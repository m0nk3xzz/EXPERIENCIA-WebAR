// ============================================================
// HAND TRACKING — MediaPipe HandLandmarker, clasificación de pose
// y calibración por usuario
// ============================================================
// Expone: init/isReady/activate/deactivate/detect (ciclo de vida) y
// classifyHandPose/runCalibration (control de gestos y arranque).

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { calibration as calUI, setGestureState } from './ui.js';
import {
  MEDIAPIPE_WASM_URL,
  HANDS_INIT_TIMEOUT_MS,
  HAND_LANDMARKER_MODEL_URL,
  HAND_LANDMARK_OPACITY,
  CALIBRATION_LANDMARK_OPACITY,
  HAND_CONNECTIONS,
  HAND_DETECTION_FRAME_INTERVAL,
  DEFAULT_FINGER_EXTENSION_MARGIN,
  DEFAULT_THUMB_ENTER_THRESHOLD,
  DEFAULT_THUMB_EXIT_THRESHOLD,
  CALIBRATION_COUNTDOWN_MS,
  CALIBRATION_SAMPLE_MS,
  CALIBRATION_DONE_MESSAGE_MS,
  NO_HAND_HINT_MS
} from './config.js';

let handLandmarker = null;
let active = false;

// Pausa de la detección por frame. MediaPipe exige un ÚNICO consumidor de
// detectForVideo sobre la misma instancia: runCalibration corre sus propias
// detecciones, así que el loop de render debe quedarse quieto mientras
// dura. Se activa/desactiva desde runCalibration y recalibrate.
let detectionPaused = false;

// Promesa de la inicialización del landmarker, sin timeout: con timeout, la
// carga abandonada seguía viva y podía dejar el landmarker listo en
// cualquier momento, con la UI (y las guardas) creyendo que no estaba. Acá
// se sabe exactamente cuándo termina, incluso si el arranque ya se rindió.
let landmarkerInitPromise = null;
let bootGaveUp = false;

let overlayCanvas = null;
let overlayCtx = null;
let overlayContainer = null;

// Rects de layout cacheadas: leer getBoundingClientRect por detección
// forzaría layout síncrono contra las escrituras por frame del overlay.
// Se invalidan en resize.
let layoutCache = null;
let layoutCacheVideo = null;

let latestResults = null;
let frameCounter = 0;

// Contador creciente por detección real: gestureControl distingue así una
// muestra nueva de un resultado reusado en frames intermedios.
let detectionId = 0;

// Umbrales calibrables (runCalibration). Si se salta, quedan los defaults.
let fingerExtensionMargins = {
  index: DEFAULT_FINGER_EXTENSION_MARGIN,
  middle: DEFAULT_FINGER_EXTENSION_MARGIN,
  ring: DEFAULT_FINGER_EXTENSION_MARGIN,
  pinky: DEFAULT_FINGER_EXTENSION_MARGIN
};
let thumbEnterThreshold = DEFAULT_THUMB_ENTER_THRESHOLD;
let thumbExitThreshold = DEFAULT_THUMB_EXIT_THRESHOLD;

// Histéresis del pulgar (ver isThumbExtended).
let thumbWasExtended = false;

// El esqueleto se dibuja con más presencia durante la calibración.
let landmarkOpacity = HAND_LANDMARK_OPACITY;

// --- Ciclo de vida ---

