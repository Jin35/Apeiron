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

/** Camera limits, not a world edge. One decade past the overview, out to 1e7. */
export const MIN_SCALE = 1e-4;
export const MAX_SCALE = 1e7;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
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
 * Immediate half of a camera command. Delegates to `panBy`, `zoomAt`, or `retarget`.
 * `viewW` and `viewH` are the viewport in CSS pixels; `panBy` does not use them.
 * `zoomStep` is not accepted here. Button zoom animates that command.
 */
export function applyCameraCommand(
  camera: Camera,
  command: ImmediateCameraCommand,
  viewW: number,
  viewH: number,
): Camera {
  switch (command.type) {
    case 'panBy':
      return panBy(camera, command.dx, command.dy);
    case 'zoomAt':
      return zoomAt(camera, command.x, command.y, viewW, viewH, command.factor);
    case 'retarget':
      return retarget(camera, command.anchor, command.target, viewW, viewH, command.factor);
  }
}
