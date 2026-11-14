import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';
import { createSimilarityPanel } from './similarityPanel.js';
import { createParamGuide } from './paramGuide.js';
import { createTerrainLab } from './terrainLab.js';
import { loadPlanetaryData, similarityDataFromCsv } from './planetaryData.js';
import { createComparePanel } from './comparePanel.js';

const { pairs } = await loadPlanetaryData();

// 1. Crear la escena
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050816);

// 2. Crear la cámara
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.z = 3;

// 3. Crear el renderizador
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// Limitar resolución para cuidar la GPU integrada
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

// Tone mapping: comprime las luces fuertes como una cámara real (menos aspecto "plástico")
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

document.body.appendChild(renderer.domElement);

// 4. Fondo espacial
// 4a. Campo de estrellas generado por código (no necesita imágenes)
function createStarfield(count = 4000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Punto aleatorio sobre una esfera lejana (radio entre 60 y 120)
    const r = 60 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;      // longitud
    const phi = Math.acos(2 * Math.random() - 1);   // latitud uniforme

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // Estrellas entre blanco-azulado y blanco-amarillento
    color.setHSL(0.55 + Math.random() * 0.15, 0.3, 0.75 + Math.random() * 0.25);
    colors[i * 3]     = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const starMaterial = new THREE.PointsMaterial({
    size: 0.25,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9
  });

  return new THREE.Points(starGeometry, starMaterial);
}

const stars = createStarfield();
scene.add(stars);

// 4b. Fondo de Vía Láctea (opcional): si existe /textures/stars.jpg se usa
const textureLoader = new THREE.TextureLoader();

textureLoader.load(
  '/textures/stars.jpg',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    scene.background = texture;
    scene.backgroundIntensity = 0.6; // más tenue para que no compita con el planeta
    console.log('Fondo de estrellas cargado');
  },
  undefined,
  () => console.info('Sin stars.jpg: se usa solo el campo de estrellas generado')
);

// 5. Cuerpos planetarios
// En la escena se dibujan con radio 1; radiusKm es el radio real para cálculos futuros.
// Marte y la Luna usan mosaicos de NASA Trek (scripts/fetch-trek.sh); si faltan, se usa la
// textura anterior para que la app siga funcionando sin haber ejecutado el script.
const BODIES = {
  mars:  { name: 'Marte',  texture: '/textures/trek/mars_viking_mdim.jpg', fallback: '/textures/mars.jpg', radiusKm: 3389.5 },
  moon:  { name: 'Luna',   texture: '/textures/trek/moon_lro_wac.jpg',     fallback: '/textures/moon.jpg', radiusKm: 1737.4 },
  earth: { name: 'Tierra', texture: '/textures/earth.jpg', radiusKm: 6371.0 },
};

// "Ranuras" del carrusel: el seleccionado va al centro, los otros a los lados
const SLOTS = {
  center: { position: new THREE.Vector3(0, 0, 0),       scale: 1 },
  left:   { position: new THREE.Vector3(-2.6, 0.2, -1), scale: 0.3 },
  right:  { position: new THREE.Vector3(2.6, 0.2, -1),  scale: 0.3 },
  hidden: { position: new THREE.Vector3(0, 0, -10),     scale: 0.001 },
};

const CAMERA_HOME = new THREE.Vector3(0, 0, 3);

// Modo comparación: Tierra en la mitad izquierda, análogo en la derecha
let compareBody = null;  // 'mars' | 'moon' | null
let cameraGoal = null;   // posición a la que la cámara vuelve suavemente

// Calcula posición y tamaño para que cada cuerpo ocupe su mitad de pantalla
function getCompareLayout() {
  const dist = CAMERA_HOME.z;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  const halfW = halfH * camera.aspect;
  const x = halfW / 2; // centro de cada mitad
  const scale = Math.min(0.95, x * 0.8, halfH * 0.75);
  return { x, scale };
}

// Coloca cada cuerpo en su lugar según el modo actual
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

