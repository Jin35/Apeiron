import { describe, expect, it } from 'vitest';
import { resolveWorldRect } from './link';
import type { CanvasObject, VisibilityRange } from './model';
import { explodeLevel, type LevelPart } from './placement';

const band: VisibilityRange = { minScale: 0.01, maxScale: 10000 };

describe('explodeLevel', () => {
  const frame: LevelPart = { id: 'frame', x: 0, y: 0, width: 40, height: 80 };
  const left: LevelPart = { id: 'left', x: -8, y: 6, width: 20, height: 30 };
  const upper: LevelPart = { id: 'upper', x: 6, y: -20, width: 12, height: 16 };
  const parts = [frame, left, upper];

  it('keeps the assembled layout when the gap is missing', () => {
    expect(explodeLevel(parts, 0)).toEqual(parts.map((part) => ({ id: part.id, x: part.x, y: part.y, scale: 1 })));
    expect(explodeLevel(parts, Number.NaN).map((part) => part.scale)).toEqual([1, 1, 1]);
  });

  it('moves each part out along its ray and leaves the frame centred', () => {
    const laid = explodeLevel(parts, 30);
    const byId = new Map(laid.map((part) => [part.id, part]));
    const frameLaid = byId.get('frame');
    const leftLaid = byId.get('left');
    const upperLaid = byId.get('upper');
    if (!frameLaid || !leftLaid || !upperLaid) throw new Error('expected every part');

    expect(frameLaid.x).toBeCloseTo(0);
    expect(frameLaid.y).toBeCloseTo(0);
    expect(leftLaid.scale).toBe(1);
    // Same direction as the assembled offset, and not a different ray.
    expect(leftLaid.x * left.y - leftLaid.y * left.x).toBeCloseTo(0);
    expect(leftLaid.x * left.x + leftLaid.y * left.y).toBeGreaterThan(0);
    expect(upperLaid.x * upper.y - upperLaid.y * upper.x).toBeCloseTo(0);
    expect(upperLaid.x * upper.x + upperLaid.y * upper.y).toBeGreaterThan(0);

    expect(gapBetween(
      at(left, leftLaid.x, leftLaid.y, leftLaid.scale),
      at(frame, frameLaid.x, frameLaid.y, frameLaid.scale),
    )).toBeGreaterThan(0);
    expect(gapBetween(
      at(upper, upperLaid.x, upperLaid.y, upperLaid.scale),
      at(frame, frameLaid.x, frameLaid.y, frameLaid.scale),
    )).toBeGreaterThan(0);
  });

  it('steps plates apart by z and keeps side parts beside the middle plate', () => {
    const laid = explodeLevel(
      [
        { id: 'back', x: 0, y: 0, z: 0, width: 70, height: 140 },
        { id: 'frame', x: 0, y: 0, z: 1, width: 70, height: 150 },
        { id: 'left', x: -10, y: 8, z: 2, width: 20, height: 30 },
        { id: 'right', x: 12, y: -20, z: 3, width: 16, height: 18 },
        { id: 'front', x: 0, y: 0, z: 4, width: 70, height: 140 },
      ],
      8,
    );
    const byId = new Map(laid.map((part) => [part.id, part]));
    const frameLaid = byId.get('frame');
    const back = byId.get('back');
    const front = byId.get('front');
    const leftLaid = byId.get('left');
    const rightLaid = byId.get('right');
    if (!frameLaid || !back || !front || !leftLaid || !rightLaid) throw new Error('expected every part');
    expect(frameLaid.x).toBeCloseTo(0);
    expect(frameLaid.y).toBeCloseTo(0);
    expect(front.y).toBeLessThan(0);
    expect(back.y).toBeGreaterThan(0);
    expect(Math.abs(front.x)).toBeLessThan(1e-6);
    expect(Math.abs(back.x)).toBeLessThan(1e-6);
    expect(leftLaid.x).toBeLessThan(0);
    expect(rightLaid.x).toBeGreaterThan(0);
    expect(back.y).toBeGreaterThan(Math.abs(leftLaid.y));
    expect(front.y).toBeLessThan(-Math.abs(rightLaid.y));
  });

  it('lays plates in a row when the axis is horizontal', () => {
    const laid = explodeLevel(
      [
        { id: 'back', x: 0, y: 0, z: 0, width: 70, height: 140 },
        { id: 'frame', x: 0, y: 0, z: 1, width: 70, height: 150 },
        { id: 'left', x: -10, y: 8, z: 2, width: 20, height: 30 },
        { id: 'right', x: 12, y: -20, z: 3, width: 16, height: 18 },
        { id: 'front', x: 0, y: 0, z: 4, width: 70, height: 140 },
      ],
      8,
      { axis: 'x' },
    );
    const byId = new Map(laid.map((part) => [part.id, part]));
    const frameLaid = byId.get('frame');
    const back = byId.get('back');
    const front = byId.get('front');
    const leftLaid = byId.get('left');
    const rightLaid = byId.get('right');
    if (!frameLaid || !back || !front || !leftLaid || !rightLaid) throw new Error('expected every part');
    expect(back.x).toBeLessThan(leftLaid.x);
    expect(leftLaid.x).toBeLessThan(frameLaid.x);
    expect(frameLaid.x).toBeCloseTo(0);
    expect(rightLaid.x).toBeGreaterThan(frameLaid.x);
    expect(front.x).toBeGreaterThan(rightLaid.x);
    expect(Math.abs(back.y)).toBeLessThan(1e-6);
    expect(Math.abs(front.y)).toBeLessThan(1e-6);
  });
});

