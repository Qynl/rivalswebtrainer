/**
 * Procedural sound effects built with WebAudio, so the game ships no audio files.
 * Browsers only allow audio after a user gesture, so call `unlock()` from a click handler.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.6;

  /** Creates the audio context. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // One second of white noise, reused by all noise-based effects.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private ready(): AudioContext | null {
    return this.ctx && this.master ? this.ctx : null;
  }

  private burst(start: number, dur: number, gain: number, freqFrom: number, freqTo: number, type: OscillatorType = 'sawtooth'): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(start: number, dur: number, gain: number, cutoff: number, q = 0.7): void {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  /** Gunshot. Pass `heavy` for the rifle, `light` for SMG-style guns. */
  gunshot(kind: 'heavy' | 'mid' | 'light' = 'mid'): void {
    const f = kind === 'heavy' ? 140 : kind === 'mid' ? 190 : 260;
    this.burst(0, 0.12, 0.35, f, 40);
    this.noiseBurst(0, kind === 'heavy' ? 0.16 : 0.09, 0.6, 1800 + (kind === 'light' ? 800 : 0));
  }

  hitMarker(head: boolean): void {
    this.burst(0, 0.08, 0.25, head ? 1800 : 1100, head ? 2400 : 900, 'square');
  }

  /** Damage taken by the player. */
  hurt(): void {
    this.burst(0, 0.18, 0.3, 220, 60, 'triangle');
  }

  swing(): void {
    this.noiseBurst(0, 0.22, 0.35, 2400, 0.9);
  }

  dash(): void {
    this.noiseBurst(0, 0.28, 0.4, 900, 0.5);
    this.burst(0, 0.25, 0.12, 300, 900, 'sine');
  }

  jump(): void {
    this.burst(0, 0.12, 0.12, 280, 520, 'sine');
  }

  roundEnd(won: boolean): void {
    if (won) {
      this.burst(0, 0.2, 0.2, 523, 523, 'triangle');
      this.burst(0.15, 0.3, 0.2, 784, 784, 'triangle');
    } else {
      this.burst(0, 0.35, 0.2, 260, 110, 'triangle');
    }
  }
}
