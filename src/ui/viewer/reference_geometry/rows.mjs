/* The reference geometry's rows in the measurement table: the levels drawn as
   tapes, the tapes hung on a POM's height, and what stands on them (lines,
   ticks, straps, curves, points). Curve and point rows are rewritten in place
   while a dot is dragged, so the selection holds. */

import { inchFraction } from '../../../core/measure_core.mjs';
import { measurePoint, bendCurve } from '../../../features/reference_geometry/index.mjs';
import { HANDLE_COLOR } from '../draw.mjs';
import { CM } from '../format.mjs';
import { registry, levelContract, torsoTris, measureGrid } from '../measurement.mjs';
import { measuredLevels, measuredShapes, measuredLines, measuredTapes, measuredTicks, measuredStraps, measuredCurves, measuredPoints, pointMoves, levelMarks, movePoint, saveCurveHandles, syncCurveState, curveHandles } from './state.mjs';
import { selectableTape, measureRowData, redrawTapes } from '../table.mjs';

let curveRowEls={},pointRowEls={};

/* Reference levels marked "tape": true in contracts/measurement-levels.json, as
   red tapes and table rows under the underbust, like the POMs. They are levels,
   not POMs: the girth is the shared engine's section at that height
   (measureLevels), they have no house code and no POM-sheet row. */
