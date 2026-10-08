// ============================================================
// CAMERA RECOVERY — la cámara sobrevive al segundo plano
// ============================================================
// Al minimizar el navegador, el sistema corta (o silencia) el track de la
// cámara. Al volver, el <video> de MindAR queda congelado en el último
// frame y nada lo reactiva solo. Acá se vigila el estado real del video
// (track vivo + currentTime avanzando) y, si está muerto, se pide un
// stream nuevo y se reasigna al MISMO elemento: MindAR y MediaPipe siguen
// leyendo el mismo <video>, así que no hay que reconstruir nada.

import {
  CAMERA_RECHECK_DELAY_MS,
  CAMERA_FRAME_PROBE_MS,
  CAMERA_MAX_ATTEMPTS,
  CAMERA_RETRY_DELAY_MS
} from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// onRecovered(reason): se llama solo si hubo que reiniciar el stream.
export function watchCamera(video, { onRecovered } = {}) {
  let recovering = false;
  let recheckTimer = null;

  function liveTrack() {
    const track = video.srcObject?.getVideoTracks?.()[0];
    return track && track.readyState === 'live' ? track : null;
  }

  // ¿Llegan frames nuevos? Un video congelado conserva su currentTime.
  async function framesAdvance(ms = CAMERA_FRAME_PROBE_MS) {
    const startTime = video.currentTime;
    await sleep(ms);
    return video.currentTime > startTime;
  }

  async function isHealthy() {
    if (!liveTrack()) return false;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        // si no deja reproducir, la prueba de frames lo delata
      }
    }
    return framesAdvance();
  }

  function bindTrack(stream) {
    stream.getVideoTracks().forEach((track) => {
      // Otra app tomó la cámara, o el sistema la cortó con la página visible.
      track.addEventListener('ended', () => scheduleCheck('track-ended'));
    });
  }

  async function restartStream() {
    const oldStream = video.srcObject;
    const width = video.videoWidth;
    const height = video.videoHeight;

    oldStream?.getTracks().forEach((track) => track.stop());

    // Misma resolución que tenía: MindAR calibró su proyección con ella.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        ...(width && height ? { width: { ideal: width }, height: { ideal: height } } : {})
      }
    });

    video.srcObject = stream;
    await video.play();
    bindTrack(stream);
  }

  async function check(reason) {
    if (recovering || document.hidden) return;
    recovering = true;

    try {
      for (let attempt = 0; attempt < CAMERA_MAX_ATTEMPTS; attempt++) {
        if (document.hidden) return;
        if (await isHealthy()) return;

        console.warn(`Cámara congelada (${reason}); reiniciando stream, intento ${attempt + 1}.`);
        try {
          await restartStream();
          if (await framesAdvance(600)) {
            console.log('Cámara recuperada.');
            onRecovered?.(reason);
            return;
          }
        } catch (err) {
          console.warn('No se pudo reiniciar la cámara:', err);
          // Sin permiso o sin dispositivo no hay nada que reintentar.
          if (err?.name === 'NotAllowedError' || err?.name === 'NotFoundError') return;
        }

        await sleep(CAMERA_RETRY_DELAY_MS);
      }
    } finally {
      recovering = false;
    }
  }

  function scheduleCheck(reason) {
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(() => check(reason), CAMERA_RECHECK_DELAY_MS);
  }

  const onVisibility = () => {
    if (!document.hidden) scheduleCheck('visible');
  };
  // pageshow cubre el regreso desde la caché de páginas (bfcache).
  const onPageShow = (event) => {
    if (event.persisted) scheduleCheck('pageshow');
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  if (video.srcObject) bindTrack(video.srcObject);

  return () => {
    clearTimeout(recheckTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
  };
}
