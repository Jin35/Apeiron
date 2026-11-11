import { clampScale, type Camera } from './camera';
import type { TitleFitPose } from './theme';

/**
 * Neutral opening camera. A pack that fits a title passes its own pose.
 * `?scale=&x=&y=` overrides whatever the caller fitted.
 */
export const initialCamera: Camera = { x: 0, y: 0, scale: 1 };

/**
 * Fit a title `titleWorldWidth` world units wide into about 86% of the view.
 * Scale does not rise above the pose's desktop scale, and does not drop below 0.04.
 * The default pose is `initialCamera`.
 */
export function initialCameraFor(
  viewWidth: number,
  titleWorldWidth: number,
  pose: TitleFitPose = initialCamera,
): Camera {
  const width = viewWidth > 0 ? viewWidth : 1280;
  const fitted =
    titleWorldWidth > 0 && Number.isFinite(titleWorldWidth)
      ? (width * 0.86) / titleWorldWidth
      : pose.scale;
  const scale = Math.min(pose.scale, Math.max(0.04, fitted));
  return { x: pose.x, y: pose.y, scale };
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
