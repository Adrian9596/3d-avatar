import {test, eq, ok, deepEq} from "../../../tests/harness.js";
import {withDom, emptyCtx} from "../../../tests/dom_fixture.js";
import {DxfImport, openedFile, openBytes, OPEN_DXF, READY, OPENED} from "./import.js";

/* open.md: the workspace starts empty, and a DXF may come from the host page (the 3D tab). */
const ORIGIN = "http://127.0.0.1:8765";
const DXF = "0\nSECTION\n2\nENTITIES\n0\nTEXT\n8\n1\n10\n0\n20\n0\n40\n1\n1\nUnits: METRIC\n0\nENDSEC\n0\nEOF\n";
const framedWin = () => { const w = {location: {origin: ORIGIN}}; w.parent = {postMessage(){}}; return w; };
const msg = (win, data, extra = {}) => ({source: win.parent, origin: ORIGIN, data, ...extra});

test("O4 openedFile takes a File the host posted from this origin", () => {
  const win = framedWin(), f = new File([DXF], "pattern-draft.dxf");
  eq(openedFile(msg(win, {type: OPEN_DXF, file: f}), win), f);
});

test("O4 openedFile ignores another window, another origin, another type, no File, and a page that is not framed", () => {
  const win = framedWin(), f = new File([DXF], "a.dxf");
  eq(openedFile(msg(win, {type: OPEN_DXF, file: f}, {source: {}}), win), null, "not the host");
  eq(openedFile(msg(win, {type: OPEN_DXF, file: f}, {origin: "https://example.com"}), win), null, "another origin");
  eq(openedFile(msg(win, {type: "open", file: f}), win), null, "another type");
  eq(openedFile(msg(win, {type: OPEN_DXF}), win), null, "no file");
  eq(openedFile(msg(win, {type: OPEN_DXF, file: {name: "a.dxf", arrayBuffer(){}}}), win), null, "file-like, not a File");
  eq(openedFile(msg(win, {type: OPEN_DXF, file: "0\nEOF"}), win), null, "text, not a File");
  eq(openedFile(msg(win, null), win), null, "no data");
  const alone = {location: {origin: ORIGIN}}; alone.parent = alone;
  eq(openedFile({source: alone, origin: ORIGIN, data: {type: OPEN_DXF, file: f}}, alone), null, "standalone: there is no host");
});

test("O1 the workspace starts empty: an Open DXF control on the stage, under the toolbar", () => withDom(({ui, byId}) => {
  const ctx = emptyCtx();
  DxfImport.mount(ctx, ui); DxfImport.boot(ctx);
  const empty = byId("empty");
  eq(empty.hidden, false, "the empty stage says what to do");
  eq(ui.stage.children[0], empty, "first in the stage, so the toolbar and the panels paint over it");
  ok(empty.all().some(e => e.tagName === "LABEL" && e.htmlFor === "pick"), "an Open DXF control for the file picker");
  ok(empty.all().some(e => /kéo thả file \.dxf/.test(e.textContent)), "and a word about dropping a file");
  eq(byId("fname").textContent, "—");
  eq(ctx.loads.length, 0, "nothing is loaded");
}));

test("O3 a DXF from the host opens like a dropped file: its name, its bytes kept, File unit back to Auto", () => withDom(({ui, byId}) => {
  const ctx = emptyCtx();
  DxfImport.mount(ctx, ui); DxfImport.boot(ctx);
  byId("fileunit").value = "inch";                        // chosen by hand for the file before
  openBytes(ctx, new TextEncoder().encode(DXF).buffer, "pattern-draft.dxf");
  eq(ctx.loads.length, 1);
  deepEq([ctx.loads[0].fileName, ctx.loads[0].opts.unit], ["pattern-draft.dxf", "auto"]);
  ok(ctx.loads[0].text.includes("Units: METRIC"), "the text of the bytes");
  eq(byId("fname").textContent, "pattern-draft.dxf");
  eq(byId("empty").hidden, true, "a file with pieces hides the empty stage");
  byId("enc").value = "utf-8"; byId("enc").emit("change");  // Encoding re-reads THIS file, not a previous one
  eq(ctx.loads.length, 2);
  deepEq([ctx.loads[1].fileName, ctx.loads[1].text], ["pattern-draft.dxf", ctx.loads[0].text]);
}));

test("O3 the host's message reaches the reader; anything else posted opens nothing", () => withDom(({ui, self, fire, file}) => {
  const ctx = emptyCtx();
  DxfImport.mount(ctx, ui); DxfImport.boot(ctx);
  fire("message", {source: {}, origin: ORIGIN, data: {type: OPEN_DXF, file: file(DXF, "x.dxf")}});
  fire("message", {source: self.parent, origin: ORIGIN, data: {type: "something-else"}});
  eq(ctx.loads.length, 0, "not from the host, or not a DXF");
  fire("message", {source: self.parent, origin: ORIGIN, data: {type: OPEN_DXF, file: file(DXF, "pattern-draft.dxf")}});
  eq(ctx.loads.length, 1);
  eq(ctx.loads[0].fileName, "pattern-draft.dxf");
}, {framed: true, origin: ORIGIN}));

test("O5 framed, the workspace says it is ready, then what it opened — to its own origin only", () => withDom(({ui, posted}) => {
  const ctx = emptyCtx();
  DxfImport.mount(ctx, ui);
  eq(posted.length, 0, "not before every feature is mounted (boot is the last step of start)");
  DxfImport.boot(ctx);
  deepEq(posted.map(p => [p.data.type, p.target]), [[READY, "/"]]);
  openBytes(ctx, new TextEncoder().encode(DXF).buffer, "pattern-draft.dxf");
  deepEq(posted[1], {data: {type: OPENED, name: "pattern-draft.dxf", pieces: 2}, target: "/"});
}, {framed: true, origin: ORIGIN}));

test("O5 standalone, the workspace posts nothing", () => withDom(({ui, posted}) => {
  const ctx = emptyCtx();
  DxfImport.mount(ctx, ui); DxfImport.boot(ctx);
  openBytes(ctx, new TextEncoder().encode(DXF).buffer, "a.dxf");
  eq(posted.length, 0);
}));
