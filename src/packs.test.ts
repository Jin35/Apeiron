import { describe, expect, it } from 'vitest';
import { bootFromLocation, openingCameraFor, resolvePack } from '../content/packs';
import {
  INTERNALS_SCALE,
  partSprites,
  PHONE_WIDTH_MM,
  smartphoneObjects,
  smartphonePack,
  smartphoneSprite,
} from '../content/smartphone';
import { initialCameraFor } from './bootstrap';
import { applyCameraCommand, deriveCameraLimits, viewBounds } from './camera';
import { demoPack, titleFitWidth } from './demo';
import type { ImagePayload } from './model';
import { relativeZoomAlpha } from './fade';
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
    expect(smartphoneObjects.some((object) => object.payload.type === 'text')).toBe(false);
    expect(smartphoneObjects.map((object) => object.id)).toEqual([
      'internals',
      'midframe',
      'battery',
      'logic-board',
      'camera-module',
      'loudspeaker',
      'haptic-motor',
      'phone',
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
      payload: { type: 'group' },
    });

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

    const parts: Array<[string, { width: number; height: number; opaqueWidth: number; opaqueHeight: number }, number, number, number]> = [
      ['midframe', partSprites.midframe, PHONE_WIDTH_MM, 0, 0],
      ['battery', partSprites.battery, 40, -12.6, 10.2],
      ['logic-board', partSprites.logicBoard, 21, 19.8, -44],
      ['camera-module', partSprites.cameraModule, 21, -22, -62.5],
      ['loudspeaker', partSprites.loudspeaker, 18, -11, 66],
      ['haptic-motor', partSprites.hapticMotor, 22, 13, 66.5],
    ];
    const midAuthored = smartphoneObjects.find((object) => object.id === 'midframe');
    if (!midAuthored || midAuthored.payload.type !== 'image') throw new Error('expected the midframe');
    for (const [id, sprite, opaqueMm, x, y] of parts) {
      const part = smartphoneObjects.find((object) => object.id === id);
      if (!part || part.payload.type !== 'image') throw new Error(`expected ${id}`);
      expect(part.parentId).toBe('internals');
      expect(part.fade).toEqual({ fadeIn: reveal });
      expect(part.scale).toBeUndefined();
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
      expect(opening).toMatchObject({ x: 0, y: 0 });
      expect(opening.scale).toBeCloseTo(limits.minScale);
      expect(opening.scale).toBeCloseTo(limits.fitScale);
      expect(limits.maxScale / limits.fitScale).toBeGreaterThanOrEqual(5);
      const boxes = createMemoryStore(smartphoneObjects).contentBoxes();
      const pan = limits.bounds;
      if (!pan) throw new Error('expected pan bounds');
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
      expect(Math.max(cssW / viewW, cssH / viewH)).toBeGreaterThan(0.65);

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
      expect(panned.x).toBeCloseTo(0);
      expect(panned.y).toBeCloseTo(0);
      expect(panned.scale).toBeCloseTo(limits.minScale);

      const zoomedOut = applyCameraCommand(
        opening,
        { type: 'zoomAt', x: viewW / 2, y: viewH / 2, factor: 0.4 },
        viewW,
        viewH,
        limits,
      );
      expect(zoomedOut.scale).toBeCloseTo(limits.minScale);
      expect(zoomedOut.x).toBeCloseTo(0);
      expect(zoomedOut.y).toBeCloseTo(0);
    }
  });

  it('shrinks the internals by one group scale and fades them in when that scale fills the opening', () => {
    const reveal = 1 / INTERNALS_SCALE;
    const fit = deriveCameraLimits(createMemoryStore(smartphoneObjects).contentBoxes(), 1280, 800).fitScale;
    const store = createMemoryStore(smartphoneObjects);
    const span = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
    const at = (ratio: number) => store.query({ bounds: span, scale: fit * ratio, fitScale: fit });

    expect(at(1).map((entry) => entry.object.id)).toEqual(['phone']);
    expect(at(reveal).map((entry) => entry.object.id)).not.toContain('phone');
    expect(at(reveal).map((entry) => entry.object.id)).not.toContain('internals');
    expect(store.countInBand(fit, fit)).toBe(1);
    expect(store.countInBand(fit * reveal, fit)).toBe(6);

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

    expect(mid.object.x).toBeCloseTo(0);
    expect(mid.object.y).toBeCloseTo(0);
    expect(mid.object.payload.width).toBeCloseTo(authoredMid.payload.width * INTERNALS_SCALE);
    expect(mid.object.payload.height).toBeCloseTo(authoredMid.payload.height * INTERNALS_SCALE);
    expect(battery.object.x).toBeCloseTo(authoredBattery.x * INTERNALS_SCALE);
    expect(battery.object.y).toBeCloseTo(authoredBattery.y * INTERNALS_SCALE);
    expect(battery.object.payload.width).toBeCloseTo(authoredBattery.payload.width * INTERNALS_SCALE);

    const phoneOpaque = PHONE_WIDTH_MM;
    const midOpaque = (mid.object.payload.width * partSprites.midframe.opaqueWidth) / partSprites.midframe.width;
    expect(midOpaque * reveal).toBeCloseTo(phoneOpaque);
    expect(mid.object.payload.width * fit * reveal).toBeCloseTo(authoredMid.payload.width * fit);
  });
});

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
