import { describe, expect, it } from 'vitest';
import { MAX_SCALE, panBy, retarget, worldPoint, zoomAt, type Camera } from './camera';

const viewW = 800;
const viewH = 600;

describe('camera', () => {
  it('maps the viewport center to the camera origin', () => {
    expect(worldPoint({ x: 5, y: 7, scale: 3 }, viewW / 2, viewH / 2, viewW, viewH)).toEqual({
      x: 5,
      y: 7,
    });
  });

  it('keeps the pointer anchored while zooming', () => {
    const camera: Camera = { x: 100, y: -50, scale: 2 };
    const screenX = 620;
    const screenY = 180;
    const before = worldPoint(camera, screenX, screenY, viewW, viewH);
    const next = zoomAt(camera, screenX, screenY, viewW, viewH, 3);
    const after = worldPoint(next, screenX, screenY, viewW, viewH);
    expect(next.scale).toBeCloseTo(6);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('pins the anchor world point to the target during a pinch pan', () => {
    const camera: Camera = { x: 0, y: 0, scale: 2 };
    const anchor = { x: 100, y: 120 };
    const target = { x: 340, y: 420 };
    const before = worldPoint(camera, anchor.x, anchor.y, viewW, viewH);
    const next = retarget(camera, anchor, target, viewW, viewH, 1.5);
    const after = worldPoint(next, target.x, target.y, viewW, viewH);
    expect(next.scale).toBeCloseTo(3);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps scale without leaving the pointer', () => {
    const camera: Camera = { x: 10, y: -4, scale: MAX_SCALE };
    const screenX = 100;
    const screenY = 80;
    const before = worldPoint(camera, screenX, screenY, viewW, viewH);
    const next = zoomAt(camera, screenX, screenY, viewW, viewH, 4);
    const after = worldPoint(next, screenX, screenY, viewW, viewH);
    expect(next.scale).toBe(MAX_SCALE);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('ignores a non-finite zoom factor', () => {
    const camera: Camera = { x: 1, y: 2, scale: 3 };
    expect(zoomAt(camera, 0, 0, viewW, viewH, Number.NaN)).toBe(camera);
  });

  it('pans in the direction of the drag', () => {
    const next = panBy({ x: 10, y: 20, scale: 2 }, 10, -6);
    expect(next.x).toBeCloseTo(5);
    expect(next.y).toBeCloseTo(23);
    expect(next.scale).toBe(2);
  });
});
