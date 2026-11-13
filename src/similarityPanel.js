// Pantalla flotante (HUD) que muestra los parámetros de similitud.
// Se puede arrastrar desde la cabecera.

import { icon } from './icons.js';

// Nivel de color según la similitud
const level = (s) => (s >= 0.75 ? 'high' : s >= 0.5 ? 'mid' : 'low');

const fmt = (value, decimals) => value.toFixed(decimals);

/**
 * Crea el HUD de similitud (oculto).
 * onNav(±1) se llama con las flechas ‹ › para pasar al punto anterior o siguiente.
 */
export function createSimilarityPanel({ onClose, onHelp, onNav }) {
  const panel = document.createElement('div');
  panel.id = 'sim-panel';
  panel.className = 'hud';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hud-header">
      <div class="hud-nav">
        <button class="hud-prev" title="Punto anterior (←)">‹</button>
        <span>Análisis de similitud</span>
        <span class="hud-nav-count"></span>
        <button class="hud-next" title="Punto siguiente (→)">›</button>
      </div>
      <div class="hud-actions">
        <button class="hud-close" title="Cerrar (Esc)">✕</button>
      </div>
    </div>
    <div class="hud-info"></div>
    <div class="hud-score"></div>
    <div class="hud-rows"></div>
    <div class="hud-footer">Tierra / análogo · <span class="hud-demo">datos de demo</span></div>
  `;
  document.body.appendChild(panel);

  const header = panel.querySelector('.hud-header');
  panel.querySelector('.hud-close').addEventListener('click', onClose);
  panel.querySelector('.hud-prev').addEventListener('click', () => onNav(-1));
  panel.querySelector('.hud-next').addEventListener('click', () => onNav(1));

  // Clic en una fila (o en el índice global) abre la guía en ese parámetro
  panel.addEventListener('click', (e) => {
    const row = e.target.closest('[data-key]');
    if (row) onHelp(row.dataset.key);
  });

  // --- Arrastrar desde la cabecera ---
  let drag = null;
  let userMoved = false;

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    header.setPointerCapture(e.pointerId); // seguir recibiendo eventos aunque el mouse salga
  });

  header.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    panel.style.left = `${Math.min(Math.max(0, e.clientX - drag.dx), maxX)}px`;
    panel.style.top = `${Math.min(Math.max(0, e.clientY - drag.dy), maxY)}px`;
    userMoved = true;
  });

  header.addEventListener('pointerup', () => (drag = null));

  // Por defecto: centrado entre los dos planetas
  function placeDefault() {
    panel.style.left = `${(window.innerWidth - panel.offsetWidth) / 2}px`;
    panel.style.top = '64px';
  }

  // nav = { index, total }: posición del punto entre los del cuerpo análogo seleccionado
  function show({ earthPoint, analogPoint, analogName, formatLatLon, data, nav }) {
    panel.querySelector('.hud-nav-count').textContent = `${nav.index + 1}/${nav.total}`;
    panel.querySelector('.hud-info').innerHTML = `
      <div><span class="hud-key">Tierra · ${earthPoint.name}</span>${formatLatLon(earthPoint)}</div>
      <div><span class="hud-key">${analogName} · ${analogPoint.name}</span>${formatLatLon(analogPoint)}</div>`;

    const overallPct = data.overall * 100;
    panel.querySelector('.hud-score').dataset.key = 'overall';
    panel.querySelector('.hud-score').innerHTML = `
      <div class="hud-icon">${icon('target')}</div>
      <div class="hud-bar hud-${level(data.overall)}">
        <div class="hud-fill" data-width="${overallPct}"></div>
        <span class="hud-label">Índice global</span>
        <span class="hud-big">${fmt(overallPct, 1)} %</span>
      </div>`;

    panel.querySelector('.hud-rows').innerHTML = data.results
      .map(({ param, earth, analog, similarity }) => `
        <div class="hud-row" data-key="${param.key}" title="Ver explicación">
          <div class="hud-icon">${icon(param.icon)}</div>
          <div class="hud-bar hud-${level(similarity)}">
            <div class="hud-fill" data-width="${similarity * 100}"></div>
            <span class="hud-label">${param.label}</span>
            <span class="hud-values">${fmt(earth, param.decimals)} / ${fmt(analog, param.decimals)} ${param.unit}</span>
          </div>
          <div class="hud-pct hud-${level(similarity)}">${Math.round(similarity * 100)}%</div>
        </div>`)
      .join('');

    panel.hidden = false;
    if (!userMoved) placeDefault();

    // Animar las barras: empiezan en 0 y crecen hasta su valor
    const fills = panel.querySelectorAll('.hud-fill');
    fills.forEach((f) => (f.style.width = '0%'));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => fills.forEach((f) => (f.style.width = `${f.dataset.width}%`)))
    );
  }

  function hide() {
    panel.hidden = true;
  }

  window.addEventListener('resize', () => {
    if (!panel.hidden && !userMoved) placeDefault();
  });

  return { show, hide };
}
