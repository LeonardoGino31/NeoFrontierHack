// Puntos de la Tierra, cada uno emparejado con un sitio objetivo de Marte o la Luna (trekSites.js).
// Sus imágenes salen de NASA GIBS (scripts/fetch-trek.sh) con el MISMO ancho en km que el sitio
// análogo, para comparar a escala. Las coordenadas deben coincidir con las del script.
//
// `limits` responde a lo que pide el reto: dónde se rompe la analogía.

const SITES_DIR = '/trek/sites';

export const EARTH_LAYERS = {
  visible: 'Blue Marble NG (NASA GIBS)',
  relief: 'ASTER GDEM (NASA GIBS)',
};

export const EARTH_SITES = [
  {
    id: 'salda', analogId: 'jezero', name: 'Lago Salda', region: 'Turquía', lat: 37.55, lon: 29.68,
    kind: 'Lago con carbonatos',
    why: 'Sus orillas tienen hidromagnesita y microbialitas, parecidas a los carbonatos del borde de Jezero. La NASA lo estudió antes de Perseverance.',
    limits: 'Hoy tiene agua, vida y vegetación; Jezero está seco desde hace más de 3 000 millones de años.',
  },
  {
    id: 'hanksville', analogId: 'gale', name: 'Hanksville', region: 'Utah, EE. UU.', lat: 38.41, lon: -110.79,
    kind: 'Sedimentos en capas',
    why: 'Desierto frío con areniscas y arcillas en capas. Aquí está la Mars Desert Research Station, donde se ensayan misiones.',
    limits: 'Las capas de Gale se depositaron en un lago dentro de un cráter; la presión y la radiación no se parecen en nada.',
  },
  {
    id: 'riotinto', analogId: 'meridiani', name: 'Río Tinto', region: 'Huelva, España', lat: 37.72, lon: -6.55,
    kind: 'Aguas ácidas con hierro',
    why: 'Agua con pH cercano a 2 que forma jarosita y hematita, los mismos minerales que encontró Opportunity. Tiene microbios extremófilos.',
    limits: 'El río fluye hoy; en Meridiani el agua desapareció hace miles de millones de años.',
  },
  {
    id: 'lavabeds', analogId: 'arsia', name: 'Lava Beds', region: 'California, EE. UU.', lat: 41.71, lon: -121.51,
    kind: 'Tubos de lava',
    why: 'Más de 700 cuevas en tubos de lava. La NASA prueba ahí robots y sensores para explorar cuevas.',
    limits: 'Con el 38 % de la gravedad terrestre, los tubos de Marte pueden ser mucho más grandes que los de la Tierra.',
  },
  {
    id: 'devon', analogId: 'utopia', name: 'Isla Devon · cráter Haughton', region: 'Nunavut, Canadá', lat: 75.38, lon: -89.68,
    kind: 'Desierto polar con hielo',
    why: 'Desierto polar con permafrost dentro de un cráter de impacto. Es la sede del Haughton-Mars Project de la NASA.',
    limits: 'La presión de Marte es menor al 1 % de la terrestre: allí el hielo expuesto sublima en vez de derretirse.',
  },
  {
    id: 'lanzarote', analogId: 'marius', name: 'Lanzarote · tubo de La Corona', region: 'Canarias, España', lat: 29.16, lon: -13.44,
    kind: 'Tubo de lava',
    why: 'Uno de los tubos de lava más largos del mundo (~8 km). La ESA entrena ahí a astronautas en geología (PANGAEA).',
    limits: 'Con 1/6 de la gravedad, los tubos lunares pueden ser cientos de metros más anchos y no hay aire dentro.',
  },
  {
    id: 'spcrater', analogId: 'aristarchus', name: 'SP Crater', region: 'Arizona, EE. UU.', lat: 35.58, lon: -111.63,
    kind: 'Ceniza y coladas basálticas',
    why: 'Cono de ceniza y coladas jóvenes en el campo volcánico de San Francisco, donde entrenaron geología los astronautas del Apolo.',
    limits: 'En la Luna no hay viento ni agua: la ceniza volcánica se conserva intacta por miles de millones de años.',
  },
  {
    id: 'cratersmoon', analogId: 'tranquillitatis', name: 'Craters of the Moon', region: 'Idaho, EE. UU.', lat: 43.42, lon: -113.52,
    kind: 'Basalto, pozos y cuevas',
    why: 'Coladas basálticas con cuevas y pozos de colapso. La NASA hace allí ensayos de exploración (proyecto FINESSE).',
    limits: 'Sin atmósfera, la superficie lunar pasa de ~120 °C de día a ~−170 °C de noche; solo los pozos se mantienen estables.',
  },
  {
    id: 'mcmurdo', analogId: 'shackleton', name: 'Valles Secos de McMurdo', region: 'Antártida', lat: -77.5, lon: 162.0,
    kind: 'Desierto polar frío',
    why: 'Frío extremo, sequedad y meses de día o de noche: se usa para probar equipos y la vida en bases aisladas.',
    limits: 'No hay vacío ni regolito lunar, y los cráteres en sombra de la Luna bajan de −230 °C.',
  },
];

/** Rutas de las imágenes (visible y relieve) de un punto de la Tierra. */
export function earthImages(site) {
  return {
    visible: `${SITES_DIR}/earth_${site.id}_visible.jpg`,
    relief: `${SITES_DIR}/earth_${site.id}_relief.jpg`,
  };
}
