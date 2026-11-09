import { describe, expect, it } from 'vitest';
import { smartphoneObjects } from '../content/smartphone';
import { boxFitScale, deriveCameraLimits, type ViewBounds } from './camera';
import { resolveWorldRect, type AxisRect } from './link';
import { createMemoryStore } from './store';

const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const span: ViewBounds = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };

describe('placement', () => {
  it('keeps a part fixed through a crossfade at every zoom and viewport', () => {
    const store = createMemoryStore(smartphoneObjects);
    const battery = resolveWorldRect(smartphoneObjects, 'battery');
    if (!battery) throw new Error('expected the battery');

    // Across the phone crossfade (r = 1 to 1.6) the display and its label
    // are coming in. Past that, the battery crossfade brings the cell in.
    // Neither rect may depend on the zoom or on which window is open.
    const openingFit = (view: { width: number; height: number }) =>
      deriveCameraLimits(store.contentBoxes(), view.width, view.height).fitScale;
    const batteryFit = (view: { width: number; height: number }) =>
      boxFitScale(boundsOf(battery), view.width, view.height);
    assertFixed(store, 'display', openingFit, [1.05, 1.2, 1.3, 1.45, 1.6]);
    assertFixed(store, 'display-label', openingFit, [1.05, 1.2, 1.3, 1.45, 1.6]);
    assertFixed(store, 'cell', batteryFit, [1.05, 1.3, 1.6, 2, 2.5]);
    assertFixed(store, 'cell-label', batteryFit, [1.05, 1.3, 1.6, 2, 2.5]);
  });
});

function assertFixed(
  store: ReturnType<typeof createMemoryStore>,
  id: string,
  referenceOf: (view: { width: number; height: number }) => number,
  ratios: readonly number[],
): void {
  const geometric = resolveWorldRect(smartphoneObjects, id);
  if (!geometric) throw new Error(`expected a world rect for ${id}`);
  for (const view of [desktop, phone]) {
    const reference = referenceOf(view);
    for (const ratio of ratios) {
      expect(shownRect(store, id, reference * ratio, view), `${id} at ${ratio} on ${view.width}×${view.height}`).toEqual(geometric);
    }
  }
}

function shownRect(
  store: ReturnType<typeof createMemoryStore>,
  id: string,
  scale: number,
  view: { width: number; height: number },
): AxisRect {
  const fit = deriveCameraLimits(store.contentBoxes(), view.width, view.height).fitScale;
  const found = store
    .query({
      bounds: span,
      scale,
      fitScale: fit,
      viewWidth: view.width,
      viewHeight: view.height,
    })
    .find((entry) => entry.object.id === id);
  if (!found || (found.object.payload.type !== 'image' && found.object.payload.type !== 'text')) {
    throw new Error(`expected ${id} in the query at scale ${scale}`);
  }
  return {
    x: found.object.x,
    y: found.object.y,
    width: found.object.payload.width,
    height: found.object.payload.height,
  };
}

function boundsOf(rect: AxisRect): ViewBounds {
  return {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
}
