// Фильтр One Euro: сильно гасит дрожание в покое и почти не запаздывает на быстрых движениях.
export class OneEuro {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private minCutoff = 1.4,
    private beta = 0.012,
    private dCutoff = 1.0,
  ) {}

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(v: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = v;
      return v;
    }
    const ad = alpha(this.dCutoff, dt);
    this.dx = ad * ((v - this.x) / dt) + (1 - ad) * this.dx;
    const a = alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = a * v + (1 - a) * this.x;
    return this.x;
  }
}

function alpha(cutoff: number, dt: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
