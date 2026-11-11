import raw from '../data/overrides.json';

type CutoutSprite = {
  src: string;
  width: number;
  height: number;
  opaqueWidth?: number;
  opaqueHeight?: number;
};

type OverridesFile = {
  phoneWidthMm: number;
  sprites: Record<string, CutoutSprite>;
};

const overrides = raw as unknown as OverridesFile;

/** Opaque phone width. World units are millimetres. */
export const PHONE_WIDTH_MM = overrides.phoneWidthMm;

type Sprite = {
  width: number;
  height: number;
  opaqueWidth: number;
  opaqueHeight: number;
};

function cutout(id: string): Sprite {
  const sprite = overrides.sprites[id];
  if (!sprite || sprite.opaqueWidth === undefined || sprite.opaqueHeight === undefined) {
    throw new Error(`missing cut-out ${id}`);
  }
  return {
    width: sprite.width,
    height: sprite.height,
    opaqueWidth: sprite.opaqueWidth,
    opaqueHeight: sprite.opaqueHeight,
  };
}

/** `images/smartphone.webp`. The opaque phone is 71.5 mm wide. */
export const smartphoneSprite = cutout('phone');

/**
 * Level-1 cutouts, in pixels. World size maps the part's opaque width in
 * millimetres onto `opaqueWidth` and keeps this file's aspect.
 */
export const partSprites = {
  backGlass: cutout('back-glass'),
  midframe: cutout('midframe'),
  battery: cutout('battery'),
  logicBoard: cutout('logic-board'),
  cameraModule: cutout('camera-module'),
  loudspeaker: cutout('loudspeaker'),
  hapticMotor: cutout('haptic-motor'),
  display: cutout('display'),
} as const satisfies Record<string, Sprite>;

/** Inside the battery. Same clear margin as the phone parts. */
export const batterySprites = {
  cell: cutout('cell'),
  protectionBoard: cutout('protection-board'),
} as const satisfies Record<string, Sprite>;
