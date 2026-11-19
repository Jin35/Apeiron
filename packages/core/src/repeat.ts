import type { ViewBounds } from './camera';
import type { CanvasObject, LatticeKind, NodeRepeat, RepeatPattern, RepeatRegion } from './model';
import { createPlacement, type WorldPlacement } from './placement';

/**
 * Below this on-screen size, copies are a single fill of the region.
 * About three CSS pixels: smaller marks alias into noise.
 */
export const REPEAT_LOD_PX = 3;

/** Copies drawn in one frame. Past this the region is filled instead. */
export const MAX_REPEAT_COPIES = 2000;

/**
 * Repeated views are tile windows, not the part itself. They stay faint
 * unless the repeat names its own opacity.
 */
export const VIEW_REPEAT_OPACITY = 0.25;

/** How far a sparse nearest-copy search walks, in cells, before it gives up. */
const OCCUPANCY_SEARCH = 48;

/**
 * A sparse window may be scanned while the occupied count stays under the cap.
 * Past this many candidates the region is filled from the estimate.
 */
const OCCUPANCY_SCAN = MAX_REPEAT_COPIES * 8;

/** Points regenerated inside one scatter tile. Keeps a tile a fixed cost. */
const SCATTER_PER_TILE = 4;

export type RepeatFocus = {
  /** World point. The copy nearest this point is the one children open inside. */
  x: number;
  y: number;
  /** Pins one node's copy, from `?focus=&i=`, until a pointer zoom replaces it. */
  lock?: { id: string; index: number };
};

export type LocalRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type VisibleCopy = {
  index: number;
  /** Centre in the parent's local coordinates. */
  x: number;
  y: number;
};

export type VisibleCopies = {
  /**
   * Copies whose footprints meet the view. This is not `repeat.count`
   * unless the view happens to cover every copy.
   */
  count: number;
  /** True when drawing individuals would pass the per-frame cap. */
  capped: boolean;
  forEach(visit: (copy: VisibleCopy) => void): void;
};

/**
 * Device-wide copy total: `count` of this node times `count` of each
 * repeated ancestor. A node without `repeat` contributes 1. Null when
 * `id` itself is not repeated.
 */
export function repeatTotal(objects: readonly CanvasObject[], id: string): number | null {
  const byId = indexById(objects);
  const node = byId.get(id);
  if (!node?.repeat) return null;
  let total = 1;
  const seen = new Set<string>();
  let current: CanvasObject | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const repeat = current.repeat;
    const count = repeat?.count;
    if (repeat && count !== undefined && count > 0 && Number.isFinite(count)) {
      total *= count * occupancyOf(repeat);
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return total;
}

/**
 * Label suffix for a repeat count. Exact integers under 1000 stay exact
 * (`×4`). Larger magnitudes use the same `×~N billion` form as pack labels.
 * The caller passes the chain total when that total differs from `count`.
 */
export function formatRepeatCount(count: number): string {
  if (!Number.isFinite(count) || !(count > 0)) return '×0';
  if (count >= 1e9) return `×~${trimMagnitude(count / 1e9)} billion`;
  if (count >= 1e6) return `×~${trimMagnitude(count / 1e6)} million`;
  if (count >= 1e3) return `×~${trimMagnitude(count / 1e3)} thousand`;
  if (Number.isInteger(count)) return `×${count}`;
  return `×~${trimMagnitude(count)}`;
}

/** True when a grid's drawn copies are exactly its per-parent `count`. */
export function gridMatchesCount(pattern: RepeatPattern, count: number): boolean {
  if (pattern.kind !== 'grid') return true;
  return pattern.cols * pattern.rows === count;
}

/** Sites in one cell. Honeycomb is graphene's two-atom basis. Diamond is four [110] columns. */
export function latticeBasis(lattice: LatticeKind): number {
  if (lattice === 'honeycomb') return 2;
  if (lattice === 'diamond') return 4;
  return 1;
}

/**
 * Distance between neighbours that the projection keeps at the real bond length.
 * Honeycomb: `a / √3`. Diamond [110], in-plane bond: `a · √3 / 4`. Hex and square: `a`.
 */
export function latticeNeighbourDistance(lattice: LatticeKind, a: number): number {
  if (!(a > 0)) return 0;
  if (lattice === 'honeycomb') return a / Math.sqrt(3);
  if (lattice === 'diamond') return (a * Math.sqrt(3)) / 4;
  return a;
}

/**
 * Parent-local centre of copy `index`, or null when `index` is outside the pattern.
 * Copy 0 is the node's authored `(originX, originY)`.
 */
export function copyLocalPosition(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  index: number,
): { x: number; y: number } | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const pattern = repeat.pattern;
  if (pattern.kind === 'grid') {
    const { cols, rows, pitchX, pitchY } = pattern;
    if (!(cols >= 1) || !(rows >= 1) || !(pitchX > 0) || !(pitchY > 0)) return null;
    if (index >= cols * rows) return null;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return { x: originX + col * pitchX, y: originY + row * pitchY };
  }
  if (pattern.kind === 'rows') {
    if (!(pattern.pitch > 0) || !(repeat.count >= 1) || index >= repeat.count) return null;
    const stagger = pattern.stagger ?? 0;
    const odd = index % 2 === 1;
    return { x: originX + (odd ? stagger : 0), y: originY + index * pattern.pitch };
  }
  if (pattern.kind === 'lattice') return latticeAt(pattern, originX, originY, index);
  const spot = scatterAt(repeat, originX, originY, index);
  return spot ? { x: spot.x, y: spot.y } : null;
}

/**
 * Copy under a parent-local point, or null when the point misses every footprint.
 * Grid and rows use the inverse of the pitch. Scatter regenerates the one tile
 * the point falls in.
 */
