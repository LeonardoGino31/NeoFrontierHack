// Parche de terreno de alta resolución alrededor del rover.
// La malla del laboratorio tiene un vértice cada ~83 m: a escala de rover (metros)
// se vería como facetas planas. Este parche de 160 × 160 m (0,5 m entre vértices)
// usa la misma función de altura más un microrrelieve, y se funde con la malla
// gruesa en el borde para que no haya escalón.
//
// Generarlo cuesta ~0,5 s de CPU, así que hay dos parches: uno visible y otro que
// se construye por tramos de pocos ms en cada cuadro; al terminar se intercambian.

import * as THREE from 'three';
import { fbm } from '../../noise.js';

const SIZE = 0.16;        // km (160 m)
const SEGS = 320;         // 0,5 m entre vértices
const CELL = SIZE / SEGS;
const HALF = SIZE / 2;
const W = SEGS + 1;
const EDGE_FLAT = 0.002;  // km pegados al borde que copian la malla gruesa
const EDGE_BLEND = 0.013; // km de transición hacia el relieve detallado
const WORLD_HALF = 10;    // el terreno del laboratorio va de -10 a 10 km
const ROWS_PER_CHECK = 4; // filas entre consultas al reloj (consultarlo en cada vértice cuesta)

/**
 * Interpola una grilla de `PlaneGeometry` (rotada a XZ) con la misma partición en
 * triángulos que usa three.js, para que la altura coincida con lo que se dibuja.
 * @param {(i:number)=>number} get  valor del vértice i (fila * W + columna)
 * @param {number} w      vértices por lado
 * @param {number} cell   separación entre vértices
 * @param {number} x0     x de la columna 0
 * @param {number} z0     z de la fila 0
 */
export function sampleGrid(get, w, cell, x0, z0, x, z) {
  const fx = Math.min(w - 1.000001, Math.max(0, (x - x0) / cell));
  const fz = Math.min(w - 1.000001, Math.max(0, (z - z0) / cell));
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const u = fx - ix, v = fz - iz;
  const a = get(iz * w + ix), b = get((iz + 1) * w + ix);
  const c = get((iz + 1) * w + ix + 1), d = get(iz * w + ix + 1);
  // PlaneGeometry parte cada celda por la diagonal b–d: caras (a, b, d) y (b, c, d)
  if (u + v <= 1) return a + u * (d - a) + v * (b - a);
  return c + (1 - u) * (b - c) + (1 - v) * (d - c);
}

/**
 * Inyecta en el material de la malla gruesa un `discard` dentro del parche, para
 * que las dos superficies casi coincidentes no peleen por la profundidad.
 * @param {THREE.Material} material
 * @param {{value: THREE.Vector4}} uTile  (centro x, centro z, semilado, activo)
 */
export function patchCoarseMaterial(material, uTile) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = uTile;
    shader.vertexShader = 'varying vec3 vTileWorld;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vTileWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    );
    shader.fragmentShader = 'uniform vec4 uTile;\nvarying vec3 vTileWorld;\n' + shader.fragmentShader.replace(
      'void main() {',
      `void main() {
  if (uTile.w > 0.5 && abs(vTileWorld.x - uTile.x) < uTile.z && abs(vTileWorld.z - uTile.y) < uTile.z) discard;`
    );
  };
  material.needsUpdate = true;
}

/**
 * Crea el parche de detalle.
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {(x:number, z:number)=>number} o.detailHeight  altura analítica + microrrelieve (km)
 * @param {(x:number, z:number)=>number} o.coarseHeight  altura de la malla gruesa visible (km)
 * @param {(x:number, z:number, out:THREE.Color)=>THREE.Color} o.coarseColor  color de la malla gruesa
 */
