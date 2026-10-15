import * as THREE from "three";

export const SMOKE_RADIUS = 4.5;
export const SMOKE_PUFFS = 32;
const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};

// One instanced draw, no downloaded textures, depth bypass or per-frame geometry.
// Billboards are distributed through the volume rather than forming a solid
// faceted sphere. Opaque world geometry still occludes each individual puff.
export function createSmokeCloud() {
  const uniforms = {
      time: { value: 0 },
      fade: { value: 1 },
      growth: { value: 0.06 },
      detail: { value: 1 },
    },
    material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms,
      vertexShader: `
        uniform float time,growth;varying vec2 smokeUv;varying float seed,core;
        void main(){
          vec3 center=instanceMatrix[3].xyz;
          seed=dot(center,vec3(7.13,13.79,3.17));core=1.-step(1.5,length(center));
          center.x+=sin(time*.6+seed)*.12;
          center.z+=cos(time*.5+seed)*.12;
          center*=growth;
          vec4 viewCenter=modelViewMatrix*vec4(center,1.);
          vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
          viewCenter.xy+=position.xy*size*growth;
          gl_Position=projectionMatrix*viewCenter;smokeUv=uv;
        }`,
      fragmentShader: `
        uniform float time,fade,detail;varying vec2 smokeUv;varying float seed,core;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){
          vec2 q=smokeUv-.5,drift=vec2(time*.035,time*-.025)+seed;
          float n=noise(smokeUv*4.+drift);if(detail>.5)n=n*.65+noise(smokeUv*8.-drift*.7)*.35;
          float edge=length(q)+(n-.5)*.13;
          float density=(1.-smoothstep(.28,.5,edge))*mix(.8+n*.2,1.,core);
          float alpha=density*mix(.78,.97,core)*fade;if(alpha<.004)discard;
          vec3 color=mix(vec3(.32,.38,.42),vec3(.64,.69,.72),.42+n*.3+smokeUv.y*.2);
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
    mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(3, 3),
      material,
      SMOKE_PUFFS,
    ),
    dummy = new THREE.Object3D();
  mesh.name = "billowing-smoke";
  mesh.frustumCulled = false;
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const j = (i % 16) * 2 + (i >= 16 ? 1 : 0),
      y = 1 - (2 * (j + 0.5)) / SMOKE_PUFFS,
      angle = j * 2.39996323,
      r = Math.sqrt(1 - y * y),
      shell = i % 4 === 0 ? 1.05 : 2.75;
    dummy.position.set(
      Math.cos(angle) * r * shell,
      y * shell,
      Math.sin(angle) * r * shell,
    );
    dummy.scale.setScalar(0.9 + (i % 5) * 0.035);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.smokeUniforms = uniforms;
  return mesh;
}
export function animateSmoke(mesh, time, life, max = 7, performance = false) {
  const u = mesh.userData.smokeUniforms;
  if (!u) return; // The authoritative/headless simulation has no materials.
  mesh.count = performance ? SMOKE_PUFFS / 2 : SMOKE_PUFFS;
  u.detail.value = performance ? 0 : 1;
  u.time.value = time;
  u.fade.value = smooth(life / 1.5);
  u.growth.value = 0.06 + 0.94 * smooth((max - life) / 0.6);
}
// Solid haze only while inside the logical volume prevents near-plane holes
// from exposing opponents through the middle of the billboard cloud.
export function smokeImmersion(eye, zones) {
  let opacity = 0;
  for (const zone of zones) {
    const pos = zone.pos || zone.mesh?.position;
    if (!pos || (zone.type && zone.type !== "smoke")) continue;
    const life = zone.effect?.life ?? zone.life ?? 0;
    if (life <= 0) continue;
    const distance = Math.hypot(eye.x - pos.x, eye.y - pos.y, eye.z - pos.z),
      depth = smooth((SMOKE_RADIUS - distance) / 1.8);
    opacity = Math.max(opacity, depth * smooth(life / 1.5) * 0.92);
  }
  return opacity;
}
