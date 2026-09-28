# Opening a file — the empty workspace and the host page

The workspace is the **2D tab** of the 3d-avatar site (tabs `2D · 3D`, `#2d` in the URL). It is
loaded in an iframe of the 3D page, same origin. The public repo carries no pattern file, so
nothing is open when the tab starts (TD, 2026-09-28: "Chỉ code, không cả BLOCK_36C"). Until
then the viewer booted on the BLOCK_36C sample that `build_viewer.py` inlined; that path is gone.

| # | Requirement |
|---|---|
| O1 | The workspace starts **empty**: no model, the title reads `—`, and the stage shows what to do — an **Open DXF** control and "or drop a .dxf file here". The toolbar, the rail toggle and the unit switch stay clickable above it (the old overlay sat on top of the toolbar). |
| O2 | With no model open, the canvas **does nothing** on pointer down / move / up, wheel, and the − / + zoom buttons — no error, no view invented. Fit is already harmless (no box, no view). |
| O3 | A DXF sent by the **host page** opens exactly like a dropped file: the bytes are kept (so Encoding and File unit re-read *it*), the title is the file's name, the file unit goes back to Auto, and it loads. |
| O4 | Only the host counts: a message is taken when it comes from `window.parent`, from this page's own origin, with `type: "pattern2d:open-dxf"` and a `file` that is a File (a name and `arrayBuffer()`). Anything else — another window, another origin, another type, no file, or a page that is not framed — is ignored. |
| O5 | When framed, the workspace tells its host `{type: "pattern2d:ready"}` once every feature is mounted, and `{type: "pattern2d:opened", name, pieces}` after each file it opens, whoever opened it. Messages go to the page's own origin only. Standalone (not framed), it posts nothing. |
| O6 | When framed, the title bar leaves room at its start for the host's `2D · 3D` tabs, which sit over the top-left corner of the frame (`html.framed`, app/app.css). Standalone, the bar is unchanged. |

The host side — the tabs, the iframe, the **Open in 2D** button of the 3D pattern block — is the
3D app's (`src/ui/tabs.mjs` in the repo). The only contract between the two is the three message
types above; neither imports the other's code.
