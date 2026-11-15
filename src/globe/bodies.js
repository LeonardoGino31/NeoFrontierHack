// Cuerpos planetarios del globo: Tierra (con nubes, luces nocturnas y atmósfera),
// Marte y la Luna (con la capa de sombra permanente del polo sur).
// Los materiales se arman con todas sus texturas desde el principio: si un mapa se
// agrega después, three.js recompila el shader (antes ocurría hasta cinco veces).

import * as THREE from 'three';
import { loadFirst, loadTexture } from './textures.js';

// En la escena se dibujan con radio 1; radiusKm es el radio real.
// Marte y la Luna arrancan con mosaicos de Trek de 2048 px y cambian a los de 4096 en
// segundo plano (scripts/fetch-trek.sh); si faltan, se usan las texturas anteriores.
export const BODIES = {
  mars: {
    name: 'Marte', radiusKm: 3389.5,
    textures: ['/textures/trek/mars_viking_mdim_2k.jpg', '/textures/mars.jpg'],
    hiRes: '/textures/trek/mars_viking_mdim.jpg',
  },
  moon: {
    name: 'Luna', radiusKm: 1737.4,
    textures: ['/textures/trek/moon_lro_wac_2k.jpg', '/textures/moon.jpg'],
    hiRes: '/textures/trek/moon_lro_wac.jpg',
  },
  earth: { name: 'Tierra', radiusKm: 6371.0, textures: ['/textures/earth.jpg'] },
};

// Texturas opcionales: si falta alguna, la escena funciona sin ese efecto
const OPTIONAL = {
  sky: ['/textures/stars.jpg', { color: true }],
  earthRoughness: ['/textures/earth_roughness.jpg', { color: false }],
  earthNormal: ['/textures/earth_normal.jpg', { color: false }],
  earthNight: ['/textures/earth_night.jpg', { color: true }],
  earthClouds: ['/textures/earth_clouds.jpg', { color: false }],
  psrMask: ['/textures/trek/moon_psr_south_mask.png', { color: false }],
};

/**
 * Descarga en paralelo todas las texturas del arranque.
 * @param {() => void} onEach  se llama al terminar cada una (para la barra de progreso)
 * @returns {Promise<Record<string, THREE.Texture|null>>}  las opcionales que falten quedan en null
 */
export async function loadBodyTextures(onEach) {
  const tracked = (promise) => promise.finally(onEach);
  const required = Object.entries(BODIES).map(([key, b]) => tracked(loadFirst(b.textures)).then((t) => [key, t]));
  const optional = Object.entries(OPTIONAL).map(([key, [url, opts]]) =>
    tracked(loadTexture(url, opts)).then((t) => [key, t], () => {
      console.info(`Textura opcional no encontrada: ${url}`);
      return [key, null];
    }));
  return Object.fromEntries(await Promise.all([...required, ...optional]));
}

/** Cantidad de texturas que carga `loadBodyTextures` (para calcular el progreso). */
export const STARTUP_TEXTURE_COUNT = Object.keys(BODIES).length + Object.keys(OPTIONAL).length;

/**
 * Crea las mallas de los tres cuerpos con sus materiales definitivos.
 * @param {Record<string, THREE.Texture|null>} tex  resultado de `loadBodyTextures`
 * @param {{ maxAnisotropy: number, sunDirView: {value: THREE.Vector3} }} o
 */
