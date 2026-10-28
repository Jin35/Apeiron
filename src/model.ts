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
  /** Size in world units. On screen it is `fontSize * camera.scale` pixels. */
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
};

export type ImagePayload = {
  type: 'image';
  /** Path under the site root, e.g. `images/phone.svg`. */
  src: string;
  width: number;
  height: number;
};

export type CanvasObject = {
  id: string;
  x: number;
  y: number;
  visibility: VisibilityRange;
  payload: TextPayload | ImagePayload;
};
