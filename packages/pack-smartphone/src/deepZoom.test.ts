import {
  boxFitScale,
  createMemoryStore,
  frameOn,
  MAX_SCALE,
  projectCss,
  resolveWorldRect,
  viewBounds,
  type ViewBounds,
} from '@apeiron/core';
import { describe, expect, it } from 'vitest';
import { hierarchyNodes } from './hierarchy.generated';
import { smartphoneLayoutReport, smartphoneObjects } from './smartphone';

const view = { width: 1280, height: 800 };

const carbonPath = [
  'phone',
  'battery',
  'cell',
  'electrode-stack',
  'electrode-repeat',
  'anode',
  'graphite-coating',
  'graphite-particle',
  'graphite-particle-scale-window-1',
  'graphite-particle-scale-window-2',
  'graphite-particle-scale-window-3',
  'graphite-crystal',
  'graphite-carbon-atom',
] as const;

const lithiumPath = [
  'phone',
  'battery',
  'cell',
  'electrode-stack',
  'electrode-repeat',
  'cathode',
  'lco-particle',
  'lco-particle-scale-window-1',
  'lco-particle-scale-window-2',
  'lco-particle-scale-window-3',
  'lco-lattice',
  'lithium-ions',
] as const;

const siliconPath = [
  'phone',
  'logic-board',
  'system-on-chip',
  'soc-die',
  'cpu-gpu-cores',
  'cpu-gpu-cores-scale-window-1',
  'cpu-gpu-cores-scale-window-2',
  'standard-cell',
  'transistor',
  'gate-stack',
  'silicon-lattice',
  'silicon-atom',
] as const;

const hafniaPath = [
  'phone',
  'logic-board',
  'system-on-chip',
  'soc-die',
  'cpu-gpu-cores',
  'cpu-gpu-cores-scale-window-1',
  'cpu-gpu-cores-scale-window-2',
  'standard-cell',
  'transistor',
  'gate-stack',
  'gate-dielectric',
  'hafnia-network',
  'hafnium-site',
] as const;

