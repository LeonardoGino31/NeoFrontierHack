// Laboratorio de terreno: un entorno 3D para VER qué significa cada parámetro.
// Genera un terreno procedural de 10 × 10 km y lo colorea según el parámetro elegido.
// Los sliders cambian el terreno en vivo y al pasar el mouse se leen los valores.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { icon } from './icons.js';

// ---------- Ruido procedural (value noise + fBm) ----------
// Hash entero → número pseudoaleatorio en [0, 1). Determinista: mismo terreno siempre.
function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// fBm: suma de varias "octavas" de ruido, cada una más fina y más débil
function fbm(x, y, octaves) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // [0, 1]
}

// ---------- Configuración ----------
const SIZE_KM = 20;     // el terreno mide 20 × 20 km
const SEGMENTS = 240;   // resolución de la malla (~83 m entre vértices)
const CELL_KM = SIZE_KM / SEGMENTS;
const SLOPE_LIMIT = 15; // pendiente máxima típica para aterrizar (°)

// Cráteres fijos: [x, z, radio] en km
const CRATERS = [
  [3.6, -2.4, 2.2], [-4.8, 3.2, 1.4], [-1.2, -5.6, 0.9], [5.6, 5.2, 1.1],
  [-6.4, -4.0, 0.8], [1.5, 6.5, 0.6], [-7.0, 6.8, 1.6], [7.2, -6.8, 0.7], [0.4, 1.2, 0.5],
];

