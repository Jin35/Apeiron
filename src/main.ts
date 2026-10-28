import { clampScale, MAX_SCALE, MIN_SCALE, panBy, retarget, zoomAt, type Camera } from './camera';
import { demoObjects, initialCameraFor } from './demo';
import { attachGestures, ZOOM_STEP } from './gestures';
import { createRenderer } from './render';
import { visibilityAlpha } from './visibility';

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

let camera = cameraFromLocation(initialCameraFor(window.innerWidth));
let drawing = false;
let pending = false;

const renderer = createRenderer(surface, () => publish());

function formatScale(scale: number): string {
  if (scale >= 10) return scale.toFixed(1);
  if (scale >= 1) return scale.toFixed(2);
  return scale.toFixed(3);
}

function countVisible(scale: number): number {
  let count = 0;
  for (const object of demoObjects) {
    if (visibilityAlpha(object.visibility, scale) > 0.02) count += 1;
  }
  return count;
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
    renderer.draw(camera, demoObjects);
    const visible = countVisible(camera.scale);
    status.textContent = `×${formatScale(camera.scale)} · ${visible} visible`;
    status.dataset.scale = String(camera.scale);
    status.dataset.x = String(camera.x);
    status.dataset.y = String(camera.y);
    zoomInButton.disabled = camera.scale >= MAX_SCALE - 1e-9;
    zoomOutButton.disabled = camera.scale <= MIN_SCALE + 1e-9;
  } finally {
    drawing = false;
  }
  if (pending) {
    pending = false;
    publish();
  }
}

function zoomFromCenter(factor: number) {
  const rect = surface.getBoundingClientRect();
  camera = zoomAt(camera, rect.width / 2, rect.height / 2, rect.width, rect.height, factor);
  publish();
}

attachGestures(surface, {
  panBy(dx, dy) {
    camera = panBy(camera, dx, dy);
    publish();
  },
  zoomAt(x, y, factor) {
    const point = localPoint(x, y);
    camera = zoomAt(camera, point.x, point.y, point.width, point.height, factor);
    publish();
  },
  retarget(anchorX, anchorY, targetX, targetY, factor) {
    const anchor = localPoint(anchorX, anchorY);
    const target = localPoint(targetX, targetY);
    camera = retarget(camera, anchor, target, anchor.width, anchor.height, factor);
    publish();
  },
});

zoomInButton.addEventListener('click', () => zoomFromCenter(ZOOM_STEP));
zoomOutButton.addEventListener('click', () => zoomFromCenter(1 / ZOOM_STEP));

new ResizeObserver(() => publish()).observe(surface);
publish();
