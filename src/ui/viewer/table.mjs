/* The measurement table: one row per POM the registry declares, in its
   order, and the tapes drawn on the body in red. Selecting a row draws its tape
   heavier. Other views hang rows under a POM (setRowsAfterPom) and push their
   own drawables into measureRowData. */

import * as THREE from 'three';
import { measureSection, pomProvenance, inchFraction } from '../../core/measure_core.mjs';
import { disposeGroup, ringPoints, TAPE_COLOR, makeLine, HANDLE_COLOR } from './draw.mjs';
import { CM } from './format.mjs';
import { registry, torsoTris } from './measurement.mjs';
import { scene } from './stage.mjs';

let tapeGroup=null;
export let measureRowData=[],selectedTapeIndex=-1,tapesVisible=true;
try{tapesVisible=localStorage.getItem('tapesVisible')!=='0'}catch(error){/* private mode */}

function clearTape(){disposeGroup(tapeGroup);tapeGroup=null}

/* Draws the measured tapes in red. `tapesVisible` shows all of them at once;
   the row selected in the table is drawn heavier, with a faint see-through
   copy so the half hidden behind the body still reads as one loop. */
export function redrawTapes(){
  clearTape();
  if(!measureRowData.length)return;
  tapeGroup=new THREE.Group();tapeGroup.name='MeasurementTapes';
  measureRowData.forEach((row,index)=>{
    const selected=index===selectedTapeIndex;
    if(!tapesVisible&&!selected)return;
    const lift=path=>path.map(a=>{
      const radial=Math.hypot(a[0],a[2])||1;
      return new THREE.Vector3(a[0]*(1+0.0015/radial),a[1],a[2]*(1+0.0015/radial));
    });
    // an open section (above the armhole) is drawn as its pieces on the skin
    const pieces=row.paths?row.paths.map(lift):[row.path?lift(row.path):ringPoints(row.section)];
    // tick marks carry their own colour and read heavier than a tape
    const color=row.color??TAPE_COLOR;
    for(const pts of pieces){
      tapeGroup.add(makeLine(pts,{color,width:row.color?(selected?4.5:3.5):(selected?3.2:2),opacity:row.color?1:(selected?1:.6)}));
      if(selected){
        tapeGroup.add(makeLine(pts,{color,width:1.6,opacity:.25,depthTest:false,order:3}));
      }
    }
    // a point's dots, a little larger when its row is selected (a curve's
    // through point only with the curve)
    for(const p of (row.curve&&!selected)?[]:row.dots||[]){
      const at=lift([p])[0];
      const dot=new THREE.Mesh(new THREE.SphereGeometry(selected?0.0042:0.0032,16,12),new THREE.MeshBasicMaterial({color}));
      dot.position.copy(at);tapeGroup.add(dot);
      if(selected){
        const ghost=new THREE.Mesh(new THREE.SphereGeometry(0.0042,16,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.3,depthTest:false}));
        ghost.position.copy(at);ghost.renderOrder=3;tapeGroup.add(ghost);
      }
    }
    // a shaped curve's two tangent handles: a dashed line to a dot you drag
    // (a handle with no line, such as a joined curve's fullness, is its dot alone)
    if(selected&&row.tangents)for(const t of row.tangents){
      const pts=lift(t.points);
      const dots=[[lift([t.tip])[0],0.0036]];
      if(pts.length>1){
        tapeGroup.add(makeLine(pts,{color:HANDLE_COLOR,width:1.8,dash:[0.003,0.002]}));
        tapeGroup.add(makeLine(pts,{color:HANDLE_COLOR,width:1,opacity:.3,depthTest:false,order:3}));
        dots.unshift([pts[0],0.0022]);
      }
      for(const [at,radius] of dots){
        const dot=new THREE.Mesh(new THREE.SphereGeometry(radius,16,12),new THREE.MeshBasicMaterial({color:HANDLE_COLOR,depthTest:false}));
        dot.position.copy(at);dot.renderOrder=4;tapeGroup.add(dot);
      }
    }
  });
  scene.add(tapeGroup);
}
const STATUS_MARK={needs_review:'?',diagnostic:'·'};
// Rows another view lists under a POM's row (the reference geometry hung on
// it); set by the app, so the table does not reach into that view.
let rowsAfterPom=()=>{};
export function setRowsAfterPom(list){rowsAfterPom=list}

