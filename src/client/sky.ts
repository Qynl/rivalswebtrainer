/**
 * The world outside the fight: bright sky, cloud sea, distant ruins.
 *
 * Deliberately ordinary daylight. The arena reads as a real place — concrete,
 * dust, sunlight — so the only saturated colours on screen belong to things you
 * need to see: the far player, the glint, the hazard wall.
 */

import * as THREE from 'three';
import { glowTexture } from './textures.ts';

interface SkyKit {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update: (dt: number, camera: THREE.Camera) => void;
}

function skyTexture(): THREE.Texture {
  const w = 2048;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // Zenith to horizon: deep blue into pale haze.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2f6fc4');
  g.addColorStop(0.32, '#5b9ad8');
  g.addColorStop(0.52, '#9dc4e6');
  g.addColorStop(0.62, '#d6e4ee');
  g.addColorStop(0.72, '#e8eef2');
  g.addColorStop(1, '#f2f0ea');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Cumulus: clusters of soft circles, brighter on the sun side.
  const cloud = (cx: number, cy: number, scale: number, alpha: number): void => {
    const puffs = 14 + Math.floor(Math.random() * 16);
    for (let i = 0; i < puffs; i++) {
      const ox = (Math.random() - 0.5) * 220 * scale;
      const oy = (Math.random() - 0.5) * 54 * scale;
      const r = (26 + Math.random() * 58) * scale;
      const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.55, `rgba(250,252,255,${alpha * 0.6})`);
      grad.addColorStop(1, 'rgba(240,246,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
    }
    // Soft grey base so the cloud has a shadow side.
    for (let i = 0; i < 8; i++) {
      const ox = (Math.random() - 0.5) * 180 * scale;
      const oy = 18 * scale + Math.random() * 22 * scale;
      const r = (22 + Math.random() * 40) * scale;
      const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
      grad.addColorStop(0, 'rgba(166,182,200,0.22)');
      grad.addColorStop(1, 'rgba(166,182,200,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 26; i++) {
    cloud(Math.random() * w, h * (0.26 + Math.random() * 0.26), 0.6 + Math.random() * 1.5, 0.5 + Math.random() * 0.3);
  }
  // A few thin high streaks.
  for (let i = 0; i < 30; i++) {
    const y = h * (0.16 + Math.random() * 0.2);
    const x = Math.random() * w;
    const len = 140 + Math.random() * 460;
    const grad = ctx.createLinearGradient(x, y, x + len, y + 8);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, len, 6 + Math.random() * 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

export function buildSky(): SkyKit {
  const group = new THREE.Group();
  group.name = 'sky';

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -100;
  group.add(dome);

  // Sun: a bright disc plus a wide halo, high and to the left.
  // A 42° sun: long enough shadows to describe the ruin, high enough that the
  // decks still read as sunlit white concrete rather than dusk silhouettes.
  const sunDir = new THREE.Vector3(-0.46, 0.62, -0.62).normalize();
  const sunPos = sunDir.clone().multiplyScalar(620);
  const sunDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff6e2, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  sunDisc.position.copy(sunPos);
  sunDisc.scale.setScalar(120);
  group.add(sunDisc);
  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xbfd8ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  sunHalo.position.copy(sunPos);
  sunHalo.scale.setScalar(520);
  group.add(sunHalo);

  // Cloud sea far below: the void is now weather.
  const cloudSea = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          vec2 p = vWorld.xz * 0.0075;
          float t = uTime * 0.012;
          float n = fbm(p + vec2(t, t * 0.6)) * 0.65 + fbm(p * 2.6 - vec2(t * 1.6, t * 0.8)) * 0.35;
          float body = smoothstep(0.36, 0.82, n);
          vec3 lit = mix(vec3(0.72, 0.78, 0.85), vec3(1.0, 0.99, 0.96), body);
          vec3 shade = mix(vec3(0.55, 0.62, 0.74), vec3(0.82, 0.86, 0.93), body);
          vec3 col = mix(shade, lit, smoothstep(0.2, 0.8, body));
          float dist = length(vWorld.xz);
          float fade = smoothstep(1250.0, 320.0, dist);
          gl_FragColor = vec4(col, (0.35 + body * 0.65) * fade);
        }
      `,
    }),
  );
  cloudSea.rotation.x = -Math.PI / 2;
  cloudSea.position.y = -150;
  group.add(cloudSea);

  // Distant ruins: white concrete towers, hugging the horizon in haze.
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xdfe2e0, roughness: 0.95, metalness: 0.02 });
  const towers: THREE.Matrix4[] = [];
  const rand = (a: number, b: number): number => a + Math.random() * (b - a);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rand(-0.05, 0.05);
    const r = rand(260, 720);
    const h = rand(50, 260);
    const w = rand(14, 60);
    const d = rand(14, 60);
    towers.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * r, rand(-140, -40) + h / 2, Math.sin(a) * r),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, Math.PI)),
        new THREE.Vector3(w, h, d),
      ),
    );
  }
  const towerMesh = new THREE.InstancedMesh(towerGeo, towerMat, towers.length);
  towers.forEach((m, i) => towerMesh.setMatrixAt(i, m));
  towerMesh.instanceMatrix.needsUpdate = true;
  group.add(towerMesh);

  // Debris slabs hanging in the air near the arena: the reason it feels high.
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0xb9b7ae, roughness: 0.92, metalness: 0.03 });
  const debris: { mesh: THREE.Mesh; spin: number; base: THREE.Vector3; phase: number }[] = [];
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 95 + Math.random() * 130;
    const geo = new THREE.IcosahedronGeometry(3 + Math.random() * 8, 0);
    geo.scale(1.5 + Math.random(), 0.22 + Math.random() * 0.3, 1.5 + Math.random());
    const mesh = new THREE.Mesh(geo, debrisMat);
    const base = new THREE.Vector3(Math.cos(a) * r, rand(-70, 60), Math.sin(a) * r);
    mesh.position.copy(base);
    mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    debris.push({ mesh, spin: rand(-0.06, 0.06), base, phase: Math.random() * 6 });
    group.add(mesh);
  }

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.copy(sunDir.clone().multiplyScalar(200));
  sun.name = 'sun';

  const update = (dt: number, camera: THREE.Camera): void => {
    const t = performance.now() / 1000;
    (cloudSea.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    // The dome tracks the camera so the far plane never clips it.
    group.position.set(camera.position.x * 0.9, 0, camera.position.z * 0.9);
    for (const d of debris) {
      d.mesh.rotation.y += d.spin * dt;
      d.mesh.position.y = d.base.y + Math.sin(t * 0.22 + d.phase) * 2.4;
    }
  };

  return { group, sun, update };
}
