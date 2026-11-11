import { frameOn, initialCameraFor, openingCameraFor } from '@apeiron/core';
import { darkTheme, demoPack, titleFitPose, titleFitWidth } from '@apeiron/pack-archipelago';
import { paperTheme, REVEAL_END, smartphonePack } from '@apeiron/pack-smartphone';
import { describe, expect, it } from 'vitest';
import { bootPage, resolvePack } from './catalog';

describe('pack query', () => {
  it('loads the archipelago pack from ?pack=archipelago in dev and production', () => {
    expect(resolvePack('?pack=archipelago').id).toBe('archipelago');
    expect(resolvePack('?pack=archipelago').pack).toBe(demoPack);
    expect(resolvePack('?pack=archipelago&scale=2&x=-3012&y=-1112').pack.theme).toBe(darkTheme);
    expect(resolvePack('?pack=other').id).toBe('smartphone');
    expect(resolvePack('').id).toBe('smartphone');
    expect(resolvePack('').pack.theme).toBe(paperTheme);

    const desktop = openingCameraFor(demoPack, 1440, 900);
    expect(desktop).toEqual(initialCameraFor(1440, titleFitWidth, titleFitPose));
    const narrow = openingCameraFor(demoPack, 390, 844);
    expect(narrow.scale).toBeLessThan(0.06);
    expect(narrow).toMatchObject({ x: 0, y: -80 });

    const prod = bootPage('?pack=archipelago&theme=paper', 1280, 800, false);
    expect(prod.id).toBe('archipelago');
    expect(prod.pack).toBe(demoPack);
    expect(prod.theme).toBe(darkTheme);
    expect(prod.opening).toEqual(initialCameraFor(1280, titleFitWidth, titleFitPose));

    const dev = bootPage('?pack=archipelago&theme=paper', 1280, 800, true);
    expect(dev.pack).toBe(demoPack);
    expect(dev.theme).toBe(paperTheme);

    const page = bootPage('', 1280, 800, false);
    expect(page.id).toBe('smartphone');
    expect(page.theme).toBe(paperTheme);
    expect(page.opening.scale).toBeGreaterThan(1);

    const wharf = bootPage('?pack=archipelago&scale=2&x=-3012&y=-1112', 1280, 800, false);
    expect(wharf.opening).toEqual({ x: -3012, y: -1112, scale: 2 });
    expect(wharf.theme).toBe(darkTheme);
  });

  it('opens ?focus=&into=1 at the pack reveal factor', () => {
    const framed = frameOn(smartphonePack.objects, 'battery', 800, 600);
    const into = bootPage('?focus=battery&into=1', 800, 600, false);
    const plain = bootPage('?focus=battery', 800, 600, false);
    expect(framed).not.toBeNull();
    expect(plain.opening.scale).toBeCloseTo(framed?.scale ?? 0);
    expect(into.opening.scale).toBeCloseTo((framed?.scale ?? 0) * REVEAL_END);
    expect(into.opening).toMatchObject({ x: framed?.x, y: framed?.y });

    const atlas = frameOn(demoPack.objects, 'place-wharf', 800, 600);
    const atlasInto = bootPage('?pack=archipelago&focus=place-wharf&into=1', 800, 600, false);
    expect(demoPack.intoFactor).toBe(REVEAL_END);
    expect(atlasInto.opening.scale).toBeCloseTo((atlas?.scale ?? 0) * REVEAL_END);
  });
});
