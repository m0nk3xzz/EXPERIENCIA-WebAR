// ============================================================
// SESSION MANAGER — ciclo de vida del objeto invocado
// ============================================================
// Una sola sesión activa a la vez. Forma de `session`:
// { entry, anchor, model, decoupled, centered, centeringComplete,
//   baseModelScale, baseRotation, decoupleTimeoutId }
//
// Luz de vitrina en 3D: al materializarse, la pieza "entra en la luz"
// (rampa de la luz KEY) y su sombra de contacto aparece después; al
// salir, la escala se condensa y la sombra se desvanece. La pieza NUNCA
// se desvanece por opacidad: sus materiales están compartidos con la
// plantilla cacheada y animarlos afectaría a todas las instancias.

import * as THREE from 'three';
import { loadModelTemplate, instantiateModel, setContactShadowFreeFloat } from './modelCache.js';
import * as motion from './motion.js';
import * as ui from './ui.js';
import * as handTracking from './handTracking.js';
import * as gestureControl from './gestureControl.js';
import { feedback } from './feedback.js';
import { t } from './i18n.js';
import {
  setActiveObject as setVoiceActiveObject,
  clearActiveObject as clearVoiceActiveObject
} from './voiceAgent.js';
import {
  DECOUPLE_DELAY_MS,
  CENTER_DELAY_MS,
  CENTER_ANIMATION_MS,
  CENTER_POSITION,
  CENTER_ROTATION,
  SHEET_OPEN_POSITION,
  SHEET_OPEN_ROTATION,
  SHEET_OPEN_SCALE_FACTOR,
  EXIT_DURATION_MS,
  KEY_LIGHT_INTENSITY,
  KEY_LIGHT_RAMP_FROM,
  KEY_LIGHT_RAMP_MS,
  SHADOW_FADE_DELAY_MS,
  SHADOW_FADE_MS
} from './config.js';

let camera = null;
let mindarThree = null;
let container = null;
let keyLight = null;
let activeSession = null;

export function init({ camera: cam, mindarThree: mindar, container: cont, keyLight: key = null }) {
  camera = cam;
  mindarThree = mindar;
  container = cont;
  keyLight = key;
}

export function getActiveSession() {
  return activeSession;
}

// Libera el estado del objeto activo (sesión + voz + micrófono). Los tres
// caminos que terminan una invocación —fallo de carga, pérdida del marcador
// durante la carga y error de voz— tenían su propia versión parcial de
// esta limpieza; centralizarla evita que alguno se olvide del micrófono.
function releaseActiveObject() {
  activeSession = null;
  clearVoiceActiveObject(); // incluye releaseMic()
}

// --- Luz de vitrina ---

// La pieza entra en la luz: la KEY sube desde una fracción de su
// intensidad hasta la base. Un tween nuevo con la misma key reemplaza al
// anterior (una segunda materialización rápida no se pisa a sí misma).
function rampKeyLight() {
  if (!keyLight) return;
  motion.tween(keyLight, {
    from: KEY_LIGHT_INTENSITY * KEY_LIGHT_RAMP_FROM,
    to: KEY_LIGHT_INTENSITY,
    dur: KEY_LIGHT_RAMP_MS,
    ease: 'out',
    apply: (value) => { keyLight.intensity = value; }
  });
}

// La sombra de contacto tiene su PROPIO material por instancia
// (createContactShadow), así que animar su opacidad es seguro.
function fadeShadowIn(instance) {
  const shadow = instance.userData.contactShadow;
  if (!shadow) return;
  motion.tween(shadow, {
    from: 0,
    to: 1,
    dur: SHADOW_FADE_MS,
    delay: SHADOW_FADE_DELAY_MS,
    ease: 'out',
    apply: (value) => { shadow.material.opacity = value; }
  });
}

function fadeShadowOut(instance) {
  const shadow = instance.userData.contactShadow;
  if (!shadow) return;
  motion.tween(shadow, {
    from: shadow.material.opacity,
    to: 0,
    dur: EXIT_DURATION_MS,
    ease: 'in',
    apply: (value) => { shadow.material.opacity = value; }
  });
}

// --- Invocación (marcador detectado) ---

