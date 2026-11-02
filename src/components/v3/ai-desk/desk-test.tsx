"use client";
// "TEST IT HERE" — the owner calls the desk from the browser (2026-10-13). The app mints a
// one-session key (actions/aiDesk startDeskTest); the browser opens a WebRTC call straight
// to OpenAI's realtime API with the desk's instructions and voice on that key; events on
// the "oai-events" channel are read by lib/aiDesk/testCall; the desk's tools run through
// deskTestTool (the calendar's open times for real, the rest only in words). When the call
// ends, its seconds join the month's minutes (endDeskTest).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deskTestTool, endDeskTest, startDeskTest } from "@/actions/aiDesk";
import { clock } from "@/lib/aiDesk/shared";
import { GREET_FIRST, readRealtimeEvent, toolOutputEvents } from "@/lib/aiDesk/testCall";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

type Phase = "idle" | "mic" | "connecting" | "live" | "ending";
type Line = { who: "desk" | "caller" | "note"; text: string };

type Conn = {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  mic: MediaStream;
  audio: HTMLAudioElement;
  startedAt: number;
  /** The channel opened: the desk is on the line and the seconds count. */
  live: boolean;
  /** The desk said goodbye or is transferring: hang up once its last turn is spoken. */
  pendingClose: boolean;
  ended: boolean;
  timers: number[];
};

function closeConn(c: Conn): void {
  for (const t of c.timers) window.clearTimeout(t);
  try {
    c.dc?.close();
  } catch {
    /* already closed */
  }
  try {
    c.pc.close();
  } catch {
    /* already closed */
  }
  for (const t of c.mic.getTracks()) t.stop();
  c.audio.pause();
  c.audio.srcObject = null;
}

const liveSeconds = (c: Conn) => (c.live ? Math.max(1, Math.round((Date.now() - c.startedAt) / 1000)) : 0);

