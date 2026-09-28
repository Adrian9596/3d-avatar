import {test, eq, near, deepEq, ok} from "../../tests/harness.js";
import {dist, plen, bboxOf, unionBox, cxOf, cyOf, boxesTouch, pointInPoly} from "./geom.js";

const square = [[0,0],[100,0],[100,100],[0,100]];

test("dist is euclidean", () => near(dist([0,0],[3,4]), 5));

test("plen walks an open path, not a ring", () => near(plen([[0,0],[10,0],[10,10]]), 20));

test("bboxOf covers every point", () =>
  deepEq(bboxOf([[5,1],[-2,9]]), {x0:-2, y0:1, x1:5, y1:9, w:7, h:8}));

test("bboxOf on nothing is null", () => eq(bboxOf([]), null));

test("unionBox ignores holes in the list", () =>
  deepEq(unionBox([{x0:0,y0:0,x1:10,y1:10}, null, {x0:20,y0:-5,x1:30,y1:0}]),
         {x0:0, y0:-5, x1:30, y1:10, w:30, h:15}));

test("centres are the middle of the box", () => {
  const b = {x0:10, y0:0, x1:30, y1:100};
  near(cxOf(b), 20); near(cyOf(b), 50);
});

test("boxesTouch counts edge contact", () => {
  ok(boxesTouch({x0:0,y0:0,x1:10,y1:10}, {x0:10,y0:0,x1:20,y1:10}), "edges meeting touch");
  ok(!boxesTouch({x0:0,y0:0,x1:10,y1:10}, {x0:11,y0:0,x1:20,y1:10}), "a gap is not a touch");
});

test("pointInPoly closes the ring itself", () => {
  ok(pointInPoly(square, [50,50]), "centre is inside");
  ok(!pointInPoly(square, [150,50]), "outside is outside");
  ok(!pointInPoly(square, [-1,-1]), "below the corner is outside");
});
