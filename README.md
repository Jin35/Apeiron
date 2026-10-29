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

The default pack is Smartphone. On the archipelago atlas (`?pack=archipelago`), a phone-width window opens a little further out so the title fits; desktop stays at `0.1`. Zooming in with + from that view walks the band under the title: Central Sound, then the field recorder. `?scale=2&x=-3012&y=-1112` opens on Old Wharf instead. `scale` in the query is clamped to `1e-4–1e7`. Gestures and the +/− controls also stay inside the content: you cannot zoom out past the fit of the atlas, or pan the map off the screen. `?theme=paper` previews the paper theme on this atlas while `npm run dev` is running; a production build ignores it. The paper theme draws no grid.

## Objects and depth

World **y grows downward**. The camera stores the world point at the center of the screen and a **scale** in CSS pixels per world unit. Pan keeps that centre inside the content, and centres the content when it is smaller than the window. Zoom is clamped to the content as well, and never outside `1e-4–1e7`. The global clamp is not a world edge.

Each object has:

- `id`
- `x`, `y` — world coordinates, or parent-local when `parentId` is set
- `visibility: { minScale, maxScale }` — its depth
- a payload: `text` (string, font size, optional color, style, and world width and height) or `image` (`src` plus world width and height)

An object is drawn only while `minScale <= camera.scale <= maxScale`. Opacity fades across a short band at each edge, measured in log scale (about a 35% zoom, or half the range when the range is narrower), so bands hand off instead of popping. Zooming in past `maxScale` hides coarse labels. Zooming out past `minScale` hides fine ones. Font size and image size are world units, so they grow as you zoom until that band ends. A later pass can swap one object for richer children that use a tighter range; the range is the hook.

The demo nests four bands. They overlap so the map is never empty between them:

| Band | Camera scale | What you see |
| --- | --- | --- |
| Overview | 0.02 – 0.30 | Archipelago and shelf names |
| Region | 0.16 – 2.2 | Harbors, dunes, compass, atoll |
| Place | 0.95 – 8 | Wharf, tower, phone, observatory |
| Detail | 5 – 64 | Bollard, buoy, lens cap, sample tray |

The readout is `×scale · N visible`. N counts objects inside the current zoom band, including ones outside the viewport. On the dark theme the grid spacing changes with zoom so empty space still shows the camera moving. The paper theme draws no grid.

## Gestures

The canvas is a full-screen map, in the greedy sense of the Google Maps app: it captures wheel and touch instead of letting the page scroll. Rotation is off. Objects are not draggable; only the camera moves. A click or a settled tap selects the object under the pointer.

- **Mouse:** drag pans, wheel zooms toward the cursor, on-screen +/− zoom about the center.
- **Trackpad:** click-drag pans. Two-finger scroll and pinch zoom toward the pointer. Scroll does not pan.
- **Multitouch:** one-finger drag pans, pinch zooms (finger translation pans, angle is ignored), double-tap zooms in, two-finger tap zooms out.
- **Single touch:** drag pans, double-tap zooms in, +/− cover the rest.
- **Keyboard:** arrow keys pan about a tenth of the view. `+` and `=` zoom in, `-` zooms out, by the same 2× step as the buttons. Those keys do nothing in a text field, or while Ctrl, Alt, or ⌘ is held.

Mouse double-click does not zoom. + and − step by 2×, and each step interpolates scale over 150ms. A reduced-motion setting skips that blend. Scroll, pinch, and tap zoom stay immediate.

## GitHub Pages

The demo is meant to be hosted at **https://jin35.github.io/Apeiron/**

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) does two jobs:

- **Every pull request, and every push to `main`:** `npm ci`, typecheck, lint, test, and build.
- **Push to `main` only** (including a merge): upload `dist/` and deploy with GitHub Actions Pages. Pull requests do not deploy.

The Vite `base` is `./`, so the same build works locally and under the `/Apeiron/` project path.

**This repository is public.** Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** (the workflow does not flip that setting itself). The deploy job publishes `dist/` on each push to `main`.
