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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    drawGrid(ctx, camera, viewW, viewH);

    // Coarser bands (smaller maxScale) sit under finer ones. Alpha is the caller's.
    const sorted = [...visible].sort(
      (a, b) => a.object.visibility.maxScale - b.object.visibility.maxScale,
    );
    for (const { object, alpha } of sorted) {
      ctx.globalAlpha = alpha;
      if (object.payload.type === 'image') {
        drawImageObject(ctx, camera.scale, object, imageFor(object.payload.src));
      } else {
        drawTextObject(ctx, object.x, object.y, object.payload.text, object.payload.style);
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
  ctx.lineWidth = 1 / camera.scale;
  const limit = 120;
  for (let i = i0, n = 0; i <= i1 && n < limit; i += 1, n += 1) {
    const x = i * step;
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, bounds.bottom);
  }
  for (let j = j0, n = 0; j <= j1 && n < limit; j += 1, n += 1) {
    const y = j * step;
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
  }
  ctx.stroke();
}

function drawImageObject(
  ctx: CanvasRenderingContext2D,
  scale: number,
  object: CanvasObject,
  image: HTMLImageElement,
) {
  if (object.payload.type !== 'image') return;
  const { width, height } = object.payload;
  const left = object.x - width / 2;
  const top = object.y - height / 2;
  ctx.fillStyle = PLATE;
  ctx.fillRect(left, top, width, height);
  if (image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, left, top, width, height);
  }
  ctx.strokeStyle = FRAME;
  ctx.lineWidth = 1.25 / scale;
  ctx.strokeRect(left, top, width, height);
}

function drawTextObject(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  style: TextStyle,
) {
  const family = style.fontFamily ?? DEFAULT_FONT;
  const weight = style.fontWeight ?? '500';
  ctx.font = `${weight} ${style.fontSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  (ctx as SpacedContext).letterSpacing = style.letterSpacing ?? '0px';
  ctx.strokeStyle = 'rgba(10, 12, 16, 0.75)';
  ctx.lineWidth = style.fontSize * 0.055;
  ctx.strokeText(label, x, y);
  ctx.fillStyle = style.color;
  ctx.fillText(label, x, y);
  (ctx as SpacedContext).letterSpacing = '0px';
}
