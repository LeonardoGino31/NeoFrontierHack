// Modelos procedurales de rovers (sin archivos externos), en METROS.
// Convención local: +X adelante, +Y arriba, +Z derecha; y = 0 es el suelo con
// el rover en reposo. Cada rueda es mount → steer (giro de dirección, eje Y)
// → spin (rodadura, eje Z) para que dirección y rodadura se animen por separado.

import * as THREE from 'three';

// ---------- Fichas técnicas ----------
// realSpeed: velocidad máxima real (informativa). maxSpeed: la de conducción en
// el laboratorio, acelerada para que recorrer el terreno no tome horas.
export const ROVERS = {
  perseverance: {
    name: 'Perseverance', body: 'Marte', year: 2021, agency: 'NASA',
    realSpeed: '0,042 m/s', maxSpeed: 2.2, accel: 1.6,
    maxCurv: 0.62, turnInPlace: true, turnRate: 0.55, suspension: 'rocker-bogie',
  },
  sojourner: {
    name: 'Sojourner', body: 'Marte', year: 1997, agency: 'NASA',
    realSpeed: '0,01 m/s', maxSpeed: 0.7, accel: 0.8,
    maxCurv: 2.4, turnInPlace: true, turnRate: 0.8, suspension: 'rocker-bogie',
  },
  lrv: {
    name: 'Apollo LRV', body: 'Luna', year: 1971, agency: 'NASA',
    realSpeed: '3,6 m/s', maxSpeed: 4.2, accel: 1.8,
    maxCurv: 0.32, turnInPlace: false, turnRate: 0, suspension: 'independent',
  },
  yutu2: {
    name: 'Yutu-2', body: 'Luna', year: 2019, agency: 'CNSA',
    realSpeed: '0,055 m/s', maxSpeed: 1.4, accel: 1.1,
    maxCurv: 1.1, turnInPlace: true, turnRate: 0.6, suspension: 'rocker-bogie',
  },
};

// ---------- Materiales y texturas ----------
const mat = (color, roughness = 0.6, metalness = 0.15, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** Crea una CanvasTexture repetible dibujada con `draw(ctx, w, h)`. */
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Las texturas se generan una sola vez, la primera vez que se arma un rover
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    solar: canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#16244a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7b8db0';
      g.lineWidth = 2;
      for (let i = 0; i <= 8; i++) {
        g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
      }
    }),
    foil: canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#c9952f';
      g.fillRect(0, 0, w, h);
      // Arrugas del aislante multicapa: parches claros y oscuros al azar
      for (let i = 0; i < 160; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,230,150,0.35)' : 'rgba(90,50,10,0.3)';
        g.beginPath();
        const x = Math.random() * w, y = Math.random() * h;
        g.moveTo(x, y);
        for (let k = 0; k < 3; k++) g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
        g.fill();
      }
    }),
    mesh: canvasTexture(64, 64, (g, w, h) => {
      // Malla de cuerda de piano de las ruedas del LRV: rombos con fondo transparente
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#d4d7da';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(w, h);
      g.moveTo(w, 0); g.lineTo(0, h);
      g.stroke();
    }),
    tread: canvasTexture(128, 32, (g, w, h) => {
      g.fillStyle = '#a7abb0';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#7d8186';
      for (let i = 0; i < 8; i++) g.fillRect(i * w / 8, 0, 3, h);
    }),
  };
  TEX.solar.repeat.set(2, 2);
  TEX.mesh.repeat.set(18, 3);
  TEX.tread.repeat.set(3, 1);
  return TEX;
}

// ---------- Primitivas ----------
/** Agrega una caja de tamaño [w, h, d] en `pos` (y rotación Euler opcional) a `parent`. */
function box(parent, size, m, pos, rot) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

