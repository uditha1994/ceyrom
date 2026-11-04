/**
 * Synthesised sound: every effect is generated with WebAudio (no sample files),
 * tuned to sound like wood on a powdered board. Music is a quiet generative
 * pentatonic phrase on a soft marimba-like voice over a low drone.
 */
type Sfx = 'coin' | 'striker' | 'wall' | 'pocket' | 'queen' | 'place' | 'turn' | 'foul' | 'win' | 'lose' | 'ui' | 'shoot' | 'cover';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private drone: OscillatorNode[] = [];
  vol = { music: 0.35, sfx: 0.8, muted: false };
  private lastPlace = 0;
  private musicOn = false;

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.connect(this.master);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.apply();
      if (this.musicOn) this.startMusic();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.vol = { music, sfx, muted };
    this.apply();
  }

  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : 1, t, 0.03);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
    this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.2);
  }

  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private noise(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(at, Math.random() * 0.3);
    src.stop(at + dur + 0.02);
  }

  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', to?: number, dest?: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** Marimba-ish pluck: fundamental + 4th partial, fast decay. */
  private mallet(at: number, freq: number, gain: number, dest?: AudioNode): void {
    this.tone(at, freq, 0.9, gain, 'sine', undefined, dest);
    this.tone(at, freq * 3.98, 0.12, gain * 0.25, 'sine', undefined, dest);
  }

  play(kind: Sfx, intensity = 1): void {
    if (!this.ctx || this.vol.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.001;
    const k = Math.max(0.05, Math.min(1, intensity));
    const v = (Math.random() - 0.5) * 0.12;
    switch (kind) {
      case 'coin':
        this.noise(t, 0.05, 'bandpass', 3200 * (1 + v), 3, 0.5 * k);
        this.tone(t, 1850 * (1 + v), 0.05, 0.12 * k, 'triangle');
        break;
      case 'striker':
        this.noise(t, 0.07, 'bandpass', 1900 * (1 + v), 2.2, 0.75 * k);
        this.tone(t, 260, 0.08, 0.3 * k, 'sine', 180);
        break;
      case 'wall':
        this.noise(t, 0.09, 'lowpass', 520, 1, 0.55 * k);
        this.tone(t, 110, 0.12, 0.35 * k, 'sine', 70);
        break;
      case 'pocket':
        this.noise(t, 0.16, 'lowpass', 700, 0.8, 0.45);
        this.tone(t, 320, 0.22, 0.32, 'sine', 120);
        this.noise(t + 0.06, 0.18, 'bandpass', 2400, 6, 0.08);
        break;
      case 'queen':
        this.play('pocket');
        [784, 988, 1175].forEach((f, i) => this.mallet(t + 0.08 + i * 0.09, f, 0.16));
        break;
      case 'cover':
        [587, 784, 988, 1319].forEach((f, i) => this.mallet(t + i * 0.08, f, 0.15));
        break;
      case 'place':
        if (t - this.lastPlace < 0.05) return;
        this.lastPlace = t;
        this.noise(t, 0.025, 'highpass', 2500, 0.7, 0.05);
        break;
      case 'shoot':
        this.noise(t, 0.04, 'bandpass', 1200, 1.4, 0.25 * k);
        break;
      case 'turn':
        this.mallet(t, 523, 0.12);
        this.mallet(t + 0.11, 659, 0.1);
        break;
      case 'foul':
        this.tone(t, 196, 0.18, 0.28, 'triangle', 150);
        this.tone(t + 0.16, 165, 0.25, 0.28, 'triangle', 120);
        break;
      case 'win':
        [523, 587, 659, 784, 880, 1047].forEach((f, i) => this.mallet(t + i * 0.12, f, 0.17));
        break;
      case 'lose':
        [440, 392, 330].forEach((f, i) => this.mallet(t + i * 0.18, f, 0.13));
        break;
      case 'ui':
        this.noise(t, 0.02, 'bandpass', 2600, 4, 0.12);
        break;
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const c = this.ctx;
    // drone: two detuned low sines through a lowpass
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const dg = c.createGain();
    dg.gain.value = 0.05;
    lp.connect(dg).connect(this.music);
    this.drone = [110, 110.6, 164.8].map((f) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return o;
    });
    // pentatonic (D major pentatonic) — gentle, unhurried
    const scale = [293.7, 329.6, 370, 440, 493.9, 587.3, 659.3, 740];
    let step = 0;
    const tick = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.05;
      const n = scale[Math.floor(Math.random() * scale.length)];
      if (Math.random() < 0.8) this.mallet(t, n, 0.06, this.music);
      if (step % 8 === 0) this.mallet(t, scale[0] / 2, 0.05, this.music);
      step++;
      this.musicTimer = window.setTimeout(tick, 520 + Math.random() * 640);
    };
    tick();
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearTimeout(this.musicTimer);
    this.musicTimer = null;
    for (const o of this.drone) o.stop();
    this.drone = [];
  }
}

export const audio = new AudioEngine();

export function haptic(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua && !ua.hasBeenActive) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
