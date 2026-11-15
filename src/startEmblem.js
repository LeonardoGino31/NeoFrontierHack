// Emblema de NeoFrontier para la pantalla de inicio: los contornos de la marca con su
// estrella y la órbita naranja. La órbita es también la barra de carga: se dibuja según
// el progreso y, cuando la escena está lista, la luna naranja la recorre pasando por
// detrás de los contornos en la mitad superior y por delante en la inferior.

const NS = 'http://www.w3.org/2000/svg';
const ORX = 330, ORY = 88;                // semiejes de la órbita
const OROT = (-14 * Math.PI) / 180;       // inclinación de la órbita
const RIPPLE_LIFE = 1.4;                  // segundos que dura la onda de un clic

/**
 * Contorno de la mancha del logo: radio con armónicos que cambian despacio con `t`.
 * @param {number} k  cuántos anillos hacia afuera (fraccionario para las ondas)
 * @param {number} t  tiempo en segundos
 */
function blobPath(k, t, R = 120, gap = 26) {
  let d = '';
  for (let i = 0; i <= 140; i++) {
    const a = (i / 140) * Math.PI * 2;
    const r = R * (1 + 0.2 * Math.sin(2 * a + 0.6 + t * 0.3) + 0.08 * Math.sin(3 * a + 2.1 - t * 0.2)
      + 0.04 * Math.sin(5 * a + 0.3 + t * 0.5)) + k * gap;
    // Alargada en horizontal e inclinada, como la mancha de la marca
    const x = r * Math.cos(a) * 1.3, y = r * Math.sin(a) * 0.85;
    const rot = -0.28;
    d += (i ? 'L' : 'M') + (x * Math.cos(rot) - y * Math.sin(rot)).toFixed(1) + ' '
      + (x * Math.sin(rot) + y * Math.cos(rot)).toFixed(1);
  }
  return d + 'Z';
}

/** Estrella de cuatro puntas con lados cóncavos, como la del logo. */
function starPath(s) {
  const c = s * 0.14;
  return `M0 ${-s} Q${c} ${-c} ${s} 0 Q${c} ${c} 0 ${s} Q${-c} ${c} ${-s} 0 Q${-c} ${-c} 0 ${-s}Z`;
}

/** Crea un elemento SVG con sus atributos. */
function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Monta el emblema dentro de `svg` y devuelve los controles que usa la pantalla de inicio.
 * @param {SVGSVGElement} svg
 */
export function createEmblem(svg) {
  svg.setAttribute('viewBox', '-400 -270 800 540');
  const defs = el('defs', {}, svg);
  // Media órbita de atrás y media de adelante: así cruza los contornos en 3D
  el('rect', { x: -500, y: -400, width: 1000, height: 400, transform: 'rotate(-14)' },
    el('clipPath', { id: 'emblem-back' }, defs));
  el('rect', { x: -500, y: 0, width: 1000, height: 400, transform: 'rotate(-14)' },
    el('clipPath', { id: 'emblem-front' }, defs));

  const orbitD = `M${-ORX} 0 A${ORX} ${ORY} 0 1 0 ${ORX} 0 A${ORX} ${ORY} 0 1 0 ${-ORX} 0`;
  const orbitAttrs = { class: 'emblem-orbit', d: orbitD, transform: 'rotate(-14)' };
  const orbitBack = el('path', orbitAttrs, el('g', { 'clip-path': 'url(#emblem-back)' }, svg));
  const dotBack = el('g', {}, svg);
  const ringsG = el('g', {}, svg);
  const rings = [0, 1, 2, 3].map(() => el('path', { class: 'emblem-ring' }, ringsG));
  el('path', { class: 'emblem-star', d: starPath(26) }, svg);
  const orbitFront = el('path', orbitAttrs, el('g', { 'clip-path': 'url(#emblem-front)' }, svg));
  const dotFront = el('g', {}, svg);
  const dot = el('circle', { class: 'emblem-moon', r: 11 }, dotFront);

  const orbitLen = orbitBack.getTotalLength();
  const ripples = [];
  let progress = 0, ready = false, angle = 0;

  return {
    /** Avance de la carga (0 a 1): cuánto de la órbita está dibujado. */
    setProgress(f) { progress = Math.min(1, Math.max(0, f)); },
    /** La escena está lista: la órbita queda completa y la luna empieza a girar. */
    ready() { ready = true; angle = progress * Math.PI * 2; },
    /** Onda de contorno que sale del emblema (al hacer clic en el fondo). */
    ripple() { ripples.push({ node: el('path', { class: 'emblem-ripple' }, ringsG), age: 0 }); },

    /**
     * Dibuja un cuadro.
     * @param {number} t   tiempo de la animación (s)
     * @param {number} dt  paso desde el cuadro anterior (s)
     * @param {number} mx  mouse suavizado, -1 a 1 (para el paralaje)
     * @param {number} my
     */
    update(t, dt, mx, my) {
      // El anillo exterior se mueve más que el interior: da profundidad
      rings.forEach((p, k) => {
        p.setAttribute('d', blobPath(k, t));
        p.setAttribute('transform', `translate(${(mx * (k + 1) * 5).toFixed(1)} ${(my * (k + 1) * 3).toFixed(1)})`);
      });
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.age += dt;
        r.node.setAttribute('d', blobPath(3 + r.age * 5, t));
        r.node.style.opacity = String(Math.max(0, 1 - r.age / RIPPLE_LIFE));
        if (r.age > RIPPLE_LIFE) { r.node.remove(); ripples.splice(i, 1); }
      }

      const drawn = ready ? orbitLen : orbitLen * progress;
      for (const o of [orbitBack, orbitFront]) o.setAttribute('stroke-dasharray', `${drawn} ${orbitLen}`);
      // Mientras carga, la luna va en la punta del trazo; después gira sola
      if (ready) angle += dt * 0.6;
      const a = ready ? angle : progress * Math.PI * 2;
      // Mismo sentido que la ruta SVG: sale por la izquierda y baja por delante
      const ex = -ORX * Math.cos(a), ey = ORY * Math.sin(a);
      dot.setAttribute('cx', (ex * Math.cos(OROT) - ey * Math.sin(OROT)).toFixed(1));
      dot.setAttribute('cy', (ex * Math.sin(OROT) + ey * Math.cos(OROT)).toFixed(1));
      const parent = ey < 0 ? dotBack : dotFront; // detrás de los contornos en la mitad de arriba
      if (dot.parentNode !== parent) parent.appendChild(dot);
    },
  };
}
