import { spatialMix } from "./combat-feedback.js";
const SPATIAL_LIFETIME = Object.freeze({
  rifle: 0.16,
  smg: 0.12,
  pistol: 0.18,
  shotgun: 0.36,
  sniper: 0.36,
  explosion: 0.8,
  step: 0.12,
  land: 0.18,
  bow: 0.2,
  flame: 0.23,
});
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.65;
    this.noise = null;
    this.spatialVoices = new Set();
    this.output = null;
  }
  init() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
      if (!this.noise) {
        this.noise = this.ctx.createBuffer(
          1,
          this.ctx.sampleRate,
          this.ctx.sampleRate,
        );
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
    } catch {}
  }
  tone(freq, duration = 0.1, type = "sine", level = 0.2, end) {
    if (!this.ctx || !this.volume) return;
    const o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (end)
      o.frequency.exponentialRampToValueAtTime(
        end,
        this.ctx.currentTime + duration,
      );
    g.gain.setValueAtTime(level * this.volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    o.connect(g).connect(this.output || this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + duration);
  }
  noiseHit(duration, level, filter = 1000) {
    if (!this.ctx || !this.noise || !this.volume) return;
    const s = this.ctx.createBufferSource(),
      f = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = "lowpass";
    f.frequency.value = filter;
    g.gain.setValueAtTime(level * this.volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    s.connect(f)
      .connect(g)
      .connect(this.output || this.ctx.destination);
    s.start(0, Math.random() * 0.5);
    s.stop(this.ctx.currentTime + duration);
  }
  playAt(name, position, listener, yaw = 0, level = 1, occluded = false) {
    if (!this.ctx || !this.volume || !listener || this.spatialVoices.size >= 32)
      return;
    const mix = spatialMix(listener, position, yaw, occluded);
    if (mix.gain * level < 0.015) return;
    const pan = this.ctx.createStereoPanner(),
      gain = this.ctx.createGain(),
      filter = this.ctx.createBiquadFilter();
    pan.pan.value = mix.pan;
    gain.gain.value = mix.gain;
    filter.type = "lowpass";
    filter.frequency.value = mix.cutoff;
    pan.connect(filter).connect(gain).connect(this.ctx.destination);
    const voice = { pan, gain, filter, timer: null };
    this.spatialVoices.add(voice);
    const previous = this.output;
    try {
      this.output = pan;
      this.play(name, level);
    } finally {
      this.output = previous;
      voice.timer = setTimeout(
        () => {
          pan.disconnect();
          gain.disconnect();
          filter.disconnect();
          this.spatialVoices.delete(voice);
        },
        ((SPATIAL_LIFETIME[name] || 0.8) + 0.06) * 1000,
      );
      voice.timer.unref?.();
    }
  }
  clearSpatial() {
    if (this.flameVoice) {
      try {
        this.flameVoice.source.stop();
      } catch {}
      this.flameVoice.source.disconnect();
      this.flameVoice.filter.disconnect();
      this.flameVoice.gain.disconnect();
      this.flameVoice = null;
    }
    for (const voice of this.spatialVoices) {
      clearTimeout(voice.timer);
      voice.pan.disconnect();
      voice.gain.disconnect();
      voice.filter.disconnect();
    }
    this.spatialVoices.clear();
    this.output = null;
  }
  updateFlame(active) {
    if (!this.ctx || !this.noise || !this.volume) active = false;
    if (active && !this.flameVoice) {
      const source = this.ctx.createBufferSource(),
        filter = this.ctx.createBiquadFilter(),
        gain = this.ctx.createGain();
      source.buffer = this.noise;
      source.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 1550;
      gain.gain.value = 0.001;
      source.connect(filter).connect(gain).connect(this.ctx.destination);
      source.start();
      this.flameVoice = { source, filter, gain, last: this.ctx.currentTime };
    }
    const voice = this.flameVoice;
    if (!voice) return;
    const time = this.ctx.currentTime;
    if (active) voice.last = time;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setTargetAtTime(
      active ? this.volume * 0.2 : 0.001,
      time,
      0.035,
    );
    voice.filter.frequency.setTargetAtTime(
      1550 + Math.sin(time * 13) * 160,
      time,
      0.06,
    );
    if (!active && time - voice.last > 0.18) {
      voice.source.stop();
      voice.source.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      this.flameVoice = null;
    }
  }
  play(name, level = 1) {
    switch (name) {
      case "bow":
        this.noiseHit(0.16, 0.1, 2400);
        this.tone(480, 0.15, "triangle", 0.09, 180);
        break;
      case "flame":
        this.noiseHit(0.17, 0.18, 1700);
        break;
      case "flash":
        this.noiseHit(0.22, 0.2, 6000);
        this.tone(3300, 0.5, "sine", 0.08, 2600);
        break;
      case "heal":
        this.tone(660, 0.2, "sine", 0.1);
        break;
      case "rifle":
        this.noiseHit(0.1, 0.25 * level, 2500);
        this.tone(135, 0.09, "sawtooth", 0.1 * level, 40);
        break;
      case "smg":
        this.noiseHit(0.07, 0.16 * level, 3200);
        this.tone(180, 0.06, "square", 0.045 * level, 65);
        break;
      case "pistol":
        this.noiseHit(0.12, 0.24 * level, 3000);
        this.tone(210, 0.1, "triangle", 0.18 * level, 50);
        break;
      case "shotgun":
      case "sniper":
        this.noiseHit(0.3, 0.4 * level, 1800);
        this.tone(110, 0.22, "sawtooth", 0.2 * level, 25);
        break;
      case "explosion":
        this.noiseHit(0.7, 0.55 * level, 550);
        this.tone(75, 0.5, "sine", 0.5 * level, 20);
        break;
      case "hit":
        this.tone(950, 0.055, "triangle", 0.15);
        this.tone(1450, 0.06, "sine", 0.12);
        break;
      case "head":
        this.tone(1900, 0.11, "sine", 0.18);
        break;
      case "kill":
        this.tone(660, 0.18, "triangle", 0.2);
        setTimeout(() => this.tone(990, 0.22, "triangle", 0.15), 70);
        break;
      case "step":
        this.noiseHit(0.07, 0.075 * level, 600);
        break;
      case "land":
        this.noiseHit(0.12, 0.12 * level, 550);
        this.tone(78, 0.1, "sine", 0.075 * level, 42);
        break;
      case "jump":
        this.noiseHit(0.14, 0.08, 700);
        break;
      case "double":
        this.tone(280, 0.15, "sine", 0.15, 650);
        break;
      case "reload":
        this.noiseHit(0.1, 0.15, 3500);
        setTimeout(() => this.noiseHit(0.08, 0.1, 2000), 240);
        break;
      case "switch":
        this.noiseHit(0.05, 0.1, 3000);
        break;
      case "empty":
        this.tone(120, 0.04, "square", 0.06);
        break;
      case "guard":
        this.noiseHit(0.2, 0.14, 4200);
        this.tone(480, 0.15, "triangle", 0.08, 760);
        break;
      case "parry":
        this.tone(2400, 0.18, "triangle", 0.2, 900);
        this.noiseHit(0.08, 0.14, 6500);
        break;
      case "melee":
      case "throw":
        this.noiseHit(0.16, 0.12, 1000);
        break;
      case "rocket":
        this.noiseHit(0.4, 0.25, 1200);
        break;
      case "count":
        this.tone(600, 0.12, "sine", 0.1);
        break;
      case "go":
        this.tone(950, 0.2, "triangle", 0.15);
        break;
      case "hurt":
        this.noiseHit(0.13, 0.13, 450);
        break;
    }
  }
}
