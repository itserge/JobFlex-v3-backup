"use client";

// BOOK A VISIT (2026-09-23) — the customer's four steps: the service, the
// time, who and where (with the one or two questions that matter for that
// visit), the receipt. Everything the shop set up is in `services`; the
// open times come from the calendar through bookingAvailability.
// Styled by ../book-public.css (2026-10-28): every class here is `jfb-*` under `.jf-book`.
// Second pass the same day (owner): the days as a calendar, the times grouped by part of the day, the choices so
// far in one "Your visit" panel with a Change on each line, a field under "Other" and a custom budget, Back on
// every step, and the receipt joined to the sheet instead of a card inside it.

import { bookingConsentText } from "@/lib/sms/registrationShared";
import { useState, useTransition } from "react";
import { bookingAvailability, createBookingPublic, type PublicDay } from "@/actions/booking";
import type { BookingService } from "@/lib/booking";

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-30" → a UTC date, so the calendar never shifts a day with the visitor's own zone. */
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const key = (d: Date) => d.toISOString().slice(0, 10);
/** A question whose answer is money gets a "Custom amount" field beside its ranges. */
const isBudget = (label: string, k: string) => /budget/i.test(label) || /budget/i.test(k);
const CUSTOM = "Custom amount";

/**
 * The open days as a month calendar: whole weeks from the first open day to the last, a closed day drawn and not
 * pressable, an open one a large tap target with how many times it has. Shared with the customer's manage link.
 */
