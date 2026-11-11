import { boxFitScale, MAX_SCALE } from '../src/camera';
import type { CanvasObject, ShapePayload, ZoomFade } from '../src/model';
import type { HierarchyNode } from './hierarchy.generated';

/**
 * Cut-outs for the cell → anode → carbon path. Pixel sizes are the files
 * in `public/images/smartphone`. The layout picks the position; the file
 * only contributes its aspect.
 */
const ART: Record<string, { src: string; width: number; height: number }> = {
  pouch: { src: 'images/smartphone/pouch.webp', width: 554, height: 868 },
  'electrode-stack': { src: 'images/smartphone/electrode-stack.webp', width: 506, height: 865 },
  anode: { src: 'images/smartphone/anode.webp', width: 656, height: 1159 },
  'graphite-particle': { src: 'images/smartphone/graphite-particle.webp', width: 821, height: 820 },
  'graphite-carbon-sheet': { src: 'images/smartphone/graphite-carbon-sheet.webp', width: 792, height: 889 },
  'graphite-carbon-atom': { src: 'images/smartphone/graphite-carbon-atom.webp', width: 981, height: 982 },
};

/** Largest child/parent ratio that still fits an exploded view without an extra shrink. */
const EXPLODED_FIT = 0.625;

/** Screen size of a label when its level is fully in, on a 1280×800 window. */
const LABEL_PX = 18;
const LABEL_VIEW = { width: 1280, height: 800 };

type Box = { x: number; y: number; width: number; height: number };

export type LayoutReport = {
  objects: CanvasObject[];
  /** Placed smaller than child size ÷ parent size so the exploded view fits. */
  shrunk: readonly { id: string; factor: number }[];
  unplaced: readonly { id: string; reason: string }[];
};

/**
 * One node, label, and leader for every hierarchy node that is not already
 * in `built`. Hand-authored parts keep their coordinates. New siblings are
 * packed into the parent's footprint, pulled apart, at child/parent size.
 */
export function layoutTree(nodes: readonly HierarchyNode[], built: readonly CanvasObject[]): LayoutReport {
  const byId = new Map<string, CanvasObject>();
  for (const object of built) byId.set(object.id, object);
  // The hand-authored parts crossfade from 1× to 1.6× of the anchor fit.
  // Group scale only sizes that row; it is not the fade.
  const reveal: readonly [number, number] = [1, 1.6];

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
    const space = spaceFor(node.id, byId);
    if (!space) {
      for (const child of children) unplaced.push({ id: child.id, reason: `no footprint for ${node.id}` });
      continue;
    }
    const placed = placeChildren(children, node, space, reveal);
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

function spaceFor(parentId: string, byId: Map<string, CanvasObject>): Space | null {
  if (parentId === 'phone' || parentId === 'battery') {
    const hostId = parentId === 'phone' ? 'internals' : 'battery-internals';
    const host = byId.get(hostId);
    const parent = byId.get(parentId);
    const size = boxOf(parent);
    if (!host || !size) return null;
    const scale = positiveScale(host.scale);
    return {
      id: hostId,
      placedScale: placedScaleOf(hostId, byId),
      width: size.width / scale,
      height: size.height / scale,
      occupied: occupiedIn(hostId, byId),
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
  reveal: readonly [number, number],
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
        return artSize(child, footprint * ratio * exploded * factor);
      }),
      space,
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

  const fade: ZoomFade =
    parent.id === 'phone' ? { fadeIn: reveal } : { fadeIn: reveal, fadeInOf: parent.id };
  const placed: PlacedChild[] = [];
  const blocked = [...space.occupied, ...best.boxes];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const box = best.boxes[index];
    if (!child || !box) return null;
    const worldMax = Math.max(box.width, box.height) * space.placedScale;
    // Wide enough to fill a desktop on this node, and never below the parts band.
    const cover = worldMax > 0 ? (1280 / worldMax) * 2 : MAX_SCALE;
    const visibility = { minScale: 0.02, maxScale: Math.min(MAX_SCALE, Math.max(10000, cover)) };
    const node: CanvasObject = {
      id: child.id,
      parentId: space.id,
      x: box.x,
      y: box.y,
      visibility,
      fade,
      payload: payloadFor(child, box.width, box.height),
    };
    const labelText = child.countMark ? `${child.name} ${child.countMark}` : child.name;
    const labelBox = labelBounds(labelText, space);
    const spot = placeLabel(box, labelBox, blocked, space);
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

function artSize(node: HierarchyNode, maxSide: number): { width: number; height: number } {
  const side = Math.max(maxSide, 0);
  if (node.kind === 'process') return { width: side, height: side * 0.56 };
  const art = ART[node.id];
  if (!art) return { width: side, height: side };
  const aspect = art.height / art.width;
  if (aspect >= 1) return { width: side / aspect, height: side };
  return { width: side, height: side * aspect };
}

function payloadFor(node: HierarchyNode, width: number, height: number): CanvasObject['payload'] {
  const art = ART[node.id];
  if (art) {
    return { type: 'image', src: art.src, width, height, frame: false };
  }
  const kind: ShapePayload['kind'] = node.kind;
  return { type: 'shape', kind, width, height };
}

/**
 * Largest ring (or a single centre) that keeps every box inside the parent
 * and clear of siblings already living there. Returns null when `dims`
 * cannot fit at this size.
 */
function layoutBoxes(dims: readonly { width: number; height: number }[], space: Space): Box[] | null {
  const n = dims.length;
  if (n === 0) return null;
  const frame = contentFrame(space, 'nodes');
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
 * The built phone parts sit there; later siblings take whatever margin remains.
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
 * Deep levels keep nodes and labels in the middle of the parent. At 1.6× the
 * parent's fit the view shows about the central 60%, so a label on the edge
 * would sit off screen. The hand-placed phone parts use the whole footprint.
 */
function contentFrame(space: Space, role: 'nodes' | 'labels'): { width: number; height: number } {
  const hand = space.id === 'internals' || space.id === 'battery-internals';
  if (hand) return { width: space.width, height: space.height };
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

function labelBounds(text: string, space: Space): { width: number; height: number; fontSize: number } {
  const levelOne = space.id === 'internals' || space.id === 'battery-internals';
  if (levelOne) {
    const fontSize = 4.2;
    return { fontSize, width: Math.max(fontSize * 3, text.length * fontSize * 0.62), height: fontSize };
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
): { x: number; y: number; scale: number } {
  const preferred = contentFrame(space, 'labels');
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
