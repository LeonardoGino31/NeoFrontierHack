// Marcadores del globo: un punto por sitio de la Tierra (color según el cuerpo de su
// análogo) y un marcador pulsante por cuerpo análogo que se mueve al sitio elegido.

import * as THREE from 'three';
import { similarityDataFromCsv } from '../planetaryData.js';

const MARKER_COLORS = { mars: 0xf97316, moon: 0xcbd5e1 }; // naranja / gris claro
const ACTIVE_COLOR = 0xfacc15; // amarillo
export const ANALOG_TARGETS = ['mars', 'moon'];

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

/**
 * Crea los marcadores y los cuelga de sus cuerpos (así giran y escalan con ellos).
 * @param {{ meshes: Record<string, THREE.Mesh>, pairs: Array, model: object }} o
 */
export function createMarkers({ meshes, pairs, model }) {
  // MeshBasicMaterial no depende de la luz: el punto se ve aunque esté en la cara oscura.
  // Un material por color (no uno por punto): al resaltar se cambia de material.
  const colorMaterials = Object.fromEntries(
    Object.entries(MARKER_COLORS).map(([body, color]) => [body, new THREE.MeshBasicMaterial({ color })])
  );
  const activeMaterial = new THREE.MeshBasicMaterial({ color: ACTIVE_COLOR });
  const geometry = new THREE.SphereGeometry(0.02, 12, 12);

  const earthMarkers = new THREE.Group();
  earthMarkers.visible = false;
  meshes.earth.add(earthMarkers);

  pairs.forEach(({ id: pairId, earthPoint, analog, comparison }, i) => {
    const marker = new THREE.Mesh(geometry, colorMaterials[analog.body]);
    marker.position.copy(latLonToVector3(earthPoint.lat, earthPoint.lon, 1.02)); // encima de las nubes
    marker.userData = {
      id: i + 1, pairId, earthPoint, analog,
      similarity: similarityDataFromCsv(model, comparison, analog.body),
    };
    earthMarkers.add(marker);
  });

  // Un marcador de análogo por cuerpo objetivo (se reutiliza, solo se mueve)
  const analogMarkers = {};
  const coreGeometry = new THREE.SphereGeometry(0.06, 16, 16);
  const haloGeometry = new THREE.SphereGeometry(0.12, 16, 16);
  const haloMaterial = new THREE.MeshBasicMaterial({ color: ACTIVE_COLOR, transparent: true, opacity: 0.35, depthWrite: false });
  for (const key of ANALOG_TARGETS) {
    const group = new THREE.Group();
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    group.add(new THREE.Mesh(coreGeometry, activeMaterial), halo);
    group.userData.halo = halo;
    group.visible = false;
    meshes[key].add(group);
    analogMarkers[key] = group;
  }

  return {
    earthMarkers,
    analogMarkers,
    /** Marcadores de la Tierra cuyo análogo está en `body`, en el orden del CSV. */
    markersFor: (body) => earthMarkers.children.filter((m) => m.userData.analog.body === body),
    /** Resalta (o vuelve a su color) un punto de la Tierra. */
    highlight(marker, on) {
      marker.material = on ? activeMaterial : colorMaterials[marker.userData.analog.body];
      marker.scale.setScalar(on ? 1.8 : 1);
    },
    /** Pulso del halo de los análogos visibles. */
    pulse(time) {
      for (const group of Object.values(analogMarkers)) {
        if (group.visible) group.userData.halo.scale.setScalar(1 + 0.4 * Math.sin(time * 4));
      }
    },
  };
}
