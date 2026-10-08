// ============================================================
// MAIN — orquestador: arranque, loop de render y cableado de eventos
// ============================================================
// Flujo: 1) Presentación → 2) Calibración (opcional) → 3) Escaneo de
// marcador → 4) Interacción (gestos + voz + ficha). Toda la inicialización
// pesada espera al toque en "Comenzar" (gesto requerido por iOS/Safari
// para cámara y audio).

import { MARKER_CATALOG } from './catalog.js';
import { validateMarkerCatalog, loadModelTemplate, updateContactShadow } from './modelCache.js';
import { createScene, createAnchors } from './sceneSetup.js';
import * as handTracking from './handTracking.js';
import * as gestureControl from './gestureControl.js';
import * as sessionManager from './sessionManager.js';
import * as motion from './motion.js';
import * as ui from './ui.js';
import { initVoiceAgent, startTalking, stopTalking, sendText, warmUpAudio, resumeAudio, getVoiceState, getVoiceErrorDetail, VoiceState, VoiceErrorDetail } from './voiceAgent.js';
import { watchCamera } from './cameraRecovery.js';
import { applyTheme } from './theme.js';
import { initI18n } from './i18n.js';
import { configureFeedback, unlockAudio } from './feedback.js';
import './style.css';

// --- Punto de entrada: tema + i18n + pantalla de presentación ---

const museum = applyTheme();
configureFeedback({ haptics: museum.haptics, sound: museum.sound });
initI18n();
validateMarkerCatalog(MARKER_CATALOG);

initVoiceAgent({
  onStateChange: ui.setVoiceState,
  onTranscript: ui.addTranscript,
  onHoldHint: ui.holdHintPtt
});

ui.initIntro(museum, { onStart: begin });

ui.onAskQuestion((question) => {
  sendText(question);
});

// CTA de la ficha: guía al botón de voz, o abre el teclado si el
// micrófono es precisamente el problema (permiso denegado o ausente).
ui.onAsk(() => {
  const micBroken =
    getVoiceState() === VoiceState.ERROR &&
    (getVoiceErrorDetail() === VoiceErrorDetail.MIC_DENIED ||
      getVoiceErrorDetail() === VoiceErrorDetail.MIC_MISSING);
  if (micBroken) ui.revealKeyboard();
  else ui.coachPtt();
});

ui.onRecalibrate(() => {
  sessionManager.recalibrate();
});

ui.onSheetToggle((open) => {
  sessionManager.setSheetOpen(open);
});

ui.wireControls();

// El botón walkie-talkie se cablea desde ui.js (pointerdown/up, no click:
// distingue apretado de soltado y prepara el audio dentro del gesto en iOS).
ui.wireTalkButton({ onPressStart: startTalking, onPressEnd: stopTalking });

// Rescan y "Traer al frente" van contra el ciclo de vida de la sesión.
ui.onRescan(() => {
  sessionManager.resetToScanMode();
});

ui.onRecenter(() => {
  sessionManager.recenterModel();
});

// --------------------------------------------------------
// "Comenzar": dentro del gesto se preparan cámara y audio.
// --------------------------------------------------------

// Guarda anti re-entrada: el CSS bloquea el puntero durante el fundido,
// pero la activación por teclado (Enter con foco) no pasa por él.
let booting = false;

