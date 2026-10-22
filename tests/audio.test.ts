// @vitest-environment jsdom
/**
 * The audio graph gets a fake WebAudio device.
 *
 * There is no way to hear the game in CI, so what is pinned here is the part
 * that would be silent at runtime: the graph has to be valid (no exponential
 * ramp to zero, no missing node), every voice the game calls has to survive
 * being played, and the pan/distance maths has to point the right way.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Sfx as S } from '../src/client/audio.ts';

class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    // A real AudioParam throws on a ramp to zero, which would be a silent
    // failure in the browser and is exactly what this guard is for.
    if (!(v > 0)) throw new Error(`exponential ramp to ${v} at ${t}`);
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(n: FakeNode): FakeNode {
    this.connections.push(n);
    return n;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = '';
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakePanner extends FakeNode {
  pan = new FakeParam();
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam();
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}
class FakeOsc extends FakeNode {
  type = '';
  frequency = new FakeParam();
  detune = new FakeParam();
  start(): void {}
  stop(): void {}
}

class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  gone: FakeNode[] = [];
  hall: { length: number; channels: number } | null = null;
  noise: { length: number; channels: number } | null = null;

  constructor() {
    FakeContext.last = this;
  }
  resolve(): void {}
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor();
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  createOscillator(): FakeOsc {
    return new FakeOsc();
  }
  createConvolver(): FakeNode & { buffer: unknown } {
    const node = new FakeNode() as FakeNode & { buffer: unknown };
    node.buffer = null;
    return node;
  }
  createBuffer(channels: number, length: number): { getChannelData: (c: number) => Float32Array } {
    const data: Float32Array[] = [];
    for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
    if (channels === 2) this.hall = { length, channels };
    else this.noise = { length, channels };
    return { getChannelData: (c: number) => data[c] };
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

let Sfx: typeof S;
let sfx: S;

beforeAll(async () => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  Sfx = (await import('../src/client/audio.ts')).Sfx;
  sfx = new Sfx();
  sfx.unlock();
});

describe('audio', () => {
  it('builds the master chain, a procedural hall and a shared noise buffer', () => {
    const ctx = FakeContext.last!;
    expect(ctx).toBeTruthy();
    // Two seconds of noise at the device rate, and a two-channel impulse.
    expect(ctx.hall?.channels).toBe(2);
    expect(ctx.hall!.length).toBeGreaterThan(48000 * 2);
    expect(ctx.noise?.length).toBe(48000 * 2);
    expect(ctx.noise?.channels).toBe(1);
  });

  it('plays every voice the game can fire without an invalid parameter', () => {
    expect(() => {
      sfx.setVolume(0.6);
      sfx.mix(26, true, true, { grounded: false, reel: 1, sliding: false, dt: 1 / 60 });
      sfx.mix(0, false, false, { grounded: true, reel: 0, sliding: true, dt: 1 / 60 });
      sfx.shot(true);
      sfx.shot(false, -0.4, 60);
      sfx.crack(0.9, 0.3);
      sfx.hitmarker(true, 3);
      sfx.hitmarker(false);
      sfx.death();
      for (const k of ['shatter', 'bloom', 'pulse', 'sting'] as const) sfx.killFx(k);
      sfx.spawn();
      sfx.attach(12, 0.2);
      sfx.zip();
      sfx.release(0.8);
      sfx.release(0);
      sfx.equip(true);
      sfx.equip(false);
      sfx.hookFire();
      sfx.hookMiss();
      sfx.footstep(0.8, 'metal');
      sfx.footstep(0.3);
      sfx.jump();
      sfx.land(0.9);
      sfx.dash();
      sfx.scope(true);
      sfx.scope(false);
      sfx.ringWarn();
      for (const k of ['hover', 'click', 'back', 'buy', 'equip', 'level', 'reward'] as const) sfx.ui(k);
      sfx.chain(2);
      sfx.fightStart();
      sfx.matchEnd(true, false);
      sfx.matchEnd(false, false);
      sfx.matchEnd(false, true);
      sfx.stopAll();
    }).not.toThrow();
  });

  it('pans by bearing and reports true distance', () => {
    // Yaw 0 looks down -z, so +x is the listener's right.
    const right = sfx.spatial({ x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    const left = sfx.spatial({ x: -20, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    expect(right.pan).toBeGreaterThan(0.4);
    expect(left.pan).toBeLessThan(-0.4);
    expect(right.distance).toBeCloseTo(20, 5);
    const ahead = sfx.spatial({ x: 0, y: 0, z: -30 }, { x: 0, y: 0, z: 0 }, 0);
    expect(Math.abs(ahead.pan)).toBeLessThan(0.05);
    // A sound straight above the head must not read as hard left or right.
    const above = sfx.spatial({ x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    expect(Math.abs(above.pan)).toBeLessThan(0.05);
  });
});
