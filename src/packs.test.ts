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
import { explodeLevel, type LevelPart } from './placement';
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
    expect(smartphoneObjects.filter((object) => object.payload.type === 'text').map((object) => object.id)).toEqual([
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
    ]);
    expect(smartphoneObjects.map((object) => object.id)).toEqual([
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
    ]);
    expect(INTERNALS_SCALE).toBe(0.625);
    const reveal = [1, 1 / INTERNALS_SCALE] as const;
    expect(reveal[1]).toBeCloseTo(1.6);

    const group = smartphoneObjects.find((object) => object.id === 'internals');
    expect(group).toMatchObject({
      parentId: 'phone',
      x: 0,
      y: 0,
      scale: INTERNALS_SCALE,
      payload: { type: 'group', explode: expect.any(Number) },
    });
    const nestedGroup = smartphoneObjects.find((object) => object.id === 'battery-internals');
    expect(nestedGroup).toMatchObject({
      parentId: 'battery',
      x: 0,
      y: 0,
      scale: INTERNALS_SCALE,
      payload: { type: 'group', explode: expect.any(Number) },
    });
    if (group?.payload.type === 'group') expect(group.payload.explode).toBeGreaterThan(0);
    if (nestedGroup?.payload.type === 'group') expect(nestedGroup.payload.explode).toBeGreaterThan(0);

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
      ['back-glass', partSprites.backGlass, 71.34, 0, 0, 0],
      ['midframe', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, 1],
      ['battery', partSprites.battery, 40, -12.6, 10.2, 2],
      ['logic-board', partSprites.logicBoard, 21, 19.8, -44, 3],
      ['camera-module', partSprites.cameraModule, 24.03, -18.8, -47.5, 4],
      ['loudspeaker', partSprites.loudspeaker, 18, -11, 66, 5],
      ['haptic-motor', partSprites.hapticMotor, 22, 13, 66.5, 6],
      ['display', partSprites.display, 71.34, 0, 0, 7],
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
      if (id === 'midframe') continue;
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
      // Callouts sit outside the phone, so the fitted centre is the content centre.
      expect(opening.y).toBeCloseTo(0);
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
      // A narrow window also fits the side labels, so the phone is a smaller share there.
      expect(Math.max(cssW / viewW, cssH / viewH)).toBeGreaterThan(viewW >= 1000 ? 0.65 : 0.5);

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

    // The frame stays on the origin. Every other part is the assembled point,
    // pulled out by the level gap and fitted back, times the group scale.
    const laid = explodeLevel(levelParts('internals'), explodeOf('internals'));
    const midLaid = laid.find((part) => part.id === 'midframe');
    const batteryLaid = laid.find((part) => part.id === 'battery');
    if (!midLaid || !batteryLaid) throw new Error('expected the laid-out parts');
    expect(midLaid.x).toBeCloseTo(0);
    expect(midLaid.y).toBeCloseTo(0);
    expect(mid.object.x).toBeCloseTo(0);
    expect(mid.object.y).toBeCloseTo(0);
    expect(mid.object.payload.width).toBeCloseTo(authoredMid.payload.width * INTERNALS_SCALE * midLaid.scale);
    expect(mid.object.payload.height).toBeCloseTo(authoredMid.payload.height * INTERNALS_SCALE * midLaid.scale);
    expect(battery.object.x).toBeCloseTo(batteryLaid.x * INTERNALS_SCALE);
    expect(battery.object.y).toBeCloseTo(batteryLaid.y * INTERNALS_SCALE);
    expect(battery.object.payload.width).toBeCloseTo(authoredBattery.payload.width * INTERNALS_SCALE * batteryLaid.scale);

    // The longer assembled side is restored, so at 1/0.625 the exploded
    // group is the size the assembled group was. That is the phone's screen.
    const assembled = unionLevel('internals');
    const placed = unionWorld(levelParts('internals').map((part) => part.id));
    const major = assembled.height >= assembled.width ? 'height' : 'width';
    // Fitted back inside the assembled footprint, and still tall enough to
    // fill the screen the way the phone did at 1/0.625.
    expect(placed[major]).toBeLessThanOrEqual(assembled[major] * INTERNALS_SCALE * 1.001);
    expect(placed[major] * reveal).toBeGreaterThan(assembled[major] * 0.9);
    expect(laidClearance('internals')).toBeGreaterThan(3);
    expect(clearanceOf(levelParts('internals').map((part) => part.id))).toBeGreaterThan(0);
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
    const solids = smartphoneObjects.filter((object) => object.payload.type === 'image');
    const boxes = [...labels, ...solids].map((object) => {
      const box = resolveWorldRect(smartphoneObjects, object.id);
      if (!box) throw new Error(`expected a world box for ${object.id}`);
      return { id: object.id, box };
    });

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const labelInvolved = a.id.endsWith('-label') || b.id.endsWith('-label');
        if (!labelInvolved) continue;
        // The cell and board sit in the phone and midframe plates. Their labels
        // share that cavity; the plates' boxes are the whole phone, not the ink.
        const ids = [a.id, b.id];
        const nestedLabel = ids.some((id) => id === 'cell-label' || id === 'protection-board-label');
        const enclosingPlate = ids.some((id) => id === 'phone' || id === 'midframe');
        if (nestedLabel && enclosingPlate) continue;
        expect(rectsOverlap(a.box, b.box), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }

    const limits = deriveCameraLimits(createMemoryStore(smartphoneObjects).contentBoxes(), 1280, 800);
    const pan = limits.bounds;
    if (!pan) throw new Error('expected pan bounds');
    for (const label of labels) {
      const box = resolveWorldRect(smartphoneObjects, label.id);
      if (!box) throw new Error(`expected a world box for ${label.id}`);
      expect(box.x - box.width / 2).toBeGreaterThan(pan.left);
      expect(box.x + box.width / 2).toBeLessThan(pan.right);
      expect(box.y - box.height / 2).toBeGreaterThan(pan.top);
      expect(box.y + box.height / 2).toBeLessThan(pan.bottom);
    }

    const leaders = partsAndLabels();
    for (let i = 0; i < leaders.length; i += 1) {
      for (let j = i + 1; j < leaders.length; j += 1) {
        const a = leaders[i];
        const b = leaders[j];
        if (!a || !b) continue;
        expect(segmentsCross(a.from, a.to, b.from, b.to), `${a.id} crosses ${b.id}`).toBe(false);
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

    const span = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
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

    const siblings = [
      'back-glass',
      'midframe',
      'battery',
      'logic-board',
      'camera-module',
      'loudspeaker',
      'haptic-motor',
      'display',
      'back-glass-label',
      'midframe-label',
      'battery-label',
      'logic-board-label',
      'camera-module-label',
      'loudspeaker-label',
      'haptic-motor-label',
      'display-label',
    ];
    expect(idsAt(1)).toEqual(expect.arrayContaining(siblings));
    expect(idsAt(1)).not.toEqual(expect.arrayContaining(['cell', 'cell-label', 'protection-board-label']));
    expect(idsAt(reveal)).not.toEqual(expect.arrayContaining(siblings));
    expect(idsAt(reveal)).toEqual(
      expect.arrayContaining(['cell', 'protection-board', 'cell-label', 'protection-board-label']),
    );
    expect(idsAt(2.5)).not.toEqual(expect.arrayContaining(siblings));
    expect(idsAt(2.5)).toEqual(expect.arrayContaining(['cell', 'protection-board', 'cell-label', 'protection-board-label']));
    // Zooming back out restores the sibling level and hides the cell again.
    expect(idsAt(1)).toEqual(expect.arrayContaining(['loudspeaker', 'haptic-motor-label']));

    const battery = mustRect('battery');
    const planAt = (ratio: number, id: string) =>
      buildLevelPlan(
        smartphoneObjects,
        (objectId) => {
          const rect = resolveWorldRect(smartphoneObjects, objectId);
          return rect ? boundsOf(rect) : undefined;
        },
        batteryFit * ratio,
        { x: battery.x, y: battery.y },
        desktop,
      ).opacity(id);
    expect(planAt(1, 'midframe')).toBeCloseTo(1);
    expect(planAt(1.3, 'midframe')).toBeCloseTo(0.5);
    expect(planAt(1.3, 'logic-board-label')).toBeCloseTo(0.5);
    expect(planAt(1.3, 'battery')).toBeCloseTo(0.5);
    expect(planAt(reveal, 'camera-module')).toBeCloseTo(0);
    expect(planAt(2.5, 'haptic-motor')).toBe(0);
    expect(planAt(1, 'loudspeaker')).toBeCloseTo(1);
    // The cell level fades in on its own anchor. The handover does not dim it,
    // and the phone's own fade is left alone.
    expect(planAt(1.3, 'cell')).toBe(1);
    expect(planAt(1.3, 'protection-board')).toBe(1);
    expect(planAt(1.3, 'cell-label')).toBe(1);
    expect(planAt(1.3, 'protection-board-label')).toBe(1);
    expect(planAt(1.3, 'phone')).toBe(1);
    expect(planAt(2.5, 'phone')).toBe(1);

    expect(store.countInBand(batteryFit, fit, desktop, { x: battery.x, y: battery.y })).toBe(16);
    expect(store.countInBand(batteryFit * 1.3, fit, desktop, { x: battery.x, y: battery.y })).toBe(20);
    expect(store.countInBand(batteryFit * reveal, fit, desktop, { x: battery.x, y: battery.y })).toBe(4);

    const view = desktop;
    const cell = mustRect('cell');
    const board = mustRect('protection-board');
    const at = (ratio: number) => ({ x: battery.x, y: battery.y, scale: batteryFit * ratio });
    expect(store.hitTest({ x: cell.x, y: cell.y }, at(1), fit, view)?.id).toBe('battery');
    expect(store.hitTest({ x: cell.x, y: cell.y }, at(reveal), fit, view)?.id).toBe('cell');
    expect(store.hitTest({ x: board.x, y: board.y }, at(reveal), fit, view)?.id).toBe('protection-board');

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
    const cellTop = cellObject.y - cellObject.payload.height / 2;
    const boardTop = boardObject.y - boardObject.payload.height / 2;
    const boardBottom = boardObject.y + boardObject.payload.height / 2;
    expect(boardTop).toBeLessThan(cellTop);
    expect(boardBottom).toBeGreaterThan(cellTop);
    expect(boardBottom).toBeLessThan(cellObject.y);
    const authoredBattery = smartphoneObjects.find((object) => object.id === 'battery');
    if (!authoredBattery || authoredBattery.payload.type !== 'image') throw new Error('expected the battery');
    const laid = explodeLevel(levelParts('battery-internals'), explodeOf('battery-internals'));
    const cellLaid = laid.find((part) => part.id === 'cell');
    if (!cellLaid) throw new Error('expected the laid-out cell');
    const batteryWorld = mustRect('battery');
    const batteryScale = batteryWorld.width / authoredBattery.payload.width;
    expect(cell.width).toBeCloseTo(cellObject.payload.width * cellLaid.scale * INTERNALS_SCALE * batteryScale);
    expect(battery.width).toBeCloseTo(authoredBattery.payload.width * batteryScale);
    const assembled = unionLevel('battery-internals');
    const placed = unionWorld(['cell', 'protection-board']);
    const major = assembled.height >= assembled.width ? 'height' : 'width';
    // The cell and the board are fitted back inside the battery they were assembled in.
    const fittedMajor = assembled[major] * INTERNALS_SCALE * batteryScale;
    expect(placed[major]).toBeLessThanOrEqual(fittedMajor * 1.001);
    expect(placed[major]).toBeGreaterThan(fittedMajor * 0.8);
    expect(laidClearance('battery-internals')).toBeGreaterThan(4);
    expect(clearanceOf(['cell', 'protection-board'])).toBeGreaterThan(0);
    // Still the direction they were assembled in: board toward the top, cell toward the bottom.
    expect(mustRect('protection-board').y).toBeLessThan(mustRect('cell').y);
  });
});