const geometry = new THREE.SphereGeometry(1, 64, 64);
const meshes = {}; // bodyKey -> mesh

for (const [key, body] of Object.entries(BODIES)) {
  // Cada cuerpo tiene su propio material; la geometría sí se comparte
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const mesh = new THREE.Mesh(geometry, material);

  const texture = textureLoader.load(
    body.texture,
    () => console.log(`Textura de ${body.name} cargada correctamente`),
    undefined,
    (error) => {
      if (!body.fallback) return console.error(`Error cargando la textura de ${body.name}:`, error);
      console.info(`Sin textura de Trek para ${body.name}; se usa ${body.fallback}`);
      const fallback = textureLoader.load(body.fallback);
      fallback.colorSpace = THREE.SRGBColorSpace;
      fallback.anisotropy = texture.anisotropy;
      material.map = fallback;
      material.needsUpdate = true;
    }
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  material.map = texture;
  mesh.userData.bodyKey = key; // para saber qué cuerpo se clicó

  // Destino al que se mueve suavemente en cada frame
  mesh.userData.targetPosition = new THREE.Vector3();
  mesh.userData.targetScale = 1;

  meshes[key] = mesh;
  scene.add(mesh);
}

let currentBody = null;

// Selecciona un cuerpo: lo manda al centro y reparte los demás a los lados
function setBody(bodyKey) {
  if (!BODIES[bodyKey] || bodyKey === currentBody) return;
  currentBody = bodyKey;
  onBodyChanged();
  applyLayout();

  // Volver a centrar la cámara en el planeta seleccionado
  controls.target.set(0, 0, 0);
}

// 5a. Realismo de la Tierra

// Filtrado anisotrópico: la textura se ve nítida también cerca de los bordes del globo
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
for (const mesh of Object.values(meshes)) mesh.material.map.anisotropy = maxAnisotropy;

const earthMaterial = meshes.earth.material;

// Carga opcional: si el archivo no existe, se avisa y no se rompe nada
function loadOptionalTexture(url, onLoad) {
  textureLoader.load(url, onLoad, undefined, () =>
    console.info(`Textura opcional no encontrada: ${url}`)
  );
}

// a) Roughness map: océanos brillantes (reflejan el sol), continentes mate
loadOptionalTexture('/textures/earth_roughness.jpg', (tex) => {
  earthMaterial.roughness = 1;
  earthMaterial.roughnessMap = tex;
  earthMaterial.needsUpdate = true;
});

// b) Normal map: simula el relieve (montañas, cordilleras) con la luz
loadOptionalTexture('/textures/earth_normal.jpg', (tex) => {
  earthMaterial.normalMap = tex;
  earthMaterial.normalScale.set(0.8, 0.8);
  earthMaterial.needsUpdate = true;
});

// c) Luces de ciudades, solo en el lado nocturno
// Dirección del sol en espacio de cámara; se actualiza en cada frame
const sunDirView = { value: new THREE.Vector3(0, 0, 1) };

loadOptionalTexture('/textures/earth_night.jpg', (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  earthMaterial.emissiveMap = tex;
  earthMaterial.emissive.set(0xffd9a0);
  earthMaterial.emissiveIntensity = 1.5;

  // Modificamos el shader de MeshStandardMaterial: apagamos el brillo emisivo
  // donde la superficie mira al sol (lado de día)
  earthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirView = sunDirView;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirView;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float sunFacing = dot(normal, uSunDirView);
        totalEmissiveRadiance *= 1.0 - smoothstep(-0.2, 0.15, sunFacing);`
      );
  };
  earthMaterial.needsUpdate = true;
});

// d) Nubes: una esfera un poco más grande, transparente, que gira a otro ritmo
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.012, 64, 64),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    roughness: 1
  })
);
clouds.visible = false;
meshes.earth.add(clouds);

loadOptionalTexture('/textures/earth_clouds.jpg', (tex) => {
  clouds.material.alphaMap = tex; // blanco = nube, negro = transparente
  clouds.material.needsUpdate = true;
  clouds.visible = true;
});

// e) Atmósfera: brillo azul en el borde (efecto Fresnel). No necesita imagen.
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 64),
  new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        // Más intenso donde la superficie se ve de canto (el borde del planeta)
        float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
      }`,
    side: THREE.BackSide,              // se dibuja la cara interna: halo alrededor
    blending: THREE.AdditiveBlending,  // suma luz, no tapa lo de atrás
    transparent: true,
    depthWrite: false
  })
);
atmosphere.scale.setScalar(1.1);
meshes.earth.add(atmosphere);

