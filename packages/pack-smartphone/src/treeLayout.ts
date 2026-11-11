import { boxFitScale, MAX_SCALE, type CanvasObject, type ShapePayload, type ZoomFade } from '@apeiron/core';
import type { HierarchyNode } from './hierarchy';

/** Largest child/parent ratio that still fits an exploded view without an extra shrink. */
const EXPLODED_FIT = 0.625;

/** Screen size of a label when its level is fully in, on a 1280×800 window. */
const LABEL_PX = 18;
const LABEL_VIEW = { width: 1280, height: 800 };

type Box = { x: number; y: number; width: number; height: number };

/**
 * Children of `parentId` are packed into `spaceId` instead of into the parent.
 * `spaceId` is a canvas object already in `built`. Its scale divides the parent's box.
 */
export type LayoutHost = {
  parentId: string;
  spaceId: string;
  /** Fade against the pack opening fit. Otherwise children fade in of `parentId`. */
  fadeAgainstOpening?: boolean;
};

/** How a packing space places nodes and labels. Absent fields use the inset defaults. */
export type SpacePolicy = {
  /** Use the full footprint. The default keeps nodes and labels in the middle. */
  fullFrame?: boolean;
  /** Label face in world units. The default sizes an 18px face on a 1280×800 window. */
  labelFontSize?: number;
};

/** Pixel size of a cut-out. The layout uses the aspect; the file contributes nothing else. */
export type LayoutArt = {
  src: string;
  width: number;
  height: number;
};

export type LayoutOptions = {
  reveal: readonly [number, number];
  hosts?: readonly LayoutHost[];
  /** Keyed by the id of the space children are packed into. */
  policies?: Readonly<Record<string, SpacePolicy>>;
  art?: Readonly<Record<string, LayoutArt>>;
  /**
   * Visibility band for a placed node.
   * `minScale` is copied. `maxScale` is at least this, and wide enough to fill a desktop.
   */
  band: { minScale: number; maxScale: number };
};

export type LayoutReport = {
  objects: CanvasObject[];
  /** Placed smaller than child size ÷ parent size so the exploded view fits. */
  shrunk: readonly { id: string; factor: number }[];
  unplaced: readonly { id: string; reason: string }[];
};

type LayoutCtx = {
  reveal: readonly [number, number];
  hosts: ReadonlyMap<string, LayoutHost>;
  policies: Readonly<Record<string, SpacePolicy>>;
  art: Readonly<Record<string, LayoutArt>>;
  band: { minScale: number; maxScale: number };
};

/**
 * One node, label, and leader for every hierarchy node that is not already
 * in `built`. Nodes already in `built` keep their coordinates. The rest are
 * packed into the parent's footprint, or into the host named for that parent.
 */
export function layoutTree(
  nodes: readonly HierarchyNode[],
  built: readonly CanvasObject[],
  options: LayoutOptions,
): LayoutReport {
  const byId = new Map<string, CanvasObject>();
  for (const object of built) byId.set(object.id, object);
  const hosts = new Map<string, LayoutHost>();
  for (const host of options.hosts ?? []) hosts.set(host.parentId, host);
  const ctx: LayoutCtx = {
    reveal: options.reveal,
    hosts,
    policies: options.policies ?? {},
    art: options.art ?? {},
    band: options.band,
  };

  const childrenOf = new Map<string, HierarchyNode[]>();
  for (const node of nodes) {
    if (!node.parentId || byId.has(node.id)) continue;
    const list = childrenOf.get(node.parentId) ?? [];
    list.push(node);
    childrenOf.set(node.parentId, list);
  }

  const objects: CanvasObject[] = [];
  const shrunk: { id: string; factor: number }[] = [];
  const unplaced: { id: string; reason: string }[] = [];

  for (const node of nodes) {
    const children = childrenOf.get(node.id);
    if (!children || children.length === 0) continue;
    const space = spaceFor(node.id, byId, ctx);
    if (!space) {
      for (const child of children) unplaced.push({ id: child.id, reason: `no footprint for ${node.id}` });
      continue;
    }
    const placed = placeChildren(children, node, space, ctx);
    if (!placed) {
      for (const child of children) unplaced.push({ id: child.id, reason: `no free spot inside ${node.id}` });
      continue;
    }
    for (const child of placed) {
      objects.push(child.node, child.label, child.link);
      byId.set(child.node.id, child.node);
      byId.set(child.label.id, child.label);
      byId.set(child.link.id, child.link);
      if (child.factor < 0.98) shrunk.push({ id: child.node.id, factor: child.factor });
    }
  }

  return { objects, shrunk, unplaced };
}

