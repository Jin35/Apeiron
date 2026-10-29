# Architecture

Target: three layers plus a thin shell. The shell is `src/main.ts`, and it is the only module that knows the other three. This is the design to reach. The code today is the section under Current state.

The live **camera** and, later, the **selection** are session state, owned by the shell. `src/camera.ts` stays the shared value (`Camera`, `ViewBounds`, scale clamp, pan/zoom math). The store, the renderer, and the gesture recognizer do not keep a camera of their own.

Content (objects, positions, zoom ranges, future notes) lives in the store. Pixels live in the renderer. Pointer and button input lives in the interaction layer, which emits commands. The shell applies a command to the session, queries the store, and hands the renderer a camera plus the visible set.

World **y grows downward**. `Camera.scale` is CSS pixels per world unit. `MIN_SCALE` / `MAX_SCALE` (`0.012–80`) are camera limits, not a world edge. An object's `visibility` range is content and may extend past those limits.

## Current state

| Module | What it does |
| --- | --- |
| `src/model.ts` | `CanvasObject`, `VisibilityRange`, text and image payloads. Data only. |
| `src/camera.ts` | `Camera`, `clampScale`, `panBy`, `zoomAt`, `retarget`, `worldPoint`, `viewBounds`. Pure functions. |
| `src/visibility.ts` | `visibilityAlpha`. Log-scale fade at each end of a range (`LOG_FADE`, about 35% zoom). |
| `src/grid.ts` | `gridStep`. Screen-targeted grid spacing. Used only by the renderer. |
| `src/demo.ts` | The atlas (`demoObjects`) and the opening camera (`initialCamera`, `initialCameraFor`). |
| `src/render.ts` | Canvas 2D. `createRenderer` / `draw`. |
| `src/gestures.ts` | Maps-greedy pointer, wheel, and Safari gesture handling. `attachGestures` calls a `GestureHost`. |
| `src/buttonZoom.ts` | The 150ms +/− animation. Holds the camera that is on screen. |
| `src/main.ts` | Builds a camera, draws every object, counts the band, listens to resize, updates the HUD. |

Gesture behavior itself is in the README. This document is only the seams.

`demoObjects` is a const array, and every consumer walks it. There is no store type and no single frame scheduler. `publish` in `main.ts` draws synchronously. `requestAnimationFrame` runs only while a button-zoom segment is queued (`pumpButtonZoom`).

### Coupling

**The renderer is given every object and decides visibility itself.** `publish` calls `renderer.draw(camera, demoObjects)`. `draw` runs `visibilityAlpha` and skips `alpha <= 0.01`, then paints. The same function is the HUD's definition of visible: `countVisible` counts `alpha > 0.02`, including objects outside the viewport. The two cutoffs differ, so the readout and the picture can disagree near a fade edge. `src/demo.test.ts` walks the array a third time, at `alpha > 0`.

**Nothing culls to the viewport.** `viewBounds` is used only by `drawGrid`. Objects have no stored bounds. `drawTextObject` learns a label's size at paint time, from the font, and discards it. `drawImageObject` uses payload width and height and does not test them against the view. `draw` also calls `imageFor` on every image in the array before the alpha test, so off-band images are fetched on the first frame.

**The displayed camera has a second home.** `camera.ts` can compute the next camera and stores nothing. The value `publish` actually draws is `zoomAnim.camera`, a `ButtonZoom` created in `main.ts`. `pressButtonZoom` / `tickButtonZoom` own the 150ms log-scale interpolation and the queue of steps. `committedCamera` is the queued target; the HUD disables +/− from that scale, while the readout uses the scale on screen.

**Input reaches that value through two dialects.** `GestureHost` (`gestures.ts`) is `panBy`, `zoomAt`, and `retarget` in client coordinates. The `attachGestures` callback in `main.ts` converts zoom points with `localPoint` and calls `panBy` / `zoomAt` / `retarget` from `camera.ts`. A +/− click does not go through `GestureHost`. `zoomFromCenter` calls `pressButtonZoom`, which calls `zoomAt` at the canvas center. A gesture cancels an in-flight button zoom by `replaceCamera`, which discards the `ButtonZoom` and builds a new one around the camera on screen. `cancelButtonZoom` implements that discard and is covered by `buttonZoom.test.ts`, but `main.ts` does not call it. Wheel, double-tap, two-finger tap, and Safari `gesturechange` all use `zoomAt`. A two-pointer drag uses `retarget` so the pinch center pans. Those stay different operations.

