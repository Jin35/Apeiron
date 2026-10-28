import type { VisibilityRange } from './model';

/** Fade width, in log-scale, at each end of a visibility range (~35% zoom). */
const LOG_FADE = Math.log(1.35);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Opacity for an object at `scale`. Zero outside the range. Near each edge
 * the object fades in log-scale space so a zoom feels even rather than popping.
 */
export function visibilityAlpha(range: VisibilityRange, scale: number): number {
  if (!(scale > 0) || !(range.minScale > 0) || !(range.maxScale > range.minScale)) return 0;
  if (scale < range.minScale || scale > range.maxScale) return 0;

  const logS = Math.log(scale);
  const logMin = Math.log(range.minScale);
  const logMax = Math.log(range.maxScale);
  const span = logMax - logMin;
  const band = Math.min(LOG_FADE, span / 2);
  if (!(band > 0)) return 0;

  const fadeIn = (logS - logMin) / band;
  const fadeOut = (logMax - logS) / band;
  return clamp01(Math.min(fadeIn, fadeOut));
}
