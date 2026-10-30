export type Camera = {
  /** World point at the center of the viewport. */
  x: number;
  y: number;
  /** CSS pixels per world unit. */
  scale: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

/** Global camera limits, not a world edge. One decade past the overview, out to 1e7. */
export const MIN_SCALE = 1e-4;
export const MAX_SCALE = 1e7;

/**
 * Share of the content span added on each side of the union.
 * The pan bounds are a little larger than the objects.
 */
export const CONTENT_MARGIN = 0.08;

/**
 * The fit scale is multiplied by this. The minimum zoom shows a little
 * space around the bounds instead of cropping flush to them.
 */
export const FIT_SLACK = 0.9;

/** Smallest side, in CSS pixels, that counts as readable at max zoom. */
export const READABLE_PX = 48;

/**
 * Clamp `scale` into `[min, max]`, and always into the global `MIN_SCALE`..`MAX_SCALE`.
 * A non-finite or non-positive scale falls back to the lower end of that range.
 */
export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  const floor = normalizeLimit(min, MIN_SCALE);
  const ceil = normalizeLimit(max, MAX_SCALE);
  const lo = Math.min(floor, ceil);
  const hi = Math.max(floor, ceil);
  if (!Number.isFinite(scale) || scale <= 0) return lo;
  return Math.min(hi, Math.max(lo, scale));
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function worldPoint(
  camera: Camera,
  screenX: number,
  screenY: number,
  viewW: number,
  viewH: number,
): ScreenPoint {
  return {
    x: camera.x + (screenX - viewW / 2) / camera.scale,
    y: camera.y + (screenY - viewH / 2) / camera.scale,
  };
}

/**
 * Change scale by `factor`, keeping the world point under `anchor`
 * pinned to `target` afterwards. Rotation is not represented.
 * When `anchor` and `target` match, this is zoom-toward-pointer.
 */
export function retarget(
  camera: Camera,
  anchor: ScreenPoint,
  target: ScreenPoint,
  viewW: number,
  viewH: number,
  factor: number,
): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const scale = clampScale(camera.scale * factor);
  const world = worldPoint(camera, anchor.x, anchor.y, viewW, viewH);
  return {
    scale,
    x: world.x - (target.x - viewW / 2) / scale,
    y: world.y - (target.y - viewH / 2) / scale,
  };
}

export function zoomAt(
  camera: Camera,
  screenX: number,
  screenY: number,
  viewW: number,
  viewH: number,
  factor: number,
): Camera {
  const point = { x: screenX, y: screenY };
  return retarget(camera, point, point, viewW, viewH, factor);
}

/** Screen-pixel drag. Content follows the pointer; the camera moves opposite. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    x: camera.x - dx / camera.scale,
    y: camera.y - dy / camera.scale,
    scale: camera.scale,
  };
}

export type ViewBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function viewBounds(camera: Camera, viewW: number, viewH: number): ViewBounds {
  const halfW = viewW / 2 / camera.scale;
  const halfH = viewH / 2 / camera.scale;
  return {
    left: camera.x - halfW,
    right: camera.x + halfW,
    top: camera.y - halfH,
    bottom: camera.y + halfH,
  };
}

/**
 * One placed object in world space. The store fills this after parent
 * flattening. The camera derives limits from it and does not read the store.
 */
export type ContentBox = {
  box: ViewBounds;
  /** `visibility.maxScale` of that object. */
  maxScale: number;
  /** Lesser authored side, in world units. */
  size: number;
};

/**
 * Optional pack override. An omitted field is derived from the content
 * and the viewport. `bounds` is a world rect.
 */
export type CameraLimits = {
  minScale?: number;
  maxScale?: number;
  bounds?: ViewBounds;
};

/**
 * Limits `applyCameraCommand` enforces. `bounds` absent means pan is free.
 * `fitScale` is the opening fit (s0): the content fitted to this viewport
 * with `FIT_SLACK`, clamped to the global range. It does not follow an
 * explicit `minScale`. Relative zoom is `camera.scale / fitScale`.
 */
export type ResolvedCameraLimits = {
  minScale: number;
  maxScale: number;
  fitScale: number;
  bounds?: ViewBounds;
};

