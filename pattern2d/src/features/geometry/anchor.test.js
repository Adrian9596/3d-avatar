/* Anchors — how a dependent point rides on the line it belongs to (spec: edit/edit.md §5).

   Expected values are hand geometry: a point 30 mm along an edge and 6 mm off it, rotated
   90° about the edge's start, sits at (−6, 30); a seam corner of a square offset 6 mm stays
   6 mm from BOTH moved sides — checked with a plain point-to-line distance written here. */
import {test, eq, near, ok, deepEq} from "../../../tests/harness.js";
import {nearestOn, anchorAt, cornerAnchor, placeAnchor, followAnchors, followPlace, reachBuild, reachEnds, hostOf, runsWith} from "./anchor.js";
import {RULES} from "./rules.js";
import {createDoc} from "./doc.js";
import {point, line, curve} from "./model.js";

const H = pts => [{pts, closed: false}];
const RING = [[0, 0], [100, 0], [100, 100], [0, 100]];
const SEW = [[6, 6], [94, 6], [94, 94], [6, 94]];
/* signed distance from q to the line a → b, positive on its left */
const toLine = (q, a, b) => ((b[0] - a[0])*(q[1] - a[1]) - (b[1] - a[1])*(q[0] - a[0]))/Math.hypot(b[0] - a[0], b[1] - a[1]);
const same = (a, b, msg) => ok(Object.is(a[0], b[0]) && Object.is(a[1], b[1]), `${msg}: [${a}] ≠ [${b}]`);

test("nearestOn: the segment, the fraction along it, the foot and the distance", () => {
  const r = nearestOn([{pts: RING, closed: true}], [30, -6]);
  eq(r.k, 0); eq(r.i, 0); near(r.u, 0.3, 1e-12); near(r.dist, 6, 1e-12); deepEq(r.foot, [30, 0]);
});

test("nothing moved: the anchor gives back the very same numbers", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [30.123456789, 6.987654321]);
  same(placeAnchor(H([[0, 0], [100, 0]]), an), [30.123456789, 6.987654321], "seg anchor");
});

test("foot rule: only B moved → the point keeps its distance from A", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [30, 6]);
  const q = placeAnchor(H([[0, 0], [150, 0]]), an);
  near(q[0], 30, 1e-12); near(q[1], 6, 1e-12);
});

test("foot rule: only A moved → the point keeps its distance from B", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [30, 6]);
  const q = placeAnchor(H([[-50, 0], [100, 0]]), an);
  near(q[0], 30, 1e-12); near(q[1], 6, 1e-12);
});

test("foot rule: B turned 90° about A → the point turns with the edge: (30, 6) → (−6, 30)", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [30, 6]);
  const q = placeAnchor(H([[0, 0], [0, 100]]), an);
  near(q[0], -6, 1e-12); near(q[1], 30, 1e-12);
});

test("foot rule: both ends moved → proportional (a translation moves the point by the same vector)", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [30, 6]);
  const q = placeAnchor(H([[5, 7], [105, 7]]), an);
  near(q[0], 35, 1e-12); near(q[1], 13, 1e-12);
});

test("a point on a vertex rides on that vertex: the corner moves 20 mm, so does the point", () => {
  const hosts = [{pts: RING, closed: true}];
  const an = anchorAt(hosts, [100.004, 0]);
  eq(an.kind, "vertex"); eq(an.v, 1);
  const q = placeAnchor([{pts: [[0, 0], [120, 0], [100, 100], [0, 100]], closed: true}], an);
  near(q[0], 120.004, 1e-12); near(q[1], 0, 1e-12);
  eq(anchorAt(hosts, [100.02, 0]).kind, "seg", "0.02 mm off the vertex is not on it");
});

