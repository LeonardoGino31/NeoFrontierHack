// Panel inferior del modo comparación: dos tarjetas pegadas a los bordes (Tierra a la izquierda,
// análogo a la derecha) y una barra central con las pestañas, para no tapar el centro de la escena. Imágenes reales de NASA GIBS (Tierra) y Solar System
// Treks (Marte y la Luna), con el mismo ancho en km para comparar a escala.

import { TREK_LAYERS, siteImages, trekUrl } from './trekSites.js';
import { EARTH_LAYERS, earthImages } from './earthSites.js';
import { MAPS_PIN_SVG } from './mapsView.js';

const BODY_NAMES = { mars: 'Marte', moon: 'Luna' };
const TREK_NAMES = { mars: 'Mars Trek', moon: 'Moon Trek' };

/**
 * Crea el panel (oculto) y devuelve sus controles.
 * @param {{ formatLatLon: (p: {lat: number, lon: number}) => string,
 *           onOpenMaps: (earth: object, origin: {x: number, y: number}) => void }} deps
 *   onOpenMaps se llama al tocar el pin de Google Maps de la tarjeta de la Tierra
 */
export function createComparePanel({ formatLatLon, onOpenMaps }) {
  const panel = document.createElement('section');
  panel.id = 'compare-panel';
  panel.className = 'compare-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hud cmp-bar">
      <div class="hud-header">
        <span>Vista real · NASA</span>
        <div class="cmp-tabs" role="tablist">
          <button data-view="visible">Imagen</button>
          <button data-view="relief">Relieve</button>
        </div>
        <button class="hud-close cmp-collapse" title="Contraer">–</button>
      </div>
    </div>
    <article class="hud cmp-side" data-side="earth"></article>
    <article class="hud cmp-side" data-side="analog"></article>
  `;
  document.body.appendChild(panel);

  let pair = null;
  let view = 'visible';

  panel.querySelector('.cmp-collapse').addEventListener('click', (e) => {
    panel.classList.toggle('collapsed');
    e.currentTarget.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

  // Pin de Google Maps: el zoom nace desde donde está el pin
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.cmp-gmap');
    if (!btn || !pair) return;
    const r = btn.getBoundingClientRect();
    onOpenMaps?.(pair.earth, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });

  panel.querySelector('.cmp-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      view = tab.dataset.view;
      render();
    }
  });

  /** HTML de una mitad: imagen + textos. `img` es null si esa vista no existe. */
  function sideHtml({ img, caption, title, subtitle, body, footer }) {
    return `
      <figure>
        <img src="${img}" alt="${title}" loading="lazy" />
        <figcaption>${caption}</figcaption>
      </figure>
      <div class="cmp-text">
        <strong>${title}</strong>
        <span class="cmp-sub">${subtitle}</span>
        ${body}
        ${footer ?? ''}
      </div>`;
  }

  /** Vuelve a pintar ambas mitades con la vista actual (imagen o relieve). */
  function render() {
    const { earth, analog } = pair;
    const km = analog.footprintKm;

    panel.querySelector('[data-side="earth"]').innerHTML = sideHtml({
      img: earthImages(earth)[view],
      caption: `${EARTH_LAYERS[view]} · ~${km} km`,
      title: earth.name,
      subtitle: `Tierra · ${earth.region} · ${formatLatLon(earth)}
        <button class="cmp-gmap" type="button" title="Ver este lugar en Google Maps" aria-label="Ver ${earth.name} en Google Maps">${MAPS_PIN_SVG}</button>`,
      body: `<p>${earth.why}</p>
        <p class="cmp-limits"><b>Dónde falla:</b> ${earth.limits}</p>`,
    });

    // Los sitios polares solo tienen relieve: se muestra aunque la pestaña sea "Imagen"
    const images = siteImages(analog);
    const analogView = images[view] ? view : 'relief';
    panel.querySelector('[data-side="analog"]').innerHTML = sideHtml({
      img: images[analogView],
      caption: `${TREK_LAYERS[analog.body][analogView]} · ~${km} km` +
        (analog.polar ? ' · vista polar' : ''),
      title: analog.name,
      subtitle: `${BODY_NAMES[analog.body]} · ${analog.kind} · ${formatLatLon(analog)}`,
      body: `<p>${analog.why}</p>`,
      footer: `<a class="cmp-link" href="${trekUrl(analog)}" target="_blank" rel="noopener">
        Explorar en ${TREK_NAMES[analog.body]} ↗</a>`,
    });

    for (const tab of panel.querySelectorAll('[data-view]')) {
      tab.classList.toggle('active', tab.dataset.view === view);
    }
  }

  /** Muestra el par Tierra–análogo cargado desde el CSV. */
  function show(earth, analog) {
    pair = { earth, analog };
    render();
    panel.hidden = false;
  }

  /** Oculta el panel. */
  function hide() {
    panel.hidden = true;
  }

  return { show, hide };
}
