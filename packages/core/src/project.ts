import type { Camera } from './camera';
import type { CanvasObject } from './model';

/** Axis-aligned box in CSS pixels. `left` and `top` are the minimum edges. */
export type CssBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Project `id` to CSS pixels by walking the parent chain in pixel space.
 *
 * Adding a deep offset onto an absolute world coordinate drops it once it
 * falls below the ulp of that coordinate. This walk subtracts the camera at
 * the root, then adds each local offset already multiplied by the pixels-per-
 * local-unit at that step, so a child that is invisible in the flattened
 * world position still lands on its own pixel.
 */
/** CSS position of parent-local `(0, 0)`, and CSS pixels per parent-local unit. */
export type CssPlane = {
  x: number;
  y: number;
  pixelsPerLocal: number;
};

/**
 * The plane children of `parentId` are drawn in.
 * Omit `parentId` for the world: local units are world units.
 * `at` replaces a node's authored `(x, y)` — a repeated ancestor's focused copy.
 */
export function cssPlane(
  objects: readonly CanvasObject[],
  parentId: string | undefined,
  camera: Camera,
  viewW: number,
  viewH: number,
  at?: (node: CanvasObject) => { x: number; y: number } | undefined,
): CssPlane | null {
  if (!(camera.scale > 0) || !Number.isFinite(camera.scale)) return null;
  if (parentId === undefined) {
    return {
      x: viewW / 2 - camera.x * camera.scale,
      y: viewH / 2 - camera.y * camera.scale,
      pixelsPerLocal: camera.scale,
    };
  }
  const nodes = chainOf(objects, parentId);
  if (!nodes) return null;
  const root = nodes[0];
  if (!root) return null;
  let pixels = camera.scale;
  const rootAt = at?.(root) ?? { x: root.x, y: root.y };
  let px = (rootAt.x - camera.x) * pixels;
  let py = (rootAt.y - camera.y) * pixels;
  pixels *= positiveScale(root.scale);
  for (let i = 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    const local = at?.(node) ?? { x: node.x, y: node.y };
    px += local.x * pixels;
    py += local.y * pixels;
    pixels *= positiveScale(node.scale);
  }
  if (!Number.isFinite(px) || !Number.isFinite(py) || !(pixels > 0)) return null;
  return { x: px + viewW / 2, y: py + viewH / 2, pixelsPerLocal: pixels };
}

export function projectCss(
  objects: readonly CanvasObject[],
  id: string,
  camera: Camera,
  viewW: number,
  viewH: number,
  at?: (node: CanvasObject) => { x: number; y: number } | undefined,
): CssBox | null {
  const nodes = chainOf(objects, id);
  if (!nodes) return null;
  const leaf = nodes[nodes.length - 1];
  if (!leaf || leaf.payload.type === 'group' || leaf.payload.type === 'link') return null;
  const plane = cssPlane(objects, leaf.parentId, camera, viewW, viewH, at);
  if (!plane) return null;
  const local = at?.(leaf) ?? { x: leaf.x, y: leaf.y };
  const pixels = plane.pixelsPerLocal * positiveScale(leaf.scale);
  const width = leaf.payload.width * pixels;
  const height = leaf.payload.height * pixels;
  const cx = plane.x + local.x * plane.pixelsPerLocal;
  const cy = plane.y + local.y * plane.pixelsPerLocal;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * CSS pixels a 1-ulp change in `value` moves at `scale`.
 * Near zero the ulp is far below a pixel at any scale this canvas uses.
 */
export function pixelQuantum(value: number, scale: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(scale)) return Number.POSITIVE_INFINITY;
  const abs = Math.abs(value);
  if (!(abs >= 1) || !(scale > 0)) return 0;
  const ulp = 2 ** (Math.floor(Math.log2(abs)) - 52);
  return ulp * scale;
}

/** True when painting `value` at `scale` can jump by more than a quarter pixel. */
export function coordinateIsCoarse(value: number, scale: number): boolean {
  return pixelQuantum(value, scale) > 0.25;
}

function chainOf(objects: readonly CanvasObject[], id: string): CanvasObject[] | null {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    if (!byId.has(object.id)) byId.set(object.id, object);
  }
  const leaf = byId.get(id);
  if (!leaf) return null;
  const reversed: CanvasObject[] = [];
  const seen = new Set<string>();
  let current: CanvasObject | undefined = leaf;
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    reversed.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    if (current === undefined && reversed[reversed.length - 1]?.parentId) return null;
  }
  return reversed.reverse();
}

function positiveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}
