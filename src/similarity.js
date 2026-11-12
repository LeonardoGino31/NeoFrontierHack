// Parámetros de similitud entre una región de la Tierra y su análogo.
// ⚠️ Por ahora los valores son de DEMO (aleatorios). Más adelante vendrán del backend
// (FastAPI + datos reales de NASA/USGS); el cálculo de similitud ya es el definitivo.

// span: diferencia a partir de la cual la similitud de ese parámetro es 0 %
// weight: importancia del parámetro en el índice global
// earth / mars / moon: rango de valores de demo para cada cuerpo
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
  { key: 'humidity',    label: 'Humedad relativa',  unit: '%',  decimals: 0, span: 100,  weight: 0.8, icon: 'drop',
    earth: [1, 60],      mars: [0, 5],        moon: [0, 0] },
];

const randomIn = ([min, max]) => min + Math.random() * (max - min);

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

// Genera un conjunto de parámetros de demo para un par Tierra–análogo
export function generateDemoParams(analogBody) {
  const results = PARAMS.map((param) => {
    const earth = randomIn(param.earth);
    const analog = randomIn(param[analogBody]);
    return { param, earth, analog, similarity: paramSimilarity(earth, analog, param.span) };
  });
  return { results, overall: overallSimilarity(results) };
}
