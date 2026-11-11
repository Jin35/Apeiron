import { bootFromLocation, type BootSelection, type ContentPack } from '@apeiron/core';
import { demoPack } from '@apeiron/pack-archipelago';
import { paperTheme, smartphonePack } from '@apeiron/pack-smartphone';

export type PackId = 'smartphone' | 'archipelago';

/** Default is Smartphone. `?pack=archipelago` selects the atlas in dev and production. */
export function resolvePack(search: string): { id: PackId; pack: ContentPack } {
  if (new URLSearchParams(search).get('pack') === 'archipelago') {
    return { id: 'archipelago', pack: demoPack };
  }
  return { id: 'smartphone', pack: smartphonePack };
}

/** What the page mounts. `?theme=paper` is a dev-only preview of the paper palette. */
export function bootPage(search: string, viewW: number, viewH: number, dev?: boolean): BootSelection {
  return bootFromLocation(search, viewW, viewH, {
    dev,
    resolvePack,
    themes: { paper: paperTheme },
  });
}