// 5b. Puntos en la Tierra y sus análogos (sitios reales; la similitud aún es de demo)

// Convierte latitud/longitud (grados) a una posición 3D sobre la esfera.
// Usa la misma convención que SphereGeometry, así el punto coincide con la textura.
function latLonToVector3(lat, lon, radius = 1) {
  const phi = THREE.MathUtils.degToRad(90 - lat);     // ángulo desde el polo norte
  const theta = THREE.MathUtils.degToRad(lon + 180);  // ángulo alrededor del eje Y
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Color de cada punto de la Tierra según el cuerpo de su análogo
const MARKER_COLORS = { mars: 0xf97316, moon: 0xcbd5e1 }; // naranja / gris claro
const MARKER_ACTIVE_COLOR = 0xfacc15; // amarillo
const ANALOG_TARGETS = ['mars', 'moon'];

// Marcadores de la Tierra: hijos del mesh, así giran y escalan con el planeta
const markerGeometry = new THREE.SphereGeometry(0.02, 12, 12);
const earthMarkers = new THREE.Group();
earthMarkers.visible = false;
meshes.earth.add(earthMarkers);

pairs.forEach(({ id: pairId, earthPoint, analog, comparison }, i) => {
  // MeshBasicMaterial no depende de la luz: el punto se ve aunque esté en la cara oscura
  const marker = new THREE.Mesh(
    markerGeometry,
    new THREE.MeshBasicMaterial({ color: MARKER_COLORS[analog.body] })
  );
  marker.position.copy(latLonToVector3(earthPoint.lat, earthPoint.lon, 1.02)); // encima de las nubes
  marker.userData = {
    id: i + 1,
    pairId,
    earthPoint,
    analog,
    similarity: similarityDataFromCsv(comparison, analog.body),
  };
  earthMarkers.add(marker);
});

/** Marcadores de la Tierra cuyo análogo está en `body`, en el orden del CSV. */
const markersFor = (body) => earthMarkers.children.filter((m) => m.userData.analog.body === body);

// Un marcador de análogo por cuerpo objetivo (se reutiliza, solo se mueve)
const analogMarkers = {};

for (const key of ANALOG_TARGETS) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 16),
    new THREE.MeshBasicMaterial({ color: MARKER_ACTIVE_COLOR })
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 16),
    new THREE.MeshBasicMaterial({
      color: MARKER_ACTIVE_COLOR,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    })
  );
  group.add(core, halo);
  group.userData.halo = halo;
  group.visible = false;
  meshes[key].add(group);
  analogMarkers[key] = group;
}

// 5c. Sombra permanente (PSR) del polo sur lunar, de LRO LOLA vía Moon Trek.
// La máscara solo cubre −78.75°…−90°, así que va sobre un casquete esférico de esas latitudes
// (el UV de un SphereGeometry parcial recorre exactamente esa banda).
const PSR_TOP_LAT = -78.75;
const psrOverlay = new THREE.Mesh(
  new THREE.SphereGeometry(
    1.003, 256, 24,
    0, Math.PI * 2,
    THREE.MathUtils.degToRad(90 - PSR_TOP_LAT), THREE.MathUtils.degToRad(90 + PSR_TOP_LAT)
  ),
  new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
);
psrOverlay.visible = false;
meshes.moon.add(psrOverlay);

