# pattern2d — the 2D pattern workspace (the site's 2D tab)

The **2D** tab of the 3d-avatar site: open a DXF pattern, look at it piece by piece, measure it, edit
it, draw on it and add pieces, and export a new DXF. The **3D** tab is the avatar viewer. Tabs read
`2D · 3D`, 3D opens by default, and `#2d` / `#3d` in the URL opens a tab directly
(<https://adrian9596.github.io/3d-avatar/#2d>). The workspace also runs on its own at
`/pattern2d/`.

It came from the private "2D Pattern" workspace ("Pattern Plotter", then a single-file
`dxf_viewer.html`) on 2026-09-28, **code only**. This repo is public, so it carries no pattern:
no factory DXF, no fixture made from one, no sample block. **The workspace opens empty** — open
a DXF to start.

## Getting a pattern in

- **Open DXF** (title bar, or on the empty stage), or **drop a `.dxf`** anywhere on the page, in
  either tab.
- From the 3D tab: draw a closed pen loop, **Flatten**, then **Open in 2D** in the pattern block.
  The flattened pieces open here in mm — a 1:1 shell of the body surface, not a pattern: no ease,
  no seam allowance (the file says so on its layer 15).
- Encoding is automatic (UTF-8, then GBK), or chosen by hand. The file's unit comes from its
  `Units:` text; a file that declares none gets a **File: mm / inch** choice, and snapping stays off
  until it has a unit.
- The tab keeps its file while you switch to 3D and back, **in memory only** — export what you want
  to keep, and keep it outside the repo: an export is a pattern, and the repo never carries one.
  Opening another file replaces it (Open in 2D asks first).

## Tools

Layers (with legend) · pieces with thumbnails · the panel (`P`) · Fit (`F`) / zoom / pan · **Geom**
(`G`) · **Edges** (`E`, each edge's length, of the sewing line when there is one) · **Straight**
(`M`, a distance) and **Along** (`L`, a length along the pattern line) · **Copy** (the piece table
as TSV) · **Arrange** (`A`; align,
distribute, lay out, drag with snapping — view only, never written back) · **Simplify** (`S`) ·
**Edit** (`D`; select · drag · move · trim / extend · split · join — `T X K J` —, Length / Angle /
Distance, sewing line, notches and grain follow) · **Vẽ** (`V`; Line · Curve · Rectangle · Circle ·
Polygon at real size, with relations; **Mảnh** (`6`) — a new piece with the pen, with grain, name
and quantity; **Notch** (`7`); **Bút** (`8`) — the smart pen: one pen, where and how you press decides —
a click a point, a drag on an edge its parallel, a drag from a point a compass line, ⇧ drag a set square,
`H` a T-square, dx · dy an offset start; every action shows its ghost and label first) · **Delete** · `U` switches the display unit in · cm · mm (numbers only, never
the geometry) · **Xuất DXF** writes a new `<name>_edit.dxf` and never overwrites anything.

Each tool's requirements are the spec next to its code (`src/features/*/**.md`, indexed in
[`src/README.md`](src/README.md)). How the workspace starts empty and takes a file from the host
page: [`src/features/dxf/open.md`](src/features/dxf/open.md).

## Layout

```
pattern2d/
├── index.html      the page (Vite entry): the shell, the stylesheets in cascade order, src/app/main.js
├── CLAUDE.md       the rules for working on this code
├── src/            app/ (composition root) · shared/ · features/<feature>/ — see src/README.md
└── tests/          run.js · harness.js · the fixture loaders · data.js (private data) · dom_fixture.js ·
                    fixtures/engine/ (synthetic DXFs drawn by ezdxf, sha256-pinned)
```

It is plain ES modules with no dependencies. It shares no code with the 3D app (`src/` at the repo
root); the host side of the tab is `src/ui/tabs.mjs`, and the two only exchange three messages
(`open.md` O3–O5).

## Tests

```sh
npm run validate:pattern2d                 # node pattern2d/tests/run.js [filter]
npm run validate:pattern2d-rules           # scripts/test_pattern2d.mjs
PATTERN2D_DATA="/path/to/2D Pattern" npm run validate:pattern2d
```

Without the private data the suite ends `790/790 passed, 151 skipped`: the tests on the factory 3380
fixture, BLOCK_36C and the DXF library are **skipped and counted, never passed**, and the runner
lists what each group needs. `PATTERN2D_DATA` names a local copy of the private 2D Pattern workspace
(it holds `tests/fixtures/3380.json`, `tests/fixtures/engine/expected.json` with its library half,
`output/BLOCK_36C.dxf` and `DXF file/`); with it every test runs, `941/941 passed`, and a missing
file is a failure, not a skip. CI runs the first two commands.

The rules gate checks what the suite cannot: no pattern data under `pattern2d/`, plain modules that
node can import (no package, no `.mjs`, no cycle, features never import `app/`), the geometry
kernel's two rules (every export tested; world millimetres, never the Canvas), the page, and the
bridge — including that the 3D export (`qa/avatar_master/flatten-draft.dxf`) opens in this reader.

The real-DXF checks (ezdxf against the factory library) stay in the private workspace and run
locally against this code; see `CLAUDE.md` §5.18.

## Build

Part of the site: `npm run build:pages` builds `pattern2d/index.html` as the second entry of
[`vite.config.mjs`](../vite.config.mjs) into `dist/pattern2d/index.html`. Served unbuilt (any
static server over the repo root) it runs as the same modules.