export function copyIndexAt(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
  localX: number,
  localY: number,
): number | null {
  const halfW = footprintW / 2;
  const halfH = footprintH / 2;
  const pattern = repeat.pattern;
  if (pattern.kind === 'grid') {
    const { cols, rows, pitchX, pitchY } = pattern;
    if (!(cols >= 1) || !(rows >= 1) || !(pitchX > 0) || !(pitchY > 0)) return null;
    const col = Math.round((localX - originX) / pitchX);
    const row = Math.round((localY - originY) / pitchY);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
    const x = originX + col * pitchX;
    const y = originY + row * pitchY;
    if (!inside(localX, localY, x, y, halfW, halfH)) return null;
    if (!centerInRegion(repeat.region, x, y)) return null;
    const index = row * cols + col;
    return isCopyOccupied(repeat, index) ? index : null;
  }
  if (pattern.kind === 'rows') {
    if (!(pattern.pitch > 0) || !(repeat.count >= 1)) return null;
    const row = Math.round((localY - originY) / pattern.pitch);
    if (row < 0 || row >= repeat.count) return null;
    const stagger = pattern.stagger ?? 0;
    const x = originX + (row % 2 === 1 ? stagger : 0);
    const y = originY + row * pattern.pitch;
    if (!inside(localX, localY, x, y, halfW, halfH)) return null;
    if (!centerInRegion(repeat.region, x, y)) return null;
    return isCopyOccupied(repeat, row) ? row : null;
  }
  if (pattern.kind === 'lattice') {
    const index = latticeIndexAt(pattern, repeat.region, originX, originY, halfW, halfH, localX, localY);
    return index !== null && isCopyOccupied(repeat, index) ? index : null;
  }
  const scattered = scatterIndexAt(repeat, originX, originY, halfW, halfH, localX, localY);
  return scattered !== null && isCopyOccupied(repeat, scattered) ? scattered : null;
}

/** Nearest copy to a parent-local point. Used when opening children, not for hits. */
export function nearestCopyIndex(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  localX: number,
  localY: number,
): number {
  const pattern = repeat.pattern;
  if (pattern.kind === 'grid') {
    const { cols, rows, pitchX, pitchY } = pattern;
    if (!(cols >= 1) || !(rows >= 1) || !(pitchX > 0) || !(pitchY > 0)) return 0;
    const col = clamp(Math.round((localX - originX) / pitchX), 0, cols - 1);
    const row = clamp(Math.round((localY - originY) / pitchY), 0, rows - 1);
    return nearestOccupied(repeat, row * cols + col, (index) => {
      const c = index % cols;
      const r = Math.floor(index / cols);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
      return { x: originX + c * pitchX, y: originY + r * pitchY };
    }, (radius, visit) => {
      for (let r = Math.max(0, row - radius); r <= Math.min(rows - 1, row + radius); r += 1) {
        for (let c = Math.max(0, col - radius); c <= Math.min(cols - 1, col + radius); c += 1) {
          if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== radius) continue;
          visit(r * cols + c);
        }
      }
    });
  }
  if (pattern.kind === 'rows') {
    if (!(pattern.pitch > 0) || !(repeat.count >= 1)) return 0;
    const row = clamp(Math.round((localY - originY) / pattern.pitch), 0, repeat.count - 1);
    return nearestOccupied(repeat, row, (index) => {
      if (index < 0 || index >= repeat.count) return null;
      const stagger = pattern.stagger ?? 0;
      return { x: originX + (index % 2 === 1 ? stagger : 0), y: originY + index * pattern.pitch };
    }, (radius, visit) => {
      if (row - radius >= 0) visit(row - radius);
      if (radius > 0 && row + radius < repeat.count) visit(row + radius);
    });
  }
  if (pattern.kind === 'lattice') return nearestLattice(repeat, pattern, originX, originY, localX, localY);
  const hit = scatterNearest(repeat, originX, originY, localX, localY);
  if (hit === null) return 0;
  if (isCopyOccupied(repeat, hit)) return hit;
  return hit;
}

/**
 * Copies that intersect `view`, in parent-local coordinates.
 * The grid range is the inverse of the pitch, so a `count` of 1e10 does not
 * iterate. `forEach` visits nothing when the window is over the frame cap.
 */
export function visibleCopies(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
  view: LocalRect,
): VisibleCopies {
  const pattern = repeat.pattern;
  const raw =
    pattern.kind === 'grid'
      ? visibleGrid(pattern, repeat.region, originX, originY, footprintW, footprintH, view, occupancyOf(repeat))
      : pattern.kind === 'rows'
        ? visibleRows(repeat, originX, originY, footprintW, footprintH, view)
        : pattern.kind === 'lattice'
          ? visibleLattice(repeat, originX, originY, footprintW, footprintH, view)
          : visibleScatter(repeat, footprintW, footprintH, view);
  return applyOccupancy(repeat, raw);
}

/** Individuals, or one fill. A copy under ~3px, or a window over the cap, fills. */
export function repeatDetail(
  minorScreenPx: number,
  visible: { count: number; capped: boolean },
): 'copies' | 'fill' {
  if (!(visible.count > 0)) return 'fill';
  if (visible.capped || visible.count > MAX_REPEAT_COPIES) return 'fill';
  if (!(minorScreenPx >= REPEAT_LOD_PX)) return 'fill';
  return 'copies';
}

const NONE: VisibleCopies = { count: 0, capped: false, forEach() {} };

