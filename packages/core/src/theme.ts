import type { CameraLimits } from './camera';
import type { CanvasObject } from './model';

/**
 * Look for one content pack. Plain data: the renderer and the shell read it.
 *
 * `background`, `ink`, `accent`, and `ui` are `#rrggbb`. `grid` is the
 * square hairline; omit it to draw no grid. `paper` is a procedural vignette
 * and grain, not an image.
 */
export type Theme = {
  /** Page and canvas fill. */
  background: string;
  /** Soft aged-paper wash. Omitted for a flat fill. */
  paper?: PaperTreatment;
  /** Square grid. Omit to draw no grid. */
  grid?: GridStyle;
  /** Text fill when an object does not set `style.color`. */
  ink: string;
  /** Selection stroke, zoom buttons, and their focus ring. */
  accent: string;
  /** Chrome text: title, and on a light pack the HUD readout. */
  ui: string;
  /** Canvas labels. */
  displayFont: string;
  /** HUD, hint, and buttons. */
  bodyFont: string;
};

/** Hairline grid. Absent on a theme means the renderer draws none. */
export type GridStyle = {
  /** Any CSS color. */
  color: string;
};

export type PaperTreatment = {
  /** Radial edge wash, a CSS color with alpha. */
  vignette: string;
  /** Speck color, a CSS color with alpha. */
  grain: string;
};

/**
 * Theme plus the objects that use it.
 * `limits` overrides the camera range derived from `objects`. Omitted fields
 * are still derived. Absent `limits` derives the whole range.
 */
export type ContentPack = {
  theme: Theme;
  objects: readonly CanvasObject[];
  limits?: CameraLimits;
};

const DISPLAY = '"Iowan Old Style", Palatino, Georgia, serif';
const BODY = 'ui-sans-serif, system-ui, sans-serif';

/**
 * The archipelago atlas as it looks today: near-black field, hairline grid,
 * gold ink and accent, cream UI text.
 */
export const darkTheme: Theme = {
  background: '#101318',
  grid: { color: 'rgba(232, 228, 217, 0.08)' },
  ink: '#f0d78c',
  accent: '#f0d78c',
  ui: '#f3efe6',
  displayFont: DISPLAY,
  bodyFont: BODY,
};

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
  displayFont: DISPLAY,
  bodyFont: 'Georgia, Palatino, "Iowan Old Style", serif',
};

/** Secondary HUD color on the demo's near-black page. Other packs use `ui`. */
const DARK_MUTED = '#8b95a3';
/** Resting lift of the dark zoom buttons. Other packs mix UI ink into the page. */
const DARK_BUTTON_HOVER = 'rgba(36, 40, 48, 0.94)';

/** `#rgb` / `#rrggbb` as `rgba(r, g, b, a)`. */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHex(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * CSS custom properties for the HUD, buttons, page background, and fonts.
 * The dark pack's muted text and button hover stay the historical colors;
 * those two are not fields on `Theme`.
 */
export function themeProperties(theme: Theme): Record<string, string> {
  const darkPage = theme.background === darkTheme.background;
  return {
    '--bg': theme.background,
    '--ui': theme.ui,
    '--accent': theme.accent,
    '--line': withAlpha(theme.accent, 0.45),
    '--button-bg': withAlpha(theme.background, 0.86),
    '--button-hover': darkPage
      ? DARK_BUTTON_HOVER
      : `color-mix(in srgb, ${theme.ui} 14%, ${theme.background})`,
    '--muted': darkPage ? DARK_MUTED : theme.ui,
    '--body-font': theme.bodyFont,
    '--display-font': theme.displayFont,
    'color-scheme': isLight(theme.background) ? 'light' : 'dark',
  };
}

/** Write `themeProperties` onto the page and set `theme-color` to the background. */
export function applyTheme(doc: Document, theme: Theme): void {
  const style = doc.documentElement.style;
  for (const [name, value] of Object.entries(themeProperties(theme))) {
    style.setProperty(name, value);
  }
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.background);
}

/**
 * Dev preview: `?theme=paper` selects `paperTheme`. A production build
 * (`dev` false) always returns `fallback`.
 */
export function themeFromSearch(search: string, options?: { dev?: boolean; fallback?: Theme }): Theme {
  const fallback = options?.fallback ?? darkTheme;
  const dev = options?.dev ?? import.meta.env.DEV;
  if (dev && new URLSearchParams(search).get('theme') === 'paper') return paperTheme;
  return fallback;
}

function parseHex(color: string): { r: number; g: number; b: number } {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const full = hex.length === 3 ? [...hex].map((channel) => channel + channel).join('') : hex;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || !Number.isFinite(n)) throw new Error(`Expected #rrggbb, got ${color}`);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Coarse sRGB brightness. Enough to choose `color-scheme`. */
function isLight(color: string): boolean {
  const { r, g, b } = parseHex(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
