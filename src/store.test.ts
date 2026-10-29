import { describe, expect, it } from 'vitest';
import { viewBounds, type ViewBounds } from './camera';
import { demoObjects } from './demo';
import type { CanvasObject, TextStyle, VisibilityRange } from './model';
import { createMemoryStore } from './store';
import { visibilityAlpha } from './visibility';

const wide: VisibilityRange = { minScale: 1, maxScale: 16 };

const nowhere: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 };
const nearby: ViewBounds = { left: -10, right: 10, top: -10, bottom: 10 };
const farAway: ViewBounds = { left: 1e9, right: 1e9 + 1, top: 1e9, bottom: 1e9 + 1 };

function textObject(
  id: string,
  visibility: VisibilityRange,
  x = 0,
  y = 0,
  label = id,
  fontSize = 12,
  extras?: Partial<TextStyle>,
  width = 4,
  height = 4,
): CanvasObject {
  return {
    id,
    x,
    y,
    visibility,
    payload: {
      type: 'text',
      text: label,
      style: { fontSize, color: '#fff', ...extras },
      width,
      height,
    },
  };
}

function imageObject(
  id: string,
  src: string,
  x = 0,
  y = 0,
  width = 10,
  height = 10,
  visibility: VisibilityRange = wide,
): CanvasObject {
  return {
    id,
    x,
    y,
    visibility,
    payload: { type: 'image', src, width, height },
  };
}

function ids(visible: { object: CanvasObject }[]): string[] {
  return visible.map((entry) => entry.object.id);
}

function withParent(object: CanvasObject, parentId: string): CanvasObject {
  return { ...object, parentId };
}

const span: ViewBounds = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };

/** Scale inside the fade-in of `wide`, where alpha tracks this fraction. */
function fadeInScale(fraction: number): number {
  return wide.minScale * 1.35 ** fraction;
}

