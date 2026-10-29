import { viewBounds, type Camera } from './camera';
import { gridStep } from './grid';
import type { CanvasObject, TextStyle } from './model';

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

/**
 * A screen font above this is not submitted. Atlas labels peak near 185px,
 * so the cap does not drop a current label.
 */
const MAX_SCREEN_FONT_PX = 512;

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
};

export type Renderer = {
  /** Paint one measured frame. Alpha is already on each visible entry. */
  draw(frame: RenderFrame): void;
  /** Fetch image bytes. Drawing does not depend on the fetch having finished. */
  warm(srcs: readonly string[]): void;
};

function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const trimmed = path.replace(/^\//, '');
  return base.endsWith('/') ? base + trimmed : `${base}/${trimmed}`;
}

export function createRenderer(canvas: HTMLCanvasElement, onReady: () => void): Renderer {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  const images = new Map<string, HTMLImageElement>();

  function imageFor(src: string): HTMLImageElement {
    const existing = images.get(src);
    if (existing) return existing;
    const image = new Image();
    image.onload = () => onReady();
    image.onerror = () => onReady();
    image.src = publicUrl(src);
    images.set(src, image);
    return image;
  }

  function warm(srcs: readonly string[]) {
    for (const src of srcs) imageFor(src);
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
        drawTextObject(
          ctx,
          camera,
          viewW,
          viewH,
          object.x,
          object.y,
          object.payload.text,
          object.payload.style,
        );
      }
    }
    ctx.restore();
  }

  return { draw, warm };
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

function drawTextObject(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  viewW: number,
  viewH: number,
  x: number,
  y: number,
  label: string,
  style: TextStyle,
) {
  const screenFont = style.fontSize * camera.scale;
  if (!(screenFont > 0) || screenFont > MAX_SCREEN_FONT_PX) return;
  const family = style.fontFamily ?? DEFAULT_FONT;
  const weight = style.fontWeight ?? '500';
  ctx.font = `${weight} ${screenFont}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  (ctx as SpacedContext).letterSpacing = style.letterSpacing ?? '0px';
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.75)';
  ctx.lineWidth = screenFont * 0.055;
  const sx = worldToCssX(x, camera, viewW);
  const sy = worldToCssY(y, camera, viewH);
  ctx.strokeText(label, sx, sy);
  ctx.fillStyle = style.color;
  ctx.fillText(label, sx, sy);
  (ctx as SpacedContext).letterSpacing = '0px';
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
