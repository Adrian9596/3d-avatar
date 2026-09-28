/* The gates of the kernel: checkPoint · checkShape (model.js) and components (path.js).
   CLAUDE.md §5.13 — every export named in a test; expected values by hand. */
import {test, eq, ok, deepEq} from "../../../tests/harness.js";
import {point, line, checkPoint, checkShape} from "./model.js";
import {components} from "./path.js";

const throwsWith = (fn, re) => { let m = ""; try{ fn(); }catch(e){ m = e.message; } ok(re.test(m), `cần lỗi ${re}, nhận "${m}"`); };

test("checkPoint: điểm hữu hạn đi qua nguyên vẹn", () => {
  const q = point(3, -4);
  eq(checkPoint(q), q);
});

test("checkPoint: NaN · ∞ · null · mảng đều bị từ chối, nêu rõ điểm nào", () => {
  throwsWith(() => checkPoint(point(NaN, 0), "điểm A"), /điểm A không hợp lệ/);
  throwsWith(() => checkPoint(point(0, Infinity)), /không hợp lệ/);
  throwsWith(() => checkPoint(null), /không hợp lệ.*null/);
  throwsWith(() => checkPoint([1, 2]), /không hợp lệ.*mảng/);
});

test("checkShape: line hợp lệ đi qua; line có NaN và kiểu lạ bị từ chối", () => {
  const l = line(point(0, 0), point(10, 0));
  eq(checkShape(l), l);
  throwsWith(() => checkShape(line(point(0, 0), point(NaN, 0))), /không hợp lệ/);
  throwsWith(() => checkShape({kind: "ellipse"}), /không hợp lệ/);
});

test("components: hai đường nối đuôi + một đường rời → hai nhóm", () => {
  const ends = [[[0, 0], [10, 0]], [[20, 0], [10, 0.03]], [[50, 50], [60, 60]]];
  deepEq(components(ends, 0.05), [[0, 1], [2]]);
});

/* binary fractions on purpose: 10.05 − 10 is 0.05000000000000071 in IEEE-754, a hair over
   a 0.05 tol, so "exactly tol" has to be spelled with numbers a double holds exactly */
test("components: khe lớn hơn tol thì không nối, bằng tol thì nối", () => {
  deepEq(components([[[0, 0], [8, 0]], [[8.25, 0], [16, 0]]], 0.0625), [[0], [1]]);
  deepEq(components([[[0, 0], [8, 0]], [[8.0625, 0], [16, 0]]], 0.0625), [[0, 1]]);
});