**The viewport is measured in three places.** `Renderer.size` reads the canvas rect inside `draw` and resizes the bitmap from `devicePixelRatio`. `localPoint` and `zoomFromCenter` each call `getBoundingClientRect` again. `draw` applies the camera transform itself (`translate` to center, `scale`, `translate` by `-camera`).

**Scheduling is part of `publish`.** Startup, each gesture sample, each resize, and each image `onload` / `onerror` call `publish`. The image callback is the renderer's `onReady`, wired as `() => publish()`. `publish` has a `drawing` / `pending` flag because that callback can re-enter `draw`. Button zoom is a second loop: `pumpButtonZoom` ticks, publishes, and reschedules itself while `segments.length > 0`.

**Bootstrap is split across content and the shell.** `initialCameraFor` lives next to the atlas and takes a view width. `cameraFromLocation` in `main.ts` then overrides it from `?scale=&x=&y=`, clamped with `clampScale`. The store's future seed data and the session's opening camera are one module today.

`model.ts`, `camera.ts`, `grid.ts`, and the gesture recognizer are already close to the right shape. `GestureHost` does not import the camera, the atlas, or the renderer. The shell on the far side of that interface, the missing store, and `draw`'s full-array contract are the problem.

## Target

Dependencies point inward, toward `model.ts` and `camera.ts`. The three layers do not import each other.

```
main.ts
  ├── store.ts         → model.ts, camera.ts (ViewBounds), visibility.ts
  ├── render.ts        → model.ts, camera.ts (Camera, viewBounds for the grid), grid.ts
  ├── interaction.ts   → gestures.ts, CameraCommand (type-only, from camera.ts)
  └── buttonZoom.ts    → camera.ts (zoomAt). Shell holds the value and ticks it.
```

`store.ts`, `render.ts`, and `interaction.ts` do not import each other. `visibility.ts` is reached only from the store. `grid.ts` is reached only from the renderer. `buttonZoom.ts` stays a pure reducer over a `ButtonZoom` value. It is session animation, not a gesture recognizer, and it does not schedule frames.

### Store

The store answers world-space questions. It does not know the DOM, the camera owner, or how pixels are produced. The shell turns the session camera into a query with `viewBounds`.

```ts
type SceneQuery = {
  bounds: ViewBounds;
  scale: number;
};

type VisibleObject = {
  object: CanvasObject;
  /** Result of visibilityAlpha at the query scale. */
  alpha: number;
};

interface SceneStore {
  /** In band, on screen, alpha above the draw cutoff (0.01 today). */
  query(query: SceneQuery): VisibleObject[];
  /** In band, anywhere in the world, alpha above the HUD cutoff (0.02 today). */
  countInBand(scale: number): number;
  /** Every image src in the dataset. The shell warms the renderer from this. */
  imageSources(): readonly string[];
  /** Later. World point comes from worldPoint in the shell. */
  hitTest(query: SceneQuery, worldX: number, worldY: number): CanvasObject | null;
}
```

`query` returns an unsorted set. Paint order is a renderer choice: today's `draw` sorts by `visibility.maxScale` ascending, so coarser bands sit under finer ones. A replacement renderer keeps that sort.

The two alpha cutoffs stay explicit on the two methods. Unifying them would change the readout or the fade, which is a product change, separate from the split.

LOD fade stays in `visibilityAlpha`. Callers outside the store receive the alpha already computed. `query` stays synchronous: a chunked or remote store answers from what is resident and asks the shell to draw again when a load arrives. The renderer does not await.

Hierarchical notes and nested detail are store data: a parent id, a body, a tighter `visibility` on the children. `query` keeps returning the flat visible set at this scale. Adding a payload variant (a note, a richer child) is the one change that also touches `model.ts` and whichever renderer paints that variant. A spatial index, a worker cache, or a remote backend does not.

### Renderer

The renderer paints one frame. It does not walk the dataset, run `visibilityAlpha`, attach listeners, or mutate the camera.

