export interface LoadedSample {
  name: string;
  buffer: AudioBuffer;
  rootFreq: number;
  start: number;
  hop: number;
  envelope: Float32Array;
}

const HOP = 256;

export async function loadSample(ctx: BaseAudioContext, file: File): Promise<LoadedSample> {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const mono = mixDown(buffer);
  const start = findOnset(mono);
  const envelope = rmsEnvelope(mono, start);
  const rootFreq = detectPitch(mono, start, buffer.sampleRate) ?? 261.63;
  return { name: file.name.replace(/\.[^.]+$/, ''), buffer, rootFreq, start: start / buffer.sampleRate, hop: HOP / buffer.sampleRate, envelope };
}

function mixDown(b: AudioBuffer): Float32Array {
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / b.numberOfChannels;
  }
  return out;
}

function findOnset(x: Float32Array): number {
  let mx = 0;
  for (let i = 0; i < x.length; i++) mx = Math.max(mx, Math.abs(x[i]));
  const th = mx * 0.03;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) return Math.max(0, i - 64);
  return 0;
}

function rmsEnvelope(x: Float32Array, start: number): Float32Array {
  const n = Math.floor((x.length - start) / HOP);
  const env = new Float32Array(Math.max(1, n));
  let mx = 1e-9;
  for (let k = 0; k < n; k++) {
    let s = 0;
    const o = start + k * HOP;
    for (let i = 0; i < HOP; i++) s += x[o + i] * x[o + i];
    env[k] = Math.sqrt(s / HOP);
    mx = Math.max(mx, env[k]);
  }
  for (let k = 0; k < n; k++) env[k] /= mx;
  return env;
}

// Нормированная автокорреляция по окну сразу после атаки.
function detectPitch(x: Float32Array, start: number, sr: number): number | null {
  const size = Math.min(4096, x.length - start - 1);
  const from = start + Math.min(Math.floor(sr * 0.04), Math.max(0, x.length - start - size - 1));
  if (size < 1024) return null;
  const minLag = Math.floor(sr / 1200);
  const maxLag = Math.min(Math.floor(sr / 45), size >> 1);
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    let m = 0;
    for (let i = 0; i < size - lag; i++) {
      const a = x[from + i];
      const b = x[from + i + lag];
      ac += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * ac) / m : 0;
  }
  let best = -1;
  let bestVal = 0;
  let globalMax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) globalMax = Math.max(globalMax, nsdf[lag]);
  if (globalMax < 0.5) return null;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > 0.88 * globalMax) {
      best = lag;
      bestVal = nsdf[lag];
      break;
    }
  }
  if (best < 0 || bestVal <= 0) return null;
  const a = nsdf[best - 1];
  const b = nsdf[best];
  const c = nsdf[best + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return sr / (best + shift);
}
