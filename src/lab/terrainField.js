// Campo de alturas procedural del laboratorio (km, relativo a la elevación base).
// Lo usan la malla del laboratorio y el parche de detalle del rover, así ambos
// producen exactamente el mismo relieve.

import { fbm } from '../noise.js';

// Cráteres fijos: [x, z, radio] en km
const CRATERS = [
  [3.6, -2.4, 2.2], [-4.8, 3.2, 1.4], [-1.2, -5.6, 0.9], [5.6, 5.2, 1.1],
  [-6.4, -4.0, 0.8], [1.5, 6.5, 0.6], [-7.0, 6.8, 1.6], [7.2, -6.8, 0.7], [0.4, 1.2, 0.5],
];

/**
 * Crea el campo de alturas para el estado de sliders `state` (se lee en cada consulta,
 * así los cambios de los sliders se ven sin recrearlo).
 * @param {{ relief: number, rough: number, craters: number }} state
 */
export function createTerrainField(state) {
  /**
   * Altura en x, z y sus componentes: `detail` (relieve fino, para la rugosidad) y
   * `crater` (> 0 dentro de un cráter o su borde, para los obstáculos).
   * @param {{h: number, detail: number, crater: number}} out  se reutiliza para no crear objetos
   */
  function sample(x, z, out) {
    // Forma general (colinas, valles)
    const macro = (fbm(x * 0.22 + 11.3, z * 0.22 - 4.7, 4) - 0.35) * state.relief * 1.6;
    // Detalle fino: aquí actúa la rugosidad
    const detail = (fbm(x * 1.7 + 3.1, z * 1.7 + 8.2, 5) - 0.5) * state.rough * 0.45;
    // Cráteres: cuenco + borde elevado
    let crater = 0;
    let inCrater = 0;
    if (state.craters > 0) {
      for (const [cx, cz, r] of CRATERS) {
        const d = Math.hypot(x - cx, z - cz) / r;
        // Interior y borde del cráter cuentan como obstáculo (más claro cuanto más marcado)
        if (d < 1.15) inCrater = Math.max(inCrater, state.craters);
        if (d < 1.6) {
          if (d < 1) crater -= (1 - d * d) * 0.25 * r;
          crater += 0.12 * r * Math.exp(-(((d - 1) / 0.18) ** 2));
        }
      }
      crater *= state.craters;
    }
    out.h = macro + detail + crater;
    out.detail = detail;
    out.crater = inCrater;
    return out;
  }

  /** Microrrelieve (km) que solo existe en el parche de detalle: lomas de ~20 m y baches de ~3 m. */
  function microKm(x, z) {
    return ((fbm(x * 50 + 7.3, z * 50 - 3.1, 3) - 0.5) * 0.0024
      + (fbm(x * 300 + 1.7, z * 300 + 2.9, 3) - 0.5) * 0.0007) * (0.35 + state.rough);
  }

  return { sample, microKm };
}
