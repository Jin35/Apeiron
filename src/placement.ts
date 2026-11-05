import { boxFitScale } from './camera';
import type { CanvasObject } from './model';

/**
 * Share of the limiting viewport side the fully exploded level should fill.
 * Inside the 85–90% band: large parts, a little paper around them.
 */
export const EXPLODED_FILL = 0.875;

/** Clear millimetres between a label and its part. Short leaders. */
const LABEL_GAP = 4;

/** Centre-to-centre angle of a leader, off horizontal. Stays above the 20° rule. */
const LABEL_ANGLE = (38 * Math.PI) / 180;

/**
 * World position of one object. `scale` multiplies the payload size and
 * every descendant. `x` and `y` are already in world units.
 */
export type WorldPlacement = {
  x: number;
  y: number;
  scale: number;
};

/** One image part of a level, in that level's units, at its assembled position. */
export type LevelPart = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Higher is closer to the front. Omit for 0. */
  z?: number;
};

/**
 * The same part after the level's explode rule.
 * `scale` multiplies the authored size. `x` and `y` are the laid-out centre
 * and already include that scale, so a caller's own object scale still does
 * not move the centre.
 */
export type ExplodedPart = {
  id: string;
  x: number;
  y: number;
  scale: number;
};

type Edges = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * The camera the explode fit is resolved against. Omit it and every level
 * stays at its assembled size, matched to the parent, which is what the
 * opening fit and a zoom before the fade use.
 */
export type PlacementView = {
  scale: number;
  fitScale?: number;
  width: number;
  height: number;
};

/**
 * Pull `parts` apart. Scale stays 1: fitting to the viewport happens later,
 * with the fade, so the spread itself is just the arrangement.
 *
 * Two or more parts on the origin are the plates, ordered by `z`. The
 * middle plate is the frame and stays centred. Lower `z` steps down and
 * higher `z` steps up until `gap` is clear. Every other part keeps its side
 * of the frame and stacks in assembled-`y` order beside it. A level with
 * fewer than two parts on the origin moves each part out along the ray from
 * the origin. `gap` of 0 returns the assembled positions.
 */
export function explodeLevel(parts: readonly LevelPart[], gap: number): readonly ExplodedPart[] {
  if (!(gap > 0) || !Number.isFinite(gap)) {
    return parts.map((part) => ({ id: part.id, x: part.x, y: part.y, scale: 1 }));
  }
  const moved = spread(parts, gap);
  const byId = new Map(moved.map((part) => [part.id, part]));
  return parts.map((part) => {
    const at = byId.get(part.id) ?? part;
    return { id: part.id, x: at.x, y: at.y, scale: 1 };
  });
}

/**
 * World placement of every object, matching the memory store and
 * `resolveWorldRect`. A group's `explode` is applied to its direct image
 * children before the parent scale. With a `view`, the spread eases in
 * across that group's fade: assembled and matched to the parent at the
 * start, fully apart and filling the viewport at the end. A missing parent
 * or a cycle is null.
 * The first object with an id is the parent; a later duplicate is placed
 * from its own record but still uses that parent.
 */
export function createPlacement(
  objects: readonly CanvasObject[],
  view?: PlacementView,
): (object: CanvasObject) => WorldPlacement | null {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    if (!byId.has(object.id)) byId.set(object.id, object);
  }
  const laidOut = layoutAdjustments(byId, view);
  const world = new Map<CanvasObject, WorldPlacement | null>();

  function resolve(object: CanvasObject, stack: Set<CanvasObject>): WorldPlacement | null {
    const known = world.get(object);
    if (known !== undefined) return known;
    if (stack.has(object)) return null;

    stack.add(object);
    const laid = laidOut.get(object.id);
    const local = positiveScale(object.scale) * (laid?.scale ?? 1);
    const x = laid?.x ?? object.x;
    const y = laid?.y ?? object.y;
    let placed: WorldPlacement | null = null;
    if (object.parentId === undefined) {
      placed = { x, y, scale: local };
    } else {
      const parent = byId.get(object.parentId);
      const origin = parent ? resolve(parent, stack) : null;
      if (origin) {
        placed = {
          x: origin.x + x * origin.scale,
          y: origin.y + y * origin.scale,
          scale: origin.scale * local,
        };
      }
    }
    stack.delete(object);
    world.set(object, placed);
    return placed;
  }

  return (object) => resolve(object, new Set());
}

