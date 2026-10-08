// ============================================================
// GESTURE CONTROL — velocidad del gesto + aplicación del movimiento
// ============================================================
// Tres pasos, frame-rate independent:
//   1. updateVelocity(): solo con detecciones nuevas; velocidad suavizada
//      exponencialmente según el dt real entre muestras.
//   2. applyMotion(): en todos los frames, integra la velocidad sobre el
//      dt real del frame.
//   3. Inercia: al soltar rotateX / rotateY / move, la última velocidad
//      suavizada sigue aplicándose un instante y decae con
//      τ = INERTIA_TIME_CONSTANT_S (la pieza "se posa" en vez de
//      clavarse). scale no tiene inercia. Con reduced motion no hay.

import * as THREE from 'three';
import { classifyHandPose, resetPoseState, getDetectionId } from './handTracking.js';
import { setGestureState } from './ui.js';
import { prefersReducedMotion } from './motion.js';
import {
  SCALE_MULTIPLIER_MIN,
  SCALE_MULTIPLIER_MAX,
  SCALE_SENSITIVITY,
  ROTATION_MAX_RAD,
  ROTATION_SENSITIVITY,
  MOVE_SENSITIVITY,
  MOVE_LIMIT_X,
  MOVE_LIMIT_Y,
  GESTURE_TIME_CONSTANT_S,
  GESTURE_VELOCITY_MAX_AGE_S,
  POSE_DEBOUNCE_FRAMES,
  INERTIA_GESTURES,
  INERTIA_TIME_CONSTANT_S,
  INERTIA_VELOCITY_GAIN,
  INERTIA_MIN_SPEED,
  INERTIA_STOP_SPEED,
  INERTIA_MAX_FRAME_GAP_S
} from './config.js';

let activeGesture = null;
let gestureReferencePoint = null;

let smoothedVelocityX = 0;
let smoothedVelocityY = 0;
let lastGestureSampleTime = null;
let lastGestureFrameTime = null;

let accumulatedRotationX = 0;
let accumulatedRotationY = 0;

let pendingPose = null;
let pendingPoseStreak = 0;

// Inercia en curso: { gesture, vx, vy } o null.
let inertia = null;

// Última detección procesada: detect() reusa resultados en frames
// intermedios; sin este control, updateVelocity() los procesaría varias
// veces (velocidad cruda 0 en repeticiones y debounce inútil).
let lastProcessedDetectionId = -1;

// Si el gesto que termina admite inercia y llevaba velocidad real, la
// guarda. Se llama ANTES de borrar el estado del gesto.
function captureInertia() {
  inertia = null;

  if (prefersReducedMotion()) return;
  if (!activeGesture || !INERTIA_GESTURES.includes(activeGesture)) return;

  // Una muestra vieja (mano tapada hace rato) no es un "lanzamiento".
  if (
    lastGestureSampleTime !== null &&
    (performance.now() - lastGestureSampleTime) / 1000 > GESTURE_VELOCITY_MAX_AGE_S
  ) return;

  const speed = Math.hypot(smoothedVelocityX, smoothedVelocityY);
  if (speed < INERTIA_MIN_SPEED) return;

  inertia = {
    gesture: activeGesture,
    vx: smoothedVelocityX * INERTIA_VELOCITY_GAIN,
    vy: smoothedVelocityY * INERTIA_VELOCITY_GAIN
  };
}

function clearGestureState() {
  captureInertia();

  activeGesture = null;
  gestureReferencePoint = null;
  smoothedVelocityX = 0;
  smoothedVelocityY = 0;
  lastGestureSampleTime = null;
}

export function updateVelocity(results, session) {
  if (!session?.centeringComplete || !session.model) return;

  const detectionId = getDetectionId();
  if (detectionId === lastProcessedDetectionId) return;
  lastProcessedDetectionId = detectionId;

  const now = performance.now();

  if (!results || !results.landmarks.length) {
    clearGestureState();
    pendingPose = null;
    pendingPoseStreak = 0;
    setGestureState({ active: null, detected: false });
    return;
  }

  const landmarks = results.landmarks[0];
  const rawPose = classifyHandPose(landmarks);
  const wrist = landmarks[0];

  // Una pose cruda se confirma tras repetirse N muestras seguidas.
  if (rawPose === pendingPose) pendingPoseStreak++;
  else { pendingPose = rawPose; pendingPoseStreak = 1; }

  const pose = pendingPoseStreak >= POSE_DEBOUNCE_FRAMES ? pendingPose : activeGesture;

  // El gesto activo se expone como dato (clave, no texto): la UI decide
  // cómo pintarlo (riel de gestos).
  setGestureState({ active: pose, detected: true });

  if (pose === null) {
    clearGestureState();
    return;
  }

  if (pose !== activeGesture || !gestureReferencePoint || lastGestureSampleTime === null) {
    // Gesto nuevo: se fija la referencia sin calcular velocidad todavía.
    // La mano retoma el control: cualquier inercia anterior se descarta.
    inertia = null;
    activeGesture = pose;
    gestureReferencePoint = { x: wrist.x, y: wrist.y };
    smoothedVelocityX = 0;
    smoothedVelocityY = 0;
    lastGestureSampleTime = now;
    return;
  }

  const dtSample = (now - lastGestureSampleTime) / 1000;
  if (dtSample <= 0) return;

  const rawVelocityX = (wrist.x - gestureReferencePoint.x) / dtSample;
  const rawVelocityY = (wrist.y - gestureReferencePoint.y) / dtSample;

  // Suavizado exponencial dependiente del dt real: la curva de respuesta
  // no cambia con el framerate ni con el intervalo de detección.
  const alpha = 1 - Math.exp(-dtSample / GESTURE_TIME_CONSTANT_S);
  smoothedVelocityX = THREE.MathUtils.lerp(smoothedVelocityX, rawVelocityX, alpha);
  smoothedVelocityY = THREE.MathUtils.lerp(smoothedVelocityY, rawVelocityY, alpha);

  gestureReferencePoint = { x: wrist.x, y: wrist.y };
  lastGestureSampleTime = now;
}

