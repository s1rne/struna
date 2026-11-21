import { dist, type HandInput, type Vec } from '../types';

const LONG_PRESS_MS = 320;

interface PointerState {
  id: number;
  type: string;
  pos: Vec;
  down: boolean;
  pinching: boolean;
  downAt: number;
  downPos: Vec;
  hover: boolean;
}

// Мышь и касания как «виртуальные руки». Мышь: наведение играет, зажатие хватает.
// Касание: провести играет; зажать на краю струны или подержать на месте хватает.
export class PointerInput {
  private pointers = new Map<number, PointerState>();

  constructor(
    el: HTMLElement,
    private grabbable: (p: Vec) => boolean,
  ) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const pos = { x: e.clientX, y: e.clientY };
      const touch = e.pointerType !== 'mouse';
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        type: e.pointerType,
        pos,
        down: true,
        pinching: !touch || this.grabbable(pos),
        downAt: performance.now(),
        downPos: pos,
        hover: true,
      });
    });
    el.addEventListener('pointermove', (e) => {
      let p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType !== 'mouse') return;
        p = { id: e.pointerId, type: e.pointerType, pos: { x: 0, y: 0 }, down: false, pinching: false, downAt: 0, downPos: { x: 0, y: 0 }, hover: true };
        this.pointers.set(e.pointerId, p);
      }
      p.pos = { x: e.clientX, y: e.clientY };
      p.hover = true;
    });
    const up = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (e.pointerType === 'mouse') {
        p.down = false;
        p.pinching = false;
      } else this.pointers.delete(e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && e.pointerType === 'mouse' && !p.down) p.hover = false;
    });
  }

  update(now: number): HandInput[] {
    const out: HandInput[] = [];
    for (const p of this.pointers.values()) {
      if (p.down && !p.pinching && p.type !== 'mouse' && now - p.downAt > LONG_PRESS_MS && dist(p.pos, p.downPos) < 12) {
        p.pinching = true;
      }
      out.push({
        id: 'p' + p.id,
        kind: 'pointer',
        present: p.hover,
        pinching: p.pinching,
        pinchPos: p.pos,
        pinchAmount: p.pinching ? 1 : 0,
        tips: [p.pos],
      });
    }
    return out;
  }
}
