"use client";

// ADMIN · OUTREACH — BLUEPRINT (2026-10-23). JobFlex's own AI desk calls contractors and tells them about JobFlex
// (lib/outreach). Paste a list; "Check lines" asks Twilio which numbers are landlines (the AI may call those); "Call the
// next 5" dials them in calling hours; the rest — cell phones, internet lines — get "Email the call-me link": one
// plain email whose link lets them ask for the call themselves. Every row opens the contractor: their line, why they
// are (or aren't) called, their consent as given, each call with its transcript, "don't call". A test call rings the
// admin's own phone with the script a contractor hears.
// 2026-10-25 "Find contractors": a trade in an area, so many a day — found online (Google's Places, their websites read
// for an email) and put on the list, every morning when asked; "On a schedule" works the list every hour on its own.
// 2026-10-31: under the Run buttons, why each grey one is grey (the owner never saw the box at the top of the page).
// Furniture: the partner-money kit (admin-influencers/admin-ui). The page is a server component: router.refresh().

import { useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { relative, shortDate } from "@/lib/format";
import { LINE_WORDS, OUTCOME_WORDS, emailDue, scheduleWords, type OutreachCall } from "@/lib/outreach/rules";
import type { OutreachReadiness } from "@/lib/outreach/server";
import type { OutreachSettings } from "@/lib/outreach/find";
import { HUNT_TRADES, PER_DAY_CHOICES, huntStatusWords, huntWords } from "@/lib/outreach/hunt";
import {
  allowOutreachUsCalls,
  callOutreachNext,
  callOutreachOne,
  checkOutreachLines,
  createOutreachHunt,
  emailOutreach,
  importOutreachList,
  outreachTestCall,
  removeOutreach,
  removeOutreachHunt,
  runOutreachHunt,
  setOutreachDnc,
  setOutreachHuntDaily,
  setOutreachChannels,
  setOutreachSchedule,
  type HuntView,
  type OutreachRow,
} from "@/actions/outreach";
import { Chip, Empty, KpiStrip, Meta, Sheet, type Tone, actionError, cx, useMdl, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./outreach.module.css";

type Funnel = { total: number; landlines: number; emailOnly: number; unchecked: number; called: number; reached: number; linkSent: number; interested: number; asked: number; dnc: number };

type Filter = "all" | "ai-call" | "email" | "check" | "called" | "interested" | "dnc";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ai-call", label: "AI calls" },
  { key: "email", label: "Email" },
  { key: "check", label: "Not checked" },
  { key: "called", label: "Called" },
  { key: "interested", label: "Interested" },
  { key: "dnc", label: "Don't call" },
];
const ROUTE: Record<OutreachRow["route"]["kind"], { label: string; tone: Tone }> = {
  "ai-call": { label: "AI calls", tone: "bp" },
  email: { label: "Email", tone: "wait" },
  check: { label: "Check line", tone: "mute" },
  none: { label: "No contact", tone: "mute" },
};
const last = (r: OutreachRow): OutreachCall | null => r.calls[r.calls.length - 1] ?? null;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Why each Run button is grey, in words: what the server lacks (readiness.missing, split as callProspect splits it),
 *  else what the list lacks — the landlines' reasons for waiting counted, the same words as each contractor's drawer. */
function idleWords(rows: OutreachRow[], readiness: OutreachReadiness, funnel: Funnel, callable: number, toEmail: number, callLabel: string): Array<{ key: string; button: string; why: string }> {
  const out: Array<{ key: string; button: string; why: string }> = [];
  if (rows.length && !funnel.unchecked) out.push({ key: "lines", button: "Check lines", why: "every number on the list is checked already." });
  if (!readiness.calls) out.push({ key: "call", button: callLabel, why: readiness.missing.filter((m) => !/mail|postal|^Texts/i.test(m)).join(" ") || "calls aren't set up." });
  else if (rows.length && !callable) {
    const held = new Map<string, number>();
    for (const r of rows) {
      const why = r.route.kind === "ai-call" ? (r.waitWhy ?? r.seqWhy ?? "").split(" — ")[0] : "";
      if (why) held.set(why, (held.get(why) ?? 0) + 1);
    }
    out.push({
      key: "call",
      button: callLabel,
      why: held.size
        ? `no one the AI may call right now: ${[...held].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} — ${lower(w)}`).join("; ")}.`
        : `no landline on the list — the AI cold-calls only landlines${funnel.emailOnly ? `; the ${funnel.emailOnly} cell phones and internet lines get the email, and are called once they ask` : ""}.`,
    });
  }
  if (!readiness.emails) out.push({ key: "email", button: "Email the call-me link", why: readiness.missing.filter((m) => /mail|postal/i.test(m)).join(" ") || "email isn't set up on this server." });
  else if (rows.length && !toEmail) out.push({ key: "email", button: "Email the call-me link", why: rows.some((r) => r.email) ? "everyone with an email address was written to already." : "no one on the list has an email address." });
  return out;
}
const match = (r: OutreachRow, f: Filter) =>
  f === "all" ? true : f === "called" ? r.calls.length > 0 : f === "interested" ? !!r.interest && r.interest.level !== "cold" : f === "dnc" ? !!r.dnc : r.route.kind === f;

export function AdminOutreachContent({ rows, readiness, funnel, hunts, settings, places }: { rows: OutreachRow[]; readiness: OutreachReadiness; funnel: Funnel; hunts: HuntView[]; settings: OutreachSettings; places: boolean }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState("");
  const [hunt, setHunt] = useState({ trade: "roofing", area: "", perDay: 10, daily: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [test, setTest] = useState({ phone: "", business: "Test Roofing", trade: "roofing" });
  const sheetRef = useRef<SheetHandle | null>(null);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => match(r, f.key)).length])) as Record<Filter, number>, [rows]);
  const shown = useMemo(() => rows.filter((r) => match(r, filter)), [rows, filter]);
  const callableCount = rows.filter((r) => r.route.kind === "ai-call" && !r.waitWhy && !r.seqWhy).length;
  const toEmail = rows.filter(emailDue).length;
  const callLabel = `Call the next ${Math.min(5, callableCount) || 5}`;
  const idle = idleWords(rows, readiness, funnel, callableCount, toEmail, callLabel);

  const run = async <R extends { ok: true } | { ok: false; error: string }>(key: string, fn: () => Promise<R>, words: (r: Extract<R, { ok: true }>) => string) => {
    setBusy(key);
    setSaid(null);
    try {
      const r = await fn();
      if (!r.ok) {
        toast.error((r as { ok: false; error: string }).error || "That didn't work.");
        return;
      }
      setSaid(words(r as Extract<R, { ok: true }>));
      router.refresh();
    } catch (err) {
      toast.error(actionError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={rootRef} className={styles.root} data-outreach>
      <div className="page-head rv">
        <div>
          <div className="kicker">Operate · Outreach</div>
          <h1 className="page-title">Outreach calls</h1>
        </div>
      </div>

      {readiness.missing.length ? (
        <section className={cx("card rv", styles.warn)} data-outreach-missing>
          <div className="card-title">Before the first call</div>
          <ul className={styles.missing}>
            {readiness.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {readiness.usCalls === false ? (
            <div className={styles.acts}>
              <button type="button" className={cx("btn btn-primary", busy === "allow" && ui.btnBusy)} disabled={!!busy} onClick={() => void run("allow", () => allowOutreachUsCalls(), () => "US calls are on for JobFlex's Twilio account. Try the call again.")} data-outreach-allow-us>
                Allow US calls on this account
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <KpiStrip
        cols={6}
        cells={[
          { label: "On the list", value: String(funnel.total) },
          { label: "Landlines", value: String(funnel.landlines), accent: true },
          { label: "Reached", value: String(funnel.reached) },
          { label: "Trial link sent", value: String(funnel.linkSent), tone: funnel.linkSent ? "ok" : undefined },
          { label: "Asked for a call", value: String(funnel.asked), tone: funnel.asked ? "ok" : undefined },
          { label: "Don't call", value: String(funnel.dnc), tone: funnel.dnc ? "warn" : undefined },
        ]}
      />

      <section className="card rv">
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">How it works</div>
            <div className="card-sub">The rules the phone law sets, built in.</div>
          </div>
        </div>
        <ol className={styles.how}>
          <li>
            <b>The email goes first,</b> to everyone with an address: one plain note in their trade&rsquo;s words — a roofer reads about measuring roofs from aerial imagery, a fence builder about drawing the fence on the map — with a &ldquo;Have the AI desk call me&rdquo; link.
          </li>
          <li>
            <b>Landlines then get the AI&rsquo;s call,</b> two days after the email (at once when there is no email). A business landline may get a call in an AI voice; a cell phone or a home line may not without the person&rsquo;s written consent. &ldquo;Check lines&rdquo; asks Twilio which is which (a fraction of a cent a number).
          </li>
          <li>
            <b>Cell phones are called and texted only once they ask:</b> whoever taps the email&rsquo;s link and ticks the box is called half a minute later, then gets one text in their trade&rsquo;s words with the free-trial link. No cold texts — the law and Twilio&rsquo;s rules forbid them, and they would cost JobFlex its texting number.
          </li>
          <li>
            <b>Calling hours:</b> 9&nbsp;am–8&nbsp;pm on their clock, Monday to Saturday; two calls at most. &ldquo;Don&rsquo;t call me&rdquo; on a call, or Unsubscribe in the email, ends it for good. The AI says it is a virtual assistant and that the call is recorded.
          </li>
          <li>Not legal advice — have a TCPA lawyer read this before the first run.</li>
        </ol>
      </section>

      <section className="card rv" data-outreach-hunts>
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">Find contractors</div>
            <div className="card-sub">Say the trade, the area and how many a day. JobFlex looks them up online, reads their websites for an email, leaves out anyone already on the list or on JobFlex, and puts the rest below — each pitched in the words of their trade. Every morning, if you like.</div>
          </div>
        </div>
        {!places ? (
          <p className={styles.said} data-outreach-hunt-missing>
            The search needs JobFlex&rsquo;s Google key on this server (GOOGLE_MAPS_API_KEY) with the Places API (New) turned on.
          </p>
        ) : null}
        <div className={styles.huntForm}>
          <label className={styles.field}>
            <span className={styles.lbl}>Trade</span>
            <select className={styles.in} value={hunt.trade} onChange={(e) => setHunt({ ...hunt, trade: e.target.value })} data-outreach-hunt-trade>
              {HUNT_TRADES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.lbl}>Where</span>
            <input className={styles.in} placeholder="Seattle, WA — or a whole state: California" title="A city and state, or a state on its own for its biggest cities, one after another" value={hunt.area} onChange={(e) => setHunt({ ...hunt, area: e.target.value })} data-outreach-hunt-area />
          </label>
          <label className={styles.field}>
            <span className={styles.lbl}>A day</span>
            <select className={styles.in} value={hunt.perDay} onChange={(e) => setHunt({ ...hunt, perDay: Number(e.target.value) })} data-outreach-hunt-per-day>
              {PER_DAY_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" role="switch" aria-checked={hunt.daily} className={styles.toggle} onClick={() => setHunt({ ...hunt, daily: !hunt.daily })} data-outreach-hunt-daily>
            <span className={cx(styles.switch, hunt.daily && styles.switchOn)} aria-hidden="true">
              <span className={styles.knob} />
            </span>
            <span className={styles.toggleText}>Every morning</span>
          </button>
          <button
            type="button"
            className={cx("btn btn-primary", busy === "hunt" && ui.btnBusy)}
            disabled={!!busy || !places || hunt.area.trim().length < 2}
            onClick={() =>
              void run("hunt", () => createOutreachHunt(hunt), (r) => {
                setHunt({ ...hunt, area: "" });
                return r.words;
              })
            }
            data-outreach-hunt-find
          >
            Find now
          </button>
        </div>
        {hunts.length ? (
          <div className={styles.hunts} data-outreach-hunt-list>
            {hunts.map((h) => (
              <div key={h.id} className={styles.hunt} data-outreach-hunt={h.id}>
                <div className={styles.huntMain}>
                  <div className={styles.huntTitle}>{huntWords(h)}</div>
                  <div className={cx(styles.huntSub, h.lastError && styles.huntErr)} data-outreach-hunt-status>
                    {huntStatusWords(h)}
                    {h.lastRunAt ? ` Last run ${relative(h.lastRunAt)}.` : ""}
                  </div>
                </div>
                <div className={styles.huntActs}>
                  <button type="button" role="switch" aria-checked={h.daily} className={styles.toggle} disabled={!!busy} onClick={() => void run(`daily-${h.id}`, () => setOutreachHuntDaily(h.id, !h.daily), () => (h.daily ? "This hunt runs only when pressed now." : "This hunt runs every morning now."))} data-outreach-hunt-toggle>
                    <span className={cx(styles.switch, h.daily && styles.switchOn)} aria-hidden="true">
                      <span className={styles.knob} />
                    </span>
                    <span className={styles.toggleText}>Every morning</span>
                  </button>
                  <button type="button" className={cx("btn", ui.btnSm, busy === `run-${h.id}` && ui.btnBusy)} disabled={!!busy || !places} onClick={() => void run(`run-${h.id}`, () => runOutreachHunt(h.id), (r) => r.words)} data-outreach-hunt-run>
                    Find now
                  </button>
                  <button type="button" className={cx("btn", ui.btnSm, ui.btnGhost, busy === `rm-${h.id}` && ui.btnBusy)} disabled={!!busy} onClick={() => void run(`rm-${h.id}`, () => removeOutreachHunt(h.id), () => "Hunt removed — the contractors it found stay on the list.")} data-outreach-hunt-remove>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card rv">
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">Add contractors</div>
            <div className="card-sub">Paste rows from a spreadsheet or a CSV: business, owner&rsquo;s name, phone, email, trade, state, city — any order, with or without a header row. Companies already on JobFlex are left out. Only for a list of your own — the contractors found above are on the list already.</div>
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.lbl} htmlFor="outreachList">
            The list
          </label>
          <textarea
            id="outreachList"
            className={cx(styles.in, styles.list)}
            rows={6}
            value={list}
            placeholder={"Business,Owner,Phone,Email,Trade,State\nSummit Roofing,Dana Lee,(206) 555-0142,dana@summitroof.com,Roofing,WA"}
            onChange={(e) => setList(e.target.value)}
            data-outreach-list
          />
        </div>
        <div className={styles.acts}>
          <button
            type="button"
            className={cx("btn btn-primary", busy === "import" && ui.btnBusy)}
            disabled={!!busy || !list.trim()}
            onClick={() => void run("import", () => importOutreachList(list), (r) => {
              setList("");
              return `Added ${r.added}${r.merged ? `, filled in ${r.merged} already on the list` : ""}${r.onJobflex ? `, left out ${r.onJobflex} already on JobFlex` : ""}${r.skipped ? `, skipped ${r.skipped} (no phone or email, or twice)` : ""}.`;
            })}
            data-outreach-import
          >
            Add to the list
          </button>
        </div>
      </section>

      <section className="card rv">
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">Run</div>
            <div className="card-sub">Each button does one batch; press again for the next.</div>
          </div>
        </div>
        <div className={styles.acts}>
          <button type="button" className={cx("btn", busy === "lines" && ui.btnBusy)} disabled={!!busy || !funnel.unchecked} onClick={() => void run("lines", () => checkOutreachLines(50), (r) => `Checked ${r.checked} number${r.checked === 1 ? "" : "s"}${r.left ? `; ${r.left} to go` : ""}${r.error ? ` — ${r.error}` : ""}.`)} data-outreach-check>
            Check lines{funnel.unchecked ? ` (${funnel.unchecked})` : ""}
          </button>
          <button type="button" className={cx("btn btn-primary", busy === "call" && ui.btnBusy)} disabled={!!busy || !readiness.calls || !callableCount} onClick={() => void run("call", () => callOutreachNext(5), (r) => `Calling ${r.placed}${r.failed ? `; ${r.failed} didn't go out (${r.errors.join("; ")})` : ""}${r.waiting ? `; ${r.waiting} more ready` : ""}.`)} data-outreach-call>
            {callLabel}
          </button>
          <button type="button" className={cx("btn", busy === "email" && ui.btnBusy)} disabled={!!busy || !readiness.emails || !toEmail} onClick={() => void run("email", () => emailOutreach(20), (r) => `Emailed ${r.sent}${r.skipped ? ` (${r.skipped} had unsubscribed)` : ""}${r.error ? ` — ${r.error}` : ""}.`)} data-outreach-email>
            Email the call-me link{toEmail ? ` (${Math.min(20, toEmail)})` : ""}
          </button>
        </div>
        {readiness.from ? (
          <p className={styles.from} data-outreach-from>
            Calls go from <b>{readiness.from.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")}</b>
            {readiness.texts ? " · the text after a call too" : ""}
          </p>
        ) : null}
        {idle.length && !busy ? (
          <ul className={styles.idle} data-outreach-idle>
            {idle.map((x) => (
              <li key={x.key} data-idle={x.key}>
                <b>{x.button}</b> is grey: {x.why}
              </li>
            ))}
          </ul>
        ) : null}
        {said ? (
          <p className={styles.said} role="status" data-outreach-said>
            {said}
          </p>
        ) : null}
        <div className={styles.test}>
          <div className={styles.testH}>Hear it first — call my phone</div>
          <div className={styles.testRow}>
            <input className={styles.in} aria-label="Your phone" placeholder="Your phone" inputMode="tel" value={test.phone} onChange={(e) => setTest({ ...test, phone: e.target.value })} data-outreach-test-phone />
            <input className={styles.in} aria-label="Pretend business" placeholder="Pretend business" value={test.business} onChange={(e) => setTest({ ...test, business: e.target.value })} />
            <input className={styles.in} aria-label="Trade" placeholder="Trade" value={test.trade} onChange={(e) => setTest({ ...test, trade: e.target.value })} />
            <button type="button" className={cx("btn", busy === "test" && ui.btnBusy)} disabled={!!busy || !readiness.calls || !test.phone.trim()} onClick={() => void run("test", () => outreachTestCall({ ...test, name: "" }), (r) => r.note)} data-outreach-test>
              Call me
            </button>
          </div>
        </div>
      </section>

      <section className="card rv" data-outreach-schedule-card>
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">On a schedule</div>
            <div className="card-sub" data-outreach-schedule-words>{scheduleWords(settings.channels, { emails: settings.emailsPerRun, calls: settings.callsPerRun, texts: settings.textsPerRun })}</div>
          </div>
        </div>
        <div className={styles.acts}>
          <button type="button" role="switch" aria-checked={settings.autoWork} className={cx(styles.toggle, styles.toggleBig)} disabled={!!busy} onClick={() => void run("schedule", () => setOutreachSchedule(!settings.autoWork), (r) => (r.settings.autoWork ? "On — the list is worked every hour from now on." : "Off — nothing goes out until you press the buttons above."))} data-outreach-schedule>
            <span className={cx(styles.switch, settings.autoWork && styles.switchOn)} aria-hidden="true">
              <span className={styles.knob} />
            </span>
            <span className={styles.toggleText}>{settings.autoWork ? "Working the list every hour" : "Off — by hand only"}</span>
          </button>
        </div>
        {/* What it sends (2026-10-25): email, calls, texts — any mix; how many of each an hour. */}
        <div className={styles.channels} role="group" aria-label="What the schedule sends" data-outreach-channels>
          {([
            { key: "email", label: "Email", per: "emailsPerRun", choices: [10, 20, 40], unit: "emails" },
            { key: "calls", label: "Calls", per: "callsPerRun", choices: [3, 5, 10, 20], unit: "calls" },
            { key: "texts", label: "Texts", per: "textsPerRun", choices: [10, 20, 50], unit: "texts" },
          ] as const).map((c) => {
            const on = settings.channels[c.key];
            const onCount = Number(settings.channels.email) + Number(settings.channels.calls) + Number(settings.channels.texts);
            return (
              <div key={c.key} className={cx(styles.channel, on && styles.channelOn)} data-channel={c.key} data-on={on}>
                <button type="button" role="switch" aria-checked={on} className={styles.toggle} disabled={!!busy || (on && onCount === 1)} title={on && onCount === 1 ? "Keep at least one on" : undefined} onClick={() => void run(`ch-${c.key}`, () => setOutreachChannels({ [c.key]: !on }), (r) => `${c.label} ${r.settings.channels[c.key] ? "on" : "off"} for the schedule.`)}>
                  <span className={cx(styles.switch, on && styles.switchOn)} aria-hidden="true">
                    <span className={styles.knob} />
                  </span>
                  <span className={styles.toggleText}>{c.label}</span>
                </button>
                <label className={styles.channelPer}>
                  <span>up to</span>
                  <select value={settings[c.per]} disabled={!!busy || !on} onChange={(e) => void run(`per-${c.key}`, () => setOutreachChannels({ [c.per]: Number(e.target.value) }), () => `Up to ${e.target.value} ${c.unit} an hour.`)} aria-label={`${c.label}: how many an hour`}>
                    {[...new Set([...c.choices, settings[c.per]])].sort((x, y) => x - y).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <span>an hour</span>
                </label>
                {c.key === "texts" ? <small className={styles.channelNote}>Only to contractors who agreed to texts — the law and the carriers ask for that.</small> : null}
              </div>
            );
          })}
        </div>
        {settings.lastWork ? (
          <p className={styles.from} data-outreach-schedule-last>
            Last hour&rsquo;s work: <b>{settings.lastWork}</b>
          </p>
        ) : null}
      </section>

      <section className="card rv">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Contractors</div>
            <div className="card-sub">Open one for their line, their consent and every call.</div>
          </div>
          <div className={ui.filters} role="group" aria-label="Filter contractors">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={cx(ui.filter, filter === f.key && ui.filterOn)} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                <i>{counts[f.key]}</i>
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty>{rows.length === 0 ? "No contractors yet — find some above, or paste a list." : "None here."}</Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Contractors">
            <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
              <span>Business</span>
              <span>Phone</span>
              <span>Line</span>
              <span>Next</span>
              <span>Last call</span>
            </div>
            {shown.map((r) => {
              const c = last(r);
              return (
                <button key={r.id} type="button" className={cx(ui.tr, ui.trBtn, styles.cols)} onClick={() => sheetRef.current?.open(r.id)} data-outreach-row={r.id} aria-label={`Open ${r.business || r.name || r.phone}`}>
                  <span className={ui.tdWide}>
                    <span className={ui.tdName}>{r.business || r.name || "—"}</span>
                    <span className={ui.tdSub}>{[r.name && r.business ? r.name : null, r.trade, r.source === "found" ? r.city : null, r.state, r.source === "found" ? "found online" : null].filter(Boolean).join(" · ") || " "}</span>
                  </span>
                  <span className={styles.cell}>
                    <span className={ui.tdLbl}>Phone</span>
                    {r.phone ?? r.email ?? "—"}
                  </span>
                  <span className={styles.cell}>
                    <span className={ui.tdLbl}>Line</span>
                    {r.line ? LINE_WORDS[r.line.type] : "—"}
                  </span>
                  <span>
                    <span className={ui.tdLbl}>Next</span>
                    {r.dnc ? <Chip tone="bad">Don&rsquo;t call</Chip> : <Chip tone={ROUTE[r.route.kind].tone}>{ROUTE[r.route.kind].label}</Chip>}
                    {r.consent ? <Meta>asked</Meta> : null}
                  </span>
                  <span className={styles.cell}>
                    <span className={ui.tdLbl}>Last call</span>
                    {c ? `${c.outcome ? OUTCOME_WORDS[c.outcome] : c.status === "calling" ? "Calling…" : c.status} · ${relative(c.at)}` : r.emailedAt ? `Emailed ${shortDate(r.emailedAt)}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <ProspectSheet handleRef={sheetRef} rows={rows} onChanged={() => router.refresh()} />
    </div>
  );
}

type SheetHandle = { open: (id: string) => void };

/** One contractor, by id — read from the list each render, so a refresh after an action shows the new state. */
function ProspectSheet({ handleRef, rows, onChanged }: { handleRef: React.RefObject<SheetHandle | null>; rows: OutreachRow[]; onChanged: () => void }) {
  const { ref, open, close } = useMdl();
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useImperativeHandle(handleRef, () => ({
    open: (next: string) => {
      setId(next);
      setError(null);
      open();
    },
  }), [open]);
  const row = id ? (rows.find((x) => x.id === id) ?? null) : null;
  const done = () => close();
  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work.");
      else onChanged();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(null);
    }
  };
  const r = row;
  return (
    <Sheet
      mdlRef={ref}
      title={r ? r.business || r.name || "Contractor" : "Contractor"}
      titleId="outreachSheetTitle"
      size="drawer"
      onClose={done}
      error={error}
      foot={
        r ? (
          <>
            <button type="button" className={cx("btn btn-primary", busy === "call" && ui.btnBusy)} disabled={!!busy || r.route.kind !== "ai-call" || !!r.waitWhy} onClick={() => void act("call", () => callOutreachOne(r.id))} data-outreach-call-one>
              Call now
            </button>
            <button type="button" className={cx("btn", busy === "dnc" && ui.btnBusy)} disabled={!!busy} onClick={() => void act("dnc", () => setOutreachDnc(r.id, !r.dnc))} data-outreach-dnc>
              {r.dnc ? "Allow calls again" : "Don’t call"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void act("remove", async () => { const x = await removeOutreach(r.id); if (x.ok) done(); return x; })}>
              Remove
            </button>
          </>
        ) : null
      }
    >
      {r ? (
        <div className={styles.sheet} data-outreach-sheet={r.id}>
          <div className={ui.facts}>
            <div className={ui.fact}>
              <div className={ui.factL}>Owner</div>
              <div className={ui.factV}>{r.name || "—"}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Trade · place</div>
              <div className={ui.factV}>{[r.trade, r.city, r.state].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Phone</div>
              <div className={ui.factV}>{r.phone ?? "—"}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Line</div>
              <div className={ui.factV}>{r.line ? `${LINE_WORDS[r.line.type]}${r.line.carrier ? ` · ${r.line.carrier}` : ""}` : "not checked"}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Email</div>
              <div className={ui.factV}>{r.email ?? "—"}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Emailed</div>
              <div className={ui.factV}>{r.emailedAt ? shortDate(r.emailedAt) : "—"}</div>
            </div>
            {r.website || r.source === "found" ? (
              <div className={ui.fact}>
                <div className={ui.factL}>Website</div>
                <div className={ui.factV}>
                  {r.website ? (
                    <a href={r.website} target="_blank" rel="noopener noreferrer" data-outreach-website>
                      {r.website.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    "—"
                  )}
                  {r.source === "found" ? <Meta> · found online</Meta> : null}
                </div>
              </div>
            ) : null}
          </div>
          <p className={styles.why} data-outreach-why>
            <b>{r.dnc ? "Never called again" : ROUTE[r.route.kind].label}:</b> {r.dnc ? `asked ${r.dnc.via === "email" ? "by unsubscribing" : r.dnc.via === "call" ? "on a call" : "— marked here"} ${relative(r.dnc.at)}` : r.route.why}
            {r.waitWhy && r.route.kind === "ai-call" ? ` · ${r.waitWhy}` : ""}
            {!r.waitWhy && r.seqWhy && r.route.kind === "ai-call" ? ` · ${r.seqWhy} (Call now doesn’t wait)` : ""}
          </p>
          {r.consent ? (
            <div className={styles.consent} data-outreach-consent>
              <div className={styles.subH}>Their consent</div>
              <p>
                &ldquo;{r.consent.text}&rdquo;
              </p>
              <Meta>
                Ticked {new Date(r.consent.at).toLocaleString("en-US")} · {r.consent.page}
                {r.consent.ip ? ` · ${r.consent.ip}` : ""}
              </Meta>
            </div>
          ) : null}
          {r.interest ? (
            <p className={styles.why}>
              <b>How it went:</b> {r.interest.level} — {r.interest.note}
              {r.interest.callBack ? ` · call back ${r.interest.callBack}` : ""}
            </p>
          ) : null}
          {r.textedAt ? (
            <p className={styles.why}>
              <b>Texted</b> the trial link {relative(r.textedAt)}
            </p>
          ) : null}
          {r.linkSentTo ? (
            <p className={styles.why}>
              <b>Trial link</b> emailed to {r.linkSentTo} {r.linkSentAt ? relative(r.linkSentAt) : ""}
            </p>
          ) : null}
          <div className={styles.subH}>Calls</div>
          {r.calls.length ? (
            r.calls
              .slice()
              .reverse()
              .map((c, i) => (
                <div key={`${c.at}-${i}`} className={styles.call} data-outreach-call-row>
                  <div className={styles.callHead}>
                    <b>{c.outcome ? OUTCOME_WORDS[c.outcome] : c.status === "calling" ? "Calling…" : c.status}</b>
                    <Meta>
                      {new Date(c.at).toLocaleString("en-US")} · {c.seconds ? `${Math.round(c.seconds)} s` : "—"}
                      {c.answeredBy ? ` · ${c.answeredBy}` : ""}
                    </Meta>
                  </div>
                  {c.error ? <p className={styles.callErr}>{c.error}</p> : null}
                  {c.transcript ? <pre className={styles.transcript}>{c.transcript}</pre> : null}
                </div>
              ))
          ) : (
            <Empty>Not called yet.</Empty>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
