/* The measurement panel is the only way in to the pen, the section, the levels,
   the grid, the landmarks and the pattern block. It used to remember being
   closed in localStorage, which meant one click could hide every tool in the
   app permanently, on every later visit, behind a single unlabelled ⌁ icon —
   the app looked like it had no pen. The choice is kept for the tab session
   instead, so closing it still sticks while you work and a fresh visit always
   shows the tools. */

export const measureBtn=document.getElementById('measureBtn'),measurePanel=document.getElementById('measurePanel'),closeMeasure=document.getElementById('closeMeasure');

export function setMeasurePanel(open){
  measurePanel.hidden=!open;
  measureBtn.setAttribute('aria-expanded',String(open));
  try{sessionStorage.setItem('measurePanelOpen',open?'1':'0')}catch(error){/* private mode */}
}
let measureOpen=true;
try{measureOpen=sessionStorage.getItem('measurePanelOpen')!=='0'}catch(error){/* private mode */}
try{localStorage.removeItem('measurePanelOpen')}catch(error){/* private mode */}
setMeasurePanel(measureOpen);
measureBtn.addEventListener('click',()=>setMeasurePanel(measurePanel.hidden));
closeMeasure.addEventListener('click',()=>setMeasurePanel(false));
