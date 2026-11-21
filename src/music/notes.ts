export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface Scale {
  id: string;
  name: string;
  steps: number[] | null;
}

export const SCALES: Scale[] = [
  { id: 'pent', name: 'Пентатоника', steps: [0, 2, 4, 7, 9] },
  { id: 'major', name: 'Мажор', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Минор', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'minpent', name: 'Минорная пентатоника', steps: [0, 3, 5, 7, 10] },
  { id: 'chrom', name: 'Хроматика', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'free', name: 'Без ладов', steps: null },
];

// Длина струны относительно диагонали экрана задает высоту, как у настоящей струны
// при одном натяжении: вдвое короче значит на октаву выше. 0.8 диагонали дает E2.
const R_REF = 0.8;
const MIDI_REF = 40;
export const MIDI_MIN = 28;
export const MIDI_MAX = 96;

export function lengthToMidi(ratio: number): number {
  const m = MIDI_REF + 12 * Math.log2(R_REF / Math.max(ratio, 1e-3));
  return Math.min(MIDI_MAX, Math.max(MIDI_MIN, m));
}

export function midiToLength(midi: number): number {
  return R_REF / Math.pow(2, (midi - MIDI_REF) / 12);
}

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Ближайшая нота лада с гистерезисом: пока струну тянут, нота не дребезжит на границе.
export function snapMidi(raw: number, scale: Scale, key: number, current?: number): number {
  if (!scale.steps) return raw;
  const inScale = (n: number) => scale.steps!.includes((((n - key) % 12) + 12) % 12);
  if (current !== undefined && inScale(current) && Number.isInteger(current)) {
    let lo = current - 1;
    while (!inScale(lo)) lo--;
    let hi = current + 1;
    while (!inScale(hi)) hi++;
    const down = current - (current - lo) / 2 - 0.18;
    const up = current + (hi - current) / 2 + 0.18;
    if (raw > down && raw < up) return current;
  }
  let best = Math.round(raw);
  let bestD = Infinity;
  for (let n = Math.floor(raw) - 6; n <= Math.ceil(raw) + 6; n++) {
    if (!inScale(n)) continue;
    const d = Math.abs(n - raw);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function noteName(midi: number): { name: string; octave: number; cents: number } {
  const n = Math.round(midi);
  return { name: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: Math.round((midi - n) * 100) };
}
