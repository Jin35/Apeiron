import type { ZoomFade } from './model';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** `camera.scale / fitScale`, or undefined when the fit scale is missing. */
export function zoomRatio(scale: number, fitScale: number | undefined): number | undefined {
  if (fitScale === undefined || !(fitScale > 0) || !Number.isFinite(fitScale)) return undefined;
  if (!Number.isFinite(scale)) return undefined;
  return scale / fitScale;
}

/**
 * Zoom-fade multiplier for `ratio` (`r`). No fade, or no ratio, is 1.
 * A range that does not increase is ignored so bad data does not blank the object.
 * `fadeOut` and `fadeIn` multiply when both are set.
 */
export function relativeZoomAlpha(fade: ZoomFade | undefined, ratio: number | undefined): number {
  if (!fade || ratio === undefined) return 1;
  const out = fade.fadeOut ? segmentAlpha(fade.fadeOut, ratio, 'out') : 1;
  const inn = fade.fadeIn ? segmentAlpha(fade.fadeIn, ratio, 'in') : 1;
  return clamp01(out * inn);
}

/**
 * Paint opacity. `visibilityAlpha` is the band fade. Zoom fade multiplies it.
 * When the zoom term is 1 the visibility value is returned unchanged.
 */
export function displayOpacity(
  visibilityAlpha: number,
  fade: ZoomFade | undefined,
  scale: number,
  fitScale: number | undefined,
): number {
  const zoom = relativeZoomAlpha(fade, zoomRatio(scale, fitScale));
  if (zoom === 1) return visibilityAlpha;
  return visibilityAlpha * zoom;
}

function segmentAlpha(
  range: readonly [number, number],
  ratio: number,
  direction: 'in' | 'out',
): number {
  const [start, end] = range;
  if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(ratio)) {
    return 1;
  }
  if (ratio <= start) return direction === 'out' ? 1 : 0;
  if (ratio >= end) return direction === 'out' ? 0 : 1;
  const t = (ratio - start) / (end - start);
  return direction === 'out' ? 1 - t : t;
}
