"use client";

// THE UPGRADE GATE — what a custom-plan org sees at the URL of a page its
// plan does not include.
//
// It RENDERS AT THE BLOCKED URL rather than redirecting (owner's call,
// 2026-08-31): the nav keeps drawing the locked page as a dimmed, padlocked
// row, clicking it lands here, and pasting the URL lands here too — one
// answer for both doors, and the address bar still says where you are. The
// layouts and the page-level gate (custom-page-gate) render this INSTEAD of
// the page, so the page's own server code never runs for an org that has not
// bought it.
//
// ONE BUTTON ADDS THE PAGE (owner, 2026-10-06): "Add Calendar for $10/mo" on
// the custom plan's own subscription (actions/billing.addCustomPages →
// lib/customBilling) — the prorated difference is charged now, nothing during
// a trial — and the page opens on the refresh. Only the owner can; anyone
// else is told who can. What it costs today is Stripe's own preview.
//
// THE NEW PLANS (Base + Tools, part 3a — owner, 2026-11-10: "no locks"). For a
// shop on them (the blocked list carries TOOLS_MARK) the menu never draws the
// page, so this is reached only by a pasted or old link: the card says which
// tool (or which size) opens it and what it costs, with one button to the
// Subscription page's Upgrade your plan — no padlock, no "not included".
//
// A PLAIN STYLESHEET, self-scoped under .jf-upgate, for the same reason the
// support widget's is: this renders inside whichever shell owns the URL —
// blueprint desktop, classic, or a handheld frame — so it can lean on none of
// their hash spaces. Tokens are read with fallbacks, never re-declared.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { addCustomPages, previewCustomPagesChange } from "@/actions/billing";
import { toolGatePrices } from "@/actions/toolPlans";
import { toast } from "@/components/ui/Toast";
import {
  CUSTOM_PAGE_CENTS,
  CUSTOM_PAGES,
  PLAN_ENDED_MARK,
  TOOLS_MARK,
  classicPageId,
  gatedPage,
  isGatedPageId,
  isPaidFeature,
  pageForPath,
  type GatedPage,
} from "@/lib/customPlan";
import { DEFAULT_CATALOG, money as toolMoney, toolOffering, type ToolId, type ToolPlanId } from "@/lib/toolPlans/shared";
import "./upgrade-gate.css";
import { BillingRecovery } from "../payment-ribbon/billing-recovery";

