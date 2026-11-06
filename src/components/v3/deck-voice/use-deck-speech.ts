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
//
// FOUR WAYS OF LISTENING (2026-11-06, the owner's phone test of the AI Operator):
//   once — a tap: one sentence, handed on as soon as it is finished (the Deck Studio's tap).
//   free — hands-free, sentence by sentence as they finish (the Deck Studio's hands-free).
//   hold — the finger is down: everything said is kept, through the pauses and through the recogniser's own stops
//          (iPhone Safari ends a session after a quiet moment; it is started again at once), and handed on as ONE
//          request when the finger lifts (stop). A slide off (cancel) throws it away.
//   live — a conversation: the pieces of a sentence are joined and handed on after a short pause, the reply is read
//          out with the microphone paused, and it listens again on its own after every reply, until it is ended —
//          when the recogniser keeps stopping at once it waits a little and tries again, never giving up by itself.
//
// ON A PHONE (2026-11-06): iPhone Safari plays sound only from an element the person's own tap or hold started, and
// the replies arrive later, from the server, outside any gesture — so the first tap or hold plays a moment of silence
// through the one element every reply then plays through (unlockVoice, called by start() and by the dial buttons);
// the browser's own voice is woken the same way. The ears listen for the language the person set (the Operator's
// Settings), English unless they picked another. A reply can stream (the Operator's route answers a GET as the audio
// is made): the element starts playing after the first moments instead of after the whole sentence is made.

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

/** The one element every reply plays through (see the head of the file). */
let player: HTMLAudioElement | null = null;
let silence: string | null = null;

/** 60 ms of silence as a WAV, made here rather than carried as a data URL. */
function silentClip(): string {
  if (silence) return silence;
  const n = 480;
  const b = new ArrayBuffer(44 + n * 2);
  const v = new DataView(b);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  silence = URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  return silence;
}

/** Call from the person's own tap or hold (a pointer or click handler): afterwards a reply that arrives later may
 *  play. Harmless anywhere else, and while a reply is playing it leaves it alone. */
export function unlockVoice(): void {
  if (typeof window === "undefined") return;
  try {
    if (!player) {
      player = new Audio();
      player.preload = "auto";
      (player as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    }
    if (!player.paused && !player.ended) return;
    player.src = silentClip();
    void player.play().catch(() => undefined);
    if ("speechSynthesis" in window && !window.speechSynthesis.speaking) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* no audio here */
  }
}

export type HearMode = "native" | "record" | "none";
export type MicState = "off" | "listening" | "recording" | "sending";
/** How it listens (see the head of the file); `true` is free, `false` is once, as the Deck Studio has always said it. */
export type HearHow = "once" | "free" | "hold" | "live";

/** Live: a sentence is handed on this long after its last piece. */
const LIVE_PAUSE_MS = 700;
/** Hold: the finger lifted but the recogniser never said it ended — hand on what was heard anyway. */
const END_GRACE_MS = 1500;
/** Record mode: stop on this much quiet after speech, or at this length — hold records until the finger lifts. */
const QUIET_MS = 1300;
const RECORD_MAX_MS = 12_000;
const HOLD_RECORD_MAX_MS = 45_000;

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
  /** The language the ears listen in (BCP 47); the Deck Studio leaves it English, the Operator passes the person's
   *  setting. The server's ears (record mode) get its first two letters. */
  lang?: string;
  /** A finished sentence: the recogniser's hearings of it, the likeliest first (hold and live hand on one text). */
  onFinal: (alternatives: string[]) => void;
  /** The words so far of the sentence being said (hold and live: everything heard so far). */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  /** Hold: the finger lifted and nothing had been heard. */
  onNothing?: () => void;
  /** The client's deck link: the natural voice is asked for with its token (the studio's own session otherwise). */
  token?: string | null;
  /** Where the natural voice and the server's ears are (2026-11-04: the JobFlex Assistant talks too, through its own
   *  routes, api/assistant/*). Deck Studio's own by default. */
  speakUrl?: string;
  transcribeUrl?: string;
  /** The voice route answers a GET with the audio as it is made (the Operator's): play it as it streams. */
  streamSpeech?: boolean;
}

