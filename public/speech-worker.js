const MODEL_URL = "/whistle.cact";
const WASM_URL = "/cactus.wasm";
const OUT_CAPACITY = 1 << 18;

let engine = null;
let outPtr = 0;
let stream = null;

self.onmessage = async (event) => {
  const message = event.data;
  try {
    if (message.type === "load") await load();
    else if (message.type === "stream-start") startStream(message.keywords);
    else if (message.type === "stream-chunk") processChunk(message.pcm);
    else if (message.type === "stream-stop") stopStream();
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || String(error) });
  }
};

async function load() {
  self.postMessage({ type: "status", phase: "engine" });
  importScripts("/cactus.js");
  const wasm = await (await fetch(WASM_URL)).arrayBuffer();
  engine = await createCactus({ wasmBinary: new Uint8Array(wasm) });

  self.postMessage({ type: "status", phase: "download" });
  const model = await fetchBytes(MODEL_URL);
  self.postMessage({ type: "status", phase: "init" });

  const ptr = engine._malloc(model.length);
  engine.HEAPU8.set(model, ptr);
  const loaded = engine._cactus_load(ptr, BigInt(model.length));
  engine._free(ptr);
  if (loaded < 0) throw new Error(lastError());

  outPtr = engine._malloc(OUT_CAPACITY);
  self.postMessage({ type: "ready" });
}

function startStream(keywords) {
  if (!engine) throw new Error("The speech model is not ready yet.");
  if (stream) {
    try {
      engine._cactus_stream_transcribe_stop(outPtr, OUT_CAPACITY);
    } catch {}
    engine._free(stream.languagePtr);
    if (stream.keywordsPtr) engine._free(stream.keywordsPtr);
  }
  stream = { languagePtr: cstr("en"), keywordsPtr: cstr(keywords), text: "", chunks: 0 };
}

function processChunk(pcm) {
  if (!stream) return;

  const samplesPtr = engine._malloc(pcm.byteLength);
  engine.HEAPU8.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), samplesPtr);
  try {
    const code = engine._cactus_stream_transcribe_process(
      samplesPtr,
      pcm.length,
      stream.languagePtr,
      stream.keywordsPtr,
      outPtr,
      OUT_CAPACITY,
    );
    if (code < 0) throw new Error(lastError());

    const result = JSON.parse(engine.UTF8ToString(outPtr));
    if (result.text) stream.text = `${stream.text} ${result.text}`.trim();
    stream.chunks++;
    self.postMessage({ type: "stream", result, text: stream.text });
  } finally {
    engine._free(samplesPtr);
  }
}

function stopStream() {
  if (!stream) return;

  const current = stream;
  stream = null;
  let result = { text: "", pending: "", language: "en" };

  try {
    if (current.chunks > 0) {
      const code = engine._cactus_stream_transcribe_stop(outPtr, OUT_CAPACITY);
      if (code < 0) throw new Error(lastError());
      result = JSON.parse(engine.UTF8ToString(outPtr));
    }
  } finally {
    engine._free(current.languagePtr);
    if (current.keywordsPtr) engine._free(current.keywordsPtr);
  }

  const text = [current.text, result.text].filter(Boolean).join(" ").trim();
  self.postMessage({ type: "stream-final", text });
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the model (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - reported > 256 * 1024) {
      reported = loaded;
      self.postMessage({ type: "progress", loaded, total });
    }
  }
  self.postMessage({ type: "progress", loaded, total });

  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function cstr(text) {
  if (!text) return 0;
  const bytes = new TextEncoder().encode(text);
  const ptr = engine._malloc(bytes.length + 1);
  engine.HEAPU8.set(bytes, ptr);
  engine.HEAPU8[ptr + bytes.length] = 0;
  return ptr;
}

function lastError() {
  return engine.UTF8ToString(engine._cactus_last_error());
}
