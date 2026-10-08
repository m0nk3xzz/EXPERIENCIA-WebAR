// ============================================================
// SCENE SETUP — instancia de MindAR, renderer, luces y anclas
// ============================================================

import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { MARKERS_MIND_PATH, KEY_LIGHT_INTENSITY } from './config.js';

// Crea MindARThree y configura renderer + iluminación. No inicia la
// cámara ni crea anclas: lo orquesta main.js para intercalar el resto
// del arranque (precarga, calibración) en el orden correcto.
// Devuelve además `keyLight`: la luz dominante, cuya intensidad anima
// sessionManager al materializar la pieza ("entra en la luz").
export async function createScene(container) {
  const mindarThree = new MindARThree({
    container,
    imageTargetSrc: MARKERS_MIND_PATH,
    uiLoading: 'no',
    uiScanning: 'no', // el escaneo usa retícula propia, no la UI nativa
    uiError: 'yes'
  });

  const { renderer, scene } = mindarThree;
  const camera = mindarThree.camera;

  // MindAR crea la cámara pero no la agrega a la escena: sin este paso,
  // camera.add(modelo) no lo dibuja el renderer.
  scene.add(camera);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // ACES: comprime highlights en vez de clipearlos (look cinematográfico).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const keyLight = await setupLighting(scene, camera, renderer);

  return { mindarThree, camera, scene, renderer, keyLight };
}

// --- Iluminación PBR de estudio ---
// KEY cálida dominante, FILL frío débil, TOP cenital, RIM de contraluz,
// más ambiente hemisférico muy bajo y env map PMREM para los reflejos.
// Todas las luces son hijas de la cámara: la pieza vive siempre frente a
// ella, así el esquema ilumina su "cara buena" rote como rote.
async function setupLighting(scene, camera, renderer) {
  // Environment map solo para iluminación/reflejos (el fondo sigue siendo
  // el video de la cámara). Se renderiza una sola vez a PMREM chica.
  try {
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  } catch (err) {
    console.warn('No se pudo generar el environment map; se continúa solo con luces:', err);
  }

  const ambientLight = new THREE.HemisphereLight(0xf0ece3, 0x1a1816, 0.15);
  scene.add(ambientLight);

  // Las direccionales apuntan al origen de la cámara (donde cuelga la
  // pieza): la position solo define la dirección del haz (x: derecha,
  // y: arriba, z: hacia el espectador).
  const addDirectional = (color, intensity, x, y, z) => {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    camera.add(light);
    camera.add(light.target);
    return light;
  };

  // KEY: lateral-derecha cálida, dominante. Su intensidad base vive en
  // config.js (KEY_LIGHT_INTENSITY) porque la rampa de materialización
  // vuelve exactamente a ese valor.
  const keyLight = addDirectional(0xffe4c4, KEY_LIGHT_INTENSITY, 1.7, 0.9, 0.35);
  // FILL: bajo-izquierda frío, ~1/10 de la key.
  addDirectional(0xe4ebf5, 0.3, -1.2, -0.1, 0.7);
  // TOP: cenital, levemente frontal.
  addDirectional(0xfff6ea, 0.9, 0.1, 1.6, 0.35);
  // RIM: contraluz neutro atrás-arriba; ACES lo comprime en un halo limpio.
  addDirectional(0xffffff, 2.8, -0.4, 0.9, -1.3);

  return keyLight;
}

// Un ancla por entrada del catálogo; el índice debe coincidir con
// entry.markerIndex (ver catalog.js).
export function createAnchors(mindarThree, catalog) {
  return catalog.map((entry) => ({
    entry,
    anchor: mindarThree.addAnchor(entry.markerIndex)
  }));
}
