"use client";

// SETTINGS → SMARTBOOK (2026-10-31, Batch 3) — desk and phone mount this one form; it loads and saves itself
// (actions/smartBookOffice), as the Website estimators form does.
//
// Owner: "make it super smart, convenient … easy for clients and easy for contractors. And very understandable." So
// the form says what SmartBook does in a line, then the owner's choices in the order they think of them — which leads,
// how it reaches them, the visit it offers, what to do with a time the customer names, the first text (with the text
// itself under it, as the customer gets it) — then the words for the Facebook form's texts box, and Send me a test.
import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarCheck } from "lucide-react";
import { loadSmartBookSettings, saveSmartBook, sendSmartBookTest, type SmartBookSettingsView } from "@/actions/smartBookOffice";
import { FIRST_MESSAGE_MAX, type SmartBookSettings, type SmartBookSources } from "@/lib/smartbook/settings";
import { firstText } from "@/lib/smartbook/words";
import styles from "./smartbook.module.css";

const SOURCES: Array<{ key: keyof SmartBookSources; name: string; sub: string }> = [
  { key: "facebook", name: "Facebook and Instagram lead forms", sub: "They come in by themselves every few minutes — saving with this on turns on “New leads come in by themselves” for your Page." },
  { key: "website", name: "Your website estimators", sub: "Every one already asks the homeowner's yes to calls, texts and email." },
  { key: "jobflex", name: "JobFlex Lead Center", sub: "Leads JobFlex sends you, once you accept them." },
  { key: "desk", name: "Messages left with the AI desk", sub: "A caller who left a message and a number." },
  { key: "other", name: "Leads you add or import", sub: "Off at first — imports are often old lists. Use Offer times on the lead instead." },
];

const TOKENS = ["{first name}", "{company}", "{service}", "{times}"] as const;

/** A sample for the preview when the calendar has nothing open right now. */
const SAMPLE_TIMES = "1) Tue Nov 4, 10am–12pm; 2) Wed Nov 5, 1–3pm; 3) Thu Nov 6, 8–10am";