type Space = {
  id: string;
  placedScale: number;
  width: number;
  height: number;
  occupied: Box[];
};

function spaceFor(parentId: string, byId: Map<string, CanvasObject>, ctx: LayoutCtx): Space | null {
  const host = ctx.hosts.get(parentId);
  if (host) {
    const hostObject = byId.get(host.spaceId);
    const parent = byId.get(parentId);
    const size = boxOf(parent);
    if (!hostObject || !size) return null;
    const scale = positiveScale(hostObject.scale);
    return {
      id: host.spaceId,
      placedScale: placedScaleOf(host.spaceId, byId),
      width: size.width / scale,
      height: size.height / scale,
      occupied: occupiedIn(host.spaceId, byId),
    };
  }
  const parent = byId.get(parentId);
  const size = boxOf(parent);
  if (!parent || !size) return null;
  return {
    id: parentId,
    placedScale: placedScaleOf(parentId, byId),
    width: size.width,
    height: size.height,
    occupied: occupiedIn(parentId, byId),
  };
}

type PlacedChild = {
  node: CanvasObject;
  label: CanvasObject;
  link: CanvasObject;
  factor: number;
};

function placeChildren(
  children: readonly HierarchyNode[],
  parent: HierarchyNode,
  space: Space,
  ctx: LayoutCtx,
): PlacedChild[] | null {
  const footprint = Math.max(space.width, space.height);
  const ratios = children.map((child) => child.sizeMm / parent.sizeMm);
  const maxRatio = Math.max(...ratios);
  if (!(maxRatio > 0) || !Number.isFinite(maxRatio)) return null;
  const exploded = maxRatio > EXPLODED_FIT ? EXPLODED_FIT / maxRatio : 1;

  let best: { factor: number; boxes: Box[] } | null = null;
  let lo = 0.05;
  let hi = 1;
  for (let step = 0; step < 16; step += 1) {
    const factor = step === 0 ? 1 : (lo + hi) / 2;
    const boxes = layoutBoxes(
      children.map((child, index) => {
        const ratio = ratios[index] ?? 0;
        return artSize(child, footprint * ratio * exploded * factor, ctx.art);
      }),
      space,
      ctx.policies,
    );
    if (boxes) {
      best = { factor, boxes };
      lo = factor;
    } else if (step === 0) {
      hi = 1;
    } else {
      hi = factor;
    }
  }
  if (!best) return null;

  const host = ctx.hosts.get(parent.id);
  const fade: ZoomFade = host?.fadeAgainstOpening
    ? { fadeIn: ctx.reveal }
    : { fadeIn: ctx.reveal, fadeInOf: parent.id };
  const placed: PlacedChild[] = [];
  const blocked = [...space.occupied, ...best.boxes];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const box = best.boxes[index];
    if (!child || !box) return null;
    const worldMax = Math.max(box.width, box.height) * space.placedScale;
    // Wide enough to fill a desktop on this node, and never below the parts band.
    const cover = worldMax > 0 ? (1280 / worldMax) * 2 : MAX_SCALE;
    const visibility = {
      minScale: ctx.band.minScale,
      maxScale: Math.min(MAX_SCALE, Math.max(ctx.band.maxScale, cover)),
    };
    const node: CanvasObject = {
      id: child.id,
      parentId: space.id,
      x: box.x,
      y: box.y,
      visibility,
      fade,
      labelId: `${child.id}-label`,
      payload: payloadFor(child, box.width, box.height, ctx.art),
    };
    const labelText = child.countMark ? `${child.name} ${child.countMark}` : child.name;
    const labelBox = labelBounds(labelText, space, ctx.policies);
    const spot = placeLabel(box, labelBox, blocked, space, ctx.policies);
    const label: CanvasObject = {
      id: `${child.id}-label`,
      parentId: space.id,
      x: spot.x,
      y: spot.y,
      visibility,
      fade,
      payload: {
        type: 'text',
        text: labelText,
        style: { fontSize: labelBox.fontSize * spot.scale },
        width: labelBox.width * spot.scale,
        height: labelBox.height * spot.scale,
      },
    };
    const link: CanvasObject = {
      id: `${child.id}-link`,
      x: 0,
      y: 0,
      visibility,
      payload: { type: 'link', from: label.id, to: child.id },
    };
    blocked.push({ x: spot.x, y: spot.y, width: labelBox.width * spot.scale, height: labelBox.height * spot.scale });
    placed.push({
      node,
      label,
      link,
      factor: (ratios[index] ?? 1) > 0 ? exploded * best.factor : 1,
    });
  }
  return placed;
}

