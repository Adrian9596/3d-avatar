/* The Edit tool's pure helpers (spec: edit/edit.md §4 — how an angle is typed; §2 — what the
   readout says about a selection). The canvas wiring itself is checked by clicking in the
   browser; what it computes is in select/relate/ops, tested next door. */
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {rectPiece, testPiece, lineP} from "../../../tests/edit_fixtures.js";
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {lengthFormatter} from "../../shared/units.js";
import {arc, point, sample, length} from "../geometry/model.js";
import {summarize} from "../dxf/model.js";
import {itemKey, groupItems, selectionRows, lengthBox, editKey, EDIT_KEYS} from "./edit.js";
import {parseAngle} from "../../shared/units.js";
import {edgesOf, vertsOf} from "./select.js";
import {applyLength, edgeMeasure} from "./ops.js";

test("P5 an angle typed as 30, 30°, -45, 12,5 or +7.25 reads in degrees", () => {
  eq(parseAngle("30"), 30); eq(parseAngle("30°"), 30); eq(parseAngle(" -45 "), -45);
  eq(parseAngle("12,5"), 12.5); eq(parseAngle("+7.25"), 7.25); eq(parseAngle(".5"), 0.5);
});

test("P6 an angle that is not a number is refused, not guessed", () => {
  for(const bad of ["", "abc", "30 deg", "1/2", "30°°", "--5", "5-"]){
    let err = null; try{ parseAngle(bad); }catch(e){ err = e; }
    ok(err && /góc/.test(err.message), `"${bad}"`);
  }
});

test("one thing selected twice is one thing: the key names the piece, the kind and the indices", () => {
  const a = {kind: "line", pi: 0, path: 0, a: 0, b: 1, click: [1, 2]}, b = {kind: "line", pi: 0, path: 0, a: 0, b: 1, click: [9, 9]};
  eq(itemKey(a), itemKey(b));
  ok(itemKey(a) !== itemKey({...a, pi: 1}));
  ok(itemKey({kind: "point", src: "entity", pt: 3, pi: 0}) !== itemKey({kind: "point", src: "vertex", path: 3, v: 0, pi: 0}));
});

test("a selection over two pieces is edited piece by piece", () => {
  const g = groupItems([{kind: "piece", pi: 1}, {kind: "line", pi: 0, path: 0, a: 0, b: 1}, {kind: "point", pi: 1, src: "entity", pt: 0}]);
  deepEq([...g.keys()], [1, 0]); eq(g.get(1).length, 2);
});

test("the readout of one Line: its kind, length and angle, in the display unit", () => {
  const p = rectPiece(), e = {...edgesOf(p.paths[0])[0], path: 0, pi: 0, click: [90, -1]};
  const rows = selectionRows([p], [e], lengthFormatter("mm"));
  deepEq(rows.slice(0, 3).map(r => [r[0], r[1]]), [["Loại", "Line"], ["Dài", "100.0 mm"], ["Góc", "0.00°"]]);
  const inch = selectionRows([p], [e], lengthFormatter("inch"));
  eq(inch[1][1], "3.937 in");
});

test("the readout of nothing, of a point, of a piece, of many", () => {
  const p = rectPiece(), L = lengthFormatter("mm");
  eq(selectionRows([p], [], L)[0][0], "Chọn");
  eq(selectionRows([p], [{kind: "point", src: "entity", pt: 0, pi: 0}], L)[0][1], "Point · notch");
  eq(selectionRows([p], [{kind: "piece", pi: 0}], L)[1][1], "100.0 × 60.0 mm");
  eq(selectionRows([p], [{kind: "piece", pi: 0}, {kind: "point", src: "entity", pt: 0, pi: 0}], L)[0][1], "2 thứ");
});

/* ── P7: the Length box takes a change as well as a length ──────────────────────────────────────
   Expected numbers by hand: 1/4 in = 6.35 mm, 1 1/4 in = 31.75 mm, 0,5 in = 12.7 mm, 2 cm = 20 mm */
