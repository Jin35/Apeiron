/**
 * Read smartphone-hierarchy.md and data/overrides.json, pack the tree, and
 * write data/smartphone.json. Run from the repo root: `npm run generate`.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  MAX_SCALE,
  formatRepeatCount,
  latticeBasis,
  patternBounds,
  repeatTotal,
  type CanvasObject,
  type LatticeKind,
  type NodeRepeat,
  type RepeatPattern,
  type ZoomFade,
} from '@apeiron/core';
import type { HierarchyKind, HierarchyNode, HierarchyPattern, HierarchyRepeat, HierarchyStatus } from '../src/hierarchy';
import { objectsFromPresented } from '../src/load';
import type { PresentedFade, PresentedFile, PresentedGroup, PresentedLabel, PresentedNode } from '../src/presented';
import { REVEAL } from '../src/reveal';
import { layoutTree, type LayoutArt, type LayoutHost, type SpacePolicy } from '../src/treeLayout';

const UNIT_IN_MM: Record<string, number> = {
  mm: 1,
  µm: 1e-3,
  um: 1e-3,
  nm: 1e-6,
  pm: 1e-9,
};

type Sprite = {
  src: string;
  width: number;
  height: number;
  opaqueWidth?: number;
  opaqueHeight?: number;
};

type OverrideGroup = {
  id: string;
  parent: string;
  x: number;
  y: number;
  scale: number;
  packChildrenOf?: string;
  fullFrame?: boolean;
  labelFontSize?: number;
  fadeAgainstOpening?: boolean;
};

type AuthoredLabel = {
  text: string;
  x: number;
  y: number;
  scale?: number;
};

type AuthoredNode = {
  id: string;
  parent?: string;
  opaqueWidthMm: number;
  x: number;
  y: number;
  z?: number;
  fade: 'in' | 'out';
  fadeInOf?: string;
  label?: AuthoredLabel;
};

type Overrides = {
  band: { minScale: number; maxScale: number };
  phoneWidthMm: number;
  groups: OverrideGroup[];
  sprites: Record<string, Sprite>;
  authored: AuthoredNode[];
  labelOrder: string[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseHierarchy(markdown: string): HierarchyNode[] {
  const chunks = markdown.split(/^### /m).slice(1);
  return chunks.map((chunk) => {
    const header = chunk.split('\n', 1)[0] ?? '';
    const headerMatch = /^(?<name>.+) \(`(?<id>[^`]+)`\)\s*$/.exec(header);
    if (!headerMatch?.groups) throw new Error(`bad heading: ${header}`);
    const id = headerMatch.groups.id;
    const name = headerMatch.groups.name.replace(/ \((view|process)\)$/, '');
    if (!id || !name) throw new Error(`bad heading: ${header}`);
    const field = (label: string) => {
      const match = new RegExp(`^- ${label}:\\s*(.+)$`, 'm').exec(chunk);
      if (!match?.[1]) throw new Error(`${id} is missing ${label}`);
      return match[1].trim();
    };
    const parentRaw = field('Parent');
    const parentMatch = /`([^`]+)`/.exec(parentRaw);
    const parentId = parentMatch?.[1] ?? null;
    const status = field('Status');
    if (status !== 'built' && status !== 'planned') throw new Error(`${id} status ${status}`);
    const kindRaw = field('Kind');
    const kind = kindRaw.split(/\s/)[0];
    if (kind !== 'part' && kind !== 'view' && kind !== 'process') throw new Error(`${id} kind ${kindRaw}`);
    const size = field('Characteristic size');
    const sizeMatch = /^([0-9]+(?:\.[0-9]+)?)\s+(mm|µm|um|nm|pm)\b/.exec(size);
    if (!sizeMatch?.[1] || !sizeMatch[2]) throw new Error(`${id} size ${size}`);
    const unit = UNIT_IN_MM[sizeMatch[2]];
    if (unit === undefined) throw new Error(`${id} size ${size}`);
    const sizeMm = roundedSize(Number(sizeMatch[1]) * unit);
    const countText = field('Count');
    const perParent = perParentCount(countText);
    const repeatLine = optionalField(chunk, 'Repeat');
    const pattern = repeatLine ? parseRepeat(repeatLine) : null;
    if (repeatLine && !pattern) throw new Error(`${id} has an unreadable Repeat line`);
    if (pattern && perParent === null) throw new Error(`${id} has Repeat but no per-parent count`);
    if (pattern && perParent !== null && !repeatMatchesCount(pattern, perParent)) {
      const shape =
        pattern.kind === 'grid'
          ? `${pattern.cols}×${pattern.rows}`
          : pattern.kind === 'lattice'
            ? `${pattern.cols}×${pattern.rows}×${pattern.basis ?? latticeBasis(pattern.lattice)}`
            : pattern.kind;
      throw new Error(`${id} ${pattern.kind} ${shape} is not count ${perParent}`);
    }
    const opacity = readUnit(chunk, id, 'Opacity');
    const occupancy = readUnit(chunk, id, 'Occupancy');
    const seed = readSeed(chunk, id);
    if ((opacity !== undefined || occupancy !== undefined || seed !== undefined) && !pattern) {
      throw new Error(`${id} sets opacity, occupancy, or seed without a Repeat`);
    }
    const repeat: HierarchyRepeat | null =
      pattern && perParent !== null
        ? {
            count: perParent,
            pattern,
            ...(opacity !== undefined ? { opacity } : {}),
            ...(occupancy !== undefined ? { occupancy } : {}),
            ...(seed !== undefined ? { seed } : {}),
          }
        : null;
    return {
      id,
      name,
      parentId,
      kind,
      status,
      sizeMm,
      countMark: countMark(countText),
      perParentCount: perParent,
      repeat,
    };
  });
}

/** A grid's cols×rows, or a lattice's cells×basis, must equal the per-parent count. */
function repeatMatchesCount(pattern: HierarchyPattern, count: number): boolean {
  if (pattern.kind === 'grid') return pattern.cols * pattern.rows === count;
  if (pattern.kind === 'lattice') {
    const basis = pattern.basis ?? latticeBasis(pattern.lattice);
    return pattern.cols * pattern.rows * basis === count;
  }
  return true;
}