function visibleGrid(
  pattern: Extract<RepeatPattern, { kind: 'grid' }>,
  region: RepeatRegion | undefined,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
  view: LocalRect,
  occupancy: number,
): VisibleCopies {
  const { cols, rows, pitchX, pitchY } = pattern;
  if (!(cols >= 1) || !(rows >= 1) || !(pitchX > 0) || !(pitchY > 0)) return NONE;
  const colsWindow = axisWindow(originX, pitchX, cols, footprintW / 2, view.left, view.right, region, 'x');
  const rowsWindow = axisWindow(originY, pitchY, rows, footprintH / 2, view.top, view.bottom, region, 'y');
  if (!colsWindow || !rowsWindow) return NONE;
  const count = (colsWindow.max - colsWindow.min + 1) * (rowsWindow.max - rowsWindow.min + 1);
  const capped = overCap(count, occupancy);
  return {
    count,
    capped,
    forEach(visit) {
      if (capped) return;
      for (let row = rowsWindow.min; row <= rowsWindow.max; row += 1) {
        for (let col = colsWindow.min; col <= colsWindow.max; col += 1) {
          visit({
            index: row * cols + col,
            x: originX + col * pitchX,
            y: originY + row * pitchY,
          });
        }
      }
    },
  };
}

function visibleRows(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
  view: LocalRect,
): VisibleCopies {
  const pattern = repeat.pattern;
  if (pattern.kind !== 'rows') return NONE;
  if (!(pattern.pitch > 0) || !(repeat.count >= 1)) return NONE;
  const halfH = footprintH / 2;
  const halfW = footprintW / 2;
  const stagger = pattern.stagger ?? 0;
  let minCenter = view.top - halfH;
  let maxCenter = view.bottom + halfH;
  if (repeat.region) {
    minCenter = Math.max(minCenter, repeat.region.y - repeat.region.height / 2);
    maxCenter = Math.min(maxCenter, repeat.region.y + repeat.region.height / 2);
  }
  let min = Math.ceil((minCenter - originY) / pattern.pitch - 1e-9);
  let max = Math.floor((maxCenter - originY) / pattern.pitch + 1e-9);
  min = Math.max(0, min);
  max = Math.min(repeat.count - 1, max);
  if (max < min) return NONE;
  const fits = (index: number) => {
    const x = originX + (index % 2 === 1 ? stagger : 0);
    return x + halfW >= view.left && x - halfW <= view.right && centerInRegion(repeat.region, x, originY + index * pattern.pitch);
  };
  let count = 0;
  const span = max - min + 1;
  if (overCap(span, occupancyOf(repeat))) {
    return { count: span, capped: true, forEach() {} };
  }
  for (let index = min; index <= max; index += 1) if (fits(index)) count += 1;
  const capped = count > MAX_REPEAT_COPIES;
  return {
    count,
    capped,
    forEach(visit) {
      if (capped) return;
      for (let index = min; index <= max; index += 1) {
        if (!fits(index)) continue;
        visit({
          index,
          x: originX + (index % 2 === 1 ? stagger : 0),
          y: originY + index * pattern.pitch,
        });
      }
    },
  };
}

function visibleScatter(
  repeat: NodeRepeat,
  footprintW: number,
  footprintH: number,
  view: LocalRect,
): VisibleCopies {
  const tiles = scatterTiles(repeat, view, footprintW, footprintH);
  if (!tiles) return NONE;
  const capped = tiles.tileCount * SCATTER_PER_TILE > MAX_REPEAT_COPIES;
  let count = 0;
  if (!capped) {
    eachScatter(repeat, tiles, (copy) => {
      if (footprintHits(copy.x, copy.y, footprintW, footprintH, view)) count += 1;
    });
  } else {
    count = tiles.tileCount * SCATTER_PER_TILE;
  }
  return {
    count,
    capped,
    forEach(visit) {
      if (capped) return;
      eachScatter(repeat, tiles, (copy) => {
        if (footprintHits(copy.x, copy.y, footprintW, footprintH, view)) visit(copy);
      });
    },
  };
}

type AxisWindow = { min: number; max: number };

function axisWindow(
  origin: number,
  pitch: number,
  n: number,
  half: number,
  viewMin: number,
  viewMax: number,
  region: RepeatRegion | undefined,
  axis: 'x' | 'y',
): AxisWindow | null {
  let minCenter = viewMin - half;
  let maxCenter = viewMax + half;
  if (region) {
    const center = axis === 'x' ? region.x : region.y;
    const span = axis === 'x' ? region.width : region.height;
    minCenter = Math.max(minCenter, center - span / 2);
    maxCenter = Math.min(maxCenter, center + span / 2);
  }
  let min = Math.ceil((minCenter - origin) / pitch - 1e-9);
  let max = Math.floor((maxCenter - origin) / pitch + 1e-9);
  min = Math.max(0, min);
  max = Math.min(n - 1, max);
  if (max < min) return null;
  return { min, max };
}

function inside(px: number, py: number, cx: number, cy: number, halfW: number, halfH: number): boolean {
  return Math.abs(px - cx) <= halfW + 1e-9 && Math.abs(py - cy) <= halfH + 1e-9;
}

function centerInRegion(region: RepeatRegion | undefined, x: number, y: number): boolean {
  if (!region) return true;
  const hw = region.width / 2;
  const hh = region.height / 2;
  return x >= region.x - hw - 1e-9 && x <= region.x + hw + 1e-9 && y >= region.y - hh - 1e-9 && y <= region.y + hh + 1e-9;
}

function footprintHits(x: number, y: number, width: number, height: number, view: LocalRect): boolean {
  return x + width / 2 >= view.left && x - width / 2 <= view.right && y + height / 2 >= view.top && y - height / 2 <= view.bottom;
}

type ScatterWindow = {
  tile: number;
  tilesX: number;
  x0: number;
  y0: number;
  tx0: number;
  tx1: number;
  ty0: number;
  ty1: number;
  tileCount: number;
  region: RepeatRegion;
};

