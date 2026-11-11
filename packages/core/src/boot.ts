import { cameraFromLocation, initialCameraFor } from './bootstrap';
import { boxFitScale, clampScale, deriveCameraLimits, type Camera, type ViewBounds } from './camera';
import { resolveWorldRect } from './link';
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
 * A pack with `titleFitWidth` opens on that title fit. Any other pack opens
 * on the derived fit of its objects, centered. That fit is also the minimum zoom.
 */
export function openingCameraFor(pack: ContentPack, viewW: number, viewH: number): Camera {
  if (pack.titleFitWidth !== undefined) return initialCameraFor(viewW, pack.titleFitWidth);
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
    const framed = frameOn(pack.objects, focus, viewW, viewH);
    if (framed) {
      const into = params.get('into') === '1' ? (pack.intoFactor ?? 1) : 1;
      return { ...framed, scale: clampScale(framed.scale * into) };
    }
  }
  return cameraFromLocation(openingCameraFor(pack, viewW, viewH), search);
}

/** Camera that fits `id` in the viewport, centred on it. */
export function frameOn(
  objects: ContentPack['objects'],
  id: string,
  viewW: number,
  viewH: number,
): Camera | null {
  const rect = resolveWorldRect(objects, id);
  if (!rect) return null;
  const bounds: ViewBounds = {
    left: rect.x - rect.width / 2,
    right: rect.x + rect.width / 2,
    top: rect.y - rect.height / 2,
    bottom: rect.y + rect.height / 2,
  };
  return { x: rect.x, y: rect.y, scale: boxFitScale(bounds, viewW, viewH) };
}
