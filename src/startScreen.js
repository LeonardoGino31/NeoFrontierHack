// Pantalla de inicio de NeoFrontier: el emblema de la marca (contornos y órbita) sobre un
// cielo estrellado y una superficie lunar con el astronauta y la nave. Reacciona al mouse
// (paralaje entre capas, linterna sobre el terreno; cada clic lanza un meteoro y una onda
// desde el emblema) y la órbita del emblema muestra el progreso de carga. El botón EMPEZAR se habilita solo
// cuando la escena está lista: antes, pulsarlo mientras se subían las texturas dejaba la
// página congelada varios segundos.

import { createEmblem } from './startEmblem.js';
import { isMuted } from './audio.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SIGNAL_TRAVEL = 1.1; // segundos que tarda la señal del satélite en llegar a la nave
const SIGNAL_GLOW = 1.8;   // segundos que la nave queda "recibiendo" al llegar la señal

let audioCtx = null;
/**
 * Pitidos cortos sintetizados (sin archivos de audio). Respetan el botón de silencio.
 * @param {number[]} freqs  frecuencias (Hz) que suenan una tras otra
 */
function beep(freqs, gap = 0.12) {
  if (isMuted()) return;
  try {
    audioCtx ??= new AudioContext();
    const now = audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      const vol = audioCtx.createGain();
      const t0 = now + i * gap;
      osc.type = 'sine';
      osc.frequency.value = f;
      vol.gain.setValueAtTime(0, t0);
      vol.gain.linearRampToValueAtTime(0.07, t0 + 0.01);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(vol).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    });
  } catch { /* sin Web Audio la señal se ve igual, solo no suena */ }
}

/** Ruido 1D suave y repetible (suma de senos) para las siluetas del terreno. */
function ridge(x, seed, amp) {
  return (
    Math.sin(x * 0.9 + seed) * 0.5 +
    Math.sin(x * 2.1 + seed * 2.3) * 0.28 +
    Math.sin(x * 5.3 + seed * 4.1) * 0.12
  ) * amp;
}

/**
 * Dibuja y anima el fondo en un canvas 2D, y mueve el emblema en el mismo cuadro.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof createEmblem>} emblem
 * @returns {{ stop: () => void }}
 */
