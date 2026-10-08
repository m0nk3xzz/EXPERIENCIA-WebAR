// ============================================================
// AudioWorkletProcessor — captura de micrófono → PCM16
// ============================================================
// Corre en el audio thread: el hilo principal ya está ocupado con el loop
// de render y el hand tracking. Junta bloques de 128 muestras Float32 en
// chunks de 2048 (~128 ms a 16 kHz) y los manda al hilo principal como
// Int16 little-endian (formato de la Live API). El AudioContext ya abre a
// 16 kHz (voiceAgent.js), así que no hace falta re-muestrear.

const CHUNK_SIZE_SAMPLES = 2048;

class PCMRecorderProcessor extends AudioWorkletProcessor {

  constructor() {
    super();
    this._buffer = new Int16Array(CHUNK_SIZE_SAMPLES);
    this._writeIndex = 0;
  }

  process(inputs) {

    const input = inputs[0];

    // Sin micrófono conectado en este bloque.
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono

    for (let i = 0; i < channelData.length; i++) {

      // Clamp + conversión Float32 (-1..1) a Int16 (-32768..32767).
      const sample = Math.max(-1, Math.min(1, channelData[i]));

      this._buffer[this._writeIndex] = sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;

      this._writeIndex++;

      if (this._writeIndex >= CHUNK_SIZE_SAMPLES) {
        // Copia + transfer del ArrayBuffer: el buffer interno se reusea.
        const chunk = this._buffer.slice(0);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this._writeIndex = 0;
      }
    }

    return true; // seguir procesando
  }
}

registerProcessor('pcm-recorder', PCMRecorderProcessor);