function artSize(
  node: HierarchyNode,
  maxSide: number,
  art: Readonly<Record<string, LayoutArt>>,
): { width: number; height: number } {
  const side = Math.max(maxSide, 0);
  if (node.kind === 'process') return { width: side, height: side * 0.56 };
  const image = art[node.id];
  if (!image) return { width: side, height: side };
  const aspect = image.height / image.width;
  if (aspect >= 1) return { width: side / aspect, height: side };
  return { width: side, height: side * aspect };
}

function payloadFor(
  node: HierarchyNode,
  width: number,
  height: number,
  art: Readonly<Record<string, LayoutArt>>,
): CanvasObject['payload'] {
  const image = art[node.id];
  if (image) {
    return { type: 'image', src: image.src, width, height, frame: false };
  }
  const kind: ShapePayload['kind'] = node.kind;
  return { type: 'shape', kind, width, height };
}

/**
 * Largest ring (or a single centre) that keeps every box inside the parent
 * and clear of siblings already living there. Returns null when `dims`
 * cannot fit at this size.
 */
function layoutBoxes(
  dims: readonly { width: number; height: number }[],
  space: Space,
  policies: Readonly<Record<string, SpacePolicy>>,
): Box[] | null {
  const n = dims.length;
  if (n === 0) return null;
  const frame = contentFrame(space, 'nodes', policies);
  const pad = Math.min(frame.width, frame.height) * 0.04;
  if (n === 1) {
    const dim = dims[0];
    if (!dim) return null;
    // Off the parent centre. A child parked on that centre ties the parent's
    // portal, and the smaller id then hides this node's own children.
    const angle = (32 * Math.PI) / 180;
    for (const fraction of [0.16, 0.1, 0.05, 0.02]) {
      const reach = Math.min(frame.width, frame.height) * fraction;
      const box = {
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        width: dim.width,
        height: dim.height,
      };
      if (fits(box, space, frame, pad)) return [box];
    }
    return greedySlots(dims, space, frame, pad);
  }

  const gap = Math.min(frame.width, frame.height) * 0.03;
  const minRadius = smallestSeparatedRadius(dims, gap);
  let lo = minRadius;
  let hi = Math.max(frame.width, frame.height);
  let best = boxesAt(dims, minRadius, space, frame, pad, gap);
  for (let step = 0; step < 20; step += 1) {
    const radius = (lo + hi) / 2;
    const boxes = boxesAt(dims, radius, space, frame, pad, gap);
    if (boxes) {
      best = boxes;
      lo = radius;
    } else {
      hi = radius;
    }
  }
  return best ?? greedySlots(dims, space, frame, pad);
}

function boxesAt(
  dims: readonly { width: number; height: number }[],
  radius: number,
  space: Space,
  frame: { width: number; height: number },
  pad: number,
  gap: number,
): Box[] | null {
  const boxes = ring(dims.length, radius).map((center, index) => {
    const dim = dims[index];
    return { x: center.x, y: center.y, width: dim?.width ?? 0, height: dim?.height ?? 0 };
  });
  if (!separated(boxes, gap) || !boxes.every((box) => fits(box, space, frame, pad))) return null;
  return boxes;
}

/** Smallest ring that keeps the boxes from touching, ignoring the parent edge. */
function smallestSeparatedRadius(dims: readonly { width: number; height: number }[], gap: number): number {
  const span = dims.reduce((sum, dim) => sum + Math.max(dim.width, dim.height), 0);
  let lo = 0;
  let hi = Math.max(span, gap);
  let best = hi;
  for (let step = 0; step < 22; step += 1) {
    const radius = (lo + hi) / 2;
    const boxes = ring(dims.length, radius).map((center, index) => {
      const dim = dims[index];
      return { x: center.x, y: center.y, width: dim?.width ?? 0, height: dim?.height ?? 0 };
    });
    if (separated(boxes, gap)) {
      best = radius;
      hi = radius;
    } else {
      lo = radius;
    }
  }
  return best;
}

/**
 * Edge and corner anchors for a parent that is already full in the middle.
 * Later siblings take whatever margin remains.
 */
