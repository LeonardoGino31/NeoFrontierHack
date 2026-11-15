// Laboratorio de terreno: un entorno 3D para VER qué significa cada parámetro.
// Muestra un recorte de 20 × 20 km de cada punto del CSV (candidato o análogo terrestre) con
// su modelo de elevación y su imagen orbital reales, y lo colorea según el parámetro elegido.
// Al pasar el mouse se leen los valores.
// Desde el menú de rovers se puede desplegar uno y conducirlo a escala real.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { icon } from '../icons.js';
import { addKeyLayer, isTyping, KEY_PRIORITY } from '../keyboard.js';
import {
  SIZE_KM, SEGMENTS, CELL_KM, SLOPE_LIMIT, SLIDERS, MODES, LEGEND_RANGE, RAMPS, OBSTACLE_M, SKY,
  SITE_VALUES,
} from './config.js';
import { createTerrainField } from './terrainField.js';
import { createTerrainBlock } from './terrainBlock.js';
import { createCameraPad } from './cameraPad.js';
import { roverMenuHtml, renderDriveTelemetry } from './roverPanel.js';
import { createDetailTile, patchCoarseMaterial, sampleGrid } from './rover/detailTile.js';
import { createRoverDrive } from './rover/roverDrive.js';

// ---------- Módulo ----------
/**
 * Crea el laboratorio (oculto). Usa el renderer de la app: al abrirse mueve su canvas
 * dentro del laboratorio y al cerrarse lo devuelve, así no se crea un segundo contexto WebGL.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer  renderer compartido con el globo
 * @param {HTMLElement} o.launcher  botón que abre el laboratorio (se oculta mientras está abierto)
 * @param {() => void} [o.onClose]  se llama al cerrar, con el canvas ya devuelto
 * @param {(active: boolean) => void} [o.onRoverChange]  se llama al desplegar o retirar un rover
 * @param {string} [o.dataUrl]  carpeta con index.json y los recortes de cada punto
 */
