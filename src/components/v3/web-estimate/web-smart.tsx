"use client";

// SMART PROPOSAL ON THE CONTRACTOR'S WEBSITE (owner, 2026-10-28: "and Smart Proposal, for remodelers"). The homeowner
// describes the project in their own words, shows photos, says where it is and roughly how big, picks a finish level;
// the intake asks only the cost-critical questions; the estimate runs in the shop's own method and price book; the
// page shows the price the shop's way and what the work includes; "Get my full quote". The shop opens Smart
// Proposal with the brief.
import * as React from "react";
import { webLead, webView, type WebEstimateView } from "@/actions/webEstimator";
import { webSmartAnalyze, webSmartGenerate } from "@/actions/advancedEstimator";
import { bandWords, money, pageWords } from "@/lib/webEstimator";
import { PRO_CAP } from "@/lib/home/jobflexPro";
import { clearCarriedWords, useCarriedWords } from "@/lib/home/carry";
import { WebHead } from "./web-head";
import "./web-estimate.css";

export interface WebSmartProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null; house?: boolean };
  title: string;
  basis: string;
  askEmail: boolean;
  embed: boolean;
}

type Question = { id: string; question: string; why?: string; kind: "select" | "number" | "text"; options?: string[]; unit?: string; placeholder?: string };
type Step = "describe" | "asking" | "questions" | "pricing" | "price" | "quote" | "done";
const STEPS: Step[] = ["describe", "questions", "price", "quote"];
const TIERS: Array<["budget" | "standard" | "luxury", string, string]> = [["budget", "Budget", "Solid, simple materials"], ["standard", "Standard", "Good mid-range finishes"], ["luxury", "Luxury", "Premium materials and details"]];

