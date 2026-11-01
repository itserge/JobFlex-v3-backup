"use client";

// FENCE STUDIO ON THE CONTRACTOR'S WEBSITE (owner, 2026-10-28: the real estimator, not a short form). The homeowner's
// fence studio: the address → the satellite map of THEIR lot with the lot lines and the buildings (lib/fence/
// boundaryLookup) → they draw the fence (the studio's own drawing map), pick the style and the height, drop gates,
// turn it in 3D → "See my price" prices the runs they drew in the shop's book → "Get my full quote". The shop opens
// the lead in its Fence Studio. When the map can't load, they type the feet instead.
import * as React from "react";
import dynamic from "next/dynamic";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { webFenceLot, webFencePrice, webGeocode, webLead, webView, type WebEstimateView, type WebLot } from "@/actions/webEstimator";
import { bandWords, money, pageWords } from "@/lib/webEstimator";
import { PRO_CAP } from "@/lib/home/jobflexPro";
import type { WebChoice } from "@/lib/webEstimatorTrades";
import type { BuildingFootprint, GateSpec, PathPoint } from "@/components/estimator/fence/fenceTypes";
import { presetWidthFt } from "@/components/estimator/fence/fenceTypes";
import { buildingsToFootprints, latLngToLocalFeet, simplifyPath } from "@/components/estimator/fence/mapProjection";
import type { ArmedOpening } from "@/stores/useFenceStudioStore";
import { WebHead } from "./web-head";
import { clearCarriedWords, useCarriedWords } from "@/lib/home/carry";
import "./web-estimate.css";

const DrawMap = dynamic(() => import("@/components/estimator/fence/FenceDrawMap").then((m) => m.FenceDrawMap), { ssr: false, loading: () => <div className="we-fence-wait">Loading the map…</div> });
const Model3D = dynamic(() => import("@/components/estimator/fence/FenceModel3D").then((m) => m.FenceModel3D), { ssr: false, loading: () => <div className="we-fence-wait">Loading the 3D…</div> });

export interface WebFenceProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null; house?: boolean };
  title: string;
  basis: string;
  askEmail: boolean;
  choices: WebChoice[];
  embed: boolean;
}

type Step = "address" | "finding" | "draw" | "price" | "quote" | "done";
const STEPS: Step[] = ["address", "draw", "price", "quote"];
const HEIGHTS = [4, 5, 6, 8];
const COLOR: Array<[RegExp, string]> = [[/cedar|shadowbox|board-on-board|picket|horizontal|split-rail/, "#b07a45"], [/pine/, "#c9a46a"], [/vinyl/, "#f1f1ee"], [/composite/, "#6b5a4a"], [/chain-link-black/, "#2a2f36"], [/chain/, "#9aa3ad"], [/aluminum|steel/, "#1f2328"]];
const colorFor = (id: string) => COLOR.find(([re]) => re.test(id))?.[1] ?? "#b07a45";
const dist = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y);
let gateN = 0;

