"use client";

import { useEffect, useRef, useState } from "react";
import { matchWords } from "../lib/score";

const TWISTERS: string[] = [
  "She sells sea shells by the sea shore.",
  "Peter Piper picked a peck of pickled peppers.",
  "How much wood would a woodchuck chuck if a woodchuck could chuck wood?",
  "Fuzzy Wuzzy was a bear. Fuzzy Wuzzy had no hair.",
  "Red lorry, yellow lorry, red lorry, yellow lorry.",
];

const PASS = 0.65;
const MAX_SECONDS = 15;
const CHUNK_SAMPLES = 16000;

const PHASES = {
  starting: "Starting speech engine…",
  engine: "Starting speech engine…",
  download: "Downloading the 16.9 MB speech model…",
  init: "Loading the speech model…",
};

type Phase = keyof typeof PHASES;
type Busy = "mic" | "checking" | null;
type Progress = { loaded: number; total: number };
type Result = { text: string; pct: number; pass: boolean };
type Mic = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  gain: GainNode;
};
type WorkerMessage =
  | { type: "progress"; loaded: number; total: number }
  | { type: "status"; phase: Phase }
  | { type: "ready" }
  | { type: "stream"; text: string; result: { pending?: string } }
  | { type: "stream-final"; text: string }
  | { type: "error"; message: string };

