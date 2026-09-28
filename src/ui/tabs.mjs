/* ---- the page's two tabs: 2D · 3D ----------------------------------------------
   3D is this page: the avatar viewer under src/ui/viewer. 2D is the pattern
   workspace, a separate app (pattern2d/) loaded in an iframe of the same origin:
   its own document, styles and keys, so neither app can reach into the other.
   The only link between them is three messages, specified on the workspace's
   side (pattern2d/src/features/dxf/open.md): it tells us it is ready and what it
   opened; we ask it to open a DXF — the 3D pattern block's Open in 2D, or a file
   dropped on this page.

   While 2D shows, the 3D stays laid out underneath, covered and inert (never
   display:none: stage.mjs would size the WebGL canvas to 1x1), and whoever
   listens to onTabChange pauses what only the 3D needs — main.mjs stops the
   frame loop. The iframe is created the first time 2D is shown and then kept:
   the workspace holds its work in memory only. #2d / #3d in the URL pick the
   tab; with neither, 3D. Imports nothing — keyboard.mjs, main.mjs and
   pattern_panel.mjs import it. ------------------------------------------------ */

const OPEN_DXF='pattern2d:open-dxf',READY='pattern2d:ready',OPENED='pattern2d:opened';
const TABS=['2d','3d'];
const WORKSPACE_URL='pattern2d/index.html';   // beside this page, locally and on Pages

const app=document.getElementById('app');
const pane=document.getElementById('pane2d');
const tablist=document.getElementById('workspaceTabs');
const buttons={'2d':document.getElementById('tab2d'),'3d':document.getElementById('tab3d')};
const listeners=[];
let active=null,frame=null,ready=false,pending=null,opened=null;

export const activeTab=()=>active;
/* fn(tab) now and on every change */
export function onTabChange(fn){listeners.push(fn);if(active)fn(active)}

function tabFromHash(){const h=location.hash.slice(1).toLowerCase();return TABS.includes(h)?h:'3d'}

function ensureFrame(){
  if(frame)return;
  frame=document.createElement('iframe');
  frame.title='2D pattern workspace';
  frame.allow='clipboard-write';      // its Copy button; downloads and the file picker need no sandbox
  frame.src=WORKSPACE_URL;
  pane.appendChild(frame);
}

function focusWorkspace(){
  const into=()=>{if(active==='2d')frame.contentWindow?.focus()};
  if(ready)into();else frame.addEventListener('load',into,{once:true});
}

function show(tab,{writeHash=true}={}){
  if(!TABS.includes(tab))tab='3d';
  if(tab===active)return;
  active=tab;
  const on2d=tab==='2d';
  if(on2d)ensureFrame();
  app.inert=on2d;pane.inert=!on2d;
  document.documentElement.dataset.tab=tab;
  for(const t of TABS){const b=buttons[t];b.setAttribute('aria-selected',String(t===tab));b.tabIndex=t===tab?0:-1}
  if(!on2d&&frame&&document.activeElement===frame)frame.blur();
  if(writeHash)history.replaceState(null,'',`${location.pathname}${location.search}#${tab}`);
  for(const fn of listeners)fn(tab);
}

function flush(){
  if(!pending||!ready)return;
  frame.contentWindow.postMessage({type:OPEN_DXF,file:pending},'/');   // '/': our own origin only
  pending=null;
}

/* Open a DXF File in the 2D tab: switch to it, send the file once the
   workspace is ready, and hand it the keys — the button or the drop that got
   here leaves focus on this page, where no key does anything while 2D shows.
   Asked from the 3D side while the workspace holds a file, it asks before
   replacing it (the workspace keeps nothing on disk). Returns false when the
   user keeps what is open. */
export function openIn2D(file){
  if(active==='3d'&&opened&&!confirm(`The 2D tab has ${opened.name} open. Replace it with ${file.name}? Changes made there and not exported are lost.`))return false;
  show('2d');
  pending=file;flush();
  focusWorkspace();
  return true;
}

addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
  const data=event.data;
  if(!data||typeof data.type!=='string')return;
  if(data.type===READY){ready=true;flush()}
  else if(data.type===OPENED)opened={name:String(data.name),pieces:Number(data.pieces)};
});

for(const t of TABS)buttons[t].addEventListener('click',event=>{
  show(t);
  // a pointer click leaves focus where the keys should go next; Enter/Space keep it on the tab
  if(event.detail>0){if(t==='2d')focusWorkspace();else buttons[t].blur()}
});
// the tabs pattern: arrows, Home and End move between tabs. The 3D shortcuts
// (arrows turn the camera, Enter finishes a pen line, Space places a landmark)
// must not also run, so nothing a tab handles goes on to the window.
tablist.addEventListener('keydown',event=>{
  const i=TABS.indexOf(active);
  const next={ArrowLeft:TABS[(i+TABS.length-1)%TABS.length],ArrowRight:TABS[(i+1)%TABS.length],Home:TABS[0],End:TABS[TABS.length-1]}[event.key];
  if(next){event.preventDefault();event.stopPropagation();show(next);buttons[next].focus();return}
  if(event.key==='Enter'||event.key===' ')event.stopPropagation();   // the button clicks itself
});
addEventListener('hashchange',()=>show(tabFromHash(),{writeHash:false}));

// A file dragged over the page must not navigate away from it (the workspace
// holds its work in memory). A .dxf dropped anywhere outside the workspace's
// own frame opens in 2D; the frame handles drops on itself.
const draggingFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
addEventListener('dragover',event=>{if(draggingFiles(event))event.preventDefault()});
addEventListener('drop',event=>{
  if(!draggingFiles(event))return;
  event.preventDefault();
  const file=event.dataTransfer.files[0];
  if(file&&/\.dxf$/i.test(file.name))openIn2D(file);
});

show(tabFromHash(),{writeHash:false});
// instrumentation for automated checks
window.__tabs={active:activeTab,show,frame:()=>frame,ready:()=>ready,opened:()=>opened};
