import { AudioEngine } from './audio/engine';
import { PRESETS, SAMPLE_ID } from './audio/presets';
import { Controller } from './interaction/controller';
import { PointerInput } from './input/pointer';
import { StringSet, type Str, type Tuning } from './model/strings';
import { midiToFreq, midiToLength, NOTE_NAMES, noteName, SCALES } from './music/notes';
import { hueOf, Renderer, type Ripple, type VideoFit } from './render/renderer';
import type { HandInput, Vec } from './types';
import { HandTracker } from './vision/tracker';

const STORE = 'struna.v1';

interface Saved {
  strings: number[][];
  mode: string;
  key: number;
  scale: string;
  showVideo: boolean;
  muted: boolean;
  tips: string[];
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const saved: Saved = {
  strings: [],
  mode: PRESETS[0].id,
  key: 0,
  scale: SCALES[0].id,
  showVideo: true,
  muted: false,
  tips: [],
  ...readStore(),
};

let W = window.innerWidth;
let H = window.innerHeight;

const canvas = $<HTMLCanvasElement>('#stage');
const renderer = new Renderer(canvas);
const strings = new StringSet(() => ({ w: W, h: H }));
const engine = new AudioEngine();
const tracker = new HandTracker();
const ripples: Ripple[] = [];

let tuning: Tuning = { scale: SCALES.find((s) => s.id === saved.scale) ?? SCALES[0], key: saved.key };
let cameraOn = false;
let audioReady = false;
let undo: { a: Vec; b: Vec }[] | null = null;
const lastTick = new Map<number, number>();

const ctrl = new Controller(strings, () => tuning, {
  pluck(s, vel, pos, at, delayMs) {
    const play = () => engine.pluck(s.voice, freqOf(s), vel, pos, panOf(s));
    delayMs > 1 ? setTimeout(play, delayMs) : play();
    ripples.push({ at, t0: performance.now() + delayMs, hue: hueOf(s.midi + engine.transpose), vel });
    tip('played');
  },
  damp(s) {
    engine.damp(s.voice);
  },
  retune(s, noteChanged) {
    engine.retune(s.voice, freqOf(s));
    // Тихий щипок на каждой новой ноте, но не чаще 110 мс: при быстром растяжении не трещит.
    const now = performance.now();
    if (noteChanged && now - (lastTick.get(s.id) ?? 0) > 110) {
      lastTick.set(s.id, now);
      engine.pluck(s.voice, freqOf(s), 0.14, 0.3, panOf(s));
    }
  },
  created(s) {
    engine.pluck(s.voice, freqOf(s), 0.42, 0.4, panOf(s));
    tip('created');
    persist();
  },
  removed(s, reason) {
    engine.stop(s.voice);
    undo = [{ a: { ...s.a }, b: { ...s.b } }];
    toast(reason === 'trash' ? 'Струна убрана' : 'Струна сжата и убрана', 'Вернуть', restoreUndo);
    persist();
  },
  full() {
    toast('Больше 32 струн не поместится');
  },
});

const pointer = new PointerInput(canvas, (p) => ctrl.isGrabbable(p));

const freqOf = (s: Str) => midiToFreq(s.midi + engine.transpose);
const panOf = (s: Str) => (((s.a.x + s.b.x) / 2 / W) * 2 - 1) * 0.7;

function readStore(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    saved.strings = strings.serialize();
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* приватный режим: работаем без сохранения */
    }
  }, 300);
}

function restoreUndo() {
  if (!undo) return;
  const now = performance.now();
  for (const u of undo) strings.add(u.a, u.b, tuning, now);
  undo = null;
  hideToast();
  persist();
}

// ---------- Подсказки ----------

const hintEl = $('#hint');
let hintText = '';

function tip(done: string) {
  if (!saved.tips.includes(done)) {
    saved.tips.push(done);
    persist();
  }
}