function layoutAdjustments(
  byId: ReadonlyMap<string, CanvasObject>,
  view: PlacementView | undefined,
): Map<string, ExplodedPart> {
  const adjustments = new Map<string, ExplodedPart>();
  const groups = [...byId.values()].filter(
    (object) => object.payload.type === 'group' && object.payload.explode !== undefined && object.payload.explode > 0,
  );
  groups.sort((a, b) => chainDepth(a.id, byId) - chainDepth(b.id, byId));

  for (const group of groups) {
    if (group.payload.type !== 'group') continue;
    const gap = group.payload.explode;
    if (gap === undefined || !(gap > 0)) continue;
    const images = childrenOf(byId, group.id, 'image');
    const parts: LevelPart[] = images.map((child) => ({
      id: child.id,
      x: child.x,
      y: child.y,
      width: child.payload.type === 'image' ? child.payload.width : 0,
      height: child.payload.type === 'image' ? child.payload.height : 0,
      ...(child.z !== undefined ? { z: child.z } : {}),
    }));
    const spread = explodeLevel(parts, gap);
    const spreadAt = new Map(spread.map((part) => [part.id, part]));
    const labels = labelSides(byId, group.id, new Set(parts.map((part) => part.id)));

    const assembledPoints = new Map(parts.map((part) => [part.id, { x: part.x, y: part.y }]));
    const explodedPoints = new Map(parts.map((part) => {
      const at = spreadAt.get(part.id);
      return [part.id, { x: at?.x ?? part.x, y: at?.y ?? part.y }];
    }));
    for (const [labelId, partId] of labels) {
      const label = byId.get(labelId);
      const part = parts.find((candidate) => candidate.id === partId);
      if (!label || label.payload.type !== 'text' || !part) continue;
      const size = { width: label.payload.width, height: label.payload.height };
      const exploded = explodedPoints.get(partId) ?? { x: part.x, y: part.y };
      // At the start of the fade the label is on its part (invisible, and it
      // does not widen the opening fit). It steps out beside the part as the
      // level explodes, so the leader stays short.
      assembledPoints.set(labelId, { x: part.x, y: part.y });
      explodedPoints.set(labelId, placeLabel({ ...part, x: exploded.x, y: exploded.y }, size));
    }

    // The spread is not symmetric (a tall cell under a thin board). Shift it
    // onto the group origin so the fitted level sits in the middle of the view.
    const explodedShift = boundsCenter(edgesOf(boundsParts(parts, labels, explodedPoints, byId)));
    for (const [id, point] of explodedPoints) {
      explodedPoints.set(id, { x: point.x - explodedShift.x, y: point.y - explodedShift.y });
    }

    const groupScale = positiveScale(group.scale);
    const assembledScale = 1 / groupScale;
    let explodedScale = assembledScale;
    let t = 0;
    const fade = fadeOf([...images, ...childrenOf(byId, group.id, 'text')]);
    if (view && view.width > 0 && view.height > 0 && view.scale > 0 && fade) {
      const reference = fade.anchor ? anchorFit(fade.anchor, byId, adjustments, view) : view.fitScale;
      if (reference !== undefined && reference > 0) {
        t = fadeProgress(view.scale / reference, fade.start, fade.end);
        const bounds = edgesOf(boundsParts(parts, labels, explodedPoints, byId));
        const ancestor = worldScale(group.id, byId, adjustments);
        const cameraAtEnd = reference * fade.end;
        explodedScale = viewportFillScale(bounds, view.width, view.height, ancestor, cameraAtEnd);
      }
    }
    const scale = lerp(assembledScale, explodedScale, t);
    for (const part of parts) {
      const from = assembledPoints.get(part.id) ?? { x: part.x, y: part.y };
      const to = explodedPoints.get(part.id) ?? from;
      adjustments.set(part.id, { id: part.id, x: lerp(from.x, to.x, t) * scale, y: lerp(from.y, to.y, t) * scale, scale });
    }
    for (const [labelId] of labels) {
      const from = assembledPoints.get(labelId);
      const to = explodedPoints.get(labelId);
      if (!from || !to) continue;
      adjustments.set(labelId, { id: labelId, x: lerp(from.x, to.x, t) * scale, y: lerp(from.y, to.y, t) * scale, scale });
    }
  }
  return adjustments;
}

