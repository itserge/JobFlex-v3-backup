"use client";
// THE STUDIO'S EARS AND VOICE (2026-10-21).
//
// Chrome, Edge and Safari write speech down themselves (the Web Speech API): the words come in live as they are
// said (shown as they come), and each finished sentence is handed on with the recogniser's other hearings of it — the
// studio picks the one its rules read whole. Hands-free, it keeps listening sentence after sentence. Where the browser
// has no recogniser (Firefox), the microphone is recorded until the speaker stops and the recording goes to the
// server to be written down (api/deck/voice/transcribe). The studio's replies are read out in a natural voice — the
// shop's AI desk voice, made by the server (api/deck/voice/speak, 2026-10-21), the browser's own voice when that cannot
// answer — and while it talks the microphone pauses, so it never hears itself.

import * as React from "react";

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  readonly length: number;
  readonly isFinal: boolean;
  [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { readonly length: number; [i: number]: SRResult };
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

const srCtor = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type HearMode = "native" | "record" | "none";
export type MicState = "off" | "listening" | "recording" | "sending";

const noop = () => () => {};
const modeNow = (): HearMode => {
  if (typeof window === "undefined") return "none";
  if (srCtor()) return "native";
  if (typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia) return "record";
  return "none";
};

/** The voice to answer in: a natural US English one where the browser has it. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_)/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) => (/natural|neural|premium|enhanced/i.test(v.name) ? 0 : /google us english|samantha|aria|jenny|guy|alex|ava|allison/i.test(v.name) ? 1 : /en(-|_)us/i.test(v.lang) ? 2 : 3);
  return voices.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export interface SpeechHandlers {
  /** The language the ears listen in (BCP 47); the Deck Studio leaves it English, the Operator passes the phone's own. */
  lang?: string;
  /** A finished sentence: the recogniser's hearings of it, the likeliest first. */
  onFinal: (alternatives: string[]) => void;
  /** The words so far of the sentence being said. */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  /** The client's deck link: the natural voice is asked for with its token (the studio's own session otherwise). */
  token?: string | null;
  /** Where the natural voice and the server's ears are (2026-11-04: the JobFlex Assistant talks too, through its own
   *  routes, api/assistant/*). Deck Studio's own by default. */
  speakUrl?: string;
  transcribeUrl?: string;
}

