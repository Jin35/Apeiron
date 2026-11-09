import { boxFitScale, viewBounds, type Camera, type ViewBounds } from './camera';
import { displayOpacity, type AnchorScale } from './fade';
import { gridStep } from './grid';
import { buildLevelPlan } from './levelFade';
import { clipLeaderLine, LEADER_GAP_PX, LEADER_WIDTH_PX, resolveWorldRect, type AxisRect } from './link';
import type { CanvasObject, LinkStyle, TextPayload } from './model';
import { darkTheme, withAlpha, type Theme } from './theme';
import { visibilityAlpha } from './visibility';

/** One object to paint, with the alpha to use. */
type VisibleObject = {
  object: CanvasObject;
  alpha: number;
};

const PLATE = '#171b22';

/** Grid hairline and plate frame, in CSS pixels. */
const GRID_LINE_PX = 1;
const PLATE_LINE_PX = 1.25;

/** Selection outline. Screen pixels, so it stays a hairline at any zoom. */
const SELECT_LINE_PX = 2;
/** Selection stroke is the accent at this alpha. Gold on the dark pack. */
const SELECT_ALPHA = 0.9;
/** Plate frame is the accent, fainter than the selection. */
const FRAME_ALPHA = 0.45;

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
  /** Pack look. Omitted frames use the demo dark theme. */
  theme?: Theme;
  /**
   * Opening fit scale (s0) for this viewport. Zoom fade on an object is
   * `camera.scale / fitScale`. Omit it and a fade with no anchor is not applied.
   * Anchor fits use this frame's width and height.
   */
  fitScale?: number;
  /**
   * Authored objects, parent-local. Leader lines resolve `from` / `to` from
   * this list each frame (parent chain and group scale). Omit and no link is drawn.
   */
  objects?: readonly CanvasObject[];
};

export type Renderer = {
  /**
   * Paint one measured frame. `alpha` is the visibility band. Zoom fade, when
   * the object has one, is applied here from `fitScale`. Alpha 0 is not drawn.
   */
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
    const theme = frame.theme ?? darkTheme;
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
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, viewW, viewH);
    drawPaper(ctx, theme, viewW, viewH);

    ctx.save();
    drawGrid(ctx, theme, camera, viewW, viewH);

    // Coarser bands (smaller maxScale) sit under finer ones. Equal bands keep
    // the caller's order, so a pack can stack parts by listing them back to front.
    const sorted = [...visible].sort(
      (a, b) => a.object.visibility.maxScale - b.object.visibility.maxScale,
    );
    const anchorScale = anchorFits(frame.objects, viewW, viewH);
    const level = levelOpacity(frame.objects, camera, viewW, viewH);
    for (const entry of sorted) {
      const alpha = paintAlpha(entry, camera.scale, frame.fitScale, anchorScale, level);
      if (!(alpha > 0)) continue;
      ctx.globalAlpha = alpha;
      const { object } = entry;
      if (object.payload.type === 'image') {
        drawImageObject(ctx, theme, camera, viewW, viewH, object, imageFor(object.payload.src));
      } else if (object.payload.type === 'text') {
        drawTextObject(ctx, theme, camera, viewW, viewH, object.x, object.y, object.payload);
      }
    }
    // After the objects, so the stroke stays visible across other parts.
    // Clipping keeps it out of the two endpoints; their transparent pixels
    // cannot show the line either, because the segment never enters the box.
    drawLinks(ctx, theme, camera, viewW, viewH, frame.objects, frame.fitScale, anchorScale, level);
    if (frame.selectedId) {
      const selected = visible.find((entry) => entry.object.id === frame.selectedId);
      if (selected && paintAlpha(selected, camera.scale, frame.fitScale, anchorScale, level) > 0) {
        drawSelection(ctx, theme, camera, viewW, viewH, selected.object);
      }
    }
    ctx.restore();
  }

  return { draw };
}

/** Visibility alpha times zoom fade times the sibling handover. Nothing here is pack-specific. */
function paintAlpha(
  entry: VisibleObject,
  scale: number,
  fitScale: number | undefined,
  anchorScale: AnchorScale | undefined,
  level: (id: string) => number,
): number {
  return displayOpacity(entry.alpha, entry.object.fade, scale, fitScale, anchorScale) * level(entry.object.id);
}

