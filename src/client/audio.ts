/**
 * Procedural audio.
 *
 * No files and no samples: every sound is synthesised on the fly from
 * oscillators and filtered noise. That keeps audio at zero bytes of download
 * and lets a sound react to state — a shot that lands far away is darker, a
 * hitmarker rises with the chain count, a footstep picks a surface.
 *
 * Signal path:
 *
 *   voice → [air absorption by distance] → [pan] → dry ─┐
 *                                                       ├→ master → compressor → limiter
 *   voice → [send] → convolver (procedural hall) ───────┘
 *
 * The convolver is what turns a dry click into a rifle shot inside an open
 * steel structure: everything sharp gets a long dark tail, panned and filtered
 * with its source. The impulse is generated once at unlock from noise with an
 * exponential decay plus four early reflections, so it costs milliseconds at
 * boot and nothing after.
 */

import { clamp, type Vec3 } from '../shared/mathx.ts';

interface VoiceOpts {
  when?: number;
  attack?: number;
  pan?: number;
  /** 0..1: how much of this voice is sent to the hall. */
  send?: number;
  /** Metres: darkens and attenuates the voice as if heard from there. */
  distance?: number;
  detune?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hall: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private cloth: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode } | null = null;
  private drone: { gain: GainNode } | null = null;
  private reel: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode } | null = null;
  private scrape: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  /** Metres walked since the last footstep. */
  private stepPhase = 0;
  private gustTimer = 6;
  private groanTimer = 15;
  volume = 0.65;

  // ── Setup ────────────────────────────────────────────────────────────────

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Master chain: gain → compressor → hard limiter, so a kill, a shot and a
    // hitmarker landing on the same frame cannot clip.
    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 16;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    master.connect(comp).connect(limiter).connect(ctx.destination);
    this.master = master;

    // The hall: one convolver, one return, shared by every voice through a send.
    const hall = ctx.createConvolver();
    hall.buffer = this.makeImpulse(2.4, 2.9);
    const hallReturn = ctx.createGain();
    hallReturn.gain.value = 0.5;
    const hallDark = ctx.createBiquadFilter();
    hallDark.type = 'lowpass';
    hallDark.frequency.value = 5200;
    hall.connect(hallDark).connect(hallReturn).connect(master);
    this.hall = hall;

    // One two-second noise buffer for every noise voice. Repitching it and
    // offsetting the read position gives each burst a different grain without
    // allocating anything.
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.startWind();
    this.startCloth();
    this.startDrone();
    this.startHum();
    this.startReel();
    this.startScrape();
  }

  /**
   * Procedural impulse response: noise under an exponential decay, darkening
   * toward the tail the way air absorbs high frequencies, plus four discrete
   * early reflections so the space has a size instead of just a smear.
   */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    const taps = [0.011, 0.019, 0.031, 0.047];
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // The filter opens toward the tail: bright attack, dark room.
        const k = 0.06 + 0.5 * t;
        lp += (Math.random() * 2 - 1 - lp) * k;
        data[i] = lp * env;
      }
      for (let i = 0; i < taps.length; i++) {
        const idx = Math.floor((taps[i] + (ch === 0 ? 0 : 0.0017)) * rate);
        if (idx < len) data[idx] += (0.5 - i * 0.09) * (Math.random() * 2 - 1);
      }
    }
    return buf;
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

  /** Distance → air absorption. A shot 80 m away is a dark thump, not a click. */
  private airCutoff(distance: number): number {
    return clamp(16000 * Math.exp(-distance / 55), 620, 16000);
  }

  // ── Voice helpers ────────────────────────────────────────────────────────

  private env(gain: GainNode, t: number, attack: number, peak: number, decay: number, curve = 2.2): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
    // A power-ish decay is what makes a transient read as a hit rather than a
    // fade: most of the energy sits in the first third.
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, peak * Math.pow(1 - f, curve)),
        t + attack + decay * f,
      );
    }
  }

  /** Wires a voice into the dry bus and the hall send. */
  private route(node: AudioNode, opts: VoiceOpts): void {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(opts.pan ?? 0, -1, 1);
    let head: AudioNode = node;
    if (opts.distance && opts.distance > 1) {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = this.airCutoff(opts.distance);
      node.connect(air);
      head = air;
    }
    head.connect(pan).connect(this.master!);
    const send = opts.send ?? 0.18;
    if (send > 0.001 && this.hall) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      head.connect(sendGain).connect(this.hall);
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    peak: number,
    opts: VoiceOpts & { slideTo?: number; curve?: number } = {},
  ): void {
    const ctx = this.ok();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.when ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(12, freq), t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(12, opts.slideTo), t + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    this.env(g, t, opts.attack ?? 0.004, peak, dur, opts.curve);
    osc.connect(g);
    this.route(g, opts);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private noiseBurst(
    dur: number,
    peak: number,
    opts: VoiceOpts & {
      freq?: number;
      q?: number;
      type?: BiquadFilterType;
      sweepTo?: number;
      /** Second filter in series, for a band-limited crack. */
      freq2?: number;
      q2?: number;
      type2?: BiquadFilterType;
      /** Playback rate: below 1 is coarser, above 1 is finer. */
      rate?: number;
    } = {},
  ): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + (opts.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t + dur);
    filter.Q.value = opts.q ?? 0.9;
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.002, peak, dur);
    src.connect(filter);
    let head: AudioNode = filter;
    if (opts.freq2 !== undefined) {
      const f2 = ctx.createBiquadFilter();
      f2.type = opts.type2 ?? 'highpass';
      f2.frequency.value = opts.freq2;
      f2.Q.value = opts.q2 ?? 0.7;
      filter.connect(f2);
      head = f2;
    }
    head.connect(g);
    this.route(g, opts);
    src.start(t, Math.random() * 1.6);
    src.stop(t + dur + 0.08);
  }

  // ── Continuous beds ──────────────────────────────────────────────────────

  private startWind(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    // A slow gust LFO on the cutoff, so the bed breathes instead of hissing.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 180;
    lfo.connect(lfoAmt).connect(filter.frequency);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.wind = { gain, filter };
  }

  /** Cloth and cape: a separate, brighter bed that opens with speed. */
  private startCloth(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.cloth = { gain, filter };
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
    const c = ctx.createOscillator();
    c.type = 'triangle';
    c.frequency.value = 92.7;
    const cGain = ctx.createGain();
    cGain.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(a.frequency);
    a.connect(gain);
    b.connect(gain);
    c.connect(cGain).connect(gain);
    gain.connect(this.master);
    a.start();
    b.start();
    c.start();
    lfo.start();
    this.drone = { gain };
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
    const trem = ctx.createOscillator();
    trem.frequency.value = 7.5;
    const tremAmt = ctx.createGain();
    tremAmt.gain.value = 0.02;
    trem.connect(tremAmt).connect(gain.gain);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    trem.start();
    this.hum = { gain, osc };
  }

  /**
   * The reels. A looping whirr that follows cable speed, so a zip screams and a
   * slow payout ticks. This is what makes the grapnel feel like machinery
   * instead of a teleport.
   */
  private startReel(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 180;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.35;
    src.connect(filter).connect(gain);
    osc.connect(oscGain).connect(gain);
    gain.connect(this.master);
    src.start();
    osc.start();
    this.reel = { gain, filter, osc };
  }

  /**
   * Boots on concrete at 9 m/s. A slide is the one movement state that needs a
   * continuous sound rather than a one-shot, because the friction is.
   */
  private startScrape(): void {
    const ctx = this.ok();
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.scrape = { gain, filter };
  }

  // ── Per-frame mix ────────────────────────────────────────────────────────

  /**
   * Drives every continuous bed from one call: wind and cloth by speed, rope
   * tension, reel speed, footsteps by distance walked, and the ambience that
   * keeps the map from ever being silent.
   */
  mix(
    speed: number,
    swinging: boolean,
    alive: boolean,
    extra: { grounded?: boolean; reel?: number; sliding?: boolean; dt?: number } = {},
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dt = extra.dt ?? 1 / 60;
    const sp = clamp(speed, 0, 80);

    if (this.wind) {
      const target = alive ? Math.min(0.26, (sp / 60) * 0.26) : 0.0001;
      this.wind.gain.gain.setTargetAtTime(Math.max(0.0001, target), t, 0.12);
      this.wind.filter.frequency.setTargetAtTime(360 + sp * 26, t, 0.2);
    }
    if (this.cloth) {
      // Cloth only speaks above a jog, and opens faster than the wind.
      const target = alive ? clamp((sp - 8) / 46, 0, 1) * 0.09 : 0.0001;
      this.cloth.gain.gain.setTargetAtTime(Math.max(0.0001, target), t, 0.09);
      this.cloth.filter.frequency.setTargetAtTime(700 + sp * 30, t, 0.12);
    }
    if (this.hum) {
      this.hum.gain.gain.setTargetAtTime(swinging ? 0.05 : 0.0001, t, 0.06);
    }
    if (this.scrape) {
      const sliding = alive && !!extra.sliding;
      const speedK = clamp(sp / 9, 0.2, 1);
      this.scrape.gain.gain.setTargetAtTime(sliding ? 0.05 + speedK * 0.1 : 0.0001, t, 0.03);
      this.scrape.filter.frequency.setTargetAtTime(1100 + speedK * 1500, t, 0.05);
    }
    if (this.reel) {
      const target = clamp(extra.reel ?? 0, 0, 1);
      this.reel.gain.gain.setTargetAtTime(target * 0.12, t, 0.05);
      this.reel.filter.frequency.setTargetAtTime(900 + target * 2600, t, 0.06);
      this.reel.osc.frequency.setTargetAtTime(150 + target * 320, t, 0.06);
    }

    // Footsteps: accumulate distance travelled while grounded and fire one per
    // stride. This is the only way steps stay in time at any speed, and it is
    // why a swing that lands into a run sounds like a run.
    if (alive && extra.grounded && sp > 2.5) {
      this.stepPhase += sp * dt;
      const stride = 2.1 + sp * 0.035;
      if (this.stepPhase >= stride) {
        this.stepPhase = 0;
        this.footstep(clamp(sp / 14, 0.15, 1));
      }
    } else if (this.stepPhase > 1.4) {
      this.stepPhase = 1.4;
    }

    // Ambience: a distant gust every few seconds, and the occasional groan of
    // steel settling somewhere out in the structure.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 6 + Math.random() * 11;
      this.noiseBurst(1.6 + Math.random() * 1.2, 0.05, {
        freq: 380 + Math.random() * 240,
        q: 0.5,
        type: 'lowpass',
        sweepTo: 240,
        attack: 0.6,
        pan: Math.random() * 1.6 - 0.8,
        send: 0.3,
      });
    }
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 16 + Math.random() * 22;
      const pan = Math.random() * 1.8 - 0.9;
      this.tone(58 + Math.random() * 22, 1.8, 'sine', 0.045, { slideTo: 40, pan, send: 0.4, attack: 0.4 });
      this.noiseBurst(1.2, 0.03, { freq: 260, q: 3, sweepTo: 150, pan, attack: 0.3, send: 0.3 });
    }
  }

  // ── Weapon ───────────────────────────────────────────────────────────────

  /**
   * The rifle. Five layers, which is what a gunshot actually is:
   * 1. the crack, 2. the body at the bore frequency, 3. the sub you feel,
   * 4. the action (own rifle only), 5. the tail through the hall.
   */
  shot(own: boolean, pan = 0, distance = 0): void {
    const atten = own ? 1 : 1 / (1 + distance / 34);
    const detune = (Math.random() - 0.5) * 40;
    const panJit = pan + (Math.random() - 0.5) * 0.05;
    this.noiseBurst(0.045, 0.75 * atten, {
      freq: own ? 6200 : 4200,
      q: 0.6,
      type: 'highpass',
      sweepTo: 2400,
      pan: panJit,
      distance: own ? 0 : distance,
      send: 0.12,
      rate: 1.4,
    });
    this.noiseBurst(0.16, 0.5 * atten, {
      freq: own ? 1500 : 1050,
      q: 1.1,
      sweepTo: 320,
      pan: panJit,
      distance: own ? 0 : distance,
      send: 0.3,
      rate: 0.85,
    });
    this.tone(own ? 118 : 92, 0.34, 'sine', 0.55 * atten, {
      slideTo: 30,
      pan: panJit,
      detune,
      send: 0.18,
      curve: 1.7,
    });
    // A second sub an octave down gives the shot a floor.
    this.tone(58, 0.5, 'sine', 0.22 * atten, { slideTo: 26, pan: panJit, send: 0.2, curve: 1.4 });
    if (own) {
      this.noiseBurst(0.05, 0.09, { freq: 3400, q: 2.4, when: 0.055, pan: 0.15 });
      this.tone(2400, 0.04, 'square', 0.03, { slideTo: 1500, when: 0.06, pan: 0.2 });
      this.noiseBurst(0.28, 0.06, { freq: 2400, q: 0.7, when: 0.02, sweepTo: 400, pan: panJit, send: 0.4 });
    } else {
      // Their shot carries: a long dark slap back off the structure.
      this.noiseBurst(0.7, 0.09 * atten, {
        freq: 900,
        q: 0.5,
        when: 0.03,
        sweepTo: 220,
        pan: panJit,
        distance,
        send: 0.55,
      });
    }
  }

  /** The snap of a round going past your head. Height is the near-miss. */
  crack(closeness: number, pan = 0): void {
    const k = clamp(closeness, 0.05, 1);
    this.noiseBurst(0.04, 0.6 * k, { freq: 7000, q: 0.9, type: 'highpass', pan, sweepTo: 2600, rate: 1.6 });
    this.tone(1700, 0.07, 'sawtooth', 0.09 * k, { slideTo: 580, pan });
    this.noiseBurst(0.26, 0.2 * k, { freq: 800, q: 1.1, pan, sweepTo: 220, when: 0.025, send: 0.3 });
    // A pressure thump in the chest, only for the closest ones.
    if (k > 0.55) this.tone(70, 0.3, 'sine', 0.18 * k, { slideTo: 40, pan, curve: 1.5 });
  }

  hitmarker(kill: boolean, chain = 0): void {
    // Rising with the chain: the hitmarker is the game's rhythm instrument.
    const base = 900 + chain * 90;
    this.tone(base, 0.05, 'square', 0.13, { slideTo: base * 1.7, send: 0.05 });
    this.noiseBurst(0.03, 0.1, { freq: 5200, q: 1.2, type: 'highpass' });
    if (kill) {
      this.tone(150, 0.5, 'sine', 0.5, { slideTo: 38, curve: 1.5, send: 0.2 });
      this.tone(690, 0.7, 'triangle', 0.1, { slideTo: 340, when: 0.02, send: 0.4 });
      this.noiseBurst(0.35, 0.16, { freq: 2400, q: 0.8, sweepTo: 360 });
    }
  }

  death(): void {
    this.tone(240, 1.3, 'sawtooth', 0.16, { slideTo: 32, curve: 1.2, send: 0.45 });
    this.noiseBurst(1.1, 0.16, { freq: 1000, q: 0.5, type: 'lowpass', sweepTo: 80, send: 0.5 });
    this.tone(58, 1.4, 'sine', 0.28, { slideTo: 30, send: 0.2, curve: 1.3 });
  }

  /** Kill stinger variants, one per purchasable effect. */
  killFx(kind: 'shatter' | 'bloom' | 'pulse' | 'sting'): void {
    if (kind === 'shatter') {
      // Glass: a bright splash plus inharmonic pings falling away.
      this.noiseBurst(0.5, 0.24, { freq: 6200, q: 1.4, sweepTo: 2200, send: 0.5, rate: 1.3 });
      for (let i = 0; i < 5; i++) {
        const f = 2200 + i * 620 + Math.random() * 200;
        this.tone(f, 0.28, 'triangle', 0.06, {
          slideTo: f * 0.55,
          when: 0.02 + i * 0.035,
          pan: (i - 2) * 0.22,
          send: 0.4,
        });
      }
    } else if (kind === 'bloom') {
      // A chord that opens: root, fifth, octave, with the fifth late.
      this.tone(392, 0.8, 'sine', 0.15, { send: 0.6, attack: 0.02 });
      this.tone(588, 0.9, 'sine', 0.09, { when: 0.05, send: 0.6 });
      this.tone(784, 0.8, 'sine', 0.06, { when: 0.1, send: 0.6 });
      this.noiseBurst(0.6, 0.07, { freq: 1400, q: 0.6, sweepTo: 320, send: 0.5 });
    } else if (kind === 'pulse') {
      this.tone(220, 0.28, 'square', 0.1, { slideTo: 1600, send: 0.3 });
      this.noiseBurst(0.22, 0.22, { freq: 3200, q: 5.5, sweepTo: 1100, send: 0.2, rate: 1.2 });
      this.noiseBurst(0.12, 0.12, { freq: 4800, q: 2.2, when: 0.09, sweepTo: 2200 });
    } else {
      // The default: a short, dry, confident knock with a sub under it.
      this.tone(1240, 0.09, 'square', 0.11, { slideTo: 700, send: 0.1 });
      this.tone(180, 0.55, 'sine', 0.3, { slideTo: 44, when: 0.02, send: 0.25, curve: 1.5 });
      this.noiseBurst(0.2, 0.1, { freq: 2600, q: 1.4, sweepTo: 600 });
    }
  }

  spawn(): void {
    this.tone(180, 0.5, 'sine', 0.2, { slideTo: 460, send: 0.3, curve: 1.6 });
    this.noiseBurst(0.4, 0.07, { freq: 2400, q: 1.2, sweepTo: 400, send: 0.4, attack: 0.05 });
    this.tone(660, 0.3, 'triangle', 0.05, { slideTo: 990, when: 0.1, send: 0.3 });
  }

  // ── Grapnel ──────────────────────────────────────────────────────────────

  /** The claw bites: metal on stone, with the cable snapping taut behind it. */
  attach(distance: number, pan: number): void {
    const a = 1 / (1 + distance / 60);
    this.tone(1250, 0.06, 'square', 0.11 * a, { slideTo: 520, pan, distance, send: 0.25 });
    this.noiseBurst(0.16, 0.24 * a, { freq: 1800, q: 2.8, pan, distance, sweepTo: 600, send: 0.3 });
    this.tone(74, 0.2, 'sine', 0.34 * a, { slideTo: 44, pan, send: 0.15, curve: 1.6 });
    // Stone chips falling off the bite point.
    this.noiseBurst(0.34, 0.06 * a, { freq: 3000, q: 1.2, when: 0.05, sweepTo: 900, pan, distance });
  }

  zip(): void {
    // A zip is a scream: rising band plus a rising motor harmonic.
    this.noiseBurst(0.4, 0.22, { freq: 600, q: 1.4, sweepTo: 4200, send: 0.2, rate: 1.1 });
    this.tone(300, 0.34, 'sine', 0.14, { slideTo: 1100, send: 0.2 });
    this.tone(150, 0.3, 'sawtooth', 0.05, { slideTo: 420, send: 0.15 });
  }

  release(boost: number): void {
    const b = clamp(boost, 0, 1);
    this.noiseBurst(0.55, 0.13 + b * 0.22, { freq: 420, q: 0.55, sweepTo: 2800, attack: 0.01, send: 0.35 });
    this.tone(220 + b * 200, 0.4, 'triangle', 0.08 + b * 0.1, { slideTo: 620 + b * 420, send: 0.3 });
    if (b > 0.55) {
      this.tone(96, 0.45, 'sine', 0.22, { slideTo: 58, curve: 1.5 });
      // The whip of the cable leaving: a short bright flick.
      this.noiseBurst(0.12, 0.12, { freq: 5200, q: 3, sweepTo: 1400, rate: 1.5 });
    }
  }

  /** Loadout change: a mechanical clack, heavier for the grapnel. */
  equip(grapnel: boolean): void {
    this.tone(grapnel ? 300 : 420, 0.06, 'square', 0.09, { slideTo: grapnel ? 170 : 560, send: 0.05 });
    this.noiseBurst(0.12, 0.08, { freq: grapnel ? 1200 : 2200, q: 2.2, sweepTo: 380, send: 0.08 });
    // The hand finding the grip: a small cloth rustle under the clack.
    this.noiseBurst(0.16, 0.03, { freq: 1600, q: 0.8, when: 0.03, sweepTo: 700 });
  }

  /** Claw launch: a pneumatic thump plus the cable paying out. */
  hookFire(): void {
    this.noiseBurst(0.05, 0.34, { freq: 900, q: 0.7, sweepTo: 3200, rate: 1.2, send: 0.2 });
    this.tone(158, 0.16, 'square', 0.16, { slideTo: 62, send: 0.15, curve: 1.6 });
    this.noiseBurst(0.42, 0.1, { freq: 2800, q: 2.6, sweepTo: 700, when: 0.03, rate: 0.9, send: 0.2 });
    this.tone(210, 0.3, 'sawtooth', 0.03, { slideTo: 420, when: 0.02, send: 0.1 });
  }

  /** Claw came back empty: the reel reversing, then the cradle catching it. */
  hookMiss(): void {
    this.noiseBurst(0.34, 0.08, { freq: 3200, q: 1.6, sweepTo: 500, rate: 1.1 });
    this.tone(280, 0.16, 'triangle', 0.05, { slideTo: 140 });
    this.tone(520, 0.1, 'square', 0.05, { slideTo: 300, when: 0.24, send: 0.1 });
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  /** One stride, on concrete or on plating. */
  footstep(strength: number, surface: 'concrete' | 'metal' = 'concrete'): void {
    const s = clamp(strength, 0.1, 1);
    const pan = (Math.random() - 0.5) * 0.16;
    if (surface === 'metal') {
      // A plate rings: a short inharmonic chime under the thud.
      this.noiseBurst(0.09, 0.1 * s, { freq: 1800, q: 1.4, pan, sweepTo: 600, rate: 1.2 });
      this.tone(430 + Math.random() * 60, 0.14, 'triangle', 0.04 * s, { slideTo: 300, pan, send: 0.2 });
    } else {
      // Concrete: a dull crunch, mostly noise, no real pitch.
      this.noiseBurst(0.1, 0.13 * s, { freq: 900, q: 0.8, type: 'lowpass', pan, sweepTo: 260, rate: 0.9 });
      this.noiseBurst(0.05, 0.05 * s, { freq: 4200, q: 0.9, type: 'highpass', pan, when: 0.005 });
      this.tone(88, 0.1, 'sine', 0.07 * s, { slideTo: 52, pan, curve: 1.6 });
    }
  }

  jump(): void {
    this.noiseBurst(0.14, 0.07, { freq: 1500, q: 1.1, sweepTo: 500, rate: 1.1 });
    this.noiseBurst(0.2, 0.04, { freq: 700, q: 0.7, when: 0.01, sweepTo: 300 });
  }

  land(strength: number): void {
    const s = clamp(strength, 0, 1);
    this.tone(76, 0.2, 'sine', 0.14 + s * 0.44, { slideTo: 36, curve: 1.4, send: 0.2 });
    this.noiseBurst(0.16, 0.06 + s * 0.13, { freq: 760, q: 0.7, type: 'lowpass', sweepTo: 140, rate: 0.85 });
    // Loose grit skittering away from the boots.
    this.noiseBurst(0.3, 0.02 + s * 0.05, { freq: 3600, q: 1.1, type: 'highpass', when: 0.03, sweepTo: 1200, rate: 1.2 });
    // Servo whine as the suit absorbs the impact.
    if (s > 0.4) this.tone(320, 0.18, 'sawtooth', 0.03 * s, { slideTo: 140, when: 0.01 });
  }

  dash(): void {
    this.noiseBurst(0.26, 0.2, { freq: 1400, q: 0.75, sweepTo: 260, send: 0.2, rate: 0.9 });
    this.tone(150, 0.16, 'square', 0.06, { slideTo: 66 });
    this.noiseBurst(0.3, 0.06, { freq: 2200, q: 0.9, when: 0.02, sweepTo: 600, rate: 1.4, send: 0.25 });
  }

  /** Mechanical scope click; the two tones are the in and out positions. */
  scope(zoomingIn: boolean): void {
    this.noiseBurst(0.05, 0.12, { freq: zoomingIn ? 2800 : 1800, q: 3.2, sweepTo: zoomingIn ? 900 : 2600, send: 0.06 });
    this.tone(zoomingIn ? 1180 : 760, 0.05, 'square', 0.05, { slideTo: zoomingIn ? 820 : 1100 });
    // The lens settling: a tiny mechanical tick a moment later.
    this.noiseBurst(0.03, 0.04, { freq: 4200, q: 4, when: 0.06, rate: 1.3 });
  }

  ringWarn(): void {
    this.tone(520, 0.55, 'sawtooth', 0.09, { slideTo: 760, send: 0.35 });
    this.tone(390, 0.55, 'sine', 0.07, { when: 0.06, send: 0.35 });
    // A sub pulse, so the warning is felt before it is heard.
    this.tone(64, 0.6, 'sine', 0.16, { slideTo: 42, send: 0.1 });
  }

  ui(kind: 'hover' | 'click' | 'back' | 'buy' | 'equip' | 'level' | 'reward'): void {
    if (kind === 'hover') this.tone(980, 0.04, 'sine', 0.035, { slideTo: 1180 });
    if (kind === 'click') {
      this.tone(620, 0.09, 'triangle', 0.09, { slideTo: 980, send: 0.12 });
      this.noiseBurst(0.04, 0.05, { freq: 3600, q: 2, rate: 1.3 });
    }
    if (kind === 'back') this.tone(420, 0.13, 'triangle', 0.07, { slideTo: 210, send: 0.12 });
    if (kind === 'buy') {
      // Coins: a quick metallic arpeggio, dry and bright.
      [1046, 1318, 1568, 2093].forEach((f, i) => {
        this.tone(f, 0.14, 'triangle', 0.07, { when: i * 0.045, send: 0.25, pan: (i - 1.5) * 0.12 });
      });
      this.noiseBurst(0.2, 0.05, { freq: 5200, q: 2.2, when: 0.02, rate: 1.4 });
    }
    if (kind === 'equip') {
      this.tone(300, 0.07, 'square', 0.07, { slideTo: 520 });
      this.noiseBurst(0.12, 0.07, { freq: 1600, q: 2.4, when: 0.02, sweepTo: 420 });
    }
    if (kind === 'level') {
      // A rising major triad with a soft bell on top.
      [392, 494, 587, 784].forEach((f, i) => {
        this.tone(f, 0.7, 'sine', 0.1, { when: i * 0.08, send: 0.55, attack: 0.01 });
      });
      this.tone(1568, 0.9, 'triangle', 0.04, { when: 0.26, send: 0.6 });
    }
    if (kind === 'reward') this.tone(1400, 0.05, 'square', 0.04, { slideTo: 1200 });
  }

  chain(stack: number): void {
    const f = 660 + stack * 110;
    this.tone(f, 0.11, 'triangle', 0.09, { slideTo: f * 2, send: 0.3 });
    this.tone(f * 1.5, 0.16, 'sine', 0.04, { when: 0.03, send: 0.3 });
  }

  /** World position → stereo pan and distance for the listener. */
  spatial(pos: Vec3, listener: Vec3, yaw: number): { pan: number; distance: number } {
    const dx = pos.x - listener.x;
    const dz = pos.z - listener.z;
    const dy = pos.y - listener.y;
    const distance = Math.hypot(dx, dz, dy);
    // Yaw 0 looks down -z, so the listener's right vector is +x.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const lateral = distance > 0.01 ? (dx * rightX + dz * rightZ) / Math.max(3, distance) : 0;
    // Height pulls the mix toward the middle: we have no height channel, and a
    // sound straight above you should not sound hard left.
    const pan = clamp(lateral * (1 - Math.abs(dy) / Math.max(8, distance)) * 0.9, -0.85, 0.85);
    return { pan, distance };
  }

  stopAll(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.wind) this.wind.gain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.cloth) this.cloth.gain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.drone) this.drone.gain.gain.setTargetAtTime(0.0001, t, 0.2);
    if (this.reel) this.reel.gain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.hum) this.hum.gain.gain.setTargetAtTime(0.0001, t, 0.1);
    if (this.scrape) this.scrape.gain.gain.setTargetAtTime(0.0001, t, 0.06);
  }
}