function scatterWindow(repeat: NodeRepeat, view: LocalRect, padX: number, padY: number): ScatterWindow | null {
  const pattern = repeat.pattern;
  const region = repeat.region;
  if (pattern.kind !== 'scatter' || !region) return null;
  if (!(pattern.density > 0) || !(region.width > 0) || !(region.height > 0)) return null;
  const tile = Math.sqrt(SCATTER_PER_TILE / pattern.density);
  if (!(tile > 0) || !Number.isFinite(tile)) return null;
  const left = region.x - region.width / 2;
  const top = region.y - region.height / 2;
  const tilesX = Math.max(1, Math.ceil(region.width / tile - 1e-9));
  const tilesY = Math.max(1, Math.ceil(region.height / tile - 1e-9));
  const tx0 = clamp(Math.floor((view.left - padX - left) / tile), 0, tilesX - 1);
  const tx1 = clamp(Math.floor((view.right + padX - left) / tile), 0, tilesX - 1);
  const ty0 = clamp(Math.floor((view.top - padY - top) / tile), 0, tilesY - 1);
  const ty1 = clamp(Math.floor((view.bottom + padY - top) / tile), 0, tilesY - 1);
  if (tx1 < tx0 || ty1 < ty0) return null;
  return {
    tile,
    tilesX,
    x0: left,
    y0: top,
    tx0,
    tx1,
    ty0,
    ty1,
    tileCount: (tx1 - tx0 + 1) * (ty1 - ty0 + 1),
    region,
  };
}

function scatterTiles(repeat: NodeRepeat, view: LocalRect, footprintW: number, footprintH: number): ScatterWindow | null {
  return scatterWindow(repeat, view, footprintW / 2, footprintH / 2);
}

function eachScatter(repeat: NodeRepeat, tiles: ScatterWindow, visit: (copy: VisibleCopy) => void): void {
  const pattern = repeat.pattern;
  if (pattern.kind !== 'scatter') return;
  for (let ty = tiles.ty0; ty <= tiles.ty1; ty += 1) {
    for (let tx = tiles.tx0; tx <= tiles.tx1; tx += 1) {
      for (const copy of tilePoints(pattern.seed, pattern.density, tiles, tx, ty)) visit(copy);
    }
  }
}

function tilePoints(seed: number, density: number, tiles: ScatterWindow, tx: number, ty: number): VisibleCopy[] {
  const expected = density * tiles.tile * tiles.tile;
  const n = Math.max(0, Math.min(SCATTER_PER_TILE, Math.round(expected)));
  const points: VisibleCopy[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = tiles.x0 + (tx + unit(seed, tx, ty, i, 1)) * tiles.tile;
    const y = tiles.y0 + (ty + unit(seed, tx, ty, i, 2)) * tiles.tile;
    if (!centerInRegion(tiles.region, x, y)) continue;
    points.push({ index: (ty * tiles.tilesX + tx) * SCATTER_PER_TILE + i, x, y });
  }
  return points;
}

function scatterIndexAt(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  halfW: number,
  halfH: number,
  localX: number,
  localY: number,
): number | null {
  void originX;
  void originY;
  const view = { left: localX, right: localX, top: localY, bottom: localY };
  const tiles = scatterWindow(repeat, view, halfW, halfH);
  if (!tiles) return null;
  const pattern = repeat.pattern;
  if (pattern.kind !== 'scatter') return null;
  let found: number | null = null;
  for (let ty = tiles.ty0; ty <= tiles.ty1; ty += 1) {
    for (let tx = tiles.tx0; tx <= tiles.tx1; tx += 1) {
      for (const copy of tilePoints(pattern.seed, pattern.density, tiles, tx, ty)) {
        if (inside(localX, localY, copy.x, copy.y, halfW, halfH)) found = copy.index;
      }
    }
  }
  return found;
}

function scatterNearest(repeat: NodeRepeat, originX: number, originY: number, localX: number, localY: number): number | null {
  void originX;
  void originY;
  const pattern = repeat.pattern;
  if (pattern.kind !== 'scatter' || !repeat.region) return null;
  const tile = Math.sqrt(SCATTER_PER_TILE / pattern.density);
  if (!(tile > 0)) return null;
  const view = { left: localX - tile, right: localX + tile, top: localY - tile, bottom: localY + tile };
  const tiles = scatterWindow(repeat, view, 0, 0);
  if (!tiles) return null;
  let best: { index: number; distance: number } | null = null;
  for (let ty = tiles.ty0; ty <= tiles.ty1; ty += 1) {
    for (let tx = tiles.tx0; tx <= tiles.tx1; tx += 1) {
      for (const copy of tilePoints(pattern.seed, pattern.density, tiles, tx, ty)) {
        const distance = (copy.x - localX) ** 2 + (copy.y - localY) ** 2;
        if (!best || distance < best.distance) best = { index: copy.index, distance };
      }
    }
  }
  return best?.index ?? null;
}

function scatterAt(repeat: NodeRepeat, originX: number, originY: number, index: number): VisibleCopy | null {
  void originX;
  void originY;
  const pattern = repeat.pattern;
  const region = repeat.region;
  if (pattern.kind !== 'scatter' || !region) return null;
  const tile = Math.sqrt(SCATTER_PER_TILE / pattern.density);
  if (!(tile > 0)) return null;
  const tilesX = Math.max(1, Math.ceil(region.width / tile - 1e-9));
  const tileIndex = Math.floor(index / SCATTER_PER_TILE);
  const tx = tileIndex % tilesX;
  const ty = Math.floor(tileIndex / tilesX);
  const window: ScatterWindow = {
    tile,
    tilesX,
    x0: region.x - region.width / 2,
    y0: region.y - region.height / 2,
    tx0: tx,
    tx1: tx,
    ty0: ty,
    ty1: ty,
    tileCount: 1,
    region,
  };
  return tilePoints(pattern.seed, pattern.density, window, tx, ty).find((copy) => copy.index === index) ?? null;
}

