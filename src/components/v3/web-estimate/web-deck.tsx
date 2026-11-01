"use client";

// DECK STUDIO ON THE CONTRACTOR'S WEBSITE (owner, 2026-10-28: "they should have access to the Deck Studio and can design
// it in 3D, whatever they need; just give them the rough price in the end; the contractor opens the design in the
// studio and sends back the full quote"). The address first — the code tables come from it — then the homeowner's
// designer (components/v3/deck-client-design), the one the contractor's client link opens, in its website mode: the
// price at the end in the shop's book, "Get my full quote" → the lead. The design link's token stays in this
// browser, so coming back lands on the same deck.
import * as React from "react";
import dynamic from "next/dynamic";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { webDeckPrice, webDeckResume, webDeckSend, webDeckStart, webLead, webView, type WebDeckProps } from "@/actions/webEstimator";
import { pageWords } from "@/lib/webEstimator";
import { PRO } from "@/lib/home/jobflexPro";
import { WebHead } from "./web-head";
import "./web-estimate.css";

const Designer = dynamic(() => import("@/components/v3/deck-client-design/deck-client-designer").then((m) => m.DeckClientDesigner), {
  ssr: false,
  loading: () => <p style={{ padding: 24, fontFamily: "Inter, -apple-system, sans-serif", color: "#6b7280" }}>Opening the studio…</p>,
});

export interface WebDeckPageProps {
  shop: { name: string; slug: string; logoUrl: string | null; primaryColor: string | null; phone: string | null; website: string | null; house?: boolean };
  title: string;
  embed: boolean;
}