function currentHint(): string {
  const t = saved.tips;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!strings.alive.length) {
    if (cameraOn) return 'Сомкните большой и указательный пальцы обеих рук и разведите руки';
    return touch ? 'Подержите палец на экране и протяните линию' : 'Зажмите кнопку мыши и протяните линию';
  }
  if (!t.includes('played')) return cameraOn ? 'Проведите пальцем сквозь струну' : 'Проведите курсором сквозь струну';
  if (!t.includes('resized')) return cameraOn ? 'Возьмите щипком за край струны и тяните: нота меняется' : 'Потяните струну за край: нота меняется';
  if (!t.includes('moved')) return cameraOn ? 'Щипок за середину переносит струну, крестик вверху убирает' : 'Струну за середину можно перенести, к крестику вверху выбросить';
  return '';
}

function updateHint() {
  const text = introOpen ? '' : currentHint();
  if (text === hintText) return;
  hintText = text;
  hintEl.classList.remove('show');
  if (text) {
    setTimeout(() => {
      if (hintText !== text) return;
      hintEl.textContent = text;
      hintEl.classList.add('show');
    }, 250);
  }
}

// ---------- Тост ----------

const toastEl = $('#toast');
let toastTimer = 0;
let toastAction: (() => void) | null = null;

function toast(text: string, action = '', fn: (() => void) | null = null) {
  toastEl.querySelector('span')!.textContent = text;
  toastEl.querySelector('button')!.textContent = action;
  toastAction = fn;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, action ? 5000 : 2600);
}

function hideToast() {
  toastEl.classList.remove('show');
  toastAction = null;
}

toastEl.querySelector('button')!.addEventListener('click', () => toastAction?.());

// ---------- Панель ----------

const instrumentsEl = $('#instruments');
const fileInput = $<HTMLInputElement>('#file');

function buildDock() {
  const items = [...PRESETS.map((p) => ({ id: p.id, name: p.name, hint: p.hint })), { id: SAMPLE_ID, name: 'Свой звук', hint: 'Загрузить аудиофайл' }];
  instrumentsEl.innerHTML = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'radio';
    b.dataset.id = it.id;
    b.title = `${it.hint} (${i + 1})`;
    b.textContent = it.name;
    b.addEventListener('click', () => chooseInstrument(it.id, true));
    instrumentsEl.append(b);
  });

  const keySel = $<HTMLSelectElement>('#key');
  keySel.innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  keySel.value = String(tuning.key);
  keySel.addEventListener('change', () => setTuning({ ...tuning, key: +keySel.value }));

  const scaleSel = $<HTMLSelectElement>('#scale');
  scaleSel.innerHTML = SCALES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  scaleSel.value = tuning.scale.id;
  scaleSel.addEventListener('change', () => setTuning({ ...tuning, scale: SCALES.find((s) => s.id === scaleSel.value)! }));

  $('#btn-layout').addEventListener('click', layoutSet);
  $('#btn-clear').addEventListener('click', clearAll);
  syncDock();
}

function syncDock() {
  for (const b of instrumentsEl.querySelectorAll<HTMLButtonElement>('button')) {
    const on = b.dataset.id === engine.mode;
    b.setAttribute('aria-checked', String(on));
    if (b.dataset.id === SAMPLE_ID) {
      b.innerHTML = 'Свой звук';
      if (engine.sample) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = engine.sample.name;
        b.append(sub);
      }
    }
  }
  $('#key').closest('label')!.toggleAttribute('hidden', tuning.scale.steps === null);
}

function chooseInstrument(id: string, fromClick = false) {
  if (!audioReady) return;
  if (id === SAMPLE_ID && (!engine.sample || (fromClick && engine.mode === SAMPLE_ID))) {
    fileInput.click();
    return;
  }
  engine.setMode(id);
  saved.mode = id;
  for (const s of strings.alive) engine.stop(s.voice);
  syncDock();
  persist();
  const s = strings.alive[Math.floor(strings.alive.length / 2)];
  if (s) engine.pluck(s.voice, freqOf(s), 0.45, 0.35, panOf(s));
}

async function useSampleFile(file: File) {
  if (!audioReady) return;
  try {
    const smp = await engine.loadSampleFile(file);
    const n = noteName(69 + 12 * Math.log2(smp.rootFreq / 440));
    engine.setMode(SAMPLE_ID);
    saved.mode = SAMPLE_ID;
    syncDock();
    toast(`«${smp.name}»: исходная нота ${n.name}${n.octave}`);
  } catch {
    toast('Не удалось прочитать этот файл как звук');
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void useSampleFile(f);
  fileInput.value = '';
});

