# Tongue Twister

Five tongue twisters, read out loud. Words light up in the twister as you say them, and the app moves to the next twister automatically when you pass. Speech recognition runs on your machine: no audio is uploaded and no API key is needed.

## Run

```sh
bun install
bun dev
```

Open http://localhost:3000. The first load downloads the 16.9 MB Whistle model and caches it. Allow microphone access when prompted. Live audio capture uses AudioWorklet, so use a modern browser and HTTPS (or localhost).

## Test

```sh
bun test
```

## How it works

- `public/speech-worker.js` runs Cactus's WebAssembly engine in a Web Worker.
- It loads `public/cactus.js` and `public/cactus.wasm` (the engine), then `public/whistle.cact` (the Whistle speech-to-text weights).
- `public/pcm-worklet.js` captures the microphone as raw audio, resampled to 16 kHz mono, and the page sends one-second chunks to the worker.
- The worker uses Whistle's streaming transcription API, so committed words appear and fill the twister while you speak.
- `lib/score.js` compares the transcript to the twister word by word, allowing near-misses. 65% of the words passes and auto-advances; hearing every word stops the recording early.
- The current twister is passed to Whistle as a keyword hint, which keeps words like "woodchuck" and "lorry" from drifting. The live text is still the model's transcript of what it heard.

Everything is static except the Next.js server shell, so it can be deployed to Vercel or any host that serves the files in `public/` over HTTPS. Keep the model files in `public/`: they are deliberately served locally so the app has no runtime dependency on Hugging Face.

## Credits

[Whistle](https://cactuscompute.com/blog/whistle) and the Cactus runtime are by Cactus Compute, Apache-2.0.
