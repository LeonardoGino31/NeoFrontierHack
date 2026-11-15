// Campo de alturas del laboratorio a partir del modelo de elevación real del punto
// (public/data/lab/<clave>.bin, escrito por `python -m pipeline lab-terrain`).
// Lo usan la malla del laboratorio y el parche de detalle del rover, así ambos
// producen exactamente el mismo relieve.

import { fbm } from '../noise.js';
import { SIZE_KM } from './config.js';

/**
 * Crea el campo de alturas. La grilla se cambia con `setGrid` al elegir otro punto.
 * Las alturas son reales (km, relativas a la media del recorte); la exageración vertical
 * se aplica al dibujar, no aquí.
 */
export function createTerrainField() {
  let grid = null; // { w, km: Float32Array } fila 0 = norte (z = −SIZE/2), columna 0 = oeste
  const half = SIZE_KM / 2;

  /** Altura de la grilla con índices recortados al borde. */
  const at = (r, c) => {
    const w = grid.w;
    return grid.km[Math.min(w - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))];
  };

  /** Interpolación Catmull-Rom: entre vértices (rover) el suelo es curvo y no facetado. */
  const cubic = (p0, p1, p2, p3, t) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

  /** Altura real (km) en x, z por interpolación bicúbica de la grilla. */
  function heightKm(x, z) {
    if (!grid) return 0;
    const cell = SIZE_KM / (grid.w - 1);
    const fx = (x + half) / cell, fz = (z + half) / cell;
    const c = Math.floor(fx), r = Math.floor(fz);
    const tx = fx - c, tz = fz - r;
    const row = (rr) => cubic(at(rr, c - 1), at(rr, c), at(rr, c + 1), at(rr, c + 2), tx);
    return cubic(row(r - 1), row(r), row(r + 1), row(r + 2), tz);
  }

  /**
   * Microrrelieve (km) que solo existe en el parche del rover: los modelos de elevación no
   * resuelven nada por debajo de ~30–460 m, y sin esto el suelo a escala de metros sería liso.
   */
  function microKm(x, z) {
    return (fbm(x * 50 + 7.3, z * 50 - 3.1, 3) - 0.5) * 0.002
      + (fbm(x * 300 + 1.7, z * 300 + 2.9, 3) - 0.5) * 0.0006;
  }

  /** Cambia la grilla de alturas (km relativos, `w` × `w`). */
  function setGrid(next) {
    grid = next;
  }

  return { heightKm, microKm, setGrid };
}