// Arranca la carga (WASM + modelo) y la acota con un techo de espera. Si el
// techo vence, el hito de arranque termina en 'warn' y la experiencia
// continúa sin gestos; si el landmarker llega más tarde, onReady avisa para
// habilitar la recalibración.
//
// El import de @mediapipe/tasks-vision es ESTÁTICO a propósito: el arranque
// espera este hito antes de mostrar el escaneo (ver main.js), así que
// diferirlo no ahorraría ninguna descarga.
export function init({ onReady = null } = {}) {
  if (!landmarkerInitPromise) {
    landmarkerInitPromise = initLandmarker().then(
      (landmarker) => {
        handLandmarker = landmarker;
        console.log('HandLandmarker listo.');
        // Solo se avisa si el arranque ya se había rendido: en el camino
        // normal main.js ya consultó isReady() y no hace falta repetir.
        if (bootGaveUp && onReady) onReady();
        return landmarker;
      },
      (err) => {
        console.error('No se pudo inicializar HandLandmarker:', err);
        handLandmarker = null;
        throw err;
      }
    );
  }

  return withTimeout(
    landmarkerInitPromise,
    HANDS_INIT_TIMEOUT_MS,
    'HandLandmarker tardó demasiado en cargar (WASM/modelo)'
  ).catch((err) => {
    // Se marca la rendición para que la resolución tardía avise a la UI.
    bootGaveUp = true;
    throw err;
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// GPU primero; si el dispositivo no lo soporta, un reintento con CPU.
async function initLandmarker() {
  console.log('Cargando HandLandmarker...');

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

  try {
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL, delegate: 'GPU' },
      numHands: 1,
      runningMode: 'VIDEO'
    });
    console.log('HandLandmarker listo (GPU).');
    return landmarker;
  } catch (gpuError) {
    console.warn('Delegate GPU falló, reintentando con CPU:', gpuError);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL, delegate: 'CPU' },
      numHands: 1,
      runningMode: 'VIDEO'
    });
    console.log('HandLandmarker listo (CPU, fallback).');
    return landmarker;
  }
}

export function isReady() {
  return handLandmarker !== null;
}

// Pausa/reanuda la detección por frame. runCalibration la usa para ser el
// único consumidor de detectForVideo mientras corre (MediaPipe no soporta
// dos llamadas concurrentes sobre la misma instancia: se corrompe el grafo).
export function pauseDetection() {
  detectionPaused = true;
}

export function resumeDetection() {
  detectionPaused = false;
}

// Crea el overlay y habilita detect(). Se llama tras el desacople del modelo.
export function activate(container, insertBeforeEl) {
  if (active) return;
  active = true;

  ensureOverlay(container, insertBeforeEl);
  setGestureState({ active: null, detected: false });

  console.log('Hand tracking activo.');
}

export function deactivate() {
  active = false;
  latestResults = null;
  frameCounter = 0;
  thumbWasExtended = false;

  clearOverlay();
  setGestureState({ active: null, detected: false });
}

// La detección pesada corre cada HAND_DETECTION_FRAME_INTERVAL frames;
// el resto reusa latestResults. detectionPaused corta la detección por
// completo: durante la calibración, collectPoseSamples es el único que
// puede llamar a detectForVideo.
export function detect(video) {
  if (!active || detectionPaused || !handLandmarker || !video || video.readyState < 2) return null;

  frameCounter++;
  if (frameCounter % HAND_DETECTION_FRAME_INTERVAL !== 0) return latestResults;

  latestResults = handLandmarker.detectForVideo(video, performance.now());
  detectionId++;
  drawLandmarks(video, latestResults);

  return latestResults;
}

export function getDetectionId() {
  return detectionId;
}

// --- Overlay de landmarks ---

