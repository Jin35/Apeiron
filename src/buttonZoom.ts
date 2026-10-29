/**
 * On-screen +/− zoom. A click applies one discrete factor with the same
 * zoom-toward-center math as an instant step, and the scale interpolates
 * across 150ms. Another click queues the next step from that target so
 * the in-between scale is not resampled. Gestures cancel and keep the
 * scale currently on screen. The shell can ask a step to land on that
 * target immediately.
 */

import {
  applyCameraCommand,
  type Camera,
  type CameraCommand,
  type ResolvedCameraLimits,
} from './camera';

export const BUTTON_ZOOM_MS = 150;

type ZoomSegment = {
  from: Camera;
  to: Camera;
  startedAt: number;
};

export type ButtonZoom = {
  /** Camera currently on screen. */
  camera: Camera;
  /** Queued steps, including the one in flight. Each lasts BUTTON_ZOOM_MS. */
  segments: readonly ZoomSegment[];
};

export function createButtonZoom(camera: Camera): ButtonZoom {
  return { camera, segments: [] };
}

/** Where repeated clicks accumulate. Falls back to the scale on screen. */
export function committedCamera(state: ButtonZoom): Camera {
  const last = state.segments[state.segments.length - 1];
  return last ? last.to : state.camera;
}

export function pressButtonZoom(
  state: ButtonZoom,
  factor: number,
  viewW: number,
  viewH: number,
  now: number,
  limits?: ResolvedCameraLimits,
): ButtonZoom {
  const base = committedCamera(state);
  const to = applyCameraCommand(
    base,
    { type: 'zoomAt', x: viewW / 2, y: viewH / 2, factor },
    viewW,
    viewH,
    limits,
  );
  if (to.scale === base.scale && to.x === base.x && to.y === base.y) return state;
  const previous = state.segments[state.segments.length - 1];
  const segment: ZoomSegment = {
    from: previous ? previous.to : state.camera,
    to,
    startedAt: previous ? previous.startedAt + BUTTON_ZOOM_MS : now,
  };
  return { camera: state.camera, segments: [...state.segments, segment] };
}

export function tickButtonZoom(state: ButtonZoom, now: number): ButtonZoom {
  if (state.segments.length === 0) return state;
  let index = 0;
  while (index < state.segments.length && now >= state.segments[index].startedAt + BUTTON_ZOOM_MS) {
    index += 1;
  }
  if (index >= state.segments.length) {
    return createButtonZoom(state.segments[state.segments.length - 1].to);
  }
  const segment = state.segments[index];
  const elapsed = now - segment.startedAt;
  return {
    camera: elapsed <= 0 ? segment.from : frameCamera(segment, elapsed),
    segments: index === 0 ? state.segments : state.segments.slice(index),
  };
}

/** Drop queued steps and keep the scale currently on screen. */
export function cancelButtonZoom(state: ButtonZoom): ButtonZoom {
  if (state.segments.length === 0) return state;
  return createButtonZoom(state.camera);
}

/**
 * Apply one camera command to button-zoom state.
 * `panBy`, `zoomAt`, and `retarget` run on the camera on screen, then
 * `cancelButtonZoom` drops the queue. `zoomStep` queues a 150ms step
 * from the committed camera, so a second click does not resample the
 * in-between scale. The target is clamped to `limits` before the blend, so
 * the step does not overshoot. `settleZoomStep` keeps that target and drops the blend.
 */
export function applyButtonZoomCommand(
  state: ButtonZoom,
  command: CameraCommand,
  viewW: number,
  viewH: number,
  now: number,
  options?: { settleZoomStep?: boolean; limits?: ResolvedCameraLimits },
): ButtonZoom {
  if (command.type === 'zoomStep') {
    const queued = pressButtonZoom(state, command.factor, viewW, viewH, now, options?.limits);
    if (!options?.settleZoomStep || queued.segments.length === 0) return queued;
    return createButtonZoom(committedCamera(queued));
  }
  const next = applyCameraCommand(state.camera, command, viewW, viewH, options?.limits);
  // The command already ran on the camera that was on screen. Cancel keeps
  // that camera and drops the queue (the same settle as createButtonZoom).
  return cancelButtonZoom({ camera: next, segments: state.segments });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Log-scale blend so a 2× step moves at a constant zoom rate. */
function frameCamera(segment: ZoomSegment, elapsedMs: number): Camera {
  const t = clamp01(elapsedMs / BUTTON_ZOOM_MS);
  const fromScale = segment.from.scale;
  const toScale = segment.to.scale;
  const scale =
    fromScale > 0 && toScale > 0
      ? Math.exp(Math.log(fromScale) + (Math.log(toScale) - Math.log(fromScale)) * t)
      : toScale;
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * t,
    y: segment.from.y + (segment.to.y - segment.from.y) * t,
    scale,
  };
}
