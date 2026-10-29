import { viewBounds, type Camera } from './camera';
import { gridStep } from './grid';
import type { CanvasObject, TextPayload } from './model';

/** One object to paint, with the alpha to use. */
type VisibleObject = {
  object: CanvasObject;
  alpha: number;
};

const PLATE = '#171b22';
const FRAME = 'rgba(240, 215, 140, 0.45)';
const DEFAULT_FONT = '"Iowan Old Style", Palatino, Georgia, serif';

/** Grid hairline and plate frame, in CSS pixels. */
const GRID_LINE_PX = 1;
const PLATE_LINE_PX = 1.25;

/** Selection outline. Screen pixels, so it stays a hairline at any zoom. */
const SELECT_LINE_PX = 2;
const SELECT_ACCENT = 'rgba(240, 215, 140, 0.9)';

/**
 * A screen font above this is not submitted. Atlas labels peak near 185px,
 * so the cap does not drop a current label.
 */
const MAX_SCREEN_FONT_PX = 512;

/**
 * Decoded images kept. Enough for this atlas many times over.
 * Loads that have not fired onload or onerror stay put, so the next frame does not restart them.
 */
const MAX_SETTLED_IMAGES = 32;

/**
 * Canvas still turns user coordinates into float32. Inside this limit the
 * true rect is sub-pixel-accurate and the bitmap can clip it. Past it, the
 * fill is cropped to the viewport and only edges that cross the view are
 * stroked — stroking the cropped quad would invent a screen-edge border.
 */
const PRECISE_COORD_LIMIT = 65536;

type SpacedContext = CanvasRenderingContext2D & { letterSpacing: string };

/** One paint. `width` and `height` are CSS pixels measured once by the shell. */
export type RenderFrame = {
  camera: Camera;
  width: number;
  height: number;
  visible: readonly VisibleObject[];
  /** Set when the shell has a selection. Stroked if that object is in `visible`. */
  selectedId?: string;
};

export type Renderer = {
  /** Paint one measured frame. Alpha is already on each visible entry. */
  draw(frame: RenderFrame): void;
};

type CachedImage = {
  image: HTMLImageElement;
  /** True after onload or onerror. `complete` is already true before `src` is assigned. */
  settled: boolean;
};