/** Agrega un cilindro (eje Y salvo que se rote) a `parent`. */
function cyl(parent, rTop, rBot, h, m, pos, rot, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/** Reubica una viga (caja unitaria escalada) para que una los puntos a y b. */
export function setBeam(mesh, a, b) {
  _a.set(...(Array.isArray(a) ? a : [a.x, a.y, a.z]));
  _b.set(...(Array.isArray(b) ? b : [b.x, b.y, b.z]));
  const len = _a.distanceTo(_b);
  mesh.position.copy(_a).add(_b).multiplyScalar(0.5);
  mesh.scale.set(mesh.userData.t, len, mesh.userData.t);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, _b.sub(_a).normalize());
}

/** Viga de sección cuadrada `t` entre a y b (coordenadas de `parent`). */
function beam(parent, a, b, t, m) {
  const mesh = new THREE.Mesh(UNIT_BOX, m);
  mesh.userData.t = t;
  setBeam(mesh, a, b);
  parent.add(mesh);
  return mesh;
}

/** Repite `geo` n veces alrededor del eje Z (garras, cuñas) con inclinación `tilt`. */
function aroundWheel(parent, geo, m, n, r, zOff = 0, tilt = 0, phase = 0) {
  const im = new THREE.InstancedMesh(geo, m, n);
  const d = new THREE.Object3D();
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    d.position.set(Math.cos(a) * r, Math.sin(a) * r, zOff);
    // Primero se inclina sobre su eje radial (chevrón) y luego se ubica en el ángulo a
    d.rotation.set(tilt, 0, a, 'ZYX');
    d.updateMatrix();
    im.setMatrixAt(k, d.matrix);
  }
  parent.add(im);
  return im;
}

// ---------- Ruedas ----------
/**
 * Arma una rueda con su jerarquía mount → steer → spin.
 * @param {{r:number, w:number, side:number, style:string}} o  side: -1 izquierda, +1 derecha
 */
function makeWheel({ r, w, side, style }) {
  const T = textures();
  const mount = new THREE.Group();
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  mount.add(steer);
  steer.add(spin);
  const outer = side * w / 2; // cara exterior (lejos del chasis)

  const tireGeo = (open) => new THREE.CylinderGeometry(r, r, w, 32, 1, open).rotateX(Math.PI / 2);

  if (style === 'lrv') {
    const mesh = mat(0xffffff, 0.5, 0.7, { map: T.mesh, alphaTest: 0.5, side: THREE.DoubleSide });
    spin.add(new THREE.Mesh(tireGeo(true), mesh));
    const alu = mat(0xb9bdc2, 0.4, 0.7);
    // Cubo interior visible a través de la malla
    spin.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.55, w * 0.7, 20).rotateX(Math.PI / 2), alu));
    for (const z of [-w / 2, w / 2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, r * 0.025, 6, 40), alu);
      rim.position.z = z;
      spin.add(rim);
    }
    // Cuñas de titanio en chevrón: dos medias cuñas inclinadas en sentidos opuestos
    const chev = new THREE.BoxGeometry(r * 0.03, r * 0.07, w * 0.52);
    const ti = mat(0x8c8274, 0.5, 0.6);
    aroundWheel(spin, chev, ti, 18, r * 1.005, w * 0.25, 0.45);
    aroundWheel(spin, chev, ti, 18, r * 1.005, -w * 0.25, -0.45);
    return { mount, steer, spin };
  }

  const metal = style === 'sojourner' ? mat(0x9ea3a8, 0.5, 0.6) : mat(0xb3b7bb, 0.4, 0.75);
  const tire = style === 'sojourner' ? metal : mat(0xffffff, 0.45, 0.7, { map: T.tread });
  spin.add(new THREE.Mesh(tireGeo(true), tire));
  const disc = mat(0x8d9196, 0.5, 0.6, { side: THREE.DoubleSide });
  const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 32), disc);
  inner.position.z = -outer;
  spin.add(inner);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, r * 0.03, 6, 32), metal);
  lip.position.z = outer;
  spin.add(lip);
  cyl(spin, r * 0.22, r * 0.22, w * 0.3, metal, [0, 0, outer], [Math.PI / 2, 0, 0]);

  const spokeM = mat(0x6f7378, 0.5, 0.6);
  const zs = outer - side * r * 0.04;
  if (style === 'msl') {
    // Rayos curvos de titanio (amortiguan como resortes en las ruedas MSL/M2020)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const p = (rad, ang) => [Math.cos(ang) * rad, Math.sin(ang) * rad, zs];
      beam(spin, p(r * 0.22, a), p(r * 0.6, a + 0.35), r * 0.06, spokeM);
      beam(spin, p(r * 0.6, a + 0.35), p(r * 0.96, a + 0.5), r * 0.06, spokeM);
    }
    const g = new THREE.BoxGeometry(r * 0.05, r * 0.045, w * 0.52);
    aroundWheel(spin, g, spokeM, 24, r * 1.01, w * 0.25, 0.3);
    aroundWheel(spin, g, spokeM, 24, r * 1.01, -w * 0.25, -0.3);
  } else if (style === 'yutu') {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      beam(spin, [Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, zs], [Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, zs], r * 0.07, spokeM);
    }
    aroundWheel(spin, new THREE.BoxGeometry(r * 0.06, r * 0.05, w), spokeM, 18, r * 1.01);
  } else {
    // Sojourner: tacos rectos de aluminio
    aroundWheel(spin, new THREE.BoxGeometry(r * 0.14, r * 0.07, w), metal, 14, r * 1.02);
  }
  return { mount, steer, spin };
}

