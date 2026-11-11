"use client";

// "REVENUE UNAVAILABLE" WITH THE NEW PLANS' NUMBERS (Base + Tools, part 5) — only where Stripe isn't set up at all (a
// dev stand: app/(admin)/admin/revenue/page): the Stripe figures can't be read, the new plans' numbers come from the
// platform's own record. The phone gets the page's handheld layout, as RevenueContent does.
import { useSyncExternalStore } from "react";
import type { ToolPlansReport } from "@/lib/toolPlans/numbers";
import { ToolPlansSection } from "./tool-plans-section";
import s from "./revenue.module.css";

const subscribe = (fn: () => void) => { const m = window.matchMedia("(max-width: 768px)"); m.addEventListener("change", fn); return () => m.removeEventListener("change", fn); };
const snapshot = () => window.matchMedia("(max-width: 768px)").matches;

export function RevenueUnavailable({ tools, currency }: { tools: ToolPlansReport; currency: string }) {
  const mobile = useSyncExternalStore(subscribe, snapshot, () => false);
  return (
    <main className={`${s.root} ${mobile ? s.mobile : ""}`}>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>Platform / Financials</p>
          <h1>Revenue unavailable</h1>
          <p className={s.subtle}>We couldn’t complete the Stripe read. No estimated totals are shown. <a href="/admin/revenue" style={{ textDecoration: "underline" }}>Try again</a></p>
        </div>
      </header>
      <ToolPlansSection data={tools} currency={currency} mobile={mobile} />
    </main>
  );
}
