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

/**
 * World placement of every object, matching the memory store and
 * `resolveWorldRect`. A parent's scale multiplies a child's position and
 * size. The child's own scale multiplies its size and its descendants, not
 * its own `x` and `y`. A missing parent or a cycle is null.
 * The first object with an id is the parent; a later duplicate is placed
 * from its own record but still uses that parent.
 */
export function createPlacement(
  objects: readonly CanvasObject[],
): (object: CanvasObject) => WorldPlacement | null {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    if (!byId.has(object.id)) byId.set(object.id, object);
  }
  const world = new Map<CanvasObject, WorldPlacement | null>();

  function resolve(object: CanvasObject, stack: Set<CanvasObject>): WorldPlacement | null {
    const known = world.get(object);
    if (known !== undefined) return known;
    if (stack.has(object)) return null;

    stack.add(object);
    const local = positiveScale(object.scale);
    let placed: WorldPlacement | null = null;
    if (object.parentId === undefined) {
      placed = { x: object.x, y: object.y, scale: local };
    } else {
      const parent = byId.get(object.parentId);
      const origin = parent ? resolve(parent, stack) : null;
      if (origin) {
        placed = {
          x: origin.x + object.x * origin.scale,
          y: origin.y + object.y * origin.scale,
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

function positiveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}
