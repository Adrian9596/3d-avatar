/* Where the pointer meets the measurement surface. */

import * as THREE from 'three';
import { torsoMeshes } from './measurement.mjs';
import { canvas, camera } from './stage.mjs';

const penRaycaster=new THREE.Raycaster();

// Where the pointer meets the measurement surface: for placing a landmark and
// dragging a curve's dots (the pen has its own, internally).
export function surfaceHit(clientX,clientY){
  if(!torsoMeshes.length)return null;
  const rect=canvas.getBoundingClientRect();
  penRaycaster.setFromCamera(new THREE.Vector2(
    ((clientX-rect.left)/rect.width)*2-1,
    -((clientY-rect.top)/rect.height)*2+1),camera);
  const hits=penRaycaster.intersectObjects(torsoMeshes,false);
  if(!hits.length)return null;
  const hit=hits[0];
  const normal=hit.face?hit.face.normal.clone().transformDirection(hit.object.matrixWorld):new THREE.Vector3(hit.point.x,0,hit.point.z).normalize();
  return {point:hit.point.clone(),normal};
}
