# Apeiron

Apeiron is a map-like pan and zoom canvas. This first cut is the shared object model, a Canvas 2D renderer, full-screen camera gestures, and a small depth atlas you can pan and zoom. Semantic level-of-detail comes later; objects already appear and fade by zoom.

Rendering stays on Canvas 2D so the model and camera are not tied to a scene graph.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run preview
```

On a phone-width window the opening scale is a little smaller so the title fits; desktop stays at `0.1`. Zooming in with + from that view walks the band under the title: Central Sound, then the field recorder. `?scale=2&x=-3012&y=-1112` opens on Old Wharf instead. `scale` is clamped to the same limits as the zoom controls.

## Objects and depth

World **y grows downward**. The camera stores the world point at the center of the screen and a **scale** in CSS pixels per world unit. Pan is unbounded. Zoom is clamped to `1e-4–1e7` so you can move past every band; the clamp is not a world edge.

Each object has:

- `id`
- `x`, `y` — world coordinates, or parent-local when `parentId` is set
- `visibility: { minScale, maxScale }` — its depth
- a payload: `text` (string, font size, color, style, and world width and height) or `image` (`src` plus world width and height)

An object is drawn only while `minScale <= camera.scale <= maxScale`. Opacity fades across a short band at each edge, measured in log scale (about a 35% zoom, or half the range when the range is narrower), so bands hand off instead of popping. Zooming in past `maxScale` hides coarse labels. Zooming out past `minScale` hides fine ones. Font size and image size are world units, so they grow as you zoom until that band ends. A later pass can swap one object for richer children that use a tighter range; the range is the hook.

The demo nests four bands. They overlap so the map is never empty between them:

| Band | Camera scale | What you see |
| --- | --- | --- |
| Overview | 0.02 – 0.30 | Archipelago and shelf names |
| Region | 0.16 – 2.2 | Harbors, dunes, compass, atoll |
| Place | 0.95 – 8 | Wharf, tower, phone, observatory |
| Detail | 5 – 64 | Bollard, buoy, lens cap, sample tray |

The readout is `×scale · N visible`. N counts objects inside the current zoom band, including ones outside the viewport. The grid spacing also changes with zoom so empty space still shows the camera moving.

## Gestures

The canvas is a full-screen map, in the greedy sense of the Google Maps app: it captures wheel and touch instead of letting the page scroll. Rotation is off. Objects are not selectable or draggable; only the camera moves.

- **Mouse:** drag pans, wheel zooms toward the cursor, on-screen +/− zoom about the center.
- **Trackpad:** click-drag pans. Two-finger scroll and pinch zoom toward the pointer. Scroll does not pan.
- **Multitouch:** one-finger drag pans, pinch zooms (finger translation pans, angle is ignored), double-tap zooms in, two-finger tap zooms out.
- **Single touch:** drag pans, double-tap zooms in, +/− cover the rest.

Mouse double-click does not zoom. + and − step by 2×, and each step interpolates scale over 150ms. Scroll, pinch, and tap zoom stay immediate.

## GitHub Pages

The demo is meant to be hosted at **https://jin35.github.io/Apeiron/**

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) does two jobs:

- **Every pull request, and every push to `main`:** `npm ci`, typecheck, lint, test, and build.
- **Push to `main` only** (including a merge): upload `dist/` and deploy with GitHub Actions Pages. Pull requests do not deploy.

The Vite `base` is `./`, so the same build works locally and under the `/Apeiron/` project path.

**This repository is public.** Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** (the workflow does not flip that setting itself). The deploy job publishes `dist/` on each push to `main`.
