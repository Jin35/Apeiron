import type { CanvasObject, ZoomFade } from '@apeiron/core';
import type { HierarchyNode } from './hierarchy';
import type { PresentedFade, PresentedFile } from './presented';

/** Hierarchy rows in file order, taken from the presented nodes. */
export function hierarchyFromPresented(file: PresentedFile): readonly HierarchyNode[] {
  return file.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    parentId: node.parent,
    kind: node.kind,
    status: node.status,
    sizeMm: node.sizeMm,
    countMark: node.count,
  }));
}

/**
 * Canvas objects in paint order. Groups, then each node's picture, label, and link.
 * Positions are the ones stored on the node. Nothing is packed here.
 */
export function objectsFromPresented(file: PresentedFile): CanvasObject[] {
  const byId = new Map<string, CanvasObject>();
  for (const group of file.groups) {
    byId.set(group.id, {
      id: group.id,
      parentId: group.parent,
      x: group.x,
      y: group.y,
      scale: group.scale,
      visibility: { minScale: group.visibility.minScale, maxScale: group.visibility.maxScale },
      payload: { type: 'group' },
    });
  }
  for (const node of file.nodes) {
    const fade = rangesOf(node.fade);
    const visibility = { minScale: node.visibility.minScale, maxScale: node.visibility.maxScale };
    byId.set(node.id, {
      id: node.id,
      x: node.place.x,
      y: node.place.y,
      ...(node.place.z !== undefined ? { z: node.place.z } : {}),
      ...(node.place.parent ? { parentId: node.place.parent } : {}),
      ...(node.place.scale !== undefined ? { scale: node.place.scale } : {}),
      visibility,
      ...(fade ? { fade } : {}),
      labelId: `${node.id}-label`,
      payload: node.image
        ? { type: 'image', src: node.image, width: node.place.width, height: node.place.height, frame: false }
        : { type: 'shape', kind: node.kind, width: node.place.width, height: node.place.height },
    });
    if (node.label) {
      const label = node.label;
      byId.set(label.id, {
        id: label.id,
        ...(label.parent ? { parentId: label.parent } : {}),
        x: label.x,
        y: label.y,
        ...(label.scale !== undefined ? { scale: label.scale } : {}),
        visibility,
        ...(fade ? { fade } : {}),
        payload: {
          type: 'text',
          text: label.text,
          style: { fontSize: label.fontSize },
          width: label.width,
          height: label.height,
        },
      });
    }
    if (node.link) {
      byId.set(node.link.id, {
        id: node.link.id,
        x: 0,
        y: 0,
        visibility,
        payload: { type: 'link', from: node.link.from, to: node.link.to },
      });
    }
  }
  return file.order.map((id) => {
    const object = byId.get(id);
    if (!object) throw new Error(`presented data has no object ${id}`);
    return object;
  });
}

function rangesOf(fade: PresentedFade): ZoomFade | undefined {
  const result: ZoomFade = {};
  if (fade.fadeOut) result.fadeOut = [fade.fadeOut[0], fade.fadeOut[1]];
  if (fade.fadeIn) result.fadeIn = [fade.fadeIn[0], fade.fadeIn[1]];
  if (fade.fadeOutOf) result.fadeOutOf = fade.fadeOutOf;
  if (fade.fadeInOf) result.fadeInOf = fade.fadeInOf;
  if (!result.fadeOut && !result.fadeIn) return undefined;
  return result;
}
