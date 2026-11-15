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
//
// TURN AFTER TURN (2026-11-07, the owner: "he answers me back, and then when I wanna talk to him again, he don't
// respond and he don't listen"). iPhone Safari writes a continuous session's words down as one growing guess and
// makes them final only when the session is stopped — so live hands on a sentence after a pause in the guess too,
// and then listens again only after the reply (a fresh session: the old one would hand the same words on twice).
// The element is unlocked ONCE: playing the moment of silence again at every touch started sound at the instant the
// microphone was starting, and the second turn's ears never came on. A reply's sound is let go of when it ends. A
// session that never says it started (after the first one did) is started once more; a stopped one that never says
// it ended is aborted, not left running under the next one. When the finger lifts on words already heard they are
// handed on at once — no waiting a second and a half for a recogniser that may never say it ended.
//
// ON AN IPHONE, THE SERVER'S EARS (2026-11-07, the owner's third phone test, after the fix above: the first question
// went through, then "Listening — just talk." sat there and nothing more ever reached the server). iPhone Safari's own
// recogniser says it started after the page has played a reply, and then hears nothing. So where the caller asks for it
// (`appleServerEars`, the AI Operator), an iPhone or iPad records instead: the microphone is opened for each turn, a
// level meter on it notices speech and then the pause after it (live; held, the lift), and that take goes to the
// server to be written down — the same way Firefox has always been heard. The meter's context is woken by the first
// touch (unlockVoice); a long silence is never sent (the take starts over), and while a reply plays the microphone is
// off, so the reply is loud and never heard back.
//
// LISTENING TILL THEY'RE DONE (2026-11-07, the owner's iPhone test of the above: "it keeps asking me questions and
// doesn't let me finish — it should listen till I'm done, do what I said, and ask after"). A pause to think ended the
// take and handed half a sentence on ("Create me a proposal from…", "to…"), and the Operator answered the half. So
// live, on the server's ears, the microphone stays on between the pieces: each piece is written down while the next
// is still being listened to, the pieces are joined, and the request goes only when they've stopped — nothing more
// said while the last piece was being written down and a moment after — and, when the words stop mid-sentence
// ("…from", "…to", "…for the"), only after a longer wait for the rest. A reply that comes back while they're still
// talking stays on the screen and is not read out over them. The native ears wait longer too, and the same way for
// an unfinished sentence.
//
// THE METER COMES BACK, AND A SILENT PIECE STARTS NO WAIT OVER (2026-11-13, the owner's first try of the Operator's
// new engine — the server's ears on a Mac: "sent after 22.7 s", "20 seconds or more", "need more faster reaction").
// A Mac's microphone can hand over PURE silence until somebody speaks (a headset, the system's own voice
// processing). A second and a half of exactly nothing and the meter was given up for the whole conversation: timed
// six-second takes, a silent one uploaded every six seconds, and each of those began the wait for an
// unfinished-sounding sentence again — on the stand such a sentence was never sent. Now the meter is used again the
// moment it reads anything (and looked for again where its context wasn't running yet); the waits count from the
// last WORDS that landed, so a piece with nothing in it changes nothing; a microphone the meter knows and reads as
// pure silence is not uploaded; a reply is held back only for speech the meter heard; a click and a cough ten
// seconds apart no longer add up to speech; and the readout is timed from this request's own last word — or says
// that no level could be read.

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

/** An iPhone or iPad — every browser there is Safari underneath (an iPad says it is a Mac, with a touch screen). */
function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** The level meter's audio context: one for the page, woken by a touch (an iPhone starts it only from one). */
let earsCtx: AudioContext | null = null;
function earsContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!earsCtx || earsCtx.state === "closed") {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      earsCtx = new Ctor();
    }
    return earsCtx;
  } catch {
    return null;
  }
}

/** The one element every reply plays through (see the head of the file), and whether a touch has unlocked it. */
let player: HTMLAudioElement | null = null;
let unlocked = false;
let silence: string | null = null;
/** A session has started on this page: the microphone is allowed, so one that never starts is stuck, not asking. */
let everStarted = false;

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
 *  play. Once is enough — after that it does nothing, so no sound starts while the microphone is starting. Harmless
 *  anywhere else, and while a reply is playing it leaves it alone. */
