/* ---- 2D pattern draft: outline (+ seam) -> flattened pieces -> DXF ----------
   The maths is src/features/pattern/pattern_draft.mjs over the flattening
   engine in src/core/flatten — the very engine validate:flatten-*,
   validate:seam-closure and validate:dxf-roundtrip run. This block is DOM only:
   read the selects, ask the pen for the lines' 3D polylines, call the module,
   draw the result. A closed pen loop is the outline; an open pen line whose ends
   sit on it is a seam that cuts it into two panels solved together. What comes
   out is a 1:1 shell of the skin — the panel says so, the DXF says so, the
   evidence says so.

   Templates are conventional cuts declared as landmarks in
   contracts/pattern-templates.json, drafted as ordinary pen lines and flattened
   by the same engine — proposals, shown with their cost, never a decision
   (AUTHORING_UX_PLAN.md §8). */

import { draftMesh, draftPieces, flattenDraft, draftSummary, SEAM_TOLERANCE_MM, draftExport } from '../../features/pattern/pattern_draft.mjs';
import { templatesFor, resolveTemplate, templatePolyline, TEMPLATE_LIMIT, templateRecord } from '../../features/pattern/pattern_templates.mjs';
import { ASSET_URL, ASSET_SHA, ASSET_VERSION } from './asset.mjs';
import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { overrides } from './landmark_store.mjs';
import { LANDMARK_ROWS, landmarkValue } from './landmark_values.mjs';
import { templates, torsoTris, measureGrid, closestOnSurface, registry, registrySha, marks } from './measurement.mjs';
import { pen } from './pen_host.mjs';

let patternMesh=null,patternResult=null;
export const patternPanel=document.getElementById('patternPanel');
const patternOutline=document.getElementById('patternOutline');
const patternSeam=document.getElementById('patternSeam');
const patternStatus=document.getElementById('patternStatus');
const patternPreview=document.getElementById('patternPreview');
const patternTable=document.getElementById('patternTable');
const patternExportBtn=document.getElementById('patternExport');
function setPatternStatus(text,isError){patternStatus.textContent=text;patternStatus.classList.toggle('err',!!isError)}
const lineLabel=l=>`${l.name} · ${(l.length*100).toFixed(1)}cm`;

export function renderPatternControls(summary){
  const closed=summary.lines.filter(l=>l.closed&&l.segments>2);
  const open=summary.lines.filter(l=>!l.closed&&l.segments>0);
  patternPanel.hidden=closed.length===0&&templates.length===0;
  renderTemplateChooser();
  document.getElementById('patternFlatten').disabled=closed.length===0;
  if(patternPanel.hidden||closed.length===0){patternResult=null;patternExportBtn.disabled=true;patternOutline.innerHTML='';if(closed.length===0){patternPreview.hidden=true;patternTable.hidden=true}return}
  const keepO=patternOutline.value,keepS=patternSeam.value;
  patternOutline.innerHTML=closed.map(l=>`<option value="${l.index}">${lineLabel(l)}</option>`).join('');
  patternSeam.innerHTML='<option value="">none — one piece</option>'+open.map(l=>`<option value="${l.index}">${lineLabel(l)}</option>`).join('');
  if([...patternOutline.options].some(o=>o.value===keepO))patternOutline.value=keepO;
  if([...patternSeam.options].some(o=>o.value===keepS))patternSeam.value=keepS;
  // a result belongs to the lines it was made from; any edit stales it
  if(patternResult){patternResult=null;patternExportBtn.disabled=true;patternPreview.hidden=true;patternTable.hidden=true;
    setPatternStatus('Lines changed — Flatten again.');}
}

function runPattern(){
  if(!pen||!torsoTris||!measureGrid){setPatternStatus('The measurement surface is not loaded yet.',true);return}
  const outline=pen.lineGeometry(+patternOutline.value);
  const seam=patternSeam.value===''?null:pen.lineGeometry(+patternSeam.value);
  if(!outline||!outline.closed){setPatternStatus('Pick a closed loop as the outline.',true);return}
  if(!patternMesh)patternMesh=draftMesh(torsoTris);
  const started=performance.now();
  const cut=draftPieces({mesh:patternMesh,closest:closestOnSurface,outline,seam,measurementSurface:registry?.measurement_surface||null});
  if(cut.error){setPatternStatus(cut.error,true);return}
  const result=flattenDraft(cut.pieces);
  patternResult={outline,seam,pieces:cut.pieces,result,elapsed_ms:Math.round(performance.now()-started)};
  lastTemplateFlatten=outline.origin?.template||null;
  renderPatternResult();
  prototypeState.pattern={outline:outline.name,seam:seam?seam.name:null,...draftSummary(cut.pieces,result)};
  syncDiagnostics();
}

