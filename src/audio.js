// Música ambiental generada en tiempo real con Web Audio (sin archivos de audio).
// Cada "escena" de la app (inicio, Tierra, Luna, Marte, comparación, laboratorio y
// rover) tiene su propio ánimo: acordes, escala, ritmo y brillo distintos. Al cambiar
// de escena se hace un fundido cruzado, así la música acompaña sin cortes.
//
// Los navegadores solo dejan sonar audio tras un gesto del usuario: el contexto se crea
// en el primer clic/tecla (ver `unlockOnGesture`) y la escena pedida antes se aplica entonces.

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Cada escena: progresión de acordes (notas MIDI), escala para las notas sueltas,
// duración de cada acorde en segundos, densidad de notas y brillo del filtro.
const SCENES = {
  intro: {
    chords: [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 66]],
    scale: [72, 74, 76, 79, 83, 86], bar: 9, notes: 0.55, bright: 1400, wave: 'sawtooth', gain: 0.9,
  },
  earth: {
    chords: [[50, 57, 62, 66], [47, 54, 59, 66], [43, 50, 55, 62], [45, 52, 57, 64]],
    scale: [66, 69, 71, 74, 76, 78, 81], bar: 8, notes: 0.7, bright: 1700, wave: 'triangle', gain: 1,
  },
  moon: {
    chords: [[38, 45, 50, 57], [36, 43, 51, 58], [34, 41, 46, 53], [36, 43, 48, 55]],
    scale: [74, 77, 81, 82, 86], bar: 12, notes: 0.28, bright: 750, wave: 'sine', gain: 1.1,
  },
  mars: {
    chords: [[40, 47, 55, 62], [43, 50, 57, 64], [38, 45, 53, 60], [40, 47, 52, 59]],
    scale: [64, 67, 69, 71, 74, 76], bar: 9, notes: 0.45, bright: 1000, wave: 'sawtooth', gain: 0.85,
  },
  compare: {
    chords: [[45, 52, 60, 64], [41, 48, 57, 64], [48, 55, 60, 67], [43, 50, 59, 62]],
    scale: [69, 72, 74, 76, 79, 81], bar: 6, notes: 0.9, bright: 1500, wave: 'triangle', gain: 0.95, pulse: 0.5,
  },
  lab: {
    chords: [[46, 53, 58, 65], [44, 51, 56, 63], [41, 48, 53, 60], [43, 50, 55, 62]],
    scale: [70, 73, 75, 77, 80, 82], bar: 5, notes: 1.4, bright: 2000, wave: 'triangle', gain: 0.8, pulse: 0.9, tech: true,
  },
  rover: {
    chords: [[40, 47, 52, 59], [38, 45, 50, 57], [43, 50, 55, 62], [41, 48, 53, 60]],
    scale: [64, 67, 71, 72, 76], bar: 4, notes: 1.3, bright: 1800, wave: 'sawtooth', gain: 0.7, pulse: 1.5, tech: true,
  },
};

const MUTE_KEY = 'neofrontier-muted';
const MASTER_VOLUME = 0.32;

let ctx = null;
let master = null;
let reverb = null;
let wanted = null;       // escena pedida (puede llegar antes de desbloquear el audio)
let active = null;       // { name, bus, timer }
let muted = readMuted();
const listeners = new Set();

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