function explodeOf(groupId: string): number {
  const group = smartphoneObjects.find((object) => object.id === groupId);
  if (!group || group.payload.type !== 'group' || group.payload.explode === undefined) {
    throw new Error(`expected an explode gap on ${groupId}`);
  }
  return group.payload.explode;
}

function levelParts(groupId: string): LevelPart[] {
  const parts: LevelPart[] = [];
  for (const object of smartphoneObjects) {
    if (object.parentId !== groupId || object.payload.type !== 'image') continue;
    parts.push({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.payload.width,
      height: object.payload.height,
      ...(object.z !== undefined ? { z: object.z } : {}),
    });
  }
  return parts;
}

function unionLevel(groupId: string): { width: number; height: number } {
  return unionRects(
    levelParts(groupId).map((part) => ({
      x: part.x,
      y: part.y,
      width: part.width,
      height: part.height,
    })),
  );
}

function unionWorld(ids: readonly string[]): { width: number; height: number } {
  return unionRects(ids.map((id) => mustRect(id)));
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

/** Gap between the fitted parts, in the level's own millimetres. */
function laidClearance(groupId: string): number {
  const parts = levelParts(groupId);
  const laid = explodeLevel(parts, explodeOf(groupId));
  const boxes = laid.map((part) => {
    const source = parts.find((candidate) => candidate.id === part.id);
    if (!source) throw new Error(part.id);
    return {
      x: part.x,
      y: part.y,
      width: source.width * part.scale,
      height: source.height * part.scale,
    };
  });
  return clearanceBetween(boxes);
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

function clearanceBetween(boxes: readonly { x: number; y: number; width: number; height: number }[]): number {
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (!a || !b) continue;
      gap = Math.min(gap, pairClearance(a, b));
    }
  }
  return gap;
}

/** Smallest gap between the world boxes. Negative means they overlap. */
function clearanceOf(ids: readonly string[]): number {
  const rects = ids.map((id) => mustRect(id));
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (!a || !b) continue;
      gap = Math.min(gap, pairClearance(a, b));
    }
  }
  return gap;
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
  from: { x: number; y: number };
  to: { x: number; y: number };
}> {
  const leaders = [];
  for (const object of smartphoneObjects) {
    if (object.payload.type !== 'link') continue;
    const from = resolveWorldRect(smartphoneObjects, object.payload.from);
    const to = resolveWorldRect(smartphoneObjects, object.payload.to);
    if (!from || !to) throw new Error(`expected endpoints for ${object.id}`);
    leaders.push({ id: object.id, from, to });
  }
  return leaders;
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