/**
 * Leader lines from `objects`. Endpoints are resolved here, not stored on the
 * link. Opacity is the minimum of the two endpoints' effective alpha, so the
 * line fades in and out with them. A missing endpoint or an alpha of 0 is skipped.
 * The stroke width and the gap stay in CSS pixels at every camera scale.
 */
function drawLinks(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  camera: Camera,
  viewW: number,
  viewH: number,
  objects: readonly CanvasObject[] | undefined,
  fitScale: number | undefined,
  anchorScale: AnchorScale | undefined,
  level: (id: string) => number,
): void {
  if (!objects || objects.length === 0) return;
  for (const object of objects) {
    if (object.payload.type !== 'link') continue;
    const { from, to, style } = object.payload;
    const fromAlpha = endpointAlpha(objects, from, camera.scale, fitScale, anchorScale, level);
    const toAlpha = endpointAlpha(objects, to, camera.scale, fitScale, anchorScale, level);
    if (fromAlpha === null || toAlpha === null) continue;
    const alpha = Math.min(fromAlpha, toAlpha);
    if (!(alpha > 0)) continue;

    const fromRect = resolveWorldRect(objects, from);
    const toRect = resolveWorldRect(objects, to);
    if (!fromRect || !toRect) continue;
    const segment = clipLeaderLine(
      projectRect(fromRect, camera, viewW, viewH),
      projectRect(toRect, camera, viewW, viewH),
      leaderGap(style),
    );
    if (!segment) continue;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style?.color ?? theme.ink;
    ctx.lineWidth = leaderWidth(style);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
  }
}

/** Display alpha of an endpoint, or null when that id is not in the list. */
function endpointAlpha(
  objects: readonly CanvasObject[],
  id: string,
  scale: number,
  fitScale: number | undefined,
  anchorScale: AnchorScale | undefined,
  level: (id: string) => number,
): number | null {
  const object = objects.find((candidate) => candidate.id === id);
  if (!object) return null;
  return displayOpacity(visibilityAlpha(object.visibility, scale), object.fade, scale, fitScale, anchorScale) * level(object.id);
}

/** Sibling handover for this camera. The same plan the store uses for culling. */
function levelOpacity(
  objects: readonly CanvasObject[] | undefined,
  camera: Camera,
  viewW: number,
  viewH: number,
): (id: string) => number {
  return buildLevelPlan(
    objects ?? [],
    (id) => {
      const rect = objects ? resolveWorldRect(objects, id) : null;
      return rect ? rectToBounds(rect) : undefined;
    },
    camera.scale,
    { x: camera.x, y: camera.y },
    { width: viewW, height: viewH },
  ).opacity;
}

/**
 * Opening fit of each anchor named on `objects`. The rect is the authored
 * placement, parent chain included, so it matches the store's world box.
 */
function anchorFits(
  objects: readonly CanvasObject[] | undefined,
  viewW: number,
  viewH: number,
): AnchorScale | undefined {
  if (!objects || !(viewW > 0) || !(viewH > 0)) return undefined;
  const cache = new Map<string, number | undefined>();
  return (id: string) => {
    const known = cache.get(id);
    if (known !== undefined || cache.has(id)) return known;
    const rect = resolveWorldRect(objects, id);
    const fitted = rect ? boxFitScale(rectToBounds(rect), viewW, viewH) : undefined;
    cache.set(id, fitted);
    return fitted;
  };
}

