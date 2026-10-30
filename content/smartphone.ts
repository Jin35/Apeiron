import type { CanvasObject, ZoomFade } from '../src/model';
import { paperTheme, type ContentPack } from '../src/theme';

/**
 * Pixel size of a trimmed cut-out, and of the pixels that are actually opaque.
 * World size maps an opaque width in millimetres onto that box and keeps the
 * file's own aspect. These cuts have no soft shadow fringe.
 */
type Sprite = {
  width: number;
  height: number;
  opaqueWidth: number;
  opaqueHeight: number;
};

/** `images/smartphone.webp`. The opaque phone is 71.5 mm wide. */
export const smartphoneSprite = {
  width: 465,
  height: 951,
  opaqueWidth: 461,
  opaqueHeight: 947,
} as const satisfies Sprite;

export const partSprites = {
  midframe: { width: 450, height: 943, opaqueWidth: 446, opaqueHeight: 939 },
  battery: { width: 487, height: 899, opaqueWidth: 483, opaqueHeight: 895 },
  logicBoard: { width: 414, height: 863, opaqueWidth: 410, opaqueHeight: 859 },
  cameraModule: { width: 537, height: 500, opaqueWidth: 533, opaqueHeight: 496 },
  loudspeaker: { width: 383, height: 227, opaqueWidth: 379, opaqueHeight: 223 },
  hapticMotor: { width: 418, height: 153, opaqueWidth: 418, opaqueHeight: 153 },
} as const satisfies Record<string, Sprite>;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = 71.5;

/**
 * The internals assembly is this fraction of the phone, about the phone centre.
 * The front finishes fading at `r = 1 / INTERNALS_SCALE`, which is when the
 * shrunk midframe is back to the screen size the front had at the opening.
 */
export const INTERNALS_SCALE = 0.625;

/** `[start, end]` in relative zoom. The end is `1 / INTERNALS_SCALE`. */
const REVEAL = [1, 1 / INTERNALS_SCALE] as const;

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
 * Front view plus the parts under it. `internals` is a group on `phone`:
 * one scale about the phone centre, no pixels of its own. The parts are
 * parent-local millimetres on that group, listed back to front, then the
 * front image. Edit a part's `x`, `y`, and opaque width to rearrange it.
 * The fade is zoom-driven, not animated.
 */
export const smartphoneObjects: readonly CanvasObject[] = [
  {
    id: 'internals',
    parentId: 'phone',
    x: 0,
    y: 0,
    scale: INTERNALS_SCALE,
    visibility: band,
    payload: { type: 'group' },
  },
  cutout('midframe', 'images/smartphone/midframe.webp', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, fadeIn, 'internals'),
  cutout('battery', 'images/smartphone/battery.webp', partSprites.battery, 40, -12.6, 10.2, fadeIn, 'internals'),
  cutout(
    'logic-board',
    'images/smartphone/logic-board.webp',
    partSprites.logicBoard,
    21,
    19.8,
    -44,
    fadeIn,
    'internals',
  ),
  cutout(
    'camera-module',
    'images/smartphone/camera-module.webp',
    partSprites.cameraModule,
    21,
    -22,
    -62.5,
    fadeIn,
    'internals',
  ),
  cutout(
    'loudspeaker',
    'images/smartphone/loudspeaker.webp',
    partSprites.loudspeaker,
    18,
    -11,
    66,
    fadeIn,
    'internals',
  ),
  cutout(
    'haptic-motor',
    'images/smartphone/haptic-motor.webp',
    partSprites.hapticMotor,
    22,
    13,
    66.5,
    fadeIn,
    'internals',
  ),
  cutout('phone', 'images/smartphone.webp', smartphoneSprite, PHONE_WIDTH_MM, 0, 0, fadeOut),
];

/** Aged paper and the phone. Camera limits are derived; the fit is the opening scale. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
};
