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
   * Set when the node's count is a magnitude above one.
   * Already includes the times sign, e.g. `×~15 billion`.
   */
  countMark: string | null;
};