function readUnit(chunk: string, id: string, label: string): number | undefined {
  const text = optionalField(chunk, label);
  if (text === null) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)/.exec(text);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${id} ${label} must be between 0 and 1`);
  }
  return value;
}

function readSeed(chunk: string, id: string): number | undefined {
  const text = optionalField(chunk, 'Seed');
  if (text === null) return undefined;
  const match = /^([0-9]+)/.exec(text);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${id} seed must be a non-negative integer`);
  return value;
}

/** Twelve significant figures, matching the sizes the layout has always packed. */
function roundedSize(value: number): number {
  if (Number.isInteger(value)) return value;
  return Number(value.toPrecision(12));
}

/**
 * Label suffix from a Count line.
 * `~15 billion …` stays `×~15 billion`. A plain integer (`4 per parent`) is `×4`.
 * A lone `1`, or the representative phrases, stay unmarked.
 */
export function countMark(count: string): string | null {
  if (/^(?:1\b|Not applicable|One representative|Typically one)/i.test(count)) return null;
  const leading = /^(~?)([0-9]+(?:\.[0-9]+)?)(?:\s+(billion|million|thousand))?\b/i.exec(count);
  if (!leading?.[2]) return null;
  const approx = leading[1] ?? '';
  const num = leading[2];
  const unit = leading[3]?.toLowerCase();
  if (unit) return `×${approx}${num} ${unit}`;
  if (approx) return `×${approx}${num}`;
  return `×${num}`;
}

/** Leading number on a Count line, in copies per parent. Magnitudes scale the number. */
export function perParentCount(count: string): number | null {
  if (/^(?:1\b|Not applicable|One representative|Typically one)/i.test(count)) return null;
  const leading = /^(~?)([0-9]+(?:\.[0-9]+)?)(?:\s+(billion|million|thousand))?\b/i.exec(count);
  if (!leading?.[2]) return null;
  const value = Number(leading[2]);
  if (!Number.isFinite(value)) return null;
  const unit = leading[3]?.toLowerCase();
  const scale = unit === 'billion' ? 1e9 : unit === 'million' ? 1e6 : unit === 'thousand' ? 1e3 : 1;
  return value * scale;
}

