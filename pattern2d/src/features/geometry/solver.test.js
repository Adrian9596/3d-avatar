import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, curve, length, bbox} from "./model.js";
import {createDoc} from "./doc.js";
import {createGraph} from "./graph.js";
import {solve} from "./solver.js";
import {RULES, ruleNames} from "./rules.js";

const sq = (w = 100, h = 100) => curve([[0,0],[w,0],[w,h],[0,h]], true);

test("tính theo thứ tự phụ thuộc, mỗi nút đúng một lần", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(100,0)));
  const b = d.derive("offset", [a], {d: 10});
  const c = d.derive("offset", [b], {d: 10});
  const e = d.derive("midpoint", [c]);
  const r = d.solve();
  deepEq(r.order, [b, c, e], "đúng thứ tự tôpô");
  eq(r.updated.length, 3);
  eq(new Set(r.order).size, r.order.length, "không tính lại nút nào hai lần");
});

test("hình thoi phụ thuộc: nút chung chỉ tính một lần", () => {
  const d = createDoc();
  const base = d.add(line(point(0,0), point(100,0)));
  const l = d.derive("offset", [base], {d: 5});
  const r1 = d.derive("midpoint", [l]);
  const r2 = d.derive("endpoint", [l], {which: "end"});
  const join = d.derive("lineBetween", [r1, r2]);
  const rep = d.solve();
  eq(rep.order.filter(id => id === l).length, 1);
  eq(rep.order[rep.order.length-1], join, "nút gộp tính sau cùng");
});

test("chỉ tính lại phần bị ảnh hưởng", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(10,0)));
  const b = d.add(line(point(0,50), point(10,50)));
  const da = d.derive("offset", [a], {d: 1});
  const db = d.derive("offset", [b], {d: 1});
  d.solve();
  d.move(a, 0, 5);
  const r = d.solve();
  deepEq(r.updated, [da], "nhánh của b không bị đụng tới");
  eq(r.order.includes(db), false);
});

test("một quan hệ gãy không làm chết cả lần giải", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(100,0)));
  const b = d.add(line(point(50,-10), point(50,10)));
  const x = d.derive("intersection", [a, b]);
  const tick = d.derive("perpendicular", [a], {t: 0.5, len: 4});
  d.solve();
  d.set(b, line(point(50, 40), point(50, 60)));         // không còn cắt a
  const r = d.solve();
  eq(r.failed.length, 1);
  eq(r.failed[0].id, x);
  eq(d.get(x), null);
  ok(d.get(tick), "nhánh không liên quan vẫn còn giá trị");
});

test("nút dưới một nút gãy bị đánh 'chặn', không phải 'lỗi'", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(100,0)));
  const b = d.add(line(point(50,40), point(50,60)));     // không cắt a ngay từ đầu
  const x = d.derive("intersection", [a, b]);
  const after = d.derive("lineBetween", [x, d.add(point(0,0))]);
  const r = d.solve();
  deepEq(r.failed.map(f => f.id), [x]);
  deepEq(r.blocked.map(f => f.id), [after]);
  ok(d.error(after).includes("đầu vào"), d.error(after));
});

test("cả ba lớp cùng chạy: sửa đường cắt thì may, notch, grainline đều theo", () => {
  const d = createDoc();
  const cut   = d.add(sq(), {name: "đường cắt"});
  const sew   = d.derive("offset", [cut], {d: 6}, {name: "đường may"});
  const notch = d.derive("pointOn", [sew], {t: 0.25}, {name: "notch"});
  const tick  = d.derive("perpendicular", [sew], {t: 0.25, len: 5}, {name: "vạch notch"});
  const grain = d.add(line(point(40,50), point(60,50)), {name: "grainline"});
  const g     = d.derive("extendTo", [d.derive("extendTo", [grain, cut], {end: "end"}), cut], {end: "start"});

  near(bbox(d.get(sew)).x1, 94, 1e-9);
  near(d.get(g).b.x, 100, 1e-9);
  const notch0 = d.get(notch);

  d.set(cut, sq(160, 100));                              // mảnh rộng ra 60 mm
  const r = d.solve();
  eq(r.failed.length, 0);
  near(bbox(d.get(sew)).x1, 154, 1e-9, "đường may bám mép mới");
  near(d.get(g).b.x, 160, 1e-9, "grainline chạm mép mới");
  ok(Math.abs(d.get(notch).x - notch0.x) > 1, "notch chạy theo cạnh dài ra");
  near(length(d.get(tick)), 5, 1e-9, "vạch notch vẫn dài 5 mm");
});

