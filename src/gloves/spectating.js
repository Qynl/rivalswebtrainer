import * as THREE from "three";
import { cameraBoomFraction } from "./camera.js";
export function spectatorTargets(g) {
  if (!g.player || g.player.alive) return [];
  return (g.entities || []).filter(
    (e) => e !== g.player && e.alive && e.team === g.player.team,
  );
}
export function spectatorTarget(g) {
  const choices = spectatorTargets(g);
  const selected =
    choices.find((e) => e.id === g.spectatorTargetId) || choices[0] || null;
  g.spectatorTargetId = selected?.id ?? null;
  return selected;
}
export function cycleSpectator(g, direction) {
  const choices = spectatorTargets(g);
  if (!choices.length) return null;
  const current = choices.findIndex((e) => e.id === g.spectatorTargetId);
  const index =
    current < 0
      ? 0
      : (current + Math.sign(direction) + choices.length) % choices.length;
  g.spectatorTargetId = choices[index].id;
  return choices[index];
}
export function spectatorInfo(g) {
  const target = spectatorTarget(g),
    choices = spectatorTargets(g);
  return target
    ? {
        name: target.name,
        glove: target.activeWeapon,
        index: choices.indexOf(target) + 1,
        count: choices.length,
      }
    : null;
}
export function updateSpectatorCamera(g, dt) {
  const follow = spectatorTarget(g);
  if (!follow) {
    g.spectatorFollow = null;
    return;
  }
  const distance = Math.max(2, Math.min(12, g.spectatorZoom ?? 6));
  const origin = new THREE.Vector3(follow.x, follow.y + 2.1, follow.z);
  const desired = origin
    .clone()
    .add(new THREE.Vector3(distance * 0.7, distance * 0.42, distance * 0.7));
  const safe = origin
    .clone()
    .lerp(desired, cameraBoomFraction(origin, desired, g.world.boxes));
  if (g.spectatorFollow !== follow) {
    g.camera.position.copy(safe);
    g.spectatorFollow = follow;
  } else g.camera.position.lerp(safe, 1 - Math.exp(-8 * Math.max(0, dt)));
  // Retract immediately even while the follow camera is smoothing. Never lerp
  // through a wall, and never change authoritative local aim or remote input.
  const smoothed = g.camera.position.clone();
  g.camera.position
    .copy(origin)
    .lerp(smoothed, cameraBoomFraction(origin, smoothed, g.world.boxes));
  g.camera.lookAt(follow.x, follow.y + 1.15, follow.z);
}