export function unlockVoice(): void {
  if (typeof window === "undefined" || unlocked) return;
  // The server's ears' level meter (an iPhone): its context can start only from a touch, so it starts now.
  if (isAppleMobile()) void earsContext()?.resume().catch(() => undefined);
  try {
    if (!player) {
      player = new Audio();
      player.preload = "auto";
      (player as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    }
    if (!player.paused && !player.ended) return;
    player.onended = null;
    player.onerror = null;
    player.src = silentClip();
    void player
      .play()
      .then(() => {
        unlocked = true;
      })
      .catch(() => undefined);
    if ("speechSynthesis" in window && !window.speechSynthesis.speaking) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* no audio here */
  }
}

/** A reply's sound is over (or cut short): its handlers go and the element lets go of the audio. */
function letGo(a: HTMLAudioElement) {
  a.onended = null;
  a.onerror = null;
  a.onplaying = null;
  try {
    a.pause();
    a.removeAttribute("src");
    a.load();
  } catch {
    /* nothing loaded */
  }
}

export type HearMode = "native" | "record" | "none";
export type MicState = "off" | "listening" | "recording" | "sending";
/** How it listens (see the head of the file); `true` is free, `false` is once, as the Deck Studio has always said it. */
export type HearHow = "once" | "free" | "hold" | "live";

/** Live: a sentence is handed on this long after its last finished piece — or after the last change in the guess,
 *  where the recogniser finishes nothing until it is stopped (iPhone Safari). */
const LIVE_PAUSE_MS = 1200;
const LIVE_GUESS_PAUSE_MS = 1500;
/** Live: words that stop mid-sentence wait this long for the rest before they go anyway; and on the server's ears
 *  finished-sounding words go this long after they come back with nothing more said. */
const UNFINISHED_WAIT_MS = 5000;
const HANDON_GRACE_MS = 600;
/** The Operator's new engine (`quick`, 2026-11-13 — the owner: "instant respond", then, after his first try, "need
 *  more faster reaction"): a take ends sooner after the speech in it stops, so it is being written down while the
 *  pause is still running, and finished-sounding words go as soon as they are written down and the meter has heard
 *  nothing for QUICK_SEND_QUIET_MS — a moment after they land where no level can be read. The microphone still
 *  listens while a piece is written down, and a sentence that stops mid-way still waits for the rest, so a pause to
 *  think is not cut off. */
const QUICK_HANDON_GRACE_MS = 100;
const QUICK_BLIND_GRACE_MS = 300;
const QUICK_LIVE_QUIET_MS = 700;
const QUICK_SEND_QUIET_MS = 1500;
/** …and words that sound unfinished wait three seconds for the rest, not five: "send it to me" ends on a word a
 *  sentence usually doesn't end on, and five seconds of nothing after it read as the Operator not having heard. */
const QUICK_UNFINISHED_WAIT_MS = 3000;

/** Words a sentence doesn't end on: "Create me a proposal from…", "I need to", "for the" — the rest is coming. */
const DANGLING = new Set(
  "to from for with and or but the a an of at in on by about into onto than as my our your his her their its me is are was were that this these those so then because if uh um umm like need want create make build price get also plus".split(" "),
);
/** An address still being said (2026-11-07, the owner's "12103 200th Street Southeast" went with no city): a house
 *  number and its street with no ZIP or state after them yet, or "the address is 12103" and nothing more. */
const STREET_SAID = /\b\d{2,6}[A-Za-z]?\s+(?:\S+\s+){0,3}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|pl|place|blvd|boulevard|way|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|trl|trail)\b\.?/i;
const STATE_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const STATE_NAME = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
function addressUnfinished(t: string): boolean {
  if (/\baddress(?:\s+is)?\s+\d{1,6}[.,]?$/i.test(t)) return true;
  const m = STREET_SAID.exec(t);
  if (!m) return false;
  const after = t.slice(m.index + m[0].length);
  if (/\b\d{5}(?:-\d{4})?\b/.test(after)) return false;
  if ((after.match(/\b[A-Z]{2}\b/g) ?? []).some((c) => STATE_CODES.has(c))) return false;
  return !STATE_NAME.test(after);
}
/** The words stop mid-sentence: they end on "…" or a comma, or on a word like "from", "to", "the" — not a question —
 *  or an address is still missing its city, state or ZIP. */
