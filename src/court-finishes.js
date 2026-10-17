import * as THREE from "three";
export const COURT_PAINT = Object.freeze({
  blockout: 0x3e6575,
  foundry: 0x985e42,
  courtyard: 0x3f7460,
});
// A two-tone architectural coating in the existing draw: no new obstacles,
// emissive silhouettes, decals, lights or transparency layers.
export function paintCourtMaterial(base, id, wallColor) {
  const material = base.clone();
  material.color.setHex(
    wallColor ?? (id === "blockout" ? 0x48616b : base.color.getHex()),
  );
  material.metalness = id === "foundry" ? 0.24 : 0;
  material.roughness = id === "foundry" ? 0.74 : 0.94;
  const paint = new THREE.Color(COURT_PAINT[id] ?? COURT_PAINT.blockout),
    compile = base.onBeforeCompile;
  material.name = "painted-court-" + id;
  material.userData.courtPaint = paint;
  material.onBeforeCompile = (shader) => {
    compile(shader);
    shader.uniforms.courtPaint = { value: paint };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nuniform vec3 courtPaint;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
   float courtVertical=1.-smoothstep(.15,.65,abs(normalize(vPanelNormal)).y);
   float courtBand=(1.-smoothstep(.94,1.04,vPanelPosition.y))*courtVertical;
   diffuseColor.rgb=mix(diffuseColor.rgb,courtPaint,courtBand*.78);
   float courtEdge=(1.-smoothstep(.018,.038,abs(vPanelPosition.y-1.02)))*courtVertical;
   diffuseColor.rgb=mix(diffuseColor.rgb,courtPaint*1.35,courtEdge*.6);`,
    );
  };
  material.customProgramCacheKey = () =>
    base.customProgramCacheKey() + "-court-painted-v1";
  return material;
}
