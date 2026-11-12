// Íconos SVG compartidos por el HUD y la guía de parámetros
const ICONS = {
  mountain: '<path d="M3 20l6-10 4 6 3-4 5 8z"/>',
  slope:    '<path d="M3 20h18L3 8z"/>',
  thermo:   '<path d="M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z"/><path d="M12 9v7"/>',
  grid:     '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
  sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  rock:     '<path d="M4 15l3-7 6-3 6 5 1 7-8 3z"/><path d="M7 8l5 5 7-3M12 13l0 7"/>',
  drop:     '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  target:   '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  eye:      '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cube:     '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
  book:     '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>',
};

export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
