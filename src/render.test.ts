import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from './camera';
import type { CanvasObject, VisibilityRange } from './model';
import { createRenderer } from './render';
import type { VisibleObject } from './store';
import { visibilityAlpha } from './visibility';

const camera: Camera = { x: 0, y: 0, scale: 4 };

type Paint =
  | { kind: 'text'; text: string; alpha: number }
  | { kind: 'image'; alpha: number };

type TransformCall = [number, number, number, number, number, number];

type Xy = { x: number; y: number };

type TextCall = Xy & { text: string };

type RectCall = { x: number; y: number; w: number; h: number };

type RecordedContext = CanvasRenderingContext2D & {
  paints: Paint[];
  transforms: TransformCall[];
  fonts: string[];
  lineWidths: number[];
  fillTexts: TextCall[];
  strokeRects: RectCall[];
  fillRects: RectCall[];
};

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  src = '';

  constructor() {
    images.push(this);
  }
}

const images: FakeImage[] = [];

function recordingContext(): RecordedContext {
  const state = { globalAlpha: 1 };
  const paints: Paint[] = [];
  const transforms: TransformCall[] = [];
  const fonts: string[] = [];
  const lineWidths: number[] = [];
  const fillTexts: TextCall[] = [];
  const strokeRects: RectCall[] = [];
  const fillRects: RectCall[] = [];
  const ctx = new Proxy({} as RecordedContext, {
    get(_target, prop) {
      if (prop === 'paints') return paints;
      if (prop === 'transforms') return transforms;
      if (prop === 'fonts') return fonts;
      if (prop === 'lineWidths') return lineWidths;
      if (prop === 'fillTexts') return fillTexts;
      if (prop === 'strokeRects') return strokeRects;
      if (prop === 'fillRects') return fillRects;
      if (prop === 'globalAlpha') return state.globalAlpha;
      if (prop === 'setTransform') {
        return (a: number, b: number, c: number, d: number, e: number, f: number) => {
          transforms.push([a, b, c, d, e, f]);
        };
      }
      if (prop === 'fillText') {
        return (text: string, x: number, y: number) => {
          paints.push({ kind: 'text', text, alpha: state.globalAlpha });
          fillTexts.push({ text, x, y });
        };
      }
      if (prop === 'strokeRect') {
        return (x: number, y: number, w: number, h: number) => {
          paints.push({ kind: 'image', alpha: state.globalAlpha });
          strokeRects.push({ x, y, w, h });
        };
      }
      if (prop === 'fillRect') {
        return (x: number, y: number, w: number, h: number) => {
          fillRects.push({ x, y, w, h });
        };
      }
      return () => {};
    },
    set(_target, prop, value: unknown) {
      if (prop === 'globalAlpha' && typeof value === 'number') state.globalAlpha = value;
      if (prop === 'font' && typeof value === 'string') fonts.push(value);
      if (prop === 'lineWidth' && typeof value === 'number') lineWidths.push(value);
      return true;
    },
  });
  return ctx;
}

function canvasFor(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  } as unknown as HTMLCanvasElement;
}

function textObject(id: string, visibility: VisibilityRange): CanvasObject {
  return {
    id,
    x: 0,
    y: 0,
    visibility,
    payload: { type: 'text', text: id, style: { fontSize: 12, color: '#fff' } },
  };
}

function imageObject(id: string, src: string, visibility: VisibilityRange): CanvasObject {
  return {
    id,
    x: 0,
    y: 0,
    visibility,
    payload: { type: 'image', src, width: 10, height: 10 },
  };
}

function visible(object: CanvasObject, alpha: number): VisibleObject {
  return { object, alpha };
}

function paintsOf(ctx: CanvasRenderingContext2D): Paint[] {
  return (ctx as RecordedContext).paints;
}

function transformsOf(ctx: CanvasRenderingContext2D): TransformCall[] {
  return (ctx as RecordedContext).transforms;
}

function fontsOf(ctx: CanvasRenderingContext2D): string[] {
  return (ctx as RecordedContext).fonts;
}

function lineWidthsOf(ctx: CanvasRenderingContext2D): number[] {
  return (ctx as RecordedContext).lineWidths;
}