function publicUrl(src: string): string {
  // An absolute URL is already fetchable. Prefixing it with BASE_URL (`./`) would break it.
  if (src.startsWith('http:') || src.startsWith('https:')) return src;
  const base = import.meta.env.BASE_URL;
  const trimmed = src.replace(/^\//, '');
  return base.endsWith('/') ? base + trimmed : `${base}/${trimmed}`;
}

export function createRenderer(canvas: HTMLCanvasElement, onReady: () => void): Renderer {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  /** Draw order: `imageFor` moves an entry to the end. Oldest settled key is first. */
  const images = new Map<string, CachedImage>();

  function imageFor(src: string): HTMLImageElement {
    const existing = images.get(src);
    if (existing) {
      touch(src, existing);
      return existing.image;
    }

    const entry: CachedImage = { image: new Image(), settled: false };
    const settle = () => {
      entry.settled = true;
      evictSettled();
      onReady();
    };
    entry.image.onload = settle;
    entry.image.onerror = settle;
    // In the map before `src`, so a synchronous load still counts toward the cap.
    touch(src, entry);
    entry.image.src = publicUrl(src);
    return entry.image;
  }

  function touch(src: string, entry: CachedImage) {
    images.delete(src);
    images.set(src, entry);
  }

  function evictSettled() {
    let settled = 0;
    for (const entry of images.values()) if (entry.settled) settled += 1;
    while (settled > MAX_SETTLED_IMAGES) {
      const victim = oldestSettled();
      if (victim === undefined) return;
      images.delete(victim);
      settled -= 1;
    }
  }

  function oldestSettled(): string | undefined {
    for (const [src, entry] of images) {
      if (entry.settled) return src;
    }
    return undefined;
  }

  function draw(frame: RenderFrame) {
    const { camera, width: viewW, height: viewH, visible } = frame;
    if (viewW < 1 || viewH < 1) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bitmapW = Math.max(1, Math.round(viewW * dpr));
    const bitmapH = Math.max(1, Math.round(viewH * dpr));
    if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
      canvas.width = bitmapW;
      canvas.height = bitmapH;
    }

    // Device pixels per CSS pixel only. World positions are converted below
    // in float64; a world scale here is a float32 matrix and drifts at deep zoom.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    drawGrid(ctx, camera, viewW, viewH);

    // Coarser bands (smaller maxScale) sit under finer ones. Alpha is the caller's.
    const sorted = [...visible].sort(
      (a, b) => a.object.visibility.maxScale - b.object.visibility.maxScale,
    );
    for (const { object, alpha } of sorted) {
      ctx.globalAlpha = alpha;
      if (object.payload.type === 'image') {
        drawImageObject(ctx, camera, viewW, viewH, object, imageFor(object.payload.src));
      } else {
        drawTextObject(ctx, camera, viewW, viewH, object.x, object.y, object.payload);
      }
    }
    if (frame.selectedId) {
      const selected = visible.find((entry) => entry.object.id === frame.selectedId);
      if (selected) drawSelection(ctx, camera, viewW, viewH, selected.object);
    }
    ctx.restore();
  }

  return { draw };
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
  object: CanvasObject,
) {
  const { width, height } = object.payload;
  if (!(width > 0) || !(height > 0)) return;
  const left = worldToCssX(object.x - width / 2, camera, viewW);
  const top = worldToCssY(object.y - height / 2, camera, viewH);
  const cssW = width * camera.scale;
  const cssH = height * camera.scale;
  if (!(cssW > 0) || !(cssH > 0)) return;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SELECT_ACCENT;
  ctx.lineWidth = SELECT_LINE_PX;
  ctx.strokeRect(left, top, cssW, cssH);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
) {
  const step = gridStep(camera.scale);
  if (!(step > 0) || !Number.isFinite(step)) return;
  const bounds = viewBounds(camera, viewW, viewH);
  const i0 = Math.floor(bounds.left / step);
  const i1 = Math.ceil(bounds.right / step);
  const j0 = Math.floor(bounds.top / step);
  const j1 = Math.ceil(bounds.bottom / step);
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(232, 228, 217, 0.08)';
  ctx.lineWidth = GRID_LINE_PX;
  const limit = 120;
  const top = worldToCssY(bounds.top, camera, viewH);
  const bottom = worldToCssY(bounds.bottom, camera, viewH);
  const left = worldToCssX(bounds.left, camera, viewW);
  const right = worldToCssX(bounds.right, camera, viewW);
  for (let i = i0, n = 0; i <= i1 && n < limit; i += 1, n += 1) {
    const x = worldToCssX(i * step, camera, viewW);
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let j = j0, n = 0; j <= j1 && n < limit; j += 1, n += 1) {
    const y = worldToCssY(j * step, camera, viewH);
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
}

function drawImageObject(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
  object: CanvasObject,
  image: HTMLImageElement,
) {
  if (object.payload.type !== 'image') return;
  const { width, height } = object.payload;
  if (!(width > 0) || !(height > 0)) return;
  const left = worldToCssX(object.x - width / 2, camera, viewW);
  const top = worldToCssY(object.y - height / 2, camera, viewH);
  const cssW = width * camera.scale;
  const cssH = height * camera.scale;
  if (!(cssW > 0) || !(cssH > 0)) return;

  if (coordsArePrecise(left, top, cssW, cssH)) {
    ctx.fillStyle = PLATE;
    ctx.fillRect(left, top, cssW, cssH);
    if (image.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, left, top, cssW, cssH);
    }
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = PLATE_LINE_PX;
    ctx.strokeRect(left, top, cssW, cssH);
    return;
  }

  const fill = clipToView(left, top, cssW, cssH, viewW, viewH);
  if (fill) {
    ctx.fillStyle = PLATE;
    ctx.fillRect(fill.x, fill.y, fill.w, fill.h);
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const sx = ((fill.x - left) / cssW) * image.naturalWidth;
      const sy = ((fill.y - top) / cssH) * image.naturalHeight;
      const sw = (fill.w / cssW) * image.naturalWidth;
      const sh = (fill.h / cssH) * image.naturalHeight;
      ctx.drawImage(image, sx, sy, sw, sh, fill.x, fill.y, fill.w, fill.h);
    }
  }
  strokeCrossingEdges(ctx, left, top, left + cssW, top + cssH, viewW, viewH);
}

/** Halo stroke as a fraction of the font size. Counted when the ink is fitted to the box. */
const TEXT_HALO = 0.055;

