import { describe, expect, it } from 'vitest';
import { boxFitScale, type ViewBounds } from './camera';
import { relativeZoomAlpha } from './fade';
import { buildLevelPlan } from './levelFade';
import type { CanvasObject, ZoomFade } from './model';
import { createMemoryStore } from './store';

const band = { minScale: 0.01, maxScale: 10000 };
const view = { width: 800, height: 600 };

describe('level handover', () => {
  it('fades siblings with the entered part and restores them on the way out', () => {
    const scene = chassis();
    const fit = fitOf(scene, 'board');
    const centre = focusOn(scene, 'board');
    const at = (ratio: number, id: string) => opacity(scene, fit * ratio, centre, id);

    expect(at(1, 'speaker')).toBeCloseTo(1);
    expect(at(1, 'board')).toBeCloseTo(1);
    expect(at(1, 'board-label')).toBeCloseTo(1);
    expect(at(1.5, 'speaker')).toBeCloseTo(0.5);
    expect(at(1.5, 'board')).toBeCloseTo(0.5);
    expect(at(1.5, 'board-label')).toBeCloseTo(0.5);
    expect(at(2, 'speaker')).toBeCloseTo(0);
    expect(at(2.5, 'speaker')).toBe(0);
    expect(at(2.5, 'board-label')).toBe(0);
    // The same camera zoomed back out is the reverse of the way in.
    expect(at(1.5, 'speaker')).toBeCloseTo(0.5);
    expect(at(1, 'speaker')).toBeCloseTo(1);

    const child = relativeZoomAlpha({ fadeIn: [1, 2] }, 1.5);
    expect(at(1.5, 'chip')).toBe(1);
    expect(child).toBeCloseTo(0.5);
    expect(at(1.5, 'cover')).toBe(1);
    expect(at(2.5, 'cover')).toBe(1);
    expect(at(1.5, 'trace')).toBe(1);
  });

  it('keeps an outer level faded after a nested part becomes the nearest', () => {
    const scene = chassis();
    const boardFit = fitOf(scene, 'board');
    const chipFit = fitOf(scene, 'chip');
    expect(chipFit).toBeGreaterThan(boardFit);
    const deep = chipFit * 2;
    const onChip = focusOn(scene, 'chip');
    const onBoard = focusOn(scene, 'board');
    expect(boardFit * 2).toBeLessThan(chipFit);

    expect(opacity(scene, deep, onChip, 'speaker')).toBe(0);
    expect(opacity(scene, deep, onChip, 'board')).toBe(0);
    expect(opacity(scene, deep, onChip, 'trace')).toBe(0);
    expect(opacity(scene, deep, onChip, 'die')).toBe(1);
    expect(opacity(scene, deep, onChip, 'cover')).toBe(1);

    // Still inside the board, not yet on the chip: only the outer level leaves.
    expect(opacity(scene, boardFit * 2, onBoard, 'speaker')).toBe(0);
    expect(opacity(scene, boardFit * 2, onBoard, 'trace')).toBe(1);
    expect(opacity(scene, boardFit * 2, onBoard, 'die')).toBe(1);
  });

  it('uses the nearer entered portal and breaks a tie by id', () => {
    const scene = twoBranches();
    const wideFit = fitOf(scene, 'wide');
    const narrowFit = fitOf(scene, 'narrow');
    const far = Math.max(wideFit, narrowFit) * 2;
    const onNarrow = focusOn(scene, 'narrow');
    const onWide = focusOn(scene, 'wide');

    expect(opacity(scene, far, onNarrow, 'narrow-sibling')).toBe(0);
    expect(opacity(scene, far, onNarrow, 'wide-sibling')).toBe(1);
    expect(opacity(scene, far, onWide, 'wide-sibling')).toBe(0);
    expect(opacity(scene, far, onWide, 'narrow-sibling')).toBe(1);

    // Below the narrow fit the wide branch is the only one entered, even
    // when the focus sits on the narrow part.
    const mid = wideFit * 1.5;
    expect(mid).toBeLessThan(narrowFit);
    expect(opacity(scene, mid, onNarrow, 'wide-sibling')).toBeCloseTo(0.5);
    expect(opacity(scene, mid, onNarrow, 'narrow-sibling')).toBe(1);

    const tied = tiedPortals();
    const scale = fitOf(tied, 'alpha') * 2;
    const middle = { x: 0, y: 0 };
    expect(opacity(tied, scale, middle, 'alpha-sibling')).toBe(0);
    expect(opacity(tied, scale, middle, 'beta-sibling')).toBe(1);
    expect(opacity(tied, scale, middle, 'alpha-sibling')).toBe(opacity(tied, scale, { x: 0, y: 1e-9 }, 'alpha-sibling'));
  });

  it('does not raise sibling opacity when a less-faded portal becomes nearer', () => {
    const scene = sharedLevel();
    const lowFit = fitOf(scene, 'low');
    const highFit = fitOf(scene, 'high');
    const between = (lowFit + highFit) / 2;
    expect(between).toBeGreaterThan(lowFit * 2);
    expect(between).toBeLessThan(highFit);
    const onHigh = focusOn(scene, 'high');
    const onLow = focusOn(scene, 'low');

    expect(opacity(scene, between, onHigh, 'other')).toBe(0);
    expect(opacity(scene, between, onLow, 'other')).toBe(0);

    // `high` is just entered (its own curve is still 1). `low` has already
    // finished, and staying nearer `high` must not bring the level back.
    expect(highFit).toBeGreaterThan(lowFit * 2);
    expect(opacity(scene, highFit, onHigh, 'other')).toBe(0);
    expect(opacity(scene, highFit, onLow, 'other')).toBe(0);
  });

  it('ignores a handover when the fit, the focus, or the range is missing', () => {
    const scene = chassis();
    const fit = fitOf(scene, 'board');
    const centre = focusOn(scene, 'board');
    expect(opacity(scene, fit * 2, undefined, 'speaker')).toBe(1);
    expect(buildLevelPlan(scene.objects, scene.boxOf, fit * 2, centre, { width: 0, height: 600 }).opacity('speaker')).toBe(1);
    expect(buildLevelPlan(scene.objects, scene.boxOf, Number.NaN, centre, view).opacity('speaker')).toBe(1);

    const broken = chassis();
    const chip = broken.objects.find((object) => object.id === 'chip');
    if (!chip) throw new Error('expected the chip');
    chip.fade = { fadeIn: [2, 2], fadeInOf: 'board' };
    expect(opacity(broken, fit * 2, centre, 'speaker')).toBe(1);
  });

  it('drops siblings from the store while the part is entered and puts them back', () => {
    const scene = chassis();
    const store = createMemoryStore(scene.objects);
    const fit = fitOf(scene, 'board');
    const centre = focusOn(scene, 'board');
    const idsAt = (ratio: number) =>
      store
        .query({
          bounds: { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 },
          scale: fit * ratio,
          fitScale: 1,
          viewWidth: view.width,
          viewHeight: view.height,
        })
        .map((entry) => entry.object.id);

    // The wide bounds are centred at the origin, which is the board.
    expect(centre).toEqual({ x: 0, y: 0 });
    expect(idsAt(1)).toEqual(expect.arrayContaining(['board', 'speaker', 'board-label', 'cover']));
    expect(idsAt(1)).not.toContain('chip');
    expect(idsAt(2)).not.toEqual(expect.arrayContaining(['board', 'speaker', 'board-label']));
    expect(idsAt(2)).toEqual(expect.arrayContaining(['chip', 'cover']));
    expect(idsAt(1)).toContain('speaker');
    expect(store.countInBand(fit * 2, 1, view, centre)).toBe(3);
    expect(store.hitTest({ x: 8, y: 0 }, { x: 0, y: 0, scale: fit * 2 }, 1, view)?.id).toBe('chip');
    expect(store.hitTest({ x: 0, y: 0 }, { x: 0, y: 0, scale: fit }, 1, view)?.id).toBe('board');
  });
});

