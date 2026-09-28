import {test, near} from "../../../tests/harness.js";
import {fitBox, zoomAt, zoomCentre, worldAt} from "./view.js";

const box = {x0:0, y0:0, x1:200, y1:100, w:200, h:100};

test("fitBox keeps the box centred", () => {
  const v = fitBox(box, 2, 0);
  near(v.x + v.w/2, 100); near(v.y + v.h/2, 50);
});

test("fitBox widens to the viewport ratio, never crops", () => {
  const v = fitBox(box, 4, 0);
  near(v.h, 100); near(v.w, 400, 1e-9, "a wide viewport gains width, not less height");
  const t = fitBox(box, 1, 0);
  near(t.w, 200); near(t.h, 200);
});

test("zoomCentre scales about the middle", () => {
  const v = zoomCentre({x:0, y:0, w:100, h:100}, 0.5);
  near(v.w, 50); near(v.x, 25); near(v.y, 25);
});

test("zoomAt pins the point under the cursor", () => {
  const v = zoomAt({x:0, y:0, w:100, h:100}, 0, 1, 0.5);   // bottom-left of the viewport
  near(v.x, 0); near(v.y, 0);
});

test("worldAt flips Y — screens grow down, patterns grow up", () => {
  const rect = {left:0, top:0, width:100, height:100};
  const v = {x:0, y:0, w:50, h:50};
  const [x, y] = worldAt(v, rect, 0, 0);
  near(x, 0); near(y, 50);
});
