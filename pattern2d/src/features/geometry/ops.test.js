import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, arc, curve, length, pointAt, bbox} from "./model.js";
import {intersect} from "./intersect.js";
import {move, scale, rotate, offset, trim, extend, measure, angleBetween, prune} from "./ops.js";

const square = curve([[0,0],[100,0],[100,100],[0,100]], true);   // ngược chiều KĐH

test("move và scale", () => {
  deepEq(move(point(1,1), 5, -2), point(6,-1));
  near(length(scale(line(point(0,0), point(10,0)), 2.5, point(0,0))), 25);
});

test("xoay quanh một gốc bất kỳ", () => {
  const r = rotate(point(10,0), Math.PI/2, point(0,0));
  near(r.x, 0, 1e-9); near(r.y, 10, 1e-9);
});

test("offset đoạn thẳng đi về phía trái", () => {
  const o = offset(line(point(0,0), point(100,0)), 6);
  near(o.a.y, 6); near(o.b.y, 6);
  near(offset(line(point(0,0), point(100,0)), -6).a.y, -6);
});

test("offset cung ngược KĐH thì bán kính co lại", () => {
  near(offset(arc(point(0,0), 50, 0, Math.PI/2), 6).r, 44);
  near(offset(arc(point(0,0), 50, 0, Math.PI/2, false), 6).r, 56, 1e-9, "cùng chiều KĐH thì nở ra");
});

test("offset khung kín: đường may lùi đều vào trong", () => {
  const inner = offset(square, 6);                       // 6 mm — seam allowance của project
  const b = bbox(inner);
  near(b.x0, 6, 1e-9); near(b.y0, 6, 1e-9);
  near(b.x1, 94, 1e-9); near(b.y1, 94, 1e-9);
  eq(inner.closed, true);
});

test("giao điểm: hai đoạn cắt nhau, song song thì không", () => {
  const h = intersect(line(point(0,0), point(10,0)), line(point(5,-5), point(5,5)));
  eq(h.length, 1); near(h[0].x, 5); near(h[0].y, 0); near(h[0].ta, 0.5);
  eq(intersect(line(point(0,0), point(10,0)), line(point(0,1), point(10,1))).length, 0);
});

test("giao điểm đoạn thẳng với cung: hai điểm", () => {
  const h = intersect(line(point(-20,5), point(20,5)), arc(point(0,0), 10, 0, Math.PI));
  eq(h.length, 2);
  for(const p of h) near(Math.hypot(p.x, p.y), 10, 1e-9);
});

test("giao hai cung", () => {
  const h = intersect(arc(point(0,0), 10, 0, 2*Math.PI*0.999),
                      arc(point(12,0), 10, 0, 2*Math.PI*0.999));
  eq(h.length, 2);
  near(h[0].x, 6, 1e-9);
});

test("giao với polyline trả tham số trên chính polyline", () => {
  const h = intersect(square, line(point(-10,50), point(110,50)));
  eq(h.length, 2, "cắt hai cạnh đứng");
  ok(h[0].ta < h[1].ta, "sắp theo tham số");
});

test("trim bỏ đúng khúc chứa điểm bấm", () => {
  const l = line(point(0,0), point(100,0));
  const cutters = [line(point(30,-5), point(30,5)), line(point(70,-5), point(70,5))];
  const r = trim(l, cutters, point(50,0));
  eq(r.kept.length, 2);
  near(length(r.removed), 40, 1e-9);
  near(length(r.kept[0]), 30, 1e-9);
  near(length(r.kept[1]), 30, 1e-9);
});

test("trim ở khúc đầu chỉ còn một mảnh", () => {
  const l = line(point(0,0), point(100,0));
  const r = trim(l, [line(point(30,-5), point(30,5))], point(5,0));
  eq(r.kept.length, 1);
  near(length(r.kept[0]), 70, 1e-9);
});

test("không có vật chặn thì trim không cắt gì", () => {
  const l = line(point(0,0), point(100,0));
  const r = trim(l, [line(point(0,10), point(100,10))], point(50,0));
  eq(r.kept.length, 1); eq(r.removed, null);
  near(length(r.kept[0]), 100);
});

test("extend kéo dài tới vật chặn gần nhất", () => {
  const l = line(point(0,0), point(40,0));
  const e = extend(l, [line(point(70,-10), point(70,10)), line(point(90,-10), point(90,10))], "end");
  near(e.b.x, 70, 1e-9, "dừng ở vật chặn gần nhất, không phải xa nhất");
  near(length(e), 70, 1e-9);
});

test("extend đầu kia đi ngược lại", () => {
  const e = extend(line(point(0,0), point(40,0)), [line(point(-25,-10), point(-25,10))], "start");
  near(e.a.x, -25, 1e-9);
});

test("extend grainline ra tới biên mảnh — đúng việc của rập", () => {
  const grain = line(point(40,50), point(60,50));
  const e = extend(extend(grain, [square], "end"), [square], "start");
  near(e.a.x, 0, 1e-9); near(e.b.x, 100, 1e-9);
});

test("không chạm được thì extend giữ nguyên", () => {
  const l = line(point(0,0), point(10,0));
  deepEq(extend(l, [line(point(0,50), point(100,50))], "end"), l);
});

test("measure: điểm–điểm, điểm–hình, hình–hình", () => {
  near(measure(point(0,0), point(3,4)).distance, 5);
  near(measure(point(50,30), line(point(0,0), point(100,0))).distance, 30);
  near(measure(line(point(0,0), point(100,0)), line(point(0,25), point(100,25))).distance, 25, 0.6);
  near(measure(line(point(0,0), point(10,0)), line(point(5,-5), point(5,5))).distance, 0, 1e-9, "cắt nhau thì bằng 0");
});

test("góc giữa hai đường", () => {
  near(angleBetween(line(point(0,0), point(10,0)), line(point(0,0), point(0,10))), Math.PI/2, 1e-9);
  near(angleBetween(line(point(0,0), point(10,0)), line(point(5,3), point(15,3))), 0, 1e-9);
});

test("prune bỏ đúng những đỉnh offset lọt vào vùng không hợp lệ", () => {
  const src = line(point(0,0), point(100,0));
  /* ba đỉnh: hai cái cách 10, một cái chỉ cách 2 — cái giữa là vòng thừa */
  const pts = [[0,10],[50,2],[100,10]];
  const kept = prune(pts, src, 10, {min: 2});   // đường hở: còn 2 đỉnh là hợp lệ
  eq(kept.length, 2);
  deepEq(kept, [[0,10],[100,10]]);
});

test("prune không dám dọn khi ring sẽ còn dưới 3 đỉnh — thà giữ nguyên", () => {
  const src = line(point(0,0), point(100,0));
  const pts = [[10,1],[50,1],[90,1]];          // cả ba đều nằm trong vùng hỏng
  deepEq(prune(pts, src, 10), pts, "ring: ngưỡng mặc định là 3 đỉnh");
});
