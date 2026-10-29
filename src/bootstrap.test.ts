import { describe, expect, it } from 'vitest';
import { cameraFromLocation, initialCamera, initialCameraFor } from './bootstrap';
import { MAX_SCALE, MIN_SCALE } from './camera';

describe('opening camera', () => {
  it('keeps the desktop view and zooms out so the title fits on a narrow viewport', () => {
    const title = 6300;
    expect(initialCameraFor(1440, title)).toEqual(initialCamera);
    expect(initialCameraFor(0, title)).toEqual(initialCamera);
    const phone = initialCameraFor(390, title);
    expect(phone).toMatchObject({ x: initialCamera.x, y: initialCamera.y });
    expect(phone.scale).toBeLessThan(0.06);
    expect(phone.scale * title).toBeLessThan(360);
    expect(initialCameraFor(200, title).scale).toBe(0.04);
  });

  it('fits the scale to the title width it is given', () => {
    const phone = initialCameraFor(390, 6300);
    const wider = initialCameraFor(390, 7000);
    expect(wider.scale).toBeLessThan(phone.scale);
    expect(wider.scale).toBeCloseTo((390 * 0.86) / 7000);
    expect(wider).toMatchObject({ x: initialCamera.x, y: initialCamera.y });

    const desktop = initialCameraFor(1440, 20000);
    expect(desktop.scale).toBeLessThan(initialCamera.scale);
    expect(desktop.scale).toBeCloseTo((1440 * 0.86) / 20000);
  });

  it('opens on the query string and clamps scale the same way as zoom', () => {
    const fallback = initialCameraFor(1440, 6300);
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
