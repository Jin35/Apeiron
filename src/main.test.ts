import { afterEach, describe, expect, it, vi } from 'vitest';
import page from '../index.html?raw';
import { initialCameraFor } from './bootstrap';
import { BUTTON_ZOOM_MS } from './buttonZoom';
import { viewBounds, zoomAt } from './camera';
import { demoObjects, titleFitWidth } from './demo';
import { DOUBLE_TAP_MS, wheelZoomFactor } from './gestures';
import { mountShell } from './main';
import type { CanvasObject } from './model';
import { createMemoryStore, type SceneStore } from './store';

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

function harness(options?: {
  search?: string;
  innerWidth?: number;
  store?: SceneStore;
  reduceMotion?: boolean;
}) {
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
    dataset: {} as DOMStringMap,
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

  const statusAttributes = new Map<string, string>([['aria-live', 'polite']]);
  const status = {
    textContent: '',
    dataset: {} as DOMStringMap,
    getAttribute(name: string) {
      return statusAttributes.get(name) ?? null;
    },
    removeAttribute(name: string) {
      statusAttributes.delete(name);
    },
  };
  const labels = createLabelList();
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

  const motionListeners: Array<(event: { matches: boolean }) => void> = [];
  let reduceMotion = options?.reduceMotion ?? false;
  let motionQuery = '';
  vi.stubGlobal('window', {
    innerWidth: options?.innerWidth ?? 1280,
    devicePixelRatio: 1,
    location: { search: options?.search ?? '' },
    addEventListener(type: string, handler: Listener) {
      const list = windowListeners.get(type) ?? [];
      list.push(handler);
      windowListeners.set(type, list);
    },
    removeEventListener() {},
    matchMedia(query: string) {
      motionQuery = query;
      return {
        matches: reduceMotion,
        media: query,
        addEventListener(type: string, handler: (event: { matches: boolean }) => void) {
          if (type === 'change') motionListeners.push(handler);
        },
        removeEventListener() {},
      };
    },
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
    options?.store,
    labels as unknown as HTMLElement,
  );

  return {
    draws,
    canvas,
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
    clickOut() {
      for (const handler of zoomOutListeners) handler({} as Event);
    },
    pointer(type: string, event: object) {
      for (const handler of canvasListeners.get(type) ?? []) handler(event as Event);
    },
    wheel(event: object) {
      for (const handler of windowListeners.get('wheel') ?? []) handler(event as Event);
    },
    keydown(event: { key: string }) {
      for (const handler of windowListeners.get('keydown') ?? []) {
        handler({
          key: event.key,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          target: { tagName: 'BODY', isContentEditable: false },
          preventDefault() {},
        } as unknown as Event);
      }
    },
    labels,
    motionQuery: () => motionQuery,
    setReduceMotion(value: boolean) {
      reduceMotion = value;
      for (const handler of motionListeners) handler({ matches: value });
    },
  };
}

type LabelNode = { textContent: string };

function createLabelList() {
  const attributes = new Map<string, string>([['aria-live', 'polite']]);
  const nodes: LabelNode[] = [];
  let builds = 0;
  return {
    className: 'sr-only',
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    ownerDocument: {
      createElement() {
        return { textContent: '' };
      },
    },
    replaceChildren(...next: LabelNode[]) {
      builds += 1;
      nodes.splice(0, nodes.length, ...next);
    },
    texts() {
      return nodes.map((node) => node.textContent);
    },
    builds() {
      return builds;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
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
    expect(shell.images).toHaveLength(0);

    // Region images start at minScale 0.16. One + step lands at 0.2, in that band.
    shell.clickIn();
    shell.setNow(1_000 + BUTTON_ZOOM_MS);
    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.2);
    const region = createMemoryStore(demoObjects).query({
      bounds: viewBounds({ x: 0, y: -80, scale: 0.2 }, 800, 600),
      scale: 0.2,
    });
    const expectedSrcs = region.flatMap((entry) =>
      entry.object.payload.type === 'image' ? [entry.object.payload.src] : [],
    );
    expect(expectedSrcs.length).toBeGreaterThan(0);
    expect(shell.images.map((image) => image.src)).toEqual(
      expectedSrcs.map((src) => expect.stringContaining(src)),
    );

    shell.resize();
    shell.resize();
    shell.images.forEach((image, index) => {
      if (index === 1) image.onerror?.();
      else image.onload?.();
    });

    expect(shell.pending.size).toBe(1);
    expect(shell.draws.n).toBe(2);

    shell.flush();
    expect(shell.draws.n).toBe(3);
    expect(shell.pending.size).toBe(0);
    expect(shell.images).toHaveLength(expectedSrcs.length);
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
    // Twelve 2× steps pass the old limit (80) and stay under 1e7.
    for (let i = 0; i < 12; i += 1) shell.clickIn();
    shell.flush();
    expect(shell.zoomIn.disabled).toBe(false);
    expect(shell.zoomOut.disabled).toBe(false);
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.1);

    // Twenty-seven steps from 0.1 land past 1e7.
    for (let i = 0; i < 15; i += 1) shell.clickIn();
    shell.flush();
    expect(shell.zoomIn.disabled).toBe(true);
    expect(shell.zoomOut.disabled).toBe(false);
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.1);
  });

  it('disables zoom-out at the wide minimum while the picture is still catching up', () => {
    const shell = harness();
    // Four 2× steps out pass the old minimum (0.012) and stay above 1e-4.
    for (let i = 0; i < 4; i += 1) shell.clickOut();
    shell.flush();
    expect(shell.zoomOut.disabled).toBe(false);
    expect(shell.zoomIn.disabled).toBe(false);

    // Ten steps from 0.1 land under 1e-4.
    for (let i = 0; i < 6; i += 1) shell.clickOut();
    shell.flush();
    expect(shell.zoomOut.disabled).toBe(true);
    expect(shell.zoomIn.disabled).toBe(false);
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

  it('opens on the fitted camera, and a scale query replaces it', () => {
    const phone = harness({ innerWidth: 390 });
    const fitted = initialCameraFor(390, titleFitWidth);
    expect(Number(phone.status.dataset.scale)).toBeCloseTo(fitted.scale);
    expect(phone.status.dataset).toMatchObject({ x: '0', y: '-80' });
    expect(fitted.scale).toBeLessThan(0.06);
    expect(phone.images).toHaveLength(0);
    const visible = createMemoryStore(demoObjects).countInBand(fitted.scale);
    expect(phone.status.textContent).toBe(`×${Number(fitted.scale).toFixed(3)} · ${visible} visible`);

    const wharf = harness({ search: '?scale=2&x=-3012&y=-1112' });
    const count = createMemoryStore(demoObjects).countInBand(2);
    expect(wharf.status.textContent).toBe(`×2.00 · ${count} visible`);
    expect(wharf.status.dataset).toMatchObject({ scale: '2', x: '-3012', y: '-1112' });
  });

  it('prints the wide scale limits and still disables +/− there', () => {
    const store = createMemoryStore(demoObjects);

    const oldMin = harness({ search: '?scale=0.012&x=0&y=-80' });
    expect(oldMin.status.textContent).toBe(`×0.012 · ${store.countInBand(0.012)} visible`);
    expect(oldMin.zoomOut.disabled).toBe(false);

    const far = harness({ search: '?scale=1e-4&x=0&y=-80' });
    expect(far.status.textContent).toBe('×1e-4 · 0 visible');
    expect(far.status.dataset.scale).toBe('0.0001');
    expect(far.zoomOut.disabled).toBe(true);
    expect(far.zoomIn.disabled).toBe(false);

    const oldMax = harness({ search: '?scale=80&x=132&y=-60' });
    expect(oldMax.status.textContent).toBe(`×80.0 · ${store.countInBand(80)} visible`);
    expect(oldMax.zoomIn.disabled).toBe(false);

    const deep = harness({ search: '?scale=1e7&x=132&y=-60' });
    expect(deep.status.textContent).toBe('×1e7 · 0 visible');
    expect(deep.status.dataset.scale).toBe('10000000');
    expect(deep.zoomIn.disabled).toBe(true);
    expect(deep.zoomOut.disabled).toBe(false);
  });

  it('paints one frame when the store replaces its objects', () => {
    const store = createMemoryStore([]);
    const shell = harness({ store });

    expect(shell.draws.n).toBe(1);
    expect(shell.pending.size).toBe(0);
    expect(shell.status.textContent).toBe('×0.100 · 0 visible');

    store.replaceObjects([
      {
        id: 'late',
        x: 0,
        y: -80,
        visibility: { minScale: 0.02, maxScale: 0.3 },
        payload: { type: 'text', text: 'Late', style: { fontSize: 12, color: '#fff' }, width: 40, height: 16 },
      },
    ]);

    expect(shell.draws.n).toBe(1);
    expect(shell.pending.size).toBe(1);

    shell.flush();
    expect(shell.draws.n).toBe(2);
    expect(shell.pending.size).toBe(0);
    expect(store.countInBand(0.1)).toBe(1);
    expect(shell.status.textContent).toBe('×0.100 · 1 visible');
  });

  it('selects on click, clears on empty space, and does not select on drag', () => {
    const shell = harness();
    expect(shell.status.dataset.selected).toBe('');
    expect(shell.canvas.dataset.selected).toBe('');

    clickAt(shell, 'mouse', 410, 320);
    expect(shell.status.dataset.selected).toBe('overview-title');
    expect(shell.canvas.dataset.selected).toBe('overview-title');

    clickAt(shell, 'mouse', 410, 368);
    expect(shell.status.dataset.selected).toBe('');
    expect(shell.canvas.dataset.selected).toBe('');

    const drag = pointerAt('mouse', 410, 320);
    shell.pointer('pointerdown', drag);
    shell.pointer('pointermove', { ...drag, clientX: 450 });
    shell.pointer('pointerup', { ...drag, clientX: 450 });
    expect(shell.status.dataset.selected).toBe('');
    expect(shell.canvas.dataset.selected).toBe('');
    expect(shell.status.dataset.x).toBe('-400');
    expect(shell.status.dataset.scale).toBe('0.1');
  });

  it('keeps a selection across a drag and does not cancel a button zoom', () => {
    const shell = harness();
    shell.clickIn();
    shell.setNow(1_000 + BUTTON_ZOOM_MS / 2);
    shell.flush();
    const scale = Number(shell.status.dataset.scale);

    clickAt(shell, 'mouse', 410, 320);
    expect(shell.status.dataset.selected).toBe('overview-title');
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(scale);
    expect(shell.pending.size).toBe(1);

    const drag = pointerAt('mouse', 410, 320);
    shell.pointer('pointerdown', drag);
    shell.pointer('pointermove', { ...drag, clientX: 450 });
    shell.pointer('pointerup', { ...drag, clientX: 450 });
    expect(shell.status.dataset.selected).toBe('overview-title');
    expect(shell.status.dataset.x).not.toBe('0');
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(scale);
  });

  it('selects a touch tap only after DOUBLE_TAP_MS', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shell = harness();
    clickAt(shell, 'touch', 410, 320);
    expect(shell.status.dataset.selected).toBe('');
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 1);
    expect(shell.status.dataset.selected).toBe('');
    vi.advanceTimersByTime(1);
    expect(shell.status.dataset.selected).toBe('overview-title');
    expect(shell.canvas.dataset.selected).toBe('overview-title');
    expect(shell.status.dataset.scale).toBe('0.1');
  });

  it('zooms a touch double-tap without selecting', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shell = harness();
    clickAt(shell, 'touch', 410, 320);
    clickAt(shell, 'touch', 410, 320);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(shell.status.dataset.selected).toBe('');
    expect(shell.canvas.dataset.selected).toBe('');
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.2);
    expect(shell.status.dataset).toMatchObject({ x: '0', y: '-80' });
  });

  it('settles a zoom step in one frame when reduced motion matches', () => {
    const shell = harness({ reduceMotion: true });
    expect(shell.motionQuery()).toBe('(prefers-reduced-motion: reduce)');

    shell.keydown({ key: '+' });
    expect(shell.draws.n).toBe(1);
    expect(shell.pending.size).toBe(1);
    expect(shell.status.dataset.scale).toBe('0.1');

    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.2);
    expect(shell.status.dataset).toMatchObject({ x: '0', y: '-80' });
    expect(shell.pending.size).toBe(0);
    expect(shell.draws.n).toBe(2);

    shell.clickIn();
    shell.flush();
    expect(Number(shell.status.dataset.scale)).toBeCloseTo(0.4);
    expect(shell.pending.size).toBe(0);
  });

  it('follows prefers-reduced-motion as it changes', () => {
    const animated = harness();
    animated.clickIn();
    animated.flush();
    expect(Number(animated.status.dataset.scale)).toBeCloseTo(0.1);
    expect(animated.pending.size).toBe(1);

    animated.setReduceMotion(true);
    animated.clickIn();
    animated.flush();
    expect(Number(animated.status.dataset.scale)).toBeCloseTo(0.4);
    expect(animated.pending.size).toBe(0);

    const settled = harness({ reduceMotion: true });
    settled.setReduceMotion(false);
    settled.clickIn();
    settled.flush();
    expect(Number(settled.status.dataset.scale)).toBeCloseTo(0.1);
    expect(settled.pending.size).toBe(1);
    settled.setNow(1_000 + BUTTON_ZOOM_MS);
    settled.flush();
    expect(Number(settled.status.dataset.scale)).toBeCloseTo(0.2);
    expect(settled.pending.size).toBe(0);
  });

  it('lists text labels from the spatial query and does not announce them', () => {
    const shell = harness();
    const camera = { x: 0, y: -80, scale: 0.1 };
    const labels = createMemoryStore(demoObjects)
      .query({ bounds: viewBounds(camera, 800, 600), scale: camera.scale })
      .flatMap((entry) => (entry.object.payload.type === 'text' ? [entry.object.payload.text] : []));

    expect(labels.length).toBeGreaterThan(0);
    expect(shell.labels.texts()).toEqual(labels);
    expect(shell.labels.getAttribute('aria-live')).toBeNull();
    expect(shell.status.getAttribute('aria-live')).toBeNull();
    expect(page).not.toContain('aria-live');
    expect(page).toContain('<p id="status"></p>');
    expect(page).toContain('<ul id="labels" class="sr-only" aria-label="Labels in view"></ul>');

    const built = shell.labels.builds();
    shell.resize();
    shell.flush();
    const down = pointerAt('mouse', 100, 100);
    shell.pointer('pointerdown', down);
    shell.pointer('pointermove', { ...down, clientX: 130 });
    expect(shell.labels.builds()).toBe(built);
    expect(shell.labels.texts()).toEqual(labels);
  });

  it('rebuilds the label list only when the queried text changes', () => {
    const band = { minScale: 0.02, maxScale: 0.3 };
    const label = (id: string, x: number, text: string): CanvasObject => ({
      id,
      x,
      y: -80,
      visibility: band,
      payload: { type: 'text', text, style: { fontSize: 12, color: '#fff' }, width: 40, height: 20 },
    });
    const plate: CanvasObject = {
      id: 'plate',
      x: 0,
      y: -80,
      visibility: band,
      payload: { type: 'image', src: 'images/phone.svg', width: 10, height: 10 },
    };
    const objects = [label('near', 0, 'Near'), plate, label('also', 100, 'Also'), label('far', 20_000, 'Far')];
    const store = createMemoryStore(objects);
    const shell = harness({ store });

    expect(store.countInBand(0.1)).toBe(4);
    expect(shell.labels.texts()).toEqual(['Near', 'Also']);
    expect(shell.labels.getAttribute('aria-live')).toBeNull();
    expect(shell.labels.builds()).toBe(1);

    const down = pointerAt('mouse', 100, 100);
    shell.pointer('pointerdown', down);
    shell.pointer('pointermove', { ...down, clientX: 130 });
    expect(shell.labels.texts()).toEqual(['Near', 'Also']);
    expect(shell.labels.builds()).toBe(1);

    store.replaceObjects([label('near', 0, 'Newer'), plate, label('also', 100, 'Also'), label('far', 20_000, 'Far')]);
    expect(shell.labels.builds()).toBe(1);
    shell.flush();
    expect(shell.labels.texts()).toEqual(['Newer', 'Also']);
    expect(shell.labels.builds()).toBe(2);
    expect(store.countInBand(0.1)).toBe(4);

    const jump = pointerAt('mouse', 2500, 100);
    shell.pointer('pointerdown', jump);
    shell.pointer('pointermove', { ...jump, clientX: 500 });
    // The earlier 30px drag left the camera at x = -300. This drag is -2000px.
    expect(shell.status.dataset.x).toBe('19700');
    expect(shell.labels.texts()).toEqual(['Far']);
    expect(shell.labels.builds()).toBe(3);
    expect(shell.labels.getAttribute('aria-live')).toBeNull();
    expect(store.countInBand(0.1)).toBe(4);
  });
});

function pointerAt(pointerType: string, clientX: number, clientY: number) {
  return {
    pointerType,
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    preventDefault() {},
  };
}

function clickAt(
  shell: { pointer: (type: string, event: object) => void },
  pointerType: string,
  clientX: number,
  clientY: number,
) {
  const event = pointerAt(pointerType, clientX, clientY);
  shell.pointer('pointerdown', event);
  shell.pointer('pointerup', event);
}
