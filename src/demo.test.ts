import { describe, expect, it } from 'vitest';
import { demoObjects, initialCamera, initialCameraFor } from './demo';
import { visibilityAlpha } from './visibility';

function visibleAt(scale: number) {
  return demoObjects.filter((object) => visibilityAlpha(object.visibility, scale) > 0);
}

describe('demo atlas', () => {
  it('has unique ids, open ranges, and both kinds of objects', () => {
    const ids = demoObjects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(demoObjects.some((object) => object.payload.type === 'text')).toBe(true);
    expect(demoObjects.some((object) => object.payload.type === 'image')).toBe(true);
    for (const object of demoObjects) {
      expect(object.visibility.minScale).toBeLessThan(object.visibility.maxScale);
      expect(Number.isFinite(object.x)).toBe(true);
      expect(Number.isFinite(object.y)).toBe(true);
    }
  });

  it('uses more than one image depth', () => {
    const scales = new Set(
      demoObjects
        .filter((object) => object.payload.type === 'image')
        .map((object) => object.visibility.minScale),
    );
    expect(scales.size).toBeGreaterThan(1);
  });

  it('fits the opening title on a narrow viewport', () => {
    expect(initialCameraFor(1440).scale).toBeCloseTo(initialCamera.scale);
    const phone = initialCameraFor(390);
    expect(phone.scale).toBeLessThan(0.06);
    expect(phone.scale * 6300).toBeLessThan(360);
  });

  it('shows a different set when zoomed in', () => {
    const far = visibleAt(initialCamera.scale);
    const near = visibleAt(16);
    expect(far.length).toBeGreaterThan(0);
    expect(near.length).toBeGreaterThan(0);
    const farIds = new Set(far.map((object) => object.id));
    expect(near.every((object) => !farIds.has(object.id))).toBe(true);
  });
});
