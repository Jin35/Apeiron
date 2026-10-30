/**
 * Camera scale is CSS pixels per world unit. World y grows downward.
 * An object's visibility range is its depth: low scales are far overview,
 * high scales are near detail. The object is drawn only while
 * `minScale <= camera.scale <= maxScale`.
 */
export type VisibilityRange = {
  minScale: number;
  maxScale: number;
};

export type TextStyle = {
  /**
   * Preferred size in world units. On screen it starts at `fontSize * camera.scale`
   * pixels, and the renderer scales it down when the ink would exceed the payload box.
   */
  fontSize: number;
  /** Fill. When omitted, the renderer uses the pack theme's ink. */
  color?: string;
  fontFamily?: string;
  fontWeight?: string;
  letterSpacing?: string;
};

export type TextPayload = {
  type: 'text';
  text: string;
  style: TextStyle;
  /** World-space bounds, centered on the object's `(x, y)`, same as an image. */
  width: number;
  height: number;
};

export type ImagePayload = {
  type: 'image';
  /** Site path such as `images/phone.svg`, or an absolute `http:` / `https:` URL. */
  src: string;
  width: number;
  height: number;
  /**
   * Dark plate and hairline frame. Omit for an atlas plate.
   * A cut-out photograph sets this false so the page shows through.
   */
  frame?: boolean;
};

/** A transform only. Not drawn, not hit, and not counted. */
export type GroupPayload = {
  type: 'group';
};

/**
 * A leader line between two objects. The payload stores ids and an optional
 * stroke. Endpoint positions are not stored: the renderer resolves them from
 * the live parent chain each frame, so pan and zoom cannot leave the line behind.
 */
export type LinkPayload = {
  type: 'link';
  from: string;
  to: string;
  style?: LinkStyle;
};

export type LinkStyle = {
  /** Stroke color. Omit to use the pack theme's ink. */
  color?: string;
  /** Stroke width in CSS pixels. Omit for a 1.25px hairline. */
  width?: number;
  /** Gap in CSS pixels between the stroke and each endpoint's bounds. Omit for 4. */
  gap?: number;
};

/**
 * Opacity from zoom relative to the opening fit scale.
 * `r = camera.scale / fitScale`. Each pair is `[start, end]` in that ratio.
 * Between the ends the blend is linear in `r`. At and below `start`, `fadeOut`
 * is opaque and `fadeIn` is transparent. At and above `end`, they swap.
 * This is not a time animation, so a reduced-motion setting does not change it.
 */
export type ZoomFade = {
  fadeOut?: readonly [number, number];
  fadeIn?: readonly [number, number];
};

export type CanvasObject = {
  id: string;
  /**
   * World position. When `parentId` is set, these are offsets in that
   * parent's space instead. The memory store adds the chain up to a world
   * position before `query` returns the object.
   */
  x: number;
  y: number;
  /** When set, `x` and `y` are parent-local. */
  parentId?: string;
  /**
   * Uniform scale of this object's local space. It multiplies the payload
   * size and every descendant's parent-local position and size. `x` and `y`
   * stay in the parent's space, so they are not multiplied by this scale.
   * Omit for 1. A non-positive value is ignored.
   */
  scale?: number;
  visibility: VisibilityRange;
  /**
   * Optional opacity from zoom relative to the opening fit scale.
   * The renderer evaluates it. The store uses the same curve so a fully
   * transparent object is not hit-tested and is left out of `query`.
   */
  fade?: ZoomFade;
  payload: TextPayload | ImagePayload | GroupPayload | LinkPayload;
};
