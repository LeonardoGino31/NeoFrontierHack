// Botones fijos en la esquina superior derecha: sonido y pantalla completa.
// Están por encima de todo (inicio, globo, guía y laboratorio), así que funcionan en cualquier pantalla.

import { icon } from './icons.js';
import { isMuted, setMuted, onMuteChange, unlockAudio } from './audio.js';

export function createHudControls() {
  const box = document.createElement('div');
  box.id = 'hud-controls';
  box.innerHTML = `
    <button class="hc-sound" type="button"></button>
    <button class="hc-full" type="button"></button>`;
  document.body.appendChild(box);

  const sound = box.querySelector('.hc-sound');
  const full = box.querySelector('.hc-full');

  const renderSound = () => {
    const muted = isMuted();
    sound.innerHTML = icon(muted ? 'mute' : 'volume');
    sound.title = muted ? 'Activar música' : 'Silenciar música';
    sound.setAttribute('aria-label', sound.title);
    sound.setAttribute('aria-pressed', String(!muted));
  };
  sound.addEventListener('click', () => {
    unlockAudio();
    setMuted(!isMuted());
  });
  onMuteChange(renderSound);
  renderSound();

  const supportsFullscreen = !!document.documentElement.requestFullscreen;
  const renderFull = () => {
    const on = !!document.fullscreenElement;
    full.innerHTML = icon(on ? 'shrink' : 'expand');
    full.title = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    full.setAttribute('aria-label', full.title);
  };
  if (!supportsFullscreen) full.hidden = true; // p. ej. iPhone: no existe la API
  full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', renderFull);
  renderFull();

  return box;
}