export function DayPicker({ days, day, onDay }: { days: PublicDay[]; day: string | null; onDay: (d: string) => void }) {
  if (!days.length) return null;
  const open = new Map(days.map((d) => [d.day, d]));
  const first = utc(days[0].day);
  const last = utc(days[days.length - 1].day);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(last);
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
  const cells: Date[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) cells.push(new Date(d));
  const span = first.getUTCMonth() === last.getUTCMonth() ? `${MONTH[first.getUTCMonth()]} ${first.getUTCFullYear()}` : `${MONTH[first.getUTCMonth()]} – ${MONTH[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  return (
    <div className="jfb-cal" data-book-days>
      <div className="jfb-cal-h">
        <span className="jfb-cal-m">{span}</span>
      </div>
      <div className="jfb-cal-g" role="grid" aria-label="Pick a day">
        {WEEK.map((w) => (
          <span key={w} className="jfb-cal-w" role="columnheader">{w}</span>
        ))}
        {cells.map((c) => {
          const k = key(c);
          const d = open.get(k);
          // The first cell and each month's 1st name their month (hidden on a phone, where the header says it).
          const label = (
            <>
              {c.getUTCDate() === 1 || k === key(start) ? <em className="jfb-cal-mo">{MONTH[c.getUTCMonth()]} </em> : null}
              {c.getUTCDate()}
            </>
          );
          if (!d) {
            return (
              <span key={k} className="jfb-cal-d is-off" aria-hidden="true">
                <span className="jfb-cal-num">{label}</span>
              </span>
            );
          }
          return (
            <button
              key={k}
              type="button"
              role="gridcell"
              aria-selected={day === k}
              aria-label={`${d.weekday} ${MONTH[c.getUTCMonth()]} ${c.getUTCDate()}, ${d.slots.length} open`}
              onClick={() => onDay(k)}
              className={`jfb-cal-d${day === k ? " is-on" : ""}`}
            >
              <span className="jfb-cal-num">{label}</span>
              <span className="jfb-cal-open">{d.slots.length} open</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The day's times under Morning / Afternoon / Evening, read off each label's own first clock time. */
export function SlotGroups({ slots, onSlot, disabled, attr }: { slots: Array<{ iso: string; label: string }>; onSlot: (s: { iso: string; label: string }) => void; disabled?: boolean; attr: "book" | "manage" | "pick" }) {
  const hourOf = (label: string) => {
    const m = label.match(/(\d{1,2})(?::\d{2})?\s*([AP]M)/i);
    if (!m) return 12;
    const h = Number(m[1]) % 12;
    return m[2].toUpperCase() === "PM" ? h + 12 : h;
  };
  const groups = [
    { name: "Morning", items: slots.filter((s) => hourOf(s.label) < 12) },
    { name: "Afternoon", items: slots.filter((s) => hourOf(s.label) >= 12 && hourOf(s.label) < 17) },
    { name: "Evening", items: slots.filter((s) => hourOf(s.label) >= 17) },
  ].filter((g) => g.items.length);
  return (
    <div className="jfb-times" {...{ [`data-${attr}-slots`]: "" }}>
      {groups.map((g) => (
        <div key={g.name} className="jfb-times-g">
          <div className="jfb-times-k">{g.name}</div>
          <div className="jfb-slots">
            {g.items.map((s) => (
              <button key={s.iso} type="button" onClick={() => onSlot(s)} disabled={disabled} className="jfb-slot">{s.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BackIcon() {
  return (
    <svg className="jfb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
  );
}

export function BookWizard({ slug, orgName, services, intro, arrivalWindow }: { slug: string; orgName: string; services: BookingService[]; intro?: string; arrivalWindow: number }) {
  const [service, setService] = useState<BookingService | null>(null);
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ iso: string; label: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // What was typed under "Other" or "Custom amount", per question.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "", smsOk: false });
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState<{ when: string; serviceLabel: string; member: boolean; priceText: string; manageToken: string } | null>(null);
  const [pending, start] = useTransition();

  // Picking a service asks the calendar for its open times — in the click,
  // not an effect, so nothing re-runs behind the customer's back.
  const pickService = (s: BookingService) => {
    setService(s);
    setDays(null);
    setDay(null);
    setSlot(null);
    setErr("");
    start(async () => {
      const r = await bookingAvailability(slug, s.key);
      if (r.ok) {
        setDays(r.days);
        setDay(r.days[0]?.day ?? null);
      } else setErr(r.error);
    });
  };

  // An "Other" or a custom amount reads as what was typed; an empty one still reads as the choice itself.
  const answerOf = (k: string) => {
    const a = answers[k] ?? "";
    const t = (typed[k] ?? "").trim();
    if (a === "Other" && t) return `Other: ${t}`;
    if (a === CUSTOM && t) return `About $${t.replace(/^\$/, "")}`;
    return a;
  };

  const step = receipt ? 4 : !service ? 1 : !slot ? 2 : 3;
  const submit = () => {
    if (!service || !slot) return;
    setErr("");
    start(async () => {
      const r = await createBookingPublic(slug, {
        serviceKey: service.key,
        startsAtISO: slot.iso,
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        notes: form.notes,
        smsOk: form.smsOk,
        answers: (service.questions ?? []).map((q) => ({ key: q.key, label: q.label, value: answerOf(q.key) })).filter((a) => a.value),
      });
      if (r.ok) setReceipt(r);
      else setErr(r.error);
    });
  };
  const dayOf = day ? days?.find((d) => d.day === day) : null;

  return (
    <div className="jfb-wizard" data-book-step={step}>
      <ol className="jfb-steps" aria-label="Steps">
        {["Service", "Time", "Details", "Booked"].map((s, i) => (
          <li key={s} className={`jfb-step${i + 1 === step ? " is-on" : i + 1 < step ? " is-done" : ""}`} aria-current={i + 1 === step ? "step" : undefined}>
            <span className="jfb-step-n">{i + 1 < step ? "✓" : i + 1}</span>
            <span className="jfb-step-l">{s}</span>
          </li>
        ))}
      </ol>

      {/* Your visit so far — each choice on its own line with its own way back. */}
      {(step === 2 || step === 3) && service && (
        <dl className="jfb-sum">
          <div className="jfb-sum-r">
            <dt>Service</dt>
            <dd>{service.label}<small>{service.priceText} · {hours(service.minutes)}</small></dd>
            <button type="button" className="jfb-sum-x" onClick={() => setService(null)}>Change</button>
          </div>
          {step === 3 && slot && (
            <div className="jfb-sum-r">
              <dt>Time</dt>
              <dd>{slot.label}{dayOf ? <small>{dayOf.weekday} {MONTH[utc(dayOf.day).getUTCMonth()]} {utc(dayOf.day).getUTCDate()}</small> : null}</dd>
              <button type="button" className="jfb-sum-x" onClick={() => setSlot(null)}>Change</button>
            </div>
          )}
        </dl>
      )}

      {step === 1 && (
        <>
          {intro && <p className="jfb-intro">{intro}</p>}
          <h2 className="jfb-h2">What do you need?</h2>
          <div className="jfb-services" data-book-services>
            {services.map((s) => (
              <button key={s.key} type="button" onClick={() => pickService(s)} className="jfb-service" data-book-service={s.key}>
                <span className="jfb-service-top">
                  <span className="jfb-service-n">{s.label}</span>
                  <span className="jfb-service-h">{hours(s.minutes)}</span>
                </span>
                {s.urgent ? <span className="jfb-urgent">today / tomorrow</span> : null}
                <span className="jfb-service-p">
                  {s.priceText}
                  {s.memberPriceText ? <em> · members: {s.memberPriceText.toLowerCase()}</em> : null}
                </span>
                {s.description && <span className="jfb-service-d">{s.description}</span>}
                <span className="jfb-service-go" aria-hidden="true">Choose<svg className="jfb-ic" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg></span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && service && (
        <>
          <h2 className="jfb-h2">Pick a day</h2>
          {!days ? (
            <p className="jfb-wait" aria-live="polite">Checking the calendar…</p>
          ) : days.length === 0 ? (
            <p className="jfb-state">Nothing open in the next few weeks — please call {orgName}.</p>
          ) : (
            <>
              <DayPicker days={days} day={day} onDay={setDay} />
              <h2 className="jfb-h2 jfb-h2--gap">Pick a time{dayOf ? <small> · {dayOf.weekday}</small> : null}</h2>
              <SlotGroups slots={dayOf?.slots ?? []} onSlot={setSlot} attr="book" />
              {arrivalWindow > 0 && <p className="jfb-hint">Times are arrival windows — the technician arrives inside the window and calls on the way.</p>}
            </>
          )}
          {err && <p className="jfb-err" role="alert">{err}</p>}
          <div className="jfb-acts jfb-acts--back">
            <button type="button" className="jfb-btn" onClick={() => setService(null)}><BackIcon />Back</button>
          </div>
        </>
      )}

      {step === 3 && service && slot && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="jfb-form"
          data-book-details
        >
          {(service.questions ?? []).map((q) => {
            const money = isBudget(q.label, q.key);
            const opts = q.options ? (money && !q.options.includes(CUSTOM) ? [...q.options, CUSTOM] : q.options) : null;
            const open = answers[q.key] === "Other" || answers[q.key] === CUSTOM;
            return (
              <div key={q.key} className="jfb-fld">
                <div className="jfb-lbl">{q.label}</div>
                {opts ? (
                  <>
                    <div className="jfb-opts">
                      {opts.map((o) => (
                        <button key={o} type="button" aria-pressed={answers[q.key] === o} onClick={() => setAnswers((a) => ({ ...a, [q.key]: o }))} className={`jfb-opt${answers[q.key] === o ? " is-on" : ""}`}>{o}</button>
                      ))}
                    </div>
                    {open && (
                      answers[q.key] === CUSTOM ? (
                        <span className="jfb-money">
                          <em>$</em>
                          <input className="jfb-in" inputMode="numeric" autoFocus aria-label={`${q.label} — your amount`} placeholder="25,000" value={typed[q.key] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [q.key]: e.target.value }))} />
                        </span>
                      ) : (
                        <input className="jfb-in" autoFocus aria-label={`${q.label} — tell us`} placeholder="Tell us in a few words" value={typed[q.key] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [q.key]: e.target.value }))} />
                      )
                    )}
                  </>
                ) : (
                  <input className="jfb-in" aria-label={q.label} value={answers[q.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
                )}
              </div>
            );
          })}
          <label className="jfb-fld"><span className="jfb-lbl">Full name</span><input className="jfb-in" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
          <div className="jfb-two">
            <label className="jfb-fld"><span className="jfb-lbl">Email</span><input className="jfb-in" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="for the confirmation" /></label>
            <label className="jfb-fld"><span className="jfb-lbl">Phone</span><input className="jfb-in" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
          </div>
          {/* Texting consent (2026-10-02): the opt-in every contractor's own texting number is registered on (lib/sms/consent). */}
          <label className="jfb-consent" data-sms-optin>
            <input type="checkbox" checked={form.smsOk} onChange={(e) => setForm({ ...form, smsOk: e.target.checked })} />
            <span>
              <b>{bookingConsentText(orgName).lead}</b> {bookingConsentText(orgName).rest}{" "}
              {/* The terms and the privacy policy beside the box (2026-10-12) — carriers look for them next to the consent. */}
              <a href={`/book/${encodeURIComponent(slug)}/texting`} target="_blank" rel="noreferrer">Texting terms</a> ·{" "}
              <a href={`/book/${encodeURIComponent(slug)}/privacy`} target="_blank" rel="noreferrer">Privacy policy</a>
            </span>
          </label>
          <label className="jfb-fld"><span className="jfb-lbl">Address of the visit</span><input className="jfb-in" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="street-address" /></label>
          <label className="jfb-fld"><span className="jfb-lbl">Anything else?</span><textarea className="jfb-in jfb-ta" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <p className="jfb-hint">On a service plan? Use the email on your plan — your member price applies automatically.</p>
          {err && <p className="jfb-err" role="alert">{err}</p>}
          <div className="jfb-acts">
            <button type="button" className="jfb-btn" onClick={() => setSlot(null)}><BackIcon />Back</button>
            <button type="submit" className="jfb-btn jfb-btn--primary" disabled={pending} data-book-submit>{pending ? "Booking…" : "Book this visit"}</button>
          </div>
        </form>
      )}

      {step === 4 && receipt && (
        <div className="jfb-receipt" data-book-receipt>
          <div className="jfb-receipt-mark" aria-hidden="true">✓</div>
          <div className="jfb-kicker">Booked</div>
          <div className="jfb-receipt-when">{receipt.when}</div>
          <p className="jfb-receipt-p">{receipt.serviceLabel} · {receipt.priceText}{receipt.member ? " · member" : ""}. {orgName} calls on the way{form.email ? `; the confirmation is in your email` : ""}.</p>
          <div className="jfb-acts">
            <a className="jfb-btn jfb-btn--primary" href={`/book/manage/${receipt.manageToken}`}>Change or cancel this visit</a>
          </div>
        </div>
      )}
    </div>
  );
}
