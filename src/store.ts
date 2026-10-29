import type { Camera, ContentBox, ViewBounds } from './camera';
import { displayOpacity } from './fade';
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
  /**
   * Opening fit scale (s0) for this viewport. Zoom fade is `scale / fitScale`.
   * Omit it and a `fade` on an object is not applied.
   */
  fitScale?: number;
};

export type VisibleObject = {
  object: CanvasObject;
  /**
   * Result of visibilityAlpha at the query scale. Zoom fade is not folded in;
   * the renderer multiplies it by `fade` and this `fitScale`.
   */
  alpha: number;
};

export interface SceneStore {
  /**
   * In band, on screen, and still visible after zoom fade (display alpha above 0.01).
   * `alpha` on each entry is the visibility band only.
   */
  query(query: SceneQuery): VisibleObject[];
  /**
   * In band, anywhere in the world, display alpha above the HUD cutoff (0.02).
   * `fitScale` is the opening fit; omit it and zoom fade is not applied.
   */
  countInBand(scale: number, fitScale?: number): number;
  /** Srcs of the resident image objects, in array order. */
  imageSources(): readonly string[];
  /** Run `onChange` after the resident set changes. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /**
   * Object that would be drawn at `camera.scale` whose unpadded authored box
   * contains `worldPoint`. The CSS pad is for culling, not for hits. Display
   * alpha at or below the draw cutoff is skipped, including a zoom fade to 0.
   * When several overlap, the greater `maxScale` wins and a tie goes to the later one.
   * `fitScale` is the opening fit; omit it and zoom fade is not applied.
   */
  hitTest(
    worldPoint: { x: number; y: number },
    camera: Camera,
    fitScale?: number,
  ): CanvasObject | null;
  /**
   * World boxes of every placed object, parent chain already flattened.
   * A missing parent or a cycle is absent, same as `query`. The shell derives
   * camera limits from this; the pad used for culling is not included.
   */
  contentBoxes(): readonly ContentBox[];
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
    countInBand(scale, fitScale) {
      let count = 0;
      for (const { object } of entries) {
        if (shownAlpha(object, scale, fitScale) > HUD_ALPHA) count += 1;
      }
      return count;
    },
    query(query) {
      const visible: VisibleObject[] = [];
      for (const entry of entries) {
        const alpha = visibilityAlpha(entry.object.visibility, query.scale);
        if (displayOpacity(alpha, entry.object.fade, query.scale, query.fitScale) <= DRAW_ALPHA) continue;
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
    hitTest(worldPoint, camera, fitScale) {
      let best: Entry | undefined;
      for (const entry of entries) {
        if (shownAlpha(entry.object, camera.scale, fitScale) <= DRAW_ALPHA) continue;
        if (!containsPoint(entry.box, worldPoint)) continue;
        if (!best || entry.object.visibility.maxScale >= best.object.visibility.maxScale) {
          best = entry;
        }
      }
      return best?.object ?? null;
    },
    replaceObjects(next) {
      resident = next;
      entries = placedEntries(next);
      notify();
    },
    contentBoxes() {
      return entries.map((entry) => ({
        box: entry.box,
        maxScale: entry.object.visibility.maxScale,
        size: minorSize(entry.object),
      }));
    },
  };
}

/** Visibility band times zoom fade. The cutoff compares this, not the band alone. */
function shownAlpha(object: CanvasObject, scale: number, fitScale: number | undefined): number {
  return displayOpacity(visibilityAlpha(object.visibility, scale), object.fade, scale, fitScale);
}

function minorSize(object: CanvasObject): number {
  const { width, height } = object.payload;
  const w = Number.isFinite(width) ? Math.abs(width) : 0;
  const h = Number.isFinite(height) ? Math.abs(height) : 0;
  if (w > 0 && h > 0) return Math.min(w, h);
  return Math.max(w, h);
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
    ...(object.fade ? { fade: object.fade } : {}),
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

function containsPoint(box: ViewBounds, point: { x: number; y: number }): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}
