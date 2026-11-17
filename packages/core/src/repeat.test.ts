import { describe, expect, it } from 'vitest';
import { frameOn } from './boot';
import type { CanvasObject } from './model';
import {
  MAX_REPEAT_COPIES,
  REPEAT_LOD_PX,
  copyIndexAt,
  copyLocalPosition,
  formatRepeatCount,
  gridMatchesCount,
  repeatDetail,
  repeatTotal,
  visibleCopies,
} from './repeat';
import { createMemoryStore } from './store';

const band = { minScale: 0.01, maxScale: 100 };

function shape(
  id: string,
  x: number,
  y: number,
  width: number,
  extras?: Partial<CanvasObject>,
): CanvasObject {
  return {
    id,
    x,
    y,
    visibility: band,
    payload: { type: 'shape', kind: 'part', width, height: width },
    ...extras,
  };
}

const grid = {
  count: 12,
  pattern: { kind: 'grid' as const, cols: 4, rows: 3, pitchX: 10, pitchY: 10 },
};

describe('visible copies', () => {
  it('returns the grid index window and nothing outside it', () => {
    const visible = visibleCopies(grid, 0, 0, 4, 4, { left: -1, right: 21, top: -1, bottom: 11 });
    const copies: { index: number; x: number; y: number }[] = [];
    visible.forEach((copy) => copies.push(copy));
    expect(visible.capped).toBe(false);
    expect(copies.map((copy) => copy.index)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(copies.every((copy) => copy.x === (copy.index % 4) * 10 && copy.y === Math.floor(copy.index / 4) * 10)).toBe(
      true,
    );
    expect(gridMatchesCount(grid.pattern, grid.count)).toBe(true);
  });

  it('places scatter points from the seed, and a different seed moves them', () => {
    const region = { x: 5, y: 5, width: 10, height: 10 };
    const base = {
      count: 40,
      pattern: { kind: 'scatter' as const, seed: 7, density: 0.4 },
      region,
    };
    const again = { ...base, pattern: { ...base.pattern } };
    const other = { ...base, pattern: { kind: 'scatter' as const, seed: 8, density: 0.4 } };
    const view = { left: 0, right: 10, top: 0, bottom: 10 };
    const collect = (repeat: typeof base) => {
      const found: { index: number; x: number; y: number }[] = [];
      visibleCopies(repeat, 0, 0, 0.2, 0.2, view).forEach((copy) => found.push(copy));
      return found;
    };
    const first = collect(base);
    expect(first.length).toBeGreaterThan(0);
    expect(collect(again)).toEqual(first);
    expect(collect(other)).not.toEqual(first);
  });

  it('visits only the visible copies when count is 1e10', () => {
    const repeat = {
      count: 1e10,
      pattern: { kind: 'grid' as const, cols: 1e5, rows: 1e5, pitchX: 1, pitchY: 1 },
    };
    expect(gridMatchesCount(repeat.pattern, repeat.count)).toBe(true);
    const started = performance.now();
    const visible = visibleCopies(repeat, 0, 0, 0.4, 0.4, { left: -0.2, right: 2.2, top: -0.2, bottom: 1.2 });
    const copies: number[] = [];
    visible.forEach((copy) => copies.push(copy.index));
    expect(performance.now() - started).toBeLessThan(50);
    expect(visible.capped).toBe(false);
    expect(copies).toEqual([0, 1, 2, 1e5, 1e5 + 1, 1e5 + 2]);
    expect(copies.length).toBeLessThan(20);

    const all = visibleCopies(repeat, 0, 0, 0.4, 0.4, { left: -1, right: 1e5, top: -1, bottom: 1e5 });
    let visited = 0;
    all.forEach(() => {
      visited += 1;
    });
    expect(all.count).toBe(1e10);
    expect(all.capped).toBe(true);
    expect(visited).toBe(0);
    expect(all.count).toBeGreaterThan(MAX_REPEAT_COPIES);
  });
});

describe('hit test copy index', () => {
  it('resolves a grid copy from the inverse pitch and misses the gap', () => {
    expect(copyIndexAt(grid, 0, 0, 4, 4, 20, 10)).toBe(1 * 4 + 2);
    expect(copyLocalPosition(grid, 0, 0, 6)).toEqual({ x: 20, y: 10 });
    expect(copyIndexAt(grid, 0, 0, 4, 4, 5, 0)).toBeNull();
  });

  it('hits the store object for that copy and not the gap', () => {
    const cell = shape('cell', 0, 0, 4, { repeat: grid });
    const store = createMemoryStore([cell]);
    expect(store.hitTest({ x: 20, y: 10 }, { x: 0, y: 0, scale: 1 })?.id).toBe('cell');
    expect(store.hitTest({ x: 5, y: 0 }, { x: 0, y: 0, scale: 1 })).toBeNull();
  });
});

describe('repeat detail', () => {
  it('fills below ~3px and when the visible window is over the cap', () => {
    expect(REPEAT_LOD_PX).toBe(3);
    expect(repeatDetail(2.9, { count: 4, capped: false })).toBe('fill');
    expect(repeatDetail(3, { count: 4, capped: false })).toBe('copies');
    expect(repeatDetail(40, { count: MAX_REPEAT_COPIES + 1, capped: true })).toBe('fill');
  });
});

describe('chain total', () => {
  it('multiplies per-parent counts and leaves a lone count unchanged', () => {
    const parent = shape('tile', 0, 0, 10, {
      repeat: { count: 100, pattern: { kind: 'grid', cols: 10, rows: 10, pitchX: 1, pitchY: 1 } },
    });
    const child = shape('device', 1, 0, 1, {
      parentId: 'tile',
      repeat: { count: 4, pattern: { kind: 'grid', cols: 2, rows: 2, pitchX: 0.4, pitchY: 0.4 } },
    });
    expect(repeatTotal([parent, child], 'device')).toBe(400);
    expect(formatRepeatCount(400)).toBe('×400');
    expect(formatRepeatCount(1.5e10)).toBe('×~15 billion');
    expect(repeatTotal([child], 'device')).toBe(4);
    expect(formatRepeatCount(4)).toBe('×4');
  });

  it('opens children inside the focused copy and frames that copy from &i=', () => {
    const parent = shape('cell', 0, 0, 30, {
      repeat: { count: 4, pattern: { kind: 'grid', cols: 2, rows: 2, pitchX: 20, pitchY: 20 } },
    });
    const child = shape('gate', 2, 0, 2, { parentId: 'cell' });
    const store = createMemoryStore([parent, child]);
    const focus = { x: 20, y: 0, lock: { id: 'cell', index: 1 } };
    const shown = store.query({
      bounds: { left: -10, right: 80, top: -10, bottom: 40 },
      scale: 1,
      repeatFocus: focus,
    });
    expect(shown.find((entry) => entry.object.id === 'gate')?.object.x).toBeCloseTo(22);
    expect(shown.find((entry) => entry.object.id === 'cell')?.object.x).toBeCloseTo(0);

    const copy0 = frameOn([parent], 'cell', 100, 100, 0);
    const copy1 = frameOn([parent], 'cell', 100, 100, 1);
    expect(copy0?.x).toBeCloseTo(0);
    expect(copy1?.x).toBeCloseTo(20);
    expect(copy1?.y).toBeCloseTo(0);
  });
});