/**
 * `Repeat:` line. Pitches and lattice constants come back in millimetres.
 * `grid C×R pitch P`, `rows pitch P` with an optional stagger, `scatter` with a density,
 * or `lattice honeycomb|hex|diamond|square, a L, C×R` with an optional basis.
 */
export function parseRepeat(line: string): HierarchyPattern | null {
  const lattice = parseLattice(line);
  if (lattice) return lattice;
  const grid =
    /grid\s+([0-9]+(?:\.[0-9]+)?)\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)\s*,?\s*pitch\s+([0-9]+(?:\.[0-9]+)?)\s*(mm|µm|um|nm|pm)(?:\s*[×x]\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|µm|um|nm|pm))?/i.exec(
      line,
    );
  if (grid?.[1] && grid[2] && grid[3] && grid[4]) {
    const cols = Number(grid[1]);
    const rows = Number(grid[2]);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return null;
    const pitchX = Number(grid[3]) * (UNIT_IN_MM[grid[4]] ?? Number.NaN);
    const pitchY = grid[5] && grid[6] ? Number(grid[5]) * (UNIT_IN_MM[grid[6]] ?? Number.NaN) : pitchX;
    if (!(pitchX > 0) || !(pitchY > 0)) return null;
    return { kind: 'grid', cols, rows, pitchXMm: pitchX, pitchYMm: pitchY };
  }
  if (/^\s*rows\b/i.test(line)) {
    const pitch = /pitch\s+([0-9]+(?:\.[0-9]+)?)\s*(mm|µm|um|nm|pm)/i.exec(line);
    if (!pitch?.[1] || !pitch[2]) return null;
    const pitchMm = Number(pitch[1]) * (UNIT_IN_MM[pitch[2]] ?? Number.NaN);
    if (!(pitchMm > 0)) return null;
    if (/\bno stagger\b/i.test(line)) return { kind: 'rows', pitchMm };
    const stagger = /stagger\s+([0-9]+(?:\.[0-9]+)?)\s*(mm|µm|um|nm|pm)/i.exec(line);
    if (stagger?.[1] && stagger[2]) {
      const staggerMm = Number(stagger[1]) * (UNIT_IN_MM[stagger[2]] ?? Number.NaN);
      if (!(staggerMm >= 0)) return null;
      return { kind: 'rows', pitchMm, staggerMm };
    }
    if (/\bstagger\b/i.test(line)) return { kind: 'rows', pitchMm, staggerMm: pitchMm / 2 };
    return { kind: 'rows', pitchMm };
  }
  if (/^\s*scatter\b/i.test(line)) {
    const density = /density\s+([0-9]+(?:\.[0-9]+)?)(?:\s*\/\s*(mm|µm|um|nm|pm)(?:2|²))?/i.exec(line);
    if (!density?.[1]) return null;
    const unit = density[2] ? UNIT_IN_MM[density[2]] : 1;
    if (unit === undefined || !(unit > 0)) return null;
    const densityPerMm2 = Number(density[1]) / (unit * unit);
    if (!(densityPerMm2 > 0)) return null;
    const seedMatch = /seed\s+([0-9]+)/i.exec(line);
    const seed = seedMatch?.[1] ? Number(seedMatch[1]) : 1;
    return { kind: 'scatter', seed, densityPerMm2 };
  }
  return null;
}

function parseLattice(line: string): HierarchyPattern | null {
  const header = /^\s*lattice\s+(hex|honeycomb|diamond|square)\b/i.exec(line);
  const name = header?.[1]?.toLowerCase();
  if (name !== 'hex' && name !== 'honeycomb' && name !== 'diamond' && name !== 'square') return null;
  const constant = /\ba\s+([0-9]+(?:\.[0-9]+)?)\s*(mm|µm|um|nm|pm)/i.exec(line);
  if (!constant?.[1] || !constant[2]) return null;
  const unit = UNIT_IN_MM[constant[2]];
  const aMm = Number(constant[1]) * (unit ?? Number.NaN);
  if (!(aMm > 0)) return null;
  const cells = /([0-9]+)\s*[×x]\s*([0-9]+)/.exec(line);
  if (!cells?.[1] || !cells[2]) return null;
  const cols = Number(cells[1]);
  const rows = Number(cells[2]);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return null;
  const basisMatch = /basis\s+([0-9]+)/i.exec(line);
  const basis = basisMatch?.[1] ? Number(basisMatch[1]) : undefined;
  if (basis !== undefined && (!Number.isInteger(basis) || basis < 1)) return null;
  const lattice: LatticeKind = name;
  if (basis !== undefined && basis !== latticeBasis(lattice)) return null;
  return { kind: 'lattice', lattice, aMm, cols, rows, ...(basis !== undefined ? { basis } : {}) };
}

