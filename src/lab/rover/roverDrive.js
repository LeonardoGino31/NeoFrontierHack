// Modo conducción del laboratorio: entrada WASD, cinemática tipo Ackermann (o giro
// sobre su eje), suspensión que copia el suelo bajo cada rueda y cámara de
// persecución. La escena está en km; el rover se modela en metros y se escala.

import * as THREE from 'three';
import { buildRover, setBeam } from './roverModels.js';

const M = 0.001;                                   // km por metro
const WORLD_LIMIT = 10 - 0.002;                    // muro invisible a 2 m del borde del terreno
const MAX_CLIMB = THREE.MathUtils.degToRad(30);    // pendiente que ningún rover remonta
const RECENTER_KM = 0.04;                          // recentrar el parche de detalle cada 40 m
const INTRO_S = 1.6;                               // duración del vuelo de cámara al desplegar
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = THREE.MathUtils.clamp;
/** Factor de suavizado exponencial independiente de los FPS. */
const smoothK = (rate, dt) => 1 - Math.exp(-rate * dt);

/**
 * Crea el controlador de conducción.
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {THREE.DirectionalLight} o.light  sol del laboratorio (proyecta la sombra del rover)
 * @param {object} o.tile  parche de detalle (createDetailTile)
 * @param {(x:number, z:number)=>number} o.ground  altura del suelo visible (km)
 */
