import { cameraFromLocation, initialCameraFor } from './bootstrap';
import { applyButtonZoomCommand, committedCamera, createButtonZoom, tickButtonZoom } from './buttonZoom';
import { MAX_SCALE, MIN_SCALE, viewBounds, type CameraCommand } from './camera';
import { demoObjects, titleFitWidth } from './demo';
import { attachInteraction } from './interaction';
import { createRenderer } from './render';
import { createMemoryStore, type SceneStore } from './store';

export function mountShell(
  surface: HTMLCanvasElement,
  status: HTMLElement,
  zoomInButton: HTMLButtonElement,
  zoomOutButton: HTMLButtonElement,
  store: SceneStore = createMemoryStore(demoObjects),
): void {
  let zoomAnim = createButtonZoom(
    cameraFromLocation(initialCameraFor(window.innerWidth, titleFitWidth), window.location.search),
  );
  let rafId = 0;

  const renderer = createRenderer(surface, () => invalidate());

  function frame(now: number) {
    zoomAnim = tickButtonZoom(zoomAnim, now);
    const rect = surface.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const camera = zoomAnim.camera;
    renderer.draw({
      camera,
      width,
      height,
      visible: store.query({ bounds: viewBounds(camera, width, height), scale: camera.scale }),
    });
    const visible = store.countInBand(camera.scale);
    status.textContent = `×${formatScale(camera.scale)} · ${visible} visible`;
    status.dataset.scale = String(camera.scale);
    status.dataset.x = String(camera.x);
    status.dataset.y = String(camera.y);
    const limit = committedCamera(zoomAnim).scale;
    zoomInButton.disabled = limit >= MAX_SCALE - 1e-9;
    zoomOutButton.disabled = limit <= MIN_SCALE + 1e-9;
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
   * Drag, wheel, and pinch paint before the handler returns.
   * A +/− step only schedules a frame; the 150ms blend runs on that clock.
   */
  function applyCommand(command: CameraCommand) {
    const rect = surface.getBoundingClientRect();
    const now = performance.now();
    zoomAnim = applyButtonZoomCommand(zoomAnim, command, rect.width, rect.height, now);
    if (command.type === 'zoomStep') {
      invalidate();
      return;
    }
    frame(now);
  }

  store.subscribe(() => invalidate());

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
  if (!canvas || !statusEl || !zoomIn || !zoomOut) {
    throw new Error('Apeiron markup is missing');
  }
  mountShell(canvas, statusEl, zoomIn, zoomOut);
}
