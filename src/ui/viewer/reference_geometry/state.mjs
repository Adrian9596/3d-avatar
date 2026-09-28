/* The reference geometry measured on this body, and the shapes dragged in this
   browser: tangent handles, or a joined curve's angle and fullness, per curve,
   and points moved off their contract place (a dot slid along its line among
   them). A per-viewer convenience — the contract's values are the record — kept
   in localStorage and dropped when they no longer lie on the skin (or the line). */

import { measureCurves, measureWires, resolveLevels, measureLevels, measureShapes, measureReferenceTapes, measureLines, measureTicks, measureStraps, measurePoints, measureCurvePoints } from '../../../features/reference_geometry/index.mjs';
import { prototypeState, syncDiagnostics } from '../diagnostics.mjs';
import { landmarkValue } from '../landmark_values.mjs';
import { levelContract, measureGrid, torsoTris, marks, registry, poms } from '../measurement.mjs';

export let measuredLevels=null,measuredShapes=[],measuredTapes=[],measuredLines=[],measuredTicks=[],measuredStraps=[],measuredCurves=[],measuredPoints=[];
// Handles dragged on a curve (the cup armhole's tangents, the CF → strap
// curve's angle and fullness), per curve id. A per-viewer convenience: the
// contract's handles are the record, and one the engine finds unsound for its
// curve falls back to it.
export let curveHandles={},pointMoves={},levelMarks={};
try{
  const stored=JSON.parse(localStorage.getItem('curveHandles')||'{}');
  const ok=h=>h&&typeof h==='object'&&Object.values(h).length>0&&Object.values(h).every(Number.isFinite);
  for(const [id,handles] of Object.entries(stored||{})){
    const entries=Object.entries(handles||{});
    if(entries.length&&entries.every(([,h])=>ok(h)))curveHandles[id]=Object.fromEntries(entries.map(([key,h])=>[key,{...h}]));
  }
  // and points dragged off their contract place, as the offsets that reach them
  // (up and forward from a landmark, or up a line)
  const moved=JSON.parse(localStorage.getItem('pointMoves')||'{}');
  for(const [id,o] of Object.entries(moved||{}))if(ok(o))pointMoves[id]={...o};
}catch(error){/* private mode */}

// A curve that `curves` has gone off the skin where `before` had it on it.
const lost=(curves,before)=>curves.some((c,i)=>c.blocked&&!before[i]?.blocked);

/* A point at its new place, and every curve through it after it (and every
   dot on those curves, and every wire). False if a curve would then leave the
   skin (the point stays where it was). */
export function movePoint(next){
  if(next.blocked)return false;
  const points=measuredPoints.map(p=>p.id===next.id?next:p);
  // a curve through the point is found again (and the wires after it); else only the wires are drawn again
  const curves=measuredCurves.some(c=>c.through?.point===next.id)
    ?measureCurves(levelContract,measuredStraps,levelMarks,measureGrid,curveHandles,points,measuredLines)
    :measureWires(levelContract,measuredCurves,levelMarks,measureGrid,points);
  if(lost(curves,measuredCurves))return false;
  measuredCurves=curves;measuredPoints=measureCurvePoints(points,curves);
  return true;
}

/* A curve at its new shape (its handles dragged or put back), and every dot
   on it and every wire after it. False if a wire would then leave the skin
   (nothing changes). */
export function reshapeCurve(next){
  if(!measuredCurves.some(c=>c.id===next.id))return false;
  const curves=measureWires(levelContract,measuredCurves.map(c=>c.id===next.id?next:c),levelMarks,measureGrid,measuredPoints);
  if(lost(curves,measuredCurves))return false;
  measuredCurves=curves;measuredPoints=measureCurvePoints(measuredPoints,curves);
  return true;
}

export function saveCurveHandles(){
  try{
    localStorage.setItem('curveHandles',JSON.stringify(curveHandles));
    localStorage.setItem('pointMoves',JSON.stringify(pointMoves));
  }catch(error){/* private mode */}
}

