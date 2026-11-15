// Marcadores del globo. Cada sitio se marca con dos cosas: un sector sombreado sobre la
// superficie (un disco translúcido con borde brillante, del color del cuerpo análogo) y,
// encima, una cruz roja de luz que se alza desde su centro y mira a la cámara. El sitio
// elegido y el marcador de cada cuerpo análogo usan una cruz más intensa, con anillo.

import * as THREE from 'three';
import { similarityDataFromCsv } from '../planetaryData.js';

const MARKER_COLORS = { mars: '#f97316', moon: '#cbd5e1' }; // naranja / gris claro
const ACTIVE_COLOR = '#ff2a3a'; // rojo: el elegido sigue el color de las cruces
export const ANALOG_TARGETS = ['mars', 'moon'];

const SECTOR_RADIUS = 0.08;
const CROSS_H = 0.2; // alto de la cruz; su travesaño queda a 0.14 de la superficie
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Convierte latitud/longitud (grados) a una posición sobre la esfera, con la misma
 * convención que SphereGeometry para que el punto coincida con la textura.
 */
export function latLonToVector3(lat, lon, radius = 1) {
  const phi = THREE.MathUtils.degToRad(90 - lat);    // ángulo desde el polo norte
  const theta = THREE.MathUtils.degToRad(lon + 180); // ángulo alrededor del eje Y
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Textura del sector: relleno suave que se intensifica hacia un borde blanco brillante. */
function sectorTexture(color, strength = 1) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const c = size / 2;
  const fill = g.createRadialGradient(c, c, 0, c, c, c * 0.88);
  fill.addColorStop(0, hexA(color, 0.1 * strength));
  fill.addColorStop(0.7, hexA(color, 0.3 * strength));
  fill.addColorStop(1, hexA(color, 0.62 * strength));
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, c * 0.88, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(c, c, c * 0.88, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Textura de la cruz de luz: un haz vertical alto y un travesaño corto, con núcleo
 * blanco y halo rojo. La versión activa añade un destello y un anillo más intensos.
 * El travesaño queda al 30 % desde arriba, donde la cámara se mete al abrir el mapa.
 */
function crossTexture(active) {
  const W = 128, H = 256, cx = W / 2, barY = H * 0.3;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  g.globalCompositeOperation = 'lighter'; // las capas de luz se suman, como en un haz real
  g.lineCap = 'round';

  // Degradados: el haz se desvanece hacia la punta y el travesaño hacia sus extremos
  const vertical = (r, gr, b, a) => {
    const grad = g.createLinearGradient(0, 6, 0, H - 4);
    grad.addColorStop(0, `rgba(${r},${gr},${b},0)`);
    grad.addColorStop(0.25, `rgba(${r},${gr},${b},${a})`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},${a})`);
    return grad;
  };
  const horizontal = (r, gr, b, a) => {
    const grad = g.createLinearGradient(10, 0, W - 10, 0);
    grad.addColorStop(0, `rgba(${r},${gr},${b},0)`);
    grad.addColorStop(0.5, `rgba(${r},${gr},${b},${a})`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    return grad;
  };
  const beam = (width, blur, rgb, alpha) => {
    g.lineWidth = width;
    g.shadowBlur = blur;
    g.shadowColor = `rgba(${rgb},1)`;
    g.strokeStyle = vertical(...rgb.split(','), alpha);
    g.beginPath(); g.moveTo(cx, 8); g.lineTo(cx, H - 6); g.stroke();
    g.strokeStyle = horizontal(...rgb.split(','), alpha);
    g.beginPath(); g.moveTo(10, barY); g.lineTo(W - 10, barY); g.stroke();
  };

  const k = active ? 1.35 : 1;
  beam(16 * k, 22 * k, '255,20,40', 0.55); // halo rojo ancho
  beam(7, 10, '255,60,70', 0.9);           // cuerpo rojo
  beam(2.5, 4, '255,235,235', 1);          // núcleo casi blanco

  g.shadowBlur = 0;
  // Destello en el cruce
  const flareR = active ? 30 : 20;
  const flare = g.createRadialGradient(cx, barY, 0, cx, barY, flareR);
  flare.addColorStop(0, 'rgba(255,255,255,1)');
  flare.addColorStop(0.3, 'rgba(255,90,100,0.8)');
  flare.addColorStop(1, 'rgba(255,0,30,0)');
  g.fillStyle = flare;
  g.fillRect(cx - flareR, barY - flareR, flareR * 2, flareR * 2);
  // Impacto en la base: el haz "toca" la superficie
  const base = g.createRadialGradient(cx, H - 8, 0, cx, H - 8, 26);
  base.addColorStop(0, 'rgba(255,220,220,0.9)');
  base.addColorStop(0.4, 'rgba(255,40,60,0.5)');
  base.addColorStop(1, 'rgba(255,0,30,0)');
  g.fillStyle = base;
  g.fillRect(cx - 26, H - 34, 52, 34);

  if (active) {
    // Anillo inclinado alrededor del cruce: distingue el sitio elegido
    g.lineWidth = 2;
    g.shadowBlur = 8;
    g.shadowColor = 'rgba(255,40,60,1)';
    g.strokeStyle = 'rgba(255,120,130,0.85)';
    g.beginPath();
    g.ellipse(cx, barY, 54, 13, 0, 0, Math.PI * 2);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Textura del destello que siempre mira a la cámara (se ve incluso desde arriba). */
function flareTexture() {
  const size = 64, c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.25, 'rgba(255,80,90,0.75)');
  glow.addColorStop(1, 'rgba(255,0,30,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Cruz roja de luz plantada en el sector. El pivote gira sobre la normal de la superficie
 * (eje Z local del sector) para que la cara de la cruz mire a la cámara; el destello es
 * un sprite para que el sitio no desaparezca cuando la cruz se ve de canto.
 */
function createCross({ geometry, crossMaterial, flareMaterial, scale = 1 }) {
  const pivot = new THREE.Group();
  const pin = new THREE.Group();
  pin.rotation.x = Math.PI / 2; // el eje Y de la cruz pasa a ser la normal (Z del sector)
  const cross = new THREE.Mesh(geometry, crossMaterial);
  const flare = new THREE.Sprite(flareMaterial);
  flare.position.y = CROSS_H * 0.7;
  flare.scale.setScalar(0.05);
  pin.add(cross, flare);
  pivot.add(pin);
  pivot.scale.setScalar(scale);
  return { pivot, pin, cross, flare };
}

/**
 * Crea los marcadores y los cuelga de sus cuerpos (así giran y escalan con ellos).
 * @param {{ meshes: Record<string, THREE.Mesh>, pairs: Array, model: object }} o
 */
export function createMarkers({ meshes, pairs, model }) {
  // Un material por color (no uno por punto): al resaltar se cambia de material.
  const sectorMaterial = (color, strength) => new THREE.MeshBasicMaterial({
    map: sectorTexture(color, strength), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
  });
  const colorMaterials = Object.fromEntries(
    Object.entries(MARKER_COLORS).map(([body, color]) => [body, sectorMaterial(color, 1)])
  );
  const activeMaterial = sectorMaterial(ACTIVE_COLOR, 1.5);
  const sectorGeometry = new THREE.CircleGeometry(SECTOR_RADIUS, 48);

  // Materiales sin luz: la cruz brilla igual en la cara de día y en la de noche
  const crossMaterial = (active) => new THREE.MeshBasicMaterial({
    map: crossTexture(active), transparent: true, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  const flareMaterial = (opacity) => new THREE.SpriteMaterial({
    map: flareTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity, toneMapped: false,
  });
  const crossGeometry = new THREE.PlaneGeometry(CROSS_H / 2, CROSS_H);
  crossGeometry.translate(0, CROSS_H / 2, 0); // la base del haz toca la superficie
  const crossParts = { geometry: crossGeometry, crossMaterial: crossMaterial(false), flareMaterial: flareMaterial(0.7) };
  const activeCross = { cross: crossMaterial(true), flare: flareMaterial(1) };

  const earthMarkers = new THREE.Group();
  earthMarkers.visible = false;
  meshes.earth.add(earthMarkers);

  pairs.forEach(({ id: pairId, earthPoint, analog, comparison }, i) => {
    // El sector es lo que se toca: tangente a la esfera, con la normal hacia afuera
    const marker = new THREE.Mesh(sectorGeometry, colorMaterials[analog.body]);
    marker.position.copy(latLonToVector3(earthPoint.lat, earthPoint.lon, 1.02)); // encima de las nubes
    marker.quaternion.setFromUnitVectors(Z_AXIS, marker.position.clone().normalize());
    const { pivot, pin, cross, flare } = createCross(crossParts);
    marker.add(pivot);
    marker.userData = {
      id: i + 1, pairId, earthPoint, analog, pivot, pin, cross, flare, phase: Math.random() * 6.28,
      similarity: similarityDataFromCsv(model, comparison, analog.body),
    };
    earthMarkers.add(marker);
  });

  // Un marcador de análogo por cuerpo objetivo (se reutiliza, solo se mueve)
  const analogMarkers = {};
  for (const key of ANALOG_TARGETS) {
    const group = new THREE.Group();
    const sector = new THREE.Mesh(sectorGeometry, activeMaterial);
    sector.scale.setScalar(1.3);
    const { pivot, pin } = createCross({
      ...crossParts, crossMaterial: activeCross.cross, flareMaterial: activeCross.flare, scale: 1.3,
    });
    group.add(sector, pivot);
    group.userData = { sector, pivot, pin };
    group.visible = false;
    meshes[key].add(group);
    analogMarkers[key] = group;
  }

  let selected = null;
  const camLocal = new THREE.Vector3();
  /** Gira la cruz sobre la normal para que su cara mire a la cámara. */
  const faceCamera = (parent, pin, camera) => {
    camLocal.copy(camera.position);
    parent.worldToLocal(camLocal);
    pin.rotation.z = Math.atan2(camLocal.y, camLocal.x) + Math.PI / 2;
  };

  return {
    earthMarkers,
    analogMarkers,
    /** Marcadores de la Tierra cuyo análogo está en `body`, en el orden del CSV. */
    markersFor: (body) => earthMarkers.children.filter((m) => m.userData.analog.body === body),
    /** Resalta (o vuelve a su color) un punto de la Tierra. */
    highlight(marker, on) {
      const { cross, flare } = marker.userData;
      marker.material = on ? activeMaterial : colorMaterials[marker.userData.analog.body];
      cross.material = on ? activeCross.cross : crossParts.crossMaterial;
      flare.material = on ? activeCross.flare : crossParts.flareMaterial;
      marker.scale.setScalar(on ? 1.5 : 1);
      selected = on ? marker : (selected === marker ? null : selected);
    },
    /** Animación: las cruces titilan y miran a la cámara; el sector elegido late. */
    pulse(time, camera) {
      if (earthMarkers.visible) {
        for (const m of earthMarkers.children) {
          const { pivot, pin, phase } = m.userData;
          // El haz no flota: está plantado y solo "respira" a lo largo
          pin.scale.y = 1 + 0.05 * Math.sin(time * 3 + phase);
          faceCamera(m, pivot, camera);
        }
        if (selected) selected.scale.setScalar(1.5 + 0.1 * Math.sin(time * 4));
      }
      for (const group of Object.values(analogMarkers)) {
        if (!group.visible) continue;
        const { sector, pivot, pin } = group.userData;
        group.quaternion.setFromUnitVectors(Z_AXIS, group.position.clone().normalize());
        pin.scale.y = 1 + 0.08 * Math.sin(time * 4);
        sector.scale.setScalar(1.3 + 0.12 * Math.sin(time * 4));
        faceCamera(group, pivot, camera);
      }
    },
  };
}
