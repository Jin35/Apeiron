import { describe, expect, it } from 'vitest';
import {
  applyButtonZoomCommand,
  BUTTON_ZOOM_MS,
  cancelButtonZoom,
  committedCamera,
  createButtonZoom,
  pressButtonZoom,
  tickButtonZoom,
} from './buttonZoom';
import { MAX_SCALE, panBy, retarget, worldPoint, zoomAt, type Camera } from './camera';
import { ZOOM_STEP } from './gestures';

const viewW = 800;
const viewH = 600;

function press(state: ReturnType<typeof createButtonZoom>, factor: number, now: number) {
  return pressButtonZoom(state, factor, viewW, viewH, now);
}

function center(camera: Camera) {
  return worldPoint(camera, viewW / 2, viewH / 2, viewW, viewH);
}

describe('button zoom', () => {
  it('interpolates one 2× step toward the center over 150ms', () => {
    expect(BUTTON_ZOOM_MS).toBe(150);
    const origin: Camera = { x: 12, y: -4, scale: 1 };
    const pressed = press(createButtonZoom(origin), ZOOM_STEP, 0);
    expect(committedCamera(pressed)).toEqual({ x: 12, y: -4, scale: 2 });

    const start = tickButtonZoom(pressed, 0).camera;
    expect(start).toEqual(origin);
    expect(center(start)).toEqual({ x: 12, y: -4 });

    const mid = tickButtonZoom(pressed, BUTTON_ZOOM_MS / 2).camera;
    expect(mid.scale).toBeCloseTo(Math.sqrt(2));
    expect(center(mid)).toEqual(center(origin));

    const done = tickButtonZoom(pressed, BUTTON_ZOOM_MS);
    expect(done.segments).toEqual([]);
    expect(done.camera).toEqual({ x: 12, y: -4, scale: 2 });
    expect(center(done.camera)).toEqual(center(origin));
  });

  it('gives each queued click its own 150ms step and lands on 4×', () => {
    let zoom = createButtonZoom({ x: 0, y: 0, scale: 1 });
    zoom = press(zoom, ZOOM_STEP, 0);
    zoom = press(zoom, ZOOM_STEP, 0);
    expect(committedCamera(zoom).scale).toBe(4);
    expect(tickButtonZoom(zoom, BUTTON_ZOOM_MS - 1).camera.scale).toBeLessThan(2);
    expect(tickButtonZoom(zoom, BUTTON_ZOOM_MS).camera.scale).toBeCloseTo(2);
    const finished = tickButtonZoom(zoom, BUTTON_ZOOM_MS * 2);
    expect(finished.camera).toEqual({ x: 0, y: 0, scale: 4 });
    expect(finished.segments).toEqual([]);
  });

  it('steps from the committed target when a click lands mid-animation', () => {
    const once = press(createButtonZoom({ x: 1, y: 2, scale: 1 }), ZOOM_STEP, 0);
    const mid = tickButtonZoom(once, BUTTON_ZOOM_MS / 2);
    expect(mid.camera.scale).toBeCloseTo(Math.sqrt(2));
    const twice = press(mid, ZOOM_STEP, BUTTON_ZOOM_MS / 2);
    expect(twice.camera.scale).toBeCloseTo(Math.sqrt(2));
    expect(committedCamera(twice).scale).toBeCloseTo(4);
    expect(tickButtonZoom(twice, BUTTON_ZOOM_MS).camera.scale).toBeCloseTo(2);
    expect(tickButtonZoom(twice, BUTTON_ZOOM_MS * 2).camera.scale).toBeCloseTo(4);
    expect(tickButtonZoom(twice, BUTTON_ZOOM_MS * 2).camera).toMatchObject({ x: 1, y: 2 });
  });

  it('animates a clamped step to the limit and ignores another click', () => {
    // 5/8 of the limit: one 2× step still overshoots, and the next click is a no-op.
    const startScale = (MAX_SCALE * 5) / 8;
    const start = createButtonZoom({ x: 8, y: 9, scale: startScale });
    const once = press(start, ZOOM_STEP, 0);
    expect(committedCamera(once)).toEqual({ x: 8, y: 9, scale: MAX_SCALE });
    expect(press(once, ZOOM_STEP, 20)).toBe(once);
    const mid = tickButtonZoom(once, BUTTON_ZOOM_MS / 2).camera;
    expect(mid.scale).toBeCloseTo(Math.sqrt(startScale * MAX_SCALE));
    expect(center(mid)).toEqual({ x: 8, y: 9 });
    const done = tickButtonZoom(once, BUTTON_ZOOM_MS);
    expect(done.camera).toEqual({ x: 8, y: 9, scale: MAX_SCALE });
  });

  it('cancels to the scale on screen so a gesture keeps that scale', () => {
    const pressed = press(createButtonZoom({ x: 5, y: 6, scale: 2 }), 1 / ZOOM_STEP, 0);
    expect(committedCamera(pressed).scale).toBeCloseTo(1);
    const mid = tickButtonZoom(pressed, BUTTON_ZOOM_MS / 2);
    expect(mid.camera.scale).toBeCloseTo(Math.sqrt(2));
    const halted = cancelButtonZoom(mid);
    expect(halted.segments).toEqual([]);
    expect(halted.camera.x).toBeCloseTo(5);
    expect(halted.camera.y).toBeCloseTo(6);
    expect(halted.camera.scale).toBeCloseTo(Math.sqrt(2));
    expect(committedCamera(press(halted, ZOOM_STEP, BUTTON_ZOOM_MS / 2)).scale).toBeCloseTo(Math.sqrt(2) * 2);
  });

  it('catches up when a frame lands after queued steps', () => {
    let zoom = createButtonZoom({ x: 3, y: 4, scale: 1 });
    zoom = press(zoom, ZOOM_STEP, 0);
    zoom = press(zoom, 1 / ZOOM_STEP, 0);
    const landed = tickButtonZoom(zoom, 10_000);
    expect(landed.camera).toEqual({ x: 3, y: 4, scale: 1 });
    expect(landed.segments).toEqual([]);
  });

  it('ignores a non-finite factor', () => {
    const start = createButtonZoom({ x: 1, y: 1, scale: 2 });
    expect(press(start, Number.NaN, 0)).toBe(start);
  });
});

