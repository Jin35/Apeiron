import type { Theme } from '@apeiron/core';

const DISPLAY = '"Iowan Old Style", Palatino, Georgia, serif';

/**
 * Aged paper for the smartphone pack. Ink and accent clear WCAG AA on the
 * page color; the vignette only darkens the edges. No grid.
 */
export const paperTheme: Theme = {
  background: '#F3EAD3',
  paper: {
    vignette: 'rgba(62, 42, 22, 0.28)',
    grain: 'rgba(59, 47, 34, 0.14)',
  },
  ink: '#3B2F22',
  accent: '#7A3E1D',
  ui: '#3B2F22',
  plate: '#171b22',
  placeholder: '#8d8d8d',
  placeholderLine: '#e7e7e7',
  displayFont: DISPLAY,
  bodyFont: 'Georgia, Palatino, "Iowan Old Style", serif',
};
