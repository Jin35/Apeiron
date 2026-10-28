import { describe, expect, it } from 'vitest';
import { gridStep } from './grid';

describe('gridStep', () => {
  it('keeps line spacing in a readable pixel band', () => {
    for (const scale of [0.02, 0.1, 0.5, 1, 3, 12, 40]) {
      const px = gridStep(scale) * scale;
      expect(px).toBeGreaterThanOrEqual(48);
      expect(px).toBeLessThanOrEqual(150);
    }
  });
});