test("foot rule: the edge shrinks below the kept distance → the foot stops at the end, not beyond", () => {
  const an = anchorAt(H([[0, 0], [100, 0]]), [80, 0]);
  const q = placeAnchor(H([[0, 0], [50, 0]]), an);
  near(q[0], 50, 1e-12); near(q[1], 0, 1e-12);
});

test("corner anchor: a seam corner stays b1 from one side and b2 from the other after the corner moves", () => {
  const hosts = [{pts: RING, closed: true}];
  const an = cornerAnchor(hosts, [94, 94], 0, 2);
  const moved = [{pts: [[0, 0], [100, 0], [120, 100], [0, 100]], closed: true}];
  const q = placeAnchor(moved, an);
  near(toLine(q, [100, 0], [120, 100]), 6, 1e-9, "6 mm inside the new right side");
  near(toLine(q, [120, 100], [0, 100]), 6, 1e-9, "6 mm inside the top");
});

test("followAnchors on a square offset 6: every seam vertex is a corner anchor; unmoved → identical", () => {
  const hosts = [{pts: RING, closed: true}];
  const ans = followAnchors(hosts, SEW, true);
  eq(ans.length, 4);
  ok(ans.every(a => a.kind === "corner"), ans.map(a => a.kind).join(","));
  followPlace(hosts, ans).forEach((q, j) => same(q, SEW[j], `vertex ${j}`));
});

test("follow after a corner drag: each seam vertex stays at its own distance from both sides it follows", () => {
  const moved = [{pts: [[0, 0], [100, 0], [120, 110], [0, 100]], closed: true}];
  const out = followPlace(moved, followAnchors([{pts: RING, closed: true}], SEW, true));
  const P = moved[0].pts;
  const sides = [[P[3], P[0]], [P[0], P[1]], [P[1], P[2]], [P[2], P[3]]];
  out.forEach((q, j) => {
    near(toLine(q, ...sides[j]), 6, 1e-9, `vertex ${j}, side before`);
    near(toLine(q, ...sides[(j + 1) % 4]), 6, 1e-9, `vertex ${j}, side after`);
  });
  same(out[0], SEW[0], "the corner nobody moved keeps every bit");
});

test("follow keeps an uneven seam allowance where it is: 0 mm on one side, 6 mm on the others", () => {
  /* the bottom edge is a free edge (SA 0): its seam vertices lie on the cut line itself */
  const sew = [[0, 0], [100, 0], [94, 94], [6, 94]];
  const hosts = [{pts: RING, closed: true}];
  const moved = [{pts: [[0, 0], [100, 0], [100, 130], [0, 130]], closed: true}];
  const out = followPlace(moved, followAnchors(hosts, sew, true));
  near(toLine(out[0], [0, 0], [100, 0]), 0, 1e-9); near(toLine(out[1], [0, 0], [100, 0]), 0, 1e-9);
  near(out[2][1], 124, 1e-9, "6 mm under the raised top"); near(out[3][1], 124, 1e-9);
});

test("uneven allowance at a corner: a seam vertex nearer the OTHER side's line still rides on its own side", () => {
  /* the 3380 后比 case: 7 mm along the right side, 1.6 mm along the top. A seam vertex 4 mm below
     the seam corner is 7 from its own side but only 5.6 from the top's line — nearest is wrong */
  const seam = [[7, 7], [93, 7], [93, 50], [93, 94.4], [93, 98.4], [7, 98.4]];
  const out = followPlace([{pts: [[0, 0], [100, 0], [105, 97], [0, 100]], closed: true}],
                          followAnchors([{pts: RING, closed: true}], seam, true));
  near(toLine(out[3], [100, 0], [105, 97]), 7, 1e-9, "7 mm from the moved right side, as before");
  near(toLine(out[4], [100, 0], [105, 97]), 7, 1e-9, "the seam corner: 7 from the side …");
  near(toLine(out[4], [105, 97], [0, 100]), 1.6, 1e-9, "… and 1.6 from the top");
});

