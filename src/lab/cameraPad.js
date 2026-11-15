// Control circular de la cámara de persecución del rover: un joystick para orbitar y
// botones de zoom y reinicio. Pensado para touchpads de laptop, donde arrastrar para
// orbitar con OrbitControls resulta brusco. Gira alrededor del mismo objetivo que
// OrbitControls. Solo se muestra con un rover desplegado (clase .driving del laboratorio).

import * as THREE from 'three';

const ORBIT_SPEED = 1.6;  // rad/s con el joystick al tope
const TILT_SPEED = 1.0;   // rad/s de inclinación con el joystick al tope
const ZOOM_SPEED = 1.3;   // factor exponencial por segundo con un botón de zoom apretado
const DEAD_ZONE = 0.12;   // fracción del radio en la que el joystick no hace nada
const MIN_POLAR = 0.05;   // no pasar exactamente por encima del objetivo (la vista giraría sola)

/**
 * Crea el control y lo agrega a `parent`.
 * @param {object} o
 * @param {HTMLElement} o.parent  raíz del laboratorio
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {() => void} o.onReset  vuelve a poner la cámara detrás del rover
 * @returns {{ update: (dt: number) => void }}
 */
export function createCameraPad({ parent, camera, controls, onReset }) {
  const el = document.createElement('div');
  el.className = 'lab-campad hud';
  el.innerHTML = `
    <div class="campad-ring" role="slider" aria-label="Orbitar la cámara" title="Arrastra para girar la cámara">
      <span class="campad-arrow up"></span><span class="campad-arrow right"></span>
      <span class="campad-arrow down"></span><span class="campad-arrow left"></span>
      <div class="campad-knob"></div>
    </div>
    <div class="campad-buttons">
      <button data-zoom="1" title="Alejar" aria-label="Alejar">−</button>
      <button class="campad-reset" title="Cámara detrás del rover (C)" aria-label="Cámara detrás del rover">⌂</button>
      <button data-zoom="-1" title="Acercar" aria-label="Acercar">+</button>
    </div>`;
  parent.appendChild(el);

  const ring = el.querySelector('.campad-ring');
  const knob = el.querySelector('.campad-knob');
  const stick = new THREE.Vector2(); // desplazamiento del joystick, cada eje en [-1, 1]
  let stickPointer = null;
  let zoomDir = 0;                   // +1 alejar, −1 acercar, 0 quieto
  let zoomPointer = null;

  // Mientras se usa el control, se avisa a quien escucha a OrbitControls: el laboratorio
  // pausa el giro automático y cancela vuelos; el rover deja de alinear la cámara al rumbo
  const begin = () => controls.dispatchEvent({ type: 'start' });
  const end = () => controls.dispatchEvent({ type: 'end' });

  /** Ubica la perilla según el puntero y guarda el desplazamiento normalizado. */
  function moveStick(e) {
    const rect = ring.getBoundingClientRect();
    const radius = rect.width / 2;
    const v = new THREE.Vector2(e.clientX - rect.left - radius, e.clientY - rect.top - radius);
    const max = radius - knob.offsetWidth / 2;
    v.clampLength(0, max);
    knob.style.transform = `translate(${v.x}px, ${v.y}px)`;
    stick.set(v.x / max, v.y / max);
  }

  ring.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    ring.setPointerCapture(e.pointerId);
    ring.classList.add('active');
    moveStick(e);
    begin();
  });
  ring.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) moveStick(e);
  });
  const releaseStick = (e) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stick.set(0, 0);
    knob.style.transform = '';
    ring.classList.remove('active');
    end();
  };
  ring.addEventListener('pointerup', releaseStick);
  ring.addEventListener('pointercancel', releaseStick);

  // Zoom mantenido: avanza mientras el botón está apretado
  for (const btn of el.querySelectorAll('[data-zoom]')) {
    btn.addEventListener('pointerdown', (e) => {
      zoomPointer = e.pointerId;
      btn.setPointerCapture(e.pointerId);
      zoomDir = Number(btn.dataset.zoom);
      begin();
    });
    const stop = (e) => {
      if (e.pointerId !== zoomPointer) return;
      zoomPointer = null;
      zoomDir = 0;
      end();
    };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
  }
  el.querySelector('.campad-reset').addEventListener('click', onReset);

  // Sin foco en los botones: Espacio (frenar el rover) no debe "pulsarlos"
  el.addEventListener('pointerup', (e) => e.target.closest('button')?.blur());

  const offset = new THREE.Vector3();
  const spherical = new THREE.Spherical();

  /** Aplica el joystick y el zoom del cuadro (llamar antes de `controls.update()`). */
  function update(dt) {
    const sx = Math.abs(stick.x) > DEAD_ZONE ? stick.x : 0;
    const sy = Math.abs(stick.y) > DEAD_ZONE ? stick.y : 0;
    if (!sx && !sy && !zoomDir) return;

    offset.subVectors(camera.position, controls.target);
    spherical.setFromVector3(offset);
    // Mismo sentido que arrastrar con el mouse: derecha gira la escena hacia la derecha,
    // arriba baja la cámara hacia el horizonte
    spherical.theta -= sx * ORBIT_SPEED * dt;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - sy * TILT_SPEED * dt, MIN_POLAR, controls.maxPolarAngle);
    if (zoomDir) {
      spherical.radius = THREE.MathUtils.clamp(
        spherical.radius * Math.exp(zoomDir * ZOOM_SPEED * dt), controls.minDistance, controls.maxDistance
      );
    }
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  }

  return { update };
}