export function useDeckSpeech(handlers: SpeechHandlers) {
  const mode = React.useSyncExternalStore(noop, modeNow, () => "none" as HearMode);
  const [mic, setMic] = React.useState<MicState>("off");
  const [speaking, setSpeaking] = React.useState(false);
  const h = React.useRef(handlers);
  React.useEffect(() => {
    h.current = handlers;
  });
  const rec = React.useRef<SR | null>(null);
  /** Listening is wanted (hands-free keeps it on across sentences and the replies). */
  const wanted = React.useRef(false);
  const hands = React.useRef(false);
  const talking = React.useRef(false);
  const restarts = React.useRef<number[]>([]);
  const media = React.useRef<{ stream: MediaStream; recorder: MediaRecorder; ctx: AudioContext | null; raf: number } | null>(null);
  /** The natural voice playing, the answer it belongs to (a newer one drops a late one), and whether it works here. */
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const sayRun = React.useRef(0);
  const natural = React.useRef(true);

  const startNative = React.useCallback(() => {
    const Ctor = srCtor();
    if (!Ctor) return;
    try {
      rec.current?.abort();
    } catch {
      /* already stopped */
    }
    const r = new Ctor();
    // The Operator passes the phone's own language (spec §2: Russian, mixed speech); the Deck Studio stays English.
    r.lang = handlers.lang ?? "en-US";
    r.continuous = hands.current;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.onstart = () => setMic("listening");
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < res.length; k++) if (res[k]?.transcript?.trim()) alts.push(res[k].transcript.trim());
          if (alts.length) h.current.onFinal(alts);
        } else interim += res[0]?.transcript ?? "";
      }
      h.current.onInterim(interim.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted.current = false;
        h.current.onError("The microphone is blocked — allow it from the lock icon in the address bar, then tap the mic again.");
      } else if (e.error === "network") {
        wanted.current = false;
        h.current.onError("Speech needs the internet in this browser — type it instead.");
      } else if (e.error === "audio-capture") {
        wanted.current = false;
        h.current.onError("No microphone was found.");
      }
      // "no-speech" and "aborted" are quiet: hands-free starts again on its own.
    };
    r.onend = () => {
      h.current.onInterim("");
      // Hands-free listens on after a pause — unless it keeps ending at once (then it stops, rather than spin).
      if (wanted.current && hands.current && !talking.current) {
        const now = Date.now();
        restarts.current = [...restarts.current.filter((t) => now - t < 4000), now];
        if (restarts.current.length < 5) {
          try {
            r.start();
            return;
          } catch {
            /* fall through: stopped */
          }
        }
      }
      if (!talking.current) {
        wanted.current = false;
        setMic("off");
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      setMic("off");
    }
  }, [handlers.lang]);

  const stopRecording = React.useCallback((send: boolean) => {
    const m = media.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    if (!send) m.recorder.ondataavailable = null;
    if (m.recorder.state !== "inactive") m.recorder.stop();
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx?.close().catch(() => undefined);
    media.current = null;
  }, []);

  const startRecording = React.useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      wanted.current = false;
      h.current.onError("The microphone is blocked — allow it in the browser, then tap the mic again.");
      setMic("off");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      if (!chunks.length) {
        setMic("off");
        return;
      }
      setMic("sending");
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        const res = await fetch(h.current.transcribeUrl ?? "/api/deck/voice/transcribe", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) h.current.onError(body.error ?? "Couldn't write that down.");
        else if (body.text) h.current.onFinal([body.text]);
      } catch {
        h.current.onError("Couldn't reach the server to write that down.");
      } finally {
        setMic("off");
        if (wanted.current && hands.current && !talking.current) void startRecordingRef.current?.();
      }
    };
    // Stop on a pause: 1.3 s quiet after speech, or 12 s in all.
    let ctx: AudioContext | null = null;
    let raf = 0;
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const t0 = performance.now();
      let spoke = false;
      let quietSince = 0;
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
        const now = performance.now();
        if (rms > 0.03) {
          spoke = true;
          quietSince = 0;
        } else if (spoke && !quietSince) quietSince = now;
        if ((spoke && quietSince && now - quietSince > 1300) || now - t0 > 12000) {
          stopRecording(true);
          return;
        }
        raf = requestAnimationFrame(tick);
        if (media.current) media.current.raf = raf;
      };
      raf = requestAnimationFrame(tick);
    } catch {
      ctx = null;
    }
    media.current = { stream, recorder, ctx, raf };
    recorder.start();
    setMic("recording");
  }, [stopRecording]);
  const startRecordingRef = React.useRef<(() => Promise<void>) | null>(null);
  React.useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  /** Start listening; hands-free keeps listening, sentence after sentence. */
  const start = React.useCallback(
    (handsFree: boolean) => {
      wanted.current = true;
      hands.current = handsFree;
      restarts.current = [];
      if (mode === "native") startNative();
      else if (mode === "record") void startRecording();
    },
    [mode, startNative, startRecording],
  );

  const stop = React.useCallback(() => {
    wanted.current = false;
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
    stopRecording(true);
    setMic((m) => (m === "sending" ? m : "off"));
  }, [stopRecording]);

  /** Read a reply out — the natural voice, else the browser's; the microphone pauses for it and comes back after. */
  const say = React.useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !text.trim()) return;
      const run = ++sayRun.current;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audio.current) {
        audio.current.pause();
        audio.current = null;
      }
      const listening = wanted.current;
      talking.current = true;
      setSpeaking(true);
      if (listening && mode === "native") {
        try {
          rec.current?.abort();
        } catch {
          /* not listening */
        }
      }
      if (listening && mode === "record") stopRecording(false);
      let finished = false;
      const done = () => {
        if (finished || run !== sayRun.current) return;
        finished = true;
        talking.current = false;
        setSpeaking(false);
        if (wanted.current && hands.current) {
          if (mode === "native") startNative();
          else if (mode === "record") void startRecording();
        } else if (wanted.current && mode === "native") setMic("off");
      };
      const browserVoice = () => {
        if (run !== sayRun.current) return;
        if (!("speechSynthesis" in window)) return done();
        const synth = window.speechSynthesis;
        const u = new SpeechSynthesisUtterance(text.replace(/\bft\b/g, "feet").replace(/\bin\.(?=\s|$)/g, "inches").replace(/\bsq ft\b/g, "square feet").replace(/(\d)\/12\b/g, "$1 in 12").replace(/\bpsf\b/g, "pounds per square foot").replace(/×/g, " by ").replace(/\s*—\s*/g, ", ").replace(/\s+,/g, ","));
        const v = pickVoice();
        if (v) u.voice = v;
        u.lang = v?.lang ?? "en-US";
        u.rate = 1.04;
        u.onend = done;
        u.onerror = done;
        synth.speak(u);
      };
      if (!natural.current) return browserVoice();
      void fetch(h.current.speakUrl ?? "/api/deck/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, token: h.current.token ?? null }) })
        .then(async (res) => {
          if (!res.ok) {
            // Not set up, not allowed here: the browser's voice for the rest of the visit.
            if (res.status === 403 || res.status === 503) natural.current = false;
            throw new Error(String(res.status));
          }
          return res.blob();
        })
        .then((blob) => {
          if (run !== sayRun.current) return;
          const url = URL.createObjectURL(blob);
          const a = new Audio(url);
          audio.current = a;
          const end = () => {
            URL.revokeObjectURL(url);
            if (audio.current === a) audio.current = null;
            done();
          };
          a.onended = end;
          a.onerror = () => {
            URL.revokeObjectURL(url);
            browserVoice();
          };
          void a.play().catch(() => {
            URL.revokeObjectURL(url);
            browserVoice();
          });
        })
        .catch(() => browserVoice());
    },
    [mode, startNative, startRecording, stopRecording],
  );

  const hush = React.useCallback(() => {
    sayRun.current++;
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    talking.current = false;
    setSpeaking(false);
  }, []);

  // Voices load late in Chrome; asking once wakes them. Everything stops when the panel goes.
  React.useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    const runs = sayRun;
    const playing = audio;
    return () => {
      wanted.current = false;
      try {
        rec.current?.abort();
      } catch {
        /* gone */
      }
      stopRecording(false);
      runs.current++;
      playing.current?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [stopRecording]);

  return { mode, mic, speaking, start, stop, say, hush };
}
