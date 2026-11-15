"use client";
import * as React from "react";
import { validateAttributionCode } from "@/actions/attribution";
import { CODE_RE, readClientAttr } from "@/lib/attributionShared";
import { discountPhrase } from "@/lib/promoDiscount";

export type RegisterAttribution = { kind: "promo" | "ref"; code: string };

// Step 4 of the attribution loop: the signup page checks the URL, then the
// 30-day capture cookie/localStorage, validates the code server-side, and shows
// "Referred by Mike Johnson ✓". The pill is a claim, not proof — the server
// re-validates whatever code registerAccount receives.
//
// This is the logic of the retired src/app/(auth)/auth/register/referred-by.tsx,
// unchanged, re-dressed in the donor's `.ref-banner` markup. The donor mockup
// shows the referred state only — it defines no manual "enter a code" field and
// no remove control, so neither ships here (see the port report).
export interface ResolvedReferral {
  kind: "promo" | "ref";
  code: string;
  displayName: string;
  percentOff: number | null;
  /** Paid months the percent lasts (null = 1, lib/promoDiscount). */
  discountMonths: number | null;
}

export function ReferralBanner({
  onChange,
  onResolved,
}: {
  onChange: (a: RegisterAttribution | null) => void;
  /** The validated code with its discount — what the Plan step prices by. A
   *  link-captured code used to reach the plan cards only as an attribution
   *  (stamped at checkout, so the discount was real) while the cards showed
   *  list price: "code applied" over an unchanged number (owner, 2026-09-02). */
  onResolved?: (p: ResolvedReferral | null) => void;
}) {
  const onChangeRef = React.useRef(onChange);
  const onResolvedRef = React.useRef(onResolved);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    onResolvedRef.current = onResolved;
  }, [onChange, onResolved]);

  const [pill, setPill] = React.useState<ResolvedReferral | null>(null);

  const apply = React.useCallback(async (kind: "promo" | "ref", code: string): Promise<boolean> => {
    const res = await validateAttributionCode({ kind, code });
    if (!res.ok) return false;
    const resolved = { kind: res.kind, code: res.code, displayName: res.displayName, percentOff: res.percentOff, discountMonths: res.discountMonths };
    setPill(resolved);
    onChangeRef.current({ kind: res.kind, code: res.code });
    onResolvedRef.current?.(resolved);
    return true;
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- state is set after the async server validation resolves, not synchronously */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!pill) return null;

  return (
    <div className="ref-banner">
      <svg className="ic">
        <use href="#i-gift" />
      </svg>
      <div>
        <div className="ref-t">Referred by {pill.displayName} ✓</div>
        <div className="ref-c">
          Code {pill.code} applied
          {pill.percentOff ? ` · ${discountPhrase(pill.percentOff, pill.discountMonths)}` : ""}
        </div>
      </div>
    </div>
  );
}