// ---------- Suspensión rocker-bogie ----------
/**
 * Arma un lado de la suspensión rocker-bogie: el balancín (rocker) lleva la rueda
 * delantera y el bogie, que a su vez lleva la media y la trasera.
 * @param {THREE.Group} root
 * @param {number} s  lado: -1 izquierda, +1 derecha
 * @param {object} c  geometría en metros (ver cada rover)
 * @param {Array} wheels  lista donde se agregan las ruedas creadas
 */
function rockerBogie(root, s, c, wheels, m) {
  const { r, w, zw, xF, xM, xR, rise, t } = c;
  const [px, py] = c.pivot;
  const [bx, by] = c.bogie;
  const zr = zw - w / 2 - t; // el plano de las vigas pasa justo por dentro de la rueda

  const rocker = new THREE.Group();
  rocker.position.set(px, py, s * zr);
  root.add(rocker);
  const bogie = new THREE.Group();
  bogie.position.set(bx - px, by - py, 0);
  rocker.add(bogie);

  /** Cuelga una rueda de `parent` (cuyo origen está en ox, oy) en x con su soporte. */
  const addWheel = (parent, ox, oy, x, steerable) => {
    const wh = makeWheel({ r, w, side: s, style: c.style });
    wh.mount.position.set(x - ox, r - oy, s * (zw - zr));
    parent.add(wh.mount);
    // Horquilla: gira con la dirección en las ruedas de esquina
    const ins = -s * (w / 2 + t / 2);
    beam(wh.steer, [0, rise, ins], [0, 0, ins], t, m.frame);
    beam(wh.steer, [0, 0, ins], [0, 0, -s * w * 0.3], t * 0.8, m.frame);
    if (steerable) cyl(wh.mount, t * 1.1, t * 1.1, t * 1.6, m.dark, [0, rise + t, ins]);
    wheels.push({ ...wh, x, z: s * zw, r, w, steerable, side: s });
    return wheels.length - 1;
  };

  const iF = addWheel(rocker, px, py, xF, true);
  const iM = addWheel(bogie, bx, by, xM, false);
  const iR = addWheel(bogie, bx, by, xR, true);

  beam(rocker, [0, 0, 0], [xF - px, r + rise - py, 0], t, m.frame);
  beam(rocker, [0, 0, 0], [bx - px, by - py, 0], t, m.frame);
  beam(bogie, [0, 0, 0], [xM - bx, r + rise - by, 0], t, m.frame);
  beam(bogie, [0, 0, 0], [xR - bx, r + rise - by, 0], t, m.frame);
  cyl(rocker, t, t, t * 2.2, m.dark, [0, 0, 0], [Math.PI / 2, 0, 0]);
  cyl(bogie, t * 0.9, t * 0.9, t * 2, m.dark, [0, 0, 0], [Math.PI / 2, 0, 0]);
  // Eje que une el balancín al chasis
  cyl(rocker, t * 0.5, t * 0.5, zr - c.bodyHalf, m.dark, [0, 0, -s * (zr - c.bodyHalf) / 2], [Math.PI / 2, 0, 0]);

  return { side: s, rocker, bogie, xp: px, xb: bx, xF, xM, xR, iF, iM, iR };
}

