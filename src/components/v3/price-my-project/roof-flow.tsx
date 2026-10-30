"use client";
// THE ROOF FLOW (/homeowner/price/roof — was /price/roof — 2026-10-27): address → the three questions → the range → get quotes (or email me
// this range). The flow owns the state; the screens draw it. The range is priced in the browser by the same pure
// engine the server uses (lib/publicEstimate/roof); the Solar read comes once from the server, cached per address.
// Design: docs/superpowers/specs/2026-10-27-home-portal-price-my-project-design.md.
import * as React from "react";
import { publicRoofRead, type PublicRoofReadResult } from "@/actions/publicEstimate";
import { DEFAULT_ANSWERS, type RoofAnswers } from "@/lib/publicEstimate/roof";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { trackTraffic } from "@/lib/traffic-client";
import { PlaceField, type Site } from "./place-field";
import { QuestionCards } from "./question-cards";
import { RangeView, type Priced } from "./range-view";
import { QuotesForm, type ResumePlan } from "./quotes-form";
import { PriceRail } from "./price-row";
import s from "./price.module.css";

type Step = "address" | "questions" | "range";
export type RoofRead = Extract<PublicRoofReadResult, { ok: true }>;

const ORDER: Step[] = ["address", "questions", "range"];
const STEP_LABELS = ["Address", "Your roof", "Your range"];

/** A range saved from the dashboard or the email, picked up at the form (the server prices it again from the cache). */
export type Resume = { site: Site; priced: Priced; plan: ResumePlan };

export function RoofFlow({ prefill, resume }: { prefill: Site | null; resume?: Resume | null }) {
  const [step, setStep] = React.useState<Step>(resume ? "range" : "address");
  const [site, setSite] = React.useState<Site | null>(resume?.site ?? prefill);
  const [answers, setAnswers] = React.useState<RoofAnswers>(resume?.priced.answers ?? DEFAULT_ANSWERS);
  const [read, setRead] = React.useState<RoofRead | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // "Get quotes" / "Email me this range": the form that follows the range (its own task) and what it carries.
  const [form, setForm] = React.useState<{ kind: "quotes" | "email"; priced: Priced } | null>(resume ? { kind: "quotes", priced: resume.priced } : null);
  const hpRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    trackTraffic(TRAFFIC_EVENTS.priceStart, { trade: "roof" });
  }, []);

  async function seeRange() {
    if (!site || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await publicRoofRead({ ...site, website: hpRef.current?.value ?? "", material: answers.material }, { kind: "home" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRead(res);
      setStep("range");
      trackTraffic(TRAFFIC_EVENTS.priceRange, { trade: "roof", basis: res.solar ? "solar" : "size", cached: res.cached });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }} data-price-flow={step}>
      <PriceRail steps={STEP_LABELS} at={ORDER.indexOf(step)} />
      {/* The honeypot: a person never sees it; a script fills it and is refused before any call. */}
      <input ref={hpRef} className={s.hp} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />

      {step === "address" ? (
        <PlaceField
          initial={site}
          onConfirm={(st) => {
            setSite(st);
            setStep("questions");
            trackTraffic(TRAFFIC_EVENTS.priceAddress, { trade: "roof", state: st.state });
          }}
        />
      ) : null}

      {step === "questions" && site ? (
        <div className={s.panel} data-price-step="questions">
          <p className={s.muted}>
            {site.address}, {site.city}, {site.state}{" "}
            <button type="button" className={`${s.btn} ${s.btnQuiet}`} onClick={() => setStep("address")} data-price-back>
              Change
            </button>
          </p>
          <QuestionCards answers={answers} onChange={setAnswers} />
          {error ? <p className={s.err}>{error}</p> : null}
          <div className={s.acts}>
            <button type="button" className={s.btn} disabled={busy} onClick={() => void seeRange()} data-price-go>
              {busy ? "Reading your roof…" : "See my range"}
            </button>
            <span className={s.small}>About a minute. No account.</span>
          </div>
        </div>
      ) : null}

      {form && site ? (
        <QuotesForm mode={form.kind} site={site} priced={form.priced} resume={resume?.plan ?? null} onBack={() => { setForm(null); if (!read) setStep("address"); }} />
      ) : null}

      {step === "range" && site && read && !form ? (
        <RangeView
          site={site}
          read={read}
          answers={answers}
          onAnswers={setAnswers}
          onBack={() => setStep("questions")}
          onQuotes={(priced) => setForm({ kind: "quotes", priced })}
          onEmail={(priced) => setForm({ kind: "email", priced })}
        />
      ) : null}
    </div>
  );
}