function renderPatternResult(){
  const {pieces,result,elapsed_ms}=patternResult;
  const {run,reports,shared,sound}=result;
  const tpl=patternResult.outline?.origin?.template;
  setPatternStatus(sound
    ?`${tpl?`Template ${tpl}${patternResult.outline.origin.edited?' (edited)':''} — a conventional cut, not a recommendation. `:''}Shell 1:1 of the skin — not a pattern (no ease, no seam allowance, no grading). ${run.iterations} sweeps, ${elapsed_ms}ms.`
    :`Flattened, but unsound: ${run.converged?'':'did not converge; '}${reports.some(x=>x.stats.triangle_flips)?'a face folded over; ':''}check the loop.`,!sound);
  const rows=pieces.map((p,i)=>{
    const c=reports[i].chords,s=reports[i].stats,err=c.seam_error_m*1000;
    return `<tr><td>${p.name}</td><td class="n">${(c.seam_length_3d_m*1000).toFixed(1)}</td><td class="n">${(c.seam_length_flat_m*1000).toFixed(1)}</td>`
      +`<td class="n">${(err>=0?'+':'')+err.toFixed(1)}</td><td class="n">${s.interior_rms_pct.toFixed(1)}%</td><td class="n">${s.triangle_flips}</td></tr>`;
  }).join('');
  const sharedRow=shared?`<tr><td colspan="6" class="pshared">Shared seam: ${shared.length_3d_mm}mm on the body, ${shared.flat_mm.join(' / ')}mm flat — mismatch <b>${shared.mismatch_mm}mm</b> (1/8in = ${SEAM_TOLERANCE_MM}mm)</td></tr>`:'';
  patternTable.innerHTML=`<thead><tr><th style="width:34%">Piece</th><th class="n">3D</th><th class="n">Flat</th><th class="n">Δ</th><th class="n">rms</th><th class="n">flip</th></tr></thead><tbody>${rows}${sharedRow}</tbody>`;
  patternTable.hidden=false;
  // preview: pieces side by side, outline = the loop's image, shared seam in teal
  const W=260,H=140,pad=8,gap=10;
  const outlines=reports.map(x=>x.flat.points.map(([u,v])=>[u*1000,v*1000]));
  const boxes=outlines.map(pts=>{let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const [x,y] of pts){a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y)}return{minx:a,miny:b,w:c-a,h:d-b}});
  const totalW=boxes.reduce((s,b)=>s+b.w,0)+gap*(boxes.length-1),maxH=Math.max(...boxes.map(b=>b.h));
  const scale=Math.min((W-2*pad)/totalW,(H-2*pad-10)/maxH);
  const sharedKey=new Set(run.shared.map(g=>g.pair));
  let x0=pad,svg='';
  pieces.forEach((p,i)=>{
    const b=boxes[i],pts=outlines[i].map(([x,y])=>[x0+(x-b.minx)*scale,H-pad-(y-b.miny)*scale]);
    svg+=`<polygon points="${pts.map(q=>q.map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="rgba(201,48,44,.07)" stroke="#c9302c" stroke-width="1"/>`;
    if(shared){
      const samples=p.patch.samples,n=samples.length;
      for(let k=0;k<n;k++){const a=samples[k],c=samples[(k+1)%n];const pair=a.key<c.key?`${a.key}|${c.key}`:`${c.key}|${a.key}`;
        if(sharedKey.has(pair))svg+=`<line x1="${pts[k][0].toFixed(1)}" y1="${pts[k][1].toFixed(1)}" x2="${pts[(k+1)%n][0].toFixed(1)}" y2="${pts[(k+1)%n][1].toFixed(1)}" stroke="#1f8a70" stroke-width="2.4"/>`}
    }
    svg+=`<text x="${(x0+b.w*scale/2).toFixed(1)}" y="${(H-pad-b.h*scale-3).toFixed(1)}" text-anchor="middle" font-size="7" fill="#4f4943">${p.name} · ${b.w.toFixed(0)}×${b.h.toFixed(0)}mm</text>`;
    x0+=b.w*scale+gap;
  });
  patternPreview.innerHTML=svg;
  patternPreview.hidden=false;
  patternExportBtn.disabled=!sound;
}