export function createTerrainLab({ renderer, launcher, onClose, onRoverChange, dataUrl = '/data/lab' }) {
  let scene, camera, controls, terrain, marker, scanBar, raf = null;
  let canvasHome = null;  // dónde estaba el canvas antes de abrir
  let savedExposure = 1;  // exposición del globo, que usa otra
  const CAMERA_HOME = new THREE.Vector3(14, 12, 18);
  let cameraGoal = null;
  let targetGoal = null;    // a dónde mira la cámara al volver de un rover
  let pendingRestore = null; // ajustes de cámara a restaurar cuando termine ese vuelo
  let tile = null, drive = null;
  let tileDirty = false;    // el parche de detalle espera a que termine el morph del terreno
  let terrainCreated = false; // la superficie ya existe: habilita el menú de rovers
  let lastFrame = 0, lastTelemetry = 0;

  // Estado de las animaciones
  const xs = new Float32Array((SEGMENTS + 1) ** 2);
  const morph = { from: new Float32Array((SEGMENTS + 1) ** 2), start: 0, dur: 0, active: false };
  // Base del bloque (km): se anima junto con las alturas para que las paredes no salten
  const bottom = { from: 0, to: 0, now: 0 };
  let block = null; // paredes y base del terreno (solo estético)
  let pad = null;   // control circular de cámara
  const fade = {
    from: new Float32Array((SEGMENTS + 1) ** 2 * 3), to: new Float32Array((SEGMENTS + 1) ** 2 * 3),
    start: 0, dur: 0, type: 'fade', active: false,
  };
  let built = false;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  let mode = 'natural';
  const state = { exag: 1 };
  const n = (SEGMENTS + 1) ** 2;

  // Puntos disponibles (index.json) y el que se ve
  let sites = [];
  let indexPromise = null;
  let site = null;       // entrada del índice del punto actual
  let image = null;      // { texture, pixels, w, h, mean: THREE.Color } del punto actual
  let shownImage = null; // imagen puesta como textura de la malla (vista natural)
  let loadToken = 0;     // descarta cargas que terminan después de elegir otro punto

  // Datos por vértice (se recalculan al cambiar de punto)
  const data = {
    hKm: new Float32Array(n), local: new Float32Array(n),
    elev: new Float32Array(n), slope: new Float32Array(n),
    hazard: new Float32Array(n), aspect: new Float32Array(n), sun: new Float32Array(n), albedo: new Float32Array(n),
    soilStability: new Float32Array(n), ice: new Float32Array(n), iceConfidence: new Float32Array(n),
    image: new Float32Array(n * 3), // color de la imagen en cada vértice (sRGB lineal)
    minElev: 0, maxElev: 1, meanM: 0,
  };

  /** Texto del CSV listo para insertar en HTML. */
  const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.id = 'terrain-lab';
  root.hidden = true;
  root.innerHTML = `
    <div class="lab-top hud">
      <div class="lab-title">${icon('cube')}<span>Laboratorio de terreno</span><small>20 × 20 km · relieve e imagen reales</small></div>
      <div class="lab-site-name"></div>
      <button class="lab-toggle" title="Ocultar/mostrar paneles (H)">◧</button>
      <button class="hud-close" title="Cerrar (Esc)">✕</button>
    </div>
    <div class="lab-left">
      <nav class="lab-modes hud">${Object.entries(MODES)
        .map(([k, m]) => `<button data-mode="${k}">${icon(m.icon)}<span>${m.label}</span></button>`).join('')}</nav>
      ${roverMenuHtml()}
    </div>
    <aside class="lab-panel hud">
      <h3 class="lab-mode-title"></h3>
      <p class="lab-caption"></p>
      <div class="lab-legend"></div>
      <h4>Punto</h4>
      <select class="lab-site" aria-label="Punto a mostrar"></select>
      <button class="lab-partner" hidden></button>
      <dl class="lab-values"></dl>
      <p class="lab-sources"></p>
      <h4>Vista</h4>
      <div class="lab-sliders">${SLIDERS.map((s) => `
        <label data-slider="${s.key}">
          <span>${s.label}</span><output></output>
          <input type="range" min="${s.min}" max="${s.max}" step="${s.step}">
        </label>`).join('')}</div>
    </aside>
    <div class="lab-readout hud" hidden></div>`;
  document.body.appendChild(root);


  const readout = root.querySelector('.lab-readout');
  const roverMenu = root.querySelector('.lab-rovers');
  const driveBox = root.querySelector('.lab-drive');

  roverMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rover]');
    if (b && !b.disabled) deployRover(b.dataset.rover);
    if (e.target.closest('.lab-rover-exit')) exitRover();
    // Sin foco, Espacio (frenar) no vuelve a "pulsar" el botón
    e.target.closest('button')?.blur();
  });

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
  const siteSelect = root.querySelector('.lab-site');
  const partnerBtn = root.querySelector('.lab-partner');
  siteSelect.addEventListener('change', () => loadSite(siteSelect.value));
  partnerBtn.addEventListener('click', () => site?.partner && loadSite(site.partner));

  // La exageración solo cambia el dibujo: las lecturas siguen usando las alturas reales
  root.querySelectorAll('[data-slider]').forEach((label) => {
    const key = label.dataset.slider;
    label.querySelector('input').addEventListener('input', (e) => {
      state[key] = Number(e.target.value);
      updateOutput(label);
      if (site) rebuild(350, false);
    });
  });

  function updateOutput(label) {
    const s = SLIDERS.find((x) => x.key === label.dataset.slider);
    label.querySelector('output').textContent = `${state[s.key].toFixed(s.dec)} ${s.unit}`;
  }

  function syncSliders() {
    root.querySelectorAll('[data-slider]').forEach((label) => {
      label.querySelector('input').value = state[label.dataset.slider];
      updateOutput(label);
    });
  }

  addKeyLayer({
    priority: KEY_PRIORITY.lab,
    isActive: () => !root.hidden,
    onKeyDown(e) {
      if (e.key === 'Escape') {
        // Primero se baja del rover; un segundo Esc cierra el laboratorio
        if (drive?.isActive()) exitRover();
        else close();
      } else if (e.key.toLowerCase() === 'h' && !isTyping(e.target)) {
        togglePanels();
      }
    },
  });

  // ---------- Escena 3D (se crea la primera vez que se abre) ----------
  function initScene() {
    // El renderer viene de la app con profundidad logarítmica (con un rover de 3 m y un
    // terreno de 20 km a la vista, la lineal haría parpadear la superficie lejana) y sombras
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

    // Paredes con estratos y base: el relieve se ve como un bloque recortado y no como una lámina
    block = createTerrainBlock({ sizeKm: SIZE_KM, segments: SEGMENTS });
    scene.add(block.group);

    // Parche de detalle y modo conducción (el parche solo se ve con un rover desplegado)
    tile = createDetailTile({ scene, detailHeight, coarseHeight: coarseHeightAt, coarseColor });
    patchCoarseMaterial(terrain.material, tile.uTile);
    drive = createRoverDrive({ scene, camera, controls, light: sun, tile, ground: groundHeight });

    // Control circular de la cámara del rover (útil con touchpad); visible solo conduciendo
    pad = createCameraPad({ parent: root, camera, controls, onReset: () => drive.snapBehind() });

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
      // El canvas es compartido: cerrado, el laboratorio no lee el mouse.
      // Conduciendo, la lectura sale en la telemetría.
      if (root.hidden || drive.isActive()) return;
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

    window.addEventListener('resize', () => {
      if (!root.hidden) resize();
    });
  }

  // ---------- Cálculo del terreno ----------
  const field = createTerrainField();
  /** Altura real más microrrelieve (km, ya exagerada), para el parche de detalle. */
  const detailHeight = (x, z) => (field.heightKm(x, z) + field.microKm(x, z)) * state.exag;

  const W_GRID = SEGMENTS + 1;
  const clampKm = (v) => Math.min(SIZE_KM / 2, Math.max(-SIZE_KM / 2, v));

  /** Altura (km) de la malla gruesa tal como se ve ahora (incluido un morph en curso). */
  function coarseHeightAt(x, z) {
    const arr = terrain.geometry.attributes.position.array;
    return sampleGrid((i) => arr[i * 3 + 1], W_GRID, CELL_KM, -SIZE_KM / 2, -SIZE_KM / 2, clampKm(x), clampKm(z));
  }

  /** Color actual del suelo en x, z (para pintar el parche del rover con el mismo modo). */
  function coarseColor(x, z, out) {
    // Con la imagen como textura los vértices son blancos: el color sale de la imagen
    if (terrain.material.map && shownImage) return imageColor(shownImage, x, z, out);
    const arr = terrain.geometry.attributes.color.array;
    const at = (ch) => sampleGrid((i) => arr[i * 3 + ch], W_GRID, CELL_KM, -SIZE_KM / 2, -SIZE_KM / 2, clampKm(x), clampKm(z));
    return out.setRGB(at(0), at(1), at(2));
  }

  /** Color de la imagen `img` en x, z (km), interpolado, en sRGB lineal. */
  function imageColor(img, x, z, out) {
    const fx = Math.min(img.w - 1.001, Math.max(0, ((x + SIZE_KM / 2) / SIZE_KM) * img.w - 0.5));
    const fy = Math.min(img.h - 1.001, Math.max(0, ((z + SIZE_KM / 2) / SIZE_KM) * img.h - 0.5));
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const px = img.pixels, w = img.w;
    const ch = (k) => {
      const i00 = (iy * w + ix) * 4 + k, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
      return ((px[i00] * (1 - u) + px[i10] * u) * (1 - v) + (px[i01] * (1 - u) + px[i11] * u) * v) / 255;
    };
    return out.setRGB(ch(0), ch(1), ch(2), THREE.SRGBColorSpace);
  }

  /** Suelo sobre el que apoya el rover: el parche si cubre el punto, si no la malla gruesa. */
  function groundHeight(x, z) {
    return tile.heightAt(x, z) ?? coarseHeightAt(x, z);
  }

  /** Índice del vértice de la malla gruesa más cercano a x, z. */
  function nearestVertex(x, z) {
    const c = Math.round((clampKm(x) + SIZE_KM / 2) / CELL_KM);
    const r = Math.round((clampKm(z) + SIZE_KM / 2) / CELL_KM);
    return r * W_GRID + c;
  }

  // ---------- Datos de cada punto ----------
  /** Descarga el índice de puntos (una sola vez) y arma el selector. */
  function loadIndex() {
    indexPromise ??= fetch(`${dataUrl}/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((index) => {
        sites = index.sites;
        renderSiteOptions();
        return sites;
      });
    return indexPromise;
  }

  const BODY_GROUPS = [
    ['moon', 'Luna · candidatos'], ['mars', 'Marte · candidatos'], ['earth', 'Tierra · análogos'],
  ];

  /** Nombre corto del punto para el selector y la barra superior. */
  function siteLabel(s) {
    return s.body === 'earth' ? `${s.name}${s.region ? `, ${s.region}` : ''}` : s.name;
  }

  function renderSiteOptions() {
    siteSelect.innerHTML = BODY_GROUPS.map(([body, label]) => {
      const options = sites.filter((s) => s.body === body)
        .map((s) => `<option value="${s.key}">${escapeHtml(siteLabel(s))}</option>`).join('');
      return options ? `<optgroup label="${label}">${options}</optgroup>` : '';
    }).join('');
  }

  /** Busca un punto por cuerpo e id del CSV. */
  function findSite(ref) {
    if (!ref) return null;
    return sites.find((s) => s.key === ref || (s.body === ref.body && s.id === ref.id)) ?? null;
  }

  /** Descarga la imagen del recorte y lee sus píxeles (hacen falta para el albedo y el rover). */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const pixels = g.getImageData(0, 0, img.width, img.height).data;
        const texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        let r = 0, gr = 0, b = 0;
        for (let i = 0; i < pixels.length; i += 4) { r += pixels[i]; gr += pixels[i + 1]; b += pixels[i + 2]; }
        const k = pixels.length / 4 * 255;
        resolve({ texture, pixels, w: img.width, h: img.height,
          mean: new THREE.Color().setRGB(r / k, gr / k, b / k, THREE.SRGBColorSpace) });
      };
      img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      img.src = url;
    });
  }

  /** Carga el punto `ref` (clave del índice o { body, id }) y transforma el terreno hacia él. */
  async function loadSite(ref) {
    const token = ++loadToken;
    await loadIndex();
    const next = findSite(ref) ?? site ?? sites[0];
    if (!next) return;
    root.classList.add('loading');
    try {
      const [heights, img] = await Promise.all([
        fetch(`${dataUrl}/${next.key}.bin`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        }),
        loadImage(`${dataUrl}/${next.key}.jpg`),
      ]);
      if (token !== loadToken) return; // el usuario ya eligió otro punto
      const q = new Uint16Array(heights);
      const meters = new Float32Array(q.length);
      const span = next.maxM - next.minM;
      let sum = 0;
      for (let i = 0; i < q.length; i++) { meters[i] = next.minM + (q[i] / 65535) * span; sum += meters[i]; }
      const mean = sum / q.length;
      const km = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) km[i] = (meters[i] - mean) / 1000;
      field.setGrid({ w: Math.round(Math.sqrt(q.length)), km });
      data.meanM = mean;
      if (image && image !== shownImage) image.texture.dispose();
      image = img;
      site = next;
      showSiteInfo();
      rebuild(built ? 1100 : 0); // el terreno se transforma en ~1 s
    } catch (err) {
      console.error(err);
      root.querySelector('.lab-sources').textContent = `No se pudo cargar el punto: ${err.message}`;
    } finally {
      if (token === loadToken) root.classList.remove('loading');
    }
  }

  /** Barra superior, selector, botón de pareja, valores medidos y fuentes del punto actual. */
  function showSiteInfo() {
    const fmt = (v, dec) => (v === null || v === undefined ? 'sin dato' : Number(v).toFixed(dec));
    const lat = `${Math.abs(site.lat).toFixed(2)}° ${site.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(site.lon).toFixed(2)}° ${site.lon >= 0 ? 'E' : 'O'}`;
    const bodyName = { earth: 'Tierra', moon: 'Luna', mars: 'Marte' }[site.body];
    root.querySelector('.lab-site-name').innerHTML =
      `<span>${escapeHtml(siteLabel(site))}</span><small>${bodyName} · ${lat}, ${lon}</small>`;
    siteSelect.value = site.key;

    const partner = sites.find((s) => s.key === site.partner);
    partnerBtn.hidden = !partner;
    if (partner) {
      partnerBtn.textContent = site.body === 'earth'
        ? `Ver el candidato en ${{ moon: 'la Luna', mars: 'Marte' }[partner.body]}`
        : `Ver su análogo en la Tierra: ${partner.name}`;
    }

    const values = site.values ?? {};
    root.querySelector('.lab-values').innerHTML = SITE_VALUES.map((v) =>
      `<dt>${v.label}</dt><dd>${fmt(values[v.key], v.dec)}${values[v.key] == null ? '' : ` ${v.unit}`}</dd>`).join('');
    root.querySelector('.lab-sources').innerHTML =
      `Valores del punto en un recorte de ${site.body === 'moon' || partner?.body === 'moon' ? '5' : '20'} km
       (planetary_candidates.csv). Relieve: ${escapeHtml(site.demDataset)}. Imagen: ${escapeHtml(site.imageDataset)}.`;

    scene.background.setHex(SKY[site.body] ?? SKY.earth);
  }

  // Recalcula el terreno objetivo y anima la transición desde el actual.
  // `full` = false: solo cambió la exageración (las alturas reales y los colores no cambian)
  function rebuild(duration = 0, full = true) {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      morph.from[i] = pos.getY(i); // altura que se ve ahora
      if (full) data.hKm[i] = field.heightKm(pos.getX(i), pos.getZ(i));
    }

    if (full) {
      // Pendiente con diferencias finitas sobre la grilla (alturas reales, sin exagerar)
      const W = SEGMENTS + 1;
      const H = (r, c) => data.hKm[Math.min(W - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
      for (let r = 0; r < W; r++) {
        for (let c = 0; c < W; c++) {
          const gx = (H(r, c + 1) - H(r, c - 1)) / (2 * CELL_KM);
          const gz = (H(r + 1, c) - H(r - 1, c)) / (2 * CELL_KM);
          data.slope[r * W + c] = THREE.MathUtils.radToDeg(Math.atan(Math.hypot(gx, gz)));
          // Ladera hacia el ecuador: el sol pasa por ese lado del cielo (+z es el sur)
          data.aspect[r * W + c] = site.lat >= 0 ? -gz : gz;
        }
      }

      // Desnivel local 3 × 3: la misma regla que mide "libre de obstáculos" en el pipeline
      for (let r = 0; r < W; r++) {
        for (let c = 0; c < W; c++) {
          let lo = Infinity, hi = -Infinity;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const h = H(r + dr, c + dc);
              lo = Math.min(lo, h);
              hi = Math.max(hi, h);
            }
          }
          data.local[r * W + c] = (hi - lo) * 1000;
        }
      }

      // Color de la imagen en cada vértice: para el albedo y las transiciones de la vista natural
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        imageColor(image, pos.getX(i), pos.getZ(i), c);
        data.image[i * 3] = c.r;
        data.image[i * 3 + 1] = c.g;
        data.image[i * 3 + 2] = c.b;
      }
    }

    // La base queda un espesor fijo bajo el punto más bajo del relieve nuevo
    let minH = Infinity;
    for (let i = 0; i < n; i++) minH = Math.min(minH, data.hKm[i] * state.exag);
    bottom.from = built ? bottom.now : minH - block.depthKm;
    bottom.to = minH - block.depthKm;
    block.setTint(image.mean);

    // Primera vez: sin animación. Después: morph suave de alturas
    if (!built || duration === 0) {
      applyHeights(1);
      built = true;
    } else {
      Object.assign(morph, { start: performance.now(), dur: duration, active: true });
    }

    if (full) {
      computeAttributes();
      paint('fade', duration || 0);
    }

    if (!terrainCreated) {
      terrainCreated = true;
      root.querySelectorAll('[data-rover]').forEach((b) => (b.disabled = false));
    }
    // Con un rover en el terreno, el parche se regenera cuando el morph termina
    if (drive?.isActive()) {
      if (morph.active) tileDirty = true;
      else drive.onTerrainChanged();
    }
  }

  // Mezcla alturas: t = 0 → anterior, t = 1 → nueva (exagerada)
  function applyHeights(t) {
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      pos.setY(i, morph.from[i] + (data.hKm[i] * state.exag - morph.from[i]) * t);
    }
    pos.needsUpdate = true;
    bottom.now = bottom.from + (bottom.to - bottom.from) * t;
    block.update(pos.array, 3, bottom.now);
    terrain.geometry.computeVertexNormals();
    if (t === 1) terrain.geometry.computeBoundingSphere();
  }

  /**
   * Reparte un valor medido en el recorte: `shape` da la forma y el promedio queda igual
   * al valor del punto (salvo lo que recorta el rango).
   */
  function distribute(out, value, shape, lo, hi) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += shape[i];
    mean /= n;
    for (let i = 0; i < n; i++) out[i] = THREE.MathUtils.clamp(value + shape[i] - mean, lo, hi);
  }

  // Atributos por vértice. Elevación, pendiente y obstáculos salen del modelo de elevación;
  // los demás solo tienen un valor por punto y se reparten según el relieve o la imagen.
  const shape = new Float32Array(n);
  function computeAttributes() {
    const v = site.values ?? {};
    let minE = Infinity, maxE = -Infinity, sumH = 0, sumLum = 0;
    for (let i = 0; i < n; i++) sumH += data.hKm[i];
    const meanH = sumH / n;
    const lum = (i) => 0.2126 * data.image[i * 3] + 0.7152 * data.image[i * 3 + 1] + 0.0722 * data.image[i * 3 + 2];
    for (let i = 0; i < n; i++) sumLum += lum(i);
    const meanLum = sumLum / n || 1;

    for (let i = 0; i < n; i++) {
      const e = data.meanM + data.hKm[i] * 1000;
      data.elev[i] = e;
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      data.hazard[i] = Math.min(1, data.local[i] / (2 * OBSTACLE_M)); // ≥ 0.5 = obstáculo
      // Albedo: proporcional al brillo de la imagen, con el promedio medido
      data.albedo[i] = THREE.MathUtils.clamp((v.albedo ?? 0.2) * (lum(i) / meanLum), 0.02, 0.9);
    }

    // Luz solar: las partes altas y las laderas al ecuador ven más sol
    for (let i = 0; i < n; i++) shape[i] = (data.hKm[i] - meanH) * 45 + data.aspect[i] * 60;
    distribute(data.sun, v.sunlight ?? 50, shape, 0, 100);
    // Suelo: menos firme en laderas empinadas y terreno abrupto
    for (let i = 0; i < n; i++) shape[i] = -data.slope[i] * 1.2 - data.hazard[i] * 20;
    distribute(data.soilStability, v.soil_stability ?? 50, shape, 0, 100);
    // Hielo: más potencial donde hay menos sol (trampas frías)
    for (let i = 0; i < n; i++) shape[i] = -data.sun[i] * 0.8;
    distribute(data.ice, v.ice ?? 0, shape, 0, 100);
    data.iceConfidence.fill(v.ice_confidence ?? 0);

    data.minElev = minE;
    data.maxElev = maxE;
  }

  // ---------- Coloreado ----------
  /** Curvas de nivel: unas 8 en el desnivel del recorte, con un paso "redondo". */
  function contourStep() {
    const span = Math.max(1, data.maxElev - data.minElev) / 8;
    const p = 10 ** Math.floor(Math.log10(span));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= span);
  }

  /** Quita la imagen de la malla y deja su color en los vértices (para animar desde ahí). */
  function unbakeImage() {
    if (!terrain.material.map) return;
    const col = terrain.geometry.attributes.color;
    const c = new THREE.Color();
    const pos = terrain.geometry.attributes.position;
    for (let i = 0; i < n; i++) {
      imageColor(shownImage, pos.getX(i), pos.getZ(i), c);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    terrain.material.map = null;
    terrain.material.needsUpdate = true;
    if (shownImage !== image) shownImage.texture.dispose();
    shownImage = null;
  }

  /** Pone la imagen del punto como textura: a 20–40 m/px se ve mucho más que en los vértices. */
  function bakeImage() {
    const col = terrain.geometry.attributes.color;
    col.array.fill(1);
    col.needsUpdate = true;
    terrain.material.map = image.texture;
    terrain.material.needsUpdate = true;
    shownImage = image;
    if (drive?.isActive()) tile.repaint();
  }

  // type: 'fade' (fundido) o 'sweep' (barrido de escaneo); duration en ms
  function paint(type = 'fade', duration = 0) {
    unbakeImage(); // las transiciones se animan con los colores de los vértices
    const col = terrain.geometry.attributes.color;
    fade.from.set(col.array); // colores que se ven ahora
    const c = new THREE.Color();
    const ramp = RAMPS[mode];
    const range = LEGEND_RANGE[mode]?.(data);
    const step = contourStep();

    for (let i = 0; i < n; i++) {
      if (mode === 'natural') {
        c.setRGB(data.image[i * 3], data.image[i * 3 + 1], data.image[i * 3 + 2]);
      } else {
        const value = {
          elevation: data.elev, slope: data.slope, hazards: data.hazard, soilStability: data.soilStability,
          sunlight: data.sun, albedo: data.albedo, ice: data.ice,
        }[mode][i];
        ramp((value - range[0]) / (range[1] - range[0]), c);
        if (mode === 'elevation') {
          const f = (((data.elev[i] - data.minElev) % step) + step) % step;
          if (f < step * 0.05) c.multiplyScalar(0.55);
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
      finishPaint();
    }
    renderLegend();
  }

  /** Al terminar una transición: en la vista natural entra la imagen a resolución completa. */
  function finishPaint() {
    if (mode === 'natural') bakeImage();
    else if (drive?.isActive()) tile.repaint();
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
    const obstacle = data.hazard[best] >= 0.5;
    const safe = slope < SLOPE_LIMIT && !obstacle;

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
      ${row('hazards', 'Desnivel local', `${data.local[best].toFixed(0)} m · ${obstacle ? 'obstáculo' : 'libre'}`)}
      ${row('soilStability', 'Estabilidad del suelo (repartida)', `${data.soilStability[best].toFixed(0)} pts`)}
      ${row('sunlight', 'Luz solar (repartida)', `${data.sun[best].toFixed(0)} %`)}
      ${row('albedo', 'Albedo (según imagen)', data.albedo[best].toFixed(2))}
      ${row('ice', 'Potencial de hielo (repartido)', `${data.ice[best].toFixed(0)} pts`)}
      ${row('ice', 'Confianza del punto', `${data.iceConfidence[best].toFixed(0)} %`)}
      <div class="lab-landing ${safe ? 'ok' : 'risk'}">Aterrizaje: ${safe ? 'APTO' : 'RIESGO'}</div>`;
    readout.hidden = false;
  }

  function setMode(key) {
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
    if (!scene) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  const SWEEP_BAND = 2.5; // ancho (km) de la franja de transición del barrido

  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    // Tope de 50 ms: tras una pestaña en segundo plano, el rover no "salta" metros
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;

    // 1) Morph de alturas
    if (morph.active) {
      const t = Math.min(1, (now - morph.start) / morph.dur);
      applyHeights(easeInOut(t));
      if (t === 1) {
        morph.active = false;
        if (tileDirty) {
          tileDirty = false;
          drive.onTerrainChanged();
        }
      }
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
        finishPaint();
      }
    }

    // 3) Pulso del anillo de aterrizaje
    if (marker.visible) marker.scale.setScalar(1 + 0.15 * Math.sin(now / 180));

    // 4) Vuelo de la cámara (entrada al laboratorio o regreso desde un rover)
    if (cameraGoal) {
      camera.position.lerp(cameraGoal, 0.045);
      if (targetGoal) controls.target.lerp(targetGoal, 0.06);
      if (camera.position.distanceTo(cameraGoal) < 0.05) finishFlight();
    }

    // Si el usuario tomó la cámara durante el regreso, los límites se restauran
    // cuando ya no la harían saltar
    if (pendingRestore && !cameraGoal && !drive.isActive()
      && camera.position.distanceTo(controls.target) >= pendingRestore.minDistance) finishFlight();

    // 5) Rover
    if (drive.isActive()) {
      drive.update(dt);
      if (now - lastTelemetry > 100) {
        lastTelemetry = now;
        renderTelemetry();
      }
    }

    // 6) Control circular: después del rover, que mueve el objetivo de la cámara
    if (drive.isActive()) pad.update(dt);

    controls.update();
    renderer.render(scene, camera);
  }

  /**
   * Abre el laboratorio. La guía pasa el campo `lab` de cada parámetro ('elevation', 'slope', ...);
   * `siteRef` ({ body, id } del CSV) elige el punto, por ejemplo el seleccionado en el globo.
   */
  function open(key = 'natural', siteRef = null) {
    if (!scene) {
      initScene();
      syncSliders();
    }
    setMode(key);
    const wanted = findSite(siteRef);
    if (!site || (wanted && wanted !== site)) loadSite(siteRef);
    root.hidden = false;
    launcher.hidden = true;
    // Tomar prestado el canvas de la app (se devuelve en close)
    canvasHome = { parent: renderer.domElement.parentNode, next: renderer.domElement.nextSibling };
    root.prepend(renderer.domElement);
    savedExposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1;
    controls.enabled = true;
    resize();

    // Entrada: la cámara llega volando desde lo alto
    camera.position.set(0, 55, 40);
    controls.target.set(0, 0, 0);
    cameraGoal = CAMERA_HOME.clone();

    if (!raf) loop();
  }

  function close() {
    if (drive?.isActive()) exitRover(true);
    root.hidden = true;
    launcher.hidden = false;
    readout.hidden = true;
    cancelAnimationFrame(raf); // no gastar GPU mientras está cerrado
    raf = null;
    // OrbitControls sigue escuchando el canvas compartido: deshabilitado no reacciona
    controls.enabled = false;
    renderer.toneMappingExposure = savedExposure;
    canvasHome.parent.insertBefore(renderer.domElement, canvasHome.next);
    onClose?.();
  }

  // ---------- Rovers ----------
  /** Punto de despliegue: el más llano y libre cerca del centro de la vista. */
  function spawnPoint() {
    const tx = clampKm(controls.target.x), tz = clampKm(controls.target.z);
    const c0 = Math.round((tx + SIZE_KM / 2) / CELL_KM), r0 = Math.round((tz + SIZE_KM / 2) / CELL_KM);
    let best = { x: tx, z: tz }, bestScore = Infinity;
    for (let dr = -6; dr <= 6; dr++) {
      for (let dc = -6; dc <= 6; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 2 || c < 2 || r > SEGMENTS - 2 || c > SEGMENTS - 2) continue;
        const i = r * W_GRID + c;
        // Se prefiere lo llano y sin obstáculos, sin alejarse mucho de lo que se está mirando
        const score = data.slope[i] + data.hazard[i] * 30 + Math.hypot(dr, dc) * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = { x: c * CELL_KM - SIZE_KM / 2, z: r * CELL_KM - SIZE_KM / 2 };
        }
      }
    }
    return best;
  }

  /** Despliega (o cambia) el rover `id` y muestra la telemetría. */
  function deployRover(id) {
    if (!terrainCreated) return;
    if (drive.isActive()) {
      const p = drive.position();
      drive.deploy(id, p.x, p.z, p.psi);
    } else {
      cameraGoal = null;
      targetGoal = null;
      if (pendingRestore) finishFlight(); // se interrumpió un regreso: partir de ajustes limpios
      const p = spawnPoint();
      drive.deploy(id, p.x, p.z);
      marker.visible = false;
      readout.hidden = true;
    }
    root.classList.add('driving');
    root.querySelectorAll('[data-rover]').forEach((b) => b.classList.toggle('active', b.dataset.rover === id));
    driveBox.hidden = false;
    renderTelemetry();
    onRoverChange?.(true);
  }

  /**
   * Retira el rover. La cámara vuelve volando a la vista general y recién al llegar
   * se restauran sus límites (si se restauraran antes, OrbitControls la haría saltar).
   * @param {boolean} [instant]  restaurar sin vuelo (al cerrar el laboratorio)
   */
  function exitRover(instant = false) {
    const savedCam = drive.undeploy();
    root.classList.remove('driving');
    root.querySelectorAll('[data-rover]').forEach((b) => b.classList.remove('active'));
    driveBox.hidden = true;
    onRoverChange?.(false);
    if (!savedCam) return;
    pendingRestore = savedCam;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    if (instant) {
      finishFlight();
      return;
    }
    // Primero sube sobre el rover, así el vuelo no atraviesa el relieve
    camera.position.y += 0.3;
    cameraGoal = CAMERA_HOME.clone();
    targetGoal = new THREE.Vector3(0, 0, 0);
  }

  /** Cierra el vuelo de cámara en curso y aplica los ajustes pendientes. */
  function finishFlight() {
    cameraGoal = null;
    targetGoal = null;
    if (!pendingRestore) return;
    const { near, far, ...limits } = pendingRestore;
    Object.assign(controls, limits);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    pendingRestore = null;
  }

  /** Refresca el panel de telemetría del rover (unas 10 veces por segundo). */
  function renderTelemetry() {
    const t = drive.telemetry();
    if (!t) return;
    const i = nearestVertex(t.x, t.z);
    renderDriveTelemetry(driveBox, t, {
      slope: data.slope[i], elev: data.elev[i], risky: data.slope[i] >= SLOPE_LIMIT || data.hazard[i] >= 0.5,
    });
  }

  return { open, close, isOpen: () => !root.hidden };
}
