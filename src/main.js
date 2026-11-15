// Escena principal: globo con la Tierra, Marte y la Luna, selección de sitios y modo
// comparación. Arranca así: las descargas (datos y texturas) empiezan de inmediato y la
// pantalla de inicio se dibuja; mientras tanto se crea el contexto WebGL (~1 s en
// algunas GPU); los shaders se compilan en paralelo y las texturas se suben de a una
// por cuadro; recién entonces se habilita "Iniciar".

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createSimilarityPanel } from './similarityPanel.js';
import { createParamGuide } from './paramGuide.js';
import { loadPlanetaryData } from './planetaryData.js';
import { loadParameterModel } from './parameterModel.js';
import { createComparePanel } from './comparePanel.js';
import { createStartScreen } from './startScreen.js';
import { icon } from './icons.js';
import { setMusicScene, unlockOnGesture } from './audio.js';
import { createHudControls } from './hudControls.js';
import { createMapsView } from './mapsView.js';
import { addKeyLayer, isTyping, KEY_PRIORITY } from './keyboard.js';
import { createStarfield, createSky } from './globe/background.js';
import { BODIES, STARTUP_TEXTURE_COUNT, createBodies, loadBodyTextures, upgradeHiRes } from './globe/bodies.js';
import { ANALOG_TARGETS, createMarkers, latLonToVector3 } from './globe/markers.js';
import { uploadGradually } from './globe/textures.js';

// ---------- Escena, cámara y renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050816);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const CAMERA_HOME = new THREE.Vector3(0, 0, 3);
camera.position.copy(CAMERA_HOME);

// Renderer y controles: se crean en boot(), cuando las descargas ya están en marcha
let renderer = null;
let controls = null;

/**
 * Crea el único renderer de la app (el laboratorio 3D lo toma prestado al abrirse).
 * La profundidad logarítmica y las sombras las necesita el modo rover del laboratorio.
 */
function createRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cuidar la GPU integrada
  // Tone mapping: comprime las luces fuertes como una cámara real (menos aspecto "plástico")
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Al principio del body: así queda detrás de los paneles, como antes
  document.body.prepend(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  setupPointer(renderer.domElement);
}

const sunlight = new THREE.DirectionalLight(0xffffff, 3);
sunlight.position.set(5, 3, 5);
scene.add(sunlight, new THREE.AmbientLight(0xffffff, 0.25));

const stars = createStarfield();
scene.add(stars);

// "Ranuras" del carrusel: el seleccionado va al centro, los otros a los lados
const SLOTS = {
  center: { position: new THREE.Vector3(0, 0, 0), scale: 1 },
  left: { position: new THREE.Vector3(-2.6, 0.2, -1), scale: 0.3 },
  right: { position: new THREE.Vector3(2.6, 0.2, -1), scale: 0.3 },
  hidden: { position: new THREE.Vector3(0, 0, -10), scale: 0.001 },
};

// ---------- Estado ----------
// Se completan en boot(), cuando llegan los datos y las texturas
let meshes = null;       // bodyKey -> mesh
let clouds = null;
let psrOverlay = null;
let sky = null;
let markers = null;
let similarityPanel = null;
let comparePanel = null;
let paramGuide = null;

let currentBody = null;  // cuerpo en el centro del carrusel
let compareBody = null;  // 'mars' | 'moon' | null: modo comparación
let cameraGoal = null;   // posición a la que la cámara vuelve suavemente
let selectedMarker = null;

const sunDirView = { value: new THREE.Vector3(0, 0, 1) }; // sol en espacio de cámara (luces nocturnas)
const infoPanel = document.getElementById('info');
const compareLabels = document.getElementById('compare-labels');
const bodySwitch = document.getElementById('label-right');

// ---------- Música según la pantalla ----------
let started = false;      // ya se pulsó EMPEZAR
let roverActive = false;  // hay un rover desplegado en el laboratorio

/** Elige la música que corresponde a lo que se ve: inicio, laboratorio, comparación o cuerpo en el centro. */
function updateMusic() {
  if (!started) setMusicScene('intro');
  else if (isLabOpen()) setMusicScene(roverActive ? 'rover' : 'lab');
  else if (compareBody) setMusicScene('compare');
  else setMusicScene(currentBody ?? 'earth');
}
const mapsView = createMapsView();
unlockOnGesture();
createHudControls();
setMusicScene('intro');

