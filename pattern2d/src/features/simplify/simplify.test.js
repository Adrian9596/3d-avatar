/* Tool Simplify — luật chọn mốc phải giữ. Phép rút gọn nằm ở geometry/simplify.js
   và có bộ test riêng; ở đây chỉ kiểm phần feature tự quyết. */
import {test, eq, deepEq, ok} from "../../../tests/harness.js";
import {marksOf} from "./simplify.js";

const piece = {points: [
  {layer: "2", x: 10, y: 0},      // turn point
  {layer: "3", x: 11, y: 0},      // curve point — KHÔNG phải mốc ngữ nghĩa
  {layer: "4", x: 20, y: 0},      // notch
  {layer: "5", x: 30, y: 5},      // grade reference
  {layer: "1", x: 40, y: 0}       // đỉnh đường cắt, không phải POINT ngữ nghĩa
]};

test("giữ turn point, notch và grade point", () =>
  deepEq(marksOf(piece), [[10, 0], [20, 0], [30, 5]]));

test("curve point KHÔNG được bảo vệ — chúng chính là thứ cần bỏ bớt", () =>
  ok(!marksOf(piece).some(p => p[0] === 11)));

test("mảnh không có POINT nào thì trả danh sách rỗng, không ném lỗi", () =>
  eq(marksOf({points: []}).length, 0));

test("không có mảnh thì cũng không ném lỗi", () => eq(marksOf(null).length, 0));
