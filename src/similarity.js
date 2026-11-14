// Parámetros de similitud entre una región de la Tierra y su análogo.
// Los valores de cada pareja se cargan desde public/data/planetary_candidates.csv.
// Por ahora son fijos y de demostración; el cálculo ya es el definitivo.
//
// Modelo: 3 grupos que se comparan Tierra–análogo (iluminación, topografía y hielo) y
// requisitos de misión que solo se evalúan en el sitio de Marte o la Luna. Cada cuerpo
// tiene un objetivo distinto, así que pondera los grupos de forma distinta.

// Grupos comparados. `icon` es el del HUD.
export const GROUPS = [
  { key: 'illumination', label: 'Iluminación', icon: 'sun' },
  { key: 'topography',   label: 'Topografía',  icon: 'mountain' },
  { key: 'ice',          label: 'Potencial de hielo', icon: 'ice' },
];

// Subparámetros de cada grupo.
// span: diferencia a partir de la cual la similitud de ese subparámetro es 0 %.
// earth / mars / moon: rangos plausibles, usados por el simulador de la guía.
// lab: modo del laboratorio 3D que lo ilustra (null si no tiene).
export const PARAMS = [
  { key: 'sunlight', group: 'illumination', label: 'Tiempo con luz solar', unit: '%', decimals: 0, span: 50, icon: 'sun', lab: 'sunlight',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'albedo', group: 'illumination', label: 'Albedo', unit: '', decimals: 2, span: 0.3, icon: 'eye', lab: 'albedo',
    earth: [0.05, 0.6], mars: [0.1, 0.35], moon: [0.07, 0.2] },
  { key: 'relief', group: 'topography', label: 'Desnivel', unit: 'm', decimals: 0, span: 2000, icon: 'mountain', lab: 'elevation',
    earth: [0, 3000], mars: [0, 3000], moon: [0, 3000] },
  { key: 'safeSlope', group: 'topography', label: 'Pendiente segura', unit: '%', decimals: 0, span: 50, icon: 'slope', lab: 'slope',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'craterFree', group: 'topography', label: 'Libre de cráteres y rocas', unit: '%', decimals: 0, span: 50, icon: 'target', lab: 'hazards',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'soilStability', group: 'topography', label: 'Estabilidad del suelo', unit: 'pts', decimals: 0, span: 50, icon: 'grid', lab: 'soilStability',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'ice', group: 'ice', label: 'Potencial de hielo', unit: 'pts', decimals: 0, span: 100, icon: 'ice', lab: 'ice',
    earth: [0, 100], mars: [0, 100], moon: [0, 100],
    // Confianza de la estimación: se muestra aparte y no entra al índice
    confidence: true },
];

// Requisitos de misión (`short` es la etiqueta del HUD): solo se miden en el sitio de Marte o la Luna, porque la Tierra no puede
// reproducirlos (no hay atmósfera marciana ni horizonte lunar en la Tierra). Un sitio que no los
// cumple se marca como no apto, sin importar cuánto se parezca su análogo terrestre.
export const REQUIREMENTS = {
  moon: {
    key: 'earthView', column: 'earth_view_analog', label: 'Comunicación con la Tierra', short: 'Tierra visible',
    unit: '%', decimals: 0, min: 50, icon: 'signal',
    note: 'Tierra sobre el horizonte; por debajo del mínimo hace falta un satélite relé.',
  },
  mars: {
    key: 'descent', column: 'descent_density_analog', label: 'Densidad del aire para el descenso', short: 'Descenso',
    unit: 'kg/m³', decimals: 4, min: 0.018, icon: 'parachute',
    note: 'Con menos aire, el paracaídas frena menos; equivale a aterrizar por debajo de ~+1 km.',
  },
};

// Objetivo de cada cuerpo y peso de cada grupo en su índice global
export const BODY_PROFILES = {
  moon: {
    purpose: 'Estación base',
    weights: { illumination: 1.5, topography: 1, ice: 1.5 },
    why: 'Una base permanente necesita energía solar casi continua y agua (hielo) cerca; el terreno debe permitir construir.',
  },
  mars: {
    purpose: 'Aterrizaje y recorridos',
    weights: { illumination: 0.5, topography: 2, ice: 1 },
    why: 'Aterrizar y moverse con un rover dependen sobre todo del terreno; el hielo es un objetivo científico y un recurso.',
  },
};

/** Similitud de un subparámetro: 1 si son iguales, baja linealmente hasta 0 al llegar a `span`. */
export function paramSimilarity(earthValue, analogValue, span) {
  return Math.max(0, 1 - Math.abs(earthValue - analogValue) / span);
}

/** Agrupa los resultados de los subparámetros: cada grupo es el promedio simple de los suyos. */
export function groupResults(results, body) {
  const weights = BODY_PROFILES[body].weights;
  return GROUPS.map((group) => {
    const items = results.filter((r) => r.param.group === group.key);
    const similarity = items.reduce((sum, r) => sum + r.similarity, 0) / items.length;
    return { group, weight: weights[group.key], items, similarity };
  });
}

/** Índice global: promedio de los grupos ponderado por el perfil del cuerpo. */
export function overallSimilarity(groups) {
  const totalWeight = groups.reduce((sum, g) => sum + g.weight, 0);
  return groups.reduce((sum, g) => sum + g.similarity * g.weight, 0) / totalWeight;
}

/** Evalúa el requisito de misión del cuerpo con el valor del sitio. */
export function checkRequirement(body, value) {
  const req = REQUIREMENTS[body];
  return { req, value, pass: value >= req.min };
}