// ---------- Rovers ----------
/** Perseverance (Mars 2020): chasis blanco, mástil con SuperCam, MMRTG trasero y brazo plegado. */
function buildPerseverance(root, wheels, sides) {
  const m = {
    white: mat(0xe9e4d8, 0.55, 0.1), deck: mat(0x77797b, 0.6, 0.3), dark: mat(0x2b2c2e, 0.5, 0.4),
    frame: mat(0xd9d6cf, 0.5, 0.3), metal: mat(0xa8adb2, 0.35, 0.8), gold: mat(0xc9a14a, 0.35, 0.8),
  };
  const c = {
    r: 0.2625, w: 0.4, zw: 1.07, xF: 1.05, xM: 0, xR: -1.0, rise: 0.3, t: 0.06,
    pivot: [0.2, 0.85], bogie: [-0.5, 0.58], bodyHalf: 0.7, style: 'msl',
  };
  for (const s of [-1, 1]) sides.push(rockerBogie(root, s, c, wheels, m));

  box(root, [1.85, 0.5, 1.4], m.white, [-0.05, 0.98, 0]);
  box(root, [1.8, 0.05, 1.36], m.deck, [-0.05, 1.255, 0]);
  box(root, [0.5, 0.18, 0.45], m.white, [-0.45, 1.37, 0.35]);   // carrusel de muestras
  box(root, [0.35, 0.14, 0.35], m.gold, [0.05, 1.35, -0.4]);
  // Barra diferencial sobre el chasis (une los dos balancines)
  cyl(root, 0.025, 0.025, 1.7, m.metal, [0.1, 1.32, 0], [Math.PI / 2, 0, 0]);

  // Mástil con cabeza RSM: SuperCam (lente grande) y las dos Mastcam-Z
  cyl(root, 0.05, 0.06, 0.95, m.white, [0.72, 1.7, 0.42]);
  const head = new THREE.Group();
  head.position.set(0.72, 2.2, 0.42);
  root.add(head);
  box(head, [0.24, 0.22, 0.5], m.white, [0, 0, 0]);
  cyl(head, 0.085, 0.085, 0.06, m.dark, [0.13, 0.02, 0], [0, 0, Math.PI / 2], 20);
  for (const z of [-0.17, 0.17]) box(head, [0.08, 0.08, 0.08], m.dark, [0.13, -0.03, z]);

  // Antena de alta ganancia hexagonal
  cyl(root, 0.025, 0.025, 0.2, m.metal, [-0.35, 1.37, -0.45]);
  cyl(root, 0.16, 0.16, 0.03, m.white, [-0.35, 1.48, -0.45], [0.3, 0, 0.2], 6);

  // MMRTG inclinado en la parte trasera, con aletas negras
  const rtg = new THREE.Group();
  rtg.position.set(-1.0, 1.15, 0);
  rtg.rotation.z = -0.5;
  root.add(rtg);
  cyl(rtg, 0.17, 0.17, 0.66, m.dark, [-0.3, 0, 0], [0, 0, Math.PI / 2]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    box(rtg, [0.6, 0.02, 0.14], m.dark, [-0.3, Math.cos(a) * 0.23, Math.sin(a) * 0.23], [a, 0, 0]);
  }

  // Brazo robótico plegado al frente con su torreta (taladro hacia abajo)
  beam(root, [0.9, 0.98, -0.55], [1.12, 1.0, -0.55], 0.07, m.white);
  beam(root, [1.12, 1.0, -0.55], [1.15, 1.0, 0.45], 0.07, m.white);
  beam(root, [1.15, 1.0, 0.45], [1.25, 0.88, -0.2], 0.06, m.white);
  box(root, [0.28, 0.24, 0.28], m.metal, [1.3, 0.82, -0.22]);
  cyl(root, 0.03, 0.02, 0.25, m.dark, [1.3, 0.6, -0.22]);
  // Hazcams frontales
  for (const z of [-0.25, 0.25]) box(root, [0.05, 0.06, 0.12], m.dark, [0.88, 0.85, z]);
}