export async function handleTargetFound(entry, anchor) {
  if (activeSession) return; // un solo objeto activo a la vez

  console.log(`Marcador detectado: ${entry.name}`);
  setVoiceActiveObject(entry);
  ui.scan.found(entry);

  // Reservar la sesión antes de que termine de cargar: una segunda
  // detección del mismo marcador no dispara una carga en paralelo.
  const session = {
    entry,
    anchor,
    model: null,
    decoupled: false,
    centered: false,
    centeringComplete: false,
    baseModelScale: 1,
    baseRotation: new THREE.Euler(),
    decoupleTimeoutId: null
  };
  activeSession = session;

  try {
    const template = await loadModelTemplate(entry);

    // Si ESTA sesión se canceló mientras cargaba, no agregar un modelo
    // huérfano. Se compara identidad de sesión (no de entry): tras un
    // found→lost→found rápido hay dos sesiones en carga con el mismo entry.
    if (activeSession !== session) return;

    const instance = instantiateModel(entry, template);
    anchor.group.add(instance);
    session.model = instance;

    // Materialización: la pieza entra al 86% y asienta a su escala real,
    // mientras la luz KEY sube y la sombra espera su turno.
    const materializeScale = instance.scale.x;
    instance.scale.multiplyScalar(0.86);
    motion.pose(instance, { scale: materializeScale }, { tau: 0.09 });
    rampKeyLight();
    fadeShadowIn(instance);
    feedback.modelReady();

    ui.scan.modelReady();

    session.decoupleTimeoutId = setTimeout(
      () => decoupleModelFromMarker(session),
      DECOUPLE_DELAY_MS
    );
  } catch (err) {
    console.error(`No se pudo cargar/mostrar "${entry.name}":`, err);
    // El reintento real es alejar la cédula y volver a apuntarla
    // (onTargetFound solo dispara en la transición false→true). El error
    // se muestra DESPUÉS del reset: al revés, toSearch() ocultaba el chip
    // que se acababa de mostrar y el visitante no veía ningún diagnóstico.
    if (activeSession === session) releaseActiveObject();
    ui.scan.toSearch();
    ui.scan.error(t('scan.errorLoad', { name: ui.localizedName(entry) }));
  }
}

// Si el usuario retira el marcador antes del timer, desacople inmediato.
export function handleTargetLost(entry, anchor) {
  const session = activeSession;
  if (!session || session.entry !== entry || session.decoupled) return;

  if (session.decoupleTimeoutId !== null) {
    clearTimeout(session.decoupleTimeoutId);
    session.decoupleTimeoutId = null;
  }

  if (!session.model) {
    // Perdido durante la carga: cancelar para no bloquear otros marcadores.
    releaseActiveObject();
    ui.scan.toSearch();
    return;
  }

  decoupleModelFromMarker(session);
}

// --- Desacople (marcador → cámara) ---

