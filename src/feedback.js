// ============================================================
// FEEDBACK — háptica y sonidos suaves
// ============================================================
// Refuerzo no visual de los momentos clave, sincronizado con su
// animación (el feedback se dispara en el mismo instante que el gesto
// visual: pulso del retículo, check dibujado, halo del micrófono, nudge).
// Se puede desactivar por museo (salas silenciosas) con
// { haptics: false, sound: false } en theme.js.

let enabled = { haptics: true, sound: true };
let audioContext = null;

export function configureFeedback({ haptics = true, sound = true } = {}) {
  enabled = { haptics, sound };
}

// El AudioContext se crea dentro del gesto de usuario ("Comenzar") para
// que iOS/Safari no lo deje suspendido.
export function unlockAudio() {
  if (!enabled.sound) return;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      return;
    }
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function vibrate(pattern) {
  if (enabled.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

// Pulso breve con gain muy bajo: matiz, no alarma. Con endFrequency el
// tono se desliza (curva exponencial) en vez de mantenerse.
function tone(frequency, durationMs = 90, endFrequency = null) {
  if (!enabled.sound || !audioContext || audioContext.state !== 'running') return;

  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, now);
  if (endFrequency) {
    osc.frequency.exponentialRampToValueAtTime(endFrequency, now + durationMs / 1000);
  }
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.06, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

  osc.connect(gain).connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.05);
}

// Momentos con feedback:
export const feedback = {
  // Sincronizado con el pulso de la retícula al cerrarse sobre la cédula.
  targetFound() {
    vibrate(18);
    tone(440, 90);
  },
  // Más agudo que el targetFound para no confundir los dos momentos.
  // Sincronizado con el check que se dibuja.
  calibrationDone() {
    vibrate(18);
    tone(587, 90);
  },
  // La pieza entra en la luz: tono suave descendente, solo sonido (la
  // háptica ya la dio targetFound segundos antes).
  modelReady() {
    tone(494, 200, 370);
  },
  // Solo háptica: un sonido interferiría con la propia voz del usuario.
  // Sincronizado con el halo del micrófono.
  listeningStart() {
    vibrate(10);
  },
  // Vibración doble, sin sonido: el color ya comunica el error.
  // Sincronizado con el nudge.
  error() {
    vibrate([40, 60, 40]);
  }
};