/** Sojourner (Mars Pathfinder): caja pequeña con panel solar plano encima. */
function buildSojourner(root, wheels, sides) {
  const T = textures();
  const m = {
    body: mat(0xd8c9a2, 0.55, 0.3), dark: mat(0x232425, 0.5, 0.3), frame: mat(0xb0b4b8, 0.4, 0.7),
    solar: mat(0xffffff, 0.35, 0.4, { map: T.solar }),
  };
  const c = {
    r: 0.065, w: 0.07, zw: 0.2, xF: 0.24, xM: 0.0, xR: -0.24, rise: 0.07, t: 0.012,
    pivot: [0.04, 0.17], bogie: [-0.12, 0.12], bodyHalf: 0.13, style: 'sojourner',
  };
  for (const s of [-1, 1]) sides.push(rockerBogie(root, s, c, wheels, m));

  box(root, [0.42, 0.11, 0.26], m.body, [0, 0.19, 0]);
  for (const [x, z] of [[0.16, 0.1], [0.16, -0.1], [-0.16, 0.1], [-0.16, -0.1]]) {
    cyl(root, 0.005, 0.005, 0.04, m.frame, [x, 0.265, z]);
  }
  box(root, [0.56, 0.012, 0.36], m.solar, [0, 0.29, 0]);
  for (const z of [-0.05, 0.05]) box(root, [0.03, 0.03, 0.03], m.dark, [0.22, 0.2, z]);
  cyl(root, 0.004, 0.004, 0.26, m.frame, [-0.14, 0.42, 0.12]);
  cyl(root, 0.018, 0.018, 0.05, m.frame, [-0.24, 0.17, 0], [0, 0, 0.9]); // APXS
}

