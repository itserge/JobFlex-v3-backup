"use client";

// THE HOMEOWNER'S PAGE on the contractor's website (2026-10-27): the address → the trade's few questions → the price in
// the shop's prices → "Get my full quote" → the lead. One client component, its own look (the shop's logo and colour
// over paper, square JobFlex blue), no login, works alone at /estimate/<slug>/<trade> and inside the shop's site in a
// frame (?embed=1: no header, closes and reports to the parent by postMessage). Prices come from actions/webEstimator.
import { useEffect, useRef, useState } from "react";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { webEstimate, webLead, webView, type WebEstimateView } from "@/actions/webEstimator";
import type { WebChoice, WebQuestion } from "@/lib/webEstimatorTrades";
import { pageWords, type WebTrade } from "@/lib/webEstimator";
import { PRO_CAP } from "@/lib/home/jobflexPro";
import { WebHead } from "./web-head";
import "./web-estimate.css";

export interface WebEstimateProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null; house?: boolean };
  trade: WebTrade;
  title: string;
  basis: string;
  askEmail: boolean;
  choices: WebChoice[];
  questions: WebQuestion[];
  embed: boolean;
}

type Step = "address" | "details" | "price" | "quote" | "done";
const money = (d: number) => "$" + Math.round(d).toLocaleString("en-US");
const TRADE_WORDS: Record<WebTrade, { ask: string; pick: string; cta: string; tool: string }> = {
  roof: { ask: "Where is the roof?", pick: "What should it be?", cta: "Measure my roof", tool: "Roof estimator" },
  hvac: { ask: "Where is the house?", pick: "What kind of system?", cta: "Size my system", tool: "HVAC estimator" },
  fence: { ask: "Where is the fence going?", pick: "What style?", cta: "Price my fence", tool: "Fence Studio" },
  deck: { ask: "Where is the deck going?", pick: "Start from a deck like…", cta: "Price my deck", tool: "Deck Studio" },
  smart: { ask: "Where is the project?", pick: "What kind of work?", cta: "Price my project", tool: "Smart Proposal" },
};