const psrToggle = document.createElement('button');
psrToggle.id = 'psr-toggle';
psrToggle.hidden = true;
psrToggle.setAttribute('aria-pressed', 'true');
psrToggle.title = 'LRO LOLA · regiones en sombra permanente del polo sur (Moon Trek)';
psrToggle.innerHTML = '<span class="swatch"></span>Sombra permanente (hielo)';
document.body.appendChild(psrToggle);

let psrEnabled = true;
let psrLoaded = false;

loadOptionalTexture('/textures/trek/moon_psr_south_mask.png', (tex) => {
  // Sin mipmaps: los PSR miden pocos píxeles y al promediarse con el resto desaparecerían
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  psrOverlay.material.alphaMap = tex; // blanco = región en sombra permanente
  psrOverlay.material.needsUpdate = true;
  psrLoaded = true;
  updatePsrVisibility();
});

psrToggle.addEventListener('click', () => {
  psrEnabled = !psrEnabled;
  psrToggle.setAttribute('aria-pressed', String(psrEnabled));
  updatePsrVisibility();
});

/** Muestra la capa PSR (y su interruptor) solo cuando la Luna está en primer plano. */
function updatePsrVisibility() {
  const moonInFocus = compareBody ? compareBody === 'moon' : currentBody === 'moon';
  psrToggle.hidden = !(psrLoaded && moonInFocus);
  psrOverlay.visible = psrLoaded && psrEnabled && moonInFocus;
}

let selectedMarker = null;
const infoPanel = document.getElementById('info');
const comparePanel = createComparePanel({ formatLatLon });
const compareLabels = document.getElementById('compare-labels');
const terrainLab = createTerrainLab();
const paramGuide = createParamGuide({
  onOpenLab: (key) => {
    paramGuide.close();
    terrainLab.open(key); // abre el laboratorio en el modo de ese parámetro
  }
});
const similarityPanel = createSimilarityPanel({
  onClose: () => clearSelection(),
  onHelp: (key) => paramGuide.open(key), // abre la guía en ese parámetro
  onNav: (dir) => stepEarthPoint(dir)
});

// Salir de la comparación con el botón ✕ o con Esc
infoPanel.addEventListener('click', (event) => {
  if (event.target.closest('.close-compare')) clearSelection();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') clearSelection();
  // Las flechas recorren los puntos, salvo si se está escribiendo o hay otra ventana abierta
  if (event.target.closest('input, textarea, select') || terrainLab.isOpen()) return;
  if (event.key === 'ArrowLeft') stepEarthPoint(-1);
  if (event.key === 'ArrowRight') stepEarthPoint(1);
});

function formatLatLon({ lat, lon }) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

// Ángulo destino que gira por el camino más corto
function shortestAngleTarget(current, desired) {
  const TWO_PI = Math.PI * 2;
  let diff = (desired - current) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return current + diff;
}

function clearSelection() {
  if (selectedMarker) {
    selectedMarker.material.color.set(MARKER_COLORS[selectedMarker.userData.analog.body]);
    selectedMarker.scale.setScalar(1);
    selectedMarker = null;
  }
  for (const group of Object.values(analogMarkers)) group.visible = false;
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

  // Salir del modo comparación
  if (compareBody) {
    compareBody = null;
    applyLayout();
  }
  updatePsrVisibility();
}

// Gira un cuerpo para que un punto (en coordenadas locales) mire hacia la cámara.
// bodyX es la posición horizontal donde quedará el cuerpo.
function faceTowardCamera(mesh, localPos, bodyX) {
  const pointAngle = Math.atan2(localPos.x, localPos.z);      // dónde está el punto
  const cameraAngle = Math.atan2(CAMERA_HOME.x - bodyX, CAMERA_HOME.z); // hacia dónde mirar
  mesh.userData.targetRotationY = shortestAngleTarget(mesh.rotation.y, cameraAngle - pointAngle);
}