describe('smartphone deep zoom', () => {
  const opening = frameOn(smartphoneObjects, 'phone', view.width, view.height);

  it('places every hierarchy node and keeps the hand-authored parts', () => {
    expect(hierarchyNodes).toHaveLength(188);
    expect(smartphoneLayoutReport.unplaced).toEqual([]);
    const ids = new Set(smartphoneObjects.map((object) => object.id));
    for (const node of hierarchyNodes) {
      expect(ids.has(node.id), node.id).toBe(true);
      if (node.id === 'phone') continue;
      expect(ids.has(`${node.id}-label`), node.id).toBe(true);
      expect(ids.has(`${node.id}-link`), node.id).toBe(true);
    }
    const transistor = smartphoneObjects.find((object) => object.id === 'transistor-label');
    expect(transistor?.payload).toMatchObject({ type: 'text', text: 'Transistor ×~15 billion' });
    const art = ['pouch', 'electrode-stack', 'anode', 'graphite-particle', 'graphite-carbon-sheet', 'graphite-carbon-atom'];
    for (const id of art) {
      const object = smartphoneObjects.find((entry) => entry.id === id);
      expect(object?.payload).toMatchObject({ type: 'image', frame: false });
      const node = hierarchyNodes.find((entry) => entry.id === id);
      expect(node?.status).toBe('built');
    }
    const planned = hierarchyNodes.filter((node) => node.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    for (const node of planned) {
      const object = smartphoneObjects.find((entry) => entry.id === node.id);
      expect(object?.payload.type, node.id).toBe('shape');
    }
  });

  it('walks the phone down to a carbon atom and to silicon and hafnia', () => {
    expect(opening).not.toBeNull();
    for (const id of [...carbonPath, ...lithiumPath, ...siliconPath, ...hafniaPath]) {
      expectVisibleAtFit(id, opening?.scale ?? 1);
    }
    const phone = resolveWorldRect(smartphoneObjects, 'phone');
    const atom = resolveWorldRect(smartphoneObjects, 'graphite-carbon-atom');
    if (!phone || !atom || !opening) throw new Error('expected the phone and the carbon atom');
    const atomFit = fitOf(atom);
    expect(atomFit / opening.scale).toBeGreaterThan(1e8);
    expect(atomFit).toBeLessThanOrEqual(MAX_SCALE);
    // The atom is on the order of 0.15 nm against a ~150 mm phone.
    expect(phone.height / atom.height).toBeGreaterThan(1e8);
  });

  it('gives every node one diagonal label, about 18px at its level', () => {
    for (const node of hierarchyNodes) {
      if (node.id === 'phone') continue;
      const label = smartphoneObjects.find((object) => object.id === `${node.id}-label`);
      const link = smartphoneObjects.find((object) => object.id === `${node.id}-link`);
      expect(label?.payload.type, node.id).toBe('text');
      expect(link?.payload, node.id).toEqual({ type: 'link', from: `${node.id}-label`, to: node.id });
      if (!label || label.payload.type !== 'text') continue;
      const from = resolveWorldRect(smartphoneObjects, label.id);
      const to = resolveWorldRect(smartphoneObjects, node.id);
      if (!from || !to) throw new Error(`expected boxes for ${node.id}`);
      expect(axisClearance(from, to), node.id).toBeGreaterThanOrEqual(20);
      if (label.parentId === 'internals' || label.parentId === 'battery-internals') continue;
      const anchorId = label.fade?.fadeInOf;
      const anchor = anchorId ? resolveWorldRect(smartphoneObjects, anchorId) : null;
      if (!anchor) throw new Error(`expected an anchor for ${node.id}`);
      const level = fitOf(anchor) * (label.fade?.fadeIn?.[1] ?? 1.6);
      // Generated labels set fontSize so this product is the on-screen face.
      // The renderer multiplies fontSize by the camera scale and does not
      // apply the parent scale again.
      const screenFont = label.payload.style.fontSize * level;
      expect(screenFont, node.id).toBeGreaterThan(15.99);
      expect(screenFont, node.id).toBeLessThan(20.01);
    }
  });
});

function axisClearance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const degrees = Math.abs(Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI));
  return Math.min(Math.min(degrees, 180 - degrees), Math.abs(degrees - 90));
}

function expectVisibleAtFit(id: string, fitScale: number) {
  const rect = resolveWorldRect(smartphoneObjects, id);
  expect(rect, id).not.toBeNull();
  if (!rect) return;
  const scale = fitOf(rect);
  const camera = { x: rect.x, y: rect.y, scale };
  const shown = storeQuery(camera, fitScale);
  expect(shown.some((entry) => entry === id), `${id} is not visible at its fit`).toBe(true);
  const css = projectCss(smartphoneObjects, id, camera, view.width, view.height);
  expect(css, id).not.toBeNull();
  if (!css) return;
  const cx = css.left + css.width / 2;
  const cy = css.top + css.height / 2;
  expect(Math.abs(cx - view.width / 2), `${id} x`).toBeLessThan(2);
  expect(Math.abs(cy - view.height / 2), `${id} y`).toBeLessThan(2);
  expect(css.left, `${id} left`).toBeLessThan(view.width);
  expect(css.left + css.width, `${id} right`).toBeGreaterThan(0);
  expect(css.top, `${id} top`).toBeLessThan(view.height);
  expect(css.top + css.height, `${id} bottom`).toBeGreaterThan(0);
  expect(Math.min(css.width, css.height), `${id} size`).toBeGreaterThan(32);
}

function fitOf(rect: { x: number; y: number; width: number; height: number }): number {
  const bounds: ViewBounds = {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
  return boxFitScale(bounds, view.width, view.height);
}

function storeQuery(camera: { x: number; y: number; scale: number }, fitScale: number): string[] {
  return createMemoryStore(smartphoneObjects)
    .query({
      bounds: viewBounds(camera, view.width, view.height),
      scale: camera.scale,
      fitScale,
      viewWidth: view.width,
      viewHeight: view.height,
    })
    .map((entry) => entry.object.id);
}
