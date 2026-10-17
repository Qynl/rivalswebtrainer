import * as THREE from "three";
import { GLOVES } from "./catalog.js";
import { GloveFX } from "./fx.js";
import { playGloveReturnAudio } from "./audio.js";
const identifies = (actor, id) =>
  id != null && (actor?.id === id || actor?.netId === id);
// Presentation for the accepted SECOND impulse, never a second contact/damage.
export function presentBoomerangReturn(g, event, source, target) {
  if (
    g.headless ||
    !g.scene?.add ||
    event.type !== "impulse" ||
    event.glove !== "glove_boomerang" ||
    event.phase !== "return" ||
    !identifies(source, event.source) ||
    !identifies(target, event.player) ||
    target.alive === false
  )
    return false;
  if (
    event.round !== undefined &&
    g.round !== undefined &&
    event.round !== g.round
  )
    return false;
  if (
    !Array.isArray(event.position) ||
    event.position.length !== 3 ||
    !event.position.every((n) => Number.isFinite(n) && Math.abs(n) < 10000)
  )
    return false;
  // A short visible effect must not become a tracker for hidden actors.
  if (
    (source.ghostTime > 0 && source !== g.player) ||
    (target.ghostTime > 0 && target !== g.player)
  )
    return false;
  const color = new THREE.Color(GLOVES.glove_boomerang.color).getHex();
  g.gloveFX ||= new GloveFX(g.scene);
  g.gloveFX.returnPull(new THREE.Vector3().fromArray(event.position), color);
  g.gloveFX.link(source, target, color, 0.24);
  playGloveReturnAudio(g, event, source, target);
  return true;
}
