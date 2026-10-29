import { describe, expect, it } from 'vitest';
import { cameraFromLocation, initialCamera, initialCameraFor } from './bootstrap';
import { MAX_SCALE, MIN_SCALE } from './camera';

describe('opening camera', () => {
  it('keeps the desktop view and zooms out so the title fits on a narrow viewport', () => {
    expect(initialCameraFor(1440)).toEqual(initialCamera);
    expect(initialCameraFor(0)).toEqual(initialCamera);
    const phone = initialCameraFor(390);
    expect(phone).toMatchObject({ x: initialCamera.x, y: initialCamera.y });
    expect(phone.scale).toBeLessThan(0.06);
    expect(phone.scale * 6300).toBeLessThan(360);
    expect(initialCameraFor(200).scale).toBe(0.04);
  });

  it('opens on the query string and clamps scale the same way as zoom', () => {
    const fallback = initialCameraFor(1440);
    expect(cameraFromLocation(fallback, '')).toEqual(fallback);
    expect(cameraFromLocation(fallback, '?scale=0&x=1&y=2')).toEqual(fallback);
    expect(cameraFromLocation(fallback, '?scale=nope')).toEqual(fallback);

    expect(cameraFromLocation(fallback, '?scale=2&x=-3012&y=-1112')).toEqual({
      x: -3012,
      y: -1112,
      scale: 2,
    });
    // An omitted coordinate is 0, which is what Number(null) produced before this move.
    expect(cameraFromLocation(fallback, '?scale=2')).toEqual({ x: 0, y: 0, scale: 2 });
    expect(cameraFromLocation(fallback, '?scale=2&x=-3012')).toEqual({ x: -3012, y: 0, scale: 2 });
    expect(cameraFromLocation(fallback, '?scale=2&x=foo&y=bar')).toEqual({
      x: fallback.x,
      y: fallback.y,
      scale: 2,
    });
    expect(cameraFromLocation(fallback, '?scale=1000&x=1&y=2')).toEqual({ x: 1, y: 2, scale: 1000 });
    expect(cameraFromLocation(fallback, '?scale=0.001&x=1&y=2')).toEqual({
      x: 1,
      y: 2,
      scale: 0.001,
    });
    expect(cameraFromLocation(fallback, '?scale=1e8&x=1&y=2').scale).toBe(MAX_SCALE);
    expect(cameraFromLocation(fallback, '?scale=1e-8&x=1&y=2').scale).toBe(MIN_SCALE);
  });
});