test("P7 the Length box: a bare length SETS it, one led by + or − CHANGES the length the edge has", () => {
  const box = lengthBox(() => 100);
  const v = (t, u) => { const r = box.read(t, u); ok(r.ok, `"${t}" (${u}): ${r.error}`); return r.mm; };
  near(v("+1/4", "inch"), 106.35, 1e-9);
  near(v("+0.25", "inch"), 106.35, 1e-9, "+0.25 is a quarter inch MORE — no longer a length of 0.25 in");
  near(v("-3mm", "inch"), 97, 1e-9, "the suffix names its own unit");
  near(v("+ 1 1/4", "inch"), 131.75, 1e-9);
  near(v("-0,5", "inch"), 87.3, 1e-9);
  near(v("+2cm", "inch"), 120, 1e-9);
  near(v("+10", "mm"), 110, 1e-9); near(v("-10", "mm"), 90, 1e-9);
  near(v("+5", null), 105, 1e-9, "a file with no unit: drawing units");
  near(v("5", "inch"), 127, 1e-9, "a bare number still sets the length");
  near(v("0.25", "inch"), 6.35, 1e-9);
});

test("P7 the change is added to the length the edge has AT THAT MOMENT", () => {
  let L0 = 100;
  const box = lengthBox(() => L0);
  near(box.read("+10", "mm").mm, 110, 1e-12);
  L0 = 50;
  near(box.read("+10", "mm").mm, 60, 1e-12);
});

test("P7 a change leaving nothing, two signs, a sign alone, no edge chosen: refused, the value kept", () => {
  const box = lengthBox(() => 100);
  ok(box.read("4", "inch").ok);
  const bad = [["-100mm", "inch"], ["-200mm", "inch"], ["-4", "inch"], ["+", "inch"], ["-", "mm"], ["++3", "mm"], ["+-3", "mm"],
               ["--3", "mm"], ["+abc", "mm"], ["+5mm", null], ["+3 mm mm", "mm"]];
  for(const [t, u] of bad){
    const r = box.read(t, u);
    ok(!r.ok && r.error, `"${t}" (${u}) refused`);
    near(box.mm, 101.6, 1e-9, `"${t}" kept the value`);
  }
  const none = lengthBox(() => NaN).read("+1", "mm");
  ok(!none.ok && /cạnh/.test(none.error), none.error);
});

test("P7 typed as a change on a Line: the bottom 1/4 in longer, then 3 mm shorter — from the length it has each time", () => {
  const p = rectPiece(), e = {...edgesOf(p.paths[0])[0], path: 0, pi: 0, click: [90, -1]};
  const box = lengthBox(() => edgeMeasure(p, e).length);
  let r = box.read("+1/4", "inch"); ok(r.ok, r.error);
  applyLength(p, e, r.mm);
  near(Math.hypot(...[0, 1].map(k => vertsOf(p.paths[0])[1][k] - vertsOf(p.paths[0])[0][k])), 106.35, 1e-9);
  r = box.read("-3mm", "inch"); ok(r.ok, r.error);
  applyLength(p, e, r.mm);
  near(vertsOf(p.paths[0])[1][0], 103.35, 1e-9); near(vertsOf(p.paths[0])[1][1], 0, 1e-9);
  deepEq(vertsOf(p.paths[0])[0], [0, 0], "the fixed end did not move");
});

/* an ARC of radius 20 over a quarter turn, (70,30) → (50,50): 10π long, its chord at 135° */
function arcPiece(){
  const p = rectPiece({grain: null}), s = arc(point(50, 30), 20, 0, Math.PI/2, true);
  p.paths.push({layer: "0", closed: false, shapes: [s], pts: sample(s, 0.05), snap: [[70, 30], [50, 50]]});
  return summarize(p);
}

test("P8 a whole curve has its own numbers: an arc of radius 20 over a quarter turn is 10π long, its chord at 135°", () => {
  const p = arcPiece(), it = {kind: "curve", whole: true, a: null, b: null, path: 2, pi: 0, click: [51, 50]};   // near (50,50): that end runs
  const m = edgeMeasure(p, it);
  near(m.length, 10*Math.PI, 1e-9); near(m.angle, 135, 1e-9);
  near(edgeMeasure(p, {...it, click: [69, 30]}).angle, 315, 1e-9, "clicked near (70,30): the chord runs the other way");
  deepEq(selectionRows([p], [it], lengthFormatter("mm")).map(r => [r[0], r[1]]),
         [["Loại", "Curve (nguyên khối)"], ["Dài", "31.4 mm"], ["Góc", "135.00°"]]);
});