const SLIDERS = [
  { key: 'base',    label: 'Elevación base',        unit: 'm',    min: -4000, max: 5000, step: 50,   dec: 0 },
  { key: 'relief',  label: 'Relieve',               unit: 'km',   min: 0,     max: 2.5,  step: 0.05, dec: 2 },
  { key: 'rough',   label: 'Rugosidad',             unit: '',     min: 0,     max: 1,    step: 0.01, dec: 2 },
  { key: 'craters', label: 'Cráteres',              unit: '',     min: 0,     max: 1,    step: 0.01, dec: 2 },
  { key: 'temp',    label: 'Temperatura en la base', unit: '°C',  min: -120,  max: 40,   step: 1,    dec: 0 },
  { key: 'lapse',   label: 'Gradiente térmico',     unit: '°C/km', min: 0,    max: 10,   step: 0.1,  dec: 1 },
  { key: 'albedo',  label: 'Albedo',                unit: '',     min: 0.05,  max: 0.6,  step: 0.01, dec: 2 },
  { key: 'iron',    label: 'Óxidos de hierro',      unit: '%',    min: 0,     max: 25,   step: 0.5,  dec: 1 },
  { key: 'ice',     label: 'Potencial de hielo',    unit: 'pts',  min: 0,     max: 100,  step: 1,    dec: 0 },
  { key: 'iceConfidence', label: 'Confianza de evidencia', unit: '%', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'landingArea', label: 'Área segura para aterrizar', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'soilStability', label: 'Estabilidad del suelo', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'edlConditions', label: 'Condiciones atmosféricas EDL', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'traverseAccess', label: 'Acceso a objetivos', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
  { key: 'solarEnergy', label: 'Energía solar disponible', unit: 'pts', min: 0, max: 100, step: 1, dec: 0 },
];

// Valores ILUSTRATIVOS para comparar entornos (no son mediciones exactas)
const PRESETS = {
  atacama: { name: 'Atacama · Tierra',      body: 'earth', base: 2500, relief: 0.9, rough: 0.35, craters: 0, temp: 12, lapse: 6.5, albedo: 0.30, iron: 8, ice: 5, iceConfidence: 25, landingArea: 70, soilStability: 50, edlConditions: 60, traverseAccess: 75, solarEnergy: 80 },
  dryval:  { name: 'Valles Secos · Tierra', body: 'earth', base: 800, relief: 1.4, rough: 0.40, craters: 0, temp: -20, lapse: 6.5, albedo: 0.35, iron: 5, ice: 30, iceConfidence: 45, landingArea: 55, soilStability: 55, edlConditions: 60, traverseAccess: 70, solarEnergy: 65 },
  iceland: { name: 'Islandia · Tierra',     body: 'earth', base: 400, relief: 0.6, rough: 0.85, craters: 0, temp: 3, lapse: 6.5, albedo: 0.10, iron: 11, ice: 25, iceConfidence: 40, landingArea: 40, soilStability: 60, edlConditions: 55, traverseAccess: 60, solarEnergy: 55 },
  mars:    { name: 'Llanura · Marte',       body: 'mars', base: -2500, relief: 0.5, rough: 0.30, craters: 0.6, temp: -55, lapse: 2.5, albedo: 0.22, iron: 18, ice: 20, iceConfidence: 35, landingArea: 60, soilStability: 55, edlConditions: 55, traverseAccess: 65, solarEnergy: 50 },
  moon:    { name: 'Mar lunar · Luna',      body: 'moon', base: -2000, relief: 0.3, rough: 0.50, craters: 1, temp: -20, lapse: 0, albedo: 0.08, iron: 18, ice: 55, iceConfidence: 40, landingArea: 60, soilStability: 55, edlConditions: 0, traverseAccess: 65, solarEnergy: 50 },
};

// Modos de visualización: qué color pinta el terreno y qué explica
const MODES = {
  natural: {
    label: 'Vista natural', icon: 'eye',
    caption: 'Vista ilustrativa: albedo y óxidos modifican el color; el potencial de hielo puede resaltar zonas frías. No es un mapa de depósitos reales.',
  },
  elevation: {
    label: 'Elevación', icon: 'mountain', unit: 'm',
    caption: 'Cada color es una altura. Las líneas finas son curvas de nivel cada 250 m: donde se juntan, el terreno sube rápido.',
    stops: ['#2c1e5e', '#3b6fb6', '#3fb8a5', '#b8d86b', '#f3e9b5', '#ffffff'],
  },
  slope: {
    label: 'Pendiente', icon: 'slope', unit: '°',
    caption: `Inclinación del terreno. En verde, zonas aptas para aterrizar; desde ~${SLOPE_LIMIT}° (naranja) el riesgo crece. Pasa el mouse: el anillo muestra si un módulo podría posarse ahí.`,
    stops: ['#3ddc84', '#c6e85a', '#ffc94d', '#ff7a3d', '#d7301f'],
  },
  roughness: {
    label: 'Rugosidad', icon: 'grid', unit: '',
    caption: 'Irregularidad a pequeña escala (rocas, crestas, grietas). Sube el slider de rugosidad: la forma general no cambia, pero el terreno se vuelve más difícil para un rover.',
    stops: ['#0b1d33', '#1f5f8b', '#36b3c9', '#b9f3ff', '#ffffff'],
  },
  temperature: {
    label: 'Temperatura', icon: 'thermo', unit: '°C',
    caption: 'La temperatura baja con la altura según el gradiente térmico (~6.5 °C/km en la Tierra, menor en Marte y nulo en la Luna, que no tiene atmósfera).',
    stops: ['#2b3fd6', '#67a9ff', '#f5f5f5', '#ffb35c', '#d7301f'],
  },
  albedo: {
    label: 'Albedo', icon: 'sun', unit: '',
    caption: 'Fracción de luz que refleja el suelo: oscuro = absorbe (basalto, regolito lunar), claro = refleja (salares, hielo).',
    stops: ['#111111', '#555555', '#aaaaaa', '#f2f2f2'],
  },
  iron: {
    label: 'Óxidos de hierro', icon: 'rock', unit: '%',
    caption: 'Contenido de óxidos de hierro del suelo. El tono rojizo de Marte viene de este hierro oxidado.',
    stops: ['#6b6b6b', '#a98c6c', '#c8692c', '#9e2a12', '#5c120a'],
  },
  ice: {
    label: 'Potencial de hielo', icon: 'ice', unit: 'pts',
    caption: 'Mapa procedural de demostración del potencial relativo de hielo. No indica depósitos observados ni mide su abundancia; la confianza de evidencia se muestra por separado.',
    stops: ['#19223d', '#315e91', '#62b9dc', '#d7f7ff', '#ffffff'],
  },
  landingArea: { label: 'Área libre de obstáculos', icon: 'target', unit: 'pts', caption: 'Índice de demostración: considera rocas, cráteres, dunas y otros obstáculos en la zona de aterrizaje.', stops: ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'] },
  soilStability: { label: 'Estabilidad del suelo', icon: 'grid', unit: 'pts', caption: 'Índice de demostración de firmeza y transitabilidad; el polvo y la arena suelta pueden complicar el movimiento del rover.', stops: ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'] },
  edlConditions: { label: 'Condiciones de descenso (EDL)', icon: 'thermo', unit: 'pts', caption: 'Índice ilustrativo de presión/densidad, viento y polvo durante la entrada, descenso y aterrizaje. Solo aplica a Marte.', stops: ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'] },
  traverseAccess: { label: 'Acceso a objetivos científicos', icon: 'mountain', unit: 'pts', caption: 'Índice ilustrativo de acceso por rutas transitables, considerando pendiente, obstáculos y distancia.', stops: ['#a81824', '#f07839', '#f7cf54', '#b6e66d', '#39cf88'] },
  solarEnergy: { label: 'Energía solar disponible', icon: 'sun', unit: 'pts', caption: 'Índice de demostración de iluminación útil a lo largo del día y las estaciones; su importancia depende de la fuente de energía del rover.', stops: ['#263b75', '#468bd4', '#62cbb9', '#e9df67', '#f4954f'] },
};

// Rango de la leyenda de cada modo
const LEGEND_RANGE = {
  elevation: (d) => [d.minElev, d.maxElev],
  slope: () => [0, 40],
  roughness: () => [0, 1],
  temperature: () => [-100, 50],
  albedo: () => [0, 0.6],
  iron: () => [0, 25],
  ice: () => [0, 100],
  landingArea: () => [0, 100],
  soilStability: () => [0, 100],
  edlConditions: () => [0, 100],
  traverseAccess: () => [0, 100],
  solarEnergy: () => [0, 100],
};

// ---------- Utilidades de color ----------
function makeRamp(hexStops) {
  const cols = hexStops.map((h) => new THREE.Color(h));
  return (t, out) => {
    t = Math.min(1, Math.max(0, t)) * (cols.length - 1);
    const i = Math.min(Math.floor(t), cols.length - 2);
    return out.copy(cols[i]).lerp(cols[i + 1], t - i);
  };
}
const RAMPS = Object.fromEntries(
  Object.entries(MODES).filter(([, m]) => m.stops).map(([k, m]) => [k, makeRamp(m.stops)])
);

// ---------- Módulo ----------
export function createTerrainLab() {
  let renderer, scene, camera, controls, terrain, marker, scanBar, raf = null;
  const CAMERA_HOME = new THREE.Vector3(14, 12, 18);
  let cameraGoal = null;

  // Estado de las animaciones
  const xs = new Float32Array((SEGMENTS + 1) ** 2);
  const morph = { from: new Float32Array((SEGMENTS + 1) ** 2), start: 0, dur: 0, active: false };
  const fade = {
    from: new Float32Array((SEGMENTS + 1) ** 2 * 3), to: new Float32Array((SEGMENTS + 1) ** 2 * 3),
    start: 0, dur: 0, type: 'fade', active: false,
  };
  let built = false;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let mode = 'natural';
  const state = { ...PRESETS.atacama };
  const n = (SEGMENTS + 1) ** 2;

  // Datos por vértice (se recalculan con los sliders)
  const data = {
    hKm: new Float32Array(n), detail: new Float32Array(n), elev: new Float32Array(n), slope: new Float32Array(n),
    rough: new Float32Array(n), temp: new Float32Array(n), albedo: new Float32Array(n),
    iron: new Float32Array(n), ice: new Float32Array(n), iceConfidence: new Float32Array(n), minElev: 0, maxElev: 1,
    landingArea: new Float32Array(n), soilStability: new Float32Array(n), edlConditions: new Float32Array(n),
    traverseAccess: new Float32Array(n), solarEnergy: new Float32Array(n),
  };

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.id = 'terrain-lab';
  root.hidden = true;
  root.innerHTML = `
    <div class="lab-top hud">
      <div class="lab-title">${icon('cube')}<span>Laboratorio de terreno</span><small>20 × 20 km · datos ilustrativos</small></div>
      <div class="lab-presets">${Object.entries(PRESETS)
        .map(([k, p]) => `<button data-preset="${k}">${p.name}</button>`).join('')}</div>
      <button class="lab-toggle" title="Ocultar/mostrar paneles (H)">◧</button>
      <button class="hud-close" title="Cerrar (Esc)">✕</button>
    </div>
    <nav class="lab-modes hud">${Object.entries(MODES)
      .map(([k, m]) => `<button data-mode="${k}">${icon(m.icon)}<span>${m.label}</span></button>`).join('')}</nav>
    <aside class="lab-panel hud">
      <h3 class="lab-mode-title"></h3>
      <p class="lab-caption"></p>
      <div class="lab-legend"></div>
      <h4>Ajustes del terreno</h4>
      <div class="lab-sliders">${SLIDERS.map((s) => `
        <label data-slider="${s.key}">
          <span>${s.label}</span><output></output>
          <input type="range" min="${s.min}" max="${s.max}" step="${s.step}">
        </label>`).join('')}</div>
    </aside>
    <div class="lab-readout hud" hidden></div>`;
  document.body.appendChild(root);

  const launcher = document.createElement('button');
  launcher.id = 'lab-launcher';
  launcher.className = 'floating-launcher';
  launcher.innerHTML = `${icon('cube')}<span>Laboratorio 3D</span>`;
  launcher.addEventListener('click', () => open('natural'));
  document.body.appendChild(launcher);

  const readout = root.querySelector('.lab-readout');

  root.querySelector('.hud-close').addEventListener('click', close);
  root.querySelector('.lab-toggle').addEventListener('click', togglePanels);

  // Ocultar los paneles deja todo el mapa a la vista
  function togglePanels() {
    root.classList.toggle('panels-hidden');
  }
  root.querySelector('.lab-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  root.querySelector('.lab-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    Object.assign(state, PRESETS[b.dataset.preset]);
    syncSliders();
    rebuild(1100); // el terreno se transforma en ~1 s
    root.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('active', x === b));
  });

  // Sliders: los de forma del terreno regeneran la malla; los demás solo recolorean
  const SHAPE_KEYS = ['relief', 'rough', 'craters'];
  root.querySelectorAll('[data-slider]').forEach((label) => {
    const key = label.dataset.slider;
    label.querySelector('input').addEventListener('input', (e) => {
      state[key] = Number(e.target.value);
      updateOutput(label);
      root.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('active'));
      if (SHAPE_KEYS.includes(key)) rebuild(350);
      else { computeAttributes(); paint('fade', 250); }
    });
  });

  function updateOutput(label) {
    const s = SLIDERS.find((x) => x.key === label.dataset.slider);
    if (s.key === 'edlConditions' && state.body === 'moon') {
      label.querySelector('output').textContent = 'No aplica';
      label.querySelector('input').disabled = true;
      return;
    }
    label.querySelector('input').disabled = false;
    label.querySelector('output').textContent = `${state[s.key].toFixed(s.dec)} ${s.unit}`;
  }

  function syncSliders() {
    root.querySelectorAll('[data-slider]').forEach((label) => {
      label.querySelector('input').value = state[label.dataset.slider];
      updateOutput(label);
    });
    const edlMode = root.querySelector('[data-mode="edlConditions"]');
    if (edlMode) edlMode.disabled = state.body === 'moon';
    if (state.body === 'moon' && mode === 'edlConditions') setMode('natural');
  }

  window.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      close();
    } else if (e.key.toLowerCase() === 'h' && e.target.tagName !== 'INPUT') {
      togglePanels();
    }
  }, true);

  // ---------- Escena 3D (se crea la primera vez que se abre) ----------
  function initScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    root.prepend(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1424);
    camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    camera.position.copy(CAMERA_HOME);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48; // no meterse debajo del terreno
    controls.minDistance = 4;
    controls.maxDistance = 60;

    // Giro lento automático; se pausa al interactuar y vuelve tras 6 s quieto
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    let idleTimer = null;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      cameraGoal = null; // si el usuario mueve la cámara, se cancela el vuelo inicial
      clearTimeout(idleTimer);
    });
    controls.addEventListener('end', () => {
      idleTimer = setTimeout(() => (controls.autoRotate = true), 6000);
    });

    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-6, 8, 4);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2a1a, 0.6));

    // Malla del terreno: un plano horizontal subdividido
    const geometry = new THREE.PlaneGeometry(SIZE_KM, SIZE_KM, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false })
    );
    scene.add(terrain);

    // Anillo que marca el punto bajo el mouse (verde = se puede aterrizar)
    marker = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 40),
      new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide, depthTest: false, transparent: true })
    );
    marker.renderOrder = 10;
    marker.visible = false;
    scene.add(marker);

    // Barra de escaneo: barre el terreno al cambiar de modo
    scanBar = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE_KM, 5).rotateY(Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x78dcff, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    scanBar.visible = false;
    scene.add(scanBar);

    // Coordenada x de cada vértice (para el barrido)
    const pos = geometry.attributes.position;
    for (let i = 0; i < n; i++) xs[i] = pos.getX(i);

    // Lectura de valores al pasar el mouse
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(terrain)[0];
      if (!hit) {
        marker.visible = false;
        readout.hidden = true;
        return;
      }
      showReadout(hit);
    });
    renderer.domElement.addEventListener('pointerleave', () => {
      marker.visible = false;
      readout.hidden = true;
    });

    window.addEventListener('resize', resize);
  }

  // ---------- Cálculo del terreno ----------
  let lastDetail = 0; // componente fina del último punto calculado (para la rugosidad)

  function heightAt(x, z) {
    // Forma general (colinas, valles)
    const macro = (fbm(x * 0.22 + 11.3, z * 0.22 - 4.7, 4) - 0.35) * state.relief * 1.6;
    // Detalle fino: aquí actúa la rugosidad
    const detail = (fbm(x * 1.7 + 3.1, z * 1.7 + 8.2, 5) - 0.5) * state.rough * 0.45;
    lastDetail = detail;
    // Cráteres: cuenco + borde elevado
    let crater = 0;
    if (state.craters > 0) {
      for (const [cx, cz, r] of CRATERS) {
        const d = Math.hypot(x - cx, z - cz) / r;
        if (d < 1.6) {
          if (d < 1) crater -= (1 - d * d) * 0.25 * r;
          crater += 0.12 * r * Math.exp(-(((d - 1) / 0.18) ** 2));
        }
      }
      crater *= state.craters;
    }
    return macro + detail + crater; // km respecto a la base
  }

  // Recalcula el terreno objetivo y anima la transición desde el actual
  function rebuild(duration = 0) {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      morph.from[i] = pos.getY(i); // altura que se ve ahora
      data.hKm[i] = heightAt(pos.getX(i), pos.getZ(i));
      data.detail[i] = lastDetail;
    }

    // Pendiente con diferencias finitas sobre la grilla (no depende de la animación)
    const W = SEGMENTS + 1;
    const H = (r, c) => data.hKm[Math.min(W - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
    for (let r = 0; r < W; r++) {
      for (let c = 0; c < W; c++) {
        const gx = (H(r, c + 1) - H(r, c - 1)) / (2 * CELL_KM);
        const gz = (H(r + 1, c) - H(r - 1, c)) / (2 * CELL_KM);
        data.slope[r * W + c] = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(gx, gz)));
      }
    }

    // Rugosidad: desviación estándar del detalle fino en la vecindad 3×3, normalizada.
    // Se usa solo el detalle para que una ladera lisa no cuente como "rugosa".
    for (let r = 0; r < W; r++) {
      for (let c = 0; c < W; c++) {
        let sum = 0, sum2 = 0, k = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= W || cc >= W) continue;
            const h = data.detail[rr * W + cc];
            sum += h; sum2 += h * h; k++;
          }
        }
        const mean = sum / k;
        const std = Math.sqrt(Math.max(0, sum2 / k - mean * mean));
        data.rough[r * W + c] = Math.min(1, std / 0.036);
      }
    }

    // Primera vez: sin animación. Después: morph suave de alturas
    if (!built || duration === 0) {
      applyHeights(1);
      built = true;
    } else {
      Object.assign(morph, { start: performance.now(), dur: duration, active: true });
    }

    computeAttributes();
    paint('fade', duration || 0);
  }

  // Mezcla alturas: t = 0 → anterior, t = 1 → nueva
  function applyHeights(t) {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < n; i++) pos.setY(i, morph.from[i] + (data.hKm[i] - morph.from[i]) * t);
    pos.needsUpdate = true;
    terrain.geometry.computeVertexNormals();
    if (t === 1) terrain.geometry.computeBoundingSphere();
  }

  // Atributos ilustrativos que no cambian la forma del terreno.
  function computeAttributes() {
    const pos = terrain.geometry.attributes.position;
    let minE = Infinity, maxE = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = data.hKm[i];
      const e = state.base + h * 1000;
      data.elev[i] = e;
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      data.temp[i] = state.temp - state.lapse * h;
      const v = fbm(x * 0.6 - 20, z * 0.6 + 7, 3) - 0.5; // variación local
      data.albedo[i] = THREE.MathUtils.clamp(state.albedo + v * 0.08, 0.02, 0.9);
      data.iron[i] = THREE.MathUtils.clamp(state.iron + v * 6, 0, 30);
      const iceVariation = fbm(x * 0.34 + 13, z * 0.34 - 9, 3) - 0.5;
      data.ice[i] = THREE.MathUtils.clamp(state.ice + iceVariation * 60, 0, 100);
      data.iceConfidence[i] = state.iceConfidence;
      data.landingArea[i] = THREE.MathUtils.clamp(state.landingArea + v * 32, 0, 100);
      data.soilStability[i] = THREE.MathUtils.clamp(state.soilStability + v * 28, 0, 100);
      data.edlConditions[i] = state.body === 'moon' ? 0 : THREE.MathUtils.clamp(state.edlConditions + v * 24, 0, 100);
      data.traverseAccess[i] = THREE.MathUtils.clamp(state.traverseAccess + v * 30, 0, 100);
      data.solarEnergy[i] = THREE.MathUtils.clamp(state.solarEnergy + v * 22, 0, 100);
    }
    data.minElev = minE;
    data.maxElev = maxE;

  }

  // ---------- Coloreado ----------
  const rust = new THREE.Color(0x8a3418);
  const dark = new THREE.Color(0x2a2724);
  const light = new THREE.Color(0xe9e2d2);
  const frost = new THREE.Color(0xf4f8ff);

  // type: 'fade' (fundido) o 'sweep' (barrido de escaneo); duration en ms
  function paint(type = 'fade', duration = 0) {
    const col = terrain.geometry.attributes.color;
    fade.from.set(col.array); // colores que se ven ahora
    const c = new THREE.Color();
    const ramp = RAMPS[mode];
    const range = LEGEND_RANGE[mode]?.(data);

    for (let i = 0; i < n; i++) {
      if (mode === 'natural') {
        c.copy(dark).lerp(light, (data.albedo[i] - 0.05) / 0.55);
        c.lerp(rust, (data.iron[i] / 25) * 0.75);
        // Resalte visual didáctico del potencial de hielo (no representa detección).
        if (data.temp[i] < 0 && data.ice[i] > 0) {
          const f = Math.min(1, (-data.temp[i] / 40) * (data.ice[i] / 100));
          c.lerp(frost, f * 0.85);
        }
        // Las paredes muy empinadas se ven más oscuras (roca expuesta)
        c.multiplyScalar(1 - Math.min(0.35, data.slope[i] / 120));
      } else {
        const value = {
          elevation: data.elev, slope: data.slope, roughness: data.rough, temperature: data.temp,
          albedo: data.albedo, iron: data.iron, ice: data.ice,
          landingArea: data.landingArea, soilStability: data.soilStability, edlConditions: data.edlConditions,
          traverseAccess: data.traverseAccess, solarEnergy: data.solarEnergy,
        }[mode][i];
        ramp((value - range[0]) / (range[1] - range[0]), c);
        // Curvas de nivel cada 250 m en el modo elevación
        if (mode === 'elevation') {
          const f = ((data.elev[i] % 250) + 250) % 250;
          if (f < 12) c.multiplyScalar(0.55);
        }
      }
      fade.to[i * 3] = c.r;
      fade.to[i * 3 + 1] = c.g;
      fade.to[i * 3 + 2] = c.b;
    }

    if (duration > 0) {
      Object.assign(fade, { start: performance.now(), dur: duration, type, active: true });
    } else {
      col.array.set(fade.to);
      col.needsUpdate = true;
      fade.active = false;
    }
    renderLegend();
  }

  // ---------- Panel ----------
  function renderLegend() {
    const m = MODES[mode];
    root.querySelector('.lab-mode-title').innerHTML = `${icon(m.icon)}<span>${m.label}</span>`;
    root.querySelector('.lab-caption').textContent = m.caption;
    const legend = root.querySelector('.lab-legend');
    if (!m.stops) {
      legend.innerHTML = '';
      return;
    }
    const [lo, hi] = LEGEND_RANGE[mode](data);
    const dec = Math.abs(hi - lo) < 2 ? 2 : 0;
    const extra = mode === 'slope'
      ? `<div class="lab-threshold" style="left:${(SLOPE_LIMIT / 40) * 100}%"><span>${SLOPE_LIMIT}°</span></div>` : '';
    legend.innerHTML = `
      <div class="lab-gradient" style="background:linear-gradient(90deg, ${m.stops.join(',')})">${extra}</div>
      <div class="lab-legend-labels"><span>${lo.toFixed(dec)} ${m.unit}</span><span>${hi.toFixed(dec)} ${m.unit}</span></div>`;
  }

  function showReadout(hit) {
    // Vértice más cercano al punto tocado
    const face = hit.face;
    const pos = terrain.geometry.attributes.position;
    const p = terrain.worldToLocal(hit.point.clone());
    let best = face.a, bestD = Infinity;
    for (const v of [face.a, face.b, face.c]) {
      const d = (pos.getX(v) - p.x) ** 2 + (pos.getZ(v) - p.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }

    const slope = data.slope[best];
    const safe = slope < SLOPE_LIMIT;

    // Anillo apoyado sobre la superficie, orientado según la normal
    marker.visible = true;
    marker.position.copy(hit.point).addScaledVector(face.normal, 0.02);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
    marker.material.color.set(safe ? 0x3ddc84 : 0xff5a4a);

    const row = (key, label, value) =>
      `<div class="${mode === key ? 'on' : ''}"><span>${label}</span>${value}</div>`;
    readout.innerHTML = `
      ${row('elevation', 'Elevación', `${data.elev[best].toFixed(0)} m`)}
      ${row('slope', 'Pendiente', `${slope.toFixed(1)}°`)}
      ${row('roughness', 'Rugosidad', data.rough[best].toFixed(2))}
      ${row('temperature', 'Temperatura', `${data.temp[best].toFixed(1)} °C`)}
      ${row('albedo', 'Albedo', data.albedo[best].toFixed(2))}
      ${row('iron', 'Óx. de hierro', `${data.iron[best].toFixed(1)} %`)}
      ${row('ice', 'Potencial de hielo (demo)', `${data.ice[best].toFixed(0)} pts`)}
      ${row('ice', 'Confianza (demo)', `${data.iceConfidence[best].toFixed(0)} %`)}
      ${row('landingArea', 'Área libre de obstáculos (demo)', `${data.landingArea[best].toFixed(0)} pts`)}
      ${row('soilStability', 'Estabilidad del suelo (demo)', `${data.soilStability[best].toFixed(0)} pts`)}
      ${row('edlConditions', 'Condiciones EDL (demo)', state.body === 'moon' ? 'No aplica' : `${data.edlConditions[best].toFixed(0)} pts`)}
      ${row('traverseAccess', 'Acceso a objetivos (demo)', `${data.traverseAccess[best].toFixed(0)} pts`)}
      ${row('solarEnergy', 'Energía solar disponible (demo)', `${data.solarEnergy[best].toFixed(0)} pts`)}
      <div class="lab-landing ${safe ? 'ok' : 'risk'}">Aterrizaje: ${safe ? 'APTO' : 'RIESGO'}</div>`;
    readout.hidden = false;
  }

  function setMode(key) {
    if (key === 'edlConditions' && state.body === 'moon') key = 'natural';
    mode = MODES[key] ? key : 'natural';
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (terrain && built) paint('sweep', 1200);

    // Reiniciar la animación de fundido del texto y la leyenda
    for (const el of root.querySelectorAll('.lab-caption, .lab-legend')) {
      el.style.animation = 'none';
      void el.offsetWidth; // fuerza al navegador a "olvidar" la animación anterior
      el.style.animation = '';
    }
  }

  // ---------- Ciclo de vida ----------
  function resize() {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const SWEEP_BAND = 2.5; // ancho (km) de la franja de transición del barrido

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();

    // 1) Morph de alturas
    if (morph.active) {
      const t = Math.min(1, (now - morph.start) / morph.dur);
      applyHeights(easeInOut(t));
      if (t === 1) morph.active = false;
    }

    // 2) Transición de colores
    if (fade.active) {
      const t = Math.min(1, (now - fade.start) / fade.dur);
      const arr = terrain.geometry.attributes.color.array;
      if (fade.type === 'sweep') {
        // Un frente avanza de izquierda a derecha revelando los colores nuevos
        const half = SIZE_KM / 2;
        const front = -half - SWEEP_BAND + (SIZE_KM + 2 * SWEEP_BAND) * easeInOut(t);
        for (let i = 0; i < n; i++) {
          const k = Math.min(1, Math.max(0, (front - xs[i]) / SWEEP_BAND));
          const glow = 1 + 0.6 * Math.max(0, 1 - Math.abs(front - xs[i]) / 0.5);
          for (let j = 0; j < 3; j++) {
            const idx = i * 3 + j;
            arr[idx] = (fade.from[idx] + (fade.to[idx] - fade.from[idx]) * k) * glow;
          }
        }
        scanBar.visible = t < 1;
        scanBar.position.set(front, 1.5, 0);
      } else {
        const k = easeInOut(t);
        for (let idx = 0; idx < arr.length; idx++) arr[idx] = fade.from[idx] + (fade.to[idx] - fade.from[idx]) * k;
      }
      terrain.geometry.attributes.color.needsUpdate = true;
      if (t === 1) {
        fade.active = false;
        scanBar.visible = false;
      }
    }

    // 3) Pulso del anillo de aterrizaje
    if (marker.visible) marker.scale.setScalar(1 + 0.15 * Math.sin(now / 180));

    // 4) Vuelo inicial de la cámara
    if (cameraGoal) {
      camera.position.lerp(cameraGoal, 0.045);
      if (camera.position.distanceTo(cameraGoal) < 0.05) cameraGoal = null;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  // Las claves de la guía coinciden con los modos ('elevation', 'slope', ...)
  function open(key = 'natural') {
    if (!renderer) {
      initScene();
      syncSliders();
      root.querySelector('[data-preset="atacama"]').classList.add('active');
      setMode(key);
      rebuild();
    } else {
      setMode(key);
    }
    root.hidden = false;
    launcher.hidden = true;
    resize();

    // Entrada: la cámara llega volando desde lo alto
    camera.position.set(0, 55, 40);
    controls.target.set(0, 0, 0);
    cameraGoal = CAMERA_HOME.clone();

    if (!raf) loop();
  }

  function close() {
    root.hidden = true;
    launcher.hidden = false;
    readout.hidden = true;
    cancelAnimationFrame(raf); // no gastar GPU mientras está cerrado
    raf = null;
  }

  return { open, close, isOpen: () => !root.hidden };
}
