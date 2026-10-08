// --- Catálogo de marcadores → objetos 3D ---
// Fuente única de verdad para escalar el proyecto. Para agregar una pieza:
//   1. Recompilar TODAS las imágenes de marcador juntas (viejas + nueva) en
//      un solo .mind con el compilador de MindAR
//      (https://hiukim.github.io/mind-ar-js-doc/tools/compile/): no se puede
//      agregar un target a un .mind ya compilado sin rehacerlo completo, y el
//      índice de cada imagen depende del ORDEN de subida.
//   2. Reemplazar /public/marcadores.mind y agregar acá la entrada con ese
//      markerIndex y su modelPath.

export const MARKER_CATALOG = [
  {
    // Identificador interno único: logs y vínculo con el contexto de la IA.
    id: 'objeto-1',

    // Índice del target dentro de marcadores.mind (orden de subida al compilador).
    markerIndex: 0,

    // Nombre visible / contexto para la IA conversacional.
    name: 'Nombre del objeto 1',

    // Descripción breve: se inyecta como contexto del sistema para que la IA
    // responda preguntas sobre este objeto.
    description:
      'Descripción breve del objeto 1: qué es, datos relevantes que la IA debería saber para responder preguntas del usuario.',

    // Ruta al modelo GLB.
    modelPath: '/models/modelo.glb',

    // Escala del modelo mientras está anclado al marcador (antes del desacople).
    initialScale: 0.1,

    // Overrides opcionales del centrado frente a cámara para ESTE objeto
    // (null = usar CENTER_POSITION / CENTER_ROTATION de config.js).
    centerPosition: null,
    centerRotation: null,

    // true → se descarga al arrancar la app (2-3 objetos "estrella").
    // false (recomendado al crecer) → se carga la primera vez que se detecta
    // ESE marcador, sin alargar el arranque.
    preload: true,

    // --- Datos de la ficha de la obra ---
    // Contenido a definir por el curador: alimenta la ficha y (vía
    // description) a la IA. No inventar datos en producción.
    inventoryNumber: 'INV-0001',
    culture: '—',
    period: '—',
    material: '—',
    origin: '—',
    suggestedQuestions: ['¿De qué época es?', '¿Cómo se usaba?', '¿De qué material es?'],

    // Traducciones por pieza (fallback por campo: español). `description`
    // también alimenta a la guía de IA en ese idioma (api/token.js la usa
    // como fuente de verdad), así que debe ir curada en cada idioma.
    translations: {
      en: {
        name: 'Object 1 name',
        description:
          'Brief description of object 1: what it is, and the relevant facts the AI guide should know to answer the visitor\'s questions.',
        suggestedQuestions: ['What period is it from?', 'How was it used?', 'What is it made of?']
      }
    }
  },

  {
    id: 'objeto-2',
    markerIndex: 1,
    name: 'Nombre del objeto 2',
    description: 'Descripción breve del objeto 2.',
    modelPath: '/models/modelo1.glb',
    initialScale: 0.1,
    centerPosition: null,
    centerRotation: null,
    preload: false,
    inventoryNumber: 'INV-0002',
    culture: '—',
    period: '—',
    material: '—',
    origin: '—',
    suggestedQuestions: ['¿De dónde proviene?', '¿Qué significan sus marcas?'],
    translations: {
      en: {
        name: 'Object 2 name',
        description: 'Brief description of object 2.',
        suggestedQuestions: ['Where does it come from?', 'What do its markings mean?']
      }
    }
  }

  // Agregar más entradas acá a medida que el catálogo crece...
];