export function createRoverDrive({ scene, camera, controls, light, tile, ground }) {
  const pose = new THREE.Group(); // posición/orientación del chasis; escala m → km
  pose.scale.setScalar(M);
  scene.add(pose);
  scene.add(light.target);
  const sunDir = light.position.clone().normalize();
  const lightHome = light.position.clone();

  let rover = null;
  let saved = null;   // ajustes de cámara previos al despliegue
  let intro = null;   // vuelo de cámara en curso
  let dragging = false;
  const keys = new Set();
  const s = {
    x: 0, z: 0, psi: 0, y: 0, v: 0, vEff: 0, steer: 0, omega: 0,
    pitch: 0, roll: 0, odo: 0, wall: false, steep: false,
  };
  const h = [];    // altura del suelo bajo cada rueda (m)
  const res = [];  // diferencia entre ese suelo y el plano del chasis (m)
  const lookAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // ---------- Entrada ----------
  // Se usa e.code (posición física) para que WASD funcione igual en teclados AZERTY
  const DRIVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
  const isTyping = (el) =>
    el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(el.type)));

  window.addEventListener('keydown', (e) => {
    if (!rover || isTyping(e.target)) return;
    // Sin esto, Espacio "pulsa" el último botón enfocado (p. ej. el del rover)
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyC') snapBehind();
    if (DRIVE_CODES.has(e.code)) keys.add(e.code);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && rover) e.preventDefault();
    keys.delete(e.code);
  }, true);
  // Si la ventana pierde el foco no llega el keyup: el rover seguiría acelerando
  window.addEventListener('blur', () => keys.clear());

  controls.addEventListener('start', () => {
    dragging = true;
    intro = null; // arrastrar durante el vuelo lo cancela y deja la cámara donde está
    if (rover) applyLimits();
  });
  controls.addEventListener('end', () => (dragging = false));

  // ---------- Geometría de la huella ----------
  /** ¿Cabe la huella del rover (rotada psi) dentro del terreno en x, z? */
  function inBounds(x, z, psi) {
    const c = Math.abs(Math.cos(psi)), sn = Math.abs(Math.sin(psi));
    const ex = (c * rover.hl + sn * rover.hw) * M;
    const ez = (sn * rover.hl + c * rover.hw) * M;
    return Math.abs(x) + ex <= WORLD_LIMIT && Math.abs(z) + ez <= WORLD_LIMIT;
  }

  /** Distancia de la cámara de persecución (km), proporcional al tamaño del rover. */
  const chaseDist = () => rover.hl * 2 * 3.2 * M;

  /** Vector cámara − objetivo para quedar detrás y algo por encima del rover. */
  function chaseOffset(out) {
    const d = chaseDist();
    return out.set(-Math.cos(s.psi) * d * 0.9, d * 0.42, Math.sin(s.psi) * d * 0.9);
  }

  function applyLimits() {
    controls.minDistance = Math.max(0.0012, rover.hl * 1.2 * M);
    controls.maxDistance = Math.max(0.04, rover.hl * 30 * M);
  }

  /** Ubica la cámara detrás del rover (tecla C). */
  function snapBehind() {
    intro = null;
    chaseOffset(tmp);
    camera.position.copy(controls.target).add(tmp);
  }

  // ---------- Despliegue ----------
  /**
   * Despliega el rover `id` en x, z (km). Si ya hay uno, lo reemplaza en el mismo
   * lugar y conserva la cámara.
   * @param {number} [psi]  rumbo inicial (rad); por defecto, hacia donde mira la cámara
   */
  function deploy(id, x, z, psi) {
    const swapping = !!rover;
    if (rover) disposeRover();
    rover = buildRover(id);
    pose.add(rover.root);

    if (!swapping) {
      tmp.subVectors(controls.target, camera.position);
      s.psi = psi ?? Math.atan2(-tmp.z, tmp.x);
      const lim = WORLD_LIMIT - 0.01;
      s.x = clamp(x, -lim, lim);
      s.z = clamp(z, -lim, lim);
      s.odo = 0;
      saved = {
        near: camera.near, far: camera.far, minDistance: controls.minDistance, maxDistance: controls.maxDistance,
        enablePan: controls.enablePan, maxPolarAngle: controls.maxPolarAngle,
      };
      // Con el buffer de profundidad logarítmico, 20 cm de near no causa parpadeos a 20 km
      camera.near = 0.0002;
      camera.far = 60;
      camera.updateProjectionMatrix();
      controls.enablePan = false;
      controls.autoRotate = false;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      tile.setActive(true, s.x, s.z);
      intro = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone() };
    } else {
      applyLimits();
      // Misma dirección de cámara, pero a la distancia que corresponde al nuevo tamaño
      if (!intro) {
        tmp.subVectors(camera.position, controls.target).setLength(chaseDist());
        camera.position.copy(controls.target).add(tmp);
      }
    }
    Object.assign(s, { v: 0, vEff: 0, steer: 0, omega: 0 });

    // Sombra ajustada al tamaño del rover: solo él la proyecta y solo el parche la recibe
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const half = Math.max(0.002, rover.hl * 4.5 * M);
    Object.assign(light.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.001, far: 0.1 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -0.0002;
    light.shadow.map?.dispose();
    light.shadow.map = null; // se regenera con el nuevo tamaño

    updatePose(0, true);
  }

  function disposeRover() {
    pose.remove(rover.root);
    rover.root.traverse((o) => {
      if (o.isMesh && o.geometry.parameters?.width !== 1) o.geometry.dispose();
    });
  }

  /**
   * Retira el rover. Devuelve los ajustes de cámara previos para que el
   * laboratorio los restaure al terminar su vuelo de regreso (null si no había rover).
   */
  function undeploy() {
    if (!rover) return null;
    disposeRover();
    rover = null;
    intro = null;
    keys.clear();
    tile.setActive(false);
    light.castShadow = false;
    light.position.copy(lightHome);
    light.target.position.set(0, 0, 0);
    controls.enablePan = saved.enablePan;
    controls.maxPolarAngle = saved.maxPolarAngle;
    const out = saved;
    saved = null;
    return out;
  }

  // ---------- Pose y suspensión ----------
  /**
   * Apoya el chasis sobre el suelo: ajusta un plano (mínimos cuadrados) a la altura
   * bajo cada rueda para el cabeceo y el alabeo, y reparte el resto en la suspensión.
   */
  function updatePose(dt, instant = false) {
    const c = Math.cos(s.psi), sn = Math.sin(s.psi);
    const ws = rover.wheels;
    let h0 = 0;
    for (let i = 0; i < ws.length; i++) {
      const { x: lx, z: lz } = ws[i];
      h[i] = ground(s.x + (lx * c + lz * sn) * M, s.z + (-lx * sn + lz * c) * M) / M;
      h0 += h[i];
    }
    h0 /= ws.length;

    // Ecuaciones normales de h = a + b·lx + c·lz
    let n = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sh = 0, sxh = 0, szh = 0;
    for (let i = 0; i < ws.length; i++) {
      const lx = ws[i].x, lz = ws[i].z, hh = h[i] - h0;
      n++; sx += lx; sz += lz; sxx += lx * lx; szz += lz * lz; sxz += lx * lz;
      sh += hh; sxh += lx * hh; szh += lz * hh;
    }
    const det3 = (a, b, cc, d, e, f, g, hh, i) => a * (e * i - f * hh) - b * (d * i - f * g) + cc * (d * hh - e * g);
    const D = det3(n, sx, sz, sx, sxx, sxz, sz, sxz, szz);
    const A = det3(sh, sx, sz, sxh, sxx, sxz, szh, sxz, szz) / D;
    const B = det3(n, sh, sz, sx, sxh, sxz, sz, szh, szz) / D;
    const C = det3(n, sx, sh, sx, sxx, sxh, sz, sxz, szh) / D;

    const k = instant ? 1 : smoothK(10, dt);
    s.pitch += (Math.atan(B) - s.pitch) * k;
    s.roll += (Math.atan(C) - s.roll) * k;
    s.y += (h0 + A - s.y) * (instant ? 1 : smoothK(18, dt));
    pose.position.set(s.x, s.y * M, s.z);
    // Orden YZX: rumbo, luego cabeceo sobre el eje lateral, luego alabeo sobre el longitudinal
    pose.rotation.set(-s.roll, s.psi, s.pitch, 'YZX');

    for (let i = 0; i < ws.length; i++) res[i] = h[i] - (h0 + A + B * ws[i].x + C * ws[i].z);

    // Rocker-bogie: el balancín copia la rueda delantera y el pivote del bogie;
    // el bogie, la diferencia entre la rueda media y la trasera
    for (const sd of rover.sides) {
      const rB = (res[sd.iM] + res[sd.iR]) / 2;
      const dF = sd.xF - sd.xp, dB = sd.xb - sd.xp;
      const thR = clamp(Math.atan((res[sd.iF] * dF + rB * dB) / (dF * dF + dB * dB)), -0.45, 0.45);
      const thB = clamp(Math.atan((res[sd.iM] - res[sd.iR]) / (sd.xM - sd.xR)) - thR, -0.5, 0.5);
      sd.rocker.rotation.z += (thR - sd.rocker.rotation.z) * k;
      sd.bogie.rotation.z += (thB - sd.bogie.rotation.z) * k;
    }
    // Suspensión independiente (LRV): cada rueda sube o baja dentro de su recorrido
    if (!rover.sides.length) {
      for (let i = 0; i < ws.length; i++) {
        const m = ws[i].mount;
        m.position.y += (ws[i].restY + clamp(res[i], -0.16, 0.16) - m.position.y) * k;
      }
      for (const arm of rover.arms) setBeam(arm.mesh, arm.chassis, tmp.copy(ws[arm.index].mount.position).add(arm.hub));
    }
  }

  // ---------- Ruedas ----------
  /** Orienta las ruedas de esquina (Ackermann o giro en el lugar) y hace rodar todas. */
  function updateWheels(dt, omegaEff, spinTurn) {
    const spec = rover.spec;
    for (const wh of rover.wheels) {
      if (wh.steerable) {
        // La dirección sigue a la intención del conductor, aunque el rover esté quieto
        let ix, iz;
        if (spinTurn) {
          ix = -wh.z; iz = wh.x;
        } else {
          const w = -s.steer * spec.maxCurv;
          ix = 1 + w * wh.z; iz = -w * wh.x;
        }
        let a = Math.atan2(-iz, ix);
        // Una rueda que rueda hacia atrás equivale a girarla 180°: se elige el ángulo menor
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        wh.steer.rotation.y += (a - wh.steer.rotation.y) * smoothK(8, dt);
      }
      const a = wh.steer.rotation.y;
      const vx = s.vEff + omegaEff * wh.z, vz = -omegaEff * wh.x;
      const along = vx * Math.cos(a) - vz * Math.sin(a);
      wh.spin.rotation.z -= (along * dt) / wh.r;
    }
  }

  // ---------- Ciclo ----------
  /** Avanza un cuadro: entrada → movimiento (con muros) → pose → ruedas → cámara y sombra. */
  function update(dt) {
    if (!rover) return;
    const spec = rover.spec;
    controls.autoRotate = false; // el giro automático del laboratorio movería la cámara de persecución

    const thr = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const steerIn = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1;
    s.steer += (steerIn - s.steer) * smoothK(4, dt);
    const spinTurn = spec.turnInPlace && thr === 0 && steerIn !== 0 && Math.abs(s.v) < 0.05;

    // Velocidad: la pendiente a favor de la marcha reduce el máximo hasta frenar en MAX_CLIMB
    const climbF = Math.max(0, s.pitch), climbR = Math.max(0, -s.pitch);
    const vFwd = spec.maxSpeed * boost * clamp(1 - climbF / MAX_CLIMB, 0, 1);
    const vRev = 0.6 * spec.maxSpeed * clamp(1 - climbR / MAX_CLIMB, 0, 1);
    if (thr) s.v += thr * spec.accel * boost * dt;
    else s.v -= Math.sign(s.v) * Math.min(Math.abs(s.v), spec.accel * 0.9 * dt);
    if (keys.has('Space')) s.v -= Math.sign(s.v) * Math.min(Math.abs(s.v), spec.accel * 3 * dt);
    s.v = clamp(s.v, -vRev, vFwd);
    s.steep = (thr > 0 && vFwd < 0.05) || (thr < 0 && vRev < 0.05);

    const omegaGoal = spinTurn ? -steerIn * spec.turnRate : -s.v * s.steer * spec.maxCurv;
    s.omega += (omegaGoal - s.omega) * smoothK(6, dt);

    // Muros invisibles: se prueba el giro y luego cada eje por separado para poder deslizar
    s.wall = false;
    let psi = s.psi + s.omega * dt;
    let omegaEff = s.omega;
    if (!inBounds(s.x, s.z, psi)) {
      psi = s.psi;
      omegaEff = 0;
      s.wall = true;
    }
    const dx = s.v * dt * Math.cos(psi) * M, dz = -s.v * dt * Math.sin(psi) * M;
    let ax = dx, az = dz;
    if (!inBounds(s.x + dx, s.z, psi)) { ax = 0; s.wall = true; }
    if (!inBounds(s.x + ax, s.z + dz, psi)) { az = 0; s.wall = true; }
    const full = Math.hypot(dx, dz);
    s.vEff = full > 0 ? (s.v * Math.hypot(ax, az)) / full : 0;
    const dPsi = psi - s.psi;
    s.x += ax;
    s.z += az;
    s.psi = psi;
    s.odo += Math.abs(s.vEff) * dt;

    if (tile.offset(s.x, s.z) > RECENTER_KM) tile.recenter(s.x, s.z);
    tile.tick(6); // construir el próximo parche sin congelar la conducción
    updatePose(dt);
    updateWheels(dt, omegaEff, spinTurn);

    // Cámara: el objetivo sigue al rover y la cámara se traslada con él (y gira con su rumbo)
    lookAt.set(s.x, s.y * M + rover.hl * 0.45 * M, s.z);
    if (intro) {
      intro.t = Math.min(1, intro.t + dt / INTRO_S);
      const e = easeInOut(intro.t);
      const eT = 1 - (1 - e) ** 3; // el objetivo llega antes que la cámara, así siempre se ve el rover
      controls.target.lerpVectors(intro.fromTarget, lookAt, eT);
      chaseOffset(tmp);
      const from = intro.fromPos.clone().sub(controls.target);
      // Distancia interpolada en escala logarítmica: de km a metros sin "saltar"
      const dist = Math.exp(THREE.MathUtils.lerp(Math.log(from.length()), Math.log(tmp.length()), e));
      camera.position.copy(controls.target).add(from.normalize().lerp(tmp.normalize(), e).normalize().multiplyScalar(dist));
      if (intro.t === 1) {
        intro = null;
        applyLimits();
      }
    } else {
      tmp.subVectors(lookAt, controls.target);
      controls.target.add(tmp);
      camera.position.add(tmp);
      if (!dragging && dPsi) {
        tmp.subVectors(camera.position, controls.target).applyAxisAngle(Y_AXIS, dPsi);
        camera.position.copy(controls.target).add(tmp);
      }
    }
    const floor = ground(camera.position.x, camera.position.z) + Math.max(0.0004, rover.hl * 0.3 * M);
    if (camera.position.y < floor) camera.position.y = floor;

    light.target.position.copy(lookAt);
    light.position.copy(lookAt).addScaledVector(sunDir, 0.05);
  }

  /** Datos para el panel de telemetría (unidades de la interfaz). */
  function telemetry() {
    if (!rover) return null;
    const deg = THREE.MathUtils.radToDeg;
    return {
      name: rover.spec.name, realSpeed: rover.spec.realSpeed,
      speed: s.vEff, heading: (((90 - deg(s.psi)) % 360) + 360) % 360,
      pitch: deg(s.pitch), roll: deg(s.roll), x: s.x, z: s.z, odo: s.odo, wall: s.wall, steep: s.steep,
    };
  }

  return {
    deploy, undeploy, update, telemetry,
    /** Cámara detrás del rover (tecla C o botón de reinicio del control de cámara). */
    snapBehind: () => rover && snapBehind(),
    isActive: () => !!rover,
    id: () => rover?.spec.id ?? null,
    position: () => ({ x: s.x, z: s.z, psi: s.psi }),
    /** El terreno cambió (sliders o preset): regenerar el parche bajo el rover. */
    onTerrainChanged: () => rover && tile.rebuild(),
  };
}
