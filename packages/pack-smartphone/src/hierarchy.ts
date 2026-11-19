export type HierarchyKind = 'part' | 'view' | 'process';

export type HierarchyStatus = 'built' | 'planned';

export type HierarchyNode = {
  id: string;
  /** Heading name, without a trailing "(view)" or "(process)". */
  name: string;
  parentId: string | null;
  kind: HierarchyKind;
  status: HierarchyStatus;
  /** Characteristic size in millimetres. */
  sizeMm: number;
  /**
   * Label suffix when the count is above one.
   * Already includes the times sign, e.g. `×4` or `×~15 billion`.
   * For a repeated node this is the chain total when that total differs
   * from the per-parent count, and the per-parent count otherwise.
   */
  countMark: string | null;
  /**
   * Copies of this node inside one copy of its parent.
   * Null when the Count line is not a number. This is not a device total.
   */
  perParentCount: number | null;
  /**
   * Parsed `Repeat:` line. Pitches are millimetres.
   * Null when the hierarchy does not repeat the node.
   */
  repeat: HierarchyRepeat | null;
};

/**
 * Arrangement from a `Repeat:` line, before it is scaled into parent-local units.
 * `count` is per parent copy. A grid's `cols * rows` equals that count.
 * A lattice's count is unit cells times its basis.
 * `occupancy` keeps a deterministic subset of those copies.
 */
export type HierarchyRepeat = {
  count: number;
  pattern: HierarchyPattern;
  /** 0..1. Omit and a repeated view is stamped at 0.25. */
  opacity?: number;
  /** 0..1. Copy i is kept when hash(seed, i) is below this. */
  occupancy?: number;
  /** Seed for occupancy. Omit for the core default. */
  seed?: number;
};

export type HierarchyLattice = 'hex' | 'honeycomb' | 'diamond' | 'square';

export type HierarchyPattern =
  | { kind: 'grid'; cols: number; rows: number; pitchXMm: number; pitchYMm: number }
  | { kind: 'rows'; pitchMm: number; staggerMm?: number }
  | { kind: 'scatter'; seed: number; densityPerMm2: number }
  | {
      kind: 'lattice';
      lattice: HierarchyLattice;
      /** Crystallographic lattice constant, millimetres. */
      aMm: number;
      cols: number;
      rows: number;
      basis?: number;
    };
