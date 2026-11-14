// Pantalla de inicio: deja ver la escena detrás y, al pulsar "Iniciar", lleva al usuario a un
// punto al azar para que la primera vista ya sea una comparación y no un globo sin contexto.

/**
 * Muestra la pantalla de inicio sobre la escena.
 * @param {{ onStart: () => void }} deps  onStart se llama una sola vez, al pulsar el botón.
 */
export function createStartScreen({ onStart }) {
  const screen = document.createElement('div');
  screen.id = 'start-screen';
  screen.innerHTML = `
    <div class="start-card">
      <p class="start-kicker">NASA Space Apps · 2026</p>
      <h1>Terra2Mars</h1>
      <p class="start-sub">Lugares de la Tierra que se parecen a la Luna y a Marte.</p>
      <button class="start-btn" autofocus>Iniciar</button>
      <p class="start-hint">Te llevamos a un análogo al azar · usa ‹ › para recorrer el resto</p>
    </div>`;
  document.body.appendChild(screen);

  const button = screen.querySelector('.start-btn');
  button.focus();
  button.addEventListener('click', () => {
    screen.classList.add('leaving');
    // Se quita después del fundido para que no siga capturando clics sobre la escena
    screen.addEventListener('transitionend', () => screen.remove(), { once: true });
    onStart();
  }, { once: true });
}
