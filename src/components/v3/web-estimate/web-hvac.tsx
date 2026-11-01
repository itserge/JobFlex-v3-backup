"use client";

// THE HVAC ESTIMATOR ON THE CONTRACTOR'S WEBSITE (owner, 2026-10-28: the real estimator, not a short form). The
// homeowner's HVAC estimator: the address → the house looked up (the assessor's living area, year built, storeys,
// the footprint, the elevation, the county's design day — lib/hvac/siteLookup) and confirmed by them → what is there
// now and the system they want → the load (a Manual J-style sizing) and the shop's three tiers, each a real unit
// priced in the shop's book → the one they pick → "Get my full quote". The shop opens the lead with the house on file.
import * as React from "react";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { webHvacLookup, webHvacPrice, webHvacSize, webLead, webView, type WebEstimateView, type WebHouse, type WebHvacSizedView } from "@/actions/webEstimator";
import { bandWords, money, pageWords } from "@/lib/webEstimator";
import { PRO_CAP } from "@/lib/home/jobflexPro";
import { WebHead } from "./web-head";
import { clearCarriedWords, useCarriedWords } from "@/lib/home/carry";
import "./web-estimate.css";

export interface WebHvacProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null; house?: boolean };
  title: string;
  basis: string;
  askEmail: boolean;
  embed: boolean;
}

type Step = "address" | "looking" | "house" | "sizing" | "sized" | "price" | "quote" | "done";
const STEPS: Step[] = ["address", "house", "sized", "price", "quote"];
const YEARS: Array<[string, string]> = [["1960", "Before 1970"], ["1980", "1970s – 80s"], ["1995", "1990s"], ["2005", "2000s"], ["2015", "2010s"], ["2022", "2020 or newer"]];
const nearestYear = (y: number | null) => (y == null ? "1995" : (YEARS.map(([v]) => Number(v)).sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0] ?? 1995).toString());

