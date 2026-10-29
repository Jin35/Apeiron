import type { CanvasObject, TextStyle, VisibilityRange } from './model';
import { darkTheme, type ContentPack } from './theme';

/**
 * Four zoom bands. Ranges overlap on purpose so the handoff fades
 * instead of leaving the map empty. See README for the scale table.
 */
const overview: VisibilityRange = { minScale: 0.02, maxScale: 0.3 };
const region: VisibilityRange = { minScale: 0.16, maxScale: 2.2 };
const place: VisibilityRange = { minScale: 0.95, maxScale: 8 };
const detail: VisibilityRange = { minScale: 5, maxScale: 64 };

const SERIF = '"Iowan Old Style", Palatino, Georgia, serif';

const GOLD = '#f0d78c';
const MIST = '#d7ebe4';
const PAPER = '#f3efe6';
const SLATE = '#a9b7c6';

function text(
  id: string,
  x: number,
  y: number,
  label: string,
  fontSize: number,
  color: string,
  visibility: VisibilityRange,
  width: number,
  height: number,
  extras?: Partial<TextStyle>,
): CanvasObject {
  return {
    id,
    x,
    y,
    visibility,
    payload: {
      type: 'text',
      text: label,
      style: { fontSize, color, fontFamily: SERIF, ...extras },
      width,
      height,
    },
  };
}

function image(
  id: string,
  x: number,
  y: number,
  src: string,
  width: number,
  height: number,
  visibility: VisibilityRange,
): CanvasObject {
  return {
    id,
    x,
    y,
    visibility,
    payload: { type: 'image', src, width, height },
  };
}

const north = { x: -2400, y: -1500 };
const harbor = { x: north.x - 540, y: north.y + 340 };
const glass = { x: north.x + 560, y: north.y - 280 };
const wharf = { x: harbor.x - 72, y: harbor.y + 48 };

const basin = { x: 2300, y: 1400 };
const dune = { x: basin.x - 460, y: basin.y - 300 };
const observatory = { x: dune.x - 90, y: dune.y + 70 };

const western = { x: -2200, y: 1550 };

/**
 * World width the opening camera uses to fit "THE ARCHIPELAGO".
 * Each text payload's width and height is its cull box — the previous glyph
 * overestimate — which stays a different number from this fit width.
 */
export const titleFitWidth = 6300;

export const demoObjects: CanvasObject[] = [
  text('overview-title', 0, -420, 'THE ARCHIPELAGO', 520, GOLD, overview, 10870.6, 808.6, {
    fontWeight: '650',
    letterSpacing: '0.14em',
  }),
  text('overview-subtitle', 0, 80, 'field atlas', 180, '#cbbd8a', overview, 2920.5, 279.9, {
    letterSpacing: '0.22em',
  }),
  text('overview-north', north.x, north.y, 'NORTH SHELF', 300, GOLD, overview, 4537.5, 466.5, {
    fontWeight: '600',
    letterSpacing: '0.12em',
  }),
  text('overview-basin', basin.x, basin.y, 'DEEP BASIN', 300, GOLD, overview, 4126.5, 466.5, {
    fontWeight: '600',
    letterSpacing: '0.12em',
  }),
  text('overview-west', western.x, western.y, 'WESTERN REACH', 280, GOLD, overview, 5002.2, 435.4, {
    fontWeight: '600',
    letterSpacing: '0.12em',
  }),

  text('region-center', 0, -210, 'Central Sound', 72, MIST, region, 1173.96, 111.96, { fontWeight: '600' }),
  image('region-compass', 0, -50, 'images/compass.svg', 150, 150, region),
  text('region-harbor', harbor.x, harbor.y, 'Harbor City', 84, MIST, region, 1159.62, 130.62, {
    fontWeight: '600',
  }),
  text('region-glass', glass.x, glass.y, 'Glass Atoll', 84, MIST, region, 1159.62, 130.62, {
    fontWeight: '600',
  }),
  image('region-atoll', glass.x, glass.y + 360, 'images/atoll.svg', 380, 380, region),

  text('region-dune', dune.x, dune.y, 'Red Dune', 84, MIST, region, 844.62, 130.62, { fontWeight: '600' }),
  image('region-dune-image', dune.x + 40, dune.y + 340, 'images/dune.svg', 480, 320, region),
  text('region-cedar', western.x - 280, western.y + 420, 'Cedar Anchorage', 76, MIST, region, 1429.18, 118.18, {
    fontWeight: '600',
  }),

  text('place-sounding', -150, -96, 'Sounding', 16, PAPER, place, 160.88, 24.88),
  text('place-recorder', 132, -130, 'Field recorder', 15, PAPER, place, 263.325, 23.325),
  image('place-phone', 132, -60, 'images/phone.svg', 36, 64, place),
  text('place-wharf', wharf.x, wharf.y, 'Old Wharf', 18, PAPER, place, 203.49, 27.99),
  text('place-tower', harbor.x + 96, harbor.y - 58, 'Signal Tower', 18, PAPER, place, 270.99, 27.99),
  text('place-market', harbor.x + 28, harbor.y + 78, 'Salt Market', 16, PAPER, place, 220.88, 24.88),
  text('place-lagoon', glass.x + 120, glass.y - 40, 'Lagoon Rim', 16, PAPER, place, 200.88, 24.88),
  text('place-observatory', observatory.x, observatory.y, 'Observatory', 18, PAPER, place, 248.49, 27.99),
  image('place-scope', observatory.x + 140, observatory.y + 24, 'images/scope.svg', 80, 60, place),

  text('detail-clapper', -12, -92, 'clapper', 2.1, SLATE, detail, 18.4905, 3.2655),
  text('detail-chain', 14, -66, 'chain link', 2, SLATE, detail, 25.11, 3.11),
  text('detail-bollard', wharf.x - 16, wharf.y - 14, 'bollard', 2.2, SLATE, detail, 19.371, 3.421),
  text('detail-rope', wharf.x + 18, wharf.y - 6, 'coil of rope', 2.1, SLATE, detail, 31.6155, 3.2655),
  text('detail-booth', wharf.x - 4, wharf.y + 18, 'ticket booth', 2, SLATE, detail, 30.11, 3.11),
  image('detail-buoy', wharf.x + 24, wharf.y + 8, 'images/buoy.svg', 7, 7, detail),
  text('detail-lens', observatory.x - 14, observatory.y - 12, 'lens cap', 2.1, SLATE, detail, 21.1155, 3.2655),
  text('detail-tray', observatory.x + 16, observatory.y + 10, 'sample tray', 2, SLATE, detail, 27.61, 3.11),
];

/** Archipelago content: the historical dark look plus the atlas objects. */
export const demoPack: ContentPack = {
  theme: darkTheme,
  objects: demoObjects,
};