// ---------- Laboratorio 3D (se descarga recién al abrirlo) ----------
const labLauncher = document.createElement('button');
labLauncher.id = 'lab-launcher';
labLauncher.title = 'Laboratorio 3D';
labLauncher.setAttribute('aria-label', 'Abrir laboratorio 3D');
labLauncher.innerHTML = icon('cube');
document.body.appendChild(labLauncher);

let lab = null;
let labModule = null;
const isLabOpen = () => lab?.isOpen() ?? false;
// Se empieza a descargar en cuanto el usuario apunta al botón: el clic llega con el módulo listo
const prefetchLab = () => (labModule ??= import('./lab/terrainLab.js'));
labLauncher.addEventListener('pointerenter', prefetchLab);
labLauncher.addEventListener('focus', prefetchLab);
labLauncher.addEventListener('click', () => openLab('natural'));

/** Abre el laboratorio en el modo `key`, creándolo la primera vez. */
async function openLab(key) {
  if (!lab) {
    const { createTerrainLab } = await prefetchLab();
    lab ??= createTerrainLab({
      renderer,
      launcher: labLauncher,
      onClose: () => {
        controls.enabled = true;
        roverActive = false;
        onResize(); // la ventana pudo cambiar de tamaño mientras estaba abierto
        updateMusic();
      },
      onRoverChange: (active) => {
        roverActive = active;
        updateMusic();
      },
    });
  }
  controls.enabled = false; // comparten el canvas: los controles del globo no deben reaccionar
  lab.open(key);
  updateMusic();
}

// ---------- Arranque ----------
const startScreen = createStartScreen({
  // Se elige cualquier punto de la Tierra: todos tienen un análogo en la Luna o en Marte
  onStart: () => {
    started = true;
    updateMusic();
    const all = markers.earthMarkers.children;
    if (all.length) selectEarthPoint(all[Math.floor(Math.random() * all.length)]);
  },
});

// Las descargas empiezan ya, antes de crear el contexto WebGL (que bloquea un rato)
// Pasos con progreso: cada textura, los datos, la compilación y la subida a la GPU
const PROGRESS_STEPS = STARTUP_TEXTURE_COUNT + 3;
let progressDone = 0;
const step = () => startScreen.setProgress(++progressDone / PROGRESS_STEPS);
const dataReady = loadParameterModel()
  .then(async (model) => ({ model, ...(await loadPlanetaryData(model)) }))
  .finally(step);
const texturesReady = loadBodyTextures(step);

boot().catch((error) => {
  console.error(error);
  startScreen.fail('No se pudieron cargar los datos. Recarga la página para reintentar.');
});

/** Crea el renderer, arma la escena y la deja lista antes de habilitar "Iniciar". */
async function boot() {
  // Esperar a que la pantalla de inicio se dibuje antes de crear el contexto WebGL
  // (setTimeout dentro de rAF corre después del dibujado de ese cuadro, no antes)
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  createRenderer();

  const [{ model, pairs }, tex] = await Promise.all([dataReady, texturesReady]);

  ({ meshes, clouds, psrOverlay } = createBodies(tex, {
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    sunDirView,
  }));
  for (const mesh of Object.values(meshes)) scene.add(mesh);
  if (tex.sky) {
    sky = createSky(tex.sky);
    scene.add(sky);
  }
  markers = createMarkers({ meshes, pairs, model });
  createPanels(model);

  // La app arranca en la Tierra, que es donde están los puntos, ya en su lugar (sin animación)
  setBody('earth');
  for (const mesh of Object.values(meshes)) {
    mesh.position.copy(mesh.userData.targetPosition);
    mesh.scale.setScalar(mesh.userData.targetScale);
  }

  // Los shaders se compilan en paralelo (KHR_parallel_shader_compile) en lugar de
  // bloquear el primer cuadro, incluidos los objetos ocultos (marcadores, capa PSR).
  // La subida va después: hecha a la vez, el driver la encola detrás de la compilación
  // y el hilo principal queda bloqueado en lugar de libre.
  await renderer.compileAsync(scene, camera);
  step();
  await uploadGradually(renderer, Object.values(tex).filter(Boolean));
  step();

  renderer.setAnimationLoop(animate);
  startScreen.ready();

  // Mosaicos de 4096 px de Marte y la Luna, en segundo plano
  upgradeHiRes(renderer, meshes);
}