test("a seam corner over a chamfered cut corner is held by the two sides it runs along, not the chamfer", () => {
  /* the cut turns its corner in two steps (a 3 mm chamfer), the seam in one — as the 3380 后比
     cut does at its first corner */
  const cut0 = [[0, 0], [100, 0], [100, 97], [97, 100], [0, 100]];
  const cut1 = [[0, 0], [100, 0], [100, 97], [97, 110], [0, 110]];          // the top raised 10 mm
  const out = followPlace([{pts: cut1, closed: true}], followAnchors([{pts: cut0, closed: true}], SEW, true));
  near(toLine(out[2], [100, 0], [100, 97]), 6, 1e-9, "6 mm from the right side");
  near(toLine(out[2], [97, 110], [0, 110]), 6, 1e-9, "6 mm from the raised top");
});

test("a seam corner sitting ON a cut vertex (the seam joins the cut line) stays on that vertex", () => {
  /* 3380 杯面: the seam runs parallel to one side 9.5 mm in, then turns and meets the cut line
     exactly at a vertex, following it with allowance 0. Held by the two sides' lines it would
     stay where those lines cross and leave the vertex behind when the vertex moves */
  const cut0 = [[0, 0], [100, 0], [100, 90], [90, 100], [0, 100]];       // a chamfered corner
  const seam = [[10, 10], [90, 10], [90, 100], [0, 100]];               // up at x = 90, then along the top
  const cut1 = [[0, 0], [100, 0], [100, 90], [85, 100], [0, 100]];       // the chamfer's top end 5 mm left
  const out = followPlace([{pts: cut1, closed: true}], followAnchors([{pts: cut0, closed: true}], seam, true));
  near(out[2][0], 85, 1e-12); near(out[2][1], 100, 1e-12, "on the vertex, wherever it went");
});

test("runsWith: how much of a line runs WITH the cut line (±20°), and the largest allowance it runs at", () => {
  /* hand geometry: a square's 6 mm offset runs with it everywhere; a tick square to the right side
     nowhere; a line 10 mm along the bottom at 4 mm, then a 12.8 mm leg up at 38.7°, for 10/22.8 */
  const hosts = [{pts: RING, closed: true}];
  const s = runsWith(hosts, SEW, true);
  near(s.share, 1, 1e-12); near(s.allowance, 6, 1e-12);
  const tick = runsWith(hosts, [[100, 45], [92, 45]], false);
  eq(tick.share, 0); eq(tick.allowance, 0);
  const bent = runsWith(hosts, [[10, 4], [20, 4], [30, 12]], false);
  near(bent.share, 10/(10 + Math.hypot(10, 8)), 1e-12); near(bent.allowance, 4, 1e-12);
  eq(runsWith(hosts, [[5, 5], [5, 5]], false).share, 0, "a line of length 0 runs nowhere");
});

test("C8 a line along one edge rides that edge, even where its own direction runs parallel to an edge across the piece", () => {
  /* the 3380 杯口 case, drawn by hand: a line 4 mm above the bottom edge A (y = 0) whose last leg turns
     up towards (30, 12). That leg runs parallel to edge B, 20 mm away — but the line has no allowance
     of 20 mm anywhere: where it runs WITH an edge (its first leg, along A) it is 4 mm off. So the end
     rides A, 12 mm below it, and moving B does not move it */
  const d = [10/Math.hypot(10, 8), 8/Math.hypot(10, 8)], nrm = [-d[1], d[0]];
  const C = [30 + 20*nrm[0], 12 + 20*nrm[1]];                                  // on B, 20 mm from (30, 12)
  const A = {pts: [[0, 0], [100, 0]], closed: false};
  const B = {pts: [[C[0] - 50*d[0], C[1] - 50*d[1]], [C[0] + 50*d[0], C[1] + 50*d[1]]], closed: false};
  const line3 = [[10, 4], [20, 4], [30, 12]];
  const an = followAnchors([A, B], line3, false);
  eq(an[2].k, 0, `the end rides edge A (host 0), not B: ${JSON.stringify(an[2]).slice(0, 80)}`);
  const Bmoved = {pts: B.pts.map(q => [q[0], q[1] + 50]), closed: false};
  same(followPlace([A, Bmoved], an)[2], [30, 12], "B moved 50 mm: the end did not");
});

