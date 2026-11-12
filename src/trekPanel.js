// Panel lateral con la vista real del sitio objetivo (imágenes de NASA Solar System Treks).
// Aparece en el modo comparación, abajo a la derecha, bajo el cuerpo análogo.

import { TREK_LAYERS, siteImages, trekUrl } from './trekSites.js';

const BODY_NAMES = { mars: 'Marte', moon: 'Luna' };
const TREK_NAMES = { mars: 'Mars Trek', moon: 'Moon Trek' };

/**
 * Crea el panel (oculto) y devuelve sus controles.
 * @param {{ formatLatLon: (p: {lat: number, lon: number}) => string }} deps
 */
export function createTrekPanel({ formatLatLon }) {
  const panel = document.createElement('aside');
  panel.id = 'trek-panel';
  panel.className = 'hud trek-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hud-header">
      <span>Vista real · NASA Trek</span>
      <button class="hud-close trek-collapse" title="Contraer">–</button>
    </div>
    <div class="trek-body">
      <div class="trek-title"></div>
      <div class="trek-tabs" role="tablist"></div>
      <figure class="trek-figure">
        <img alt="" loading="lazy" />
        <figcaption></figcaption>
      </figure>
      <div class="trek-text">
        <p class="trek-why"></p>
        <p class="trek-analogs"></p>
        <a class="trek-link" target="_blank" rel="noopener"></a>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const img = $('.trek-figure img');
  let site = null;
  let view = 'visible';

  $('.trek-collapse').addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    $('.trek-collapse').textContent = panel.classList.contains('collapsed') ? '+' : '–';
  });

  $('.trek-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) setView(tab.dataset.view);
  });

  /** Cambia entre la imagen visible y el relieve, y actualiza el pie de foto. */
  function setView(next) {
    view = next;
    const src = siteImages(site)[view];
    img.src = src;
    img.alt = `${site.name}: ${view === 'visible' ? 'imagen' : 'relieve'}`;
    $('.trek-figure figcaption').textContent =
      `${TREK_LAYERS[site.body][view]} · ~${site.footprintKm} km de ancho` +
      (site.polar ? ' · vista desde el polo (0° arriba)' : ' · norte arriba');
    for (const tab of panel.querySelectorAll('[data-view]')) {
      tab.classList.toggle('active', tab.dataset.view === view);
    }
  }

  /** Muestra el panel con los datos de un sitio de trekSites.js. */
  function show(nextSite) {
    site = nextSite;
    const images = siteImages(site);
    $('.trek-title').innerHTML = `
      <strong>${site.name}</strong>
      <span>${BODY_NAMES[site.body]} · ${formatLatLon(site)} · ${site.kind}</span>`;
    // Los sitios polares no tienen imagen visible: no se ofrece esa pestaña
    $('.trek-tabs').innerHTML = [
      images.visible && '<button data-view="visible">Imagen</button>',
      '<button data-view="relief">Relieve</button>',
    ].filter(Boolean).join('');
    $('.trek-why').textContent = site.why;
    $('.trek-analogs').innerHTML = `<b>Análogos terrestres conocidos:</b> ${site.earthAnalogs}`;
    const link = $('.trek-link');
    link.href = trekUrl(site);
    link.textContent = `Explorar en ${TREK_NAMES[site.body]} ↗`;
    setView(images.visible ? 'visible' : 'relief');
    panel.hidden = false;
  }

  /** Oculta el panel. */
  function hide() {
    panel.hidden = true;
  }

  return { show, hide };
}
