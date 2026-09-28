/* --- pen ------------------------------------------------------------------
   The tool lives in src/features/pen/pen_tool.mjs; only its DOM chrome is here:
   the line list, the on-body length labels, the buttons. Pasting the tool's
   geometry in here would give the project two implementations of the same
   measurement, which scripts/test_single_engine.mjs exists to prevent. -- */

import * as THREE from 'three';
import { inchFraction } from '../../core/measure_core.mjs';
import { ASSET_URL, ASSET_SHA } from './asset.mjs';
import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { registry } from './measurement.mjs';
import { measurePanel, setMeasurePanel } from './panels.mjs';
import { onResize, camera, canvas } from './stage.mjs';
import { setTip } from './tip.mjs';

export let pen=null;
export function setPen(tool){pen=tool}
onResize((w,h)=>pen?.updateResolution(w,h));
// what else follows the pen's lines (the pattern block), set by the app
let draftListener=()=>{};
export function onDraftChange(listener){draftListener=listener}
export const penEnabled=()=>Boolean(pen&&pen.enabled);

export function renderDraftList(){
  if(!pen)return;
  const list=document.getElementById('strokeList');
  const summary=pen.summary();
  const hasLines=summary.lines.length>0;
  const drafting=Boolean(summary.active&&summary.active.anchors);
  document.getElementById('penFinish').disabled=!(summary.active&&summary.active.anchors>1);
  document.getElementById('penUndo').disabled=!hasLines&&!drafting;
  document.getElementById('penClear').disabled=!hasLines;
  document.getElementById('penExport').disabled=!hasLines;
  list.hidden=!hasLines&&!drafting;
  list.innerHTML='';
  summary.lines.forEach(line=>{
    const row=document.createElement('div');
    row.className='stroke-row';
    row.dataset.selected=String(summary.selected===line.index);
    row.title=(line.approximated
      ?'Part of this line could not follow the surface and is measured straight. '
      :'Shortest path along the surface through its control points. ')
      +(line.span?`Straight line end to end: ${(line.span*100).toFixed(1)}cm (${inchFraction(line.span)})`:'Closed loop');
    const geo=pen.lineGeometry(line.index);
    const flag=geo?.origin?.asymmetry_flag?'<em class="flag" title="Mirrored line: a point had to move more than 5mm to reach the skin — the body is not symmetric here">⚠</em>':'';
    row.innerHTML=`<i></i><span class="lname">${line.name}</span>${flag}`
      +`<b>${(line.length*100).toFixed(1)}cm</b><span>${inchFraction(line.length)}</span>`;
    row.addEventListener('click',event=>{
      if(event.target.tagName==='BUTTON'||event.target.isContentEditable)return;
      pen.selectLine(line.index);
    });
    const nameEl=row.querySelector('.lname');
    const rename=document.createElement('button');
    rename.textContent='✎';rename.setAttribute('aria-label','Rename this line');
    rename.addEventListener('click',()=>{
      nameEl.contentEditable='true';nameEl.focus();
      const range=document.createRange();range.selectNodeContents(nameEl);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    nameEl.addEventListener('blur',()=>{nameEl.contentEditable='false';pen.renameLine(line.index,nameEl.textContent.trim())});
    nameEl.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();nameEl.blur()}
      if(event.key==='Escape'){nameEl.textContent=line.name;nameEl.blur()}
    });
    row.appendChild(rename);
    const label=document.createElement('button');
    label.textContent=line.labelVisible?'◉':'◎';
    label.setAttribute('aria-label',"Show or hide this line's measurement on the body");
    label.addEventListener('click',()=>pen.toggleLabel(line.index));
    row.appendChild(label);
    const remove=document.createElement('button');
    remove.textContent='×';remove.setAttribute('aria-label','Delete this line');
    remove.addEventListener('click',()=>pen.deleteLine(line.index));
    row.appendChild(remove);
    list.appendChild(row);
  });
  if(drafting){
    const row=document.createElement('div');
    row.className='stroke-row';row.dataset.active='true';
    row.innerHTML=`<i></i><span>${summary.active.anchors>1
      ?`${(summary.active.length*100).toFixed(1)}cm`:'click the body to pin the next point'}</span>`;
    list.appendChild(row);
  }
  prototypeState.draftLines=summary.lines.map(l=>({
    name:l.name,closed:l.closed,segments:l.segments,
    length_mm:+(l.length*1000).toFixed(1),on_surface:!l.approximated,
  }));
  draftListener(summary);
  syncDiagnostics();
}

let penLabelEls=[];
export function positionDraftLabels(){
  if(!pen||!camera)return;
  const labels=pen.getLabels();
  const host=document.getElementById('penLabels');
  while(penLabelEls.length<labels.length){
    const el=document.createElement('div');el.className='mlabel';
    host.appendChild(el);penLabelEls.push(el);
  }
  penLabelEls.forEach((el,i)=>{el.hidden=i>=labels.length});
  const projected=new THREE.Vector3();
  labels.forEach((label,i)=>{
    const el=penLabelEls[i];
    projected.copy(label.position).project(camera);
    if(projected.z>1){el.hidden=true;return}
    el.textContent=`${(label.length*100).toFixed(1)}cm · ${inchFraction(label.length)}`
      +(label.approximated?' ·straight':'');
    el.style.left=((projected.x*0.5+0.5)*canvas.clientWidth)+'px';
    // lifted clear of the curve so it never hides the control points
    el.style.top=((-projected.y*0.5+0.5)*canvas.clientHeight-20)+'px';
  });
}

export function setPenMode(on){
  if(!pen)return;
  pen.setEnabled(on);
  // P works with the panel closed, and the pen's own buttons live in it, so
  // turning the pen on brings its controls back into view rather than leaving
  // a mode running with nothing on screen to show for it.
  if(on&&measurePanel?.hidden)setMeasurePanel(true);
  document.getElementById('penToggle').setAttribute('aria-pressed',String(on));
  setTip(on
    ?'Pen: click to pin · drag empty skin to orbit · Shift = level snap · Alt = mirror snap · N snap on/off · Z loupe · ⌘Z undo · ? keys'
    :'Drag to orbit · wheel/pinch to zoom · use view presets · ? for keys');
}
const penToggle=document.getElementById('penToggle');
penToggle.addEventListener('click',()=>setPenMode(!penEnabled()));
document.getElementById('penFinish').addEventListener('click',()=>pen?.finishLine());
document.getElementById('penUndo').addEventListener('click',()=>pen?.undoPoint());
document.getElementById('penClear').addEventListener('click',()=>pen?.clear());

/* Draft lines leave the tool as evidence, not as a screenshot: anchors, control
   points and length, pinned to the asset SHA so a reader can tell which body
   they were measured on. The payload is built by the shared tool. */
document.getElementById('penExport').addEventListener('click',()=>{
  if(!pen)return;
  const payload=pen.toExport({
    asset:ASSET_URL.replace(/^.*\//,''),assetSha:ASSET_SHA,
    inchDenominator:registry?.reporting?.inch_denominator??8,inchFraction,
  });
  const text=JSON.stringify(payload,null,2)+'\n';
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  link.download='draft-lines.json';
  document.body.appendChild(link);link.click();link.remove();
  try{navigator.clipboard.writeText(text)}catch(error){/* no clipboard permission */}
  console.log('draft-lines.json — save into qa/avatar_master/\n'+text);
});
