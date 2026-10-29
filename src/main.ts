import { applyButtonZoomCommand, committedCamera, createButtonZoom, tickButtonZoom } from './buttonZoom';
import { clampScale, MAX_SCALE, MIN_SCALE, viewBounds, type Camera, type CameraCommand } from './camera';
import { demoObjects, initialCameraFor } from './demo';
import { attachGestures, ZOOM_STEP } from './gestures';
import { createRenderer } from './render';
import { createMemoryStore } from './store';

export function mountShell(
  surface: HTMLCanvasElement,
  status: HTMLElement,
  zoomInButton: HTMLButtonElement,
  zoomOutButton: HTMLButtonElement,
): void {
  let zoomAnim = createButtonZoom(cameraFromLocation(initialCameraFor(window.innerWidth)));
  let rafId = 0;

  const renderer = createRenderer(surface, () => invalidate());
  const store = createMemoryStore(demoObjects);
  // Off-band images are absent from the visible set. Fetch every src once up front.
  renderer.warm(store.imageSources());

  function localPoint(clientX: number, clientY: number) {
    const rect = surface.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

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

  /** At most one animation frame. Button zoom, resize, and image loads use this. */
  function invalidate() {
    if (rafId !== 0) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      frame(now);
    });
  }

  function applyGesture(command: CameraCommand, viewW: number, viewH: number) {
    const now = performance.now();
    zoomAnim = applyButtonZoomCommand(zoomAnim, command, viewW, viewH, now);
    frame(now);
  }

  attachGestures(surface, {
    panBy(dx, dy) {
      // A pan does not use the viewport size.
      applyGesture({ type: 'panBy', dx, dy }, 0, 0);
    },
    zoomAt(x, y, factor) {
      const point = localPoint(x, y);
      applyGesture({ type: 'zoomAt', x: point.x, y: point.y, factor }, point.width, point.height);
    },
    retarget(anchorX, anchorY, targetX, targetY, factor) {
      const anchor = localPoint(anchorX, anchorY);
      const target = localPoint(targetX, targetY);
      applyGesture(
        {
          type: 'retarget',
          anchor: { x: anchor.x, y: anchor.y },
          target: { x: target.x, y: target.y },
          factor,
        },
        anchor.width,
        anchor.height,
      );
    },
  });

  function zoomStep(factor: number) {
    const rect = surface.getBoundingClientRect();
    zoomAnim = applyButtonZoomCommand(
      zoomAnim,
      { type: 'zoomStep', factor },
      rect.width,
      rect.height,
      performance.now(),
    );
    invalidate();
  }

  zoomInButton.addEventListener('click', () => zoomStep(ZOOM_STEP));
  zoomOutButton.addEventListener('click', () => zoomStep(1 / ZOOM_STEP));

  new ResizeObserver(() => invalidate()).observe(surface);
  // The first paint stays synchronous so the canvas is up before any input.
  frame(performance.now());
}

function formatScale(scale: number): string {
  if (scale >= 10) return scale.toFixed(1);
  if (scale >= 1) return scale.toFixed(2);
  return scale.toFixed(3);
}

function cameraFromLocation(fallback: Camera): Camera {
  const params = new URLSearchParams(window.location.search);
  const scale = Number(params.get('scale'));
  if (!Number.isFinite(scale) || scale <= 0) return { ...fallback };
  const x = Number(params.get('x'));
  const y = Number(params.get('y'));
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    scale: clampScale(scale),
  };
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
