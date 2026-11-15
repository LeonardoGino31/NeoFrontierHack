// Carga de texturas sin bloquear la interfaz.
// TextureLoader decodifica cada JPG en el hilo principal en el momento de subirlo a la
// GPU (con imágenes de 4096 px eran segundos de pantalla congelada). ImageBitmapLoader
// decodifica en segundo plano y la subida se reparte de a una textura por cuadro.

import * as THREE from 'three';

// Las imágenes de color se convierten al espacio de color del navegador; los mapas
// de datos (normales, rugosidad, máscaras) deben llegar con sus valores intactos.
const colorLoader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY' });
const dataLoader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', colorSpaceConversion: 'none' });

/**
 * Descarga y decodifica una imagen como textura.
 * @param {string} url
 * @param {{ color?: boolean }} [opts]  color: false para mapas de datos (normales, rugosidad, máscaras)
 * @returns {Promise<THREE.Texture>}
 */
export function loadTexture(url, { color = true } = {}) {
  return new Promise((resolve, reject) => {
    (color ? colorLoader : dataLoader).load(url, (bitmap) => {
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false; // createImageBitmap ya la entregó invertida
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    }, undefined, () => reject(new Error(`No se pudo cargar ${url}`)));
  });
}

/** Prueba las URLs en orden y devuelve la primera textura que cargue. */
export async function loadFirst(urls, opts) {
  let lastError;
  for (const url of urls) {
    try {
      return await loadTexture(url, opts);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Sube las texturas a la GPU de a una por cuadro, para que la pantalla de carga
 * siga respondiendo en lugar de congelarse con todas juntas.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Texture[]} textures
 */
export async function uploadGradually(renderer, textures) {
  for (const texture of textures) {
    renderer.initTexture(texture);
    await nextFrame();
  }
}