/** Paneles HUD, guía y selector de cuerpo (necesitan el modelo de parámetros). */
function createPanels(model) {
  comparePanel = createComparePanel({
    formatLatLon,
    onOpenMaps: (earth, origin) => mapsView.open(
      { name: earth.name, subtitle: `${earth.region} · ${formatLatLon(earth)}`, lat: earth.lat, lon: earth.lon },
      origin.x, origin.y,
    ),
  });
  paramGuide = createParamGuide({
    model,
    onOpenLab: (key) => {
      paramGuide.close();
      openLab(key); // abre el laboratorio en el modo de ese parámetro
    },
  });
  similarityPanel = createSimilarityPanel({
    onClose: () => clearSelection(),
    onHelp: (key) => paramGuide.open(key), // abre la guía en ese parámetro
    onNav: (dir) => stepEarthPoint(dir),
  });

  // Selector Marte | Luna sobre la mitad derecha
  bodySwitch.classList.add('body-switch');
  bodySwitch.innerHTML = ANALOG_TARGETS
    .map((key) => `<button data-body="${key}">${BODIES[key].name}</button>`)
    .join('');
  bodySwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-body]');
    if (btn) switchAnalogBody(btn.dataset.body);
  });
}

// ---------- Disposición del carrusel y del modo comparación ----------
/** Posición y tamaño para que cada cuerpo ocupe su mitad de pantalla al comparar. */
function getCompareLayout() {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAMERA_HOME.z;
  const halfW = halfH * camera.aspect;
  const x = halfW / 2; // centro de cada mitad
  const scale = Math.min(0.95, x * 0.8, halfH * 0.75);
  return { x, scale };
}

/** Asigna a cada cuerpo su destino según el modo actual (el bucle lo lleva suavemente). */
function applyLayout() {
  let assignment;
  if (compareBody) {
    const { x, scale } = getCompareLayout();
    assignment = {};
    for (const key of Object.keys(BODIES)) {
      if (key === 'earth') assignment[key] = { position: new THREE.Vector3(-x, 0, 0), scale };
      else if (key === compareBody) assignment[key] = { position: new THREE.Vector3(x, 0, 0), scale };
      else assignment[key] = SLOTS.hidden;
    }
  } else {
    const others = Object.keys(BODIES).filter((k) => k !== currentBody);
    assignment = { [currentBody]: SLOTS.center, [others[0]]: SLOTS.left, [others[1]]: SLOTS.right };
  }
  for (const [key, slot] of Object.entries(assignment)) {
    meshes[key].userData.targetPosition.copy(slot.position);
    meshes[key].userData.targetScale = slot.scale;
  }
}

/** Lleva un cuerpo al centro y reparte los demás a los lados. */
function setBody(bodyKey) {
  if (!BODIES[bodyKey] || bodyKey === currentBody) return;
  currentBody = bodyKey;
  // Los puntos solo existen cuando la Tierra está en el centro
  markers.earthMarkers.visible = currentBody === 'earth';
  if (currentBody !== 'earth') clearSelection();
  updatePsrVisibility();
  applyLayout();
  controls.target.set(0, 0, 0);
  updateMusic();
}

/** Muestra la capa PSR solo cuando la Luna está en primer plano. */
function updatePsrVisibility() {
  const moonInFocus = compareBody ? compareBody === 'moon' : currentBody === 'moon';
  psrOverlay.visible = psrOverlay.userData.available && moonInFocus;
}

// ---------- Selección ----------
function formatLatLon({ lat, lon }) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/** Ángulo destino que gira por el camino más corto. */
function shortestAngleTarget(current, desired) {
  const TWO_PI = Math.PI * 2;
  let diff = (desired - current) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return current + diff;
}

/** Sale de la selección y del modo comparación. */
function clearSelection() {
  if (selectedMarker) {
    markers.highlight(selectedMarker, false);
    selectedMarker = null;
  }
  for (const group of Object.values(markers.analogMarkers)) group.visible = false;
  for (const mesh of Object.values(meshes)) {
    mesh.userData.targetRotationY = null;
    mesh.userData.targetRotationX = 0;
  }
  infoPanel.hidden = true;
  compareLabels.hidden = true;
  similarityPanel.hide();
  comparePanel.hide();
  controls.enableRotate = true;
  paramGuide.setContext(null);

  if (compareBody) {
    compareBody = null;
    applyLayout();
  }
  updatePsrVisibility();
  updateMusic();
}

/**
 * Gira un cuerpo para que un punto (en coordenadas locales) mire hacia la cámara.
 * @param {number} bodyX  posición horizontal donde quedará el cuerpo
 */
function faceTowardCamera(mesh, localPos, bodyX) {
  const pointAngle = Math.atan2(localPos.x, localPos.z);
  const cameraAngle = Math.atan2(CAMERA_HOME.x - bodyX, CAMERA_HOME.z);
  mesh.userData.targetRotationY = shortestAngleTarget(mesh.rotation.y, cameraAngle - pointAngle);
}

