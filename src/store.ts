import type { ViewBounds } from './camera';
import type { CanvasObject } from './model';
import { visibilityAlpha } from './visibility';

/** HUD counts an object only above this opacity. */
const HUD_ALPHA = 0.02;

/** A draw query includes an object only above this opacity. */
const DRAW_ALPHA = 0.01;

export type SceneQuery = {
  bounds: ViewBounds;
  scale: number;
};

export type VisibleObject = {
  object: CanvasObject;
  /** Result of visibilityAlpha at the query scale. */
  alpha: number;
};

export interface SceneStore {
  /**
   * Objects above the draw cutoff (0.01). `bounds` is accepted and ignored
   * until a later change culls to the viewport.
   */
  query(query: SceneQuery): VisibleObject[];
  /** Objects above the HUD cutoff (0.02), anywhere in the world. */
  countInBand(scale: number): number;
}

/** Linear scan of a fixed object list. */
export function createMemoryStore(objects: readonly CanvasObject[]): SceneStore {
  return {
    countInBand(scale) {
      let count = 0;
      for (const object of objects) {
        if (visibilityAlpha(object.visibility, scale) > HUD_ALPHA) count += 1;
      }
      return count;
    },
    query(query) {
      const visible: VisibleObject[] = [];
      for (const object of objects) {
        const alpha = visibilityAlpha(object.visibility, query.scale);
        if (alpha > DRAW_ALPHA) visible.push({ object, alpha });
      }
      return visible;
    },
  };
}
