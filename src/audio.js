export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.65;
    this.noise = null;
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
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + duration);
  }
  noiseHit(duration, level, filter = 1000) {
    if (!this.ctx || !this.noise) return;
    const s = this.ctx.createBufferSource(),
      f = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = "lowpass";
    f.frequency.value = filter;
    g.gain.setValueAtTime(level * this.volume, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    s.connect(f).connect(g).connect(this.ctx.destination);
    s.start(0, Math.random() * 0.5);
    s.stop(this.ctx.currentTime + duration);
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