/** Entra al modo comparación con el punto de la Tierra `marker` y su análogo. */
function selectEarthPoint(marker) {
  clearSelection();
  selectedMarker = marker;
  markers.highlight(marker, true);

  const { earthPoint, analog } = marker.userData;
  const localPos = latLonToVector3(analog.lat, analog.lon, 1);
  const group = markers.analogMarkers[analog.body];
  group.position.copy(localPos);
  group.visible = true;

  // Tierra a la izquierda, análogo a la derecha. OrbitControls movería la cámara (y
  // ambos cuerpos a la vez): aquí se arrastra cada cuerpo por separado.
  compareBody = analog.body;
  controls.enableRotate = false;
  applyLayout();
  cameraGoal = CAMERA_HOME.clone();
  controls.target.set(0, 0, 0);

  // Girar ambos cuerpos para que sus puntos queden de frente, e inclinarlos hacia su latitud:
  // sin la inclinación, sitios polares como Shackleton o McMurdo quedarían en el borde del disco
  const { x } = getCompareLayout();
  faceTowardCamera(meshes.earth, marker.position, -x);
  faceTowardCamera(meshes[analog.body], localPos, x);
  meshes.earth.userData.targetRotationX = THREE.MathUtils.degToRad(earthPoint.lat);
  meshes[analog.body].userData.targetRotationX = THREE.MathUtils.degToRad(analog.lat);

  for (const btn of bodySwitch.querySelectorAll('[data-body]')) {
    btn.classList.toggle('active', btn.dataset.body === analog.body);
  }
  compareLabels.hidden = false;

  const siblings = markers.markersFor(analog.body);
  similarityPanel.show({
    earthPoint,
    analogPoint: analog,
    analogName: BODIES[analog.body].name,
    formatLatLon,
    data: marker.userData.similarity,
    nav: { index: siblings.indexOf(marker), total: siblings.length },
  });
  comparePanel.show(earthPoint, analog.site);
  updatePsrVisibility();

  // La guía también muestra los valores de este punto
  paramGuide.setContext({ analogName: BODIES[analog.body].name, analogBody: analog.body, data: marker.userData.similarity });
  updateMusic();
}

/** Pasa al punto anterior (−1) o siguiente (+1) entre los del cuerpo análogo actual. */
function stepEarthPoint(dir) {
  if (!selectedMarker) return;
  const list = markers.markersFor(selectedMarker.userData.analog.body);
  const i = list.indexOf(selectedMarker);
  selectEarthPoint(list[(i + dir + list.length) % list.length]);
}

/** Cambia el análogo a otro cuerpo, saltando al primer punto de la Tierra emparejado con él. */
function switchAnalogBody(body) {
  if (!selectedMarker || selectedMarker.userData.analog.body === body) return;
  const [first] = markers.markersFor(body);
  if (first) selectEarthPoint(first);
}

// ---------- Teclado ----------
infoPanel.addEventListener('click', (event) => {
  if (event.target.closest('.close-compare')) clearSelection();
});

addKeyLayer({
  priority: KEY_PRIORITY.globe,
  isActive: () => !!meshes,
  onKeyDown(event) {
    if (event.key === 'Escape') clearSelection();
    if (isTyping(event.target)) return;
    if (event.key === 'ArrowLeft') stepEarthPoint(-1);
    if (event.key === 'ArrowRight') stepEarthPoint(1);
  },
});

// ---------- Mouse: clic, arrastre y cursor ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerDown = new THREE.Vector2();

/** Convierte la posición del mouse a coordenadas normalizadas (-1 a 1). */
function updatePointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

/**
 * Un solo raycast para todo lo que hay bajo el mouse: el marcador de la Tierra (si no
 * está detrás del planeta) y el cuerpo. Los marcadores son hijos de la Tierra.
 */
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const targets = Object.values(meshes);
  if (markers.earthMarkers.visible) targets.push(...markers.earthMarkers.children);
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return { marker: null, bodyKey: null };
  const isMarker = !hit.object.userData.bodyKey;
  return { marker: isMarker ? hit.object : null, bodyKey: isMarker ? 'earth' : hit.object.userData.bodyKey };
}

// En el modo comparación cada cuerpo se gira por separado arrastrándolo
const DRAG_SPEED = 0.008; // radianes por píxel
const MAX_TILT = THREE.MathUtils.degToRad(85);
let dragBody = null;
const dragLast = new THREE.Vector2();
// El canvas lo comparte el laboratorio: mientras está abierto, el globo no escucha
const globeActive = () => meshes && !isLabOpen();

