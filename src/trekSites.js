// Sitios objetivo en Marte y la Luna, con imágenes reales de NASA Solar System Treks.
// Las imágenes se generan con scripts/fetch-trek.sh; las coordenadas deben coincidir con las
// del script (si se añade un sitio aquí, hay que añadirlo también allí y volver a ejecutarlo).

const SITES_DIR = '/trek/sites';

// Capas de Trek de las que salen las imágenes (se citan en el panel)
export const TREK_LAYERS = {
  mars: {
    visible: 'Viking MDIM 2.1 (mosaico color)',
    relief: 'MGS MOLA (relieve coloreado)',
  },
  moon: {
    visible: 'LRO WAC (mosaico global)',
    relief: 'LRO LOLA (relieve sombreado)',
  },
};

// footprintKm: ancho aproximado del recorte (768 px a z7 ≈ 4.2° de longitud en el ecuador)
export const TREK_SITES = [
  {
    id: 'jezero', body: 'mars', name: 'Cráter Jezero', lat: 18.38, lon: 77.58, footprintKm: 250,
    kind: 'Delta y antiguo lago',
    why: 'Cráter que tuvo un lago, con un delta fósil donde Perseverance recoge muestras que podrían guardar rastros de vida antigua.',
  },
  {
    id: 'gale', body: 'mars', name: 'Cráter Gale', lat: -5.4, lon: 137.8, footprintKm: 250,
    kind: 'Sedimentos en capas',
    why: 'El Monte Sharp guarda millones de años de capas de sedimentos. Curiosity las recorre desde 2012.',
  },
  {
    id: 'meridiani', body: 'mars', name: 'Meridiani Planum', lat: -1.95, lon: -5.53, footprintKm: 250,
    kind: 'Hematita y aguas ácidas',
    why: 'Llanura con esferas de hematita y sulfatos, formados por agua ácida. La exploró Opportunity.',
  },
  {
    id: 'arsia', body: 'mars', name: 'Arsia Mons', lat: -8.26, lon: -120.1, footprintKm: 250,
    kind: 'Volcán y posibles cuevas',
    why: 'Volcán escudo con hundimientos que podrían ser tubos de lava: refugio natural frente a la radiación.',
  },
  {
    id: 'utopia', body: 'mars', name: 'Utopia Planitia', lat: 46.7, lon: 117.5, footprintKm: 250,
    kind: 'Hielo bajo la superficie',
    why: 'Llanura con hielo enterrado y terreno festoneado: recurso clave de agua para una base humana.',
  },
  {
    id: 'marius', body: 'moon', name: 'Colinas de Marius', lat: 14.09, lon: -56.8, footprintKm: 128,
    kind: 'Tubo de lava (claraboya)',
    why: 'Un pozo de unos 60 m abre paso a un posible tubo de lava: protección térmica y contra la radiación para una base.',
  },
  {
    id: 'aristarchus', body: 'moon', name: 'Meseta de Aristarco', lat: 23.7, lon: -47.4, footprintKm: 128,
    kind: 'Vulcanismo explosivo',
    why: 'Depósitos de ceniza volcánica rica en oxígeno y hierro, útiles para producir recursos en el lugar (ISRU).',
  },
  {
    id: 'tranquillitatis', body: 'moon', name: 'Pozo de Tranquilidad', lat: 8.34, lon: 33.22, footprintKm: 128,
    kind: 'Pozo en mar basáltico',
    why: 'Pozo de ~100 m cuyo interior mantiene unos 17 °C estables, frente a los extremos de la superficie.',
  },
  {
    id: 'shackleton', body: 'moon', name: 'Polo sur · Shackleton', lat: -89.67, lon: 129.78, footprintKm: 120,
    kind: 'Base lunar permanente',
    why: 'Bordes con luz solar casi constante junto a cráteres en sombra permanente que guardan hielo de agua. Es la zona de Artemis III.',
    polar: true,
  },
];

/**
 * Rutas de las imágenes de un sitio. Los sitios polares solo tienen relieve,
 * porque cerca del polo las imágenes visibles están casi siempre en sombra.
 */
export function siteImages(site) {
  return {
    visible: site.polar ? null : `${SITES_DIR}/${site.id}_visible.jpg`,
    relief: `${SITES_DIR}/${site.id}_relief.jpg`,
  };
}

// Trek rechaza el enlace ("Invalid projection") si no se indica la proyección de cada cuerpo
const TREK_PROJECTION = {
  mars: 'urn:ogc:def:crs:EPSG::104905',
  moon: 'urn:ogc:def:crs:EPSG::104903',
};

/** Enlace al visor de Trek (Mars Trek o Moon Trek) centrado en el sitio. */
export function trekUrl(site) {
  const p = encodeURIComponent(TREK_PROJECTION[site.body]);
  return `https://trek.nasa.gov/${site.body}/#v=0.1&x=${site.lon}&y=${site.lat}&z=8&p=${p}&d=`;
}
