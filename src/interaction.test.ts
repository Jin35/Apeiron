import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_MS, ZOOM_STEP, wheelZoomFactor } from './gestures';
import { attachInteraction, type SceneCommand } from './interaction';

type Listener = (event: Event) => void;

function listenerMap() {
  const map = new Map<string, Listener[]>();
  return {
    add(type: string, handler: Listener) {
      const list = map.get(type) ?? [];
      list.push(handler);
      map.set(type, list);
    },
    remove(type: string, handler: Listener) {
      const list = map.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type: string, event: object) {
      for (const handler of [...(map.get(type) ?? [])]) handler(event as Event);
    },
  };
}

function harness() {
  const canvasListeners = listenerMap();
  const windowListeners = listenerMap();
  const zoomInListeners = listenerMap();
  const zoomOutListeners = listenerMap();
  const commands: SceneCommand[] = [];

  const canvas = {
    classList: { add() {}, remove() {} },
    setPointerCapture() {},
    getBoundingClientRect: () => ({
      left: 40,
      top: 15,
      width: 800,
      height: 600,
      right: 840,
      bottom: 615,
      x: 40,
      y: 15,
      toJSON() {
        return {};
      },
    }),
    addEventListener: canvasListeners.add,
    removeEventListener: canvasListeners.remove,
  };
  const zoomIn = {
    addEventListener: zoomInListeners.add,
    removeEventListener: zoomInListeners.remove,
  };
  const zoomOut = {
    addEventListener: zoomOutListeners.add,
    removeEventListener: zoomOutListeners.remove,
  };

  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 700,
    addEventListener: windowListeners.add,
    removeEventListener: windowListeners.remove,
  });
  vi.stubGlobal('WheelEvent', { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });

  const detach = attachInteraction(
    {
      canvas: canvas as unknown as HTMLElement,
      zoomIn: zoomIn as unknown as HTMLElement,
      zoomOut: zoomOut as unknown as HTMLElement,
    },
    (command) => {
      commands.push(command);
    },
  );

  function pointer(type: string, event: object) {
    canvasListeners.dispatch(type, { preventDefault() {}, button: 0, ...event });
  }

  return { commands, detach, pointer, windowListeners, zoomInListeners, zoomOutListeners };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('attachInteraction', () => {
  it('emits panBy for a mouse drag and ignores movement inside the tap slop', () => {
    const { commands, pointer } = harness();
    const down = { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 120 };
    pointer('pointerdown', down);
    pointer('pointermove', { ...down, clientX: 110, clientY: 120 });
    expect(commands).toEqual([]);

    pointer('pointermove', { ...down, clientX: 130, clientY: 128 });
    expect(commands).toEqual([{ type: 'panBy', dx: 30, dy: 8 }]);

    pointer('pointermove', { ...down, clientX: 140, clientY: 128 });
    expect(commands).toEqual([
      { type: 'panBy', dx: 30, dy: 8 },
      { type: 'panBy', dx: 10, dy: 0 },
    ]);
  });

  it('emits panBy for a one-finger touch drag', () => {
    const { commands, pointer } = harness();
    const down = { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 80 };
    pointer('pointerdown', down);
    pointer('pointermove', { ...down, clientX: 80, clientY: 70 });
    expect(commands).toEqual([{ type: 'panBy', dx: 30, dy: -10 }]);
  });

  it('emits zoomAt in canvas-local pixels for a wheel and a trackpad pinch', () => {
    const { commands, windowListeners } = harness();
    windowListeners.dispatch('wheel', {
      deltaX: 0,
      deltaY: -80,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 100,
      clientY: 80,
      preventDefault() {},
    });
    windowListeners.dispatch('wheel', {
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 200,
      clientY: 90,
      preventDefault() {},
    });

    expect(commands).toEqual([
      { type: 'zoomAt', x: 60, y: 65, factor: wheelZoomFactor(-80, false) },
      { type: 'zoomAt', x: 160, y: 75, factor: wheelZoomFactor(40, true) },
    ]);
  });

  it('emits retarget in canvas-local pixels for a two-finger pinch', () => {
    const { commands, pointer } = harness();
    pointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 200 });
    pointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 180, clientY: 200 });
    pointer('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 260, clientY: 200 });

    expect(commands).toEqual([
      {
        type: 'retarget',
        anchor: { x: 100, y: 185 },
        target: { x: 140, y: 185 },
        factor: 2,
      },
    ]);
  });

  it('emits zoomAt for a touch double-tap and selectAt for mouse clicks', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const touch = harness();
    const tap = { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 95 };
    touch.pointer('pointerdown', tap);
    touch.pointer('pointerup', tap);
    expect(touch.commands).toEqual([]);
    touch.pointer('pointerdown', tap);
    touch.pointer('pointerup', tap);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(touch.commands).toEqual([{ type: 'zoomAt', x: 100, y: 80, factor: ZOOM_STEP }]);

    const mouse = harness();
    const click = { pointerType: 'mouse', pointerId: 1, clientX: 140, clientY: 95 };
    mouse.pointer('pointerdown', click);
    mouse.pointer('pointerup', click);
    mouse.pointer('pointerdown', click);
    mouse.pointer('pointerup', click);
    expect(mouse.commands).toEqual([
      { type: 'selectAt', x: 100, y: 80 },
      { type: 'selectAt', x: 100, y: 80 },
    ]);
  });

  it('emits selectAt for a mouse click and not for a drag', () => {
    const click = harness();
    const down = { pointerType: 'mouse', pointerId: 1, clientX: 140, clientY: 95 };
    click.pointer('pointerdown', down);
    click.pointer('pointerup', down);
    expect(click.commands).toEqual([{ type: 'selectAt', x: 100, y: 80 }]);

    const drag = harness();
    const start = { pointerType: 'mouse', pointerId: 1, clientX: 140, clientY: 95 };
    drag.pointer('pointerdown', start);
    drag.pointer('pointermove', { ...start, clientX: 180, clientY: 95 });
    drag.pointer('pointerup', { ...start, clientX: 180, clientY: 95 });
    expect(drag.commands).toEqual([{ type: 'panBy', dx: 40, dy: 0 }]);
  });

  it('emits selectAt for a touch tap only after DOUBLE_TAP_MS', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { commands, pointer } = harness();
    const tap = { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 95 };
    pointer('pointerdown', tap);
    pointer('pointerup', tap);
    expect(commands).toEqual([]);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 1);
    expect(commands).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commands).toEqual([{ type: 'selectAt', x: 100, y: 80 }]);
  });

  it('does not emit selectAt for a touch drag', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { commands, pointer } = harness();
    const start = { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 80 };
    pointer('pointerdown', start);
    pointer('pointermove', { ...start, clientX: 80, clientY: 70 });
    pointer('pointerup', { ...start, clientX: 80, clientY: 70 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(commands).toEqual([{ type: 'panBy', dx: 30, dy: -10 }]);
  });

  it('does not emit a settled tap after detach', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { commands, detach, pointer } = harness();
    const tap = { pointerType: 'touch', pointerId: 1, clientX: 140, clientY: 95 };
    pointer('pointerdown', tap);
    pointer('pointerup', tap);
    detach();
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(commands).toEqual([]);
  });

  it('emits zoomAt for a two-finger tap', () => {
    const { commands, pointer } = harness();
    pointer('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 200 });
    pointer('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 160, clientY: 230 });
    pointer('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 200 });

    expect(commands).toEqual([{ type: 'zoomAt', x: 90, y: 200, factor: 1 / ZOOM_STEP }]);
  });

  it('emits zoomAt for a Safari pinch', () => {
    const { commands, windowListeners } = harness();
    windowListeners.dispatch('gesturestart', { preventDefault() {} });
    windowListeners.dispatch('gesturechange', {
      preventDefault() {},
      scale: 1.25,
      clientX: 90,
      clientY: 55,
    });

    expect(commands).toEqual([{ type: 'zoomAt', x: 50, y: 40, factor: 1.25 }]);
  });

  it('emits a queued zoom step for + and −', () => {
    const { commands, zoomInListeners, zoomOutListeners } = harness();
    zoomInListeners.dispatch('click', {});
    zoomOutListeners.dispatch('click', {});
    zoomInListeners.dispatch('click', {});

    expect(commands).toEqual([
      { type: 'zoomStep', factor: ZOOM_STEP },
      { type: 'zoomStep', factor: 1 / ZOOM_STEP },
      { type: 'zoomStep', factor: ZOOM_STEP },
    ]);
  });

  it('stops emitting after detach', () => {
    const { commands, detach, pointer, windowListeners, zoomInListeners } = harness();
    const down = { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 };
    pointer('pointerdown', down);
    pointer('pointermove', { ...down, clientX: 40, clientY: 0 });
    expect(commands).toHaveLength(1);

    detach();
    commands.length = 0;
    pointer('pointermove', { ...down, clientX: 80, clientY: 10 });
    windowListeners.dispatch('wheel', {
      deltaX: 0,
      deltaY: -40,
      deltaMode: 0,
      ctrlKey: false,
      clientX: 100,
      clientY: 80,
      preventDefault() {},
    });
    zoomInListeners.dispatch('click', {});
    expect(commands).toEqual([]);
  });
});
