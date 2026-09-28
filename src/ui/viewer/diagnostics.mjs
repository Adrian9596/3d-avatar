/* The app's state for automated checks: one object, published as
   window.__avatarPrototype and window.__avatarPlatform (the names two lanes had
   before they were merged) and mirrored into #prototypeDiagnostics. */

import { ASSET_URL, ASSET_VERSION, ASSET_SHA } from './asset.mjs';

export const prototypeState={status:'LOADING',assetUrl:ASSET_URL,version:ASSET_VERSION,sha256:ASSET_SHA,roleCounts:{BODY:0,BIKINI_TOP:0,BIKINI_BRIEF:0},roleVisibility:{BODY:true,BIKINI_TOP:true,BIKINI_BRIEF:true},wireframe:false,meshCount:0,morphNames:[],armaturePresent:false,clipNames:[],contracts:null,loadMs:null,camera:null,error:null};
// One app, so one diagnostics object under both of the names it has been read
// by: __avatarPrototype since this file was the prototype lane, __avatarPlatform
// since the production lane was merged into it.
window.__avatarPrototype=prototypeState;
window.__avatarPlatform=prototypeState;
const diagnosticOutput=document.getElementById('prototypeDiagnostics');
export function syncDiagnostics(){diagnosticOutput.textContent=JSON.stringify(prototypeState);document.documentElement.dataset.prototypeStatus=prototypeState.status}
syncDiagnostics();
