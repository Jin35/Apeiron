import { describe, expect, it } from 'vitest';
import { classifyTap, isTwoFingerTap, wheelZoomFactor } from './gestures';

describe('classifyTap', () => {
  it('zooms in on a second nearby touch tap', () => {
    const first = classifyTap({
      pointerType: 'touch',
      moved: false,
      elapsedMs: 40,
      x: 10,
      y: 10,
      now: 1000,
      lastTap: null,
    });
    expect(first.zoomIn).toBe(false);
    const second = classifyTap({
      pointerType: 'touch',
      moved: false,
      elapsedMs: 50,
      x: 18,
      y: 14,
      now: 1220,
      lastTap: first.lastTap,
    });
    expect(second.zoomIn).toBe(true);
    expect(second.lastTap).toBeNull();
  });

  it('does not treat mouse clicks as taps', () => {
    const first = classifyTap({
      pointerType: 'mouse',
      moved: false,
      elapsedMs: 30,
      x: 4,
      y: 4,
      now: 500,
      lastTap: null,
    });
    const second = classifyTap({
      pointerType: 'mouse',
      moved: false,
      elapsedMs: 30,
      x: 5,
      y: 5,
      now: 700,
      lastTap: first.lastTap,
    });
    expect(first.zoomIn).toBe(false);
    expect(second.zoomIn).toBe(false);
  });

  it('cancels a pending double-tap after a drag', () => {
    const result = classifyTap({
      pointerType: 'touch',
      moved: true,
      elapsedMs: 20,
      x: 0,
      y: 0,
      now: 50,
      lastTap: { x: 0, y: 0, t: 0 },
    });
    expect(result.zoomIn).toBe(false);
    expect(result.lastTap).toBeNull();
  });

  it('starts a new sequence when the second tap is far away', () => {
    const second = classifyTap({
      pointerType: 'touch',
      moved: false,
      elapsedMs: 40,
      x: 400,
      y: 20,
      now: 1200,
      lastTap: { x: 10, y: 10, t: 1000 },
    });
    expect(second.zoomIn).toBe(false);
    expect(second.lastTap).toEqual({ x: 400, y: 20, t: 1200 });
  });
});

describe('wheelZoomFactor', () => {
  it('zooms out when the wheel scrolls down', () => {
    expect(wheelZoomFactor(100, false)).toBeLessThan(1);
    expect(wheelZoomFactor(-100, false)).toBeGreaterThan(1);
  });
});

describe('isTwoFingerTap', () => {
  it('accepts a short clean two-finger release', () => {
    expect(isTwoFingerTap(true, 120)).toBe(true);
  });

  it('rejects movement and a slow release', () => {
    expect(isTwoFingerTap(false, 80)).toBe(false);
    expect(isTwoFingerTap(true, 900)).toBe(false);
  });
});
