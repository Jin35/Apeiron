import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUTTON_ZOOM_MS } from './buttonZoom';
import { zoomAt } from './camera';
import { demoObjects } from './demo';
import { wheelZoomFactor } from './gestures';
import { mountShell } from './main';
import { createMemoryStore } from './store';

type Listener = (event: Event) => void;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  src = '';
}

function recordingContext(draws: { n: number }): CanvasRenderingContext2D {
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop === 'setTransform') {
        return () => {
          draws.n += 1;
        };
      }
      return () => {};
    },
    set() {
      return true;
    },
  });
}

function harness() {
  const draws = { n: 0 };
  const ctx = recordingContext(draws);
  const canvasListeners = new Map<string, Listener[]>();
  const rect = {
    width: 800,
    height: 600,
    left: 10,
    top: 20,
    right: 810,
    bottom: 620,
    x: 10,
    y: 20,
    toJSON() {
      return {};
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    classList: { add() {}, remove() {} },
    setPointerCapture() {},
    getContext: () => ctx,
    getBoundingClientRect: () => rect,
    addEventListener(type: string, handler: Listener) {
      const list = canvasListeners.get(type) ?? [];
      list.push(handler);
      canvasListeners.set(type, list);
    },
    removeEventListener() {},
  };

  const status = { textContent: '', dataset: {} as DOMStringMap };
  const zoomInListeners: Listener[] = [];
  const zoomOutListeners: Listener[] = [];
  const zoomIn = {
    disabled: false,
    addEventListener(type: string, handler: Listener) {
      if (type === 'click') zoomInListeners.push(handler);
    },
  };
  const zoomOut = {
    disabled: false,
    addEventListener(type: string, handler: Listener) {
      if (type === 'click') zoomOutListeners.push(handler);
    },
  };

  const windowListeners = new Map<string, Listener[]>();
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let now = 1_000;
  let onResize: (() => void) | undefined;
  const images: FakeImage[] = [];

  class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      onResize = () => {
        callback([], this);
      };
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class RecordingImage extends FakeImage {
    constructor() {
      super();
      images.push(this);
    }
  }

  vi.stubGlobal('window', {
    innerWidth: 1280,
    devicePixelRatio: 1,
    location: { search: '' },
    addEventListener(type: string, handler: Listener) {
      const list = windowListeners.get(type) ?? [];
      list.push(handler);
      windowListeners.set(type, list);
    },
    removeEventListener() {},
  });
  vi.stubGlobal('Image', RecordingImage);
  vi.stubGlobal('ResizeObserver', ResizeObserver);
  vi.stubGlobal('WheelEvent', { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);

  mountShell(
    canvas as unknown as HTMLCanvasElement,
    status as unknown as HTMLElement,
    zoomIn as unknown as HTMLButtonElement,
    zoomOut as unknown as HTMLButtonElement,
  );

  return {
    draws,
    status,
    zoomIn,
    zoomOut,
    pending,
    images,
    setNow(value: number) {
      now = value;
    },
    flush() {
      const batch = [...pending.values()];
      pending.clear();
      for (const callback of batch) callback(now);
    },
    resize() {
      onResize?.();
    },
    clickIn() {
      for (const handler of zoomInListeners) handler({} as Event);
    },
    pointer(type: string, event: object) {
      for (const handler of canvasListeners.get(type) ?? []) handler(event as Event);
    },
    wheel(event: object) {
      for (const handler of windowListeners.get('wheel') ?? []) handler(event as Event);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('frame loop', () => {
  it('paints on startup and coalesces later invalidates into one frame', () => {
    const shell = harness();
    const visible = createMemoryStore(demoObjects).countInBand(0.1);

    expect(shell.draws.n).toBe(1);
    expect(shell.pending.size).toBe(0);
    expect(shell.status.textContent).toBe(`×0.100 · ${visible} visible`);
    expect(shell.status.dataset).toMatchObject({ scale: '0.1', x: '0', y: '-80' });

    shell.resize();
    shell.resize();
    shell.images[0]?.onload?.();
    shell.images[1]?.onerror?.();
    shell.images[2]?.onload?.();

    expect(shell.pending.size).toBe(1);
    expect(shell.draws.n).toBe(1);

    shell.flush();
    expect(shell.draws.n).toBe(2);
    expect(shell.pending.size).toBe(0);
  });

  it('re-invalidates while a button zoom is running, then stops', () => {
    const shell = harness();
    shell.clickIn();
    shell.clickIn();

    expect(shell.pending.size).toBe(1);
    expect(shell.draws.n).toBe(1);
    expect(shell.status.dataset.scale).toBe('0.1');

    shell.flush();
    expect(shell.draws.n).toBe(2);
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.1);
    expect(shell.pending.size).toBe(1);

    shell.setNow(1_000 + BUTTON_ZOOM_MS);
    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.2);
    expect(shell.status.dataset).toMatchObject({ x: '0', y: '-80' });
    expect(shell.pending.size).toBe(1);

    shell.setNow(1_000 + BUTTON_ZOOM_MS * 2);
    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.4);
    expect(shell.pending.size).toBe(0);
  });

  it('disables zoom-in from the committed scale while the picture is still catching up', () => {
    const shell = harness();
    for (let i = 0; i < 12; i += 1) shell.clickIn();

    shell.flush();
    expect(shell.zoomIn.disabled).toBe(true);
    expect(shell.zoomOut.disabled).toBe(false);
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.1);
  });

  it('paints a drag and a wheel zoom before the handler returns', () => {
    const shell = harness();
    const down = {
      pointerType: 'mouse',
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
    };
    shell.pointer('pointerdown', down);
    shell.pointer('pointermove', { ...down, clientX: 30 });

    expect(shell.draws.n).toBe(2);
    expect(shell.pending.size).toBe(0);
    expect(shell.status.dataset.x).toBe('-300');
    expect(shell.status.dataset.scale).toBe('0.1');

    shell.wheel({
      deltaX: 0,
      deltaY: -80,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 400,
      clientY: 300,
      preventDefault() {},
    });

    const zoomed = zoomAt(
      { x: -300, y: -80, scale: 0.1 },
      390,
      280,
      800,
      600,
      wheelZoomFactor(-80, false),
    );
    expect(shell.draws.n).toBe(3);
    expect(shell.pending.size).toBe(0);
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(zoomed.scale);
    expect(Number(shell.status.dataset.x)).toBeCloseTo(zoomed.x);
    expect(Number(shell.status.dataset.y)).toBeCloseTo(zoomed.y);
  });

  it('keeps the on-screen scale when a gesture cancels a button zoom', () => {
    const shell = harness();
    shell.clickIn();
    shell.setNow(1_000 + BUTTON_ZOOM_MS / 2);
    shell.flush();
    const scale = Number(shell.status.dataset.scale);
    expect(scale).toBeCloseTo(0.1 * Math.SQRT2);
    expect(shell.pending.size).toBe(1);

    const down = {
      pointerType: 'mouse',
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault() {},
    };
    shell.pointer('pointerdown', down);
    shell.pointer('pointermove', { ...down, clientX: 40 });

    expect(Number(shell.status.dataset.scale)).toBeCloseTo(scale);
    expect(shell.status.dataset.x).not.toBe('0');
    expect(shell.draws.n).toBe(3);

    shell.setNow(1_000 + BUTTON_ZOOM_MS * 4);
    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(scale);
    expect(shell.pending.size).toBe(0);
  });
});
