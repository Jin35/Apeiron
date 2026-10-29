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

function recordingContext(): CanvasRenderingContext2D {
  const state = { globalAlpha: 1 };
  const paints: Paint[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D & { paints: Paint[] }, {
    get(_target, prop) {
      if (prop === 'paints') return paints;
      if (prop === 'globalAlpha') return state.globalAlpha;
      if (prop === 'fillText') {
        return (text: string) => {
          paints.push({ kind: 'text', text, alpha: state.globalAlpha });
        };
      }
      if (prop === 'strokeRect') {
        return () => {
          paints.push({ kind: 'image', alpha: state.globalAlpha });
        };
      }
      return () => {};
    },
    set(_target, prop, value: number) {
      if (prop === 'globalAlpha') state.globalAlpha = value;
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
  return (ctx as CanvasRenderingContext2D & { paints: Paint[] }).paints;
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
  });

  it('fetches warmed sources that this frame does not draw', () => {
    const ctx = recordingContext();
    const onReady = vi.fn();
    const renderer = createRenderer(canvasFor(ctx), onReady);

    renderer.warm(['images/off-band.svg', 'images/buoy.svg', 'images/off-band.svg']);
    renderer.draw({
      camera,
      width: 800,
      height: 600,
      visible: [visible(textObject('label', { minScale: 1, maxScale: 16 }), 1)],
    });

    expect(images.map((image) => image.src)).toEqual([
      expect.stringContaining('images/off-band.svg'),
      expect.stringContaining('images/buoy.svg'),
    ]);
    expect(paintsOf(ctx)).toEqual([{ kind: 'text', text: 'label', alpha: 1 }]);
    expect(onReady).not.toHaveBeenCalled();

    images[0]?.onload?.();
    images[1]?.onerror?.();
    expect(onReady).toHaveBeenCalledTimes(2);
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
});
