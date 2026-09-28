import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, curve, length, bbox, pointAt} from "./model.js";
import {createDoc} from "./doc.js";

const sq = () => curve([[0,0],[100,0],[100,100],[0,100]], true);

test("lineBetween: đường bám hai điểm, dời điểm thì đường theo", () => {
  const d = createDoc();
  const a = d.add(point(0,0)), b = d.add(point(10,0));
  const l = d.derive("lineBetween", [a, b]);
  near(length(d.get(l)), 10);
  d.set(b, point(10, 10));
  near(length(d.get(l)), Math.hypot(10,10), 1e-9);
});

test("pointOn: notch bám cạnh theo phần trăm chiều dài", () => {
  const d = createDoc();
  const e = d.add(line(point(0,0), point(90,0)));
  const n = d.derive("pointOn", [e], {t: 1/3});
  near(d.get(n).x, 30, 1e-9);
  d.set(e, line(point(0,0), point(300,0)));
  near(d.get(n).x, 100, 1e-9, "cạnh dài ra thì notch dịch theo tỉ lệ");
});

test("midpoint và endpoint", () => {
  const d = createDoc();
  const e = d.add(line(point(0,0), point(40,0)));
  near(d.get(d.derive("midpoint", [e])).x, 20);
  near(d.get(d.derive("endpoint", [e], {which: "start"})).x, 0);
  near(d.get(d.derive("endpoint", [e], {which: "end"})).x, 40);
});

test("intersection: giao điểm là một nút, hết cắt nhau thì nút báo lỗi", () => {
  const d = createDoc();
  const a = d.add(line(point(0,0), point(100,0)));
  const b = d.add(line(point(50,-50), point(50,50)));
  const x = d.derive("intersection", [a, b]);
  near(d.get(x).x, 50);
  d.set(b, line(point(50, 40), point(50, 90)));      // nhấc ra khỏi đường a
  eq(d.get(x), null);
  ok(d.error(x).includes("không cắt nhau"), "báo đúng lý do: " + d.error(x));
});

test("offset: đường may là đường cắt lùi vào — quan hệ, không phải bản sao", () => {
  const d = createDoc();
  const cut = d.add(sq(), {name: "đường cắt"});
  const sew = d.derive("offset", [cut], {d: 6}, {name: "đường may"});
  const b = bbox(d.get(sew));
  near(b.x0, 6, 1e-9); near(b.x1, 94, 1e-9);
  d.set(cut, curve([[0,0],[200,0],[200,100],[0,100]], true));
  near(bbox(d.get(sew)).x1, 194, 1e-9, "sửa đường cắt thì đường may tự theo");
});

test("perpendicular: vạch notch vuông góc với cạnh", () => {
  const d = createDoc();
  const e = d.add(line(point(0,0), point(100,0)));
  const tick = d.get(d.derive("perpendicular", [e], {t: 0.5, len: 5}));
  near(tick.a.x, 50); near(tick.b.x, 50); near(tick.b.y, 5, 1e-9);
});

test("mirror: ảnh gương qua trục CF", () => {
  const d = createDoc();
  const half = d.add(curve([[0,0],[50,0],[50,80]]));
  const axis = d.add(line(point(0,0), point(0,100)));
  const m = d.get(d.derive("mirror", [half, axis]));
  near(m.pts[1][0], -50, 1e-9); near(m.pts[1][1], 0, 1e-9);
  near(m.pts[2][1], 80, 1e-9);
});

test("extendTo: grainline tự chạm biên mảnh, biên đổi thì chạm lại", () => {
  const d = createDoc();
  const outline = d.add(sq(), {name: "biên"});
  const grain = d.add(line(point(40,50), point(60,50)), {name: "grainline"});
  const g1 = d.derive("extendTo", [grain, outline], {end: "end"});
  const g2 = d.derive("extendTo", [g1, outline], {end: "start"});
  near(d.get(g2).a.x, 0, 1e-9); near(d.get(g2).b.x, 100, 1e-9);
  d.set(outline, curve([[0,0],[160,0],[160,100],[0,100]], true));
  near(d.get(g2).b.x, 160, 1e-9, "mảnh rộng ra, grainline dài theo");
});

test("trimTo: cắt bỏ khúc ngoài biên", () => {
  const d = createDoc();
  const outline = d.add(sq());
  const long = d.add(line(point(-50,50), point(50,50)));
  const t = d.derive("trimTo", [long, outline], {at: [-40, 50]});
  near(d.get(t).a.x, 0, 1e-9, "phần ngoài biên bị bỏ");
  near(length(d.get(t)), 50, 1e-9);
});

test("curveThrough: đường gấp khúc qua các điểm rời", () => {
  const d = createDoc();
  const ps = [point(0,0), point(50,0), point(50,50)].map(p => d.add(p));
  const c = d.derive("curveThrough", ps, {closed: false});
  near(length(d.get(c)), 100);
  d.set(ps[1], point(100, 0));                       // (0,0) → (100,0) → (50,50)
  near(length(d.get(c)), 100 + Math.hypot(50, 50), 1e-9);
});

test("projectOn và scaled/moved", () => {
  const d = createDoc();
  const e = d.add(line(point(0,0), point(100,0)));
  const p = d.add(point(30, 40));
  deepEq(d.get(d.derive("projectOn", [p, e])), point(30, 0));
  near(length(d.get(d.derive("scaled", [e], {k: 3}))), 300);
  near(d.get(d.derive("moved", [e], {dx: 5, dy: 7})).a.y, 7);
});

test("khai sai số đầu vào thì từ chối ngay, không đợi lúc giải", () => {
  const d = createDoc();
  const a = d.add(point(0,0));
  let err = "";
  try{ d.derive("lineBetween", [a]); }catch(e){ err = e.message; }
  ok(err.includes("cần 2 đầu vào"), err);
  try{ d.derive("khongCoThat", [a]); }catch(e){ err = e.message; }
  ok(err.includes("không có quan hệ"), err);
});

test("không cho sửa nút dẫn xuất — sửa nguồn của nó", () => {
  const d = createDoc();
  const a = d.add(point(0,0)), b = d.add(point(10,0));
  const l = d.derive("lineBetween", [a, b]);
  let err = "";
  try{ d.set(l, line(point(0,0), point(1,1))); }catch(e){ err = e.message; }
  ok(err.includes("dẫn xuất"), err);
});

test("quan hệ tạo vòng lặp bị chặn từ lúc khai", () => {
  const d = createDoc();
  const e = d.add(line(point(0,0), point(10,0)));
  const o1 = d.derive("offset", [e], {d: 5});
  let err = "";
  try{ d.graph.addDerived("offset", [o1], {d: 5}, {id: o1}); }catch(x){ err = x.message; }
  ok(err.includes("vòng lặp"), err);
});

test("panel quan hệ đọc được bằng tiếng người", () => {
  const d = createDoc();
  const cut = d.add(sq(), {name: "đường cắt"});
  d.derive("offset", [cut], {d: 6}, {name: "đường may"});
  const r = d.relations();
  eq(r.length, 1);
  eq(r[0].text, "lùi 6 mm");
  eq(r[0].name, "đường may");
});
