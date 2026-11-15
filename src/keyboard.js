// Teclado centralizado. Cada capa de la interfaz (globo, guía, laboratorio) declara
// cuándo está activa y solo la capa activa de mayor prioridad recibe cada tecla.
// Así Esc cierra únicamente lo que está arriba, sin depender del orden en que se
// registraron los listeners ni de stopImmediatePropagation.

export const KEY_PRIORITY = { globe: 0, guide: 10, lab: 20, maps: 30 };

const layers = [];

/**
 * Registra una capa de teclado.
 * @param {{ priority: number, isActive: () => boolean, onKeyDown: (e: KeyboardEvent) => void }} layer
 */
export function addKeyLayer(layer) {
  layers.push(layer);
  layers.sort((a, b) => b.priority - a.priority);
}

/** ¿El foco está en un campo de texto? (los sliders no cuentan: no escriben letras) */
export function isTyping(target) {
  return !!target?.closest?.('textarea, select, input:not([type="range"]):not([type="checkbox"]):not([type="button"])');
}

window.addEventListener('keydown', (e) => {
  layers.find((l) => l.isActive())?.onKeyDown(e);
});
