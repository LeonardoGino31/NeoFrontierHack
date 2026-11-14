// Capas, imágenes y enlaces de NASA Solar System Treks.
// Los sitios, sus coordenadas y sus datos de comparación se cargan desde el CSV.

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