describe('placement', () => {
  it('fits an exploded child through the group scale and leaves the label where it was authored', () => {
    const gap = 24;
    const parts: LevelPart[] = [
      { id: 'frame', x: 0, y: 0, width: 40, height: 80 },
      { id: 'part', x: -10, y: 8, width: 16, height: 20 },
    ];
    const laid = explodeLevel(parts, gap);
    const part = laid.find((entry) => entry.id === 'part');
    if (!part) throw new Error('expected the part');

    const objects: CanvasObject[] = [
      group('level', gap),
      image('frame', 0, 0, 40, 80, 'level'),
      { ...image('part', -10, 8, 16, 20, 'level'), fade: { fadeIn: [1, 1.6] } },
      text('part-label', -40, 12, 'level'),
      {
        id: 'part-link',
        x: 0,
        y: 0,
        visibility: band,
        payload: { type: 'link', from: 'part-label', to: 'part' },
      },
      image('nested', 4, -2, 6, 8, 'part'),
    ];

    // No camera: assembled, and matched to the parent (the 0.625 group undoes the 1.6).
    expect(resolveWorldRect(objects, 'part')).toMatchObject({ x: -10, y: 8, width: 16, height: 20 });
    expect(resolveWorldRect(objects, 'frame')).toMatchObject({ x: 0, y: 0, width: 40, height: 80 });
    const fadedView = { scale: 4, fitScale: 1, width: 800, height: 600 };
    const label = resolveWorldRect(objects, 'part-label', fadedView);
    const fadedPart = resolveWorldRect(objects, 'part', fadedView);
    if (!label || !fadedPart) throw new Error('expected the part and its label');
    expect(Math.abs(label.x - fadedPart.x)).toBeGreaterThan(fadedPart.width / 2);
    expect(axisClearance(label, fadedPart)).toBeGreaterThanOrEqual(20);

    const nested = resolveWorldRect(objects, 'nested');
    expect(nested).toMatchObject({ x: -6, width: 6 });

    const faded = resolveWorldRect(objects, 'part', fadedView);
    expect(faded?.x).not.toBeCloseTo(-10);
  });
});

function at(part: LevelPart, x: number, y: number, scale: number): LevelPart {
  return { id: part.id, x, y, width: part.width * scale, height: part.height * scale };
}

function axisClearance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const degrees = Math.abs(Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI));
  return Math.min(Math.min(degrees, 180 - degrees), Math.abs(degrees - 90));
}

function gapBetween(a: LevelPart, b: LevelPart): number {
  const dx = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  const dy = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  if (dx >= 0) return dx;
  if (dy >= 0) return dy;
  return Math.max(dx, dy);
}

function group(id: string, explode: number): CanvasObject {
  return {
    id,
    x: 0,
    y: 0,
    scale: 0.625,
    visibility: band,
    payload: { type: 'group', explode },
  };
}

function image(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: string,
): CanvasObject {
  return {
    id,
    parentId,
    x,
    y,
    visibility: band,
    payload: { type: 'image', src: `images/${id}.webp`, width, height, frame: false },
  };
}

function text(id: string, x: number, y: number, parentId: string): CanvasObject {
  return {
    id,
    parentId,
    x,
    y,
    visibility: band,
    payload: { type: 'text', text: id, style: { fontSize: 4 }, width: 12, height: 4 },
  };
}
