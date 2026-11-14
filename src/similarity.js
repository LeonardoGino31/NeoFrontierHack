// Parámetros de similitud entre una región de la Tierra y su análogo.
// Los valores de cada pareja se cargan desde public/data/planetary_candidates.csv.
// La tabla actual es fija y de demostración; más adelante se reemplazará por datos de misión.
// (FastAPI + datos reales de NASA/USGS); el cálculo de similitud ya es el definitivo.

// span: diferencia a partir de la cual la similitud de ese parámetro es 0 %
// weight: importancia del parámetro en el índice global
// earth / mars / moon: rangos de demo usados por el simulador de la guía
export const PARAMS = [
  { key: 'elevation',   label: 'Elevación',         unit: 'm',  decimals: 0, span: 4000, weight: 1,   icon: 'mountain',
    earth: [0, 4500],    mars: [-4000, 6000], moon: [-3000, 5000] },
  { key: 'slope',       label: 'Pendiente',         unit: '°',  decimals: 1, span: 20,   weight: 1.5, icon: 'slope',
    earth: [0, 30],      mars: [0, 30],       moon: [0, 30] },
  { key: 'temperature', label: 'Temperatura media', unit: '°C', decimals: 0, span: 150,  weight: 1,   icon: 'thermo',
    earth: [-40, 40],    mars: [-110, -20],   moon: [-150, 100] },
  { key: 'roughness',   label: 'Rugosidad',         unit: '',   decimals: 2, span: 1,    weight: 1.5, icon: 'grid',
    earth: [0, 1],       mars: [0, 1],        moon: [0, 1] },
  { key: 'albedo',      label: 'Albedo',            unit: '',   decimals: 2, span: 0.4,  weight: 1,   icon: 'sun',
    earth: [0.1, 0.45],  mars: [0.1, 0.35],   moon: [0.07, 0.2] },
  { key: 'iron',        label: 'Óxidos de hierro',  unit: '%',  decimals: 1, span: 20,   weight: 1,   icon: 'rock',
    earth: [0, 15],      mars: [10, 20],      moon: [3, 14] },
  { key: 'ice',         label: 'Potencial de hielo', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'ice',
    earth: [0, 100],     mars: [0, 100],      moon: [0, 100],
    // Confianza de la estimación, informativa y separada del valor comparado.
    confidence: { earth: [20, 85], mars: [20, 75], moon: [20, 75] } },
  { key: 'landingArea', label: 'Área libre de obstáculos', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'target',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'soilStability', label: 'Estabilidad del suelo', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'grid',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'edlConditions', label: 'Condiciones de descenso', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'thermo', bodies: ['mars'],
    earth: [0, 100], mars: [0, 100] },
  { key: 'traverseAccess', label: 'Acceso a objetivos científicos', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'mountain',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
  { key: 'solarEnergy', label: 'Disponibilidad de energía solar', unit: 'pts', decimals: 0, span: 100, weight: 1, icon: 'sun',
    earth: [0, 100], mars: [0, 100], moon: [0, 100] },
];

// Similitud de un parámetro: 1 si son iguales, baja linealmente hasta 0 al llegar a "span"
export function paramSimilarity(earthValue, analogValue, span) {
  return Math.max(0, 1 - Math.abs(earthValue - analogValue) / span);
}

// Índice global: promedio ponderado de las similitudes
export function overallSimilarity(results) {
  const totalWeight = results.reduce((sum, r) => sum + r.param.weight, 0);
  const weighted = results.reduce((sum, r) => sum + r.similarity * r.param.weight, 0);
  return weighted / totalWeight;
}

