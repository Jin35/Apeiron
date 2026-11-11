import { createMemoryStore, mountShell } from '@apeiron/core';
import { bootPage } from './catalog';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
const statusEl = document.querySelector<HTMLElement>('#status');
const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in');
const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out');
const labels = document.querySelector<HTMLElement>('#labels');
if (!canvas || !statusEl || !zoomIn || !zoomOut || !labels) {
  throw new Error('Apeiron markup is missing');
}

const rect = canvas.getBoundingClientRect();
const boot = bootPage(
  window.location.search,
  rect.width > 0 ? rect.width : window.innerWidth,
  rect.height > 0 ? rect.height : window.innerHeight,
  import.meta.env.DEV,
);
mountShell(
  canvas,
  statusEl,
  zoomIn,
  zoomOut,
  createMemoryStore(boot.pack.objects),
  labels,
  boot.theme,
  boot.limits,
  boot.opening,
);