function renderTapeLevelRows(tbody){
  if(!measuredLevels||measuredLevels.needs)return;
  const taped=measuredLevels.levels.filter(l=>l.tape).sort((a,b)=>b.offset_in-a.offset_in);
  for(const level of taped){
    const tr=document.createElement('tr');
    const label='Fold '+level.label_in;
    const inches=level.label_in.replace(/^[+-]/,'');
    tr.title='Reference level: the girth '+inches+(level.offset_in<0?' below':' above')
      +' the underbust fold. A level, not a POM — no house code, not in the POM sheet.';
    if(level.girth_m===null){
      tr.className='landmark';
      tr.innerHTML=`<td>${label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
      tr.title+=' '+(level.blocked||'');
      tbody.appendChild(tr);
      continue;
    }
    tr.setAttribute('aria-selected','false');
    tr.innerHTML=`<td>${label}</td><td class="val">${CM(level.girth_m)}</td>`
      +`<td class="in">${inchFraction(level.girth_m,registry.reporting.inch_denominator)}</td>`;
    selectableTape(tr,tbody);
    tbody.appendChild(tr);
    measureRowData.push({label,section:level.section});
    for(const shape of measuredShapes.filter(s=>s.level===level.id))renderShapeRow(shape,tbody);
    for(const line of measuredLines.filter(l=>l.from===level.id))renderLineRow(line,tbody);
  }
}

/* Reference tapes hung on a POM's height (contracts/measurement-levels.json
   "reference_tapes"), listed under that POM. Above the armhole the torso is
   open, so such a tape has no girth: the row says why and gives the front and
   back pieces' lengths on hover, and the pieces are drawn on the skin. */
function renderReferenceTapeRows(fromId,tbody){
  const den=registry.reporting.inch_denominator;
  const tapes=measuredTapes.filter(t=>t.from===fromId).sort((a,b)=>Math.abs(a.offset_in)-Math.abs(b.offset_in));
  for(const tape of tapes){
    const tr=document.createElement('tr');
    tr.title=`Reference tape ${Math.abs(tape.offset_in)}" ${tape.offset_in>0?'above':'below'} ${fromId}`
      +(tape.y_m!==null?` (y = ${tape.y_m.toFixed(3)} m)`:'')+'. A reference, not a POM.';
    if(tape.blocked){
      tr.className='landmark';
      tr.innerHTML=`<td>${tape.label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
      tr.title+=` No girth: ${tape.blocked}.`;
      if(tape.pieces_m?.length){
        tr.title+=' On the skin: '+tape.chains.map((c,i)=>{
          const z=c.reduce((sum,p)=>sum+p[2],0)/c.length;
          return `${z>0?'front':'back'} ${CM(tape.pieces_m[i])} cm (${inchFraction(tape.pieces_m[i],den)})`;
        }).join(', ')+'.';
      }
    }else{
      tr.innerHTML=`<td>${tape.label}</td><td class="val">${CM(tape.girth_m)}</td><td class="in">${tape.girth_in}</td>`;
    }
    if(!tape.chains.length&&!tape.section){tbody.appendChild(tr);continue}
    tr.setAttribute('aria-selected','false');
    selectableTape(tr,tbody);
    tbody.appendChild(tr);
    measureRowData.push(tape.section?{label:tape.label,section:tape.section}:{label:tape.label,paths:tape.chains});
  }
  // lines that start on one of these tapes (or on the POM itself) follow them
  const ids=new Set(tapes.map(t=>t.id));
  for(const line of measuredLines.filter(l=>ids.has(l.from)||l.from===fromId))renderLineRow(line,tbody);
  for(const tick of measuredTicks.filter(t=>ids.has(t.on)))renderTickRow(tick,tbody);
  const tickIds=new Set(measuredTicks.filter(t=>ids.has(t.on)).map(t=>t.id));
  for(const strap of measuredStraps.filter(s=>tickIds.has(s.from))){
    renderStrapRow(strap,tbody);
    const listed=new Set();
    for(const curve of measuredCurves.filter(c=>c.from.strap===strap.id||c.to.strap===strap.id)){
      renderCurveRows(curve,tbody);
      // points hung on a landmark the curve ends at (the armhole's wing top) follow it
      const ends=new Set([curve.from.landmark,curve.to.landmark].filter(Boolean));
      for(const point of measuredPoints.filter(p=>ends.has(p.from.landmark)&&!listed.has(p.id))){listed.add(point.id);renderPointRow(point,tbody)}
    }
  }
}

/* The reference geometry's rows under a POM's row: the levels drawn as tapes
   under the underbust, and whatever hangs on that POM's own height. */
export function listReferenceRows(spec,tbody){
  if(spec.id==='BODY_UNDERBUST_GIRTH')renderTapeLevelRows(tbody);
  renderReferenceTapeRows(spec.id,tbody);
}

/* A point offset from a landmark ("points" in contracts/measurement-levels.json),
   such as the armhole point the cup armhole passes through: a dot on each side.
   Select its row (or an armhole row) and drag a dot on the body to move it; both
   sides follow, mirrored, the row reads the up and forward offsets that reach
   the new place, and ↺ puts it back where the contract has it. */
function renderPointRow(point,tbody){
  const tr=document.createElement('tr');
  if(point.blocked){
    tr.className='landmark';
    tr.innerHTML=`<td>${point.label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
    tr.title=`${point.label}: ${point.blocked}`;
    tbody.appendChild(tr);
    return;
  }
  tr.setAttribute('aria-selected','false');
  tr.innerHTML=`<td><span style="color:${point.colour}">●</span> ${point.label} <span class="angle"></span> <button type="button" class="curve-reset" aria-label="Put the point back">↺</button></td><td class="val"></td><td class="in"></td>`;
  tr.querySelector('button').addEventListener('click',event=>{event.stopPropagation();resetPoint(point.id)});
  selectableTape(tr,tbody);
  tbody.appendChild(tr);
  pointRowEls[point.id]={tr,index:measureRowData.length};
  measureRowData.push({label:point.label,paths:[],dots:[],color:parseInt(point.colour.slice(1),16),point:point.id});
  updatePointRow(point);
}

function updatePointRow(point){
  const el=pointRowEls[point.id];
  if(!el||point.blocked)return;
  const den=registry.reporting.inch_denominator;
  const inch=v=>(v<0?'−':'')+inchFraction(Math.abs(v)*0.0254,den).replace(/^0 /,'');
  const m=point.marks[0];
  el.tr.querySelector('.angle').textContent=`↑${inch(point.up_in)} →${inch(point.forward_in)}`;
  el.tr.querySelector('button').hidden=!point.moved;
  el.tr.title=`${inch(point.up_in)} up the skin from ${point.from.landmark}_L/R, then ${inch(point.forward_in)} forward along the level section`
    +` (on the skin: up ${CM(m.up_m)} cm, forward ${CM(m.forward_m)} cm).`
    +(point.moved?' Moved here by dragging; ↺ puts it back.':' Where the contract puts it.')
    +' Select this row and drag a dot on the body to move it; both sides follow.';
  const row=measureRowData[el.index];
  row.dots=point.marks.map(k=>k.point);row.grabs=point.marks.map(k=>({kind:'point',id:point.id,side:k.side,at:k.point}));
}

function resetPoint(id){
  const def=(levelContract?.points||[]).find(p=>p.id===id);
  if(!def)return;
  delete pointMoves[id];
  const next=measurePoint(def,levelMarks,torsoTris,null);
  if(movePoint(next))showMovedPoint(next);
  saveCurveHandles();syncCurveState();
}

// The rows and tapes after a point moved: its own row and every curve's.
export function showMovedPoint(point){
  updatePointRow(point);
  for(const c of measuredCurves)updateCurveRows(c);
  redrawTapes();
}

/* A curve on the skin ("curves" in contracts/measurement-levels.json), such as
   the cup armhole: one row per side with its length on the skin. A
   "tangent_curve" is shaped by two tangent handles, a "control_curve" by one
   control point: select a side's row and drag the round dots on the body; the
   handles shape both sides, mirrored, and every number here follows the drag. */
function curveEndText(end,side){
  if(end.strap)return `the strap's ${end.corner.replace('_',' ')} corner`;
  if(end.line)return `the ${end.end} of the ${measuredLines.find(l=>l.id===end.line)?.kind==='centre_front'?'CF':'CB'} line`;
  return `${end.landmark}_${side}`;
}
function renderCurveRows(curve,tbody){
  const den=registry.reporting.inch_denominator;
  const shaped=curve.kind==='tangent_curve'||curve.kind==='control_curve';
  const els=curveRowEls[curve.id]={sides:{},handles:{}};
  for(const side of ['L','R']){
    const label=`${curve.label} ${side}`;
    const tr=document.createElement('tr');
    tr.title=`From ${curveEndText(curve.from,side)} to ${curveEndText(curve.to,side)}, `
      +(curve.kind==='control_curve'?'shaped by one control point: select this row, then drag the green dot on the body.'
        :shaped?`${curve.through?'through the armhole point, ':''}shaped by two tangent handles: select this row, then drag the green dots (tangents) or the blue dot (the point) on the body.`:'the shortest path over the skin.');
    const run=curve.runs.find(r=>r.side===side);
    if(curve.blocked||!run){
      tr.className='landmark';
      tr.innerHTML=`<td>${label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
      tr.title+=' '+(curve.blocked||'');
      tbody.appendChild(tr);
      continue;
    }
    tr.setAttribute('aria-selected','false');
    tr.innerHTML=`<td><span style="color:${curve.colour}">▮</span> ${label}</td><td class="val"></td><td class="in"></td>`;
    selectableTape(tr,tbody);
    tbody.appendChild(tr);
    els.sides[side]={tr,index:measureRowData.length,title:tr.title};
    measureRowData.push({label,paths:[run.points],color:parseInt(curve.colour.slice(1),16),curve:curve.id,side,tangents:null,grabs:[]});
  }
  const handleRows=curve.kind==='control_curve'
    ?[['control','Control',`The control point: its distance from ${curveEndText(curve.from,'L')}, and its angle from the shortest path over the skin toward ${curveEndText(curve.to,'L')} (positive turns it up). The curve bends toward it. Drag its dot on the body to change it; ↺ puts it back to the contract's.`]]
    :[['from','Tangent at strap'],['to','Tangent at wing']].map(([end,name])=>[end,name,
      `The tangent handle ${name.slice(8)}: its length, and its angle from the shortest path over the skin toward the ${curve.through?'armhole point':'other end'} (positive turns it up toward the shoulder). Drag its dot on the body to change it; ↺ puts both handles back to the contract's.`]);
  if(shaped&&!curve.blocked)for(const [k,[end,name,title]] of handleRows.entries()){
    const tr=document.createElement('tr');
    tr.title=title;
    // one reset for all the curve's handles, on the first handle's row
    const reset=k===0?' <button type="button" class="curve-reset" aria-label="Reset the handles">↺</button>':'';
    tr.innerHTML=`<td class="tangent"><span style="color:#${HANDLE_COLOR.toString(16).padStart(6,'0')}">↳</span> ${name} <span class="angle"></span>${reset}</td><td class="val"></td><td class="in"></td>`;
    tr.querySelector('button')?.addEventListener('click',event=>{event.stopPropagation();resetCurveHandles(curve.id)});
    tbody.appendChild(tr);
    els.handles[end]=tr;
  }
  updateCurveRows(curve);
}

/* The numbers in a curve's rows, rewritten in place while a handle is dragged
   (the table is not rebuilt, so the selection holds). */
export function updateCurveRows(curve){
  const den=registry.reporting.inch_denominator;
  const els=curveRowEls[curve.id];
  if(!els)return;
  const base=(levelContract?.curves||[]).find(c=>c.id===curve.id)?.handles;
  const moved=Boolean(base&&curve.handles&&Object.keys(base).some(end=>
    Math.abs(curve.handles[end].angle_deg-base[end].angle_deg)>0.05||Math.abs(curve.handles[end].length_mm-base[end].length_mm)>0.05));
  for(const run of curve.runs){
    const el=els.sides[run.side];
    if(!el)continue;
    el.tr.querySelector('.val').textContent=CM(run.length_m);
    el.tr.querySelector('.in').textContent=inchFraction(run.length_m,den);
    const row=measureRowData[el.index];
    row.paths=[run.points];row.tangents=run.tangents||null;
    row.dots=run.through?[run.through]:[];
    row.grabs=[...(run.tangents||[]).map(t=>({kind:'handle',end:t.end,curve:curve.id,side:run.side,at:t.tip})),
      ...(run.through?[{kind:'point',id:curve.through.point,side:run.side,at:run.through}]:[])];
    if(run.guide_length_m)el.tr.title=el.title
      +(run.leg_lengths_m?` Through the armhole point: ${CM(run.leg_lengths_m[0])} cm from the strap to it, ${CM(run.leg_lengths_m[1])} cm from it to the wing.`:'')
      +` Shortest path${run.through?' through the point':''} ${CM(run.guide_length_m)} cm; this curve ${CM(run.length_m)} cm.`;
  }
  for(const [end,tr] of Object.entries(els.handles)){
    const h=curve.handles[end],length=h.length_mm/1000,a=Math.round(h.angle_deg);
    tr.querySelector('.angle').textContent=`${a>0?'+':a<0?'−':''}${Math.abs(a)}°`;
    tr.querySelector('.val').textContent=CM(length);
    tr.querySelector('.in').textContent=inchFraction(length,den).replace(/^0 /,'');
    const reset=tr.querySelector('button');
    if(reset)reset.hidden=!moved;
  }
}

function resetCurveHandles(id){
  const i=measuredCurves.findIndex(c=>c.id===id);
  const base=(levelContract?.curves||[]).find(c=>c.id===id)?.handles;
  if(i<0||!base)return;
  delete curveHandles[id];
  const next=bendCurve(measuredCurves[i],base,measureGrid);
  if(next.blocked)return;
  measuredCurves[i]=next;
  saveCurveHandles();updateCurveRows(next);redrawTapes();syncCurveState();
}

/* A strap over the shoulder ("straps" in contracts/measurement-levels.json): a
   band from each front tick to the same side's back tick, drawn as its outline.
   The row gives the width; the edge lengths over the shoulder are on hover. */
function renderStrapRow(strap,tbody){
  const den=registry.reporting.inch_denominator;
  const tr=document.createElement('tr');
  const frontOn=strap.front_on?(measuredTapes.find(t=>t.id===strap.front_on)||{}).label||strap.front_on:null;
  const start=frontOn?`${frontOn} in front of each ${strap.from} mark`:`each ${strap.from} mark`;
  tr.title=`${strap.width_mm/10}cm band from ${start} over the shoulder to the ${strap.to} mark on the same side.`;
  if(strap.blocked){
    tr.className='landmark';
    tr.innerHTML=`<td>${strap.label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
    tr.title+=' '+strap.blocked;
    tbody.appendChild(tr);
    return;
  }
  const b=strap.bands[0];
  tr.title+=` Edges over the shoulder ${CM(b.inner_length_m)} cm (neck side) and ${CM(b.outer_length_m)} cm (arm side); ${CM(b.top_width_m)} cm wide at the top of the shoulder.`;
  const width=strap.width_mm/1000;
  tr.setAttribute('aria-selected','false');
  tr.innerHTML=`<td><span style="color:${strap.colour}">▮</span> ${strap.label}</td><td class="val">${CM(width)}</td><td class="in">${inchFraction(width,den).replace(/^0 /,'')}</td>`;
  selectableTape(tr,tbody);
  tbody.appendChild(tr);
  measureRowData.push({label:strap.label,paths:strap.bands.map(band=>band.outline),color:parseInt(strap.colour.slice(1),16)});
  // its length (the middle of the band, tick to tick over the shoulder): a number only, nothing drawn
  const lengthLabel=`${strap.label} length`;
  const lr=document.createElement('tr');
  lr.title=`Along the middle of the strap, from ${start} over the shoulder to the ${strap.to} mark, on the skin. Edges ${CM(b.inner_length_m)} cm (neck side) and ${CM(b.outer_length_m)} cm (arm side).`;
  lr.innerHTML=`<td><span style="color:${strap.colour}">▮</span> ${lengthLabel}</td><td class="val">${CM(b.length_m)}</td><td class="in">${inchFraction(b.length_m,den)}</td>`;
  tbody.appendChild(lr);
}

/* Tick marks ("ticks" in contracts/measurement-levels.json): short marks in
   their own colour across a tape, the row giving the distance from centre back
   (or front) each side, measured along the tape. */
function renderTickRow(tick,tbody){
  const den=registry.reporting.inch_denominator;
  const on=(measuredTapes.find(t=>t.id===tick.on)||{}).label||tick.on;
  const front=tick.anchor==='centre_front';
  const label=`${on} ticks ${front?'CF':'CB'}`;
  const tr=document.createElement('tr');
  tr.title=`${tick.length_mm}mm marks across ${on}, ${inchFraction(tick.offset_in*0.0254,den)} from centre ${front?'front':'back'} on each side, measured along the tape.`;
  if(tick.blocked){
    tr.className='landmark';
    tr.innerHTML=`<td>${label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
    tr.title+=' '+tick.blocked;
    tbody.appendChild(tr);
    return;
  }
  const arc=tick.marks[0].arc_m;
  tr.setAttribute('aria-selected','false');
  tr.innerHTML=`<td><span style="color:${tick.colour}">▮</span> ${label}</td><td class="val">±${CM(arc)}</td><td class="in">±${inchFraction(arc,den)}</td>`;
  selectableTape(tr,tbody);
  tbody.appendChild(tr);
  measureRowData.push({label,paths:tick.marks.map(m=>m.points),color:parseInt(tick.colour.slice(1),16)});
}

/* A centre-back or centre-front line ("lines" in contracts/measurement-levels.json):
   its length down the back (up the front) along the skin; the straight chord is
   on hover. */
function renderLineRow(line,tbody){
  const den=registry.reporting.inch_denominator;
  const tr=document.createElement('tr');
  const front=line.kind==='centre_front';
  const label=front?'CF line':'CB line';
  tr.title=line.label+(front?': straight up the centre front':': straight down the centre back')+', measured along the skin.';
  if(line.blocked){
    tr.className='landmark';
    tr.innerHTML=`<td>${label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
    tr.title+=' '+line.blocked;
    tbody.appendChild(tr);
    return;
  }
  tr.title+=` From y = ${line.y_top_m.toFixed(3)} m to ${line.y_bottom_m.toFixed(3)} m; straight chord ${CM(line.chord_m)} cm (${inchFraction(line.chord_m,den)}).`;
  tr.setAttribute('aria-selected','false');
  tr.innerHTML=`<td>${label}</td><td class="val">${CM(line.length_m)}</td><td class="in">${inchFraction(line.length_m,den)}</td>`;
  selectableTape(tr,tbody);
  tbody.appendChild(tr);
  measureRowData.push({label,path:line.points});
}

/* A reference shape declared on a tape level (contracts/measurement-levels.json
   "shapes"), drawn as its red outline with a row under that level. The row gives
   the declared size; the top edge is measured along the skin, and its own
   length is on hover. */
function renderShapeRow(shape,tbody){
  const tr=document.createElement('tr');
  const label='CB rect';
  const den=registry.reporting.inch_denominator;
  tr.title=shape.label_en+'.';
  if(shape.blocked){
    tr.className='landmark';
    tr.innerHTML=`<td>${label} <em>⊘</em></td><td class="val">—</td><td class="in">—</td>`;
    tr.title+=' '+shape.blocked;
    tbody.appendChild(tr);
    return;
  }
  tr.title+=` Bottom ${CM(shape.bottom_width_m)} cm along the ring, sides ${CM(shape.side_height_m.l)} cm up the back,`
    +` top edge ${CM(shape.top_width_m)} cm (${inchFraction(shape.top_width_m,den)}) along the section they reach.`;
  tr.setAttribute('aria-selected','false');
  tr.innerHTML=`<td>${label}</td><td class="val">${CM(shape.width_m)}×${CM(shape.height_m)}</td>`
    +`<td class="in">${inchFraction(shape.width_m,den).replace('"','')}×${inchFraction(shape.height_m,den)}</td>`;
  selectableTape(tr,tbody);
  tbody.appendChild(tr);
  measureRowData.push({label,path:shape.outline});
}