export function syncCurveState(){
  prototypeState.curves=measuredCurves.map(c=>({id:c.id,kind:c.kind,blocked:c.blocked,
    handles:c.handles?Object.fromEntries(Object.entries(c.handles).map(([end,h])=>[end,Object.fromEntries(Object.entries(h).map(([k,v])=>[k,+v.toFixed(k==='fullness'?3:1)]))])):null,
    length_mm:Object.fromEntries(c.runs.map(r=>[r.side,+(r.length_m*1000).toFixed(1)])),
    // how far a joined curve bows below the shortest path
    ...(c.runs.some(r=>Number.isFinite(r.depth_m))?{depth_mm:Object.fromEntries(c.runs.map(r=>[r.side,+(r.depth_m*1000).toFixed(1)]))}:{}),
    // where each tangent's dot is, for automated checks
    tips_m:Object.fromEntries(c.runs.filter(r=>r.tangents).map(r=>[r.side,Object.fromEntries(r.tangents.map(t=>[t.end,t.tip.map(v=>+v.toFixed(5))]))])),
    // where a wire starts, runs lowest and ends
    ...(c.kind==='wire_curve'?{ends_m:Object.fromEntries(c.runs.map(r=>[r.side,Object.fromEntries(['from','through','to'].map(k=>[k,r[k].map(v=>+v.toFixed(5))]))]))}:{})}));
  const perSide=(p,f)=>Object.fromEntries((p.marks||[]).map(m=>[m.side,f(m)]));
  prototypeState.points=measuredPoints.map(p=>p.kind==='on_line'
    // a dot on a line: how far up it and to its top, and where (one dot, on the centre plane)
    ?{id:p.id,kind:p.kind,line:p.line,blocked:p.blocked,moved:Boolean(p.moved),up_in:+(p.up_in??0).toFixed(3),
      ...(p.at?{up_mm:+(p.up_m*1000).toFixed(1),to_top_mm:+(p.down_m*1000).toFixed(1),at_m:{C:p.at.map(v=>+v.toFixed(4))}}:{})}
    :p.kind==='on_curve'
    // a dot on each side of a curve: how far along from its end, how far on the curve goes, and where
    ?{id:p.id,kind:p.kind,curve:p.curve,end:p.end,blocked:p.blocked,along_in:p.along_in,
      along_mm:perSide(p,m=>+(m.along_m*1000).toFixed(1)),rest_mm:perSide(p,m=>+(m.rest_m*1000).toFixed(1)),
      ...(p.marks?.some(m=>Number.isFinite(m.to_through_m))?{to_through_mm:perSide(p,m=>+(m.to_through_m*1000).toFixed(1))}:{}),
      at_m:perSide(p,m=>m.point.map(v=>+v.toFixed(4)))}
    :{id:p.id,kind:p.kind,blocked:p.blocked,moved:Boolean(p.moved),
      up_in:+(p.up_in??0).toFixed(3),forward_in:+(p.forward_in??0).toFixed(3),
      at_m:Object.fromEntries((p.marks||[]).map(m=>[m.side,m.point.map(v=>+v.toFixed(4))]))});
  syncDiagnostics();
}

// Every reference kind measured on this body, with the remembered drags.
export function measureReferenceGeometry(){
  measuredLevels=null;
  if(levelContract&&torsoTris&&marks?.fold){
    const resolved=resolveLevels(levelContract,{[levelContract.datum]:marks.fold.y});
    measuredLevels=resolved.needs?resolved:measureLevels(resolved,torsoTris,{
      scan:registry.scan,maxY:levelContract.max_y_m,inchDenominator:registry.reporting.inch_denominator});
  }
  measuredShapes=levelContract&&torsoTris?measureShapes(levelContract,measuredLevels,torsoTris):[];
  // tapes hung on a POM's own height (the largest girth), not on the datum
  const heights=Object.fromEntries(Object.entries(poms||{}).map(([id,r])=>[id,r.at_y]));
  measuredTapes=levelContract&&torsoTris?measureReferenceTapes(levelContract,heights,torsoTris,{
    scan:registry.scan,maxY:levelContract.max_y_m,inchDenominator:registry.reporting.inch_denominator}):[];
  measuredLines=levelContract&&torsoTris?measureLines(levelContract,measuredLevels,measuredTapes,torsoTris,heights):[];
  measuredTicks=levelContract&&torsoTris?measureTicks(levelContract,measuredLevels,measuredTapes,torsoTris):[];
  measuredStraps=levelContract&&torsoTris?measureStraps(levelContract,measuredLevels,measuredTapes,measuredTicks,torsoTris):[];
  // curves end on a registry landmark on each side (the wing top, say), or a
  // wire follows the root round one (the apex), as the table places it
  const curveMarks=levelMarks={};
  for(const landmark of [...(levelContract?.curves||[]).flatMap(c=>[c.from.landmark,c.to.landmark,c.through?.landmark,c.root?.about?.landmark]),...(levelContract?.points||[]).map(p=>p.from?.landmark)].filter(Boolean))for(const side of ['L','R']){
    const id=`${landmark}_${side}`,p=landmarkValue(id);
    if(p&&Number.isFinite(p.x))curveMarks[id]=[p.x,p.y,p.z];
  }
  // points first (after the lines a dot may sit on): a curve may pass through
  // one. A remembered place or shape that no longer lies on the skin, or a dot
  // past the end of its line, falls back to the contract's.
  measuredPoints=levelContract&&torsoTris?measurePoints(levelContract,curveMarks,torsoTris,pointMoves,measuredLines):[];
  if(measuredPoints.some(p=>p.blocked&&pointMoves[p.id])){
    for(const p of measuredPoints)if(p.blocked)delete pointMoves[p.id];
    measuredPoints=measurePoints(levelContract,curveMarks,torsoTris,pointMoves,measuredLines);
  }
  measuredCurves=levelContract&&measureGrid?measureCurves(levelContract,measuredStraps,curveMarks,measureGrid,curveHandles,measuredPoints,measuredLines):[];
  // the points a curve is drawn through or (a wire) between
  const on=c=>[c.through?.point,c.from.point,c.to.point].filter(Boolean);
  if(measuredCurves.some(c=>c.blocked&&(curveHandles[c.id]||on(c).some(id=>pointMoves[id])))){
    for(const c of measuredCurves)if(c.blocked){delete curveHandles[c.id];for(const id of on(c))delete pointMoves[id]}
    measuredPoints=measurePoints(levelContract,curveMarks,torsoTris,pointMoves,measuredLines);
    measuredCurves=measureCurves(levelContract,measuredStraps,curveMarks,measureGrid,curveHandles,measuredPoints,measuredLines);
  }
  // and the dots on a curve, now that the curves are measured
  measuredPoints=measureCurvePoints(measuredPoints,measuredCurves);
}
