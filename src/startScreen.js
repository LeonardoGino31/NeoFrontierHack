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
  const shooting = [];
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

    // Estrellas fugaces ocasionales
    if (!reducedMotion && Math.random() < dt * 0.25) {
      shooting.push({ x: Math.random() * w * 0.8, y: Math.random() * h * 0.35, life: 0 });
    }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const s = shooting[i];
      s.life += dt;
      s.x += 520 * dt;
      s.y += 220 * dt;
      const a = Math.max(0, 1 - s.life / 0.9);
      const grad = g.createLinearGradient(s.x, s.y, s.x - 90, s.y - 38);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = grad;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - 90, s.y - 38);
      g.stroke();
      if (s.life > 0.9) shooting.splice(i, 1);
    }

    drawEarth();

    // Capas del terreno, de la más lejana a la más cercana
    drawRidge(0.74, 0.035, 1.3, '#1a2036', 6, false);
    drawRidge(0.82, 0.05, 4.1, '#252c47', 14, true);
    drawRidge(0.92, 0.04, 7.7, '#323a5a', 30, true);

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