function optionalField(chunk: string, label: string): string | null {
  const match = new RegExp(`^- ${label}:\\s*(.+)$`, 'm').exec(chunk);
  return match?.[1]?.trim() ?? null;
}

export function presentedJson(): string {
  const nodes = readNodes();
  const overrides = readOverrides();
  const scene = place(nodes, overrides);
  const file = presentFile(scene, overrides, scene.nodes);
  const json = `${JSON.stringify(file, null, 2)}\n`;
  assertSame(scene.objects, objectsFromPresented(JSON.parse(json) as PresentedFile));
  return json;
}

function presentFile(
  scene: { objects: CanvasObject[]; report: ReturnType<typeof layoutTree> },
  overrides: Overrides,
  nodes: readonly HierarchyNode[],
): PresentedFile {
  if (scene.report.unplaced.length > 0) {
    throw new Error(`unplaced: ${scene.report.unplaced.map((entry) => entry.id).join(', ')}`);
  }
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const groups = overrides.groups.map((group) => groupRecord(required(byId, group.id)));
  const presented = nodes.map((node) => nodeRecord(node, byId));
  return {
    groups,
    nodes: presented,
    order: scene.objects.map((object) => object.id),
    report: {
      shrunk: scene.report.shrunk.map((entry) => ({ id: entry.id, factor: entry.factor })),
      unplaced: scene.report.unplaced.map((entry) => ({ id: entry.id, reason: entry.reason })),
    },
  };
}

function readNodes(): HierarchyNode[] {
  const markdown = readFileSync(join(root, 'smartphone-hierarchy.md'), 'utf8');
  const nodes = parseHierarchy(markdown);
  if (nodes.length !== 200) throw new Error(`expected 200 nodes, parsed ${nodes.length}`);
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new Error(`duplicate id ${node.id}`);
    ids.add(node.id);
    if (node.parentId !== null && !ids.has(node.parentId)) {
      throw new Error(`${node.id} is listed before its parent ${node.parentId}`);
    }
    if (!(node.sizeMm > 0)) throw new Error(`${node.id} has no characteristic size`);
  }
  return nodes;
}

function readOverrides(): Overrides {
  return JSON.parse(readFileSync(join(root, 'data/overrides.json'), 'utf8')) as Overrides;
}

function place(
  nodes: readonly HierarchyNode[],
  overrides: Overrides,
): { objects: CanvasObject[]; report: ReturnType<typeof layoutTree>; nodes: HierarchyNode[] } {
  const built = authoredObjects(nodes, overrides);
  const hosts: LayoutHost[] = [];
  const policies: Record<string, SpacePolicy> = {};
  for (const group of overrides.groups) {
    if (group.packChildrenOf) {
      hosts.push({
        parentId: group.packChildrenOf,
        spaceId: group.id,
        ...(group.fadeAgainstOpening ? { fadeAgainstOpening: true } : {}),
      });
    }
    if (group.fullFrame || group.labelFontSize !== undefined) {
      policies[group.id] = {
        ...(group.fullFrame ? { fullFrame: true } : {}),
        ...(group.labelFontSize !== undefined ? { labelFontSize: group.labelFontSize } : {}),
      };
    }
  }
  const art: Record<string, LayoutArt> = {};
  for (const [id, sprite] of Object.entries(overrides.sprites)) {
    art[id] = { src: sprite.src, width: sprite.width, height: sprite.height };
  }
  const labeled = applyChainLabels(nodes);
  const laidOut = layoutTree(labeled, built, {
    reveal: REVEAL,
    hosts,
    policies,
    art,
    band: overrides.band,
  });
  const objects = [...built, ...laidOut.objects];
  stampRepeats(objects, labeled);
  // The carbon disc is smaller than its bond, so its fit sits on the camera
  // ceiling. The band has to extend past that ceiling or the fade ends exactly
  // where the camera stops and the atom is invisible.
  extendBand(objects, 'graphite-carbon-atom');
  return { objects, report: laidOut, nodes: labeled };
}