export function createDetailTile({ scene, detailHeight, coarseHeight, coarseColor }) {
  /** Un parche: malla + alturas + grano de color, centrado en (cx, cz). */
  const makeSlot = () => {
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(W * W * 3), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.receiveShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, geometry, heights: new Float32Array(W * W), grain: new Float32Array(W * W), cx: 0, cz: 0, ready: false };
  };
  const slots = [makeSlot(), makeSlot()];
  let front = slots[0]; // el visible y el que usa la física
  let active = false;
  let job = null;       // construcción en curso (generador)
  let paintJob = null;  // repintado en curso del parche visible
  const uTile = { value: new THREE.Vector4(0, 0, HALF - 0.001, 0) };
  const tmp = new THREE.Color();

  /** Centro alineado a la grilla y sin salirse del terreno (evita que el relieve "nade"). */
  const snapCenter = (v) => THREE.MathUtils.clamp(Math.round(v / CELL) * CELL, -(WORLD_HALF - HALF), WORLD_HALF - HALF);

  /** Calcula alturas y grano de un tramo de filas; devuelve la fila siguiente. */
  function buildRows(slot, from, to) {
    const pos = slot.geometry.attributes.position;
    for (let iz = from; iz < to; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        const wx = slot.cx + ix * CELL - HALF;
        const wz = slot.cz + iz * CELL - HALF;
        const edge = Math.min(ix, SEGS - ix, iz, SEGS - iz) * CELL;
        const t = THREE.MathUtils.smoothstep(edge, EDGE_FLAT, EDGE_FLAT + EDGE_BLEND);
        const hc = coarseHeight(wx, wz);
        const h = t > 0 ? hc + (detailHeight(wx, wz) - hc) * t : hc;
        slot.heights[i] = h;
        pos.setY(i, h);
        // Grano de ~1 m: sin él, a escala de rover el suelo parece plástico liso
        slot.grain[i] = 0.84 + 0.3 * fbm(wx * 900 + 5.1, wz * 900 - 2.7, 2);
      }
    }
  }

  /** Copia a un tramo de filas los colores del modo actual de la malla gruesa. */
  function paintRows(slot, from, to) {
    const arr = slot.geometry.attributes.color.array;
    for (let iz = from; iz < to; iz++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iz * W + ix;
        coarseColor(slot.cx + ix * CELL - HALF, slot.cz + iz * CELL - HALF, tmp);
        const g = slot.grain[i];
        arr[i * 3] = tmp.r * g;
        arr[i * 3 + 1] = tmp.g * g;
        arr[i * 3 + 2] = tmp.b * g;
      }
    }
  }

  /** Construye el parche de reserva en (cx, cz) por tramos y lo pone al frente al terminar. */
  function* buildJob(cx, cz) {
    const slot = slots[0] === front && front.ready ? slots[1] : slots[0];
    slot.ready = false;
    slot.cx = cx;
    slot.cz = cz;
    for (let r = 0; r < W; r += ROWS_PER_CHECK) {
      buildRows(slot, r, Math.min(W, r + ROWS_PER_CHECK));
      yield;
    }
    slot.geometry.attributes.position.needsUpdate = true;
    slot.geometry.computeVertexNormals();
    slot.geometry.computeBoundingSphere();
    yield;
    for (let r = 0; r < W; r += ROWS_PER_CHECK * 2) {
      paintRows(slot, r, Math.min(W, r + ROWS_PER_CHECK * 2));
      yield;
    }
    slot.geometry.attributes.color.needsUpdate = true;
    slot.mesh.position.set(cx, 0, cz);
    slot.ready = true;
    const old = front;
    front = slot;
    if (old !== slot) old.mesh.visible = false;
    paintJob = null; // el parche nuevo ya trae los colores vigentes
    show();
  }

  /** Repinta el parche visible por tramos (cambio de modo o de colores). */
  function* paintJobFn(slot) {
    for (let r = 0; r < W; r += ROWS_PER_CHECK * 2) {
      paintRows(slot, r, Math.min(W, r + ROWS_PER_CHECK * 2));
      yield;
    }
    slot.geometry.attributes.color.needsUpdate = true;
  }

  function show() {
    front.mesh.visible = active && front.ready;
    uTile.value.set(front.cx, front.cz, HALF - 0.001, active && front.ready ? 1 : 0);
  }

  /**
   * Pide un parche centrado cerca de x, z. No hace nada si el centro (alineado y
   * acotado al terreno) no cambia: junto al borde el rover siempre queda "lejos"
   * del centro y, sin esto, el parche se regeneraría en cada cuadro.
   */
  function recenter(x, z) {
    const cx = snapCenter(x), cz = snapCenter(z);
    const target = job ? job.target : front.ready ? front : null;
    if (target && Math.abs(target.cx - cx) < 1e-9 && Math.abs(target.cz - cz) < 1e-9) return;
    startBuild(cx, cz);
  }

  function startBuild(cx, cz) {
    const gen = buildJob(cx, cz);
    job = { gen, target: { cx, cz } };
  }

  /** El terreno cambió: reconstruir en el mismo lugar. */
  function rebuild() {
    const t = job ? job.target : front;
    startBuild(t.cx, t.cz);
  }

  /** Pide repintar con los colores actuales de la malla gruesa. */
  function repaint() {
    if (job || !front.ready) return; // la construcción en curso ya pinta al final
    paintJob = paintJobFn(front);
  }

  /**
   * Avanza el trabajo pendiente durante a lo sumo `budgetMs` (llamar cada cuadro).
   * @param {boolean} [all]  terminarlo todo ya (p. ej. si aún no hay parche visible)
   */
  function tick(budgetMs = 6, all = false) {
    const end = performance.now() + budgetMs;
    while (job || paintJob) {
      const current = job ?? paintJob;
      const { done } = (job ? job.gen : paintJob).next();
      if (done) {
        if (current === job) job = null;
        else paintJob = null;
      }
      if (!all && performance.now() > end) break;
    }
  }

  /** Altura (km) del parche visible en x, z, o null si no hay parche o el punto cae fuera. */
  function heightAt(x, z) {
    if (!active || !front.ready) return null;
    const lx = x - front.cx + HALF, lz = z - front.cz + HALF;
    if (lx < 0 || lz < 0 || lx > SIZE || lz > SIZE) return null;
    return sampleGrid((i) => front.heights[i], W, CELL, front.cx - HALF, front.cz - HALF, x, z);
  }

  /**
   * Activa el parche centrado en x, z o lo apaga. Se construye en segundo plano:
   * mientras tanto el rover apoya sobre la malla gruesa (la cámara aún viene volando).
   */
  function setActive(on, x = 0, z = 0) {
    active = on;
    if (on) {
      front.ready = false;
      startBuild(snapCenter(x), snapCenter(z));
    } else {
      job = null;
      paintJob = null;
    }
    show();
  }

  return {
    uTile, recenter, rebuild, repaint, heightAt, setActive, tick,
    /** Distancia (km, norma infinito) del punto al centro del parche visible. */
    offset: (x, z) => Math.max(Math.abs(x - front.cx), Math.abs(z - front.cz)),
    get center() { return { x: front.cx, y: front.cz }; },
    get busy() { return !!job; },
  };
}
