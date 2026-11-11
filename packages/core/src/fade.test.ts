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

  it('fades across r = 1 to 1.6, the width of a 0.625 scale', () => {
    const end = 1 / 0.625;
    const out: ZoomFade = { fadeOut: [1, end] };
    const inn: ZoomFade = { fadeIn: [1, end] };
    const front = (ratio: number) => Math.min(1, Math.max(0, 1 - (ratio - 1) / (end - 1)));
    for (const ratio of [0.5, 1, 1.3, 1.6, 2.5]) {
      expect(relativeZoomAlpha(out, ratio)).toBeCloseTo(front(ratio));
      expect(relativeZoomAlpha(inn, ratio)).toBeCloseTo(1 - front(ratio));
    }
    expect(front(1)).toBe(1);
    expect(front(1.3)).toBeCloseTo(0.5);
    expect(front(1.6)).toBeCloseTo(0);
    expect(front(2.5)).toBe(0);
  });

  it('ignores a range that does not increase', () => {
    expect(relativeZoomAlpha({ fadeOut: [2, 2] }, 3)).toBe(1);
    expect(relativeZoomAlpha({ fadeIn: [2, 1] }, 0.5)).toBe(1);
  });

  it('uses an anchor fit for the named range and leaves the other on s0', () => {
    const anchor = (id: string) => (id === 'battery' ? 10 : undefined);
    const out: ZoomFade = { fadeOut: [1, 1.6], fadeOutOf: 'battery' };
    expect(displayOpacity(1, out, 10, 4, anchor)).toBe(1);
    expect(displayOpacity(1, out, 13, 4, anchor)).toBeCloseTo(0.5);
    expect(displayOpacity(1, out, 16, 4, anchor)).toBe(0);
    // The opening fit would already have finished this fade. The anchor has not.
    expect(displayOpacity(1, out, 8, 4, anchor)).toBe(1);
    // No resolver: the named range is not applied.
    expect(displayOpacity(1, out, 16, 4)).toBe(1);

    const both: ZoomFade = { fadeIn: [1, 1.6], fadeOut: [1, 1.6], fadeOutOf: 'battery' };
    expect(displayOpacity(1, both, 4, 4, anchor)).toBe(0);
    expect(displayOpacity(1, both, 6.4, 4, anchor)).toBeCloseTo(1);
    expect(displayOpacity(0.4, both, 6.4, 4, anchor)).toBeCloseTo(0.4);
    expect(displayOpacity(1, both, 16, 4, anchor)).toBe(0);
  });
});