/* A table row that selects the tape drawn after it: the row carries the index
   its tape will have, so rows without a tape (blocked POMs) cannot shift it. */
export function selectableTape(tr,tbody){
  const tape=measureRowData.length;
  tr.dataset.tape=String(tape);
  tr.addEventListener('click',()=>{
    selectedTapeIndex=selectedTapeIndex===tape?-1:tape;
    tbody.querySelectorAll('tr').forEach(r=>r.setAttribute('aria-selected',String(r.dataset.tape===String(selectedTapeIndex))));
    redrawTapes();
  });
}

export function renderMeasurements(marks,poms,elapsedMs){
  const tbody=document.getElementById('measureRows');
  if(!marks||!poms){
    tbody.innerHTML='<tr><td colspan="3" class="h">Unavailable — the measurement surface '
      +registry.measurement_surface.join(', ')+' is not in this asset.</td></tr>';
    return;
  }
  // The registry decides what is reported and in what order; nothing is
  // measured or shown that it does not declare.
  // Visible absence beats silent omission: a POM that is measurable but waiting
  // on a hand-placed landmark is listed, greyed, with the reason on hover.
  const rows=registry.poms
    .filter(spec=>['plane_section','surface_path','section_arc'].includes(spec.method)
      &&(poms[spec.id]||spec.status==='blocked_until_manual'))
    .map(spec=>({spec,result:poms[spec.id]||null}));
  tbody.innerHTML='';
  measureRowData=[];
  selectedTapeIndex=-1;
  rows.forEach(({spec,result},index)=>{
    const isPath=spec.method!=='plane_section';
    const section=(isPath||!result)?null:measureSection(torsoTris,result.at_y);
    const tr=document.createElement('tr');
    if(spec.status==='diagnostic'||!result)tr.className='landmark';
    if(!result){
      tr.innerHTML=`<td>${spec.label_short||spec.label_en} <em>⊘</em></td>`
        +`<td class="val">—</td><td class="in">—</td>`;
      tr.title=`Waiting on a hand-placed landmark (${(spec.unblocked_by||[]).join(', ')}). `
        +(spec.blocked_reason||'');
      tbody.appendChild(tr);
      return;
    }
    tr.setAttribute('aria-selected','false');
    const mark=STATUS_MARK[spec.status]||'';
    const provenance=marks&&marks.source?pomProvenance(spec.id,marks.source):'auto';
    const manualMark=provenance==='auto'?'':' <em title="depends on a hand-placed landmark">✎</em>';
    tr.title=(provenance==='auto'?'':`Depends on a hand-placed landmark (${provenance}). `)
      +(spec.review_reason||spec.comment||spec.label_en||'');
    tr.innerHTML=`<td>${spec.label_short||spec.label_en}${mark?' <em>'+mark+'</em>':''}${manualMark}</td>`
      +`<td class="val">${CM(result.value)}</td>`
      +`<td class="in">${inchFraction(result.value,registry.reporting.inch_denominator)}</td>`;
    selectableTape(tr,tbody);
    tbody.appendChild(tr);
    // a girth POM draws as a ring, a surface-path POM as its own polyline
    if(isPath&&result.points)measureRowData.push({label:spec.label_short,path:result.points});
    else if(section)measureRowData.push({label:spec.label_short,section});
    rowsAfterPom(spec,tbody);
  });
  redrawTapes();

}

export const tapeToggle=document.getElementById('tapeToggle');
tapeToggle.setAttribute('aria-pressed',String(tapesVisible));
tapeToggle.addEventListener('click',()=>{
  tapesVisible=!tapesVisible;
  tapeToggle.setAttribute('aria-pressed',String(tapesVisible));
  try{localStorage.setItem('tapesVisible',tapesVisible?'1':'0')}catch(error){/* private mode */}
  redrawTapes();
});
