/* The level rings on the body, their labels and the Levels panel. */

import * as THREE from 'three';
import { disposeGroup, ringPoints, makeLine } from '../draw.mjs';
import { CM, M } from '../format.mjs';
import { levelContract, registry } from '../measurement.mjs';
import { measuredLevels } from './state.mjs';
import { scene, camera, canvas } from '../stage.mjs';

let levelsVisible=false,levelGroup=null,levelLabelEls=[];
try{levelsVisible=localStorage.getItem('levelsVisible')==='1'}catch(error){/* private mode */}

const LEVEL_GROUP_COLOUR=g=>Number.parseInt((levelContract?.groups?.[g]?.colour||'#8a6ad0').slice(1),16);

export function drawLevels(){
  disposeGroup(levelGroup);levelGroup=null;
  if(!levelsVisible||!measuredLevels||measuredLevels.needs)return;
  levelGroup=new THREE.Group();levelGroup.name='ReferenceLevels';
  for(const level of measuredLevels.levels){
    if(!level.section)continue;
    const colour=LEVEL_GROUP_COLOUR(level.group);
    const datum=level.offset_in===0;
    const pts=ringPoints(level.section);
    levelGroup.add(makeLine(pts,{color:colour,width:datum?2.6:1.6,opacity:level.blocked?.35:1}));
    // the half behind the body, faint, so a ring still reads as one loop
    levelGroup.add(makeLine(pts,{color:colour,width:datum?1.4:1,opacity:.22,depthTest:false,order:3}));
  }
  scene.add(levelGroup);
}

/* Labels are set off to one side in a column with a leader back to the ring,
   the way the source sheets do it, because the rings are only millimetres apart
   on the body and a label parked on each would be one illegible pile. The
   column sits clear of the widest ring in view, and the labels are pushed apart
   vertically until none overlaps; a leader keeps each tied to its own ring, so
   moving a label never changes which height it names. Display only. */
const LEVEL_LABEL_GAP=13,LEVEL_LABEL_MARGIN=26;
export function positionLevelLabels(){
  const host=document.getElementById('levelLabels');
  const leaders=document.getElementById('levelLeaders');
  const rows=(levelsVisible&&measuredLevels&&!measuredLevels.needs)?measuredLevels.levels.filter(l=>l.section):[];
  while(levelLabelEls.length<rows.length){
    const el=document.createElement('div');el.className='llabel';
    host.appendChild(el);levelLabelEls.push(el);
  }
  levelLabelEls.forEach((el,i)=>{el.hidden=i>=rows.length});
  if(!rows.length||!camera){leaders.replaceChildren();return}
  const W=canvas.clientWidth,H=canvas.clientHeight;
  const projected=new THREE.Vector3();
  // Anchor each ring at its right-most point on screen, and find the column.
  const anchors=[];let columnX=-Infinity;
  for(const level of rows){
    let ax=-Infinity,ay=0,behind=true;
    for(const [x,z] of level.section.ring){
      projected.set(x,level.y_m,z).project(camera);
      if(projected.z>1)continue;
      behind=false;
      if(projected.x>ax){ax=projected.x;ay=projected.y}
    }
    if(behind){anchors.push(null);continue}
    const px=(ax*0.5+0.5)*W,py=(-ay*0.5+0.5)*H;
    anchors.push({x:px,y:py});
    if(px>columnX)columnX=px;
  }
  columnX=Math.min(columnX+LEVEL_LABEL_MARGIN,W-70);
  // Push apart downward, then back up if the column ran off the bottom, so the
  // stack keeps the rings' own order without leaving the canvas.
  const placed=anchors.map(a=>a?a.y:null);
  let last=-Infinity;
  for(let i=0;i<placed.length;i++){
    if(placed[i]===null)continue;
    placed[i]=Math.max(placed[i],last+LEVEL_LABEL_GAP);last=placed[i];
  }
  let floor=H-8;
  for(let i=placed.length-1;i>=0;i--){
    if(placed[i]===null)continue;
    placed[i]=Math.min(placed[i],floor);floor=placed[i]-LEVEL_LABEL_GAP;
  }
  const svg=[];
  rows.forEach((level,i)=>{
    const el=levelLabelEls[i],anchor=anchors[i];
    if(!anchor){el.hidden=true;return}
    const colour=levelContract.groups[level.group].colour;
    el.hidden=false;
    // the 13 printed values come from the contract with a plain inch mark; the
    // unlabelled datum has to match them or the pill and the panel disagree
    el.textContent=level.label_in||'0"';
    el.style.background=colour;
    el.style.left=columnX+'px';
    el.style.top=placed[i]+'px';
    // blocked (no reading — above the reliable ceiling, or outside the scan)
    // still gets its ring and its pill, muted, so the on-body stack never
    // silently drops a declared level; only the girth is withheld.
    el.style.opacity=level.blocked?'.5':'1';
    el.title=level.blocked||'';
    svg.push('<path d="M'+anchor.x.toFixed(1)+' '+anchor.y.toFixed(1)
      +'L'+(columnX-4).toFixed(1)+' '+placed[i].toFixed(1)+'" stroke="'+colour+'" stroke-width="1" fill="none" opacity="'+(level.blocked?'.3':'.65')+'"/>');
  });
  leaders.innerHTML=svg.join('');
  leaders.setAttribute('viewBox','0 0 '+W+' '+H);
}

export function renderLevelList(){
  const panel=document.getElementById('levelPanel');
  const rows=document.getElementById('levelRows');
  const note=document.getElementById('levelNote');
  panel.hidden=!levelsVisible;
  if(!levelsVisible)return;
  if(!levelContract){
    rows.innerHTML='';
    note.innerHTML='<b>Unavailable.</b> contracts/measurement-levels.json did not load, so there is no stack to draw.';
    return;
  }
  if(!measuredLevels||measuredLevels.needs){
    rows.innerHTML='';
    note.innerHTML='<b>Needs '+(measuredLevels?.needs||[levelContract.datum]).join(', ')
      +'.</b> Every height is measured from it, so without it there are no levels.';
    return;
  }
  const denom=registry.reporting.inch_denominator;
  rows.innerHTML=measuredLevels.levels.map(level=>{
    const colour=levelContract.groups[level.group].colour;
    const value=level.blocked
      ?'<span class="blocked" title="'+level.blocked+'">no reading</span>'
      :'<span>'+CM(level.girth_m)+'cm · '+level.girth_in+'</span>';
    return '<div class="level-row'+(level.offset_in===0?' datum':'')+'">'
      +'<i style="background:'+colour+'"></i>'
      +'<b>'+(level.label_in||'0"')+'</b>'
      +levelContract.groups[level.group].label_en
      +value+'</div>';
  }).join('');
  note.innerHTML='Heights from <b>'+measuredLevels.datum+'</b> at y = '+M(measuredLevels.datum_y_m)
    +'m, traced from the house how-to-measure sheets. '+levelContract.declared_limit
    +' The girths are this body at those heights, with no compression allowance.';
}

export const levelToggle=document.getElementById('levelToggle');
levelToggle.setAttribute('aria-pressed',String(levelsVisible));
levelToggle.addEventListener('click',()=>{
  levelsVisible=!levelsVisible;
  levelToggle.setAttribute('aria-pressed',String(levelsVisible));
  try{localStorage.setItem('levelsVisible',levelsVisible?'1':'0')}catch(error){/* private mode */}
  drawLevels();renderLevelList();
});