function setTuning(t: Tuning) {
  tuning = t;
  saved.key = t.key;
  saved.scale = t.scale.id;
  strings.retuneAll(tuning);
  syncDock();
  persist();
}

function layoutSet() {
  const steps = tuning.scale.steps ?? SCALES[1].steps!;
  const base = 48 + tuning.key;
  const notes = steps.map((s) => base + s).concat(base + 12).slice(0, 8);
  if (strings.alive.length) {
    undo = strings.alive.map((s) => ({ a: { ...s.a }, b: { ...s.b } }));
    for (const s of strings.alive) {
      engine.stop(s.voice);
      strings.kill(s, performance.now());
    }
  }
  // В портрете струны встают вертикально, иначе длинные не влезают и теряют ноту.
  const diag = Math.hypot(W, H);
  const portrait = H > W * 1.1;
  const span = portrait ? [W * 0.12, W * 0.88] : [H * 0.2, H * 0.72];
  const maxLen = portrait ? H * 0.7 : W * 0.92;
  const mid = portrait ? H * 0.47 : W / 2;
  const now = performance.now();
  notes.forEach((m, i) => {
    const len = Math.min(maxLen, midiToLength(m) * diag);
    const k = i / Math.max(1, notes.length - 1);
    const a = portrait ? { x: span[0] + (span[1] - span[0]) * k, y: mid + len / 2 } : { x: mid - len / 2, y: span[1] - (span[1] - span[0]) * k };
    const b = portrait ? { x: a.x, y: mid - len / 2 } : { x: mid + len / 2, y: a.y };
    const s = strings.add(a, b, tuning, now + i * 40);
    if (s) setTimeout(() => engine.pluck(s.voice, freqOf(s), 0.35, 0.4, panOf(s)), 260 + i * 70);
  });
  persist();
}

function clearAll() {
  if (!strings.alive.length) return;
  undo = strings.alive.map((s) => ({ a: { ...s.a }, b: { ...s.b } }));
  const now = performance.now();
  for (const s of strings.alive) {
    engine.stop(s.voice);
    strings.kill(s, now);
  }
  toast('Все струны убраны', 'Вернуть', restoreUndo);
  persist();
}

// ---------- Верхние кнопки ----------

const videoBtn = $('#btn-video');
const muteBtn = $('#btn-mute');

function syncTop() {
  videoBtn.setAttribute('aria-pressed', String(saved.showVideo));
  videoBtn.hidden = !cameraOn;
  muteBtn.setAttribute('aria-pressed', String(saved.muted));
}

videoBtn.addEventListener('click', () => {
  saved.showVideo = !saved.showVideo;
  syncTop();
  persist();
});

muteBtn.addEventListener('click', () => {
  saved.muted = !saved.muted;
  if (audioReady) engine.setMuted(saved.muted);
  syncTop();
  persist();
});

const helpEl = $('#help');
const toggleHelp = (open = helpEl.hidden) => {
  helpEl.hidden = !open;
};
$('#btn-help').addEventListener('click', () => toggleHelp(true));
$('#btn-help-close').addEventListener('click', () => toggleHelp(false));
helpEl.addEventListener('click', (e) => e.target === helpEl && toggleHelp(false));

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    restoreUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= PRESETS.length + 1) chooseInstrument(n <= PRESETS.length ? PRESETS[n - 1].id : SAMPLE_ID);
  const k = e.code;
  if (k === 'KeyM') muteBtn.click();
  else if (k === 'KeyV' && cameraOn) videoBtn.click();
  else if (k === 'KeyH' || e.key === '?') toggleHelp();
  else if (k === 'Escape') toggleHelp(false);
});

// ---------- Перетаскивание файла ----------

const dropEl = $('#drop');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropEl.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropEl.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f && (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac|aiff?)$/i.test(f.name))) void useSampleFile(f);
  else if (f) toast('Нужен аудиофайл: wav, mp3, ogg, flac, m4a');
});

// ---------- Старт ----------

const introEl = $('#intro');
const startBtn = $<HTMLButtonElement>('#btn-start');
const introNote = $('#intro-note');
let introOpen = true;

