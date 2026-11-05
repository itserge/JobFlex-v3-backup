"use client";

// THE INVESTOR LINK'S FRONT DOOR (owner, 2026-10-13): before the figures, the reader says who they are — name,
// company, what they do, an email — and we hear about it; then the page opens for them (a pass in this browser,
// lib/investorVisitors). And on the page itself, "We accept VC offers": a short offer, sent to us with the
// investor's address to reply to.
//
// 2026-10-20 (owner: "don't open the link till we approve it"): with approvals on, the door sends a request — the
// reader then waits on InvestorWaiting, which asks every little while and opens the page itself when an admin says
// yes. An email already let in, typed in a new browser, opens the figures there (owner, 2026-11-03: "once it's
// approved by us, he can open it from the phone, from email, as long as it's the same link").
//
// 2026-11-02 (owner: "when they click send for approval it just clicks and does nothing … transfer this button to
// showing reviewing"): once the door has the request, the button says so — "Request sent — under review" — and stays
// pressed until the waiting page is up (the page is fetched again behind it, which can take a few seconds). A
// signed-in admin is still let in without approval (owner, 2026-11-02: keep skipping for admins), and the button and
// the note say so plainly, with the way to try the reader's door: a private window.
//
// 2026-11-03 (owner: "when they open the link, above the form, there should be a text blurb about JobFlex"): what
// JobFlex is comes first, so an investor knows what they are asking to see — in the owner's own words (2026-11-04).

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { introduceInvestorAction, investorRequestStatusAction, sendInvestorOfferAction } from "@/actions/investorGate";
import { INVESTOR_KINDS, OFFER_AMOUNTS, OFFER_INSTRUMENTS, OFFER_TIMELINES, OFFER_TYPES, type InvestorVisitorView } from "@/lib/investorGate";
import s from "./investor-gate.module.css";

type Problems = Record<string, string>;

function Field({ id, label, hint, problem, children }: { id: string; label: string; hint?: string; problem?: string; children: React.ReactNode }) {
  return (
    <label className={`${s.field} ${problem ? s.bad : ""}`} htmlFor={id}>
      <span className={s.label}>
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      {children}
      {problem ? <span className={s.why}>{problem}</span> : null}
    </label>
  );
}

function Chips({ name, options, value, onPick, problem }: { name: string; options: readonly string[]; value: string; onPick: (v: string) => void; problem?: string }) {
  return (
    <div className={`${s.chipsWrap} ${problem ? s.bad : ""}`}>
      <div className={s.chips} role="radiogroup" aria-label={name}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={`${s.chip} ${value === o ? s.on : ""}`} onClick={() => onPick(o)}>
            {o}
          </button>
        ))}
      </div>
      {problem ? <span className={s.why}>{problem}</span> : null}
    </div>
  );
}

/** "j•••@acme.vc": enough for the reader to know which inbox to look in. */
const maskEmail = (e: string) => {
  const [user, domain] = e.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : e;
};

/** What JobFlex is, before the door — the owner's own blurb, word for word (2026-11-04). */
function AboutJobFlex() {
  return (
    <section className={s.blurb} aria-label="About JobFlex" data-investor-blurb>
      <h1 className={s.blurbTitle}>JobFlex — AI-Powered Estimating &amp; Business Management for Contractors</h1>
      <p className={s.lede}>JobFlex is an all-in-one AI-powered platform designed for contractors across all construction and home improvement trades.</p>
      <p className={s.blurbText}>From roofing, HVAC, fencing, decking, and gutters to remodeling and general contracting, JobFlex simplifies estimating, project management, and business operations with intelligent automation.</p>
      <p className={s.blurbText}>The platform combines AI-powered estimates, property measurements, material takeoffs, professional proposals, CRM, scheduling, payments, and customer financing solutions in one streamlined workspace.</p>
      <p className={s.blurbText}>JobFlex also features a dedicated Homeowner Portal, allowing homeowners to submit projects and connect with contractors, creating new opportunities for business growth.</p>
      <p className={s.blurbClose}>Built for contractors of every specialty, JobFlex helps businesses save time, win more projects, and scale efficiently.</p>
      <a className={s.blurbSite} href="https://jobflex.app" target="_blank" rel="noopener noreferrer">jobflex.app</a>
    </section>
  );
}

