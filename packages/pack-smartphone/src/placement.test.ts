import {
  boxFitScale,
  createMemoryStore,
  deriveCameraLimits,
  resolveWorldRect,
  type AxisRect,
  type ViewBounds,
} from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { smartphoneObjects } from './smartphone';

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
    const onBattery = { x: battery.x, y: battery.y };
    assertFixed(store, 'display', openingFit, [1.05, 1.2, 1.3, 1.45, 1.6]);
    assertFixed(store, 'display-label', openingFit, [1.05, 1.2, 1.3, 1.45, 1.6]);
    assertFixed(store, 'cell', batteryFit, [1.05, 1.3, 1.6, 2, 2.5], onBattery);
    assertFixed(store, 'cell-label', batteryFit, [1.05, 1.3, 1.6, 2, 2.5], onBattery);

    // One deep node, across the crossfade that reveals it. The camera is on
    // that node, and the rect still does not depend on zoom or viewport.
    const crystal = resolveWorldRect(smartphoneObjects, 'graphite-crystal');
    if (!crystal) throw new Error('expected the graphite crystal');
    const crystalFit = (view: { width: number; height: number }) =>
      boxFitScale(boundsOf(crystal), view.width, view.height);
    const onCrystal = { x: crystal.x, y: crystal.y };
    assertFixed(store, 'graphite-carbon-atom', crystalFit, [1.05, 1.2, 1.3, 1.45, 1.6], onCrystal);
    assertFixed(store, 'graphite-carbon-atom-label', crystalFit, [1.05, 1.2, 1.3, 1.45, 1.6], onCrystal);
  });
});

function assertFixed(
  store: ReturnType<typeof createMemoryStore>,
  id: string,
  referenceOf: (view: { width: number; height: number }) => number,
  ratios: readonly number[],
  focus?: { x: number; y: number },
): void {
  const geometric = resolveWorldRect(smartphoneObjects, id);
  if (!geometric) throw new Error(`expected a world rect for ${id}`);
  for (const view of [desktop, phone]) {
    const reference = referenceOf(view);
    for (const ratio of ratios) {
      expect(shownRect(store, id, reference * ratio, view, focus), `${id} at ${ratio} on ${view.width}×${view.height}`).toEqual(geometric);
    }
  }
}

function shownRect(
  store: ReturnType<typeof createMemoryStore>,
  id: string,
  scale: number,
  view: { width: number; height: number },
  focus?: { x: number; y: number },
): AxisRect {
  const fit = deriveCameraLimits(store.contentBoxes(), view.width, view.height).fitScale;
  const bounds = focus
    ? { left: focus.x - 1e6, right: focus.x + 1e6, top: focus.y - 1e6, bottom: focus.y + 1e6 }
    : span;
  const found = store
    .query({
      bounds,
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
