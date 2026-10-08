// ============================================================
// MODEL CACHE — carga, caché LRU e instanciación de modelos GLB
// ============================================================
// Las plantillas nunca se agregan a la escena: solo se clonan. La caché
// LRU pone techo a la memoria en sesiones largas con catálogo grande.

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_CACHE_MAX_SIZE } from './config.js';

class ModelTemplateCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map(); // orden de inserción = recencia de uso
  }

  get(modelPath) {
    if (!this.map.has(modelPath)) return undefined;
    const template = this.map.get(modelPath);
    this.map.delete(modelPath);
    this.map.set(modelPath, template); // reinsertar = "recién usada"
    return template;
  }

  set(modelPath, template) {
    if (this.map.has(modelPath)) this.map.delete(modelPath);
    this.map.set(modelPath, template);

    if (this.map.size > this.maxSize) this.evictOldest();
  }

  // Descarta la plantilla menos usada recientemente. Si no queda ninguna
  // descartable (todas protegidas por un caller), informa el exceso en vez
  // de devolver silenciosamente una caché fuera de su cota: el aviso es lo
  // que hace visible que el tamaño declarado ya no alcanza.
  evictOldest() {
    const [oldestKey] = this.map.keys();
    if (oldestKey === undefined) return;

    const template = this.map.get(oldestKey);
    this.map.delete(oldestKey);
    disposeModelTemplate(template);
    console.log(`Plantilla descartada de la caché LRU (límite ${this.maxSize}): ${oldestKey}`);
  }
}

function disposeModelTemplate(template) {
  template.traverse((node) => {
    if (!node.isMesh) return;

    node.geometry?.dispose();

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => value?.isTexture && value.dispose());
      material.dispose();
    });
  });
}

const cache = new ModelTemplateCache(MODEL_CACHE_MAX_SIZE);

// Detecta los errores típicos al mantener el catálogo, antes de que se
// manifiesten como un fallo opaco de MindAR al crear las anclas:
//   - id ausente o duplicado (rompe la búsqueda del contexto de la IA)
//   - markerIndex inválido, duplicado o fuera del rango declarado
//   - modelPath ausente
// Un markerIndex fuera del .mind compilado no se puede detectar acá (el
// .mind es binario), pero el rango declarado en el catálogo sí: si el
// índice mayor supera lo esperado, se avisa en el arranque.
export function validateMarkerCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    console.error('catalog.js: el catálogo está vacío o no es un array.');
    return;
  }

  const seenIndices = new Map();
  const seenIds = new Map();

  catalog.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      console.error('catalog.js: entrada inválida (no es un objeto).');
      return;
    }

    if (typeof entry.id !== 'string' || !entry.id) {
      console.error('catalog.js: entrada sin "id" (obligatorio y no vacío).');
    } else if (seenIds.has(entry.id)) {
      console.error(`catalog.js: id duplicado ("${entry.id}"): cada entrada necesita un id único.`);
    } else {
      seenIds.set(entry.id, true);
    }

    if (typeof entry.modelPath !== 'string' || !entry.modelPath) {
      console.error(`catalog.js: "${entry.id}" no tiene "modelPath".`);
    }

    if (typeof entry.markerIndex !== 'number' || entry.markerIndex < 0) {
      console.error(`catalog.js: "${entry.id}" tiene un markerIndex inválido (${entry.markerIndex}).`);
      return;
    }

    const firstEntryId = seenIndices.get(entry.markerIndex);
    if (firstEntryId) {
      console.error(
        `catalog.js: markerIndex duplicado (${entry.markerIndex}) — "${firstEntryId}" y "${entry.id}" ` +
        'apuntan al mismo marcador. Cada entrada necesita un markerIndex único.'
      );
      return;
    }

    seenIndices.set(entry.markerIndex, entry.id);
  });

  // Los índices deben ser contiguos desde 0: MindAR crea un ancla por
  // índice y el .mind compilado los numera por orden de subida. Un hueco
  // significa que el catálogo y el .mind ya no se corresponden.
  const maxIndex = Math.max(...seenIndices.keys());
  for (let i = 0; i <= maxIndex; i++) {
    if (!seenIndices.has(i)) {
      console.warn(
        `catalog.js: hueco en los markerIndex (falta ${i}, hay ${maxIndex} como máximo). ` +
        'Recompilá marcadores.mind con TODAS las imágenes, en orden, y revisá el catálogo.'
      );
    }
  }
}

// Cargas en vuelo por ruta: dos llamadas concurrentes al mismo modelPath
// comparten la misma promesa en vez de descargar el GLB dos veces.
const inflightLoads = new Map(); // modelPath -> Promise<template>

// Descarga (o devuelve de caché) la plantilla del GLB de una entrada del
// catálogo. GLTFLoader se importa dinámicamente para no ir en el bundle inicial.
export function loadModelTemplate(entry) {
  const cached = cache.get(entry.modelPath);
  if (cached) return Promise.resolve(cached);

  const inflight = inflightLoads.get(entry.modelPath);
  if (inflight) return inflight;

  const loadPromise = doLoadModelTemplate(entry).finally(() => {
    inflightLoads.delete(entry.modelPath);
  });
  inflightLoads.set(entry.modelPath, loadPromise);
  return loadPromise;
}

