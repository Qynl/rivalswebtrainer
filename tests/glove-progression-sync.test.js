import test from "node:test";
import assert from "node:assert/strict";
import { SlapProgression } from "../src/gloves/progression.js";
const KEY = "slap-arena-profile-v1";
function fixture() {
  let saved = null,
    writes = 0;
  const storage = {
    getItem: () => saved,
    setItem: (_, v) => {
      saved = v;
      writes++;
    },
  };
  return {
    storage,
    set: (v) => {
      saved = v;
    },
    get: () => saved,
    writes: () => writes,
  };
}
test("a stale tab cannot overwrite already earned slaps when selecting an ordinary glove", () => {
  const f = fixture(),
    a = new SlapProgression(f.storage),
    b = new SlapProgression(f.storage);
  for (let i = 0; i < 15; i++) a.award(`a:${i}`);
  assert.equal(b.select("glove_default"), true);
  assert.equal(new SlapProgression(f.storage).profile.slaps, 15);
});
test("sequential accepted awards from stale tabs add to the latest saved total rather than replacing one another", () => {
  const f = fixture(),
    a = new SlapProgression(f.storage),
    b = new SlapProgression(f.storage);
  assert.equal(a.award("a:1"), true);
  assert.equal(b.award("b:1"), true);
  assert.equal(a.award("a:2"), true);
  assert.equal(new SlapProgression(f.storage).profile.slaps, 3);
  assert.equal(a.award("a:2"), false);
  assert.equal(a.profile.slaps, 3);
});
test("a stale tab can equip a milestone genuinely earned in another tab, without spending or manufacturing slaps", () => {
  const f = fixture(),
    a = new SlapProgression(f.storage),
    b = new SlapProgression(f.storage);
  for (let i = 0; i < 15; i++) a.award(`a:${i}`);
  assert.equal(b.select("glove_diamond"), true);
  assert.equal(b.profile.slaps, 15);
  assert.equal(b.select("glove_golden"), false);
  assert.equal(b.profile.slaps, 15);
});
test("storage events refresh actual saved profiles without writing back or re-notifying for identical values, and disposal removes listeners", () => {
  const f = fixture(),
    target = new EventTarget(),
    a = new SlapProgression(f.storage),
    b = new SlapProgression(f.storage, target);
  let notifications = 0;
  b.subscribe(() => notifications++);
  a.award("a:1");
  const before = f.writes();
  const event = () =>
    target.dispatchEvent(Object.assign(new Event("storage"), { key: KEY }));
  event();
  assert.equal(b.profile.slaps, 1);
  assert.equal(notifications, 1);
  assert.equal(f.writes(), before);
  event();
  assert.equal(notifications, 1);
  b.dispose();
  a.award("a:2");
  event();
  assert.equal(b.profile.slaps, 1);
  assert.equal(notifications, 1);
});
test("corrupt, deleted, blocked or older storage cannot erase live earned progress or selection", () => {
  const f = fixture(),
    p = new SlapProgression(f.storage);
  for (let i = 0; i < 15; i++) p.award(`a:${i}`);
  p.select("glove_diamond");
  const before = { ...p.profile };
  for (const saved of [
    "{",
    null,
    JSON.stringify({ slaps: 1, selected: "glove_default" }),
  ]) {
    f.set(saved);
    p.refresh();
    assert.deepEqual(p.profile, before);
  }
  let blocked = false;
  const storage = {
    getItem: () => {
      if (blocked) throw Error("blocked");
      return f.get();
    },
    setItem: () => {
      throw Error("quota");
    },
  };
  f.set(JSON.stringify(before));
  const q = new SlapProgression(storage);
  blocked = true;
  assert.equal(q.award("session:1"), true);
  assert.equal(q.profile.slaps, 16);
  assert.equal(q.profile.selected, "glove_diamond");
});