test("C8 the uneven-allowance corner still rides its own side: the parallel side is no further than the line's own allowance", () => {
  /* the same seam as the 3380 后比 test above: its own allowances are 7 (right side) and 1.6 (top), so the
     vertex 5.6 mm from the top's line and 7 mm from its own side still takes its own side */
  const seam = [[7, 7], [93, 7], [93, 50], [93, 94.4], [93, 98.4], [7, 98.4]];
  const an = followAnchors([{pts: RING, closed: true}], seam, true);
  eq(an[3].kind, "seg"); eq(an[3].i, 1, "segment 1 is the right side");
});

test("C9 reachEnds: the boundary comes in past the end's neighbour — the end slides back ALONG the line, nothing folds", () => {
  /* VeraLifting and Bianca draw inner lines with a 1 mm last segment. The left edge moves in 5 mm:
     sliding the end along that segment would put it 4 mm behind its neighbour — the line would fold
     back on itself. It walks back along the line instead, to where the line meets the new edge */
  const RING60 = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const g = curve([[0, 30], [1, 30], [80, 30]], false);
  const ends = reachBuild(g, [curve(RING60, true)]);
  eq(ends.map(e => e.end).join(), "start");
  const r = reachEnds(g, [curve([[5, 0], [100, 0], [100, 60], [5, 60]], true)], {ends});
  eq(r.pts.length, 3, "the vertex count is kept (points on the line address it by index)");
  near(r.pts[0][0], 5, 1e-9); near(r.pts[0][1], 30, 1e-9);
  near(r.pts[1][0], 5, 1e-9, "the passed vertex joins the end"); near(r.pts[1][1], 30, 1e-9);
  deepEq(r.pts[2], [80, 30]);
  /* a bent line keeps its own track: the crossing is on its second leg */
  const bent = curve([[0, 30], [1, 30], [20, 40], [80, 40]], false);
  const rb = reachEnds(bent, [curve([[5, 0], [100, 0], [100, 60], [5, 60]], true)], {ends: reachBuild(bent, [curve(RING60, true)])});
  near(rb.pts[0][0], 5, 1e-9); near(rb.pts[0][1], 30 + 40/19, 1e-9, "on the leg (1,30)→(20,40), at x = 5");
  /* moving OUT is the plain slide along the last segment, as before */
  const o = reachEnds(g, [curve([[-5, 0], [100, 0], [100, 60], [-5, 60]], true)], {ends});
  near(o.pts[0][0], -5, 1e-9); deepEq(o.pts.slice(1), [[1, 30], [80, 30]]);
  /* past the whole line: nothing of it touches the boundary — an error (C6), not a guess */
  let err = null;
  try{ reachEnds(g, [curve([[90, 0], [100, 0], [100, 60], [90, 60]], true)], {ends}); }catch(e){ err = e; }
  ok(err && /biên/.test(err.message), err && err.message);
});

