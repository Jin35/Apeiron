import type { Theme } from '@apeiron/core';

const DISPLAY = '"Iowan Old Style", Palatino, Georgia, serif';
const BODY = 'ui-sans-serif, system-ui, sans-serif';

/**
 * The archipelago atlas: near-black field, hairline grid, gold ink and accent,
 * cream UI text. `muted` and `buttonHover` are the historical chrome colors.
 */
export const darkTheme: Theme = {
  background: '#101318',
  grid: { color: 'rgba(232, 228, 217, 0.08)' },
  ink: '#f0d78c',
  accent: '#f0d78c',
  ui: '#f3efe6',
  muted: '#8b95a3',
  buttonHover: 'rgba(36, 40, 48, 0.94)',
  displayFont: DISPLAY,
  bodyFont: BODY,
};