function childrenOf(
  byId: ReadonlyMap<string, CanvasObject>,
  parentId: string,
  type: 'image' | 'text',
): CanvasObject[] {
  const children: CanvasObject[] = [];
  for (const child of byId.values()) {
    if (child.parentId === parentId && child.payload.type === type) children.push(child);
  }
  return children;
}

/** Label id to the part id its leader points at. */
function labelSides(
  byId: ReadonlyMap<string, CanvasObject>,
  groupId: string,
  partIds: ReadonlySet<string>,
): Map<string, string> {
  const sides = new Map<string, string>();
  for (const object of byId.values()) {
    if (object.payload.type !== 'link') continue;
    const { from, to } = object.payload;
    const fromObject = byId.get(from);
    const toObject = byId.get(to);
    if (fromObject?.parentId === groupId && fromObject.payload.type === 'text' && partIds.has(to)) {
      sides.set(from, to);
    } else if (toObject?.parentId === groupId && toObject.payload.type === 'text' && partIds.has(from)) {
      sides.set(to, from);
    }
  }
  return sides;
}

function placeLabel(
  part: { x: number; y: number; width: number; height: number },
  label: { width: number; height: number },
): { x: number; y: number } {
  const { sx, sy } = labelQuadrant(part);
  let dx = absSize(part.width) / 2 + LABEL_GAP + absSize(label.width) / 2;
  let dy = absSize(part.height) / 2 + LABEL_GAP + absSize(label.height) / 2;
  const minRatio = Math.tan(LABEL_ANGLE);
  if (dy / dx < minRatio) dy = dx * minRatio;
  if (dx / dy < minRatio) dx = dy * minRatio;
  return { x: part.x + sx * dx, y: part.y + sy * dy };
}

function labelQuadrant(part: { x: number; y: number }): { sx: number; sy: number } {
  if (Math.hypot(part.x, part.y) <= ON_ORIGIN_MM) return { sx: 1, sy: 1 };
  if (Math.abs(part.x) <= ON_ORIGIN_MM) return part.y < 0 ? { sx: 1, sy: -1 } : { sx: -1, sy: 1 };
  return { sx: part.x < 0 ? -1 : 1, sy: part.y < 0 ? -1 : 1 };
}

function boundsParts(
  parts: readonly LevelPart[],
  labels: ReadonlyMap<string, string>,
  points: ReadonlyMap<string, { x: number; y: number }>,
  byId: ReadonlyMap<string, CanvasObject>,
): LevelPart[] {
  const boxes: LevelPart[] = parts.map((part) => {
    const at = points.get(part.id);
    return { ...part, x: at?.x ?? part.x, y: at?.y ?? part.y };
  });
  for (const [labelId] of labels) {
    const label = byId.get(labelId);
    const at = points.get(labelId);
    if (!label || label.payload.type !== 'text' || !at) continue;
    boxes.push({ id: labelId, x: at.x, y: at.y, width: label.payload.width, height: label.payload.height });
  }
  return boxes;
}

function fadeOf(children: readonly CanvasObject[]): { start: number; end: number; anchor?: string } | undefined {
  for (const child of children) {
    const range = child.fade?.fadeIn;
    if (!range) continue;
    const [start, end] = range;
    if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    return { start, end, ...(child.fade?.fadeInOf ? { anchor: child.fade.fadeInOf } : {}) };
  }
  return undefined;
}

function fadeProgress(ratio: number, start: number, end: number): number {
  if (!Number.isFinite(ratio)) return 0;
  if (ratio <= start) return 0;
  if (ratio >= end) return 1;
  return (ratio - start) / (end - start);
}

