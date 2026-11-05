import { boxFitScale } from './camera';
import type { CanvasObject } from './model';

/**
 * Share of the limiting viewport side the fully exploded images should fill.
 * Labels sit in the margin at a fixed screen size, so they are not in this fit.
 */
export const EXPLODED_FILL = 0.85;

/** Painted label height at the end of the level's fade, in CSS pixels. */
const LABEL_PX = 18;

/** Shortest leader, edge to edge, in CSS pixels. */
const LEADER_PX = 12;

/** Clear space between two labels, in CSS pixels. */
const LABEL_PAD_PX = 6;

/** Labels stay this far inside the viewport, in CSS pixels. */
const VIEW_PAD_PX = 8;

/** Leaders are authored at least this far off both axes. The rule is 20°. */
const MIN_LEADER_RAD = (22 * Math.PI) / 180;

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

/** Which way plates step off the frame. `x` is a row, `y` is a stack. */
export type ExplodeAxis = 'x' | 'y';

export type ExplodeOptions = {
  /**
   * Plate step direction. Default `y`: lower `z` steps down, higher `z` steps up.
   * `x` puts lower `z` on the left and higher `z` on the right.
   */
  axis?: ExplodeAxis;
  /**
   * Parts that are not on the origin move into columns beside the frame.
   * Set false to leave them at their assembled offsets. Default true.
   */
  spreadInternals?: boolean;
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
 * middle plate is the frame and stays centred. The other plates step along
 * `options.axis` until `gap` is clear. Every other part keeps its side of
 * the frame and stacks in assembled-`y` order beside it, unless
 * `spreadInternals` is false. A level with fewer than two parts on the
 * origin moves each part out along the ray from the origin. `gap` of 0
 * returns the assembled positions.
 */
export function explodeLevel(
  parts: readonly LevelPart[],
  gap: number,
  options?: ExplodeOptions,
): readonly ExplodedPart[] {
  if (!(gap > 0) || !Number.isFinite(gap)) {
    return parts.map((part) => ({ id: part.id, x: part.x, y: part.y, scale: 1 }));
  }
  const moved = spread(parts, gap, options);
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
    const labels = labelSides(byId, group.id, new Set(parts.map((part) => part.id)));
    const options = explodeOptions(view);
    const opened = options.axis === 'x' ? Math.max(gap, gutterGap(parts, labels, byId, view)) : gap;
    const spread = explodeLevel(parts, opened, options);
    const spreadAt = new Map(spread.map((part) => [part.id, part]));
    const plateIds = new Set(parts.filter(onOrigin).map((part) => part.id));

    const assembledPoints = new Map(parts.map((part) => [part.id, { x: part.x, y: part.y }]));
    const explodedPoints = new Map(parts.map((part) => {
      const at = spreadAt.get(part.id);
      return [part.id, { x: at?.x ?? part.x, y: at?.y ?? part.y }];
    }));
    for (const [labelId, partId] of labels) {
      const part = parts.find((candidate) => candidate.id === partId);
      if (!part) continue;
      // At the start of the fade the label sits on its part. It is invisible
      // there, and it does not widen the opening fit.
      assembledPoints.set(labelId, { x: part.x, y: part.y });
    }

    // The spread is not symmetric (a tall cell under a thin board, or a wider
    // column on one side). Shift the images onto the group origin so the
    // fitted level sits in the middle of the view. Labels are placed after
    // that, in the margin.
    const explodedShift = boundsCenter(edgesOf(parts.map((part) => {
      const at = explodedPoints.get(part.id);
      return { ...part, x: at?.x ?? part.x, y: at?.y ?? part.y };
    })));
    for (const [id, point] of explodedPoints) {
      explodedPoints.set(id, { x: point.x - explodedShift.x, y: point.y - explodedShift.y });
    }

    const groupScale = positiveScale(group.scale);
    const assembledScale = 1 / groupScale;
    let explodedScale = assembledScale;
    let t = 0;
    let pxPerLocal = 0;
    let ancestor = groupScale;
    let cameraAtEnd = 0;
    const fade = fadeOf([...images, ...childrenOf(byId, group.id, 'text')]);
    if (view && view.width > 0 && view.height > 0 && view.scale > 0 && fade) {
      const reference = fade.anchor ? anchorFit(fade.anchor, byId, adjustments, view) : view.fitScale;
      if (reference !== undefined && reference > 0) {
        t = fadeProgress(view.scale / reference, fade.start, fade.end);
        const bounds = edgesOf(parts.map((part) => {
          const at = explodedPoints.get(part.id);
          return { ...part, x: at?.x ?? part.x, y: at?.y ?? part.y };
        }));
        ancestor = worldScale(group.id, byId, adjustments);
        cameraAtEnd = reference * fade.end;
        explodedScale = viewportFillScale(bounds, view.width, view.height, ancestor, cameraAtEnd);
        pxPerLocal = explodedScale * ancestor * cameraAtEnd;
        const shifted = parts.map((part) => {
          const at = explodedPoints.get(part.id);
          return { ...part, x: at?.x ?? part.x, y: at?.y ?? part.y };
        });
        const placed = arrangeLabels(shifted, labels, byId, view, pxPerLocal, options.axis ?? 'x', plateIds);
        for (const [labelId, at] of placed) explodedPoints.set(labelId, at);
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
      const label = byId.get(labelId);
      if (!from || !to || !label || label.payload.type !== 'text') continue;
      const sizeScale = pxPerLocal > 0
        ? labelSizeScale(label.payload.height, ancestor, cameraAtEnd)
        : scale;
      adjustments.set(labelId, {
        id: labelId,
        x: lerp(from.x, to.x, t) * scale,
        y: lerp(from.y, to.y, t) * scale,
        scale: sizeScale,
      });
    }
  }
  return adjustments;
}

/**
 * Wide views lay the plates out in a row and pull the loose parts off the
 * frame. Tall views stack the plates and leave the loose parts on the frame,
 * where a side label still has room.
 */
function explodeOptions(view: PlacementView | undefined): ExplodeOptions {
  if (view && view.height > view.width) return { axis: 'y', spreadInternals: false };
  return { axis: 'x', spreadInternals: false };
}

/**
 * On a wide view the plates sit in a row and the loose parts stay on the
 * frame. The gutter between plates has to hold the widest of those labels.
 * Returns a gap in the level's millimetres, or 0 when there is nothing to open.
 */
function gutterGap(
  parts: readonly LevelPart[],
  labels: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, CanvasObject>,
  view: PlacementView | undefined,
): number {
  if (!view || !(view.width > 0)) return 0;
  const plates = parts.filter(onOrigin);
  if (plates.length < 2) return 0;
  let widest = 0;
  for (const [labelId, partId] of labels) {
    if (plates.some((plate) => plate.id === partId)) continue;
    const label = byId.get(labelId);
    if (!label || label.payload.type !== 'text' || !(label.payload.height > 0)) continue;
    widest = Math.max(widest, (absSize(label.payload.width) / label.payload.height) * LABEL_PX);
  }
  const need = widest + LEADER_PX + LABEL_PAD_PX + VIEW_PAD_PX;
  const sum = plates.reduce((total, plate) => total + absSize(plate.width), 0);
  const gaps = plates.length - 1;
  const denom = EXPLODED_FILL * view.width - need * gaps;
  if (!(denom > 0) || !(need > 0)) return 0;
  return (need * sum) / denom;
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

/**
 * Screen-sized labels in the level's local millimetres. Each one sits just
 * off its part, on a diagonal, clear of the other boxes and inside the view
 * at the end of the fade. Outer parts claim a spot first.
 */
function arrangeLabels(
  parts: readonly LevelPart[],
  labels: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, CanvasObject>,
  view: PlacementView,
  pxPerLocal: number,
  layout: ExplodeAxis,
  plateIds: ReadonlySet<string>,
): Map<string, { x: number; y: number }> {
  const placed = new Map<string, { x: number; y: number }>();
  if (!(pxPerLocal > 0)) return placed;
  const leader = LEADER_PX / pxPerLocal;
  const pad = LABEL_PAD_PX / pxPerLocal;
  const viewBox = viewEdges(view, pxPerLocal);
  const obstacles: LevelPart[] = parts.map((part) => ({ ...part }));
  const leaders: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = [];
  const order = [...labels.entries()].sort((a, b) => {
    const partA = parts.find((part) => part.id === a[1]);
    const partB = parts.find((part) => part.id === b[1]);
    const da = partA ? Math.hypot(partA.x, partA.y) : 0;
    const db = partB ? Math.hypot(partB.x, partB.y) : 0;
    return db - da || a[0].localeCompare(b[0]);
  });
  for (const [labelId, partId] of order) {
    const label = byId.get(labelId);
    const part = parts.find((candidate) => candidate.id === partId);
    if (!label || label.payload.type !== 'text' || !part) continue;
    const size = labelLocalSize(label.payload.width, label.payload.height, pxPerLocal);
    const prefer: ExplodeAxis = plateIds.has(part.id) && layout === 'x' ? 'y' : 'x';
    const spot = findLabelSpot(part, size, leader, pad, prefer, obstacles, leaders, viewBox);
    placed.set(labelId, spot);
    obstacles.push({ id: labelId, x: spot.x, y: spot.y, width: size.width, height: size.height });
    leaders.push({ from: { x: part.x, y: part.y }, to: spot });
  }
  return placed;
}

function labelLocalSize(width: number, height: number, pxPerLocal: number): { width: number; height: number } {
  const localH = LABEL_PX / pxPerLocal;
  const aspect = absSize(height) > 0 ? absSize(width) / absSize(height) : 1;
  return { width: localH * aspect, height: localH };
}

function labelSizeScale(authoredHeight: number, ancestor: number, cameraAtEnd: number): number {
  if (!(authoredHeight > 0) || !(ancestor > 0) || !(cameraAtEnd > 0)) return 1;
  return LABEL_PX / (authoredHeight * ancestor * cameraAtEnd);
}

function viewEdges(view: PlacementView, pxPerLocal: number): Edges {
  const pad = VIEW_PAD_PX / pxPerLocal;
  return {
    left: -view.width / 2 / pxPerLocal + pad,
    right: view.width / 2 / pxPerLocal - pad,
    top: -view.height / 2 / pxPerLocal + pad,
    bottom: view.height / 2 / pxPerLocal - pad,
  };
}

type LabelSide = 'left' | 'right' | 'up' | 'down';

function findLabelSpot(
  part: LevelPart,
  size: { width: number; height: number },
  leader: number,
  pad: number,
  prefer: ExplodeAxis,
  obstacles: readonly LevelPart[],
  leaders: readonly { from: { x: number; y: number }; to: { x: number; y: number } }[],
  viewBox: Edges,
): { x: number; y: number } {
  let best: { x: number; y: number; score: number } | undefined;
  const sides = sidesFor(part, prefer);
  for (let index = 0; index < sides.length; index += 1) {
    const side = sides[index];
    if (!side) continue;
    for (const align of [-0.7, -0.35, 0, 0.35, 0.7]) {
      const spot = slideSide(part, size, side, align, leader, pad, obstacles, leaders, viewBox);
      if (!spot) continue;
      const score = index * 10000 + Math.hypot(spot.x - part.x, spot.y - part.y);
      if (!best || score < best.score) best = { ...spot, score };
    }
  }
  if (best) return { x: best.x, y: best.y };
  const fallback = sides[0] === 'left' || sides[0] === 'right' || sides[0] === 'up' || sides[0] === 'down'
    ? sides[0]
    : 'up';
  return nudgeAngle(part, {
    x: part.x + (fallback === 'left' ? -1 : fallback === 'right' ? 1 : 0) * (absSize(part.width) / 2 + absSize(size.width) / 2 + leader),
    y: part.y + (fallback === 'up' ? -1 : fallback === 'down' ? 1 : 0) * (absSize(part.height) / 2 + absSize(size.height) / 2 + leader),
  }, fallback);
}

function sidesFor(part: { x: number; y: number }, prefer: ExplodeAxis): LabelSide[] {
  if (prefer === 'y') {
    const vertical: LabelSide[] = part.y <= 0 ? ['up', 'down'] : ['down', 'up'];
    const horizontal: LabelSide[] = part.x <= 0 ? ['left', 'right'] : ['right', 'left'];
    return [...vertical, ...horizontal];
  }
  const horizontal: LabelSide[] = part.x <= 0 ? ['left', 'right'] : ['right', 'left'];
  const vertical: LabelSide[] = part.y <= 0 ? ['up', 'down'] : ['down', 'up'];
  return [...horizontal, ...vertical];
}

/**
 * Step the label out along one side until it clears every obstacle, stays
 * inside the view, and the leader is at least 22° off both axes.
 */
function slideSide(
  part: LevelPart,
  size: { width: number; height: number },
  side: LabelSide,
  align: number,
  leader: number,
  pad: number,
  obstacles: readonly LevelPart[],
  leaders: readonly { from: { x: number; y: number }; to: { x: number; y: number } }[],
  viewBox: Edges,
): { x: number; y: number } | null {
  const halfW = absSize(part.width) / 2;
  const halfH = absSize(part.height) / 2;
  const labelW = absSize(size.width) / 2;
  const labelH = absSize(size.height) / 2;
  const along = side === 'left' || side === 'right' ? align * halfH : align * halfW;
  for (let step = 0; step < 36; step += 1) {
    const extra = leader * step * 0.45;
    const raw = {
      x: side === 'right'
        ? part.x + halfW + leader + extra + labelW
        : side === 'left'
          ? part.x - halfW - leader - extra - labelW
          : part.x + along,
      y: side === 'down'
        ? part.y + halfH + leader + extra + labelH
        : side === 'up'
          ? part.y - halfH - leader - extra - labelH
          : part.y + along,
    };
    const at = nudgeAngle(part, raw, side);
    const box: LevelPart = { id: `${part.id}-label`, x: at.x, y: at.y, width: size.width, height: size.height };
    if (!insideEdges(box, viewBox)) return null;
    if (!offAxis(part, at)) continue;
    if (!clearsAll(box, obstacles, pad, leader)) continue;
    if (leaders.some((other) => segmentsCross(part, at, other.from, other.to))) continue;
    return at;
  }
  return null;
}

/** Push the shorter component out so the centre line clears both axes. */
function nudgeAngle(
  part: { x: number; y: number },
  at: { x: number; y: number },
  side: LabelSide,
): { x: number; y: number } {
  let dx = at.x - part.x;
  let dy = at.y - part.y;
  const min = Math.tan(MIN_LEADER_RAD);
  if (Math.abs(dy) < Math.abs(dx) * min) {
    const sign = side === 'up' || dy < 0 ? -1 : 1;
    dy = sign * (Math.abs(dx) * min + 1e-4);
  }
  if (Math.abs(dx) < Math.abs(dy) * min) {
    const sign = side === 'left' || dx < 0 ? -1 : 1;
    dx = sign * (Math.abs(dy) * min + 1e-4);
  }
  return { x: part.x + dx, y: part.y + dy };
}

function offAxis(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const angle = Math.abs(Math.atan2(to.y - from.y, to.x - from.x));
  const toHorizontal = Math.min(angle, Math.PI - angle);
  const toVertical = Math.abs(angle - Math.PI / 2);
  return Math.min(toHorizontal, toVertical) >= MIN_LEADER_RAD - 1e-3;
}

function clearsAll(box: LevelPart, obstacles: readonly LevelPart[], labelGap: number, partGap: number): boolean {
  for (const other of obstacles) {
    const gap = other.id.endsWith('-label') ? labelGap : partGap;
    if (separation(box, other) < gap - 1e-6) return false;
  }
  return true;
}

function insideEdges(box: LevelPart, view: Edges): boolean {
  const halfW = absSize(box.width) / 2;
  const halfH = absSize(box.height) / 2;
  return box.x - halfW >= view.left
    && box.x + halfW <= view.right
    && box.y - halfH >= view.top
    && box.y + halfH <= view.bottom;
}

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
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

function spread(parts: readonly LevelPart[], gap: number, options: ExplodeOptions | undefined): LevelPart[] {
  const plates = parts.filter(onOrigin).sort(byDepth);
  if (plates.length >= 2) return spreadPlates(parts, plates, gap, options ?? {});
  return spreadRadial(parts, gap);
}

/**
 * Plates step off the frame. `y` stacks them (higher `z` is up). `x` lays
 * them in a row (higher `z` is to the right). Internals form one column on
 * each side, top to bottom in assembled order, unless they stay assembled.
 */
function spreadPlates(
  parts: readonly LevelPart[],
  plates: readonly LevelPart[],
  gap: number,
  options: ExplodeOptions,
): LevelPart[] {
  const frame = plates[Math.floor((plates.length - 1) / 2)] ?? plates[0];
  if (!frame) return parts.map((part) => ({ ...part }));
  const placed: LevelPart[] = [{ ...frame, x: 0, y: 0 }];
  const internals = parts.filter((part) => !onOrigin(part));
  if (options.spreadInternals === false) {
    for (const part of internals) placed.push({ ...part });
  } else {
    placeColumn(internals.filter((part) => part.x < 0), -1, frame, gap, placed);
    placeColumn(internals.filter((part) => part.x >= 0), 1, frame, gap, placed);
  }
  const others = plates.filter((part) => part.id !== frame.id).sort((a, b) => {
    const dz = Math.abs(depth(a) - depth(frame)) - Math.abs(depth(b) - depth(frame));
    return dz !== 0 ? dz : a.id.localeCompare(b.id);
  });
  const axis = options.axis ?? 'y';
  for (const plate of others) {
    // Higher z is the front of the phone.
    const sign = depth(plate) >= depth(frame) ? 1 : -1;
    const dir = axis === 'x' ? { x: sign, y: 0 } : { x: 0, y: -sign };
    placed.push(slide(plate, dir, placed, gap));
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
