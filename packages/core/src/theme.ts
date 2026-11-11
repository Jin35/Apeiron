import type { CameraLimits } from './camera';
import type { CanvasObject } from './model';

/** Neutral plate and placeholder colors. A pack overrides them on its theme. */
const NEUTRAL_PLATE = '#171b22';
const NEUTRAL_PLACEHOLDER = '#8d8d8d';
const NEUTRAL_PLACEHOLDER_LINE = '#e7e7e7';

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
  /**
   * Secondary HUD color. Omit to use `ui`.
   * A pack sets this when its chrome uses a quieter ink than the title.
   */
  muted?: string;
  /**
   * Resting zoom-button color. Omit to mix `ui` into the page background.
   */
  buttonHover?: string;
  /**
   * Fill behind a framed image. Omit for the neutral plate.
   */
  plate?: string;
  /**
   * Placeholder shape fill. Omit for the neutral grey.
   */
  placeholder?: string;
  /**
   * Placeholder outline. Omit for the neutral light line.
   */
  placeholderLine?: string;
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
  /**
   * When set, the opening camera fits a title of this world width
   * instead of the content bounds.
   */
  titleFitWidth?: number;
  /**
   * Camera centre and desktop scale used with `titleFitWidth`.
   * Omit for the neutral pose: the origin at scale 1.
   */
  titleFitPose?: TitleFitPose;
  /**
   * Scale multiplier for `?focus=&into=1`. Omit to keep the framed fit.
   * A pack sets this to the same ratio its fades already use.
   */
  intoFactor?: number;
};

/**
 * Opening camera for a title fit. `scale` is the desktop cap; a narrower
 * view only zooms out from it.
 */
export type TitleFitPose = {
  x: number;
  y: number;
  scale: number;
};

/**
 * Used when a frame does not name a theme. The page always passes the
 * pack theme, so this is only the library default.
 */
export const fallbackTheme: Theme = {
  background: '#ffffff',
  ink: '#111111',
  accent: '#111111',
  ui: '#111111',
  displayFont: 'sans-serif',
  bodyFont: 'sans-serif',
  plate: NEUTRAL_PLATE,
  placeholder: NEUTRAL_PLACEHOLDER,
  placeholderLine: NEUTRAL_PLACEHOLDER_LINE,
};

/** Plate and placeholder colors, using the neutral defaults when a theme omits them. */
export function paintColors(theme: Theme): { plate: string; placeholder: string; placeholderLine: string } {
  return {
    plate: theme.plate ?? NEUTRAL_PLATE,
    placeholder: theme.placeholder ?? NEUTRAL_PLACEHOLDER,
    placeholderLine: theme.placeholderLine ?? NEUTRAL_PLACEHOLDER_LINE,
  };
}

/** `#rgb` / `#rrggbb` as `rgba(r, g, b, a)`. */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = parseHex(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * CSS custom properties for the HUD, buttons, page background, and fonts.
 * `muted` and `buttonHover` come from the theme when the pack sets them.
 */
export function themeProperties(theme: Theme): Record<string, string> {
  return {
    '--bg': theme.background,
    '--ui': theme.ui,
    '--accent': theme.accent,
    '--line': withAlpha(theme.accent, 0.45),
    '--button-bg': withAlpha(theme.background, 0.86),
    '--button-hover':
      theme.buttonHover ?? `color-mix(in srgb, ${theme.ui} 14%, ${theme.background})`,
    '--muted': theme.muted ?? theme.ui,
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
 * Dev preview: `?theme=<name>` selects that entry from `themes`.
 * A production build (`dev` false) always returns `fallback`.
 */
export function themeFromSearch(
  search: string,
  options: { dev?: boolean; fallback: Theme; themes?: Readonly<Record<string, Theme>> },
): Theme {
  const dev = options.dev ?? false;
  const name = new URLSearchParams(search).get('theme');
  if (dev && name && options.themes && Object.prototype.hasOwnProperty.call(options.themes, name)) {
    const theme = options.themes[name];
    if (theme) return theme;
  }
  return options.fallback;
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