function buildPatternDxf(){
  const {pieces,result,outline,seam}=patternResult;
  return draftExport({pieces,result,outline,seam,template:templateRecordFor(outline,seam),
    asset:{file:ASSET_URL.replace(/^.*\//,''),sha256:ASSET_SHA},registrySha,release:ASSET_VERSION});
}

/* ---- templates: the chooser, Draft, Compare, and following a landmark drag --- */
const patternTemplate=document.getElementById('patternTemplate');
const patternCompareTable=document.getElementById('patternCompareTable');
function templateLandmarks(){
  const map={};
  for(const row of LANDMARK_ROWS){if(row.kind!=='point')continue;const v=landmarkValue(row.id);if(v&&Number.isFinite(v.x))map[row.id]=[v.x,v.y,v.z]}
  return map;
}
function landmarkProvenance(){
  const prov={};
  for(const row of LANDMARK_ROWS){const o=(overrides.landmarks||{})[row.id];prov[row.id]=o?(o.source||'manual'):(marks?.source?.[row.id]||'auto')}
  return prov;
}
export function renderTemplateChooser(){
  const draftBtn=document.getElementById('patternDraft'),compareBtn=document.getElementById('patternCompare');
  if(!templates.length||!measureGrid){patternTemplate.innerHTML='';draftBtn.disabled=compareBtn.disabled=true;return}
  patternPanel.hidden=false;   // templates give the block something to offer before any loop is drawn
  const map=templateLandmarks();
  const {available,blocked}=templatesFor(null,map,templates);
  const keep=patternTemplate.value;
  patternTemplate.innerHTML=[...available.map(a=>`<option value="${a.template.id}">${a.template.label_en}</option>`),
    ...blocked.map(b=>`<option value="${b.template.id}" disabled>${b.template.label_en} — needs ${b.needs.join(', ')}</option>`)].join('');
  if([...patternTemplate.options].some(o=>o.value===keep&&!o.disabled))patternTemplate.value=keep;
  else if(available.length)patternTemplate.value=available[0].template.id;
  draftBtn.disabled=!available.length;compareBtn.disabled=!available.length;
  prototypeState.templates={available:available.map(a=>a.template.id),blocked:Object.fromEntries(blocked.map(b=>[b.template.id,b.needs]))};
}
function templateLinesOf(id){
  const out=[];const n=pen.summary().lines.length;
  for(let i=0;i<n;i++){const g=pen.lineGeometry(i);if(g?.origin?.template&&(!id||g.origin.template===id))out.push({index:i,geo:g})}
  return out;
}
/** Draft: the template's lines become ordinary pen lines (through the pen, so
 *  every tool applies), pre-selected as outline and seam, and flattened. */
function draftTemplate(id){
  const t=templates.find(x=>x.id===id);
  if(!t||!pen){setPatternStatus('No template chosen.',true);return false}
  const map=templateLandmarks();
  const r=resolveTemplate(t,map);
  if(r.needs){setPatternStatus(`${t.label_en}: needs ${r.needs.join(', ')} — place them in the Landmarks panel (Space walks them).`,true);return false}
  for(const {index} of templateLinesOf(id).reverse())pen.deleteLine(index);
  const origin=(role,ids)=>({template:id,role,landmarks:ids,edited:false});
  const outlineIndex=pen.addLine(r.outline.anchors,true,r.outline.name,origin('outline',r.outline.landmark_ids));
  const seamIndex=r.seam?pen.addLine(r.seam.anchors,false,r.seam.name,origin('seam',r.seam.landmark_ids)):null;
  patternOutline.value=String(outlineIndex);patternSeam.value=seamIndex===null?'':String(seamIndex);
  patternCompareTable.hidden=true;
  try{runPattern()}catch(error){setPatternStatus(`Flatten failed: ${error.message}`,true)}
  return true;
}
/** Compare: every available template flattened in memory (no pen lines), listed
 *  with what each cut costs; a row drafts that template. */
function compareTemplates(){
  if(!measureGrid||!torsoTris)return false;
  const map=templateLandmarks();
  const {available,blocked}=templatesFor(null,map,templates);
  if(!patternMesh)patternMesh=draftMesh(torsoTris);
  const started=performance.now();
  const rows=available.map(({template:t,resolved:r})=>{
    const outline=templatePolyline(r.outline.anchors,true,measureGrid);
    const seam=r.seam?templatePolyline(r.seam.anchors,false,measureGrid):null;
    const cut=draftPieces({mesh:patternMesh,closest:closestOnSurface,outline:{name:t.id,points:outline.points},seam:seam?{name:r.seam.name,points:seam.points}:null,measurementSurface:registry.measurement_surface});
    if(cut.error)return {id:t.id,label:t.label_en,error:cut.error};
    const flat=flattenDraft(cut.pieces),summary=draftSummary(cut.pieces,flat);
    return {id:t.id,label:t.label_en,sound:flat.sound,pieces:summary.pieces.map(p=>p.seam_error_mm),mismatch:summary.shared_seam?.mismatch_mm??null};
  });
  patternCompareTable.innerHTML=`<thead><tr><th style="width:52%">Template</th><th class="n">Seam Δ mm</th><th class="n">Shared</th></tr></thead><tbody>`
    +rows.map(r=>`<tr data-template="${r.id}" title="Draft this template">`+(r.error
      ?`<td>${r.label}</td><td colspan="2" class="pshared">${r.error}</td>`
      :`<td>${r.label}</td><td class="n">${r.pieces.map(v=>v.toFixed(1)).join(' / ')}${r.sound?'':' ⚠'}</td><td class="n">${r.mismatch===null?'—':r.mismatch.toFixed(2)}</td>`)+'</tr>').join('')
    +blocked.map(b=>`<tr class="landmark"><td>${b.template.label_en}</td><td colspan="2" class="pshared">needs ${b.needs.join(', ')}</td></tr>`).join('')
    +`<tr><td colspan="3" class="pshared">${TEMPLATE_LIMIT} Seam Δ is each panel's flattened seam against the body; shared is the mismatch between panels. ${Math.round(performance.now()-started)} ms. Click a row to draft it.</td></tr></tbody>`;
  patternCompareTable.querySelectorAll('tr[data-template]').forEach(tr=>tr.addEventListener('click',()=>{patternTemplate.value=tr.dataset.template;draftTemplate(tr.dataset.template)}));
  patternCompareTable.hidden=false;
  prototypeState.templateCompare=rows;
  return true;
}
/** A template line follows the landmarks it was drafted from — rebuilt in place
 *  while a root is dragged, re-flattened if it was the flattened outline. Lines
 *  a person edited by hand are theirs and are left alone. */
let templateRefreshTimer=null,templateRefreshAt=0,lastTemplateFlatten=null;   // the template whose lines were last flattened
export function refreshTemplateLines(){
  if(!pen||!measureGrid||!templates.length)return;
  const lines=templateLinesOf(null).filter(l=>!l.geo.origin.edited);
  if(!lines.length)return;
  const now=performance.now();
  if(now-templateRefreshAt<150){clearTimeout(templateRefreshTimer);templateRefreshTimer=setTimeout(refreshTemplateLines,160);return}
  templateRefreshAt=now;
  const map=templateLandmarks();
  // re-flatten the template last flattened even if a hand edit staled the
  // result since: the edited line is the person's and is kept as they left it
  const flattened=lastTemplateFlatten;
  let touched=false;
  for(const {index,geo} of lines){
    const t=templates.find(x=>x.id===geo.origin.template);if(!t)continue;
    const r=resolveTemplate(t,map);if(r.needs)continue;
    const line=geo.origin.role==='seam'?r.seam:r.outline;if(!line)continue;
    pen.replaceLine(index,line.anchors,line.closed,geo.origin);touched=true;
  }
  if(touched&&flattened){
    const outlineIndex=templateLinesOf(flattened).find(l=>l.geo.origin.role==='outline')?.index;
    const seamIndex=templateLinesOf(flattened).find(l=>l.geo.origin.role==='seam')?.index;
    if(outlineIndex!==undefined){patternOutline.value=String(outlineIndex);patternSeam.value=seamIndex===undefined?'':String(seamIndex);try{runPattern()}catch(error){setPatternStatus(`Flatten failed: ${error.message}`,true)}}
  }
}
function templateRecordFor(outline,seam){
  const id=outline?.origin?.template||seam?.origin?.template;
  const t=id&&templates.find(x=>x.id===id);
  if(!t)return null;
  return templateRecord(t,templateLandmarks(),landmarkProvenance(),Boolean(outline?.origin?.edited||seam?.origin?.edited));
}
document.getElementById('patternDraft').addEventListener('click',()=>draftTemplate(patternTemplate.value));
document.getElementById('patternCompare').addEventListener('click',()=>compareTemplates());
window.__templates={draft:draftTemplate,compare:compareTemplates,landmarks:templateLandmarks,lines:()=>templateLinesOf(null)};
function downloadText(name,text,type){
  const blob=new Blob([text],{type});const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();link.remove();
}
document.getElementById('patternFlatten').addEventListener('click',()=>{
  try{runPattern()}catch(error){setPatternStatus(`Flatten failed: ${error.message}`,true);console.error(error)}
});
patternExportBtn.addEventListener('click',()=>{
  if(!patternResult)return;
  try{
    const out=buildPatternDxf();
    downloadText('pattern-draft.dxf',out.dxf,'application/dxf');
    downloadText('pattern-draft.json',out.evidence,'application/json');
    setPatternStatus('Exported pattern-draft.dxf (ASTM D6673-10, Gerber dialect, mm) and pattern-draft.json — save both into qa/avatar_master/. Import into AccuMark is not verified.');
  }catch(error){setPatternStatus(`Export refused: ${error.message}`,true)}
});
// automated checks read the same objects the buttons use
window.__patternDebug={run:()=>{runPattern();return prototypeState.pattern},dxf:()=>buildPatternDxf(),result:()=>patternResult,
  closest:p=>closestOnSurface(p)};   // closest point on the MEASUREMENT surface (arms excluded), for building test loops
