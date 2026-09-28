import {test, eq, near, deepEq, ok} from "../../../tests/harness.js";
import {point, line, arc, curve} from "./model.js";
import {lineLine, lineArc, arcArc, intersect, onShape} from "./intersect.js";

test("lineLine: cắt nhau trả toạ độ và tham số trên cả hai đoạn", () => {
  const h = lineLine(line(point(0,0), point(10,0)), line(point(4,-2), point(4,6)));
  eq(h.length, 1);
  near(h[0].x, 4); near(h[0].y, 0);
  near(h[0].ta, 0.4, 1e-12); near(h[0].tb, 0.25, 1e-12);
});

test("lineLine: song song, trùng nhau, hoặc gặp nhau ngoài đoạn đều trả rỗng", () => {
  eq(lineLine(line(point(0,0), point(10,0)), line(point(0,3), point(10,3))).length, 0);
  eq(lineLine(line(point(0,0), point(10,0)), line(point(2,0), point(8,0))).length, 0, "trùng phương");
  eq(lineLine(line(point(0,0), point(10,0)), line(point(20,-5), point(20,5))).length, 0, "ngoài đoạn");
});

test("lineArc: cắt hai điểm, tiếp tuyến một điểm, hụt thì không có", () => {
  const a = arc(point(0,0), 10, 0, Math.PI);
  eq(lineArc(line(point(-20,5), point(20,5)), a).length, 2);
  eq(lineArc(line(point(-20,10), point(20,10)), a).length, 1, "tiếp tuyến ở đỉnh cung");
  eq(lineArc(line(point(-20,11), point(20,11)), a).length, 0);
  eq(lineArc(line(point(-20,-5), point(20,-5)), a).length, 0, "nửa dưới không thuộc cung");
});

test("arcArc: hai đường tròn cắt nhau, rời nhau, lồng nhau", () => {
  const full = (cx, r) => arc(point(cx,0), r, 0, 2*Math.PI*0.999);
  eq(arcArc(full(0,10), full(12,10)).length, 2);
  eq(arcArc(full(0,10), full(50,10)).length, 0, "rời nhau");
  eq(arcArc(full(0,10), full(0,3)).length, 0, "lồng nhau, không chạm");
});

test("intersect: điểm không cắt gì, và curve trả tham số trên chính curve", () => {
  eq(intersect(point(0,0), line(point(0,0), point(1,1))).length, 0);
  const sq = curve([[0,0],[100,0],[100,100],[0,100]], true);
  const h = intersect(sq, line(point(-10,50), point(110,50)));
  eq(h.length, 2);
  ok(h[0].ta >= 0 && h[0].ta <= 1 && h[0].ta < h[1].ta, "sắp theo tham số của curve");
});

test("onShape: điểm nằm trên hình hay không, theo dung sai", () => {
  const l = line(point(0,0), point(10,0));
  ok(onShape(l, point(5, 0)));
  ok(!onShape(l, point(5, 0.5)));
  ok(onShape(l, point(5, 0.001), 0.01), "dung sai nới ra thì tính là nằm trên");
});