/** Yutu-2 (Chang'e 4): cuerpo dorado, dos alas solares y mástil de cámaras. */
function buildYutu2(root, wheels, sides) {
  const T = textures();
  const m = {
    foil: mat(0xffffff, 0.35, 0.8, { map: T.foil }), dark: mat(0x252629, 0.5, 0.4),
    frame: mat(0xc4c7cb, 0.4, 0.7), white: mat(0xe8e8e8, 0.5, 0.2),
    solar: mat(0xffffff, 0.35, 0.4, { map: T.solar, side: THREE.DoubleSide }),
  };
  const c = {
    r: 0.15, w: 0.15, zw: 0.44, xF: 0.55, xM: 0.0, xR: -0.55, rise: 0.15, t: 0.03,
    pivot: [0.1, 0.45], bogie: [-0.28, 0.32], bodyHalf: 0.31, style: 'yutu',
  };
  for (const s of [-1, 1]) sides.push(rockerBogie(root, s, c, wheels, m));

  box(root, [0.95, 0.4, 0.62], m.foil, [0, 0.62, 0]);
  box(root, [0.95, 0.02, 0.62], m.white, [0, 0.83, 0]);
  // Alas solares articuladas en los bordes superiores: una baja, la otra casi vertical
  for (const [s, ang] of [[-1, 0.35], [1, -1.15]]) {
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.84, s * 0.31);
    hinge.rotation.x = s * ang;
    root.add(hinge);
    box(hinge, [0.95, 0.015, 0.55], m.solar, [0, 0, s * 0.275]);
  }
  // Mástil con cámaras panorámicas y de navegación
  cyl(root, 0.025, 0.03, 0.55, m.frame, [0.38, 1.1, 0]);
  box(root, [0.12, 0.12, 0.36], m.white, [0.38, 1.42, 0]);
  for (const z of [-0.12, 0.12]) cyl(root, 0.03, 0.03, 0.05, m.dark, [0.46, 1.42, z], [0, 0, Math.PI / 2]);
  // Antena parabólica en la parte trasera
  cyl(root, 0.015, 0.015, 0.2, m.frame, [-0.38, 0.93, 0.12]);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 8, 0, Math.PI * 2, 0, Math.PI / 4),
    mat(0xf0f0f0, 0.4, 0.2, { side: THREE.DoubleSide })
  );
  dish.position.set(-0.38, 1.15, 0.12);
  dish.rotation.set(Math.PI, 0, -0.6);
  root.add(dish);
}

