// Menú de rovers del laboratorio (abajo a la izquierda) y su panel de telemetría.

import { icon } from '../icons.js';
import { ROVERS } from './rover/roverModels.js';

/** HTML del menú: rovers agrupados por cuerpo (deshabilitados hasta que haya terreno) y telemetría. */
export function roverMenuHtml() {
  return `
    <div class="lab-rovers hud">
      <div class="lab-rovers-head">${icon('rover')}<span>Rovers</span></div>
      ${['Marte', 'Luna'].map((body) => `
        <div class="lab-rover-group"><small>${body}</small><div>${Object.entries(ROVERS)
          .filter(([, r]) => r.body === body)
          .map(([k, r]) => `<button data-rover="${k}" disabled
            title="${r.agency} · velocidad real máx. ${r.realSpeed}"><span>${r.name}</span><em>${r.year}</em></button>`)
          .join('')}</div></div>`).join('')}
      <div class="lab-drive" hidden>
        <div class="lab-drive-grid"></div>
        <div class="lab-drive-status"></div>
        <p class="lab-drive-hint">WASD conducir · Shift rápido · Espacio frenar<br>Arrastrar: cámara · C: detrás · Esc: salir</p>
        <button class="lab-rover-exit">Salir del rover</button>
      </div>
    </div>`;
}

/**
 * Escribe la telemetría del rover.
 * @param {HTMLElement} box  contenedor `.lab-drive`
 * @param {object} t  telemetría de roverDrive
 * @param {{ slope: number, elev: number, risky: boolean }} ground  datos del terreno bajo el rover
 */
export function renderDriveTelemetry(box, t, { slope, elev, risky }) {
  const cell = (label, value) => `<div><span>${label}</span>${value}</div>`;
  box.querySelector('.lab-drive-grid').innerHTML = `
    ${cell('Velocidad', `${Math.abs(t.speed).toFixed(2)} m/s`)}
    ${cell('Rumbo', `${t.heading.toFixed(0)}°`)}
    ${cell('Cabeceo', `${t.pitch.toFixed(1)}°`)}
    ${cell('Alabeo', `${t.roll.toFixed(1)}°`)}
    ${cell('Pendiente', `${slope.toFixed(1)}°`)}
    ${cell('Elevación', `${elev.toFixed(0)} m`)}
    ${cell('Recorrido', `${t.odo.toFixed(0)} m`)}
    ${cell('Vel. real máx.', t.realSpeed)}`;
  const status = box.querySelector('.lab-drive-status');
  const [cls, text] = t.wall ? ['risk', 'Límite del terreno']
    : t.steep ? ['risk', 'Pendiente excesiva']
      : risky ? ['risk', 'Terreno: riesgo'] : ['ok', 'Terreno: transitable'];
  status.className = `lab-drive-status lab-landing ${cls}`;
  status.textContent = text;
}
