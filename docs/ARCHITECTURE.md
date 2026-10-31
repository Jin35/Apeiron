# Architecture

Three layers plus a thin shell. The shell is `src/main.ts`, and it is the only module that constructs the other three. The live **camera** and the **selection** are session state, owned by the shell. `src/camera.ts` stays the shared value (`Camera`, `ViewBounds`, scale clamp, pan/zoom math). The store, the renderer, and the gesture recognizer do not keep a camera of their own.

Content lives in the store. Pixels live in the renderer. Pointer, keyboard, and button input lives in the interaction layer, which emits commands. The shell applies a command to the session, queries the store, and hands the renderer a camera plus the visible set.

World **y grows downward**. `Camera.scale` is CSS pixels per world unit. `MIN_SCALE` / `MAX_SCALE` (`1e-4–1e7` in `camera.ts`) are the outer camera limits, not a world edge. A content pack may tighten them. An object's `visibility` range is content and may extend past those limits.

The first split is merged (PRs #5–#12). The sections through [First sequence](#first-sequence) describe that design as it stands in the tree. [Second review](#second-review) is the problem list behind [Next sequence](#next-sequence). That sequence is done.

## Current state

| Module | What it does |
| --- | --- |
| `src/model.ts` | `CanvasObject`, `VisibilityRange`, text, image, group, and link payloads. Data only. Optional `parentId` and `scale`. Optional `fade` (`fadeOut` / `fadeIn` over a ratio of a fit scale). A range names an anchor object when its ratio is that object's own opening fit instead of s0. Text carries world `width` and `height`. Text `color` is optional. Image `frame` is optional. A group is not drawn. A link stores `from` / `to` ids and an optional stroke, not endpoint coordinates. |
| `src/camera.ts` | `Camera`, `clampScale`, `panBy`, `zoomAt`, `retarget`, `worldPoint`, `viewBounds`, `CameraCommand`, `applyCameraCommand`, `deriveCameraLimits`. Pure functions. Content limits are enforced in `applyCameraCommand`. `fitScale` on the resolved limits is the opening fit (s0). |
| `src/visibility.ts` | `visibilityAlpha`. Log-scale fade at each end of a range (`LOG_FADE`, about 35% zoom). The store uses it for queries. The renderer uses it for a leader line's endpoint alpha. |
| `src/fade.ts` | `relativeZoomAlpha`, `displayOpacity`. Linear in `scale / reference`. The reference is the opening fit, or an anchor object's own opening fit when the range names one. The renderer multiplies it onto the visibility alpha. The store uses the same curve for `query`, `countInBand`, and `hitTest`. |
| `src/levelFade.ts` | `buildLevelPlan`. When the camera enters a part that has a next level (`fadeInOf` names it), that part and every sibling with the same `parentId` fade out over the children's fade-in range. The active part is the entered portal nearest the viewport centre; an equal distance uses the smaller id. Ancestor portals stay applied, and a same-level portal that is further along cannot be undone by panning onto a less-faded neighbour. Descendants are not siblings. Links are not in the plan: the renderer keeps the lower endpoint opacity. |
| `src/grid.ts` | `gridStep`. Screen-targeted grid spacing. Reached only from the renderer. |
| `src/link.ts` | `clipLeaderLine`, `resolveWorldRect`. Pure. The segment between two centres, clipped to the rectangles, then shortened by a gap in the same units. Overlapping bounds return nothing. `resolveWorldRect` walks `parentId` and `scale`. |
| `src/store.ts` | `createMemoryStore`. `query`, `countInBand`, `imageSources`, `subscribe`, `hitTest`, `contentBoxes`, `resident`. `replaceObjects` rebuilds world-space entries from parent-local `x`/`y` and notifies. A parent's `scale` multiplies descendant positions and sizes. A group is not an entry. A link is not an entry either: no box, no hit, no HUD count. A missing parent or a cycle is omitted. Text and image boxes are the authored rect plus the screen-pixel pad. `hitTest` uses that rect without the pad, at the draw cutoff, and the greater `maxScale` wins. A zoom fade to alpha 0 is below that cutoff. `contentBoxes` is the unpadded world box after that flattening. `resident` is the authored list the renderer resolves links from. |
| `src/theme.ts` | `Theme`, `darkTheme`, `paperTheme`. A content pack is `{ theme, objects, limits? }`. `grid` is optional; the paper theme omits it. |
| `src/gestures.ts` | Maps-greedy pointer, wheel, and Safari gesture handling. `attachGestures` calls a `GestureHost` in client coordinates. A mouse click and a touch tap that stays single for `DOUBLE_TAP_MS` call `selectAt`. |
| `src/interaction.ts` | `attachInteraction`. Owns the recognizer, the +/− buttons, keyboard pan and zoom, and client-to-local conversion. Emits canvas-local `SceneCommand`s (`CameraCommand` or `selectAt`). Arrow keys and `+`/`−` reuse `CameraCommand`. |
| `src/buttonZoom.ts` | The 150ms +/− animation. Pure reducer. The shell holds the `ButtonZoom` value and ticks it. A reduced-motion `zoomStep` settles on the committed camera with no segments. |
| `src/bootstrap.ts` | `initialCamera`, `initialCameraFor(viewWidth, titleWorldWidth)`, `cameraFromLocation`. Session opening camera, separate from the atlas. The archipelago title fit lives here. |
| `src/render.ts` | `createRenderer`, `draw(RenderFrame)`. Canvas 2D, image cache, grid, plates, leader lines. Colors and fonts come from the frame's `theme` (the demo dark theme when it is omitted). Text is fitted into its authored box. A `selectedId` strokes that object's box in screen pixels. An image with `frame: false` is drawn without the plate fill or hairline. Zoom fade is applied from `frame.fitScale`; the sibling handover multiplies the same opacity the store uses. Alpha 0 is not drawn. A link is stroked from `frame.objects` each frame: screen-pixel width, gap outside each endpoint box, alpha the minimum of the two endpoints. No pack is special-cased. |
| `src/demo.ts` | `demoPack` (`darkTheme` and `demoObjects`) and the title fit width. Thirty objects, six images, four overlapping bands. Secondary pack, `?pack=archipelago`. |
| `content/smartphone.ts` | `smartphonePack`: `paperTheme`, the front view, and the parts in millimetres on an `internals` group parented to `phone`. The group's scale is `0.625`. The front fades out over relative zoom `1` to `1 / 0.625`; the parts fade in over the same range. Each part has a label on that group and a link to the part. `battery-internals`, parented to `battery` at the same scale, holds the cell and the protection board. Those, and their labels, fade in over `1` to `1 / 0.625` of the battery's opening fit (`fadeInOf: 'battery'`). The platform then fades the whole parts level — every sibling part, label, and, through the endpoints, leader — out over that same range. |
| `content/packs.ts` | `resolvePack`, `openingCameraFor`, `bootFromLocation`. Default id is `smartphone`. |
| `src/main.ts` | `mountShell`. One `frame`, one `invalidate`, applies commands, writes the HUD and a visually hidden label list from the frame's `query`. Session `selectedId` is on the frame and on `dataset.selected`. `prefers-reduced-motion: reduce` settles `zoomStep` in one frame. Each frame derives camera limits from `contentBoxes` and the viewport, with the pack override on top. The page boots `smartphonePack`. |

`store.ts`, `render.ts`, and `interaction.ts` do not import each other. `frame` in `mountShell` is the only paint. Gestures call it before the handler returns. Button zoom, `ResizeObserver`, image `onReady`, and the store subscription call `invalidate`, which schedules one `requestAnimationFrame`. Startup paints synchronously. `mountShell` takes an optional store, an optional theme, optional camera limits, and an optional opening camera. Callers that omit them still get the archipelago fixture. The page boots the smartphone pack: `paperTheme`, the phone and its parts, and an opening camera that fits it. Each frame passes that fit scale into `query`, `countInBand`, `hitTest`, and `draw`. `?pack=archipelago` loads the demo pack in dev and production and keeps the title fit. The shell writes the theme into CSS custom properties for the page, HUD, and buttons, and into the `theme-color` meta, and passes the same object on the frame. `style.color` overrides the theme ink. `grid` omitted means the renderer draws no grid. `?theme=paper` on the dev server previews `paperTheme` on the atlas. `applyButtonZoomCommand` is the one cancel path: an immediate command runs on the camera on screen and drops the queue; `zoomStep` queues a 150ms step from `committedCamera`, unless `prefers-reduced-motion: reduce` matches, in which case that step settles in the next frame. Both paths pass the same resolved limits into `applyCameraCommand`, which clamps scale before position. Limits are derived again on every frame, so `replaceObjects` and a viewport resize are in effect before the next command and before +/− enablement updates. The opening camera is not rewritten on the first paint.

### Contracts that are actually in the tree

```ts
type SceneQuery = { bounds: ViewBounds; scale: number; fitScale?: number };

interface SceneStore {
  query(query: SceneQuery): VisibleObject[];       // display alpha > 0.01, viewport cull
  countInBand(scale, fitScale?): number;           // display alpha > 0.02, whole world
  imageSources(): readonly string[];               // srcs of the resident objects
  subscribe(onChange: () => void): () => void;     // resident set changed
  hitTest(worldPoint, camera, fitScale?): CanvasObject | null; // display alpha > 0.01, unpadded box
  contentBoxes(): ContentBox[];                    // placed world boxes, for camera limits
  resident(): readonly CanvasObject[];             // authored objects; links keep from/to ids
}

type SceneCommand = CameraCommand | { type: 'selectAt'; x: number; y: number };

interface MemoryStore extends SceneStore {
  replaceObjects(objects: readonly CanvasObject[]): void; // rebuild entries, then notify
}

type RenderFrame = {
  camera: Camera;
  width: number;
  height: number;
  visible: readonly VisibleObject[];
  selectedId?: string;                             // shell session; stroked when that object is drawn
  theme?: Theme;                                   // pack look; omitted frame uses the demo dark theme
  fitScale?: number;                               // opening fit (s0); zoom fade is scale / fitScale
  objects?: readonly CanvasObject[];               // authored; leader endpoints resolve from these
};

interface Renderer {
  draw(frame: RenderFrame): void;
}
```

`query` returns an unsorted set. `draw` sorts by `visibility.maxScale` ascending, so coarser bands sit under finer ones. The two alpha cutoffs stay on the two store methods. `VisibleObject` is declared in `store.ts` and repeated as a private type in `render.ts`, so the renderer does not import the store.

`hitTest` ignores the cull pad. `selectAt` is not an `applyCameraCommand` input; the shell resolves it with `worldPoint` and stores `selectedId`.

## Target

Dependencies point inward, toward `model.ts` and `camera.ts`.

```
main.ts
  ├── store.ts         → model.ts, camera.ts (ViewBounds), visibility.ts
  ├── render.ts        → model.ts, camera.ts, grid.ts, theme.ts
  ├── interaction.ts   → gestures.ts, CameraCommand (type-only). Emits SceneCommand.
  └── buttonZoom.ts    → camera.ts. Shell holds the value and ticks it.
```

LOD fade stays in `visibilityAlpha`. Callers outside the store receive the alpha already computed. `query` stays synchronous: a chunked or remote store answers from what is resident and asks the shell to draw again when a load arrives. The renderer does not await. That last sentence is the contract the second review still has to make callable. Today nothing on `SceneStore` can ask.

Hierarchical notes and nested detail are store data: a parent id, local placement, a tighter `visibility` on the children. `query` keeps returning a flat visible set. A spatial index, a worker cache, or a remote backend does not change `RenderFrame`. Replacing a layer means another `createMemoryStore` / `createRenderer` / `attachInteraction` behind the same types. `mountShell` is the plug point.

## First sequence

**Done.** Merged as PRs #5–#12. Each left the demo working and CI green (`typecheck`, `lint`, `test`, `build` in `.github/workflows/ci.yml`).

| Step | PR | Outcome |
| --- | --- | --- |
| 1. Memory store for the HUD | #5 | `createMemoryStore`, `countInBand` (`alpha > 0.02`), `query` (`alpha > 0.01`). |
| 2. Renderer takes the visible set | #6 | `draw(RenderFrame)` uses the given alpha. `warm` + `imageSources` keep the eager fetches. |
| 3. Immediate camera commands | #7 | `CameraCommand`, `applyCameraCommand`. |
| 4. One cancel path | #8 | Immediate commands cancel via `cancelButtonZoom`. `zoomStep` queues from the committed camera. |
| 5. One `frame` function | #9 | Gestures call `frame`. Button zoom, resize, and `onReady` call `invalidate`. |
| 6. Interaction adapter | #10 | `attachInteraction` emits canvas-local commands. |
| 7. Atlas vs opening camera | #11 | `demo.ts` is the atlas. `bootstrap.ts` is the opening camera. |
| 8. Spatial `query` | #12 | Conservative world boxes. `countInBand` stays world-wide. |

The three layers meet at `SceneStore`, `RenderFrame`, and `CameraCommand`. The next work is inside those layers and at the two places the split still cannot move: deep-zoom pixels, and content that is not a resident array.

## Second review

Read against `main` at the #12 tree. Order is what unblocks the product: a map-like canvas, a zoom range deep enough for a phone, then a chip, then a transistor, educational topics first, hierarchical notes on the same platform, web and mobile web before native.

### 1. The renderer bakes the world camera into a float32 transform

**Problem.** `draw` in `render.ts` does this and then paints at absolute world coordinates (`drawGrid` at `i * step`, `drawImageObject` at `object.x` / `object.y`, `drawTextObject` at the same point, font size in world units):

```ts
ctx.translate(viewW / 2, viewH / 2);
ctx.scale(camera.scale, camera.scale);
ctx.translate(-camera.x, -camera.y);
```

Browser Canvas 2D rasterizes that matrix in float32 (Chromium through Skia). Float32 has a 23-bit mantissa. The device-pixel translation is `camera.x * camera.scale`. At the demo's max zoom the picture is still sharp: the wharf sits near x = −3012 (`demo.ts`), scale 80, translation ≈ 2.4×10⁵, and the float32 ulp there is 0.016px. The phone plate is `place-phone` at (132, −60), 36×64 world units. A 70mm phone and a 50nm transistor are about 1.4×10⁶ apart, so the transistor is ~2.6×10⁻⁵ world units and wants scale ≈ 3×10⁶ to be ~80px on screen. At scale 10⁶ on that phone the translation is 1.32×10⁸ and the float32 ulp is 8px. At 10⁷ it is 128px. Grid lines and labels jump by that much while `panBy`, `zoomAt`, `viewBounds`, and `query` are still exact, because those run in float64.

`drawTextObject` sets `ctx.font` to a world `fontSize` and lets the same matrix scale it. The largest on-screen font in the current bands is about 185px (a region label at `maxScale` 2.2). A detail label of font size 2 at scale 10⁶ asks the browser for a 2×10⁶px font. `drawImage` of the 36-unit phone at that scale is a destination rect tens of millions of pixels wide. Visibility bands hide this in the demo because each object only lives for a few doublings. A parent plate that stays in band while you zoom into a child does not.

The other gate is in front of the matrix. `clampScale` refuses anything outside `0.012–80`, about 3.8 decades. The detail band already ends at 64. Raising the constants without changing `draw` moves the clamp into the range where the picture is garbage. `panBy` is unbounded, so a wide notes map hits the same wall without any deep zoom: at scale 80 the ulp reaches 1px near `|camera.x| ≈ 10⁵`. `cameraFromLocation` will open there for any finite `?x=`.

Float64 camera math is not the wall. At the phone's x = 132, a 1px pan is lost only around scale 10¹³. Flattening a parent chain into one world `x` loses a child when the local offset drops below the ulp of the parent's world position (ulp of 132 is ~3×10⁻¹⁴). That is past the transistor example. It becomes real if notes sit at large world x and then nest many levels.

**Impact.** This is what "practically unlimited zoom" breaks on. The store can return the right objects and the canvas still paints them on top of each other. It also blocks a notes canvas much wider than the demo atlas (± a few thousand today).

**Proposed change.** `draw` keeps the DPR transform only. Convert world to CSS pixels in float64, `(x - camera.x) * scale + view/2`, and pass those numbers to canvas. Font size and stroke width are CSS pixels (`fontSize * scale`, grid and plate strokes at `1` and `1.25`). A screen font above 512px is not submitted: the demo's fade-edge peak is about 185px, so current bands stay, and a label left in band across a deep zoom does not ask for a million-pixel font. The image **fill** is clipped to the viewport before `drawImage`, so a parent plate the camera is inside becomes a viewport-sized quad. The plate **frame** is stroked only on edges that actually cross the view. Shrinking the rect and then stroking it would draw a border along the screen edge that the plate does not have. Grid endpoints take the same conversion. Leave `MIN_SCALE` / `MAX_SCALE` alone in that change, then widen them in the next one.

### 2. A full-dataset image warm is what runs out of memory first

**Problem.** The atlas is 30 objects and 6 SVGs. `mountShell` calls `renderer.warm(store.imageSources())` before the first `frame`. `imageSources` returns every image payload in the array. `imageFor` puts each `HTMLImageElement` in a `Map` that only grows. `draw` also calls `imageFor` for a visible image, so a miss still fetches.

At the opening scale (`0.1`, or the fitted phone scale under `0.06`) no image is in band. Region images start at `minScale` 0.16. The first paint of the title still downloads and decodes all six. `render.test.ts` ("fetches warmed sources that this frame does not draw") locks that in.

`query` and `countInBand` are linear scans. A hundred times the atlas is 3,000 rows. Walking those twice per frame, including the `Math.log` in `visibilityAlpha`, stays well under a millisecond. Viewport culling means a 10× atlas spread across the world does not 10× the paint list. The cost that grows with the dataset, on the opening frame, before any of those objects is on screen, is `warm`. A decoded bitmap is `naturalWidth × naturalHeight × 4` bytes. The SVGs hide this. A 2048² plate is 16MB decoded. A few dozen educational photos (die shots, microscope fields) are enough to kill a mobile tab, which is the first client. The CPU cliff after that, if one band puts hundreds of labels in one view, is `drawTextObject`: `strokeText` plus `fillText` for every visible label, on the pointer path, because `applyCommand` calls `frame` before the handler returns. A quadtree behind `query` does not move either cliff. The comment on `createMemoryStore` is right that an index would not change what the renderer receives.

**Impact.** Real pictures break mobile web while the camera is still on the overview. The store scan is not the 10× or 100× limit.

**Proposed change.** Stop warming the dataset. Let `draw` fetch an image when a `query` result first contains it. Cap the `Map`: a small fixed size (32 decoded images is enough for this atlas many times over), dropping the least recently drawn image that has already settled (`complete`). Leave an image that has not fired `onload` / `onerror` yet, or the next frame restarts the download. `onReady` still means "decode finished, `invalidate`." Update the render test and the shell test that pokes `images[0].onload` at startup. There is no onload at the opening scale once the warm is gone; the test zooms into the region band first.

### 3. The store is a closed array, and image URLs cannot leave the site

**Problem.** `createMemoryStore` copies `objects` once and returns `query` / `countInBand` / `imageSources`. There is no `subscribe`, no `replaceObjects`, no revision. `invalidate` runs from the shell for resize, button zoom, and image `onReady` only. A chunk that arrives later has no function to call. `mountShell` constructs `createMemoryStore(demoObjects)` inline, so a test cannot hand it a store that fires either.

`publicUrl` in `render.ts` prefixes every src with `import.meta.env.BASE_URL` (`./` in `vite.config.ts`). `images/phone.svg` resolves. `https://…` becomes `./https://…`. A remote plate cannot be named in a payload.

`countInBand` means "every object in the world in this band," including off screen. That matches the HUD and the README. A store that has only loaded the phone's children would undercount and change the readout. Metadata is the cheap part: id, placement, visibility, bounds, parent. Image bytes and, later, note bodies are the heavy part. A textbook of nested topics is thousands of small records. Those can stay resident so the HUD and the cull keep their meaning. The bytes cannot.

**Impact.** "A remote backend behind `SceneStore`" is not a drop-in until the store can say that the resident set changed, and until a payload src can be an absolute URL. Building the client before that seam means the shell grows a special case.

**Proposed change.** Add `subscribe(onChange: () => void): () => void` and `replaceObjects(objects)` to the memory store. `replaceObjects` rebuilds the entries and notifies. The shell subscribes with `invalidate`. Give `mountShell` an optional store argument; production still constructs the demo store, and a unit test passes one, calls `replaceObjects`, flushes the frame, and sees the new count. In `publicUrl`, an `http:` or `https:` src is returned unchanged. `imageSources` stays "srcs of the resident objects," which after the warm change is a query for callers, not a startup fetch.

### 4. Text cull boxes re-implement the renderer's ink

**Problem.** Images carry `width` and `height`. Text does not. `textBox` and `letterSpacingWorld` in `store.ts` rebuild the ink `drawTextObject` might leave: `TEXT_ADVANCE_EM` (1.25), `TEXT_STROKE_EM` (0.055, the same factor as `lineWidth = fontSize * 0.055`), a hand-rolled `px|em|rem` parser, and "anything else is one em so the box stays outside the ink." `IMAGE_PAD_CSS_PX` matches the 1.25px stroke in `drawImageObject`. The parser is the most complicated function in the store, and it exists so a Canvas 2D detail does not drop a glyph. A WebGL renderer, a real `measureText`, or a remote client that does not ship this file will disagree with it. The boxes are an overestimate on purpose (`store.test.ts` covers the slop). They are the wrong shape for a hit target: a dense label would hit the padding.

`TITLE_WORLD_WIDTH = 6300` in `bootstrap.ts` is a second, quieter copy of the title. It is the hand estimate of `overview-title` ("THE ARCHIPELAGO", font size 520, `letterSpacing: '0.14em'`). `initialCameraFor` uses it so a phone-width window fits the title. `bootstrap.test.ts` repeats the number (`phone.scale * 6300 < 360`). The cull overestimate for that string is about 1.1×10⁴, so the fit width and the cull width are already different numbers. Changing the label does not change the fit.

**Impact.** The data layer cannot change representation, move to a worker, or grow a `hitTest` without taking the Canvas 2D font model with it. The phone opening camera drifts from the title with no type error.

**Proposed change.** Put world `width` and `height` on the text payload, centered on `(x, y)`, the same convention as images. For the demo, set them from today's `textBox` output so `query` membership stays. `query` intersects that box plus the existing one-CSS-pixel pad. Delete `letterSpacingWorld`, `TEXT_ADVANCE_EM`, and `TEXT_STROKE_EM`. Move `6300` to `demo.ts` next to `overview-title` as the fit width, and let `initialCameraFor(viewWidth, titleWorldWidth)` receive it. The phone scale stays. The cull width and the fit width remain two explicit numbers, beside the string they describe.

### 5. Nested topics have nowhere to live except absolute coordinates

**Problem.** `CanvasObject` is `id`, world `x`, world `y`, `visibility`, and a text or image payload. `demo.ts` builds proximity by hand (`wharf` is `harbor` plus an offset, `harbor` is `north` plus an offset) and then throws the parents away. The four bands are four `VisibilityRange` constants on a flat array. Nothing says the buoy belongs to the wharf, or a transistor to a chip, or a chip to the phone. `query` cannot load children of the node under the camera because there are no children. Notes need the same tree: a page contains pages.

Authoring the educational atlas as another flat list means every nested coordinate is an absolute float, written by hand, in the JS bundle, present on the first parse. `main.ts` imports `demoObjects` as a static value. That is the right shape for 30 objects. It is how a deep tree gets baked in before the store can represent one.

**Impact.** The next content written against today's model is the content that cannot be lazy, cannot be a note tree, and cannot keep a transistor's position as a small offset from its chip. Precision finding 1's float64 limit shows up here if those offsets are added onto a large world x inside `query` and only then subtracted by the renderer.

**Proposed change.** Optional `parentId`. When it is set, `x` and `y` are in the parent's space. `createMemoryStore` walks ancestors and emits world coordinates on the objects `query` returns, so `RenderFrame` stays world space and the pixel-space renderer keeps subtracting `camera`. A missing parent or a cycle drops that object from `query` and from `countInBand` until the parent is resident (a partial chunk must not throw). The demo stays parentless; HUD numbers stay. One fixture: a parent at x = 132 and a child at local 10⁻⁶, and the world x `query` returns still differs from the parent. Offsets below the ulp of the parent's world x collapse in that add. That is the signal to subtract the camera during the walk and to put a camera-relative position on `VisibleObject`. Do that when the fixture fails, not before.

### 6. There is no hit test, and a tap has nowhere to go except zoom

**Problem.** `SceneStore` has no `hitTest`. `GestureHost` has `panBy`, `zoomAt`, and `retarget`. `classifyTap` in `gestures.ts` zooms on a touch double-tap and ignores `pointerType === 'mouse'`. A mouse click that does not move emits nothing. A single touch tap only arms the double-tap. `attachGestures` calls `preventDefault` on pointer down and on touch, so the canvas consumes the event the educational "what is this?" tap would need. Paint order is the renderer's sort (`maxScale` ascending, finer on top). A hit has to walk the opposite way, and the store does not know a caller wants that.

The README says objects are not selectable. That was the right call for the camera demo. A topic you can zoom into and not point at is still only pixels plus the HUD count.

**Impact.** Selection, "you are inside the chip," and any later note editor all need the same function: world point in, topmost object out. Wiring it before text has authored bounds (finding 4) freezes the 1.25em overestimate as the hit slop.

**Proposed change.** After authored bounds, `hitTest(query, worldX, worldY)` uses the draw cutoff and the unpadded box (the CSS pad is for antialiased cull, not for hits). Topmost is the greater `maxScale`, then later in the array. Add `{ type: 'selectAt'; x: number; y: number }` to the command union `attachInteraction` emits. A mouse click that did not cross `TAP_SLOP` emits it. A touch tap emits it only after `DOUBLE_TAP_MS` with no second tap, so a double-tap zoom does not also select. The shell maps the point with `worldPoint`, calls `hitTest`, and stores `selectedId` on the session. `RenderFrame.selectedId` is set when present. The renderer strokes that object's box. `status.dataset.selected` carries the id (or is empty) so the existing shell harness sees it. `applyCameraCommand` does not accept `selectAt`.

### 7. The per-frame HUD is a live region, and the topic text never leaves the bitmap

**Problem.** `#status` in `index.html` is `aria-live="polite"`. `frame` assigns `status.textContent` on every paint. `applyCommand` paints on every pointer move and every wheel event, so a drag queues a stream of "×0.142 · 12 visible" for assistive tech. The visual readout and the three `dataset` fields are how the tests observe the camera; those stay.

The canvas has `aria-label="Apeiron canvas"` and a static `.sr-only` paragraph that names no label from the atlas. Every topic string is painted by `fillText` and exists nowhere else in the DOM. There is no `keydown` listener. The only keyboard path is tabbing to the +/− buttons, which are real buttons with `:focus-visible`. Arrow keys do not pan. `+` / `−` do not zoom. `user-scalable=no` and `touch-action: none` are the greedy map (`onWheel` on `window`, `onTouchGuard`). Giving pinch back to the browser fights that model. Keyboard commands are the access that remains.

`prefers-reduced-motion` is unread. The 150ms blend is small; a reduce setting should still jump a `zoomStep` to its committed camera.

**Impact.** Web is the first client, and the page is an educational surface. The live region makes the one available announcement worse during the core gesture. A screen-reader user cannot reach "Harbor City" or "Old Wharf" at all.

**Proposed change.** Remove `aria-live` from `#status`. Keep the visual text and `dataset`. In `attachInteraction`, a window `keydown` emits `panBy` for arrows (a step of about a tenth of the canvas width, via the rect it already measures) and `zoomStep` for `+` / `−` / `=`. Ignore the event when the target is an input or textarea, so a later editor still receives keys. In the shell, when `prefers-reduced-motion: reduce` matches, a `zoomStep` lands on the committed camera in one `frame`. Project in-band text into a DOM list from the same `query` result `frame` already has, using the existing `.sr-only` class so the layout does not change. Update that list when the ordered ids change, and do not mark it `aria-live`. A pan that keeps the same objects then changes no accessible text.

### 8. What CI can see, and what it cannot

**Problem.** Vitest runs in `node` (`vite.config.ts`). `render.test.ts` records `fillText` and `strokeRect` and throws the transform away. `main.test.ts` counts `setTransform` calls and does not read arguments. `grid.test.ts` checks `gridStep` for scales `0.02–40` and never runs `drawGrid`. Store tests at scale 80 and at x = 10⁶ (`store.test.ts`, "keeps only the sliver") pass in float64 even if the canvas matrix is wrong. There is no browser harness. The first sequence was right to skip one: the HUD contract is what CI guards.

**Impact.** The pixel-space change can merge while `draw` still builds the world matrix, and every current test stays green.

**Proposed change.** Extend the fake context the renderer tests already use. Record `setTransform`, `font`, `lineWidth`, and the coordinates of `fillText` / `strokeRect` / `fillRect`. The precision PR asserts, at camera `{ x: 132, y: -60, scale: 1e6 }`, that a label with a screen font under the 512px cap lands within a pixel of the viewport center, that a normal world font at that scale does not call `fillText`, and that `setTransform` carries the DPR only. No Playwright, no screenshot job.

### Leave these alone

- **A quadtree, a worker cache, a WebGL renderer.** The scan is not the limit (finding 2). A new renderer is a `createRenderer` behind `RenderFrame` after the coordinates it receives are in CSS pixels.
- **A tile pyramid.** That is the next renderer change only if a single image stays in band across many doublings and must stay sharp. Clipping the destination rect (finding 1) is the step that makes the current images safe to zoom past. Tiles are a content decision.
- **Unifying the 0.01 and 0.02 alpha cutoffs.** That changes the HUD or the fade.
- **Collapsing the two `VisibleObject` types.** The private copy in `render.ts` is what keeps the renderer off `store.ts`.
- **The gesture recognizer.** Safari `gesture*`, two-finger tap, and `wheelZoomFactor` are the product. `attachInteraction` is the seam in front of them.
- **`replaceState` on every pointer move.** A `?focus=<id>` link is worth doing after `parentId` and `hitTest` can frame an object. Writing the camera into the URL on each move is a separate, smaller shell change, and it is not required to prove the seams.
- **The cleanup `attachInteraction` returns.** `mountShell` ignores it. One full-screen page has nothing to detach. An embed or a hot-reload leak is a one-line shell change when that host exists.

## Next sequence

**Done.** Steps 1–7 are on `main` (PRs #14–#20). Step 8 is keyboard pan and zoom, no live region on `#status`, an immediate `zoomStep` while `prefers-reduced-motion: reduce` matches, and a visually hidden list of the text labels in the frame's `query`.

Each PR leaves the demo working and CI green (the same `verify` job). Preserve the HUD string, the three `dataset` fields, and +/− disabled from the committed scale, except where a step says the clamp moved. Preserve pixels at scales the demo already uses, except where a step says a test changed. There is still no browser harness. Add the assertion at the function the step introduces.

1. **Draw in CSS pixels, relative to the camera.** In `render.ts`, `draw` / `drawGrid` / `drawImageObject` / `drawTextObject` convert world to viewport pixels in float64 and set the transform to DPR only. Font size and line width are CSS pixels. Skip `fillText` when the screen font would exceed 512px (the atlas peaks near 185px, so this changes no current label). Clip the image fill to the viewport. Stroke a plate edge only when that edge crosses the view. The fake context records the transform and the coordinates. A camera at `{ x: 132, y: -60, scale: 1e6 }` paints a label whose world font keeps the screen size under 512px (so `fontSize` is tiny) near the viewport center. A world font of ordinary size at that scale does not call `fillText`. A plate the camera sits inside fills the view without a stroke along the screen edge. `MIN_SCALE` and `MAX_SCALE` stay. Alphas, sort order, and the HUD stay.

2. **Widen the scale clamp.** After step 1, set `MIN_SCALE` to `1e-4` and `MAX_SCALE` to `1e7`. `1e7` covers the ~3×10⁶ transistor example with headroom. `1e-4` is about one decade further out than `0.012`. At x = 132, float64 pan still resolves a pixel well past `1e7`. Update the README clamp sentence, `clampScale` tests, the button-zoom tests that pin `MAX_SCALE`, `gridStep` checks at the new ends, and the shell test that disables + by clicking twelve times (from `0.1`, twenty-seven steps of 2× land past `1e7`). Disabling +/− moves. Pixels inside the old range do not.

3. **Load images with the visible set, and cap the cache.** Delete the startup `renderer.warm(store.imageSources())` in `mountShell`. `imageFor` on draw is the fetch. Cap the map at 32 settled images, least recently drawn first. Do not evict an image that has not loaded or failed yet. Replace the test that expects off-band fetches. The shell onload test enters the region band before it fires `onload`. Opening the demo fetches no image. `imageSources` stays on the store.

4. **Let the store notify, and let an image src be absolute.** Add `subscribe` and `replaceObjects` to `createMemoryStore`. `mountShell` takes an optional store, subscribes, and invalidates. A test store that calls `replaceObjects` causes one frame and a new `countInBand`. `publicUrl` returns `http:` and `https:` srcs unchanged and still prefixes `images/phone.svg`. No fetch client, no chunk format.

5. **Parent-local placement.** Optional `parentId` on `CanvasObject`. With it set, `x` and `y` are parent-local. The memory store flattens to world coordinates inside `query` and `countInBand`. A missing parent or a cycle omits the object. Demo objects stay parentless, so the atlas and the HUD stay. A fixture asserts that a child offset of `1e-6` under a parent at x = 132 survives in the world position `query` returns.

6. **Authored text bounds.** Add world `width` and `height` to the text payload. Fill the demo from the current `textBox` values so culling membership stays. `query` uses those boxes plus the one-pixel pad. Delete `letterSpacingWorld` and the advance/stroke constants from `store.ts`. Export the title fit width (`6300`) from `demo.ts` beside `overview-title`, and pass it into `initialCameraFor`. The phone opening scale stays.

7. **`hitTest`, then `selectAt`.** `hitTest` uses the draw cutoff and the unpadded authored box; finer `maxScale` wins. Tests only, no input change, in the first commit of the PR. Then `selectAt`: mouse click, and a touch tap that waited out `DOUBLE_TAP_MS` without becoming a double-tap zoom. The shell stores `selectedId`, puts it on `RenderFrame`, strokes the box, and mirrors it to `dataset.selected`. Double-tap zoom and drag pan stay. The README gains one sentence that a click or a settled tap selects.

8. **Keyboard, the live region, and the label list.** **Done.** `attachInteraction` emits `panBy` for the arrow keys (a tenth of the canvas width) and `zoomStep` for `+`, `=`, `-`, and `−`. Those keys are ignored in an input, textarea, select, or contenteditable, and while Ctrl, Meta, or Alt is held. `#status` has no `aria-live`. A `prefers-reduced-motion: reduce` match, including a later change to that query, settles `zoomStep` on the committed camera in one frame. A visually hidden `.sr-only` list of the text labels in the frame's `query` is rebuilt when that set changes and is not a live region.

After these eight, a `?focus=<id>` opener is a small bootstrap follow-up: the store returns the world box of an id, and `cameraFromLocation` frames it. It wants steps 5 and 6. A tile cache wants a real plate that stays in band across many doublings, which this sequence does not add.
