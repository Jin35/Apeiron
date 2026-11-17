import { cameraFromLocation, initialCameraFor } from './bootstrap';
import { boxFitScale, clampScale, deriveCameraLimits, type Camera, type ViewBounds } from './camera';
import { resolveWorldRect } from './link';
import { copyWorldDelta } from './repeat';
import { createMemoryStore } from './store';
import { themeFromSearch, type ContentPack, type Theme } from './theme';

export type BootSelection = {
  id: string;
  pack: ContentPack;
  theme: Theme;
  opening: Camera;
  limits: ContentPack['limits'];
};

/**
 * A pack with `titleFitWidth` opens on that title fit, using `titleFitPose`
 * when the pack sets one. Any other pack opens on the derived fit of its
 * objects, centered. That fit is also the minimum zoom.
 */
export function openingCameraFor(pack: ContentPack, viewW: number, viewH: number): Camera {
  if (pack.titleFitWidth !== undefined) return initialCameraFor(viewW, pack.titleFitWidth, pack.titleFitPose);
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

/**
 * What the page mounts. A `?scale=` query still replaces the fitted camera.
 * `?focus=<id>` frames that node. `?into=1` multiplies by the pack's `intoFactor`.
 * `&i=<copyIndex>` frames that copy of a repeated node. Copy 0 is the authored one.
 */
export function bootFromLocation(
  search: string,
  viewW: number,
  viewH: number,
  options: {
    dev?: boolean;
    resolvePack: (search: string) => { id: string; pack: ContentPack };
    themes?: Readonly<Record<string, Theme>>;
  },
): BootSelection {
  const { id, pack } = options.resolvePack(search);
  const width = viewW > 0 ? viewW : 1280;
  const height = viewH > 0 ? viewH : 800;
  return {
    id,
    pack,
    theme: themeFromSearch(search, { dev: options.dev, fallback: pack.theme, themes: options.themes }),
    opening: openingFromSearch(pack, search, width, height),
    limits: pack.limits,
  };
}

function openingFromSearch(pack: ContentPack, search: string, viewW: number, viewH: number): Camera {
  const params = new URLSearchParams(search);
  const focus = params.get('focus');
  const scaleParam = Number(params.get('scale'));
  if (focus && !(scaleParam > 0)) {
    const framed = frameOn(pack.objects, focus, viewW, viewH, copyIndexFrom(params));
    if (framed) {
      const into = params.get('into') === '1' ? (pack.intoFactor ?? 1) : 1;
      return { ...framed, scale: clampScale(framed.scale * into) };
    }
  }
  return cameraFromLocation(openingCameraFor(pack, viewW, viewH), search);
}

/** Camera that fits `id` in the viewport, centred on it. `copyIndex` centres that copy. */
export function frameOn(
  objects: ContentPack['objects'],
  id: string,
  viewW: number,
  viewH: number,
  copyIndex = 0,
): Camera | null {
  const rect = resolveWorldRect(objects, id);
  if (!rect) return null;
  const shift = copyWorldDelta(objects, id, copyIndex);
  const x = rect.x + shift.x;
  const y = rect.y + shift.y;
  const bounds: ViewBounds = {
    left: x - rect.width / 2,
    right: x + rect.width / 2,
    top: y - rect.height / 2,
    bottom: y + rect.height / 2,
  };
  return { x, y, scale: boxFitScale(bounds, viewW, viewH) };
}

function copyIndexFrom(params: URLSearchParams): number {
  const raw = params.get('i');
  if (raw === null) return 0;
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) return 0;
  return index;
}