describe('applyButtonZoomCommand', () => {
  const origin: Camera = { x: 5, y: 6, scale: 2 };

  function midZoom() {
    const pressed = press(createButtonZoom(origin), 1 / ZOOM_STEP, 0);
    return tickButtonZoom(pressed, BUTTON_ZOOM_MS / 2);
  }

  it('matches panBy, zoomAt, and retarget on an idle camera and leaves no queue', () => {
    const state = createButtonZoom({ x: 10, y: 20, scale: 2 });
    const command = { type: 'panBy', dx: 10, dy: -6 } as const;
    const panned = applyButtonZoomCommand(state, command, 0, 0, 0);
    expect(panned.segments).toEqual([]);
    expect(panned.camera).toEqual(panBy(state.camera, 10, -6));
    expect(applyButtonZoomCommand(state, command, viewW, viewH, 0).camera).toEqual(panned.camera);

    const zoomed = applyButtonZoomCommand(
      state,
      { type: 'zoomAt', x: 620, y: 180, factor: 3 },
      viewW,
      viewH,
      0,
    );
    expect(zoomed.segments).toEqual([]);
    expect(zoomed.camera).toEqual(zoomAt(state.camera, 620, 180, viewW, viewH, 3));

    const anchor = { x: 100, y: 120 };
    const target = { x: 340, y: 420 };
    const moved = applyButtonZoomCommand(
      state,
      { type: 'retarget', anchor, target, factor: 1.5 },
      viewW,
      viewH,
      0,
    );
    expect(moved.segments).toEqual([]);
    expect(moved.camera).toEqual(retarget(state.camera, anchor, target, viewW, viewH, 1.5));
  });

  it('applies an immediate zoom to the scale on screen and drops the queue', () => {
    const mid = midZoom();
    expect(committedCamera(mid).scale).toBeCloseTo(1);
    expect(mid.camera.scale).toBeCloseTo(Math.sqrt(2));

    const halted = applyButtonZoomCommand(
      mid,
      { type: 'zoomAt', x: 100, y: 80, factor: 3 },
      viewW,
      viewH,
      BUTTON_ZOOM_MS / 2,
    );
    expect(halted.segments).toEqual([]);
    expect(halted.camera).toEqual(zoomAt(mid.camera, 100, 80, viewW, viewH, 3));
    expect(halted.camera.scale).toBeCloseTo(Math.sqrt(2) * 3);
    expect(committedCamera(halted)).toEqual(halted.camera);
  });

  it('pans the camera on screen when a gesture cancels the animation', () => {
    const mid = midZoom();
    const halted = applyButtonZoomCommand(
      mid,
      { type: 'panBy', dx: 8, dy: -4 },
      viewW,
      viewH,
      BUTTON_ZOOM_MS / 2,
    );
    expect(halted.segments).toEqual([]);
    expect(halted.camera).toEqual(panBy(mid.camera, 8, -4));
    expect(halted.camera.scale).toBeCloseTo(mid.camera.scale);
    expect(committedCamera(halted).scale).toBeCloseTo(Math.sqrt(2));
  });

  it('queues zoomStep from the committed camera instead of the in-between scale', () => {
    const once = press(createButtonZoom({ x: 1, y: 2, scale: 1 }), ZOOM_STEP, 0);
    const mid = tickButtonZoom(once, BUTTON_ZOOM_MS / 2);
    const twice = applyButtonZoomCommand(
      mid,
      { type: 'zoomStep', factor: ZOOM_STEP },
      viewW,
      viewH,
      BUTTON_ZOOM_MS / 2,
    );
    expect(twice).toEqual(press(mid, ZOOM_STEP, BUTTON_ZOOM_MS / 2));
    expect(twice.segments).toHaveLength(2);
    expect(twice.camera.scale).toBeCloseTo(Math.sqrt(2));
    expect(committedCamera(twice).scale).toBeCloseTo(4);
    expect(tickButtonZoom(twice, BUTTON_ZOOM_MS).camera.scale).toBeCloseTo(2);
    expect(tickButtonZoom(twice, BUTTON_ZOOM_MS * 2).camera.scale).toBeCloseTo(4);
  });

  it('settles zoomStep on the committed camera and drops the blend', () => {
    const mid = midZoom();
    const settled = applyButtonZoomCommand(
      mid,
      { type: 'zoomStep', factor: ZOOM_STEP },
      viewW,
      viewH,
      BUTTON_ZOOM_MS / 2,
      { settleZoomStep: true },
    );
    expect(settled.segments).toEqual([]);
    expect(settled.camera).toEqual(origin);

    const towardLimit = tickButtonZoom(
      press(createButtonZoom({ x: 1, y: 1, scale: MAX_SCALE / 2 }), ZOOM_STEP, 0),
      BUTTON_ZOOM_MS / 2,
    );
    const snapped = applyButtonZoomCommand(
      towardLimit,
      { type: 'zoomStep', factor: ZOOM_STEP },
      viewW,
      viewH,
      10,
      { settleZoomStep: true },
    );
    expect(snapped.segments).toEqual([]);
    expect(snapped.camera).toEqual({ x: 1, y: 1, scale: MAX_SCALE });
  });
});
