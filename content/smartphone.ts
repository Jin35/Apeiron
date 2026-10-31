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

/** Inside the battery. Same 2px clear margin as the phone parts. */
export const batterySprites = {
  cell: { width: 552, height: 890, opaqueWidth: 548, opaqueHeight: 886 },
  protectionBoard: { width: 948, height: 233, opaqueWidth: 944, opaqueHeight: 229 },
} as const satisfies Record<string, Sprite>;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = 71.5;

/**
 * The internals assembly is this fraction of the phone, about the phone centre.
 * The front finishes fading at `r = 1 / INTERNALS_SCALE`, which is when the
 * shrunk midframe is back to the screen size the front had at the opening.
 */
export const INTERNALS_SCALE = 0.625;

/**
 * `[start, end]` in relative zoom. The end is `1 / INTERNALS_SCALE`.
 * The phone uses the opening fit as `r = 1`. A nested level names the part
 * it belongs to (`fadeInOf`); that part's own opening fit is `r = 1`.
 * The platform fades the part's siblings out over the same range.
 */
const REVEAL = [1, 1 / INTERNALS_SCALE] as const;

/**
 * Pouch cell, 39 mm across the 40 mm pack. Its opaque bottom sits 1 mm above
 * the pack's opaque bottom.
 */
const CELL_WIDTH_MM = 39;
const CELL_Y_MM = 4.53;

/**
 * Protection board, 40 mm across the cell's top edge. The flex in the art
 * points up on the right, where the pack's connector is.
 */
const BOARD_WIDTH_MM = 40;
const BOARD_Y_MM = -29.72;

/**
 * Wide enough that the opening fit and the battery level sit in the flat
 * middle of the band. Zoom fade, not this range, is what changes opacity.
 * Every part shares the same maxScale so paint order follows this array:
 * the renderer sorts by maxScale and keeps ties in the order given.
 */
const band = { minScale: 0.02, maxScale: 10000 };

const fadeOut: ZoomFade = { fadeOut: REVEAL };
const fadeIn: ZoomFade = { fadeIn: REVEAL };
/** Cell, protection board, and their labels. `r = 1` is the battery's fit. */
const fadeInBattery: ZoomFade = { fadeIn: REVEAL, fadeInOf: 'battery' };

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
 * A callout in its parent's millimetres: the same face and size as the other
 * part labels. `x` and `y` are the label centre. The link stores ids only.
 * The label fades in with its part. When a next level opens, the platform
 * fades every sibling at this parent — parts, labels, and through them the
 * leaders — so this callout does not name the part being entered.
 */
function callout(
  partId: string,
  text: string,
  x: number,
  y: number,
  width: number,
  parentId = 'internals',
  fade: ZoomFade = fadeIn,
): readonly CanvasObject[] {
  return [
    {
      id: `${partId}-label`,
      parentId,
      x,
      y,
      visibility: band,
      fade,
      payload: {
        type: 'text',
        text,
        style: { fontSize: 4.2 },
        width,
        height: 4.2,
      },
    },
    {
      id: `${partId}-link`,
      x: 0,
      y: 0,
      visibility: band,
      payload: { type: 'link', from: `${partId}-label`, to: partId },
    },
  ];
}

/**
 * Front view plus the parts under it. `internals` is a group on `phone`:
 * one scale about the phone centre, no pixels of its own. The parts are
 * parent-local millimetres on that group, listed back to front, then the
 * front image. `battery-internals` is that same kind of group on `battery`.
 * Edit a part's `x`, `y`, and opaque width to rearrange it.
 * The fade is zoom-driven, not animated. Children of a part set `fadeInOf`
 * to that part. Entering it fades the whole sibling level, not only the part.
 *
 * Labels sit in two columns outside the phone, each offset from its part so
 * the centre-to-centre leader is at least 20° off horizontal and vertical.
 * The cell and protection board use the same callout, on their own group.
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
  {
    id: 'battery-internals',
    parentId: 'battery',
    x: 0,
    y: 0,
    scale: INTERNALS_SCALE,
    visibility: band,
    payload: { type: 'group' },
  },
  cutout('midframe', 'images/smartphone/midframe.webp', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, fadeIn, 'internals'),
  cutout(
    'cell',
    'images/smartphone/battery-cell.webp',
    batterySprites.cell,
    CELL_WIDTH_MM,
    0,
    CELL_Y_MM,
    fadeInBattery,
    'battery-internals',
  ),
  cutout(
    'protection-board',
    'images/smartphone/battery-controller.webp',
    batterySprites.protectionBoard,
    BOARD_WIDTH_MM,
    0,
    BOARD_Y_MM,
    fadeInBattery,
    'battery-internals',
  ),
  cutout(
    'battery',
    'images/smartphone/battery.webp',
    partSprites.battery,
    40,
    -12.6,
    10.2,
    fadeIn,
    'internals',
  ),
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
  ...callout('camera-module', 'Camera', -69, -40, 13),
  ...callout('battery', 'Battery', -70, -14, 15),
  ...callout('loudspeaker', 'Speaker', -70, 36, 15),
  ...callout('logic-board', 'Logic board', 74, -20, 23),
  ...callout('midframe', 'Midframe', 71, 26, 17),
  ...callout('haptic-motor', 'Haptic motor', 76, 42, 26),
  ...callout('cell', 'Cell', -42, 20, 12, 'battery-internals', fadeInBattery),
  ...callout('protection-board', 'Protection board', 41, -12, 16, 'battery-internals', fadeInBattery),
];

/** Aged paper and the phone. Camera limits are derived; the fit is the opening scale. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
};
