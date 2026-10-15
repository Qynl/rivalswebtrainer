import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ArenaRenderer } from "../src/rendering.js";

function rendererStub() {
  return {
    width: 1280,
    height: 800,
    current: null,
    draws: [],
    clears: 0,
    getDrawingBufferSize(v) {
      return v.set(this.width, this.height);
    },
    getRenderTarget() {
      return this.current;
    },
    setRenderTarget(t) {
      this.current = t;
    },
    clear() {
      this.clears++;
    },
    render(scene, camera) {
      this.draws.push({
        scene,
        camera,
        target: this.current,
        material: scene.children[0]?.material,
        direction:
          scene.children[0]?.material.uniforms?.direction?.value.clone(),
      });
    },
  };
}

test("HDR resizing retains target ownership, uses quarter-size bloom and handles a zero-size drawing buffer", () => {
  const r = rendererStub(),
    p = new ArenaRenderer(r),
    target = p.target,
    a = p.bloomA,
    b = p.bloomB;
  assert.equal(target.width, 1280);
  assert.equal(target.height, 800);
  assert.equal(a.width, 320);
  assert.equal(a.height, 200);
  assert.equal(b.width, 320);
  assert.equal(b.height, 200);
  r.width = 390;
  r.height = 844;
  p.resize();
  assert.equal(p.target, target);
  assert.equal(p.bloomA, a);
  assert.equal(p.bloomB, b);
  assert.equal(a.width, 97);
  assert.equal(a.height, 211);
  assert.equal(b.width, 97);
  assert.equal(b.height, 211);
  assert.equal(p.material.uniforms.resolution.value.x, 390);
  r.width = 0;
  r.height = 0;
  p.resize();
  for (const t of [target, a, b]) {
    assert.equal(t.width, 1);
    assert.equal(t.height, 1);
  }
  assert.deepEqual(p.brightMaterial.uniforms.texel.value.toArray(), [1, 1]);
  p.dispose();
});

test("HDR passes never read and write the same bloom target and restore the incoming output target", () => {
  const r = rendererStub(),
    p = new ArenaRenderer(r),
    world = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(85, 1.6, 0.07, 200),
    incoming = new THREE.WebGLRenderTarget(8, 8);
  r.current = incoming;
  p.render(world, camera);
  assert.deepEqual(
    r.draws.map((d) => d.target),
    [p.target, p.bloomA, p.bloomB, p.bloomA, incoming],
  );
  assert.deepEqual(
    r.draws.map((d) => d.material),
    [undefined, p.brightMaterial, p.blurMaterial, p.blurMaterial, p.material],
  );
  assert.equal(r.draws[0].scene, world);
  assert.equal(r.draws[0].camera, camera);
  assert.equal(r.clears, 1);
  assert.deepEqual(r.draws[2].direction.toArray(), [1 / 320, 0]);
  assert.deepEqual(r.draws[3].direction.toArray(), [0, 1 / 200]);
  assert.equal(r.getRenderTarget(), incoming);
  assert.equal(p.quad.material, p.material);
  assert.ok(
    p.material.uniforms.inverseProjection.value.equals(
      camera.projectionMatrixInverse,
    ),
  );
  p.dispose();
  incoming.dispose();
});

test("HDR disposal releases owned targets, shaders and geometry but not an external target", () => {
  const r = rendererStub(),
    p = new ArenaRenderer(r),
    external = new THREE.WebGLRenderTarget(8, 8);
  let externalDisposals = 0;
  external.addEventListener("dispose", () => externalDisposals++);
  r.current = external;
  const owned = [
      p.target,
      p.bloomA,
      p.bloomB,
      p.material,
      p.brightMaterial,
      p.blurMaterial,
      p.quad.geometry,
    ],
    counts = new Map(owned.map((o) => [o, 0]));
  for (const o of owned)
    o.addEventListener("dispose", () => counts.set(o, counts.get(o) + 1));
  p.dispose();
  for (const count of counts.values()) assert.equal(count, 1);
  assert.equal(externalDisposals, 0);
  external.dispose();
});
