import { describe, expect, it } from 'vitest';
import { displayOpacity, relativeZoomAlpha, zoomRatio } from './fade';
import type { ZoomFade } from './model';

const fadeOut: ZoomFade = { fadeOut: [1, 2] };
const fadeIn: ZoomFade = { fadeIn: [1, 2] };

describe('relativeZoomAlpha', () => {
  it('fades the front out and the parts in across r = 1 to 2', () => {
    const samples: Array<[number, number, number]> = [
      [0.5, 1, 0],
      [1, 1, 0],
      [1.1, 0.9, 0.1],
      [1.2, 0.8, 0.2],
      [1.5, 0.5, 0.5],
      [2, 0, 1],
      [3, 0, 1],
    ];
    for (const [ratio, front, parts] of samples) {
      expect(relativeZoomAlpha(fadeOut, ratio)).toBeCloseTo(front);
      expect(relativeZoomAlpha(fadeIn, ratio)).toBeCloseTo(parts);
      expect(relativeZoomAlpha(fadeIn, ratio)).toBeCloseTo(1 - front);
    }
  });

  it('is fully shown when there is no fade or no fit scale', () => {
    expect(relativeZoomAlpha(undefined, 3)).toBe(1);
    expect(relativeZoomAlpha(fadeOut, undefined)).toBe(1);
    expect(zoomRatio(4, undefined)).toBeUndefined();
    expect(zoomRatio(4, 0)).toBeUndefined();
    expect(zoomRatio(4, 2)).toBe(2);
    expect(displayOpacity(0.4, fadeOut, 8, undefined)).toBe(0.4);
    expect(displayOpacity(0.4, undefined, 8, 4)).toBe(0.4);
  });

  it('ignores a range that does not increase', () => {
    expect(relativeZoomAlpha({ fadeOut: [2, 2] }, 3)).toBe(1);
    expect(relativeZoomAlpha({ fadeIn: [2, 1] }, 0.5)).toBe(1);
  });
});
