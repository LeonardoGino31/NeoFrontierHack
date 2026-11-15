// Cuerpo del terreno: paredes laterales con estratos que convierten la lámina del
// relieve en un bloque recortado (como una maqueta o un corte geológico). El bloque es
// parcial: la roca se desvanece hacia abajo en lugar de cerrarse con una base.
// Es solo estético: no interviene en las lecturas, la pendiente ni el rover.

import * as THREE from 'three';

const ROWS = 10;         // subdivisiones verticales de cada pared
const DEPTH_KM = 1.4;    // espesor del bloque bajo el punto más bajo del relieve
const FADE_KM = 0.9;     // tramo inferior en el que la roca se desvanece
const STRATA_KM = 0.6;   // alto de un ciclo de estratos de la textura
const ROCK = new THREE.Color(0x9a9184);

/** Textura de estratos: bandas horizontales de distinto espesor y tono, con grano. */
function strataTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d');
  // Capas fijas (no aleatorias) para que el corte sea siempre el mismo
  const layers = [
    [0.10, '#cfc6b8'], [0.06, '#8d8273'], [0.16, '#b3a896'], [0.04, '#6f6558'],
    [0.12, '#c2b7a5'], [0.08, '#9b8f7e'], [0.18, '#d8d0c2'], [0.05, '#7a6f61'], [0.21, '#aea290'],
  ];
  let y = 0;
  for (const [h, color] of layers) {
    g.fillStyle = color;
    g.fillRect(0, y, c.width, Math.ceil(h * c.height));
    y += h * c.height;
  }
  // Grano: puntos claros y oscuros, para que las paredes no parezcan plástico
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 2, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Crea las paredes del bloque para la grilla del terreno.
 * @param {{ sizeKm: number, segments: number }} o  mismas medidas que la malla del terreno
 * @returns {{ group: THREE.Group, update: (posY: ArrayLike<number>, stride: number, bottom: number) => void, setTint: (ground: THREE.Color) => void, depthKm: number }}
 */
export function createTerrainBlock({ sizeKm, segments }) {
  const W = segments + 1;
  const half = sizeKm / 2;
  const cell = sizeKm / segments;
  const strata = strataTexture();
  const material = new THREE.MeshStandardMaterial({
    map: strata,
    color: ROCK.clone(),
    roughness: 1,
    // Brillo propio tenue con la misma textura: las paredes a la sombra no quedan negras
    emissiveMap: strata,
    emissive: ROCK.clone().multiplyScalar(0.3),
    vertexColors: true, // el canal alfa de los vértices hace el desvanecido
    transparent: true,
  });

  // Cada pared recorre un borde de la grilla: índice del vértice del borde y su posición
  const edges = [
    { normal: [0, 0, -1], at: (k) => [k, 0] },             // norte: fila 0
    { normal: [0, 0, 1], at: (k) => [k, segments] },       // sur: última fila
    { normal: [-1, 0, 0], at: (k) => [0, k] },             // oeste: columna 0
    { normal: [1, 0, 0], at: (k) => [segments, k] },       // este: última columna
  ];

  const group = new THREE.Group();
  const walls = edges.map(({ normal, at }) => {
    const n = W * (ROWS + 1);
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const color = new Float32Array(n * 4).fill(1); // RGB blanco (no tiñe); A = opacidad
    const gridIndex = new Uint32Array(W);
    for (let k = 0; k < W; k++) {
      const [c, r] = at(k);
      gridIndex[k] = r * W + c;
      for (let j = 0; j <= ROWS; j++) {
        const v = j * W + k;
        pos[v * 3] = c * cell - half;
        pos[v * 3 + 2] = r * cell - half;
        nor.set(normal, v * 3);
        uv[v * 2] = (k * cell) / 2; // una repetición de la textura cada 2 km a lo largo
      }
    }
    // Triángulos con la cara frontal hacia afuera. Con el orden (arriba k, abajo k, arriba k+1)
    // la cara mira hacia (−dz, 0, dx), siendo (dx, dz) el sentido en que avanza el borde
    const index = [];
    const [c0, r0] = at(0), [c1, r1] = at(1);
    const dx = c1 - c0, dz = r1 - r0;
    const outwardFirst = -dz * normal[0] + dx * normal[2] > 0;
    for (let j = 0; j < ROWS; j++) {
      for (let k = 0; k < segments; k++) {
        const a = j * W + k, b = a + 1, c = a + W, d = c + 1;
        if (outwardFirst) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 4));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    return { geometry, gridIndex };
  });

  /**
   * Ajusta las paredes a las alturas actuales del borde del terreno.
   * @param {ArrayLike<number>} posY  alturas de la malla (array de posiciones)
   * @param {number} stride  3 si es el array de posiciones (x, y, z)
   * @param {number} bottom  altura donde la roca termina de desvanecerse (km)
   */
  function update(posY, stride, bottom) {
    for (const { geometry, gridIndex } of walls) {
      const pos = geometry.attributes.position.array;
      const uv = geometry.attributes.uv.array;
      const alpha = geometry.attributes.color.array;
      for (let k = 0; k < W; k++) {
        const top = posY[gridIndex[k] * stride + (stride === 3 ? 1 : 0)];
        for (let j = 0; j <= ROWS; j++) {
          const v = j * W + k;
          const y = top + (bottom - top) * (j / ROWS);
          pos[v * 3 + 1] = y;
          // Estratos según la altura absoluta: quedan horizontales en todo el bloque
          uv[v * 2 + 1] = y / STRATA_KM;
          // Desvanecido según la altura absoluta: el borde inferior queda horizontal
          alpha[v * 4 + 3] = THREE.MathUtils.smoothstep(y, bottom, bottom + FADE_KM);
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.uv.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  }

  /** Tiñe la roca con el color medio del suelo del punto, así el corte combina con la imagen. */
  function setTint(ground) {
    material.color.copy(ROCK).lerp(ground, 0.7);
    material.emissive.copy(material.color).multiplyScalar(0.3);
  }

  return { group, update, setTint, depthKm: DEPTH_KM };
}
