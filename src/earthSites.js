// Recursos visuales del panel Tierra–análogo. Los sitios y sus datos se cargan desde el CSV.

const SITES_DIR = '/trek/sites';

export const EARTH_LAYERS = {
  visible: 'Blue Marble NG (NASA GIBS)',
  relief: 'ASTER GDEM (NASA GIBS)',
};

/** Rutas de las imágenes (visible y relieve) de un punto de la Tierra. */
export function earthImages(site) {
  return {
    visible: `${SITES_DIR}/earth_${site.id}_visible.jpg`,
    relief: `${SITES_DIR}/earth_${site.id}_relief.jpg`,
  };
}
