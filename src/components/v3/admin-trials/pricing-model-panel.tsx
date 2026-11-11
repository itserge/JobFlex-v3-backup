"use client";

// THE PLANS SWITCH (owner, 2026-11-10), on Admin → Trial watch under the sign-up switches: which plans NEW sign-ups
// get — Classic (today) or Base + Tools (lib/toolPlans). Off until the build is finished: the "Base + Tools" button
// stays greyed, with the parts still to come listed, until lib/toolPlans/server TOOLS_PLANS_READY is true. Shops
// already on a plan stay Classic whatever this says. Same clothes as the other switches.
import { useState } from "react";
import { setPricingModelAction } from "@/actions/trialPolicy";
import { money, ladderChecks, TOOL_PLANS, TOOLS } from "@/lib/toolPlans/shared";
import type { PricingModel, PricingModelSetting } from "@/lib/toolPlans/server";
import t from "./trial-policy.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const NOW: Record<PricingModel, string> = {
  classic: "Classic plans: new sign-ups get today's plan cards (Starter, Professional, Advanced) and the sign-up works exactly as it does now.",
  tools: "Base + Tools: new sign-ups get Basic, Professional, Advanced or Complete, with the tool their ad sold as their main tool. The menu shows only what they have; everything else is one click away under Upgrade your plan.",
};

export function PricingModelPanel({ initial, ready, parts }: { initial: PricingModelSetting; ready: boolean; parts: ReadonlyArray<{ part: number; what: string; done: boolean }> }) {
  const [v, setV] = useState(initial);
  const [pending, setPending] = useState<PricingModel | null>(null);
  const [error, setError] = useState("");
  const pick = async (mode: PricingModel) => {
    if (mode === v.mode || pending) return;
    setPending(mode);
    setError("");
    try {
      const res = await setPricingModelAction({ mode });
      if (res.ok) setV(res.pricing);
      else setError(res.error);
    } catch {
      setError("The switch could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  };
  const why = v.source === "admin" ? `Set here${v.at ? ` on ${when(v.at)}` : ""}${v.by ? ` by ${v.by}` : ""}.` : "The default; nothing set here yet.";
  const ladderOk = ladderChecks().every((c) => c.ok);
  const todo = parts.filter((p) => !p.done);
  return (
    <section className={t.panel} aria-label="Plans for new sign-ups" data-pricing-model={v.mode} data-mode={v.mode === "tools" ? "card" : undefined}>
      <div className={t.main}>
        <div className={t.kicker}>Plans · new sign-ups</div>
        <p className={t.now} aria-live="polite">
          {NOW[v.mode]}
        </p>
        <dl className={t.facts}>
          {TOOL_PLANS.map((p) => (
            <div key={p.id}>
              <dt>{p.name}</dt>
              <dd>
                {money(p.cents)}/mo · {p.includedTrade === "all" ? "every tool" : p.seats === 1 ? "just the owner" : `${p.seats} people`}
              </dd>
            </div>
          ))}
        </dl>
        <p className={t.why}>
          {why} Shops already on a plan never change: their plan stays Classic whatever this says. The landing pages stay as
          they are; when this is on, only the plan cards change, and an ad&apos;s <code>?tool=</code> link prices them with its
          tool (&quot;Professional + Deck Studio&quot;). {TOOLS.length} tools from {money(Math.min(...TOOLS.map((x) => x.cents)))} to{" "}
          {money(Math.max(...TOOLS.map((x) => x.cents)))} a month, each with a 3-day free try.{" "}
          {ladderOk ? "Every bundle costs less than its parts." : "Warning: a bundle costs more than its parts — check the prices."}
        </p>
        {!ready && todo.length > 0 && (
          <p className={t.why} data-pricing-todo>
            <b>Not ready to turn on yet.</b> Still to build:{" "}
            {todo.map((p, i) => (
              <span key={p.part}>
                {i > 0 ? "; " : ""}part {p.part}, {p.what.charAt(0).toLowerCase() + p.what.slice(1)}
              </span>
            ))}
            .
          </p>
        )}
        {error && (
          <p className={t.err} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={t.actions}>
        <div className={t.seg} role="radiogroup" aria-label="Plans for new sign-ups">
          <button type="button" role="radio" aria-checked={v.mode === "classic"} className={t.segBtn} disabled={pending !== null} onClick={() => void pick("classic")}>
            {pending === "classic" ? "Saving…" : "Classic plans"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={v.mode === "tools"}
            className={t.segBtn}
            disabled={pending !== null || (!ready && v.mode !== "tools")}
            title={ready ? undefined : "Opens when the last part is built"}
            style={ready ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
            onClick={() => void pick("tools")}
          >
            {pending === "tools" ? "Saving…" : ready ? "Base + Tools" : "Base + Tools · not ready"}
          </button>
        </div>
      </div>
    </section>
  );
}