async function startAudio() {
  if (audioReady) {
    engine.resume();
    return;
  }
  await engine.init();
  audioReady = true;
  engine.setMode(saved.mode === SAMPLE_ID ? PRESETS[0].id : saved.mode);
  engine.setMuted(saved.muted);
  engine.resume();
  syncDock();
}

function closeIntro() {
  introOpen = false;
  introEl.classList.add('leaving');
  setTimeout(() => (introEl.hidden = true), 380);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startBtn.textContent = 'Загружаю модель рук…';
  introNote.classList.remove('error');
  try {
    const audio = startAudio();
    await tracker.init();
    startBtn.textContent = 'Жду разрешение камеры…';
    await tracker.startCamera();
    await audio;
    cameraOn = true;
    syncTop();
    closeIntro();
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = 'Попробовать снова';
    const name = (err as Error)?.name;
    introNote.classList.add('error');
    introNote.textContent =
      name === 'NotAllowedError'
        ? 'Доступ к камере запрещен. Разрешите его в настройках сайта или играйте мышью.'
        : name === 'NotFoundError'
          ? 'Камера не найдена. Можно играть мышью или касаниями.'
          : 'Не удалось запустить камеру или модель. Можно играть мышью.';
  }
});

$('#btn-mouse').addEventListener('click', async () => {
  await startAudio();
  syncTop();
  closeIntro();
});

// ---------- Кадр ----------

function videoFit(): VideoFit | null {
  const v = tracker.video;
  if (!v.videoWidth) return null;
  const scale = Math.max(W / v.videoWidth, H / v.videoHeight);
  return { scale, ox: (W - v.videoWidth * scale) / 2, oy: (H - v.videoHeight * scale) / 2 };
}

function resize() {
  const nw = window.innerWidth;
  const nh = window.innerHeight;
  if (W && H && (nw !== W || nh !== H)) strings.rescale(nw / W, nh / H);
  W = nw;
  H = nh;
  renderer.resize(W, H);
  ctrl.setTrashPos({ x: W / 2, y: Math.max(76, H * 0.1) });
}

window.addEventListener('resize', () => {
  resize();
  strings.retuneAll(tuning);
  persist();
});

resize();
strings.restore(saved.strings, tuning, -1000);
buildDock();
syncTop();

// После клика мышью кнопка не держит фокус, иначе клавиши 1–6 подсвечивают ее рамкой.
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b && e.detail > 0) b.blur();
});

let last = performance.now();
let lastSerialized = '';
let wasGrabbing = new Set<number>();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const fit = videoFit();
  const inputs: HandInput[] = [];
  if (cameraOn && fit) {
    const v = tracker.video;
    const map = (x: number, y: number) => ({ x: W - (fit.ox + x * v.videoWidth * fit.scale), y: fit.oy + y * v.videoHeight * fit.scale });
    inputs.push(...tracker.update(now, map));
  }
  if (!introOpen) inputs.push(...pointer.update(now));

  ctrl.update(now, dt, inputs);
  trackGrabTips();
  if (audioReady) engine.updateEnv();
  strings.sweep(now);
  while (ripples.length && now - ripples[0].t0 > 600) ripples.shift();

  renderer.draw(
    {
      now,
      strings,
      ctrl,
      hands: inputs,
      env: engine.env,
      ripples,
      transpose: audioReady ? engine.transpose : 0,
      video: cameraOn ? tracker.video : null,
      fit,
      showVideo: saved.showVideo,
    },
    dt,
  );

  canvas.style.cursor = strings.alive.some((s) => s.held) ? 'grabbing' : ctrl.hovers.length ? 'grab' : 'default';
  updateHint();
}

// Отмечаем освоенные жесты и сохраняем струны после того, как их отпустили.
function trackGrabTips() {
  const held = new Set(strings.alive.filter((s) => s.held).map((s) => s.id));
  if (held.size !== wasGrabbing.size || [...held].some((id) => !wasGrabbing.has(id))) {
    if (ctrl.trash.visible) tip('moved');
    else if (held.size && strings.alive.some((s) => s.held && saved.tips.includes('created') && performance.now() - s.born > 1500)) tip('resized');
    if (!held.size) {
      const ser = JSON.stringify(strings.serialize());
      if (ser !== lastSerialized) {
        lastSerialized = ser;
        persist();
      }
    }
  }
  wasGrabbing = held;
}

requestAnimationFrame(frame);