export function createBodies(tex, { maxAnisotropy, sunDirView }) {
  const geometry = new THREE.SphereGeometry(1, 64, 64); // compartida por todas las esferas
  const meshes = {};

  for (const key of Object.keys(BODIES)) {
    // Filtrado anisotrópico: la textura se ve nítida también cerca del borde del disco
    tex[key].anisotropy = maxAnisotropy;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: tex[key], roughness: 0.95 }));
    mesh.userData.bodyKey = key; // para saber qué cuerpo se clicó
    mesh.userData.targetPosition = new THREE.Vector3();
    mesh.userData.targetScale = 1;
    meshes[key] = mesh;
  }

  configureEarth(meshes.earth.material, tex, sunDirView);

  // Nubes: la misma esfera algo más grande, transparente, que gira a otro ritmo
  const clouds = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, roughness: 1,
    alphaMap: tex.earthClouds, // blanco = nube, negro = transparente
  }));
  clouds.scale.setScalar(1.012);
  clouds.visible = !!tex.earthClouds;
  meshes.earth.add(clouds);

  const atmosphere = new THREE.Mesh(geometry, createAtmosphereMaterial());
  atmosphere.scale.setScalar(1.1);
  meshes.earth.add(atmosphere);

  const psrOverlay = createPsrOverlay(tex.psrMask);
  meshes.moon.add(psrOverlay);

  return { meshes, clouds, psrOverlay };
}

/** Rugosidad, relieve y luces de ciudades (solo del lado nocturno) de la Tierra. */
function configureEarth(material, tex, sunDirView) {
  if (tex.earthRoughness) {
    // Océanos brillantes (reflejan el sol), continentes mate
    material.roughness = 1;
    material.roughnessMap = tex.earthRoughness;
  }
  if (tex.earthNormal) {
    material.normalMap = tex.earthNormal;
    material.normalScale.set(0.8, 0.8);
  }
  if (tex.earthNight) {
    material.emissiveMap = tex.earthNight;
    material.emissive.set(0xffd9a0);
    material.emissiveIntensity = 1.5;
    // Se apaga el brillo emisivo donde la superficie mira al sol (lado de día)
    material.onBeforeCompile = (shader) => {
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
  }
}

/**
 * Halo azul en el borde (efecto Fresnel). Incluye los fragmentos de profundidad
 * logarítmica porque el renderer, compartido con el laboratorio, la usa.
 */
function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vNormal;
      void main() {
        #include <logdepthbuf_fragment>
        // Más intenso donde la superficie se ve de canto (el borde del planeta)
        float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
      }`,
    side: THREE.BackSide,             // se dibuja la cara interna: halo alrededor
    blending: THREE.AdditiveBlending, // suma luz, no tapa lo de atrás
    transparent: true,
    depthWrite: false,
  });
}

// La máscara de sombra permanente (LRO LOLA vía Moon Trek) solo cubre −78,75°…−90°, así
// que va sobre un casquete de esas latitudes (su UV recorre exactamente esa banda).
const PSR_TOP_LAT = -78.75;

/** Capa de regiones en sombra permanente del polo sur lunar (oculta si no hay máscara). */
function createPsrOverlay(mask) {
  if (mask) {
    // Sin mipmaps: los PSR miden pocos píxeles y al promediarse desaparecerían
    mask.generateMipmaps = false;
    mask.minFilter = THREE.LinearFilter;
  }
  const overlay = new THREE.Mesh(
    new THREE.SphereGeometry(
      1.003, 256, 24, 0, Math.PI * 2,
      THREE.MathUtils.degToRad(90 - PSR_TOP_LAT), THREE.MathUtils.degToRad(90 + PSR_TOP_LAT)
    ),
    new THREE.MeshBasicMaterial({
      color: 0x5ee7ff, alphaMap: mask, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  overlay.visible = false;
  overlay.userData.available = !!mask;
  return overlay;
}

/**
 * Cambia Marte y la Luna a sus mosaicos de 4096 px, de a uno y sin bloquear: la
 * imagen se decodifica en segundo plano y se sube a la GPU antes de mostrarse.
 */
export async function upgradeHiRes(renderer, meshes) {
  for (const [key, body] of Object.entries(BODIES)) {
    if (!body.hiRes) continue;
    try {
      const texture = await loadTexture(body.hiRes);
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      renderer.initTexture(texture);
      const material = meshes[key].material;
      const old = material.map;
      material.map = texture; // mismo tipo de mapa: no hace falta recompilar
      old.dispose();
    } catch {
      // Sin la versión grande se queda la de 2048 px
    }
  }
}
