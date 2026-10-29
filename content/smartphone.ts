import type { CanvasObject } from '../src/model';
import { paperTheme, type ContentPack } from '../src/theme';

/**
 * Pixel size of `images/smartphone.webp`, and of the opaque phone inside
 * its transparent margin. World size maps the opaque phone to 71.5 mm wide.
 * Height follows the photo so the picture is not stretched (about 145 mm).
 */
export const smartphoneSprite = {
  width: 331,
  height: 649,
  opaqueWidth: 309,
  opaqueHeight: 627,
} as const;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = 71.5;

const pxToMm = PHONE_WIDTH_MM / smartphoneSprite.opaqueWidth;

/**
 * Opening level only: one front view, centered, no title and no labels.
 * The plate stays fully in band from below the fit through a deep look
 * at the photograph. Inner parts are not in this pack.
 */
export const smartphoneObjects: readonly CanvasObject[] = [
  {
    id: 'smartphone',
    x: 0,
    y: 0,
    visibility: { minScale: 0.02, maxScale: 10000 },
    payload: {
      type: 'image',
      src: 'images/smartphone.webp',
      width: smartphoneSprite.width * pxToMm,
      height: smartphoneSprite.height * pxToMm,
      frame: false,
    },
  },
];

/** Aged paper, one phone. Camera limits are derived from this object. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
};