export function WebDeck(p: WebDeckPageProps) {
  const key = `jf-web-deck:${p.shop.slug}`;
  const [state, setState] = React.useState<"boot" | "address" | "starting" | "design" | "resting" | "sent">("boot");
  /** The studio resting for the month (the shop's cap): no design, but the request still goes, with the address. */
  const [noPrice, setNoPrice] = React.useState<string | null>(null);
  const [contact, setContact] = React.useState({ name: "", phone: "", email: "", note: "", consent: false, company: "" });
  const [busy, setBusy] = React.useState(false);
  const [props, setProps] = React.useState<WebDeckProps | null>(null);
  const [typed, setTyped] = React.useState("");
  const [address, setAddress] = React.useState<PickedAddress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void webView(p.shop.slug, "deck").catch(() => {});
    let token: string | null = null;
    try { token = localStorage.getItem(key); } catch { token = null; }
    const back = token ? webDeckResume(p.shop.slug, token) : Promise.resolve({ ok: false as const, error: "" });
    void back.then((r) => {
      if (r.ok) { setProps(r.props); setState("design"); return; }
      try { localStorage.removeItem(key); } catch { /* nothing kept */ }
      setState("address");
    }).catch(() => setState("address"));
  }, [p.shop.slug, key]);

  const addressOk = !!(address?.address || typed.trim().length >= 5);
  const start = async () => {
    setState("starting");
    setError(null);
    const a = address ? [address.address, address.city, [address.state, address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : typed.trim();
    const r = await webDeckStart(p.shop.slug, a).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    if (!r.ok) {
      if (!p.shop.house && "code" in r && r.code === "capped") { setNoPrice(r.error); setState("resting"); return; }
      setError(r.error); setState("address"); return;
    }
    try { localStorage.setItem(key, r.props.token); } catch { /* the page still works; a reload starts over */ }
    setProps(r.props);
    setState("design");
  };

  if (state === "design" && props) {
    const token = props.token;
    return (
      <div data-web-estimate="deck" data-web-step="design" data-web-token={token}>
        <Designer
          token={token}
          shop={props.shop}
          clientName=""
          clientPhone={null}
          address={props.address}
          start="blank"
          base={props.base}
          work={props.work}
          note={props.note}
          unsure={[]}
          sentAt={props.sentAt}
          expired={false}
          website={{ askEmail: props.askEmail, leadId: props.leadId, house: !!p.shop.house, price: (d) => webDeckPrice(token, d), send: (i) => webDeckSend(token, i) }}
        />
      </div>
    );
  }

  const accent = p.shop.primaryColor || undefined;
  const typedAddress = address ? [address.address, address.city, [address.state, address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : typed.trim();
  const sendRequest = async () => {
    setBusy(true); setError(null);
    const r = await webLead(p.shop.slug, "deck", null, { ...contact, address: { address: typedAddress, city: "", state: "", zip: "" } }).catch(() => ({ ok: false as const, error: "Something went wrong — try again." }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setState("sent");
    if (p.embed && window.parent !== window) window.parent.postMessage({ jobflex: "estimator", event: "lead" }, "*");
  };
  if (state === "resting" || state === "sent") {
    return (
      <div className={"we" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="deck" data-web-step={state === "sent" ? "done" : "quote"}>
        <WebHead shop={p.shop} title={p.title} tool={"Deck Studio"} embed={p.embed} />
        {state === "sent" ? (
          <section className="we-card we-done" data-web-step="done">
            <div className="we-tick">✓</div>
            <h2>Sent to {p.shop.name}</h2>
            <p className="we-sub">They have your request and will price it and get back to you{contact.phone ? ` at ${contact.phone}` : ""}.</p>
          </section>
        ) : (
          <section className="we-card" data-web-step="quote">
            <h2>Leave your details</h2>
            <p className="we-note" data-web-no-price>{noPrice ?? `The studio is resting — ${p.shop.name} will design and price it with you.`}</p>
            <form className="we-form" onSubmit={(e) => { e.preventDefault(); void sendRequest(); }}>
              <label><span>Address of the house</span><input value={typedAddress} autoComplete="street-address" onChange={(e) => { setAddress(null); setTyped(e.target.value); }} data-web-address /></label>
              <label><span>Your name</span><input value={contact.name} autoComplete="name" onChange={(e) => setContact({ ...contact, name: e.target.value })} data-web-name /></label>
              <label><span>Phone</span><input value={contact.phone} inputMode="tel" autoComplete="tel" onChange={(e) => setContact({ ...contact, phone: e.target.value })} data-web-phone /></label>
              <label><span>Email <small>optional</small></span><input type="email" value={contact.email} autoComplete="email" onChange={(e) => setContact({ ...contact, email: e.target.value })} data-web-email /></label>
              <label><span>The deck you have in mind <small>optional</small></span><textarea rows={3} maxLength={1000} value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} data-web-note /></label>
              <label className="we-consent"><input type="checkbox" checked={contact.consent} onChange={(e) => setContact({ ...contact, consent: e.target.checked })} data-web-consent /><span>{p.shop.name} may call, text or email me about this deck.</span></label>
              <input className="we-hp" tabIndex={-1} autoComplete="off" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} aria-hidden="true" name="company" />
              {error ? <p className="we-err" role="alert">{error}</p> : null}
              <div className="we-row">
                <button type="button" className="we-btn we-ghost" onClick={() => setState("address")} disabled={busy}>Back</button>
                <button type="submit" className="we-btn" disabled={busy || typedAddress.length < 5} data-web-send>{busy ? "Sending…" : "Send my request"}</button>
              </div>
            </form>
          </section>
        )}
        <p className="we-foot">Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</p>
      </div>
    );
  }
  return (
    <div className={"we" + (p.embed ? " we-embed" : "")} style={accent ? ({ "--we-accent": accent } as React.CSSProperties) : undefined} data-web-estimate="deck" data-web-step="address">
      <WebHead shop={p.shop} title={p.title} tool={"Deck Studio"} embed={p.embed} />
      <section className="we-card">
        <h2>Where is the deck going?</h2>
        <p className="we-sub">Type the street address. The building code for your area — snow, frost, railing heights — comes from it, and the design is drawn to it.</p>
        {state === "boot" ? <p className="we-fine">One moment…</p> : null}
        <PlacesAutocomplete className="we-input" placeholder="123 Main St, City, ST" onPick={(a) => { setAddress(a); setTyped(a.formatted ?? a.address); }} onTextChange={(t) => { setTyped(t); if (address && t !== (address.formatted ?? address.address)) setAddress(null); }} />
        {error ? <p className="we-err" role="alert">{error}</p> : null}
        <button type="button" className="we-btn" disabled={!addressOk || state !== "address"} onClick={() => void start()} data-web-next>
          {state === "starting" ? "Opening the studio…" : "Design my deck"}
        </button>
        <p className="we-fine">No account, no payment. Design it in 3D, see the price at the end, and {p.shop.house ? PRO : p.shop.name} sends the full quote when you ask for it.</p>
      </section>
      <p className="we-foot">{p.shop.house ? pageWords(p.shop, "deck").foot : <>Estimates by <b>JobFlex</b> for {p.shop.name}. No prices are shown to anyone else; the final price follows a visit.</>}</p>
    </div>
  );
}
