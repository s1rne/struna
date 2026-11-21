import type { Controller } from '../interaction/controller';
import type { Str, StringSet } from '../model/strings';
import { noteName } from '../music/notes';
import { HAND_EDGES } from '../vision/tracker';
import { clamp, type HandInput, type Vec } from '../types';

export interface Ripple {
  at: Vec;
  t0: number;
  hue: number;
  vel: number;
}

export interface VideoFit {
  scale: number;
  ox: number;
  oy: number;
}

export interface Frame {
  now: number;
  strings: StringSet;
  ctrl: Controller;
  hands: HandInput[];
  env: Float32Array;
  ripples: Ripple[];
  transpose: number;
  video: HTMLVideoElement | null;
  fit: VideoFit | null;
  showVideo: boolean;
}

export const hueOf = (midi: number) => {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  // Квинтовый круг: соседние ступени лада получают близкие оттенки.
  return (((pc * 7) % 12) * 30 + 28) % 360;
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private phase = new Map<number, number>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  draw(f: Frame, dt: number) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    this.background(f);

    const bendOf = new Map(f.ctrl.bends.map((b) => [b.id, b]));
    const hoverOf = new Map(f.ctrl.hovers.map((h) => [h.id, h.part]));

    for (const s of f.strings.list) {
      const ph = (this.phase.get(s.id) ?? Math.random() * 6) + dt * (6 + 3 * Math.log2(1 + Math.max(0, s.midi - 28) / 12)) * Math.PI * 2;
      this.phase.set(s.id, ph);
      this.string(s, f, ph, bendOf.get(s.id), hoverOf.get(s.id));
    }
    for (const id of this.phase.keys()) if (!f.strings.byId(id)) this.phase.delete(id);

    this.ripples(f);
    this.trash(f);
    for (const p of f.ctrl.pendings) this.pending(p, f.now);
    for (const h of f.hands) this.hand(h);
  }

  private background(f: Frame) {
    const c = this.ctx;
    const { w, h } = this;
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, w, h);
    if (f.showVideo && f.video && f.fit && f.video.readyState >= 2) {
      const { scale, ox, oy } = f.fit;
      c.save();
      c.translate(w, 0);
      c.scale(-1, 1);
      c.drawImage(f.video, ox, oy, f.video.videoWidth * scale, f.video.videoHeight * scale);
      c.restore();
      c.fillStyle = 'rgba(9, 9, 12, 0.52)';
      c.fillRect(0, 0, w, h);
    }
    const g = c.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  private string(s: Str, f: Frame, ph: number, bend: { t: number; d: number } | undefined, hover: 'a' | 'b' | 'body' | undefined) {
    const c = this.ctx;
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const env = f.env[s.voice] ?? 0;
    const hue = hueOf(s.midi + f.transpose);

    let k = 1;
    if (s.dying) k = 1 - clamp((f.now - s.dying) / 320, 0, 1);
    const appear = clamp((f.now - s.born) / 260, 0, 1);
    const alpha = k * (0.35 + 0.65 * appear);
    const cx = (s.a.x + s.b.x) / 2;
    const cy = (s.a.y + s.b.y) / 2;
    const shrink = s.dying ? 0.4 + 0.6 * k : 1;
    const A = { x: cx + (s.a.x - cx) * shrink, y: cy + (s.a.y - cy) * shrink };
    const B = { x: cx + (s.b.x - cx) * shrink, y: cy + (s.b.y - cy) * shrink };

    const pts: Vec[] = [];
    const amp = env * clamp(len * 0.03, 2.5, 15);
    if (bend) {
      pts.push(A, { x: A.x + ux * bend.t * len + nx * bend.d, y: A.y + uy * bend.t * len + ny * bend.d }, B);
    } else {
      const N = 48;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const off = amp * (Math.sin(Math.PI * u) * Math.cos(ph) + 0.3 * Math.sin(2 * Math.PI * u) * Math.sin(1.73 * ph));
        pts.push({ x: A.x + (B.x - A.x) * u + nx * off, y: A.y + (B.y - A.y) * u + ny * off });
      }
    }

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // Размытое «веретено»: так глаз видит быстро колеблющуюся струну.
    if (amp > 0.6 && !bend) {
      c.beginPath();
      const N = 32;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const o = amp * 1.15 * Math.sin(Math.PI * u);
        const x = A.x + (B.x - A.x) * u + nx * o;
        const y = A.y + (B.y - A.y) * u + ny * o;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      for (let i = N; i >= 0; i--) {
        const u = i / N;
        const o = -amp * 1.15 * Math.sin(Math.PI * u);
        c.lineTo(A.x + (B.x - A.x) * u + nx * o, A.y + (B.y - A.y) * u + ny * o);
      }
      c.closePath();
      c.fillStyle = `hsla(${hue}, 85%, 62%, ${0.1 * env * alpha})`;
      c.fill();
    }

    const path = () => {
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    };
    const lit = s.held ? 0.5 : hover === 'body' ? 0.35 : 0;
    path();
    c.strokeStyle = `hsla(${hue}, 90%, 60%, ${(0.06 + 0.22 * env + 0.08 * lit) * alpha})`;
    c.lineWidth = 10 + 6 * env;
    c.stroke();
    path();
    c.strokeStyle = `hsla(${hue}, 85%, 66%, ${(0.22 + 0.4 * env + 0.2 * lit) * alpha})`;
    c.lineWidth = 3.4;
    c.stroke();
    path();
    c.strokeStyle = `hsla(${hue}, 60%, 94%, ${(0.78 + 0.22 * env) * alpha})`;
    c.lineWidth = 1.3;
    c.stroke();
    c.restore();

    for (const end of ['a', 'b'] as const) {
      const P = end === 'a' ? A : B;
      const hot = hover === end;
      if (hot || s.held) {
        c.beginPath();
        c.arc(P.x, P.y, hot ? 15 : 10, 0, Math.PI * 2);
        c.fillStyle = `hsla(${hue}, 90%, 65%, ${0.16 * alpha})`;
        c.fill();
      }
      c.beginPath();
      c.arc(P.x, P.y, 4.5, 0, Math.PI * 2);
      c.fillStyle = `rgba(12, 12, 15, ${0.9 * alpha})`;
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = `hsla(${hue}, 70%, 78%, ${alpha})`;
      c.stroke();
    }

    const n = noteName(s.midi + f.transpose);
    c.textBaseline = 'middle';
    if (s.held && !s.dying) {
      const side = ny > 0 ? -1 : 1;
      c.textAlign = 'center';
      c.font = '600 26px ui-sans-serif, -apple-system, "SF Pro Display", "Segoe UI", sans-serif';
      c.fillStyle = `hsla(${hue}, 70%, 88%, ${alpha})`;
      c.fillText(n.name + n.octave, cx + nx * side * 34, cy + ny * side * 34);
      if (n.cents) {
        c.font = '500 12px ui-sans-serif, -apple-system, sans-serif';
        c.fillStyle = `rgba(255,255,255,${0.5 * alpha})`;
        c.fillText((n.cents > 0 ? '+' : '') + n.cents + '¢', cx + nx * side * 58, cy + ny * side * 58);
      }
    } else {
      // Подпись у левого колка, снаружи струны: середина остается свободной для игры.
      const left = A.x <= B.x ? A : B;
      const dir = A.x <= B.x ? -1 : 1;
      c.textAlign = 'right';
      c.font = '500 12px ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", sans-serif';
      c.fillStyle = `hsla(${hue}, 50%, 88%, ${(0.45 + 0.55 * env) * alpha})`;
      c.save();
      c.translate(left.x + ux * dir * 14, left.y + uy * dir * 14);
      c.fillText(n.name + n.octave, 0, 0);
      c.restore();
    }
  }

  private ripples(f: Frame) {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const r of f.ripples) {
      const t = (f.now - r.t0) / 520;
      if (t < 0 || t >= 1) continue;
      const e = 1 - Math.pow(1 - t, 3);
      c.beginPath();
      c.arc(r.at.x, r.at.y, 4 + e * (12 + 18 * r.vel), 0, Math.PI * 2);
      c.strokeStyle = `hsla(${r.hue}, 90%, 72%, ${(1 - t) * 0.6})`;
      c.lineWidth = 1.5;
      c.stroke();
    }
    c.restore();
  }

  private trash(f: Frame) {
    const t = f.ctrl.trash;
    if (!t.visible) return;
    const c = this.ctx;
    const r = t.hot ? 40 : 32;
    c.save();
    c.beginPath();
    c.arc(t.pos.x, t.pos.y, r, 0, Math.PI * 2);
    c.fillStyle = t.hot ? 'rgba(232, 72, 64, 0.32)' : 'rgba(255,255,255,0.06)';
    c.fill();
    c.lineWidth = 1.5;
    c.setLineDash(t.hot ? [] : [4, 5]);
    c.strokeStyle = t.hot ? 'rgba(255, 120, 110, 0.9)' : 'rgba(255,255,255,0.35)';
    c.stroke();
    c.setLineDash([]);
    const s = 8;
    c.beginPath();
    c.moveTo(t.pos.x - s, t.pos.y - s);
    c.lineTo(t.pos.x + s, t.pos.y + s);
    c.moveTo(t.pos.x + s, t.pos.y - s);
    c.lineTo(t.pos.x - s, t.pos.y + s);
    c.strokeStyle = t.hot ? '#fff' : 'rgba(255,255,255,0.6)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.stroke();
    c.restore();
  }

  private pending(p: Vec, now: number) {
    const c = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    c.save();
    c.beginPath();
    c.arc(p.x, p.y, 16 + 4 * pulse, 0, Math.PI * 2);
    c.setLineDash([3, 5]);
    c.strokeStyle = `rgba(255, 196, 120, ${0.5 + 0.3 * pulse})`;
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
  }

  private hand(h: HandInput) {
    const c = this.ctx;
    if (h.landmarks && h.present) {
      const L = h.landmarks;
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.22)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (const [a, b] of HAND_EDGES) {
        c.moveTo(L[a].x, L[a].y);
        c.lineTo(L[b].x, L[b].y);
      }
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 21; i++) {
        if (i % 4 === 0 && i) continue;
        c.beginPath();
        c.arc(L[i].x, L[i].y, 1.8, 0, Math.PI * 2);
        c.fill();
      }
      if (!h.pinching) {
        c.fillStyle = 'rgba(255,255,255,0.92)';
        for (const t of h.tips) {
          c.beginPath();
          c.arc(t.x, t.y, 3.4, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    }
    if (!h.present && h.kind === 'hand') return;
    const p = h.pinchPos;
    if (h.pinching) {
      c.beginPath();
      c.arc(p.x, p.y, 6, 0, Math.PI * 2);
      c.fillStyle = '#ffc478';
      c.fill();
      c.beginPath();
      c.arc(p.x, p.y, 13, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255, 196, 120, 0.55)';
      c.lineWidth = 1.5;
      c.stroke();
    } else if (h.kind === 'hand' && h.pinchAmount > 0.25) {
      const a = (h.pinchAmount - 0.25) / 0.75;
      c.beginPath();
      c.arc(p.x, p.y, 26 - 12 * a, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255, 196, 120, ${0.15 + 0.5 * a})`;
      c.lineWidth = 1.5;
      c.stroke();
    }
  }
}
