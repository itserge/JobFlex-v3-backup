"use client";

// Blueprint settings — page CONTENT only. The donor's `.content` children;
// the sidebar, topbar, graph-paper field and the shared sprite come from the
// shared shell (components/v3/blueprint-shell), which persists across
// navigation.
//
// Returning a fragment keeps `.page-head` and `.set` as DIRECT children of
// `.content`, which the donor's grid and the shell's reveal cascade depend on.
//
// This file owns the page's two page-level assets: `./settings-global.css`
// (the keyframes) and `<SettingsSprite/>` (the symbols the shell sprite lacks).
//
// The rail is React state. All five panes stay MOUNTED and are shown/hidden
// by `.pane` / `.pane.on`, so field text survives a trip through another tab.
// `?tab=integrations` (and `&sub=stripe`) opens a rail/subtab on arrival — the
// OAuth callbacks land on the old `?tab=payments`, which opens Integrations /
// Payments — and a pane can jump elsewhere through `navigate`.
//
// The donor's "Help center" page action is gone: it never led anywhere.

import { useState } from "react";
import type { ComponentType } from "react";
import { useSearchParams } from "next/navigation";

import "./settings-global.css";
import { SettingsSprite } from "./sprite";
import {
  DEFAULT_RAIL,
  PAGE_TITLE,
  RAIL_ITEMS,
  RAIL_NEW_BADGE,
  railKeyFor,
  type PaneProps,
  type RailKey,
  type SettingsData,
  type SubTabKey,
} from "./settings-data";
import { AccountPane } from "./panes/account-pane";
import { BillingPane } from "./panes/billing-pane";
import { IntegrationsPane } from "./panes/integrations-pane";
import { NotificationsPane } from "./panes/notifications-pane";
import { DeskPane } from "./panes/desk-pane";
import { EstimatingPane } from "./panes/estimating-pane";
import { WebsitePane } from "./panes/website-pane";
import { SmartBookPane } from "./panes/smartbook-pane";

const PANE_BODIES: Record<RailKey, ComponentType<PaneProps>> = {
  account: AccountPane,
  billing: BillingPane,
  integrations: IntegrationsPane,
  notifications: NotificationsPane,
  // Texting is its own page since 2026-10-16 (/dashboard/texting).
  desk: DeskPane,
  estimating: EstimatingPane,
  website: WebsitePane,
  smartbook: SmartBookPane,
};

const SUB_KEYS = new Set<string>(["getpaid", "gmail", "meta", "ramp", "stripe", "square", "stax", "financing"]);

export function SettingsContent({
  data,
  initialPane,
}: {
  data: SettingsData;
  /** Deep-link target (?pane=…): the legacy /dashboard/settings/* URLs now
   *  redirect here and land on their pane instead of always on Account.
   *  `?tab=` (read client-side below) wins when both are present. */
  initialPane?: RailKey;
}) {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const subParam = params.get("sub");
  const notice = {
    gmail: params.get("gmail") ?? undefined,
    stripe: params.get("stripe") ?? undefined,
    square: params.get("square") ?? undefined,
    financing: params.get("financing") ?? undefined,
  };
  // A sub-tab (?sub=stripe|gmail|…) always means Integrations / Payments.
  const [active, setActive] = useState<RailKey>(
    subParam && SUB_KEYS.has(subParam) ? "integrations" : (railKeyFor(tabParam) ?? initialPane ?? DEFAULT_RAIL),
  );
  const [sub, setSub] = useState<SubTabKey | undefined>(
    subParam && SUB_KEYS.has(subParam) ? (subParam as SubTabKey) : undefined,
  );

  const navigate = (rail: RailKey, next?: SubTabKey) => {
    setActive(rail);
    if (next) setSub(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const railItems = RAIL_ITEMS.filter((item) => item.key !== "website" || data.website?.visible);
  const activeLabel = RAIL_ITEMS.find((item) => item.key === active)?.label ?? PAGE_TITLE;

  return (
    <>
      <SettingsSprite />

      <div className="page-head">
        <div>
          <div className="kicker">{activeLabel}</div>
          <h1 className="page-title">{PAGE_TITLE}</h1>
        </div>
      </div>

      <div className="set">
        <aside className="rail">
          <nav className="rail-nav">
            {railItems.map((item) => (
              <button
                key={item.key}
                className={`rail-a${item.key === active ? " on" : ""}`}
                type="button"
                data-p={item.key}
                aria-current={item.key === active ? "true" : undefined}
                onClick={() => setActive(item.key)}
              >
                <svg className="ic">
                  <use href={`#${item.icon}`} />
                </svg>
                {item.label}
                {item.isNew ? <span className="rail-new">{RAIL_NEW_BADGE}</span> : null}
              </button>
            ))}
          </nav>
          <div className="rail-sep"></div>
        </aside>

        <div className="panes">
          {railItems.map((item) => {
            const PaneBody = PANE_BODIES[item.key];
            return (
              <div
                key={item.key}
                className={`pane${item.key === active ? " on" : ""}`}
                data-pane={item.key}
              >
                <div className="pane-h">
                  <div className="pane-t">{item.label}</div>
                  {item.sub ? <div className="pane-s">{item.sub}</div> : null}
                </div>
                <PaneBody data={data} navigate={navigate} sub={sub} notice={notice} shown={item.key === active} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
