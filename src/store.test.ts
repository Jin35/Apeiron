import { describe, expect, it } from 'vitest';
import type { ViewBounds } from './camera';
import type { CanvasObject, VisibilityRange } from './model';
import { createMemoryStore } from './store';
import { visibilityAlpha } from './visibility';

const wide: VisibilityRange = { minScale: 1, maxScale: 16 };

const nowhere: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 };
const nearby: ViewBounds = { left: -10, right: 10, top: -10, bottom: 10 };
const farAway: ViewBounds = { left: 1e9, right: 1e9 + 1, top: 1e9, bottom: 1e9 + 1 };

function textObject(id: string, visibility: VisibilityRange, x = 0): CanvasObject {
  return {
    id,
    x,
    y: 0,
    visibility,
    payload: { type: 'text', text: id, style: { fontSize: 12, color: '#fff' } },
  };
}

function imageObject(id: string, src: string): CanvasObject {
  return {
    id,
    x: 0,
    y: 0,
    visibility: wide,
    payload: { type: 'image', src, width: 10, height: 10 },
  };
}

/** Scale inside the fade-in of `wide`, where alpha tracks this fraction. */
function fadeInScale(fraction: number): number {
  return wide.minScale * 1.35 ** fraction;
}

describe('createMemoryStore', () => {
  it('counts every object above the HUD cutoff, including ones outside the view', () => {
    const near = textObject('near', wide, 0);
    const far = textObject('far', wide, 1_000_000);
    const hidden = textObject('hidden', { minScale: 100, maxScale: 200 });
    const store = createMemoryStore([near, far, hidden]);

    expect(visibilityAlpha(wide, 4)).toBe(1);
    expect(store.countInBand(4)).toBe(2);
    expect(store.countInBand(0.5)).toBe(0);
  });

  it('uses a stricter cutoff for the HUD than for query', () => {
    const object = textObject('fade', wide);
    const store = createMemoryStore([object]);

    const aboveHud = fadeInScale(0.03);
    expect(visibilityAlpha(wide, aboveHud)).toBeGreaterThan(0.02);
    expect(store.countInBand(aboveHud)).toBe(1);
    expect(store.query({ bounds: nowhere, scale: aboveHud })).toEqual([
      { object, alpha: visibilityAlpha(wide, aboveHud) },
    ]);

    const between = fadeInScale(0.015);
    const betweenAlpha = visibilityAlpha(wide, between);
    expect(betweenAlpha).toBeGreaterThan(0.01);
    expect(betweenAlpha).toBeLessThanOrEqual(0.02);
    expect(store.countInBand(between)).toBe(0);
    expect(store.query({ bounds: nowhere, scale: between })).toEqual([
      { object, alpha: betweenAlpha },
    ]);

    const belowDraw = fadeInScale(0.005);
    expect(visibilityAlpha(wide, belowDraw)).toBeGreaterThan(0);
    expect(visibilityAlpha(wide, belowDraw)).toBeLessThanOrEqual(0.01);
    expect(store.countInBand(belowDraw)).toBe(0);
    expect(store.query({ bounds: nowhere, scale: belowDraw })).toEqual([]);
  });

  it('ignores query bounds', () => {
    const object = textObject('placed', wide, 1_000_000);
    const store = createMemoryStore([object]);
    const scale = 4;
    const expected = [{ object, alpha: 1 }];

    expect(store.query({ bounds: nearby, scale })).toEqual(expected);
    expect(store.query({ bounds: farAway, scale })).toEqual(expected);
    expect(store.query({ bounds: nowhere, scale })).toEqual(expected);
  });

  it('returns an empty result for an empty list', () => {
    const store = createMemoryStore([]);
    expect(store.countInBand(4)).toBe(0);
    expect(store.query({ bounds: nearby, scale: 4 })).toEqual([]);
    expect(store.imageSources()).toEqual([]);
  });

  it('lists every image src in dataset order and skips text', () => {
    const store = createMemoryStore([
      imageObject('compass', 'images/compass.svg'),
      textObject('label', wide),
      imageObject('buoy', 'images/buoy.svg'),
      imageObject('compass-again', 'images/compass.svg'),
    ]);

    expect(store.imageSources()).toEqual([
      'images/compass.svg',
      'images/buoy.svg',
      'images/compass.svg',
    ]);
    expect(createMemoryStore([textObject('only-text', wide)]).imageSources()).toEqual([]);
  });
});