describe('createMemoryStore', () => {
  it('counts every object above the HUD cutoff, including ones outside the view', () => {
    const near = textObject('near', wide, 0);
    const far = textObject('far', wide, 1_000_000);
    const hidden = textObject('hidden', { minScale: 100, maxScale: 200 });
    const store = createMemoryStore([near, far, hidden]);

    expect(visibilityAlpha(wide, 4)).toBe(1);
    expect(store.countInBand(4)).toBe(2);
    expect(store.countInBand(0.5)).toBe(0);
  });

  it('uses a stricter cutoff for the HUD than for query', () => {
    const object = textObject('fade', wide);
    const store = createMemoryStore([object]);

    const aboveHud = fadeInScale(0.03);
    expect(visibilityAlpha(wide, aboveHud)).toBeGreaterThan(0.02);
    expect(store.countInBand(aboveHud)).toBe(1);
    expect(store.query({ bounds: nowhere, scale: aboveHud })).toEqual([
      { object, alpha: visibilityAlpha(wide, aboveHud) },
    ]);

    const between = fadeInScale(0.015);
    const betweenAlpha = visibilityAlpha(wide, between);
    expect(betweenAlpha).toBeGreaterThan(0.01);
    expect(betweenAlpha).toBeLessThanOrEqual(0.02);
    expect(store.countInBand(between)).toBe(0);
    expect(store.query({ bounds: nowhere, scale: between })).toEqual([
      { object, alpha: betweenAlpha },
    ]);

    const belowDraw = fadeInScale(0.005);
    expect(visibilityAlpha(wide, belowDraw)).toBeGreaterThan(0);
    expect(visibilityAlpha(wide, belowDraw)).toBeLessThanOrEqual(0.01);
    expect(store.countInBand(belowDraw)).toBe(0);
    expect(store.query({ bounds: nowhere, scale: belowDraw })).toEqual([]);
  });

  it('counts an in-band object that is far outside the view and omits it from query', () => {
    const placed = textObject('placed', wide, 1_000_000);
    const store = createMemoryStore([placed]);
    const scale = 4;

    expect(store.countInBand(scale)).toBe(1);
    expect(store.query({ bounds: nearby, scale })).toEqual([]);
    expect(store.query({ bounds: farAway, scale })).toEqual([]);
    expect(store.query({ bounds: nowhere, scale })).toEqual([]);
  });

  it('drops objects fully outside the view and keeps ones that only clip an edge', () => {
    const scale = 8;
    const plate = imageObject('plate', 'images/plate.svg', 0, 0, 100, 40);
    const images = createMemoryStore([plate]);

    // Payload spans x [-50, 50], y [-20, 20]. None of these views contain the center.
    const rightEdge: ViewBounds = { left: 40, right: 80, top: -5, bottom: 5 };
    const leftEdge: ViewBounds = { left: -80, right: -40, top: -5, bottom: 5 };
    const topEdge: ViewBounds = { left: -5, right: 5, top: -30, bottom: -15 };
    const bottomEdge: ViewBounds = { left: -5, right: 5, top: 15, bottom: 30 };
    const offScreen: ViewBounds = { left: 400, right: 500, top: -5, bottom: 5 };

    expect(ids(images.query({ bounds: rightEdge, scale }))).toEqual(['plate']);
    expect(ids(images.query({ bounds: leftEdge, scale }))).toEqual(['plate']);
    expect(ids(images.query({ bounds: topEdge, scale }))).toEqual(['plate']);
    expect(ids(images.query({ bounds: bottomEdge, scale }))).toEqual(['plate']);
    expect(images.query({ bounds: offScreen, scale })).toEqual([]);
    expect(images.countInBand(scale)).toBe(1);

    // Half of the 1.25px image stroke sticks out past the payload rect.
    const frameOnly: ViewBounds = { left: 50.05, right: 50.2, top: -1, bottom: 1 };
    expect(ids(images.query({ bounds: frameOnly, scale }))).toEqual(['plate']);

    // Authored box is 500 by 160, centered on the anchor.
    // These views miss the anchor and still cover that box.
    const label = textObject('label', wide, 0, 0, 'MMMM', 100, undefined, 500, 160);
    const labels = createMemoryStore([label]);
    const textRight: ViewBounds = { left: 150, right: 180, top: -10, bottom: 10 };
    const textAbove: ViewBounds = { left: -10, right: 10, top: -60, bottom: -30 };
    expect(ids(labels.query({ bounds: textRight, scale }))).toEqual(['label']);
    expect(ids(labels.query({ bounds: textAbove, scale }))).toEqual(['label']);
    expect(labels.query({ bounds: offScreen, scale })).toEqual([]);
  });

  it('uses the authored text width and height for query bounds', () => {
    const scale = 4;
    // 100 by 40, centered. The one-pixel pad is 0.25 world units at this scale.
    const label = textObject('label', wide, 0, 0, 'Hi', 20, { letterSpacing: '10em' }, 100, 40);
    const store = createMemoryStore([label]);
    const onBox: ViewBounds = { left: 40, right: 49, top: -2, bottom: 2 };
    const padOnly: ViewBounds = { left: 50.05, right: 50.2, top: -1, bottom: 1 };
    const beyond: ViewBounds = { left: 50.3, right: 51, top: -1, bottom: 1 };

    expect(ids(store.query({ bounds: onBox, scale }))).toEqual(['label']);
    expect(ids(store.query({ bounds: padOnly, scale }))).toEqual(['label']);
    expect(store.query({ bounds: beyond, scale })).toEqual([]);

    // A narrower box misses the same view. Letter-spacing does not grow it.
    const narrow = textObject('narrow', wide, 0, 0, 'Hi', 20, { letterSpacing: '10em' }, 20, 40);
    expect(createMemoryStore([narrow]).query({ bounds: onBox, scale })).toEqual([]);
  });

  it('keeps only the sliver inside a deep-zoom view', () => {
    const scale = 80;
    const visibility: VisibilityRange = { minScale: 20, maxScale: 200 };
    const edge = imageObject('edge', 'images/edge.svg', 0, 0, 2, 2, visibility);
    const neighbor = imageObject('neighbor', 'images/neighbor.svg', 40, 0, 2, 2, visibility);
    const fine = textObject('fine', visibility, 1_000_000, -20, 'x', 1);
    const store = createMemoryStore([edge, neighbor, fine]);

    const sliver: ViewBounds = { left: 0.7, right: 1.2, top: -0.2, bottom: 0.2 };
    expect(store.query({ bounds: sliver, scale })).toEqual([{ object: edge, alpha: 1 }]);

    const onNeighbor: ViewBounds = { left: 39.2, right: 40.2, top: -0.4, bottom: 0.4 };
    expect(ids(store.query({ bounds: onNeighbor, scale }))).toEqual(['neighbor']);

    const gap: ViewBounds = { left: 10, right: 12, top: -1, bottom: 1 };
    expect(store.query({ bounds: gap, scale })).toEqual([]);

    const fineInk: ViewBounds = { left: 1_000_000.05, right: 1_000_000.15, top: -20.05, bottom: -19.95 };
    const fineMiss: ViewBounds = { left: 1_000_030, right: 1_000_032, top: -21, bottom: -19 };
    expect(ids(store.query({ bounds: fineInk, scale }))).toEqual(['fine']);
    expect(store.query({ bounds: fineMiss, scale })).toEqual([]);

    expect(store.countInBand(scale)).toBe(3);
  });

  it('sends fewer atlas objects to the renderer than the band contains', () => {
    const store = createMemoryStore(demoObjects);
    const scale = 1;
    const bounds = viewBounds({ x: 0, y: -80, scale }, 1280, 720);
    const visible = store.query({ bounds, scale });
    const band = store.countInBand(scale);
    const idsInView = visible.map((entry) => entry.object.id);

    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(band);
    expect(idsInView).toContain('region-compass');
    expect(idsInView).not.toContain('region-dune');
    expect(idsInView).not.toContain('detail-bollard');
  });

  it('returns an empty result for an empty list', () => {
    const store = createMemoryStore([]);
    expect(store.countInBand(4)).toBe(0);
    expect(store.query({ bounds: nearby, scale: 4 })).toEqual([]);
    expect(store.imageSources()).toEqual([]);
  });

  it('lists every image src in dataset order and skips text', () => {
    const store = createMemoryStore([
      imageObject('compass', 'images/compass.svg'),
      textObject('label', wide),
      imageObject('buoy', 'images/buoy.svg'),
      imageObject('compass-again', 'images/compass.svg'),
    ]);

    expect(store.imageSources()).toEqual([
      'images/compass.svg',
      'images/buoy.svg',
      'images/compass.svg',
    ]);
    expect(createMemoryStore([textObject('only-text', wide)]).imageSources()).toEqual([]);
  });

  it('rebuilds the resident set and notifies when objects are replaced', () => {
    const first = textObject('first', wide);
    const plate = imageObject('plate', 'images/plate.svg');
    const store = createMemoryStore([first, plate]);
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.countInBand(4));
    });

    expect(seen).toEqual([]);
    expect(store.imageSources()).toEqual(['images/plate.svg']);

    const second = textObject('second', wide);
    store.replaceObjects([second]);

    expect(seen).toEqual([1]);
    expect(store.countInBand(4)).toBe(1);
    expect(ids(store.query({ bounds: nearby, scale: 4 }))).toEqual(['second']);
    expect(store.imageSources()).toEqual([]);

    unsubscribe();
    store.replaceObjects([first, second]);
    expect(seen).toEqual([1]);
    expect(store.countInBand(4)).toBe(2);
    expect(ids(store.query({ bounds: nearby, scale: 4 }))).toEqual(['first', 'second']);
  });

  it('keeps a child offset of 1e-6 under a parent at x = 132', () => {
    const parent = textObject('phone', wide, 132, -60);
    const child = withParent(textObject('mark', wide, 1e-6, 0), 'phone');
    const store = createMemoryStore([child, parent]);
    const aroundPhone: ViewBounds = { left: 131, right: 133, top: -61, bottom: -59 };

    const mark = store.query({ bounds: aroundPhone, scale: 4 }).find((entry) => entry.object.id === 'mark');
    expect(mark).toBeDefined();
    expect(mark?.object.x).toBe(132 + 1e-6);
    expect(mark?.object.x).not.toBe(132);
    expect(mark?.object.y).toBe(-60);
    expect(mark?.object.parentId).toBeUndefined();
    expect(child.x).toBe(1e-6);
    expect(child.parentId).toBe('phone');
    expect(store.countInBand(4)).toBe(2);
  });

  it('flattens a grandchild chain to world coordinates', () => {
    const root = textObject('root', wide, 50, 80, 'x', 1);
    const child = withParent(textObject('child', wide, 20, -10, 'x', 1), 'root');
    const grandchild = withParent(textObject('grandchild', wide, -4, 6, 'x', 1), 'child');
    const store = createMemoryStore([grandchild, child, root]);

    const visible = store.query({ bounds: span, scale: 4 });
    const byId = new Map(visible.map((entry) => [entry.object.id, entry.object]));
    expect(byId.get('root')).toMatchObject({ x: 50, y: 80 });
    expect(byId.get('child')).toMatchObject({ x: 70, y: 70 });
    expect(byId.get('grandchild')).toMatchObject({ x: 66, y: 76 });
    expect(store.countInBand(4)).toBe(3);

    const onGrandchild: ViewBounds = { left: 65.5, right: 66.5, top: 75.5, bottom: 76.5 };
    const onLocal: ViewBounds = { left: -5, right: -3, top: 5, bottom: 7 };
    expect(ids(store.query({ bounds: onGrandchild, scale: 4 }))).toEqual(['grandchild']);
    expect(store.query({ bounds: onLocal, scale: 4 })).toEqual([]);
  });

  it('omits an object whose parent is missing until that parent is resident', () => {
    const orphan = withParent(imageObject('chip', 'images/chip.svg', 4, -2), 'phone');
    const store = createMemoryStore([orphan]);

    expect(store.query({ bounds: span, scale: 4 })).toEqual([]);
    expect(store.countInBand(4)).toBe(0);
    expect(store.imageSources()).toEqual(['images/chip.svg']);

    const phone = textObject('phone', wide, 132, -60);
    store.replaceObjects([orphan, phone]);

    const visible = store.query({ bounds: span, scale: 4 });
    expect(ids(visible)).toEqual(['chip', 'phone']);
    expect(visible[0]?.object).toMatchObject({ x: 136, y: -62 });
    expect(store.countInBand(4)).toBe(2);
    expect(orphan.x).toBe(4);
    expect(orphan.parentId).toBe('phone');
  });

  it('omits a parent cycle and anything that hangs off it', () => {
    const a = withParent(textObject('a', wide, 1, 1), 'b');
    const b = withParent(textObject('b', wide, 2, 2), 'a');
    const hanging = withParent(textObject('hanging', wide, 3, 3), 'b');
    const self = withParent(textObject('self', wide, 4, 4), 'self');
    const kept = textObject('kept', wide, 0, 0);
    const store = createMemoryStore([a, hanging, self, kept, b]);

    expect(ids(store.query({ bounds: span, scale: 4 }))).toEqual(['kept']);
    expect(store.countInBand(4)).toBe(1);
  });

  it('hits only objects above the draw cutoff', () => {
    const object = textObject('fade', wide, 0, 0, 'fade', 12, undefined, 8, 8);
    const store = createMemoryStore([object]);
    const at = (scale: number) => ({ x: 0, y: 0, scale });

    const belowDraw = fadeInScale(0.005);
    expect(visibilityAlpha(wide, belowDraw)).toBeGreaterThan(0);
    expect(visibilityAlpha(wide, belowDraw)).toBeLessThanOrEqual(0.01);
    expect(store.hitTest({ x: 0, y: 0 }, at(belowDraw))).toBeNull();
    expect(store.hitTest({ x: 0, y: 0 }, at(0.5))).toBeNull();
    expect(store.hitTest({ x: 0, y: 0 }, at(100))).toBeNull();

    // Above the draw cutoff and still under the HUD cutoff. The renderer would paint it.
    const between = fadeInScale(0.015);
    const betweenAlpha = visibilityAlpha(wide, between);
    expect(betweenAlpha).toBeGreaterThan(0.01);
    expect(betweenAlpha).toBeLessThanOrEqual(0.02);
    expect(store.countInBand(between)).toBe(0);
    expect(store.hitTest({ x: 0, y: 0 }, at(between))?.id).toBe('fade');
  });

  it('uses the unpadded authored box', () => {
    const scale = 4;
    // 10 by 10, so the right edge is x = 5. The image pad is 1.625 CSS pixels.
    const plate = imageObject('plate', 'images/plate.svg', 0, 0, 10, 10);
    const store = createMemoryStore([plate]);
    const camera = { x: 0, y: 0, scale };
    const padOnly: ViewBounds = { left: 5.05, right: 5.3, top: -0.2, bottom: 0.2 };

    expect(store.hitTest({ x: 4.9, y: 0 }, camera)?.id).toBe('plate');
    expect(store.hitTest({ x: 5, y: 0 }, camera)?.id).toBe('plate');
    expect(store.hitTest({ x: 5.2, y: 0 }, camera)).toBeNull();
    expect(ids(store.query({ bounds: padOnly, scale }))).toEqual(['plate']);
  });

  it('prefers the finer object, the one with the greater maxScale', () => {
    const coarse = textObject('coarse', { minScale: 1, maxScale: 4 }, 0, 0, 'c', 12, undefined, 30, 10);
    const fine = textObject('fine', { minScale: 2, maxScale: 20 }, 0, 0, 'f', 12, undefined, 10, 10);
    // Listed first, and still the hit while both are drawn. Greater maxScale is on top.
    const store = createMemoryStore([fine, coarse]);
    const inside = { x: 0, y: 0 };

    expect(store.hitTest(inside, { x: 0, y: 0, scale: 3 })?.id).toBe('fine');
    // Below the fine band only the coarse object would be drawn.
    expect(store.hitTest(inside, { x: 0, y: 0, scale: 1.2 })?.id).toBe('coarse');

    const tied = textObject('tied', wide, 0, 0, 't', 12, undefined, 10, 10);
    const earlier = textObject('earlier', wide, 0, 0, 'e', 12, undefined, 10, 10);
    expect(createMemoryStore([earlier, tied]).hitTest(inside, { x: 0, y: 0, scale: 4 })?.id).toBe('tied');
  });

  it('hits a parent-local child at its world position', () => {
    const parent = textObject('phone', wide, 132, -60, 'phone', 12, undefined, 40, 20);
    const child = withParent(textObject('mark', wide, 100, 0, 'mark', 12, undefined, 2, 2), 'phone');
    const store = createMemoryStore([parent, child]);
    const camera = { x: 132, y: -60, scale: 4 };

    const hit = store.hitTest({ x: 232, y: -60 }, camera);
    expect(hit).toMatchObject({ id: 'mark', x: 232, y: -60 });
    expect(hit?.parentId).toBeUndefined();
    expect(store.hitTest({ x: 100, y: 0 }, camera)).toBeNull();
    expect(child.x).toBe(100);
    expect(child.parentId).toBe('phone');
  });

  it('skips an object whose zoom fade has reached alpha 0', () => {
    const band: VisibilityRange = { minScale: 0.01, maxScale: 10000 };
    const fitScale = 4;
    const front = {
      ...textObject('front', band, 0, 0, 'Front', 12, undefined, 20, 10),
      fade: { fadeOut: [1, 2] as const },
    };
    const part = withParent(
      {
        ...textObject('part', band, 0, 0, 'Part', 12, undefined, 10, 10),
        fade: { fadeIn: [1, 2] as const },
      },
      'front',
    );
    const store = createMemoryStore([part, front]);
    const at = (ratio: number) => ({ x: 0, y: 0, scale: fitScale * ratio });

    expect(store.hitTest({ x: 0, y: 0 }, at(0.5), fitScale)?.id).toBe('front');
    expect(store.hitTest({ x: 0, y: 0 }, at(1), fitScale)?.id).toBe('front');
    expect(store.hitTest({ x: 0, y: 0 }, at(1.5), fitScale)?.id).toBe('front');
    expect(store.hitTest({ x: 0, y: 0 }, at(2), fitScale)).toMatchObject({ id: 'part' });
    expect(store.hitTest({ x: 0, y: 0 }, at(3), fitScale)?.id).toBe('part');
    // No fit scale means the fade is not applied, so the later object still wins.
    expect(store.hitTest({ x: 0, y: 0 }, at(3))?.id).toBe('front');

    const shown = (ratio: number) => store.query({ bounds: span, scale: fitScale * ratio, fitScale });
    expect(ids(shown(1))).toEqual(['front']);
    expect(shown(1.2).find((entry) => entry.object.id === 'front')?.alpha).toBe(1);
    expect(ids(shown(2))).toEqual(['part']);
    expect(store.countInBand(fitScale, fitScale)).toBe(1);
    expect(store.countInBand(fitScale * 1.5, fitScale)).toBe(2);
    expect(store.countInBand(fitScale * 3, fitScale)).toBe(1);
  });
});