test("C9 a grainline in a 6 mm strip: the top goes up 8 mm — the grainline follows it up, not down to the bottom edge that is now nearer its old end", () => {
  /* a strap or a binding: the grainline runs from 1 mm above the bottom to the top edge. Raised 8 mm,
     the top is 8 mm from where the end was and the bottom only 6 — "nearest to where it was" took
     the bottom, behind the other end, and turned the grainline round. The end only goes to crossings
     on its own side of the line. Expected by construction */
  const strip = [[0, 0], [100, 0], [100, 6], [0, 6]], raised = [[0, 0], [100, 0], [100, 14], [0, 14]];
  const g = line(point(50, 1), point(50, 6));
  const ends = reachBuild(g, [curve(strip, true)]);
  eq(ends.map(e => e.end).join(), "end");
  const r = reachEnds(g, [curve(raised, true)], {ends});
  same([r.a.x, r.a.y], [50, 1], "the start touches nothing: it stays");
  near(r.b.x, 50, 1e-12); near(r.b.y, 14, 1e-9, "up to the raised top");
  /* a line ending at a corner that is dragged out and down: its end goes along its own direction to
     the moved edge — (80,30) → (100,60), corner to (104,57): edge (104,57)→(0,60) at u = 6/106 */
  const diag = line(point(80, 30), point(100, 60)), R60 = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const e2 = reachBuild(diag, [curve(R60, true)]);
  const r2 = reachEnds(diag, [curve([[0, 0], [100, 0], [104, 57], [0, 60]], true)], {ends: e2});
  const u = 6/106;
  near(r2.b.x, 104 - 104*u, 1e-9); near(r2.b.y, 57 + 3*u, 1e-9);
});

test("C9 a line across an 8 mm strap (SofyLift): the strap shifts 4.2 mm along it — each end stays on ITS side", () => {
  /* both ends reach. Shifted by 4.2 mm — more than half the width — the far side is nearer the old end
     than its own side is: "nearest" put both ends on one side and the line vanished. An end rides the
     part of the cut line it was on, as a notch rides its segment. Expected by construction */
  const strap = [[0, 0], [100, 0], [100, 8], [0, 8]], shifted = strap.map(q => [q[0], q[1] + 4.2]);
  const g = line(point(50, 0), point(50, 8));
  const ends = reachBuild(g, [curve(strap, true)]);
  eq(ends.map(e => e.end).join(), "start,end");
  const r = reachEnds(g, [curve(shifted, true)], {ends});
  near(r.a.x, 50, 1e-12); near(r.a.y, 4.2, 1e-9, "the start on the bottom side");
  near(r.b.x, 50, 1e-12); near(r.b.y, 12.2, 1e-9, "the end on the top side");
});

test("C9 a grainline (two points) whose boundary passes its other end fails instead of turning round", () => {
  const g = line(point(50, 0), point(50, 30));
  const ends = reachBuild(g, [curve(RING, true)]);
  eq(ends.map(e => e.end).join(), "start");
  let err = null;
  try{ reachEnds(g, [curve([[0, 40], [100, 40], [100, 100], [0, 100]], true)], {ends}); }catch(e){ err = e; }
  ok(err && /biên/.test(err.message), err && err.message);
});

test("reachEnds: a grainline touching the top and bottom follows them when they move", () => {
  const g = line(point(50, 0), point(50, 100));
  const ends = reachBuild(g, [curve(RING, true)]);
  eq(ends.length, 2);
  const up = reachEnds(g, [curve([[0, 0], [100, 0], [100, 120], [0, 120]], true)], {ends});
  near(up.a.x, 50, 1e-12); near(up.a.y, 0, 1e-12); near(up.b.x, 50, 1e-12); near(up.b.y, 120, 1e-9);
  const down = reachEnds(g, [curve([[0, 0], [100, 0], [100, 80], [0, 80]], true)], {ends});
  near(down.b.y, 80, 1e-9, "trimmed back to a lower top");
});

test("reachBuild: an end on the boundary whose own line crosses it elsewhere is not a reach end", () => {
  /* a line lying ALONG the bottom edge, 6 mm short of each corner: on the cut line, but its
     direction meets the boundary 6 mm further on — that is riding the edge, not reaching it */
  eq(reachBuild(line(point(6, 0), point(94, 0)), [curve(RING, true)]).length, 0);
});

