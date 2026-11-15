// Configuración del laboratorio de terreno: tamaño de la malla, sliders, presets,
// modos de visualización y sus rampas de color.

import * as THREE from 'three';

export const SIZE_KM = 20;     // el terreno mide 20 × 20 km
export const SEGMENTS = 240;   // resolución de la malla (~83 m entre vértices)
export const CELL_KM = SIZE_KM / SEGMENTS;
export const SLOPE_LIMIT = 15; // pendiente máxima típica para aterrizar (°)

// Único ajuste: la forma y los valores salen de los datos de cada punto. La exageración
// solo cambia cómo se dibuja; pendiente, obstáculos y lecturas usan las alturas reales.
export const SLIDERS = [
  { key: 'exag', label: 'Exageración vertical', unit: '×', min: 1, max: 10, step: 0.5, dec: 1 },
];

// Obstáculo: desnivel local 3 × 3 mayor que este límite (misma regla que el pipeline,
// pipeline/config.json → obstacleLocalReliefM para resoluciones ≤ 120 m)
export const OBSTACLE_M = 60;

// Fondo de la escena según el cuerpo (cielo de la Tierra, polvo de Marte, vacío lunar)
export const SKY = { earth: 0x0b1424, mars: 0x1d1310, moon: 0x05070b };

// Valores medidos del punto (columnas del CSV) que se listan en el panel
export const SITE_VALUES = [
  { key: 'relief', label: 'Desnivel', unit: 'm', dec: 0 },
  { key: 'safe_slope', label: 'Pendiente segura', unit: '%', dec: 1 },
  { key: 'crater_free', label: 'Libre de obstáculos', unit: '%', dec: 1 },
  { key: 'sunlight', label: 'Luz solar', unit: '%', dec: 1 },
  { key: 'albedo', label: 'Albedo', unit: '', dec: 3 },
  { key: 'soil_stability', label: 'Estabilidad del suelo', unit: 'pts', dec: 0 },
  { key: 'ice', label: 'Potencial de hielo', unit: 'pts', dec: 0 },
  { key: 'ice_confidence', label: 'Confianza de evidencia', unit: '%', dec: 0 },
];

// Modos de visualización: qué color pinta el terreno y qué explica.
// Las claves coinciden con el campo `lab` de los parámetros (public/data/parameter_model.json).
export const GOOD_BAD = ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'];
export const MODES = {
  natural: {
    label: 'Vista natural', icon: 'eye',
    caption: 'Imagen orbital real del recorte sobre el modelo de elevación real del punto (fuentes abajo). La luz de la escena es fija; las sombras propias de la imagen son las del momento en que se tomó.',
  },
  elevation: {
    label: 'Desnivel', icon: 'mountain', unit: 'm',
    caption: 'Cada color es una altura del modelo de elevación. Lo que se compara es el desnivel (máxima − mínima) dentro del recorte, no la altitud. Las líneas finas son curvas de nivel.',
    stops: ['#2c1e5e', '#3b6fb6', '#3fb8a5', '#b8d86b', '#f3e9b5', '#ffffff'],
  },
  slope: {
    label: 'Pendiente segura', icon: 'slope', unit: '°',
    caption: `Inclinación del terreno. En verde, zonas aptas para aterrizar; desde ~${SLOPE_LIMIT}° (naranja) el riesgo crece. El porcentaje de área bajo ese límite es la "pendiente segura".`,
    stops: ['#3ddc84', '#c6e85a', '#ffc94d', '#ff7a3d', '#d7301f'],
  },
  hazards: {
    label: 'Cráteres y rocas', icon: 'target', unit: '',
    caption: `Desnivel local (vecindad 3 × 3) del modelo de elevación. En rojo, celdas que superan ${OBSTACLE_M} m: bordes de cráter, escarpes o bloques; es la misma regla con la que se mide el "libre de obstáculos".`,
    stops: GOOD_BAD.slice().reverse(),
  },
  soilStability: {
    label: 'Estabilidad del suelo', icon: 'grid', unit: 'pts',
    caption: 'El promedio es el valor del punto; el reparto dentro del recorte es ilustrativo (menos firme en laderas empinadas y terreno abrupto). El polvo y la arena suelta pueden atascar un rover.',
    stops: GOOD_BAD,
  },
  sunlight: {
    label: 'Luz solar', icon: 'sun', unit: '%',
    caption: 'El promedio es el valor del punto; el reparto es ilustrativo y usa el relieve real: las partes altas y las laderas que miran al ecuador reciben más sol, los fondos quedan en sombra.',
    stops: ['#263b75', '#468bd4', '#62cbb9', '#e9df67', '#f4954f'],
  },
  albedo: {
    label: 'Albedo', icon: 'eye', unit: '',
    caption: 'Fracción de luz que refleja el suelo: oscuro = absorbe (basalto, regolito lunar), claro = refleja (salares, hielo). Se reparte según el brillo de la imagen orbital y su promedio es el albedo medido del punto.',
    stops: ['#111111', '#555555', '#aaaaaa', '#f2f2f2'],
  },
  ice: {
    label: 'Potencial de hielo', icon: 'ice', unit: 'pts',
    caption: 'El promedio es el potencial de hielo del punto; el reparto es ilustrativo (más en las zonas con menos sol). No indica depósitos observados; la confianza de evidencia se muestra por separado.',
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