export default function Page() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [progress, setProgress] = useState<Progress>({ loaded: 0, total: 0 });
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [round, setRound] = useState(0);
  const [committed, setCommitted] = useState("");
  const [pending, setPending] = useState("");
  const [matched, setMatched] = useState<boolean[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");

  const workerRef = useRef<Worker | null>(null);
  const roundRef = useRef(0);
  const micRef = useRef<Mic | null>(null);
  const blockRef = useRef(new Float32Array(CHUNK_SAMPLES));
  const offsetRef = useRef(0);
  const recordingRef = useRef(false);
  const streamingRef = useRef(false);
  const spokenRef = useRef(false);
  const silenceRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const worker = new Worker("/speech-worker.js");
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as WorkerMessage;
      if (data.type === "progress") setProgress({ loaded: data.loaded, total: data.total });
      else if (data.type === "status") setPhase(data.phase);
      else if (data.type === "ready") setReady(true);
      else if (data.type === "stream") {
        setCommitted(data.text);
        setPending(data.result.pending || "");
      } else if (data.type === "stream-final") {
        const { matched: finalMatched, score } = matchWords(TWISTERS[roundRef.current], data.text);
        setCommitted(data.text);
        setPending("");
        setMatched((previous) =>
          score >= PASS ? finalMatched.map((value, index) => Boolean(value || previous[index])) : finalMatched,
        );
        setResult({ text: data.text, pct: Math.round(score * 100), pass: score >= PASS });
        setBusy(null);
        recordingRef.current = false;
        setRecording(false);
      } else if (data.type === "error") {
        cleanupAudio();
        streamingRef.current = false;
        setBusy(null);
        setError(data.message);
      }
    };
    worker.onerror = () => {
      cleanupAudio();
      streamingRef.current = false;
      setBusy(null);
      setError("The speech engine could not start. Reload the page to try again.");
    };

    worker.postMessage({ type: "load" });
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 200);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const heard = [committed, pending].filter(Boolean).join(" ");
    const { matched: next } = matchWords(TWISTERS[round], heard);
    if (!next.length) return;
    setMatched((previous) => next.map((value, index) => Boolean(value || previous[index])));

    const stable = matchWords(TWISTERS[round], committed).matched;
    if (stable.length && stable.every(Boolean)) stopRef.current();
  }, [committed, pending, recording, round]);

  useEffect(() => {
    if (!result?.pass) return;
    const timer = setTimeout(() => {
      setResult(null);
      setCommitted("");
      setPending("");
      setMatched([]);
      if (roundRef.current >= TWISTERS.length - 1) setFinished(true);
      else setRound((value) => value + 1);
    }, 1800);
    return () => clearTimeout(timer);
  }, [result]);

  useEffect(() => {
    stopRef.current = stopRecording;
  });

  useEffect(
    () => () => {
      cleanupAudio();
      clearStopTimer();
    },
    [],
  );

  function clearStopTimer() {
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }

  function cleanupAudio(): void {
    clearStopTimer();
    const mic = micRef.current;
    micRef.current = null;
    if (mic?.node) mic.node.port.onmessage = null;
    if (mic?.stream) mic.stream.getTracks().forEach((track) => track.stop());
    try {
      mic?.source?.disconnect();
      mic?.node?.disconnect();
      mic?.gain?.disconnect();
    } catch {}
    if (mic?.context && mic.context.state !== "closed") mic.context.close().catch(() => {});
    recordingRef.current = false;
    setRecording(false);
  }

  async function startRecording(): Promise<void> {
    if (busy || recordingRef.current) return;
    setError("");
    setResult(null);
    setCommitted("");
    setPending("");
    setMatched([]);
    setBusy("mic");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setBusy(null);
      const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser and try again."
          : "Could not access the microphone.",
      );
      return;
    }

    let context: AudioContext | undefined;
    try {
      const AudioConstructor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioConstructor) throw new Error("This browser cannot capture live audio.");
      try {
        context = new AudioConstructor({ sampleRate: 16000 });
      } catch {
        context = new AudioConstructor();
      }
      await context.resume();
      if (!context.audioWorklet) throw new Error("This browser cannot capture live audio.");

      await context.audioWorklet.addModule("/pcm-worklet.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-capture");
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);

      blockRef.current = new Float32Array(CHUNK_SAMPLES);
      offsetRef.current = 0;
      spokenRef.current = false;
      silenceRef.current = 0;
      const rate = context.sampleRate;
      node.port.onmessage = (event: MessageEvent) =>
        pushSamples(resample(event.data as Float32Array, rate));

      const worker = workerRef.current;
      if (!worker) throw new Error("The speech engine is not ready.");

      micRef.current = { stream, context, source, node, gain };
      worker.postMessage({ type: "stream-start", keywords: TWISTERS[roundRef.current] });
      streamingRef.current = true;
      recordingRef.current = true;
      setBusy(null);
      setRecording(true);
      stopTimerRef.current = setTimeout(() => stopRef.current(), MAX_SECONDS * 1000);
    } catch (err) {
      cleanupAudio();
      if (context && context.state !== "closed") context.close().catch(() => {});
      stream.getTracks().forEach((track) => track.stop());
      if (streamingRef.current) {
        streamingRef.current = false;
        workerRef.current?.postMessage({ type: "stream-stop" });
      }
      setBusy(null);
      setError(err instanceof Error ? err.message : "Could not start live audio capture.");
    }
  }

  function pushSamples(samples: Float32Array): void {
    if (!recordingRef.current) return;

    let energy = 0;
    for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / Math.max(1, samples.length));
    if (rms > 0.01) {
      spokenRef.current = true;
      silenceRef.current = 0;
    } else if (spokenRef.current) {
      silenceRef.current += samples.length / 16000;
      if (silenceRef.current >= 1.3) {
        stopRef.current();
        return;
      }
    }

    let at = 0;
    const worker = workerRef.current;
    if (!worker) return;

    while (at < samples.length) {
      const take = Math.min(CHUNK_SAMPLES - offsetRef.current, samples.length - at);
      blockRef.current.set(samples.subarray(at, at + take), offsetRef.current);
      offsetRef.current += take;
      at += take;

      if (offsetRef.current === CHUNK_SAMPLES) {
        const block = blockRef.current;
        worker.postMessage({ type: "stream-chunk", pcm: block }, [block.buffer]);
        blockRef.current = new Float32Array(CHUNK_SAMPLES);
        offsetRef.current = 0;
      }
    }
  }

  function stopRecording(): void {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearStopTimer();

    const leftover = offsetRef.current;
    const block = leftover ? blockRef.current.slice(0, leftover) : null;
    blockRef.current = new Float32Array(CHUNK_SAMPLES);
    offsetRef.current = 0;

    cleanupAudio();
    if (streamingRef.current) {
      streamingRef.current = false;
      const worker = workerRef.current;
      if (block) worker?.postMessage({ type: "stream-chunk", pcm: block }, [block.buffer]);
      worker?.postMessage({ type: "stream-stop" });
    }
    setBusy("checking");
  }

  function primary() {
    if (result) {
      if (!result.pass) startRecording();
    } else if (recordingRef.current) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function playAgain() {
    setRound(0);
    setResult(null);
    setCommitted("");
    setPending("");
    setMatched([]);
    setFinished(false);
  }

  const label =
    busy === "mic"
      ? "Waiting for microphone…"
      : busy === "checking"
        ? "Checking…"
        : recording
          ? "Stop recording"
          : result?.pass
            ? round === TWISTERS.length - 1
              ? "See results…"
              : "Next twister…"
            : result
              ? "Try again"
              : "Start recording";

  const words = TWISTERS[round].split(/\s+/);
  const filled = words.map((_, index) => Boolean(matched[index]));
  const fillPercent = Math.round((filled.filter(Boolean).length / words.length) * 100);
  const percent = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  return (
    <main className="shell">
      <header>
        <h1>Tongue Twister</h1>
        <p className="sub">
          Five twisters. Say each one out loud. The words light up as you speak, and the next one starts
          on its own. Your voice stays on your device.
        </p>
      </header>

      {!started && !finished && (
        <section className="card">
          {!ready && !error ? (
            <div className="loading" aria-live="polite">
              <p>{PHASES[phase] || PHASES.starting}</p>
              <div
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div style={{ width: `${percent}%` }} />
              </div>
              <p className="muted">
                {progress.loaded
                  ? `${(progress.loaded / 1024 / 1024).toFixed(1)} MB${
                      progress.total ? ` of ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ""
                    }`
                  : "One time download. It is cached after this."}
              </p>
            </div>
          ) : ready ? (
            <p className="ready">Speech model ready · running locally</p>
          ) : null}

          <button className="primary" onClick={() => setStarted(true)} disabled={!ready}>
            Start
          </button>
          {ready && (
            <p className="muted center">You need {PASS * 100}% of the words to pass each twister.</p>
          )}
          {!ready && !error && (
            <p className="muted center">The Start button unlocks when the model is ready.</p>
          )}
          {error && (
            <>
              <p className="error">{error}</p>
              <button className="secondary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </>
          )}
        </section>
      )}

      {started && !finished && (
        <section className="card">
          <div className="round">
            Twister {round + 1} of {TWISTERS.length}
          </div>

          <p className="twister" key={round}>
            {words.map((word, index) => (
              <span key={index}>
                <span className={filled[index] ? "word on" : "word"}>{word}</span>
                {index < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>

          <div className="fillbar" aria-hidden="true">
            <div style={{ width: `${fillPercent}%` }} />
          </div>

          <div className="mic">
            {recording && <span className="dot" aria-hidden="true" />}
            {recording ? `Listening… ${seconds}s / ${MAX_SECONDS}s` : "Tap, read the twister, tap again."}
          </div>

          {(recording || committed || pending || result) && (
            <div className="live" aria-live="polite">
              <span className="live-label">{recording ? "You're saying" : "You said"}</span>
              <p>
                {committed || pending ? (
                  <>
                    {committed}
                    {pending && (
                      <>
                        {" "}
                        <span className="pending">{pending}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="pending">{recording ? "Listening…" : "Nothing heard."}</span>
                )}
              </p>
            </div>
          )}

          <button
            className="primary"
            onClick={primary}
            disabled={Boolean(busy) || Boolean(result?.pass)}
          >
            {label}
          </button>

          {result && (
            <div className={result.pass ? "result pass" : "result fail"} aria-live="polite">
              <strong>
                {result.pass ? "Passed" : "Not quite"} · {result.pct}%
              </strong>
              <p className="muted">
                {result.pass
                  ? round === TWISTERS.length - 1
                    ? "Finishing…"
                    : "Next twister coming up…"
                  : `You need ${PASS * 100}% of the words. Try it again.`}
              </p>
            </div>
          )}

          {error && (
            <p className="error" aria-live="polite">
              {error}
            </p>
          )}
        </section>
      )}

      {finished && (
        <section className="card center">
          <p className="big">You passed all five.</p>
          <p className="muted">Speech recognition ran entirely in your browser.</p>
          <button className="primary" onClick={playAgain}>
            Play again
          </button>
        </section>
      )}
    </main>
  );
}

function resample(samples: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return samples;
  const length = Math.round((samples.length * 16000) / rate);
  const output = new Float32Array(length);
  const step = rate / 16000;
  for (let i = 0; i < length; i++) {
    const position = i * step;
    const index = Math.floor(position);
    const fraction = position - index;
    output[i] = (samples[index] ?? 0) * (1 - fraction) + (samples[index + 1] ?? 0) * fraction;
  }
  return output;
}