```ts
type RenderFrame = {
  camera: Camera;
  /** CSS pixels. The shell measured the canvas once this frame. */
  width: number;
  height: number;
  visible: readonly VisibleObject[];
  /** Set when selection exists. Absent until then. */
  selectedId?: string;
};

interface Renderer {
  draw(frame: RenderFrame): void;
  /** Fetch image bytes. Drawing does not depend on the fetch having finished. */
  warm(srcs: readonly string[]): void;
}
```

`createRenderer(canvas, onReady)` stays. `onReady` means "an async resource finished," and the shell schedules a frame. It is not a draw call. Bitmap size and `devicePixelRatio` stay inside the renderer. The grid stays inside the renderer; `viewBounds` there is only for grid lines.

Image decode stays in the renderer. The shell calls `renderer.warm(store.imageSources())` so the first frame still requests every image, which is what `draw` does today by calling `imageFor` before the alpha test. Dropping eager loads is a later store-side prefetch, after the seam exists.

`CanvasObject` payloads are plain data, so a worker or WebGL renderer can take the same `RenderFrame` without a callback into the store.

### Interaction

Interaction turns input into commands. It does not read objects, draw, or hold the camera. Coordinates on a command are canvas-local CSS pixels, the space `panBy` / `zoomAt` / `retarget` already use. The client-to-local conversion that `localPoint` does today moves here, next to the element.

```ts
type CameraCommand =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'zoomAt'; x: number; y: number; factor: number }
  | { type: 'retarget'; anchor: ScreenPoint; target: ScreenPoint; factor: number }
  | { type: 'zoomStep'; factor: number }; // +/− , animated, anchored at the view center

type SceneCommand =
  | { type: 'selectAt'; x: number; y: number }
  | { type: 'nudge'; id: string; dx: number; dy: number };

function attachInteraction(
  elements: { canvas: HTMLElement; zoomIn: HTMLElement; zoomOut: HTMLElement },
  emit: (command: CameraCommand) => void,
): () => void;
```

`SceneCommand` is the selection/editing extension. It is not part of the seam work below. The shell handles it by calling `store.hitTest` and keeping `selectedId` next to the camera. The renderer only sees `selectedId` on the frame.

`attachGestures` can remain the recognizer under this adapter. Its detach function removes the `window` `wheel` and Safari `gesture*` listeners as well as the canvas listeners; `attachInteraction` returns that cleanup. Wheel, taps, and Safari pinch still emit `zoomAt`. Two-pointer drags still emit `retarget`. `ZOOM_STEP` stays the interaction policy for taps and for `zoomStep`.

The shell applies a command:

- `panBy`, `zoomAt`, `retarget` run on the camera **on screen**, then `createButtonZoom` drops the queue. That is `replaceCamera` today.
- `zoomStep` calls `pressButtonZoom` from `committedCamera`, so a second click queues another 150ms step instead of resampling the in-between scale.

`applyCameraCommand` in `camera.ts` is the immediate half (delegate to `panBy` / `zoomAt` / `retarget`). The animated half stays `pressButtonZoom` / `tickButtonZoom`.

### Frame loop

The shell owns the only loop. One function paints:

1. `zoomAnim = tickButtonZoom(zoomAnim, now)`.
2. Measure the canvas once.
3. `visible = store.query({ bounds: viewBounds(camera, width, height), scale: camera.scale })`.
4. `renderer.draw({ camera, width, height, visible })`.
5. Write the HUD from `countInBand(camera.scale)` and from `formatScale`. Set `dataset.scale`, `dataset.x`, `dataset.y`.
6. Disable +/− from `committedCamera(zoomAnim)` against `MIN_SCALE` / `MAX_SCALE`.

Pointer and wheel commands call this function before the event handler returns, so a drag stays on the event that produced it. Button-zoom ticks, `ResizeObserver`, and image `onReady` call `invalidate`, which schedules one `requestAnimationFrame`. The `drawing` / `pending` flag goes away once those callbacks no longer call `draw` themselves. The first paint on startup stays synchronous.

## Replacing a layer later

**Store.** `createMemoryStore(demoObjects)` is the first implementation: a linear scan, then real bounds, then a scale bucket plus a quadtree per band. `query` / `countInBand` / `hitTest` stay the signatures above. Chunks and a remote backend sit behind a resident cache and call the shell's invalidate when data arrives. The renderer keeps drawing whatever `query` returned. Nested detail is more objects with tighter ranges, not a new render path.