function extendBand(objects: CanvasObject[], id: string): void {
  const cap = MAX_SCALE * 1.35;
  for (const target of [id, `${id}-label`, `${id}-link`]) {
    const object = objects.find((entry) => entry.id === target);
    if (!object || object.visibility.maxScale < MAX_SCALE) continue;
    object.visibility = { ...object.visibility, maxScale: Math.max(object.visibility.maxScale, cap) };
  }
}

/**
 * The label shows the per-parent count. When repeated ancestors make the
 * device-wide product differ, the label shows that product instead.
 */
function applyChainLabels(nodes: readonly HierarchyNode[]): HierarchyNode[] {
  const standins: CanvasObject[] = nodes.map((node) => ({
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    x: 0,
    y: 0,
    visibility: { minScale: 0, maxScale: 1 },
    ...(node.repeat
      ? {
          repeat: {
            count: node.repeat.count,
            pattern: { kind: 'rows' as const, pitch: 1 },
            ...(node.repeat.occupancy !== undefined ? { occupancy: node.repeat.occupancy } : {}),
          },
        }
      : {}),
    payload: { type: 'group' },
  }));
  return nodes.map((node) => {
    if (!node.repeat) return node;
    const total = repeatTotal(standins, node.id);
    const shown = total !== null && total !== node.repeat.count ? total : node.repeat.count;
    return { ...node, countMark: formatRepeatCount(shown) };
  });
}

/** Parent-local pitches: the node's drawn size stands for its characteristic size. */
function stampRepeats(objects: CanvasObject[], nodes: readonly HierarchyNode[]): void {
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const node of nodes) {
    if (!node.repeat) continue;
    const object = byId.get(node.id);
    const payload = object?.payload;
    if (!object || !payload || payload.type === 'group' || payload.type === 'link') {
      throw new Error(`repeat ${node.id} is not a picture`);
    }
    if (!(node.sizeMm > 0)) throw new Error(`${node.id} has no size for its repeat pitch`);
    const xScale = payload.width / node.sizeMm;
    const yScale = payload.height / node.sizeMm;
    const pattern = localPattern(node.repeat.pattern, xScale, yScale);
    const repeat: NodeRepeat = { count: node.repeat.count, pattern, ...repeatStyle(node) };
    // Scatter has no pitch. The region is the square whose area is count ÷ density,
    // centred on the placed copy, so the drawn points match the per-parent count.
    if (pattern.kind === 'scatter' && node.repeat.pattern.kind === 'scatter') {
      const areaMm2 = node.repeat.count / node.repeat.pattern.densityPerMm2;
      const sideMm = Math.sqrt(areaMm2);
      if (sideMm > 0 && Number.isFinite(sideMm)) {
        object.repeat = {
          ...repeat,
          region: {
            x: object.x,
            y: object.y,
            width: sideMm * xScale,
            height: sideMm * yScale,
          },
        };
        continue;
      }
    }
    const bounds = patternBounds(repeat, object.x, object.y, payload.width, payload.height);
    object.repeat = {
      ...repeat,
      region: {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      },
    };
  }
}

/** Repeated views are faint unless the hierarchy names an opacity. Parts stay opaque. */
function repeatStyle(node: HierarchyNode): Pick<NodeRepeat, 'opacity' | 'occupancy' | 'seed'> {
  const opacity = node.repeat?.opacity ?? (node.kind === 'view' ? 0.25 : undefined);
  return {
    ...(opacity !== undefined ? { opacity } : {}),
    ...(node.repeat?.occupancy !== undefined ? { occupancy: node.repeat.occupancy } : {}),
    ...(node.repeat?.seed !== undefined ? { seed: node.repeat.seed } : {}),
  };
}