function selectEarthPoint(marker) {
  clearSelection();
  selectedMarker = marker;
  marker.material.color.set(MARKER_ACTIVE_COLOR);
  marker.scale.setScalar(1.8);

  const { earthPoint, analog } = marker.userData;

  // Encender el punto en el cuerpo análogo
  const localPos = latLonToVector3(analog.lat, analog.lon, 1);
  const group = analogMarkers[analog.body];
  group.position.copy(localPos);
  group.visible = true;

  // Modo comparación: Tierra a la izquierda, análogo a la derecha.
  // OrbitControls movería la cámara (y ambos cuerpos a la vez): aquí se arrastra cada cuerpo.
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

  updateBodySwitch(analog.body);
  compareLabels.hidden = false;

  const siblings = markersFor(analog.body);
  similarityPanel.show({
    earthPoint,
    analogPoint: analog,
    analogName: BODIES[analog.body].name,
    formatLatLon,
    data: marker.userData.similarity,
    nav: { index: siblings.indexOf(marker), total: siblings.length }
  });

  comparePanel.show(earthPoint, analog.site);
  updatePsrVisibility();

  // La guía también muestra los valores de este punto
  paramGuide.setContext({ analogName: BODIES[analog.body].name, analogBody: analog.body, data: marker.userData.similarity });
}

/** Pasa al punto anterior (−1) o siguiente (+1) entre los del cuerpo análogo actual. */
function stepEarthPoint(dir) {
  if (!selectedMarker) return;
  const list = markersFor(selectedMarker.userData.analog.body);
  const i = list.indexOf(selectedMarker);
  selectEarthPoint(list[(i + dir + list.length) % list.length]);
}

/** Cambia el análogo a otro cuerpo, saltando al primer punto de la Tierra emparejado con él. */
function switchAnalogBody(body) {
  if (!selectedMarker || selectedMarker.userData.analog.body === body) return;
  const [first] = markersFor(body);
  if (first) selectEarthPoint(first);
}

// Selector Marte | Luna sobre la mitad derecha (reemplaza a la etiqueta fija)
const bodySwitch = document.getElementById('label-right');
bodySwitch.classList.add('body-switch');
bodySwitch.innerHTML = ANALOG_TARGETS
  .map((key) => `<button data-body="${key}">${BODIES[key].name}</button>`)
  .join('');
bodySwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-body]');
  if (btn) switchAnalogBody(btn.dataset.body);
});

/** Resalta en el selector el cuerpo análogo activo. */
function updateBodySwitch(body) {
  for (const btn of bodySwitch.querySelectorAll('[data-body]')) {
    btn.classList.toggle('active', btn.dataset.body === body);
  }
}

// Los puntos solo existen cuando la Tierra está en el centro
function onBodyChanged() {
  earthMarkers.visible = currentBody === 'earth';
  if (currentBody !== 'earth') clearSelection();
  updatePsrVisibility();
}

// Pulso del halo de los análogos
function updateHighlightPulse(time) {
  for (const group of Object.values(analogMarkers)) {
    if (group.visible) group.userData.halo.scale.setScalar(1 + 0.4 * Math.sin(time * 4));
  }
}

// 6. Iluminación
const sunlight = new THREE.DirectionalLight(0xffffff, 3);
sunlight.position.set(5, 3, 5);
scene.add(sunlight);
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// 7. Controles de cámara
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 8. Selección con clic (Raycaster)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerDown = new THREE.Vector2();

// Convierte la posición del mouse a coordenadas normalizadas (-1 a 1)
function updatePointer(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

// Devuelve el marcador de la Tierra bajo el mouse (ignora los que están detrás del planeta)
function getHoveredMarker() {
  if (currentBody !== 'earth') return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([meshes.earth, ...earthMarkers.children], false);
  if (hits.length === 0) return null;
  return hits[0].object === meshes.earth ? null : hits[0].object;
}

function getHoveredBody() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(Object.values(meshes), false);
  return hits.length > 0 ? hits[0].object.userData.bodyKey : null;
}

