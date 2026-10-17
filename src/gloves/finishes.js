import * as THREE from "three";
export function gloveFinish(color, key) {
  const metallic = ["diamond", "thanos", "golden", "anchor", "magnet"].includes(
    key,
  );
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: metallic ? 0.3 : 0.56,
    metalness: metallic ? 0.58 : 0.08,
    clearcoat: metallic ? 0.65 : 0.18,
    clearcoatRoughness: 0.3,
    sheen: metallic ? 0.12 : 0.48,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.25),
    sheenRoughness: 0.7,
  });
  material.name = "sculpted-glove-shell";
  // Tiny locally generated textile. Mipmaps prevent dancing pixels at distance.
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4,
        n =
          175 +
          ((x * 13 + y * 7) % 9) +
          (x % 4 < 2 ? 24 : 0) -
          (y % 4 < 2 ? 14 : 0);
      data[i] = data[i + 1] = data[i + 2] = metallic ? 225 : n;
      data[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = "original-glove-weave";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  material.roughnessMap = texture;
  material.bumpMap = texture;
  material.bumpScale = metallic ? 0.001 : 0.004;
  // Existing preview/bot/equip call sites all dispose materials. Texture belongs
  // to this single material, so it follows those lifetimes too.
  material.addEventListener("dispose", () => texture.dispose());
  return material;
}
export function createSweep(color) {
  const n = 32,
    positions = [],
    uvs = [],
    indices = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      a = -0.2 + t * Math.PI * 1.12;
    for (const r of [0.48, 0.76]) {
      positions.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      uvs.push(t, r === 0.48 ? 0 : 1);
    }
    if (i < n) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, alpha: { value: 0 } },
    vertexShader:
      "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:
      "varying vec2 vUv;uniform vec3 tint;uniform float alpha;void main(){float a=sin(vUv.x*3.14159)*pow(max(0.,1.-abs(vUv.y-.5)*2.),2.);gl_FragColor=vec4(mix(tint,vec3(1.),.28),a*alpha);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n}",
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "glove-motion-ribbon";
  mesh.visible = false;
  mesh.position.set(-0.24, 0.06, 0.01);
  mesh.userData.presentationOnly = true;
  return mesh;
}
