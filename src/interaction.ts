/**
 * Turns pointer, wheel, touch, keyboard, and +/− input into session commands.
 * Points on a command are canvas-local CSS pixels. This module does not
 * read the camera, the store, or the renderer.
 */

import type { CameraCommand } from './camera';
import { attachGestures, ZOOM_STEP } from './gestures';

/** Arrow keys move the view by this fraction of the canvas width. */
const KEY_PAN_FRACTION = 0.1;

/** Camera motion, or a click / settled tap. `selectAt` does not move the camera. */
export type SceneCommand = CameraCommand | { type: 'selectAt'; x: number; y: number };

export function attachInteraction(
  elements: { canvas: HTMLElement; zoomIn: HTMLElement; zoomOut: HTMLElement },
  emit: (command: SceneCommand) => void,
): () => void {
  const { canvas, zoomIn, zoomOut } = elements;

  function localPoint(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  const detachGestures = attachGestures(canvas, {
    panBy(dx, dy) {
      emit({ type: 'panBy', dx, dy });
    },
    zoomAt(x, y, factor) {
      const point = localPoint(x, y);
      emit({ type: 'zoomAt', x: point.x, y: point.y, factor });
    },
    retarget(anchorX, anchorY, targetX, targetY, factor) {
      const anchor = localPoint(anchorX, anchorY);
      const target = localPoint(targetX, targetY);
      emit({
        type: 'retarget',
        anchor,
        target,
        factor,
      });
    },
    selectAt(x, y) {
      const point = localPoint(x, y);
      emit({ type: 'selectAt', x: point.x, y: point.y });
    },
  });

  function onZoomIn() {
    emit({ type: 'zoomStep', factor: ZOOM_STEP });
  }

  function onZoomOut() {
    emit({ type: 'zoomStep', factor: 1 / ZOOM_STEP });
  }

  zoomIn.addEventListener('click', onZoomIn);
  zoomOut.addEventListener('click', onZoomOut);

  function onKeyDown(event: Event) {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) return;
    if (isTypingTarget(keyEvent.target)) return;
    const rect = canvas.getBoundingClientRect();
    const command = commandForKey(keyEvent.key, rect.width * KEY_PAN_FRACTION);
    if (!command) return;
    keyEvent.preventDefault();
    emit(command);
  }

  window.addEventListener('keydown', onKeyDown);

  return () => {
    detachGestures();
    zoomIn.removeEventListener('click', onZoomIn);
    zoomOut.removeEventListener('click', onZoomOut);
    window.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Arrow keys move the view: `panBy` shifts the camera opposite the screen
 * delta, so ArrowRight is a negative dx. `+` and `=` zoom in. `-` and `−` zoom out.
 */
function commandForKey(key: string, step: number): CameraCommand | null {
  switch (key) {
    case 'ArrowLeft':
      return { type: 'panBy', dx: step, dy: 0 };
    case 'ArrowRight':
      return { type: 'panBy', dx: -step, dy: 0 };
    case 'ArrowUp':
      return { type: 'panBy', dx: 0, dy: step };
    case 'ArrowDown':
      return { type: 'panBy', dx: 0, dy: -step };
    case '+':
    case '=':
      return { type: 'zoomStep', factor: ZOOM_STEP };
    case '-':
    case '−':
      return { type: 'zoomStep', factor: 1 / ZOOM_STEP };
    default:
      return null;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  if (element.isContentEditable) return true;
  switch (element.tagName?.toUpperCase()) {
    case 'INPUT':
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    default:
      return false;
  }
}