/** A photo shrunk to fit a server call: longest side 1280 px, JPEG. */
async function shrink(file: File): Promise<string | null> {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

export function WebSmart(p: WebSmartProps) {
  const [step, setStep] = React.useState<Step>("describe");
  const [briefIn, setBrief] = React.useState({ description: "", location: "", sqft: "", qualityTier: "standard" as "budget" | "standard" | "luxury" });
  // The house (2026-10-28, lib/home/carry): what they wrote in the homeowner portal's box starts the brief, until
  // they write here themselves.
  const carried = useCarriedWords();
  const [wrote, setWrote] = React.useState(false);
  const brief = p.shop.house && !wrote && !briefIn.description ? { ...briefIn, description: carried.slice(0, 4000) } : briefIn;
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [est, setEst] = React.useState<WebEstimateView | null>(null);
  const [included, setIncluded] = React.useState<string[]>([]);
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  const pw = pageWords(p.shop, "project");
  const [leadId, setLeadId] = React.useState<string | null>(null);
  /** Why there is no price (the estimator resting for the month, or not answering): the form still takes the request,
   *  with the address and the project in their words. */
  const [noPrice, setNoPrice] = React.useState<string | null>(null);
  const [where, setWhere] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, "smart").catch(() => {});
  }, [p.shop.slug]);

  const tell = (event: "lead" | "close") => { if (p.embed && typeof window !== "undefined" && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event }, "*"); };
  const ready = brief.description.trim().length >= 20;
  const answersText = () => questions.map((q) => (answers[q.id] ? `${q.question} ${answers[q.id]}${q.unit ? ` ${q.unit}` : ""}` : "")).filter(Boolean).join("; ");

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const f of Array.from(files).slice(0, 3 - next.length)) { const d = await shrink(f); if (d) next.push(d); }
    setPhotos(next.slice(0, 3));
  }
  async function analyze() {
    setBusy(true); setError(null); setStep("asking");
    const r = await webSmartAnalyze(p.shop.slug, { ...brief, photos }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && (r.code === "capped" || r.code === "unavailable")) { setEst(null); if (p.shop.house) setError(r.error); else setNoPrice(r.error); setStep("quote"); return; }
      setError(r.error); setStep("describe"); return;
    }
    if (r.location) setBrief((b) => ({ ...b, location: r.location ?? b.location }));
    if (r.questions.length) { setQuestions(r.questions as Question[]); setStep("questions"); return; }
    await generate();
  }
  async function generate() {
    setBusy(true); setError(null); setStep("pricing");
    const r = await webSmartGenerate(p.shop.slug, { ...brief, photos, answers: answersText() }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && (r.code === "capped" || r.code === "unavailable")) { setEst(null); if (p.shop.house) setError(r.error); else setNoPrice(r.error); setStep("quote"); return; }
      setError(r.error); setStep(questions.length ? "questions" : "describe"); return;
    }
    setEst(r.estimate); setIncluded(r.included); setStep("price");
  }
  async function sendNow() {
    setBusy(true); setError(null);
    if (!est && p.shop.house) { setError(pw.call); setBusy(false); return; }
    // no price (resting, or not answering): the request goes with the address and the project in their words
    const words = [contact.note.trim(), brief.description.trim() ? `The project: ${brief.description.trim()}` : ""].filter(Boolean).join(" — ");
    const r = await (est ? webLead(p.shop.slug, "smart", est.token, contact) : webLead(p.shop.slug, "smart", null, { ...contact, note: words, address: { address: placeIn, city: "", state: "", zip: "" } })).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.next) { clearCarriedWords(); window.location.assign(r.next); return; }   // the house: the homeowner's own request page
    setLeadId(r.leadId); setStep("done"); tell("lead");
  }

  const placeIn = (where ?? brief.location).trim();
  const price = est ? (est.show === "exact" ? money(est.band.low) : bandWords(est.band)) : null;
  const accent = p.shop.primaryColor || undefined;
  const idx = (s: Step) => STEPS.indexOf(s === "asking" ? "describe" : s === "pricing" ? "questions" : s === "done" ? "quote" : s);

  return (
    <div className={"we" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="smart" data-web-step={step}>
      <WebHead shop={p.shop} title={p.title} tool={"Smart Proposal"} embed={p.embed} />
      <ol className="we-steps" aria-hidden="true">
        {STEPS.map((s, i) => <li key={s} className={idx(step) === i ? "on" : idx(step) > i ? "done" : ""}><i>{i + 1}</i></li>)}
      </ol>

      {(step === "describe" || step === "asking") && (
        <section className="we-card" data-web-step="describe">
          <h2>What are we building?</h2>
          <p className="we-sub">Describe the project the way you&apos;d tell a friend — the room, what changes, what stays. Photos help a lot.</p>
          <div className="we-form">
            <label><span>The project</span><textarea rows={5} maxLength={4000} value={brief.description} placeholder="We want to remodel the main bathroom: new tile floor and shower, a double vanity, move the toilet about two feet, new lights…" onChange={(e) => { setWrote(true); setBrief({ ...brief, description: e.target.value }); }} data-web-brief /></label>
            <div className="we-qs">
              <label className="we-q"><span>Where <small>city, ST — prices follow the area</small></span><input value={brief.location} placeholder="Kirkland, WA" onChange={(e) => setBrief({ ...brief, location: e.target.value })} data-web-location /></label>
              <label className="we-q"><span>Rough size <small>optional, sq ft</small></span><input type="number" min={10} max={20000} value={brief.sqft} placeholder="120" onChange={(e) => setBrief({ ...brief, sqft: e.target.value })} data-web-sqft /></label>
            </div>
            <div>
              <span className="we-q-lbl">Finish level</span>
              <div className="we-choices we-tiers" role="radiogroup">
                {TIERS.map(([id, label, note]) => (
                  <button key={id} type="button" role="radio" aria-checked={brief.qualityTier === id} className={"we-choice" + (brief.qualityTier === id ? " on" : "")} onClick={() => setBrief({ ...brief, qualityTier: id })} data-web-tier={id}><b>{label}</b><span>{note}</span></button>
                ))}
              </div>
            </div>
            <label className="we-photos">
              <span>Photos <small>up to three; the estimator reads what&apos;s there</small></span>
              <input type="file" accept="image/*" multiple onChange={(e) => void addPhotos(e.target.files)} data-web-photos />
              {photos.length ? (
                <div className="we-thumbs">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the homeowner's own photos, in memory */}
                  {photos.map((src, i) => <img key={i} src={src} alt="" />)}
                  <button type="button" className="we-link" onClick={() => setPhotos([])}>Remove photos</button>
                </div>
              ) : null}
            </label>
          </div>
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={!ready || busy} onClick={() => void analyze()} data-web-next>
            {step === "asking" ? "Reading your project…" : "Price my project"}
          </button>
          <p className="we-fine">{pw.sees}</p>
        </section>
      )}

      {(step === "questions" || step === "pricing") && (
        <section className="we-card" data-web-step="questions">
          <h2>A couple of questions</h2>
          <p className="we-sub">Only what moves the price. Skip what you don&apos;t know.</p>
          <div className="we-form">
            {questions.map((q) => (
              <label key={q.id}>
                <span>{q.question}{q.why ? <small> {q.why}</small> : null}</span>
                {q.kind === "select" && q.options?.length ? (
                  <select value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} data-web-q={q.id}><option value="">—</option>{q.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                ) : (
                  <input type={q.kind === "number" ? "number" : "text"} value={answers[q.id] ?? ""} placeholder={q.placeholder ?? (q.unit ? `in ${q.unit}` : "")} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} data-web-q={q.id} />
                )}
              </label>
            ))}
          </div>
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <div className="we-row">
            <button type="button" className="we-btn we-ghost" onClick={() => setStep("describe")} disabled={busy}>Back</button>
            <button type="button" className="we-btn" disabled={busy} onClick={() => void generate()} data-web-run>{step === "pricing" ? "Pricing…" : "Price it"}</button>
          </div>
        </section>
      )}

      {step === "price" && est && (
        <section className="we-card we-price" data-web-step="price">
          <div className="we-kicker">{est.show === "exact" ? "Your estimated price" : "Your estimated price range"}</div>
          <div className="we-big" data-web-band>{price}</div>
          <p className="we-basis">{est.basis}</p>
          <p className="we-sum">{est.summary}</p>
          {included.length ? (
            <ul className="we-included" data-web-included>
              {included.map((l) => <li key={l}>{l}</li>)}
            </ul>
          ) : null}
          <button type="button" className="we-btn we-wide" onClick={() => setStep("quote")} data-web-quote>Get my full quote</button>
          <p className="we-fine">{pw.quote}</p>
          <button type="button" className="we-link" onClick={() => setStep("describe")} data-web-again>Change the project</button>
        </section>
      )}

      {step === "quote" && (
        <section className="we-card" data-web-step="quote">
          <h2>{est ? "Your full quote" : "Leave your details"}</h2>
          {est ? <p className="we-note">{est.choice}: <b>{price}</b>. {p.shop.house ? PRO_CAP : p.shop.name} confirms it line by line.</p> : !p.shop.house ? <p className="we-note" data-web-no-price>{noPrice ?? `No price this time — ${p.shop.name} will price it and get back to you.`}</p> : null}
          <form className="we-form" onSubmit={(e) => { e.preventDefault(); void sendNow(); }}>
            {!est && !p.shop.house ? <label><span>Address of the project</span><input value={where ?? brief.location} autoComplete="street-address" onChange={(e) => setWhere(e.target.value)} data-web-address /></label> : null}
            <label><span>Your name</span><input value={contact.name} autoComplete="name" onChange={(e) => setContact({ ...contact, name: e.target.value })} data-web-name /></label>
            <label><span>Phone</span><input value={contact.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-web-phone /></label>
            {p.askEmail ? <label><span>Email {p.shop.house ? null : <small>for your copy of the price</small>}</span><input type="email" required={!!p.shop.house} value={contact.email} autoComplete="email" onChange={(e) => setContact({ ...contact, email: e.target.value })} data-web-email /></label> : null}
            <label><span>Anything we should know? <small>optional</small></span><textarea rows={3} maxLength={1000} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} data-web-note /></label>
            <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{pw.consent}</span></label>
            <input className="we-hp" tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} aria-hidden="true" name="company" />
            {error ? <p className="we-err" role="alert">{error}</p> : null}
            <div className="we-row">
              <button type="button" className="we-btn we-ghost" onClick={() => setStep(est ? "price" : "describe")} disabled={busy}>Back</button>
              <button type="submit" className="we-btn" disabled={busy || (!est && (!!p.shop.house || placeIn.length < 5))} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
            </div>
            {!est && p.shop.house ? <p className="we-fine"><a className="we-link" href="/homeowner">{pw.call}</a></p> : null}
          </form>
        </section>
      )}

      {step === "done" && (
        <section className="we-card we-done" data-web-step="done" data-web-lead={leadId ?? ""}>
          <div className="we-tick">✓</div>
          <h2>Sent to {p.shop.name}</h2>
          <p className="we-sub">{est ? <>They have your project and the price you saw, and will be in touch</> : <>They have your request and will price it and get back to you</>}{contact.phone ? ` at ${contact.phone}` : ""} to confirm the details.</p>
          {p.embed ? <button type="button" className="we-btn we-ghost" onClick={() => tell("close")}>Close</button> : null}
        </section>
      )}

      <p className="we-foot">{p.shop.house ? pw.foot : <>Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</>}</p>
    </div>
  );
}
