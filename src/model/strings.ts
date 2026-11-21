import { MAX_VOICES } from '../audio/engine';
import { lengthToMidi, snapMidi, type Scale } from '../music/notes';
import { dist, type Vec } from '../types';

export interface Str {
  id: number;
  a: Vec;
  b: Vec;
  midi: number;
  voice: number;
  born: number;
  dying: number;
  held: number;
}

export interface Tuning {
  scale: Scale;
  key: number;
}

export const MIN_LENGTH = 60;

export class StringSet {
  list: Str[] = [];
  private nextId = 1;

  constructor(private viewport: () => { w: number; h: number }) {}

  get diag() {
    const { w, h } = this.viewport();
    return Math.hypot(w, h);
  }

  get alive() {
    return this.list.filter((s) => !s.dying);
  }

  get full() {
    return this.alive.length >= MAX_VOICES;
  }

  add(a: Vec, b: Vec, tuning: Tuning, now: number): Str | null {
    const used = new Set(this.list.map((s) => s.voice));
    let voice = -1;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (!used.has(i)) {
        voice = i;
        break;
      }
    }
    if (voice < 0) return null;
    const s: Str = { id: this.nextId++, a: { ...a }, b: { ...b }, midi: 0, voice, born: now, dying: 0, held: 0 };
    s.midi = this.pitchOf(s, tuning);
    this.list.push(s);
    return s;
  }

  byId(id: number) {
    return this.list.find((s) => s.id === id);
  }

  kill(s: Str, now: number) {
    s.dying = now;
  }

  sweep(now: number) {
    this.list = this.list.filter((s) => !s.dying || now - s.dying < 320);
  }

  pitchOf(s: Str, tuning: Tuning, keep = false): number {
    const raw = lengthToMidi(dist(s.a, s.b) / this.diag);
    return snapMidi(raw, tuning.scale, tuning.key, keep ? s.midi : undefined);
  }

  retuneAll(tuning: Tuning) {
    for (const s of this.list) s.midi = this.pitchOf(s, tuning);
  }

  rescale(sx: number, sy: number) {
    for (const s of this.list) {
      s.a = { x: s.a.x * sx, y: s.a.y * sy };
      s.b = { x: s.b.x * sx, y: s.b.y * sy };
    }
  }

  serialize() {
    const { w, h } = this.viewport();
    return this.alive.map((s) => [s.a.x / w, s.a.y / h, s.b.x / w, s.b.y / h].map((v) => Math.round(v * 1e4) / 1e4));
  }

  restore(data: number[][], tuning: Tuning, now: number) {
    const { w, h } = this.viewport();
    for (const [ax, ay, bx, by] of data) this.add({ x: ax * w, y: ay * h }, { x: bx * w, y: by * h }, tuning, now);
  }
}

// Геометрия точки относительно струны: t вдоль (0..1), d со знаком поперек.
export function relate(s: Str, p: Vec) {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = p.x - s.a.x;
  const py = p.y - s.a.y;
  return { t: (px * dx + py * dy) / (len * len), d: (dx * py - dy * px) / len, len };
}
