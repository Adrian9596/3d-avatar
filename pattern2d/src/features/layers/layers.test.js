import {test, eq, deepEq, ok} from "../../../tests/harness.js";
import {defaultVisibility, countEntities, layerSwatch, lineLayers} from "./layers.js";
import {layerMeta} from "../dxf/aama.js";

const model = {
  pieces: [{paths:[{layer:"1"},{layer:"8"}], points:[{layer:"3"},{layer:"3"}], texts:[{layer:"8"}]}],
  loose: {paths:[], points:[], texts:[{layer:"0"}]}
};

test("entities are counted per layer, pieces and loose alike", () =>
  deepEq(countEntities(model), {"1":1, "8":2, "3":2, "0":1}));

test("a fresh file hides the point clouds that would bury the outline", () => {
  const on = defaultVisibility({"1":1, "2":9, "3":9, "8":1});
  eq(on["1"], true); eq(on["8"], true);
  eq(on["2"], false); eq(on["3"], false);
});

test("a file made only of points still shows something", () => {
  const on = defaultVisibility({"2":5, "3":5});
  ok(on["2"] && on["3"], "hiding everything would show an empty canvas");
});

test("the swatch draws the mark its layer draws", () => {
  ok(layerSwatch(layerMeta("8")).includes("stroke-dasharray"), "the sewing line is dashed");
  ok(layerSwatch(layerMeta("4")).includes("<circle"), "notches are points");
  ok(layerSwatch(layerMeta("14")).includes("<text"), "piece names are glyphs");
});

/* 2026-09-24 — in the ASTM files (Bianca, SofyLift, the strike-cost files, 3087) layer 14 is the SEW LINE (CLAUDE.md §8), and
   Edges measures it as "đường may"; the legend called it "Name" with a text glyph — to measure the cut line instead TD had to
   turn off a chip named after the piece-name text. Layer 14 holding lines reads as a sewing line; holding only text, as before */
test("layer 14 holding lines is a sewing line in the legend and on the canvas; holding only text it stays the piece name", () => {
  const astm = {pieces: [{paths: [{layer: "1"}, {layer: "14"}], points: [], texts: [{layer: "14"}]}], loose: {paths: [], points: [], texts: []}};
  const house = {pieces: [{paths: [{layer: "1"}, {layer: "8"}], points: [], texts: [{layer: "14"}]}], loose: {paths: [], points: [], texts: []}};
  deepEq([...lineLayers(astm)].sort(), ["1", "14"]); deepEq([...lineLayers(house)].sort(), ["1", "8"]);
  const sew14 = layerMeta("14", {lines: true});
  eq(sew14.short, "Sew 14"); eq(sew14.tok, "--l-sew"); ok(/[Ss]ew/.test(sew14.name), sew14.name);
  ok(layerSwatch(sew14).includes("stroke-dasharray"), "nét đứt như đường may");
  eq(layerMeta("14").short, "Name", "chỉ có chữ (3380): vẫn là tên mảnh");
  eq(layerMeta("8", {lines: true}).short, "Sew", "layer khác không đổi");
});