function decoupleModelFromMarker(session) {
  if (session.decoupled || !session.model) return;

  session.decoupleTimeoutId = null;
  console.log(`Desacoplando "${session.entry.name}" del marcador...`);

  // Conservar la transformación mundial al re-parentar a la cámara:
  // sin salto visual.
  session.model.updateMatrixWorld(true);
  const worldMatrix = session.model.matrixWorld.clone();

  session.anchor.group.remove(session.model);
  camera.add(session.model);
  camera.updateMatrixWorld(true);

  const cameraInverse = new THREE.Matrix4().copy(camera.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(cameraInverse, worldMatrix);
  localMatrix.decompose(session.model.position, session.model.quaternion, session.model.scale);

  session.decoupled = true;
  session.model.visible = true;

  // La sombra de contacto pasa a modo flotante (horizontal bajo la pieza).
  setContactShadowFreeFloat(session.model, true);

  // Anillo de espera que se llena mientras dura delay + centrado.
  ui.scan.decouple(CENTER_DELAY_MS + CENTER_ANIMATION_MS);

  setTimeout(() => centerModelOnCamera(session), CENTER_DELAY_MS);

  // Se apaga el image tracking (la pieza ya quedó fija a la cámara) y
  // arranca el hand tracking.
  if (mindarThree?.controller?.stopProcessVideo) {
    mindarThree.controller.stopProcessVideo();
  }
  handTracking.activate(container, mindarThree.renderer.domElement);
}

// --- Centrado frente a cámara ---

function centerModelOnCamera(session) {
  if (session.centered || !session.model || !session.decoupled) return;
  session.centered = true;

  const targetPosition = session.entry.centerPosition ?? CENTER_POSITION;
  const targetRotation = session.entry.centerRotation ?? CENTER_ROTATION;
  const targetQuaternion = new THREE.Quaternion().setFromEuler(targetRotation);

  // Glide de duración fija: la entrada escalonada de la sección 4
  // depende de que termine en un momento predecible.
  motion.pose(
    session.model,
    { position: targetPosition, quaternion: targetQuaternion },
    {
      mode: 'glide',
      duration: CENTER_ANIMATION_MS,
      onArrive: () => {
        if (activeSession !== session) return; // re-escaneada a mitad de camino

        session.baseModelScale = session.model.scale.x;

        // Los gestos de rotación se SUMAN a esta base (no la reemplazan).
        // Se fija el Euler exacto para evitar que la descomposición
        // quaternión→Euler dé una representación equivalente pero distinta.
        session.model.rotation.copy(targetRotation);
        session.baseRotation = targetRotation.clone();

        session.centeringComplete = true;

        ui.scan.hide();
        ui.interaction.show(session.entry);
      }
    }
  );
}

// --- Volver a modo escaneo ---

export function resetToScanMode() {
  const session = activeSession;
  if (!session || !session.decoupled || !session.model) return;

  clearVoiceActiveObject();
  ui.interaction.hide();

  handTracking.deactivate();
  gestureControl.reset();

  // Salida espejo de la materialización: condensa en escala mientras su
  // sombra se desvanece y, al terminar, sale de la escena. La sesión se
  // libera de inmediato para permitir re-escanear sin esperar a la
  // animación. La instancia comparte geometría/materiales con la
  // plantilla cacheada: no se llama dispose() sobre ella ni se anima la
  // opacidad de sus materiales.
  const model = session.model;
  motion.cancelPose(model);
  fadeShadowOut(model);
  motion.pose(model, { scale: model.scale.x * 0.55 }, {
    mode: 'exit',
    duration: EXIT_DURATION_MS,
    onArrive: () => camera.remove(model)
  });

  // Forzar la transición de visibilidad para que onTargetFound vuelva a disparar.
  session.anchor.visible = false;
  session.anchor.group.visible = false;

  if (session.decoupleTimeoutId !== null) clearTimeout(session.decoupleTimeoutId);

  activeSession = null;

  if (mindarThree?.controller?.processVideo && mindarThree?.video) {
    mindarThree.controller.processVideo(mindarThree.video);
  }

  ui.scan.show();
}

// --- Recalibrar desde la sección 4 ---

export async function recalibrate() {
  if (!mindarThree?.video || !handTracking.isReady()) return false;

  const session = activeSession;
  const modelWasVisible = session?.model?.visible ?? false;

  if (session?.model) session.model.visible = false;

  // runCalibration pausa y reanuda la detección por frame por su cuenta
  // (handTracking.pauseDetection): es el dueño exclusivo del landmarker
  // mientras corre, así que acá no hace falta deactivate()/activate().
  gestureControl.reset();

  await handTracking.runCalibration(mindarThree.video, container);

  if (session?.model && modelWasVisible) {
    // Reaparición con la misma materialización breve del inicio.
    const reappearScale = session.model.scale.x;
    session.model.scale.multiplyScalar(0.9);
    session.model.visible = true;
    motion.pose(session.model, { scale: reappearScale }, { tau: 0.09 });
  }
  ui.interaction.reshow();

  return true;
}

// --- "Traer al frente" (rescate de la pieza fuera de cuadro) ---

export function recenterModel() {
  const session = activeSession;
  // Sin pieza centrada, o con la ficha abierta (ahí la pieza está en su
  // pose de ficha, no perdida), no hay nada que rescatar.
  if (!session?.model || !session.centeringComplete || sheetSavedTransform) return;

  const targetPosition = session.entry.centerPosition ?? CENTER_POSITION;
  const targetRotation = session.entry.centerRotation ?? CENTER_ROTATION;

  // Los acumuladores de gesto vuelven a cero: rotación limpia desde la base.
  gestureControl.reset();

  motion.pose(
    session.model,
    { position: targetPosition, quaternion: new THREE.Quaternion().setFromEuler(targetRotation) },
    {
      mode: 'glide',
      duration: 600,
      onArrive: () => {
        if (activeSession !== session) return;
        session.model.rotation.copy(targetRotation);
        session.baseRotation = targetRotation.clone();
      }
    }
  );
}

// --- Ficha de la obra (bottom sheet) ---
// Al abrir: la pieza toma la pose de lectura (SHEET_* o overrides por
// entrada del catálogo). Al cerrar: vuelve exactamente a la transformación
// que tenía el visitante (los gestos no se pierden). El settle (τ=0.11 s)
// equivale a la duración de la hoja (--dur-panel).

let sheetSavedTransform = null;

export function setSheetOpen(open) {
  const session = activeSession;
  if (!session?.model || !session.centeringComplete) return;

  if (open && !sheetSavedTransform) {
    sheetSavedTransform = {
      position: session.model.position.clone(),
      quaternion: session.model.quaternion.clone(),
      scale: session.model.scale.x
    };

    const sheetPosition = session.entry.sheetPosition ?? SHEET_OPEN_POSITION;
    const sheetRotation = session.entry.sheetRotation ?? SHEET_OPEN_ROTATION;
    const sheetScaleFactor = session.entry.sheetScaleFactor ?? SHEET_OPEN_SCALE_FACTOR;

    // Posición, rotación y escala viajan juntas en una sola pose settle.
    motion.pose(
      session.model,
      {
        position: sheetPosition,
        quaternion: new THREE.Quaternion().setFromEuler(sheetRotation),
        scale: session.baseModelScale * sheetScaleFactor
      },
      { tau: 0.11 }
    );
  } else if (!open && sheetSavedTransform) {
    const saved = sheetSavedTransform;
    sheetSavedTransform = null;
    motion.pose(session.model, saved, { tau: 0.11 });
  }
}
