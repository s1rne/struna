import { MIN_LENGTH, relate, type Str, type StringSet, type Tuning } from '../model/strings';
import { clamp, dist, type HandInput, type Vec } from '../types';

const R_END = 42;
const R_BODY = 26;
const CREATE_DRAG = 34;
const TRASH_R = 78;

type Grab =
  | { kind: 'none' }
  | { kind: 'pending'; start: Vec }
  | { kind: 'end'; id: number; end: 'a' | 'b'; off: Vec }
  | { kind: 'move'; id: number; offA: Vec; offB: Vec };

interface HandState {
  wasPinching: boolean;
  grab: Grab;
  pos: Vec;
}

interface Finger {
  prev: Vec | null;
  engaged: { id: number; side: number } | null;
}

export interface Bend {
  id: number;
  t: number;
  d: number;
}

export interface Hover {
  id: number;
  part: 'a' | 'b' | 'body';
}

export interface ControllerEvents {
  pluck(s: Str, vel: number, pos: number, at: Vec, delayMs: number): void;
  damp(s: Str): void;
  retune(s: Str, noteChanged: boolean): void;
  created(s: Str): void;
  removed(s: Str, reason: 'trash' | 'short'): void;
  full(): void;
}

export class Controller {
  private hands = new Map<string, HandState>();
  private fingers = new Map<string, Finger>();
  private cooldown = new Map<string, number>();
  private creating = new Set<number>();
  bends: Bend[] = [];
  hovers: Hover[] = [];
  pendings: Vec[] = [];
  trash = { visible: false, hot: false, pos: { x: 0, y: 0 } };

  constructor(
    private strings: StringSet,
    private tuning: () => Tuning,
    private ev: ControllerEvents,
  ) {}

  setTrashPos(p: Vec) {
    this.trash.pos = p;
  }

  isGrabbable(p: Vec) {
    return this.target(p) !== null;
  }

  private target(p: Vec): Hover | null {
    let best: Hover | null = null;
    let bestD = R_END;
    for (const s of this.strings.alive) {
      const da = dist(p, s.a);
      const db = dist(p, s.b);
      if (da < bestD) {
        bestD = da;
        best = { id: s.id, part: 'a' };
      }
      if (db < bestD) {
        bestD = db;
        best = { id: s.id, part: 'b' };
      }
    }
    if (best) return best;
    bestD = R_BODY;
    for (const s of this.strings.alive) {
      const r = relate(s, p);
      if (r.t > 0 && r.t < 1 && Math.abs(r.d) < bestD) {
        bestD = Math.abs(r.d);
        best = { id: s.id, part: 'body' };
      }
    }
    return best;
  }

  update(now: number, dt: number, inputs: HandInput[]) {
    const seen = new Set<string>();
    this.bends = [];
    this.hovers = [];
    this.pendings = [];

    for (const h of inputs) {
      seen.add(h.id);
      let st = this.hands.get(h.id);
      if (!st) {
        st = { wasPinching: false, grab: { kind: 'none' }, pos: h.pinchPos };
        this.hands.set(h.id, st);
      }
      st.pos = h.pinchPos;
      if (h.pinching && !st.wasPinching) this.pinchStart(h, st, now);
      else if (h.pinching) this.pinchMove(h, st, now);
      else if (st.wasPinching) this.pinchEnd(st, now);
      st.wasPinching = h.pinching;

      if (st.grab.kind === 'pending') this.pendings.push(st.grab.start);
      if (!h.pinching && h.present && (h.kind === 'pointer' || h.pinchAmount > 0.45)) {
        const t = this.target(h.pinchPos);
        if (t) this.hovers.push(t);
      }
    }

    for (const [id, st] of this.hands) {
      if (seen.has(id)) continue;
      if (st.wasPinching) this.pinchEnd(st, now);
      this.hands.delete(id);
    }

    this.trash.visible = [...this.hands.values()].some((s) => s.grab.kind === 'move');
    if (!this.trash.visible) this.trash.hot = false;

    for (const h of inputs) {
      const st = this.hands.get(h.id)!;
      const canPlay = h.present && !h.pinching && st.grab.kind === 'none';
      h.tips.forEach((tip, i) => this.finger(h.id + ':' + i, canPlay ? tip : null, now, dt));
    }
    for (const key of this.fingers.keys()) {
      if (!seen.has(key.slice(0, key.indexOf(':')))) this.fingers.delete(key);
    }
  }

  private pinchStart(h: HandInput, st: HandState, now: number) {
    const p = h.pinchPos;
    const t = this.target(p);
    if (t) {
      const s = this.strings.byId(t.id)!;
      s.held++;
      this.ev.damp(s);
      if (t.part === 'body') {
        st.grab = { kind: 'move', id: s.id, offA: sub(s.a, p), offB: sub(s.b, p) };
      } else {
        st.grab = { kind: 'end', id: s.id, end: t.part, off: sub(s[t.part], p) };
      }
      return;
    }

    // Вторая рука щипнула в пустоте, пока первая ждет: струна натягивается между руками.
    for (const other of this.hands.values()) {
      if (other === st || other.grab.kind !== 'pending') continue;
      const s = this.spawn(other.pos, p, now);
      if (!s) break;
      s.held = 2;
      other.grab = { kind: 'end', id: s.id, end: 'a', off: { x: 0, y: 0 } };
      st.grab = { kind: 'end', id: s.id, end: 'b', off: { x: 0, y: 0 } };
      return;
    }
    st.grab = { kind: 'pending', start: { ...p } };
  }