function unit(seed: number, tx: number, ty: number, i: number, salt: number): number {
  const h = mix(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tx + 1, 0x85ebca6b) ^ Math.imul(ty + 1, 0xc2b2ae35) ^ Math.imul(i + 1, 0x27d4eb2f) ^ salt);
  return h / 4294967296;
}

function mix(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function occupancyOf(repeat: NodeRepeat): number {
  const value = repeat.occupancy;
  if (value === undefined || !Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function seedOf(repeat: NodeRepeat): number {
  const seed = repeat.seed;
  if (seed === undefined || !Number.isFinite(seed)) return 1;
  return seed | 0;
}

/** Copy `index` is drawn. Occupancy 1 (the default) keeps every copy. */
function isCopyOccupied(repeat: NodeRepeat, index: number): boolean {
  const occupancy = occupancyOf(repeat);
  if (!(occupancy < 1)) return true;
  if (!(occupancy > 0)) return false;
  if (!Number.isInteger(index) || index < 0) return false;
  return hashUnit(seedOf(repeat), index) < occupancy;
}

function hashUnit(seed: number, index: number): number {
  const hi = Math.floor(index / 4294967296);
  const h = mix(Math.imul(seed, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b) ^ Math.imul(hi | 0, 0xc2b2ae35));
  return h / 4294967296;
}

function overCap(candidates: number, occupancy: number): boolean {
  if (!(candidates > MAX_REPEAT_COPIES)) return false;
  if (!(occupancy < 1)) return true;
  if (candidates > OCCUPANCY_SCAN) return true;
  return candidates * occupancy > MAX_REPEAT_COPIES;
}

function applyOccupancy(repeat: NodeRepeat, raw: VisibleCopies): VisibleCopies {
  const occupancy = occupancyOf(repeat);
  if (!(occupancy < 1)) return raw;
  if (!(occupancy > 0) || !(raw.count > 0)) return NONE;
  if (raw.capped) return { count: raw.count * occupancy, capped: true, forEach() {} };
  const kept: VisibleCopy[] = [];
  raw.forEach((copy) => {
    if (isCopyOccupied(repeat, copy.index)) kept.push(copy);
  });
  const capped = kept.length > MAX_REPEAT_COPIES;
  return {
    count: kept.length,
    capped,
    forEach(visit) {
      if (capped) return;
      for (const copy of kept) visit(copy);
    },
  };
}

function resolveOccupiedIndex(repeat: NodeRepeat, originX: number, originY: number, index: number): number {
  if (isCopyOccupied(repeat, index)) return index;
  const at = copyLocalPosition(repeat, originX, originY, index);
  if (!at) return nearestCopyIndex(repeat, originX, originY, originX, originY);
  return nearestCopyIndex(repeat, originX, originY, at.x, at.y);
}

function nearestOccupied(
  repeat: NodeRepeat,
  guess: number,
  position: (index: number) => { x: number; y: number } | null,
  ring: (radius: number, visit: (index: number) => void) => void,
): number {
  if (isCopyOccupied(repeat, guess)) return guess;
  const origin = position(guess);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 1; radius <= OCCUPANCY_SEARCH; radius += 1) {
    ring(radius, (index) => {
      if (!isCopyOccupied(repeat, index)) return;
      const at = position(index);
      if (!at || !origin) return;
      const distance = (at.x - origin.x) ** 2 + (at.y - origin.y) ** 2;
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex >= 0) return bestIndex;
  }
  return guess;
}

type LatticeGeom = {
  a1: { x: number; y: number };
  a2: { x: number; y: number };
  sites: { x: number; y: number }[];
};

function latticeGeometry(lattice: LatticeKind, a: number): LatticeGeom | null {
  if (!(a > 0) || !Number.isFinite(a)) return null;
  const sqrt3 = Math.sqrt(3);
  if (lattice === 'square') {
    return { a1: { x: a, y: 0 }, a2: { x: 0, y: a }, sites: [{ x: 0, y: 0 }] };
  }
  if (lattice === 'hex') {
    return {
      a1: { x: a, y: 0 },
      a2: { x: a / 2, y: (a * sqrt3) / 2 },
      sites: [{ x: 0, y: 0 }],
    };
  }
  if (lattice === 'honeycomb') {
    const bond = a / sqrt3;
    return {
      a1: { x: (3 * bond) / 2, y: (bond * sqrt3) / 2 },
      a2: { x: (3 * bond) / 2, y: -(bond * sqrt3) / 2 },
      sites: [
        { x: 0, y: 0 },
        { x: bond, y: 0 },
      ],
    };
  }
  const column = a / (2 * Math.SQRT2);
  return {
    a1: { x: a / Math.SQRT2, y: 0 },
    a2: { x: 0, y: a },
    sites: [
      { x: 0, y: 0 },
      { x: 0, y: a / 4 },
      { x: column, y: a / 2 },
      { x: column, y: (3 * a) / 4 },
    ],
  };
}

function latticeGeom(pattern: Extract<RepeatPattern, { kind: 'lattice' }>): LatticeGeom | null {
  const geom = latticeGeometry(pattern.lattice, pattern.a);
  if (!geom) return null;
  const declared = pattern.basis;
  if (declared === undefined || declared === geom.sites.length) return geom;
  if (Number.isInteger(declared) && declared >= 1 && declared < geom.sites.length) {
    return { ...geom, sites: geom.sites.slice(0, declared) };
  }
  return geom;
}

function latticeAt(
  pattern: Extract<RepeatPattern, { kind: 'lattice' }>,
  originX: number,
  originY: number,
  index: number,
): { x: number; y: number } | null {
  const geom = latticeGeom(pattern);
  if (!geom) return null;
  const { cols, rows } = pattern;
  if (!(cols >= 1) || !(rows >= 1)) return null;
  const basis = geom.sites.length;
  if (index >= cols * rows * basis) return null;
  const cell = Math.floor(index / basis);
  const site = geom.sites[index % basis];
  if (!site) return null;
  const col = cell % cols;
  const row = Math.floor(cell / cols);
  return {
    x: originX + col * geom.a1.x + row * geom.a2.x + site.x,
    y: originY + col * geom.a1.y + row * geom.a2.y + site.y,
  };
}

function latticeCell(geom: LatticeGeom, x: number, y: number): { col: number; row: number } {
  const det = geom.a1.x * geom.a2.y - geom.a2.x * geom.a1.y;
  if (!(Math.abs(det) > 1e-18)) return { col: 0, row: 0 };
  return {
    col: (x * geom.a2.y - y * geom.a2.x) / det,
    row: (geom.a1.x * y - geom.a1.y * x) / det,
  };
}

function latticeIndexAt(
  pattern: Extract<RepeatPattern, { kind: 'lattice' }>,
  region: RepeatRegion | undefined,
  originX: number,
  originY: number,
  halfW: number,
  halfH: number,
  localX: number,
  localY: number,
): number | null {
  const geom = latticeGeom(pattern);
  if (!geom) return null;
  const { cols, rows } = pattern;
  if (!(cols >= 1) || !(rows >= 1)) return null;
  const here = latticeCell(geom, localX - originX, localY - originY);
  const pitch = latticePitch(geom);
  const reach = Math.max(1, Math.ceil(Math.max(halfW, halfH) / pitch) + 1);
  const col0 = clamp(Math.floor(here.col) - reach, 0, cols - 1);
  const col1 = clamp(Math.ceil(here.col) + reach, 0, cols - 1);
  const row0 = clamp(Math.floor(here.row) - reach, 0, rows - 1);
  const row1 = clamp(Math.ceil(here.row) + reach, 0, rows - 1);
  const basis = geom.sites.length;
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      for (let site = 0; site < basis; site += 1) {
        const point = geom.sites[site];
        if (!point) continue;
        const x = originX + col * geom.a1.x + row * geom.a2.x + point.x;
        const y = originY + col * geom.a1.y + row * geom.a2.y + point.y;
        if (!inside(localX, localY, x, y, halfW, halfH)) continue;
        if (!centerInRegion(region, x, y)) continue;
        return (row * cols + col) * basis + site;
      }
    }
  }
  return null;
}

function nearestLattice(
  repeat: NodeRepeat,
  pattern: Extract<RepeatPattern, { kind: 'lattice' }>,
  originX: number,
  originY: number,
  localX: number,
  localY: number,
): number {
  const geom = latticeGeom(pattern);
  if (!geom) return 0;
  const { cols, rows } = pattern;
  if (!(cols >= 1) || !(rows >= 1)) return 0;
  const here = latticeCell(geom, localX - originX, localY - originY);
  const col0 = clamp(Math.round(here.col), 0, cols - 1);
  const row0 = clamp(Math.round(here.row), 0, rows - 1);
  const basis = geom.sites.length;
  const pitch = latticePitch(geom);
  const sparse = occupancyOf(repeat) < 1;
  const limit = sparse ? OCCUPANCY_SEARCH : 1;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius <= limit; radius += 1) {
    for (let row = Math.max(0, row0 - radius); row <= Math.min(rows - 1, row0 + radius); row += 1) {
      for (let col = Math.max(0, col0 - radius); col <= Math.min(cols - 1, col0 + radius); col += 1) {
        if (Math.max(Math.abs(col - col0), Math.abs(row - row0)) !== radius) continue;
        for (let site = 0; site < basis; site += 1) {
          const index = (row * cols + col) * basis + site;
          if (!isCopyOccupied(repeat, index)) continue;
          const point = geom.sites[site];
          if (!point) continue;
          const x = originX + col * geom.a1.x + row * geom.a2.x + point.x;
          const y = originY + col * geom.a1.y + row * geom.a2.y + point.y;
          const distance = (x - localX) ** 2 + (y - localY) ** 2;
          if (distance < bestDistance) {
            bestIndex = index;
            bestDistance = distance;
          }
        }
      }
    }
    if (bestIndex >= 0 && (!sparse || radius * pitch > Math.sqrt(bestDistance))) return bestIndex;
  }
  return bestIndex >= 0 ? bestIndex : row0 * cols * basis;
}

