import { describe, expect, it } from 'vitest';
import { cameraFromLocation, initialCamera, initialCameraFor } from './bootstrap';
import { MAX_SCALE, MIN_SCALE } from './camera';
import type { TitleFitPose } from './theme';

const atlasPose: TitleFitPose = { x: 0, y: -80, scale: 0.1 };

describe('opening camera', () => {
  it('opens at the origin and scale 1 unless a pose says otherwise', () => {
    expect(initialCamera).toEqual({ x: 0, y: 0, scale: 1 });
    expect(initialCameraFor(1440, 100)).toEqual(initialCamera);
    const wide = initialCameraFor(1440, 20000);
    expect(wide).toEqual({ x: 0, y: 0, scale: (1440 * 0.86) / 20000 });
    expect(initialCameraFor(200, 20000).scale).toBe(0.04);
  });

  it('keeps a caller pose on desktop and zooms out so the title fits on a narrow viewport', () => {
    const title = 6300;
    expect(initialCameraFor(1440, title, atlasPose)).toEqual(atlasPose);
    expect(initialCameraFor(0, title, atlasPose)).toEqual(atlasPose);
    const narrow = initialCameraFor(390, title, atlasPose);
    expect(narrow).toMatchObject({ x: atlasPose.x, y: atlasPose.y });
    expect(narrow.scale).toBeLessThan(0.06);
    expect(narrow.scale * title).toBeLessThan(360);
    expect(initialCameraFor(200, title, atlasPose).scale).toBe(0.04);
  });

  it('fits the scale to the title width it is given', () => {
    const narrow = initialCameraFor(390, 6300, atlasPose);
    const wider = initialCameraFor(390, 7000, atlasPose);
    expect(wider.scale).toBeLessThan(narrow.scale);
    expect(wider.scale).toBeCloseTo((390 * 0.86) / 7000);
    expect(wider).toMatchObject({ x: atlasPose.x, y: atlasPose.y });

    const desktop = initialCameraFor(1440, 20000, atlasPose);
    expect(desktop.scale).toBeLessThan(atlasPose.scale);
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
    expect(cameraFromLocation(fallback, '?scale=1e8&x=1&y=2').scale).toBe(1e8);
    expect(cameraFromLocation(fallback, '?scale=1e13&x=1&y=2').scale).toBe(MAX_SCALE);
    expect(cameraFromLocation(fallback, '?scale=1e-8&x=1&y=2').scale).toBe(MIN_SCALE);
  });
});
