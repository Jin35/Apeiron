import type { CanvasObject } from './model';

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
 * Pull `parts` apart and fit them back inside the assembled footprint.
 *
 * Two or more parts on the origin are the plates, ordered by `z`. The
 * middle plate is the frame and stays centred. Lower `z` steps down and
 * higher `z` steps up, along the long axis, until `gap` of the group's
 * units is clear. Every other part keeps its side of the frame (the sign
 * of its assembled `x`) and stacks in assembled-`y` order in one column
 * beside the frame. A level with fewer than two parts on the origin has no
 * plates: each part moves outward along the ray from the origin through
 * its assembled centre, and a part already on the origin stays there.
 *
 * The parts are then scaled about the origin until they sit inside the
 * assembled bounds. Uniform scale keeps the gaps. The long side of a phone
 * is what meets the parent when the group's own scale is `0.625` and the
 * fade ends at `1 / 0.625`, so the crossfade still fills the screen.
 * `gap` of 0, or a bad value, returns the assembled positions at scale 1.
 */
export function explodeLevel(parts: readonly LevelPart[], gap: number): readonly ExplodedPart[] {
  if (!(gap > 0) || !Number.isFinite(gap)) {
    return parts.map((part) => ({ id: part.id, x: part.x, y: part.y, scale: 1 }));
  }

  const moved = spread(parts, gap);
  const scale = containScale(edgesOf(parts), moved);
  const byId = new Map(moved.map((part) => [part.id, part]));
  return parts.map((part) => {
    const at = byId.get(part.id) ?? part;
    return { id: part.id, x: at.x * scale, y: at.y * scale, scale };
  });
}

/**
 * World placement of every object, matching the memory store and
 * `resolveWorldRect`. A group's `explode` is applied to its direct image
 * children before the parent scale. A missing parent or a cycle is null.
 * The first object with an id is the parent; a later duplicate is placed
 * from its own record but still uses that parent.
 */
export function createPlacement(objects: readonly CanvasObject[]): (object: CanvasObject) => WorldPlacement | null {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    if (!byId.has(object.id)) byId.set(object.id, object);
  }
  const laidOut = layoutAdjustments(byId);
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

function layoutAdjustments(byId: ReadonlyMap<string, CanvasObject>): Map<string, ExplodedPart> {
  const adjustments = new Map<string, ExplodedPart>();
  for (const group of byId.values()) {
    if (group.payload.type !== 'group') continue;
    const gap = group.payload.explode;
    if (gap === undefined || !(gap > 0) || !Number.isFinite(gap)) continue;
    const parts: LevelPart[] = [];
    for (const child of byId.values()) {
      if (child.parentId !== group.id || child.payload.type !== 'image') continue;
      parts.push({
        id: child.id,
        x: child.x,
        y: child.y,
        width: child.payload.width,
        height: child.payload.height,
        ...(child.z !== undefined ? { z: child.z } : {}),
      });
    }
    for (const placed of explodeLevel(parts, gap)) adjustments.set(placed.id, placed);
  }
  return adjustments;
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

/** Scale about the origin so every moved edge falls inside the assembled edges. */
function containScale(assembled: Edges, placed: readonly LevelPart[]): number {
  let scale = 1;
  for (const part of placed) {
    const width = absSize(part.width);
    const height = absSize(part.height);
    const left = part.x - width / 2;
    const right = part.x + width / 2;
    const top = part.y - height / 2;
    const bottom = part.y + height / 2;
    if (right > 1e-9 && assembled.right > 0) scale = Math.min(scale, assembled.right / right);
    if (left < -1e-9 && assembled.left < 0) scale = Math.min(scale, assembled.left / left);
    if (bottom > 1e-9 && assembled.bottom > 0) scale = Math.min(scale, assembled.bottom / bottom);
    if (top < -1e-9 && assembled.top < 0) scale = Math.min(scale, assembled.top / top);
  }
  if (!Number.isFinite(scale) || !(scale > 0)) return 1;
  return Math.min(scale, 1);
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