export function WebHvac(p: WebHvacProps) {
  const [step, setStep] = React.useState<Step>("address");
  const [address, setAddress] = React.useState<PickedAddress | null>(null);
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  const [house, setHouse] = React.useState<WebHouse | null>(null);
  const [ans, setAns] = React.useState({ sqft: "", storeys: "1", year: "1995", existing: "split-ac-furnace", gas: "yes" });
  const [kind, setKind] = React.useState<"ac-furnace" | "heat-pump">("ac-furnace");
  const [sized, setSized] = React.useState<WebHvacSizedView | null>(null);
  const [tier, setTier] = React.useState<"value" | "mid" | "premium">("mid");
  const [est, setEst] = React.useState<WebEstimateView | null>(null);
  const [contactIn, setContact] = React.useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  // The house (2026-10-28, lib/home/carry): what they wrote in the homeowner portal's box is the note to the pro,
  // until they change it here.
  const carried = useCarriedWords();
  const [noted, setNoted] = React.useState(false);
  const contact = p.shop.house && !noted && !contactIn.note ? { ...contactIn, note: carried.slice(0, 1000) } : contactIn;
  const pw = pageWords(p.shop, "system");
  const [leadId, setLeadId] = React.useState<string | null>(null);
  /** Why there is no price (the estimator resting for the month): the form still takes the request. */
  const [noPrice, setNoPrice] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, "hvac").catch(() => {});
  }, [p.shop.slug]);

  const tell = (event: "lead" | "close") => { if (p.embed && typeof window !== "undefined" && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event }, "*"); };
  const addressOk = !!(address?.address || typed.trim().length >= 5);
  const addressIn = () => address ?? { address: typed.trim(), city: "", state: "", zip: "" };

  async function lookUp() {
    setBusy(true); setError(null); setStep("looking");
    const r = await webHvacLookup(p.shop.slug, { address: addressIn() }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      if ("code" in r && r.code === "capped") { setEst(null); if (p.shop.house) setError(r.error); else setNoPrice(r.error); setStep("quote"); return; }
      setError(r.error); setStep("address"); return;
    }
    setToken(r.token); setHouse(r.house);
    setAns((a) => ({ ...a, sqft: r.house.livingSqft ? String(r.house.livingSqft) : a.sqft, storeys: r.house.storeys ? String(Math.min(3, Math.max(1, r.house.storeys))) : a.storeys, year: nearestYear(r.house.yearBuilt) }));
    setStep("house");
  }
  async function sizeNow() {
    if (!token) return;
    const sqft = Number(ans.sqft);
    if (!Number.isFinite(sqft) || sqft < 400) { setError("How many square feet does the system heat and cool? A guess within a few hundred feet is fine."); return; }
    setBusy(true); setError(null); setStep("sizing");
    const r = await webHvacSize(p.shop.slug, token, { answers: { sqft, storeys: ans.storeys, year: ans.year, existing: ans.existing, gas: ans.gas }, choice: kind }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); setStep("house"); return; }
    setSized(r.sized);
    setTier(r.sized.tiers.some((t) => t.tier === "mid") ? "mid" : r.sized.tiers[0].tier);
    setStep("sized");
  }
  async function priceNow(pick: "value" | "mid" | "premium") {
    if (!token) return;
    setTier(pick); setBusy(true); setError(null);
    const r = await webHvacPrice(p.shop.slug, token, pick).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEst(r.estimate); setStep("price");
  }
  async function sendNow() {
    setBusy(true); setError(null);
    if (!est && p.shop.house) { setError(pw.call); setBusy(false); return; }
    // no price (the estimator resting): the request goes with the address alone
    const r = await (est ? webLead(p.shop.slug, "hvac", est.token, contact) : webLead(p.shop.slug, "hvac", null, { ...contact, address: addressIn() })).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.next) { clearCarriedWords(); window.location.assign(r.next); return; }   // the house: the homeowner's own request page
    setLeadId(r.leadId); setStep("done"); tell("lead");
  }

  const price = est ? (est.show === "exact" ? money(est.band.low) : bandWords(est.band)) : null;
  const accent = p.shop.primaryColor || undefined;
  const idx = (s: Step) => STEPS.indexOf(s === "looking" ? "address" : s === "sizing" ? "house" : s === "done" ? "quote" : s);
  const fact = (v: number | null, unit: string) => (v == null ? "—" : `${v.toLocaleString("en-US")}${unit}`);
  const src = (k: string) => house?.sources[k] ?? null;

  return (
    <div className={"we" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="hvac" data-web-step={step}>
      <WebHead shop={p.shop} title={p.title} tool={"HVAC estimator"} embed={p.embed} />
      <ol className="we-steps" aria-hidden="true">
        {STEPS.map((s, i) => <li key={s} className={idx(step) === i ? "on" : idx(step) > i ? "done" : ""}><i>{i + 1}</i></li>)}
      </ol>

      {(step === "address" || step === "looking") && (
        <section className="we-card" data-web-step="address">
          <h2>Where is the house?</h2>
          <p className="we-sub">Type the street address. We look the house up — its size, its age, the local climate — and size the system to it.</p>
          <PlacesAutocomplete className="we-input" placeholder="123 Main St, City, ST" onPick={(a) => { setAddress(a); setTyped(a.formatted ?? a.address); }} onTextChange={(t) => { setTyped(t); if (address && t !== (address.formatted ?? address.address)) setAddress(null); }} />
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={!addressOk || busy} onClick={() => void lookUp()} data-web-next>
            {step === "looking" ? "Looking up the house…" : "Look up my house"}
          </button>
          <p className="we-fine">{pw.sees}</p>
        </section>
      )}

      {(step === "house" || step === "sizing") && house && (
        <section className="we-card" data-web-step="house">
          <h2>Your house</h2>
          <p className="we-sub">What the records say. Correct anything that&apos;s off — the sizing follows your numbers.</p>
          <dl className="we-facts" data-web-facts>
            <div><dt>Living area</dt><dd><b>{house.livingSqft ? house.livingSqft.toLocaleString("en-US") : "—"}</b> sq ft{src("living") ? <small> · {src("living")}</small> : null}</dd></div>
            <div><dt>Year built</dt><dd><b>{house.yearBuilt ?? "—"}</b>{src("yearBuilt") ? <small> · {src("yearBuilt")}</small> : null}</dd></div>
            <div><dt>Footprint</dt><dd><b>{fact(house.footprintSqft, "")}</b> sq ft</dd></div>
            <div><dt>Elevation</dt><dd><b>{fact(house.elevationFt, "")}</b> ft{house.county ? <small> · {house.county}</small> : null}</dd></div>
          </dl>
          <div className="we-qs">
            <label className="we-q"><span>Heated square feet</span><input type="number" min={400} max={8000} step={50} value={ans.sqft} onChange={(e) => setAns({ ...ans, sqft: e.target.value })} data-web-q="sqft" /></label>
            <label className="we-q"><span>Storeys</span><select value={ans.storeys} onChange={(e) => setAns({ ...ans, storeys: e.target.value })} data-web-q="storeys"><option value="1">One storey</option><option value="2">Two storeys</option><option value="3">Three or more</option></select></label>
            <label className="we-q"><span>Year built</span><select value={ans.year} onChange={(e) => setAns({ ...ans, year: e.target.value })} data-web-q="year">{YEARS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="we-q"><span>What is there now</span><select value={ans.existing} onChange={(e) => setAns({ ...ans, existing: e.target.value })} data-web-q="existing"><option value="split-ac-furnace">Air conditioner + furnace</option><option value="split-heat-pump">Heat pump</option><option value="furnace-only">Furnace only</option><option value="none">Nothing yet</option></select></label>
            <label className="we-q"><span>Natural gas at the house</span><select value={ans.gas} onChange={(e) => setAns({ ...ans, gas: e.target.value })} data-web-q="gas"><option value="yes">Yes</option><option value="no">No</option></select></label>
          </div>
          <h2 className="we-h2">What kind of system?</h2>
          <div className="we-choices" role="radiogroup">
            <button type="button" role="radio" aria-checked={kind === "ac-furnace"} className={"we-choice" + (kind === "ac-furnace" ? " on" : "")} onClick={() => setKind("ac-furnace")} data-web-choice="ac-furnace"><b>Air conditioner + gas furnace</b><span>The usual split system</span></button>
            <button type="button" role="radio" aria-checked={kind === "heat-pump"} className={"we-choice" + (kind === "heat-pump" ? " on" : "")} onClick={() => setKind("heat-pump")} data-web-choice="heat-pump"><b>Heat pump</b><span>Heats and cools, all electric</span></button>
          </div>
          {house.warnings.length ? <p className="we-fine">{house.warnings[0]}</p> : null}
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={busy} onClick={() => void sizeNow()} data-web-run>{step === "sizing" ? "Sizing…" : "Size my system"}</button>
        </section>
      )}

      {step === "sized" && sized && (
        <section className="we-card" data-web-step="sized">
          <h2>Sized to your house</h2>
          <p className="we-sub">{sized.summary} Design day: {sized.design.heatingF}°F in winter, {sized.design.coolingF}°F in summer{sized.design.county ? ` (${sized.design.county})` : ""}.</p>
          <dl className="we-facts" data-web-load>
            <div><dt>System size</dt><dd><b>{sized.load.coolingTons.toFixed(1)}</b> tons</dd></div>
            <div><dt>Heating</dt><dd><b>{Math.round(sized.load.heatingBtuh).toLocaleString("en-US")}</b> BTU/h</dd></div>
            <div><dt>Cooling</dt><dd><b>{Math.round(sized.load.coolingTotalBtuh).toLocaleString("en-US")}</b> BTU/h</dd></div>
            <div><dt>Type</dt><dd><b>{sized.outdoorKind === "heat-pump" ? "Heat pump" : "AC + furnace"}</b></dd></div>
          </dl>
          <h2 className="we-h2">Pick a tier</h2>
          <div className="we-choices we-tiers" role="radiogroup">
            {sized.tiers.map((t) => (
              <button key={t.tier} type="button" role="radio" aria-checked={tier === t.tier} className={"we-choice" + (tier === t.tier ? " on" : "")} onClick={() => void priceNow(t.tier)} disabled={busy} data-web-tier={t.tier}>
                <b>{t.label}</b>
                <span>{t.unit}</span>
                <em>{t.words}</em>
              </button>
            ))}
          </div>
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-link" onClick={() => setStep("house")} data-web-back>Change the house or the system</button>
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
          <p className="we-fine">{pw.quote}</p>
          <button type="button" className="we-link" onClick={() => setStep("sized")} data-web-again>Try another tier</button>
        </section>
      )}

      {step === "quote" && (
        <section className="we-card" data-web-step="quote">
          <h2>{est ? "Your full quote" : "Leave your details"}</h2>
          {est ? <p className="we-note">{est.summary} <b>{price}</b> as {est.choice}. {p.shop.house ? PRO_CAP : p.shop.name} confirms it line by line.</p> : !p.shop.house ? <p className="we-note" data-web-no-price>{noPrice ?? `No price this time — ${p.shop.name} will size and price it and get back to you.`}</p> : null}
          <form className="we-form" onSubmit={(e) => { e.preventDefault(); void sendNow(); }}>
            {!est && !p.shop.house ? <label><span>Address of the house</span><input value={typed} autoComplete="street-address" onChange={(e) => { setTyped(e.target.value); setAddress(null); }} data-web-address /></label> : null}
            <label><span>Your name</span><input value={contact.name} autoComplete="name" onChange={(e) => setContact({ ...contact, name: e.target.value })} data-web-name /></label>
            <label><span>Phone</span><input value={contact.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-web-phone /></label>
            {p.askEmail ? <label><span>Email {p.shop.house ? null : <small>for your copy of the price</small>}</span><input type="email" required={!!p.shop.house} value={contact.email} autoComplete="email" onChange={(e) => setContact({ ...contact, email: e.target.value })} data-web-email /></label> : null}
            <label><span>Anything we should know? <small>optional</small></span><textarea rows={3} maxLength={1000} value={contact.note} onChange={(e) => { setNoted(true); setContact({ ...contact, note: e.target.value }); }} data-web-note /></label>
            <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{pw.consent}</span></label>
            <input className="we-hp" tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} aria-hidden="true" name="company" />
            {error ? <p className="we-err" role="alert">{error}</p> : null}
            <div className="we-row">
              <button type="button" className="we-btn we-ghost" onClick={() => setStep(est ? "price" : "address")} disabled={busy}>Back</button>
              <button type="submit" className="we-btn" disabled={busy || (!est && (!!p.shop.house || typed.trim().length < 5))} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
            </div>
            {!est && p.shop.house ? <p className="we-fine"><a className="we-link" href="/homeowner">{pw.call}</a></p> : null}
          </form>
        </section>
      )}

      {step === "done" && (
        <section className="we-card we-done" data-web-step="done" data-web-lead={leadId ?? ""}>
          <div className="we-tick">✓</div>
          <h2>Sent to {p.shop.name}</h2>
          <p className="we-sub">{est ? <>They have your house, the sizing and the price you saw, and will be in touch</> : <>They have your request and will size and price it and get back to you</>}{contact.phone ? ` at ${contact.phone}` : ""} to confirm the details.</p>
          {p.embed ? <button type="button" className="we-btn we-ghost" onClick={() => tell("close")}>Close</button> : null}
        </section>
      )}

      <p className="we-foot">{p.shop.house ? pw.foot : <>Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</>}</p>
    </div>
  );
}
