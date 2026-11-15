// Pantalla flotante (HUD) que muestra los parámetros de similitud.
// Se puede arrastrar desde la cabecera.

import { icon } from './icons.js';

// Nivel de color según la similitud
const level = (s) => (s >= 0.75 ? 'high' : s >= 0.5 ? 'mid' : 'low');

const fmt = (value, decimals) => value.toFixed(decimals);
const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

/**
 * Crea el HUD de similitud (oculto).
 * onNav(±1) se llama desde la barra superior para pasar al punto anterior o siguiente.
 */
export function createSimilarityPanel({ onClose, onHelp, onNav }) {
  const panel = document.createElement('div');
  panel.id = 'sim-panel';
  panel.className = 'hud';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hud-header">
      <span>Análisis de similitud</span>
      <div class="hud-actions">
        <button class="hud-close" title="Cerrar (Esc)">✕</button>
      </div>
    </div>
    <div class="hud-info"></div>
    <div class="hud-score"></div>
    <div class="hud-rows"></div>
    <div class="hud-footer"></div>
  `;
  document.body.appendChild(panel);

  // Navegación entre puntos arriba del todo, fuera del HUD, para que se vea como acción principal
  const nav = document.createElement('nav');
  nav.id = 'point-nav';
  nav.hidden = true;
  nav.innerHTML = `
    <button class="nav-prev" title="Punto anterior (←)"><span aria-hidden="true">‹</span> Anterior</button>
    <span class="nav-count"></span>
    <button class="nav-next" title="Punto siguiente (→)">Siguiente <span aria-hidden="true">›</span></button>
  `;
  document.body.appendChild(nav);

  const header = panel.querySelector('.hud-header');
  panel.querySelector('.hud-close').addEventListener('click', onClose);
  nav.querySelector('.nav-prev').addEventListener('click', () => onNav(-1));
  nav.querySelector('.nav-next').addEventListener('click', () => onNav(1));

  // Clic en una fila (o en el índice global) abre la guía en ese parámetro
  panel.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
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

  function animateBars() {
    const fills = panel.querySelectorAll('.hud-fill');
    fills.forEach((fill) => (fill.style.width = '0%'));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => fills.forEach((fill) => (fill.style.width = `${fill.dataset.width}%`)))
    );
  }

  /** Posición por defecto: centrado entre los dos planetas. */
  function placeDefault() {
    panel.style.left = `${(window.innerWidth - panel.offsetWidth) / 2}px`;
    panel.style.top = '76px'; // debajo de la barra de navegación
  }

  /**
   * Pinta el HUD para un par Tierra–análogo.
   * `nav` = { index, total }: posición del punto entre los del cuerpo análogo seleccionado.
   */
  function show({ earthPoint, analogPoint, analogName, formatLatLon, data, nav: position }) {
    header.querySelector('span').textContent = 'Análisis de similitud';
    panel.querySelector('.hud-footer').innerHTML = 'Tierra / análogo · <span class="hud-demo">datos de demo</span>';
    const { purpose } = data.profile;
    nav.querySelector('.nav-count').textContent = `${position.index + 1} / ${position.total}`;
    nav.hidden = false;
    panel.querySelector('.hud-info').innerHTML = `
      <div><span class="hud-key">Tierra · ${earthPoint.name}</span>${formatLatLon(earthPoint)}</div>
      <div><span class="hud-key">${analogName} · ${analogPoint.name}</span>${formatLatLon(analogPoint)}</div>`;

    const overallPct = data.overall * 100;
    const score = panel.querySelector('.hud-score');
    score.dataset.key = 'overall';
    score.className = `hud-score hud-${level(data.overall)}`;
    panel.querySelector('.hud-score').innerHTML = `
      <div class="hud-icon">${icon('target')}</div>
      <div class="hud-bar hud-${level(data.overall)}">
        <div class="hud-fill" data-width="${overallPct}"></div>
        <span class="hud-label">Índice global<small class="hud-purpose">${purpose}</small></span>
        <span class="hud-big hud-level-text">${fmt(overallPct, 1)}<small>%</small></span>
      </div>`;

    // Solo los grupos en pantalla; los subparámetros se detallan en la guía (clic en la fila)
    const groupRows = data.groups.map(({ group, items, similarity }) => `
        <div class="hud-row hud-group" data-key="${items[0].param.key}" title="Ver explicación">
          <div class="hud-icon">${icon(group.icon)}</div>
          <div class="hud-bar hud-${level(similarity)}">
            <div class="hud-fill" data-width="${similarity * 100}"></div>
            <span class="hud-label">${group.label}</span>
          </div>
          <div class="hud-pct hud-${level(similarity)}">${Math.round(similarity * 100)}%</div>
        </div>`);

    // Requisito de misión: solo del sitio de Marte o la Luna, no entra al índice
    const { req, value, pass } = data.requirement;
    const reqRow = `
        <div class="hud-row hud-req ${pass ? 'hud-req-ok' : 'hud-req-fail'}" data-key="${req.key}" title="Mínimo: ${fmt(req.min, req.decimals)} ${req.unit} · ver explicación">
          <div class="hud-icon">${icon(req.icon)}</div>
          <div class="hud-bar">
            <span class="hud-label">${req.short}</span>
            <span class="hud-values">${fmt(value, req.decimals)} ${req.unit}</span>
          </div>
          <div class="hud-pct">${pass ? 'APTO' : 'NO APTO'}</div>
        </div>`;

    panel.querySelector('.hud-rows').innerHTML =
      groupRows.join('') + '<hr class="hud-divider">' + reqRow;

    // Cuántos de los valores de esta pareja salen de datos reales (el resto es demo)
    const { real, total } = data.dataSummary;
    panel.querySelector('.hud-footer').innerHTML = real
      ? `Tierra / análogo · <span class="hud-real">${real} de ${total} valores con datos reales</span>`
      : 'Tierra / análogo · <span class="hud-demo">datos de demo</span>';

    panel.hidden = false;
    if (!userMoved) placeDefault();

    animateBars();
  }

  /** Muestra factores y filtros del candidato sin inventar una comparación terrestre. */
  function showCandidate({ candidate, bodyName, formatLatLon, data, nav: position }) {
    header.querySelector('span').textContent = 'Análisis del candidato';
    panel.querySelector('.hud-footer').textContent = 'Punto candidato · sin comparación terrestre';
    const statusText = {
      passed_but_too_close: 'Cumple los filtros evaluados; quedó cerca de un candidato principal',
      near_miss: 'Casi cumple; el potencial de hielo quedó bajo el umbral',
      ice_unassessed: 'El IFI no cubría el punto; el valor actual es un proxy de latitud',
    }[candidate.status] ?? candidate.status;
    const detail = candidate.selectionDetail;
    const detailText = candidate.status === 'passed_but_too_close'
      ? `Distancia al candidato principal: ${detail.distance_to_nearest_selected_km ?? '—'} km (separación mínima ${detail.minimum_separation_km ?? '—'} km).`
      : candidate.status === 'near_miss'
        ? `Hielo: ${detail.value ?? '—'} pts; umbral ${detail.threshold ?? '—'} pts; diferencia ${detail.shortfall ?? '—'} pts.`
        : 'El valor de hielo mostrado ahora es un proxy de latitud con confianza muy baja.';

    nav.querySelector('.nav-count').textContent = `${position.index + 1} / ${position.total}`;
    nav.hidden = false;
    panel.querySelector('.hud-info').innerHTML = `
      <div><span class="hud-key">${bodyName} · ${candidate.site.name}</span>${formatLatLon(candidate.site)}</div>
      <div><span class="hud-key">${statusText}</span>${detailText}</div>
      <div class="hud-candidate-coverage">Cobertura de datos de origen: ${candidate.parameterDataCoveragePercent ?? 0}% · filtros evaluados: ${candidate.hardFilterCoveragePercent ?? 0}%</div>`;

    const overallPct = data.overall * 100;
    const score = panel.querySelector('.hud-score');
    score.dataset.key = 'overall';
    score.className = `hud-score hud-${level(data.overall)}`;
    score.innerHTML = `
      <div class="hud-icon">${icon('target')}</div>
      <div class="hud-bar hud-${level(data.overall)}">
        <div class="hud-fill" data-width="${overallPct}"></div>
        <span class="hud-label">Puntaje de selección<small class="hud-purpose">${data.profile.purpose}</small></span>
        <span class="hud-big hud-level-text">${fmt(overallPct, 1)}<small>%</small></span>
      </div>`;

    const groups = data.groups.map(({ group, items, similarity }) => {
      const groupPct = similarity == null ? null : similarity * 100;
      const groupClass = similarity == null ? '' : `hud-${level(similarity)}`;
      const groupRow = `
        <div class="hud-row hud-group ${groupClass}" data-key="${items[0]?.param.key ?? 'overall'}" title="Ver factores del grupo">
          <div class="hud-icon">${icon(group.icon)}</div>
          <div class="hud-bar ${groupClass}">
            ${groupPct == null ? '' : `<div class="hud-fill" data-width="${groupPct}"></div>`}
            <span class="hud-label">${group.label}</span>
            <span class="hud-values">${groupPct == null ? 'Sin puntuación' : `${Math.round(groupPct)}%`}</span>
          </div>
        </div>`;
      const factorRows = items.map(({ param, analog, confidence, factorMetadata }) => {
        const unit = param.unit || factorMetadata?.unit || '';
        const value = analog == null ? 'Sin datos' : `${fmt(analog, param.decimals)} ${unit}`;
        const confidenceValue = factorMetadata?.confidence_percent ?? confidence?.analog;
        const confidenceText = factorMetadata?.confidence
          ? `<small class="hud-confidence">Confianza del dato: ${factorMetadata.confidence}${confidenceValue == null ? '' : ` (${Math.round(confidenceValue)}%)`}</small>`
          : confidenceValue == null
            ? ''
            : `<small class="hud-confidence">Confianza del indicador: ${Math.round(confidenceValue)}%</small>`;
        const sourceUrl = factorMetadata?.source_url
          ?? factorMetadata?.reference_source_url
          ?? factorMetadata?.planned_source_url;
        const sourceText = factorMetadata?.source
          ? escapeMarkup(factorMetadata.source)
          : '';
        const sourceLinkText = factorMetadata?.planned_source_url || factorMetadata?.reference_source_url
          ? 'Producto de referencia (no usado)'
          : 'Abrir fuente';
        const provenance = factorMetadata
          ? `<small class="hud-factor-note">${factorMetadata.kind === 'usgs_ice_favorability_raster' ? 'Fuente directa' : 'Estimación aproximada'} · ${escapeMarkup(factorMetadata.method)}<br>${sourceText ? `Fuente: ${sourceText}<br>` : ''}${escapeMarkup(factorMetadata.limitation)}${sourceUrl ? `<br><a href="${escapeMarkup(sourceUrl)}" target="_blank" rel="noopener noreferrer">${sourceLinkText}</a>` : ''}</small>`
          : '';
        return `
          <div class="candidate-factor" data-key="${param.key}" title="Ver explicación del factor">
            <span class="candidate-factor-icon">${icon(param.icon)}</span>
            <span class="candidate-factor-label">${param.label}</span>
            <span class="candidate-factor-value">${value}${confidenceText}${provenance}</span>
          </div>`;
      }).join('');
      return groupRow + factorRows;
    }).join('');

    const { req, value, pass } = data.requirement;
    const requirementValue = value == null ? 'Sin datos' : `${fmt(value, req.decimals)} ${req.unit}`;
    const reqRow = `
      <div class="hud-row hud-req ${pass ? 'hud-req-ok' : 'hud-req-fail'}" data-key="${req.key}" title="Mínimo: ${fmt(req.min, req.decimals)} ${req.unit} · ver explicación">
        <div class="hud-icon">${icon(req.icon)}</div>
        <div class="hud-bar">
          <span class="hud-label">${req.short}</span>
          <span class="hud-values">${requirementValue}</span>
        </div>
        <div class="hud-pct">${value == null ? 'S/D' : pass ? 'APTO' : 'NO APTO'}</div>
      </div>`;
    panel.querySelector('.hud-rows').innerHTML = groups + '<hr class="hud-divider">' + reqRow;

    panel.hidden = false;
    if (!userMoved) placeDefault();
    animateBars();
  }

  /** Oculta el HUD y su barra de navegación. */
  function hide() {
    panel.hidden = true;
    nav.hidden = true;
  }

  window.addEventListener('resize', () => {
    if (!panel.hidden && !userMoved) placeDefault();
  });

  return { show, showCandidate, hide };
}
