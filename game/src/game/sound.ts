/**
 * Courtyard ambience — the fuller bed (option B).
 *
 * Not a notification kit. A quiet open-stone place: two layers of air, a distant
 * water lap that never lands on the beat, a warm fifth that breathes, and a short
 * motif written out by hand rather than picked at random. Effects sit in the same
 * hall, and they stay short.
 */

const SCALE = [146.83, 164.81, 196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0];

// A written phrase, in scale degrees, with a rest as -1. Repeats. Timing is humanized.
const MOTIF: Array<[number, number]> = [
  [5, 0.0],
  [7, 1.55],
  [4, 3.4],
  [-1, 4.6],
  [6, 5.15],
  [5, 6.7],
  [8, 8.35],
  [3, 10.1],
];
const MOTIF_LEN = 13.5;

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private rollStoneGain: GainNode | null = null;
  private rollStoneFilter: BiquadFilterNode | null = null;
  private rollShadowGain: GainNode | null = null;
  private rollShadowFilter: BiquadFilterNode | null = null;
  private sunHumGain: GainNode | null = null;
  private sunHumFilter: BiquadFilterNode | null = null;

  private started = false;
  private muted = false;
  private lastDetent = 0;
  private detentStep = 0;

  private volumes: AudioVolumes = { master: 0.9, music: 0.55, sfx: 0.85, ambience: 0.72 };

  private impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const n = Math.random() * 2 - 1;
        lp = lp * 0.78 + n * 0.22;
        const env = Math.pow(1 - i / len, decay);
        // A couple of early taps so the hall has a wall, not a wash
        const tap = i > ctx.sampleRate * 0.04 && i < ctx.sampleRate * 0.06 ? 0.35 : 1;
        d[i] = lp * env * tap;
      }
    }
    return buf;
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.028;
      b1 = 0.985 * b1 + w * 0.031;
      b2 = 0.95 * b2 + w * 0.046;
      d[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.05) * 1.7));
    }
    return buf;
  }

  private buildGraph(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0.0001 : this.volumes.master;
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(ctx, 2.4, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.34;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.0001;
    this.ambienceBus.connect(this.master);
    this.ambienceBus.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, this.volumes.ambience),
      ctx.currentTime + 2.8
    );

    this.noise = this.noiseBuffer(ctx, 4);
  }

  private buildBed(ctx: AudioContext) {
    if (!this.noise || !this.ambienceBus || !this.sfxBus || !this.reverbSend || !this.musicBus) return;

    // Low air across the basin
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = 'lowpass';
    airF.frequency.value = 260;
    airF.Q.value = 0.55;
    const airG = ctx.createGain();
    airG.gain.value = 0.055;
    air.connect(airF);
    airF.connect(airG);
    airG.connect(this.ambienceBus);
    air.start();

    const airLfo = ctx.createOscillator();
    const airLfoG = ctx.createGain();
    airLfo.frequency.value = 0.041;
    airLfoG.gain.value = 70;
    airLfo.connect(airLfoG);
    airLfoG.connect(airF.frequency);
    airLfo.start();

    // A thinner, higher air — the open edge of the court, not a second wind machine
    const high = ctx.createBufferSource();
    high.buffer = this.noise;
    high.loop = true;
    high.playbackRate.value = 1.35;
    const highF = ctx.createBiquadFilter();
    highF.type = 'bandpass';
    highF.frequency.value = 1400;
    highF.Q.value = 0.45;
    const highG = ctx.createGain();
    highG.gain.value = 0.007;
    high.connect(highF);
    highF.connect(highG);
    highG.connect(this.ambienceBus);
    high.start();

    // Distant water, always just present
    const water = ctx.createBufferSource();
    water.buffer = this.noise;
    water.loop = true;
    water.playbackRate.value = 0.62;
    const waterF = ctx.createBiquadFilter();
    waterF.type = 'bandpass';
    waterF.frequency.value = 480;
    waterF.Q.value = 0.7;
    const waterG = ctx.createGain();
    waterG.gain.value = 0.012;
    water.connect(waterF);
    waterF.connect(waterG);
    waterG.connect(this.ambienceBus);
    water.start();

    const waterLfo = ctx.createOscillator();
    const waterLfoG = ctx.createGain();
    waterLfo.frequency.value = 0.07;
    waterLfoG.gain.value = 0.004;
    waterLfo.connect(waterLfoG);
    waterLfoG.connect(waterG.gain);
    waterLfo.start();

    // Warm fifth, detuned a few cents so it doesn't sit like a test tone
    [98.0, 146.83].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = i === 0 ? -4 : 6;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.045 : 0.02;
      osc.connect(g);
      g.connect(this.ambienceBus!);
      osc.start();
    });

    // Rolling contact
    const stone = ctx.createBufferSource();
    stone.buffer = this.noise;
    stone.loop = true;
    this.rollStoneFilter = ctx.createBiquadFilter();
    this.rollStoneFilter.type = 'bandpass';
    this.rollStoneFilter.frequency.value = 165;
    this.rollStoneFilter.Q.value = 1.4;
    this.rollStoneGain = ctx.createGain();
    this.rollStoneGain.gain.value = 0.0001;
    stone.connect(this.rollStoneFilter);
    this.rollStoneFilter.connect(this.rollStoneGain);
    this.rollStoneGain.connect(this.sfxBus);
    stone.start();

    const shade = ctx.createBufferSource();
    shade.buffer = this.noise;
    shade.loop = true;
    this.rollShadowFilter = ctx.createBiquadFilter();
    this.rollShadowFilter.type = 'bandpass';
    this.rollShadowFilter.frequency.value = 700;
    this.rollShadowFilter.Q.value = 3.2;
    this.rollShadowGain = ctx.createGain();
    this.rollShadowGain.gain.value = 0.0001;
    shade.connect(this.rollShadowFilter);
    this.rollShadowFilter.connect(this.rollShadowGain);
    this.rollShadowGain.connect(this.sfxBus);
    this.rollShadowGain.connect(this.reverbSend);
    shade.start();

    // Light source hum — present, never a laser
    this.sunHumGain = ctx.createGain();
    this.sunHumGain.gain.value = 0.0035;
    this.sunHumFilter = ctx.createBiquadFilter();
    this.sunHumFilter.type = 'lowpass';
    this.sunHumFilter.frequency.value = 860;
    this.sunHumFilter.Q.value = 0.6;
    this.sunHumFilter.connect(this.sunHumGain);
    this.sunHumGain.connect(this.sfxBus);
    this.sunHumGain.connect(this.reverbSend);

    [196.0, 293.66, 587.33].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 7;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.14 : 0.4;
      osc.connect(g);
      g.connect(this.sunHumFilter!);
      osc.start();
    });

    this.scheduleMotif(ctx.currentTime + 1.6);
    this.scheduleLap(ctx.currentTime + 1.2);
  }

  /** Written motif, slightly late or early, the way a person plays it. */
  private scheduleMotif(at: number) {
    if (!this.ctx || !this.musicBus) return;
    for (const [degree, beat] of MOTIF) {
      if (degree < 0) continue;
      const wobble = (Math.random() - 0.5) * 0.06;
      const vel = 0.028 + Math.random() * 0.008;
      this.tone(SCALE[degree], at + beat + wobble, vel, 3.6, 'music', true, 'triangle');
    }
    const next = at + MOTIF_LEN + (Math.random() - 0.5) * 0.4;
    window.setTimeout(() => {
      if (this.ctx) this.scheduleMotif(Math.max(this.ctx.currentTime + 0.05, next));
    }, Math.max(200, (next - (this.ctx?.currentTime ?? at)) * 1000 - 400));
  }

  /** A single lap against stone, never metronomic. */
  private scheduleLap(at: number) {
    if (!this.ctx) return;
    this.burst(at, 0.016 + Math.random() * 0.008, 360 + Math.random() * 80, 0.8, 0.42, 'ambience');
    const wait = 2.6 + Math.random() * 3.4;
    window.setTimeout(() => {
      if (this.ctx) this.scheduleLap(this.ctx.currentTime + 0.05);
    }, wait * 1000);
  }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.buildGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.ctx.state === 'running' && !this.started) {
      this.started = true;
      this.buildBed(this.ctx);
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    at: number,
    peak: number,
    decay: number,
    bus: 'music' | 'sfx' = 'sfx',
    sendReverb = true,
    type: OscillatorType = 'triangle'
  ) {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const ctx = this.ctx;
    const dest = bus === 'music' ? this.musicBus : this.sfxBus;

    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc.type = type;
    osc2.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc2.frequency.setValueAtTime(freq * 2.003, at);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(Math.min(4200, freq * 5.2), at);
    filt.frequency.exponentialRampToValueAtTime(Math.max(280, freq * 1.25), at + decay * 0.7);
    filt.Q.value = 0.55;

    const g2 = ctx.createGain();
    g2.gain.value = 0.18;

    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    osc.connect(filt);
    osc2.connect(g2);
    g2.connect(filt);
    filt.connect(env);
    env.connect(dest);
    if (sendReverb && this.reverbSend) env.connect(this.reverbSend);

    osc.start(at);
    osc2.start(at);
    osc.stop(at + decay + 0.04);
    osc2.stop(at + decay + 0.04);
  }

  private burst(
    at: number,
    peak: number,
    freq: number,
    q: number,
    dur: number,
    bus: 'sfx' | 'ambience' = 'sfx'
  ) {
    if (!this.ctx || !this.noise || !this.sfxBus || !this.ambienceBus) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.35;

    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(filt);
    filt.connect(env);
    env.connect(bus === 'sfx' ? this.sfxBus : this.ambienceBus);
    if (bus === 'sfx' && this.reverbSend) env.connect(this.reverbSend);

    src.start(at);
    src.stop(at + dur + 0.04);
  }

  wake() {
    this.ensure();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0.0001 : this.volumes.master, this.ctx.currentTime, 0.08);
    }
  }

  isMuted() {
    return this.muted;
  }

  setVolumes(v: Partial<AudioVolumes>) {
    this.volumes = { ...this.volumes, ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0.0001 : this.volumes.master, t, 0.08);
    this.musicBus?.gain.setTargetAtTime(this.volumes.music, t, 0.15);
    this.sfxBus?.gain.setTargetAtTime(this.volumes.sfx, t, 0.08);
    this.ambienceBus?.gain.setTargetAtTime(Math.max(0.0002, this.volumes.ambience), t, 0.25);
  }

  setSunEngagement(amount: number) {
    if (!this.ctx || !this.sunHumGain || !this.sunHumFilter) return;
    const t = this.ctx.currentTime;
    const a = Math.max(0, Math.min(1, amount));
    this.sunHumGain.gain.setTargetAtTime(0.0035 + a * 0.028, t, 0.18);
    this.sunHumFilter.frequency.setTargetAtTime(780 + a * 1400, t, 0.22);
  }

  updateRolling(speedNorm: number, onShadow: boolean, airborne: boolean) {
    if (!this.ctx || !this.rollStoneGain || !this.rollShadowGain) return;
    if (!this.rollStoneFilter || !this.rollShadowFilter) return;
    const t = this.ctx.currentTime;
    const v = this.muted || airborne ? 0 : Math.max(0, Math.min(1, speedNorm));
    this.rollStoneGain.gain.setTargetAtTime(!onShadow && v > 0.02 ? v * 0.05 : 0.0001, t, 0.05);
    this.rollStoneFilter.frequency.setTargetAtTime(125 + v * 140, t, 0.06);
    this.rollShadowGain.gain.setTargetAtTime(onShadow && v > 0.02 ? v * 0.032 : 0.0001, t, 0.06);
    this.rollShadowFilter.frequency.setTargetAtTime(560 + v * 340, t, 0.07);
  }

  playSunTick() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastDetent < 0.09) return;
    this.lastDetent = now;
    this.detentStep = (this.detentStep + 1) % 5;
    this.burst(now, 0.011, 2100 + this.detentStep * 40, 2.8, 0.026);
    this.tone(SCALE[2 + this.detentStep] * 2, now, 0.007, 0.08, 'sfx', false, 'sine');
  }

  playUiClick() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.burst(now, 0.02, 1280, 1.8, 0.032);
    this.tone(310, now, 0.014, 0.06, 'sfx', false, 'sine');
  }

  playUiBack() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.burst(now, 0.014, 820, 1.6, 0.04);
    this.tone(196, now, 0.012, 0.08, 'sfx', false, 'sine');
  }

  playBridgeAligned() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(SCALE[5], now, 0.048, 1.6, 'sfx', true, 'triangle');
    this.tone(SCALE[7], now + 0.12, 0.038, 1.9, 'sfx', true, 'triangle');
    this.burst(now + 0.02, 0.014, 400, 0.9, 0.55);
  }

  playBump(intensity = 0.5) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const v = Math.max(0.15, Math.min(1, intensity));
    this.tone(140 + v * 55, now, 0.028 + v * 0.04, 0.1, 'sfx', true, 'sine');
    this.burst(now, 0.01 + v * 0.018, 580, 1.3, 0.055);
  }

  playEclipseState(eclipsed: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (eclipsed) {
      this.tone(SCALE[2], now, 0.04, 1.0, 'sfx', true, 'triangle');
      this.tone(SCALE[1], now + 0.11, 0.032, 1.25, 'sfx', true, 'triangle');
      this.burst(now + 0.16, 0.018, 240, 0.9, 0.24);
    } else {
      this.tone(SCALE[4], now, 0.034, 1.05, 'sfx', true, 'triangle');
      this.tone(SCALE[6], now + 0.1, 0.03, 1.5, 'sfx', true, 'triangle');
    }
  }

  playFall() {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.46);
    env.gain.setValueAtTime(0.032, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(env);
    env.connect(this.sfxBus);
    if (this.reverbSend) env.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.55);
    this.burst(now + 0.02, 0.012, 340, 0.8, 0.4);
  }

  playWaterSplash() {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    // Soft upward bubble + filtered water spray
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.085);
    env.gain.setValueAtTime(0.032, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(env);
    env.connect(this.sfxBus);
    if (this.reverbSend) env.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + 0.16);
    this.burst(now, 0.034, 920, 0.85, 0.28);
    this.burst(now + 0.05, 0.018, 1650, 1.2, 0.22);
  }

  playRespawn() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(174.6, now, 0.028, 0.16, 'sfx', true, 'sine');
    this.burst(now, 0.014, 700, 1.4, 0.07);
  }

  playVictory() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    [SCALE[3], SCALE[5], SCALE[6], SCALE[8]].forEach((f, i) => {
      this.tone(f, now + i * 0.17, 0.04 - i * 0.004, 3.1, 'sfx', true, 'triangle');
    });
    this.burst(now + 0.08, 0.01, 460, 0.8, 1.0);
  }
}

export const sound = new SoundEngine();
