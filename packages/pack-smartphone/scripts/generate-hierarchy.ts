/**
 * Read smartphone-hierarchy.md and data/overrides.json, pack the tree, and
 * write data/smartphone.json. Run from the repo root: `npm run generate`.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CanvasObject, ZoomFade } from '@apeiron/core';
import type { HierarchyKind, HierarchyNode, HierarchyStatus } from '../src/hierarchy';
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
    return {
      id,
      name,
      parentId,
      kind,
      status,
      sizeMm,
      countMark: countMark(field('Count')),
    };
  });
}

/** Twelve significant figures, matching the sizes the layout has always packed. */
function roundedSize(value: number): number {
  if (Number.isInteger(value)) return value;
  return Number(value.toPrecision(12));
}

function countMark(count: string): string | null {
  if (/^(1\b|Not applicable|One representative|Typically one)/i.test(count)) return null;
  const leading = /^(~?[0-9]+(?:\.[0-9]+)?)\s+(billion|million|thousand)\b/i.exec(count);
  if (leading?.[1] && leading[2]) return `×${leading[1]} ${leading[2].toLowerCase()}`;
  return null;
}

export function presentedJson(): string {
  const nodes = readNodes();
  const overrides = readOverrides();
  const scene = place(nodes, overrides);
  const file = presentFile(scene, overrides, nodes);
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
  if (nodes.length !== 188) throw new Error(`expected 188 nodes, parsed ${nodes.length}`);
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

function place(nodes: readonly HierarchyNode[], overrides: Overrides): { objects: CanvasObject[]; report: ReturnType<typeof layoutTree> } {
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
  const laidOut = layoutTree(nodes, built, {
    reveal: REVEAL,
    hosts,
    policies,
    art,
    band: overrides.band,
  });
  return { objects: [...built, ...laidOut.objects], report: laidOut };
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