  private pinchMove(h: HandInput, st: HandState, now: number) {
    const p = h.pinchPos;
    const g = st.grab;
    if (g.kind === 'pending') {
      if (dist(p, g.start) > CREATE_DRAG) {
        const s = this.spawn(g.start, p, now);
        if (!s) {
          st.grab = { kind: 'none' };
          return;
        }
        s.held = 1;
        st.grab = { kind: 'end', id: s.id, end: 'b', off: { x: 0, y: 0 } };
      }
      return;
    }
    if (g.kind === 'end') {
      const s = this.strings.byId(g.id);
      if (!s) return;
      s[g.end] = add(p, g.off);
      this.reshaped(s);
      return;
    }
    if (g.kind === 'move') {
      const s = this.strings.byId(g.id);
      if (!s) return;
      s.a = add(p, g.offA);
      s.b = add(p, g.offB);
      this.trash.hot = dist(p, this.trash.pos) < TRASH_R;
    }
  }

  private pinchEnd(st: HandState, now: number) {
    const g = st.grab;
    st.grab = { kind: 'none' };
    if (g.kind === 'none' || g.kind === 'pending') return;
    const s = this.strings.byId(g.id);
    if (!s || s.dying) return;
    s.held = Math.max(0, s.held - 1);

    if (g.kind === 'move' && this.trash.hot) {
      this.trash.hot = false;
      s.held = 0;
      this.strings.kill(s, now);
      this.ev.removed(s, 'trash');
      return;
    }
    if (s.held > 0) return;
    if (dist(s.a, s.b) < MIN_LENGTH) {
      this.strings.kill(s, now);
      if (!this.creating.has(s.id)) this.ev.removed(s, 'short');
      this.creating.delete(s.id);
      return;
    }
    if (this.creating.delete(s.id)) this.ev.created(s);
  }

  private spawn(a: Vec, b: Vec, now: number): Str | null {
    if (this.strings.full) {
      this.ev.full();
      return null;
    }
    const s = this.strings.add(a, b, this.tuning(), now);
    if (s) this.creating.add(s.id);
    return s;
  }

  private reshaped(s: Str) {
    const before = s.midi;
    s.midi = this.strings.pitchOf(s, this.tuning(), true);
    if (s.midi !== before) this.ev.retune(s, Number.isInteger(s.midi) && Math.round(before) !== s.midi);
  }

  // Палец задевает струну, ведет ее за собой и срывается, как при настоящем щипке.
  private finger(key: string, p: Vec | null, now: number, dt: number) {
    let f = this.fingers.get(key);
    if (!f) {
      f = { prev: null, engaged: null };
      this.fingers.set(key, f);
    }
    if (!p) {
      f.prev = null;
      f.engaged = null;
      return;
    }
    const prev = f.prev;
    f.prev = { ...p };
    if (!prev) return;

    if (f.engaged) {
      const s = this.strings.byId(f.engaged.id);
      if (!s || s.held || s.dying) {
        f.engaged = null;
        return;
      }
      const r = relate(s, p);
      const r0 = relate(s, prev);
      const past = -r.d * f.engaged.side;
      const maxDisp = clamp(r.len * 0.08, 14, 40);
      const speed = Math.abs(r.d - r0.d) / Math.max(dt, 1e-3);
      if (past <= 0) {
        f.engaged = null;
      } else if (past > maxDisp || r.t < 0.01 || r.t > 0.99) {
        f.engaged = null;
        this.cool(key, s.id, now);
        const vel = clamp(0.4 + 0.6 * Math.min(1, speed / 1600), 0.25, 1);
        this.ev.pluck(s, vel, clamp(r.t, 0, 1), p, 0);
      } else {
        this.bends.push({ id: s.id, t: r.t, d: r.d });
      }
      return;
    }

    const engagedIds = new Set<number>();
    for (const fi of this.fingers.values()) if (fi.engaged) engagedIds.add(fi.engaged.id);

    for (const s of this.strings.alive) {
      if (s.held || engagedIds.has(s.id) || now - s.born < 200) continue;
      if ((this.cooldown.get(key + '/' + s.id) ?? 0) > now) continue;
      const r0 = relate(s, prev);
      const r1 = relate(s, p);
      if (r0.d === 0 || Math.sign(r0.d) === Math.sign(r1.d)) continue;
      const k = r0.d / (r0.d - r1.d);
      const tc = r0.t + (r1.t - r0.t) * k;
      if (tc < 0.02 || tc > 0.98) continue;

      const maxDisp = clamp(r1.len * 0.08, 14, 40);
      const past = Math.abs(r1.d);
      if (past > maxDisp) {
        const speed = Math.abs(r1.d - r0.d) / Math.max(dt, 1e-3);
        const vel = clamp(0.3 + 0.7 * Math.min(1, speed / 1800), 0.2, 1);
        this.cool(key, s.id, now);
        const at = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
        // Задержка по моменту пересечения внутри кадра: быстрый бой звучит как бой, а не аккорд.
        this.ev.pluck(s, vel, tc, at, k * dt * 1000);
      } else {
        f.engaged = { id: s.id, side: Math.sign(r0.d) };
        this.bends.push({ id: s.id, t: r1.t, d: r1.d });
        return;
      }
    }
  }

  private cool(key: string, id: number, now: number) {
    this.cooldown.set(key + '/' + id, now + 90);
    if (this.cooldown.size > 400) {
      for (const [k, t] of this.cooldown) if (t < now) this.cooldown.delete(k);
    }
  }
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
