import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorldRect } from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { smartphoneObjects } from './smartphone';

type Rect = { x: number; y: number; width: number; height: number } | null;

const snapshot = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'smartphone-world-rects.json'), 'utf8'),
) as Record<string, Rect>;

describe('smartphone world rects', () => {
  it('matches the rects recorded on main before the split', () => {
    expect(Object.keys(snapshot).sort()).toEqual(smartphoneObjects.map((object) => object.id).sort());
    for (const object of smartphoneObjects) {
      expect(resolveWorldRect(smartphoneObjects, object.id), object.id).toEqual(snapshot[object.id]);
    }
  });
});