function localPattern(pattern: HierarchyPattern, xScale: number, yScale: number): RepeatPattern {
  if (pattern.kind === 'lattice') {
    const scale = Math.max(xScale, yScale);
    return {
      kind: 'lattice',
      lattice: pattern.lattice,
      a: pattern.aMm * scale,
      cols: pattern.cols,
      rows: pattern.rows,
      ...(pattern.basis !== undefined ? { basis: pattern.basis } : {}),
    };
  }
  if (pattern.kind === 'grid') {
    return {
      kind: 'grid',
      cols: pattern.cols,
      rows: pattern.rows,
      pitchX: pattern.pitchXMm * xScale,
      pitchY: pattern.pitchYMm * yScale,
    };
  }
  if (pattern.kind === 'rows') {
    return {
      kind: 'rows',
      pitch: pattern.pitchMm * yScale,
      ...(pattern.staggerMm !== undefined ? { stagger: pattern.staggerMm * xScale } : {}),
    };
  }
  return {
    kind: 'scatter',
    seed: pattern.seed,
    density: pattern.densityPerMm2 / (xScale * yScale),
  };
}

function authoredObjects(nodes: readonly HierarchyNode[], overrides: Overrides): CanvasObject[] {
  const known = new Set(nodes.map((node) => node.id));
  const groupById = new Map(overrides.groups.map((group) => [group.id, group]));
  const objects: CanvasObject[] = [];
  for (const group of overrides.groups) {
    objects.push({
      id: group.id,
      parentId: group.parent,
      x: group.x,
      y: group.y,
      scale: group.scale,
      visibility: overrides.band,
      payload: { type: 'group' },
    });
  }
  const authored = new Map<string, AuthoredNode>();
  for (const item of overrides.authored) {
    if (!known.has(item.id)) throw new Error(`authored ${item.id} is not in the hierarchy`);
    authored.set(item.id, item);
    const sprite = overrides.sprites[item.id];
    if (!sprite?.opaqueWidth || !sprite.opaqueHeight) throw new Error(`${item.id} needs a cut-out`);
    const mmPerPx = item.opaqueWidthMm / sprite.opaqueWidth;
    objects.push({
      id: item.id,
      x: item.x,
      y: item.y,
      ...(item.z !== undefined ? { z: item.z } : {}),
      ...(item.parent ? { parentId: item.parent } : {}),
      visibility: overrides.band,
      fade: fadeFor(item),
      labelId: `${item.id}-label`,
      payload: {
        type: 'image',
        src: sprite.src,
        width: sprite.width * mmPerPx,
        height: sprite.height * mmPerPx,
        frame: false,
      },
    });
  }
  for (const id of overrides.labelOrder) {
    const item = authored.get(id);
    const label = item?.label;
    if (!item || !label) throw new Error(`missing label for ${id}`);
    const host = item.parent ? groupById.get(item.parent) : undefined;
    const fontSize = host?.labelFontSize;
    if (fontSize === undefined) throw new Error(`${id} label has no font size`);
    objects.push({
      id: `${id}-label`,
      ...(item.parent ? { parentId: item.parent } : {}),
      x: label.x,
      y: label.y,
      ...(label.scale !== undefined ? { scale: label.scale } : {}),
      visibility: overrides.band,
      fade: fadeFor(item),
      payload: {
        type: 'text',
        text: label.text,
        style: { fontSize },
        width: Math.round(label.text.length * 0.55 * fontSize * 10) / 10,
        height: fontSize,
      },
    });
    objects.push({
      id: `${id}-link`,
      x: 0,
      y: 0,
      visibility: overrides.band,
      payload: { type: 'link', from: `${id}-label`, to: id },
    });
  }
  return objects;
}

function fadeFor(item: AuthoredNode): ZoomFade {
  if (item.fade === 'out') return { fadeOut: REVEAL };
  if (item.fadeInOf) return { fadeIn: REVEAL, fadeInOf: item.fadeInOf };
  return { fadeIn: REVEAL };
}

function groupRecord(object: CanvasObject): PresentedGroup {
  if (object.payload.type !== 'group' || !object.parentId || object.scale === undefined) {
    throw new Error(`bad group ${object.id}`);
  }
  return {
    id: object.id,
    parent: object.parentId,
    x: object.x,
    y: object.y,
    scale: object.scale,
    visibility: { minScale: object.visibility.minScale, maxScale: object.visibility.maxScale },
  };
}

