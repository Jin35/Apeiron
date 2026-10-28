/**
 * Full-screen "greedy" camera gestures (Google Maps app, not a cooperative embed).
 * Wheel and trackpad scroll zoom toward the pointer; they never pan the camera.
 * One pointer drags to pan. Two pointers pinch to zoom. Rotation is ignored.
 * A touch double-tap zooms in. A two-finger tap zooms out. Mouse double-click does not.
 */

export const ZOOM_STEP = 2;
const TAP_SLOP = 14;
const TAP_MS = 280;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 28;
const TWO_FINGER_TAP_MS = 280;

/** Positive wheel delta (scroll down / pinch closed) zooms out. */
export function wheelZoomFactor(delta: number, ctrlKey: boolean): number {
  const gain = ctrlKey ? 0.007 : 0.0025;
  return Math.exp(-delta * gain);
}

export type TapPoint = { x: number; y: number; t: number };

export type GestureHost = {
  panBy(dx: number, dy: number): void;
  /** Client coordinates. */
  zoomAt(x: number, y: number, factor: number): void;
  /** Client coordinates. Keeps the world point under the anchor pinned to the target. */
  retarget(anchorX: number, anchorY: number, targetX: number, targetY: number, factor: number): void;
};

type PointerRecord = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startT: number;
  moved: boolean;
};

type PairState = {
  born: number;
  ids: [number, number];
  clean: boolean;
};

type PinchState = {
  dist: number;
  cx: number;
  cy: number;
};

export function classifyTap(input: {
  pointerType: string;
  moved: boolean;
  elapsedMs: number;
  x: number;
  y: number;
  now: number;
  lastTap: TapPoint | null;
}): { zoomIn: boolean; lastTap: TapPoint | null } {
  const tap =
    input.pointerType !== 'mouse' && !input.moved && input.elapsedMs >= 0 && input.elapsedMs <= TAP_MS;
  if (!tap) {
    return { zoomIn: false, lastTap: input.moved ? null : input.lastTap };
  }
  const last = input.lastTap;
  if (
    last &&
    input.now - last.t <= DOUBLE_TAP_MS &&
    Math.hypot(input.x - last.x, input.y - last.y) <= DOUBLE_TAP_DIST
  ) {
    return { zoomIn: true, lastTap: null };
  }
  return { zoomIn: false, lastTap: { x: input.x, y: input.y, t: input.now } };
}

export function isTwoFingerTap(clean: boolean, elapsedMs: number): boolean {
  return clean && elapsedMs >= 0 && elapsedMs <= TWO_FINGER_TAP_MS;
}

type GestureScaleEvent = Event & { scale: number; clientX: number; clientY: number };