/** Clic, arrastre y cursor sobre el canvas del globo. */
function setupPointer(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    if (!globeActive()) return;
    pointerDown.set(event.clientX, event.clientY);
    if (!compareBody) return;
    updatePointer(event);
    const { bodyKey } = pick();
    if (bodyKey === 'earth' || bodyKey === compareBody) {
      dragBody = bodyKey;
      dragLast.set(event.clientX, event.clientY);
      canvas.setPointerCapture(event.pointerId);
    }
  });

  /** Acumula el arrastre sobre el objetivo de rotación; el bucle lo sigue con suavizado. */
  function dragRotate(event) {
    const data = meshes[dragBody].userData;
    const dx = event.clientX - dragLast.x;
    const dy = event.clientY - dragLast.y;
    dragLast.set(event.clientX, event.clientY);
    data.targetRotationY = (data.targetRotationY ?? meshes[dragBody].rotation.y) + dx * DRAG_SPEED;
    data.targetRotationX = THREE.MathUtils.clamp((data.targetRotationX ?? 0) + dy * DRAG_SPEED, -MAX_TILT, MAX_TILT);
  }

  window.addEventListener('pointerup', () => {
    dragBody = null;
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!globeActive()) return;
    // Si el mouse se movió mucho, fue un arrastre de OrbitControls, no un clic
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
    updatePointer(event);
    const { marker, bodyKey } = pick();
    if (marker) {
      selectEarthPoint(marker);
      return;
    }
    // En el modo comparación un clic en un cuerpo no lo cambia: ahí se usa para arrastrar
    if (bodyKey && !compareBody) setBody(bodyKey);
  });

  // Cursor de "mano" sobre puntos, cuerpos laterales y cuerpos arrastrables
  canvas.addEventListener('pointermove', (event) => {
    if (!globeActive()) return;
    if (dragBody) {
      dragRotate(event);
      canvas.style.cursor = 'grabbing';
      return;
    }
    updatePointer(event);
    const { marker, bodyKey } = pick();
    const overSideBody = bodyKey && bodyKey !== currentBody && !compareBody;
    const overDraggable = compareBody && (bodyKey === 'earth' || bodyKey === compareBody);
    canvas.style.cursor = marker || overSideBody ? 'pointer' : overDraggable ? 'grab' : 'default';
  });
}

// ---------- Animación ----------
const timer = new THREE.Timer();
timer.connect(document); // al volver de otra pestaña no llega un delta gigante

/** Un cuadro del globo (setAnimationLoop; no dibuja mientras el laboratorio está abierto). */
function animate(timestamp) {
  if (isLabOpen()) return;
  timer.update(timestamp);
  // Tope de 0,1 s: al cerrar el laboratorio el primer delta abarca todo el tiempo que estuvo abierto
  const delta = Math.min(timer.getDelta(), 0.1);

  // Suavizado independiente de los FPS: avanza ~6% del camino por cuadro a 60 fps
  const t = 1 - Math.exp(-4 * delta);

  for (const mesh of Object.values(meshes)) {
    mesh.position.lerp(mesh.userData.targetPosition, t);
    mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, mesh.userData.targetScale, t));
    // Si hay un análogo seleccionado, el cuerpo gira hasta mostrarlo; si no, rota solo
    if (mesh.userData.targetRotationY != null) {
      mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, mesh.userData.targetRotationY, t);
    } else {
      mesh.rotation.y += 0.06 * delta;
    }
    mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, mesh.userData.targetRotationX ?? 0, t);
  }

  markers.pulse(timer.getElapsed(), camera);

  // Regreso suave de la cámara a su posición inicial
  if (cameraGoal) {
    camera.position.lerp(cameraGoal, t);
    if (camera.position.distanceTo(cameraGoal) < 0.01) cameraGoal = null;
  }

  clouds.rotation.y += 0.015 * delta; // nubes un poco más rápidas que la Tierra
  stars.rotation.y += 0.002 * delta;  // giro muy lento del fondo

  // Dirección del sol vista desde la cámara (para las luces nocturnas)
  sunDirView.value.copy(sunlight.position).normalize().transformDirection(camera.matrixWorldInverse);

  controls.update();
  sky?.follow(camera);
  renderer.render(scene, camera);
}

// ---------- Tamaño de la ventana ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (compareBody) applyLayout(); // recalcular las mitades de pantalla
}
window.addEventListener('resize', () => {
  if (!isLabOpen()) onResize();
});