/** What the owner can do about a call that can't go yet — or that JobFlex is on it (lib/aiDesk/leadCalls leadCallReadiness). */
function CallFix({ why }: { why: string }) {
  if (/number|business|minutes/.test(why)) return <>Open the <a href="/dashboard/phone">AI desk</a> page.</>;
  if (/plan|month's calls/.test(why)) return <>See <a href="/dashboard/upgrade">Plans &amp; upgrade</a>.</>;
  return <>That&rsquo;s on JobFlex&rsquo;s side — nothing to do on yours.</>;
}

export function SmartBookSettingsForm({ mobile = false, onOpen }: { mobile?: boolean; onOpen?: (where: "notifications" | "meta") => void }) {
  const [view, setView] = useState<SmartBookSettingsView | null>(null);
  const [s, setS] = useState<SmartBookSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; line: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"save" | "test" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    void loadSmartBookSettings().then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setView(r.view);
      setS(r.view.settings);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loadError) return <p className={styles.err} role="alert">{loadError}</p>;
  if (!view || !s) return <p className={styles.help}>Loading…</p>;

  const p = view.preview;
  const set = (patch: Partial<SmartBookSettings>) => {
    setS({ ...s, ...patch });
    setSaved(null);
    setError(null);
  };
  const dirty = JSON.stringify({ ...s, onSince: null }) !== JSON.stringify({ ...view.settings, onSince: null });
  const company = p.company;
  const vars = { first: "Alex", company, project: null, visit: p.visitNoun, free: p.free, times: p.times || SAMPLE_TIMES, count: p.count || 3, link: p.link };
  const preview = firstText(vars, s.firstMessage);
  const cut = !!s.firstMessage && preview.includes("…");
  const consentText = `Yes, ${company} may text me about my request, including to schedule a visit. Msg & data rates may apply. Reply STOP to opt out.`;
  const consentCall = `Yes, ${company} may call me about my request, including with an automated assistant.`;

  const save = () =>
    start(async () => {
      setWhich("save");
      const r = await saveSmartBook({ ...s, firstMessage: s.firstMessage?.trim() || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setView({ ...view, settings: r.settings, facebook: { ...view.facebook, auto: r.facebookAuto } });
      setS(r.settings);
      setSaved(r.settings.on ? "Saved — SmartBook is answering new leads." : "Saved. SmartBook is off — turn it on at the top when you're ready.");
    });
  const sendTest = () =>
    start(async () => {
      setWhich("test");
      setTest(null);
      const r = await sendSmartBookTest();
      setTest(r.ok ? { ok: true, line: r.line } : { ok: false, line: r.error });
    });
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800);
    } catch {
      /* the words stay selectable */
    }
  };
  const insert = (token: string) => {
    const el = area.current;
    const cur = s.firstMessage ?? "";
    const at = el ? el.selectionStart : cur.length;
    const end = el ? el.selectionEnd : cur.length;
    const next = `${cur.slice(0, at)}${token}${cur.slice(end)}`.slice(0, FIRST_MESSAGE_MAX);
    set({ firstMessage: next });
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  return (
    <section className={`${styles.sb}${mobile ? ` ${styles.mobile}` : ""}`} data-nest data-smartbook-settings aria-labelledby="sbSetT">
      <div className={styles.head}>
        <div className={styles.brand}>
          <CalendarCheck size={22} aria-hidden="true" />
          <h2 className={styles.title} id="sbSetT">
            Times for new leads
          </h2>
          <span className={styles.stamp} data-tone={view.settings.on ? "emerald" : undefined} data-smartbook-state>
            {view.settings.on ? "On" : "Off"}
          </span>
        </div>
        <label className={styles.switchRow} data-tour="smartbook:on">
          <button className={styles.tg} type="button" role="switch" aria-checked={s.on} aria-label="SmartBook answers new leads" data-smartbook-on onClick={() => set({ on: !s.on })} />
          {s.on ? "Answers new leads" : "Off"}
        </label>
      </div>

      <div className={styles.body}>
        <div className={styles.sec}>
          <p className={styles.lead}>
            A new lead gets {s.offers} open times from your calendar by text and email, in a minute. They tap one and they&rsquo;re booked. If they name their own
            time, SmartBook says &ldquo;let me check&rdquo; and asks you — answer YES or NO by text, and it tells them.
          </p>
          {!p.bookingOn ? (
            <p className={styles.warn}>
              Online booking is off. SmartBook offers the open hours you set there — <a href="/dashboard/booking">turn on Online booking</a> first.
            </p>
          ) : !p.count ? (
            <p className={styles.warn}>Nothing is open on your calendar in the next {p.horizonDays} days, so a lead would be asked to wait while SmartBook asks you. Check your hours in <a href="/dashboard/booking">Online booking</a>.</p>
          ) : null}
          {s.on && !view.settings.on ? <p className={styles.note}>Leads that came in before you turn it on are left alone — use Offer times on a lead for those.</p> : null}
          {!s.on && view.settings.on ? <p className={styles.note}>Turning it off stops new leads. Conversations already going finish — pause one on its lead page.</p> : null}
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>Which leads</h3>
          <div className={styles.checks}>
            {SOURCES.map((x) => (
              <label key={x.key} className={styles.check} data-on={s.sources[x.key] ? "true" : undefined}>
                <input className={styles.box} type="checkbox" checked={s.sources[x.key]} onChange={(e) => set({ sources: { ...s.sources, [x.key]: e.target.checked } })} data-smartbook-source={x.key} />
                <span className={styles.checkT}>
                  <span className={styles.checkN}>{x.name}</span>
                  <span className={styles.checkS}>{x.sub}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>How it reaches them</h3>
          <div className={styles.checks}>
            <label className={styles.check} data-on={s.text ? "true" : undefined}>
              <input className={styles.box} type="checkbox" checked={s.text} onChange={(e) => set({ text: e.target.checked })} data-smartbook-text />
              <span className={styles.checkT}>
                <span className={styles.checkN}>Text</span>
                <span className={styles.checkS}>Only to people who said yes to texts — the box on your Facebook form, your website form, or &ldquo;Text me&rdquo; on their SmartBook page. From your company&rsquo;s number; STOP always works.</span>
              </span>
            </label>
            <label className={styles.check} data-on={s.email ? "true" : undefined}>
              <input className={styles.box} type="checkbox" checked={s.email} onChange={(e) => set({ email: e.target.checked })} data-smartbook-email />
              <span className={styles.checkT}>
                <span className={styles.checkN}>Email</span>
                <span className={styles.checkS}>A button for each time. Everyone with an email gets it, and it offers texts to those who haven&rsquo;t said yes.</span>
              </span>
            </label>
            <label className={styles.check} data-on={s.call ? "true" : undefined}>
              <input className={styles.box} type="checkbox" checked={s.call} onChange={(e) => set({ call: e.target.checked })} data-smartbook-call />
              <span className={styles.checkT}>
                <span className={styles.checkN}>One AI call if there&rsquo;s no answer in 2 business hours</span>
                <span className={styles.checkS}>
                  Your AI desk calls once from your number, 9 AM–7 PM Monday to Saturday, only people who agreed to calls — and never someone the desk already called. It offers the times and books one. A voicemail gets a short message, nothing booked. Uses your desk minutes
                  {view.call.minutesLeft !== null ? ` (${view.call.minutesLeft} left this month)` : ""}.
                </span>
              </span>
            </label>
          </div>
          {s.call && view.call.blocked ? (
            <p className={styles.warn} data-smartbook-call-blocked>
              SmartBook can&rsquo;t call yet: {view.call.blocked} Until then it follows up by text and email. <CallFix why={view.call.blocked} />
            </p>
          ) : null}
          {s.text && !p.textingNumber ? <p className={styles.warn}>No texting number yet — SmartBook emails until you get one in <a href="/dashboard/texting">Texting</a>.</p> : null}
          {s.text && view.textsUsed ? <p className={styles.warn}>This month&rsquo;s texts are used — SmartBook goes on by email until next month.</p> : null}
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>The visit it offers</h3>
          <div className={styles.fields}>
            <label className={`${styles.field} ${styles.fieldGrow}`}>
              <span className={styles.fieldL}>Visit type</span>
              <select className={styles.select} value={s.serviceKey ?? ""} onChange={(e) => set({ serviceKey: e.target.value || null })} data-smartbook-visit>
                <option value="">{p.visits.find((v) => v.key === p.defaultVisit)?.label ?? "Your first estimate visit"} (default)</option>
                {p.visits
                  .filter((v) => v.key !== p.defaultVisit)
                  .map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
              </select>
            </label>
            <div className={styles.field}>
              <span className={styles.fieldL}>Times in each message</span>
              <div className={styles.seg} role="group" aria-label="Times in each message">
                {[2, 3, 4].map((n) => (
                  <button key={n} type="button" aria-pressed={s.offers === n} onClick={() => set({ offers: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className={styles.help}>The times come from your Online booking hours — the soonest open one, another day, the other half of the day — and never one already offered to someone else.</p>
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>When a customer names their own time</h3>
          <div className={styles.radios} role="radiogroup" aria-label="When a customer names their own time">
            <label className={styles.radio} data-on={s.ownTime === "ask" ? "true" : undefined}>
              <input className={styles.dot} type="radio" name="sbOwnTime" checked={s.ownTime === "ask"} onChange={() => set({ ownTime: "ask" })} />
              <span className={styles.checkT}>
                <span className={styles.checkN}>Ask me first</span>
                <span className={styles.checkS}>SmartBook tells them &ldquo;let me check&rdquo; and texts and emails you. Answer YES, NO or another time — it books it or goes back to them.</span>
              </span>
            </label>
            <label className={styles.radio} data-on={s.ownTime === "auto" ? "true" : undefined}>
              <input className={styles.dot} type="radio" name="sbOwnTime" checked={s.ownTime === "auto"} onChange={() => set({ ownTime: "auto" })} />
              <span className={styles.checkT}>
                <span className={styles.checkN}>Book it if my calendar is free, then tell me</span>
                <span className={styles.checkS}>A time inside your hours with nothing on the calendar is booked at once. Anything else still comes to you.</span>
              </span>
            </label>
          </div>
          <p className={styles.help}>
            Requests go to everyone who keeps <b>SmartBook requests</b> on in{" "}
            {onOpen ? (
              <button className={styles.linkBtn} type="button" onClick={() => onOpen("notifications")}>
                Notifications
              </button>
            ) : (
              "Notifications"
            )}
            , and they show on your Calendar.
          </p>
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>The first text</h3>
          <div className={styles.tokens} aria-label="Insert into the message">
            {TOKENS.map((t) => (
              <button key={t} className={styles.token} type="button" onClick={() => insert(t)}>
                {t}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldL}>In your words (optional)</span>
            <textarea
              ref={area}
              className={styles.area}
              value={s.firstMessage ?? ""}
              maxLength={FIRST_MESSAGE_MAX}
              placeholder={`Leave empty for SmartBook's words. Or write your own, like: Hi {first name}, it's {company}! We can come out for a free estimate: {times}`}
              onChange={(e) => set({ firstMessage: e.target.value || null })}
              data-smartbook-first
            />
          </label>
          <div className={styles.preview}>
            <span className={styles.label}>What a new lead named Alex gets</span>
            <p className={styles.bubble} data-smartbook-preview>
              {preview}
            </p>
            <div className={styles.bubbleMeta}>
              <span>{preview.length} of 320 characters — one text</span>
              {s.firstMessage ? (
                <button className={`${styles.btn} ${styles.btnQuiet}`} type="button" onClick={() => set({ firstMessage: null })}>
                  Use SmartBook&rsquo;s words
                </button>
              ) : null}
            </div>
            {cut ? <p className={styles.warn}>Your words are too long for one text with the times, the link and STOP — the end is cut (…). Shorten them a little.</p> : null}
            {!p.count ? <p className={styles.help}>Sample times — your calendar has nothing open right now.</p> : null}
          </div>
          <p className={styles.help}>The link opens their own page with every open time and &ldquo;Suggest a time&rdquo;. The email says the same, with a button for each time.</p>
        </div>

        <div className={styles.sec}>
          <h3 className={styles.secH}>The texts box on your Facebook form</h3>
          <p className={styles.secS}>SmartBook texts a Facebook lead only when they tick a texts box on your lead form; everyone else gets the email. Add this box once:</p>
          <div className={styles.copy} data-tour="smartbook:consent">
            <span className={styles.copyT} data-smartbook-consent>{consentText}</span>
            <button className={styles.copyB} type="button" onClick={() => void copy("text", consentText)}>
              {copied === "text" ? "Copied" : "Copy"}
            </button>
          </div>
          <ol className={styles.steps}>
            <li>In Meta Ads Manager, open your lead form — a published form can&rsquo;t be changed, so duplicate it.</li>
            <li>Under Privacy, add a custom disclaimer, then add a checkbox with these words. Leave it optional.</li>
            <li>Publish the copy and use it in your ads. SmartBook sees the box within a few hours.</li>
          </ol>
          <details>
            <summary className={styles.help}>For SmartBook&rsquo;s call, a second box</summary>
            <div className={styles.copy}>
              <span className={styles.copyT}>{consentCall}</span>
              <button className={styles.copyB} type="button" onClick={() => void copy("call", consentCall)}>
                {copied === "call" ? "Copied" : "Copy"}
              </button>
            </div>
          </details>
          <p className={styles.help}>The call goes only to Facebook leads who tick the calls box; website and Lead Center leads already agreed to calls.</p>
          {view.facebook.connected && !view.facebook.auto && s.on && s.sources.facebook ? (
            <p className={styles.warn} data-smartbook-fb-auto>
              New Facebook leads come in by themselves only while &ldquo;New leads come in by themselves&rdquo; is on — Save turns it on.{" "}
              {onOpen ? (
                <button className={styles.linkBtn} type="button" onClick={() => onOpen("meta")}>
                  See it in Integrations → Meta business
                </button>
              ) : null}
            </p>
          ) : null}
          {view.facebook.connected ? (
            view.facebook.forms !== null ? (
              <p className={view.facebook.withTexts ? styles.note : styles.warn} data-smartbook-forms>
                {view.facebook.withTexts ?? 0} of your {view.facebook.forms} Facebook form{view.facebook.forms === 1 ? "" : "s"} {view.facebook.withTexts === 1 ? "has" : "have"} the texts box.
              </p>
            ) : (
              <p className={styles.note}>Your Page is connected — SmartBook checks its forms within a few minutes.</p>
            )
          ) : (
            <p className={styles.note}>
              Facebook isn&rsquo;t connected yet.{" "}
              {onOpen ? (
                <button className={styles.linkBtn} type="button" onClick={() => onOpen("meta")}>
                  Connect it in Integrations → Meta business
                </button>
              ) : (
                "Connect it in Integrations → Meta business."
              )}
            </p>
          )}
        </div>

        <div className={styles.foot}>
          <div className={styles.acts}>
            <button className={`${styles.btn} ${styles.btnP}`} type="button" disabled={pending || !dirty} aria-busy={pending && which === "save" ? "true" : undefined} onClick={save} data-smartbook-save>
              {pending && which === "save" ? "Saving…" : "Save"}
            </button>
            <button className={styles.btn} type="button" disabled={pending || dirty} aria-busy={pending && which === "test" ? "true" : undefined} onClick={sendTest} data-smartbook-test data-tour="smartbook:test">
              {pending && which === "test" ? "Sending…" : "Send me a test"}
            </button>
          </div>
          <p className={styles.help}>
            {dirty
              ? "Save first — the test uses your saved settings."
              : `The test plays you as a new lead: ${[view.me.phone ? `a text to ${view.me.phone}` : null, view.me.email ? `an email to ${view.me.email}` : null].filter(Boolean).join(" and ") || "verify your mobile in Notifications to get it"}. Nothing is booked.`}
          </p>
          {error ? <p className={styles.err} role="alert">{error}</p> : null}
          {saved ? <p className={styles.ok} role="status">{saved}</p> : null}
          {test ? (
            <p className={test.ok ? styles.ok : styles.err} role={test.ok ? "status" : "alert"} data-smartbook-test-result>
              {test.line}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
