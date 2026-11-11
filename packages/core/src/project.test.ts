import { describe, expect, it } from 'vitest';
import type { CanvasObject } from './model';
import { projectCss } from './project';

describe('projectCss', () => {
  it('matches the camera projection for ordinary coordinates', () => {
    const objects: CanvasObject[] = [
      {
        id: 'root',
        x: 10,
        y: -4,
        scale: 0.5,
        visibility: { minScale: 0.01, maxScale: 10 },
        payload: { type: 'group' },
      },
      {
        id: 'child',
        parentId: 'root',
        x: 8,
        y: 6,
        visibility: { minScale: 0.01, maxScale: 10 },
        payload: { type: 'shape', kind: 'part', width: 4, height: 2 },
      },
    ];
    const camera = { x: 3, y: 1, scale: 5 };
    const box = projectCss(objects, 'child', camera, 200, 100);
    // world = (10 + 8 * 0.5, -4 + 6 * 0.5), size = (4, 2) * 0.5
    const worldX = 14;
    const worldY = -1;
    const width = 2 * camera.scale;
    const height = 1 * camera.scale;
    expect(box).toEqual({
      left: (worldX - width / camera.scale / 2 - camera.x) * camera.scale + 100,
      top: (worldY - height / camera.scale / 2 - camera.y) * camera.scale + 50,
      width,
      height,
    });
  });

  it('keeps a child offset that absolute world coordinates drop', () => {
    const parentX = 1e8;
    const offset = 1e-9;
    const scale = 1e10;
    const objects: CanvasObject[] = [
      {
        id: 'parent',
        x: parentX,
        y: 0,
        visibility: { minScale: 1, maxScale: 1e12 },
        payload: { type: 'shape', kind: 'part', width: 10, height: 10 },
      },
      {
        id: 'child',
        parentId: 'parent',
        x: offset,
        y: 0,
        visibility: { minScale: 1, maxScale: 1e12 },
        payload: { type: 'shape', kind: 'part', width: 1e-9, height: 1e-9 },
      },
    ];
    // Flattening loses the offset: 1e8 + 1e-9 is 1e8.
    expect(parentX + offset).toBe(parentX);
    const camera = { x: parentX, y: 0, scale };
    const viewW = 800;
    const box = projectCss(objects, 'child', camera, viewW, 600);
    expect(box).not.toBeNull();
    const center = (box?.left ?? 0) + (box?.width ?? 0) / 2;
    // 1e-9 world units * 1e10 px/unit = 10px to the right of the parent.
    expect(center).toBeCloseTo(viewW / 2 + 10, 4);
  });
});
