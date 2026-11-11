import { describe, expect, it } from 'vitest';
import { themeFromSearch, themeProperties, withAlpha, type Theme } from './theme';

const ink: Theme = {
  background: '#101010',
  grid: { color: 'rgba(1, 2, 3, 0.08)' },
  ink: '#ffcc00',
  accent: '#ff0000',
  ui: '#eeeeee',
  muted: '#888888',
  buttonHover: 'rgba(20, 20, 20, 0.9)',
  displayFont: 'Serif, serif',
  bodyFont: 'Sans, sans-serif',
};

const page: Theme = {
  background: '#eeeeee',
  paper: { vignette: 'rgba(1, 2, 3, 0.2)', grain: 'rgba(4, 5, 6, 0.1)' },
  ink: '#222222',
  accent: '#333333',
  ui: '#222222',
  displayFont: 'Serif, serif',
  bodyFont: 'Body, serif',
};

describe('themes', () => {
  it('turns a hex color into rgba and derives chrome from the theme fields', () => {
    expect(withAlpha(ink.accent, 0.9)).toBe('rgba(255, 0, 0, 0.9)');
    expect(withAlpha(ink.accent, 0.45)).toBe('rgba(255, 0, 0, 0.45)');
    expect(withAlpha(ink.background, 0.86)).toBe('rgba(16, 16, 16, 0.86)');
    expect(themeProperties(ink)).toMatchObject({
      '--bg': ink.background,
      '--ui': ink.ui,
      '--accent': ink.accent,
      '--muted': ink.muted,
      '--line': 'rgba(255, 0, 0, 0.45)',
      '--button-bg': 'rgba(16, 16, 16, 0.86)',
      '--button-hover': ink.buttonHover,
      '--body-font': ink.bodyFont,
      '--display-font': ink.displayFont,
      'color-scheme': 'dark',
    });
  });

  it('uses ui and a mix for muted and button hover when the theme omits them', () => {
    expect(themeProperties(page)['color-scheme']).toBe('light');
    expect(themeProperties(page)['--muted']).toBe(page.ui);
    expect(themeProperties(page)['--button-hover']).toBe(
      `color-mix(in srgb, ${page.ui} 14%, ${page.background})`,
    );
    expect(themeProperties(page)['--bg']).toBe(page.background);
  });

  it('selects a named theme from the query only in dev', () => {
    const themes = { preview: page };
    expect(themeFromSearch('?theme=preview', { dev: true, fallback: ink, themes }).background).toBe(page.background);
    expect(themeFromSearch('?scale=2&theme=preview', { dev: true, fallback: ink, themes })).toBe(page);
    expect(themeFromSearch('?theme=preview', { dev: false, fallback: ink, themes })).toBe(ink);
    expect(themeFromSearch('?theme=other', { dev: true, fallback: ink, themes })).toBe(ink);
    expect(themeFromSearch('', { dev: true, fallback: ink, themes })).toBe(ink);
  });
});
