import { describe, expect, it } from 'vitest';
import { bootFromLocation, openingCameraFor, resolvePack } from '../content/packs';
import {
  batterySprites,
  INTERNALS_SCALE,
  partSprites,
  PHONE_WIDTH_MM,
  smartphoneObjects,
  smartphonePack,
  smartphoneSprite,
} from '../content/smartphone';
import { initialCameraFor } from './bootstrap';
import { applyCameraCommand, boxFitScale, deriveCameraLimits, viewBounds, type ViewBounds } from './camera';
import { demoPack, titleFitWidth } from './demo';
import { resolveWorldRect, type AxisRect } from './link';
import type { ImagePayload } from './model';
import { relativeZoomAlpha } from './fade';
import { buildLevelPlan } from './levelFade';
import { createMemoryStore } from './store';
import { darkTheme, paperTheme } from './theme';
import { visibilityAlpha } from './visibility';

function phoneObject() {
  const phone = smartphoneObjects.find((object) => object.id === 'phone');
  if (!phone || phone.payload.type !== 'image') throw new Error('expected the phone image');
  return phone;
}

function phonePayload(): ImagePayload {
  const payload = phoneObject().payload;
  if (payload.type !== 'image') throw new Error('expected the phone image');
  return payload;
}

describe('smartphone pack', () => {
  it('is the default, on paper, with a centered phone and parts parented to it', () => {
    expect(resolvePack('').id).toBe('smartphone');
    expect(resolvePack('').pack).toBe(smartphonePack);
    expect(resolvePack('?scale=2').pack.theme).toBe(paperTheme);
    expect(paperTheme.background).toBe('#F3EAD3');
    expect(paperTheme.grid).toBeUndefined();
    expect(smartphonePack.theme).toBe(paperTheme);
    expect(smartphonePack.limits).toBeUndefined();
    const handLabels = [
      'back-glass-label',
      'camera-module-label',
      'battery-label',
      'loudspeaker-label',
      'display-label',
      'logic-board-label',
      'midframe-label',
      'haptic-motor-label',
      'cell-label',
      'protection-board-label',
    ];
    expect(smartphoneObjects.filter((object) => object.payload.type === 'text').map((object) => object.id).slice(0, handLabels.length)).toEqual(handLabels);
    expect(smartphoneObjects.filter((object) => object.payload.type === 'text').length).toBeGreaterThan(handLabels.length);
    const handIds = [
      'internals',
      'battery-internals',
      'back-glass',
      'midframe',
      'cell',
      'protection-board',
      'battery',
      'logic-board',
      'camera-module',
      'loudspeaker',
      'haptic-motor',
      'display',
      'phone',
      'back-glass-label',
      'back-glass-link',
      'camera-module-label',
      'camera-module-link',
      'battery-label',
      'battery-link',
      'loudspeaker-label',
      'loudspeaker-link',
      'display-label',
      'display-link',
      'logic-board-label',
      'logic-board-link',
      'midframe-label',
      'midframe-link',
      'haptic-motor-label',
      'haptic-motor-link',
      'cell-label',
      'cell-link',
      'protection-board-label',
      'protection-board-link',
    ];
    expect(smartphoneObjects.map((object) => object.id).slice(0, handIds.length)).toEqual(handIds);
    expect(smartphoneObjects.length).toBeGreaterThan(handIds.length);
    expect(INTERNALS_SCALE).toBe(0.625);
    const reveal = [1, 1 / INTERNALS_SCALE] as const;
    expect(reveal[1]).toBeCloseTo(1.6);

    const group = smartphoneObjects.find((object) => object.id === 'internals');
    expect(group).toMatchObject({
      parentId: 'phone',
      x: 0,
      y: 0,
      payload: { type: 'group' },
    });
    const nestedGroup = smartphoneObjects.find((object) => object.id === 'battery-internals');
    expect(nestedGroup).toMatchObject({
      parentId: 'battery',
      x: 0,
      y: 0,
      payload: { type: 'group' },
    });
    if (!group || group.scale === undefined || !nestedGroup || nestedGroup.scale === undefined) {
      throw new Error('expected both groups to carry a scale');
    }
    expect(group.scale).toBeGreaterThan(0);
    expect(group.scale).toBeLessThan(1);
    expect(nestedGroup.scale).toBeGreaterThan(0);

    const phone = phoneObject();
    expect(phone.x).toBe(0);
    expect(phone.y).toBe(0);
    expect(phone.parentId).toBeUndefined();
    expect(phone.fade).toEqual({ fadeOut: reveal });
    const payload = phonePayload();
    expect(payload.src).toBe('images/smartphone.webp');
    expect(payload.frame).toBe(false);
    expect(payload.width).toBeCloseTo((PHONE_WIDTH_MM * smartphoneSprite.width) / smartphoneSprite.opaqueWidth);
    expect(payload.height / payload.width).toBeCloseTo(smartphoneSprite.height / smartphoneSprite.width);
    const opaqueWidth = (payload.width * smartphoneSprite.opaqueWidth) / smartphoneSprite.width;
    const opaqueHeight = (payload.height * smartphoneSprite.opaqueHeight) / smartphoneSprite.height;
    expect(opaqueWidth).toBeCloseTo(PHONE_WIDTH_MM);
    expect(opaqueHeight).toBeGreaterThan(140);
    expect(opaqueHeight).toBeLessThan(150);

    const parts: Array<[string, { width: number; height: number; opaqueWidth: number; opaqueHeight: number }, number, number, number, number]> = [
      ['back-glass', partSprites.backGlass, 71.34, -111.205, 0, 0],
      ['midframe', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, 1],
      ['battery', partSprites.battery, 40, -12.6, 10.2, 2],
      ['logic-board', partSprites.logicBoard, 21, 19.8, -44, 3],
      ['camera-module', partSprites.cameraModule, 24.03, -18.8, -47.5, 4],
      ['loudspeaker', partSprites.loudspeaker, 18, -11, 66, 5],
      ['haptic-motor', partSprites.hapticMotor, 22, 13, 66.5, 6],
      ['display', partSprites.display, 71.34, 111.205, 0, 7],
    ];
    const midAuthored = smartphoneObjects.find((object) => object.id === 'midframe');
    if (!midAuthored || midAuthored.payload.type !== 'image') throw new Error('expected the midframe');
    for (const [id, sprite, opaqueMm, x, y, z] of parts) {
      const part = smartphoneObjects.find((object) => object.id === id);
      if (!part || part.payload.type !== 'image') throw new Error(`expected ${id}`);
      expect(part.parentId).toBe('internals');
      expect(part.fade).toEqual({ fadeIn: reveal });
      expect(part.scale).toBeUndefined();
      expect(part.z).toBe(z);
      expect(part.x).toBe(x);
      expect(part.y).toBe(y);
      expect(part.payload.frame).toBe(false);
      expect(part.payload.height / part.payload.width).toBeCloseTo(sprite.height / sprite.width);
      const partOpaqueWidth = (part.payload.width * sprite.opaqueWidth) / sprite.width;
      const partOpaqueHeight = (part.payload.height * sprite.opaqueHeight) / sprite.height;
      expect(partOpaqueWidth).toBeCloseTo(opaqueMm);
      expect(partOpaqueHeight / partOpaqueWidth).toBeCloseTo(sprite.opaqueHeight / sprite.opaqueWidth);
      if (id === 'midframe' || id === 'back-glass' || id === 'display') continue;
      expect(Math.abs(part.x) + part.payload.width / 2).toBeLessThanOrEqual(midAuthored.payload.width / 2 + 1e-9);
      expect(Math.abs(part.y) + part.payload.height / 2).toBeLessThanOrEqual(midAuthored.payload.height / 2 + 1e-9);
    }
  });

  it('fits the opening camera to the phone on a desktop and a narrow viewport', () => {
    for (const [viewW, viewH] of [
      [1280, 800],
      [390, 844],
    ] as const) {
      const opening = openingCameraFor('smartphone', smartphonePack, viewW, viewH);
      const limits = deriveCameraLimits(createMemoryStore(smartphoneObjects).contentBoxes(), viewW, viewH);
      const payload = phonePayload();
      expect(opening.scale).toBeCloseTo(limits.minScale);
      expect(opening.scale).toBeCloseTo(limits.fitScale);
      expect(limits.maxScale / limits.fitScale).toBeGreaterThanOrEqual(5);
      const boxes = createMemoryStore(smartphoneObjects).contentBoxes();
      const pan = limits.bounds;
      if (!pan) throw new Error('expected pan bounds');
      // The fitted centre is the content centre. Labels sit just off their parts.
      expect(opening.y).toBeCloseTo((pan.top + pan.bottom) / 2);
      expect(opening.x).toBeCloseTo((pan.left + pan.right) / 2);
      for (const entry of boxes) {
        expect(entry.box.left).toBeGreaterThanOrEqual(pan.left);
        expect(entry.box.right).toBeLessThanOrEqual(pan.right);
        expect(entry.box.top).toBeGreaterThanOrEqual(pan.top);
        expect(entry.box.bottom).toBeLessThanOrEqual(pan.bottom);
      }
      const deep = applyCameraCommand(
        opening,
        { type: 'zoomAt', x: viewW / 2, y: viewH / 2, factor: 5 },
        viewW,
        viewH,
        limits,
      );
      expect(deep.scale).toBeCloseTo(opening.scale * 5);
      expect(visibilityAlpha(phoneObject().visibility, opening.scale)).toBe(1);

      const cssW = payload.width * opening.scale;
      const cssH = payload.height * opening.scale;
      expect(cssW).toBeLessThan(viewW * 0.9);
      expect(cssH).toBeLessThan(viewH * 0.9);
      // Desktop is tall-phone limited, so the front still fills most of the height.
      // A narrow window fits the wide row, so the front is a smaller share of the width.
      expect(Math.max(cssW / viewW, cssH / viewH)).toBeGreaterThan(viewW >= 1000 ? 0.65 : 0.25);

      const bounds = viewBounds(opening, viewW, viewH);
      expect(bounds.left).toBeLessThan(-payload.width / 2);
      expect(bounds.right).toBeGreaterThan(payload.width / 2);
      expect(bounds.top).toBeLessThan(-payload.height / 2);
      expect(bounds.bottom).toBeGreaterThan(payload.height / 2);

      const panned = applyCameraCommand(
        opening,
        { type: 'panBy', dx: 4000, dy: -2500 },
        viewW,
        viewH,
        limits,
      );
      expect(panned.x).toBeCloseTo(opening.x);
      expect(panned.y).toBeCloseTo(opening.y);
      expect(panned.scale).toBeCloseTo(limits.minScale);

      const zoomedOut = applyCameraCommand(
        opening,
        { type: 'zoomAt', x: viewW / 2, y: viewH / 2, factor: 0.4 },
        viewW,
        viewH,
        limits,
      );
      expect(zoomedOut.scale).toBeCloseTo(limits.minScale);
      expect(zoomedOut.x).toBeCloseTo(opening.x);
      expect(zoomedOut.y).toBeCloseTo(opening.y);
    }
  });

  it('shrinks the internals by one group scale and fades them in when that scale fills the opening', () => {
    const reveal = 1 / INTERNALS_SCALE;
    const view = { width: 1280, height: 800 };
    const fit = deriveCameraLimits(createMemoryStore(smartphoneObjects).contentBoxes(), view.width, view.height).fitScale;
    const store = createMemoryStore(smartphoneObjects);
    const span = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
    const at = (ratio: number) =>
      store.query({
        bounds: span,
        scale: fit * ratio,
        fitScale: fit,
        viewWidth: view.width,
        viewHeight: view.height,
      });

    expect(at(1).map((entry) => entry.object.id)).toEqual(['phone']);
    expect(at(reveal).map((entry) => entry.object.id)).not.toContain('phone');
    expect(at(reveal).map((entry) => entry.object.id)).not.toContain('internals');
    expect(at(reveal).map((entry) => entry.object.id)).not.toContain('cell');
    expect(store.countInBand(fit, fit, view)).toBe(1);
    expect(store.countInBand(fit * reveal, fit, view)).toBe(16);
    const revealed = at(reveal).map((entry) => entry.object.id);
    expect(revealed).toEqual(expect.arrayContaining([
      'back-glass-label',
      'camera-module-label',
      'battery-label',
      'loudspeaker-label',
      'display-label',
      'logic-board-label',
      'midframe-label',
      'haptic-motor-label',
    ]));
    expect(revealed.some((id) => id.endsWith('-link'))).toBe(false);

    const front = (ratio: number) => Math.min(1, Math.max(0, 1 - (ratio - 1) / (reveal - 1)));
    for (const ratio of [0.5, 1, 1.3, 1.6, 2.5]) {
      expect(relativeZoomAlpha({ fadeOut: [1, reveal] }, ratio)).toBeCloseTo(front(ratio));
      expect(relativeZoomAlpha({ fadeIn: [1, reveal] }, ratio)).toBeCloseTo(1 - front(ratio));
    }

    const open = at(reveal);
    const mid = open.find((entry) => entry.object.id === 'midframe');
    const battery = open.find((entry) => entry.object.id === 'battery');
    const authoredMid = smartphoneObjects.find((object) => object.id === 'midframe');
    const authoredBattery = smartphoneObjects.find((object) => object.id === 'battery');
    if (!mid || mid.object.payload.type !== 'image') throw new Error('expected the midframe');
    if (!battery || battery.object.payload.type !== 'image') throw new Error('expected the battery');
    if (!authoredMid || authoredMid.payload.type !== 'image') throw new Error('expected the authored midframe');
    if (!authoredBattery || authoredBattery.payload.type !== 'image') throw new Error('expected the authored battery');

    // Wide window: back glass, midframe and its parts, display, left to right.
    const display = open.find((entry) => entry.object.id === 'display');
    const backGlass = open.find((entry) => entry.object.id === 'back-glass');
    if (!display || !backGlass) throw new Error('expected the plates');
    expect(backGlass.object.x).toBeLessThan(battery.object.x);
    expect(battery.object.x).toBeLessThan(mid.object.x);
    expect(mid.object.x).toBeLessThan(display.object.x);
    expect(Math.abs(display.object.y - mid.object.y)).toBeLessThan(mid.object.payload.height);

    const shown = { scale: fit * reveal, width: view.width, height: view.height };
    const imageIds = levelImageIds('internals');
    const placed = unionRects(imageIds.map((id) => mustRect(id)));
    const screenW = placed.width * shown.scale;
    const screenH = placed.height * shown.scale;
    const fill = Math.max(screenW / view.width, screenH / view.height);
    expect(fill).toBeGreaterThan(0.83);
    expect(fill).toBeLessThan(0.88);
    const labelPx = mustRect('battery-label').height * shown.scale;
    expect(labelPx).toBeGreaterThan(16);
    expect(labelPx).toBeLessThan(21);
    expect(pairClearance(mustRect('back-glass'), mustRect('midframe'))).toBeGreaterThan(0);
    expect(pairClearance(mustRect('midframe'), mustRect('display'))).toBeGreaterThan(0);

    const narrow = { width: 390, height: 844 };
    const narrowFit = deriveCameraLimits(store.contentBoxes(), narrow.width, narrow.height).fitScale;
    const narrowMid = mustRect('midframe');
    const narrowDisplay = mustRect('display');
    const narrowBack = mustRect('back-glass');
    // One layout: the wide row, on a tall window too.
    expect(narrowBack.x).toBeLessThan(narrowMid.x);
    expect(narrowMid.x).toBeLessThan(narrowDisplay.x);
    expect(narrowBack.y).toBeCloseTo(narrowMid.y);
    expect(narrowDisplay.y).toBeCloseTo(narrowMid.y);
    const opening = openingCameraFor('smartphone', smartphonePack, narrow.width, narrow.height);
    expect(opening.scale).toBeCloseTo(narrowFit);
    for (const object of smartphoneObjects) {
      if (object.payload.type !== 'image' && object.payload.type !== 'text') continue;
      const box = mustRect(object.id);
      const left = (box.x - box.width / 2 - opening.x) * opening.scale + narrow.width / 2;
      const right = (box.x + box.width / 2 - opening.x) * opening.scale + narrow.width / 2;
      const top = (box.y - box.height / 2 - opening.y) * opening.scale + narrow.height / 2;
      const bottom = (box.y + box.height / 2 - opening.y) * opening.scale + narrow.height / 2;
      expect(left, object.id).toBeGreaterThanOrEqual(0);
      expect(right, object.id).toBeLessThanOrEqual(narrow.width);
      expect(top, object.id).toBeGreaterThanOrEqual(0);
      expect(bottom, object.id).toBeLessThanOrEqual(narrow.height);
    }
  });

  it('keeps every part leader at least 15° off the axes', () => {
    const names: Record<string, string> = {
      'back-glass': 'Back glass',
      battery: 'Battery',
      'logic-board': 'Logic board',
      'camera-module': 'Camera',
      midframe: 'Midframe',
      loudspeaker: 'Speaker',
      'haptic-motor': 'Haptic motor',
      display: 'Display',
    };
    const parts = smartphoneObjects.filter(
      (object) => object.parentId === 'internals' && object.payload.type === 'image',
    );
    expect(parts.map((part) => part.id).sort()).toEqual(Object.keys(names).sort());

    for (const part of parts) {
      const label = smartphoneObjects.find((object) => object.id === `${part.id}-label`);
      const link = smartphoneObjects.find((object) => object.id === `${part.id}-link`);
      if (!label || label.payload.type !== 'text') throw new Error(`expected a label for ${part.id}`);
      if (!link || link.payload.type !== 'link') throw new Error(`expected a link for ${part.id}`);
      expect(label.parentId).toBe('internals');
      expect(label.fade).toEqual({ fadeIn: [1, 1 / INTERNALS_SCALE] });
      expect(label.payload).toMatchObject({
        text: names[part.id],
        style: { fontSize: 4.2 },
        height: 4.2,
      });
      expect(label.payload.style.color).toBeUndefined();
      expect(label.payload.style.fontFamily).toBeUndefined();
      expect(link.payload).toEqual({ type: 'link', from: label.id, to: part.id });

      const from = resolveWorldRect(smartphoneObjects, label.id);
      const to = resolveWorldRect(smartphoneObjects, part.id);
      if (!from || !to) throw new Error(`expected world boxes for ${part.id}`);
      const angle = axisClearanceDegrees(from, to);
      expect(angle, part.id).toBeGreaterThanOrEqual(20);
    }

    const inside: Record<string, string> = {
      cell: 'Cell',
      'protection-board': 'Protection board',
    };
    const nested = smartphoneObjects.filter(
      (object) => object.parentId === 'battery-internals' && object.payload.type === 'image',
    );
    expect(nested.map((part) => part.id).sort()).toEqual(Object.keys(inside).sort());
    for (const part of nested) {
      const label = smartphoneObjects.find((object) => object.id === `${part.id}-label`);
      const link = smartphoneObjects.find((object) => object.id === `${part.id}-link`);
      if (!label || label.payload.type !== 'text') throw new Error(`expected a label for ${part.id}`);
      if (!link || link.payload.type !== 'link') throw new Error(`expected a link for ${part.id}`);
      expect(label.parentId).toBe('battery-internals');
      expect(label.fade).toEqual(part.fade);
      expect(part.fade).toEqual({ fadeIn: [1, 1 / INTERNALS_SCALE], fadeInOf: 'battery' });
      expect(label.payload).toMatchObject({
        text: inside[part.id],
        style: { fontSize: 4.2 },
        height: 4.2,
      });
      expect(label.payload.style.color).toBeUndefined();
      expect(label.payload.style.fontFamily).toBeUndefined();
      expect(link.payload).toEqual({ type: 'link', from: label.id, to: part.id });
      const from = resolveWorldRect(smartphoneObjects, label.id);
      const to = resolveWorldRect(smartphoneObjects, part.id);
      if (!from || !to) throw new Error(`expected world boxes for ${part.id}`);
      expect(axisClearanceDegrees(from, to), part.id).toBeGreaterThanOrEqual(20);
    }
  });

  it('links a label to every part image that has a parent', () => {
    const parts = smartphoneObjects.filter(
      (object) => object.parentId !== undefined && object.payload.type === 'image',
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const link = smartphoneObjects.find((object) => {
        if (object.payload.type !== 'link') return false;
        return object.payload.from === part.id || object.payload.to === part.id;
      });
      expect(link, `${part.id} has no leader`).toBeDefined();
      if (!link || link.payload.type !== 'link') continue;
      const labelId = link.payload.from === part.id ? link.payload.to : link.payload.from;
      const label = smartphoneObjects.find((object) => object.id === labelId);
      expect(label?.payload.type, `${part.id} is not linked to a label`).toBe('text');
    }
  });

  it('keeps part labels off the phone, the parts, and each other, and inside the pan bounds', () => {
    const labels = smartphoneObjects.filter((object) => object.payload.type === 'text');
    const solids = smartphoneObjects.filter(
      (object) => object.payload.type === 'image' || object.payload.type === 'shape',
    );
    const boxes = [...labels, ...solids].map((object) => {
      const box = resolveWorldRect(smartphoneObjects, object.id);
      if (!box) throw new Error(`expected a world box for ${object.id}`);
      return { id: object.id, parentId: object.parentId, box };
    });

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const labelInvolved = a.id.endsWith('-label') || b.id.endsWith('-label');
        if (!labelInvolved) continue;
        // Only siblings are on screen together. A nested label sits inside an
        // ancestor plate; that plate has already faded out.
        if (a.parentId !== b.parentId) continue;
        expect(rectsOverlap(a.box, b.box), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }

    const desktop = { width: 1280, height: 800 };
    const fit = deriveCameraLimits(createMemoryStore(smartphoneObjects).contentBoxes(), desktop.width, desktop.height).fitScale;
    const phoneView = { scale: fit / INTERNALS_SCALE, fitScale: fit, width: desktop.width, height: desktop.height };
    for (const label of labels) {
      if (label.parentId !== 'internals') continue;
      const box = resolveWorldRect(smartphoneObjects, label.id);
      if (!box) throw new Error(`expected a world box for ${label.id}`);
      const left = (box.x - box.width / 2) * phoneView.scale + desktop.width / 2;
      const right = (box.x + box.width / 2) * phoneView.scale + desktop.width / 2;
      const top = (box.y - box.height / 2) * phoneView.scale + desktop.height / 2;
      const bottom = (box.y + box.height / 2) * phoneView.scale + desktop.height / 2;
      expect(left, label.id).toBeGreaterThan(0);
      expect(right, label.id).toBeLessThan(desktop.width);
      expect(top, label.id).toBeGreaterThan(0);
      expect(bottom, label.id).toBeLessThan(desktop.height);
    }

    const leaders = partsAndLabels();
    const byParent = new Map<string, typeof leaders>();
    for (const leader of leaders) {
      const key = parentOf(leader.toId) ?? '';
      const list = byParent.get(key) ?? [];
      list.push(leader);
      byParent.set(key, list);
    }
    for (const group of byParent.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i];
          const b = group[j];
          if (!a || !b) continue;
          expect(segmentsCross(a.from, a.to, b.from, b.to), `${a.id} crosses ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('fades the battery out across its own fit and brings the cell and board in', () => {
    const reveal = 1 / INTERNALS_SCALE;
    const desktop = { width: 1280, height: 800 };
    const store = createMemoryStore(smartphoneObjects);
    const fit = deriveCameraLimits(store.contentBoxes(), desktop.width, desktop.height).fitScale;
    const batteryFit = boxFitScale(boundsOf(mustRect('battery')), desktop.width, desktop.height);
    expect(batteryFit).toBeGreaterThan(fit * reveal);

    const narrow = { width: 390, height: 844 };
    const narrowFit = deriveCameraLimits(store.contentBoxes(), narrow.width, narrow.height).fitScale;
    expect(boxFitScale(boundsOf(mustRect('battery')), narrow.width, narrow.height)).toBeGreaterThan(narrowFit * reveal);

    const batteryCentre = mustRect('battery');
    const span = {
      left: batteryCentre.x - 1e6,
      right: batteryCentre.x + 1e6,
      top: batteryCentre.y - 1e6,
      bottom: batteryCentre.y + 1e6,
    };
    const idsAt = (ratio: number) =>
      store
        .query({
          bounds: span,
          scale: batteryFit * ratio,
          fitScale: fit,
          viewWidth: desktop.width,
          viewHeight: desktop.height,
        })
        .map((entry) => entry.object.id);

    // Larger parts have already finished their own handover by the time the
    // battery fills the view. The battery stays, on its own curve. The cell
    // has not started. Only the battery's children come in after that.
    expect(idsAt(1)).toEqual(expect.arrayContaining(['battery', 'battery-label']));
    expect(idsAt(1)).not.toEqual(expect.arrayContaining(['cell', 'cell-label', 'protection-board', 'loudspeaker', 'midframe']));
    expect(idsAt(reveal)).not.toEqual(expect.arrayContaining(['battery', 'loudspeaker', 'midframe', 'display']));
    expect(idsAt(reveal)).toEqual(
      expect.arrayContaining(['cell', 'protection-board', 'cell-label', 'protection-board-label']),
    );
    expect(idsAt(2.5)).not.toEqual(expect.arrayContaining(['battery', 'loudspeaker', 'midframe']));
    expect(idsAt(2.5)).toEqual(expect.arrayContaining(['cell', 'protection-board', 'cell-label', 'protection-board-label']));
    expect(idsAt(1)).toEqual(expect.arrayContaining(['battery', 'battery-label']));

    const planAt = (ratio: number, id: string) => {
      const batteryNow = mustRect('battery');
      return buildLevelPlan(
        smartphoneObjects,
        (objectId) => {
          const rect = resolveWorldRect(smartphoneObjects, objectId);
          return rect ? boundsOf(rect) : undefined;
        },
        batteryFit * ratio,
        { x: batteryNow.x, y: batteryNow.y },
        desktop,
      ).opacity(id);
    };
    expect(planAt(1, 'battery')).toBeCloseTo(1);
    expect(planAt(1, 'battery-label')).toBeCloseTo(1);
    expect(planAt(1, 'midframe')).toBeCloseTo(0);
    expect(planAt(1.3, 'midframe')).toBeCloseTo(0);
    expect(planAt(1.3, 'logic-board-label')).toBeCloseTo(0);
    expect(planAt(1.3, 'battery')).toBeCloseTo(0.5);
    expect(planAt(1.3, 'battery-label')).toBeCloseTo(0.5);
    expect(planAt(reveal, 'camera-module')).toBeCloseTo(0);
    expect(planAt(2.5, 'haptic-motor')).toBe(0);
    expect(planAt(1, 'loudspeaker')).toBeCloseTo(0);
    // The cell level fades in on its own anchor. The handover does not dim it,
    // and the phone's own fade is left alone.
    expect(planAt(1.3, 'cell')).toBe(1);
    expect(planAt(1.3, 'protection-board')).toBe(1);
    expect(planAt(1.3, 'cell-label')).toBe(1);
    expect(planAt(1.3, 'protection-board-label')).toBe(1);
    expect(planAt(1.3, 'phone')).toBe(1);
    expect(planAt(2.5, 'phone')).toBe(1);

    const battery = mustRect('battery');
    expect(store.countInBand(batteryFit, fit, desktop, { x: battery.x, y: battery.y })).toBe(2);
    expect(store.countInBand(batteryFit * 1.3, fit, desktop, { x: battery.x, y: battery.y })).toBe(6);
    expect(store.countInBand(batteryFit * reveal, fit, desktop, { x: battery.x, y: battery.y })).toBe(4);

    const view = desktop;
    const at = (ratio: number) => ({ x: battery.x, y: battery.y, scale: batteryFit * ratio });
    const cellAt = () => mustRect('cell');
    const boardAt = () => mustRect('protection-board');
    expect(store.hitTest({ x: cellAt().x, y: cellAt().y }, at(1), fit, view)?.id).toBe('battery');
    expect(store.hitTest({ x: cellAt().x, y: cellAt().y }, at(reveal), fit, view)?.id).toBe('cell');
    expect(store.hitTest({ x: boardAt().x, y: boardAt().y }, at(reveal), fit, view)?.id).toBe('protection-board');

    const limits = deriveCameraLimits(store.contentBoxes(), desktop.width, desktop.height);
    expect(limits.maxScale).toBeGreaterThanOrEqual(batteryFit * 2.5);
    const boardObject = smartphoneObjects.find((object) => object.id === 'protection-board');
    const cellObject = smartphoneObjects.find((object) => object.id === 'cell');
    if (!boardObject || boardObject.payload.type !== 'image') throw new Error('expected the protection board');
    if (!cellObject || cellObject.payload.type !== 'image') throw new Error('expected the cell');
    expect(visibilityAlpha(boardObject.visibility, batteryFit * 2.5)).toBe(1);
    expect(cellObject.payload.src).toBe('images/smartphone/battery-cell.webp');
    expect(boardObject.payload.src).toBe('images/smartphone/battery-controller.webp');
    const cellOpaque = (cellObject.payload.width * batterySprites.cell.opaqueWidth) / batterySprites.cell.width;
    const boardOpaque =
      (boardObject.payload.width * batterySprites.protectionBoard.opaqueWidth) /
      batterySprites.protectionBoard.width;
    expect(cellOpaque).toBeCloseTo(39);
    expect(boardOpaque).toBeCloseTo(40);
    const cellBox = mustRect('cell');
    const boardBox = mustRect('protection-board');
    expect(boardBox.y + boardBox.height / 2).toBeLessThan(cellBox.y - cellBox.height / 2);
    const level = unionRects([cellBox, boardBox]);
    const revealScale = batteryFit * reveal;
    const fill = Math.max((level.width * revealScale) / desktop.width, (level.height * revealScale) / desktop.height);
    expect(fill).toBeGreaterThan(0.83);
    expect(fill).toBeLessThan(0.88);
    const cellLabelPx = mustRect('cell-label').height * revealScale;
    expect(cellLabelPx).toBeGreaterThan(16);
    expect(cellLabelPx).toBeLessThan(21);
    expect(pairClearance(cellBox, boardBox)).toBeGreaterThan(0);
  });
});

function levelImageIds(groupId: string): string[] {
  const ids: string[] = [];
  for (const object of smartphoneObjects) {
    if (object.parentId === groupId && object.payload.type === 'image') ids.push(object.id);
  }
  return ids;
}

function unionRects(rects: readonly AxisRect[]): { width: number; height: number } {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.x - rect.width / 2);
    right = Math.max(right, rect.x + rect.width / 2);
    top = Math.min(top, rect.y - rect.height / 2);
    bottom = Math.max(bottom, rect.y + rect.height / 2);
  }
  return { width: right - left, height: bottom - top };
}

function pairClearance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const dx = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  const dy = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  if (dx >= 0) return dx;
  if (dy >= 0) return dy;
  return Math.max(dx, dy);
}

function mustRect(id: string): AxisRect {
  const rect = resolveWorldRect(smartphoneObjects, id);
  if (!rect) throw new Error(`expected a world rect for ${id}`);
  return rect;
}

function boundsOf(rect: AxisRect): ViewBounds {
  return {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
}

/** Degrees from the nearest axis. 0 is horizontal or vertical. */
function axisClearanceDegrees(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const degrees = Math.abs(Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI));
  const toHorizontal = Math.min(degrees, 180 - degrees);
  const toVertical = Math.abs(degrees - 90);
  return Math.min(toHorizontal, toVertical);
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2
  );
}

function partsAndLabels(): Array<{
  id: string;
  toId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}> {
  const leaders = [];
  for (const object of smartphoneObjects) {
    if (object.payload.type !== 'link') continue;
    const from = resolveWorldRect(smartphoneObjects, object.payload.from);
    const to = resolveWorldRect(smartphoneObjects, object.payload.to);
    if (!from || !to) throw new Error(`expected endpoints for ${object.id}`);
    leaders.push({ id: object.id, toId: object.payload.to, from, to });
  }
  return leaders;
}

function parentOf(id: string): string | undefined {
  return smartphoneObjects.find((object) => object.id === id)?.parentId;
}

function orient(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

describe('pack query', () => {
  it('loads the archipelago pack from ?pack=archipelago in dev and production', () => {
    expect(resolvePack('?pack=archipelago').id).toBe('archipelago');
    expect(resolvePack('?pack=archipelago').pack).toBe(demoPack);
    expect(resolvePack('?pack=archipelago&scale=2&x=-3012&y=-1112').pack.theme).toBe(darkTheme);
    expect(resolvePack('?pack=other').id).toBe('smartphone');

    const desktop = openingCameraFor('archipelago', demoPack, 1440, 900);
    expect(desktop).toEqual(initialCameraFor(1440, titleFitWidth));
    const narrow = openingCameraFor('archipelago', demoPack, 390, 844);
    expect(narrow.scale).toBeLessThan(0.06);
    expect(narrow).toMatchObject({ x: 0, y: -80 });

    const prod = bootFromLocation('?pack=archipelago&theme=paper', 1280, 800, false);
    expect(prod.id).toBe('archipelago');
    expect(prod.pack).toBe(demoPack);
    expect(prod.theme).toBe(darkTheme);
    expect(prod.opening).toEqual(initialCameraFor(1280, titleFitWidth));

    const dev = bootFromLocation('?pack=archipelago&theme=paper', 1280, 800, true);
    expect(dev.pack).toBe(demoPack);
    expect(dev.theme).toBe(paperTheme);

    const page = bootFromLocation('', 1280, 800, false);
    expect(page.id).toBe('smartphone');
    expect(page.theme).toBe(paperTheme);
    expect(page.opening.scale).toBeGreaterThan(1);

    const wharf = bootFromLocation('?pack=archipelago&scale=2&x=-3012&y=-1112', 1280, 800, false);
    expect(wharf.opening).toEqual({ x: -3012, y: -1112, scale: 2 });
    expect(wharf.theme).toBe(darkTheme);
  });
});
