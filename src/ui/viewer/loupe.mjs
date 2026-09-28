/* ---- loupe: a 3x inset of the skin under the cursor, rendered into a corner of
   the same canvas each frame while Z is on and the pen is hovering the body. */

import * as THREE from 'three';
import { pen } from './pen_host.mjs';
import { renderer, canvas, camera, scene } from './stage.mjs';

let loupeOn=false;const loupeCamera=new THREE.PerspectiveCamera(28/3,1,.01,100);
export function toggleLoupe(){loupeOn=!loupeOn;document.getElementById('loupeFrame').hidden=!loupeOn;return loupeOn}
const LOUPE_PX=200;
export function renderLoupe(){
  if(!loupeOn||!pen||!renderer)return;
  const at=pen.hoverPoint()||pen.selectedPoint();
  if(!at)return;
  const w=canvas.clientWidth,h=canvas.clientHeight,dpr=renderer.getPixelRatio();
  loupeCamera.position.copy(camera.position);loupeCamera.lookAt(at.point[0],at.point[1],at.point[2]);loupeCamera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setViewport(0,0,LOUPE_PX,LOUPE_PX);renderer.setScissor(0,0,LOUPE_PX,LOUPE_PX);
  renderer.render(scene,loupeCamera);
  renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.setScissor(0,0,w,h);
}
