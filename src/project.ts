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
export function projectCss(
  objects: readonly CanvasObject[],
  id: string,
  camera: Camera,
  viewW: number,
  viewH: number,
): CssBox | null {
  const nodes = chainOf(objects, id);
  if (!nodes) return null;
  const leaf = nodes[nodes.length - 1];
  if (!leaf || leaf.payload.type === 'group' || leaf.payload.type === 'link') return null;
  if (!(camera.scale > 0) || !Number.isFinite(camera.scale)) return null;

  let pixelsPerLocal = camera.scale;
  let px = (nodes[0].x - camera.x) * pixelsPerLocal;
  let py = (nodes[0].y - camera.y) * pixelsPerLocal;
  pixelsPerLocal *= positiveScale(nodes[0].scale);
  for (let i = 1; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    px += node.x * pixelsPerLocal;
    py += node.y * pixelsPerLocal;
    pixelsPerLocal *= positiveScale(node.scale);
  }

  const width = leaf.payload.width * pixelsPerLocal;
  const height = leaf.payload.height * pixelsPerLocal;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  return { left: px - width / 2 + viewW / 2, top: py - height / 2 + viewH / 2, width, height };
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
