import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import * as THREE from "three";
const encoded = await readFile(
  new URL("../src/assets/studio-environment.bin", import.meta.url),
);
async function loader(key) {
  return (await import(`../src/environment.js?test=${key}`)).loadEnvironment;
}
test("parallel studio lighting consumers share one exact decoded pixel buffer and one in-flight request", async (t) => {
  const original = globalThis.fetch;
  let calls = 0;
  t.after(() => (globalThis.fetch = original));
  globalThis.fetch = async () => {
    calls++;
    return new Response(encoded);
  };
  const load = await loader("shared");
  const a = load(),
    b = load();
  assert.equal(a, b);
  const [one, two] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(one, two);
  assert.equal(one.values, two.values);
  const bytes = gunzipSync(encoded),
    count = one.width * one.height * 4,
    reference = new Uint16Array(count);
  for (let i = 0; i < count; i++)
    reference[i] =
      ((i < 4 ? 0 : reference[i - 4]) + bytes[i] + (bytes[count + i] << 8)) &
      65535;
  assert.deepEqual(one.values, reference);
  const game = new THREE.DataTexture(one.values, one.width, one.height),
    preview = new THREE.DataTexture(two.values, two.width, two.height);
  game.dispose();
  assert.equal(preview.image.data, one.values);
  assert.deepEqual(preview.image.data, reference);
  preview.dispose();
  assert.equal(await load(), one);
  assert.equal(calls, 1);
});
test("failed lighting data is not permanently cached and can retry without an unhandled rejection", async (t) => {
  const original = globalThis.fetch,
    warn = console.warn;
  let calls = 0;
  const warnings = [];
  t.after(() => {
    globalThis.fetch = original;
    console.warn = warn;
  });
  console.warn = (...args) => warnings.push(args);
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("unavailable", { status: 503 })
      : new Response(encoded);
  };
  const load = await loader("retry");
  const a = load(),
    b = load();
  assert.equal(a, b);
  assert.equal(await a, null);
  assert.equal(calls, 1);
  assert.equal(warnings.length, 1);
  const recovered = await load();
  assert.ok(recovered.values instanceof Uint16Array);
  assert.equal(calls, 2);
  assert.equal(await load(), recovered);
  assert.equal(calls, 2);
});