function anchorFit(
  id: string,
  byId: ReadonlyMap<string, CanvasObject>,
  adjustments: ReadonlyMap<string, ExplodedPart>,
  view: PlacementView,
): number | undefined {
  const object = byId.get(id);
  if (!object || (object.payload.type !== 'image' && object.payload.type !== 'text')) return undefined;
  const scale = worldScale(id, byId, adjustments);
  const width = absSize(object.payload.width) * scale;
  const height = absSize(object.payload.height) * scale;
  if (!(width > 0) || !(height > 0)) return undefined;
  return boxFitScale({ left: -width / 2, right: width / 2, top: -height / 2, bottom: height / 2 }, view.width, view.height);
}

function viewportFillScale(bounds: Edges, viewW: number, viewH: number, ancestor: number, cameraAtEnd: number): number {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0) || !(ancestor > 0) || !(cameraAtEnd > 0)) return 1;
  const fit = Math.min(viewW / width, viewH / height);
  if (!(fit > 0) || !Number.isFinite(fit)) return 1;
  return (EXPLODED_FILL * fit) / (ancestor * cameraAtEnd);
}

function worldScale(
  id: string,
  byId: ReadonlyMap<string, CanvasObject>,
  adjustments: ReadonlyMap<string, ExplodedPart>,
  seen = new Set<string>(),
): number {
  const object = byId.get(id);
  if (!object || seen.has(id)) return 1;
  seen.add(id);
  const own = positiveScale(object.scale) * (adjustments.get(id)?.scale ?? 1);
  if (!object.parentId) return own;
  return worldScale(object.parentId, byId, adjustments, seen) * own;
}

function chainDepth(id: string, byId: ReadonlyMap<string, CanvasObject>, seen = new Set<string>()): number {
  const object = byId.get(id);
  if (!object?.parentId || seen.has(id)) return 0;
  seen.add(id);
  return 1 + chainDepth(object.parentId, byId, seen);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function boundsCenter(bounds: Edges): { x: number; y: number } {
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}

const ON_ORIGIN_MM = 1e-6;

function spread(parts: readonly LevelPart[], gap: number): LevelPart[] {
  const plates = parts.filter(onOrigin).sort(byDepth);
  if (plates.length >= 2) return spreadPlates(parts, plates, gap);
  return spreadRadial(parts, gap);
}

/**
 * Plates step off the frame along y (up is negative). Internals form one
 * column on each side, top to bottom in assembled order, so the stack stays
 * as tall as the phone and the crossfade still fills the screen.
 */
function spreadPlates(parts: readonly LevelPart[], plates: readonly LevelPart[], gap: number): LevelPart[] {
  const frame = plates[Math.floor((plates.length - 1) / 2)] ?? plates[0];
  if (!frame) return parts.map((part) => ({ ...part }));
  const placed: LevelPart[] = [{ ...frame, x: 0, y: 0 }];
  const internals = parts.filter((part) => !onOrigin(part));
  placeColumn(internals.filter((part) => part.x < 0), -1, frame, gap, placed);
  placeColumn(internals.filter((part) => part.x >= 0), 1, frame, gap, placed);
  const others = plates.filter((part) => part.id !== frame.id).sort((a, b) => {
    const dz = Math.abs(depth(a) - depth(frame)) - Math.abs(depth(b) - depth(frame));
    return dz !== 0 ? dz : a.id.localeCompare(b.id);
  });
  for (const plate of others) {
    // Higher z is the front of the phone, drawn above the frame.
    const sign = depth(plate) >= depth(frame) ? 1 : -1;
    placed.push(slide(plate, { x: 0, y: -sign }, placed, gap));
  }
  return placed;
}

function placeColumn(
  column: readonly LevelPart[],
  side: -1 | 1,
  frame: LevelPart,
  gap: number,
  placed: LevelPart[],
): void {
  if (column.length === 0) return;
  const ordered = [...column].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
  const heights = ordered.map((part) => absSize(part.height));
  const stack = heights.reduce((sum, height) => sum + height, 0) + gap * (ordered.length - 1);
  const mean = ordered.reduce((sum, part) => sum + part.y, 0) / ordered.length;
  const frameTop = -absSize(frame.height) / 2;
  const frameBottom = absSize(frame.height) / 2;
  let top = mean - stack / 2;
  if (stack <= absSize(frame.height)) {
    if (top < frameTop) top = frameTop;
    if (top + stack > frameBottom) top = frameBottom - stack;
  }
  let cursor = top;
  for (let i = 0; i < ordered.length; i += 1) {
    const part = ordered[i];
    const height = heights[i];
    if (!part || height === undefined) continue;
    const width = absSize(part.width);
    const y = cursor + height / 2;
    const x = side < 0
      ? -absSize(frame.width) / 2 - gap - width / 2
      : absSize(frame.width) / 2 + gap + width / 2;
    cursor += height + gap;
    placed.push({ ...part, x, y });
  }
}

/** Each part leaves the origin along its assembled direction. Nothing moves inward. */
function spreadRadial(parts: readonly LevelPart[], gap: number): LevelPart[] {
  const placed: LevelPart[] = [];
  for (const part of parts.filter(onOrigin)) placed.push({ ...part });
  const movers = parts
    .filter((part) => !onOrigin(part))
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.id.localeCompare(b.id));
  for (const part of movers) {
    const length = Math.hypot(part.x, part.y);
    const dir = { x: part.x / length, y: part.y / length };
    if (clears({ ...part }, placed, gap)) {
      placed.push({ ...part });
      continue;
    }
    placed.push(slideFrom(part, dir, length, placed, gap));
  }
  return placed;
}

