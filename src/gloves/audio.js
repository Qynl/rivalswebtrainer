import { gloveImpactSound } from "./impact-sounds.js";
import * as THREE from "three";
import { GLOVES } from "./catalog.js";
export function gloveAbilitySound(key) {
  if (key === "default") return "slapBlast";
  if (["flash", "thanos", "swapper"].includes(key)) return "gloveBlink";
  if (key === "stun") return "gloveEMP";
  if (["za_hando", "magnet", "anchor"].includes(key)) return "glovePull";
  if (key === "diamond" || key === "brick") return "gloveStone";
  if (key === "ghost") return "gloveGhost";
  if (["golden", "reverse", "space"].includes(key)) return "glovePower";
  return "gloveRoll";
}
const validPosition = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const audible = (g) =>
  !g.headless &&
  g.audio &&
  g.audio.volume !== 0 &&
  g.player &&
  !["paused", "lobby", "results"].includes(g.state);
function local(g, id) {
  return (
    id !== undefined &&
    id !== null &&
    (id === g.player?.id || id === g.player?.netId || id === g.network?.id)
  );
}
function spatial(g, sound, position, level) {
  if (!validPosition(position)) return;
  const point = new THREE.Vector3().fromArray(position);
  const listener = g.player.alive
    ? g.eye(g.player)
    : g.camera?.position || g.eye(g.player);
  let yaw = g.yaw || 0;
  if (!g.player.alive && g.camera?.getWorldDirection) {
    const d = g.camera.getWorldDirection(new THREE.Vector3());
    yaw = Math.atan2(-d.x, -d.z);
  }
  const muffled = g.hasLOS ? !g.hasLOS(listener, point, false) : false;
  if (g.audio.playAt)
    g.audio.playAt(sound, point, listener, yaw, level, muffled);
  // A minimal audio implementation may not have a spatial bus. Do not replace
  // positional world sounds with equally loud map-wide playback in that case.
}
export function playGloveAbilityAudio(g, event) {
  if (!audible(g) || !GLOVES[event.glove]) return;
  const key = GLOVES[event.glove].key,
    sound = gloveAbilitySound(key);
  if (local(g, event.player) && g.player.alive) {
    g.audio.play?.(sound, 0.9);
    return;
  }
  if (
    ["flash", "thanos", "swapper"].includes(key) &&
    validPosition(event.origin) &&
    validPosition(event.position) &&
    Math.hypot(...event.position.map((p, i) => p - event.origin[i])) > 1.5
  ) {
    spatial(g, sound, event.origin, 0.4);
    spatial(g, sound, event.position, 0.55);
  } else spatial(g, sound, event.position, 0.75);
}
export function playGloveImpactAudio(g, event, source, target) {
  if (!audible(g)) return;
  const sound = gloveImpactSound(GLOVES[event.glove]?.key, event.roll);
  if (g.player.alive && (source === g.player || target === g.player))
    g.audio.play?.(sound, source === g.player ? 1 : 0.85);
  else spatial(g, sound, event.position, 0.65);
}

export function playGloveSwingAudio(g, body) {
  if (!audible(g) || !body) return;
  if (body === g.player && g.player.alive) g.audio.play?.("slapSwing", 0.85);
  else spatial(g, "slapSwing", [body.x, body.y + 1.45, body.z], 0.45);
}

export function playGloveStepAudio(g, body) {
  if (!audible(g) || !body) return;
  spatial(g, "step", [body.x, body.y + 0.08, body.z], 0.55);
}
