// Струнный синтез: расширенный Karplus-Strong с плавной перестройкой длины задержки.
// Один процессор держит все струны; каждая струна получает свой голос.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const MAX_VOICES = 32;
const BUF = 8192;
const MASK = BUF - 1;
const ENV_EVERY = 3;

interface Params {
  t60: number;
  damping: number;
  hardness: number;
  noise: number;
  buzz: number;
  gain: number;
}

class Voice {
  buf = new Float32Array(BUF);
  w = 0;
  delay = 100;
  target = 100;
  prev = 0;
  g = 0.999;
  exc = new Float32Array(BUF);
  excPos = 0;
  excLen = 0;
  peak = 0;
  env = 0;
  quiet = 0;
  active = false;
  damped = false;
  freq = 220;
  panL = Math.SQRT1_2;
  panR = Math.SQRT1_2;
  dcIn = 0;
  dcOut = 0;
}

class PluckProcessor extends AudioWorkletProcessor {
  private voices: Voice[] = [];
  private p: Params = { t60: 3, damping: 0.5, hardness: 0.5, noise: 0.3, buzz: 0, gain: 0.6 };
  private envOut = new Float32Array(MAX_VOICES);
  private blocks = 0;

  constructor() {
    super();
    for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice());
    this.port.onmessage = (e: MessageEvent) => this.onMessage(e.data);
  }

  private onMessage(m: any) {
    switch (m.type) {
      case 'params':
        this.p = { ...this.p, ...m.params };
        for (const v of this.voices) this.updateGain(v);
        break;
      case 'pluck':
        this.pluck(this.voices[m.voice], m.freq, m.vel, m.pos, m.pan);
        break;
      case 'retune': {
        const v = this.voices[m.voice];
        v.freq = m.freq;
        v.target = this.delayFor(m.freq);
        this.updateGain(v);
        break;
      }
      case 'damp': {
        const v = this.voices[m.voice];
        v.damped = true;
        this.updateGain(v);
        break;
      }
      case 'stop': {
        const v = this.voices[m.voice];
        v.buf.fill(0);
        v.excLen = 0;
        v.active = false;
        v.env = 0;
        break;
      }
    }
  }

  private delayFor(freq: number) {
    const d = sampleRate / freq - this.p.damping;
    return Math.min(BUF - 8, Math.max(4, d));
  }

  private updateGain(v: Voice) {
    const f = v.freq;
    const t60 = v.damped ? 0.07 : this.p.t60 * Math.min(2, Math.max(0.45, Math.pow(196 / f, 0.45)));
    v.g = Math.pow(10, -3 / (t60 * f));
  }

  private pluck(v: Voice, freq: number, vel: number, pos: number, pan: number) {
    const first = !v.active;
    v.freq = freq;
    v.target = this.delayFor(freq);
    if (first || v.env < 0.002) v.delay = v.target;
    v.damped = false;
    this.updateGain(v);

    const a = (pan + 1) * Math.PI * 0.25;
    v.panL = Math.cos(a);
    v.panR = Math.sin(a);

    // Начальная форма: треугольник с вершиной в точке щипка плюс шум медиатора,
    // гребенка по точке щипка и сглаживание по жесткости.
    const n = Math.max(4, Math.min(BUF - 8, Math.round(sampleRate / freq)));
    const p = Math.min(0.92, Math.max(0.08, pos));
    const peakAt = Math.max(1, Math.round(p * n));
    const e = v.exc;
    const noise = this.p.noise;
    for (let i = 0; i < n; i++) {
      const tri = i < peakAt ? i / peakAt : (n - i) / (n - peakAt);
      e[i] = (1 - noise) * tri + noise * (Math.random() * 2 - 1);
    }
    const comb = Math.round(p * n * 0.5);
    if (comb > 0) for (let i = n - 1; i >= comb; i--) e[i] -= 0.6 * e[i - comb];

    const fc = 600 + 9000 * this.p.hardness * (0.35 + 0.65 * vel);
    const k = Math.exp((-2 * Math.PI * fc) / sampleRate);
    let s = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        s = (1 - k) * e[i] + k * s;
        e[i] = s;
      }
    }

    let mean = 0;
    for (let i = 0; i < n; i++) mean += e[i];
    mean /= n;
    let mx = 1e-9;
    for (let i = 0; i < n; i++) {
      e[i] -= mean;
      const ab = Math.abs(e[i]);
      if (ab > mx) mx = ab;
    }
    const amp = (0.12 + 0.88 * vel * vel) * 0.5 / mx;
    for (let i = 0; i < n; i++) e[i] *= amp;

    v.excPos = 0;
    v.excLen = n;
    v.active = true;
    v.quiet = 0;
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    const frames = L.length;
    const S = this.p.damping;
    const buzz = this.p.buzz;
    const gain = this.p.gain;

    for (let vi = 0; vi < MAX_VOICES; vi++) {
      const v = this.voices[vi];
      if (!v.active) continue;
      const buf = v.buf;
      let w = v.w;
      let delay = v.delay;
      const target = v.target;
      let prev = v.prev;
      const g = v.g;
      let peak = 0;
      let dcIn = v.dcIn;
      let dcOut = v.dcOut;

      for (let i = 0; i < frames; i++) {
        delay += (target - delay) * 0.0015;
        let d = delay;
        if (buzz > 0) d *= 1 - buzz * 0.035 * Math.min(1, Math.abs(prev) * 5);

        const rp = w - d;
        const ri = Math.floor(rp);
        const f = rp - ri;
        const x0 = buf[(ri - 1) & MASK];
        const x1 = buf[ri & MASK];
        const x2 = buf[(ri + 1) & MASK];
        const x3 = buf[(ri + 2) & MASK];
        const c1 = 0.5 * (x2 - x0);
        const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
        const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
        const y = ((c3 * f + c2) * f + c1) * f + x1;

        let fb = ((1 - S) * y + S * prev) * g;
        prev = y;
        if (v.excPos < v.excLen) fb += v.exc[v.excPos++];
        buf[w & MASK] = fb;
        w++;

        // Срез постоянной составляющей перед выходом.
        const o = y - dcIn + 0.995 * dcOut;
        dcIn = y;
        dcOut = o;

        const ab = o < 0 ? -o : o;
        if (ab > peak) peak = ab;
        const s = o * gain;
        L[i] += s * v.panL;
        R[i] += s * v.panR;
      }

      v.w = w & MASK;
      v.delay = delay;
      v.prev = prev;
      v.dcIn = dcIn;
      v.dcOut = dcOut;
      v.peak = peak;
      v.env = Math.max(peak, v.env * 0.82);

      if (peak < 2e-5 && v.excPos >= v.excLen) {
        if (++v.quiet > 40) {
          v.active = false;
          v.env = 0;
          buf.fill(0);
        }
      } else v.quiet = 0;
    }

    if (++this.blocks >= ENV_EVERY) {
      this.blocks = 0;
      for (let i = 0; i < MAX_VOICES; i++) this.envOut[i] = this.voices[i].env;
      this.port.postMessage(this.envOut);
    }
    return true;
  }
}

registerProcessor('pluck', PluckProcessor);