export function WebFence(p: WebFenceProps) {
  const [step, setStep] = React.useState<Step>("address");
  const [address, setAddress] = React.useState<PickedAddress | null>(null);
  const [typed, setTyped] = React.useState("");
  const [origin, setOrigin] = React.useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lot, setLot] = React.useState<WebLot | null>(null);
  const [lotState, setLotState] = React.useState<"idle" | "loading" | "done">("idle");
  const [points, setPoints] = React.useState<PathPoint[]>([]);
  const [rev, setRev] = React.useState(0);
  const [gates, setGates] = React.useState<GateSpec[]>([]);
  const [armed, setArmed] = React.useState<ArmedOpening | null>(null);
  const [style, setStyle] = React.useState<string>(p.choices[0]?.id ?? "cedar-privacy");
  const [heightFt, setHeightFt] = React.useState(6);
  const [view, setView] = React.useState<"map" | "3d">("map");
  const [typedFeet, setTypedFeet] = React.useState("");
  const [typedGates, setTypedGates] = React.useState("1");
  /** Why there is no price (the estimator resting for the month): the form still takes the request. */
  const [noPrice, setNoPrice] = React.useState<string | null>(null);
  const [byHand, setByHand] = React.useState(false);
  const [est, setEst] = React.useState<WebEstimateView | null>(null);
  const [contactIn, setContact] = React.useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  // The house (2026-10-28, lib/home/carry): what they wrote in the homeowner portal's box is the note to the pro,
  // until they change it here.
  const carried = useCarriedWords();
  const [noted, setNoted] = React.useState(false);
  const contact = p.shop.house && !noted && !contactIn.note ? { ...contactIn, note: carried.slice(0, 1000) } : contactIn;
  const pw = pageWords(p.shop, "fence");
  const [leadId, setLeadId] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, "fence").catch(() => {});
  }, [p.shop.slug]);

  const tell = (event: "lead" | "close") => { if (p.embed && typeof window !== "undefined" && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event }, "*"); };
  const addressOk = !!(address?.address || typed.trim().length >= 5);
  const addressIn = () => ({ ...(address ?? { address: typed.trim(), city: "", state: "", zip: "" }), ...(origin ? { lat: origin.lat, lng: origin.lng } : {}) });

  // the lot: the parcel ring and the buildings, in the map's frame and the 3D's
  const parcelFt = React.useMemo(() => (origin && lot?.ring ? simplifyPath(lot.ring.map((ll) => latLngToLocalFeet(origin, ll)), 1) : null), [origin, lot]);
  const footprints = React.useMemo<BuildingFootprint[]>(() => (origin && lot ? buildingsToFootprints(lot.buildings, origin, parcelFt) : []), [origin, lot, parcelFt]);
  const detected = React.useMemo(() => (lot ? lot.buildings.map((b) => b.ring) : []), [lot]);
  const runsFt = React.useMemo(() => points.slice(1).map((pt, i) => dist(points[i], pt)), [points]);
  const feet = Math.round(runsFt.reduce((s, n) => s + n, 0));
  const walkGates = gates.filter((g) => g.kind === "gate" && g.widthFt < 8).length;
  const doubleGates = gates.filter((g) => g.kind === "gate" && g.widthFt >= 8).length;

  async function find() {
    setBusy(true); setError(null); setStep("finding");
    let o = address && typeof address.lat === "number" && typeof address.lng === "number" ? { lat: address.lat, lng: address.lng } : null;
    if (!o) {
      const g = await webGeocode(p.shop.slug, address?.formatted ?? address?.address ?? typed).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
      if (!g.ok) { setBusy(false); setError(g.error); setStep("address"); return; }
      o = { lat: g.lat, lng: g.lng };
    }
    setOrigin(o);
    setBusy(false);
    setStep("draw");
    setLotState("loading");
    const r = await webFenceLot(p.shop.slug, o.lat, o.lng).catch(() => ({ ok: false as const, error: "" }));
    setLotState("done");
    if (r.ok) setLot(r.lot);
  }
  const useLotLines = () => { if (!parcelFt || parcelFt.length < 3) return; setPoints([...parcelFt, parcelFt[0]]); setRev((v) => v + 1); };
  const clearAll = () => { setPoints([]); setGates([]); setArmed(null); setRev((v) => v + 1); };
  const arm = (variant: "single" | "double") => setArmed({ kind: "gate", variant, widthFt: presetWidthFt("gate", variant) });

  async function priceNow() {
    setBusy(true); setError(null);
    const hand = byHand || points.length < 2;
    const runs = hand ? [Number(typedFeet)] : runsFt;
    const nGates = hand ? Number(typedGates) || 0 : walkGates;
    const nDoubles = hand ? 0 : doubleGates;
    if (!runs.some((n) => Number.isFinite(n) && n > 0)) { setBusy(false); setError(hand ? "How many feet of fence?" : "Draw the fence line on the map first — tap the corners."); return; }
    const r = await webFencePrice(p.shop.slug, { address: addressIn(), runsFt: runs, type: style, heightFt, gates: nGates, doubles: nDoubles, points: hand ? null : points }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) {
      if (!p.shop.house && "code" in r && (r.code === "capped" || r.code === "unavailable")) { setEst(null); setNoPrice(r.error); setStep("quote"); return; }
      setError(r.error); return;
    }
    setEst(r.estimate); setStep("price");
  }
  async function sendNow() {
    setBusy(true); setError(null);
    // no price (the estimator resting): the request goes with the address alone
    const r = await (est ? webLead(p.shop.slug, "fence", est.token, contact) : webLead(p.shop.slug, "fence", null, { ...contact, address: addressIn() })).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.next) { clearCarriedWords(); window.location.assign(r.next); return; }   // the house: the homeowner's own request page
    setLeadId(r.leadId); setStep("done"); tell("lead");
  }

  const price = est ? (est.show === "exact" ? money(est.band.low) : bandWords(est.band)) : null;
  const accent = p.shop.primaryColor || undefined;
  const idx = (s: Step) => STEPS.indexOf(s === "finding" ? "address" : s === "done" ? "quote" : s);

  return (
    <div className={"we we-fence" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="fence" data-web-step={step}>
      <WebHead shop={p.shop} title={p.title} tool={"Fence Studio"} embed={p.embed} />
      <ol className="we-steps" aria-hidden="true">
        {STEPS.map((s, i) => <li key={s} className={idx(step) === i ? "on" : idx(step) > i ? "done" : ""}><i>{i + 1}</i></li>)}
      </ol>

      {(step === "address" || step === "finding") && (
        <section className="we-card" data-web-step="address">
          <h2>Where is the fence going?</h2>
          <p className="we-sub">Type the street address. We bring up your lot from the air with its property lines, and you draw the fence on it.</p>
          <PlacesAutocomplete className="we-input" placeholder="123 Main St, City, ST" onPick={(a) => { setAddress(a); setTyped(a.formatted ?? a.address); }} onTextChange={(t) => { setTyped(t); if (address && t !== (address.formatted ?? address.address)) setAddress(null); }} />
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={!addressOk || busy} onClick={() => void find()} data-web-next>
            {step === "finding" ? "Finding the lot…" : "Show my lot"}
          </button>
          <p className="we-fine">{pw.sees}</p>
        </section>
      )}

      {step === "draw" && origin && (
        <section className="we-card we-fence-card" data-web-step="draw">
          <h2>Draw the fence on your lot</h2>
          <p className="we-sub">Tap the corners where the fence goes{lot?.ring ? " — or start from your property lines" : ""}. Pick the style and the height, drop the gates where you want them, and look at it in 3D.</p>
          <div className="we-fence-bar">
            <div className="we-fence-tools">
              {lot?.ring ? <button type="button" className="we-btn we-ghost we-sm" onClick={useLotLines} data-web-lot-lines>Use my property lines</button> : null}
              <button type="button" className={"we-btn we-ghost we-sm" + (armed?.variant === "single" ? " on" : "")} onClick={() => arm("single")} data-web-gate>+ Gate</button>
              <button type="button" className={"we-btn we-ghost we-sm" + (armed?.variant === "double" ? " on" : "")} onClick={() => arm("double")} data-web-gate-double>+ Double gate</button>
              <button type="button" className="we-btn we-ghost we-sm" onClick={clearAll} data-web-clear>Clear</button>
            </div>
            <div className="we-fence-view" role="radiogroup">
              <button type="button" className={"we-btn we-ghost we-sm" + (view === "map" ? " on" : "")} onClick={() => setView("map")} data-web-view="map">Map</button>
              <button type="button" className={"we-btn we-ghost we-sm" + (view === "3d" ? " on" : "")} onClick={() => setView("3d")} disabled={points.length < 2} data-web-view="3d">3D</button>
            </div>
          </div>
          {lotState === "loading" ? <p className="we-fine">Looking up your lot lines…</p> : lot?.note ? <p className="we-fine">{lot.note}</p> : null}
          <div className="we-fence-stage" data-web-fence-stage>
            <div className={"we-fence-pane" + (view === "map" ? " show" : "")}>
              <DrawMap lat={origin.lat} lng={origin.lng} points={points} onChange={(pts) => setPoints(pts)} revision={rev} gates={gates} armed={armed} customOpenings={[]} onArm={(kind, variant) => setArmed({ kind, variant, widthFt: presetWidthFt(kind, variant) })} onDropOpening={(segmentIndex, t, x, y) => { if (!armed) return; setGates((g) => [...g, { id: `wg${++gateN}`, segmentIndex, t, widthFt: armed.widthFt, kind: armed.kind, variant: armed.variant, ...(typeof x === "number" && typeof y === "number" ? { x, y } : {}) }]); setArmed(null); }} onUpdateGate={(id, patch) => setGates((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)))} onDisarm={() => setArmed(null)} parcel={lot?.ring ? { ring: lot.ring } : null} detectedBuildings={detected} className="we-fence-map" />
            </div>
            <div className={"we-fence-pane" + (view === "3d" ? " show" : "")}>
              {view === "3d" ? <Model3D points={points} height={heightFt} material={style} materialColor={colorFor(style)} gates={gates} selectedSegment={null} buildings={footprints} controls="orbit" active className="we-fence-3d" /> : null}
            </div>
          </div>
          <div className="we-fence-sum" data-web-fence-sum>
            {points.length >= 2 ? <><b>{feet.toLocaleString("en-US")} ft</b> of fence in {runsFt.length} run{runsFt.length === 1 ? "" : "s"}{gates.length ? ` · ${gates.length} gate${gates.length > 1 ? "s" : ""}` : ""}</> : <span>Nothing drawn yet.</span>}
            <button type="button" className="we-link" onClick={() => setByHand((v) => !v)} data-web-by-hand>{byHand ? "Draw it on the map instead" : "I'll type the feet instead"}</button>
          </div>
          {byHand ? (
            <div className="we-qs">
              <label className="we-q"><span>Feet of fence</span><input type="number" min={10} max={3000} step={5} value={typedFeet} onChange={(e) => setTypedFeet(e.target.value)} data-web-feet /></label>
              <label className="we-q"><span>Walk gates</span><input type="number" min={0} max={6} value={typedGates} onChange={(e) => setTypedGates(e.target.value)} data-web-feet-gates /></label>
            </div>
          ) : null}
          <h2 className="we-h2">What style?</h2>
          <div className="we-choices" role="radiogroup">
            {p.choices.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={style === c.id} className={"we-choice" + (style === c.id ? " on" : "")} onClick={() => setStyle(c.id)} data-web-choice={c.id}>
                <b>{c.label}</b>
                {c.note ? <span>{c.note}</span> : null}
              </button>
            ))}
          </div>
          <div className="we-fence-heights" role="radiogroup" aria-label="Height">
            <span className="we-q-lbl">Height</span>
            {HEIGHTS.map((h) => <button key={h} type="button" role="radio" aria-checked={heightFt === h} className={"we-btn we-ghost we-sm" + (heightFt === h ? " on" : "")} onClick={() => setHeightFt(h)} data-web-height={h}>{h} ft</button>)}
          </div>
          {error ? <p className="we-err" role="alert">{error}</p> : null}
          <button type="button" className="we-btn we-wide" disabled={busy} onClick={() => void priceNow()} data-web-run>{busy ? "Pricing…" : "See my price"}</button>
        </section>
      )}

      {step === "price" && est && (
        <section className="we-card we-price" data-web-step="price">
          <div className="we-kicker">{est.show === "exact" ? "Your estimated price" : "Your estimated price range"}</div>
          <div className="we-big" data-web-band>{price}</div>
          <p className="we-basis">{est.basis}</p>
          <p className="we-sum">{est.summary}</p>
          <p className="we-choice-line"><i>Priced as</i>{est.choice}, {heightFt} ft</p>
          <button type="button" className="we-btn we-wide" onClick={() => setStep("quote")} data-web-quote>Get my full quote</button>
          <p className="we-fine">{pw.quote}</p>
          <button type="button" className="we-link" onClick={() => setStep("draw")} data-web-again>Change the fence</button>
        </section>
      )}

      {step === "quote" && (
        <section className="we-card" data-web-step="quote">
          <h2>{est ? "Your full quote" : "Leave your details"}</h2>
          {est ? <p className="we-note">{est.summary} <b>{price}</b> as {est.choice}. {p.shop.house ? PRO_CAP : p.shop.name} confirms it line by line.</p> : <p className="we-note" data-web-no-price>{noPrice ?? `No price this time — ${p.shop.name} will price it and get back to you.`}</p>}
          <form className="we-form" onSubmit={(e) => { e.preventDefault(); void sendNow(); }}>
            {!est ? <label><span>Address of the house</span><input value={typed} autoComplete="street-address" onChange={(e) => { setTyped(e.target.value); setAddress(null); }} data-web-address /></label> : null}
            <label><span>Your name</span><input value={contact.name} autoComplete="name" onChange={(e) => setContact({ ...contact, name: e.target.value })} data-web-name /></label>
            <label><span>Phone</span><input value={contact.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-web-phone /></label>
            {p.askEmail ? <label><span>Email {p.shop.house ? null : <small>for your copy of the price</small>}</span><input type="email" required={!!p.shop.house} value={contact.email} autoComplete="email" onChange={(e) => setContact({ ...contact, email: e.target.value })} data-web-email /></label> : null}
            <label><span>Anything we should know? <small>optional</small></span><textarea rows={3} maxLength={1000} value={contact.note} onChange={(e) => { setNoted(true); setContact({ ...contact, note: e.target.value }); }} data-web-note /></label>
            <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{pw.consent}</span></label>
            <input className="we-hp" tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} aria-hidden="true" name="company" />
            {error ? <p className="we-err" role="alert">{error}</p> : null}
            <div className="we-row">
              <button type="button" className="we-btn we-ghost" onClick={() => setStep(est ? "price" : "draw")} disabled={busy}>Back</button>
              <button type="submit" className="we-btn" disabled={busy || (!est && typed.trim().length < 5)} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
            </div>
          </form>
        </section>
      )}

      {step === "done" && (
        <section className="we-card we-done" data-web-step="done" data-web-lead={leadId ?? ""}>
          <div className="we-tick">✓</div>
          <h2>Sent to {p.shop.name}</h2>
          <p className="we-sub">{est ? <>They have your fence as you drew it and the price you saw, and will be in touch</> : <>They have your request and will price it and get back to you</>}{contact.phone ? ` at ${contact.phone}` : ""} to confirm the details.</p>
          {p.embed ? <button type="button" className="we-btn we-ghost" onClick={() => tell("close")}>Close</button> : null}
        </section>
      )}

      <p className="we-foot">{p.shop.house ? pw.foot : <>Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</>}</p>
    </div>
  );
}