export function soundsUnfinished(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/(\.\.\.|…|,|-|—|–)$/.test(t)) return true;
  if (addressUnfinished(t)) return true;
  if (/\?$/.test(t)) return false;
  const last = (t.replace(/[.!]+$/, "").split(/\s+/).pop() ?? "").toLowerCase().replace(/[^a-z']/g, "");
  return DANGLING.has(last);
}
/** Hold: the finger lifted — the last words arrive with the end; without an end, what was heard goes after this
 *  (at once when words were already heard, a little longer when nothing was yet). */
const HEARD_GRACE_MS = 300;
const END_GRACE_MS = 1200;
/** A session that has not said it started by now (after one did on this page) is started once more. */
const START_WATCH_MS = 1800;
/** Record mode: a take ends this long after the speech in it stops (live sooner), and at this length in any case —
 *  held, only when the finger lifts (or at the long limit). Speech is this much voice in a take, not a click. */
const QUIET_MS = 1300;
const LIVE_QUIET_MS = 1200;
const VOICE_MS = 200;
/** Before a take counts as speech, the voice heard in it drains away again in the quiet (this share of the time):
 *  a click now and a cough ten seconds later don't add up to "they spoke" — on a desktop microphone they did. */
const VOICE_LEAK = 0.15;
const TAKE_MAX_MS = 25_000;
const HOLD_RECORD_MAX_MS = 45_000;
/** A take with no speech in it this long starts over (nothing is sent); where no level can be read, takes are this
 *  long and all of them go (the server sends back nothing for silence). */
const IDLE_TAKE_MS = 15_000;
const BLIND_TAKE_MS = 6_000;
/** The level meter reads every this many ms; a meter that reads exactly nothing this long is not working. */
const WATCH_MS = 50;
const DEAD_METER_MS = 1500;
/** A meter whose context was not running when the microphone came on is asked for again this often. */
const METER_RETRY_MS = 1000;
/** The meter has read sound on this page: its context and the way to the microphone work here, so a later take it
 *  reads as exactly nothing is a silent microphone (a headset or the system's own voice processing hand over pure
 *  silence until somebody speaks), not a meter that came loose. */
let meterProven = false;

const noop = () => () => {};
const modeNow = (): HearMode => {
  if (typeof window === "undefined") return "none";
  if (srCtor()) return "native";
  if (canRecord()) return "record";
  return "none";
};
/** Every device records and lets the server write it down (the Operator's new engine: the server's ears are given
 *  the company's own words, which the browser's own recogniser cannot be). */
const modeServerAlways = (): HearMode => {
  if (typeof window === "undefined") return "none";
  if (canRecord()) return "record";
  return modeNow();
};
/** The same, except that an iPhone or iPad records and lets the server write it down (see the head of the file). */
const modeServerOnApple = (): HearMode => {
  if (typeof window === "undefined") return "none";
  if (isAppleMobile() && canRecord()) return "record";
  return modeNow();
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
  /** On an iPhone or iPad, record and let the server write it down instead of Safari's own recogniser (see the head
   *  of the file). The AI Operator asks for it; the Deck Studio doesn't. */
  appleServerEars?: boolean;
  /** On every device (2026-11-13, the Operator's new engine): record and let the server write it down — its ears are
   *  given the company's own words. */
  serverEarsAlways?: boolean;
  /** The Operator's new engine: hand a finished sentence on sooner (QUICK_* above). */
  quick?: boolean;
  /** Server's ears: a request is being handed on — how long since their voice was last heard (null where no level
   *  could be read: the takes were timed), how long the last piece took to be written down, and whether the words
   *  sounded unfinished and were waited on (the admin's speed readout). */
  onHandOn?: (t: { sinceVoiceMs: number | null; heardMs: number | null; ears: "meter" | "timed"; rest: boolean }) => void;
  /** A reply's sound started. */
  onVoiceStart?: () => void;
}

/** Record mode: one recording, from the moment the meter says go to the pause after the speech in it. */
/** `timed`: no level could be read for some of it, so it goes at the timed length whatever the meter noticed;
 *  `zero`: a meter was on it all along and read exactly nothing. */
type Take = { recorder: MediaRecorder; chunks: Blob[]; send: boolean; spoke: boolean; timed: boolean; zero: boolean; voiceMs: number; quietMs: number; at: number };

export function useDeckSpeech(handlers: SpeechHandlers) {
  const mode = React.useSyncExternalStore(noop, handlers.serverEarsAlways ? modeServerAlways : handlers.appleServerEars ? modeServerOnApple : modeNow, () => "none" as HearMode);
  const [mic, setMic] = React.useState<MicState>("off");
  const [speaking, setSpeaking] = React.useState(false);
  /** Record mode: the meter hears a voice in the take being recorded; and words are being written down while the
   *  microphone stays on (live). */
  const [voiced, setVoiced] = React.useState(false);
  const [writing, setWriting] = React.useState(false);
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
  /** A session that never says it started: watched, and started once more. */
  const startWatch = React.useRef(0);
  const retried = React.useRef(false);
  /** Live: a sentence was handed on — the ears rest until the reply has been said (or resume()). */
  const thinking = React.useRef(false);
  /** Record mode: the microphone, the take on it, the meter's nodes and its timer; and a microphone being opened. */
  const media = React.useRef<{ stream: MediaStream; take: Take | null; nodes: AudioNode[]; watch: number } | null>(null);
  const opening = React.useRef(false);
  /** Live: words heard and written down, not handed on yet; pieces still being written down; when the last piece
   *  came back; since when the words have stopped mid-sentence (0: they haven't); the wait before they go. */
  const livePending = React.useRef("");
  const inFlight = React.useRef(0);
  const landedAt = React.useRef(0);
  const unfinishedAt = React.useRef(0);
  /** When the meter last heard their voice in the request being said (0: not yet, or no level can be read), how long
   *  the last take took to be written down, whether a piece of this request went on a timer with no speech noticed
   *  in it, and how many pieces now being written down the meter did hear speech in. */
  const lastVoiceAt = React.useRef(0);
  const lastHeardMs = React.useRef<number | null>(null);
  const timedSince = React.useRef(false);
  const inFlightVoiced = React.useRef(0);
  const handingOn = React.useCallback((rest = false) => {
    const timed = timedSince.current;
    h.current.onHandOn?.({ sinceVoiceMs: !timed && lastVoiceAt.current ? Date.now() - lastVoiceAt.current : null, heardMs: lastHeardMs.current, ears: timed ? "timed" : "meter", rest });
    // The next request is timed from its own last word, never from this one's (2026-11-13: after a turn the meter
    // could not read, the readout counted from the turn before — "sent after 22.7 s").
    lastVoiceAt.current = 0;
    timedSince.current = false;
  }, []);
  const decideTimer = React.useRef(0);
  /** The natural voice playing, the answer it belongs to (a newer one drops a late one), and whether it works here. */
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const sayRun = React.useRef(0);
  const natural = React.useRef(true);
  const streamFails = React.useRef(0);

  const off = React.useCallback(() => {
    want.current = null;
    flushOnEnd.current = null;
    thinking.current = false;
    livePending.current = "";
    unfinishedAt.current = 0;
    window.clearTimeout(decideTimer.current);
    window.clearTimeout(graceTimer.current);
    window.clearTimeout(restartTimer.current);
    window.clearTimeout(startWatch.current);
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

  /** Live: the sentence goes — and this session with it (its guess would hand the same words on again); the ears
   *  rest until the reply has been said, then a fresh session listens (say → resume). */
  const handOnLiveRef = React.useRef<() => void>(() => {});
  const handOnLive = React.useCallback(() => {
    if (want.current !== "live") return;
    // Words that stop mid-sentence wait for the rest (new words start the pause over), then go anyway.
    const said = [...finals.current, interim.current].join(" ").trim();
    if (soundsUnfinished(said)) {
      if (!unfinishedAt.current) unfinishedAt.current = Date.now();
      const left = UNFINISHED_WAIT_MS - (Date.now() - unfinishedAt.current);
      if (left > 0) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = window.setTimeout(() => handOnLiveRef.current(), left);
        return;
      }
    }
    unfinishedAt.current = 0;
    const r = rec.current;
    thinking.current = true;
    window.clearTimeout(restartTimer.current);
    window.clearTimeout(startWatch.current);
    if (r) {
      r.onend = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    }
    setMic("off");
    flush(true);
  }, [flush]);
  React.useEffect(() => {
    handOnLiveRef.current = handOnLive;
  }, [handOnLive]);

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
    thinking.current = false;
    const r = new Ctor();
    // The Operator passes the language the person set (Settings → AI Operator); the Deck Studio stays English.
    r.lang = handlers.lang ?? "en-US";
    r.continuous = want.current !== "once";
    r.interimResults = true;
    r.maxAlternatives = 3;
    startedAt.current = Date.now();
    let began = false;
    r.onstart = () => {
      began = true;
      everStarted = true;
      retried.current = false;
      window.clearTimeout(startWatch.current);
      setMic("listening");
    };
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
        // Live: a sentence is handed on after a short pause with nothing new — its pieces joined; a guess that
        // never becomes final (iPhone Safari) after a little longer.
        if (w === "live" && (finals.current.length || interim.current) && !flushOnEnd.current) {
          unfinishedAt.current = 0;
          window.clearTimeout(flushTimer.current);
          flushTimer.current = window.setTimeout(handOnLive, interim.current ? LIVE_GUESS_PAUSE_MS : LIVE_PAUSE_MS);
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
      if (thinking.current) return;
      // A session that ended on its own: its last guess is kept as said (the next session starts a new guess).
      if ((w === "hold" || w === "live") && interim.current) {
        finals.current.push(interim.current);
        interim.current = "";
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
    // The microphone was allowed before on this page, so a session that stays silent about starting is stuck (the
    // second turn on an iPhone): once more, then say so instead of seeming to listen.
    window.clearTimeout(startWatch.current);
    if (everStarted) {
      startWatch.current = window.setTimeout(() => {
        if (began || rec.current !== r || !want.current || talking.current || thinking.current) return;
        if (!retried.current) {
          retried.current = true;
          startNativeRef.current();
          return;
        }
        retried.current = false;
        r.onend = null;
        try {
          r.abort();
        } catch {
          /* never started */
        }
        off();
        h.current.onInterim("");
        h.current.onError("The microphone didn't come on — tap the dial and talk again.");
      }, START_WATCH_MS);
    }
  }, [handlers.lang, flush, off, handOnLive]);
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

  /** Record mode: what was recorded goes to the server to be written down, and on from there — handed on, or, when
   *  nothing worth sending was in it, live and free listen again. */
  const startRecordingRef = React.useRef<(() => Promise<void>) | null>(null);
  /** The server writes a take down: its words, or nothing (and whether that was a failure, already said). */
  const writeDown = React.useCallback(async (blob: Blob): Promise<{ text: string; failed: boolean }> => {
    try {
      const form = new FormData();
      form.append("audio", blob, `voice.${/mp4|m4a|aac/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm"}`);
      form.append("language", (h.current.lang ?? "en-US").slice(0, 2).toLowerCase());
      const sent = performance.now();
      const res = await fetch(h.current.transcribeUrl ?? "/api/deck/voice/transcribe", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      lastHeardMs.current = Math.round(performance.now() - sent);
      if (!res.ok) {
        h.current.onError(body.error ?? "Couldn't write that down.");
        return { text: "", failed: true };
      }
      return { text: (body.text ?? "").trim(), failed: false };
    } catch {
      h.current.onError("Couldn't reach the server to write that down.");
      return { text: "", failed: true };
    }
  }, []);

  /** Live on the server's ears: the request goes only when they're done — no piece still being written down, no
   *  voice in the take being recorded now, and a moment of quiet since the last piece came back (a longer one when
   *  the words stop mid-sentence). Asked again as each piece comes back and every moment in between. */
  const decideLiveRef = React.useRef<() => void>(() => {});
  const decideLive = React.useCallback(() => {
    window.clearTimeout(decideTimer.current);
    if (want.current !== "live") return;
    const said = livePending.current.trim();
    if (!said) return;
    // More words on the way, or they're talking right now: that piece, when it comes back, asks again. The waits
    // below count from the last WORDS that landed — a piece that comes back with nothing in it (a noise, a quiet
    // room on timed takes) does not start them over. It used to (2026-11-13, the owner on a Mac: "20 seconds or
    // more"): where no level could be read a silent piece went every six seconds, each one began the five seconds
    // for an unfinished-sounding sentence again, and the request could wait for ever.
    if (inFlight.current > 0 || media.current?.take?.spoke) return;
    const now = Date.now();
    const unfinished = soundsUnfinished(said);
    const sinceWords = now - landedAt.current;
    let left: number;
    if (unfinished) left = (h.current.quick ? QUICK_UNFINISHED_WAIT_MS : UNFINISHED_WAIT_MS) - sinceWords;
    else if (!h.current.quick) left = HANDON_GRACE_MS - sinceWords;
    else if (lastVoiceAt.current && !timedSince.current) left = Math.max(QUICK_HANDON_GRACE_MS - sinceWords, QUICK_SEND_QUIET_MS - (now - lastVoiceAt.current));
    else left = QUICK_BLIND_GRACE_MS - sinceWords;
    if (left > 0) {
      decideTimer.current = window.setTimeout(() => decideLiveRef.current(), Math.min(left, 200));
      return;
    }
    livePending.current = "";
    unfinishedAt.current = 0;
    thinking.current = true;
    h.current.onInterim("");
    handingOn(unfinished);
    h.current.onFinal([said]);
  }, [handingOn]);
  React.useEffect(() => {
    decideLiveRef.current = decideLive;
  }, [decideLive]);

  /** Live: a piece of what they said, written down while the microphone stays on; joined to the pieces before it. */
  const hearLive = React.useCallback(
    async (blob: Blob, voiced: boolean) => {
      inFlight.current++;
      if (voiced) inFlightVoiced.current++;
      setWriting(true);
      const { text } = await writeDown(blob);
      inFlight.current = Math.max(0, inFlight.current - 1);
      if (voiced) inFlightVoiced.current = Math.max(0, inFlightVoiced.current - 1);
      if (!inFlight.current) setWriting(false);
      if (want.current !== "live") return;
      if (text) {
        livePending.current = `${livePending.current} ${text}`.replace(/\s+/g, " ").trim();
        landedAt.current = Date.now();
        // What's been heard so far shows while they finish ("Create me a proposal from…").
        h.current.onInterim(livePending.current);
      }
      decideLive();
    },
    [writeDown, decideLive],
  );

  const transcribe = React.useCallback(
    async (blob: Blob, how: HearHow) => {
      setMic("sending");
      const { text, failed } = await writeDown(blob);
      setMic((m) => (m === "sending" ? "off" : m));
      const w = want.current;
      if (text) {
        // Live rests until the reply has been said (say → resume), as the native ears do.
        if (w === "live") thinking.current = true;
        handingOn();
        h.current.onFinal([text]);
        if (w === "free" && !talking.current && !media.current) void startRecordingRef.current?.();
        return;
      }
      if (how === "hold" && !failed) h.current.onNothing?.();
      if ((w === "live" || w === "free") && !talking.current && !thinking.current && !media.current) void startRecordingRef.current?.();
    },
    [writeDown, handingOn],
  );

  /** Record mode: the microphone off — the take on it sent to be written down, or thrown away. */
  const stopRecording = React.useCallback((send: boolean) => {
    const m = media.current;
    if (!m) return;
    media.current = null;
    window.clearInterval(m.watch);
    setVoiced(false);
    for (const n of m.nodes) {
      try {
        n.disconnect();
      } catch {
        /* not connected */
      }
    }
    const close = () => m.stream.getTracks().forEach((t) => t.stop());
    const t = m.take;
    if (t && t.recorder.state !== "inactive") {
      t.send = send;
      // The microphone goes once the recorder has its last piece (and in a moment regardless).
      t.recorder.addEventListener("stop", close, { once: true });
      window.setTimeout(close, 1500);
      try {
        t.recorder.stop();
      } catch {
        close();
      }
    } else close();
  }, []);

  const startRecording = React.useCallback(async () => {
    if (!want.current || media.current || opening.current) return;
    opening.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      opening.current = false;
      off();
      h.current.onError("The microphone is blocked — allow it in the browser, then tap the mic again.");
      return;
    }
    // The level meter: speech, and the pause after it. Its context runs only after a touch woke it (unlockVoice) or
    // while the microphone is on; where it can't, takes are timed instead.
    const nodes: AudioNode[] = [];
    const meter: { analyser: AnalyserNode | null; buf: Float32Array | null } = { analyser: null, buf: null };
    const ctx = earsContext();
    /** The meter on this microphone, as soon as its context runs (asked again while it listens, where it didn't yet). */
    const meterOn = (): boolean => {
      if (meter.analyser) return true;
      if (!ctx || ctx.state !== "running") return false;
      try {
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        // Through a silent gain to the output: Safari reads a meter only when it leads somewhere.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(analyser);
        analyser.connect(mute);
        mute.connect(ctx.destination);
        nodes.push(src, analyser, mute);
        meter.analyser = analyser;
        meter.buf = new Float32Array(analyser.fftSize);
        return true;
      } catch {
        return false;
      }
    };
    if (ctx) {
      try {
        if (ctx.state !== "running") await Promise.race([ctx.resume(), new Promise((r) => window.setTimeout(r, 400))]);
      } catch {
        /* it may start a moment later */
      }
      meterOn();
    }
    opening.current = false;
    // How it listens is read now: it may have changed while the microphone was coming on (a tap on the dial starts a
    // hold and turns it into live a moment later — on a phone, before the microphone is on). Ended, a reply begun,
    // or the sentence already handed on meanwhile: let it go.
    const how = want.current;
    if (!how || talking.current || (how === "live" && thinking.current) || media.current) {
      for (const n of nodes) n.disconnect();
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((x) => MediaRecorder.isTypeSupported?.(x)) ?? "";
    const m: { stream: MediaStream; take: Take | null; nodes: AudioNode[]; watch: number } = { stream, take: null, nodes, watch: 0 };
    media.current = m;

    // The meter's state: the last three seconds of levels, and whether a level can be read right now (`blind`: not
    // — no meter yet, or one that has read exactly nothing since the microphone came on; takes are timed meanwhile).
    const levels: number[] = [];
    let blind = !meter.analyser;
    let deadMs = 0;
    let retryMs = 0;
    let everSound = false;
    let last = performance.now();

    /** A new take on the open microphone (the one before it, if any, thrown away). */
    const begin = () => {
      const old = m.take;
      if (old && old.recorder.state !== "inactive") {
        old.send = false;
        try {
          old.recorder.stop();
        } catch {
          /* stopped */
        }
      }
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const t: Take = { recorder, chunks: [], send: false, spoke: false, timed: blind, zero: !!meter.analyser, voiceMs: 0, quietMs: 0, at: performance.now() };
      recorder.ondataavailable = (e) => {
        if (e.data.size) t.chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (!t.send) return;
        // The meter heard nothing: nothing is sent (a lift on silence says so) — unless no level could be read for
        // some of it (`timed`): then it goes, and the server writes nothing down for silence. One exception: a
        // meter known to work here that read exactly nothing all through it — that microphone was silent (live and
        // held only; and not on an iPhone or iPad, where a meter can come loose from a microphone that still hears).
        const silent = (how === "live" || how === "hold") && t.timed && !t.spoke && t.zero && meterProven && !isAppleMobile();
        if ((!t.timed && !t.spoke) || silent || !t.chunks.length) {
          if (how === "hold") h.current.onNothing?.();
          return;
        }
        const blob = new Blob(t.chunks, { type: recorder.mimeType || type || "audio/mp4" });
        if (t.timed && !t.spoke) timedSince.current = true;
        if (how === "live") void hearLive(blob, t.spoke);
        else void transcribe(blob, how);
      };
      m.take = t;
      setVoiced(false);
      recorder.start();
    };

    /** Live: this piece is over (a pause after speech) — it is written down while the next take already listens. */
    const endTake = () => {
      const t = m.take;
      if (!t) return;
      m.take = null;
      t.send = true;
      try {
        t.recorder.stop();
      } catch {
        /* stopped */
      }
      begin();
    };

    begin();
    setMic("recording");
    m.watch = window.setInterval(() => {
      if (media.current !== m || !m.take) return;
      const t = m.take;
      const now = performance.now();
      const dt = now - last;
      last = now;
      const age = now - t.at;
      if (how === "hold" && age > HOLD_RECORD_MAX_MS) {
        stopRecording(true);
        return;
      }
      // No meter yet (its context wasn't running when the microphone came on): asked for again every second.
      if (!meter.analyser && ctx && (retryMs += dt) >= METER_RETRY_MS) {
        retryMs = 0;
        if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
        meterOn();
      }
      let rms = 0;
      if (meter.analyser && meter.buf) {
        const buf = meter.buf;
        meter.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        rms = Math.sqrt(sum / buf.length);
        // A meter that reads exactly nothing is not hearing the microphone — yet: timed takes until it reads
        // something, and the meter again from then on. (2026-11-13: it used to be given up for the whole
        // conversation. A Mac's microphone can hand over pure silence until somebody speaks — a headset, the
        // system's own voice processing — so a second and a half of thinking before a sentence put every turn on
        // six-second takes.)
        if (rms > 0) {
          everSound = true;
          meterProven = true;
          if (blind) {
            blind = false;
            levels.length = 0;
          }
          t.zero = false;
        } else if (!everSound && (deadMs += dt) > DEAD_METER_MS) blind = true;
      } else t.zero = false;
      if (blind) t.timed = true;
      if (!blind) {
        // The room's own level: a low point of the last three seconds; speech is well above it.
        levels.push(rms);
        if (levels.length > 60) levels.shift();
        const floor = levels.length < 8 ? 0.004 : [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.15)];
        const threshold = Math.min(0.07, Math.max(0.012, floor * 3));
        if (rms > threshold) {
          t.voiceMs += dt;
          t.quietMs = 0;
          if (t.spoke || t.voiceMs >= VOICE_MS) lastVoiceAt.current = Date.now();
        } else {
          t.quietMs += dt;
          if (!t.spoke && t.voiceMs > 0) t.voiceMs = Math.max(0, t.voiceMs - dt * VOICE_LEAK);
        }
        if (!t.spoke && t.voiceMs >= VOICE_MS) {
          t.spoke = true;
          setVoiced(true);
          // They went on talking: words that stopped mid-sentence aren't waiting on their own any more.
          unfinishedAt.current = 0;
        }
        if (how === "hold") return;
        if (t.spoke && (t.quietMs >= (how === "live" ? (h.current.quick ? QUICK_LIVE_QUIET_MS : LIVE_QUIET_MS) : QUIET_MS) || age > TAKE_MAX_MS)) {
          if (how === "live") endTake();
          else stopRecording(true);
          return;
        }
        // Some of this take had no level to read: it goes at the timed length, though no speech was noticed in it.
        if (t.timed && !t.spoke && age > BLIND_TAKE_MS) {
          if (how === "live") endTake();
          else stopRecording(true);
          return;
        }
        // Nothing said in a long while: the take starts over (a long silence is never sent) — a single sentence's
        // listening (once) gives up instead.
        if (!t.spoke && age > IDLE_TAKE_MS) {
          if (how === "once") {
            stopRecording(false);
            off();
          } else begin();
        }
        return;
      }
      if (how !== "hold" && age > BLIND_TAKE_MS) {
        if (how === "live") endTake();
        else stopRecording(true);
      }
    }, WATCH_MS);
  }, [stopRecording, off, transcribe, hearLive]);
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
      thinking.current = false;
      retried.current = false;
      finals.current = [];
      interim.current = "";
      livePending.current = "";
      unfinishedAt.current = 0;
      lastVoiceAt.current = 0;
      timedSince.current = false;
      window.clearTimeout(decideTimer.current);
      quickEnds.current = 0;
      setHearing(w);
      if (mode === "native") startNative();
      else if (mode === "record") {
        // A take still open (another way of listening) is thrown away; this one opens its own.
        stopRecording(false);
        void startRecording();
      }
    },
    [mode, startNative, startRecording, stopRecording],
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
      // iPhone Safari sometimes never says it ended after a stop: hand on what was heard anyway — at once when words
      // were already heard — and abort that session, so it is not still running when the next turn starts.
      const heardSome = finals.current.length > 0 || interim.current.trim() !== "";
      window.clearTimeout(graceTimer.current);
      graceTimer.current = window.setTimeout(() => {
        if (!flushOnEnd.current || rec.current !== r) return;
        const keep = flushOnEnd.current === "all";
        r.onend = null;
        try {
          r.abort();
        } catch {
          /* already ended */
        }
        off();
        flush(keep);
      }, heardSome ? HEARD_GRACE_MS : END_GRACE_MS);
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
    // Held, and the microphone never came on (a quick lift, or the question whether it may): say so.
    if (mode === "record" && w === "hold" && !media.current) h.current.onNothing?.();
    stopRecording(true);
    setMic((m) => (m === "sending" ? m : "off"));
  }, [mode, stopRecording, flush, off]);

  /** Stop listening and throw away what was heard (a slide off the dial, a cancel). */
  const cancel = React.useCallback(() => {
    window.clearTimeout(flushTimer.current);
    finals.current = [];
    interim.current = "";
    setWriting(false);
    off();
    try {
      rec.current?.abort();
    } catch {
      /* already stopped */
    }
    stopRecording(false);
    h.current.onInterim("");
  }, [stopRecording, off]);

  /** Listen again after a reply (free and live): a fresh session, unless a reply is being said. The Operator calls it
   *  when a turn ends with nothing to say (muted, or it didn't go through). */
  const resume = React.useCallback(() => {
    const w = want.current;
    if (talking.current || !w || w === "once" || w === "hold") return;
    thinking.current = false;
    if (mode === "native") startNative();
    else if (mode === "record" && !media.current) void startRecording();
  }, [mode, startNative, startRecording]);

  /** Read a reply out — the natural voice, else the browser's; the microphone pauses for it and comes back after
   *  (free and live). */
  const say = React.useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !text.trim()) return;
      // Live on the server's ears, and they're still talking — or have said more since, still being written down or
      // waiting to go: the reply stays on the screen, not read out over them; the ears stay on (the next request
      // goes when they're done). A timed piece the meter heard no speech in doesn't hold a reply back (where no
      // level could be read one was on its way one second in six, and that reply was never said).
      if (mode === "record" && want.current === "live" && (media.current?.take?.spoke || inFlightVoiced.current > 0 || livePending.current)) {
        thinking.current = false;
        return;
      }
      const run = ++sayRun.current;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audio.current) {
        letGo(audio.current);
        audio.current = null;
      }
      const listening = want.current !== null;
      talking.current = true;
      setSpeaking(true);
      window.clearTimeout(restartTimer.current);
      window.clearTimeout(startWatch.current);
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
        if (w && w !== "once" && w !== "hold") resume();
        else if (w && mode === "native") setMic("off");
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
        u.onstart = () => h.current.onVoiceStart?.();
        u.onend = done;
        u.onerror = done;
        synth.speak(u);
      };
      if (!natural.current) return browserVoice();
      // The unlocked element when there is one (a phone), else a fresh one.
      const a = player ?? new Audio();
      player = a;
      a.onplaying = () => {
        if (run === sayRun.current) h.current.onVoiceStart?.();
      };
      if (h.current.streamSpeech && h.current.speakUrl) {
        // Played as it streams from the route: the first words sound before the sentence is finished being made.
        audio.current = a;
        a.onended = () => {
          if (audio.current === a) audio.current = null;
          streamFails.current = 0;
          letGo(a);
          done();
        };
        a.onerror = () => {
          // Twice in a row (not set up, not allowed here): the browser's voice for the rest of the visit.
          if (++streamFails.current >= 2) natural.current = false;
          if (audio.current === a) audio.current = null;
          letGo(a);
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
            letGo(a);
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
    [mode, stopRecording, resume],
  );

  /** Stop talking (a reply cut short); live listens again after it — and after a sentence it only rested for ("wait"). */
  const hush = React.useCallback(() => {
    sayRun.current++;
    if (audio.current) {
      letGo(audio.current);
      audio.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const wasTalking = talking.current;
    talking.current = false;
    setSpeaking(false);
    if (wasTalking || thinking.current) resume();
  }, [resume]);

  // Voices load late in Chrome; asking once wakes them. Everything stops when the panel goes.
  React.useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    const runs = sayRun;
    const playing = audio;
    const timers = [flushTimer, graceTimer, restartTimer, decideTimer];
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

  return { mode, mic, speaking, hearing, voiced, writing, start, stop, cancel, say, hush, resume };
}
