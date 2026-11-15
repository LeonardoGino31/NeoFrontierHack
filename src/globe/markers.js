// Marcadores del globo. Cada sitio se marca con dos cosas: un sector sombreado sobre la
// superficie (un disco translúcido con borde brillante, del color del cuerpo análogo) y,
// encima, un pin rojo en 3D como los de Google Maps, que flota y muestra su agujero
// blanco hacia la cámara. Hay también un marcador igual (en amarillo) por cuerpo análogo.

import * as THREE from 'three';
import { similarityDataFromCsv } from '../planetaryData.js';

const MARKER_COLORS = { mars: '#f97316', moon: '#cbd5e1' }; // naranja / gris claro
const ACTIVE_COLOR = '#facc15'; // amarillo
export const ANALOG_TARGETS = ['mars', 'moon'];

const SECTOR_RADIUS = 0.06;
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

/** Geometría de gota (pin de mapa): punta abajo en y = 0, cabeza redonda arriba. */
function pinGeometry(R, H) {
  const alpha = Math.asin(R / H);
  const pts = [new THREE.Vector2(0, 0)];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const phi = -alpha + (i / steps) * (Math.PI / 2 + alpha);
    pts.push(new THREE.Vector2(R * Math.cos(phi), H + R * Math.sin(phi)));
  }
  return new THREE.LatheGeometry(pts, 28);
}

/**
 * Pin rojo con agujero blanco. El pivote gira sobre la normal de la superficie (eje Z
 * local del sector) para que el agujero mire a la cámara.
 */
function createPin({ geometry, redMaterial, holeMaterial, holeGeometry, R, H, scale = 1 }) {
  const pivot = new THREE.Group();
  const pin = new THREE.Group();
  pin.rotation.x = Math.PI / 2; // el eje Y del pin pasa a ser la normal (Z del sector)
  pin.add(new THREE.Mesh(geometry, redMaterial));
  for (const side of [1, -1]) {
    const hole = new THREE.Mesh(holeGeometry, holeMaterial);
    hole.position.set(0, H, side * R * 0.93);
    if (side < 0) hole.rotation.y = Math.PI;
    pin.add(hole);
  }
  pivot.add(pin);
  pivot.scale.setScalar(scale);
  return { pivot, pin };
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

  const R = 0.018, H = 0.052;
  const pinParts = {
    geometry: pinGeometry(R, H),
    // Emisivo: el pin se distingue también en la cara nocturna del planeta
    redMaterial: new THREE.MeshStandardMaterial({ color: 0xe11d24, emissive: 0x5a0508, roughness: 0.35, metalness: 0.1 }),
    holeMaterial: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    holeGeometry: new THREE.CircleGeometry(R * 0.42, 20),
    R, H,
  };

  const earthMarkers = new THREE.Group();
  earthMarkers.visible = false;
  meshes.earth.add(earthMarkers);

  pairs.forEach(({ id: pairId, earthPoint, analog, comparison }, i) => {
    // El sector es lo que se toca: tangente a la esfera, con la normal hacia afuera
    const marker = new THREE.Mesh(sectorGeometry, colorMaterials[analog.body]);
    marker.position.copy(latLonToVector3(earthPoint.lat, earthPoint.lon, 1.02)); // encima de las nubes
    marker.quaternion.setFromUnitVectors(Z_AXIS, marker.position.clone().normalize());
    const { pivot, pin } = createPin(pinParts);
    marker.add(pivot);
    marker.userData = {
      id: i + 1, pairId, earthPoint, analog, pivot, pin, phase: Math.random() * 6.28,
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
    const { pivot, pin } = createPin({ ...pinParts, scale: 1.4 });
    group.add(sector, pivot);
    group.userData = { sector, pivot, pin };
    group.visible = false;
    meshes[key].add(group);
    analogMarkers[key] = group;
  }

  let selected = null;
  const camLocal = new THREE.Vector3();
  /** Gira el pin sobre la normal para que su agujero mire a la cámara. */
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
      marker.material = on ? activeMaterial : colorMaterials[marker.userData.analog.body];
      marker.scale.setScalar(on ? 1.5 : 1);
      selected = on ? marker : (selected === marker ? null : selected);
    },
    /** Animación: los pines flotan y miran a la cámara; el sector elegido late. */
    pulse(time, camera) {
      if (earthMarkers.visible) {
        for (const m of earthMarkers.children) {
          const { pivot, phase } = m.userData;
          pivot.position.z = 0.008 + 0.006 * Math.sin(time * 2 + phase);
          faceCamera(m, pivot, camera);
        }
        if (selected) selected.scale.setScalar(1.5 + 0.1 * Math.sin(time * 4));
      }
      for (const group of Object.values(analogMarkers)) {
        if (!group.visible) continue;
        const { sector, pivot } = group.userData;
        group.quaternion.setFromUnitVectors(Z_AXIS, group.position.clone().normalize());
        pivot.position.z = 0.01 + 0.008 * Math.sin(time * 3);
        sector.scale.setScalar(1.3 + 0.12 * Math.sin(time * 4));
        faceCamera(group, pivot, camera);
      }
    },
  };
}
