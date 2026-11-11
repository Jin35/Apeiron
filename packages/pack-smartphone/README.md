# Smartphone pack

A pack is one subject for the canvas: the objects it draws, the theme, and the images. `@apeiron/core` does not know this pack exists. The app in `apps/apeiron` lists the packs and opens this one unless the query is `?pack=archipelago`.

## Data

`smartphone-hierarchy.md` is the tree: name, parent, kind (`part`, `view`, or `process`), characteristic size, and count. `data/overrides.json` is the part that is authored by hand: the groups, the placed pictures, their labels, and the cut-out pixel sizes. A group can say which parent's children it receives, whether those children use the full footprint, and the label size.

`data/smartphone.json` is the presented scene. It is generated. Do not edit it by hand. Each entry in `nodes` is one hierarchy node:

- `id`, `name`, `parent` (the content parent, or `null` for the root)
- `kind` and `status` (`built` or `planned`)
- `sizeMm`, the characteristic size in millimetres
- `count`, a magnitude such as `×~15 billion`, or `null`
- `image`, a site path, or `null` when the node is a placeholder. The kind chooses the shape: a rounded square, a dashed square, or a pill
- `place`, the fixed parent-local position and size. `place.parent` is the canvas parent, which may be a group
- `label`, with `id`, `text`, and position
- `link`, with `id`, `from`, and `to`

`groups` are transforms with no pixels. `order` is the paint order of every canvas object. `report.shrunk` lists nodes drawn smaller than child size ÷ parent size. `report.unplaced` lists any the packer could not place.

`src/smartphone.ts` loads that file and maps each record to canvas objects. The page does not run the packer.

## Images

Cut-outs live in `public/images/`. The path stored on a node is `images/...`, without `public/`. Pixel size, and the opaque box for a trimmed photograph, are on the sprite in `data/overrides.json`. A node with no sprite is a placeholder.

## Regenerate

From the repo root, after editing the hierarchy or the overrides:

```bash
npm run generate
```

That runs `scripts/generate-hierarchy.ts` and rewrites `data/smartphone.json`. The test in `src/data.test.ts` fails when the checked-in file does not match a fresh run.
