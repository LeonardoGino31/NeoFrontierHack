// Resultados de la búsqueda global de análogos (public/data/earth_candidates.json, generado
// con `python -m pipeline search`). Para cada objetivo de la Luna o Marte muestra las
// celdas de la Tierra con los números más parecidos, en una lista y como puntos en el globo.

import * as THREE from 'three';
import { icon } from './icons.js';

const DATA_URL = '/data/earth_candidates.json';
const BODY_NAMES = { mars: 'Marte', moon: 'Luna' };
const CANDIDATE_COLOR = 0x22d3ee;
const BEST_COLOR = 0xfacc15;

/** Descarga los resultados; null si todavía no se ejecutó la búsqueda. */
async function loadCandidates() {
  try {
    const response = await fetch(DATA_URL);
    return response.ok ? await response.json() : null;
  } catch {
    // El servidor de desarrollo puede devolver index.html en lugar de un 404
    return null;
  }
}

/** Formatea un número con la unidad del parámetro del modelo. */
function formatValue(param, value) {
  if (value == null) return '—';
  return `${Number(value).toFixed(param?.decimals ?? 0)} ${param?.unit ?? ''}`.trim();
}

/**
 * Crea el panel (oculto) y su botón de apertura.
 * @param {{ model: object, earthMesh: THREE.Mesh, latLonToVector3: Function,
 *           formatLatLon: Function, onOpen: Function, focus: (lat: number, lon: number) => void }} deps
 */
export async function createDiscoveryPanel({ model, earthMesh, latLonToVector3, formatLatLon, onOpen, focus }) {
  const data = await loadCandidates();
  if (!data?.targets?.length) return { close() {} };

  const params = Object.fromEntries(model.parameters.map((p) => [p.key, p]));
  const markers = new THREE.Group();
  markers.visible = false;
  earthMesh.add(markers);
  const markerGeometry = new THREE.SphereGeometry(0.014, 12, 12);

  const launcher = document.createElement('button');
  launcher.id = 'discovery-launcher';
  launcher.title = 'Análogos encontrados en la Tierra';
  launcher.innerHTML = icon('target');
  document.body.appendChild(launcher);

  const panel = document.createElement('section');
  panel.id = 'discovery-panel';
  panel.className = 'hud';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="hud-header">
      <span>Análogos encontrados</span>
      <button class="hud-close" title="Cerrar">✕</button>
    </div>
    <label class="disc-pick">Objetivo
      <select>${['moon', 'mars'].map((body) => `
        <optgroup label="${BODY_NAMES[body]}">${data.targets
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.body === body)
          .map(({ t, i }) => `<option value="${i}">${t.name}</option>`).join('')}
        </optgroup>`).join('')}
      </select>
    </label>
    <div class="disc-body"></div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector('.disc-body');
  const select = panel.querySelector('select');

  /** Dibuja el objetivo elegido: sus valores, sus candidatos y el puesto de los análogos conocidos. */
  function render() {
    const target = data.targets[Number(select.value)];
    const req = target.requirement;
    const used = target.parametersUsed.map((k) => params[k]?.label ?? k).join(', ');
    const values = Object.entries(target.targetValues)
      .filter(([k]) => params[k])
      .map(([k, v]) => `<span>${params[k].label}: <b>${formatValue(params[k], v)}</b></span>`).join('');

    body.innerHTML = `
      <p class="disc-origin">${target.origin}</p>
      <p class="disc-coords">${BODY_NAMES[target.body]} · ${formatLatLon(target)}
        ${req?.value != null ? `· <b class="${req.pass ? 'lvl-high' : 'lvl-low'}">${req.pass ? 'cumple' : 'no cumple'} el requisito</b>` : ''}</p>
      <div class="disc-values">${values}</div>
      <p class="disc-note">Comparado con: ${used}.</p>
      ${target.knownAnalogs.length ? `<h4>Análogos conocidos</h4>${target.knownAnalogs.map((a) => `
        <button class="disc-row disc-known" data-lat="${a.lat}" data-lon="${a.lon}">
          <span>${a.name}</span>
          <span>${a.rank ? `puesto ${a.rank.toLocaleString('es')} · top ${a.topPct} %` : 'sin dato'}</span>
        </button>`).join('')}` : ''}
      <h4>Mejores candidatos en la Tierra</h4>
      ${target.candidates.map((c, i) => `
        <button class="disc-row" data-lat="${c.lat}" data-lon="${c.lon}" title="${Object.entries(c.values)
          .map(([k, v]) => `${params[k]?.label ?? k}: ${formatValue(params[k], v)}`).join(' · ')}">
          <span>${i + 1}. ${formatLatLon(c)}</span>
          <span class="disc-score">${(c.score * 100).toFixed(1)} %</span>
        </button>`).join('')}`;

    markers.clear();
    target.candidates.forEach((c, i) => {
      const marker = new THREE.Mesh(markerGeometry,
        new THREE.MeshBasicMaterial({ color: i === 0 ? BEST_COLOR : CANDIDATE_COLOR }));
      marker.position.copy(latLonToVector3(c.lat, c.lon, 1.02));
      if (i === 0) marker.scale.setScalar(1.6);
      markers.add(marker);
    });
    const best = target.candidates[0];
    if (best) focus(best.lat, best.lon);
  }

  select.addEventListener('change', render);
  body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-lat]');
    if (row) focus(Number(row.dataset.lat), Number(row.dataset.lon));
  });
  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('.hud-close').addEventListener('click', close);

  /** Abre el panel y muestra los candidatos del objetivo elegido. */
  function open() {
    onOpen();
    panel.hidden = false;
    markers.visible = true;
    render();
  }

  /** Cierra el panel y quita los puntos del globo. */
  function close() {
    panel.hidden = true;
    markers.visible = false;
  }

  return { close };
}