export function attachGestures(target: HTMLElement, host: GestureHost): () => void {
  const pointers = new Map<number, PointerRecord>();
  const suppressTap = new Set<number>();
  let lastTap: TapPoint | null = null;
  let pair: PairState | null = null;
  let pinch: PinchState | null = null;
  let safariPinch = 1;
  let safariGesturing = false;

  function centroid(): PinchState | null {
    const pts = [...pointers.values()];
    if (pts.length < 2) return null;
    return {
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can vanish before capture; the element still receives the move.
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startT: performance.now(),
      moved: false,
    });
    if (pointers.size === 2) {
      const ids = [...pointers.keys()];
      const recs = [...pointers.values()];
      pair = {
        born: performance.now(),
        ids: [ids[0], ids[1]],
        clean: recs.every((rec) => !rec.moved),
      };
      pinch = centroid();
    } else if (pointers.size > 2) {
      pair = null;
      pinch = null;
    }
  }

  function onPointerMove(event: PointerEvent) {
    const rec = pointers.get(event.pointerId);
    if (!rec) return;
    const travel = Math.hypot(event.clientX - rec.startX, event.clientY - rec.startY);
    if (travel > TAP_SLOP) rec.moved = true;
    if (pair && rec.moved) pair.clean = false;

    if (pointers.size === 1) {
      if (!rec.moved) return;
      host.panBy(event.clientX - rec.x, event.clientY - rec.y);
      rec.x = event.clientX;
      rec.y = event.clientY;
      target.classList.add('is-panning');
      return;
    }

    rec.x = event.clientX;
    rec.y = event.clientY;
    if (pointers.size === 2 && pinch) {
      const next = centroid();
      if (next && pinch.dist > 0.5 && next.dist > 0.5) {
        host.retarget(pinch.cx, pinch.cy, next.cx, next.cy, next.dist / pinch.dist);
      }
      pinch = next;
    }
  }

  function endPointer(event: PointerEvent, cancelled: boolean) {
    const rec = pointers.get(event.pointerId);
    if (!rec) return;
    pointers.delete(event.pointerId);
    const suppressed = suppressTap.delete(event.pointerId);

    let zoomedOut = false;
    if (pair && (pair.ids[0] === event.pointerId || pair.ids[1] === event.pointerId)) {
      if (event.pointerType === 'mouse' || rec.moved || cancelled) pair.clean = false;
      if (!cancelled && isTwoFingerTap(pair.clean, performance.now() - pair.born)) {
        const other = [...pointers.values()][0];
        const ox = other?.x ?? rec.x;
        const oy = other?.y ?? rec.y;
        host.zoomAt((rec.x + ox) / 2, (rec.y + oy) / 2, 1 / ZOOM_STEP);
        for (const id of pointers.keys()) suppressTap.add(id);
        lastTap = null;
        zoomedOut = true;
      }
      pair = null;
    }

    pinch = pointers.size >= 2 ? centroid() : null;
    if (pointers.size === 0) target.classList.remove('is-panning');
    if (cancelled || suppressed || zoomedOut) return;

    const now = performance.now();
    const decision = classifyTap({
      pointerType: event.pointerType,
      moved: rec.moved,
      elapsedMs: now - rec.startT,
      x: event.clientX,
      y: event.clientY,
      now,
      lastTap,
    });
    lastTap = decision.lastTap;
    if (decision.zoomIn) host.zoomAt(event.clientX, event.clientY, ZOOM_STEP);
  }

  function onWheel(event: WheelEvent) {
    if (safariGesturing) return;
    event.preventDefault();
    const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    let delta = dominant;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= window.innerHeight;
    host.zoomAt(event.clientX, event.clientY, wheelZoomFactor(delta, event.ctrlKey));
  }

  function onGestureStart(event: Event) {
    event.preventDefault();
    safariGesturing = true;
    safariPinch = 1;
  }

  function onGestureChange(event: Event) {
    event.preventDefault();
    const gesture = event as GestureScaleEvent;
    if (safariPinch > 0 && Number.isFinite(gesture.scale) && gesture.scale > 0) {
      host.zoomAt(gesture.clientX, gesture.clientY, gesture.scale / safariPinch);
      safariPinch = gesture.scale;
    }
  }

  function onGestureEnd(event: Event) {
    event.preventDefault();
    safariGesturing = false;
  }

  function onTouchGuard(event: Event) {
    event.preventDefault();
  }

  function onContextMenu(event: Event) {
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent) {
    endPointer(event, false);
  }

  function onPointerCancel(event: PointerEvent) {
    endPointer(event, true);
  }

  function listen(node: EventTarget, type: string, handler: EventListener) {
    node.addEventListener(type, handler, { passive: false });
  }

  function unlisten(node: EventTarget, type: string, handler: EventListener) {
    node.removeEventListener(type, handler);
  }

  listen(target, 'pointerdown', onPointerDown as EventListener);
  listen(target, 'pointermove', onPointerMove as EventListener);
  listen(target, 'pointerup', onPointerUp as EventListener);
  listen(target, 'pointercancel', onPointerCancel as EventListener);
  listen(target, 'contextmenu', onContextMenu);
  listen(target, 'touchstart', onTouchGuard);
  listen(target, 'touchmove', onTouchGuard);
  listen(window, 'wheel', onWheel as EventListener);
  listen(window, 'gesturestart', onGestureStart);
  listen(window, 'gesturechange', onGestureChange);
  listen(window, 'gestureend', onGestureEnd);

  return () => {
    unlisten(target, 'pointerdown', onPointerDown as EventListener);
    unlisten(target, 'pointermove', onPointerMove as EventListener);
    unlisten(target, 'pointerup', onPointerUp as EventListener);
    unlisten(target, 'pointercancel', onPointerCancel as EventListener);
    unlisten(target, 'contextmenu', onContextMenu);
    unlisten(target, 'touchstart', onTouchGuard);
    unlisten(target, 'touchmove', onTouchGuard);
    unlisten(window, 'wheel', onWheel as EventListener);
    unlisten(window, 'gesturestart', onGestureStart);
    unlisten(window, 'gesturechange', onGestureChange);
    unlisten(window, 'gestureend', onGestureEnd);
  };
}
