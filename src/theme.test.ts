import { describe, expect, it } from 'vitest';
import { darkTheme, paperTheme, themeFromSearch, themeProperties, withAlpha } from './theme';

describe('themes', () => {
  it('keeps the demo dark look', () => {
    expect(darkTheme).toMatchObject({
      background: '#101318',
      grid: 'rgba(232, 228, 217, 0.08)',
      ink: '#f0d78c',
      accent: '#f0d78c',
      ui: '#f3efe6',
      displayFont: '"Iowan Old Style", Palatino, Georgia, serif',
      bodyFont: 'ui-sans-serif, system-ui, sans-serif',
    });
    expect(darkTheme.paper).toBeUndefined();
    expect(withAlpha(darkTheme.accent, 0.9)).toBe('rgba(240, 215, 140, 0.9)');
    expect(withAlpha(darkTheme.accent, 0.45)).toBe('rgba(240, 215, 140, 0.45)');
    expect(withAlpha(darkTheme.background, 0.86)).toBe('rgba(16, 19, 24, 0.86)');
    expect(themeProperties(darkTheme)).toMatchObject({
      '--bg': '#101318',
      '--ui': '#f3efe6',
      '--accent': '#f0d78c',
      '--muted': '#8b95a3',
      '--line': 'rgba(240, 215, 140, 0.45)',
      '--button-bg': 'rgba(16, 19, 24, 0.86)',
      '--button-hover': 'rgba(36, 40, 48, 0.94)',
      'color-scheme': 'dark',
    });
  });

  it('gives paper ink and accent WCAG AA contrast on the page', () => {
    expect(contrast(paperTheme.ink, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperTheme.ui, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperTheme.accent, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(paperTheme.paper?.vignette).toBeTruthy();
    expect(paperTheme.paper?.grain).toBeTruthy();
    expect(themeProperties(paperTheme)['color-scheme']).toBe('light');
    expect(themeProperties(paperTheme)['--muted']).toBe(paperTheme.ui);
  });

  it('previews paper from the query string only in dev', () => {
    expect(themeFromSearch('?theme=paper', { dev: true }).background).toBe(paperTheme.background);
    expect(themeFromSearch('?scale=2&theme=paper', { dev: true })).toBe(paperTheme);
    expect(themeFromSearch('?theme=paper', { dev: false, fallback: darkTheme })).toBe(darkTheme);
    expect(themeFromSearch('?theme=other', { dev: true, fallback: darkTheme })).toBe(darkTheme);
    expect(themeFromSearch('', { dev: true, fallback: darkTheme })).toBe(darkTheme);
  });
});

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
