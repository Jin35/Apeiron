import { cameraFromLocation, initialCameraFor } from './bootstrap';
import { applyButtonZoomCommand, committedCamera, createButtonZoom, tickButtonZoom } from './buttonZoom';
import { deriveCameraLimits, viewBounds, worldPoint, type CameraLimits } from './camera';
import { demoPack, titleFitWidth } from './demo';
import { attachInteraction, type SceneCommand } from './interaction';
import { createRenderer } from './render';
import { createMemoryStore, type SceneStore, type VisibleObject } from './store';
import { applyTheme, themeFromSearch, type Theme } from './theme';

export function mountShell(
  surface: HTMLCanvasElement,
  status: HTMLElement,
  zoomInButton: HTMLButtonElement,
  zoomOutButton: HTMLButtonElement,
  store: SceneStore = createMemoryStore(demoPack.objects),
  labelList?: HTMLElement,
  theme: Theme = demoPack.theme,
  limits?: CameraLimits,
): void {
  let zoomAnim = createButtonZoom(
    cameraFromLocation(initialCameraFor(window.innerWidth, titleFitWidth), window.location.search),
  );
  let selectedId: string | null = null;
  let labelKey = '';
  let rafId = 0;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motion.matches;
  motion.addEventListener('change', (event) => {
    reduceMotion = (event as MediaQueryListEvent).matches;
  });

  status.removeAttribute('aria-live');
  labelList?.removeAttribute('aria-live');
  if (surface.ownerDocument) applyTheme(surface.ownerDocument, theme);

  const renderer = createRenderer(surface, () => invalidate());

  function frame(now: number) {
    zoomAnim = tickButtonZoom(zoomAnim, now);
    const rect = surface.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const camera = zoomAnim.camera;
    const limitsNow = activeLimits(width, height);
    const shown = store.query({ bounds: viewBounds(camera, width, height), scale: camera.scale });
    renderer.draw({
      camera,
      width,
      height,
      visible: shown,
      theme,
      ...(selectedId ? { selectedId } : {}),
    });
    if (labelList) syncLabelList(labelList, shown);
    const visible = store.countInBand(camera.scale);
    status.textContent = `×${formatScale(camera.scale)} · ${visible} visible`;
    status.dataset.scale = String(camera.scale);
    status.dataset.x = String(camera.x);
    status.dataset.y = String(camera.y);
    const selected = selectedId ?? '';
    status.dataset.selected = selected;
    surface.dataset.selected = selected;
    const limit = committedCamera(zoomAnim).scale;
    zoomInButton.disabled = limit >= limitsNow.maxScale - 1e-9;
    zoomOutButton.disabled = limit <= limitsNow.minScale + 1e-9;
    if (zoomAnim.segments.length > 0) invalidate();
  }

  /** At most one animation frame. Button zoom, resize, image loads, and store changes use this. */
  function invalidate() {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      frame(now);
    });
  }

  /**
   * Drag, wheel, pinch, and a click paint before the handler returns.
   * A settled tap paints when its wait ends.
   * A +/− step only schedules a frame; the 150ms blend runs on that clock.
   * Reduced motion settles that step on the committed camera in the same frame.
   * `selectAt` does not cancel that blend.
   */
  function applyCommand(command: SceneCommand) {
    const rect = surface.getBoundingClientRect();
    const now = performance.now();
    if (command.type === 'selectAt') {
      const camera = zoomAnim.camera;
      const world = worldPoint(camera, command.x, command.y, rect.width, rect.height);
      selectedId = store.hitTest(world, camera)?.id ?? null;
      frame(now);
      return;
    }
    zoomAnim = applyButtonZoomCommand(zoomAnim, command, rect.width, rect.height, now, {
      settleZoomStep: reduceMotion,
      limits: activeLimits(rect.width, rect.height),
    });
    if (command.type === 'zoomStep') {
      invalidate();
      return;
    }
    frame(now);
  }

  /** Text labels from this frame's `query`, in that order. Not a live region. */
  function syncLabelList(list: HTMLElement, shown: readonly VisibleObject[]): void {
    const texts: string[] = [];
    const ids: string[] = [];
    for (const { object } of shown) {
      if (object.payload.type !== 'text') continue;
      ids.push(object.id);
      texts.push(object.payload.text);
    }
    const key = JSON.stringify(ids.map((id, index) => [id, texts[index]]));
    if (key === labelKey) return;
    labelKey = key;
    list.replaceChildren(
      ...texts.map((text) => {
        const item = list.ownerDocument.createElement('li');
        item.textContent = text;
        return item;
      }),
    );
  }

  store.subscribe(() => invalidate());

  /** Pack override, or the objects and the current viewport. Fresh on resize and replaceObjects. */
  function activeLimits(width: number, height: number) {
    return deriveCameraLimits(store.contentBoxes(), width, height, limits);
  }

  attachInteraction(
    { canvas: surface, zoomIn: zoomInButton, zoomOut: zoomOutButton },
    applyCommand,
  );

  new ResizeObserver(() => invalidate()).observe(surface);
  // The first paint stays synchronous so the canvas is up before any input.
  frame(performance.now());
}

function formatScale(scale: number): string {
  // Fixed decimals cover the atlas. Past that, 1e-4 would print "0.000" and 1e7 a digit run.
  if (scale < 1e-3 || scale >= 1e4) return formatWideScale(scale);
  if (scale >= 10) return scale.toFixed(1);
  if (scale >= 1) return scale.toFixed(2);
  return scale.toFixed(3);
}

/** Scientific form with trailing zeros removed: `1e-4`, `6.71e6`. */
function formatWideScale(scale: number): string {
  const [mantissa, exponent] = scale.toExponential(2).split('e');
  let end = mantissa.length;
  if (mantissa.includes('.')) {
    while (mantissa[end - 1] === '0') end -= 1;
    if (mantissa[end - 1] === '.') end -= 1;
  }
  return `${mantissa.slice(0, end)}e${Number(exponent)}`;
}

if (typeof document !== 'undefined') {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  const statusEl = document.querySelector<HTMLElement>('#status');
  const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in');
  const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out');
  const labels = document.querySelector<HTMLElement>('#labels');
  if (!canvas || !statusEl || !zoomIn || !zoomOut || !labels) {
    throw new Error('Apeiron markup is missing');
  }
  // The store defaults to the demo pack. `?theme=paper` previews paperTheme in dev.
  mountShell(
    canvas,
    statusEl,
    zoomIn,
    zoomOut,
    undefined,
    labels,
    themeFromSearch(window.location.search, { fallback: demoPack.theme }),
  );
}
