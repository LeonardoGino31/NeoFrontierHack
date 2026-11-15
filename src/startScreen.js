// Pantalla de inicio: muestra el progreso de carga y, al pulsar "Iniciar", lleva al
// usuario a un punto al azar para que la primera vista ya sea una comparación.
// El botón se habilita solo cuando la escena está lista: antes, pulsarlo mientras se
// subían las texturas dejaba la página congelada varios segundos.

/**
 * Muestra la pantalla de inicio sobre la escena.
 * @param {{ onStart: () => void }} deps  onStart se llama una sola vez, al pulsar el botón.
 * @returns {{ setProgress: (f: number) => void, ready: () => void, fail: (msg: string) => void }}
 */
export function createStartScreen({ onStart }) {
  const screen = document.createElement('div');
  screen.id = 'start-screen';
  screen.innerHTML = `
    <div class="start-card">
      <p class="start-kicker">NASA Space Apps · 2026</p>
      <h1>Terra2Mars</h1>
      <p class="start-sub">Lugares de la Tierra que se parecen a la Luna y a Marte.</p>
      <button class="start-btn" disabled>Cargando…</button>
      <div class="start-progress" role="progressbar" aria-label="Carga" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div></div></div>
      <p class="start-hint">Te llevamos a un análogo al azar · usa ‹ › para recorrer el resto</p>
    </div>`;
  document.body.appendChild(screen);

  const button = screen.querySelector('.start-btn');
  const bar = screen.querySelector('.start-progress');

  button.addEventListener('click', () => {
    screen.classList.add('leaving');
    // Se quita después del fundido para que no siga capturando clics sobre la escena
    screen.addEventListener('transitionend', () => screen.remove(), { once: true });
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
      button.textContent = 'Iniciar';
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
