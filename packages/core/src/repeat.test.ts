import { describe, expect, it } from 'vitest';
import { frameOn } from './boot';
import type { CanvasObject, NodeRepeat } from './model';
import {
  MAX_REPEAT_COPIES,
  REPEAT_LOD_PX,
  copyIndexAt,
  copyLocalPosition,
  formatRepeatCount,
  gridMatchesCount,
  latticeBasis,
  latticeNeighbourDistance,
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

  it('multiplies the chain total by occupancy', () => {
    const node = shape('ion', 0, 0, 1, {
      repeat: { count: 4, occupancy: 0.25, pattern: { kind: 'grid', cols: 2, rows: 2, pitchX: 1, pitchY: 1 } },
    });
    expect(repeatTotal([node], 'ion')).toBe(1);
    expect(formatRepeatCount(1)).toBe('×1');
  });
});

describe('occupancy', () => {
  const pitch = 10;
  const repeat: NodeRepeat = {
    count: 16,
    occupancy: 0.5,
    seed: 4,
    pattern: { kind: 'grid', cols: 4, rows: 4, pitchX: pitch, pitchY: pitch },
  };

  function occupiedIndices(sample: NodeRepeat): number[] {
    const found: number[] = [];
    visibleCopies(sample, 0, 0, 4, 4, { left: -5, right: 40, top: -5, bottom: 40 }).forEach((copy) => {
      found.push(copy.index);
    });
    return found;
  }

  it('keeps the same subset for the same seed and drops the rest from hits', () => {
    const first = occupiedIndices(repeat);
    const again = occupiedIndices({ ...repeat, pattern: { ...repeat.pattern } });
    expect(again).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(16);
    const other = occupiedIndices({ ...repeat, seed: 5 });
    expect(other).not.toEqual(first);

    const present = first[0] ?? 0;
    const missing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((index) => !first.includes(index));
    expect(missing).toBeDefined();
    const at = copyLocalPosition(repeat, 0, 0, present);
    const gap = copyLocalPosition(repeat, 0, 0, missing ?? 0);
    expect(at).not.toBeNull();
    expect(gap).not.toBeNull();
    expect(copyIndexAt(repeat, 0, 0, 4, 4, at?.x ?? 0, at?.y ?? 0)).toBe(present);
    expect(copyIndexAt(repeat, 0, 0, 4, 4, gap?.x ?? 0, gap?.y ?? 0)).toBeNull();

    const cell = shape('cell', 0, 0, 4, { repeat });
    const store = createMemoryStore([cell]);
    expect(store.hitTest({ x: at?.x ?? 0, y: at?.y ?? 0 }, { x: 0, y: 0, scale: 1 })?.id).toBe('cell');
    expect(store.hitTest({ x: gap?.x ?? 0, y: gap?.y ?? 0 }, { x: 0, y: 0, scale: 1 })).toBeNull();

    const framed = frameOn([cell], 'cell', 100, 100, missing ?? 0);
    expect(samePoint(framed, gap)).toBe(false);
    expect(first.some((index) => samePoint(framed, copyLocalPosition(repeat, 0, 0, index)))).toBe(true);
  });

  it('skips empty rows as well as empty lattice sites', () => {
    const rows: NodeRepeat = {
      count: 6,
      occupancy: 0.5,
      seed: 9,
      pattern: { kind: 'rows', pitch: 8 },
    };
    const drawn: number[] = [];
    visibleCopies(rows, 0, 0, 2, 2, { left: -2, right: 4, top: -2, bottom: 50 }).forEach((copy) => drawn.push(copy.index));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(6);
    const absent = [0, 1, 2, 3, 4, 5].find((index) => !drawn.includes(index)) ?? 0;
    const spot = copyLocalPosition(rows, 0, 0, absent);
    expect(copyIndexAt(rows, 0, 0, 2, 2, spot?.x ?? 0, spot?.y ?? 0)).toBeNull();
  });
});