function money(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

type Preview = { dueNowCents: number | null; monthlyCents: number; trialing: boolean };

export function UpgradeGate({
  pathname,
  locked,
  isOwner = false,
}: {
  pathname: string;
  /** The org's blocked hrefs (lib/customPageAccess) — what it holds is the
   *  rest, which prices the plan after this page is added. */
  locked?: readonly string[];
  /** Only the owner changes the plan (actions/billing requireOwner). */
  isOwner?: boolean;
}) {
  const router = useRouter();
  // "#feature:<id>" names a gated feature that has no page of its own (custom-page-gate).
  const featureId = pathname.startsWith("#feature:") ? pathname.slice("#feature:".length) : null;
  const found: GatedPage | null = featureId ? (isGatedPageId(featureId) ? gatedPage(featureId) : null) : pageForPath(pathname);
  // A shop on the new plans (TOOLS_MARK): the tool's card below. A Classic shop reads a new-plan page as its Classic
  // twin — the blueprint estimator is Smart Proposal's page there, offered and added as that.
  const tools = Boolean(locked?.includes(TOOLS_MARK));
  const twin = found && !tools ? classicPageId(found.id) : null;
  const gated: GatedPage | null = found && twin && twin !== found.id ? gatedPage(twin) ?? found : found;
  // Only a sellable add-on page can be added on its own; a paid feature comes with any plan.
  const page = gated && !isPaidFeature(gated.id) ? CUSTOM_PAGES.find((p) => p.id === gated.id) ?? null : null;
  const label = gated?.label ?? "This page";
  const owned = CUSTOM_PAGES.filter((p) => !(locked ?? []).includes(p.href)).map((p) => p.id as string);
  // THE PLAN ENDED (owner, 2026-10-07): cancelled, unpaid, expired or a
  // card-less trial run out (lib/planStatus) — every add-on is closed for that
  // reason, and the way back is a plan, not one page.
  const ended = Boolean(locked?.includes(PLAN_ENDED_MARK));
  const canAdd = Boolean(page && isOwner && locked && !ended && !tools);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = page && canAdd ? [...owned, page.id].join(",") : "";

  useEffect(() => {
    if (!key) return;
    let live = true;
    previewCustomPagesChange(key.split(","))
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);

  async function add() {
    if (!page || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await addCustomPages([page.id]);
      if (!res.ok) throw new Error(res.error);
      toast.success(
        `${page.label} added`,
        res.chargedCents > 0
          ? `${money(res.chargedCents)} charged today. Your plan is ${money(res.monthlyCents)}/mo from the next bill.`
          : `Your plan is ${money(res.monthlyCents)}/mo from the next bill.`,
      );
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add the page.");
      setBusy(false);
    }
  }

  if (ended) {
    return (
      <div className="jf-upgate" data-nest="">
        <div className="jf-upgate-recovery">
          <BillingRecovery isOwner={isOwner} pageLabel={label} blocked />
        </div>
      </div>
    );
  }

  if (tools) return <ToolsOffer id={gated?.id ?? null} label={label} isOwner={isOwner} />;

  return (
    <div className="jf-upgate" data-nest="">
      <div className="jf-upgate-card">
        <div className="jf-upgate-kick">Custom plan · not included</div>
        <svg className="jf-upgate-lock" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="1.5" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <h1 className="jf-upgate-h">{label} isn&apos;t in your plan.</h1>
        <p className="jf-upgate-p">
          {page ? (
            <>
              <b>{page.label}</b> ({page.note.toLowerCase()}) is a {money(CUSTOM_PAGE_CENTS)}/mo add-on to your custom plan.
            </>
          ) : (
            "Your custom plan doesn't include this page."
          )}{" "}
          {page && !isOwner ? "Ask the account owner to add it." : null}
        </p>
        {canAdd ? (
          <p className="jf-upgate-note" aria-live="polite">
            {preview?.trialing
              ? `Nothing is charged during your trial; your plan becomes ${money(preview.monthlyCents)}/mo.`
              : preview && preview.dueNowCents !== null
                ? `${money(preview.dueNowCents)} today for the rest of this billing period, then ${money(preview.monthlyCents)}/mo.`
                : "Charged today for the rest of this billing period, prorated."}
          </p>
        ) : null}
        {err ? (
          <p className="jf-upgate-err" role="alert">
            {err}
          </p>
        ) : null}
        <div className="jf-upgate-row">
          {canAdd ? (
            <button type="button" className="jf-upgate-go" disabled={busy} aria-busy={busy} onClick={() => void add()}>
              {busy ? "Adding…" : `Add ${label} for ${money(CUSTOM_PAGE_CENTS)}/mo`}
            </button>
          ) : (
            <Link className="jf-upgate-go" href={"/dashboard/upgrade" as Route}>
              See plans
            </Link>
          )}
          <Link className="jf-upgate-back" href={(canAdd ? "/dashboard/upgrade" : "/dashboard") as Route}>
            {canAdd ? "Compare plans" : "Back to overview"}
          </Link>
        </div>
      </div>
    </div>
  );
}

type GatePrices = { tools: Partial<Record<ToolId, number>>; plans: Partial<Record<ToolPlanId, number>> };

/** "Roof estimator · $49/mo" — what opens a page on the new plans, from the catalog's ids (lib/toolPlans/shared
 *  toolOffering). The prices are the code's until the server answers with Admin → Plans' (actions/toolPlans). */
function ToolsOffer({ id, label, isOwner }: { id: string | null; label: string; isOwner: boolean }) {
  const [prices, setPrices] = useState<GatePrices | null>(null);
  useEffect(() => {
    let live = true;
    toolGatePrices()
      .then((p) => {
        if (live && p) setPrices(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const offer = id ? toolOffering(id, DEFAULT_CATALOG) : null;
  const toolCents = offer?.kind === "tool" ? prices?.tools[offer.tool.id] ?? offer.tool.cents : 0;
  const planCents = offer?.kind === "size" ? prices?.plans[offer.plan.id] ?? offer.plan.cents : 0;
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  return (
    <div className="jf-upgate" data-nest="" data-tools-offer={id ?? ""}>
      <div className="jf-upgate-card">
        <div className="jf-upgate-kick">{offer?.kind === "size" ? `On ${offer.plan.name}` : "Add it to your plan"}</div>
        <h1 className="jf-upgate-h jf-upgate-h-gap">{label}</h1>
        <p className="jf-upgate-p">
          {offer?.kind === "tool" ? (
            offer.tool.label === label ? (
              offer.tool.note
            ) : (
              <>
                {label} comes with <b>{offer.tool.label}</b>: {lower(offer.tool.note)}
                {offer.also.length ? ` Also in ${offer.also.map((t) => t.label).join(" and ")}.` : null}
              </>
            )
          ) : offer?.kind === "size" ? (
            <>
              {label} comes with the <b>{offer.plan.name}</b> plan.
            </>
          ) : (
            "See what you can add to your plan."
          )}
        </p>
        {offer ? (
          <p className="jf-upgate-price">
            {offer.kind === "tool" ? `${toolMoney(toolCents)}/mo on your bill` : `${offer.plan.name} is ${toolMoney(planCents)}/mo`}
          </p>
        ) : null}
        {!isOwner ? <p className="jf-upgate-note">Ask the account owner to add it.</p> : null}
        <div className="jf-upgate-row">
          {isOwner ? (
            <Link className="jf-upgate-go" href={"/dashboard/subscription" as Route}>
              See it in Upgrade your plan
            </Link>
          ) : (
            <Link className="jf-upgate-go" href={"/dashboard" as Route}>
              Back to overview
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
