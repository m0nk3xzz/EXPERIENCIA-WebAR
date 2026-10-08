// ============================================================
// PCMPlayer — streaming de los chunks PCM16 24 kHz de Gemini
// ============================================================
// Los chunks se agendan uno tras otro con _nextStartTime. El aviso de
// "terminó de sonar" espera un debounce por si llega otro chunk enseguida,
// para que la UI no parpadee entre "Respondiendo" e inactivo.

import { PLAYBACK_END_DEBOUNCE_MS } from '../config.js';

export class PCMPlayer {

  constructor() {
    this._context = null;
    this._nextStartTime = 0;
    this._activeSources = [];
    this._onPlaybackEnd = null;
    this._endTimer = null;
  }

  _ensureContext() {
    if (!this._context) {
      this._context = new AudioContext({ sampleRate: 24000 });
    }
    if (this._context.state === 'suspended') {
      this._context.resume();
    }
    return this._context;
  }

  // Llamar síncrono dentro del gesto del usuario (pointerdown / "Comenzar").
  unlock() {
    this._ensureContext();
  }

  enqueue(base64Chunk) {
    const context = this._ensureContext();

    // Llegó audio nuevo: cancelar un aviso de fin pendiente.
    this._clearEndTimer();

    const binary = atob(base64Chunk);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);

    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }

    const audioBuffer = context.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime, this._nextStartTime);

    source.start(startAt);
    this._nextStartTime = startAt + audioBuffer.duration;

    this._activeSources.push(source);

    source.onended = () => {
      this._activeSources = this._activeSources.filter((s) => s !== source);
      if (this._activeSources.length === 0) this._scheduleEndNotice();
    };
  }

  // Interrupción del servidor o barge-in del usuario.
  stopAndClear() {
    this._clearEndTimer();

    this._activeSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // ya puede haber terminado solo
      }
    });
    this._activeSources = [];

    if (this._context) {
      this._nextStartTime = this._context.currentTime;
    }
  }

  get isPlaying() {
    return this._activeSources.length > 0;
  }

  set onPlaybackEnd(callback) {
    this._onPlaybackEnd = callback;
  }

  _scheduleEndNotice() {
    this._clearEndTimer();
    this._endTimer = setTimeout(() => {
      this._endTimer = null;
      if (this._activeSources.length === 0 && this._onPlaybackEnd) {
        this._onPlaybackEnd();
      }
    }, PLAYBACK_END_DEBOUNCE_MS);
  }

  _clearEndTimer() {
    if (this._endTimer !== null) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }
  }
}
