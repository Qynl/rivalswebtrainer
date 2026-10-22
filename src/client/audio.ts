/**
 * Procedural audio. No files, no samples: every sound is a short synthesised
 * gesture. The palette is "cold metal over a low void hum":
 * - rifle: a filtered noise crack with a subsonic thump and a long tail,
 * - rope: a metallic ping on attach, filtered-noise zip, air whoosh on release,
 * - movement: soft thuds, wind that rises with speed,
 * - UI: short sine blips.
 *
 * Opponent sounds are panned and distance-filtered so you can hear where they
 * are — which is part of the "everything is information" rule.
 */

import type { Vec3 } from '../shared/mathx.ts';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode } | null = null;
  private drone: { gain: GainNode } | null = null;
  volume = 0.65;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 3.4;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.startWind();
    this.startDrone();
    this.startHum();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private ok(): AudioContext | null {
    if (!this.ctx || !this.master) return null;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private env(gain: GainNode, t: number, attack: number, peak: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    opts: { slideTo?: number; attack?: number; pan?: number; when?: number; detune?: number } = {},
  ): void {
    const ctx = this.ok();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    this.env(g, t, opts.attack ?? 0.004, peak, dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    osc.connect(g).connect(pan).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private noiseBurst(
    dur: number,
    peak: number,
    opts: { freq?: number; q?: number; type?: BiquadFilterType; pan?: number; when?: number; sweepTo?: number; attack?: number } = {},
  ): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + (opts.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), t + dur);
    filter.Q.value = opts.q ?? 0.9;
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.002, peak, dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    src.connect(filter).connect(g).connect(pan).connect(this.master);
    src.start(t, Math.random() * 1.4);
    src.stop(t + dur + 0.05);
  }

  private startWind(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.wind = { gain, filter };
  }

  private startDrone(): void {
    const ctx = this.ok();
    if (!ctx || !this.master) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = 46;
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = 69.2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(a.frequency);
    a.connect(gain);
    b.connect(gain);
    gain.connect(this.master);
    a.start();
    b.start();
    lfo.start();
    this.drone = { gain };
  }

  /** Per-frame mix: wind by speed, rope hum while swinging. */
  mix(speed: number, swinging: boolean, alive: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.wind) {
      const target = alive ? Math.min(0.22, (speed / 60) * 0.22) : 0.0001;
      this.wind.gain.gain.setTargetAtTime(Math.max(0.0001, target), t, 0.12);
      this.wind.filter.frequency.setTargetAtTime(380 + speed * 22, t, 0.2);
    }
    if (this.hum) {
      const target = swinging ? 0.05 : 0.0001;
      this.hum.gain.gain.setTargetAtTime(target, t, 0.06);
    }
  }

  private startHum(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || this.hum) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 128;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 640;
    filter.Q.value = 3;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.hum = { gain, osc };
  }

  shot(own: boolean, pan = 0, distance = 0): void {
    const atten = own ? 1 : 1 / (1 + distance / 45);
    this.noiseBurst(0.09, 0.55 * atten, { freq: own ? 3400 : 2200, q: 0.7, type: 'highpass', pan, sweepTo: 700 });
    this.noiseBurst(0.34, 0.24 * atten, { freq: own ? 900 : 520, q: 0.6, type: 'lowpass', pan, sweepTo: 180, attack: 0.01 });
    this.tone(own ? 92 : 74, 0.3, 'sine', 0.5 * atten, { slideTo: 34, pan });
    if (own) {
      this.tone(2100, 0.05, 'square', 0.05, { pan: 0 });
      this.noiseBurst(0.5, 0.05, { freq: 1800, q: 1.5, pan, when: 0.08, sweepTo: 320 });
    }
  }

  hitmarker(kill: boolean): void {
    this.tone(880, 0.07, 'square', 0.16, { slideTo: 1320 });
    if (kill) {
      this.tone(140, 0.45, 'sine', 0.5, { slideTo: 42 });
      this.tone(660, 0.6, 'triangle', 0.12, { slideTo: 330, when: 0.02 });
      this.noiseBurst(0.3, 0.18, { freq: 2200, q: 0.8, sweepTo: 400 });
    }
  }

  death(): void {
    this.tone(220, 1.1, 'sawtooth', 0.18, { slideTo: 40 });
    this.noiseBurst(0.9, 0.15, { freq: 900, q: 0.5, type: 'lowpass', sweepTo: 90 });
  }

  spawn(): void {
    this.tone(180, 0.4, 'sine', 0.2, { slideTo: 440 });
    this.noiseBurst(0.25, 0.06, { freq: 2400, q: 1.2, sweepTo: 520 });
  }

  attach(distance: number, pan: number): void {
    const a = 1 / (1 + distance / 60);
    this.tone(1250, 0.07, 'square', 0.12 * a, { slideTo: 620, pan });
    this.noiseBurst(0.18, 0.25 * a, { freq: 1600, q: 2.4, pan, sweepTo: 700 });
    this.tone(70, 0.16, 'sine', 0.3, { slideTo: 46, pan });
  }

  zip(): void {
    this.noiseBurst(0.35, 0.2, { freq: 700, q: 1.2, sweepTo: 3200, type: 'bandpass' });
    this.tone(320, 0.3, 'sine', 0.14, { slideTo: 900 });
  }

  release(boost: number): void {
    this.noiseBurst(0.5, 0.16 + boost * 0.2, { freq: 500, q: 0.6, sweepTo: 2400, type: 'bandpass' });
    this.tone(240 + boost * 160, 0.35, 'triangle', 0.1 + boost * 0.1, { slideTo: 620 + boost * 300 });
    if (boost > 0.6) this.tone(96, 0.4, 'sine', 0.2, { slideTo: 60 });
  }

  jump(): void {
    this.noiseBurst(0.1, 0.06, { freq: 1800, q: 1.2, sweepTo: 600 });
  }

  land(strength: number): void {
    this.tone(80, 0.18, 'sine', 0.12 + strength * 0.4, { slideTo: 40 });
    this.noiseBurst(0.14, 0.05 + strength * 0.12, { freq: 700, q: 0.7, type: 'lowpass', sweepTo: 160 });
  }

  dash(): void {
    this.noiseBurst(0.22, 0.18, { freq: 1200, q: 0.8, sweepTo: 300 });
    this.tone(140, 0.15, 'square', 0.07, { slideTo: 70 });
  }

  /** Mechanical scope click; the two tones are the in and out positions. */
  scope(zoomingIn: boolean): void {
    this.noiseBurst(0.06, 0.12, { freq: zoomingIn ? 2600 : 1800, q: 2.6, sweepTo: zoomingIn ? 900 : 2400 });
    this.tone(zoomingIn ? 1180 : 760, 0.05, 'square', 0.05, { slideTo: zoomingIn ? 820 : 1100 });
  }

  ringWarn(): void {
    this.tone(520, 0.5, 'sawtooth', 0.09, { slideTo: 720 });
    this.tone(390, 0.5, 'sine', 0.07, { when: 0.06 });
  }

  ui(kind: 'hover' | 'click' | 'back'): void {
    if (kind === 'hover') this.tone(880, 0.05, 'sine', 0.045);
    if (kind === 'click') this.tone(620, 0.09, 'triangle', 0.09, { slideTo: 980 });
    if (kind === 'back') this.tone(420, 0.12, 'triangle', 0.07, { slideTo: 220 });
  }

  chain(stack: number): void {
    this.tone(660 + stack * 120, 0.12, 'triangle', 0.1, { slideTo: 1320 + stack * 120 });
  }

  /** Converts a world position into a stereo pan + distance for the listener. */
  spatial(pos: Vec3, listener: Vec3, yaw: number): { pan: number; distance: number } {
    const dx = pos.x - listener.x;
    const dz = pos.z - listener.z;
    const distance = Math.hypot(dx, dz, pos.y - listener.y);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const pan = distance > 0.01 ? Math.max(-0.85, Math.min(0.85, (dx * rightX + dz * rightZ) / Math.max(4, distance))) : 0;
    return { pan, distance };
  }

  stopAll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.wind) this.wind.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
    if (this.drone) this.drone.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
  }
}
