import { themeProperties, withAlpha } from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { darkTheme } from './theme';

describe('atlas theme', () => {
  it('keeps the demo dark look', () => {
    expect(darkTheme).toMatchObject({
      background: '#101318',
      grid: { color: 'rgba(232, 228, 217, 0.08)' },
      ink: '#f0d78c',
      accent: '#f0d78c',
      ui: '#f3efe6',
      muted: '#8b95a3',
      buttonHover: 'rgba(36, 40, 48, 0.94)',
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
});