function fillTextsOf(ctx: CanvasRenderingContext2D): TextCall[] {
  return (ctx as RecordedContext).fillTexts;
}

function strokeRectsOf(ctx: CanvasRenderingContext2D): RectCall[] {
  return (ctx as RecordedContext).strokeRects;
}

function fillRectsOf(ctx: CanvasRenderingContext2D): RectCall[] {
  return (ctx as RecordedContext).fillRects;
}

beforeEach(() => {
  images.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createRenderer', () => {
  it('paints the provided alpha in ascending maxScale order', () => {
    const ctx = recordingContext();
    const renderer = createRenderer(canvasFor(ctx), () => {});
    const low: VisibilityRange = { minScale: 1, maxScale: 2 };
    const mid: VisibilityRange = { minScale: 1, maxScale: 8 };
    const fine: VisibilityRange = { minScale: 1, maxScale: 64 };

    expect(visibilityAlpha(low, camera.scale)).toBe(0);
    expect(visibilityAlpha(fine, camera.scale)).toBe(1);

    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [
        visible(textObject('fine', fine), 0.55),
        visible(textObject('early', low), 0.3),
        visible(textObject('mid', mid), 0.011),
        visible(textObject('late', low), 0.2),
      ],
    });

    expect(paintsOf(ctx)).toEqual([
      { kind: 'text', text: 'early', alpha: 0.3 },
      { kind: 'text', text: 'late', alpha: 0.2 },
      { kind: 'text', text: 'mid', alpha: 0.011 },
      { kind: 'text', text: 'fine', alpha: 0.55 },
    ]);
    expect(transformsOf(ctx)).toEqual([[1, 0, 0, 1, 0, 0]]);
    expect(fillTextsOf(ctx).every((entry) => entry.x === 400 && entry.y === 300)).toBe(true);
    expect(fontsOf(ctx).every((font) => font.includes('48px'))).toBe(true);
  });

  it('fetches an image only when this frame draws it', () => {
    const ctx = recordingContext();
    const onReady = vi.fn();
    const renderer = createRenderer(canvasFor(ctx), onReady);

    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [visible(textObject('label', { minScale: 1, maxScale: 16 }), 1)],
    });

    expect(images).toEqual([]);
    expect(paintsOf(ctx)).toEqual([{ kind: 'text', text: 'label', alpha: 1 }]);
    expect(onReady).not.toHaveBeenCalled();

    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [visible(imageObject('buoy', 'images/buoy.svg', { minScale: 1, maxScale: 16 }), 1)],
    });

    expect(images.map((image) => image.src)).toEqual([expect.stringContaining('images/buoy.svg')]);
    images[0]?.onerror?.();
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('keeps 32 settled images and drops the least recently drawn', () => {
    const ctx = recordingContext();
    const onReady = vi.fn();
    const renderer = createRenderer(canvasFor(ctx), onReady);
    const visibility: VisibilityRange = { minScale: 1, maxScale: 64 };
    const settled = Array.from({ length: 32 }, (_, index) => `images/plate-${index}.svg`);
    const waiting = Array.from({ length: 5 }, (_, index) => `images/new-${index}.svg`);

    function drawSrcs(srcs: readonly string[]) {
      renderer.draw({
        camera,
        width: 800,
        height: 600,
        visible: srcs.map((src) => visible(imageObject(src, src, visibility), 1)),
      });
    }

    drawSrcs(settled);
    expect(images).toHaveLength(32);
    for (const image of images) image.onload?.();
    expect(onReady).toHaveBeenCalledTimes(32);

    // plate-0 was drawn first. Draw it again so a later eviction skips it.
    drawSrcs([settled[0]]);
    expect(images).toHaveLength(32);

    // In-flight loads stay even though 32 images have already settled.
    drawSrcs(waiting);
    expect(images).toHaveLength(37);
    drawSrcs([settled[0], waiting[4]]);
    expect(images).toHaveLength(37);

    // Settling one of them evicts plate-1, the least recently drawn settled image.
    images[32]?.onerror?.();
    expect(onReady).toHaveBeenCalledTimes(33);
    drawSrcs([settled[1]]);
    expect(images).toHaveLength(38);
    expect(images[37]?.src).toEqual(expect.stringContaining('images/plate-1.svg'));

    // The redrawn plate, the image that just settled, and one that has not loaded yet stay cached.
    drawSrcs([settled[0], waiting[0], waiting[1]]);
    expect(images).toHaveLength(38);
  });

  it('paints a visible image at the provided alpha and loads it once', () => {
    const ctx = recordingContext();
    const onReady = vi.fn();
    const renderer = createRenderer(canvasFor(ctx), onReady);
    const visibility: VisibilityRange = { minScale: 1, maxScale: 2 };
    expect(visibilityAlpha(visibility, camera.scale)).toBe(0);

    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [visible(imageObject('buoy', 'images/buoy.svg', visibility), 0.4)],
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.src).toEqual(expect.stringContaining('images/buoy.svg'));
    expect(paintsOf(ctx)).toEqual([{ kind: 'image', alpha: 0.4 }]);
    expect(strokeRectsOf(ctx)).toEqual([{ x: 380, y: 280, w: 40, h: 40 }]);
    expect(lineWidthsOf(ctx)).toEqual([1, 1.25]);

    images[0]?.onload?.();
    expect(onReady).toHaveBeenCalledOnce();
    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [visible(imageObject('buoy', 'images/buoy.svg', visibility), 0.4)],
    });
    expect(images).toHaveLength(1);
  });

  it('sizes the bitmap from the frame and does not measure the canvas', () => {
    const ctx = recordingContext();
    const canvas = canvasFor(ctx);
    canvas.getBoundingClientRect = () => {
      throw new Error('draw should not measure the canvas');
    };
    const renderer = createRenderer(canvas, () => {});

    renderer.draw({
      camera,
      width: 100,
      height: 40,
      visible: [visible(textObject('label', { minScale: 1, maxScale: 16 }), 1)],
    });

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(40);
    expect(paintsOf(ctx)).toEqual([{ kind: 'text', text: 'label', alpha: 1 }]);
  });

  it('draws CSS pixels from the camera at a million-to-one scale', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    const ctx = recordingContext();
    const renderer = createRenderer(canvasFor(ctx), () => {});
    const viewW = 800;
    const viewH = 600;
    const deep: Camera = { x: 132, y: -60, scale: 1e6 };
    const screenFont = 100;
    const fontSize = screenFont / deep.scale;
    const painted = fontSize * deep.scale;

    renderer.draw({
      camera: deep,
      width: viewW,
      height: viewH,
      visible: [
        visible(plateAt(132, -60, 36, 64), 1),
        visible(labelAt('pin', 132, -60, fontSize), 1),
        visible(labelAt('ordinary', 132, -60, 12), 1),
      ],
    });

    expect(painted).toBeLessThanOrEqual(512);
    expect(12 * deep.scale).toBeGreaterThan(512);
    expect(transformsOf(ctx)).toEqual([[2, 0, 0, 2, 0, 0]]);
    expect(fontsOf(ctx)).toEqual([expect.stringContaining(`${painted}px`)]);
    expect(lineWidthsOf(ctx)).toEqual([1, painted * 0.055]);

    const texts = fillTextsOf(ctx);
    expect(texts.map((entry) => entry.text)).toEqual(['pin']);
    expect(Math.abs((texts[0]?.x ?? Number.NaN) - viewW / 2)).toBeLessThan(1);
    expect(Math.abs((texts[0]?.y ?? Number.NaN) - viewH / 2)).toBeLessThan(1);

    expect(fillRectsOf(ctx)).toEqual([
      { x: 0, y: 0, w: viewW, h: viewH },
      { x: 0, y: 0, w: viewW, h: viewH },
    ]);
    expect(strokeRectsOf(ctx)).toEqual([]);
  });
});

function labelAt(id: string, x: number, y: number, fontSize: number): CanvasObject {
  return {
    id,
    x,
    y,
    visibility: { minScale: 1, maxScale: 2 },
    payload: { type: 'text', text: id, style: { fontSize, color: '#fff' } },
  };
}

function plateAt(x: number, y: number, width: number, height: number): CanvasObject {
  return {
    id: 'plate',
    x,
    y,
    visibility: { minScale: 1, maxScale: 1 },
    payload: { type: 'image', src: 'images/phone.svg', width, height },
  };
}
