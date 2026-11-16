"use client";
// ONE CARD FOR A CLOSED SMART CRM PART (owner, 2026-11-16 — lib/crm/smartAccess). Where Win back, the company pulse
// or the client 360 would sit on a plan without Smart CRM: what the part does, and the way to it — the price and
// "Upgrade your plan" for a new-plan shop's owner, "See plans" when the plan ended, a word to ask the owner for
// anyone else. Never an error box, never a button that can't work. The desk sheet, the phone CRM and the client page
// draw the same card.

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { toolGatePrices } from "@/actions/toolPlans";
import { smartOffer, type SmartCrmAccess, type SmartOfferPlace } from "@/lib/crm/smartAccess";
import { DEFAULT_CATALOG, money as toolMoney } from "@/lib/toolPlans/shared";
import s from "./smart-crm-offer.module.css";

const CATALOG_CENTS = DEFAULT_CATALOG.tools.find((t) => t.id === "smartcrm")?.cents ?? 3900;

export function SmartCrmOffer({ access, place }: { access: SmartCrmAccess; place: SmartOfferPlace }) {
  const offer = smartOffer(access, place);
  // The price in force (Admin → Plans), the catalog's until the server answers — the tools' own card does the same
  // (components/v3/upgrade-gate ToolsOffer).
  const [cents, setCents] = useState(CATALOG_CENTS);
  useEffect(() => {
    if (!offer.price) return;
    let live = true;
    toolGatePrices()
      .then((p) => {
        const c = p?.tools.smartcrm;
        if (live && typeof c === "number") setCents(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [offer.price]);

  return (
    <section className={s.offer} data-smart-crm-offer={place} aria-label={`Smart CRM — ${offer.title}`}>
      <div className={s.kick}>Smart CRM</div>
      <h3 className={s.title}>{offer.title}</h3>
      <p className={s.line}>{offer.line}</p>
      {offer.why ? <p className={s.why}>{offer.why}</p> : null}
      {offer.price ? <p className={s.price}>{toolMoney(cents)}/mo on your bill</p> : null}
      {offer.note ? <p className={s.note}>{offer.note}</p> : null}
      {offer.button ? (
        <div className={s.row}>
          <Link href={offer.button.href as Route} className={s.go} data-smart-crm-go>
            {offer.button.label}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