async function doLoadModelTemplate(entry) {
  console.log(`Cargando modelo "${entry.name}" (${entry.modelPath})...`);

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(entry.modelPath);

  // Se baja la contribución del environment map para que los albedos
  // claros no se sobreexpongan junto con la key light (look lavado).
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material && 'envMapIntensity' in material) material.envMapIntensity = 0.4;
    });
  });

  // Bounding box de la plantilla: la sombra de contacto la usa para
  // dimensionarse y apoyarse en la base, sin importar escala/origen del GLB.
  const bbox = new THREE.Box3().setFromObject(gltf.scene);
  gltf.scene.userData.bbox = bbox;

  cache.set(entry.modelPath, gltf.scene);

  return gltf.scene;
}

// SkeletonUtils.clone (no Object3D.clone) para soportar modelos con
// esqueleto/animaciones. Geometría y materiales quedan compartidos con
// la plantilla — nunca hacer dispose() sobre una instancia.
export function instantiateModel(entry, template) {
  const instance = cloneSkeleton(template);

  instance.position.set(0, 0, 0.1);
  instance.rotation.set(0, 0, 0);
  instance.scale.setScalar(entry.initialScale ?? 0.1);
  instance.visible = true;

  const shadow = createContactShadow(template.userData.bbox);
  if (shadow) {
    instance.add(shadow);
    instance.userData.contactShadow = shadow;
  }

  return instance;
}

// --- Sincronización por frame de la sombra de contacto ---
// La sombra es hija del modelo (hereda escala y posición) pero NO su
// rotación: una sombra de piso queda horizontal, debajo de la pieza.
// Solo se ajusta tras el desacople (freeFloat); anclada al marcador,
// queda en su pose de creación.

const shadowDown = new THREE.Vector3(0, -1.5, 0);
const shadowOffset = new THREE.Vector3();
const shadowInvQuat = new THREE.Quaternion();

export function updateContactShadow(instance) {
  const shadow = instance?.userData?.contactShadow;
  if (!shadow || !shadow.userData.freeFloat) return;

  const scale = instance.scale.x || 1;

  // "Debajo de la pieza" en espacio del padre (cámara), convertido al
  // espacio local de la sombra (desrotando y desescalando).
  shadowInvQuat.copy(instance.quaternion).invert();
  shadowOffset.copy(shadowDown).multiplyScalar(scale * shadow.userData.dropDistance);
  shadowOffset.applyQuaternion(shadowInvQuat).divideScalar(scale);
  shadow.position.copy(shadowOffset);

  // Se anula la rotación del modelo y se reaplica la pose horizontal.
  shadow.quaternion.copy(shadowInvQuat).multiply(shadow.userData.baseQuat);
}

// Fija si la sombra flota con la pieza (post-desacople) o queda apoyada
// en el plano del marcador (pre-desacople).
export function setContactShadowFreeFloat(instance, free) {
  const shadow = instance?.userData?.contactShadow;
  if (shadow) shadow.userData.freeFloat = free;
}

// --- Sombra de contacto falsa ---
// Plano con gradiente radial dibujado en canvas: ancla visual de la pieza
// al "suelo" sin el costo de un shadow map real en móvil. Como el
// gradiente es radial, las rotaciones no la delatan.
let contactShadowTexture = null;

function getContactShadowTexture() {
  if (contactShadowTexture) return contactShadowTexture;

  const size = 250;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.50)');
  gradient.addColorStop(0.50, 'rgba(0, 0, 0, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  contactShadowTexture = new THREE.CanvasTexture(canvas);
  return contactShadowTexture;
}

function createContactShadow(bbox) {
  if (!bbox || bbox.isEmpty()) return null;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  const radius = Math.max(size.x, size.z) * 0.75;
  if (radius <= 0) return null;

  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2);
  const material = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    // Sin escribir profundidad y dibujada al final: no pelea con el
    // marcador/piso en z-fighting.
    polygonOffset: true,
    polygonOffsetFactor: -1
  });

  const mesh = new THREE.Mesh(geometry, material);
  // 10° de tilt hacia la cámara: con el disco perfectamente horizontal se
  // vuelve una línea invisible al ver la pieza desde abajo o de perfil.
  mesh.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(10);
  // Apoyada en la base del bbox, con caída extra para que la pieza no la
  // atraviese al girar o escalar.
  const lift = Math.max(size.x, size.y, size.z) * 0.005;
  const extraDrop = size.y * 0.05;
  mesh.position.set(center.x, bbox.min.y + lift - extraDrop, center.z);
  mesh.renderOrder = 1;

  // Datos para updateContactShadow(): pose de creación y distancia
  // origen→sombra (para quedar "debajo" al flotar en espacio de cámara).
  mesh.userData.baseQuat = mesh.quaternion.clone();
  mesh.userData.dropDistance = center.y - bbox.min.y - lift + extraDrop;
  mesh.userData.freeFloat = false;

  return mesh;
}
