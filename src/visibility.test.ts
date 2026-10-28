import { describe, expect, it } from 'vitest';
import { visibilityAlpha } from './visibility';

const range = { minScale: 1, maxScale: 16 };

describe('visibilityAlpha', () => {
  it('hides objects outside the range', () => {
    expect(visibilityAlpha(range, 0.5)).toBe(0);
    expect(visibilityAlpha(range, 32)).toBe(0);
    expect(visibilityAlpha(range, 0)).toBe(0);
  });

  it('is fully visible around the middle of a wide range', () => {
    expect(visibilityAlpha(range, 4)).toBe(1);
  });

  it('fades just inside each edge', () => {
    const nearMin = visibilityAlpha(range, 1.05);
    const nearMax = visibilityAlpha(range, 15.4);
    expect(nearMin).toBeGreaterThan(0);
    expect(nearMin).toBeLessThan(1);
    expect(nearMax).toBeGreaterThan(0);
    expect(nearMax).toBeLessThan(1);
  });

  it('rejects an inverted range', () => {
    expect(visibilityAlpha({ minScale: 4, maxScale: 1 }, 2)).toBe(0);
  });
});