type Scene = {
  objects: CanvasObject[];
  boxOf: (id: string) => ViewBounds | undefined;
};

function opacity(scene: Scene, scale: number, focus: { x: number; y: number } | undefined, id: string): number {
  return buildLevelPlan(scene.objects, scene.boxOf, scale, focus, view).opacity(id);
}

function fitOf(scene: Scene, id: string): number {
  const box = scene.boxOf(id);
  if (!box) throw new Error(`expected a box for ${id}`);
  return boxFitScale(box, view.width, view.height);
}

function focusOn(scene: Scene, id: string): { x: number; y: number } {
  const box = scene.boxOf(id);
  if (!box) throw new Error(`expected a box for ${id}`);
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
}

/**
 * `cover` is another level. `board` opens onto `chip`; `chip` opens onto `die`.
 * `speaker` and `board-label` are siblings of the board. `trace` is a sibling of the chip.
 */
function chassis(): Scene {
  const reveal: ZoomFade = { fadeIn: [1, 2], fadeInOf: 'board' };
  const deeper: ZoomFade = { fadeIn: [1, 2], fadeInOf: 'chip' };
  const objects: CanvasObject[] = [
    group('level'),
    image('board', 0, 0, 40, 30, 'level'),
    text('speaker', 70, 0, 'Speaker', 'level'),
    text('board-label', -70, 10, 'Board', 'level'),
    group('nest', 'board'),
    text('chip', 8, 0, 'Chip', 'nest', reveal),
    text('trace', 30, 0, 'Trace', 'nest'),
    group('die-group', 'chip'),
    text('die', 8, 0, 'Die', 'die-group', deeper),
    text('cover', 0, -80, 'Cover'),
  ];
  const boxes = new Map<string, ViewBounds>([
    ['board', rect(0, 0, 40, 30)],
    ['speaker', rect(70, 0, 16, 6)],
    ['board-label', rect(-70, 10, 16, 6)],
    ['chip', rect(8, 0, 12, 8)],
    ['trace', rect(30, 0, 10, 6)],
    ['die', rect(8, 0, 4, 4)],
    ['cover', rect(0, -80, 20, 6)],
  ]);
  return { objects, boxOf: (id) => boxes.get(id) };
}

