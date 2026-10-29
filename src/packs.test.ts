import { describe, expect, it } from 'vitest';
import { bootFromLocation, openingCameraFor, resolvePack } from '../content/packs';
import { PHONE_WIDTH_MM, smartphoneObjects, smartphonePack, smartphoneSprite } from '../content/smartphone';
import { initialCameraFor } from './bootstrap';
import { applyCameraCommand, deriveCameraLimits, viewBounds } from './camera';
import { demoPack, titleFitWidth } from './demo';
import { createMemoryStore } from './store';
import { darkTheme, paperTheme } from './theme';
import { visibilityAlpha } from './visibility';

function phonePayload() {
  const phone = smartphoneObjects[0];
  if (!phone || phone.payload.type !== 'image') throw new Error('expected the phone image');
  return phone.payload;
}

describe('smartphone pack', () => {
  it('is the default, on paper, with one centered phone and no labels', () => {
    expect(resolvePack('').id).toBe('smartphone');
    expect(resolvePack('').pack).toBe(smartphonePack);
    expect(resolvePack('?scale=2').pack.theme).toBe(paperTheme);
    expect(paperTheme.background).toBe('#F3EAD3');
    expect(paperTheme.grid).toBeUndefined();
    expect(smartphonePack.theme).toBe(paperTheme);
    expect(smartphonePack.limits).toBeUndefined();
    expect(smartphoneObjects).toHaveLength(1);
    expect(smartphoneObjects.some((object) => object.payload.type === 'text')).toBe(false);

    const phone = smartphoneObjects[0];
    expect(phone?.id).toBe('smartphone');
    expect(phone?.x).toBe(0);
    expect(phone?.y).toBe(0);
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
      expect(visibilityAlpha(smartphoneObjects[0]!.visibility, opening.scale)).toBe(1);

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