function greedySlots(
  dims: readonly { width: number; height: number }[],
  space: Space,
  frame: { width: number; height: number },
  pad: number,
): Box[] | null {
  const anchors: { x: number; y: number }[] = [];
  for (const gx of [-0.42, -0.28, 0.06, 0.28, 0.42]) {
    for (const gy of [-0.42, -0.28, 0.08, 0.28, 0.42]) {
      anchors.push(clearPoint(gx * frame.width, gy * frame.height, frame));
    }
  }
  anchors.sort((a, b) => b.x * b.x + b.y * b.y - (a.x * a.x + a.y * a.y));
  const gap = Math.min(frame.width, frame.height) * 0.02;
  const placed: Box[] = [];
  for (const dim of dims) {
    let chosen: Box | null = null;
    for (const anchor of anchors) {
      const box = { x: anchor.x, y: anchor.y, width: dim.width, height: dim.height };
      const clearOfNew = placed.every((other) => !overlaps(box, other, gap));
      if (clearOfNew && fits(box, space, frame, pad)) {
        chosen = box;
        break;
      }
    }
    if (!chosen) return null;
    placed.push(chosen);
  }
  return placed;
}

/**
 * A full-frame space uses its whole footprint. Every other space keeps nodes
 * and labels in the middle: at 1.6× the parent's fit the view shows about the
 * central 60%, so a label on the edge would sit off screen.
 */
function contentFrame(
  space: Space,
  role: 'nodes' | 'labels',
  policies: Readonly<Record<string, SpacePolicy>>,
): { width: number; height: number } {
  if (policies[space.id]?.fullFrame) return { width: space.width, height: space.height };
  // Nodes sit in the middle. Labels use the band just outside them, still
  // inside the region that stays on screen at 1.6× the parent's fit.
  const fraction = role === 'nodes' ? 0.42 : 0.58;
  return { width: space.width * fraction, height: space.height * fraction };
}

function ring(count: number, radius: number): { x: number; y: number }[] {
  return clearAngles(count).map((angle) => ({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }));
}

/**
 * Angles at least 20° off both axes, spread around the parent.
 * An outward label then stays on the same ray, so leaders do not cross
 * and none of them lie on an axis.
 */
function clearPoint(
  x: number,
  y: number,
  frame: { width: number; height: number },
): { x: number; y: number } {
  const radius = Math.hypot(x, y);
  const min = Math.min(frame.width, frame.height) * 0.04;
  const angle = radius < 1e-9 ? (32 * Math.PI) / 180 : nudgeOffAxes(Math.atan2(y, x));
  const reach = Math.max(radius, min);
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}

function clearAngles(count: number): number[] {
  const wedges: Array<[number, number]> = [
    [20, 70],
    [110, 160],
    [200, 250],
    [290, 340],
  ];
  const slots = Math.ceil(count / wedges.length);
  const angles: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const wedge = wedges[index % wedges.length];
    if (!wedge) continue;
    const slot = Math.floor(index / wedges.length);
    const t = (slot + 0.5) / slots;
    angles.push(((wedge[0] + t * (wedge[1] - wedge[0])) * Math.PI) / 180);
  }
  return angles;
}

function fits(
  box: Box,
  space: Space,
  frame: { width: number; height: number },
  pad: number,
): boolean {
  if (!inside(box, frame.width, frame.height, pad)) return false;
  const gap = Math.min(space.width, space.height) * 0.012;
  return space.occupied.every((other) => !overlaps(box, other, gap));
}

function separated(boxes: readonly Box[], gap: number): boolean {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a && b && overlaps(a, b, gap)) return false;
    }
  }
  return true;
}

function inside(box: Box, width: number, height: number, pad: number): boolean {
  return (
    Math.abs(box.x) + box.width / 2 <= width / 2 - pad &&
    Math.abs(box.y) + box.height / 2 <= height / 2 - pad
  );
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
  );
}

function labelBounds(
  text: string,
  space: Space,
  policies: Readonly<Record<string, SpacePolicy>>,
): { width: number; height: number; fontSize: number } {
  const fixed = policies[space.id]?.labelFontSize;
  if (fixed !== undefined) {
    return { fontSize: fixed, width: Math.max(fixed * 3, text.length * fixed * 0.62), height: fixed };
  }
  const parentWorldW = space.width * space.placedScale;
  const parentWorldH = space.height * space.placedScale;
  const parentFit = boxFitScale(
    {
      left: -parentWorldW / 2,
      right: parentWorldW / 2,
      top: -parentWorldH / 2,
      bottom: parentWorldH / 2,
    },
    LABEL_VIEW.width,
    LABEL_VIEW.height,
  );
  const atLevel = parentFit * (1 / EXPLODED_FIT);
  const fontSize = LABEL_PX / atLevel;
  // The renderer does not multiply fontSize by ancestor scale, but it does
  // scale the text box. Inflate the local box so the ink stays ~18px.
  const screenBox = (px: number) => px / (space.placedScale * atLevel);
  return {
    fontSize,
    width: screenBox(LABEL_PX * Math.max(3, text.length * 0.62)),
    height: screenBox(LABEL_PX * 1.45),
  };
}

