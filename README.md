# Struna

**English** · [Русский](README.ru.md)

Strings in the air in front of your webcam. Stretch a string between your hands, pinch its end to change the note, and run a finger through it to make it sound.

Demo: https://s1rne.github.io/struna/

## Running

```sh
npm install
npm run dev        # http://localhost:5190
npm run build      # static build in dist/
```

The camera only works on `localhost` or over HTTPS. Without a camera you can play with a mouse or touch.

## Gestures

| Action | Camera | Mouse |
|---|---|---|
| Create a string | pinch with both hands in empty space and pull them apart, or pinch with one hand and drag | press and drag |
| Play | move a finger through the string | move the cursor through it |
| Change the note | pinch an end and pull | drag an end |
| Move | pinch the middle | drag the middle |
| Remove | carry it to the cross at the top, or squeeze it shorter than 60 px | same |

Keys: `1`–`6` instrument, `M` sound, `V` camera, `H` help, `⌘Z` restore a removed string.

The interface is in Russian.

## How it works

- **Hands.** MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`) with the model in `public/models/hand_landmarker.task`, GPU first, CPU as fallback. Landmarks are smoothed with a One Euro filter. A pinch is measured in 3D relative to palm size, with hysteresis.
- **Plucking.** A finger that crosses a string slowly drags it along and lets go after 14–40 px. A fast crossing sounds at once. When several strings are crossed in one frame, each is delayed by its crossing moment, so a strum does not collapse into a block chord.
- **Pitch.** String length relative to the screen diagonal: half as long is an octave higher, 0.8 of the diagonal is E2. The note snaps to the selected scale. Stretching a ringing string bends its pitch smoothly.
- **Sound.** An AudioWorklet running extended Karplus-Strong synthesis: a triangular pluck shape mixed with noise, a comb filter at the pluck position, and Hermite interpolation for smooth retuning. After that come body resonances on biquad filters, reverb on a generated impulse response, and a compressor. "Свой звук" (your own sound) plays an uploaded file, resampled per string; its root note is found by autocorrelation.

```
src/
  audio/        engine, string worklet, presets, sample loading
  vision/       hand tracker, One Euro filter
  input/        mouse and touch as virtual hands
  interaction/  gestures: grab, stretch, pluck
  model/        strings, geometry, persistence
  music/        notes and scales
  render/       canvas rendering
```