function nodeRecord(node: HierarchyNode, byId: Map<string, CanvasObject>): PresentedNode {
  const object = required(byId, node.id);
  const payload = object.payload;
  if (payload.type !== 'image' && payload.type !== 'shape') throw new Error(`${node.id} is not a picture`);
  const label = byId.get(`${node.id}-label`);
  const link = byId.get(`${node.id}-link`);
  if (!object.fade) throw new Error(`${node.id} has no fade`);
  if (label) assertCompanion(object, label);
  if (link) {
    if (link.visibility.minScale !== object.visibility.minScale || link.visibility.maxScale !== object.visibility.maxScale) {
      throw new Error(`${node.id} link visibility`);
    }
    if (link.payload.type !== 'link') throw new Error(`${node.id} link`);
  }
  const kind: HierarchyKind = node.kind;
  const status: HierarchyStatus = node.status;
  return {
    id: node.id,
    name: node.name,
    parent: node.parentId,
    kind,
    status,
    sizeMm: node.sizeMm,
    count: node.countMark,
    ...(object.repeat ? { repeat: object.repeat } : {}),
    image: payload.type === 'image' ? payload.src : null,
    place: {
      parent: object.parentId ?? null,
      x: object.x,
      y: object.y,
      width: payload.width,
      height: payload.height,
      ...(object.z !== undefined ? { z: object.z } : {}),
      ...(object.scale !== undefined ? { scale: object.scale } : {}),
    },
    visibility: { minScale: object.visibility.minScale, maxScale: object.visibility.maxScale },
    fade: fadeRecord(object.fade),
    label: label ? labelRecord(label) : null,
    link:
      link && link.payload.type === 'link'
        ? { id: link.id, from: link.payload.from, to: link.payload.to }
        : null,
  };
}

function assertCompanion(node: CanvasObject, label: CanvasObject): void {
  if (label.payload.type !== 'text') throw new Error(`${label.id} is not text`);
  if (label.visibility.minScale !== node.visibility.minScale || label.visibility.maxScale !== node.visibility.maxScale) {
    throw new Error(`${label.id} visibility`);
  }
  if (stable(label.fade) !== stable(node.fade)) throw new Error(`${label.id} fade`);
}

function labelRecord(object: CanvasObject): PresentedLabel {
  if (object.payload.type !== 'text') throw new Error(object.id);
  return {
    id: object.id,
    text: object.payload.text,
    parent: object.parentId ?? null,
    x: object.x,
    y: object.y,
    width: object.payload.width,
    height: object.payload.height,
    fontSize: object.payload.style.fontSize,
    ...(object.scale !== undefined ? { scale: object.scale } : {}),
  };
}

function fadeRecord(fade: ZoomFade): PresentedFade {
  const record: PresentedFade = {};
  if (fade.fadeOut) record.fadeOut = [fade.fadeOut[0], fade.fadeOut[1]];
  if (fade.fadeIn) record.fadeIn = [fade.fadeIn[0], fade.fadeIn[1]];
  if (fade.fadeOutOf) record.fadeOutOf = fade.fadeOutOf;
  if (fade.fadeInOf) record.fadeInOf = fade.fadeInOf;
  return record;
}

function required(byId: Map<string, CanvasObject>, id: string): CanvasObject {
  const object = byId.get(id);
  if (!object) throw new Error(`missing ${id}`);
  return object;
}

function assertSame(expected: readonly CanvasObject[], actual: readonly CanvasObject[]): void {
  if (expected.length !== actual.length) {
    throw new Error(`object count ${actual.length} !== ${expected.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (!left || !right || stable(left) !== stable(right)) {
      throw new Error(`object ${left?.id ?? index} does not round-trip`);
    }
  }
}

function stable(value: unknown): string {
  return JSON.stringify(sortValue(JSON.parse(JSON.stringify(value ?? null))));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

export function writePresented(): void {
  const outPath = join(root, 'data/smartphone.json');
  const json = presentedJson();
  writeFileSync(outPath, json);
  const count = (JSON.parse(json) as PresentedFile).nodes.length;
  console.log(`wrote ${count} nodes to ${outPath}`);
}

if (isDirectRun()) writePresented();