/** Before the figures: who is reading. An admin goes through it too (2026-10-14), to see the page as a reader does. */
export function InvestorGate({ token, admin = false, approval = true, notice }: { token: string; admin?: boolean; approval?: boolean; notice?: "bad" | "closed" }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", company: "", kind: "", email: "", phone: "" });
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** The door has it: under review (a request), or opening (let in). Held while the page is fetched again. */
  const [sent, setSent] = useState<"review" | "open" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const wasRefreshing = useRef(false);
  // The page came back and this is still the door (the pass did not take): let them try again.
  useEffect(() => {
    if (wasRefreshing.current && !refreshing && sent) {
      setSent(null);
      setError("That did not open. Try again in a moment.");
    }
    wasRefreshing.current = refreshing;
  }, [refreshing, sent]);
  /** Approval applies to this reader: approvals are on and they are not a signed-in admin. */
  const review = approval && !admin;
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setProblems((p) => ({ ...p, [k]: "" }));
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await introduceInvestorAction(token, f);
      if (!r.ok) {
        setError(r.error);
        setProblems("problems" in r ? (r.problems ?? {}) : {});
        return;
      }
      setSent("outcome" in r && r.outcome === "pending" ? "review" : "open");
      startRefresh(() => router.refresh());
    } catch {
      setError("That did not go through. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.gate} data-investor-gate>
      <div className={s.kicker}>JobFlex · Investors</div>
      <AboutJobFlex />
      <h2 className={`${s.h2} ${s.doorTitle}`}>Before the figures — who&apos;s reading?</h2>
      <p className={s.sub}>
        {approval
          ? "The live numbers — what the ads cost, how many contractors start a trial, and how soon the ads pay for themselves — are shared one reader at a time. Tell us who you are; we look at each request and open the page for you. You'll hear by email, and this page opens on its own. Already let in? Type the same email and it opens on this device too."
          : "The live numbers are one step away: what the ads cost, how many contractors start a trial, and how soon the ads pay for themselves. Tell us who you are and the page opens — this browser remembers you."}
      </p>
      {notice ? (
        <p className={s.note} data-open-notice={notice}>
          {notice === "bad" ? "That open link did not work — it may have been cut short when it was copied. Type the email you were let in with below and the figures open." : "That request has not been approved yet. Ask again below, or wait for our email."}
        </p>
      ) : null}
      {admin ? (
        <p className={s.note} data-admin-note>
          You are signed in as an admin, so this opens <b>without approval</b>: your entry is marked as yours, kept out of the reader list on Admin → Investors, and nobody is emailed about it.{approval ? " To try what an investor sees — the request, “under review”, and your approval — open this link in a private window where you are not signed in." : ""}
        </p>
      ) : null}
      <form className={s.form} onSubmit={submit} noValidate>
        <div className={s.pair}>
          <Field id="inv-name" label="Your name" problem={problems.name}>
            <input id="inv-name" className={s.input} autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="inv-company" label="Company or fund" problem={problems.company}>
            <input id="inv-company" className={s.input} autoComplete="organization" value={f.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
        </div>
        <div className={s.field}>
          <span className={s.label}>What you do</span>
          <Chips name="What you do" options={INVESTOR_KINDS} value={f.kind} onPick={(v) => set("kind", v)} problem={problems.kind} />
        </div>
        <div className={s.pair}>
          <Field id="inv-email" label="Email" hint="so we can answer you" problem={problems.email}>
            <input id="inv-email" className={s.input} type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field id="inv-phone" label="Phone" hint="optional" problem={problems.phone}>
            <input id="inv-phone" className={s.input} type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
        </div>
        {error ? (
          <p className={s.err} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.primary} disabled={busy || sent !== null} aria-live="polite" data-investor-open data-sent={sent ?? undefined}>
          {sent === "review" ? "Request sent — under review" : sent === "open" ? "Opening the figures…" : busy ? (review ? "Sending your request…" : "Opening…") : admin ? "See the figures — admin, no approval" : approval ? "Ask to see the figures" : "See the figures"}
        </button>
        <p className={s.fine}>Used only to know who is reading and to answer you. Never shared.</p>
      </form>
    </div>
  );
}

/**
 * Waiting for our yes (2026-10-20): what happens next, in one breath — and the page asks every 15 seconds while it is
 * on screen (and when the reader comes back to the tab), opening the figures itself the moment an admin approves. A
 * declined request gets a polite, final word. The offer button stays: an investor need not wait to make an offer.
 */
export function InvestorWaiting({ token, visitor, status }: { token: string; visitor: InvestorVisitorView; status: "pending" | "declined" }) {
  const router = useRouter();
  const first = visitor.name.split(/\s+/)[0] || visitor.name;
  useEffect(() => {
    if (status !== "pending") return;
    let stop = false;
    const ask = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const r = await investorRequestStatusAction(token);
        if (!stop && r.status !== "pending") router.refresh();
      } catch {
        /* the next tick asks again */
      }
    };
    const t = window.setInterval(ask, 15_000);
    const onShow = () => void ask();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stop = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [status, token, router]);
  if (status === "declined") {
    return (
      <div className={s.gate} data-investor-waiting="declined">
        <div className={s.kicker}>JobFlex · Investors</div>
        <h1 className={s.h1}>Thank you, {first}</h1>
        <p className={s.sub}>We share these figures with a small circle for now, and we can&apos;t open them to you at this time. Thank you for your interest in JobFlex.</p>
      </div>
    );
  }
  return (
    <div className={s.gate} data-investor-waiting="pending">
      <div className={s.kicker}>JobFlex · Investors</div>
      <h1 className={s.h1}>Thanks, {first} — it&apos;s with us</h1>
      <p className={s.sub}>
        We look at each request before the figures open. The moment we do, you&apos;ll get an email at <b>{maskEmail(visitor.email)}</b> with your link — and this page opens on its own, so you can leave it open.
      </p>
      <p className={s.wait} role="status" data-under-review>
        <span className={s.waitDot} aria-hidden="true" />
        Under review — waiting for our approval · {visitor.company}
      </p>
      <div className={s.waitOffer}>
        <span>While you wait — we accept VC offers.</span>
        <VcOfferButton token={token} visitor={visitor} lead={false} />
      </div>
    </div>
  );
}

/** "We accept VC offers": the button at the top, and the short offer it opens. */
export function VcOfferButton({ token, visitor, lead }: { token: string; visitor: InvestorVisitorView | null; lead: boolean }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [o, setO] = useState({ type: "", amount: "", instrument: "", valuation: "", timeline: "", message: "", name: visitor?.name ?? "", company: visitor?.company ?? "", email: visitor?.email ?? "", phone: visitor?.phone ?? "" });
  const [editFrom, setEditFrom] = useState(!visitor);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const set = (k: keyof typeof o, v: string) => {
    setO((x) => ({ ...x, [k]: v }));
    setProblems((p) => ({ ...p, [k]: "" }));
  };
  // An intro call needs no figures yet: the open answers are picked for them.
  const pickType = (v: string) => {
    setO((x) => ({ ...x, type: v, ...(v === "Intro call first" ? { amount: x.amount || "Open", instrument: x.instrument || "Not sure yet", timeline: x.timeline || "Exploring" } : {}) }));
    setProblems((p) => ({ ...p, type: "" }));
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await sendInvestorOfferAction(token, o);
      if (!r.ok) {
        setError(r.error);
        setProblems(r.problems ?? {});
        if (r.problems && (r.problems.name || r.problems.company || r.problems.email)) setEditFrom(true);
        return;
      }
      setSent(true);
    } catch {
      setError("That did not go through. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={`${s.vc} ${lead ? s.vcLead : ""} ${sent ? s.vcSent : ""}`} onClick={() => setOpen(true)} data-vc-open>
        <span className={s.vcDot} aria-hidden="true" />
        {sent ? "Offer sent — thank you" : "We accept VC offers"}
      </button>
      {open ? (
        <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="vc-title" data-vc-dialog>
            <div className={s.dHead}>
              <div>
                <div className={s.kicker}>JobFlex · Investors</div>
                <h2 id="vc-title" className={s.h2}>
                  {sent ? "Received" : "We accept VC offers"}
                </h2>
              </div>
              <button type="button" className={s.x} onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            {sent ? (
              <div className={s.done} data-vc-done>
                <p>Your offer is in our inbox now. We read every one and answer by email{o.email ? ` at ${o.email}` : ""}.</p>
                <button type="button" className={s.primary} onClick={() => setOpen(false)}>
                  Back to the figures
                </button>
              </div>
            ) : (
              <form className={s.form} onSubmit={submit} noValidate>
                <p className={s.sub}>Open to term sheets and to a first conversation — SAFE, priced round or notes. A few taps; we answer by email. Every indicative offer is reviewed by the founders; shortlisted investors receive the founding team, the company structure and the cap table, and a call with the founders.</p>
                <div className={s.field}>
                  <span className={s.label}>What you&apos;re sending</span>
                  <div className={`${s.chipsWrap} ${problems.type ? s.bad : ""}`}>
                    <div className={s.chips} role="radiogroup" aria-label="What you're sending">
                      {OFFER_TYPES.map((t, i) => (
                        <button key={t} ref={i === 0 ? firstRef : undefined} type="button" role="radio" aria-checked={o.type === t} className={`${s.chip} ${o.type === t ? s.on : ""}`} onClick={() => pickType(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    {problems.type ? <span className={s.why}>{problems.type}</span> : null}
                  </div>
                </div>
                <div className={s.field}>
                  <span className={s.label}>Amount</span>
                  <Chips name="Amount" options={OFFER_AMOUNTS} value={o.amount} onPick={(v) => set("amount", v)} problem={problems.amount} />
                </div>
                <div className={s.field}>
                  <span className={s.label}>Instrument</span>
                  <Chips name="Instrument" options={OFFER_INSTRUMENTS} value={o.instrument} onPick={(v) => set("instrument", v)} problem={problems.instrument} />
                </div>
                <div className={s.pair}>
                  <Field id="vc-val" label="Valuation or cap" hint="optional" problem={problems.valuation}>
                    <input id="vc-val" className={s.input} placeholder="e.g. $8M post" value={o.valuation} onChange={(e) => set("valuation", e.target.value)} />
                  </Field>
                  <div className={s.field}>
                    <span className={s.label}>Timeline</span>
                    <Chips name="Timeline" options={OFFER_TIMELINES} value={o.timeline} onPick={(v) => set("timeline", v)} problem={problems.timeline} />
                  </div>
                </div>
                <Field id="vc-msg" label="A note" hint={o.type === "Term sheet" ? "the terms in a line or two" : "optional"} problem={problems.message}>
                  <textarea id="vc-msg" className={s.textarea} rows={3} value={o.message} onChange={(e) => set("message", e.target.value)} />
                </Field>
                {editFrom ? (
                  <div className={s.pair}>
                    <Field id="vc-name" label="Your name" problem={problems.name}>
                      <input id="vc-name" className={s.input} value={o.name} onChange={(e) => set("name", e.target.value)} />
                    </Field>
                    <Field id="vc-company" label="Company or fund" problem={problems.company}>
                      <input id="vc-company" className={s.input} value={o.company} onChange={(e) => set("company", e.target.value)} />
                    </Field>
                    <Field id="vc-email" label="Email" problem={problems.email}>
                      <input id="vc-email" className={s.input} type="email" value={o.email} onChange={(e) => set("email", e.target.value)} />
                    </Field>
                    <Field id="vc-phone" label="Phone" hint="optional">
                      <input id="vc-phone" className={s.input} type="tel" value={o.phone} onChange={(e) => set("phone", e.target.value)} />
                    </Field>
                  </div>
                ) : (
                  <p className={s.from} data-vc-from>
                    From <b>{o.name}</b> · {o.company} · {o.email}{" "}
                    <button type="button" className={s.link} onClick={() => setEditFrom(true)}>
                      change
                    </button>
                  </p>
                )}
                {error ? (
                  <p className={s.err} role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="submit" className={s.primary} disabled={busy} data-vc-send>
                  {busy ? "Sending…" : "Send the offer"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