// En todos los frames, haya o no detección nueva.
export function applyMotion(session) {
  const now = performance.now();
  const previousFrameTime = lastGestureFrameTime;
  lastGestureFrameTime = now;

  if (!session?.centeringComplete || !session.model) return;
  if (previousFrameTime === null) return; // primer frame: dt no confiable

  const dtFrame = (now - previousFrameTime) / 1000;

  // Gesto en curso.
  if (activeGesture) {
    // Muestra demasiado vieja (mano tapada, tab en segundo plano): apagar
    // la velocidad en vez de integrar un valor obsoleto.
    if (lastGestureSampleTime !== null && (now - lastGestureSampleTime) / 1000 > GESTURE_VELOCITY_MAX_AGE_S) {
      smoothedVelocityX = 0;
      smoothedVelocityY = 0;
    }

    applyDelta(activeGesture, smoothedVelocityX * dtFrame, smoothedVelocityY * dtFrame, session);
    return;
  }

  // Sin gesto: la inercia, si la hay, termina de posar la pieza.
  if (!inertia) return;

  // Hueco grande entre frames (ficha abierta, pose, tab en segundo plano):
  // la inercia ya no es de este momento.
  if (dtFrame > INERTIA_MAX_FRAME_GAP_S) {
    inertia = null;
    return;
  }

  const decay = Math.exp(-dtFrame / INERTIA_TIME_CONSTANT_S);
  inertia.vx *= decay;
  inertia.vy *= decay;

  if (Math.hypot(inertia.vx, inertia.vy) < INERTIA_STOP_SPEED) {
    inertia = null;
    return;
  }

  applyDelta(inertia.gesture, inertia.vx * dtFrame, inertia.vy * dtFrame, session);
}

// Aplica un desplazamiento (en unidades normalizadas de imagen) del gesto
// dado sobre la pieza. Lo comparten el gesto en curso y la inercia.
function applyDelta(gesture, deltaX, deltaY, session) {
  const model = session.model;
  const baseModelScale = session.baseModelScale;

  // Las rotaciones se acumulan SOBRE la rotación de centrado.
  const baseRotationX = session.baseRotation?.x ?? 0;
  const baseRotationY = session.baseRotation?.y ?? 0;

  switch (gesture) {
    case 'scale': {
      const currentMultiplier = model.scale.x / baseModelScale;
      const nextMultiplier = currentMultiplier - deltaY * SCALE_SENSITIVITY;
      const clamped = THREE.MathUtils.clamp(nextMultiplier, SCALE_MULTIPLIER_MIN, SCALE_MULTIPLIER_MAX);
      model.scale.setScalar(baseModelScale * clamped);
      break;
    }
    case 'rotateY': {
      accumulatedRotationY = THREE.MathUtils.clamp(
        accumulatedRotationY + deltaX * ROTATION_SENSITIVITY, -ROTATION_MAX_RAD, ROTATION_MAX_RAD
      );
      model.rotation.y = baseRotationY + accumulatedRotationY;
      break;
    }
    case 'rotateX': {
      accumulatedRotationX = THREE.MathUtils.clamp(
        accumulatedRotationX - deltaY * ROTATION_SENSITIVITY, -ROTATION_MAX_RAD, ROTATION_MAX_RAD
      );
      model.rotation.x = baseRotationX + accumulatedRotationX;
      break;
    }
    case 'move': {
      // Move vive en espacio de cámara; el clamp es un barrio, no una
      // jaula (puede salir del cuadro, no del mundo).
      model.position.x = THREE.MathUtils.clamp(
        model.position.x + deltaX * MOVE_SENSITIVITY, -MOVE_LIMIT_X, MOVE_LIMIT_X
      );
      model.position.y = THREE.MathUtils.clamp(
        model.position.y - deltaY * MOVE_SENSITIVITY, -MOVE_LIMIT_Y, MOVE_LIMIT_Y
      ); // y de imagen crece hacia abajo
      break;
    }
  }
}

// Se llama al volver a modo escaneo (y al rescatar la pieza con
// "Traer al frente"): sin gesto, sin velocidad y sin inercia pendiente.
export function reset() {
  clearGestureState();
  inertia = null; // clearGestureState puede haber capturado una inercia
  pendingPose = null;
  pendingPoseStreak = 0;
  lastGestureFrameTime = null;
  lastProcessedDetectionId = -1;
  accumulatedRotationX = 0;
  accumulatedRotationY = 0;
  resetPoseState();
}
