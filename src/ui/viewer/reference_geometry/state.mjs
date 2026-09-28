/* The reference geometry measured on this body, and the shapes dragged in this
   browser: tangent handles and control points per curve, and points moved off
   their contract place. A per-viewer convenience — the contract's values are
   the record — kept in localStorage and dropped when they no longer lie on the
   skin. */

import { measureCurves, resolveLevels, measureLevels, measureShapes, measureReferenceTapes, measureLines, measureTicks, measureStraps, measurePoints } from '../../../features/reference_geometry/index.mjs';
import { prototypeState, syncDiagnostics } from '../diagnostics.mjs';
import { landmarkValue } from '../landmark_values.mjs';
import { levelContract, measureGrid, torsoTris, marks, registry, poms } from '../measurement.mjs';

export let measuredLevels=null,measuredShapes=[],measuredTapes=[],measuredLines=[],measuredTicks=[],measuredStraps=[],measuredCurves=[],measuredPoints=[];
// Handles dragged on a curve (the cup armhole's tangents, a control point), per
// curve id. A per-viewer convenience: the contract's handles are the record.
export let curveHandles={},pointMoves={},levelMarks={};
try{
  const stored=JSON.parse(localStorage.getItem('curveHandles')||'{}');
  const ok=h=>Number.isFinite(h?.angle_deg)&&Number.isFinite(h?.length_mm)&&h.length_mm>0;
  for(const [id,handles] of Object.entries(stored||{})){
    const entries=Object.entries(handles||{});
    if(entries.length&&entries.every(([,h])=>ok(h)))curveHandles[id]=Object.fromEntries(entries.map(([key,h])=>[key,{angle_deg:h.angle_deg,length_mm:h.length_mm}]));
  }
  // and points dragged off their contract place, as the offsets that reach them
  const moved=JSON.parse(localStorage.getItem('pointMoves')||'{}');
  for(const [id,o] of Object.entries(moved||{}))if(Number.isFinite(o?.up_in)&&Number.isFinite(o?.forward_in))pointMoves[id]={up_in:o.up_in,forward_in:o.forward_in};
}catch(error){/* private mode */}

/* A point at its new place, and every curve through it after it. False if a
   curve would then leave the skin (the point stays where it was). */
export function movePoint(next){
  if(next.blocked)return false;
  const points=measuredPoints.map(p=>p.id===next.id?next:p);
  const curves=measureCurves(levelContract,measuredStraps,levelMarks,measureGrid,curveHandles,points,measuredLines);
  if(curves.some(c=>c.blocked&&c.through?.point===next.id))return false;
  measuredPoints=points;measuredCurves=curves;
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
    handles:c.handles?Object.fromEntries(Object.entries(c.handles).map(([end,h])=>[end,{angle_deg:+h.angle_deg.toFixed(1),length_mm:+h.length_mm.toFixed(1)}])):null,
    length_mm:Object.fromEntries(c.runs.map(r=>[r.side,+(r.length_m*1000).toFixed(1)])),
    // where each tangent's dot is, for automated checks
    tips_m:Object.fromEntries(c.runs.filter(r=>r.tangents).map(r=>[r.side,Object.fromEntries(r.tangents.map(t=>[t.end,t.tip.map(v=>+v.toFixed(5))]))]))}));
  prototypeState.points=measuredPoints.map(p=>({id:p.id,blocked:p.blocked,moved:Boolean(p.moved),
    up_in:+(p.up_in??0).toFixed(3),forward_in:+(p.forward_in??0).toFixed(3),
    at_m:Object.fromEntries((p.marks||[]).map(m=>[m.side,m.point.map(v=>+v.toFixed(4))]))}));
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
  // curves end on a registry landmark on each side (the wing top, say), as the table places it
  const curveMarks=levelMarks={};
  for(const landmark of [...(levelContract?.curves||[]).flatMap(c=>[c.from.landmark,c.to.landmark]).filter(Boolean),...(levelContract?.points||[]).map(p=>p.from.landmark)])for(const side of ['L','R']){
    const id=`${landmark}_${side}`,p=landmarkValue(id);
    if(p&&Number.isFinite(p.x))curveMarks[id]=[p.x,p.y,p.z];
  }
  // points first: a curve may pass through one. A remembered place or shape
  // that no longer lies on the skin falls back to the contract's.
  measuredPoints=levelContract&&torsoTris?measurePoints(levelContract,curveMarks,torsoTris,pointMoves):[];
  if(measuredPoints.some(p=>p.blocked&&pointMoves[p.id])){
    for(const p of measuredPoints)if(p.blocked)delete pointMoves[p.id];
    measuredPoints=measurePoints(levelContract,curveMarks,torsoTris,pointMoves);
  }
  measuredCurves=levelContract&&measureGrid?measureCurves(levelContract,measuredStraps,curveMarks,measureGrid,curveHandles,measuredPoints,measuredLines):[];
  if(measuredCurves.some(c=>c.blocked&&(curveHandles[c.id]||pointMoves[c.through?.point]))){
    for(const c of measuredCurves)if(c.blocked){delete curveHandles[c.id];if(c.through)delete pointMoves[c.through.point]}
    measuredPoints=measurePoints(levelContract,curveMarks,torsoTris,pointMoves);
    measuredCurves=measureCurves(levelContract,measuredStraps,curveMarks,measureGrid,curveHandles,measuredPoints,measuredLines);
  }
}