test("undo: chụp lại nút nguồn là đủ, dẫn xuất tính lại được", () => {
  const d = createDoc();
  const cut = d.add(sq());
  const sew = d.derive("offset", [cut], {d: 6});
  const snap = d.snapshot();
  d.set(cut, sq(300, 300));
  near(bbox(d.get(sew)).x1, 294, 1e-9);
  d.restore(snap);
  near(bbox(d.get(sew)).x1, 94, 1e-9, "quay lại đúng hình cũ");
  eq(snap.length, 1, "chỉ chụp nút nguồn, không chụp thứ tính được");
});

test("trim và extend là phép sửa trên nút nguồn, phần dẫn xuất chạy theo", () => {
  const d = createDoc();
  const outline = d.add(sq());
  const long = d.add(line(point(-50,50), point(150,50)));
  const mid = d.derive("midpoint", [long]);
  near(d.get(mid).x, 50);
  d.trim(long, [outline], point(-40, 50));
  near(d.get(long).a.x, 0, 1e-9, "khúc ngoài biên bị cắt");
  near(d.get(mid).x, 75, 1e-9, "trung điểm tính lại trên đường đã cắt");
});

test("đổi tham số quan hệ cũng kéo nhánh dưới tính lại", () => {
  const d = createDoc();
  const cut = d.add(sq());
  const sew = d.derive("offset", [cut], {d: 6});
  const mid = d.derive("midpoint", [sew]);
  near(bbox(d.get(sew)).x0, 6, 1e-9);
  d.setParams(sew, {d: 12});
  const r = d.solve();
  near(bbox(d.get(sew)).x0, 12, 1e-9);
  ok(r.updated.includes(mid), "trung điểm của đường may cũng phải tính lại");
});

test("solveAll tính lại toàn bộ, dùng khi nạp file", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(10,0)));
  d.derive("offset", [a], {d: 1});
  d.derive("midpoint", [a]);
  d.solve();
  const r = d.solveAll();
  eq(r.updated.length, 2);
});

test("đồ thị lớn vẫn giải nhanh", () => {
  const d = createDoc();
  let cur = d.add(line(point(0,0), point(100,0)));
  const chain = [];
  for(let i = 0; i < 200; i++){ cur = d.derive("offset", [cur], {d: 0.1}); chain.push(cur); }
  d.solve();
  const t0 = Date.now();
  d.move(chain[0] && d.ids()[0], 1, 0);
  const r = d.solve();
  eq(r.updated.length, 200);
  ok(Date.now() - t0 < 500, "200 nút phụ thuộc chuỗi: " + (Date.now()-t0) + "ms");
});

test("createGraph: nút nguồn, nút dẫn xuất, và cờ bẩn lan xuống dưới", () => {
  const g = createGraph();
  const a = g.addSource(line(point(0,0), point(10,0)));
  const b = g.addDerived("offset", [a], {d: 1});
  const c = g.addDerived("midpoint", [b]);
  deepEq(g.dependents(a), [b]);
  deepEq(g.descendants(a).sort(), [b, c].sort());
  ok(g.isSource(a) && !g.isSource(b));
  g.dirty.clear();
  g.setValue(a, line(point(0,0), point(20,0)));
  deepEq([...g.dirty].sort(), [b, c].sort(), "sửa nguồn thì cả nhánh dưới bẩn");
});

test("createGraph: không cho xoá nút đang được nút khác dùng", () => {
  const g = createGraph();
  const a = g.addSource(line(point(0,0), point(10,0)));
  const b = g.addDerived("offset", [a], {d: 1});
  let err = "";
  try{ g.remove(a); }catch(e){ err = e.message; }
  ok(err.includes(b), err);
  g.remove(b); g.remove(a);
  eq(g.ids().length, 0);
});

test("solve() chạy trực tiếp trên graph, trả báo cáo đủ 5 phần", () => {
  const g = createGraph();
  const a = g.addSource(line(point(0,0), point(10,0)));
  g.addDerived("midpoint", [a]);
  const r = solve(g);
  deepEq(Object.keys(r).sort(), ["blocked", "failed", "ms", "order", "updated"]);
  eq(r.updated.length, 1);
  eq(solve(g).order.length, 0, "không còn gì bẩn thì không tính lại gì");
});

test("RULES: mỗi quan hệ khai đủ arity, compute và câu mô tả", () => {
  /* 14 relations until 2026-09-23; Edit's Constraint layer (edit/edit.md §5) added three */
  eq(ruleNames().length, 17);
  for(const name of ["follow", "attach", "reach"]) ok(ruleNames().includes(name), name);
  for(const name of ruleNames()){
    const r = RULES[name];
    ok(r.arity === "n" || Number.isInteger(r.arity), name + ": arity");
    eq(typeof r.compute, "function", name + ": compute");
    eq(typeof r.describe({t: 0.5, d: 6, len: 5, k: 2, dx: 1, dy: 1, which: "end", end: "end"}), "string", name);
  }
});