// Crea el canvas la primera vez y siempre lo (re)ubica antes de
// insertBeforeEl. En calibración nace al final del contenedor; al activar
// el tracking hay que moverlo bajo el canvas de three.js para que el
// esqueleto no tape al modelo.
function ensureOverlay(container, insertBeforeEl) {
  if (!overlayCanvas) {
    overlayContainer = container;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;
    `;
    overlayCtx = overlayCanvas.getContext('2d');

    window.addEventListener('resize', resizeOverlay);
  }

  container.insertBefore(overlayCanvas, insertBeforeEl);
  resizeOverlay();
}

function resizeOverlay() {
  if (!overlayCanvas || !overlayContainer) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  overlayCanvas.width = overlayContainer.clientWidth * dpr;
  overlayCanvas.height = overlayContainer.clientHeight * dpr;
  layoutCache = null;
}

function clearOverlay() {
  if (overlayCtx && overlayCanvas) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
}

function landmarkToCanvasPoint(landmark, containerRect, videoRect, dpr) {
  const xInContainer = (videoRect.left - containerRect.left) + landmark.x * videoRect.width;
  const yInContainer = (videoRect.top - containerRect.top) + landmark.y * videoRect.height;
  return { x: xInContainer * dpr, y: yInContainer * dpr };
}

function drawLandmarks(video, results) {
  if (!overlayCtx || !overlayCanvas) return;

  // Opacidad 0 = esqueleto invisible: ni limpiar ni redibujar 21 puntos y
  // 21 líneas cada 4 frames en un loop que ya carga con MediaPipe + Three
  // + cámara. La calibración sube la opacidad, así que ahí sí dibuja.
  if (landmarkOpacity === 0) return;

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!results || !results.landmarks.length) return;

  const dpr = Math.min(window.devicePixelRatio, 2);
  if (!layoutCache || layoutCacheVideo !== video) {
    layoutCache = {
      container: overlayContainer.getBoundingClientRect(),
      video: video.getBoundingClientRect()
    };
    layoutCacheVideo = video;
  }
  const containerRect = layoutCache.container;
  const videoRect = layoutCache.video;

  overlayCtx.globalAlpha = landmarkOpacity;

  results.landmarks.forEach((handLandmarks) => {
    overlayCtx.strokeStyle = '#00ffcc';
    overlayCtx.lineWidth = 3 * dpr;

    HAND_CONNECTIONS.forEach(([a, b]) => {
      const pointA = landmarkToCanvasPoint(handLandmarks[a], containerRect, videoRect, dpr);
      const pointB = landmarkToCanvasPoint(handLandmarks[b], containerRect, videoRect, dpr);
      overlayCtx.beginPath();
      overlayCtx.moveTo(pointA.x, pointA.y);
      overlayCtx.lineTo(pointB.x, pointB.y);
      overlayCtx.stroke();
    });

    overlayCtx.fillStyle = '#ff3366';
    handLandmarks.forEach((landmark) => {
      const point = landmarkToCanvasPoint(landmark, containerRect, videoRect, dpr);
      overlayCtx.beginPath();
      overlayCtx.arc(point.x, point.y, 5 * dpr, 0, Math.PI * 2);
      overlayCtx.fill();
    });
  });

  overlayCtx.globalAlpha = 1;
}

// --- Clasificación de pose ---

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Extendido si la punta está más lejos de la muñeca que el PIP, con
// margen proporcional al tamaño de la mano (calibrable).
function isFingerExtended(landmarks, tipIndex, pipIndex, fingerKey) {
  const wrist = landmarks[0];
  const handSize = distance2D(wrist, landmarks[5]) || 1;
  const distTip = distance2D(wrist, landmarks[tipIndex]);
  const distPip = distance2D(wrist, landmarks[pipIndex]);
  const margin = fingerExtensionMargins[fingerKey] ?? DEFAULT_FINGER_EXTENSION_MARGIN;

  return (distTip - distPip) > handSize * margin;
}

// El pulgar se clasifica aparte y con histéresis (umbrales distintos de
// entrada y salida) para no parpadear cerca del umbral.
function isThumbExtended(landmarks) {
  const wrist = landmarks[0];
  const handSize = distance2D(wrist, landmarks[5]) || 1;
  const distance = distance2D(landmarks[4], landmarks[5]);

  const enterThreshold = handSize * thumbEnterThreshold;
  const exitThreshold = handSize * thumbExitThreshold;

  thumbWasExtended = thumbWasExtended ? distance > exitThreshold : distance > enterThreshold;
  return thumbWasExtended;
}

// 'scale' (índice+pulgar) | 'rotateY' (índice) | 'rotateX' (índice+medio)
// | 'move' (puño cerrado) | null.
export function classifyHandPose(landmarks) {
  const thumbExtended = isThumbExtended(landmarks);
  const indexExtended = isFingerExtended(landmarks, 8, 6, 'index');
  const middleExtended = isFingerExtended(landmarks, 12, 10, 'middle');
  const ringExtended = isFingerExtended(landmarks, 16, 14, 'ring');
  const pinkyExtended = isFingerExtended(landmarks, 20, 18, 'pinky');
  const ringAndPinkyCurled = !ringExtended && !pinkyExtended;

  if (!indexExtended && !middleExtended && ringAndPinkyCurled) return 'move';
  if (!ringAndPinkyCurled) return null;
  if (indexExtended && middleExtended) return 'rotateX';
  if (indexExtended && !middleExtended) return thumbExtended ? 'scale' : 'rotateY';

  return null;
}

export function resetPoseState() {
  thumbWasExtended = false;
}

// --- Calibración por usuario ---

function average(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function sleepUnlessSkipped(ms, isSkipped, onProgress = null) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    function check() {
      if (isSkipped() || performance.now() - startTime >= ms) resolve();
      else {
        onProgress?.(Math.min((performance.now() - startTime) / ms, 1));
        requestAnimationFrame(check);
      }
    }
    check();
  });
}

// Acumula por frame la proporción (distancia relevante / tamaño de mano)
// de cada dedo. onProgress alimenta el anillo; onDetection la pill y el
// chip de ayuda de la UI.
function collectPoseSamples(video, durationMs, isSkipped, onProgress = null, onDetection = null) {
  return new Promise((resolve) => {
    const samples = { index: [], middle: [], ring: [], pinky: [], thumb: [] };
    const startTime = performance.now();
    let lastDetectedAt = startTime;

    function step(now) {
      if (isSkipped()) return resolve(samples);

      if (video.readyState >= 2 && handLandmarker) {
        const results = handLandmarker.detectForVideo(video, now);
        drawLandmarks(video, results);

        if (results.landmarks.length) {
          lastDetectedAt = now;
          onDetection?.(true, 0);

          const landmarks = results.landmarks[0];
          const wrist = landmarks[0];
          const handSize = distance2D(wrist, landmarks[5]) || 1;

          samples.index.push((distance2D(wrist, landmarks[8]) - distance2D(wrist, landmarks[6])) / handSize);
          samples.middle.push((distance2D(wrist, landmarks[12]) - distance2D(wrist, landmarks[10])) / handSize);
          samples.ring.push((distance2D(wrist, landmarks[16]) - distance2D(wrist, landmarks[14])) / handSize);
          samples.pinky.push((distance2D(wrist, landmarks[20]) - distance2D(wrist, landmarks[18])) / handSize);
          samples.thumb.push(distance2D(landmarks[4], landmarks[5]) / handSize);
        } else {
          onDetection?.(false, now - lastDetectedAt);
        }
      }

      onProgress?.(Math.min((now - startTime) / durationMs, 1));
      if (now - startTime < durationMs) requestAnimationFrame(step);
      else resolve(samples);
    }

    requestAnimationFrame(step);
  });
}

// Aplica los umbrales por dedo y devuelve la calidad real del resultado:
// { ok, total } con total = 5. Sirve para no anunciar éxito cuando solo
// calibraron algunos dedos.
function applyCalibrationResults(fistSamples, openSamples) {
  const result = { ok: 0, total: 5 };

  ['index', 'middle', 'ring', 'pinky'].forEach((finger) => {
    const curled = average(fistSamples[finger]);
    const extended = average(openSamples[finger]);

    if (curled === null || extended === null || extended <= curled) {
      console.warn(`Calibración de "${finger}" incompleta; se usa el valor por defecto.`);
      return;
    }

    // Umbral en el punto medio entre puño y mano abierta.
    fingerExtensionMargins[finger] = (curled + extended) / 2;
    result.ok++;
    console.log(`Umbral calibrado (${finger}): ${fingerExtensionMargins[finger].toFixed(3)}`);
  });

  const thumbCurled = average(fistSamples.thumb);
  const thumbExtendedAvg = average(openSamples.thumb);

  if (thumbCurled !== null && thumbExtendedAvg !== null && thumbExtendedAvg > thumbCurled) {
    const midpoint = (thumbCurled + thumbExtendedAvg) / 2;
    const margin = (thumbExtendedAvg - thumbCurled) * 0.1;

    thumbEnterThreshold = midpoint + margin;
    thumbExitThreshold = midpoint - margin;
    result.ok++;
    console.log(`Umbral calibrado (pulgar): salida ${thumbExitThreshold.toFixed(3)} / entrada ${thumbEnterThreshold.toFixed(3)}`);
  } else {
    console.warn('Calibración de pulgar incompleta; se usa el valor por defecto.');
  }

  return result;
}

// Orquesta el flujo: puño → mano abierta → aplicar resultados → mensaje
// final. La UI vive en ui.calibration.*; los listeners de los botones se
// retiran siempre al resolver (nada queda colgando entre calibraciones).
// Mientras corre, la detección por frame queda pausada (ver
// pauseDetection): esta función es la dueña exclusiva del landmarker.
export function runCalibration(video, container) {
  return new Promise((resolveCalibration) => {
    let skipped = false;
    const isSkipped = () => skipped;

    if (!overlayCanvas) ensureOverlay(container, null);
    calUI.show();

    // La pausa se libera siempre al resolver, incluso si el flujo se
    // saltea o falla a mitad de camino.
    pauseDetection();

    const previousOpacity = landmarkOpacity;
    landmarkOpacity = CALIBRATION_LANDMARK_OPACITY;

    function handleDetection(detected, noHandMs) {
      calUI.setHandDetected(detected, noHandMs > NO_HAND_HINT_MS);
      calUI.showHint(!detected && noHandMs > NO_HAND_HINT_MS);
    }

    // Cada paso llena media vuelta del anillo: countdown + captura.
    async function runStep(stepKey, progressStart) {
      calUI.setStep(stepKey);

      await sleepUnlessSkipped(CALIBRATION_COUNTDOWN_MS, isSkipped, (frac) => {
        calUI.setProgress(progressStart + frac * 0.2);
      });
      if (skipped) return null;

      const samples = await collectPoseSamples(
        video,
        CALIBRATION_SAMPLE_MS,
        isSkipped,
        (frac) => calUI.setProgress(progressStart + 0.2 + frac * 0.3),
        handleDetection
      );
      clearOverlay();
      calUI.setHandDetected(null, false);

      return samples;
    }

    async function flow() {
      skipped = (await calUI.awaitStartOrSkip()) === 'skip';

      let fistSamples = null;
      let openSamples = null;

      if (!skipped) fistSamples = await runStep('fist', 0);
      if (!skipped) openSamples = await runStep('open', 0.5);

      clearOverlay();

      if (!skipped && fistSamples && openSamples) {
        const { ok, total } = applyCalibrationResults(fistSamples, openSamples);
        calUI.setProgress(1);

        // Final honesto: done (5/5), partial (algunos) o failed (ninguno).
        if (ok === total) calUI.setStep('done');
        else if (ok > 0) calUI.setStep('partial');
        else calUI.setStep('failed');
      } else {
        console.log('Calibración omitida o incompleta: se usan los umbrales por defecto.');
        calUI.setStep('skipped');
      }

      await new Promise((resolve) => setTimeout(resolve, CALIBRATION_DONE_MESSAGE_MS));

      landmarkOpacity = previousOpacity;
      resumeDetection();
      calUI.hide();

      resolveCalibration();
    }

    flow();
  });
}
