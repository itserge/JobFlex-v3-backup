"use client";

// PARTNER PORTAL — OVERVIEW · BLUEPRINT
// /influencer
//
// The four numbers that answer "where is my money", the codes to share, and who
// came in through them. Three balances split the way the ledger actually splits:
// still clearing, ready to withdraw, already paid. Lifetime sits beside them as
// the headline the partner cares about.
//
// The referred-client list shows MONTH · PLAN · STATUS and nothing else. It used
// to print the client's organisation name; see portal-data.ts for why it does
// not any more.

import { useRef } from "react";
import {
  Chip,
  CopyRow,
  Empty,
  KpiStrip,
  Meta,
  type Tone,
  cx,
  useReveal,
} from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import {
  usd,
  type BalancesDTO,
  type MoneyNoteDTO,
  type PartnerDTO,
  type PromoCodeDTO,
  type ReferredClientDTO,
} from "./portal-data";
import { ConnectBanner, HoldNote, MoneyNotes, RequestPayoutButton } from "./portal-ui";
import styles from "./portal.module.css";

const CLIENT_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  ENDED: "mute",
  VOID: "bad",
};
const CLIENT_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ENDED: "Ended",
  VOID: "Not counted",
};

export function InfluencerOverviewContent({
  partner,
  balances,
  codes,
  clients,
  notes,
  payoutReason,
}: {
  partner: PartnerDTO;
  balances: BalancesDTO;
  codes: PromoCodeDTO[];
  clients: ReferredClientDTO[];
  notes: MoneyNoteDTO[];
  payoutReason: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  const activeClients = clients.filter((c) => c.status === "ACTIVE").length;
  const totalClicks = codes.reduce((n, c) => n + c.clicks, 0);
  const liveCodes = codes.filter((c) => c.active);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={cx("page-head", "rv")}>
        <div className={styles.headTxt}>
          <div className="kicker">Partner</div>
          <h1 className={cx("page-title", styles.title)}>Overview</h1>
        </div>
        <div className="page-actions">
          <RequestPayoutButton reason={payoutReason} />
        </div>
      </div>

      <KpiStrip
        cols={4}
        cells={[
          { label: "Still clearing", value: usd(balances.pendingCents) },
          {
            label: "Ready to withdraw",
            value: usd(balances.clearedCents),
            ...(balances.clearedCents < 0 ? { tone: "bad" as const } : { accent: true }),
          },
          { label: "Paid out", value: usd(balances.paidOutCents), tone: "ok" },
          { label: "Lifetime earned", value: usd(balances.lifetimeEarnedCents) },
        ]}
      />
      <div className="rv">
        <HoldNote holdDays={partner.holdDays} />
      </div>

      <ConnectBanner connect={partner.connect} />

      <MoneyNotes notes={notes} />

      <section className="card rv">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Your codes</div>
            <div className="card-sub">
              Share the link or the code itself. Commission accrues when a subscriber pays.
            </div>
          </div>
          <span className={ui.cardCount}>
            {totalClicks} {totalClicks === 1 ? "click" : "clicks"}
          </span>
        </div>

        {codes.length === 0 ? (
          <Empty>No codes assigned yet. Your JobFlex contact sets these up.</Empty>
        ) : (
          <div className={styles.codes}>
            {codes.map((c) => (
              <div key={c.id} className={styles.code}>
                <div className={styles.codeTop}>
                  <span className={cx(ui.tag, !c.active && ui.tagOff, styles.codeTag)}>{c.code}</span>
                  <Chip tone={c.active ? "ok" : "mute"}>{c.replaced ? "Earlier terms" : c.active ? "Active" : "Off"}</Chip>
                </div>
                {/* Two lines, never one: what the subscriber gets is not what the partner earns, and
                    "20% · 12 months" beside "saves 20%" read as one deal (owner, 2026-11-14). */}
                <dl className={styles.codeTerms}>
                  <div>
                    <dt>Subscribers get</dt>
                    <dd data-sub-discount>{c.discount ?? "No discount"}</dd>
                  </div>
                  <div>
                    <dt>Your commission</dt>
                    <dd>{c.terms}</dd>
                  </div>
                </dl>
                <Meta className={styles.codeClicks}>{`${c.clicks} ${c.clicks === 1 ? "click" : "clicks"}`}</Meta>
                {c.replaced ? (
                  <p className={styles.codeOff}>
                    The terms this code had before its discount changed. Subscribers who joined with them keep their
                    discount and keep earning you commission.
                  </p>
                ) : c.active ? (
                  <div className={styles.codeCopies}>
                    <CopyRow label="Share link" value={c.shareUrl} />
                    <CopyRow label="Code" value={c.code} />
                  </div>
                ) : (
                  // "Off" on its own reads as "your money stopped". It did not:
                  // switching a code off closes it to NEW signups and leaves
                  // everyone already on it earning (lib/stripeSync's accrual
                  // does not check PromoCode.active, deliberately).
                  <p className={styles.codeOff}>
                    Closed to new signups. Anyone already subscribed with it keeps earning you
                    commission.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card rv">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Who came in</div>
            <div className="card-sub">
              {activeClients} active of {clients.length}. We show the month, the plan and the status —
              never a client&apos;s name or contact details.
            </div>
          </div>
          {liveCodes.length > 1 ? <span className={ui.cardCount}>{liveCodes.length} codes live</span> : null}
        </div>

        {clients.length === 0 ? (
          <Empty>
            No referrals yet. When someone subscribes with your code and their first payment clears,
            they appear here.
          </Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Referred clients">
            <div className={cx(ui.tr, ui.th, styles.clientCols)} role="row">
              <span>Since</span>
              <span>Plan</span>
              <span>Code</span>
              <span>Status</span>
            </div>
            {clients.map((c) => (
              <div key={c.id} className={cx(ui.tr, styles.clientCols)} role="row">
                <div className={styles.clientSince}>
                  <span className={ui.tdLbl}>Since</span>
                  {c.since ?? "Not paid yet"}
                </div>
                <div className={styles.clientPlan}>
                  <span className={ui.tdLbl}>Plan</span>
                  {c.plan ?? "—"}
                </div>
                <div>
                  <span className={ui.tdLbl}>Code</span>
                  <span className={cx(ui.tag, styles.codeTag)}>{c.code}</span>
                </div>
                <div>
                  <span className={ui.tdLbl}>Status</span>
                  <Chip tone={CLIENT_TONE[c.status] ?? "mute"}>{CLIENT_LABEL[c.status] ?? c.status}</Chip>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
