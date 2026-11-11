"use client";

// THE NEW PLANS' PRICES on Admin → Plans (Base + Tools, part 2 — owner, 2026-11-10: "prices live in Admin → Plans").
// The four sizes, the extra-person price on each size that sells people, and the twelve tools. The price rule is
// checked as you type and on save (lib/toolPlans/shared priceProblems): a bundle always costs less than its parts.
// Only what differs from the code's prices is stored; a shop keeps the price its line was bought at.
import { useMemo, useState } from "react";
import { saveToolPricesAction } from "@/actions/toolPlans";
import { DEFAULT_CATALOG, ladderChecks, money, priceProblems, withPrices, type PriceSet, type SeatPlanId, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";
import type { ToolPriceSetting } from "@/lib/toolPlans/prices";
import s from "./tool-prices.module.css";

type Field = { group: "plans" | "seats" | "tools"; id: string; label: string; base: number };

const FIELDS: Field[] = [
  ...DEFAULT_CATALOG.plans.map((p) => ({ group: "plans" as const, id: p.id, label: p.name, base: p.cents })),
  ...DEFAULT_CATALOG.plans.filter((p) => p.seatCents !== null).map((p) => ({ group: "seats" as const, id: p.id, label: `Each person after ${p.seats} · ${p.name}`, base: p.seatCents! })),
  ...DEFAULT_CATALOG.tools.map((t) => ({ group: "tools" as const, id: t.id, label: t.label, base: t.cents })),
];

const keyOf = (f: Field) => `${f.group}:${f.id}`;
const dollars = (cents: number) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function centsOf(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function ToolPricesPanel({ initial }: { initial: ToolPriceSetting }) {
  const start = useMemo(() => {
    const cat = withPrices(initial.prices);
    const v: Record<string, string> = {};
    for (const f of FIELDS) {
      const cents =
        f.group === "plans" ? cat.plans.find((p) => p.id === f.id)!.cents : f.group === "seats" ? cat.plans.find((p) => p.id === f.id)!.seatCents! : cat.tools.find((t) => t.id === f.id)!.cents;
      v[keyOf(f)] = dollars(cents);
    }
    return v;
  }, [initial.prices]);
  const [values, setValues] = useState(start);
  const [setting, setSetting] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  // Only what differs from the code's prices is sent and stored.
  const { set, bad } = useMemo(() => {
    const out: PriceSet = { plans: {}, seats: {}, tools: {} };
    const wrong: string[] = [];
    for (const f of FIELDS) {
      const cents = centsOf(values[keyOf(f)] ?? "");
      if (cents === null) {
        wrong.push(`${f.label}: type a price like 49 or 39.99.`);
        continue;
      }
      if (cents === f.base) continue;
      if (f.group === "plans") out.plans![f.id as ToolPlanId] = cents;
      else if (f.group === "seats") out.seats![f.id as SeatPlanId] = cents;
      else out.tools![f.id as ToolId] = cents;
    }
    return { set: out, bad: wrong };
  }, [values]);
  const cat = withPrices(set);
  const checks = ladderChecks(cat.plans, cat.tools);
  const live = bad.length ? bad : priceProblems(set);

  const save = async () => {
    if (busy || live.length) return;
    setBusy(true);
    setProblems([]);
    setSaved(false);
    try {
      const res = await saveToolPricesAction(set);
      if (res.ok) {
        setSetting(res.setting);
        setSaved(true);
      } else setProblems(res.problems);
    } catch {
      setProblems(["The prices could not be saved. Try again."]);
    } finally {
      setBusy(false);
    }
  };

  const group = (g: Field["group"], title: string) => (
    <div className={s.group}>
      <span className={s.glab}>{title}</span>
      {FIELDS.filter((f) => f.group === g).map((f) => {
        const k = keyOf(f);
        const id = `tp-${f.group}-${f.id}`;
        const changed = centsOf(values[k] ?? "") !== f.base;
        return (
          <div className={s.row} key={k}>
            <label htmlFor={id}>{f.label}</label>
            <div className={s.money} data-changed={changed}>
              <span>$</span>
              <input
                id={id}
                inputMode="decimal"
                value={values[k] ?? ""}
                onChange={(e) => {
                  setSaved(false);
                  setValues((v) => ({ ...v, [k]: e.target.value }));
                }}
                aria-describedby="tp-note"
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className={s.panel} aria-label="Base + Tools prices" data-tool-prices>
      <div className={s.head}>
        <div>
          <div className={s.kicker}>New plans · Base + Tools</div>
          <h2 className={s.title}>Prices for the new plans, per month</h2>
        </div>
        <span className={s.note}>
          {setting.source === "admin" ? `Saved${setting.at ? ` ${when(setting.at)}` : ""}${setting.by ? ` by ${setting.by}` : ""}.` : "The prices in the plan; nothing changed here yet."}
        </span>
      </div>
      <p className={s.note} id="tp-note">
        Only new sign-ups on the new plans pay these, and only once the Plans switch on Trial watch is on. A shop keeps the price it bought at. Yearly is ten
        months&apos; price. A changed price is outlined in blue.
      </p>
      <div className={s.groups}>
        {group("plans", "Plans")}
        {group("seats", "Extra people")}
        {group("tools", "Tools")}
      </div>
      <div className={s.group}>
        <span className={s.glab}>A bundle always costs less than its parts</span>
        <ul className={s.checks}>
          {checks.map((c) => (
            <li key={c.label} data-ok={c.ok}>
              {c.ok ? "✓" : "✗"} {c.label}: {money(c.bundle)} vs {money(c.parts)}
            </li>
          ))}
        </ul>
      </div>
      {(problems.length > 0 || (live.length > 0 && !bad.length)) && (
        <p className={s.err} role="alert">
          {(problems.length ? problems : live).join(" ")}
        </p>
      )}
      {bad.length > 0 && (
        <p className={s.err} role="alert">
          {bad.join(" ")}
        </p>
      )}
      <div className={s.foot}>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || live.length > 0} data-tool-prices-save>
          {busy ? "Saving…" : "Save prices"}
        </button>
        {saved && <p className={s.ok}>Saved. New lines use these prices from now on.</p>}
      </div>
    </section>
  );
}
