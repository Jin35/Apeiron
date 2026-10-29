import { clampScale, type Camera } from './camera';

/**
 * Session opening camera. The atlas does not choose this; the shell does.
 * Desktop keeps `initialCamera`. A narrow viewport zooms out so the title fits.
 * `?scale=&x=&y=` overrides the fitted camera.
 */
export const initialCamera: Camera = { x: 0, y: -80, scale: 0.1 };

/** Approximate on-screen width of the title at scale 1, including letter-spacing. */
const TITLE_WORLD_WIDTH = 6300;

/** Desktop keeps `initialCamera`. Narrow viewports zoom out so the title fits. */
export function initialCameraFor(viewWidth: number): Camera {
  const width = viewWidth > 0 ? viewWidth : 1280;
  const fitted = (width * 0.86) / TITLE_WORLD_WIDTH;
  const scale = Math.min(initialCamera.scale, Math.max(0.04, fitted));
  return { x: initialCamera.x, y: initialCamera.y, scale };
}

/**
 * Apply `?scale=&x=&y=` from `search` (the shell passes `location.search`).
 * A missing or non-positive scale keeps `fallback`. Scale uses the same clamp as zoom.
 */
export function cameraFromLocation(fallback: Camera, search: string): Camera {
  const params = new URLSearchParams(search);
  const scale = Number(params.get('scale'));
  if (!Number.isFinite(scale) || scale <= 0) return { ...fallback };
  // Number(null) is 0, so an omitted x or y lands on the origin.
  const x = Number(params.get('x'));
  const y = Number(params.get('y'));
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    scale: clampScale(scale),
  };
}