**Renderer.** A WebGL or WebGPU `createRenderer` implements the same `draw(RenderFrame)`. Tile caches and worker rasterizers key off the camera and the visible ids, inside that module. They do not import `demoObjects`, `visibilityAlpha`, or `attachGestures`. Grid, plates, font outlines, and the bitmap backing stay presentation details of whichever renderer is plugged into the shell.

**Interaction.** Another recognizer, or a select/edit mode, emits `CameraCommand` and `SceneCommand`. Hit testing and object mutation stay in the store. The 150ms zoom stays `zoomStep` plus the pure `ButtonZoom` reducer, so a different control can emit the same command. Replacing the recognizer does not move the camera value.

## Refactor sequence

Each PR leaves the demo working and CI green (`typecheck`, `lint`, `test`, `build` in `.github/workflows/ci.yml`). There is no browser harness. Preserve the observable HUD: `×scale · N visible`, the three `dataset` fields, and +/− disabled from the committed scale. Preserve eager image fetches until a PR says otherwise. Existing unit tests stay; add tests at the new function.

1. **Memory store for the HUD.** Add `src/store.ts` with `createMemoryStore`, `countInBand` (`alpha > 0.02`), and `query` (`alpha > 0.01`, bounds ignored). `countVisible` delegates to `countInBand`. `draw` still receives `demoObjects`. Pixel output unchanged. `demo.test.ts` can keep calling `visibilityAlpha` directly to check atlas ranges.

2. **Renderer takes the visible set.** `draw` accepts `VisibleObject[]` and uses the given alpha. Delete the `visibilityAlpha` import from `render.ts`. Keep the `maxScale` sort in the renderer. Add `imageSources()` and call `renderer.warm` once from the shell, so off-band images still load on the first frame. `query` is what `publish` passes in.

3. **Immediate camera commands.** Add `CameraCommand` and `applyCameraCommand`. The gesture callback in `main.ts` builds a command and applies it. `replaceCamera` stays, so cancellation behavior does not change in this PR. Tests sit beside `camera.test.ts` and check `panBy`, `zoomAt`, and `retarget` against the existing functions.

4. **One cancel path.** Immediate commands apply to the on-screen camera and then `cancelButtonZoom` (equivalently `createButtonZoom` of that result). `zoomFromCenter` becomes a `zoomStep` command that calls `pressButtonZoom`. Delete `replaceCamera`. Queueing, the 150ms log blend, and "a gesture keeps the scale on screen" stay as `buttonZoom.test.ts` describes them.

5. **One `frame` function.** Move the body of `publish` into `frame`. Gestures call `frame` synchronously. `pumpButtonZoom`, the resize observer, and image `onReady` only `invalidate`. Startup still paints before the first input. The re-entry flag goes away with the direct callback into `publish`.

6. **Interaction adapter.** Add `attachInteraction`. It owns `attachGestures`, the +/− listeners, and client-to-local conversion, and it emits canvas-local commands. `main.ts` stops importing `panBy`, `zoomAt`, `retarget`, `ZOOM_STEP`, and `localPoint`. The shell applies commands, holds `zoomAnim`, and calls `frame`.

7. **Atlas data vs opening camera.** Move `initialCamera` and `initialCameraFor` out of `demo.ts` (a `bootstrap.ts` next to the shell, with `cameraFromLocation`). `demo.ts` exports `demoObjects` only. The shell constructs `createMemoryStore(demoObjects)`. Split `demo.test.ts` along that line.

8. **Spatial `query`.** Add conservative world bounds: images use the rect `drawImageObject` already uses; text uses an overestimate from `fontSize`, length, and letter-spacing, large enough that a label which would have been painted cannot fall outside the box. `query` intersects those boxes with `SceneQuery.bounds`. `countInBand` stays world-wide, matching the README (N includes off-screen objects in the band). A fixture object in-band and far outside the view is counted and absent from `query`. On-screen pixels stay. An index behind `query` can follow later without a renderer or gesture change.

After PR 8 the three layers meet only at `SceneStore.query` / `countInBand` / `imageSources`, `RenderFrame`, and `CameraCommand`, and only `main.ts` sits between them. `hitTest` and `SceneCommand` arrive with selection. WebGL, tile caches, and chunk loading are replacements behind those types, not further steps in this split.
