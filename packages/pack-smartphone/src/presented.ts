import type { HierarchyKind, HierarchyStatus } from './hierarchy';

/** Opacity ranges copied onto the node, its label, and its link. */
export type PresentedFade = {
  fadeOut?: readonly [number, number];
  fadeIn?: readonly [number, number];
  fadeOutOf?: string;
  fadeInOf?: string;
};

/** Label as placed. `parent` is the canvas parent. `x` and `y` are that parent's space. */
export type PresentedLabel = {
  id: string;
  text: string;
  parent: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  scale?: number;
};

export type PresentedLink = {
  id: string;
  from: string;
  to: string;
};

/**
 * One hierarchy node and the pixels that present it.
 * `parent` is the content parent. `place.parent` is the canvas parent:
 * a group, when the node's picture does not sit on the content parent.
 */
export type PresentedNode = {
  id: string;
  name: string;
  parent: string | null;
  kind: HierarchyKind;
  status: HierarchyStatus;
  /** Characteristic size in millimetres. */
  sizeMm: number;
  /** Magnitude above one, already including the times sign, or null. */
  count: string | null;
  /** Site path. Null draws a placeholder of `kind`. */
  image: string | null;
  place: {
    parent: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    z?: number;
    scale?: number;
  };
  visibility: { minScale: number; maxScale: number };
  fade: PresentedFade;
  label: PresentedLabel | null;
  link: PresentedLink | null;
};

/** A transform with no pixels. Children use `place.parent` to name it. */
export type PresentedGroup = {
  id: string;
  parent: string;
  x: number;
  y: number;
  scale: number;
  visibility: { minScale: number; maxScale: number };
};

export type PresentedFile = {
  groups: PresentedGroup[];
  nodes: PresentedNode[];
  /** Canvas object ids in paint order: groups, pictures, labels, links. */
  order: string[];
  report: {
    shrunk: { id: string; factor: number }[];
    unplaced: { id: string; reason: string }[];
  };
};
