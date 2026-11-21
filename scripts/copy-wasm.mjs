import { cpSync, mkdirSync } from 'node:fs';

const from = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const to = new URL('../public/wasm/', import.meta.url);
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