function visibleLattice(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
  view: LocalRect,
): VisibleCopies {
  const pattern = repeat.pattern;
  if (pattern.kind !== 'lattice') return NONE;
  const geom = latticeGeom(pattern);
  if (!geom) return NONE;
  const { cols, rows } = pattern;
  if (!(cols >= 1) || !(rows >= 1)) return NONE;
  const halfW = footprintW / 2;
  const halfH = footprintH / 2;
  const pad = Math.max(halfW, halfH, ...geom.sites.map((site) => Math.hypot(site.x, site.y)));
  const corners = [
    latticeCell(geom, view.left - pad - originX, view.top - pad - originY),
    latticeCell(geom, view.right + pad - originX, view.top - pad - originY),
    latticeCell(geom, view.left - pad - originX, view.bottom + pad - originY),
    latticeCell(geom, view.right + pad - originX, view.bottom + pad - originY),
  ];
  let col0 = cols;
  let col1 = -1;
  let row0 = rows;
  let row1 = -1;
  for (const corner of corners) {
    col0 = Math.min(col0, Math.floor(corner.col) - 1);
    col1 = Math.max(col1, Math.ceil(corner.col) + 1);
    row0 = Math.min(row0, Math.floor(corner.row) - 1);
    row1 = Math.max(row1, Math.ceil(corner.row) + 1);
  }
  col0 = clamp(col0, 0, cols - 1);
  col1 = clamp(col1, 0, cols - 1);
  row0 = clamp(row0, 0, rows - 1);
  row1 = clamp(row1, 0, rows - 1);
  if (col1 < col0 || row1 < row0) return NONE;
  const basis = geom.sites.length;
  const windowCount = (col1 - col0 + 1) * (row1 - row0 + 1) * basis;
  if (overCap(windowCount, occupancyOf(repeat))) {
    return { count: windowCount, capped: true, forEach() {} };
  }
  const copies: VisibleCopy[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      for (let site = 0; site < basis; site += 1) {
        const point = geom.sites[site];
        if (!point) continue;
        const x = originX + col * geom.a1.x + row * geom.a2.x + point.x;
        const y = originY + col * geom.a1.y + row * geom.a2.y + point.y;
        if (!centerInRegion(repeat.region, x, y)) continue;
        if (!footprintHits(x, y, footprintW, footprintH, view)) continue;
        copies.push({ index: (row * cols + col) * basis + site, x, y });
      }
    }
  }
  const capped = copies.length > MAX_REPEAT_COPIES;
  return {
    count: copies.length,
    capped,
    forEach(visit) {
      if (capped) return;
      for (const copy of copies) visit(copy);
    },
  };
}

