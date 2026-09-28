import {test, eq, ok, deepEq} from "../../../tests/harness.js";
import {compose, headed} from "./readout.js";

test("nobody claims the heading, nothing is shown", () => {
  eq(compose([null, {section:"Edges", rows:[["A","1"]]}]), "", "a section alone is not a panel");
  eq(compose([]), "");
});

test("the first provider with a title owns the heading", () => {
  const html = compose([{title:"cradle_M", rows:[["Cut","×1"]]}, {title:"5 pieces", rows:[]}]);
  ok(html.startsWith("<h3>cradle_M</h3>"));
  ok(html.includes("<td>Cut</td><td class=\"mono\">×1</td>"));
});

test("sections append under the heading, with their total last", () => {
  const html = compose([
    {title:"5 pieces", rows:[["Pieces","5"]]},
    {section:"Edges", rows:[["A","270.7",true]], total:["Total","477.1"]}
  ]);
  ok(html.indexOf("Pieces") < html.indexOf("Edges"), "heading rows come first");
  ok(html.includes('<tr class="sec"><td colspan="2">Edges</td></tr>'));
  ok(html.includes('<tr><td class="mono">A</td>'), "an edge letter is set in mono");
  ok(html.trimEnd().endsWith("</table>") && html.includes('class="tot"'));
});

test("values from a DXF are escaped, not injected", () => {
  const html = compose([{title:"<img src=x>", rows:[["k","<b>v</b>"]]}]);
  ok(!html.includes("<img"), "piece names come from a file, so they are data");
  ok(html.includes("&lt;b&gt;v&lt;/b&gt;"));
});

/* point_to_point.md P8 (TD 2026-09-24, "đo điểm"): a tool's block when nothing is selected — nobody claims the heading,
   and a Straight measurement between two pieces used to show its dx, dy nowhere (bấm thật: the panel stayed hidden) */
test("P8 a tool's block becomes the heading when nobody claims it — and stays a section under a heading when someone does", () => {
  const block = {section: "Straight", rows: [["Khoảng cách", "5.544 in", true], ["dx", "5.544 in", true]], total: ["A → B", "5.544 in"]};
  deepEq(headed(block, false), {title: "Straight", rows: block.rows, total: block.total}, "không ai giữ tiêu đề: khối là tiêu đề");
  eq(headed(block, true), block, "đang chọn mảnh: vẫn là một khối dưới tên mảnh");
  eq(headed(null, false), null, "không có gì để nói: không có bảng");
  const html = compose([null, headed(block, false)]);
  ok(html.startsWith("<h3>Straight</h3>"), "bảng hiện, tiêu đề Straight");
  ok(html.includes("<td>dx</td>") || html.includes('<td class="mono">dx</td>'), "có dx");
  ok(html.includes('class="tot"') && html.indexOf("dx") < html.indexOf('class="tot"'), "dòng tổng A → B ở cuối khối");
});

test("P8 the heading's own total is drawn under its rows, before any section", () => {
  const html = compose([{title: "Along Path", rows: [["Dọc đường", "6.305 in"]], total: ["A → B", "6.305 in"]},
                        {section: "Edges · đường cắt", rows: [["A", "1"]]}]);
  ok(html.indexOf("A → B") < html.indexOf("Edges"), "tổng của tiêu đề trước các khối khác");
});
