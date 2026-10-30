// THE SIGN-UP FORM ON A LIVE LINE (owner, 2026-10-14: "what they're doing exactly, where they leave, and whether
// it's our side"). Under a visitor's sentence: the box they are in now, the boxes they used (time, filled, refused),
// every problem they met — red when it was ours, amber when the form refused them — the tab away and back, and the
// leave with its verdict. Read from lib/traffic-live formWatchOf; no state, no fetch.
import type { LiveFormWatch } from "@/lib/traffic-live";
import { durationWords } from "@/lib/signup-watch-shared";
import s from "./traffic.module.css";

const VERDICT: Record<NonNullable<LiveFormWatch["verdict"]>, { words: string; tone: string }> = {
  ours: { words: "Our side", tone: "ours" },
  theirs: { words: "The form refused them", tone: "theirs" },
  choice: { words: "Their choice — no error", tone: "choice" },
};

function clock(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
}

export function FormWatchLine({ f, active, timezone }: { f: LiveFormWatch; active: boolean; timezone: string }) {
  const verdict = f.verdict ? VERDICT[f.verdict] : null;
  return (
    <span className={s.formWatch} data-form-watch data-screen={f.screen}>
      <span className={s.fwRow}>
        <em className={s.fwScreen}>{f.screen}</em>
        {f.inBox && active && (
          <em className={s.fwNow} data-form-now={f.inBox.field}>
            In {f.inBox.field} · since {clock(f.inBox.since, timezone)}
          </em>
        )}
        {f.boxes.map((b) => (
          <em key={b.field} className={s.fwBox} data-form-box={b.field} data-filled={b.filled} data-valid={b.valid} title={`${b.visits} visit${b.visits === 1 ? "" : "s"} · ${b.edits} edit${b.edits === 1 ? "" : "s"}`}>
            {b.field} {durationWords(b.secs * 1000)}
            {!b.filled ? " · left empty" : !b.valid ? " · refused" : " ✓"}
          </em>
        ))}
      </span>
      {f.problems.length > 0 && (
        <span className={s.fwRow}>
          {f.problems.map((p) => (
            <em key={p.at + p.reason} className={s.fwProblem} data-form-problem={p.reason} data-side={p.side} title={p.message || p.words}>
              {/* The browser's own failure says "not ours" in its words, in grey (2026-10-30). */}
              {p.side === "ours" ? "Ours · " : ""}
              {p.words}
              <i>{clock(p.at, timezone)}</i>
              {/* What the browser said, in plain sight — it used to wait in a hover (2026-10-16). */}
              {p.message && p.message !== p.words ? <b className={s.fwMsg} data-form-problem-message>“{p.message}”</b> : null}
            </em>
          ))}
        </span>
      )}
      {(f.away || f.cameBack || f.left || verdict) && (
        <span className={s.fwRow}>
          {f.away && <em className={s.fwAway} data-form-away>Away since {clock(f.away.since, timezone)}{f.screen === "Email code" ? " — reading the code email?" : ""}</em>}
          {f.cameBack && !f.away && <em className={s.fwBack} data-form-back>Came back after {durationWords(f.cameBack.secs * 1000)}</em>}
          {f.left && (
            <em className={s.fwLeft} data-form-left={f.left.kind}>
              {f.left.kind === "closed" ? `Closed the page on the ${f.left.screen} screen` : f.left.kind === "google" ? "Went to Google" : f.left.kind === "checkout" ? "Went to Stripe's card page · not signed up yet" : f.left.kind === "done" ? "Account made" : "Left"}
              {f.left.kind === "closed" ? ` · ${durationWords(f.left.screenSecs * 1000)} on it${f.left.field ? ` · in ${f.left.field}` : ""}${f.left.awaySecs ? ` · after ${durationWords(f.left.awaySecs * 1000)} away` : ""}` : ""}
            </em>
          )}
          {verdict && <em className={s.fwVerdict} data-form-verdict={f.verdict} data-tone={verdict.tone}>{verdict.words}</em>}
        </span>
      )}
    </span>
  );
}
