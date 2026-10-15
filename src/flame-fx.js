import * as THREE from "three";
export const FLAME_LIMIT = 192;
const EMITTER_LIMIT = 7,
  DOWN = new THREE.Vector3(0, -1, 0);
const NOISE = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}float fbm(vec2 p){return noise(p)*.65+noise(p*2.03+7.1)*.25+noise(p*4.1)*.1;}`;
// Two persistent instanced draws: flowing crossed ribbons + detached hot wisps.
// Seven fixed emitters cover a full 3v3 without allocating objects while firing.
export class FlameJet {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cursor = 0;
    this.active = 0;
    this.dummy = new THREE.Object3D();
    this.ray = new THREE.Raycaster();
    this.direction = new THREE.Vector3();
    this.segment = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.sheetRotation = new THREE.Quaternion();
    this.emitters = Array.from({ length: EMITTER_LIMIT }, () => ({
      key: null,
      life: 0,
      envelope: 0,
      credit: 0,
      range: 11,
      probeAt: -1,
      p: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      rotation: new THREE.Quaternion(),
    }));
    this.states = Array.from({ length: FLAME_LIMIT }, () => ({
      life: 0,
      max: 0.45,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      range: 11,
      seed: 0,
    }));
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 3);
    geometry.setAttribute(
      "flameData",
      new THREE.InstancedBufferAttribute(
        new Float32Array(FLAME_LIMIT * 3),
        3,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec3 flameData;varying vec2 vUv;varying vec3 data;uniform float time;
void main(){vUv=uv;data=flameData;vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);vec2 q=position.xy*data.y;q.x+=sin(uv.y*5.+time*14.+data.z)*.12*data.x;c.xy+=q;gl_Position=projectionMatrix*c;}`,
      fragmentShader: `varying vec2 vUv;varying vec3 data;uniform float time;${NOISE}
void main(){if(data.y<.001)discard;vec2 q=vUv-.5;float n=fbm(vUv*5.+vec2(data.z,time*-5.));float shape=1.-smoothstep(.12,.48,length(q*vec2(1.3,.8))+n*.18);float alpha=shape*(1.-smoothstep(.45,1.,data.x))*.32;if(alpha<.01)discard;float core=1.-smoothstep(.04,.3,length(q));vec3 orange=mix(vec3(1.6,.12,.006),vec3(3.,1.15,.1),core);gl_FragColor=vec4(orange,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, FLAME_LIMIT);
    this.mesh.name = "flamethrower-wisps";
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    const ribbon = new THREE.PlaneGeometry(1, 1, 4, 24);
    ribbon.setAttribute(
      "jetData",
      new THREE.InstancedBufferAttribute(
        new Float32Array(EMITTER_LIMIT * 3 * 4),
        4,
      ).setUsage(THREE.DynamicDrawUsage),
    );
    const jetMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec4 jetData;varying vec2 vUv;varying vec4 data;uniform float time;
void main(){vUv=uv;data=jetData;float u=1.-uv.y;float wave=sin(u*24.-time*19.+data.z)*u*.10;vec3 p=vec3(position.x*(.075+pow(u,.8)*3.2)+wave,-u*data.x,sin(u*29.-time*15.+data.z)*u*.07);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec2 vUv;varying vec4 data;uniform float time;${NOISE}
void main(){if(data.y<.002)discard;float u=1.-vUv.y;vec2 p=vec2(vUv.x*5.+data.z,u*26.-time*16.);float n=fbm(p);float curl=sin(u*25.-time*18.+data.z)*.035;float side=abs(vUv.x-.5+curl);float edge=1.-smoothstep(.16,.48,side+n*.14);float tip=1.-smoothstep(.72,.99,u+n*.07);float breakup=mix(1.,smoothstep(.24,.7,n),smoothstep(.25,.9,u));float a=edge*tip*breakup*data.y*.38;if(a<.008)discard;float core=(1.-smoothstep(.04,.3,side))*(.65+n*.35);vec3 hot=mix(vec3(1.65,.15,.005),vec3(3.3,1.7,.25),core);vec3 blue=mix(vec3(.08,.25,1.5),vec3(.8,1.6,2.7),core);vec3 color=mix(hot,blue,1.-smoothstep(.025,.10,u));gl_FragColor=vec4(color,a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
    });
    this.core = new THREE.InstancedMesh(ribbon, jetMaterial, EMITTER_LIMIT * 3);
    this.core.name = "flamethrower-continuous-core";
    this.core.frustumCulled = false;
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.core);
    this.clear();
  }
  source(key) {
    return (
      this.emitters.find((e) => e.key === key) ||
      this.emitters.find((e) => e.key === null) ||
      this.emitters.find((e) => e.envelope < 0.001)
    );
  }
  positionSource(source, origin, forward, solids, safeEye) {
    source.p.copy(origin);
    source.dir.copy(forward).normalize();
    source.rotation.setFromUnitVectors(DOWN, source.dir);
    if (safeEye) {
      this.segment.copy(origin).sub(safeEye);
      const distance = this.segment.length();
      if (distance > 0.001) {
        this.ray.set(safeEye, this.segment.multiplyScalar(1 / distance));
        this.ray.far = distance + 0.03;
        const wall = this.ray.intersectObjects(solids, false)[0];
        if (wall) {
          this.normal
            .copy(wall.face.normal)
            .transformDirection(wall.object.matrixWorld);
          source.p.copy(wall.point).addScaledVector(this.normal, 0.07);
        }
      }
    }
    this.ray.set(source.p, source.dir);
    this.ray.far = 12;
    const hit = this.ray.intersectObjects(solids, false)[0];
    source.range = hit ? Math.max(0.025, hit.distance - 0.06) : 12;
  }
  emit(
    origin,
    forward,
    solids = [],
    count = 10,
    key = "local",
    safeEye = null,
  ) {
    const source = this.source(key);
    if (!source) return;
    source.key = key;
    source.life = 0.18;
    this.positionSource(source, origin, forward, solids, safeEye);
    this.spawn(source, Math.min(3, count));
  }
  track(key, origin, forward, solids = [], safeEye = null) {
    const source = this.emitters.find((e) => e.key === key);
    if (source) this.positionSource(source, origin, forward, solids, safeEye);
  }
  stop(key = "local") {
    const source = this.emitters.find((e) => e.key === key);
    if (source) source.life = 0;
  }
  spawn(source, count) {
    for (let i = 0; i < count; i++) {
      const p = this.states[this.cursor++ % FLAME_LIMIT];
      p.life = p.max = 0.36 + Math.random() * 0.17;
      p.p.copy(source.p);
      p.origin.copy(source.p);
      p.range = source.range;
      p.v.copy(source.dir).multiplyScalar(20 + Math.random() * 4);
      p.v.x += (Math.random() - 0.5) * 1.4;
      p.v.y += (Math.random() - 0.5) * 1.0;
      p.v.z += (Math.random() - 0.5) * 1.4;
      p.seed = Math.random() * 50;
    }
  }
  update(dt) {
    this.time += dt;
    this.mesh.material.uniforms.time.value =
      this.core.material.uniforms.time.value = this.time;
    const ribbons = this.core.geometry.attributes.jetData;
    let coreActive = false;
    for (let i = 0; i < this.emitters.length; i++) {
      const source = this.emitters[i];
      source.life = Math.max(0, source.life - dt);
      source.envelope +=
        (Number(source.life > 0) - source.envelope) * (1 - Math.exp(-dt * 32));
      if (source.life > 0) {
        source.credit += dt * 110;
        const count = Math.floor(source.credit);
        source.credit -= count;
        this.spawn(source, count);
      } else source.credit = 0;
      if (source.envelope > 0.002) coreActive = true;
      for (let sheet = 0; sheet < 3; sheet++) {
        const at = i * 3 + sheet;
        ribbons.setXYZW(
          at,
          source.range,
          source.envelope,
          i * 0.71 + sheet * 2.1,
          sheet,
        );
        this.dummy.position.copy(source.p);
        this.dummy.quaternion.copy(source.rotation);
        this.sheetRotation.setFromAxisAngle(DOWN, (sheet * Math.PI) / 3);
        this.dummy.quaternion.multiply(this.sheetRotation);
        this.dummy.updateMatrix();
        this.core.setMatrixAt(at, this.dummy.matrix);
      }
    }
    this.core.visible = coreActive;
    ribbons.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    const data = this.mesh.geometry.attributes.flameData;
    this.active = 0;
    this.dummy.quaternion.identity();
    for (let i = 0; i < this.states.length; i++) {
      const p = this.states[i];
      p.life = Math.max(0, p.life - dt);
      if (p.life > 0) {
        p.p.addScaledVector(p.v, dt);
        p.v.y += dt * 1.5;
        if (p.p.distanceTo(p.origin) > p.range) p.life = 0;
      }
      const age = 1 - p.life / p.max;
      data.setXYZ(i, age, p.life > 0 ? 0.09 + age * 0.95 : 0, p.seed);
      this.dummy.position.copy(p.p);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      if (p.life > 0) this.active++;
    }
    this.mesh.visible = this.active > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    data.needsUpdate = true;
  }
  clear() {
    for (const p of this.states) p.life = 0;
    for (const s of this.emitters) {
      s.life = s.envelope = s.credit = 0;
      s.key = null;
    }
    this.active = 0;
    this.mesh.visible = this.core.visible = false;
    this.mesh.geometry.attributes.flameData.array.fill(0);
    this.core.geometry.attributes.jetData.array.fill(0);
  }
  dispose() {
    for (const mesh of [this.mesh, this.core]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