function rectToBounds(rect: AxisRect): ViewBounds {
  return {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
}

function projectRect(rect: AxisRect, camera: Camera, viewW: number, viewH: number): AxisRect {
  return {
    x: worldToCssX(rect.x, camera, viewW),
    y: worldToCssY(rect.y, camera, viewH),
    width: rect.width * camera.scale,
    height: rect.height * camera.scale,
  };
}

function leaderGap(style: LinkStyle | undefined): number {
  const gap = style?.gap;
  if (gap === undefined || !Number.isFinite(gap)) return LEADER_GAP_PX;
  return Math.max(0, gap);
}

function leaderWidth(style: LinkStyle | undefined): number {
  const width = style?.width;
  if (width === undefined || !Number.isFinite(width) || !(width > 0)) return LEADER_WIDTH_PX;
  return width;
}

/** Vignette plus a deterministic speck field. No image asset. */
function drawPaper(ctx: CanvasRenderingContext2D, theme: Theme, viewW: number, viewH: number) {
  const paper = theme.paper;
  if (!paper) return;

  const vignette = ctx.createRadialGradient(
    viewW / 2,
    viewH / 2,
    Math.min(viewW, viewH) * 0.2,
    viewW / 2,
    viewH / 2,
    Math.hypot(viewW, viewH) * 0.55,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, paper.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.fillStyle = paper.grain;
  const cols = Math.max(1, Math.floor(viewW));
  const rows = Math.max(1, Math.floor(viewH));
  const count = Math.min(700, Math.round((viewW * viewH) / 2800));
  for (let i = 0; i < count; i += 1) {
    const x = speck(i) % cols;
    const y = speck(i + 100003) % rows;
    const size = speck(i + 17) % 7 === 0 ? 2 : 1;
    ctx.fillRect(x, y, size, size);
  }
}

function speck(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  camera: Camera,
  viewW: number,
  viewH: number,
  object: CanvasObject,
) {
  if (object.payload.type === 'group' || object.payload.type === 'link') return;
  const { width, height } = object.payload;
  if (!(width > 0) || !(height > 0)) return;
  const left = worldToCssX(object.x - width / 2, camera, viewW);
  const top = worldToCssY(object.y - height / 2, camera, viewH);
  const cssW = width * camera.scale;
  const cssH = height * camera.scale;
  if (!(cssW > 0) || !(cssH > 0)) return;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = withAlpha(theme.accent, SELECT_ALPHA);
  ctx.lineWidth = SELECT_LINE_PX;
  ctx.strokeRect(left, top, cssW, cssH);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  camera: Camera,
  viewW: number,
  viewH: number,
) {
  const color = theme.grid?.color;
  if (!color) return;
  const step = gridStep(camera.scale);
  if (!(step > 0) || !Number.isFinite(step)) return;
  const bounds = viewBounds(camera, viewW, viewH);
  const i0 = Math.floor(bounds.left / step);
  const i1 = Math.ceil(bounds.right / step);
  const j0 = Math.floor(bounds.top / step);
  const j1 = Math.ceil(bounds.bottom / step);
  ctx.beginPath();
  ctx.strokeStyle = color;
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
  theme: Theme,
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

  const framed = object.payload.frame !== false;
  if (coordsArePrecise(left, top, cssW, cssH)) {
    if (framed) {
      ctx.fillStyle = PLATE;
      ctx.fillRect(left, top, cssW, cssH);
    }
    if (image.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, left, top, cssW, cssH);
    }
    if (framed) {
      ctx.strokeStyle = withAlpha(theme.accent, FRAME_ALPHA);
      ctx.lineWidth = PLATE_LINE_PX;
      ctx.strokeRect(left, top, cssW, cssH);
    }
    return;
  }

  const fill = clipToView(left, top, cssW, cssH, viewW, viewH);
  if (fill) {
    if (framed) {
      ctx.fillStyle = PLATE;
      ctx.fillRect(fill.x, fill.y, fill.w, fill.h);
    }
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const sx = ((fill.x - left) / cssW) * image.naturalWidth;
      const sy = ((fill.y - top) / cssH) * image.naturalHeight;
      const sw = (fill.w / cssW) * image.naturalWidth;
      const sh = (fill.h / cssH) * image.naturalHeight;
      ctx.drawImage(image, sx, sy, sw, sh, fill.x, fill.y, fill.w, fill.h);
    }
  }
  if (framed) strokeCrossingEdges(ctx, theme, left, top, left + cssW, top + cssH, viewW, viewH);
}

/** Halo stroke as a fraction of the font size. Counted when the ink is fitted to the box. */
const TEXT_HALO = 0.055;

function drawTextObject(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
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

  const family = style.fontFamily ?? theme.displayFont;
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
  ctx.fillStyle = style.color ?? theme.ink;
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
  theme: Theme,
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

  ctx.strokeStyle = withAlpha(theme.accent, FRAME_ALPHA);
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
