import * as THREE from "three";
import { validateAnimationContract } from "./contracts.js";

export class AnimationController {
  constructor(root, clips) {
    this.root = root;
    this.clips = clips;
    this.contract = validateAnimationContract(clips.map((clip) => clip.name));
    this.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    this.activeAction = null;
  }

  play(name) {
    if (!this.mixer) return false;
    const clip = THREE.AnimationClip.findByName(this.clips, name);
    if (!clip) return false;
    if (this.activeAction) this.activeAction.fadeOut(0.15);
    this.activeAction = this.mixer.clipAction(clip);
    this.activeAction.reset().setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
    this.activeAction.fadeIn(0.15).play();
    return true;
  }

  update(delta) {
    this.mixer?.update(delta);
  }
}

