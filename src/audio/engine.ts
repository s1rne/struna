import workletUrl from './pluck.worklet.ts?worker&url';
import { PRESETS, SAMPLE_ID, type Preset } from './presets';
import { loadSample, type LoadedSample } from './sample';

export const MAX_VOICES = 32;
const MASTER = 1.6;

interface SampleVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  rate: number;
  vel: number;
}

export class AudioEngine {
  ctx!: AudioContext;
  private node!: AudioWorkletNode;
  private bodyIn!: GainNode;
  private bodyOut!: GainNode;
  private bodyNodes: BiquadFilterNode[] = [];
  private sampleBus!: GainNode;
  private dry!: GainNode;
  private send!: GainNode;
  private wet!: GainNode;
  private master!: GainNode;
  private synthEnv = new Float32Array(MAX_VOICES);
  private sampleVoices: (SampleVoice | null)[] = new Array(MAX_VOICES).fill(null);
  readonly env = new Float32Array(MAX_VOICES);

  preset: Preset = PRESETS[0];
  mode: string = PRESETS[0].id;
  sample: LoadedSample | null = null;
  private muted = false;

  async init() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(ctx, 'pluck', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.port.onmessage = (e) => this.synthEnv.set(e.data as Float32Array);

    this.bodyIn = ctx.createGain();
    this.bodyOut = ctx.createGain();
    this.sampleBus = ctx.createGain();
    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.wet = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = MASTER;

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 2.6);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    this.node.connect(this.bodyIn);
    this.bodyOut.connect(this.dry);
    this.sampleBus.connect(this.dry);
    this.dry.connect(this.master);
    this.dry.connect(this.send);
    this.send.connect(reverb);
    reverb.connect(this.wet);
    this.wet.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.applyPreset(this.preset);
  }

  resume() {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.03);
  }

  get isMuted() {
    return this.muted;
  }

  setMode(id: string) {
    this.mode = id;
    if (id !== SAMPLE_ID) {
      const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
      this.preset = p;
      this.applyPreset(p);
    } else {
      this.send.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.05);
    }
  }

  get transpose() {
    return this.mode === SAMPLE_ID ? 0 : this.preset.transpose;
  }

  private applyPreset(p: Preset) {
    const { t60, damping, hardness, noise, buzz, gain } = p;
    this.node.port.postMessage({ type: 'params', params: { t60, damping, hardness, noise, buzz, gain } });

    this.bodyIn.disconnect();
    for (const n of this.bodyNodes) n.disconnect();
    this.bodyNodes = p.body.map((b) => {
      const f = this.ctx.createBiquadFilter();
      f.type = b.type;
      f.frequency.value = b.freq;
      if (b.q !== undefined) f.Q.value = b.q;
      if (b.gain !== undefined) f.gain.value = b.gain;
      return f;
    });
    let prev: AudioNode = this.bodyIn;
    for (const n of this.bodyNodes) {
      prev.connect(n);
      prev = n;
    }
    prev.connect(this.bodyOut);
    this.send.gain.setTargetAtTime(p.reverb, this.ctx.currentTime, 0.05);
  }

  async loadSampleFile(file: File) {
    this.sample = await loadSample(this.ctx, file);
    return this.sample;
  }

  pluck(voice: number, freq: number, vel: number, pos: number, pan: number) {
    if (this.mode === SAMPLE_ID) {
      this.pluckSample(voice, freq, vel, pan);
      return;
    }
    this.node.port.postMessage({ type: 'pluck', voice, freq, vel, pos, pan });
  }

  retune(voice: number, freq: number) {
    if (this.mode === SAMPLE_ID) {
      const v = this.sampleVoices[voice];
      if (v && this.sample) {
        v.rate = freq / this.sample.rootFreq;
        v.src.playbackRate.setTargetAtTime(v.rate, this.ctx.currentTime, 0.02);
      }
      return;
    }
    this.node.port.postMessage({ type: 'retune', voice, freq });
  }

  damp(voice: number) {
    this.node.port.postMessage({ type: 'damp', voice });
    this.fadeSample(voice, 0.06);
  }

  stop(voice: number) {
    this.node.port.postMessage({ type: 'stop', voice });
    this.fadeSample(voice, 0.02);
  }

  private pluckSample(voice: number, freq: number, vel: number, pan: number) {
    const s = this.sample;
    if (!s) return;
    this.fadeSample(voice, 0.03);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    const rate = freq / s.rootFreq;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const amp = 0.15 + 0.85 * vel * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.004);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sampleBus);
    src.start(t, s.start);
    const sv: SampleVoice = { src, gain: g, startedAt: t, rate, vel: amp };
    this.sampleVoices[voice] = sv;
    src.onended = () => {
      if (this.sampleVoices[voice] === sv) this.sampleVoices[voice] = null;
      p.disconnect();
    };
  }

  private fadeSample(voice: number, time: number) {
    const v = this.sampleVoices[voice];
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + time);
    v.src.stop(t + time + 0.01);
    this.sampleVoices[voice] = null;
  }

  // Огибающая каждого голоса для анимации струн.
  updateEnv() {
    const s = this.sample;
    const now = this.ctx.currentTime;
    for (let i = 0; i < MAX_VOICES; i++) {
      let e = this.synthEnv[i] * 2.2;
      const v = this.sampleVoices[i];
      if (v && s) {
        const k = Math.floor(((now - v.startedAt) * v.rate) / s.hop);
        e = Math.max(e, k < s.envelope.length ? s.envelope[k] * v.vel : 0);
      }
      this.env[i] = Math.min(1, e);
    }
  }
}

function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // С течением хвоста шум темнеет, как в настоящем зале.
      const k = 0.15 + 0.8 * t;
      lp = (1 - k) * (Math.random() * 2 - 1) + k * lp;
      const pre = i < sr * 0.012 ? 0 : 1;
      d[i] = lp * Math.pow(1 - t, 3.2) * pre;
    }
  }
  return buf;
}
