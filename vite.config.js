// --- Vite config ---
// Separa el bundle en un chunk por librería pesada: así se descargan
// en paralelo y se cachean aparte (una actualización propia no invalida three.js).

import { defineConfig } from 'vite';

// Librerías que no deben mezclarse con el bundle de entrada. `@tensorflow`
// es explícito a propósito: mind-ar lo trae por su cuenta y hoy cae en su
// chunk por la ruta del importador, lo cual es accidental y frágil. Con la
// regla propia, un cambio de resolución no lo devuelve al chunk inicial.
const VENDOR_CHUNKS = [
  { test: /node_modules[\\/]three[\\/]/, name: 'three' },
  { test: /node_modules[\\/]mind-ar[\\/]/, name: 'mind-ar' },
  { test: /node_modules[\\/]@tensorflow[\\/]/, name: 'mind-ar' },
  { test: /node_modules[\\/]@mediapipe[\\/]/, name: 'mediapipe' },
  { test: /node_modules[\\/]@google[\\/]genai[\\/]/, name: 'genai' }
];

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Vite 8 solo admite manualChunks como función. mind-ar arrastra
        // TensorFlow.js dentro de su propio árbol de dependencias.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          const match = VENDOR_CHUNKS.find(({ test }) => test.test(id));
          return match?.name;
        }
      }
    }
  }
});
