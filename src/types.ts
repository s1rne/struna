export interface Vec {
  x: number;
  y: number;
}

export interface HandInput {
  id: string;
  kind: 'hand' | 'pointer';
  present: boolean;
  pinching: boolean;
  pinchPos: Vec;
  // 0: пальцы разведены, 1: сомкнуты. Для кольца-подсказки.
  pinchAmount: number;
  tips: Vec[];
  landmarks?: Vec[];
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
