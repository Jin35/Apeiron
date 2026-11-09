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

/**
 * Level-1 cutouts, in pixels. World size maps the part's `width_mm` onto the
 * opaque width and keeps this file's aspect. The image has no placement of
 * its own; millimetres and `z` live on the object.
 */
export const partSprites = {
  backGlass: { width: 464, height: 950, opaqueWidth: 460, opaqueHeight: 946 },
  midframe: { width: 450, height: 943, opaqueWidth: 446, opaqueHeight: 939 },
  battery: { width: 487, height: 899, opaqueWidth: 483, opaqueHeight: 895 },
  logicBoard: { width: 414, height: 863, opaqueWidth: 410, opaqueHeight: 859 },
  cameraModule: { width: 161, height: 230, opaqueWidth: 155, opaqueHeight: 224 },
  loudspeaker: { width: 383, height: 227, opaqueWidth: 379, opaqueHeight: 223 },
  hapticMotor: { width: 426, height: 161, opaqueWidth: 418, opaqueHeight: 153 },
  display: { width: 464, height: 950, opaqueWidth: 460, opaqueHeight: 946 },
} as const satisfies Record<string, Sprite>;

/** Inside the battery. Same 2px clear margin as the phone parts. */
export const batterySprites = {
  cell: { width: 552, height: 890, opaqueWidth: 548, opaqueHeight: 886 },
  protectionBoard: { width: 948, height: 233, opaqueWidth: 944, opaqueHeight: 229 },
} as const satisfies Record<string, Sprite>;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = 71.5;

/**
 * The front finishes fading at `r = 1 / INTERNALS_SCALE` (1.6× the opening fit).
 * The parts group uses its own scale: the exploded row is authored at its final size.
 */
export const INTERNALS_SCALE = 0.625;

/**
 * Scale of the parts group. On a 1280×800 window, at 1.6× the opening fit,
 * the back glass, the midframe and the display fill about 85% of the limiting side.
 */
const PARTS_SCALE = 0.562631;

/** Scale of the battery's inner group, in the battery's own space. */
const BATTERY_PARTS_SCALE = 0.643568;

/**
 * Label scale in its group's space. With the group scale above, the face is
 * about 18px at that level's reveal on a 1280×800 window.
 */
const PARTS_LABEL_SCALE = 1.159545;
const BATTERY_LABEL_SCALE = 0.499237;

/**
 * `[start, end]` in relative zoom. The end is `1 / INTERNALS_SCALE`.
 * The phone uses the opening fit as `r = 1`. A nested level names the part
 * it belongs to (`fadeInOf`); that part's own opening fit is `r = 1`.
 * The platform fades the part's siblings out over the same range.
 */
const REVEAL = [1, 1 / INTERNALS_SCALE] as const;

/** Pouch cell, 39 mm across the 40 mm pack. `CELL_Y_MM` is its exploded centre. */
const CELL_WIDTH_MM = 39;
const CELL_Y_MM = 7.936;

/**
 * Protection board, 40 mm across. The flex in the art points up on the right,
 * where the pack's connector is. `BOARD_Y_MM` is its exploded centre, above the cell.
 */
const BOARD_WIDTH_MM = 40;
const BOARD_Y_MM = -34.67;

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
  z?: number,
): CanvasObject {
  const mmPerPx = opaqueWidthMm / sprite.opaqueWidth;
  return {
    id,
    x,
    y,
    ...(z !== undefined ? { z } : {}),
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
 * A callout in its parent's millimetres. `x` and `y` are the label centre,
 * already where the leader should land. The link stores ids only.
 * The label fades in with its part. When a next level opens, the platform
 * fades every sibling at this parent — parts, labels, and through them the
 * leaders — so this callout does not name the part being entered.
 */
/**
 * Wide enough for the words at the label's 4.2 mm face. `scale` then brings
 * that face to about 18px at the level's reveal on a wide window.
 */
function labelWidth(text: string): number {
  return Math.round(text.length * 0.55 * 4.2 * 10) / 10;
}

function callout(
  partId: string,
  text: string,
  x: number,
  y: number,
  parentId = 'internals',
  fade: ZoomFade = fadeIn,
  scale = PARTS_LABEL_SCALE,
): readonly CanvasObject[] {
  return [
    {
      id: `${partId}-label`,
      parentId,
      x,
      y,
      scale,
      visibility: band,
      fade,
      payload: {
        type: 'text',
        text,
        style: { fontSize: 4.2 },
        width: labelWidth(text),
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
 * front image. `x` and `y` are the final positions of the wide exploded row.
 * Nothing moves as you zoom. `battery-internals` is that same kind of group
 * on `battery`, with the cell and the protection board already apart.
 * The fade is zoom-driven opacity. Children of a part set
 * `fadeInOf` to that part. Entering it fades the whole sibling level, not
 * only the part, and only that part's children come in.
 *
 * Each label sits just off its part: a short leader, at least 20° off both
 * axes, about 18px on a 1280×800 window when that level has finished fading in.
 */
export const smartphoneObjects: readonly CanvasObject[] = [
  {
    id: 'internals',
    parentId: 'phone',
    x: 0,
    y: 0,
    scale: PARTS_SCALE,
    visibility: band,
    payload: { type: 'group' },
  },
  {
    id: 'battery-internals',
    parentId: 'battery',
    x: 0,
    y: 0,
    scale: BATTERY_PARTS_SCALE,
    visibility: band,
    payload: { type: 'group' },
  },
  cutout('back-glass', 'images/smartphone/back-glass.webp', partSprites.backGlass, 71.34, -111.205, 0, fadeIn, 'internals', 0),
  cutout('midframe', 'images/smartphone/midframe.webp', partSprites.midframe, PHONE_WIDTH_MM, 0, 0, fadeIn, 'internals', 1),
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
    2,
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
    3,
  ),
  cutout(
    'camera-module',
    'images/smartphone/camera-module.webp',
    partSprites.cameraModule,
    24.03,
    -18.8,
    -47.5,
    fadeIn,
    'internals',
    4,
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
    5,
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
    6,
  ),
  cutout('display', 'images/smartphone/display.webp', partSprites.display, 71.34, 111.205, 0, fadeIn, 'internals', 7),
  cutout('phone', 'images/smartphone.webp', smartphoneSprite, PHONE_WIDTH_MM, 0, 0, fadeOut),
  ...callout('back-glass', 'Back glass', -143.264, -79.348),
  ...callout('camera-module', 'Camera', -48.43, -59.471),
  ...callout('battery', 'Battery', -49.788, -4.825),
  ...callout('loudspeaker', 'Speaker', -47.344, 80.684),
  ...callout('display', 'Display', 79.146, -79.348),
  ...callout('logic-board', 'Logic board', 54.22, -57.906),
  ...callout('midframe', 'Midframe', 32.835, -81.27),
  ...callout('haptic-motor', 'Haptic motor', 50.822, 81.781),
  ...callout('cell', 'Cell', -23.337, 17.365, 'battery-internals', fadeInBattery, BATTERY_LABEL_SCALE),
  ...callout('protection-board', 'Protection board', -30.718, -22.259, 'battery-internals', fadeInBattery, BATTERY_LABEL_SCALE),
];

/** Aged paper and the phone. Camera limits are derived; the fit is the opening scale. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
};
