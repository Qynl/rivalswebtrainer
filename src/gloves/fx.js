import { GloveLinks } from "./links.js";
import * as THREE from "three";
import { GLOVES } from "./catalog.js";
const X = new THREE.Vector3(1, 0, 0);
export const GLOVE_FX_LIMITS = Object.freeze({
  rings: 32,
  rays: 128,
  puffs: 64,
});
function pool(scene, geometry, count, kind = "ring") {
  const ray = kind === "ray",
    cloud = kind === "cloud";
  const progress = new THREE.InstancedBufferAttribute(
    new Float32Array(count).fill(1),
    1,
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("progress", progress);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: cloud ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexShader: `attribute float progress;varying float age;varying vec2 vUv;varying vec3 tint;void main(){age=progress;vUv=uv;tint=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying float age;varying vec2 vUv;varying vec3 tint;void main(){float edge=${cloud ? "exp(-dot(vUv-.5,vUv-.5)*12.)*.48" : ray ? "pow(max(0.,1.-abs(vUv.x-.5)*2.),1.5)*sin(vUv.y*3.14159)" : "smoothstep(.79,.88,length(vUv-.5)*2.)*(1.-smoothstep(.93,1.,length(vUv-.5)*2.))"};float alpha=edge*pow(1.-age,1.5);if(alpha<.003)discard;gl_FragColor=vec4(tint,alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = cloud
    ? "glove-ability-mist-pool"
    : ray
      ? "glove-impact-streak-pool"
      : "glove-shockwave-pool";
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  dummy.scale.setScalar(0);
  for (let i = 0; i < count; i++) {
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, new THREE.Color("white"));
  }
  scene.add(mesh);
  return {
    mesh,
    progress,
    states: Array.from({ length: count }, () => ({
      life: 0,
      max: 1,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      start: 0.1,
      end: 1,
      angle: 0,
      ground: false,
      inward: false,
    })),
    cursor: 0,
  };
}
export class GloveFX {
  constructor(scene) {
    this.scene = scene;
    this.rings = pool(
      scene,
      new THREE.RingGeometry(0.8, 1, 40),
      GLOVE_FX_LIMITS.rings,
    );
    this.rays = pool(
      scene,
      new THREE.PlaneGeometry(1, 1),
      GLOVE_FX_LIMITS.rays,
      "ray",
    );
    this.puffs = pool(
      scene,
      new THREE.PlaneGeometry(1, 1),
      GLOVE_FX_LIMITS.puffs,
      "cloud",
    );
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.direction = new THREE.Vector3();
  }
  emit(pool, position, color, options = {}) {
    const i = pool.cursor++ % pool.states.length,
      s = pool.states[i];
    Object.assign(
      s,
      {
        life: 0.36,
        max: 0.36,
        start: 0.12,
        end: 1,
        angle: 0,
        ground: false,
        inward: false,
      },
      options,
    );
    s.max = s.life;
    s.p.copy(position);
    s.q.identity();
    s.v.set(0, 0, 0);
    pool.mesh.setColorAt(i, this.color.set(color));
    pool.mesh.instanceColor.needsUpdate = true;
    return s;
  }
  link(source, target, color, life = 0.35) {
    this.links ||= new GloveLinks(this.scene);
    this.links.emit(source, target, color, life);
  }
  hit(position, color, heavy = false, key = "") {
    if (key === "snow")
      for (let i = 0; i < 4; i++) {
        const s = this.emit(this.puffs, position, "#8fdded", {
          start: 0.2,
          end: 0.7,
          life: 0.4,
        });
        s.v.set(Math.sin(i * 1.57) * 1.3, 0.5, Math.cos(i * 1.57) * 1.3);
      }
    if (["pull", "boomerang", "anchor"].includes(key))
      this.emit(this.rings, position, color, {
        start: 0.1,
        end: 1.3,
        inward: true,
        life: 0.45,
      });
    this.emit(this.rings, position, "#fff0d1", {
      end: heavy ? 1.15 : 0.72,
      life: 0.18,
    });
    this.emit(this.rings, position, color, {
      end: heavy ? 1.9 : 1.25,
      life: 0.32,
    });
    const n = heavy ? 12 : 8;
    for (let i = 0; i < n; i++)
      this.emit(this.rays, position, i % 3 ? color : "#fff5dc", {
        angle: (i / n) * Math.PI * 2 + 0.13,
        end: heavy ? 1.25 : 0.85,
        life: 0.26 + (i % 3) * 0.03,
      });
  }
  gas(position, yaw = 0, count = 3) {
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        s = this.emit(this.puffs, position, i % 2 ? "#9fb867" : "#678b50", {
          start: 0.3,
          end: 1.5,
          life: 0.7 + (i % 3) * 0.1,
        });
      s.p.x += Math.sin(a) * 0.25 + Math.sin(yaw) * 0.65;
      s.p.z += Math.cos(a) * 0.25 + Math.cos(yaw) * 0.65;
      s.v.set(
        Math.sin(yaw) * 1.4 + Math.sin(a) * 0.3,
        0.4,
        Math.cos(yaw) * 1.4 + Math.cos(a) * 0.3,
      );
    }
  }
  ability(event) {
    const glove = GLOVES[event.glove];
    if (!glove) return;
    const p = new THREE.Vector3().fromArray(event.position),
      color = glove.color,
      key = glove.key;
    const radial = key === "stun" || key === "za_hando",
      inward = key === "za_hando";
    if (key === "default") {
      this.gas(p, event.yaw || 0, 16);
      this.emit(
        this.rings,
        p.clone().add(new THREE.Vector3(0, -0.52, 0)),
        "#c4df86",
        {
          ground: true,
          end: 1.5,
          life: 0.35,
        },
      );
      return;
    }
    if (radial) {
      p.y -= 0.52;
      for (let i = 0; i < 3; i++)
        this.emit(this.rings, p, color, {
          ground: true,
          start: 0.3 + i * 0.2,
          end: (key === "stun" ? 5.8 : 9) * (1 - i * 0.14),
          life: 0.58 + i * 0.1,
          inward,
        });
      return;
    }
    if (key === "flash" || key === "swapper" || key === "thanos") {
      if (event.origin) {
        const departure = new THREE.Vector3().fromArray(event.origin);
        this.emit(this.rings, departure, color, {
          start: 1.2,
          end: 0.1,
          life: 0.45,
          ground: true,
        });
      }
      for (let i = 0; i < 3; i++) {
        p.y = event.position[1] - 0.1 + i * 0.35;
        this.emit(this.rings, p, color, {
          ground: true,
          start: 0.25,
          end: 1.3,
          life: 0.4 + i * 0.08,
        });
      }
      if (event.targetDestination) {
        const q = new THREE.Vector3().fromArray(event.targetDestination);
        q.y += 0.08;
        this.emit(this.rings, q, color, { ground: true, end: 1.3, life: 0.55 });
      }
      return;
    }
    if (key === "ghost") {
      for (let i = 0; i < 7; i++)
        this.emit(this.rays, p, color, {
          angle: (i * Math.PI * 2) / 7,
          end: 0.8,
          life: 0.6,
          inward: true,
        });
      return;
    }
    if (key === "brick") {
      p.y -= 0.53;
      this.emit(this.rings, p, color, { ground: true, end: 1, life: 0.35 });
      return;
    }
    this.hit(p, color, key === "golden" || key === "diamond");
  }
  update(dt, camera) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.links?.update(dt);
    for (const [data, ray] of [
      [this.rings, false],
      [this.rays, true],
      [this.puffs, "cloud"],
    ]) {
      for (let i = 0; i < data.states.length; i++) {
        const s = data.states[i];
        if (s.life <= 0 && data.progress.getX(i) >= 1) continue;
        s.life = Math.max(0, s.life - dt);
        const age = 1 - s.life / s.max;
        data.progress.setX(i, age);
        this.dummy.position.copy(s.p).addScaledVector(s.v, s.max - s.life);
        this.dummy.quaternion.copy(camera?.quaternion || s.q);
        const t = 1 - Math.pow(1 - age, 3),
          radius = s.inward
            ? s.end + (s.start - s.end) * t
            : s.start + (s.end - s.start) * t;
        if (s.ground) this.dummy.quaternion.setFromAxisAngle(X, -Math.PI / 2);
        if (ray === "cloud") {
          this.dummy.scale.setScalar(radius);
        } else if (ray) {
          this.dummy.rotateZ(s.angle);
          this.direction
            .set(Math.sin(s.angle), Math.cos(s.angle), 0)
            .applyQuaternion(camera?.quaternion || s.q);
          this.dummy.position.addScaledVector(this.direction, radius);
          this.dummy.scale.set(0.035 * (1 - age), 0.3 + age * 0.35, 1);
        } else this.dummy.scale.setScalar(radius);
        if (!s.life) this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        data.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      data.mesh.instanceMatrix.needsUpdate = true;
      data.progress.needsUpdate = true;
    }
  }
  clear() {
    this.links?.clear();
    for (const data of [this.rings, this.rays, this.puffs])
      for (const s of data.states) s.life = 0;
    this.update(0);
  }
  dispose() {
    this.links?.dispose();
    for (const data of [this.rings, this.rays, this.puffs]) {
      data.mesh.removeFromParent();
      data.mesh.geometry.dispose();
      data.mesh.material.dispose();
      data.mesh.dispose();
    }
  }
}
export function gloveActor(g, id) {
  if (id === undefined || id === null) return null;
  if (g.player && (g.player.id === id || g.player.netId === id))
    return g.player;
  return g.entities?.find((e) => e.id === id || e.netId === id) || null;
}
export function presentGloveAbility(g, event) {
  if (!g.scene?.add || g.headless) return;
  g.gloveFX ||= new GloveFX(g.scene);
  g.gloveFX.ability(event);
  const source = gloveActor(g, event.player);
  if (source && source === g.player) {
    const glove = GLOVES[event.glove];
    const names = {
      default: "FART BLAST · BOOSTING",
      diamond: "STONE FORM",
      flash: "BLINK",
      ghost: "INVISIBILITY",
      thanos: event.mark ? "RETURN POINT SET" : "TIME REVERSAL",
      stun: `EMP · ${event.affected || 0} STUNNED`,
      za_hando: `ERASURE · ${event.affected || 0} PULLED`,
      magnet: "TARGET LOCK · RUSHING",
      anchor: "DOCK PLACED",
      space: "ZERO-G LIFTOFF",
      golden: "POWERUP",
      reverse: "REFLECTION ACTIVE",
      acrobat: "DODGE ROLL",
      brick: "TRAP PLACED",
      swapper: "POSITIONS SWAPPED",
    };
    g.gloveNotice = {
      text: names[glove?.key] || glove?.ability || "ABILITY",
      until: g.clock + 1.1,
    };
  }
  if (source && event.glove === "glove_magnet") {
    const target = gloveActor(g, event.target);
    g.gloveFX.link(source, target, GLOVES[event.glove].color, 0.55);
  }
  if (source) {
    source.gloveCastTime = g.clock;
    source.gloveCastId = event.glove;
  }
}

export { gloveAbilitySound } from "./audio.js";
