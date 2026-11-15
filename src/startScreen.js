// Pantalla de inicio de NeoFrontier: una superficie lunar animada con la Tierra en el
// horizonte. Reacciona al mouse (paralaje entre capas, linterna sobre el terreno, clic
// que lanza una onda) y muestra el progreso de carga. El botón EMPEZAR se habilita solo
// cuando la escena está lista: antes, pulsarlo mientras se subían las texturas dejaba la
// página congelada varios segundos.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ruido 1D suave y repetible (suma de senos) para las siluetas del terreno. */
function ridge(x, seed, amp) {
  return (
    Math.sin(x * 0.9 + seed) * 0.5 +
    Math.sin(x * 2.1 + seed * 2.3) * 0.28 +
    Math.sin(x * 5.3 + seed * 4.1) * 0.12
  ) * amp;
}

/**
 * Dibuja y anima el fondo en un canvas 2D. Devuelve { stop, pulse }.
 * @param {HTMLCanvasElement} canvas
 */
function startBackdrop(canvas) {
  const g = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, px: 0.5, py: 0.5 }; // x,y: -1..1 suavizado; px,py: 0..1
  const ripples = [];
  const meteors = [];
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

  function onMove(e) {
    mouse.px = e.clientX / window.innerWidth;
    mouse.py = e.clientY / window.innerHeight;
    mouse.tx = mouse.px * 2 - 1;
    mouse.ty = mouse.py * 2 - 1;
  }
  function onDown(e) {
    if (e.target.closest('.start-btn')) return;
    ripples.push({ x: e.clientX, y: e.clientY, age: 0 });
    spawnMeteor(); // cada clic también lanza un meteoro
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
      [0.2, 0.22, 0.38, 'rgba(120,60,200,0.16)'],
      [0.78, 0.12, 0.34, 'rgba(40,120,220,0.14)'],
      [0.5, 0.45, 0.45, 'rgba(200,70,140,0.07)'],
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

  /** Marte pequeño y lejano, con casquete polar. */
  function drawMars() {
    const r = Math.min(w, h) * 0.035;
    const x = w * 0.14 + mouse.x * -8, y = h * 0.2 + mouse.y * -5;
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

  /** Satélite que cruza el cielo con una luz que parpadea. */
  function drawSatellite() {
    const x = ((t * 22) % (w + 200)) - 100 + mouse.x * -12;
    const y = h * 0.1 + Math.sin(t * 0.2) * 6 + mouse.y * -6;
    g.save();
    g.translate(x, y);
    g.rotate(-0.2);
    g.fillStyle = '#9fb0cf';
    g.fillRect(-5, -4, 10, 8);
    g.fillStyle = '#3566c9';
    g.fillRect(-26, -3, 18, 6);
    g.fillRect(8, -3, 18, 6);
    g.fillStyle = '#c7d2e8';
    g.fillRect(-1, -9, 2, 5);
    if (Math.sin(t * 5) > 0.3) {
      g.fillStyle = 'rgba(255,80,80,0.95)';
      g.beginPath();
      g.arc(0, -10, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** Astronauta de pie: saluda, mira al cursor y se anima más si el mouse se acerca. */
  function drawAstronaut(x, y, s) {
    const dx = mouse.px * w - x, dy = mouse.py * h - (y - 80 * s);
    const near = Math.hypot(dx, dy) < w * 0.22;
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

    // Mochila de soporte vital
    g.fillStyle = '#c3cbdd';
    g.beginPath();
    g.roundRect(-24, -70, 14, 34, 4);
    g.fill();

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

    // Brazo izquierdo (saluda)
    g.strokeStyle = shade;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-14, -62);
    g.lineTo(-24 - Math.sin(wave) * 4, -78 - Math.cos(wave) * 10);
    g.lineTo(-30 + wave * 16, -98 - Math.abs(wave) * 6);
    g.stroke();
    g.fillStyle = '#e8ecf6';
    g.beginPath();
    g.arc(-30 + wave * 16, -100 - Math.abs(wave) * 6, 5.5, 0, Math.PI * 2);
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

  /** Bandera de NeoFrontier plantada, con la tela ondeando. */
  function drawFlag(x, y, s) {
    const poleH = 120 * s;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x + 8 * s, y, 26 * s, 4 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#cfd6e6';
    g.lineWidth = 2.5 * s;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - poleH);
    g.stroke();
    const fw = 70 * s, fh = 44 * s, top = y - poleH + 4 * s;
    const cloth = (dx) => Math.sin(t * 2.4 + dx / (9 * s)) * 4 * s * (dx / fw);
    g.beginPath();
    g.moveTo(x, top);
    for (let i = 0; i <= 14; i++) g.lineTo(x + (fw * i) / 14, top + cloth((fw * i) / 14));
    for (let i = 14; i >= 0; i--) g.lineTo(x + (fw * i) / 14, top + fh + cloth((fw * i) / 14));
    g.closePath();
    const grad = g.createLinearGradient(x, top, x + fw, top + fh);
    grad.addColorStop(0, '#16336e');
    grad.addColorStop(1, '#0b1b45');
    g.fillStyle = grad;
    g.fill();
    // Emblema: planeta con anillo
    const ex = x + fw * 0.5, ey = top + fh * 0.5 + cloth(fw * 0.5);
    g.strokeStyle = '#facc15';
    g.lineWidth = 2 * s;
    g.beginPath();
    g.arc(ex, ey, 9 * s, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(ex, ey, 15 * s, 4 * s, -0.4, 0, Math.PI * 2);
    g.stroke();
  }

  /** Módulo lunar dorado con antena parabólica y patas. */
  function drawLander(x, y, s) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(10, 2, 80, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#9aa3b8';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-30, -52); g.lineTo(-70, -2);
    g.moveTo(30, -52); g.lineTo(72, -2);
    g.moveTo(-12, -48); g.lineTo(-26, -2);
    g.moveTo(14, -48); g.lineTo(30, -2);
    g.stroke();
    g.fillStyle = '#c7ceda';
    for (const px of [-70, -26, 30, 72]) {
      g.beginPath();
      g.ellipse(px, -1, 11, 3, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Etapa de descenso (envoltura dorada)
    const gold = g.createLinearGradient(-40, -90, 40, -40);
    gold.addColorStop(0, '#f0c75a');
    gold.addColorStop(0.5, '#a8741c');
    gold.addColorStop(1, '#5e3f0e');
    g.fillStyle = gold;
    g.beginPath();
    g.moveTo(-40, -52); g.lineTo(-30, -90); g.lineTo(30, -90); g.lineTo(40, -52);
    g.closePath();
    g.fill();
    // Etapa de ascenso
    g.fillStyle = '#d6dbe6';
    g.beginPath();
    g.moveTo(-26, -90); g.lineTo(-20, -128); g.lineTo(20, -128); g.lineTo(26, -90);
    g.closePath();
    g.fill();
    g.fillStyle = '#1a2038';
    g.beginPath();
    g.moveTo(-14, -114); g.lineTo(-6, -122); g.lineTo(-6, -108);
    g.closePath();
    g.moveTo(14, -114); g.lineTo(6, -122); g.lineTo(6, -108);
    g.closePath();
    g.fill();
    // Antena parabólica
    g.strokeStyle = '#c7ceda';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(10, -128); g.lineTo(24, -150);
    g.stroke();
    g.fillStyle = '#e6e9f2';
    g.beginPath();
    g.ellipse(24, -152, 12, 4, -0.7, 0, Math.PI * 2);
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

  function drawEarth() {
    const r = Math.min(w, h) * 0.075;
    const x = w * 0.64 + mouse.x * -14;
    const y = h * 0.3 + mouse.y * -9;
    const halo = g.createRadialGradient(x, y, r * 0.8, x, y, r * 3.2);
    halo.addColorStop(0, 'rgba(90,160,255,0.28)');
    halo.addColorStop(1, 'rgba(90,160,255,0)');
    g.fillStyle = halo;
    g.fillRect(x - r * 3.3, y - r * 3.3, r * 6.6, r * 6.6);

    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.clip();
    const body = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    body.addColorStop(0, '#6fb4ff');
    body.addColorStop(0.55, '#2a63c4');
    body.addColorStop(1, '#0a1f55');
    g.fillStyle = body;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    // Continentes y nubes que giran despacio
    const spin = t * 0.04;
    g.fillStyle = 'rgba(70,160,110,0.75)';
    for (let i = 0; i < 4; i++) {
      const a = spin + i * 1.7;
      g.beginPath();
      g.ellipse(x + Math.sin(a) * r * 0.55, y + Math.cos(a * 1.3 + i) * r * 0.4,
        r * (0.18 + 0.05 * i % 3 * 0.5), r * 0.26, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 5; i++) {
      const a = spin * 1.6 + i * 1.3;
      g.beginPath();
      g.ellipse(x + Math.sin(a) * r * 0.6, y + Math.cos(a * 0.8 + i * 2) * r * 0.5, r * 0.3, r * 0.06, a * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    // Sombra del terminador (el sol viene de la izquierda)
    const shade = g.createLinearGradient(x - r, y, x + r, y);
    shade.addColorStop(0.4, 'rgba(0,0,10,0)');
    shade.addColorStop(1, 'rgba(0,0,10,0.7)');
    g.fillStyle = shade;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-4 * dt));
    mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-4 * dt));

    // Cielo
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#02040d');
    sky.addColorStop(0.7, '#070d24');
    sky.addColorStop(1, '#101a38');
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
    drawMars();
    drawSatellite();

    drawEarth();

    // Capas del terreno, de la más lejana a la más cercana
    drawRidge(0.74, 0.035, 1.3, '#1a2036', 6, false);
    drawRidge(0.82, 0.05, 4.1, '#252c47', 14, true);
    // Escenografía entre la capa media y la cercana: módulo, bandera y astronauta
    const u = Math.min(w, h) / 720; // escala según el tamaño de la ventana
    drawLander(w * 0.84 + mouse.x * -22, h * 0.9, 1.1 * u);
    drawFlag(w * 0.31 + mouse.x * -26, h * 0.905, 1.0 * u);
    drawAstronaut(w * 0.17 + mouse.x * -30, h * 0.915, 1.7 * u);
    drawRidge(0.92, 0.04, 7.7, '#323a5a', 30, true);
    drawRocks();

    // Cráteres de la capa cercana
    g.fillStyle = 'rgba(10,14,30,0.45)';
    for (const c of craters) {
      const x = c.x * w + mouse.x * -34;
      g.beginPath();
      g.ellipse(x, c.y * h, c.r * w, c.r * w * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    }

    // Polvo
    for (const d of dust) {
      d.x = (d.x + d.v * dt) % 1;
      g.fillStyle = 'rgba(200,215,255,0.35)';
      g.beginPath();
      g.arc(d.x * w + mouse.x * -40, d.y * h + Math.sin(t + d.x * 9) * 4, d.r, 0, Math.PI * 2);
      g.fill();
    }

    // Ondas de los clics
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      const k = r.age / 1.4;
      g.strokeStyle = `rgba(120,220,255,${(1 - k).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, 10 + k * 180, 0, Math.PI * 2);
      g.stroke();
      if (k >= 1) ripples.splice(i, 1);
    }

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
  const title = 'NeoFrontier';
  screen.innerHTML = `
    <canvas class="start-canvas" aria-hidden="true"></canvas>
    <div class="start-card">
      <p class="start-kicker">NASA Space Apps · 2026</p>
      <h1 aria-label="${title}">${[...title].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</h1>
      <p class="start-sub">Lugares de la Tierra que se parecen a la Luna y a Marte.</p>
      <button class="start-btn" disabled>Cargando…</button>
      <div class="start-progress" role="progressbar" aria-label="Carga" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div>
      <p class="start-hint">Te llevamos a un análogo al azar · usa ‹ › para recorrer el resto<br>Con sonido: la música se activa al empezar</p>
    </div>`;
  document.body.appendChild(screen);

  const backdrop = startBackdrop(screen.querySelector('.start-canvas'));
  const button = screen.querySelector('.start-btn');
  const bar = screen.querySelector('.start-progress');

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
    /** Avance de la carga, de 0 a 1. */
    setProgress(f) {
      const pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
      bar.firstElementChild.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
    },
    /** La escena está lista: habilita el botón. */
    ready() {
      bar.classList.add('done');
      button.disabled = false;
      button.textContent = 'Empezar';
      button.focus();
    },
    /** Error irrecuperable de carga. */
    fail(message) {
      bar.classList.add('failed');
      button.textContent = 'Error';
      screen.querySelector('.start-hint').textContent = message;
    },
  };
}
