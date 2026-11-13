// Guía de parámetros: pantalla dedicada que explica cada parámetro de similitud,
// de dónde salen los datos y cómo se calcula, con un simulador interactivo.

import { PARAMS, paramSimilarity } from './similarity.js';
import { PARAM_INFO, OVERALL_INFO } from './paramInfo.js';
import { icon } from './icons.js';

const BODY_NAMES = { earth: 'Tierra', mars: 'Marte', moon: 'Luna' };
const level = (s) => (s >= 0.75 ? 'high' : s >= 0.5 ? 'mid' : 'low');

export function createParamGuide({ onOpenLab } = {}) {
  // --- Estructura base ---
  const overlay = document.createElement('div');
  overlay.id = 'param-guide';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="guide hud">
      <div class="hud-header">
        <span>${icon('book')} Guía de parámetros</span>
        <button class="hud-close" title="Cerrar (Esc)">✕</button>
      </div>
      <div class="guide-body">
        <nav class="guide-nav"></nav>
        <section class="guide-detail"></section>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Botón fijo para abrir la guía en cualquier momento
  const launcher = document.createElement('button');
  launcher.id = 'guide-launcher';
  launcher.innerHTML = `${icon('book')}<span>Parámetros</span>`;
  launcher.addEventListener('click', () => open('overall'));
  document.body.appendChild(launcher);

  const nav = overlay.querySelector('.guide-nav');
  const detail = overlay.querySelector('.guide-detail');
  let currentKey = null;
  let context = null; // datos del punto seleccionado (si hay)
  let activeParams = PARAMS;
  let keys = [];

  function refreshNavigation() {
    activeParams = context?.analogBody
      ? PARAMS.filter((p) => !p.bodies || p.bodies.includes(context.analogBody))
      : PARAMS;
    keys = ['overall', ...activeParams.map((p) => p.key)];
    nav.innerHTML = [
      `<button data-key="overall">${icon('target')}<span>Índice global</span></button>`,
      ...activeParams.map((p) => `<button data-key="${p.key}">${icon(p.icon)}<span>${p.label}</span></button>`),
    ].join('');
    if (currentKey && !keys.includes(currentKey)) currentKey = 'overall';
  }
  refreshNavigation();

  // --- Eventos ---
  overlay.querySelector('.hud-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // clic fuera de la ventana
  });
  detail.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lab]');
    if (btn && onOpenLab) onOpenLab(btn.dataset.lab);
  });
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (btn) show(btn.dataset.key);
  });

  // Teclado: Esc cierra y ↑/↓ navegan. Se registra en fase de captura para
  // que Esc cierre solo la guía y no también la comparación de atrás.
  window.addEventListener(
    'keydown',
    (e) => {
      if (overlay.hidden) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = keys.indexOf(currentKey) + (e.key === 'ArrowDown' ? 1 : -1);
        show(keys[(i + keys.length) % keys.length]);
      }
    },
    true
  );

  // --- Render ---
  function show(key) {
    if (!keys.includes(key)) key = 'overall';
    currentKey = key;
    nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.key === key));
    detail.innerHTML = key === 'overall' ? renderOverall() : renderParam(key);
    detail.scrollTop = 0;
    if (key !== 'overall') bindSimulator(key);
  }

  function renderOverall() {
    const totalWeight = activeParams.reduce((sum, p) => sum + p.weight, 0);
    const rows = activeParams.map((p) => {
      const share = (p.weight / totalWeight) * 100;
      return `
        <div class="weight-row">
          <span class="weight-icon">${icon(p.icon)}</span>
          <span class="weight-label">${p.label}</span>
          <div class="weight-bar"><div style="width:${share}%"></div></div>
          <span class="weight-value">×${p.weight} · ${share.toFixed(1)}%</span>
        </div>`;
    }).join('');

    const current = context
      ? `<div class="guide-block guide-current">
           <h3>En el punto seleccionado</h3>
           <p>Comparación Tierra – ${context.analogName}:
             <strong class="lvl-${level(context.data.overall)}">${(context.data.overall * 100).toFixed(1)} %</strong></p>
         </div>`
      : '';

    return `
      <header class="guide-title">
        <span class="guide-title-icon">${icon('target')}</span>
        <div><h2>Índice global de similitud</h2><span class="guide-tag">promedio ponderado</span></div>
        <button class="guide-lab-btn" data-lab="natural">${icon('cube')} Laboratorio 3D</button>
      </header>
      <div class="guide-block"><h3>Qué es</h3><p>${OVERALL_INFO.what}</p></div>
      <div class="guide-block">
        <h3>Fórmula</h3>
        <div class="formula">índice = Σ (peso<sub>i</sub> × similitud<sub>i</sub>) / Σ peso<sub>i</sub></div>
      </div>
      <div class="guide-block"><h3>Peso de cada parámetro</h3>${rows}<p class="guide-note">${OVERALL_INFO.note}</p></div>
      <div class="guide-block"><h3>Por qué sirve</h3><p>${OVERALL_INFO.why}</p></div>
      ${current}
      <p class="guide-disclaimer">Los valores en pantalla son de demo. Las fuentes de cada parámetro son los datasets que se usarán para los datos reales.</p>`;
  }

  function renderParam(key) {
    const p = activeParams.find((x) => x.key === key);
    const info = PARAM_INFO[key];
    const totalWeight = activeParams.reduce((sum, item) => sum + item.weight, 0);
    const share = (p.weight / totalWeight) * 100;
    const unit = p.unit || '—';

    const sources = Object.entries(info.sources)
      .map(([b, source]) => `<div class="source"><span>${BODY_NAMES[b]}</span>${source}</div>`)
      .join('');

    const result = context?.data.results.find((r) => r.param.key === key);
    const current = result
      ? `<div class="guide-block guide-current">
           <h3>En el punto seleccionado</h3>
           <div class="current-grid">
             <div><span>Tierra</span>${result.earth.toFixed(p.decimals)} ${p.unit}</div>
             <div><span>${context.analogName}</span>${result.analog.toFixed(p.decimals)} ${p.unit}</div>
             <div><span>Similitud</span><strong class="lvl-${level(result.similarity)}">${Math.round(result.similarity * 100)} %</strong></div>
           </div>
           ${result.confidence ? `<p class="guide-note">Confianza de la estimación (demo): Tierra ${Math.round(result.confidence.earth)}% · ${context.analogName} ${Math.round(result.confidence.analog)}%. No forma parte del índice de similitud.</p>` : ''}
         </div>`
      : '';

    return `
      <header class="guide-title">
        <span class="guide-title-icon">${icon(p.icon)}</span>
        <div>
          <h2>${p.label}</h2>
          <span class="guide-tag">unidad: ${unit}</span>
          <span class="guide-tag">peso ×${p.weight} (${share.toFixed(1)}% del índice)</span>
        </div>
        <button class="guide-lab-btn" data-lab="${key}">${icon('cube')} Ver en 3D</button>
      </header>

      <div class="guide-block"><h3>Qué mide</h3><p>${info.what}</p></div>
      <div class="guide-block"><h3>Por qué importa</h3><p>${info.why}</p></div>
      <div class="guide-block"><h3>Ejemplo en la Tierra</h3><p>${info.example}</p></div>
      <div class="guide-block"><h3>Fuentes de datos</h3><div class="sources">${sources}</div></div>

      <div class="guide-block">
        <h3>Cómo se compara</h3>
        <div class="formula">similitud = max(0, 1 − |Tierra − análogo| / ${p.span} ${p.unit})</div>
        <p class="guide-note">Si la diferencia llega a ${p.span} ${p.unit} (el <em>span</em> de este parámetro), la similitud es 0 %.</p>
        ${p.key === 'ice' ? '<p class="guide-note">El índice de potencial y la confianza son conceptos distintos. El simulador compara el índice; la confianza solo comunica cuánta certeza tendría la estimación. Los valores actuales son de demostración.</p>' : ''}
        <div class="simulator">
          <svg class="sim-plot" viewBox="0 0 300 130"></svg>
          <div class="sim-controls">
            <label>Tierra <output data-out="earth"></output>
              <input type="range" data-sim="earth"></label>
            <label>Análogo <output data-out="analog"></output>
              <input type="range" data-sim="analog"></label>
            <div class="sim-calc"></div>
            <div class="hud-bar sim-bar"><div class="hud-fill"></div>
              <span class="hud-label">Similitud</span><span class="hud-big sim-pct"></span></div>
          </div>
        </div>
      </div>
      ${current}`;
  }

  // --- Simulador: mueve los valores y recalcula con la misma función del HUD ---
  function bindSimulator(key) {
    const p = PARAMS.find((x) => x.key === key);
    const ranges = [p.earth, p.mars, p.moon].filter(Boolean);
    const lo = Math.min(...ranges.map((range) => range[0]));
    const hi = Math.max(...ranges.map((range) => range[1]));
    const step = (hi - lo) / 200 || 0.01;
    const mid = ([a, b]) => (a + b) / 2;

    const result = context?.data.results.find((r) => r.param.key === key);
    const start = {
      earth: result ? result.earth : mid(p.earth),
      analog: result ? result.analog : mid(p[context?.analogBody] ?? p.mars ?? p.moon),
    };

    const inputs = {};
    for (const side of ['earth', 'analog']) {
      const input = detail.querySelector(`[data-sim="${side}"]`);
      Object.assign(input, { min: lo, max: hi, step, value: start[side] });
      input.addEventListener('input', update);
      inputs[side] = input;
    }

    const plot = detail.querySelector('.sim-plot');
    const bar = detail.querySelector('.sim-bar');
    const fill = bar.querySelector('.hud-fill');

    // Gráfica: similitud en función de la diferencia (forma de "tienda")
    const range = p.span * 1.5;
    const X = (d) => 20 + ((d + range) / (2 * range)) * 260;
    const Y = (s) => 105 - s * 85;

    function update() {
      const e = Number(inputs.earth.value);
      const a = Number(inputs.analog.value);
      const s = paramSimilarity(e, a, p.span);
      const diff = e - a;
      const d = Math.max(-range, Math.min(range, diff));

      detail.querySelector('[data-out="earth"]').textContent = `${e.toFixed(p.decimals)} ${p.unit}`;
      detail.querySelector('[data-out="analog"]').textContent = `${a.toFixed(p.decimals)} ${p.unit}`;
      detail.querySelector('.sim-calc').textContent =
        `1 − |${e.toFixed(p.decimals)} − ${a.toFixed(p.decimals)}| / ${p.span} = ${(1 - Math.abs(diff) / p.span).toFixed(2)} → ${s.toFixed(2)}`;
      detail.querySelector('.sim-pct').textContent = `${Math.round(s * 100)} %`;
      bar.className = `hud-bar sim-bar hud-${level(s)}`;
      fill.style.width = `${s * 100}%`;

      plot.innerHTML = `
        <line x1="20" y1="105" x2="280" y2="105" class="axis"/>
        <line x1="${X(0)}" y1="15" x2="${X(0)}" y2="105" class="axis dashed"/>
        <polyline class="curve" points="${X(-range)},${Y(0)} ${X(-p.span)},${Y(0)} ${X(0)},${Y(1)} ${X(p.span)},${Y(0)} ${X(range)},${Y(0)}"/>
        <line x1="${X(d)}" y1="105" x2="${X(d)}" y2="${Y(s)}" class="guide-line"/>
        <circle cx="${X(d)}" cy="${Y(s)}" r="5" class="dot lvl-${level(s)}"/>
        <text x="${X(-p.span)}" y="120" text-anchor="middle">−${p.span}</text>
        <text x="${X(0)}" y="120" text-anchor="middle">0</text>
        <text x="${X(p.span)}" y="120" text-anchor="middle">+${p.span}</text>
        <text x="${X(0) + 6}" y="22">100 %</text>
        <text x="280" y="98" text-anchor="end" class="axis-label">diferencia Tierra − análogo</text>`;
    }

    update();
  }

  // --- API ---
  function open(key = 'overall', ctx = context) {
    context = ctx;
    refreshNavigation();
    overlay.hidden = false;
    launcher.hidden = true;
    show(key);
  }

  function close() {
    overlay.hidden = true;
    launcher.hidden = false;
  }

  // El contexto cambia cuando se selecciona o se limpia un punto
  function setContext(ctx) {
    context = ctx;
    refreshNavigation();
    if (!overlay.hidden) show(currentKey ?? 'overall');
  }

  return { open, close, setContext };
}