/**
 * Pan and zoom limits for one viewport.
 * Bounds are the union of `content` plus `CONTENT_MARGIN`, unless `explicit.bounds` is set.
 * `minScale` fits those bounds with `FIT_SLACK`. `maxScale` is deep enough to read the
 * finest object (`visibility.maxScale`, or `READABLE_PX` on its smaller side, whichever
 * is deeper). Both scales stay inside `MIN_SCALE`..`MAX_SCALE`. An explicit field replaces
 * the derived one. `fitScale` stays the opening fit even when `minScale` is overridden.
 */
export function deriveCameraLimits(
  content: readonly ContentBox[],
  viewW: number,
  viewH: number,
  explicit?: CameraLimits,
): ResolvedCameraLimits {
  const union = unionBoxes(content);
  const derivedBounds = union ? expandBounds(union, CONTENT_MARGIN) : undefined;
  const bounds = finiteBounds(explicit?.bounds) ?? derivedBounds;

  const openingFit = bounds ? slackFit(bounds, viewW, viewH) : MIN_SCALE;
  const readable = content.length > 0 ? readingScale(content) : MAX_SCALE;

  const minOverride = positiveScale(explicit?.minScale);
  const maxOverride = positiveScale(explicit?.maxScale);
  let minScale = clampScale(minOverride ?? openingFit);
  let maxScale = clampScale(maxOverride ?? readable);
  if (minScale > maxScale) {
    // Keep a non-empty range. An explicit ceiling below the fit wins, and the
    // floor drops to meet it. An explicit floor above the readable depth lifts
    // the ceiling. Two explicit values are ordered.
    if (maxOverride !== undefined && minOverride === undefined) minScale = maxScale;
    else if (minOverride !== undefined && maxOverride !== undefined) {
      const lo = Math.min(minScale, maxScale);
      const hi = Math.max(minScale, maxScale);
      minScale = lo;
      maxScale = hi;
    } else maxScale = minScale;
  }

  return bounds
    ? { minScale, maxScale, fitScale: openingFit, bounds }
    : { minScale, maxScale, fitScale: openingFit };
}

/**
 * Pull `camera` into `limits`. Scale is clamped first. The centre then stays
 * inside `bounds`; when the content is smaller than the viewport on an axis,
 * that axis is centred. No bounds means only the scale changes.
 */
export function constrainCamera(
  camera: Camera,
  viewW: number,
  viewH: number,
  limits?: ResolvedCameraLimits,
): Camera {
  const scale = clampScale(camera.scale, limits?.minScale ?? MIN_SCALE, limits?.maxScale ?? MAX_SCALE);
  const bounds = limits?.bounds;
  if (!bounds || !(viewW > 0) || !(viewH > 0) || !(scale > 0)) {
    return scale === camera.scale ? camera : { x: camera.x, y: camera.y, scale };
  }
  const x = clampCenter(camera.x, bounds.left, bounds.right, viewW / scale);
  const y = clampCenter(camera.y, bounds.top, bounds.bottom, viewH / scale);
  if (x === camera.x && y === camera.y && scale === camera.scale) return camera;
  return { x, y, scale };
}

function clampCenter(center: number, min: number, max: number, viewSpan: number): number {
  if (viewSpan >= max - min) return (min + max) / 2;
  if (center < min) return min;
  if (center > max) return max;
  return center;
}

function positiveScale(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function readingScale(content: readonly ContentBox[]): number {
  let max = MIN_SCALE;
  for (const item of content) {
    const fromBand = Number.isFinite(item.maxScale) && item.maxScale > 0 ? item.maxScale : MIN_SCALE;
    const fromSize = Number.isFinite(item.size) && item.size > 0 ? READABLE_PX / item.size : fromBand;
    max = Math.max(max, fromBand, fromSize);
  }
  return max;
}

/**
 * Opening fit of one world box. Expands by `CONTENT_MARGIN`, then applies
 * `FIT_SLACK`, the same rule `deriveCameraLimits` uses for the pack's s0.
 * A non-positive viewport is `MIN_SCALE`.
 */
export function boxFitScale(box: ViewBounds, viewW: number, viewH: number): number {
  return slackFit(expandBounds(box, CONTENT_MARGIN), viewW, viewH);
}

/** `fitScale` of bounds that are already expanded (or an explicit override), times slack. */
function slackFit(bounds: ViewBounds, viewW: number, viewH: number): number {
  if (!(viewW > 0) || !(viewH > 0)) return MIN_SCALE;
  return clampScale(fitScale(bounds, viewW, viewH) * FIT_SLACK);
}

function fitScale(bounds: ViewBounds, viewW: number, viewH: number): number {
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;
  const sx = w > 0 ? viewW / w : Number.POSITIVE_INFINITY;
  const sy = h > 0 ? viewH / h : Number.POSITIVE_INFINITY;
  const fit = Math.min(sx, sy);
  return Number.isFinite(fit) && fit > 0 ? fit : MIN_SCALE;
}

function unionBoxes(content: readonly ContentBox[]): ViewBounds | undefined {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { box } of content) {
    if (!Number.isFinite(box.left) || !Number.isFinite(box.right)) continue;
    if (!Number.isFinite(box.top) || !Number.isFinite(box.bottom)) continue;
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
    top = Math.min(top, box.top);
    bottom = Math.max(bottom, box.bottom);
  }
  if (!Number.isFinite(left) || !(right >= left) || !(bottom >= top)) return undefined;
  return { left, right, top, bottom };
}