async function begin() {
  if (booting) return;
  booting = true;

  // Síncrono, antes de cualquier await: iOS no suspenda los AudioContext.
  unlockAudio();
  warmUpAudio();

  try {
    const container = document.querySelector('#app');
    const { mindarThree, camera, scene, renderer } = await createScene(container);

    sessionManager.init({ camera, mindarThree, container });

    createAnchors(mindarThree, MARKER_CATALOG).forEach(({ entry, anchor }) => {
      anchor.onTargetFound = () => sessionManager.handleTargetFound(entry, anchor);
      anchor.onTargetLost = () => sessionManager.handleTargetLost(entry, anchor);
    });

    // La cámara arranca acá pero el image tracking se pausa en el acto:
    // ninguna detección puede empezar una sesión invisible debajo del
    // loading. Se reanuda recién al entrar al escaneo.
    await mindarThree.start();
    mindarThree.controller.stopProcessVideo();
    ui.setBootStep('camera', 'done');

    // Segundo plano: al volver, si el video quedó congelado se pide un
    // stream nuevo sobre el mismo <video> (MindAR y MediaPipe lo siguen
    // leyendo). El audio también se reactiva.
    watchCamera(mindarThree.video, {
      onRecovered: () => restartImageTracking(mindarThree)
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resumeAudio();
    });

    // Hitos en paralelo: hand tracking + precarga de piezas estrella.
    // Un hito fallido se marca 'warn' y la experiencia continúa degradada;
    // nunca bloquea el arranque.
    //
    // El hand tracking SÍ se espera antes de entrar al escaneo (decisión
    // explícita del proyecto): pesa ~19,5 MB y puede tardar hasta
    // HANDS_INIT_TIMEOUT_MS, pero la experiencia no empieza sin gestos ni
    // sin calibración. Si el techo vence, se sigue igual marcado 'warn'.
    const handTrackingReady = handTracking.init({ onReady: markHandsReady })
      .then(() => ui.setBootStep('hands', 'done'))
      .catch((err) => {
        console.error('No se pudo inicializar HandLandmarker:', err);
        ui.setBootStep('hands', 'warn');
      });

    const preloadReady = Promise.all(
      MARKER_CATALOG.filter((entry) => entry.preload).map((entry) =>
        loadModelTemplate(entry).then(
          () => null,
          (err) => {
            console.error(`No se pudo precargar "${entry.name}":`, err);
            return entry;
          }
        )
      )
    ).then((failed) => {
      ui.setBootStep('catalog', failed.some(Boolean) ? 'warn' : 'done');
    });

    await handTrackingReady;
    // Recalibrar requiere HandLandmarker: si no está, no se ofrece el botón.
    markHandsReady();
    await preloadReady;

    // Calibración de la mano (opcional); el tracking de imagen sigue pausado.
    if (handTracking.isReady()) {
      await handTracking.runCalibration(mindarThree.video, container);
    } else {
      console.warn('HandLandmarker no disponible: se omite la calibración.');
    }

    // Con la sección de escaneo por mostrarse, el tracking vuelve a procesar.
    mindarThree.controller.processVideo(mindarThree.video);

    ui.hideIntro();
    ui.scan.show();

    renderer.setAnimationLoop(() => {
      // Un error en un frame no puede matar el loop: se registra y el
      // frame siguiente reintenta el mundo completo.
      try {
        const session = sessionManager.getActiveSession();

        // Las poses 3D (centrado, ficha, salida) se integran primero,
        // antes de gestos y render.
        motion.updatePoses();

        // Con la ficha abierta, o mientras la pieza viaja por una pose,
        // los gestos quedan pausados.
        const sheetOpen = ui.isSheetOpen();
        const modelPosing = motion.isPosing(session?.model);

        const handResults = handTracking.detect(mindarThree.video);
        if (!sheetOpen) {
          gestureControl.updateVelocity(handResults, session);
          if (!modelPosing) gestureControl.applyMotion(session);
        }

        // La sombra de contacto corre siempre (la pieza también se mueve
        // por poses, no solo por gestos).
        if (session?.model) updateContactShadow(session.model);

        ui.updateObjectOverlay(session, camera);
        renderer.render(scene, camera);
      } catch (loopError) {
        console.error('Error en el loop de render:', loopError);
      }
    });

    console.log('WebAR iniciado correctamente');
  } catch (error) {
    console.error('Error iniciando WebAR:', error);
    const isCamera = error?.name === 'NotAllowedError' || error?.name === 'NotFoundError';
    ui.showBootError(isCamera ? 'camera' : 'generic');
  }
}

// Recalibrar solo se ofrece con el HandLandmarker vivo. Se llama dos veces:
// al resolverse el init (camino normal) y desde su onReady si la carga
// llegó DESPUÉS de que venciera el techo de HANDS_INIT_TIMEOUT_MS — sin
// eso, el landmarker tardío quedaba utilizable pero sin botón que lo use.
function markHandsReady() {
  ui.setRecalibrateAvailable(handTracking.isReady());
}

// Tras recuperar la cámara, el bucle de image tracking de MindAR puede haber
// muerto leyendo un video congelado. Solo se reinicia si el escaneo está
// activo (con la pieza ya desacoplada el tracking de imagen está apagado a
// propósito). La pausa deja que el bucle viejo termine antes del nuevo.
function restartImageTracking(mindarThree) {
  // Se pregunta a la UI en vez de leer el DOM desde acá: la capa de
  // interacción visible implica que el escaneo ya terminó.
  const scanning = () =>
    !ui.isInteractionVisible() && !sessionManager.getActiveSession()?.decoupled;
  if (!scanning()) return;

  mindarThree.controller.stopProcessVideo();
  setTimeout(() => {
    if (scanning()) mindarThree.controller.processVideo(mindarThree.video);
  }, 200);
}