export function useDeckSpeech(handlers: SpeechHandlers) {
  const mode = React.useSyncExternalStore(noop, modeNow, () => "none" as HearMode);
  const [mic, setMic] = React.useState<MicState>("off");
  const [speaking, setSpeaking] = React.useState(false);
  /** How it is listening right now (off when it isn't). */
  const [hearing, setHearing] = React.useState<HearHow | "off">("off");
  const h = React.useRef(handlers);
  React.useEffect(() => {
    h.current = handlers;
  });
  const rec = React.useRef<SR | null>(null);
  /** Listening is wanted, and how (null: not wanted). */
  const want = React.useRef<HearHow | null>(null);
  const talking = React.useRef(false);
  /** Hold and live: what was heard and not yet handed on. */
  const finals = React.useRef<string[]>([]);
  const interim = React.useRef("");
  const flushTimer = React.useRef(0);
  /** The finger lifted (hold) or live was ended: hand on what was heard when the recogniser ends. */
  const flushOnEnd = React.useRef<"all" | "finals" | null>(null);
  const graceTimer = React.useRef(0);
  const startedAt = React.useRef(0);
  const quickEnds = React.useRef(0);
  const restartTimer = React.useRef(0);
  const media = React.useRef<{ stream: MediaStream; recorder: MediaRecorder; ctx: AudioContext | null; raf: number } | null>(null);
  /** The natural voice playing, the answer it belongs to (a newer one drops a late one), and whether it works here. */
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const sayRun = React.useRef(0);
  const natural = React.useRef(true);
  const streamFails = React.useRef(0);

  const off = React.useCallback(() => {
    want.current = null;
    flushOnEnd.current = null;
    window.clearTimeout(graceTimer.current);
    window.clearTimeout(restartTimer.current);
    setHearing("off");
    setMic("off");
  }, []);

  /** Hold and live: hand on what was heard as one request (the finals, and the words still being said unless told not to). */
  const flush = React.useCallback((keepInterim: boolean) => {
    window.clearTimeout(flushTimer.current);
    const parts = keepInterim ? [...finals.current, interim.current] : finals.current;
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    finals.current = [];
    interim.current = "";
    h.current.onInterim("");
    if (text) h.current.onFinal([text]);
    else if (want.current === "hold" || flushOnEnd.current) h.current.onNothing?.();
  }, []);

  /** The listener as of the last render, for the restart timer (a session that ended starts the next one). */
  const startNativeRef = React.useRef<() => void>(() => {});
  const startNative = React.useCallback(() => {
    const Ctor = srCtor();
    if (!Ctor) return;
    try {
      rec.current?.abort();
    } catch {
      /* already stopped */
    }
    const r = new Ctor();
    // The Operator passes the language the person set (Settings → AI Operator); the Deck Studio stays English.
    r.lang = handlers.lang ?? "en-US";
    r.continuous = want.current !== "once";
    r.interimResults = true;
    r.maxAlternatives = 3;
    startedAt.current = Date.now();
    r.onstart = () => setMic("listening");
    r.onresult = (e) => {
      const w = want.current;
      const gathering = w === "hold" || w === "live";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < res.length; k++) if (res[k]?.transcript?.trim()) alts.push(res[k].transcript.trim());
          if (!alts.length) continue;
          if (gathering) finals.current.push(alts[0]);
          else h.current.onFinal(alts);
        } else inter += res[0]?.transcript ?? "";
      }
      interim.current = inter.trim();
      if (gathering) {
        h.current.onInterim([...finals.current, interim.current].join(" ").trim());
        // Live: a sentence is handed on after a short pause with nothing new — its pieces joined.
        if (w === "live" && finals.current.length && !flushOnEnd.current) {
          window.clearTimeout(flushTimer.current);
          flushTimer.current = window.setTimeout(() => flush(true), LIVE_PAUSE_MS);
        }
      } else h.current.onInterim(interim.current);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        off();
        h.current.onError("The microphone is blocked — allow it from the lock icon in the address bar, then tap the mic again.");
      } else if (e.error === "network") {
        off();
        h.current.onError("Speech needs the internet in this browser — type it instead.");
      } else if (e.error === "audio-capture") {
        off();
        h.current.onError("No microphone was found.");
      }
      // "no-speech" and "aborted" are quiet: hold and live start again on their own.
    };
    r.onend = () => {
      if (rec.current !== r) return; // an older session, replaced
      const w = want.current;
      if (flushOnEnd.current) {
        // The finger lifted, or live was ended: the last words have arrived — hand them on.
        const keep = flushOnEnd.current === "all";
        off();
        flush(keep);
        return;
      }
      if (w && w !== "once" && !talking.current) {
        // It keeps listening: at once, or after a little wait when it keeps ending the moment it starts.
        const quick = Date.now() - startedAt.current < 1500;
        quickEnds.current = quick ? quickEnds.current + 1 : 0;
        let delay = 150;
        if (quickEnds.current >= 4) {
          delay = 2000;
          quickEnds.current = 0;
        }
        window.clearTimeout(restartTimer.current);
        restartTimer.current = window.setTimeout(() => {
          if (want.current === w && !talking.current) startNativeRef.current();
        }, delay);
        return;
      }
      if (!talking.current) {
        h.current.onInterim("");
        off();
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      setMic("off");
    }
  }, [handlers.lang, flush, off]);
  React.useEffect(() => {
    startNativeRef.current = startNative;
  }, [startNative]);

  // The language changed while it listens (the setting arrives with the conversation, after the first start on a
  // device that never had it): listen again in the right one.
  const firstLang = React.useRef(true);
  React.useEffect(() => {
    if (firstLang.current) {
      firstLang.current = false;
      return;
    }
    if (want.current && mode === "native" && !talking.current) startNative();
  }, [handlers.lang, mode, startNative]);

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
      off();
      h.current.onError("The microphone is blocked — allow it in the browser, then tap the mic again.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const held = want.current === "hold";
    recorder.onstop = async () => {
      if (!chunks.length) {
        setMic("off");
        if (held) h.current.onNothing?.();
        return;
      }
      setMic("sending");
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        form.append("language", (h.current.lang ?? "en-US").slice(0, 2).toLowerCase());
        const res = await fetch(h.current.transcribeUrl ?? "/api/deck/voice/transcribe", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) h.current.onError(body.error ?? "Couldn't write that down.");
        else if (body.text) h.current.onFinal([body.text]);
        else if (held) h.current.onNothing?.();
      } catch {
        h.current.onError("Couldn't reach the server to write that down.");
      } finally {
        setMic("off");
        const w = want.current;
        if (w && w !== "once" && w !== "hold" && !talking.current) void startRecordingRef.current?.();
      }
    };
    // Stop on a pause: quiet after speech, or at the limit — held, only at the (long) limit.
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
        const limit = held ? HOLD_RECORD_MAX_MS : RECORD_MAX_MS;
        if ((!held && spoke && quietSince && now - quietSince > QUIET_MS) || now - t0 > limit) {
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
  }, [stopRecording, off]);
  const startRecordingRef = React.useRef<(() => Promise<void>) | null>(null);
  React.useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  /** Start listening — once, free, hold or live (see the head of the file); `true` is free and `false` once. */
  const start = React.useCallback(
    (how: boolean | HearHow) => {
      const w: HearHow = how === true ? "free" : how === false ? "once" : how;
      unlockVoice();
      window.clearTimeout(graceTimer.current);
      window.clearTimeout(restartTimer.current);
      window.clearTimeout(flushTimer.current);
      want.current = w;
      flushOnEnd.current = null;
      finals.current = [];
      interim.current = "";
      quickEnds.current = 0;
      setHearing(w);
      if (mode === "native") startNative();
      else if (mode === "record") void startRecording();
    },
    [mode, startNative, startRecording],
  );

  /** Stop listening. Held: the finger lifted — what was heard is handed on as one request. Live: ended — a finished
   *  sentence still waiting is handed on, the words being said are not. */
  const stop = React.useCallback(() => {
    const w = want.current;
    if (mode === "native" && (w === "hold" || w === "live") && rec.current) {
      const r = rec.current;
      flushOnEnd.current = w === "hold" ? "all" : "finals";
      window.clearTimeout(flushTimer.current);
      try {
        r.stop();
      } catch {
        const keep = flushOnEnd.current === "all";
        off();
        flush(keep);
        return;
      }
      // iPhone Safari sometimes never says it ended after a stop: hand on what was heard anyway.
      window.clearTimeout(graceTimer.current);
      graceTimer.current = window.setTimeout(() => {
        if (!flushOnEnd.current || rec.current !== r) return;
        const keep = flushOnEnd.current === "all";
        r.onend = null;
        off();
        flush(keep);
      }, END_GRACE_MS);
      return;
    }
    want.current = null;
    window.clearTimeout(restartTimer.current);
    setHearing("off");
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
    stopRecording(true);
    setMic((m) => (m === "sending" ? m : "off"));
  }, [mode, stopRecording, flush, off]);

  /** Stop listening and throw away what was heard (a slide off the dial, a cancel). */
  const cancel = React.useCallback(() => {
    window.clearTimeout(flushTimer.current);
    finals.current = [];
    interim.current = "";
    off();
    try {
      rec.current?.abort();
    } catch {
      /* already stopped */
    }
    stopRecording(false);
    h.current.onInterim("");
  }, [stopRecording, off]);

  /** Read a reply out — the natural voice, else the browser's; the microphone pauses for it and comes back after
   *  (free and live). */
  const say = React.useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !text.trim()) return;
      const run = ++sayRun.current;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audio.current) {
        audio.current.pause();
        audio.current = null;
      }
      const listening = want.current !== null;
      talking.current = true;
      setSpeaking(true);
      window.clearTimeout(restartTimer.current);
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
        const w = want.current;
        if (w && w !== "once" && w !== "hold") {
          if (mode === "native") startNative();
          else if (mode === "record") void startRecording();
        } else if (w && mode === "native") setMic("off");
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
      // The unlocked element when there is one (a phone), else a fresh one.
      const a = player ?? new Audio();
      player = a;
      if (h.current.streamSpeech && h.current.speakUrl) {
        // Played as it streams from the route: the first words sound before the sentence is finished being made.
        audio.current = a;
        a.onended = () => {
          if (audio.current === a) audio.current = null;
          streamFails.current = 0;
          done();
        };
        a.onerror = () => {
          // Twice in a row (not set up, not allowed here): the browser's voice for the rest of the visit.
          if (++streamFails.current >= 2) natural.current = false;
          browserVoice();
        };
        a.src = `${h.current.speakUrl}?t=${encodeURIComponent(text)}&n=${run}`;
        void a.play().catch(() => browserVoice());
        return;
      }
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
          a.src = url;
          void a.play().catch(() => {
            URL.revokeObjectURL(url);
            browserVoice();
          });
        })
        .catch(() => browserVoice());
    },
    [mode, startNative, startRecording, stopRecording],
  );

  /** Stop talking (a reply cut short); live listens again after it. */
  const hush = React.useCallback(() => {
    sayRun.current++;
    if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const wasTalking = talking.current;
    talking.current = false;
    setSpeaking(false);
    const w = want.current;
    if (wasTalking && w && w !== "once" && w !== "hold") {
      if (mode === "native") startNative();
      else if (mode === "record") void startRecording();
    }
  }, [mode, startNative, startRecording]);

  // Voices load late in Chrome; asking once wakes them. Everything stops when the panel goes.
  React.useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    const runs = sayRun;
    const playing = audio;
    const timers = [flushTimer, graceTimer, restartTimer];
    return () => {
      want.current = null;
      for (const t of timers) window.clearTimeout(t.current);
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

  return { mode, mic, speaking, hearing, start, stop, cancel, say, hush };
}
