import { createMemoryStore, deriveCameraLimits, MAX_SCALE, MIN_SCALE, viewBounds, visibilityAlpha } from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { demoObjects, demoPack, titleFitWidth } from './demo';
import { darkTheme } from './theme';

function visibleAt(scale: number) {
  return demoObjects.filter((object) => visibilityAlpha(object.visibility, scale) > 0);
}

describe('demo atlas', () => {
  it('has unique ids, open ranges, and both kinds of objects', () => {
    const ids = demoObjects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(demoObjects.some((object) => object.payload.type === 'text')).toBe(true);
    expect(demoObjects.some((object) => object.payload.type === 'image')).toBe(true);
    expect(titleFitWidth).toBe(6300);
    expect(demoPack.theme).toBe(darkTheme);
    expect(demoPack.objects).toBe(demoObjects);
    const title = demoObjects.find((object) => object.id === 'overview-title');
    expect(title?.payload.type === 'text' && title.payload.width).toBeGreaterThan(titleFitWidth);
    for (const object of demoObjects) {
      expect(object.visibility.minScale).toBeLessThan(object.visibility.maxScale);
      expect(Number.isFinite(object.x)).toBe(true);
      expect(Number.isFinite(object.y)).toBe(true);
      expect(object.parentId).toBeUndefined();
      if (object.payload.type === 'text') {
        expect(object.payload.width).toBeGreaterThan(0);
        expect(object.payload.height).toBeGreaterThan(0);
      }
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

  it('keeps the opening scale inside the fit and the readable depth', () => {
    const limits = deriveCameraLimits(createMemoryStore(demoObjects).contentBoxes(), 800, 600);
    expect(limits.minScale).toBeLessThanOrEqual(0.1);
    expect(limits.minScale).toBeGreaterThan(MIN_SCALE);
    expect(limits.maxScale).toBeGreaterThanOrEqual(0.1);
    expect(limits.maxScale).toBeLessThan(MAX_SCALE);
    expect(limits.bounds).toBeDefined();
  });

  it('sends fewer atlas objects to the renderer than the band contains', () => {
    const store = createMemoryStore(demoObjects);
    const scale = 1;
    const bounds = viewBounds({ x: 0, y: -80, scale }, 1280, 720);
    const visible = store.query({ bounds, scale });
    const band = store.countInBand(scale);
    const idsInView = visible.map((entry) => entry.object.id);

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(band);
    expect(idsInView).toContain('region-compass');
    expect(idsInView).not.toContain('region-dune');
    expect(idsInView).not.toContain('detail-bollard');
  });

  it('shows the title at the desktop opening scale and a different set when zoomed in', () => {
    const far = visibleAt(0.1);
    const near = visibleAt(16);
    expect(far.map((object) => object.id)).toContain('overview-title');
    expect(near.map((object) => object.id)).toContain('detail-buoy');
    const farIds = new Set(far.map((object) => object.id));
    expect(near.every((object) => !farIds.has(object.id))).toBe(true);
  });
});
