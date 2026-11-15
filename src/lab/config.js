// Configuración del laboratorio de terreno: tamaño de la malla, sliders, presets,
// modos de visualización y sus rampas de color.

import * as THREE from 'three';

export const SIZE_KM = 20;     // el terreno mide 20 × 20 km
export const SEGMENTS = 240;   // resolución de la malla (~83 m entre vértices)
export const CELL_KM = SIZE_KM / SEGMENTS;
export const SLOPE_LIMIT = 15; // pendiente máxima típica para aterrizar (°)

export const SLIDERS = [
  { key: 'base',    label: 'Elevación base',        unit: 'm',    min: -4000, max: 5000, step: 50,   dec: 0 },
  { key: 'relief',  label: 'Relieve',               unit: 'km',   min: 0,     max: 2.5,  step: 0.05, dec: 2 },
  { key: 'rough',   label: 'Rugosidad (rocas)',     unit: '',     min: 0,     max: 1,    step: 0.01, dec: 2 },
  { key: 'craters', label: 'Cráteres',              unit: '',     min: 0,     max: 1,    step: 0.01, dec: 2 },
  { key: 'sunlight', label: 'Tiempo con luz solar', unit: '%',    min: 0,     max: 100,  step: 1,    dec: 0 },
  { key: 'albedo',  label: 'Albedo',                unit: '',     min: 0.05,  max: 0.6,  step: 0.01, dec: 2 },
  { key: 'soilStability', label: 'Estabilidad del suelo', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'ice',     label: 'Potencial de hielo',    unit: 'pts',  min: 0,     max: 100,  step: 1,    dec: 0 },
  { key: 'iceConfidence', label: 'Confianza de evidencia', unit: '%', min: 0, max: 100, step: 1, dec: 0 },
];

// Valores ILUSTRATIVOS para comparar entornos (no son mediciones exactas).
// `rust` solo tiñe la vista natural (polvo oxidado de Marte); no es un parámetro.
export const PRESETS = {
  atacama: { name: 'Atacama · Tierra',      body: 'earth', base: 2500, relief: 0.9, rough: 0.35, craters: 0, sunlight: 80, albedo: 0.30, soilStability: 50, ice: 5, iceConfidence: 25, rust: 0.3 },
  dryval:  { name: 'Valles Secos · Tierra', body: 'earth', base: 800, relief: 1.4, rough: 0.40, craters: 0, sunlight: 55, albedo: 0.35, soilStability: 55, ice: 30, iceConfidence: 45, rust: 0.15 },
  iceland: { name: 'Islandia · Tierra',     body: 'earth', base: 400, relief: 0.6, rough: 0.85, craters: 0, sunlight: 45, albedo: 0.10, soilStability: 60, ice: 25, iceConfidence: 40, rust: 0.4 },
  mars:    { name: 'Llanura · Marte',       body: 'mars', base: -2500, relief: 0.5, rough: 0.30, craters: 0.6, sunlight: 50, albedo: 0.22, soilStability: 55, ice: 20, iceConfidence: 35, rust: 0.75 },
  moon:    { name: 'Polo sur · Luna',       body: 'moon', base: 1500, relief: 1.6, rough: 0.50, craters: 1, sunlight: 70, albedo: 0.10, soilStability: 55, ice: 55, iceConfidence: 40, rust: 0 },
};

// Modos de visualización: qué color pinta el terreno y qué explica.
// Las claves coinciden con el campo `lab` de los parámetros (public/data/parameter_model.json).
export const GOOD_BAD = ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'];
export const MODES = {
  natural: {
    label: 'Vista natural', icon: 'eye',
    caption: 'Vista ilustrativa: el albedo aclara u oscurece el suelo y el hielo potencial se resalta en las zonas con menos sol. No es un mapa de depósitos reales.',
  },
  elevation: {
    label: 'Desnivel', icon: 'mountain', unit: 'm',
    caption: 'Cada color es una altura. Lo que se compara es el desnivel (máxima − mínima) dentro del recorte, no la altitud. Las líneas finas son curvas de nivel cada 250 m.',
    stops: ['#2c1e5e', '#3b6fb6', '#3fb8a5', '#b8d86b', '#f3e9b5', '#ffffff'],
  },
  slope: {
    label: 'Pendiente segura', icon: 'slope', unit: '°',
    caption: `Inclinación del terreno. En verde, zonas aptas para aterrizar; desde ~${SLOPE_LIMIT}° (naranja) el riesgo crece. El porcentaje de área bajo ese límite es la "pendiente segura".`,
    stops: ['#3ddc84', '#c6e85a', '#ffc94d', '#ff7a3d', '#d7301f'],
  },
  hazards: {
    label: 'Cráteres y rocas', icon: 'target', unit: '',
    caption: 'En rojo, celdas con obstáculos: dentro de un cráter o con rocas (rugosidad alta). Sube los sliders de cráteres o rugosidad y mira cómo se reduce el área libre.',
    stops: GOOD_BAD.slice().reverse(),
  },
  soilStability: {
    label: 'Estabilidad del suelo', icon: 'grid', unit: 'pts',
    caption: 'Índice de demostración de firmeza del suelo; el polvo y la arena suelta pueden atascar un rover o hundir un aterrizador.',
    stops: GOOD_BAD,
  },
  sunlight: {
    label: 'Luz solar', icon: 'sun', unit: '%',
    caption: 'Ilustrativo: las partes altas reciben sol más tiempo y el fondo de los cráteres queda en sombra, como en los polos lunares.',
    stops: ['#263b75', '#468bd4', '#62cbb9', '#e9df67', '#f4954f'],
  },
  albedo: {
    label: 'Albedo', icon: 'eye', unit: '',
    caption: 'Fracción de luz que refleja el suelo: oscuro = absorbe (basalto, regolito lunar), claro = refleja (salares, hielo).',
    stops: ['#111111', '#555555', '#aaaaaa', '#f2f2f2'],
  },
  ice: {
    label: 'Potencial de hielo', icon: 'ice', unit: 'pts',
    caption: 'Mapa procedural de demostración del potencial relativo de hielo, mayor en las zonas con menos sol. No indica depósitos observados; la confianza de evidencia se muestra por separado.',
    stops: ['#19223d', '#315e91', '#62b9dc', '#d7f7ff', '#ffffff'],
  },
};

// Rango de la leyenda de cada modo
export const LEGEND_RANGE = {
  elevation: (d) => [d.minElev, d.maxElev],
  slope: () => [0, 40],
  hazards: () => [0, 1],
  soilStability: () => [0, 100],
  sunlight: () => [0, 100],
  albedo: () => [0, 0.6],
  ice: () => [0, 100],
};

// ---------- Utilidades de color ----------
/** Interpolador de una rampa de colores: t en [0, 1] → color. */
function makeRamp(hexStops) {
  const cols = hexStops.map((h) => new THREE.Color(h));
  return (t, out) => {
    t = Math.min(1, Math.max(0, t)) * (cols.length - 1);
    const i = Math.min(Math.floor(t), cols.length - 2);
    return out.copy(cols[i]).lerp(cols[i + 1], t - i);
  };
}
export const RAMPS = Object.fromEntries(
  Object.entries(MODES).filter(([, m]) => m.stops).map(([k, m]) => [k, makeRamp(m.stops)])
);
