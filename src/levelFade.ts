import { boxFitScale, type ViewBounds } from './camera';
import { relativeZoomAlpha } from './fade';
import type { CanvasObject } from './model';

/**
 * Viewport centre in world units. The shell's camera stores this point.
 * `query` uses the centre of its bounds, which is the same point.
 */
export type LevelFocus = {
  x: number;
  y: number;
};

export type LevelPlan = {
  /**
   * Extra opacity for this id. Objects the handover does not touch are 1.
   * Multiply it with `displayOpacity`. A link is not listed: its stroke
   * stays the lower of the two endpoints after this multiplier.
   */
  opacity(id: string): number;
};

type Portal = {
  id: string;
  parentId: string | undefined;
  range: readonly [number, number];
  fit: number;
  x: number;
  y: number;
};

const SHOWN: LevelPlan = { opacity: () => 1 };

/**
 * Sibling fade for the child level under the camera.
 *
 * A portal is an object some resident `fadeInOf` names. Its children fade in
 * over that range of its own opening fit. While the camera is in that part's
 * fit-scale range — every scale at or above `fit * start`, so the level stays
 * entered after the blend finishes — the part and every sibling that shares
 * its `parentId` fade out over the same range. Descendants are a different
 * parent, so they keep their own fade. Labels sit on the parent group with
 * the part, so they leave with it. No pack is named here.
 *
 * The active portal is the entered one nearest `focus`. An equal distance
 * goes to the smaller id. The choice is a pure function of the camera, so a
 * still view cannot flicker. Ancestor portals of that part stay applied, and
 * so does every other entered portal in the same sibling group: switching
 * which sibling is nearest can only hold the level down, never pop it back.
 * Zooming out leaves the range and the multiplier returns to 1.
 */
export function buildLevelPlan(
  objects: readonly CanvasObject[],
  boxOf: (id: string) => ViewBounds | undefined,
  scale: number,
  focus: LevelFocus | undefined,
  view: { width: number; height: number } | undefined,
): LevelPlan {
  if (!Number.isFinite(scale) || !(scale > 0)) return SHOWN;
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) return SHOWN;
  if (!view || !(view.width > 0) || !(view.height > 0)) return SHOWN;

  const parentOf = new Map<string, string | undefined>();
  for (const object of objects) {
    if (!parentOf.has(object.id)) parentOf.set(object.id, object.parentId);
  }

  const portals = collectPortals(objects, parentOf, boxOf, view);
  const entered = portals.filter((portal) => scale / portal.fit >= portal.range[0]);
  if (entered.length === 0) return SHOWN;

  const fading = fadingPortals(nearestPortal(entered, focus), entered, parentOf);
  return { opacity: factorsFor(objects, fading, scale) };
}

function factorsFor(
  objects: readonly CanvasObject[],
  fading: readonly Portal[],
  scale: number,
): (id: string) => number {
  const factors = new Map<string, number>();
  const seen = new Set<string>();
  for (const object of objects) {
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    if (object.payload.type === 'group' || object.payload.type === 'link') continue;
    let factor = 1;
    let touched = false;
    for (const portal of fading) {
      if (object.parentId !== portal.parentId) continue;
      const curve = relativeZoomAlpha({ fadeOut: portal.range }, scale / portal.fit);
      factor = touched ? Math.min(factor, curve) : curve;
      touched = true;
    }
    if (touched) factors.set(object.id, factor);
  }
  return (id: string) => factors.get(id) ?? 1;
}

function collectPortals(
  objects: readonly CanvasObject[],
  parentOf: ReadonlyMap<string, string | undefined>,
  boxOf: (id: string) => ViewBounds | undefined,
  view: { width: number; height: number },
): Portal[] {
  const rangeOf = new Map<string, readonly [number, number]>();
  for (const object of objects) {
    const anchor = object.fade?.fadeInOf;
    const range = object.fade?.fadeIn;
    if (!anchor || !range || rangeOf.has(anchor)) continue;
    const [start, end] = range;
    if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    rangeOf.set(anchor, range);
  }

  const portals: Portal[] = [];
  for (const [id, range] of rangeOf) {
    const box = boxOf(id);
    if (!box) continue;
    const fit = boxFitScale(box, view.width, view.height);
    if (!(fit > 0) || !Number.isFinite(fit)) continue;
    portals.push({
      id,
      parentId: parentOf.get(id),
      range,
      fit,
      x: (box.left + box.right) / 2,
      y: (box.top + box.bottom) / 2,
    });
  }
  return portals;
}

function nearestPortal(portals: readonly Portal[], focus: LevelFocus): Portal {
  let best = portals[0] as Portal;
  let bestDistance = distance2(best, focus);
  for (let i = 1; i < portals.length; i += 1) {
    const portal = portals[i];
    if (!portal) continue;
    const distance = distance2(portal, focus);
    if (distance < bestDistance || (distance === bestDistance && portal.id < best.id)) {
      best = portal;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The active portal, its entered ancestors, and any other entered portal
 * that shares a parent with one of those. Ancestor fade keeps an outer
 * level down after a nested part becomes nearest. Same-level portals use
 * the further-along curve so a small pan cannot raise opacity.
 */
function fadingPortals(
  active: Portal,
  entered: readonly Portal[],
  parentOf: ReadonlyMap<string, string | undefined>,
): Portal[] {
  const byId = new Map(entered.map((portal) => [portal.id, portal]));
  const chain: Portal[] = [];
  const seen = new Set<string>();
  let id: string | undefined = active.id;
  while (id && !seen.has(id)) {
    seen.add(id);
    const portal = byId.get(id);
    if (portal) chain.push(portal);
    id = parentOf.get(id);
  }

  const parents = new Set(chain.map((portal) => portal.parentId));
  const fading = [...chain];
  const included = new Set(chain.map((portal) => portal.id));
  for (const portal of entered) {
    if (included.has(portal.id)) continue;
    if (!parents.has(portal.parentId)) continue;
    fading.push(portal);
    included.add(portal.id);
  }
  return fading;
}

function distance2(portal: Portal, focus: LevelFocus): number {
  const dx = portal.x - focus.x;
  const dy = portal.y - focus.y;
  return dx * dx + dy * dy;
}
