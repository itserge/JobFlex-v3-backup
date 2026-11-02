"use client";

// Settings blueprint — INTEGRATIONS / PAYMENTS pane. Payments joined
// Integrations on 2026-10-30 (owner): one section whose sub-tab strip holds
// Gmail, Meta and Ramp, then the three payment processors — Stripe, Square and
// Stax, each the full connection card (connect, API key, payment options,
// permissions, webhook, disconnect) — and Financing once JobFlex lets the
// account in. Every provider stays mounted so a half-typed key or field
// survives a tab switch.
//
// Stripe's and Square's OAuth hand-offs return to ?tab=payments with a
// ?stripe= / ?square= status. That note shows once, and the pane opens on the
// provider it is about.

import { useState } from "react";
import { MetaConnection } from "../meta-connection";
import { GmailConnection } from "./gmail-connection";
import { RampConnection } from "./ramp-connection";
import { ProcessorSubpane } from "./processor-subpane";
import { StaxSubpane } from "./stax-subpane";
import { FinancingSubpane } from "./financing-subpane";
import {
  COMING_SOON_TAB, comingSoonNote, integrationSubTabs, isVisibleSubTab, PROCESSOR_OAUTH_NOTICE,
  type PaneProps, type SubTabKey,
} from "../settings-data";

export function IntegrationsPane({ data, sub: wanted, notice }: PaneProps) {
  const { gmail, meta, ramp, stripe, square, connections } = data.integrations;
  const financing = data.payments.financing;
  const tabs = integrationSubTabs({
    gmail: !gmail.comingSoon || gmail.connected || Boolean(gmail.revokedAt),
    financing: financing !== null,
  });
  const returnedFrom: SubTabKey | undefined = notice?.square ? "square" : notice?.stripe ? "stripe" : notice?.financing && financing ? "financing" : notice?.gmail ? "gmail" : undefined;
  const [sub, setSub] = useState<SubTabKey>(
    isVisibleSubTab(wanted, tabs) ? (wanted as SubTabKey) : isVisibleSubTab(returnedFrom, tabs) ? (returnedFrom as SubTabKey) : tabs[0].key,
  );
  // A later jump to a provider (?sub=) lands on its tab.
  const [seenWanted, setSeenWanted] = useState(wanted);
  if (wanted !== seenWanted) {
    setSeenWanted(wanted);
    if (isVisibleSubTab(wanted, tabs)) setSub(wanted as SubTabKey);
  }

  const oauth = notice?.stripe
    ? { name: "Stripe", ...PROCESSOR_OAUTH_NOTICE[notice.stripe] }
    : notice?.square
      ? { name: "Square", ...PROCESSOR_OAUTH_NOTICE[notice.square] }
      : null;
  const soon: Partial<Record<SubTabKey, boolean>> = {
    gmail: gmail.comingSoon, meta: meta.comingSoon, ramp: !ramp.enabled && !ramp.connected,
    stripe: stripe.comingSoon, square: square.comingSoon, stax: false,
  };
  const names: Partial<Record<SubTabKey, string>> = {
    gmail: "Gmail sending", meta: "Meta business", ramp: "Ramp cards", stripe: "Stripe", square: "Square", stax: "Stax",
  };

  return <>
    {/* What the last OAuth round trip came back with — once, on this load. */}
    {oauth && oauth.title ? <div className={oauth.tone === "ok" ? "note note--ok" : "note"} role="status" style={{ marginBottom: "14px" }}>
      <svg className="ic"><use href="#i-bell" /></svg>
      <div><b>{`${oauth.name} — ${oauth.title}`}</b><span>{oauth.sub}</span></div>
    </div> : null}
    {soon[sub] && <div className="note note--soon" style={{ marginBottom: "14px" }}>
      <svg className="ic" aria-hidden="true"><use href="#i-bell" /></svg>
      <div><b>{`${names[sub]} — coming soon`}</b><span>{comingSoonNote(names[sub] ?? "")}</span></div>
    </div>}
    <div className="sub" data-tour="payments:processors">
      {tabs.map(tab => <button key={tab.key} className={tab.key === sub ? "sub-b on" : "sub-b"} type="button" aria-pressed={tab.key === sub} onClick={() => setSub(tab.key)}>
        {tab.label}{soon[tab.key] && <span className="sub-soon">{COMING_SOON_TAB}</span>}
      </button>)}
    </div>
    <div className={sub === "gmail" ? "subpane on" : "subpane"}><GmailConnection data={gmail} notice={notice?.gmail} /></div>
    <div className={sub === "meta" ? "subpane on" : "subpane"}><MetaConnection data={meta} /></div>
    <div className={sub === "ramp" ? "subpane on" : "subpane"}><RampConnection data={ramp} /></div>
    <div className={sub === "stripe" ? "subpane on" : "subpane"}><ProcessorSubpane d={stripe} conns={connections} /></div>
    <div className={sub === "square" ? "subpane on" : "subpane"}><ProcessorSubpane d={square} conns={connections} /></div>
    <div className={sub === "stax" ? "subpane on" : "subpane"}><StaxSubpane conns={connections} /></div>
    {financing ? <div className={sub === "financing" ? "subpane on" : "subpane"}>
      <FinancingSubpane d={financing} returned={notice?.financing === "back"} />
    </div> : null}
  </>;
}
