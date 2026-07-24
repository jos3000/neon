export class Synth {
  ctx: AudioContext | null;
  master: GainNode | null;
  unlocked: boolean;

  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
  }

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      this.master = master;
      master.gain.value = 0.18;
      master.connect(ctx.destination);
    } catch (e) {
      console.warn('AudioContext unavailable', e);
      this.ctx = null;
    }
  }

  unlock() {
    this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    if (!(ctx.state === 'suspended')) {
      !ctx
        .resume()
        .then(() => {
          this.unlocked = true;
        })
        .catch(() => {});
    } else {
      this.unlocked = true;
    }
  }

  playOsc(type: OscillatorType, freq: number, duration = 0.12, gain = 0.12) {
    if (!this.ctx || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    o.connect(g);
    g.connect(this.master!);
    o.start(now);
    o.stop(now + duration + 0.02);
  }

  playShot() {
    this.playOsc('sawtooth', 880, 0.08, 0.08);
  }
  playHit() {
    this.playOsc('square', 420, 0.1, 0.1);
  }
  playExplosion() {
    this.playOsc('sawtooth', 160, 0.28, 0.22);
    this.playOsc('sine', 260, 0.18, 0.1);
  }
  playBigSpawn() {
    this.playOsc('triangle', 220, 0.36, 0.18);
  }
  playDeath() {
    this.playOsc('sawtooth', 120, 0.6, 0.24);
  }
  playTick() {
    this.playOsc('square', 1200, 0.06, 0.06);
  }
  playGo() {
    this.playOsc('sawtooth', 1400, 0.18, 0.12);
  }
}
