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
  color: string;
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
  visibility: VisibilityRange;
  payload: TextPayload | ImagePayload;
};