test("reachEnds: nothing changed → the same end, bit for bit", () => {
  const g = line(point(50, 0.004), point(50, 99.996));            // within 0.01 of the boundary
  const ends = reachBuild(g, [curve(RING, true)]);
  const r = reachEnds(g, [curve(RING, true)], {ends});
  same([r.a.x, r.a.y], [50, 0.004], "start"); same([r.b.x, r.b.y], [50, 99.996], "end");
});

test("reachEnds: the boundary gone from its path → an error, not a guess", () => {
  const g = line(point(50, 0), point(50, 100));
  const ends = reachBuild(g, [curve(RING, true)]);
  let err = null;
  try{ reachEnds(g, [curve([[500, 500], [600, 500], [600, 600]], true)], {ends}); }catch(e){ err = e; }
  ok(err && /biên/.test(err.message), err && err.message);
});

test("rules follow · attach · reach run through the doc and the solver like any other relation", () => {
  const doc = createDoc();
  const cut = doc.add(curve(RING, true), {name: "cut"});
  const sew = doc.derive("follow", [cut], {anchors: followAnchors([{pts: RING, closed: true}], SEW, true), closed: true});
  const notch = doc.derive("attach", [cut], {anchor: anchorAt([{pts: RING, closed: true}], [40, 0])});
  const g0 = line(point(50, 0), point(50, 100));
  const grain = doc.add(g0);
  const fit = doc.derive("reach", [grain, cut], {ends: reachBuild(g0, [curve(RING, true)])});
  doc.solve();
  doc.set(cut, curve([[0, 0], [100, 0], [100, 150], [0, 150]], true));
  const r = doc.solve();
  eq(r.failed.length, 0, JSON.stringify(r.failed));
  near(doc.get(sew).pts[2][1], 144, 1e-9); near(doc.get(notch).x, 40, 1e-12); near(doc.get(notch).y, 0, 1e-12);
  near(doc.get(fit).b.y, 150, 1e-9);
  ok(RULES.follow && RULES.attach && RULES.reach, "the three rules are in the library");
});

test("invalid: an anchor on a host that is not a polyline or a line is refused", () => {
  let bad = null;
  try{ hostOf(point(1, 2)); }catch(e){ bad = e; }
  ok(bad && /polyline/.test(bad.message), bad && bad.message);
  let err = null;
  try{ placeAnchor([{pts: [[0, 0]], closed: false}], {kind: "seg", k: 0, i: 3}); }catch(e){ err = e; }
  ok(err && /đoạn/.test(err.message), err && err.message);
});

test("C13 a seam tip in a narrow V of the cut line is held by BOTH sides: one side moved, the tip keeps 5 mm to each", () => {
  /* a tab 16 wide and 60 tall on the top edge: sides (40,60)→(48,120) and (48,120)→(56,60), 15.2° apart. The seam runs
     up one side and back down the other at 5 mm, its tip on the axis 5/sin θ below the tab's tip (sin θ = 8/√3664) —
     hand geometry. The left side's foot moves out to (37,60): the tip must stay 5 mm from the moved side AND the other */
  const TAB = [[0, 0], [100, 0], [100, 60], [56, 60], [48, 120], [40, 60], [0, 60]], r = Math.sqrt(3664);
  const nL = [60/r, -8/r], nR = [-60/r, -8/r];
  const A = [40 + 0.8 + 5*nL[0], 66 + 5*nL[1]], T = [48, 120 - 5*r/8], B = [56 - 0.8 + 5*nR[0], 66 + 5*nR[1]];
  near(Math.abs(toLine(T, [40, 60], [48, 120])), 5, 1e-12, "the tip, by construction"); near(Math.abs(toLine(T, [48, 120], [56, 60])), 5, 1e-12);
  const anchors = followAnchors([{pts: TAB, closed: true}], [A, T, B], false);
  const moved = TAB.map(q => q.slice()); moved[5] = [37, 60];
  const [A2, T2, B2] = followPlace([{pts: moved, closed: true}], anchors);
  near(Math.abs(toLine(T2, [37, 60], [48, 120])), 5, 1e-9, "tip → the moved side");
  near(Math.abs(toLine(T2, [48, 120], [56, 60])), 5, 1e-9, "tip → the side that stayed");
  near(Math.abs(toLine(A2, [37, 60], [48, 120])), 5, 1e-9, "the arm along the moved side");
  same(B2, B, "the arm along the side that stayed does not move");
});