/** Apollo LRV: chasis abierto, dos asientos, guardabarros, antena paraguas y cámara de TV. */
function buildLRV(root, wheels, arms) {
  const T = textures();
  const m = {
    alu: mat(0xbcc0c4, 0.4, 0.7), dark: mat(0x2a2b2d, 0.5, 0.4), seat: mat(0x6f8196, 0.8, 0.05),
    fender: mat(0xa59a86, 0.6, 0.1, { side: THREE.DoubleSide }), foil: mat(0xd6d9dc, 0.3, 0.9),
    gold: mat(0xffffff, 0.35, 0.8, { map: T.foil }),
  };
  const r = 0.41, w = 0.23;

  // Chasis: largueros, travesaños y piso
  for (const z of [-0.62, 0.62]) beam(root, [-1.45, 0.5, z], [1.45, 0.5, z], 0.06, m.alu);
  for (const x of [-1.45, -0.6, 0.45, 1.45]) beam(root, [x, 0.5, -0.62], [x, 0.5, 0.62], 0.05, m.alu);
  box(root, [2.2, 0.02, 1.2], m.alu, [-0.1, 0.49, 0]);

  for (const x of [1.15, -1.15]) {
    for (const s of [-1, 1]) {
      const wh = makeWheel({ r, w, side: s, style: 'lrv' });
      wh.mount.position.set(x, r, s * 0.915);
      root.add(wh.mount);
      // Guardabarros: sube y baja con la rueda pero no gira con la dirección
      const fender = new THREE.Mesh(
        new THREE.CylinderGeometry(r + 0.07, r + 0.07, w + 0.1, 20, 1, true, Math.PI - 1.15, 2.3).rotateX(Math.PI / 2),
        m.fender
      );
      wh.mount.add(fender);
      cyl(wh.mount, 0.06, 0.06, 0.08, m.dark, [0, 0, -s * (w / 2 + 0.05)], [Math.PI / 2, 0, 0]); // motor de cubo
      const index = wheels.push({ ...wh, x, z: s * 0.915, r, w, steerable: true, side: s, restY: r }) - 1;
      // Brazos de suspensión: se recalculan cada cuadro porque la rueda sube y baja
      for (const dy of [0.07, -0.07]) {
        const mesh = beam(root, [0, 0, 0], [0, 1, 0], 0.035, m.alu);
        arms.push({
          mesh, index,
          chassis: new THREE.Vector3(x - Math.sign(x) * 0.35, 0.5 + dy * 0.5, s * 0.6),
          hub: new THREE.Vector3(0, dy, -s * (w / 2 + 0.08)),
        });
      }
    }
  }

  // Asientos plegables con respaldo
  for (const z of [-0.32, 0.32]) {
    box(root, [0.45, 0.04, 0.42], m.seat, [-0.15, 0.62, z]);
    box(root, [0.04, 0.5, 0.42], m.seat, [-0.4, 0.88, z], [0, 0, 0.2]);
    beam(root, [-0.35, 0.5, z], [-0.35, 0.6, z], 0.025, m.alu);
    beam(root, [0.05, 0.5, z], [0.05, 0.6, z], 0.025, m.alu);
  }
  // Consola de control y mando en T entre los asientos
  beam(root, [0.55, 0.5, 0], [0.62, 0.98, 0], 0.05, m.alu);
  box(root, [0.12, 0.26, 0.32], m.dark, [0.64, 1.06, 0], [0, 0, 0.35]);
  beam(root, [0.25, 0.5, 0], [0.25, 0.75, 0], 0.03, m.alu);
  box(root, [0.05, 0.03, 0.14], m.dark, [0.25, 0.77, 0]);

  // Antena de alta ganancia tipo paraguas y antena helicoidal de baja ganancia
  beam(root, [0.95, 0.5, -0.45], [0.95, 1.55, -0.45], 0.03, m.alu);
  const dish = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.16, 16, 1, true),
    mat(0xffffff, 0.5, 0.6, { map: T.mesh, alphaTest: 0.5, side: THREE.DoubleSide })
  );
  dish.position.set(0.95, 1.62, -0.45);
  dish.rotation.set(0, 0, Math.PI - 0.5);
  root.add(dish);
  beam(root, [0.95, 0.5, 0.45], [0.95, 1.15, 0.45], 0.02, m.alu);
  cyl(root, 0.035, 0.035, 0.3, m.foil, [0.95, 1.25, 0.45]);

  // Cámara de TV (GCTA) al frente y la unidad de comunicaciones (LCRU)
  beam(root, [1.35, 0.5, 0], [1.35, 1.05, 0], 0.03, m.alu);
  box(root, [0.24, 0.14, 0.14], m.foil, [1.38, 1.12, 0]);
  cyl(root, 0.035, 0.035, 0.06, m.dark, [1.52, 1.12, 0], [0, 0, Math.PI / 2]);
  box(root, [0.3, 0.28, 0.4], m.gold, [1.2, 0.68, 0]);
  // Plataforma trasera de herramientas
  box(root, [0.45, 0.35, 1.0], m.foil, [-1.25, 0.72, 0]);
  for (const z of [-0.4, -0.15, 0.15, 0.4]) beam(root, [-1.4, 0.9, z], [-1.4, 1.35, z], 0.02, m.alu);
}

/**
 * Arma el rover `id` y devuelve las piezas que anima el modo de conducción.
 * @returns {{root:THREE.Group, wheels:Array, sides:Array, arms:Array, spec:object, hl:number, hw:number}}
 *   hl / hw: semilargo y semiancho de la huella (m), para los límites del terreno.
 */
export function buildRover(id) {
  const spec = ROVERS[id];
  const root = new THREE.Group();
  const wheels = [], sides = [], arms = [];
  if (id === 'perseverance') buildPerseverance(root, wheels, sides);
  else if (id === 'sojourner') buildSojourner(root, wheels, sides);
  else if (id === 'yutu2') buildYutu2(root, wheels, sides);
  else buildLRV(root, wheels, arms);

  for (const wh of wheels) wh.restY ??= wh.mount.position.y;
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  const hl = Math.max(...wheels.map((wh) => Math.abs(wh.x) + wh.r));
  const hw = Math.max(...wheels.map((wh) => Math.abs(wh.z) + wh.w / 2));
  return { root, wheels, sides, arms, spec: { id, ...spec }, hl, hw };
}
