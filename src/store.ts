import type { ViewBounds } from './camera';
import type { CanvasObject, ImagePayload, TextPayload } from './model';
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

/**
 * Em charged per code unit. A bold W in the fallback face advances one em;
 * the extra quarter em pads faces and glyphs that were not measured.
 * Canvas letter-spacing is added once per code unit, including a trailing gap.
 */
const TEXT_ADVANCE_EM = 1.25;

/** `drawTextObject` strokes with this fraction of the font size. */
const TEXT_STROKE_EM = 0.055;

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
  /** Every image src in the dataset. The shell warms the renderer from this. */
  imageSources(): readonly string[];
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
 */
export function createMemoryStore(objects: readonly CanvasObject[]): SceneStore {
  const entries = objects.map(entryFor);

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
      for (const { object } of entries) {
        if (object.payload.type === 'image') srcs.push(object.payload.src);
      }
      return srcs;
    },
  };
}

function entryFor(object: CanvasObject): Entry {
  if (object.payload.type === 'image') {
    return { object, box: imageBox(object, object.payload), padCssPx: IMAGE_PAD_CSS_PX };
  }
  return { object, box: textBox(object, object.payload), padCssPx: TEXT_PAD_CSS_PX };
}

/** Centered payload rect. Matches the rect `drawImageObject` fills. */
function imageBox(object: CanvasObject, payload: ImagePayload): ViewBounds {
  const halfW = (Number.isFinite(payload.width) ? Math.abs(payload.width) : 0) / 2;
  const halfH = (Number.isFinite(payload.height) ? Math.abs(payload.height) : 0) / 2;
  return {
    left: object.x - halfW,
    right: object.x + halfW,
    top: object.y - halfH,
    bottom: object.y + halfH,
  };
}

/**
 * Overestimate of the ink `drawTextObject` can leave. Text is centered on
 * `(x, y)` with a middle baseline, so the em square is `fontSize` tall.
 * Width counts one padded em per code unit plus letter-spacing. Height adds
 * another quarter em on each side because the ascender and descender are not
 * measured, then the stroke.
 */
function textBox(object: CanvasObject, payload: TextPayload): ViewBounds {
  const fontSize =
    payload.style.fontSize > 0 && Number.isFinite(payload.style.fontSize) ? payload.style.fontSize : 0;
  const count = payload.text.length;
  const spacing = Math.max(0, letterSpacingWorld(payload.style.letterSpacing, fontSize));
  const stroke = fontSize * TEXT_STROKE_EM;
  const halfW = (count * (fontSize * TEXT_ADVANCE_EM + spacing) + stroke) / 2;
  const halfH = fontSize * 0.75 + stroke / 2;
  return {
    left: object.x - halfW,
    right: object.x + halfW,
    top: object.y - halfH,
    bottom: object.y + halfH,
  };
}

/**
 * Letter-spacing in world units, the same space as `fontSize`.
 * `em` and `rem` resolve against the font size (canvas `rem` tracks the
 * current font). An unparsed length becomes one em so the box stays outside
 * the ink. Negative spacing is left negative; the caller ignores the shrink.
 */
function letterSpacingWorld(spacing: string | undefined, fontSize: number): number {
  if (!spacing) return 0;
  const trimmed = spacing.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'normal') return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(px|em|rem)$/.exec(trimmed);
  if (!match) return fontSize;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return fontSize;
  return match[2] === 'px' ? value : value * fontSize;
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
