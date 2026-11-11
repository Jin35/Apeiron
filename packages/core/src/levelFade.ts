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
  /** Label that keeps this portal's own curve. Omitted when the pack sets none. */
  labelId?: string;
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
 * its `parentId` fade out over the same range. A label whose id the part names
 * in `labelId` leaves with that part. Descendants of a sibling that has faded
 * leave with that sibling; the active part's own children do not. No pack is
 * named here.
 *
 * The active portal is the entered one nearest `focus`. An equal distance
 * goes to the smaller id. It keeps its own fade curve, so a larger sibling
 * that finished earlier cannot blank the part under the camera. Every other
 * sibling still takes the furthest-along curve: panning onto a less-faded
 * neighbour does not bring the rest of the level back. Ancestor portals stay
 * applied. Children of any other entered portal stay at 0, including ones in
 * the viewport and ones whose own fade has already opened. Zooming out leaves
 * the range and the multiplier returns to 1.
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

  const active = nearestPortal(entered, focus);
  const fading = fadingPortals(active, entered, parentOf);
  const open = openPortalIds(active, entered, parentOf);
  const blocked = new Set<string>();
  for (const portal of entered) {
    if (!open.has(portal.id)) blocked.add(portal.id);
  }
  return { opacity: factorsFor(objects, fading, scale, blocked, parentOf) };
}

function factorsFor(
  objects: readonly CanvasObject[],
  fading: readonly Portal[],
  scale: number,
  blocked: ReadonlySet<string>,
  parentOf: ReadonlyMap<string, string | undefined>,
): (id: string) => number {
  const active = fading[0];
  const factors = new Map<string, number>();
  const seen = new Set<string>();
  for (const object of objects) {
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    if (object.payload.type === 'group' || object.payload.type === 'link') continue;
    if (belongsToBlocked(object, blocked, parentOf)) {
      factors.set(object.id, 0);
      continue;
    }
    // The part under the camera keeps its own curve, and so does the label
    // it names. A larger sibling that already finished must not blank the
    // part you zoomed to; it still holds the rest of the level down.
    const own =
      active !== undefined &&
      (object.id === active.id || (active.labelId !== undefined && object.id === active.labelId));
    let factor = 1;
    let touched = false;
    for (const portal of fading) {
      if (object.parentId !== portal.parentId) continue;
      if (own && portal.id !== active?.id) continue;
      const curve = relativeZoomAlpha({ fadeOut: portal.range }, scale / portal.fit);
      factor = touched ? Math.min(factor, curve) : curve;
      touched = true;
    }
    if (touched) factors.set(object.id, factor);
  }
  // A faded sibling takes its descendants with it. The active part's own
  // children stay: they are the level being revealed. Ancestors are protected
  // the same way, so a nested portal does not inherit the outer fade twice.
  const protectedIds = new Set<string>();
  if (active) {
    const walk = new Set<string>();
    let id: string | undefined = active.id;
    while (id && !walk.has(id)) {
      walk.add(id);
      protectedIds.add(id);
      id = parentOf.get(id);
    }
  }
  let grew = true;
  let guard = 0;
  while (grew && guard < 64) {
    grew = false;
    guard += 1;
    for (const object of objects) {
      if (factors.has(object.id)) continue;
      if (object.payload.type === 'group' || object.payload.type === 'link') continue;
      const parent = object.parentId;
      if (!parent || protectedIds.has(parent)) continue;
      const parentFactor = factors.get(parent);
      if (parentFactor === undefined) continue;
      factors.set(object.id, parentFactor);
      grew = true;
    }
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

  const labelOf = new Map<string, string | undefined>();
  for (const object of objects) {
    if (!labelOf.has(object.id)) labelOf.set(object.id, object.labelId);
  }

  const portals: Portal[] = [];
  for (const [id, range] of rangeOf) {
    const box = boxOf(id);
    if (!box) continue;
    const fit = boxFitScale(box, view.width, view.height);
    if (!(fit > 0) || !Number.isFinite(fit)) continue;
    const labelId = labelOf.get(id);
    portals.push({
      id,
      parentId: parentOf.get(id),
      ...(labelId ? { labelId } : {}),
      range,
      fit,
      x: (box.left + box.right) / 2,
      y: (box.top + box.bottom) / 2,
    });
  }
  return portals;
}

/**
 * The active portal and the entered portals you passed through to reach it.
 * A sibling portal that is also entered is not open: its children stay hidden.
 */
function openPortalIds(
  active: Portal,
  entered: readonly Portal[],
  parentOf: ReadonlyMap<string, string | undefined>,
): Set<string> {
  const enteredIds = new Set(entered.map((portal) => portal.id));
  const open = new Set<string>();
  const seen = new Set<string>();
  let id: string | undefined = active.id;
  while (id && !seen.has(id)) {
    seen.add(id);
    if (enteredIds.has(id)) open.add(id);
    id = parentOf.get(id);
  }
  return open;
}

/**
 * True when `object` is a child of an entered portal that is not the active
 * one and not an ancestor of it. `fadeInOf` names the portal directly.
 * A descendant parented under that portal is included even without a fade,
 * so a nearby child cannot draw just because its box meets the viewport.
 */
function belongsToBlocked(
  object: CanvasObject,
  blocked: ReadonlySet<string>,
  parentOf: ReadonlyMap<string, string | undefined>,
): boolean {
  if (blocked.size === 0) return false;
  const anchor = object.fade?.fadeInOf;
  if (anchor && blocked.has(anchor)) return true;
  const seen = new Set<string>();
  let id = object.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    if (blocked.has(id)) return true;
    id = parentOf.get(id);
  }
  return false;
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