function placeLabel(
  node: Box,
  label: { width: number; height: number },
  blocked: readonly Box[],
  space: Space,
  policies: Readonly<Record<string, SpacePolicy>>,
): { x: number; y: number; scale: number } {
  const preferred = contentFrame(space, 'labels', policies);
  const parent = { width: space.width, height: space.height };
  // Out along the node's own ray, so sibling leaders do not cross.
  const angle = nudgeOffAxes(Math.hypot(node.x, node.y) < 1e-9 ? (32 * Math.PI) / 180 : Math.atan2(node.y, node.x));
  // 18px down to 16px. Below that the face is no longer readable at the level.
  const scales = [1, 16 / 18];
  for (const frame of [preferred, parent]) {
    for (const scale of scales) {
      const sized = { width: label.width * scale, height: label.height * scale };
      const gap = Math.max(
        Math.min(node.width, node.height) * 0.12,
        Math.min(sized.width, sized.height) * 0.35,
        Math.min(frame.width, frame.height) * 0.01,
      );
      for (const stretch of [1, 1.15, 1.35, 1.6, 2, 2.6]) {
        const reach =
          (halfExtent(node.width, node.height, angle) + halfExtent(sized.width, sized.height, angle) + gap) * stretch;
        const spot = { x: node.x + Math.cos(angle) * reach, y: node.y + Math.sin(angle) * reach };
        const candidate = { ...spot, width: sized.width, height: sized.height };
        if (!inside(candidate, frame.width, frame.height, 0)) continue;
        if (overlaps(candidate, node, gap * 0.15)) continue;
        if (blocked.some((other) => overlaps(candidate, other, gap * 0.15))) continue;
        return { ...spot, scale };
      }
    }
  }
  const gap = Math.min(node.width, node.height) * 0.12;
  const reach = halfExtent(node.width, node.height, angle) + halfExtent(label.width, label.height, angle) + gap;
  return {
    x: node.x + Math.cos(angle) * reach,
    y: node.y + Math.sin(angle) * reach,
    scale: 1,
  };
}

/** At least 24° from horizontal and from vertical. */
function nudgeOffAxes(angle: number): number {
  const min = (24 * Math.PI) / 180;
  let value = Math.atan2(Math.sin(angle), Math.cos(angle));
  for (let step = 0; step < 4; step += 1) {
    if (axisClearance(value) >= min - 1e-6) return value;
    const deficit = min - axisClearance(value);
    const plus = value + deficit;
    const minus = value - deficit;
    value = axisClearance(plus) >= axisClearance(minus) ? plus : minus;
  }
  return value;
}

function axisClearance(angle: number): number {
  const turn = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  const fromHorizontal = Math.min(turn, Math.PI - turn);
  const fromVertical = Math.abs(turn - Math.PI / 2);
  return Math.min(fromHorizontal, fromVertical);
}

function halfExtent(width: number, height: number, angle: number): number {
  return (Math.abs(Math.cos(angle)) * width) / 2 + (Math.abs(Math.sin(angle)) * height) / 2;
}

function occupiedIn(parentId: string, byId: Map<string, CanvasObject>): Box[] {
  const boxes: Box[] = [];
  for (const object of byId.values()) {
    if (object.parentId !== parentId) continue;
    const size = boxOf(object);
    if (!size) continue;
    boxes.push({ x: object.x, y: object.y, width: size.width, height: size.height });
  }
  return boxes;
}

function boxOf(object: CanvasObject | undefined): { width: number; height: number } | null {
  if (!object) return null;
  const payload = object.payload;
  if (payload.type === 'group' || payload.type === 'link') return null;
  if (!(payload.width > 0) || !(payload.height > 0)) return null;
  return { width: payload.width, height: payload.height };
}

function placedScaleOf(id: string, byId: Map<string, CanvasObject>): number {
  const chain: CanvasObject[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  let scale = 1;
  for (const node of chain.reverse()) scale *= positiveScale(node.scale);
  return scale;
}

function positiveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}
