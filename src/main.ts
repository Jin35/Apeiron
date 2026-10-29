import { applyButtonZoomCommand, committedCamera, createButtonZoom, tickButtonZoom } from './buttonZoom';
import { clampScale, MAX_SCALE, MIN_SCALE, viewBounds, type Camera, type CameraCommand } from './camera';
import { demoObjects, initialCameraFor } from './demo';
import { attachGestures, ZOOM_STEP } from './gestures';
import { createRenderer } from './render';
import { createMemoryStore } from './store';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
const statusEl = document.querySelector<HTMLElement>('#status');
const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in');
const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out');
if (!canvas || !statusEl || !zoomIn || !zoomOut) {
  throw new Error('Apeiron markup is missing');
}
const surface = canvas;
const status = statusEl;
const zoomInButton = zoomIn;
const zoomOutButton = zoomOut;

let zoomAnim = createButtonZoom(cameraFromLocation(initialCameraFor(window.innerWidth)));
let zoomFrame = 0;
let drawing = false;
let pending = false;

const renderer = createRenderer(surface, () => publish());
const store = createMemoryStore(demoObjects);
// Off-band images are absent from the visible set. Fetch every src once up front.
renderer.warm(store.imageSources());

function formatScale(scale: number): string {
  if (scale >= 10) return scale.toFixed(1);
  if (scale >= 1) return scale.toFixed(2);
  return scale.toFixed(3);
}

function countVisible(scale: number): number {
  return store.countInBand(scale);
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

function localPoint(clientX: number, clientY: number) {
  const rect = surface.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function publish() {
  if (drawing) {
    pending = true;
    return;
  }
  drawing = true;
  try {
    const camera = zoomAnim.camera;
    const { width, height } = renderer.size();
    renderer.draw(
      camera,
      store.query({ bounds: viewBounds(camera, width, height), scale: camera.scale }),
    );
    const visible = countVisible(camera.scale);
    status.textContent = `×${formatScale(camera.scale)} · ${visible} visible`;
    status.dataset.scale = String(camera.scale);
    status.dataset.x = String(camera.x);
    status.dataset.y = String(camera.y);
    const limit = committedCamera(zoomAnim).scale;
    zoomInButton.disabled = limit >= MAX_SCALE - 1e-9;
    zoomOutButton.disabled = limit <= MIN_SCALE + 1e-9;
  } finally {
    drawing = false;
  }
  if (pending) {
    pending = false;
    publish();
  }
}

function pumpButtonZoom(now: number) {
  zoomFrame = 0;
  zoomAnim = tickButtonZoom(zoomAnim, now);
  publish();
  if (zoomAnim.segments.length > 0) zoomFrame = requestAnimationFrame(pumpButtonZoom);
}

function applyCommand(command: CameraCommand, viewW: number, viewH: number) {
  zoomAnim = applyButtonZoomCommand(zoomAnim, command, viewW, viewH, performance.now());
  if (command.type === 'zoomStep') {
    if (zoomAnim.segments.length > 0 && zoomFrame === 0) {
      zoomFrame = requestAnimationFrame(pumpButtonZoom);
    }
  } else if (zoomFrame !== 0) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = 0;
  }
  publish();
}

attachGestures(surface, {
  panBy(dx, dy) {
    // A pan does not use the viewport size.
    applyCommand({ type: 'panBy', dx, dy }, 0, 0);
  },
  zoomAt(x, y, factor) {
    const point = localPoint(x, y);
    applyCommand({ type: 'zoomAt', x: point.x, y: point.y, factor }, point.width, point.height);
  },
  retarget(anchorX, anchorY, targetX, targetY, factor) {
    const anchor = localPoint(anchorX, anchorY);
    const target = localPoint(targetX, targetY);
    applyCommand(
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
  applyCommand({ type: 'zoomStep', factor }, rect.width, rect.height);
}

zoomInButton.addEventListener('click', () => zoomStep(ZOOM_STEP));
zoomOutButton.addEventListener('click', () => zoomStep(1 / ZOOM_STEP));

new ResizeObserver(() => publish()).observe(surface);
publish();
