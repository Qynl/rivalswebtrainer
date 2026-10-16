import * as THREE from "three";
const origin = new THREE.Vector3(),
  toViewer = new THREE.Vector3(),
  forward = new THREE.Vector3(),
  rotation = new THREE.Quaternion();
export function createScopeGlint() {
  const glint = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, size: { value: 0.22 } },
      vertexShader: `varying vec2 uvGlint; uniform float size;
      void main() { uvGlint = uv; vec4 center = modelViewMatrix * vec4(0.,0.,0.,1.);
      center.xy += position.xy * size; gl_Position = projectionMatrix * center; }`,
      fragmentShader: `varying vec2 uvGlint; uniform float opacity;
      void main() { vec2 p = (uvGlint - .5) * 2.; float r = length(p);
      float core = exp(-r*r*45.)*3.; float halo = exp(-r*r*10.)*.24;
      float star = (exp(-abs(p.x)*100.) + exp(-abs(p.y)*100.)) * pow(max(0.,1.-r),3.)*.4;
      float alpha = (core + halo + star)*opacity; if(alpha < .003) discard;
      gl_FragColor = vec4(vec3(1.),alpha); }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  glint.name = "sniper-scope-glint";
  glint.position.set(0.24, 0.028, -0.936);
  glint.frustumCulled = false;
  glint.visible = false;
  return glint;
}
export function updateScopeGlint(model, actor, viewer, clock = 0) {
  const weapon = model.parts.onlineSocket?.userData.weapon;
  const glint = weapon?.userData.scopeGlint;
  if (!glint) return;
  glint.visible = false;
  glint.material.uniforms.opacity.value = 0;
  if (
    !viewer ||
    actor.alive === false ||
    !actor.aiming ||
    actor.activeWeapon !== "sniper" ||
    actor.reload > 0 ||
    actor.quickMeleeTime > 0 ||
    actor.quickUtilityTime > 0 ||
    actor.deflectTime > 0 ||
    actor.healTime > 0 ||
    !model.parts.onlineSocket.visible
  )
    return;
  glint.getWorldPosition(origin);
  weapon.getWorldQuaternion(rotation);
  forward.set(0, 0, -1).applyQuaternion(rotation);
  toViewer.copy(viewer).sub(origin);
  const distance = toViewer.length();
  if (distance < 0.2) return;
  const facing = forward.dot(toViewer.multiplyScalar(1 / distance));
  const cone = THREE.MathUtils.smoothstep(facing, 0.86, 0.985);
  if (cone <= 0) return;
  glint.material.uniforms.opacity.value =
    cone * (0.94 + Math.sin(clock * 7) * 0.06);
  glint.material.uniforms.size.value = THREE.MathUtils.clamp(
    distance * 0.012,
    0.28,
    0.65,
  );
  glint.visible = true;
}
