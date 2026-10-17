import * as THREE from "three";
import { detailedWeapon } from "./weapon-models.js";
import { COMBAT_ITEMS as WEAPONS } from "./data.js";
export const THROW_DURATION = 0.48,
  THROW_RELEASE = 0.16;
export const THROWN_UTILITIES = new Set([
  "grenade",
  "molotov",
  "smoke",
  "flashbang",
]);

// The projectile is the same original model as the held item, not a coloured ball.
export function createThrownModel(id) {
  const model = detailedWeapon(id, WEAPONS[id], { hands: false });
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const center = new THREE.Box3()
    .setFromObject(model)
    .getCenter(new THREE.Vector3());
  model.position.sub(center);
  const group = new THREE.Group();
  group.name = "thrown-" + id;
  group.add(model);
  group.userData.item = model;
  group.userData.utility = id;
  if (id !== "molotov") {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 6, 4),
      new THREE.MeshBasicMaterial({
        color:
          id === "grenade" ? 0xffad62 : id === "smoke" ? 0xa6d5b0 : 0xe3f0ff,
        transparent: true,
      }),
    );
    led.position.y = new THREE.Box3().setFromObject(group).max.y - 0.025;
    group.add(led);
    group.userData.fuseLight = led;
  }
  return group;
}
export function animateThrown(p, dt, time) {
  const led = p.mesh.userData.fuseLight;
  if (led)
    led.material.opacity =
      0.25 + 0.75 * Math.sin(time * ((p.fuse || 2) < 0.6 ? 24 : 12)) ** 2;
  const flame = p.mesh.userData.item?.userData.pilotFlame;
  if (flame) flame.scale.set(1, 1 + Math.sin(time * 31) * 0.18, 1);
  if (!p.spin) return;
  p.mesh.rotation.x += p.spin.x * dt;
  p.mesh.rotation.y += p.spin.y * dt;
  p.mesh.rotation.z += p.spin.z * dt;
}
// Smooth value noise avoids repeating stripes and needs no texture download.
const FIRE_NOISE = `
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.,1.)),f.x),f.y);}
float turbulence(vec2 p){return noise21(p)*.65+noise21(p*2.03+7.1)*.25+noise21(p*4.01)*.1;}
`;
export function createFirePatch() {
  const group = new THREE.Group();
  group.name = "molotov-fire";
  const uniforms = { time: { value: 0 }, fade: { value: 1 } };
  const base = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms,
      vertexShader:
        "varying vec2 pUv;void main(){pUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec2 pUv;uniform float time,fade;${FIRE_NOISE}
void main(){
  vec2 p=(pUv-.5)*2.;float r=length(p);
  float n=turbulence(p*4.2+vec2(time*.16,-time*.2));
  float edge=1.-smoothstep(.65+n*.12,.92+n*.08,r);
  float ember=smoothstep(.47,.85,n)*( .65+.35*sin(time*4.+n*17.));
  gl_FragColor=vec4(mix(vec3(.065,.04,.025),vec3(1.1,.21,.018),ember),edge*.56*fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`,
    }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.025;
  group.add(base);
  const geometry = new THREE.PlaneGeometry(0.65, 1.15, 1, 5);
  geometry.translate(0, 0.575, 0);
  geometry.setAttribute(
    "seed",
    new THREE.InstancedBufferAttribute(
      Float32Array.from({ length: 22 }, (_, i) => i * 0.713),
      1,
    ),
  );
  const flames = new THREE.InstancedMesh(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: `attribute float seed;uniform float time;varying vec2 pUv;varying float phase;
void main(){pUv=uv;phase=seed;
vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
float h=.65+.32*sin(seed*19.)+.14*sin(time*8.+seed*13.);
c.x+=position.x*(.85+.2*cos(seed*7.))+sin(time*6.+seed*9.+uv.y*3.)*uv.y*.13;
c.y+=position.y*h;gl_Position=projectionMatrix*c;}`,
      fragmentShader: `varying vec2 pUv;varying float phase;uniform float time,fade;${FIRE_NOISE}
void main(){
  vec2 q=vec2(pUv.x*4.+phase,pUv.y*4.-time*3.1);
  float n=turbulence(q), y=pUv.y;
  float center=.5+sin(y*8.-time*5.+phase)*y*.11;
  float w=max(.006,(1.-y)*(.26+.18*n));
  float edge=1.-smoothstep(w*.28,w,abs(pUv.x-center));
  float a=edge*(1.-smoothstep(.42+n*.3,.92,y))*(.58+.32*n)*fade;
  a*=smoothstep(0.,.07,y);if(a<.01)discard;
  float core=(1.-y)*edge;
  gl_FragColor=vec4(mix(vec3(1.6,.2,.018),vec3(2.9,1.35,.2),core),a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`,
    }),
    22,
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 22; i++) {
    const angle = i * 2.39996,
      r = Math.sqrt((i + 0.5) / 22) * 2.7;
    dummy.position.set(Math.cos(angle) * r, 0.04, Math.sin(angle) * r);
    dummy.updateMatrix();
    flames.setMatrixAt(i, dummy.matrix);
  }
  flames.frustumCulled = false;
  group.add(flames);
  group.userData.fireUniforms = uniforms;
  return group;
}
export function animateFire(group, time, life) {
  const u = group.userData.fireUniforms;
  if (u) {
    u.time.value = time;
    u.fade.value = Math.max(0, Math.min(1, life / 0.6));
  }
}
