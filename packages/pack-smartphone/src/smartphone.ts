import type { ContentPack } from '@apeiron/core';
import presented from '../data/smartphone.json';
import { hierarchyFromPresented, objectsFromPresented } from './load';
import type { PresentedFile } from './presented';
import { REVEAL_END } from './reveal';
import { batterySprites, partSprites, PHONE_WIDTH_MM, smartphoneSprite } from './sprites';
import { paperTheme } from './theme';

const data = presented as unknown as PresentedFile;

export { batterySprites, partSprites, PHONE_WIDTH_MM, smartphoneSprite };
export { INTERNALS_SCALE, REVEAL, REVEAL_END } from './reveal';

/** One row per hierarchy node, in the order the markdown lists them. */
export const hierarchyNodes = hierarchyFromPresented(data);

/** Nodes drawn smaller than child size ÷ parent size, and any the packer could not place. */
export const smartphoneLayoutReport = {
  shrunk: data.report.shrunk,
  unplaced: data.report.unplaced,
};

/**
 * The checked-in scene: groups, pictures, labels, and links, in paint order.
 * Positions come from `data/smartphone.json`. The page does not pack them.
 */
export const smartphoneObjects = objectsFromPresented(data);

/** Aged paper and the phone. Camera limits are derived; the fit is the opening scale. */
export const smartphonePack: ContentPack = {
  theme: paperTheme,
  objects: smartphoneObjects,
  intoFactor: REVEAL_END,
};
