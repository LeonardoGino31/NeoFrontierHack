// Fondo espacial: campo de estrellas generado por código más la Vía Láctea en una esfera.

import * as THREE from 'three';

/** Puntos aleatorios sobre una cáscara lejana (radio 60–120), en tonos blanco-azulado. */
export function createStarfield(count = 4000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = 60 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1); // latitud uniforme sobre la esfera

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    color.setHSL(0.55 + Math.random() * 0.15, 0.3, 0.75 + Math.random() * 0.25);
    colors.set([color.r, color.g, color.b], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.25, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9,
  }));
}

/**
 * Esfera interior con la imagen equirectangular de la Vía Láctea.
 * Usarla como `scene.background` obligaba a three.js a convertirla en un cubemap con
 * caras del alto de la imagen (6 × 4096² con el JPG original): cientos de MB de GPU.
 * Debe seguir a la cámara (ver `follow`) para que parezca estar en el infinito.
 * @param {THREE.Texture} texture
 * @param {number} intensity  brillo relativo (la imagen no debe competir con los planetas)
 */
export function createSky(texture, intensity = 0.6) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 64, 32),
    new THREE.MeshBasicMaterial({
      map: texture,
      color: new THREE.Color(intensity, intensity, intensity),
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false, // igual que scene.background con una textura sRGB
    })
  );
  // Vista desde dentro, la esfera espeja la imagen; esto la deja orientada
  // exactamente igual que el fondo equirectangular anterior
  sky.scale.x = -1;
  sky.rotation.y = Math.PI;
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.follow = (camera) => sky.position.copy(camera.position);
  return sky;
}
