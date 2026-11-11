import { describe, expect, it } from 'vitest';
import { clipLeaderLine, resolveWorldRect, type AxisRect } from './link';
import type { CanvasObject, VisibilityRange } from './model';
import { createMemoryStore } from './store';

const band: VisibilityRange = { minScale: 0.01, maxScale: 10000 };

describe('clipLeaderLine', () => {
  it('clips a horizontal segment to the facing edges', () => {
    const from: AxisRect = { x: 0, y: 0, width: 10, height: 6 };
    const to: AxisRect = { x: 30, y: 0, width: 10, height: 8 };

    expect(clipLeaderLine(from, to, 0)).toEqual({ x1: 5, y1: 0, x2: 25, y2: 0 });
  });

  it('shortens both ends by the gap, in the same units as the rectangles', () => {
    const from: AxisRect = { x: 0, y: 0, width: 10, height: 6 };
    const to: AxisRect = { x: 30, y: 0, width: 10, height: 8 };
    const gapped = clipLeaderLine(from, to, 4);

    expect(gapped?.x1).toBeCloseTo(9);
    expect(gapped?.y1).toBeCloseTo(0);
    expect(gapped?.x2).toBeCloseTo(21);
    expect(gapped?.y2).toBeCloseTo(0);
    expect(gapped && Math.hypot(gapped.x1 - 5, gapped.y1)).toBeCloseTo(4);
    expect(gapped && Math.hypot(25 - gapped.x2, gapped.y2)).toBeCloseTo(4);
  });

  it('clips a diagonal to the edges and applies the gap along the segment', () => {
    const from: AxisRect = { x: 0, y: 0, width: 4, height: 4 };
    const to: AxisRect = { x: 8, y: 6, width: 4, height: 4 };

    // Centres are 8 across and 6 down (length 10). Each box exits at t = 0.25,
    // so the edges are (2, 1.5) and (6, 4.5).
    expect(clipLeaderLine(from, to, 0)).toEqual({ x1: 2, y1: 1.5, x2: 6, y2: 4.5 });

    const gapped = clipLeaderLine(from, to, 1);
    expect(gapped?.x1).toBeCloseTo(2.8);
    expect(gapped?.y1).toBeCloseTo(2.1);
    expect(gapped?.x2).toBeCloseTo(5.2);
    expect(gapped?.y2).toBeCloseTo(3.9);
    expect(gapped && Math.hypot(gapped.x1 - 2, gapped.y1 - 1.5)).toBeCloseTo(1);
    expect(gapped && Math.hypot(6 - gapped.x2, 4.5 - gapped.y2)).toBeCloseTo(1);
  });

  it('draws nothing when the rectangles overlap, even off the centre line', () => {
    expect(
      clipLeaderLine({ x: 0, y: 0, width: 10, height: 10 }, { x: 8, y: 0, width: 10, height: 10 }, 0),
    ).toBeNull();
    // Corner overlap. The centre segment would still have a gap; the bounds do not.
    expect(
      clipLeaderLine({ x: 0, y: 0, width: 10, height: 2 }, { x: 3, y: 3, width: 2, height: 10 }, 0),
    ).toBeNull();
    expect(
      clipLeaderLine({ x: 0, y: 0, width: 20, height: 20 }, { x: 1, y: 1, width: 4, height: 4 }, 4),
    ).toBeNull();
  });

  it('draws nothing when the gap consumes the span or the centres coincide', () => {
    const from: AxisRect = { x: 0, y: 0, width: 10, height: 10 };
    const to: AxisRect = { x: 20, y: 0, width: 10, height: 10 };
    // Facing edges are 10 apart. A gap of 6 on each end leaves nothing.
    expect(clipLeaderLine(from, to, 6)).toBeNull();
    expect(clipLeaderLine(from, { ...from }, 0)).toBeNull();
    expect(clipLeaderLine({ x: 0, y: 0, width: 0, height: 4 }, to, 0)).toBeNull();
  });
});

