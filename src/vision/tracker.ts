import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { dist, type HandInput, type Vec } from '../types';
import { OneEuro } from './oneEuro';

const TIPS = [4, 8, 12, 16, 20];
const PINCH_ON = 0.3;
const PINCH_OFF = 0.45;
const LOST_GRACE_MS = 220;

interface Track {
  id: string;
  fx: OneEuro[];
  fy: OneEuro[];
  pts: Vec[];
  raw: Vec[];
  pinching: boolean;
  pinchAmount: number;
  seenAt: number;
  present: boolean;
}

export type ScreenMap = (x: number, y: number) => Vec;

export class HandTracker {
  readonly video: HTMLVideoElement;
  private landmarker!: HandLandmarker;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;
  private lastTs = 0;
  private tracks: Track[] = [];
  private nextId = 0;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async init() {
    const base = new URL('.', document.baseURI).href;
    const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + 'models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await make('GPU');
    } catch {
      this.landmarker = await make('CPU');
    }
  }

  async startCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  get ready() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  // Возвращает руки в экранных координатах. Детекция идет только на новых кадрах камеры.
  update(now: number, map: ScreenMap): HandInput[] {
    if (this.ready && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const ts = Math.max(now, this.lastTs + 1);
      const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 1 / 30;
      this.lastTs = ts;
      const res = this.landmarker.detectForVideo(this.video, ts);
      this.ingest(res.landmarks, now, dt, map);
    }
    this.tracks = this.tracks.filter((t) => now - t.seenAt < LOST_GRACE_MS);
    return this.tracks.map((t) => ({
      id: t.id,
      kind: 'hand',
      present: t.present,
      pinching: t.pinching,
      pinchPos: mid(t.pts[4], t.pts[8]),
      pinchAmount: t.pinchAmount,
      tips: TIPS.map((i) => t.pts[i]),
      landmarks: t.pts,
    }));
  }

  private ingest(hands: NormalizedLandmark[][], now: number, dt: number, map: ScreenMap) {
    for (const t of this.tracks) t.present = false;
    const free = new Set(this.tracks);
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    for (const lm of hands) {
      const raw = lm.map((p) => map(p.x, p.y));
      // Сопоставление с прошлыми руками по запястью: метки left/right у модели скачут.
      let best: Track | null = null;
      let bestD = Infinity;
      for (const t of free) {
        const d = dist(t.raw[0], raw[0]) + dist(t.raw[9], raw[9]);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      const handSize = dist(raw[0], raw[9]);
      if (!best || bestD > handSize * 3) {
        best = {
          id: 'h' + this.nextId++,
          fx: raw.map(() => new OneEuro()),
          fy: raw.map(() => new OneEuro()),
          pts: raw,
          raw,
          pinching: false,
          pinchAmount: 0,
          seenAt: now,
          present: true,
        };
        this.tracks.push(best);
      }
      free.delete(best);
      const t = best;
      t.raw = raw;
      t.pts = raw.map((p, i) => ({ x: t.fx[i].filter(p.x, dt), y: t.fy[i].filter(p.y, dt) }));
      t.seenAt = now;
      t.present = true;

      // Щипок меряется в 3D относительно размера ладони, поэтому не зависит от дистанции до камеры.
      const p3 = (i: number) => ({ x: lm[i].x * vw, y: lm[i].y * vh, z: lm[i].z * vw });
      const d3 = (a: number, b: number) => {
        const A = p3(a);
        const B = p3(b);
        return Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      };
      const ratio = d3(4, 8) / Math.max(1e-6, d3(0, 5));
      t.pinching = t.pinching ? ratio < PINCH_OFF : ratio < PINCH_ON;
      t.pinchAmount = Math.min(1, Math.max(0, (0.9 - ratio) / (0.9 - PINCH_ON)));
    }
  }
}

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const HAND_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
