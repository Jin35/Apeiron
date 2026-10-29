import type { ViewBounds } from './camera';
import type { CanvasObject } from './model';
import { visibilityAlpha } from './visibility';

/** HUD counts an object only above this opacity. */
const HUD_ALPHA = 0.02;

/** A draw query includes an object only above this opacity. */
const DRAW_ALPHA = 0.01;

/**
 * CSS pixels of slop so antialiasing cannot fall outside the box.
 * `drawImageObject` strokes a 1.25px frame centered on the payload rect,
 * so the image pad also includes the half of that stroke that lies outside.
 */
const TEXT_PAD_CSS_PX = 1;
const IMAGE_STROKE_CSS_PX = 1.25;
const IMAGE_PAD_CSS_PX = IMAGE_STROKE_CSS_PX / 2 + TEXT_PAD_CSS_PX;

export type SceneQuery = {
  bounds: ViewBounds;
  scale: number;
};

export type VisibleObject = {
  object: CanvasObject;
  /** Result of visibilityAlpha at the query scale. */
  alpha: number;
};

export interface SceneStore {
  /** In band, on screen, alpha above the draw cutoff (0.01). */
  query(query: SceneQuery): VisibleObject[];
  /** In band, anywhere in the world, alpha above the HUD cutoff (0.02). */
  countInBand(scale: number): number;
  /** Srcs of the resident image objects, in array order. */
  imageSources(): readonly string[];
  /** Run `onChange` after the resident set changes. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

/**
 * Memory-store write. The shell only needs `subscribe` on `SceneStore`.
 * Replacing the resident array is this backend, not the layer seam.
 */
export interface MemoryStore extends SceneStore {
  /** Rebuild the resident entries, then notify subscribers. */
  replaceObjects(objects: readonly CanvasObject[]): void;
}

type Entry = {
  object: CanvasObject;
  /** Scale-independent box. Screen-pixel slop is applied in `query`. */
  box: ViewBounds;
  padCssPx: number;
};

/**
 * Linear scan of conservative world boxes. The atlas is small enough that
 * a quadtree would not change what the renderer receives.
 * Parent-local coordinates are flattened to world space when the entries
 * are built, not on each query. `replaceObjects` rebuilds those boxes and
 * notifies subscribers.
 */
export function createMemoryStore(objects: readonly CanvasObject[]): MemoryStore {
  let resident = objects;
  let entries = placedEntries(objects);
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  return {
    countInBand(scale) {
      let count = 0;
      for (const { object } of entries) {
        if (visibilityAlpha(object.visibility, scale) > HUD_ALPHA) count += 1;
      }
      return count;
    },
    query(query) {
      const visible: VisibleObject[] = [];
      for (const entry of entries) {
        const alpha = visibilityAlpha(entry.object.visibility, query.scale);
        if (alpha <= DRAW_ALPHA) continue;
        if (!intersects(query.bounds, padBox(entry, query.scale))) continue;
        visible.push({ object: entry.object, alpha });
      }
      return visible;
    },
    imageSources() {
      const srcs: string[] = [];
      for (const object of resident) {
        if (object.payload.type === 'image') srcs.push(object.payload.src);
      }
      return srcs;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    replaceObjects(next) {
      resident = next;
      entries = placedEntries(next);
      notify();
    },
  };
}

/**
 * Parent-local `x` / `y` become world coordinates here, so `query` keeps
 * scanning scale-independent boxes. A missing parent or a cycle leaves the
 * object out of the entries (and therefore out of `query` and `countInBand`)
 * instead of throwing. The authored object is not mutated. `imageSources`
 * still lists every resident image, placed or not.
 */
function placedEntries(objects: readonly CanvasObject[]): Entry[] {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    // First id wins, so a duplicate cannot move a parent out from under its children.
    if (!byId.has(object.id)) byId.set(object.id, object);
  }

  const world = new Map<CanvasObject, { x: number; y: number } | null>();

  function resolve(object: CanvasObject, stack: Set<CanvasObject>): { x: number; y: number } | null {
    const known = world.get(object);
    if (known !== undefined) return known;
    if (stack.has(object)) return null;

    stack.add(object);
    let placed: { x: number; y: number } | null = null;
    if (object.parentId === undefined) {
      placed = { x: object.x, y: object.y };
    } else {
      const parent = byId.get(object.parentId);
      const origin = parent ? resolve(parent, stack) : null;
      if (origin) placed = { x: origin.x + object.x, y: origin.y + object.y };
    }
    stack.delete(object);
    world.set(object, placed);
    return placed;
  }

  const entries: Entry[] = [];
  for (const object of objects) {
    const placed = resolve(object, new Set());
    if (!placed) continue;
    entries.push(entryFor(atWorld(object, placed.x, placed.y)));
  }
  return entries;
}

/** Query objects are world-space, so a parent link is not left on them. */
function atWorld(object: CanvasObject, x: number, y: number): CanvasObject {
  if (object.parentId === undefined) return object;
  return {
    id: object.id,
    x,
    y,
    visibility: object.visibility,
    payload: object.payload,
  };
}

function entryFor(object: CanvasObject): Entry {
  const pad = object.payload.type === 'image' ? IMAGE_PAD_CSS_PX : TEXT_PAD_CSS_PX;
  return {
    object,
    box: centeredBox(object.x, object.y, object.payload.width, object.payload.height),
    padCssPx: pad,
  };
}

/**
 * Centered payload rect. Images match the rect `drawImageObject` fills.
 * Text uses the authored width and height the same way, instead of a glyph estimate.
 */
function centeredBox(x: number, y: number, width: number, height: number): ViewBounds {
  const halfW = (Number.isFinite(width) ? Math.abs(width) : 0) / 2;
  const halfH = (Number.isFinite(height) ? Math.abs(height) : 0) / 2;
  return {
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

function padBox(entry: Entry, scale: number): ViewBounds {
  const pad = scale > 0 && Number.isFinite(scale) ? entry.padCssPx / scale : 0;
  return {
    left: entry.box.left - pad,
    right: entry.box.right + pad,
    top: entry.box.top - pad,
    bottom: entry.box.bottom + pad,
  };
}

function intersects(view: ViewBounds, box: ViewBounds): boolean {
  return view.left <= box.right && box.left <= view.right && view.top <= box.bottom && box.top <= view.bottom;
}
