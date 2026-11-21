export interface BodyFilter {
  type: BiquadFilterType;
  freq: number;
  q?: number;
  gain?: number;
}

export interface Preset {
  id: string;
  name: string;
  hint: string;
  transpose: number;
  t60: number;
  damping: number;
  hardness: number;
  noise: number;
  buzz: number;
  gain: number;
  reverb: number;
  body: BodyFilter[];
}

export const PRESETS: Preset[] = [
  {
    id: 'nylon',
    name: 'Нейлон',
    hint: 'Классическая гитара',
    transpose: 0,
    t60: 3.2,
    damping: 0.5,
    hardness: 0.42,
    noise: 0.3,
    buzz: 0,
    gain: 0.55,
    reverb: 0.2,
    body: [
      { type: 'peaking', freq: 105, q: 1.4, gain: 5 },
      { type: 'peaking', freq: 230, q: 1.2, gain: 3 },
      { type: 'peaking', freq: 2600, q: 0.8, gain: -2 },
      { type: 'highshelf', freq: 6000, gain: -6 },
    ],
  },
  {
    id: 'steel',
    name: 'Сталь',
    hint: 'Акустика с металлическими струнами',
    transpose: 0,
    t60: 5,
    damping: 0.3,
    hardness: 0.72,
    noise: 0.42,
    buzz: 0,
    gain: 0.45,
    reverb: 0.2,
    body: [
      { type: 'peaking', freq: 98, q: 1.3, gain: 4 },
      { type: 'peaking', freq: 210, q: 1, gain: 2 },
      { type: 'peaking', freq: 3200, q: 0.9, gain: 2.5 },
      { type: 'highshelf', freq: 9000, gain: -3 },
    ],
  },
  {
    id: 'harp',
    name: 'Арфа',
    hint: 'Мягкий щипок, долгий звон',
    transpose: 12,
    t60: 4.5,
    damping: 0.45,
    hardness: 0.28,
    noise: 0.12,
    buzz: 0,
    gain: 0.5,
    reverb: 0.34,
    body: [
      { type: 'peaking', freq: 190, q: 0.9, gain: 2 },
      { type: 'highshelf', freq: 4500, gain: -8 },
    ],
  },
  {
    id: 'bass',
    name: 'Бас',
    hint: 'На октаву ниже',
    transpose: -12,
    t60: 3.6,
    damping: 0.5,
    hardness: 0.35,
    noise: 0.22,
    buzz: 0,
    gain: 0.75,
    reverb: 0.08,
    body: [
      { type: 'lowshelf', freq: 90, gain: 4 },
      { type: 'peaking', freq: 700, q: 0.9, gain: 2 },
      { type: 'highshelf', freq: 3500, gain: -9 },
    ],
  },
  {
    id: 'sitar',
    name: 'Ситар',
    hint: 'Жужжащий мостик',
    transpose: 0,
    t60: 5,
    damping: 0.18,
    hardness: 0.8,
    noise: 0.35,
    buzz: 0.7,
    gain: 0.38,
    reverb: 0.26,
    body: [
      { type: 'peaking', freq: 300, q: 1, gain: 2 },
      { type: 'peaking', freq: 2200, q: 1.5, gain: 3 },
      { type: 'highshelf', freq: 8000, gain: -4 },
    ],
  },
];

export const SAMPLE_ID = 'sample';
