import { themeProperties } from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { paperTheme } from './theme';

describe('paper theme', () => {
  it('gives ink and accent WCAG AA contrast on the page', () => {
    expect(contrast(paperTheme.ink, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperTheme.ui, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperTheme.accent, paperTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(paperTheme.paper?.vignette).toBeTruthy();
    expect(paperTheme.paper?.grain).toBeTruthy();
    expect(paperTheme.grid).toBeUndefined();
    expect(paperTheme.background).toBe('#F3EAD3');
    expect(themeProperties(paperTheme)['color-scheme']).toBe('light');
    expect(themeProperties(paperTheme)['--muted']).toBe(paperTheme.ui);
    expect(themeProperties(paperTheme)['--button-hover']).toBe(
      'color-mix(in srgb, #3B2F22 14%, #F3EAD3)',
    );
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
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