function slide(part: LevelPart, dir: { x: number; y: number }, placed: readonly LevelPart[], gap: number): LevelPart {
  return slideFrom(part, dir, 0, placed, gap);
}

function slideFrom(
  part: LevelPart,
  dir: { x: number; y: number },
  start: number,
  placed: readonly LevelPart[],
  gap: number,
): LevelPart {
  const at = (distance: number): LevelPart => ({ ...part, x: dir.x * distance, y: dir.y * distance });
  if (clears(at(start), placed, gap)) return at(start);
  let lo = start;
  let hi = start + 1;
  while (hi < 10000 && !clears(at(hi), placed, gap)) hi *= 2;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (clears(at(mid), placed, gap)) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

function edgesOf(parts: readonly LevelPart[]): Edges {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    if (!Number.isFinite(part.x) || !Number.isFinite(part.y)) continue;
    const halfW = absSize(part.width) / 2;
    const halfH = absSize(part.height) / 2;
    left = Math.min(left, part.x - halfW);
    right = Math.max(right, part.x + halfW);
    top = Math.min(top, part.y - halfH);
    bottom = Math.max(bottom, part.y + halfH);
  }
  if (!(right > left) || !(bottom > top)) return { left: 0, right: 0, top: 0, bottom: 0 };
  return { left, right, top, bottom };
}

function clears(part: LevelPart, placed: readonly LevelPart[], gap: number): boolean {
  for (const other of placed) {
    if (other.id === part.id) continue;
    if (separation(part, other) < gap - 1e-6) return false;
  }
  return true;
}

function separation(a: LevelPart, b: LevelPart): number {
  const dx = Math.abs(a.x - b.x) - (absSize(a.width) + absSize(b.width)) / 2;
  const dy = Math.abs(a.y - b.y) - (absSize(a.height) + absSize(b.height)) / 2;
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  if (dx >= 0) return dx;
  if (dy >= 0) return dy;
  return Math.max(dx, dy);
}

function onOrigin(part: LevelPart): boolean {
  return Math.hypot(part.x, part.y) <= ON_ORIGIN_MM;
}

function depth(part: LevelPart): number {
  return part.z !== undefined && Number.isFinite(part.z) ? part.z : 0;
}

function byDepth(a: LevelPart, b: LevelPart): number {
  const dz = depth(a) - depth(b);
  return dz !== 0 ? dz : a.id.localeCompare(b.id);
}

function absSize(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function positiveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}
