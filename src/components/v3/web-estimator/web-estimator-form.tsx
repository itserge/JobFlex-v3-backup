"use client";

// SETTINGS → WEBSITE ESTIMATORS (2026-10-27): one row per trade — icon, name, price, its state, the switch — and,
// with the trade on, what the homeowner sees (a range or the exact figure, how wide), which materials they may pick,
// a note under the price, ask for the email; then the shop's sites, the monthly cap, this month's counts, and the
// three ways onto a website (the link, the button, the frame), each with Copy and a Preview. A platform admin also
// sees the owner's switch that opens the feature to every account. Loads and saves itself (actions/webEstimator).
// Restyled 2026-10-30 to the Estimating pane's cloth (company-pricing-form): the same piece sits in the desk pane and
// the phone pane, so it carries its own styles.
//
// THE MONEY (lib/webAddon): with the feature open, a trade on is a line on the shop's plan. Switching a trade on on a
// card plan asks Stripe what today costs (the rest of this period) before anything is saved; Save puts the line on
// and says what was charged. Off takes the line off (a credit). In a trial, free until it ends.
import { useEffect, useState, useTransition } from "react";
import { loadWebEstimator, quoteWebAddon, saveWebEstimator, setWebEstimatorOpenAction, type WebEstimatorView } from "@/actions/webEstimator";
import { SPREAD_MAX, SPREAD_MIN, WEB_TRADE, WEB_TRADES, embedSnippets, type WebEstimatorSettings, type WebTrade } from "@/lib/webEstimator";
import { dollars, webAddonCents, webAddonPriceWords, webBillingWords, webModeBills } from "@/lib/webAddon";
import styles from "./web-estimator-form.module.css";

type Quote = { dueNowCents: number | null; termCents: number; interval: "MONTH" | "YEAR"; trialing: boolean } | "loading" | "error";

/** The trade's mark in the shell sprite (desk: proposals-blueprint/sprite, phone: mobile-shell/sprite). */
const ICON: Record<WebTrade, string> = { roof: "#i-roof", hvac: "#i-heatpump", fence: "#i-fence", deck: "#i-deck", smart: "#i-bulb" };
/** "Roof estimator", "Deck Studio" — the bill's name without "on your website". */
const shortName = (t: WebTrade) => WEB_TRADE[t].name.replace(/ on your website$/, "");
const firstWord = (t: WebTrade) => WEB_TRADE[t].name.split(" ")[0];