/* ── C14: a line between two edges is not torn apart ──────────────────────────────────────────── */
/* a strap 200 long and 24 wide; a sew line down its middle, every 10 mm from x = 20 to 180 — at 11.9 mm from the
   bottom edge, except x = 90…110 at 12.1 (0.1 mm nearer the TOP edge). Hand geometry: the whole line is within 0.2 mm
   of the middle, "which edge" is a tie everywhere */
const STRAP = [[0, 0], [200, 0], [200, 24], [0, 24]];
const middle = (dip = 12.1) => Array.from({length: 17}, (_, k) => [20 + 10*k, k >= 7 && k <= 9 ? dip : 11.9]);
test("C14 a line down the middle of a strap is not torn: the top edge tilts, the line rides the bottom edge as one", () => {
  /* the corner (200,24) goes up 6 mm: only the top edge moves. Before, x = 90…110 rode the top edge and went up
     with it while their neighbours stayed: a kink. Riding the side their neighbours ride, nothing moves at all */
  const V = middle(), anchors = followAnchors([{pts: STRAP, closed: true}], V, false);
  const moved = STRAP.map(q => q.slice()); moved[2] = [200, 30];
  const V2 = followPlace([{pts: moved, closed: true}], anchors);
  V2.forEach((q, k) => same(q, V[k], `x = ${V[k][0]}`));
});
test("C14 where the line is clearly nearer the other edge it still follows that edge", () => {
  /* the same line, but x = 90…110 at 20 mm — 4 mm from the top, 20 from the bottom: not a tie. They follow the top
     edge up (2.7–3.3 mm at x = 90…110 on the tilted edge), the rest stays */
  const V = middle(20), anchors = followAnchors([{pts: STRAP, closed: true}], V, false);
  const moved = STRAP.map(q => q.slice()); moved[2] = [200, 30];
  const V2 = followPlace([{pts: moved, closed: true}], anchors);
  [7, 8, 9].forEach(k => near(Math.abs(toLine(V2[k], [200, 30], [0, 24])), 4, 1e-9, `x = ${V[k][0]} keeps 4 mm to the top`));
  V2.forEach((q, k) => { if(k < 7 || k > 9) same(q, V[k], `x = ${V[k][0]}`); });
});

test("C14 a hairpin between two edges: its turn, held by the far edge on one arm, does not carry the turn off", () => {
  /* as SN1252 draws its line: down the strap's middle along y = 11.9, the last stretch before the turn a hair nearer
     the TOP edge — (90, 12.2), (100, 12.3) — the turn (104, 12), then back along y = 11.9. From its own middle the arm
     into the turn runs with the top edge and the arm out of it with the bottom one: the turn is held by the two edges
     of the strap, far apart along the cut line. Everything is within 0.3 mm of the middle — a tie, so the stretch rides
     the edge its neighbours ride, and tilting the top edge moves nothing */
  const out = Array.from({length: 7}, (_, k) => [20 + 10*k, 11.9]), back = Array.from({length: 9}, (_, k) => [100 - 10*k, 11.9]);
  const V = [...out, [90, 12.2], [100, 12.3], [104, 12], ...back], anchors = followAnchors([{pts: STRAP, closed: true}], V, false);
  const moved = STRAP.map(q => q.slice()); moved[2] = [200, 30];
  const V2 = followPlace([{pts: moved, closed: true}], anchors);
  V2.forEach((q, k) => same(q, V[k], `vertex ${k} (${V[k]})`));
});
