import * as THREE from 'three';

function makeCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.CanvasTexture(canvas);

  context.clearRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(128, 54, 6, 128, 54, 112);
  glow.addColorStop(0, 'rgba(255,255,255,.9)');
  glow.addColorStop(0.55, 'rgba(255,255,255,.52)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(255,255,255,.76)';
  const puffs = [
    [40, 54, 35, 20],
    [78, 40, 49, 29],
    [126, 50, 62, 27],
    [177, 42, 45, 26],
    [214, 56, 34, 19],
  ];
  puffs.forEach(([x, y, radiusX, radiusY]) => {
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addCloud(scene: THREE.Scene, position: THREE.Vector3, scale: number, opacity: number): void {
  const cloud = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeCloudTexture(),
      transparent: true,
      depthWrite: false,
      opacity,
      fog: false,
    }),
  );
  cloud.position.copy(position);
  cloud.scale.set(scale, scale * 0.38, 1);
  cloud.name = 'atmosphere:cloud';
  scene.add(cloud);
}

export function addWorldAtmosphere(scene: THREE.Scene): void {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(140, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x1597df) },
        horizonColor: { value: new THREE.Color(0x9ee6fb) },
        lowerColor: { value: new THREE.Color(0xd9f1f2) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 lowerColor;
        varying vec3 vWorldPosition;
        void main() {
          float height = normalize(vWorldPosition).y;
          vec3 skyColor = mix(horizonColor, topColor, smoothstep(-0.02, 0.86, height));
          skyColor = mix(lowerColor, skyColor, smoothstep(-0.2, 0.08, height));
          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
    }),
  );
  sky.name = 'atmosphere:sky';
  scene.add(sky);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.4, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: 0.82 }),
  );
  sun.position.set(-35, 54, -60);
  sun.name = 'atmosphere:sun';
  scene.add(sun);

  addCloud(scene, new THREE.Vector3(-30, 26, -38), 18, 0.52);
  addCloud(scene, new THREE.Vector3(28, 31, -55), 23, 0.43);
  addCloud(scene, new THREE.Vector3(46, 22, 18), 15, 0.34);
  addCloud(scene, new THREE.Vector3(-42, 18, 34), 13, 0.28);
}