export function WebEstimate(p: WebEstimateProps) {
  const [step, setStep] = useState<Step>("address");
  const [address, setAddress] = useState<PickedAddress | null>(null);
  const [typed, setTyped] = useState("");
  const [choice, setChoice] = useState<string | null>(p.choices[0]?.id ?? null);
  const [answers, setAnswers] = useState<Record<string, string | number>>(() => Object.fromEntries(p.questions.filter((q) => q.default !== undefined).map((q) => [q.id, q.default as string | number])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [est, setEst] = useState<WebEstimateView | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  const pw = pageWords(p.shop, "project");
  const [leadId, setLeadId] = useState<string | null>(null);
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, p.trade).catch(() => {});
  }, [p.shop.slug, p.trade]);

  const tell = (event: "lead" | "close") => { if (p.embed && typeof window !== "undefined" && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event }, "*"); };

  const addressOk = !!(address?.address || typed.trim().length >= 5);
  const addressIn = (): PickedAddress => address ?? { address: typed.trim(), city: "", state: "", zip: "" };

  const needDetails = p.questions.length > 0 || p.choices.length > 1;

  async function run() {
    setBusy(true); setError(null);
    for (const q of p.questions) {
      if (q.required && (answers[q.id] === undefined || answers[q.id] === "")) { setError(`${q.label}, please.`); setBusy(false); return; }
    }
    const r = await webEstimate(p.shop.slug, p.trade, { address: addressIn(), choice, answers }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      // no roof from the air, a resting estimator: the homeowner may still ask for the quote by hand
      if ("code" in r && (r.code === "no-coverage" || r.code === "capped" || r.code === "unavailable")) { setEst(null); setError(r.error); setStep("quote"); return; }
      setError(r.error); return;
    }
    setEst(r.estimate); setStep("price");
  }

  async function send() {
    setBusy(true); setError(null);
    if (!est && p.shop.house) { setError("Run the estimate first."); setBusy(false); return; }
    // no price (resting, no read of the house): the request goes with the address alone
    const r = await (est ? webLead(p.shop.slug, p.trade, est.token, contact) : webLead(p.shop.slug, p.trade, null, { ...contact, address: addressIn() })).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.next) { window.location.assign(r.next); return; }   // the house: the homeowner's own request page
    setLeadId(r.leadId); setStep("done"); tell("lead");
  }

  const w = TRADE_WORDS[p.trade];
  const accent = p.shop.primaryColor && /^#[0-9a-f]{6}$/i.test(p.shop.primaryColor) ? p.shop.primaryColor : "#1854a0";
  const band = est ? (est.band.low === est.band.high ? money(est.band.low) : `${money(est.band.low)} – ${money(est.band.high)}`) : "";

  return (
    <div className={"we" + (p.embed ? " we-embed" : "")} style={{ ["--we-accent" as string]: accent }} data-web-estimate={p.trade} data-step={step}>
      <WebHead shop={p.shop} title={p.title} tool={TRADE_WORDS[p.trade].tool} embed={p.embed} />

      <ol className="we-steps" aria-hidden="true">
        {(["address", "details", "price", "quote"] as Step[]).filter((s) => s !== "details" || needDetails).map((s, i) => (
          <li key={s} className={step === s ? "on" : (["address", "details", "price", "quote", "done"].indexOf(step) > ["address", "details", "price", "quote", "done"].indexOf(s) ? "done" : "")}><i>{i + 1}</i></li>
        ))}
      </ol>

      {step === "address" && (
        <section className="we-card" data-web-step="address">
          <h2>{w.ask}</h2>
          <p className="we-sub">Type the street address. {p.trade === "roof" ? "We measure the roof from aerial imagery — no visit needed for the first number." : "The price is set for this area."}</p>
          <PlacesAutocomplete className="we-input" placeholder="123 Main St, City, ST" onPick={(a) => { setAddress(a); setTyped(a.formatted ?? a.address); }} onTextChange={(t) => { setTyped(t); if (address && t !== (address.formatted ?? address.address)) setAddress(null); }} />
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn" disabled={!addressOk || busy} onClick={() => { setError(null); if (needDetails) setStep("details"); else void run(); }} data-web-next>
            {needDetails ? "Next" : busy ? "Measuring…" : w.cta}
          </button>
          <p className="we-fine">{pw.sees}</p>
        </section>
      )}

      {step === "details" && (
        <section className="we-card" data-web-step="details">
          {p.choices.length > 1 ? (
            <>
              <h2>{w.pick}</h2>
              <div className="we-choices" role="radiogroup">
                {p.choices.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={choice === c.id} className={"we-choice" + (choice === c.id ? " on" : "")} onClick={() => setChoice(c.id)} data-web-choice={c.id}>
                    <b>{c.label}</b>{c.note ? <span>{c.note}</span> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {p.questions.length ? (
            <div className="we-qs">
              {p.questions.map((q) => (
                <label key={q.id} className="we-q">
                  <span>{q.label}{q.unit ? <small> · {q.unit}</small> : null}</span>
                  {q.kind === "number" ? (
                    <input type="number" inputMode="numeric" min={q.min} max={q.max} step={q.step ?? 1} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value === "" ? "" : Number(e.target.value) }))} data-web-q={q.id} />
                  ) : (
                    <select value={String(answers[q.id] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} data-web-q={q.id}>
                      {(q.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  )}
                  {q.help ? <em>{q.help}</em> : null}
                </label>
              ))}
            </div>
          ) : null}
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <div className="we-row">
            <button type="button" className="we-btn we-ghost" onClick={() => setStep("address")}>Back</button>
            <button type="button" className="we-btn" disabled={busy} onClick={() => void run()} data-web-run>{busy ? "Working…" : w.cta}</button>
          </div>
        </section>
      )}

      {step === "price" && est && (
        <section className="we-card we-price" data-web-step="price">
          <div className="we-kicker">{est.show === "exact" ? "Your estimated price" : "Your estimated price range"}</div>
          <div className="we-big" data-web-band>{band}</div>
          <p className="we-basis">{est.basis}</p>
          <p className="we-sum">{est.summary}</p>
          <p className="we-choice-line"><i>Priced as</i> {est.choice}</p>
          <button type="button" className="we-btn we-wide" onClick={() => { setError(null); setStep("quote"); }} data-web-quote>Get my full quote</button>
          <p className="we-fine">{pw.quote}</p>
          {needDetails ? <button type="button" className="we-link" onClick={() => setStep("details")}>Change the details</button> : null}
        </section>
      )}

      {step === "quote" && (
        <section className="we-card" data-web-step="quote">
          <h2>{est ? "Where should the quote go?" : "Leave your details"}</h2>
          {!est && !p.shop.house ? <p className="we-note" data-web-no-price>{error ?? `No price this time — ${p.shop.name} will price it and get back to you.`}</p> : !est && error ? <p className="we-note">{error}</p> : null}
          {est ? <p className="we-sub">{p.shop.house ? PRO_CAP : p.shop.name} will send the full quote for <b>{band}</b> and confirm it with you.</p> : null}
          <form className="we-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            {!est && !p.shop.house ? <label><span>Address of the house</span><input required value={typed} autoComplete="street-address" onChange={(e) => { setTyped(e.target.value); setAddress(null); }} data-web-address /></label> : null}
            <label><span>Your name</span><input required value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" data-web-name /></label>
            <label><span>Phone</span><input required type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" inputMode="tel" data-web-phone /></label>
            {p.askEmail ? <label><span>Email {p.shop.house ? null : <small>for a copy of the estimate</small>}</span><input type="email" required={!!p.shop.house} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" data-web-email /></label> : null}
            <label><span>Anything to add? <small>optional</small></span><textarea rows={3} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} data-web-note /></label>
            <label className="we-hp" aria-hidden="true"><input tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} name="company" /></label>
            <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{pw.consent}</span></label>
            {error && est ? <p className="we-err" role="alert">{error}</p> : null}
            {error && !est && step === "quote" && contact.name ? null : null}
            <div className="we-row">
              <button type="button" className="we-btn we-ghost" onClick={() => setStep(est ? "price" : "address")}>Back</button>
              <button type="submit" className="we-btn" disabled={busy || (!est && (!!p.shop.house || typed.trim().length < 5))} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
            </div>
            {!est && p.shop.house ? <p className="we-fine">The estimate couldn&apos;t be made from the address alone. <a className="we-link" href="/homeowner">{pw.call}</a></p> : null}
          </form>
        </section>
      )}

      {step === "done" && (
        <section className="we-card we-done" data-web-step="done" data-web-lead={leadId ?? ""}>
          <div className="we-tick" aria-hidden="true">✓</div>
          <h2>Sent to {p.shop.name}.</h2>
          <p className="we-sub">{est ? <>They have your address, the {p.trade === "hvac" ? "sizing" : "measurements"} and the price you saw</> : <>They have your request and will price it and get back to you</>}{contact.email ? `, and a copy is on its way to ${contact.email}` : ""}. Expect a call{p.shop.phone ? `, or reach them at ${p.shop.phone}` : ""}.</p>
          {p.embed ? <button type="button" className="we-btn we-ghost" onClick={() => tell("close")}>Close</button> : p.shop.website ? <a className="we-btn we-ghost" href={p.shop.website.startsWith("http") ? p.shop.website : `https://${p.shop.website}`}>Back to {p.shop.name}</a> : null}
        </section>
      )}

      <footer className="we-foot">{p.shop.house ? pw.foot : <>Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</>}</footer>
    </div>
  );
}
