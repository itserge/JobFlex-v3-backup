"use client";

// MOBILE · Create account — attribution.
//
// The RESOLUTION LOGIC is the desktop port's (components/v3/
// auth-register-blueprint/referral-banner.tsx) verbatim: check the register URL
// for ?promo / ?ref, then the 30-day capture cookie, then localStorage, and
// validate whatever turns up through the existing `validateAttributionCode`
// server action. The resolved pill is a CLAIM, not proof — the server
// re-validates whatever code registerAccount finally receives.
//
// TWO CHANGES FROM THE DESKTOP PORT, both deliberate:
//
// 1. A MANUAL CODE FIELD (flagged in the build report as an addition beyond the
//    desktop port). Auto-capture only fires for someone who arrived through a
//    link; a contractor holding a printed card or a code read to them on the
//    phone had no way in. Optional, collapsed by default, and it calls the SAME
//    existing server action — no new endpoint, no data-layer change. A typed
//    code cannot declare whether it is a promo or a referral, so the panel
//    tries `promo` first and falls back to `ref`; both shapes match CODE_RE and
//    an invalid code simply fails both.
//
// 2. THIS COMPONENT NO LONGER RENDERS THE PILL — it reports the resolved pill
//    upward and renders only the entry affordance. On a phone the two want
//    different homes: the reward belongs directly under the headline (where the
//    desktop banner sits), while a "have a code?" disclosure between the
//    headline and the first field would tax the majority who have none. One
//    component still owns the single validation path.

import * as React from "react";
import { validateAttributionCode } from "@/actions/attribution";
import { CODE_RE, readClientAttr } from "@/lib/attributionShared";
import { discountPhrase } from "@/lib/promoDiscount";

export type RegisterAttribution = { kind: "promo" | "ref"; code: string };

export type ResolvedAttribution = {
  kind: "promo" | "ref";
  code: string;
  displayName: string;
  percentOff: number | null;
  discountMonths: number | null;
};

export function MobileReferralPanel({
  resolved,
  onResolved,
}: {
  resolved: ResolvedAttribution | null;
  onResolved: (a: ResolvedAttribution | null) => void;
}) {
  const onResolvedRef = React.useRef(onResolved);
  React.useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  const [open, setOpen] = React.useState(false);
  const [manual, setManual] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [manualErr, setManualErr] = React.useState<string | null>(null);

  const apply = React.useCallback(async (kind: "promo" | "ref", code: string): Promise<boolean> => {
    const res = await validateAttributionCode({ kind, code });
    if (!res.ok) return false;
    onResolvedRef.current({
      kind: res.kind,
      code: res.code,
      displayName: res.displayName,
      percentOff: res.percentOff,
      discountMonths: res.discountMonths,
    });
    return true;
  }, []);

  React.useEffect(() => {
    // Freshest signal first: a code in the register URL itself, then the capture
    // cookie, then localStorage.
    const sp = new URLSearchParams(window.location.search);
    const urlPromo = sp.get("promo")?.trim().toUpperCase();
    const urlRef = sp.get("ref")?.trim().toUpperCase();
    const fromUrl = urlPromo
      ? ({ k: "promo", c: urlPromo } as const)
      : urlRef
        ? ({ k: "ref", c: urlRef } as const)
        : null;
    const candidate = fromUrl && CODE_RE.test(fromUrl.c) ? fromUrl : readClientAttr();
    if (!candidate) return;
    void apply(candidate.k, candidate.c);
  }, [apply]);

  async function onApplyManual() {
    if (checking) return;
    const code = manual.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      setManualErr("Codes are 3–40 letters, numbers, dashes or underscores.");
      return;
    }
    setManualErr(null);
    setChecking(true);
    try {
      // A typed code carries no kind — try the promo table, then referrals.
      const ok = (await apply("promo", code)) || (await apply("ref", code));
      if (!ok) setManualErr("That code isn't valid. Check it and try again.");
    } finally {
      setChecking(false);
    }
  }

  // Resolved — the pill is rendered by the page, under the headline.
  if (resolved) return null;

  return (
    <div className="mr-code">
      <button
        className="mr-code-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="mr-code-body"
        onClick={() => setOpen((v) => !v)}
      >
        <svg className="ic" aria-hidden="true">
          <use href="#mrg-gift" />
        </svg>
        <span>Have a promo or referral code?</span>
        <svg className={open ? "ic mr-code-chev is-up" : "ic mr-code-chev"} aria-hidden="true">
          <use href="#mrg-chev" />
        </svg>
      </button>

      <div className={open ? "mr-code-body" : "mr-code-body is-hidden"} id="mr-code-body">
        <div className="mr-code-row">
          <input
            className="mr-in mr-code-in"
            id="mr-promo"
            name="promoCode"
            placeholder="e.g. MIKE20"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onApplyManual();
              }
            }}
            aria-label="Promo or referral code"
          />
          <button
            className="mr-code-apply"
            type="button"
            onClick={() => void onApplyManual()}
            disabled={checking || manual.trim().length === 0}
          >
            {checking ? "…" : "Apply"}
          </button>
        </div>
        <span className={manualErr ? "mr-code-note is-bad" : "mr-code-note"} role="status">
          {manualErr ?? "Optional. Referral links apply their code for you."}
        </span>
      </div>
    </div>
  );
}

/** The earned reward, rendered by the page directly under the headline. */
export function MobileReferralPill({ pill }: { pill: ResolvedAttribution }) {
  return (
    <div className="mr-ref" role="status">
      <span className="mr-ref-ic">
        <svg className="ic" aria-hidden="true">
          <use href="#mrg-gift" />
        </svg>
      </span>
      <span className="mr-ref-txt">
        <span className="mr-ref-t">
          {pill.kind === "ref" ? "Referred by " : "Code from "}
          {pill.displayName}
          <svg className="ic mr-ref-check" aria-hidden="true">
            <use href="#mrg-check" />
          </svg>
        </span>
        <span className="mr-ref-c">
          Code {pill.code} applied
          {pill.percentOff ? ` · ${discountPhrase(pill.percentOff, pill.discountMonths)}` : ""}
        </span>
      </span>
    </div>
  );
}
