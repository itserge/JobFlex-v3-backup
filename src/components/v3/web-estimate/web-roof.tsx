"use client";

// THE ROOF ESTIMATOR ON THE CONTRACTOR'S WEBSITE (owner, 2026-10-28: "same thing with roofing" — the real estimator,
// not a short form). The homeowner's roof estimator: the address with the live satellite map and the pin on THEIR roof
// (drag it onto the right building), "Measure my roof" from the air, the measurement shown on the house — squares,
// pitch, planes, the imagery's date — then the material (every family the shop offers, the shop's own brand for it),
// the price in the shop's book, "Get my full quote". The shop opens the lead with the measurement on file.
import * as React from "react";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { AddressPinPreview } from "@/components/v3/roof-estimator-blueprint/address-pin-preview";
import { webLead, webRoofMeasure, webRoofPrice, webView, type WebEstimateView, type WebRoofFacts } from "@/actions/webEstimator";
import { bandWords, money } from "@/lib/webEstimator";
import type { WebChoice } from "@/lib/webEstimatorTrades";
import { WebHead } from "./web-head";
import "./web-estimate.css";

export interface WebRoofProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null };
  title: string;
  basis: string;
  askEmail: boolean;
  choices: WebChoice[];
  embed: boolean;
}

type Step = "address" | "measuring" | "measured" | "price" | "quote" | "done";
const STEPS: Step[] = ["address", "measured", "price", "quote"];

