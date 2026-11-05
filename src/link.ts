import type { CanvasObject } from './model';
import { createPlacement, type PlacementView } from './placement';

/** Default leader gap, in CSS pixels. Keeps the stroke off the endpoint boxes. */
export const LEADER_GAP_PX = 4;

/** Default leader stroke, in CSS pixels. Matches the plate hairline. */
export const LEADER_WIDTH_PX = 1.25;

/**
 * Axis-aligned rectangle. `x` and `y` are the centre.
 * Units are whatever the caller is clipping in (world or CSS pixels).
 */
export type AxisRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Directed segment. Same units as the rectangles passed to `clipLeaderLine`. */
export type LeaderSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/**
 * Segment between the centres of `from` and `to`, clipped to each rectangle
 * and then shortened by `gap` at both ends. `gap` uses the same units as the
 * rectangles, so a screen-pixel gap is applied after the rects are projected.
 * Overlapping rectangles, a zero-length span, or a gap that consumes the span
 * all return null — nothing is drawn.
 */
export function clipLeaderLine(from: AxisRect, to: AxisRect, gap = 0): LeaderSegment | null {
  if (rectsOverlap(from, to)) return null;
  if (!finitePoint(from) || !finitePoint(to)) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;

  const leaveFrom = edgeT(from, dx, dy);
  const leaveTo = edgeT(to, dx, dy);
  if (leaveFrom === null || leaveTo === null) return null;
  const enterTo = 1 - leaveTo;

  const inset = gap > 0 && Number.isFinite(gap) ? gap / length : 0;
  const t1 = leaveFrom + inset;
  const t2 = enterTo - inset;
  if (!(t2 > t1)) return null;

  return {
    x1: from.x + dx * t1,
    y1: from.y + dy * t1,
    x2: from.x + dx * t2,
    y2: from.y + dy * t2,
  };
}

/**
 * World-space centre and size of `id`. Uses the same placement as the memory
 * store, including a parent group's explode rule: a parent's scale multiplies
 * this object's position and size, and this object's own scale multiplies
 * its size and its descendants but not its own `x` / `y`.
 * A group, a link, a missing id, a broken parent, or a cycle is null.
 * The first object with `id` wins.
 */
export function resolveWorldRect(
  objects: readonly CanvasObject[],
  id: string,
  view?: PlacementView,
): AxisRect | null {
  const object = objects.find((candidate) => candidate.id === id);
  if (!object || object.payload.type === 'group' || object.payload.type === 'link') return null;
  const placed = createPlacement(objects, view)(object);
  if (!placed) return null;
  const width = object.payload.width * placed.scale;
  const height = object.payload.height * placed.scale;
  if (!(width > 0) || !(height > 0)) return null;
  if (!Number.isFinite(placed.x) || !Number.isFinite(placed.y)) return null;
  return { x: placed.x, y: placed.y, width, height };
}

/** True when the rectangles have intersecting area. Touching edges do not count. */
function rectsOverlap(a: AxisRect, b: AxisRect): boolean {
  const ahw = Math.abs(a.width) / 2;
  const ahh = Math.abs(a.height) / 2;
  const bhw = Math.abs(b.width) / 2;
  const bhh = Math.abs(b.height) / 2;
  if (!(ahw > 0) || !(ahh > 0) || !(bhw > 0) || !(bhh > 0)) return false;
  return Math.abs(a.x - b.x) < ahw + bhw && Math.abs(a.y - b.y) < ahh + bhh;
}

function finitePoint(rect: AxisRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y);
}

/**
 * Fraction of `(dx, dy)` from the rectangle centre to its edge.
 * `dx` and `dy` are the full centre-to-centre vector, so the result is
 * the parameter `t` along that vector. Null when the rectangle has no area.
 */
function edgeT(rect: AxisRect, dx: number, dy: number): number | null {
  const hw = Math.abs(rect.width) / 2;
  const hh = Math.abs(rect.height) / 2;
  if (!(hw > 0) || !(hh > 0)) return null;
  const tx = Math.abs(dx) > 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? t : null;
}
