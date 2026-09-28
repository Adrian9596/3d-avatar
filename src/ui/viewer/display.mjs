/* The display popover: body and wireframe toggles. */

import { prototypeState, syncDiagnostics } from './diagnostics.mjs';
import { avatarRoot, roleMeshes } from './stage.mjs';

document.querySelectorAll('.toggle').forEach(button=>button.addEventListener('click',()=>{
  const role=button.dataset.role,next=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(next));button.textContent=next?'On':'Off';
  if(role==='WIREFRAME'){
    avatarRoot?.traverse(object=>{if(object.isMesh){const mats=Array.isArray(object.material)?object.material:[object.material];mats.filter(Boolean).forEach(mat=>{mat.wireframe=next;mat.needsUpdate=true})}});
    prototypeState.wireframe=next;
  }else{roleMeshes[role]?.forEach(object=>object.visible=next);prototypeState.roleVisibility[role]=next}
  syncDiagnostics();
}));
const viewBtn=document.getElementById('viewBtn'),viewPop=document.getElementById('viewPop');

viewBtn.addEventListener('click',()=>{const open=!viewPop.classList.contains('open');viewPop.classList.toggle('open',open);viewBtn.setAttribute('aria-expanded',String(open))});