function drawTextObject(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
  x: number,
  y: number,
  payload: TextPayload,
) {
  const { text: label, style, width, height } = payload;
  if (!(width > 0) || !(height > 0)) return;
  const screenFont = style.fontSize * camera.scale;
  if (!(screenFont > 0) || screenFont > MAX_SCREEN_FONT_PX) return;

  const family = style.fontFamily ?? DEFAULT_FONT;
  const weight = style.fontWeight ?? '500';
  const spaced = ctx as SpacedContext;
  ctx.font = `${weight} ${screenFont}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  spaced.letterSpacing = style.letterSpacing ?? '0px';

  const fontPx = screenFont * textFit(ctx, label, screenFont, width * camera.scale, height * camera.scale);
  if (fontPx !== screenFont) ctx.font = `${weight} ${fontPx}px ${family}`;

  ctx.strokeStyle = 'rgba(10, 12, 16, 0.75)';
  ctx.lineWidth = fontPx * TEXT_HALO;
  const sx = worldToCssX(x, camera, viewW);
  const sy = worldToCssY(y, camera, viewH);
  ctx.strokeText(label, sx, sy);
  ctx.fillStyle = style.color;
  ctx.fillText(label, sx, sy);
  spaced.letterSpacing = '0px';
}

/**
 * Uniform scale that keeps the ink inside the authored box. It never exceeds 1:
 * `fontSize` is the size when the glyphs already fit, and the demo boxes are
 * the old overestimate, so those labels stay at `fontSize`. A context with no
 * usable `measureText` also stays at 1.
 */
function textFit(
  ctx: CanvasRenderingContext2D,
  label: string,
  fontPx: number,
  boxW: number,
  boxH: number,
): number {
  if (!(boxW > 0) || !(boxH > 0) || !(fontPx > 0) || typeof ctx.measureText !== 'function') return 1;
  const metrics = ctx.measureText(label);
  if (!metrics || !(metrics.width > 0)) return 1;
  const stroke = fontPx * TEXT_HALO;
  const ascent = metrics.actualBoundingBoxAscent;
  const descent = metrics.actualBoundingBoxDescent;
  const inkH =
    typeof ascent === 'number' && typeof descent === 'number' && ascent + descent > 0
      ? ascent + descent + stroke
      : fontPx + stroke;
  const inkW = metrics.width + stroke;
  const fit = Math.min(boxW / inkW, boxH / inkH);
  if (!Number.isFinite(fit) || !(fit > 0)) return 1;
  return Math.min(1, fit);
}

/** `(world - camera) * scale + view / 2`, in CSS pixels. */
function worldToCssX(worldX: number, camera: Camera, viewW: number): number {
  return (worldX - camera.x) * camera.scale + viewW / 2;
}

function worldToCssY(worldY: number, camera: Camera, viewH: number): number {
  return (worldY - camera.y) * camera.scale + viewH / 2;
}

function coordsArePrecise(left: number, top: number, width: number, height: number): boolean {
  const right = left + width;
  const bottom = top + height;
  return (
    Number.isFinite(left) &&
    Number.isFinite(top) &&
    Number.isFinite(right) &&
    Number.isFinite(bottom) &&
    Math.abs(left) <= PRECISE_COORD_LIMIT &&
    Math.abs(top) <= PRECISE_COORD_LIMIT &&
    Math.abs(right) <= PRECISE_COORD_LIMIT &&
    Math.abs(bottom) <= PRECISE_COORD_LIMIT
  );
}

type CssRect = { x: number; y: number; w: number; h: number };

function clipToView(
  x: number,
  y: number,
  w: number,
  h: number,
  viewW: number,
  viewH: number,
): CssRect | null {
  const x0 = Math.max(x, 0);
  const y0 = Math.max(y, 0);
  const x1 = Math.min(x + w, viewW);
  const y1 = Math.min(y + h, viewH);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

function strokeCrossingEdges(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  viewW: number,
  viewH: number,
) {
  const edges = [
    clipHorizontal(top, left, right, viewW, viewH),
    clipVertical(right, top, bottom, viewW, viewH),
    clipHorizontal(bottom, right, left, viewW, viewH),
    clipVertical(left, bottom, top, viewW, viewH),
  ].filter((edge): edge is Segment => edge !== null);
  if (edges.length === 0) return;

  ctx.strokeStyle = FRAME;
  ctx.lineWidth = PLATE_LINE_PX;
  ctx.beginPath();
  let prevX = Number.NaN;
  let prevY = Number.NaN;
  let open = false;
  for (const edge of edges) {
    if (open && edge.x1 === prevX && edge.y1 === prevY) {
      ctx.lineTo(edge.x2, edge.y2);
    } else {
      ctx.moveTo(edge.x1, edge.y1);
      ctx.lineTo(edge.x2, edge.y2);
    }
    prevX = edge.x2;
    prevY = edge.y2;
    open = true;
  }
  ctx.stroke();
}

function clipHorizontal(
  y: number,
  fromX: number,
  toX: number,
  viewW: number,
  viewH: number,
): Segment | null {
  if (y < 0 || y > viewH) return null;
  const span = clipSpan(fromX, toX, 0, viewW);
  if (!span) return null;
  return { x1: span[0], y1: y, x2: span[1], y2: y };
}

function clipVertical(
  x: number,
  fromY: number,
  toY: number,
  viewW: number,
  viewH: number,
): Segment | null {
  if (x < 0 || x > viewW) return null;
  const span = clipSpan(fromY, toY, 0, viewH);
  if (!span) return null;
  return { x1: x, y1: span[0], x2: x, y2: span[1] };
}

/** The part of a directed span that lies inside `[min, max]`. */
function clipSpan(from: number, to: number, min: number, max: number): [number, number] | null {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const start = Math.max(lo, min);
  const end = Math.min(hi, max);
  if (!(end > start)) return null;
  return from <= to ? [start, end] : [end, start];
}
