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
// A PLAIN STYLESHEET, self-scoped under .jf-upgate, for the same reason the
// support widget's is: this renders inside whichever shell owns the URL —
// blueprint desktop, classic, or a handheld frame — so it can lean on none of
// their hash spaces. Tokens are read with fallbacks, never re-declared.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { addCustomPages, previewCustomPagesChange } from "@/actions/billing";
import { toast } from "@/components/ui/Toast";
import { CUSTOM_PAGE_CENTS, CUSTOM_PAGES, PLAN_ENDED_MARK, gatedPage, isPaidFeature, pageForPath, type GatedPage } from "@/lib/customPlan";
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
  // "#feature:<id>" names a paid feature that has no page of its own (custom-page-gate).
  const featureId = pathname.startsWith("#feature:") ? pathname.slice("#feature:".length) : null;
  const gated: GatedPage | null = featureId ? (isPaidFeature(featureId) ? gatedPage(featureId) : null) : pageForPath(pathname);
  // Only a sellable add-on page can be added on its own; a paid feature comes with any plan.
  const page = gated && !isPaidFeature(gated.id) ? CUSTOM_PAGES.find((p) => p.id === gated.id) ?? null : null;
  const label = gated?.label ?? "This page";
  const owned = CUSTOM_PAGES.filter((p) => !(locked ?? []).includes(p.href)).map((p) => p.id as string);
  // THE PLAN ENDED (owner, 2026-10-07): cancelled, unpaid, expired or a
  // card-less trial run out (lib/planStatus) — every add-on is closed for that
  // reason, and the way back is a plan, not one page.
  const ended = Boolean(locked?.includes(PLAN_ENDED_MARK));
  const canAdd = Boolean(page && isOwner && locked && !ended);
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
