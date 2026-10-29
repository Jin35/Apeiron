import { cameraFromLocation, initialCameraFor } from '../src/bootstrap';
import { deriveCameraLimits, type Camera } from '../src/camera';
import { demoPack, titleFitWidth } from '../src/demo';
import { createMemoryStore } from '../src/store';
import { themeFromSearch, type ContentPack, type Theme } from '../src/theme';
import { smartphonePack } from './smartphone';

export type PackId = 'smartphone' | 'archipelago';

/** Default is Smartphone. `?pack=archipelago` selects the atlas in dev and production. */
export function resolvePack(search: string): { id: PackId; pack: ContentPack } {
  if (new URLSearchParams(search).get('pack') === 'archipelago') {
    return { id: 'archipelago', pack: demoPack };
  }
  return { id: 'smartphone', pack: smartphonePack };
}

/**
 * Archipelago keeps the title fit. Any other pack opens on the derived fit
 * of its objects, centered. That fit is also the minimum zoom.
 */
export function openingCameraFor(id: PackId, pack: ContentPack, viewW: number, viewH: number): Camera {
  if (id === 'archipelago') return initialCameraFor(viewW, titleFitWidth);
  const width = viewW > 0 ? viewW : 1280;
  const height = viewH > 0 ? viewH : 800;
  const limits = deriveCameraLimits(
    createMemoryStore(pack.objects).contentBoxes(),
    width,
    height,
    pack.limits,
  );
  const bounds = limits.bounds;
  return {
    x: bounds ? (bounds.left + bounds.right) / 2 : 0,
    y: bounds ? (bounds.top + bounds.bottom) / 2 : 0,
    scale: limits.minScale,
  };
}

export type BootSelection = {
  id: PackId;
  pack: ContentPack;
  theme: Theme;
  opening: Camera;
  limits: ContentPack['limits'];
};

/** What the page mounts. A `?scale=` query still replaces the fitted camera. */
export function bootFromLocation(search: string, viewW: number, viewH: number, dev?: boolean): BootSelection {
  const { id, pack } = resolvePack(search);
  return {
    id,
    pack,
    theme: themeFromSearch(search, { dev, fallback: pack.theme }),
    opening: cameraFromLocation(openingCameraFor(id, pack, viewW, viewH), search),
    limits: pack.limits,
  };
}
