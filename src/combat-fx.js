import * as THREE from "three";
import { circleBox, surfaceHeight } from "./physics.js";

// Fixed-size pools: sustained automatic fire never creates a mesh/material per hit.
export const FX_LIMITS = Object.freeze({
  particles: 384,
  traces: 64,
  decals: 128,
  casings: 48,
});
export class CombatFX {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cursor = { particle: 0, trace: 0, decal: 0, casing: 0 };
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.size = new THREE.Vector2();
    this.up = new THREE.Vector3(0, 0, 1);
    this.direction = new THREE.Vector3();
    this.particleState = Array.from({ length: FX_LIMITS.particles }, () => ({
      life: 0,
      v: new THREE.Vector3(),
      type: 0,
      opacity: 0.75,
      baseSize: 0.035,
      maxLife: 1,
    }));
    this.traceLife = new Float32Array(FX_LIMITS.traces);
    this.traceState = Array.from({ length: FX_LIMITS.traces }, () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      length: 0,
    }));
    this.casingState = Array.from({ length: FX_LIMITS.casings }, () => ({
      life: 0,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      r: new THREE.Euler(),
      spin: new THREE.Vector3(),
    }));
    const geometry = new THREE.BufferGeometry();
    for (const [name, width] of [
      ["position", 3],
      ["color", 3],
      ["size", 1],
      ["alpha", 1],
      ["shape", 1],
    ])
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          new Float32Array(FX_LIMITS.particles * width),
          width,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { pointScale: { value: 400 } },
        vertexShader: `attribute float size,alpha,shape;attribute vec3 color;uniform float pointScale;
          varying vec3 tint;varying float opacity,style;
          void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
          gl_PointSize=clamp(size*pointScale/max(.1,-p.z),1.,22.);tint=color;opacity=alpha;style=shape;}`,
        fragmentShader: `varying vec3 tint;varying float opacity,style;
          void main(){vec2 q=gl_PointCoord-.5;float mode=floor(style),angle=fract(style)*7.85;
          q=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*q;
          float a;vec3 color=tint;
          if(mode<.5){a=1.-smoothstep(.15,1.,length(q)*2.);}
          else if(mode<1.5){float edge=max(abs(q.x)*1.8,abs(q.y)*2.5);a=1.-smoothstep(.72,1.,edge);color*=.68+.32*step(0.,q.x+q.y);}
          else if(mode<2.5){a=pow(max(0.,1.-length(q)*2.),1.5)*.6;}
          else {a=1.-smoothstep(.4,1.,abs(q.x)*6.+abs(q.y)*2.);}
          a*=opacity;if(a<.005)discard;gl_FragColor=vec4(color,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(this.size);
      this.points.material.uniforms.pointScale.value =
        this.size.y * 0.5 * camera.projectionMatrix.elements[5];
    };
    const traceGeometry = new THREE.BufferGeometry();
    for (const [name, width] of [
      ["position", 3],
      ["color", 3],
      ["alpha", 1],
    ])
      traceGeometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          new Float32Array(FX_LIMITS.traces * 2 * width),
          width,
        ).setUsage(THREE.DynamicDrawUsage),
      );
    this.traces = new THREE.LineSegments(
      traceGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `attribute vec3 color;attribute float alpha;varying vec3 tint;varying float opacity;void main(){tint=color;opacity=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec3 tint;varying float opacity;void main(){gl_FragColor=vec4(tint,opacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,
      }),
    );
    this.traces.frustumCulled = false;
    const decalGeometry = new THREE.PlaneGeometry(0.16, 0.16);
    decalGeometry.setAttribute(
      "birth",
      new THREE.InstancedBufferAttribute(
        new Float32Array(FX_LIMITS.decals).fill(-1000),
        1,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    this.decals = new THREE.InstancedMesh(
      decalGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: { time: { value: 0 } },
        vertexShader: `attribute float birth;uniform float time;varying vec2 hitUv;varying float age;void main(){hitUv=uv;age=time-birth;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 hitUv;varying float age;void main(){if(age>14.||age<0.)discard;vec2 p=hitUv-.5;float r=length(p),angle=atan(p.y,p.x);float edge=.19+sin(angle*7.)*.018+sin(angle*13.)*.015;float hole=1.-smoothstep(edge-.025,edge+.02,r);float scuff=(1.-smoothstep(.2,.48,r))*.28;float crack=pow(max(0.,cos(angle*5.+r*7.)),22.)*(1.-smoothstep(.2,.48,r))*.25;float opacity=max(hole*.83,max(scuff,crack))*(1.-smoothstep(12.,14.,age));if(opacity<.01)discard;gl_FragColor=vec4(mix(vec3(.31,.32,.33),vec3(.045,.048,.05),hole),opacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`,
      }),
      FX_LIMITS.decals,
    );
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 5;
    this.casings = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.033, 6),
      new THREE.MeshStandardMaterial({
        color: 0xb19a55,
        metalness: 0.8,
        roughness: 0.3,
      }),
      FX_LIMITS.casings,
    );
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    scene.add(this.points, this.traces, this.decals, this.casings);
    this.clear();
  }
  clear() {
    for (const p of this.particleState) p.life = 0;
    this.traceLife.fill(0);
    for (const c of this.casingState) c.life = 0;
    this.decals.geometry.attributes.birth.array.fill(-1000);
    this.decals.geometry.attributes.birth.needsUpdate = true;
    this.decals.count = 0;
    this.points.geometry.setDrawRange(0, 0);
    this.traces.geometry.setDrawRange(0, 0);
    this.casings.count = 0;
    this.points.geometry.attributes.alpha.array.fill(0);
    this.traces.geometry.attributes.alpha.array.fill(0);
    this.points.geometry.attributes.alpha.needsUpdate =
      this.traces.geometry.attributes.alpha.needsUpdate = true;
    this.cursor = { particle: 0, trace: 0, decal: 0, casing: 0 };
    this.active = { particles: 0, traces: 0, casings: 0 };
  }
  burst(position, color, count = 10, normal = null) {
    this.color.set(color);
    const a = this.points.geometry.attributes;
    for (let n = 0; n < Math.min(count, FX_LIMITS.particles); n++) {
      const i = this.cursor.particle++ % FX_LIMITS.particles,
        p = this.particleState[i];
      p.life = 0.22 + Math.random() * 0.32;
      p.type = 0;
      p.opacity = 0.75;
      p.maxLife = p.life;
      p.baseSize = 0.035 + Math.random() * 0.055;
      p.v.set(
        (Math.random() - 0.5) * 3.5,
        Math.random() * 3,
        (Math.random() - 0.5) * 3.5,
      );
      if (normal && normal.lengthSq() > 1e-8) {
        const length = normal.length();
        p.v.addScaledVector(normal, 1.8 / length);
        const outward = p.v.dot(normal) / length;
        if (outward < 0.4)
          p.v.addScaledVector(normal, (0.4 - outward) / length);
      }
      a.position.setXYZ(i, position.x, position.y, position.z);
      a.color.setXYZ(i, this.color.r, this.color.g, this.color.b);
      a.size.setX(i, p.baseSize);
      a.shape.setX(i, 0);
      a.alpha.setX(i, 0.75);
    }
    for (const name of ["position", "color", "size", "alpha", "shape"])
      a[name].needsUpdate = true;
    this.points.geometry.setDrawRange(0, FX_LIMITS.particles);
  }
  impact(position, normal) {
    const i = this.cursor.decal++ % FX_LIMITS.decals;
    const n = this.direction.copy(normal);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    else n.normalize();
    this.dummy.position.copy(position).addScaledVector(n, 0.007);
    this.dummy.quaternion.setFromUnitVectors(this.up, n);
    this.dummy.rotateZ(Math.random() * Math.PI * 2);
    this.dummy.scale.setScalar(0.7 + Math.random() * 0.5);
    this.dummy.updateMatrix();
    this.decals.setMatrixAt(i, this.dummy.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decals.geometry.attributes.birth.setX(i, this.time);
    this.decals.geometry.attributes.birth.needsUpdate = true;
    this.decals.count = Math.min(FX_LIMITS.decals, this.cursor.decal);
    const attrs = this.points.geometry.attributes;
    for (const [type, color, count] of [
      [1, 0x85877f, 6],
      [2, 0x999083, 4],
      [3, 0xffd49c, 2],
    ]) {
      const start = this.cursor.particle;
      this.burst(position, color, count, n);
      for (let k = 0; k < count; k++) {
        const slot = (start + k) % FX_LIMITS.particles,
          p = this.particleState[slot];
        attrs.position.setXYZ(
          slot,
          position.x + n.x * 0.012,
          position.y + n.y * 0.012,
          position.z + n.z * 0.012,
        );
        p.type = type;
        p.life =
          type === 3
            ? 0.08 + Math.random() * 0.06
            : type === 2
              ? 0.35 + Math.random() * 0.2
              : 0.25 + Math.random() * 0.25;
        p.maxLife = p.life;
        p.opacity = type === 2 ? 0.35 : 0.85;
        p.baseSize =
          type === 2
            ? 0.09 + Math.random() * 0.035
            : type === 3
              ? 0.035
              : 0.035 + Math.random() * 0.025;
        if (type === 2) p.v.multiplyScalar(0.22).addScaledVector(n, 0.35);
        if (type === 3) {
          p.v.multiplyScalar(1.6);
          this.color.set(color).multiplyScalar(2);
          attrs.color.setXYZ(slot, this.color.r, this.color.g, this.color.b);
        }
        attrs.shape.setX(slot, type + Math.random() * 0.8);
        attrs.size.setX(slot, p.baseSize);
        attrs.alpha.setX(slot, p.opacity);
      }
    }
  }
  trace(a, b, team = 0, color) {
    const i = this.cursor.trace++ % FX_LIMITS.traces,
      attrs = this.traces.geometry.attributes;
    this.color
      .set(color ?? (team === 0 ? 0xffdfad : 0xffb49d))
      .multiplyScalar(2.6);
    const t = this.traceState[i];
    t.a.copy(a);
    t.b.copy(b);
    t.length = a.distanceTo(b);
    const end = Math.min(1, 4 / Math.max(0.001, t.length));
    attrs.position.setXYZ(i * 2, a.x, a.y, a.z);
    attrs.position.setXYZ(
      i * 2 + 1,
      a.x + (b.x - a.x) * end,
      a.y + (b.y - a.y) * end,
      a.z + (b.z - a.z) * end,
    );
    for (const index of [i * 2, i * 2 + 1]) {
      attrs.color.setXYZ(index, this.color.r, this.color.g, this.color.b);
      attrs.alpha.setX(index, 0.75);
    }
    this.traceLife[i] = 0.065;
    for (const key of ["position", "color", "alpha"])
      attrs[key].needsUpdate = true;
    this.traces.geometry.setDrawRange(0, FX_LIMITS.traces * 2);
  }
  eject(position, right, forward) {
    const i = this.cursor.casing++ % FX_LIMITS.casings,
      c = this.casingState[i];
    c.life = 2.5;
    c.p.copy(position);
    c.v
      .copy(right)
      .multiplyScalar(1.8 + Math.random() * 1.2)
      .addScaledVector(forward, 0.4);
    c.v.y += 1.3 + Math.random();
    c.r.set(Math.random(), Math.random(), Math.random());
    c.spin.set(8 + Math.random() * 5, 6, 11);
    this.casings.count = FX_LIMITS.casings;
  }
  update(dt, boxes = []) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    this.decals.material.uniforms.time.value = this.time;
    const attrs = this.points.geometry.attributes;
    let particles = 0,
      traces = 0,
      casings = 0,
      particleDirty = false;
    for (let i = 0; i < this.particleState.length; i++) {
      const p = this.particleState[i];
      if (p.life <= 0) continue;
      p.life = Math.max(0, p.life - dt);
      particleDirty = true;
      const oldY = attrs.position.getY(i);
      p.v.y -= (p.type === 2 ? -0.3 : p.type === 1 ? 9 : 7) * dt;
      p.v.multiplyScalar(Math.exp(-(p.type === 2 ? 4 : 2) * dt));
      attrs.position.setXYZ(
        i,
        attrs.position.getX(i) + p.v.x * dt,
        attrs.position.getY(i) + p.v.y * dt,
        attrs.position.getZ(i) + p.v.z * dt,
      );
      if (p.type === 1 && p.v.y < 0) {
        const x = attrs.position.getX(i),
          z = attrs.position.getZ(i);
        let floor = 0;
        for (const box of boxes)
          if (circleBox(x, z, 0.02, box)) {
            const top = surfaceHeight(box, x, z);
            if (oldY >= top - 0.02 && attrs.position.getY(i) <= top + 0.02)
              floor = Math.max(floor, top);
          }
        if (attrs.position.getY(i) < floor + 0.02) {
          attrs.position.setY(i, floor + 0.02);
          p.v.y = Math.abs(p.v.y) * 0.22;
          p.v.x *= 0.58;
          p.v.z *= 0.58;
          p.life = Math.min(p.life, 0.14);
        }
      }
      attrs.alpha.setX(
        i,
        p.opacity * Math.min(1, p.life / (p.type === 0 ? 0.15 : 0.12)),
      );
      attrs.size.setX(
        i,
        p.baseSize * (p.type === 2 ? 1 + (1 - p.life / p.maxLife) * 1.8 : 1),
      );
      if (p.life > 0) particles++;
    }
    if (particleDirty) {
      attrs.position.needsUpdate = true;
      attrs.alpha.needsUpdate = true;
      attrs.size.needsUpdate = true;
    }
    if (!particles) this.points.geometry.setDrawRange(0, 0);
    for (let i = 0; i < this.traceLife.length; i++)
      if (this.traceLife[i] > 0) {
        this.traceLife[i] = Math.max(0, this.traceLife[i] - dt);
        const alpha = (this.traceLife[i] / 0.065) * 0.75;
        const t = this.traceState[i],
          head = Math.min(1, (1 - this.traceLife[i] / 0.065) * 1.3 + 0.1),
          tail = Math.max(
            0,
            head - Math.min(0.6, 4 / Math.max(0.001, t.length)),
          );
        const positions = this.traces.geometry.attributes.position;
        positions.setXYZ(
          i * 2,
          t.a.x + (t.b.x - t.a.x) * tail,
          t.a.y + (t.b.y - t.a.y) * tail,
          t.a.z + (t.b.z - t.a.z) * tail,
        );
        positions.setXYZ(
          i * 2 + 1,
          t.a.x + (t.b.x - t.a.x) * head,
          t.a.y + (t.b.y - t.a.y) * head,
          t.a.z + (t.b.z - t.a.z) * head,
        );
        positions.needsUpdate = true;
        this.traces.geometry.attributes.alpha.setX(i * 2, alpha);
        this.traces.geometry.attributes.alpha.setX(i * 2 + 1, alpha);
        if (alpha > 0) traces++;
        this.traces.geometry.attributes.alpha.needsUpdate = true;
      }
    if (!traces) this.traces.geometry.setDrawRange(0, 0);
    for (let i = 0; i < this.casingState.length; i++) {
      const c = this.casingState[i];
      this.dummy.scale.setScalar(0);
      if (c.life > 0) {
        c.life = Math.max(0, c.life - dt);
        const oldY = c.p.y;
        c.v.y -= 20 * dt;
        c.p.addScaledVector(c.v, dt);
        let floor = 0;
        for (const b of boxes)
          if (circleBox(c.p.x, c.p.z, 0.009, b)) {
            const top = surfaceHeight(b, c.p.x, c.p.z);
            if (oldY >= top - 0.02 && c.p.y <= top + 0.017)
              floor = Math.max(floor, top);
          }
        if (c.p.y < floor + 0.017) {
          c.p.y = floor + 0.017;
          c.v.y = Math.abs(c.v.y) * 0.28;
          c.v.x *= 0.6;
          c.v.z *= 0.6;
          c.spin.multiplyScalar(0.65);
        }
        c.r.x += c.spin.x * dt;
        c.r.y += c.spin.y * dt;
        c.r.z += c.spin.z * dt;
        this.dummy.position.copy(c.p);
        this.dummy.rotation.copy(c.r);
        this.dummy.scale.setScalar(Math.min(1, c.life / 0.18));
        casings++;
      }
      this.dummy.updateMatrix();
      this.casings.setMatrixAt(i, this.dummy.matrix);
    }
    if (casings) this.casings.instanceMatrix.needsUpdate = true;
    else this.casings.count = 0;
    this.active = { particles, traces, casings };
  }
  dispose() {
    for (const object of [
      this.points,
      this.traces,
      this.decals,
      this.casings,
    ]) {
      object.removeFromParent();
      object.geometry.dispose();
      object.material.dispose();
      object.dispose?.();
    }
  }
}