function startBackdrop(canvas, emblem) {
  const g = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, px: 0.5, py: 0.5 }; // x,y: -1..1 suavizado; px,py: 0..1
  const meteors = [];
  // Satélite (posición en pantalla del último cuadro, para el clic) y sus señales en vuelo
  const sat = { x: -999, y: -999, s: 1 };
  const signals = [];
  const dish = { x: 0, y: 0 }; // antena de la nave, destino de la señal
  let received = 0;            // tiempo restante del destello de "señal recibida"
  let raf = 0;
  let last = performance.now();
  let t = 0;

  // Estrellas en tres capas de profundidad (las lejanas casi no se mueven)
  const stars = Array.from({ length: 260 }, () => ({
    x: Math.random(), y: Math.random() * 0.75,
    z: Math.random(), tw: Math.random() * Math.PI * 2,
  }));
  // Polvo lunar flotando
  const dust = Array.from({ length: 40 }, () => ({
    x: Math.random(), y: 0.6 + Math.random() * 0.4,
    r: 0.6 + Math.random() * 1.4, v: 0.004 + Math.random() * 0.01,
  }));
  const rocks = Array.from({ length: 9 }, () => ({ x: Math.random(), y: 0.95 + Math.random() * 0.06, s: 0.012 + Math.random() * 0.03 }));
  const craters = Array.from({ length: 14 }, () => ({
    x: Math.random(), y: 0.82 + Math.random() * 0.16, r: 0.015 + Math.random() * 0.05,
  }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** ¿El puntero está sobre el satélite? (radio generoso: es pequeño y se mueve) */
  const onSatellite = (e) => Math.hypot(e.clientX - sat.x, e.clientY - sat.y) < 36 * sat.s;

  function onMove(e) {
    mouse.px = e.clientX / window.innerWidth;
    mouse.py = e.clientY / window.innerHeight;
    mouse.tx = mouse.px * 2 - 1;
    mouse.ty = mouse.py * 2 - 1;
    canvas.style.cursor = onSatellite(e) ? 'pointer' : '';
  }
  function onDown(e) {
    if (e.target.closest('.start-btn')) return;
    // El satélite manda una señal a la nave en vez de lanzar un meteoro
    if (onSatellite(e)) {
      signals.push({ age: 0, x: sat.x, y: sat.y });
      beep([1320, 1760]);
      return;
    }
    // Cada clic lanza un meteoro y una onda de contorno desde el emblema
    spawnMeteor();
    if (!reducedMotion) emblem.ripple();
  }

  /** Silueta del terreno de una capa: un polígono con relieve que se desplaza con el mouse. */
  function drawRidge(base, amp, seed, color, shift, light) {
    const off = shift * mouse.x;
    g.beginPath();
    g.moveTo(-20, h);
    for (let x = -20; x <= w + 20; x += 8) {
      const y = h * base + ridge(x / w * 6 + off * 0.01 + seed, seed, amp * h);
      g.lineTo(x, y);
    }
    g.lineTo(w + 20, h);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    // Borde iluminado por la "linterna" del cursor
    if (light) {
      const grad = g.createRadialGradient(mouse.px * w, mouse.py * h, 0, mouse.px * w, mouse.py * h, w * 0.35);
      grad.addColorStop(0, 'rgba(160,210,255,0.22)');
      grad.addColorStop(1, 'rgba(160,210,255,0)');
      g.fillStyle = grad;
      g.fill();
    }
  }


  /** Lanza un meteoro desde arriba o desde el borde izquierdo, grande y con estela. */
  function spawnMeteor() {
    const angle = 0.25 + Math.random() * 0.5; // radianes bajo la horizontal
    const speed = 600 + Math.random() * 400;
    const fromTop = Math.random() < 0.5;
    meteors.push({
      x: fromTop ? Math.random() * w * 0.7 : -40,
      y: fromTop ? -30 : Math.random() * h * 0.35,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 3, tail: 220 + Math.random() * 220,
      life: 0, max: 1.6 + Math.random() * 1.2,
    });
  }

  /** Brillo de nebulosa detrás de las estrellas. */
  function drawNebula() {
    const blobs = [
      [0.5, 0.35, 0.55, 'rgba(40,58,150,0.30)'],  // resplandor azul de la marca tras el emblema
      [0.15, 0.18, 0.36, 'rgba(70,60,170,0.16)'],
      [0.85, 0.2, 0.32, 'rgba(255,107,53,0.06)'], // un toque del naranja de la marca
    ];
    for (const [bx, by, br, color] of blobs) {
      const x = bx * w + mouse.x * -10, y = by * h + mouse.y * -6, r = br * Math.max(w, h) * 0.6;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  /** Marte pequeño y lejano, con casquete polar y una mancha oscura que gira despacio. */
  function drawMars() {
    const r = Math.min(w, h) * 0.035;
    const x = w * 0.13 + mouse.x * -8, y = h * 0.2 + mouse.y * -5;
    const halo = g.createRadialGradient(x, y, r * 0.9, x, y, r * 2.4);
    halo.addColorStop(0, 'rgba(255,120,60,0.18)');
    halo.addColorStop(1, 'rgba(255,120,60,0)');
    g.fillStyle = halo;
    g.fillRect(x - r * 2.5, y - r * 2.5, r * 5, r * 5);
    const body = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    body.addColorStop(0, '#ffb07a');
    body.addColorStop(0.6, '#c4552d');
    body.addColorStop(1, '#4a1a10');
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(x, y - r * 0.9, r * 0.35, r * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(90,30,15,0.5)';
    g.beginPath();
    g.ellipse(x + Math.sin(t * 0.05) * r * 0.3, y + r * 0.1, r * 0.4, r * 0.18, 0.3, 0, Math.PI * 2);
    g.fill();
  }

  /** Luna creciente al fondo, con mares oscuros y el lado de sombra hacia la derecha. */
  function drawMoon() {
    const r = Math.min(w, h) * 0.05;
    const x = w * 0.86 + mouse.x * -10, y = h * 0.15 + mouse.y * -6;
    const halo = g.createRadialGradient(x, y, r * 0.9, x, y, r * 2.6);
    halo.addColorStop(0, 'rgba(220,228,255,0.16)');
    halo.addColorStop(1, 'rgba(220,228,255,0)');
    g.fillStyle = halo;
    g.fillRect(x - r * 2.7, y - r * 2.7, r * 5.4, r * 5.4);
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.clip();
    const body = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, '#f1f3f8');
    body.addColorStop(1, '#a9b0c4');
    g.fillStyle = body;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.fillStyle = 'rgba(110,118,145,0.45)'; // mares
    for (const [mx, my, mr] of [[-0.3, -0.2, 0.28], [0.15, 0.25, 0.22], [0.3, -0.35, 0.14], [-0.15, 0.45, 0.12]]) {
      g.beginPath();
      g.arc(x + mx * r, y + my * r, mr * r, 0, Math.PI * 2);
      g.fill();
    }
    const shade = g.createLinearGradient(x - r, y, x + r, y);
    shade.addColorStop(0.45, 'rgba(7,11,34,0)');
    shade.addColorStop(1, 'rgba(7,11,34,0.75)');
    g.fillStyle = shade;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }

  /** Satélite que cruza el cielo; al hacerle clic emite una señal hacia la nave. */
  function drawSatellite(u) {
    const s = 1.3 * u;
    const x = ((t * 22) % (w + 200)) - 100 + mouse.x * -12;
    const y = h * 0.1 + Math.sin(t * 0.2) * 6 + mouse.y * -6;
    Object.assign(sat, { x, y, s });
    const sending = signals.length > 0;
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.rotate(-0.2);
    g.fillStyle = '#9fb0cf';
    g.fillRect(-5, -4, 10, 8);
    g.fillStyle = '#3566c9';
    g.fillRect(-26, -3, 18, 6);
    g.fillRect(8, -3, 18, 6);
    g.strokeStyle = 'rgba(160,200,255,0.5)'; // celdas de los paneles
    g.lineWidth = 0.6;
    g.beginPath();
    for (const px of [-20, -14, 14, 20]) { g.moveTo(px, -3); g.lineTo(px, 3); }
    g.stroke();
    g.fillStyle = '#c7d2e8';
    g.fillRect(-1, -9, 2, 5);
    // Antena parabólica hacia abajo: de ahí sale la señal
    g.fillStyle = sending ? '#ffd8c4' : '#e6e9f2';
    g.beginPath();
    g.ellipse(0, 7, 6, 2.2, 0, 0, Math.PI);
    g.fill();
    if (Math.sin(t * 5) > 0.3 || sending) {
      g.fillStyle = sending ? 'rgba(255,107,53,1)' : 'rgba(255,80,80,0.95)';
      g.beginPath();
      g.arc(0, -10, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /**
   * Señales en vuelo: ondas que salen del satélite y un pulso naranja que baja hasta la
   * antena de la nave. Al llegar, la nave "responde" con su propio pitido y un destello.
   */
  function drawSignals(dt) {
    for (let i = signals.length - 1; i >= 0; i--) {
      const sg = signals[i];
      sg.age += dt;
      const k = Math.min(1, sg.age / SIGNAL_TRAVEL);
      // Tres frentes de onda, escalonados, que se abren y se apagan
      for (let j = 0; j < 3; j++) {
        const a = sg.age - j * 0.18;
        if (a <= 0 || a > 1) continue;
        g.strokeStyle = `rgba(255,140,90,${(1 - a) * 0.8})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(sg.x, sg.y, 8 + a * 70 * sat.s, 0, Math.PI * 2);
        g.stroke();
      }
      // El pulso viaja por una línea punteada hacia la antena (que se mueve con el paralaje)
      if (k < 1) {
        const px = sg.x + (dish.x - sg.x) * k, py = sg.y + (dish.y - sg.y) * k;
        g.strokeStyle = 'rgba(255,107,53,0.35)';
        g.setLineDash([4, 8]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(sg.x, sg.y);
        g.lineTo(px, py);
        g.stroke();
        g.setLineDash([]);
        const glow = g.createRadialGradient(px, py, 0, px, py, 14);
        glow.addColorStop(0, 'rgba(255,240,220,1)');
        glow.addColorStop(0.3, 'rgba(255,107,53,0.8)');
        glow.addColorStop(1, 'rgba(255,107,53,0)');
        g.fillStyle = glow;
        g.fillRect(px - 14, py - 14, 28, 28);
      } else if (!sg.arrived) {
        sg.arrived = true;
        received = SIGNAL_GLOW;
        beep([880, 1175, 1568], 0.09); // la nave contesta
      }
      if (sg.age > Math.max(SIGNAL_TRAVEL, 1.4)) signals.splice(i, 1);
    }
    // Destello en la antena mientras la nave "recibe"
    if (received > 0) {
      received = Math.max(0, received - dt);
      const a = received / SIGNAL_GLOW;
      const r = 18 + (1 - a) * 40;
      g.strokeStyle = `rgba(255,140,90,${a})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(dish.x, dish.y, r, 0, Math.PI * 2);
      g.stroke();
      const glow = g.createRadialGradient(dish.x, dish.y, 0, dish.x, dish.y, 22);
      glow.addColorStop(0, `rgba(255,230,200,${a})`);
      glow.addColorStop(1, 'rgba(255,107,53,0)');
      g.fillStyle = glow;
      g.fillRect(dish.x - 22, dish.y - 22, 44, 44);
    }
  }

  /** Astronauta de pie: saluda, mira al cursor y se anima más si el mouse se acerca. */
  function drawAstronaut(x, y, s) {
    const dx = mouse.px * w - x, dy = mouse.py * h - (y - 80 * s);
    // Saluda con ganas si el mouse se acerca o si la nave acaba de recibir una señal
    const near = Math.hypot(dx, dy) < w * 0.22 || received > 0;
    const look = Math.max(-1, Math.min(1, dx / (w * 0.4)));
    const lookY = Math.max(-1, Math.min(1, dy / (h * 0.4)));
    const bob = Math.sin(t * 1.6) * 1.2;
    const wave = Math.sin(t * (near ? 7 : 2.5)) * (near ? 0.45 : 0.2);
    const blink = Math.sin(t * 4) > 0;

    g.save();
    g.translate(x, y + bob * s);
    g.scale(s, s);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(10, 2, 30, 5, 0, 0, Math.PI * 2);
    g.fill();

    const suit = g.createLinearGradient(-18, 0, 18, 0);
    suit.addColorStop(0, '#f1f4fb');
    suit.addColorStop(0.7, '#d4dbea');
    suit.addColorStop(1, '#8fa3d4'); // reflejo azul de la Tierra a la derecha
    const shade = '#aab5cf';

    // Mochila de soporte vital: más oscura que el traje y más alta que el hombro, para que
    // se lea como un equipo a la espalda y no como parte del torso
    const pack = g.createLinearGradient(-30, 0, -12, 0);
    pack.addColorStop(0, '#7f8bab');
    pack.addColorStop(1, '#aeb8d0');
    g.fillStyle = pack;
    g.strokeStyle = '#5d6889';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(-30, -82, 20, 46, 6);
    g.fill();
    g.stroke();
    g.fillStyle = '#c9d0e2'; // tapa superior
    g.beginPath();
    g.roundRect(-31, -85, 22, 7, 3);
    g.fill();
    g.strokeStyle = '#5d6889'; // rejillas de ventilación
    g.lineWidth = 1.2;
    g.beginPath();
    for (const vy of [-52, -47, -42]) { g.moveTo(-27, vy); g.lineTo(-20, vy); }
    g.stroke();
    // Manguera de la mochila al casco
    g.strokeStyle = '#8c97b4';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-24, -78);
    g.quadraticCurveTo(-22, -96, -10, -96);
    g.stroke();

    // Piernas y botas
    g.strokeStyle = shade;
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(-6, -30); g.lineTo(-8, -6);
    g.moveTo(7, -30); g.lineTo(10, -6);
    g.stroke();
    g.fillStyle = '#4b5470';
    g.beginPath();
    g.roundRect(-16, -8, 16, 9, 4);
    g.roundRect(1, -8, 17, 9, 4);
    g.fill();

    // Brazo izquierdo (saluda). El brazo sale hacia el costado y el antebrazo pivota
    // sobre el codo: si la mano se moviera por su cuenta, el codo se doblaría al revés.
    const elbowX = -33, elbowY = -76 + Math.sin(wave) * 1.5;
    const handX = elbowX + Math.sin(wave) * 21, handY = elbowY - Math.cos(wave) * 21;
    g.strokeStyle = shade;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-13, -64);
    g.lineTo(elbowX, elbowY);
    g.lineTo(handX, handY);
    g.stroke();
    g.fillStyle = '#c3cbdd'; // codera: marca la articulación
    g.beginPath();
    g.arc(elbowX, elbowY, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8ecf6';
    g.beginPath();
    g.arc(handX, handY - 2, 5.5, 0, Math.PI * 2);
    g.fill();

    // Torso con panel de control
    g.fillStyle = suit;
    g.beginPath();
    g.roundRect(-16, -72, 32, 44, 10);
    g.fill();
    g.fillStyle = '#2c3556';
    g.fillRect(-9, -62, 18, 11);
    g.fillStyle = blink ? '#ff5a4d' : '#7a2a28';
    g.fillRect(-7, -60, 4, 3);
    g.fillStyle = '#4ade80';
    g.fillRect(-1, -60, 4, 3);
    g.fillStyle = '#facc15';
    g.fillRect(5, -60, 3, 3);
    g.fillStyle = '#7b86a6';
    g.fillRect(-16, -34, 32, 4);

    // Brazo derecho (caído)
    g.strokeStyle = shade;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(15, -62);
    g.lineTo(21, -46 + bob);
    g.lineTo(20, -33);
    g.stroke();
    g.fillStyle = '#e8ecf6';
    g.beginPath();
    g.arc(20, -30, 5.5, 0, Math.PI * 2);
    g.fill();

    // Cuello y casco
    g.fillStyle = '#c3cbdd';
    g.fillRect(-7, -77, 14, 7);
    const hx = look * 2, hy = -90;
    g.fillStyle = suit;
    g.beginPath();
    g.arc(hx, hy, 17, 0, Math.PI * 2);
    g.fill();
    // Visor dorado; se desplaza hacia donde mira el cursor
    const vx = hx + look * 5, vy = hy + lookY * 3;
    const visor = g.createRadialGradient(vx - 5, vy - 6, 1, vx, vy, 14);
    visor.addColorStop(0, '#ffe9a8');
    visor.addColorStop(0.35, '#b07a1f');
    visor.addColorStop(1, '#1b1408');
    g.fillStyle = visor;
    g.beginPath();
    g.ellipse(vx, vy, 11.5, 9.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(120,190,255,0.55)'; // la Tierra reflejada
    g.beginPath();
    g.arc(vx + 4, vy + 2, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(vx - 5, vy - 4, 3, 1.6, -0.6, 0, Math.PI * 2);
    g.fill();
    // Antena del casco
    g.strokeStyle = '#c3cbdd';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-12, -102); g.lineTo(-16, -114);
    g.stroke();
    g.fillStyle = blink ? '#ff5a4d' : '#7a2a28';
    g.beginPath();
    g.arc(-16, -115, 1.8, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Nave de exploración aterrizada: fuselaje con paneles, aletas, patas, escalera y luces. */
  function drawLander(x, y, s) {
    const blink = Math.sin(t * 3) > 0;
    const glow = 0.5 + 0.5 * Math.sin(t * 2);
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Sombra y charco de luz de la escotilla sobre el suelo
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(14, 3, 92, 9, 0, 0, Math.PI * 2);
    g.fill();
    const pool = g.createRadialGradient(46, 2, 0, 46, 2, 60);
    pool.addColorStop(0, `rgba(255,220,140,${0.28 + glow * 0.1})`);
    pool.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = pool;
    g.beginPath();
    g.ellipse(46, 2, 60, 9, 0, 0, Math.PI * 2);
    g.fill();

    // Patas con puntales y platos de apoyo (la central queda detrás del fuselaje)
    g.strokeStyle = '#7d879f';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-18, -36); g.lineTo(-62, -3);
    g.moveTo(18, -36); g.lineTo(66, -3);
    g.moveTo(0, -30); g.lineTo(2, -3);
    g.stroke();
    g.strokeStyle = '#a9b2c8';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-24, -62); g.lineTo(-46, -20);
    g.moveTo(24, -62); g.lineTo(50, -20);
    g.stroke();
    g.fillStyle = '#c7ceda';
    for (const px of [-64, 2, 68]) {
      g.beginPath();
      g.ellipse(px, -2, 12, 3.5, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Aletas laterales (acento naranja)
    g.fillStyle = '#c8461f';
    g.beginPath();
    g.moveTo(-26, -62); g.lineTo(-52, -22); g.lineTo(-26, -30);
    g.closePath();
    g.moveTo(26, -62); g.lineTo(52, -22); g.lineTo(26, -30);
    g.closePath();
    g.fill();
    g.fillStyle = '#8f2c10';
    g.beginPath();
    g.moveTo(-26, -62); g.lineTo(-52, -22); g.lineTo(-45, -22); g.lineTo(-26, -52);
    g.closePath();
    g.fill();

    // Tobera del motor con su brillo
    const engine = g.createRadialGradient(0, -16, 1, 0, -16, 26);
    engine.addColorStop(0, `rgba(255,170,80,${0.55 + glow * 0.3})`);
    engine.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = engine;
    g.fillRect(-28, -42, 56, 40);
    g.fillStyle = '#2b3042';
    g.beginPath();
    g.moveTo(-10, -30); g.lineTo(-17, -12); g.lineTo(17, -12); g.lineTo(10, -30);
    g.closePath();
    g.fill();

    // Fuselaje cilíndrico (luz a la izquierda, reflejo azul de la Tierra a la derecha)
    const body = g.createLinearGradient(-28, 0, 28, 0);
    body.addColorStop(0, '#f4f6fb');
    body.addColorStop(0.45, '#d5dbe9');
    body.addColorStop(0.85, '#8e9bb8');
    body.addColorStop(1, '#6f8fd0');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-26, -30);
    g.lineTo(-26, -132);
    g.quadraticCurveTo(-24, -168, 0, -190);
    g.quadraticCurveTo(24, -168, 26, -132);
    g.lineTo(26, -30);
    g.closePath();
    g.fill();

    // Escudo térmico oscuro en la base y banda naranja
    g.fillStyle = '#2f364d';
    g.fillRect(-26, -42, 52, 12);
    g.fillStyle = '#ff6b35';
    g.fillRect(-26, -50, 52, 6);

    // Líneas de paneles y remaches
    g.strokeStyle = 'rgba(60,72,104,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    for (const py of [-70, -96, -126]) {
      g.moveTo(-26, py); g.lineTo(26, py);
    }
    g.moveTo(-8, -126); g.lineTo(-8, -96);
    g.moveTo(10, -96); g.lineTo(10, -70);
    g.stroke();
    g.fillStyle = 'rgba(60,72,104,0.55)';
    for (const py of [-70, -96, -126]) {
      for (const px of [-21, 21]) {
        g.beginPath();
        g.arc(px, py + 4, 1, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Emblema NeoFrontier: estrella de la marca con su órbita naranja
    g.fillStyle = '#0d1433';
    g.beginPath();
    g.moveTo(0, -90);
    g.quadraticCurveTo(1, -83, 8, -82);
    g.quadraticCurveTo(1, -81, 0, -74);
    g.quadraticCurveTo(-1, -81, -8, -82);
    g.quadraticCurveTo(-1, -83, 0, -90);
    g.fill();
    g.strokeStyle = '#ff6b35';
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(0, -82, 15, 4, -0.25, 0, Math.PI * 2);
    g.stroke();

    // Ventanillas con luz interior
    for (const px of [-13, 0, 13]) {
      const lit = g.createRadialGradient(px - 1, -113, 0.5, px, -111, 6);
      lit.addColorStop(0, '#fff3c0');
      lit.addColorStop(0.5, '#4aa8e8');
      lit.addColorStop(1, '#16407a');
      g.fillStyle = lit;
      g.strokeStyle = '#4b5470';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(px, -111, 5.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Escotilla iluminada y escalera
    g.fillStyle = '#ffe6a0';
    g.fillRect(8, -66, 12, 16);
    g.strokeStyle = '#4b5470';
    g.lineWidth = 1.5;
    g.strokeRect(8, -66, 12, 16);
    g.strokeStyle = '#a9b2c8';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(24, -50); g.lineTo(40, -2);
    g.moveTo(30, -50); g.lineTo(46, -2);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 1; i <= 6; i++) {
      const ty = -50 + i * 8;
      const k = (ty + 50) / 48;
      g.moveTo(24 + 16 * k, ty); g.lineTo(30 + 16 * k, ty);
    }
    g.stroke();

    // Antena parabólica lateral y mástil con baliza
    g.strokeStyle = '#c7ceda';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-26, -118); g.lineTo(-40, -132);
    g.stroke();
    g.fillStyle = '#e6e9f2';
    g.beginPath();
    g.ellipse(-42, -134, 12, 4, -0.8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c7ceda';
    g.beginPath();
    g.moveTo(0, -190); g.lineTo(0, -206);
    g.stroke();
    if (blink) {
      const beacon = g.createRadialGradient(0, -207, 0, 0, -207, 12);
      beacon.addColorStop(0, 'rgba(255,90,80,1)');
      beacon.addColorStop(1, 'rgba(255,90,80,0)');
      g.fillStyle = beacon;
      g.fillRect(-12, -219, 24, 24);
    }
    g.fillStyle = blink ? '#ff5a4d' : '#7a2a28';
    g.beginPath();
    g.arc(0, -207, 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Rocas sueltas del primer plano. */
  function drawRocks() {
    for (const r of rocks) {
      const x = r.x * w + mouse.x * -46, y = h * r.y, sz = r.s * Math.min(w, h);
      const grad = g.createLinearGradient(x - sz, y - sz, x + sz, y);
      grad.addColorStop(0, '#5a6286');
      grad.addColorStop(1, '#1d2340');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - sz, y);
      g.lineTo(x - sz * 0.7, y - sz * 0.7);
      g.lineTo(x - sz * 0.1, y - sz);
      g.lineTo(x + sz * 0.6, y - sz * 0.6);
      g.lineTo(x + sz, y);
      g.closePath();
      g.fill();
    }
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-4 * dt));
    mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-4 * dt));

    // Cielo
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#070b22'); // azul noche de la marca
    sky.addColorStop(0.7, '#0d1440');
    sky.addColorStop(1, '#141c4f');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // Estrellas con paralaje y parpadeo
    for (const s of stars) {
      const depth = 0.2 + s.z * 0.8;
      const x = ((s.x * w + mouse.x * -22 * depth - t * 2 * depth) % w + w) % w;
      const y = s.y * h + mouse.y * -14 * depth;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.8 + s.z * 2) + s.tw));
      g.fillStyle = `rgba(220,235,255,${(a * (0.4 + depth * 0.6)).toFixed(3)})`;
      const size = 0.5 + depth * 1.4;
      g.fillRect(x, y, size, size);
    }

    // Meteoros grandes: cabeza brillante con halo y una estela larga
    if (!reducedMotion && Math.random() < dt * 0.55) spawnMeteor();
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const a = Math.max(0, Math.min(1, (m.max - m.life) / (m.max * 0.4)));
      const speed = Math.hypot(m.vx, m.vy);
      const tx = m.x - (m.vx / speed) * m.tail, ty = m.y - (m.vy / speed) * m.tail;
      const tail = g.createLinearGradient(m.x, m.y, tx, ty);
      tail.addColorStop(0, `rgba(255,240,210,${a})`);
      tail.addColorStop(0.3, `rgba(255,170,90,${a * 0.55})`);
      tail.addColorStop(1, 'rgba(255,110,60,0)');
      g.strokeStyle = tail;
      g.lineCap = 'round';
      g.lineWidth = m.size * 1.6;
      g.beginPath();
      g.moveTo(m.x, m.y);
      g.lineTo(tx, ty);
      g.stroke();
      const halo = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 6);
      halo.addColorStop(0, `rgba(255,245,220,${a})`);
      halo.addColorStop(0.25, `rgba(255,190,120,${a * 0.5})`);
      halo.addColorStop(1, 'rgba(255,150,80,0)');
      g.fillStyle = halo;
      g.fillRect(m.x - m.size * 6, m.y - m.size * 6, m.size * 12, m.size * 12);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      g.fill();
      if (m.life > m.max || m.x > w + 200 || m.y > h) meteors.splice(i, 1);
    }

    drawNebula();
    const u = Math.min(w, h) / 720; // escala según el tamaño de la ventana
    drawMars();
    drawMoon();
    drawSatellite(u);

    // Capas del terreno, de la más lejana a la más cercana
    drawRidge(0.74, 0.035, 1.3, '#1a2036', 6, false);
    drawRidge(0.82, 0.05, 4.1, '#252c47', 14, true);
    // Cráteres antes de la escenografía: si no, quedan pintados encima del astronauta y la nave
    g.fillStyle = 'rgba(10,14,30,0.45)';
    for (const c of craters) {
      const x = c.x * w + mouse.x * -34;
      g.beginPath();
      g.ellipse(x, c.y * h, c.r * w, c.r * w * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Escenografía entre la capa media y la cercana: nave y astronauta
    const landerX = w * 0.85 + mouse.x * -22, landerY = h * 0.9, landerS = 1.9 * u;
    drawLander(landerX, landerY, landerS);
    // Antena parabólica de la nave (coordenadas locales -42, -134): destino de las señales
    dish.x = landerX - 42 * landerS;
    dish.y = landerY - 134 * landerS;
    drawAstronaut(w * 0.17 + mouse.x * -30, h * 0.915, 1.7 * u);
    drawRidge(0.92, 0.04, 7.7, '#323a5a', 30, true);
    drawRocks();

    // Polvo
    for (const d of dust) {
      d.x = (d.x + d.v * dt) % 1;
      g.fillStyle = 'rgba(200,215,255,0.35)';
      g.beginPath();
      g.arc(d.x * w + mouse.x * -40, d.y * h + Math.sin(t + d.x * 9) * 4, d.r, 0, Math.PI * 2);
      g.fill();
    }

    drawSignals(dt);
    emblem.update(t, dt, mouse.x, mouse.y);

    if (!reducedMotion) raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onDown);
  last = performance.now();
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    },
  };
}

/**
 * Muestra la pantalla de inicio sobre la escena.
 * @param {{ onStart: () => void }} deps  onStart se llama una sola vez, al pulsar el botón.
 * @returns {{ setProgress: (f: number) => void, ready: () => void, fail: (msg: string) => void }}
 */
export function createStartScreen({ onStart }) {
  const screen = document.createElement('div');
  screen.id = 'start-screen';
  screen.innerHTML = `
    <canvas class="start-canvas" aria-hidden="true"></canvas>
    <div class="start-card">
      <svg class="start-emblem" role="progressbar" aria-label="Carga de la escena"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></svg>
      <h1>NEO FRONTIER</h1>
      <p class="start-tagline">nasa space apps challenge</p>
      <p class="start-sub">Lugares de la Tierra que se parecen a la Luna y a Marte.</p>
      <button class="start-btn" disabled>Cargando…</button>
      <p class="start-hint">Te llevamos a un análogo al azar; usa ‹ › para recorrer el resto.<br>La música se activa al empezar.</p>
    </div>`;
  document.body.appendChild(screen);

  const svg = screen.querySelector('.start-emblem');
  const emblem = createEmblem(svg);
  const backdrop = startBackdrop(screen.querySelector('.start-canvas'), emblem);
  const button = screen.querySelector('.start-btn');
  // Sin animación no hay bucle de cuadros: el emblema se redibuja en cada cambio
  const redraw = () => { if (reducedMotion) emblem.update(0, 0, 0, 0); };

  button.addEventListener('click', () => {
    screen.classList.add('leaving');
    // Se quita después del fundido para que no siga capturando clics sobre la escena
    screen.addEventListener('transitionend', () => {
      backdrop.stop();
      screen.remove();
    }, { once: true });
    onStart();
  }, { once: true });

  return {
    /** Avance de la carga, de 0 a 1: dibuja esa parte de la órbita. */
    setProgress(f) {
      emblem.setProgress(f);
      svg.setAttribute('aria-valuenow', String(Math.round(Math.min(1, Math.max(0, f)) * 100)));
      redraw();
    },
    /** La escena está lista: cierra la órbita y habilita el botón. */
    ready() {
      emblem.ready();
      redraw();
      button.disabled = false;
      button.textContent = 'Empezar';
      button.focus();
    },
    /** Error irrecuperable de carga: la órbita se pone roja. */
    fail(message) {
      svg.classList.add('failed');
      button.textContent = 'Error';
      screen.querySelector('.start-hint').textContent = message;
    },
  };
}
