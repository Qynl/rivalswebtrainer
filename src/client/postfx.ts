/**
 * Post-processing, kept deliberately restrained so the image reads as a real
 * place: a light bloom for the sun and muzzle flashes, a soft grade, a vignette
 * and the scope mask. Speed adds a radial blur and a little colour separation;
 * nothing here is on by default at a strength you would notice standing still.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uScope: { value: 0 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffd27a) },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uScope;
    uniform float uHurt;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform vec2 uSun;
    uniform float uSunVis;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r = length(center);
      vec2 dir = r > 0.0001 ? center / r : vec2(0.0);

      // Radial blur that only shows up above ~30 m/s, and never in the middle.
      float blur = uSpeed * 0.010 * smoothstep(0.12, 0.62, r);
      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 4; i++) {
        float t = float(i) / 3.0;
        float w = 1.0 - t * 0.5;
        col += texture2D(tDiffuse, uv - dir * blur * t).rgb * w;
        total += w;
      }
      col /= total;

      // A whisper of chromatic aberration, mostly at the edges.
      float ca = (0.00018 + uSpeed * 0.0012 + uHurt * 0.0008) * (0.4 + r * 1.4);
      vec2 off = dir * ca;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Grade: slightly cool shadows, warm highlights, gentle contrast.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(vec3(0.97, 1.0, 1.04), vec3(1.03, 1.0, 0.97), smoothstep(0.15, 0.85, luma));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.08);
      col = pow(max(col, 0.0), vec3(1.02));
      // A touch of saturation, since ACES desaturates hard.
      col = mix(vec3(luma), col, 1.08);

      // Vignette, and the scope mask (a hard black ring with a soft inner edge).
      float vig = smoothstep(1.05, 0.38, r);
      col *= mix(1.0, vig, 0.4 + uScope * 0.1);
      float scopeMask = 1.0 - smoothstep(0.36, 0.4, r);
      col = mix(col, col * scopeMask, uScope);

      // Fine grain: keeps large flat surfaces from banding.
      col += (hash(uv * uResolution + uTime * 40.0) - 0.5) * 0.014;

      // Sun: a warm halo and a thin anamorphic streak when the disc is on
      // screen. No sprites, no extra pass: it is the grade pass doing double
      // duty, and it only ever costs a few instructions.
      if (uSunVis > 0.001) {
        vec2 sp = uv - uSun;
        sp.x *= uResolution.x / max(1.0, uResolution.y);
        float sd = length(sp);
        float halo = exp(-sd * 6.5) * 0.2 + exp(-sd * 2.2) * 0.06;
        float streak = exp(-abs(sp.y) * 150.0) * exp(-abs(sp.x) * 1.8) * 0.16;
        col += vec3(1.0, 0.87, 0.68) * uSunVis * (halo + streak);
      }

      // Kill flash: a hot centre bloom that dies out fast. It is the frame the
      // kill lands on, and it has to read through the scope without whiting out
      // the target you are already tracking.
      float flashCore = 1.0 - smoothstep(0.0, 0.62, r);
      col = mix(col, uFlashColor, uFlash * (0.28 + flashCore * 0.55));

      // Damage: a red edge tint, not a full-screen wash.
      float edge = smoothstep(0.22, 0.75, r);
      col = mix(col, vec3(0.62, 0.06, 0.05), uHurt * edge * 0.75);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private grade: ShaderPass;
  private bloom: UnrealBloomPass;
  private renderer: THREE.WebGLRenderer;
  private baseResolution = new THREE.Vector2(1, 1);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: renderer.getPixelRatio() <= 1.25 ? 4 : 0,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Restrained bloom: the sun, muzzle flashes and the glint get a halo; the
    // concrete does not.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x / 2), Math.max(1, size.y / 2)), 0.32, 0.72, 1.05);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x / renderer.getPixelRatio(), size.y / renderer.getPixelRatio());
    this.updateResolution();
  }

  private updateResolution(): void {
    this.renderer.getDrawingBufferSize(this.baseResolution);
    (this.grade.uniforms.uResolution.value as THREE.Vector2).copy(this.baseResolution);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.resolution.set(Math.max(1, width / 2), Math.max(1, height / 2));
    this.updateResolution();
  }

  private flashAmt = 0;
  private flashColor = new THREE.Color(0xffd27a);

  /** Screen position of the sun in UV space, and how visible it is (0..1). */
  setSun(uv: THREE.Vector2, visibility: number): void {
    (this.grade.uniforms.uSun.value as THREE.Vector2).copy(uv);
    this.grade.uniforms.uSunVis.value = visibility;
  }

  /** A brief full-frame flash in a given colour. Used on kills only. */
  flash(color: number, amount = 0.15): void {
    this.flashAmt = Math.min(0.55, this.flashAmt + amount);
    this.flashColor.setHex(color);
  }

  /** 0..1 motion, 0..1 scope, 0..1 damage flash. */
  setState(time: number, speed: number, scope: number, hurt: number): void {
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uSpeed.value = speed;
    this.grade.uniforms.uScope.value = scope;
    this.grade.uniforms.uHurt.value = hurt;
    this.flashAmt = Math.max(0, this.flashAmt - 1 / 60 * 2.4);
    this.grade.uniforms.uFlash.value = this.flashAmt;
    (this.grade.uniforms.uFlashColor.value as THREE.Color).copy(this.flashColor);
  }

  render(): void {
    this.composer.render();
  }

  /** Used by the adaptive quality guard. */
  setBloomScale(scale: number): void {
    this.bloom.strength = 0.32 * scale;
  }
}
