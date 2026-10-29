/**
 * Turns pointer, wheel, touch, and +/− input into session commands.
 * Points on a command are canvas-local CSS pixels. This module does not
 * read the camera, the store, or the renderer.
 */

import type { CameraCommand } from './camera';
import { attachGestures, ZOOM_STEP } from './gestures';

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

  return () => {
    detachGestures();
    zoomIn.removeEventListener('click', onZoomIn);
    zoomOut.removeEventListener('click', onZoomOut);
  };
}