function latticeBounds(pattern: Extract<RepeatPattern, { kind: 'lattice' }>): LocalRect | null {
  const geom = latticeGeom(pattern);
  if (!geom) return null;
  const { cols, rows } = pattern;
  if (!(cols >= 1) || !(rows >= 1)) return null;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const columns = [0, Math.max(0, cols - 1)];
  const rowEnds = [0, Math.max(0, rows - 1)];
  for (const row of rowEnds) {
    for (const col of columns) {
      for (const site of geom.sites) {
        const x = col * geom.a1.x + row * geom.a2.x + site.x;
        const y = col * geom.a1.y + row * geom.a2.y + site.y;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (!Number.isFinite(left)) return null;
  return { left, right, top, bottom };
}

function latticePitch(geom: LatticeGeom): number {
  const first = Math.hypot(geom.a1.x, geom.a1.y);
  const second = Math.hypot(geom.a2.x, geom.a2.y);
  const pitch = Math.min(first, second);
  return pitch > 0 ? pitch : 1;
}

function trimMagnitude(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type RepeatResolver = {
  /** World centre. `copy0` keeps this node's authored copy; ancestors still follow the focus. */
  center(id: string, mode: 'copy0' | 'focused'): { x: number; y: number } | null;
  /** Focused parent-local position of a repeated node, for the pixel walk. */
  localOverride(id: string): { x: number; y: number } | undefined;
  /** Copy index at a world point, or null when the point misses the footprint. */
  indexAt(id: string, worldX: number, worldY: number): number | null;
  /** World bounds of every copy, for culling. Null when the node is not repeated. */
  worldBounds(id: string): ViewBounds | null;
};

/**
 * Placement of repeated nodes for one camera focus.
 * The unfocused centre is `createPlacement`, so a focus on copy 0 does not move anything.
 */
export function createRepeatResolver(
  objects: readonly CanvasObject[],
  focus: RepeatFocus | undefined,
): RepeatResolver {
  const byId = indexById(objects);
  const place = createPlacement(objects);
  const shiftMemo = new Map<string, { x: number; y: number }>();
  const localMemo = new Map<string, { x: number; y: number }>();

  function parentScale(node: CanvasObject): number {
    if (!node.parentId) return 1;
    const parent = byId.get(node.parentId);
    const placed = parent ? place(parent) : null;
    return placed ? placed.scale : 1;
  }

  function parentWorld(node: CanvasObject): { x: number; y: number; scale: number } | null {
    if (!node.parentId) return { x: 0, y: 0, scale: 1 };
    const parent = byId.get(node.parentId);
    if (!parent) return null;
    const placed = place(parent);
    if (!placed) return null;
    const shift = worldShift(parent, 'focused');
    return { x: placed.x + shift.x, y: placed.y + shift.y, scale: placed.scale };
  }

  function copyUnderFocus(node: CanvasObject, point: RepeatFocus): number | null {
    if (!node.repeat) return null;
    if (point.lock?.id === node.id) return point.lock.index;
    const parent = parentWorld(node);
    if (!parent || !(parent.scale > 0)) return null;
    const lx = (point.x - parent.x) / parent.scale;
    const ly = (point.y - parent.y) / parent.scale;
    return nearestCopyIndex(node.repeat, node.x, node.y, lx, ly);
  }

  function focusedLocal(node: CanvasObject): { x: number; y: number } {
    const known = localMemo.get(node.id);
    if (known) return known;
    const authored = { x: node.x, y: node.y };
    if (!node.repeat || !focus) {
      localMemo.set(node.id, authored);
      return authored;
    }
    const index = copyUnderFocus(node, focus);
    if (index === null) {
      localMemo.set(node.id, authored);
      return authored;
    }
    const resolved = resolveOccupiedIndex(node.repeat, node.x, node.y, index);
    const local = copyLocalPosition(node.repeat, node.x, node.y, resolved) ?? authored;
    localMemo.set(node.id, local);
    return local;
  }

  function worldShift(node: CanvasObject, mode: 'copy0' | 'focused'): { x: number; y: number } {
    const key = `${mode}:${node.id}`;
    const known = shiftMemo.get(key);
    if (known) return known;
    shiftMemo.set(key, { x: 0, y: 0 });
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const parentShift = parent ? worldShift(parent, 'focused') : { x: 0, y: 0 };
    const local = mode === 'focused' ? focusedLocal(node) : { x: node.x, y: node.y };
    const scale = parentScale(node);
    const shift = {
      x: parentShift.x + (local.x - node.x) * scale,
      y: parentShift.y + (local.y - node.y) * scale,
    };
    shiftMemo.set(key, shift);
    return shift;
  }

  function centerOf(id: string, mode: 'copy0' | 'focused'): { x: number; y: number } | null {
    const node = byId.get(id);
    if (!node) return null;
    const placed: WorldPlacement | null = place(node);
    if (!placed) return null;
    const shift = worldShift(node, mode);
    return { x: placed.x + shift.x, y: placed.y + shift.y };
  }

  return {
    center: centerOf,
    localOverride(id) {
      const node = byId.get(id);
      if (!node?.repeat || !focus) return undefined;
      const local = focusedLocal(node);
      if (local.x === node.x && local.y === node.y) return undefined;
      return local;
    },
    indexAt(id, worldX, worldY) {
      const node = byId.get(id);
      if (!node?.repeat) return null;
      const foot = footprint(node);
      if (!foot) return null;
      const parent = parentWorld(node);
      if (!parent || !(parent.scale > 0)) return null;
      const lx = (worldX - parent.x) / parent.scale;
      const ly = (worldY - parent.y) / parent.scale;
      return copyIndexAt(node.repeat, node.x, node.y, foot.w, foot.h, lx, ly);
    },
    worldBounds(id) {
      const node = byId.get(id);
      if (!node?.repeat) return null;
      const foot = footprint(node);
      if (!foot) return null;
      const local = patternBounds(node.repeat, node.x, node.y, foot.w, foot.h);
      const parent = parentWorld(node);
      if (!parent) return null;
      return {
        left: parent.x + local.left * parent.scale,
        right: parent.x + local.right * parent.scale,
        top: parent.y + local.top * parent.scale,
        bottom: parent.y + local.bottom * parent.scale,
      };
    },
  };
}

/** World offset of copy `index` from copy 0. Copy 0 is zero. */
export function copyWorldDelta(
  objects: readonly CanvasObject[],
  id: string,
  index: number,
): { x: number; y: number } {
  if (!(index > 0)) return { x: 0, y: 0 };
  const byId = indexById(objects);
  const node = byId.get(id);
  if (!node?.repeat) return { x: 0, y: 0 };
  const resolved = resolveOccupiedIndex(node.repeat, node.x, node.y, index);
  const local = copyLocalPosition(node.repeat, node.x, node.y, resolved);
  if (!local) return { x: 0, y: 0 };
  const placed = createPlacement(objects)(node);
  if (!placed) return { x: 0, y: 0 };
  const scale = node.parentId ? parentPlacementScale(objects, node) : 1;
  return { x: (local.x - node.x) * scale, y: (local.y - node.y) * scale };
}

function parentPlacementScale(objects: readonly CanvasObject[], node: CanvasObject): number {
  if (!node.parentId) return 1;
  const parent = objects.find((object) => object.id === node.parentId);
  const placed = parent ? createPlacement(objects)(parent) : null;
  return placed ? placed.scale : 1;
}

export function patternBounds(
  repeat: NodeRepeat,
  originX: number,
  originY: number,
  footprintW: number,
  footprintH: number,
): LocalRect {
  const halfW = footprintW / 2;
  const halfH = footprintH / 2;
  if (repeat.region && repeat.pattern.kind === 'scatter') {
    return {
      left: repeat.region.x - repeat.region.width / 2 - halfW,
      right: repeat.region.x + repeat.region.width / 2 + halfW,
      top: repeat.region.y - repeat.region.height / 2 - halfH,
      bottom: repeat.region.y + repeat.region.height / 2 + halfH,
    };
  }
  if (repeat.pattern.kind === 'grid') {
    const { cols, rows, pitchX, pitchY } = repeat.pattern;
    const x1 = originX + Math.max(0, cols - 1) * pitchX;
    const y1 = originY + Math.max(0, rows - 1) * pitchY;
    return {
      left: Math.min(originX, x1) - halfW,
      right: Math.max(originX, x1) + halfW,
      top: Math.min(originY, y1) - halfH,
      bottom: Math.max(originY, y1) + halfH,
    };
  }
  if (repeat.pattern.kind === 'rows') {
    const stagger = Math.abs(repeat.pattern.stagger ?? 0);
    const last = Math.max(0, repeat.count - 1) * repeat.pattern.pitch;
    return {
      left: originX - stagger - halfW,
      right: originX + stagger + halfW,
      top: Math.min(originY, originY + last) - halfH,
      bottom: Math.max(originY, originY + last) + halfH,
    };
  }
  if (repeat.pattern.kind === 'lattice') {
    const bounds = latticeBounds(repeat.pattern);
    if (bounds) {
      return {
        left: originX + bounds.left - halfW,
        right: originX + bounds.right + halfW,
        top: originY + bounds.top - halfH,
        bottom: originY + bounds.bottom + halfH,
      };
    }
  }
  return {
    left: originX - halfW,
    right: originX + halfW,
    top: originY - halfH,
    bottom: originY + halfH,
  };
}

export function footprint(object: CanvasObject): { w: number; h: number } | null {
  const payload = object.payload;
  if (payload.type === 'group' || payload.type === 'link') return null;
  const scale = positiveScale(object.scale);
  if (!(payload.width > 0) || !(payload.height > 0)) return null;
  return { w: payload.width * scale, h: payload.height * scale };
}

function indexById(objects: readonly CanvasObject[]): Map<string, CanvasObject> {
  const byId = new Map<string, CanvasObject>();
  for (const object of objects) {
    if (!byId.has(object.id)) byId.set(object.id, object);
  }
  return byId;
}

function positiveScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || !(scale > 0)) return 1;
  return scale;
}