test("P8 a closed whole curve: its length is its round; it has no chord, so no direction", () => {
  const p = rectPiece({grain: null}), s = arc(point(50, 30), 10, 0, 2*Math.PI, true);
  p.paths.push({layer: "11", closed: true, shapes: [s], pts: sample(s, 0.05), snap: [[60, 30]]}); summarize(p);
  const it = {kind: "curve", whole: true, a: null, b: null, path: 2, pi: 0, click: [60, 30]}, m = edgeMeasure(p, it);
  near(m.length, 20*Math.PI, 1e-9); eq(m.angle, null);
  deepEq(selectionRows([p], [it], lengthFormatter("mm")).map(r => [r[0], r[1]]),
         [["Loại", "Curve (nguyên khối)"], ["Dài", "62.8 mm"], ["Góc", "—"]]);
});

test("P7 typed as a change on a whole arc: 10 mm longer is 10π + 10 exactly, about its fixed end", () => {
  const p = arcPiece(), it = {kind: "curve", whole: true, a: null, b: null, path: 2, pi: 0, click: [51, 50]};
  const r = lengthBox(() => edgeMeasure(p, it).length).read("+10", "mm");
  ok(r.ok, r.error);
  applyLength(p, it, r.mm);
  near(length(p.paths[2].shapes[0]), 10*Math.PI + 10, 1e-9);
  /* scaled by k = (10π + 10)/10π = 1 + 1/π about its fixed end (70,30): the centre (50,30) goes to
     (70 − 20k, 30), the radius to 20k — by hand */
  const a = p.paths[2].shapes[0], k = 1 + 1/Math.PI;
  near(a.c.x, 70 - 20*k, 1e-9); near(a.c.y, 30, 1e-9); near(a.r, 20*k, 1e-9);
  near(a.c.x + a.r*Math.cos(a.a0), 70, 1e-9, "the fixed end stays"); near(a.c.y + a.r*Math.sin(a.a0), 30, 1e-9);
});

/* ── D11: the Edit keys ─────────────────────────────────────────────────────────────────────── */
test("D11 T and X open the single Trim / Extend mode; either toggles it off; K/J unchanged", () => {
  const k = (key, mode, extra = {}) => editKey({key, ...extra}, mode);
  for(const key of ["t", "x"]){
    deepEq(k(key, "drag"), {mode: "trimExtend"});
    deepEq(k(key, "trimExtend"), {mode: "drag"});
  }
  deepEq(k("k", "drag"), {mode: "split"}); deepEq(k("K", "split", {shiftKey: true}), {mode: "drag"});
  deepEq(k("j", "drag"), {act: "join"}); deepEq(k("J", "trimExtend", {shiftKey: true}), {act: "join"});
});

test("D11 held with ⌘ · Ctrl · ⌥, typed into a box, or any other key: not Edit's", () => {
  const box = {matches: sel => /input/.test(sel)};
  for(const extra of [{metaKey: true}, {ctrlKey: true}, {altKey: true}, {target: box}])
    for(const key of ["t", "x", "k", "j"]) eq(editKey({key, ...extra}, "drag"), null, `${key} ${Object.keys(extra)[0]}`);
  for(const key of ["d", "e", "m", "s", "a", "z", "Escape", "Enter", " ", ""]) eq(editKey({key}, "drag"), null, `"${key}"`);
});

test("D11 no viewer shortcut is taken twice: T · X · K · J are Edit's alone", () => {
  /* every ctx.key("…") in the source, read from the files — one key registered twice would do two things */
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(f => f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith(".js") && !f.name.endsWith(".test.js") ? [join(d, f.name)] : []);
  const global = walk(root).flatMap(f => [...readFileSync(f, "utf8").matchAll(/ctx\.key\("([^"]+)"/g)].map(m => m[1]));
  deepEq([...global].sort(), ["6", "7", "a", "d", "e", "f", "g", "l", "m", "p", "s", "u", "v"], "the viewer's keys (D · M · L · S · G · E · A · F · P · U · V — Vẽ, draw.md W1 · 6 · 7 — Vẽ straight in Mảnh / Notch, piece.md M13)");
  deepEq(Object.keys(EDIT_KEYS).sort(), ["j", "k", "t", "x"]);
  for(const k of Object.keys(EDIT_KEYS)) ok(!global.includes(k), `${k} is not taken`);
});
