// Proposals v3 (Blueprint) — filter band + ledger sheet.
// Server component: filters are plain links driven by ?status= searchParams,
// so the whole page stays zero-client-JS like dashboard-v2. Row motion is
// CSS-only (slideIn stagger), killed under prefers-reduced-motion.

import Link from "next/link";
import type { Route } from "next";
import { money, shortDate } from "@/lib/format";
import { V3_PORTED_ROUTES } from "@/lib/v3/routes";
import styles from "./proposals.module.css";

export const FILTER_KEYS = [
  "ALL",
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "PAID",
  "DECLINED",
  "EXPIRED",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export function isFilterKey(v: string | undefined): v is FilterKey {
  return v !== undefined && (FILTER_KEYS as readonly string[]).includes(v);
}

export type LedgerRow = {
  id: string;
  title: string;
  status: string;
  total: number;
  updatedAt: Date;
  viewCount: number;
  clientName: string;
  clientPlace: string | null;
  ownerName: string | null;
};

const FILTER_LABELS: Record<FilterKey, string> = {
  ALL: "All",
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  PAID: "Paid",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

function chipClass(status: string) {
  if (status === "ACCEPTED") return styles.chipWon;
  if (status === "PAID") return styles.chipPaid;
  if (status === "SENT" || status === "VIEWED") return styles.chipSent;
  if (status === "DECLINED" || status === "EXPIRED" || status === "ARCHIVED")
    return styles.chipDead;
  return styles.chipDraft;
}

export function ProposalsLedger({
  rows,
  counts,
  totalCount,
  active,
}: {
  rows: LedgerRow[];
  counts: Map<string, number>;
  totalCount: number;
  active: FilterKey;
}) {
  const filteredTotal = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <>
      {/* Filter band — status cells, live counts */}
      <nav className={`${styles.filters} ${styles.rv} ${styles.d3}`} aria-label="Filter by status">
        {FILTER_KEYS.map((key) => {
          const n = key === "ALL" ? totalCount : (counts.get(key) ?? 0);
          // One plain string, one Route at the end: two Routes joined in a conditional made TypeScript build a union
          // past its 100,000-member limit (TS2590) once the app passed ~300 pages (2026-11-05).
          const path: string = key === "ALL" ? V3_PORTED_ROUTES.proposalsBlueprint : `${V3_PORTED_ROUTES.proposalsBlueprint}?status=${key}`;
          const href = path as Route;
          return (
            <Link
              key={key}
              href={href}
              className={`${styles.filterCell} ${active === key ? styles.filterOn : ""}`}
              aria-current={active === key ? "page" : undefined}
            >
              {FILTER_LABELS[key]}
              <span className={styles.filterCount}>{String(n).padStart(2, "0")}</span>
            </Link>
          );
        })}
        <span className={styles.filterSpacer} aria-hidden />
      </nav>

      {/* Ledger sheet */}
      <div className={`${styles.ledger} ${styles.rv} ${styles.d4}`}>
        <div className={styles.ledgerHead}>
          <span>
            Ledger <em>Rows</em>
          </span>
          <span>
            <span className={styles.ledgerDot} aria-hidden />
            {rows.length} shown · Live
          </span>
        </div>

        <div className={styles.cols} aria-hidden>
          <span>№</span>
          <span>Proposal</span>
          <span className={styles.colOwner}>Prepared by</span>
          <span>Updated</span>
          <span className={styles.colViews}>Views</span>
          <span>Status</span>
          <span className={styles.colRight}>Total</span>
        </div>

        {rows.length > 0 ? (
          <div className={styles.ledgerRows}>
            {rows.map((r, i) => (
              <Link
                key={r.id}
                href={`/dashboard/proposals/${r.id}` as Route}
                className={styles.ledgerRow}
                style={{ animationDelay: `${0.35 + Math.min(i, 20) * 0.03}s` }}
              >
                <span className={styles.ledgerNum}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.ledgerName}>
                  <strong>{r.title}</strong>
                  <span>
                    {r.clientName}
                    {r.clientPlace ? ` · ${r.clientPlace}` : ""}
                  </span>
                </span>
                <span className={styles.ledgerOwner}>{r.ownerName ?? "—"}</span>
                <span className={styles.ledgerDate}>{shortDate(r.updatedAt)}</span>
                <span
                  className={`${styles.ledgerViews} ${r.viewCount === 0 ? styles.ledgerViewsZero : ""}`}
                >
                  {r.viewCount > 0 ? `${r.viewCount}×` : "—"}
                </span>
                <span className={`${styles.chip} ${chipClass(r.status)}`}>{r.status}</span>
                <span className={styles.ledgerPrice}>{money(r.total)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.ledgerEmpty}>
            <div className={styles.ledgerEmptyBox}>
              {active === "ALL" ? (
                <>
                  No proposals on file —{" "}
                  <Link href={"/dashboard/proposals/new" as Route}>draft no. 001 →</Link>
                </>
              ) : (
                <>
                  Nothing filed under {FILTER_LABELS[active]} —{" "}
                  <Link href={V3_PORTED_ROUTES.proposalsBlueprint as Route}>
                    show the full ledger →
                  </Link>
                </>
              )}
            </div>
          </div>
        )}

        <div className={styles.ledgerTotal}>
          <span className={styles.ledgerTotalLbl}>
            {active === "ALL" ? "Ledger total" : `${FILTER_LABELS[active]} total`}
          </span>
          <span className={styles.ledgerTotalVal}>{money(filteredTotal)}</span>
        </div>
        <div className={styles.ledgerFoot}>
          <Link href={"/dashboard/proposals" as Route}>Open classic view →</Link>
          <span className={styles.stampInk}>Tracked</span>
        </div>
      </div>
    </>
  );
}