describe('lattice', () => {
  it('spaces honeycomb and diamond neighbours at the bond length', () => {
    expect(latticeBasis('honeycomb')).toBe(2);
    expect(latticeBasis('diamond')).toBe(4);
    expect(latticeBasis('hex')).toBe(1);
    expect(latticeBasis('square')).toBe(1);

    const bond = 0.142;
    const graphiteA = bond * Math.sqrt(3);
    expect(latticeNeighbourDistance('honeycomb', graphiteA)).toBeCloseTo(bond);
    const sheet: NodeRepeat = {
      count: 4,
      pattern: { kind: 'lattice', lattice: 'honeycomb', a: graphiteA, cols: 2, rows: 1 },
    };
    const origin = copyLocalPosition(sheet, 0, 0, 0);
    const partner = copyLocalPosition(sheet, 0, 0, 1);
    expect(origin).not.toBeNull();
    expect(partner).not.toBeNull();
    expect(Math.hypot((partner?.x ?? 0) - (origin?.x ?? 0), (partner?.y ?? 0) - (origin?.y ?? 0))).toBeCloseTo(bond);

    const siliconA = 0.543099;
    const siliconBond = latticeNeighbourDistance('diamond', siliconA);
    expect(siliconBond).toBeCloseTo((siliconA * Math.sqrt(3)) / 4);
    expect(siliconBond).toBeCloseTo(0.235, 2);
    const crystal: NodeRepeat = {
      count: 4,
      pattern: { kind: 'lattice', lattice: 'diamond', a: siliconA, cols: 1, rows: 1 },
    };
    const column = copyLocalPosition(crystal, 0, 0, 1);
    const neighbour = copyLocalPosition(crystal, 0, 0, 2);
    expect(column).not.toBeNull();
    expect(neighbour).not.toBeNull();
    expect(Math.hypot((neighbour?.x ?? 0) - (column?.x ?? 0), (neighbour?.y ?? 0) - (column?.y ?? 0))).toBeCloseTo(
      siliconBond,
    );

    const hex: NodeRepeat = {
      count: 2,
      pattern: { kind: 'lattice', lattice: 'hex', a: 1.5, cols: 2, rows: 1 },
    };
    const hex0 = copyLocalPosition(hex, 0, 0, 0);
    const hex1 = copyLocalPosition(hex, 0, 0, 1);
    expect(Math.hypot((hex1?.x ?? 0) - (hex0?.x ?? 0), (hex1?.y ?? 0) - (hex0?.y ?? 0))).toBeCloseTo(1.5);
  });

  it('visits only the lattice copies inside the view when the cell count is huge', () => {
    const repeat: NodeRepeat = {
      count: 2e10,
      pattern: { kind: 'lattice', lattice: 'honeycomb', a: 1, cols: 1e5, rows: 1e5 },
    };
    const started = performance.now();
    const visible = visibleCopies(repeat, 0, 0, 0.2, 0.2, { left: -0.2, right: 2.2, top: -0.2, bottom: 1.2 });
    const copies: number[] = [];
    visible.forEach((copy) => copies.push(copy.index));
    expect(performance.now() - started).toBeLessThan(50);
    expect(visible.capped).toBe(false);
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.length).toBeLessThan(40);
    for (const index of copies) {
      const at = copyLocalPosition(repeat, 0, 0, index);
      expect(at).not.toBeNull();
      expect(at?.x).toBeGreaterThan(-1);
      expect(at?.x).toBeLessThan(4);
    }

    const all = visibleCopies(repeat, 0, 0, 0.2, 0.2, { left: -1, right: 1e5, top: -1, bottom: 1e5 });
    let visited = 0;
    all.forEach(() => {
      visited += 1;
    });
    expect(all.capped).toBe(true);
    expect(visited).toBe(0);
    expect(all.count).toBeGreaterThan(MAX_REPEAT_COPIES);
  });

  it('does not hit or focus an unoccupied lattice site', () => {
    const repeat: NodeRepeat = {
      count: 8,
      occupancy: 0.5,
      seed: 3,
      pattern: { kind: 'lattice', lattice: 'honeycomb', a: 1, cols: 2, rows: 2 },
    };
    const drawn: number[] = [];
    visibleCopies(repeat, 0, 0, 0.2, 0.2, { left: -1, right: 4, top: -2, bottom: 2 }).forEach((copy) => {
      drawn.push(copy.index);
    });
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(8);
    const absent = [0, 1, 2, 3, 4, 5, 6, 7].find((index) => !drawn.includes(index)) ?? 0;
    const spot = copyLocalPosition(repeat, 0, 0, absent);
    expect(copyIndexAt(repeat, 0, 0, 0.2, 0.2, spot?.x ?? 0, spot?.y ?? 0)).toBeNull();
    const cell = shape('atom', 0, 0, 0.2, { repeat });
    const framed = frameOn([cell], 'atom', 80, 80, absent);
    expect(samePoint(framed, spot)).toBe(false);
    expect(drawn.some((index) => samePoint(framed, copyLocalPosition(repeat, 0, 0, index)))).toBe(true);
  });
});

function samePoint(
  camera: { x: number; y: number } | null | undefined,
  point: { x: number; y: number } | null | undefined,
): boolean {
  if (!camera || !point) return false;
  return Math.abs(camera.x - point.x) < 1e-9 && Math.abs(camera.y - point.y) < 1e-9;
}