function expandBounds(bounds: ViewBounds, margin: number): ViewBounds {
  const w = Math.max(0, bounds.right - bounds.left);
  const h = Math.max(0, bounds.bottom - bounds.top);
  return {
    left: bounds.left - w * margin,
    right: bounds.right + w * margin,
    top: bounds.top - h * margin,
    bottom: bounds.bottom + h * margin,
  };
}

function finiteBounds(bounds: ViewBounds | undefined): ViewBounds | undefined {
  if (!bounds) return undefined;
  const { left, right, top, bottom } = bounds;
  if (![left, right, top, bottom].every(Number.isFinite)) return undefined;
  if (!(right > left) || !(bottom > top)) return undefined;
  return { left, right, top, bottom };
}

/**
 * Session camera command. Coordinates are canvas-local CSS pixels.
 * `zoomStep` is the animated +/− control, anchored at the view center.
 */
export type CameraCommand =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'zoomAt'; x: number; y: number; factor: number }
  | { type: 'retarget'; anchor: ScreenPoint; target: ScreenPoint; factor: number }
  | { type: 'zoomStep'; factor: number };

type ImmediateCameraCommand = Exclude<CameraCommand, { type: 'zoomStep' }>;

/**
 * Immediate half of a camera command. Delegates to `panBy`, `zoomAt`, or `retarget`,
 * then enforces `limits` when the shell passes them.
 * `viewW` and `viewH` are the viewport in CSS pixels.
 * `zoomStep` is not accepted here. Button zoom animates that command and passes
 * the same limits, so the committed scale does not overshoot.
 *
 * Zoom clamps scale first and only then the position, using the clamped scale,
 * so the world point under the cursor stays put when the scale limit is what
 * stopped the zoom. A further zoom in that blocked direction does not move.
 */
export function applyCameraCommand(
  camera: Camera,
  command: ImmediateCameraCommand,
  viewW: number,
  viewH: number,
  limits?: ResolvedCameraLimits,
): Camera {
  switch (command.type) {
    case 'panBy':
      return constrainCamera(panBy(camera, command.dx, command.dy), viewW, viewH, limits);
    case 'zoomAt':
      return zoomLimited(
        camera,
        { x: command.x, y: command.y },
        { x: command.x, y: command.y },
        viewW,
        viewH,
        command.factor,
        limits,
      );
    case 'retarget':
      return zoomLimited(
        camera,
        command.anchor,
        command.target,
        viewW,
        viewH,
        command.factor,
        limits,
      );
  }
}

function zoomLimited(
  camera: Camera,
  anchor: ScreenPoint,
  target: ScreenPoint,
  viewW: number,
  viewH: number,
  factor: number,
  limits?: ResolvedCameraLimits,
): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  const scale = clampScale(
    camera.scale * factor,
    limits?.minScale ?? MIN_SCALE,
    limits?.maxScale ?? MAX_SCALE,
  );
  // Same scale and a pure zoom: keep the camera bits exact, then the pan clamp
  // runs. Recomputing the anchor here would drift by a ulp on every wheel tick.
  if (scale === camera.scale && anchor.x === target.x && anchor.y === target.y) {
    return constrainCamera(camera, viewW, viewH, limits);
  }
  const world = worldPoint(camera, anchor.x, anchor.y, viewW, viewH);
  return constrainCamera(
    {
      scale,
      x: world.x - (target.x - viewW / 2) / scale,
      y: world.y - (target.y - viewH / 2) / scale,
    },
    viewW,
    viewH,
    limits,
  );
}