export function WebRoof(p: WebRoofProps) {
  const [step, setStep] = React.useState<Step>("address");
  const [address, setAddress] = React.useState<PickedAddress | null>(null);
  const [typed, setTyped] = React.useState("");
  const [pin, setPin] = React.useState<{ lat: number; lng: number } | null>(null);
  const [moved, setMoved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [measure, setMeasure] = React.useState<{ token: string; facts: WebRoofFacts; choices: WebChoice[] } | null>(null);
  const [choice, setChoice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [est, setEst] = React.useState<WebEstimateView | null>(null);
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  const [leadId, setLeadId] = React.useState<string | null>(null);
  /** Why there is no price (the estimator resting for the month, no read from the air): the form still takes the request. */
  const [noPrice, setNoPrice] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, "roof").catch(() => {});
  }, [p.shop.slug]);

  const tell = (event: "lead" | "close") => { if (p.embed && typeof window !== "undefined" && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event }, "*"); };
  const addressOk = !!(address?.address || typed.trim().length >= 5);
  const addressIn = () => ({ ...(address ?? { address: typed.trim(), city: "", state: "", zip: "" }), ...(pin ? { lat: pin.lat, lng: pin.lng } : {}) });
  const label = address?.formatted ?? address?.address ?? typed.trim();

  async function measureNow() {
    setBusy(true); setError(null); setStep("measuring");
    const r = await webRoofMeasure(p.shop.slug, { address: addressIn() }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      // no roof from the air, a resting estimator: the homeowner may still ask for the quote by hand
      if ("code" in r && (r.code === "no-coverage" || r.code === "capped" || r.code === "unavailable")) { setEst(null); setNoPrice(r.error); setStep("quote"); return; }
      // the building Google found is not under the pin: the map shows where the pin is, to drag it onto the roof
      if ("pin" in r && r.pin) { setPin(r.pin); setMoved(false); }
      setError(r.error); setStep("address"); return;
    }
    setMeasure(r);
    setPin(r.facts.pin);
    setChoice((c) => c ?? r.choices[0]?.id ?? null);
    setStep("measured");
  }
  async function priceNow() {
    if (!measure) return;
    setBusy(true); setError(null);
    const r = await webRoofPrice(p.shop.slug, measure.token, choice).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEst(r.estimate);
    setStep("price");
  }
  async function sendNow() {
    setBusy(true); setError(null);
    // no price (resting, or no read from the air): the request goes with the address alone
    const r = await (est ? webLead(p.shop.slug, "roof", est.token, contact) : webLead(p.shop.slug, "roof", null, { ...contact, address: addressIn() })).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setLeadId(r.leadId); setStep("done"); tell("lead");
  }

  const price = est ? (est.show === "exact" ? money(est.band.low) : bandWords(est.band)) : null;
  const accent = p.shop.primaryColor || undefined;
  const stepIndex = (s: Step) => STEPS.indexOf(s === "measuring" ? "address" : s === "done" ? "quote" : s);
  const pinLabel = label || "Your house";

  return (
    <div className={"we" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="roof" data-web-step={step}>
      <WebHead shop={p.shop} title={p.title} tool={"Roof estimator"} embed={p.embed} />
      <ol className="we-steps" aria-hidden="true">
        {STEPS.map((s, i) => <li key={s} className={stepIndex(step) === i ? "on" : stepIndex(step) > i ? "done" : ""}><i>{i + 1}</i></li>)}
      </ol>

      {(step === "address" || step === "measuring") && (
        <section className="we-card" data-web-step="address">
          <h2>Where is the roof?</h2>
          <p className="we-sub">Type the street address. We measure the roof from aerial imagery — no visit needed for the first number.</p>
          <PlacesAutocomplete className="we-input" placeholder="123 Main St, City, ST" onPick={(a) => { setAddress(a); setTyped(a.formatted ?? a.address); if (typeof a.lat === "number" && typeof a.lng === "number") { setPin({ lat: a.lat, lng: a.lng }); setMoved(false); } }} onTextChange={(t) => { setTyped(t); if (address && t !== (address.formatted ?? address.address)) { setAddress(null); setPin(null); } }} />
          {pin ? (
            <div className="we-map" data-web-map>
              <AddressPinPreview lat={pin.lat} lng={pin.lng} label={pinLabel} scanning={step === "measuring"} moved={moved} onMove={(q) => { setPin(q); setMoved(true); }} />
              <p className="we-fine">The pin should sit on your roof. Drag it onto the right building if it landed next door.</p>
            </div>
          ) : null}
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={!addressOk || busy} onClick={() => void measureNow()} data-web-next>
            {step === "measuring" ? "Measuring from the air…" : "Measure my roof"}
          </button>
          <p className="we-fine">No account, no payment. {p.shop.name} sees your request only when you send it.</p>
        </section>
      )}

      {step === "measured" && measure && (
        <section className="we-card" data-web-step="measured">
          <h2>Your roof, measured</h2>
          <p className="we-sub">From aerial imagery{measure.facts.imagery ? ` of ${measure.facts.imagery}` : ""}. The final measure is confirmed on the roof.</p>
          <div className="we-map" data-web-map>
            <AddressPinPreview lat={pin?.lat ?? measure.facts.pin.lat} lng={pin?.lng ?? measure.facts.pin.lng} label={pinLabel} moved={moved} onMove={(q) => { setPin(q); setMoved(true); }} />
          </div>
          <dl className="we-facts" data-web-facts>
            <div><dt>Roof area</dt><dd><b>{measure.facts.squares}</b> squares <small>({measure.facts.areaSqft.toLocaleString("en-US")} sq ft)</small></dd></div>
            <div><dt>Pitch</dt><dd><b>{measure.facts.pitchLabel}</b></dd></div>
            <div><dt>Roof planes</dt><dd><b>{measure.facts.segmentCount}</b></dd></div>
            <div><dt>Footprint</dt><dd><b>{measure.facts.footprintSqft.toLocaleString("en-US")}</b> sq ft</dd></div>
          </dl>
          {moved ? <button type="button" className="we-link" onClick={() => void measureNow()} disabled={busy} data-web-remeasure>Measure again at the pin</button> : null}
          <h2 className="we-h2">What should it be?</h2>
          <div className="we-choices" role="radiogroup">
            {measure.choices.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={choice === c.id} className={"we-choice" + (choice === c.id ? " on" : "")} onClick={() => setChoice(c.id)} data-web-choice={c.id}>
                <b>{c.label}</b>
                {c.note ? <span>{c.note}</span> : null}
              </button>
            ))}
          </div>
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={busy || !choice} onClick={() => void priceNow()} data-web-run>
            {busy ? "Pricing…" : "Price my roof"}
          </button>
        </section>
      )}

      {step === "price" && est && (
        <section className="we-card we-price" data-web-step="price">
          <div className="we-kicker">{est.show === "exact" ? "Your estimated price" : "Your estimated price range"}</div>
          <div className="we-big" data-web-band>{price}</div>
          <p className="we-basis">{est.basis}</p>
          <p className="we-sum">{est.summary}</p>
          <p className="we-choice-line"><i>Priced as</i>{est.choice}</p>
          <button type="button" className="we-btn we-wide" onClick={() => setStep("quote")} data-web-quote>Get my full quote</button>
          <p className="we-fine">The full, line-by-line quote comes from {p.shop.name} after they look at it. You pick a time; they confirm the price.</p>
          <button type="button" className="we-link" onClick={() => setStep("measured")} data-web-again>Try another material</button>
        </section>
      )}

      {step === "quote" && (
        <section className="we-card" data-web-step="quote">
          <h2>{est ? "Your full quote" : "Leave your details"}</h2>
          {est ? <p className="we-note">{est.summary} <b>{price}</b> as {est.choice}. {p.shop.name} confirms it line by line.</p> : <p className="we-note" data-web-no-price>{noPrice ?? `No price this time — ${p.shop.name} will price it and get back to you.`}</p>}
          <form className="we-form" onSubmit={(e) => { e.preventDefault(); void sendNow(); }}>
            {!est ? <label><span>Address of the house</span><input value={typed} autoComplete="street-address" onChange={(e) => { setTyped(e.target.value); setAddress(null); }} data-web-address /></label> : null}
            <label><span>Your name</span><input value={contact.name} autoComplete="name" onChange={(e) => setContact({ ...contact, name: e.target.value })} data-web-name /></label>
            <label><span>Phone</span><input value={contact.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-web-phone /></label>
            {p.askEmail ? <label><span>Email <small>for your copy of the price</small></span><input type="email" value={contact.email} autoComplete="email" onChange={(e) => setContact({ ...contact, email: e.target.value })} data-web-email /></label> : null}
            <label><span>Anything we should know? <small>optional</small></span><textarea rows={3} maxLength={1000} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} data-web-note /></label>
            <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{p.shop.name} may call, text or email me about this roof.</span></label>
            <input className="we-hp" tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} aria-hidden="true" name="company" />
            {error ? <p className="we-err" role="alert">{error}</p> : null}
            <div className="we-row">
              <button type="button" className="we-btn we-ghost" onClick={() => setStep(est ? "price" : "address")} disabled={busy}>Back</button>
              <button type="submit" className="we-btn" disabled={busy || (!est && typed.trim().length < 5)} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
            </div>
          </form>
        </section>
      )}

      {step === "done" && (
        <section className="we-card we-done" data-web-step="done" data-web-lead={leadId ?? ""}>
          <div className="we-tick">✓</div>
          <h2>Sent to {p.shop.name}</h2>
          <p className="we-sub">{est ? <>They have your roof&apos;s measurement and the price you saw, and will be in touch</> : <>They have your request and will price it and get back to you</>}{contact.phone ? ` at ${contact.phone}` : ""} to confirm the details.</p>
          {p.embed ? <button type="button" className="we-btn we-ghost" onClick={() => tell("close")}>Close</button> : null}
        </section>
      )}

      <p className="we-foot">Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</p>
    </div>
  );
}
