import * as THREE from "three";
export function createBrickModel() {
  const root = new THREE.Group();
  root.name = "original-trip-brick";
  const material = new THREE.MeshStandardMaterial({
    color: "#e47754",
    roughness: 0.55,
    metalness: 0.1,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.38), material);
  base.position.y = 0.07;
  root.add(base);
  for (let i = 0; i < 4; i++) {
    const stud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.066, 0.066, 0.055, 8),
      material,
    );
    stud.position.set(
      ((i % 2) - 0.5) * 0.34,
      0.165,
      (Math.floor(i / 2) - 0.5) * 0.18,
    );
    root.add(stud);
  }
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}