describe('resolveWorldRect', () => {
  it('resolves a child through parentId and a group scale', () => {
    const phone = image('phone', 0, 0, 70, 140);
    const internals: CanvasObject = {
      id: 'internals',
      parentId: 'phone',
      x: 0,
      y: 0,
      scale: 0.625,
      visibility: band,
      payload: { type: 'group' },
    };
    const battery = withParent(image('battery', -9.8, 16.6, 40, 80), 'internals');
    const label = withParent(text('battery-label', -69, 16.6, 14, 4.2), 'internals');
    const objects = [internals, battery, label, phone];

    expect(resolveWorldRect(objects, 'battery')).toEqual({
      x: -9.8 * 0.625,
      y: 16.6 * 0.625,
      width: 40 * 0.625,
      height: 80 * 0.625,
    });
    expect(resolveWorldRect(objects, 'battery-label')).toEqual({
      x: -69 * 0.625,
      y: 16.6 * 0.625,
      width: 14 * 0.625,
      height: 4.2 * 0.625,
    });
    expect(resolveWorldRect(objects, 'internals')).toBeNull();
    expect(resolveWorldRect(objects, 'missing')).toBeNull();

    const store = createMemoryStore(objects);
    const visible = store.query({
      bounds: { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 },
      scale: 4,
    });
    for (const id of ['battery', 'battery-label']) {
      const placed = visible.find((entry) => entry.object.id === id);
      const resolved = resolveWorldRect(objects, id);
      expect(placed).toBeDefined();
      expect(resolved).not.toBeNull();
      expect(placed?.object.x).toBeCloseTo(resolved?.x ?? Number.NaN);
      expect(placed?.object.y).toBeCloseTo(resolved?.y ?? Number.NaN);
      if (placed?.object.payload.type === 'image' || placed?.object.payload.type === 'text') {
        expect(placed.object.payload.width).toBeCloseTo(resolved?.width ?? Number.NaN);
        expect(placed.object.payload.height).toBeCloseTo(resolved?.height ?? Number.NaN);
      }
    }
    expect(store.countInBand(4)).toBe(3);
  });

  it('follows a parent chain under the group, and ignores a non-positive scale', () => {
    const group: CanvasObject = {
      id: 'internals',
      x: 10,
      y: -4,
      scale: 0.5,
      visibility: band,
      payload: { type: 'group' },
    };
    const battery = withParent(image('battery', 8, -6, 10, 20), 'internals');
    const chip = withParent(image('chip', 4, 2, 6, 6), 'battery');
    chip.scale = 0;
    const objects = [chip, battery, group];

    expect(resolveWorldRect(objects, 'battery')).toEqual({ x: 14, y: -7, width: 5, height: 10 });
    expect(resolveWorldRect(objects, 'chip')).toEqual({ x: 16, y: -6, width: 3, height: 3 });

    const visible = createMemoryStore(objects).query({
      bounds: { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 },
      scale: 4,
    });
    const placedChip = visible.find((entry) => entry.object.id === 'chip');
    expect(placedChip?.object).toMatchObject({ x: 16, y: -6 });
    expect(placedChip?.object.payload).toMatchObject({ width: 3, height: 3 });
  });

  it('returns null for a cycle or a missing parent', () => {
    const a = withParent(text('a', 0, 0, 4, 4), 'b');
    const b = withParent(text('b', 0, 0, 4, 4), 'a');
    const orphan = withParent(text('orphan', 1, 1, 4, 4), 'gone');
    expect(resolveWorldRect([a, b], 'a')).toBeNull();
    expect(resolveWorldRect([orphan], 'orphan')).toBeNull();
  });
});

function image(id: string, x: number, y: number, width: number, height: number): CanvasObject {
  return {
    id,
    x,
    y,
    visibility: band,
    payload: { type: 'image', src: `images/${id}.webp`, width, height, frame: false },
  };
}

function text(id: string, x: number, y: number, width: number, height: number): CanvasObject {
  return {
    id,
    x,
    y,
    visibility: band,
    payload: { type: 'text', text: id, style: { fontSize: height }, width, height },
  };
}

function withParent(object: CanvasObject, parentId: string): CanvasObject {
  return { ...object, parentId };
}