export function DeskTest({ desk }: { desk: DeskSettingsData }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const conn = useRef<Conn | null>(null);
  const tick = useRef<number | null>(null);

  const push = (line: Line) => setLines((xs) => [...xs, line].slice(-80));
  const stopTick = () => {
    if (tick.current !== null) window.clearInterval(tick.current);
    tick.current = null;
  };
  const send = (c: Conn, obj: unknown) => {
    if (c.dc && c.dc.readyState === "open") c.dc.send(JSON.stringify(obj));
  };

  /** Once: close everything, then count the seconds. */
  const hangUp = async (c: Conn, why: "owner" | "ended" | "time" | "closed" | "lost") => {
    if (c.ended) return;
    c.ended = true;
    stopTick();
    closeConn(c);
    if (conn.current === c) conn.current = null;
    const secs = liveSeconds(c);
    setSeconds(secs);
    if (!c.live) {
      // Never connected: nothing to count. The owner's own hang-up needs no error.
      if (why !== "owner") setErr(C.testFailed);
      setPhase("idle");
      return;
    }
    setPhase("ending");
    try {
      const r = await endDeskTest(secs);
      if (r.ok) setResult(r.note ?? "");
      router.refresh();
    } catch {
      /* the minutes are a figure; the call still ended */
    }
    setPhase("idle");
  };

  const onEvent = async (c: Conn, raw: unknown) => {
    const ev = readRealtimeEvent(raw);
    if (!ev || c.ended) return;
    if (ev.kind === "desk") push({ who: "desk", text: ev.text });
    else if (ev.kind === "caller") push({ who: "caller", text: ev.text });
    else if (ev.kind === "tool") {
      if (ev.name === "end_call" || ev.name === "transfer_call") c.pendingClose = true;
      let output: unknown = { error: "JobFlex could not do that right now." };
      try {
        const r = await deskTestTool(ev.name, ev.args);
        if (r.ok) {
          output = r.output;
          if (r.line) push({ who: "note", text: r.line });
        }
      } catch {
        /* the error above goes back to the model */
      }
      for (const e of toolOutputEvents(ev.callId, output)) send(c, e);
    } else if (ev.kind === "turn-done" && c.pendingClose) {
      // The goodbye is spoken: let the last of it play, then hang up.
      c.timers.push(window.setTimeout(() => void hangUp(c, "ended"), 1500));
    } else if (ev.kind === "error") setErr(ev.message);
  };

  const start = async () => {
    if (conn.current) return;
    setErr("");
    setResult("");
    setLines([]);
    setSeconds(0);
    if (typeof RTCPeerConnection !== "function" || !navigator.mediaDevices?.getUserMedia) {
      setErr(C.testUnsupported);
      return;
    }
    setPhase("mic");
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr(C.testNoMic);
      setPhase("idle");
      return;
    }
    setPhase("connecting");
    const pc = new RTCPeerConnection();
    const audio = new Audio();
    audio.autoplay = true;
    const c: Conn = { pc, dc: null, mic, audio, startedAt: Date.now(), live: false, pendingClose: false, ended: false, timers: [] };
    conn.current = c;
    try {
      const r = await startDeskTest();
      if (!r.ok) {
        setErr(r.error);
        await hangUp(c, "owner");
        return;
      }
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };
      for (const t of mic.getTracks()) pc.addTrack(t, mic);
      const dc = pc.createDataChannel("oai-events");
      c.dc = dc;
      dc.onopen = () => {
        if (c.ended) return;
        c.live = true;
        c.startedAt = Date.now();
        setPhase("live");
        tick.current = window.setInterval(() => setSeconds(Math.round((Date.now() - c.startedAt) / 1000)), 1000);
        // The desk speaks first, as on a real call; a test is capped like a call.
        send(c, GREET_FIRST);
        c.timers.push(window.setTimeout(() => send(c, { type: "response.create", response: { instructions: "The test call is nearly over: wrap up, say goodbye, and call end_call." } }), Math.max(10, r.maxSeconds - 20) * 1000));
        c.timers.push(window.setTimeout(() => void hangUp(c, "time"), r.maxSeconds * 1000));
      };
      dc.onmessage = (e) => void onEvent(c, e.data);
      dc.onclose = () => void hangUp(c, "closed");
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") void hangUp(c, "lost");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const res = await fetch(r.callsUrl, { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${r.key}`, "Content-Type": "application/sdp" } });
      if (!res.ok) throw new Error(`realtime ${res.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    } catch {
      setErr(C.testFailed);
      await hangUp(c, "owner");
    }
  };

  // Leaving the page mid-call: close the call and still count its seconds (no state — the panel is gone).
  useEffect(
    () => () => {
      const c = conn.current;
      if (!c || c.ended) return;
      c.ended = true;
      const secs = liveSeconds(c);
      closeConn(c);
      if (secs) void endDeskTest(secs).catch(() => null);
    },
    [],
  );

  const live = phase === "live";
  return (
    <div className={`${s.sec} ${s.test}`} id="desk-test" data-desk-test data-phase={phase} data-tour="ai-desk:test">
      <div className={s.h}>{C.testTitle}</div>
      <p className={s.note}>{C.testSub}</p>
      <div className={s.testBar}>
        {phase === "idle" ? (
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!desk.aiConfigured || !desk.canManage} onClick={() => void start()} data-desk-test-start>
            {C.testStart}
          </button>
        ) : (
          <button
            type="button"
            className={`${s.btn} ${s.btnDanger}`}
            disabled={phase === "ending"}
            onClick={() => {
              const c = conn.current;
              if (c) void hangUp(c, "owner");
            }}
            data-desk-test-stop
          >
            {phase === "ending" ? C.testEnding : C.testHangUp}
          </button>
        )}
        <span className={s.testState} data-live={live ? "1" : "0"} data-desk-test-state>
          {phase === "mic" ? C.testMic : phase === "connecting" ? C.testConnecting : live ? `${C.testLive} · ${clock(seconds)}` : phase === "ending" ? C.testEnding : ""}
        </span>
        {!desk.aiConfigured ? <span className={`${s.note} ${s.noteErr}`}>{C.aiOff}</span> : null}
      </div>
      {lines.length ? (
        <div className={s.lines} data-desk-test-lines aria-live="polite">
          {lines.map((l, i) =>
            l.who === "note" ? (
              <div key={i} className={s.lineNote}>
                {l.text}
              </div>
            ) : (
              <div key={i} className={`${s.line} ${l.who === "desk" ? s.lineDesk : ""}`}>
                <b>{l.who === "desk" ? C.testDesk : C.testYou}</b>
                <span>{l.text}</span>
              </div>
            ),
          )}
        </div>
      ) : null}
      {result ? (
        <p className={`${s.note} ${s.noteOk}`} role="status" data-desk-test-result>
          {result}
        </p>
      ) : null}
      {err ? (
        <p className={`${s.note} ${s.noteErr}`} role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