/** Two portals on different parents, so only the nearer branch fades. */
function twoBranches(): Scene {
  const objects: CanvasObject[] = [
    group('wide-level'),
    image('wide', -80, 0, 50, 40, 'wide-level'),
    text('wide-sibling', -80, 40, 'Wide', 'wide-level'),
    text('wide-child', -80, 0, 'In', 'wide', { fadeIn: [1, 2], fadeInOf: 'wide' }),
    group('narrow-level'),
    image('narrow', 80, 0, 16, 12, 'narrow-level'),
    text('narrow-sibling', 80, 30, 'Narrow', 'narrow-level'),
    text('narrow-child', 80, 0, 'In', 'narrow', { fadeIn: [1, 2], fadeInOf: 'narrow' }),
  ];
  const boxes = new Map<string, ViewBounds>([
    ['wide', rect(-80, 0, 50, 40)],
    ['wide-sibling', rect(-80, 40, 12, 6)],
    ['wide-child', rect(-80, 0, 8, 6)],
    ['narrow', rect(80, 0, 16, 12)],
    ['narrow-sibling', rect(80, 30, 12, 6)],
    ['narrow-child', rect(80, 0, 6, 4)],
  ]);
  return { objects, boxOf: (id) => boxes.get(id) };
}

/** Equal distance from the origin. `alpha` sorts before `beta`. */
function tiedPortals(): Scene {
  const objects: CanvasObject[] = [
    group('alpha-level'),
    image('alpha', 0, 0, 20, 20, 'alpha-level'),
    text('alpha-sibling', 0, 30, 'A', 'alpha-level'),
    text('alpha-child', 0, 0, 'a', 'alpha', { fadeIn: [1, 2], fadeInOf: 'alpha' }),
    group('beta-level'),
    image('beta', 0, 0, 20, 20, 'beta-level'),
    text('beta-sibling', 0, -30, 'B', 'beta-level'),
    text('beta-child', 0, 0, 'b', 'beta', { fadeIn: [1, 2], fadeInOf: 'beta' }),
  ];
  const boxes = new Map<string, ViewBounds>([
    ['alpha', rect(0, 0, 20, 20)],
    ['alpha-sibling', rect(0, 30, 8, 4)],
    ['alpha-child', rect(0, 0, 6, 4)],
    ['beta', rect(0, 0, 20, 20)],
    ['beta-sibling', rect(0, -30, 8, 4)],
    ['beta-child', rect(0, 0, 6, 4)],
  ]);
  return { objects, boxOf: (id) => boxes.get(id) };
}

/**
 * Two portals share a parent. `low` is the larger fit. Once it has faded the
 * level out, moving onto `high` must not bring the siblings back.
 */
function sharedLevel(): Scene {
  const objects: CanvasObject[] = [
    group('level'),
    image('low', -40, 0, 60, 40, 'level'),
    image('high', 50, 0, 16, 12, 'level'),
    text('other', 0, 40, 'Other', 'level'),
    text('low-child', -40, 0, 'L', 'low', { fadeIn: [1, 2], fadeInOf: 'low' }),
    text('high-child', 50, 0, 'H', 'high', { fadeIn: [1, 2], fadeInOf: 'high' }),
  ];
  const boxes = new Map<string, ViewBounds>([
    ['low', rect(-40, 0, 60, 40)],
    ['high', rect(50, 0, 16, 12)],
    ['other', rect(0, 40, 12, 6)],
    ['low-child', rect(-40, 0, 8, 6)],
    ['high-child', rect(50, 0, 6, 4)],
  ]);
  return { objects, boxOf: (id) => boxes.get(id) };
}

function rect(x: number, y: number, width: number, height: number): ViewBounds {
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function group(id: string, parentId?: string): CanvasObject {
  return {
    id,
    x: 0,
    y: 0,
    ...(parentId ? { parentId } : {}),
    visibility: band,
    payload: { type: 'group' },
  };
}

function image(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): CanvasObject {
  return {
    id,
    x,
    y,
    ...(parentId ? { parentId } : {}),
    visibility: band,
    payload: { type: 'image', src: `images/${id}.webp`, width, height, frame: false },
  };
}

function text(
  id: string,
  x: number,
  y: number,
  label: string,
  parentId?: string,
  fade?: ZoomFade,
): CanvasObject {
  return {
    id,
    x,
    y,
    ...(parentId ? { parentId } : {}),
    ...(fade ? { fade } : {}),
    visibility: band,
    payload: { type: 'text', text: label, style: { fontSize: 4 }, width: 12, height: 4 },
  };
}