/** Reverberación con un impulso de ruido que decae: da la sensación de espacio abierto. */
function makeReverb(audio) {
  const length = audio.sampleRate * 4;
  const impulse = audio.createBuffer(2, length, audio.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  const node = audio.createConvolver();
  node.buffer = impulse;
  return node;
}

function ensureContext() {
  if (ctx) return true;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_VOLUME;
  const compressor = ctx.createDynamicsCompressor();
  reverb = makeReverb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(compressor);
  master.connect(compressor);
  compressor.connect(ctx.destination);
  return true;
}

/** Una voz con ataque/relajación lentos, que se envía seca y a la reverberación. */
function playVoice(bus, scene, freq, when, length, level, wave = scene.wave) {
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc.type = osc2.type = wave;
  osc.frequency.value = freq;
  osc2.frequency.value = freq;
  osc2.detune.value = 7 + Math.random() * 6; // dos osciladores algo desafinados: más cuerpo
  osc.detune.value = -(4 + Math.random() * 5);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = scene.bright;
  const env = ctx.createGain();
  const attack = Math.min(length * 0.4, 2.5);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(level, when + attack);
  env.gain.setValueAtTime(level, when + length - attack);
  env.gain.exponentialRampToValueAtTime(0.0001, when + length + attack);

  osc.connect(filter);
  osc2.connect(filter);
  filter.connect(env);
  env.connect(bus);
  env.connect(reverb);
  for (const o of [osc, osc2]) {
    o.start(when);
    o.stop(when + length + attack + 0.1);
  }
}

/** Nota corta tipo campana/pluck, para la melodía suelta. */
function playPluck(bus, scene, freq, when, level) {
  const osc = ctx.createOscillator();
  osc.type = scene.tech ? 'square' : 'sine';
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(scene.tech ? 3200 : 2400, when);
  filter.frequency.exponentialRampToValueAtTime(500, when + 1.2);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(level, when + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, when + (scene.tech ? 0.9 : 2.8));
  osc.connect(filter).connect(env);
  env.connect(bus);
  env.connect(reverb);
  osc.start(when);
  osc.stop(when + 3);
}

/** Programa un compás entero (acorde + notas sueltas) a partir de `when`. */
function scheduleBar(bus, scene, barIndex, when) {
  const chord = scene.chords[barIndex % scene.chords.length];
  chord.forEach((note, i) => {
    // el bajo (primera nota) suena más fuerte y las agudas más suave
    const level = i === 0 ? 0.16 : 0.07;
    playVoice(bus, scene, midi(note), when + i * 0.15, scene.bar, level * scene.gain);
  });

  // Notas sueltas sobre la escala, en una rejilla de corcheas
  const step = scene.pulse ? 1 / scene.pulse : 2.2;
  for (let t = Math.random() * 0.5; t < scene.bar; t += step) {
    if (Math.random() > scene.notes / (scene.pulse ? 1.6 : 1.1)) continue;
    const note = scene.scale[Math.floor(Math.random() * scene.scale.length)];
    playPluck(bus, scene, midi(note), when + t, 0.05 * scene.gain);
  }
  // Pulso grave en las escenas "activas"
  if (scene.pulse) {
    for (let t = 0; t < scene.bar; t += 1 / scene.pulse * 2) {
      playPluck(bus, { ...scene, tech: false }, midi(chord[0] - 12), when + t, 0.1 * scene.gain);
    }
  }
}

function startScene(name) {
  const scene = SCENES[name];
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(master);
  const now = ctx.currentTime;
  bus.gain.setValueAtTime(0, now);
  bus.gain.linearRampToValueAtTime(1, now + 3); // entrada suave

  let bar = 0;
  let nextTime = now + 0.1;
  // Se programa con un poco de adelanto (el temporizador del navegador no es preciso)
  const tick = () => {
    while (nextTime < ctx.currentTime + 2) {
      scheduleBar(bus, scene, bar++, nextTime);
      nextTime += scene.bar;
    }
  };
  tick();
  const timer = setInterval(tick, 500);
  return { name, bus, timer };
}

function stopScene(scene) {
  clearInterval(scene.timer);
  const now = ctx.currentTime;
  scene.bus.gain.cancelScheduledValues(now);
  scene.bus.gain.setValueAtTime(scene.bus.gain.value, now);
  scene.bus.gain.linearRampToValueAtTime(0, now + 2.5); // las notas en vuelo se apagan solas
  setTimeout(() => scene.bus.disconnect(), 8000);
}

function applyScene() {
  if (!ctx || !wanted || ctx.state === 'closed') return;
  if (active?.name === wanted) return;
  if (active) stopScene(active);
  active = startScene(wanted);
}

/** Cambia la música a la escena `name` (con fundido cruzado). Se puede llamar antes del primer gesto. */
export function setMusicScene(name) {
  if (!SCENES[name]) return;
  wanted = name;
  applyScene();
}

/** Crea/reanuda el audio (debe llamarse dentro de un gesto del usuario). */
export function unlockAudio() {
  if (!ensureContext()) return;
  if (ctx.state === 'suspended') ctx.resume();
  applyScene();
}

/** Escucha el primer gesto del usuario para poder empezar a sonar. */
export function unlockOnGesture() {
  const events = ['pointerdown', 'keydown', 'touchend'];
  const handler = () => {
    unlockAudio();
    for (const e of events) window.removeEventListener(e, handler, true);
  };
  for (const e of events) window.addEventListener(e, handler, true);
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* sin almacenamiento: no pasa nada */ }
  if (ctx && !muted && ctx.state === 'suspended' && !document.hidden) ctx.resume();
  if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.15);
  for (const fn of listeners) fn(muted);
}

export function onMuteChange(fn) {
  listeners.add(fn);
}

// Si la pestaña pasa a segundo plano el audio se pausa, para no gastar batería
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else if (!muted) ctx.resume();
});
