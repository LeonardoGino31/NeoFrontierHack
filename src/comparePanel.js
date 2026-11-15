// Panel inferior del modo comparación: dos tarjetas pegadas a los bordes (Tierra a la izquierda,
// análogo a la derecha) y una barra central con las pestañas, para no tapar el centro de la escena. Imágenes reales de NASA GIBS (Tierra) y Solar System
// Treks (Marte y la Luna), con el mismo ancho en km para comparar a escala.

import { TREK_LAYERS, siteImages, trekUrl } from './trekSites.js';
import { EARTH_LAYERS, earthImages } from './earthSites.js';
import { MAPS_PIN_SVG } from './mapsView.js';
import { addKeyLayer, KEY_PRIORITY } from './keyboard.js';

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
        <div class="cmp-tabs" role="tablist">
          <button data-view="visible">Imagen</button>
          <button data-view="relief">Relieve</button>
        </div>
        <button class="cmp-data" type="button">Datos</button>
        <button class="hud-close cmp-collapse" title="Contraer">–</button>
      </div>
    </div>
    <article class="hud cmp-side" data-side="earth"></article>
    <article class="hud cmp-side" data-side="analog"></article>
  `;
  document.body.appendChild(panel);

  // Ventana de datos: dos marcos separados, Tierra a la izquierda y el análogo a la derecha
  const modal = document.createElement('div');
  modal.id = 'cmp-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <button class="hud-close cmp-modal-close" type="button" title="Cerrar (Esc)">✕</button>
    <article class="hud dm-frame" data-side="earth"></article>
    <article class="hud dm-frame" data-side="analog"></article>`;
  document.body.appendChild(modal);

  const closeModal = () => { modal.hidden = true; };
  panel.querySelector('.cmp-data').addEventListener('click', () => { if (pair) modal.hidden = false; });
  modal.querySelector('.cmp-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
  addKeyLayer({
    priority: KEY_PRIORITY.modal,
    isActive: () => !modal.hidden,
    onKeyDown(e) { if (e.key === 'Escape') closeModal(); },
  });

  let pair = null;
  let view = 'visible';

  panel.querySelector('.cmp-collapse').addEventListener('click', (e) => {
    panel.classList.toggle('collapsed');
    e.currentTarget.textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

  // Pin de Google Maps (en la ventana de datos): el zoom nace desde donde está el pin
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('.cmp-gmap');
    if (!btn || !pair) return;
    const r = btn.getBoundingClientRect();
    closeModal();
    onOpenMaps?.(pair.earth, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });

  panel.querySelector('.cmp-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) {
      view = tab.dataset.view;
      render();
    }
  });

  /** Tarjeta del panel inferior: imagen real, nombre y coordenadas, nada más. */
  function cardHtml({ img, caption, title, coords }) {
    return `
      <figure>
        <img src="${img}" alt="${title}" loading="lazy" />
        <figcaption>${caption}</figcaption>
      </figure>
      <div class="cmp-text">
        <strong>${title}</strong>
        <span class="cmp-sub">${coords}</span>
      </div>`;
  }

  /** Marco de la ventana de datos: imagen grande + toda la información + cómo explorarlo. */
  function frameHtml({ img, caption, title, subtitle, body, action }) {
    return `
      <div class="hud-header"><span>${title}</span></div>
      <figure class="dm-fig">
        <img src="${img}" alt="${title}" />
        <figcaption>${caption}</figcaption>
      </figure>
      <div class="dm-text">
        <span class="cmp-sub">${subtitle}</span>
        ${body}
        ${action}
      </div>`;
  }

  /** Vuelve a pintar ambas mitades con la vista actual (imagen o relieve). */
  function render() {
    const { earth, analog } = pair;
    const km = analog.footprintKm;

    const earthImg = earthImages(earth)[view];
    const earthCaption = `${EARTH_LAYERS[view]} · ~${km} km`;

    // Los sitios polares solo tienen relieve: se muestra aunque la pestaña sea "Imagen"
    const images = siteImages(analog);
    const analogView = images[view] ? view : 'relief';
    const analogCaption = `${TREK_LAYERS[analog.body][analogView]} · ~${km} km` +
      (analog.polar ? ' · vista polar' : '');

    panel.querySelector('[data-side="earth"]').innerHTML = cardHtml({
      img: earthImg, caption: earthCaption, title: earth.name, coords: formatLatLon(earth),
    });
    panel.querySelector('[data-side="analog"]').innerHTML = cardHtml({
      img: images[analogView], caption: analogCaption, title: analog.name, coords: formatLatLon(analog),
    });

    modal.querySelector('[data-side="earth"]').innerHTML = frameHtml({
      img: earthImg,
      caption: earthCaption,
      title: `Tierra · ${earth.name}`,
      subtitle: `${earth.region} · ${formatLatLon(earth)}`,
      body: `<p>${earth.why}</p>
        <p class="cmp-limits"><b>Dónde falla:</b> ${earth.limits}</p>`,
      action: `<button class="cmp-explore cmp-gmap" type="button" aria-label="Ver ${earth.name} en Google Maps">
        <span class="cmp-pin">${MAPS_PIN_SVG}</span> Explorar en Google Maps</button>`,
    });
    modal.querySelector('[data-side="analog"]').innerHTML = frameHtml({
      img: images[analogView],
      caption: analogCaption,
      title: `${BODY_NAMES[analog.body]} · ${analog.name}`,
      subtitle: `${analog.kind} · ${formatLatLon(analog)}`,
      body: `<p>${analog.why}</p>`,
      action: `<a class="cmp-explore" href="${trekUrl(analog)}" target="_blank" rel="noopener">
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
    closeModal();
  }

  return { show, hide };
}
