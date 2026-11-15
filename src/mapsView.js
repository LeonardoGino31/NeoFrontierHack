// Visor de Google Maps: al tocar el pin de una tarjeta se "entra" al lugar con un zoom
// circular que nace en el pin y termina en la vista real de Google Maps (satélite o mapa).
//
// Sin configuración usa el visor incrustable gratuito de Google (no necesita clave). Si se
// define VITE_GOOGLE_MAPS_KEY en un archivo .env se usa la Maps Embed API oficial.

import { addKeyLayer, KEY_PRIORITY } from './keyboard.js';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const ZOOM = 14;

/** Pin característico de Google Maps (rojo, azul, amarillo y verde) como SVG propio. */
export const MAPS_PIN_SVG = `
<svg viewBox="0 0 24 32" aria-hidden="true">
  <defs><clipPath id="gm-pin-clip"><path d="M12 1C6.5 1 2 5.4 2 10.8c0 3 1.5 5.6 3.6 8.4C8 22 10.5 25 12 31c1.5-6 4-9 6.4-11.8C20.5 16.4 22 13.8 22 10.8 22 5.4 17.5 1 12 1z"/></clipPath></defs>
  <g clip-path="url(#gm-pin-clip)">
    <polygon points="0,0 10,0 12,10.8 0,16" fill="#ea4335"/>
    <polygon points="10,0 24,0 24,8 12,10.8" fill="#4285f4"/>
    <polygon points="0,16 12,10.8 12,32 0,32" fill="#fbbc04"/>
    <polygon points="12,10.8 24,8 24,32 12,32" fill="#34a853"/>
  </g>
  <circle cx="12" cy="10.8" r="4" fill="#fff"/>
</svg>`;

/** Dirección del visor incrustado para unas coordenadas y un tipo de mapa ('satellite' | 'roadmap'). */
function embedUrl({ lat, lon }, type) {
  if (API_KEY) {
    return `https://www.google.com/maps/embed/v1/view?key=${API_KEY}&center=${lat},${lon}&zoom=${ZOOM}&maptype=${type}`;
  }
  return `https://maps.google.com/maps?q=${lat},${lon}&t=${type === 'satellite' ? 'k' : 'm'}&z=${ZOOM}&ie=UTF8&hl=es&output=embed`;
}

export function createMapsView() {
  const root = document.createElement('div');
  root.id = 'maps-view';
  root.hidden = true;
  root.innerHTML = `
    <div class="mv-stage">
      <iframe class="mv-frame" title="Google Maps" allowfullscreen loading="eager"
        referrerpolicy="no-referrer-when-downgrade"></iframe>
      <div class="mv-loading"><span class="mv-spin"></span><span class="mv-loading-text"></span></div>
    </div>
    <header class="mv-bar">
      <span class="mv-pin">${MAPS_PIN_SVG}</span>
      <div class="mv-title"><strong></strong><small></small></div>
      <div class="mv-tabs" role="tablist">
        <button data-type="satellite">Satélite</button>
        <button data-type="roadmap">Mapa</button>
      </div>
      <a class="mv-external" target="_blank" rel="noopener">Abrir en Google Maps ↗</a>
      <button class="mv-close" title="Volver al globo (Esc)" aria-label="Volver al globo">✕</button>
    </header>`;
  document.body.appendChild(root);

  const frame = root.querySelector('.mv-frame');
  const loading = root.querySelector('.mv-loading');
  let place = null;
  let type = 'satellite';
  let isOpen = false;
  let closeTimer = 0;

  const setFrame = () => {
    root.classList.add('loading');
    frame.src = embedUrl(place, type);
    for (const b of root.querySelectorAll('[data-type]')) b.classList.toggle('active', b.dataset.type === type);
  };
  frame.addEventListener('load', () => {
    if (frame.src && frame.src !== 'about:blank') root.classList.remove('loading');
  });

  root.querySelector('.mv-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b || b.dataset.type === type) return;
    type = b.dataset.type;
    setFrame();
  });
  root.querySelector('.mv-close').addEventListener('click', close);

  /**
   * Entra al lugar con un zoom circular que parte de (originX, originY), el pin tocado.
   * @param {{ name: string, subtitle: string, lat: number, lon: number }} spot
   */
  function open(spot, originX = window.innerWidth / 2, originY = window.innerHeight / 2) {
    clearTimeout(closeTimer);
    place = spot;
    type = 'satellite';
    root.querySelector('.mv-title strong').textContent = spot.name;
    root.querySelector('.mv-title small').textContent = spot.subtitle;
    root.querySelector('.mv-external').href = `https://www.google.com/maps/@${spot.lat},${spot.lon},${ZOOM}z/data=!3m1!1e3`;
    loading.querySelector('.mv-loading-text').textContent = `Descendiendo a ${spot.name}…`;
    root.style.setProperty('--ox', `${originX}px`);
    root.style.setProperty('--oy', `${originY}px`);
    root.classList.remove('entered');
    root.hidden = false;
    isOpen = true;
    setFrame();
    // Dos cuadros: el primero fija el estado inicial (círculo cerrado) y el segundo anima
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('entered')));
    root.querySelector('.mv-close').focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('entered'); // el círculo se cierra de vuelta hacia el pin
    closeTimer = setTimeout(() => {
      root.hidden = true;
      frame.src = 'about:blank'; // detiene la carga y libera memoria
    }, 900);
  }

  addKeyLayer({
    priority: KEY_PRIORITY.maps,
    isActive: () => isOpen,
    onKeyDown(e) {
      if (e.key === 'Escape') close();
    },
  });

  return { open, close, isOpen: () => isOpen };
}