export function WebEstimatorForm() {
  const [view, setView] = useState<WebEstimatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<WebEstimatorSettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Partial<Record<WebTrade, Quote>>>({});
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [domainsText, setDomainsText] = useState("");
  const [embedPick, setEmbedPick] = useState<WebTrade | null>(null);

  useEffect(() => {
    let alive = true;
    void loadWebEstimator().then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.error); return; }
      setView(r.view); setSettings(r.view.settings); setDomainsText(r.view.settings.domains.join(", "));
    });
    return () => { alive = false; };
  }, []);

  if (!view || !settings) {
    return error
      ? <p className={`${styles.form} ${styles.note} ${styles.isErr}`} data-nest="" role="alert">{error}</p>
      : <p className={`${styles.form} ${styles.note}`} data-nest="">Loading your website estimators…</p>;
  }

  const billing = view.billing;
  const bills = view.open && webModeBills(billing.mode);
  const set = (next: WebEstimatorSettings) => { setSettings(next); setSaved(null); };
  const setTrade = (t: WebTrade, patch: Partial<WebEstimatorSettings["trades"][WebTrade]>) => set({ ...settings, trades: { ...settings.trades, [t]: { ...settings.trades[t], ...patch } } });
  const flip = (t: WebTrade, on: boolean) => {
    setTrade(t, { on });
    // switched on on a card plan without its line: ask what today costs
    if (on && bills && !billing.held[t] && !quotes[t]) {
      setQuotes((q) => ({ ...q, [t]: "loading" }));
      void quoteWebAddon(t).then((r) => setQuotes((q) => ({ ...q, [t]: r.ok ? { dueNowCents: r.dueNowCents, termCents: r.termCents, interval: r.interval, trialing: r.trialing } : "error" })));
    }
  };
  const save = () => start(async () => {
    const next = { ...settings, domains: domainsText.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean) };
    const r = await saveWebEstimator(next);
    if (!r.ok) { setError(r.error); return; }
    setSettings(r.settings); setDomainsText(r.settings.domains.join(", ")); setSaved("Saved"); setError(null);
    setNotes(r.notes); setErrors(r.errors); setQuotes({});
    setView({ ...view, settings: r.settings, billing: r.billing });
  });
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800); } catch { /* the field is selectable */ } };
  const flipOpen = (on: boolean) => start(async () => { const r = await setWebEstimatorOpenAction(on); if (r.ok) { const v = await loadWebEstimator(); if (v.ok) { setView(v.view); setSettings(v.view.settings); } else setView({ ...view, open: r.open }); } else setError(r.error); });

  const onTrades = WEB_TRADES.filter((t) => settings.trades[t].on);
  // unsaved changes: the Preview opens the SAVED page, so it waits for Save
  const dirty = JSON.stringify(settings) !== JSON.stringify(view.settings) || domainsText.split(/[,\s]+/).filter(Boolean).join(",") !== view.settings.domains.join(",");
  const adding = bills ? WEB_TRADES.filter((t) => settings.trades[t].on && !billing.held[t]) : [];
  const removing = bills ? WEB_TRADES.filter((t) => !settings.trades[t].on && billing.held[t]) : [];
  const cannot = view.open && (billing.mode === "free" || billing.mode === "offline");
  const per = billing.interval === "YEAR" ? "year" : "month";
  const embedTrade = embedPick && onTrades.includes(embedPick) ? embedPick : onTrades[0];

  const status = pending ? "Saving…"
    : error ? error
      : saved ? `${saved}${onTrades.length ? ` · ${onTrades.map(firstWord).join(", ")} on` : ""}`
        : dirty ? "Unsaved changes"
          : "";
  const statusTone = error && !pending ? styles.isErr : saved && !pending ? styles.isOk : dirty && !pending ? styles.isWarn : "";

  return (
    <div className={styles.form} data-nest="" data-web-estimator-form data-web-billing={billing.mode}>
      {view.admin ? (
        <div className={styles.notice} data-web-admin>
          <div className={styles.noticeTxt}>
            <span className={styles.kicker}>{view.open ? "Live" : "Preview"}</span>
            <p>{view.open ? "Open to every account — a trade on is a line on the shop's plan." : "Only JobFlex admins see this page and can turn a trade on; nothing is billed yet."}</p>
          </div>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={pending} onClick={() => flipOpen(!view.open)} data-web-open-switch>
            {view.open ? "Back to preview" : "Open to every account"}
          </button>
        </div>
      ) : null}

      <section className={styles.group}>
        <h4 className={styles.gh}>Estimators</h4>
        <ul className={styles.list}>
          {WEB_TRADES.map((t) => {
            const info = WEB_TRADE[t], ts = settings.trades[t], held = billing.held[t] ?? null, q = quotes[t];
            const words = view.open
              ? webBillingWords({ mode: billing.mode, trade: t, interval: billing.interval, held, on: ts.on, trialEndsAt: billing.trialEndsAt })
              : "In preview — not billed";
            const willAdd = bills && ts.on && !held, willRemove = bills && !ts.on && !!held;
            const tag = !ts.on ? "off" : view.open ? "on" : "preview";
            return (
              <li key={t} className={styles.trade} data-web-trade={t} data-on={ts.on} data-held={!!held}>
                <div className={styles.row}>
                  <span className={styles.tic} aria-hidden="true">
                    <svg className={styles.ico}><use href={ICON[t]} /></svg>
                  </span>
                  <div className={styles.rowTxt}>
                    <b>{shortName(t)}</b>
                    <span data-web-money={t}>{words}</span>
                  </div>
                  <span className={styles.price}>{dollars(held ? held.cents : webAddonCents(t, billing.interval))} / {per}</span>
                  <span className={`${styles.tag} ${tag === "on" ? styles.tagOn : tag === "preview" ? styles.tagPreview : ""}`} data-web-tag={tag}>{tag}</span>
                  <button
                    type="button"
                    className={styles.tg}
                    role="switch"
                    aria-checked={ts.on}
                    aria-label={`${shortName(t)} on your website`}
                    disabled={cannot && !ts.on}
                    onClick={() => flip(t, !ts.on)}
                    data-web-on={t}
                  />
                </div>
                {willAdd ? (
                  <p className={styles.money} data-web-quote={t}>
                    {q === "loading" ? "Asking what today costs…"
                      : q && q !== "error" ? (q.trialing || q.dueNowCents === 0 ? `Nothing charged today. ${webAddonPriceWords(q.termCents, q.interval, true)} from the end of your trial. Added when you save.`
                        : q.dueNowCents === null ? `Charged today for the rest of this period, then ${webAddonPriceWords(q.termCents, q.interval, true)}. Added when you save.`
                        : `Charged today: ${dollars(q.dueNowCents)} for the rest of this period, then ${webAddonPriceWords(q.termCents, q.interval, true)}. Added when you save.`)
                      : q === "error" ? "Couldn't read what today costs — Save still adds it, prorated for this period."
                      : "Added to your plan when you save."}
                    {!billing.owner ? " Only the account owner can add it." : ""}
                  </p>
                ) : null}
                {willRemove ? <p className={styles.money} data-web-quote={t}>Taken off your plan when you save{billing.mode === "card" ? "; the unused days come back as a credit on your next bill" : ""}.{!billing.owner ? " Only the account owner can take it off." : ""}</p> : null}
                {ts.on ? (
                  <div className={styles.body}>
                    <div className={styles.fld}>
                      <span className={styles.lbl}>The homeowner sees</span>
                      <div className={styles.seg} role="radiogroup" aria-label={`${shortName(t)}: the homeowner sees`} data-web-show={t}>
                        {([["range", "A price range", "A band around your price"], ["exact", "The exact figure", "Your price, to the dollar"]] as const).map(([v, name, d]) => (
                          <button key={v} type="button" role="radio" aria-checked={ts.show === v} className={styles.segBtn} onClick={() => setTrade(t, { show: v })}>
                            <b>{name}</b>
                            <span>{d}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {ts.show === "range" ? (
                      <label className={styles.fld}>
                        <span className={styles.lblRow}><span className={styles.lbl}>How wide</span><span className={styles.hintIn}>±{Math.round(ts.spread * 100)}% each way</span></span>
                        <input className={styles.range} type="range" min={SPREAD_MIN * 100} max={SPREAD_MAX * 100} step={1} value={Math.round(ts.spread * 100)} onChange={(e) => setTrade(t, { spread: Number(e.target.value) / 100 })} data-web-spread={t} />
                      </label>
                    ) : null}
                    {t === "deck" ? (
                      <div className={styles.fld}>
                        <span className={styles.lbl}>What they design</span>
                        <p className={styles.hint}>The whole Deck Studio in 3D — kinds, size and shape, height, stairs, railing, boards, roofs, a lower level, a photo of their house wall. The price at the end is your rate book on what they drew.</p>
                      </div>
                    ) : t === "smart" ? (
                      <div className={styles.fld}>
                        <span className={styles.lbl}>What they describe</span>
                        <p className={styles.hint}>The project in their own words and photos; the intake asks the cost-critical questions; the estimate runs in your own method and price book. Any trade — kitchens, baths, basements, additions.</p>
                      </div>
                    ) : (
                      <div className={styles.fld}>
                        <span className={styles.lblRow}><span className={styles.lbl}>What they may pick</span><span className={styles.hintIn}>none picked = all of these</span></span>
                        <div className={styles.chips}>
                          {view.choices[t].map((c) => {
                            const on = ts.materials.includes(c.id);
                            return (
                              <button key={c.id} type="button" className={styles.chip} aria-pressed={on} title={c.note ?? ""} onClick={() => setTrade(t, { materials: on ? ts.materials.filter((m) => m !== c.id) : [...ts.materials, c.id] })} data-web-material={c.id}>
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <label className={styles.fld}>
                      <span className={styles.lblRow}><span className={styles.lbl}>Under the price</span><span className={styles.hintIn}>your own words, or leave the standard line</span></span>
                      <span className={styles.box}>
                        <input className={styles.in} value={ts.note} placeholder={info.basis} maxLength={200} onChange={(e) => setTrade(t, { note: e.target.value })} data-web-note={t} />
                      </span>
                    </label>
                    <div className={styles.opt}>
                      <div className={styles.optTxt}>
                        <b>Ask for their email too</b>
                        <span>Name and one way to reach them are always asked.</span>
                      </div>
                      <button type="button" className={styles.tg} role="switch" aria-checked={ts.askEmail} aria-label={`${shortName(t)}: ask for their email too`} onClick={() => setTrade(t, { askEmail: !ts.askEmail })} />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.group}>
        <h4 className={styles.gh}>Where it runs</h4>
        <label className={styles.fld}>
          <span className={styles.lblRow}><span className={styles.lbl}>Your websites</span><span className={styles.hintIn}>the button runs only on these; the link works anywhere. Blank = any site.</span></span>
          <span className={styles.box}>
            <input className={styles.in} value={domainsText} placeholder="ridgelineroofing.com, shop.ridgelineroofing.com" onChange={(e) => { setDomainsText(e.target.value); setSaved(null); }} data-web-domains />
          </span>
        </label>
        <label className={styles.fld}>
          <span className={styles.lblRow}><span className={styles.lbl}>Public estimates a month</span><span className={styles.hintIn}>a cost guard; the page rests after it and still takes the lead</span></span>
          <span className={`${styles.box} ${styles.boxNarrow}`}>
            <input className={styles.in} type="number" min={20} max={5000} step={10} value={settings.monthlyCap} onChange={(e) => set({ ...settings, monthlyCap: Number(e.target.value) || 0 })} data-web-cap />
            <i className={styles.affix}>/ month</i>
          </span>
        </label>
        <div className={styles.fld} data-web-counts>
          <span className={styles.lbl}>This month</span>
          <div className={styles.tiles}>
            {([["Views", view.counts.views], ["Estimates", view.counts.estimates], ["Leads", view.counts.leads]] as const).map(([k, n]) => (
              <div key={k} className={styles.tile}>
                <span>{k}</span>
                <b>{n.toLocaleString("en-US")}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      {onTrades.length && view.slug ? (
        <section className={styles.group} data-web-embed>
          <h4 className={styles.gh}>On your site</h4>
          {onTrades.length > 1 ? (
            <div className={styles.sub} role="tablist" aria-label="Which estimator">
              {onTrades.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={t === embedTrade} className={styles.subBtn} onClick={() => setEmbedPick(t)}>
                  {firstWord(t)}
                </button>
              ))}
            </div>
          ) : null}
          <Snippets base={view.base} slug={view.slug} trade={embedTrade} copied={copied} onCopy={copy} saved={view.settings.trades[embedTrade].on && !dirty} />
        </section>
      ) : null}

      {notes.length ? <ul className={styles.notes} data-web-notes>{notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {errors.length ? <ul className={styles.errors} role="alert" data-web-errors>{errors.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {!view.slug ? <p className={`${styles.note} ${styles.isErr}`}>This company has no public handle yet — the link can&apos;t be made.</p> : null}

      <div className={styles.foot}>
        {status ? <p className={`${styles.status} ${statusTone}`} role="status" aria-live="polite" data-web-saved={saved && !pending ? "" : undefined}>{status}</p> : null}
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending} onClick={save} data-web-save>
          {pending ? "Saving…" : adding.length ? `Save and add to my plan (${adding.map(firstWord).join(", ")})` : removing.length ? "Save and take off my plan" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Snippets({ base, slug, trade, copied, onCopy, saved }: { base: string; slug: string; trade: WebTrade; copied: string | null; onCopy: (what: string, text: string) => void; saved: boolean }) {
  const s = embedSnippets(base, slug, trade);
  const rows: Array<[string, string, string, string]> = [
    ["button", "The button", 'one line where your site builder takes "custom HTML" or "embed code"', s.button],
    ["link", "The link", "a button on your site, Google Business Profile, Facebook, an email, a QR code", s.link],
    ["frame", "On the page", "a frame that shows the estimator inside your own page", s.iframe],
  ];
  return (
    <div className={styles.snips} data-web-snippets={trade}>
      {rows.map(([k, name, how, code]) => (
        <div key={k} className={styles.fld}>
          <span className={styles.lblRow}><span className={styles.lbl}>{name}</span><span className={styles.hintIn}>{how}</span></span>
          <div className={styles.snipRow}>
            <span className={`${styles.box} ${styles.boxCode}`}>
              <input className={`${styles.in} ${styles.code}`} readOnly value={code} aria-label={`${name} — code`} onFocus={(e) => e.currentTarget.select()} data-web-snippet={k} />
            </span>
            <button type="button" className={`${styles.btn} ${styles.btnGhost} ${copied === `${trade}:${k}` ? styles.isDone : ""}`} onClick={() => onCopy(`${trade}:${k}`, code)}>{copied === `${trade}:${k}` ? "Copied" : "Copy"}</button>
            {k === "link" ? (saved ? <a className={`${styles.btn} ${styles.btnGhost}`} href={code} target="_blank" rel="noreferrer" data-web-preview={trade}>Preview</a> : <span className={`${styles.btn} ${styles.btnGhost} ${styles.btnOff}`} title="The page answers once this is saved as On" data-web-preview-wait={trade}>Save first</span>) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
