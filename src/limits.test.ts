import { describe, expect, it } from 'vitest';
import {
  BUTTON_ZOOM_MS,
  committedCamera,
  createButtonZoom,
  pressButtonZoom,
  tickButtonZoom,
} from './buttonZoom';
import {
  applyCameraCommand,
  boxFitScale,
  CONTENT_MARGIN,
  deriveCameraLimits,
  FIT_SLACK,
  MAX_SCALE,
  MIN_SCALE,
  READABLE_PX,
  worldPoint,
  type Camera,
  type ContentBox,
  type ViewBounds,
} from './camera';
import { demoObjects } from './demo';
import type { CanvasObject } from './model';
import { createMemoryStore } from './store';

const viewW = 800;
const viewH = 600;

describe('derived camera limits', () => {
  it('keeps the demo opening scale inside the fit and the readable depth', () => {
    const limits = deriveCameraLimits(createMemoryStore(demoObjects).contentBoxes(), viewW, viewH);
    expect(limits.minScale).toBeLessThanOrEqual(0.1);
    expect(limits.minScale).toBeGreaterThan(MIN_SCALE);
    expect(limits.maxScale).toBeGreaterThanOrEqual(0.1);
    expect(limits.maxScale).toBeLessThan(MAX_SCALE);
    expect(limits.bounds).toBeDefined();
  });

  it('unions parent-local children, including a grandchild, and skips a missing parent', () => {
    const parent = text('parent', 100, 50, 40, 20, 4);
    const child = text('child', 30, -10, 16, 12, 20, 'parent');
    const grand = text('grand', 5, 4, 40, 40, 80, 'child');
    const orphan = text('orphan', 0, 0, 10, 10, 500, 'missing');
    const store = createMemoryStore([grand, orphan, child, parent]);
    const limits = deriveCameraLimits(store.contentBoxes(), viewW, viewH);

    // child world (130, 40); grandchild world (135, 44).
    const union = { left: 80, right: 155, top: 24, bottom: 64 };
    const width = union.right - union.left;
    const height = union.bottom - union.top;
    expect(limits.bounds).toEqual({
      left: union.left - width * CONTENT_MARGIN,
      right: union.right + width * CONTENT_MARGIN,
      top: union.top - height * CONTENT_MARGIN,
      bottom: union.bottom + height * CONTENT_MARGIN,
    });
    expect(limits.maxScale).toBeCloseTo(80);
    expect(store.contentBoxes().map((entry) => entry.maxScale).sort((a, b) => a - b)).toEqual([4, 20, 80]);
  });

  it('cannot zoom out past the fit or in past the readable scale', () => {
    const limits = deriveCameraLimits([plate(-100, 100, -50, 50, 10, 20)], viewW, viewH);
    const fitted = fitOf(limits.bounds!, viewW, viewH) * FIT_SLACK;
    expect(limits.minScale).toBeCloseTo(fitted);
    expect(limits.fitScale).toBeCloseTo(fitted);
    const only = plate(-100, 100, -50, 50, 10, 20);
    expect(boxFitScale(only.box, viewW, viewH)).toBeCloseTo(
      deriveCameraLimits([only], viewW, viewH).fitScale,
    );
    expect(limits.maxScale).toBeCloseTo(10);

    const out = applyCameraCommand(
      { x: 30, y: -10, scale: 8 },
      { type: 'zoomAt', x: 700, y: 40, factor: 1e-6 },
      viewW,
      viewH,
      limits,
    );
    expect(out.scale).toBeCloseTo(limits.minScale);
    expect(out.scale).toBeGreaterThan(MIN_SCALE);

    const into = applyCameraCommand(
      { x: 0, y: 0, scale: 4 },
      { type: 'zoomAt', x: 120, y: 90, factor: 100 },
      viewW,
      viewH,
      limits,
    );
    expect(into.scale).toBeCloseTo(limits.maxScale);
    expect(into.scale).toBeLessThan(MAX_SCALE);
  });

  it('reads a tiny object past its band, and never past the global clamp', () => {
    const deep = deriveCameraLimits([plate(0, 1e-6, 0, 1e-6, 2, 1e-6)], viewW, viewH);
    expect(READABLE_PX / 1e-6).toBeGreaterThan(MAX_SCALE);
    expect(deep.maxScale).toBe(MAX_SCALE);

    const capped = deriveCameraLimits([plate(-1, 1, -1, 1, 1e12, 10)], viewW, viewH);
    expect(capped.maxScale).toBe(MAX_SCALE);
    expect(capped.minScale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it('cannot pan the centre outside the bounds, and centres a small map', () => {
    const limits = deriveCameraLimits([plate(-100, 100, -80, 80, 20, 10)], viewW, viewH);
    const near = applyCameraCommand(
      { x: 0, y: 0, scale: 20 },
      { type: 'panBy', dx: -1e6, dy: 1e6 },
      viewW,
      viewH,
      limits,
    );
    expect(near.scale).toBe(20);
    expect(near.x).toBeCloseTo(limits.bounds!.right);
    expect(near.y).toBeCloseTo(limits.bounds!.top);
    expect(near.x).toBeLessThan(1e6);

    const tiny = applyCameraCommand(
      { x: 40, y: -20, scale: limits.minScale },
      { type: 'panBy', dx: 500, dy: -500 },
      viewW,
      viewH,
      limits,
    );
    expect(tiny.x).toBeCloseTo((limits.bounds!.left + limits.bounds!.right) / 2);
    expect(tiny.y).toBeCloseTo((limits.bounds!.top + limits.bounds!.bottom) / 2);
  });

  it('does not drift when zooming further at a scale limit', () => {
    const limits = deriveCameraLimits([plate(-100, 100, -80, 80, 8, 10)], viewW, viewH);
    let zoomed = applyCameraCommand(
      { x: 5, y: -4, scale: limits.maxScale },
      { type: 'panBy', dx: 0, dy: 0 },
      viewW,
      viewH,
      limits,
    );
    const atMax = { ...zoomed };
    for (let i = 0; i < 6; i += 1) {
      zoomed = applyCameraCommand(
        zoomed,
        { type: 'zoomAt', x: 12, y: 40, factor: 1.7 },
        viewW,
        viewH,
        limits,
      );
    }
    expect(zoomed).toEqual(atMax);

    let far = applyCameraCommand(
      { x: 12, y: -6, scale: 4 },
      { type: 'zoomAt', x: 700, y: 20, factor: 1e-9 },
      viewW,
      viewH,
      limits,
    );
    const atMin = { ...far };
    expect(atMin.scale).toBeCloseTo(limits.minScale);
    for (let i = 0; i < 6; i += 1) {
      far = applyCameraCommand(far, { type: 'zoomAt', x: 700, y: 20, factor: 0.3 }, viewW, viewH, limits);
    }
    expect(far.scale).toBeCloseTo(atMin.scale);
    expect(far.x).toBeCloseTo(atMin.x);
    expect(far.y).toBeCloseTo(atMin.y);
  });

  it('keeps the cursor pinned when a zoom lands on the scale limit', () => {
    const limits = deriveCameraLimits([plate(-5000, 5000, -5000, 5000, 4, 100)], viewW, viewH);
    const camera: Camera = { x: 0, y: 0, scale: 2 };
    const screenX = 100;
    const screenY = 80;
    const before = worldPoint(camera, screenX, screenY, viewW, viewH);
    const next = applyCameraCommand(
      camera,
      { type: 'zoomAt', x: screenX, y: screenY, factor: 10 },
      viewW,
      viewH,
      limits,
    );
    const after = worldPoint(next, screenX, screenY, viewW, viewH);
    expect(next.scale).toBeCloseTo(limits.maxScale);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('lets explicit limits replace any derived field', () => {
    const content = [plate(-100, 100, -50, 50, 10, 20)];
    const derived = deriveCameraLimits(content, viewW, viewH);
    const bounds: ViewBounds = { left: -10, right: 10, top: -8, bottom: 8 };
    const explicit = deriveCameraLimits(content, viewW, viewH, {
      minScale: 0.5,
      maxScale: 1.5,
      bounds,
    });
    expect(explicit).toEqual({ minScale: 0.5, maxScale: 1.5, fitScale: fitOf(bounds, viewW, viewH) * FIT_SLACK, bounds });
    expect(explicit.fitScale).not.toBeCloseTo(explicit.minScale);
    expect(explicit.minScale).not.toBeCloseTo(derived.minScale);
    expect(explicit.bounds).not.toEqual(derived.bounds);

    const onlyMax = deriveCameraLimits(content, viewW, viewH, { maxScale: 6 });
    expect(onlyMax.maxScale).toBeCloseTo(6);
    expect(onlyMax.minScale).toBeCloseTo(derived.minScale);
    expect(onlyMax.bounds).toEqual(derived.bounds);

    const ceiling = deriveCameraLimits(content, viewW, viewH, { maxScale: 1 });
    expect(ceiling.maxScale).toBeCloseTo(1);
    expect(ceiling.minScale).toBeCloseTo(1);

    const outer = deriveCameraLimits(content, viewW, viewH, { minScale: 1e-12, maxScale: 1e12 });
    expect(outer.minScale).toBe(MIN_SCALE);
    expect(outer.maxScale).toBe(MAX_SCALE);
  });

  it('does not let an animated zoom step overshoot the limits', () => {
    const limits = deriveCameraLimits([plate(-5000, 5000, -5000, 5000, 3, 1000)], viewW, viewH);
    expect(limits.maxScale).toBeCloseTo(3);
    const pressed = pressButtonZoom(createButtonZoom({ x: 1, y: 2, scale: 2 }), 4, viewW, viewH, 0, limits);
    expect(committedCamera(pressed).scale).toBeCloseTo(3);
    expect(committedCamera(pressed)).toMatchObject({ x: 1, y: 2 });
    const mid = tickButtonZoom(pressed, BUTTON_ZOOM_MS / 2).camera;
    expect(mid.scale).toBeGreaterThan(2);
    expect(mid.scale).toBeLessThan(3);
    expect(tickButtonZoom(pressed, BUTTON_ZOOM_MS).camera.scale).toBeCloseTo(3);

    const out = pressButtonZoom(
      createButtonZoom({ x: 0, y: 0, scale: limits.minScale * 1.5 }),
      0.01,
      viewW,
      viewH,
      0,
      limits,
    );
    expect(committedCamera(out).scale).toBeCloseTo(limits.minScale);
    const midOut = tickButtonZoom(out, BUTTON_ZOOM_MS / 2).camera;
    expect(midOut.scale).toBeGreaterThan(limits.minScale);
    expect(midOut.scale).toBeLessThan(limits.minScale * 1.5);
  });

  it('derives an empty atlas as the global clamp with no pan bounds', () => {
    expect(deriveCameraLimits([], viewW, viewH)).toEqual({
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      fitScale: MIN_SCALE,
    });
  });
});

function plate(
  left: number,
  right: number,
  top: number,
  bottom: number,
  maxScale: number,
  size: number,
): ContentBox {
  return { box: { left, right, top, bottom }, maxScale, size };
}

function fitOf(bounds: ViewBounds, width: number, height: number): number {
  return Math.min(width / (bounds.right - bounds.left), height / (bounds.bottom - bounds.top));
}

function text(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  maxScale: number,
  parentId?: string,
): CanvasObject {
  return {
    id,
    x,
    y,
    ...(parentId ? { parentId } : {}),
    visibility: { minScale: 0.01, maxScale },
    payload: { type: 'text', text: id, style: { fontSize: 10 }, width, height },
  };
}
