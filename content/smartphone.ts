import type { CanvasObject, ZoomFade } from '../src/model';
import { paperTheme, type ContentPack } from '../src/theme';

/**
 * Pixel size of a trimmed cut-out, and of the pixels that are actually opaque.
 * A 4px soft margin sits on every side. World size maps the opaque width to
 * millimetres and keeps the file's own aspect.
 */
type Sprite = {
  width: number;
  height: number;
  opaqueWidth: number;
  opaqueHeight: number;
};

/** `images/smartphone.webp`. The opaque phone is 71.5 mm wide. */
export const smartphoneSprite = {
  width: 478,
  height: 977,
  opaqueWidth: 470,
  opaqueHeight: 969,
} as const satisfies Sprite;

export const partSprites = {
  midframe: { width: 488, height: 985, opaqueWidth: 480, opaqueHeight: 977 },
  battery: { width: 491, height: 879, opaqueWidth: 483, opaqueHeight: 871 },
  logicBoard: { width: 439, height: 887, opaqueWidth: 431, opaqueHeight: 878 },
  cameraModule: { width: 594, height: 521, opaqueWidth: 586, opaqueHeight: 513 },
  loudspeaker: { width: 439, height: 280, opaqueWidth: 431, opaqueHeight: 272 },
  hapticMotor: { width: 423, height: 200, opaqueWidth: 415, opaqueHeight: 192 },
} as const satisfies Record<string, Sprite>;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = 71.5;

/**
 * Relative zoom at which the front finishes fading and the parts finish
 * fading in. `r = camera.scale / fitScale`, and `r = 1` is the opening fit.
 */
const REVEAL: readonly [number, number] = [1, 2];

/**
 * Wide enough that the opening fit and a deep look (r well past 3) sit in
 * the flat middle of the band. Zoom fade, not this range, is what changes
 * opacity. Every part shares the same maxScale so paint order follows this
 * array: the renderer sorts by maxScale and keeps ties in the order given.
 */
const band = { minScale: 0.02, maxScale: 10000 };

const fadeOut: ZoomFade = { fadeOut: REVEAL };
const fadeIn: ZoomFade = { fadeIn: REVEAL };

function cutout(
  id: string,
  src: string,
  sprite: Sprite,
  opaqueWidthMm: number,
  x: number,
  y: number,
  fade: ZoomFade,
  parentId?: string,
): CanvasObject {
  const mmPerPx = opaqueWidthMm / sprite.opaqueWidth;
  return {
    id,
    x,
    y,
    ...(parentId ? { parentId } : {}),
    visibility: band,
    fade,
    payload: {
      type: 'image',
      src,
      width: sprite.width * mmPerPx,
      height: sprite.height * mmPerPx,
      frame: false,
    },
  };
}

/**
 * Front view plus the parts under it. Children are parent-local millimetres
 * on `phone`, listed back to front: chassis, battery, logic board, camera,
 * loudspeaker, haptic motor, then the front image. Edit `x`, `y`, and the
 * opaque width to rearrange them. The fade is zoom-driven, not animated.
 */
export const smartphoneObjects: readonly CanvasObject[] = [
  cutout('midframe', 'images/smartphone/midframe.webp', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, fadeIn, 'phone'),
  cutout('battery', 'images/smartphone/battery.webp', partSprites.battery, 50, -9.8, 16.6, fadeIn, 'phone'),
  cutout('logic-board', 'images/smartphone/logic-board.webp', partSprites.logicBoard, 26, 19.8, -45.2, fadeIn, 'phone'),
  cutout(
    'camera-module',
    'images/smartphone/camera-module.webp',
    partSprites.cameraModule,
    22,
    -21.5,
    -59.5,
    fadeIn,
    'phone',
  ),
  cutout('loudspeaker', 'images/smartphone/loudspeaker.webp', partSprites.loudspeaker, 14, -12, 65.8, fadeIn, 'phone'),
  cutout('haptic-motor', 'images/smartphone/haptic-motor.webp', partSprites.hapticMotor, 15, 12, 65.8, fadeIn, 'phone'),
  cutout('phone', 'images/smartphone.webp', smartphoneSprite, PHONE_WIDTH_MM, 0, 0, fadeOut),
];

/** Aged paper and the phone. Camera limits are derived; the fit is the opening scale. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
};