// En el modo comparación cada cuerpo se gira por separado arrastrándolo
const DRAG_SPEED = 0.008; // radianes por píxel
const MAX_TILT = THREE.MathUtils.degToRad(85);
let dragBody = null;
const dragLast = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown.set(event.clientX, event.clientY);
  if (!compareBody) return;
  updatePointer(event);
  const bodyKey = getHoveredBody();
  if (bodyKey === 'earth' || bodyKey === compareBody) {
    dragBody = bodyKey;
    dragLast.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture(event.pointerId);
  }
});

// Se acumula sobre el objetivo de rotación: el bucle de animación ya lo sigue con suavizado
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

renderer.domElement.addEventListener('pointerup', (event) => {
  // Si el mouse se movió mucho, fue un arrastre de OrbitControls, no un clic
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  if (moved > 5) return;

  updatePointer(event);

  const marker = getHoveredMarker();
  if (marker) {
    selectEarthPoint(marker);
    return;
  }

  // En el modo comparación un clic en un cuerpo no lo cambia: ahí se usa para arrastrar
  const bodyKey = getHoveredBody();
  if (bodyKey && !compareBody) setBody(bodyKey);
});

// Cursor de "mano" al pasar sobre un cuerpo que no está en el centro
renderer.domElement.addEventListener('pointermove', (event) => {
  if (dragBody) {
    dragRotate(event);
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }
  updatePointer(event);
  const overMarker = getHoveredMarker() !== null;
  const bodyKey = getHoveredBody();
  const overSideBody = bodyKey && bodyKey !== currentBody && !compareBody;
  const overDraggable = compareBody && (bodyKey === 'earth' || bodyKey === compareBody);
  renderer.domElement.style.cursor =
    overMarker || overSideBody ? 'pointer' : overDraggable ? 'grab' : 'default';
});

// La app arranca en la Tierra, que es donde están los puntos
setBody('earth');

// Arrancar ya en su lugar (sin animación inicial)
for (const mesh of Object.values(meshes)) {
  mesh.position.copy(mesh.userData.targetPosition);
  mesh.scale.setScalar(mesh.userData.targetScale);
}

// 9. Animación
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  // Mientras el laboratorio está abierto, la escena principal no se dibuja (ahorra GPU)
  if (terrainLab.isOpen()) return;
  const delta = clock.getDelta();

  // Suavizado independiente de los FPS: avanza ~6% del camino por frame a 60 fps
  const t = 1 - Math.exp(-4 * delta);

  for (const mesh of Object.values(meshes)) {
    mesh.position.lerp(mesh.userData.targetPosition, t);
    const s = THREE.MathUtils.lerp(mesh.scale.x, mesh.userData.targetScale, t);
    mesh.scale.setScalar(s);
    // Si hay un análogo seleccionado, el cuerpo gira hasta mostrarlo; si no, rota solo
    if (mesh.userData.targetRotationY != null) {
      mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, mesh.userData.targetRotationY, t);
    } else {
      mesh.rotation.y += 0.06 * delta;
    }
    mesh.rotation.x = THREE.MathUtils.lerp(mesh.rotation.x, mesh.userData.targetRotationX ?? 0, t);
  }

  updateHighlightPulse(clock.elapsedTime);

  // Regreso suave de la cámara a su posición inicial
  if (cameraGoal) {
    camera.position.lerp(cameraGoal, t);
    if (camera.position.distanceTo(cameraGoal) < 0.01) cameraGoal = null;
  }

  // Nubes un poco más rápidas que la Tierra
  clouds.rotation.y += 0.015 * delta;

  // Dirección del sol vista desde la cámara (para las luces nocturnas)
  sunDirView.value
    .copy(sunlight.position)
    .normalize()
    .transformDirection(camera.matrixWorldInverse);

  stars.rotation.y += 0.002 * delta; // giro muy lento del fondo

  controls.update();
  renderer.render(scene, camera);
}

animate();

// 10. Adaptar el tamaño de la ventana
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Recalcular las mitades de pantalla si estamos comparando
  if (compareBody) applyLayout();
});
