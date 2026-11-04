// THE DOOR AND THE TOP OF EVERY PAGE BEHIND THE INVESTOR LINK (2026-10-25: the figures, then the pitch deck and the
// platform tour beside them). One rule for all three: the link must be live, the reader must have said who they are,
// and — with approvals on — we must have said yes (lib/investorGate). The figures page counts the visit; the other two
// read the pass without counting, so moving between the pages is not a second visit.
import type { ReactNode } from "react";
import Link from "next/link";
import { investorLinkOpen, readInvestorSettings } from "@/lib/investors";
import { visitorForLink, type InvestorVisitor } from "@/lib/investorVisitors";
import { INVESTING_KINDS, mayRead, statusOf } from "@/lib/investorGate";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { InvestorGate, InvestorWaiting, VcOfferButton } from "@/components/v3/investor-gate/investor-gate";
import s from "./investors-public.module.css";

async function signedInAdmin(): Promise<boolean> {
  try {
    await requirePlatformAdmin();
    return true;
  } catch {
    return false;
  }
}

/** The reader, or the page to show instead (not active · introduce yourself · waiting for our yes). */
export async function investorReader(token: string, opts: { openWord?: string; countVisit?: boolean } = {}): Promise<{ visitor: InvestorVisitor } | { door: ReactNode }> {
  const notice = opts.openWord === "bad" || opts.openWord === "closed" ? opts.openWord : undefined;
  const open = /^[A-Za-z0-9_-]{16,64}$/.test(token) && (await investorLinkOpen(token));
  if (!open) {
    return {
      door: (
        <main className={s.page}>
          <div className={s.frame}>
            <div className={s.kicker}>JobFlex · Investors</div>
            <h1 className={s.h1}>This link is not active</h1>
            <p className={s.sub}>Ask for a current one.</p>
          </div>
        </main>
      ),
    };
  }
  const [admin, visitor, settings] = await Promise.all([signedInAdmin(), visitorForLink(token, { countVisit: opts.countVisit === true }), readInvestorSettings()]);
  if (!visitor) {
    return {
      door: (
        <main className={s.page}>
          <InvestorGate token={token} admin={admin} approval={settings.approveReaders} notice={notice} />
        </main>
      ),
    };
  }
  if (!mayRead(visitor, settings.approveReaders)) {
    return {
      door: (
        <main className={s.page}>
          <InvestorWaiting token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} status={statusOf(visitor) === "declined" ? "declined" : "pending"} />
        </main>
      ),
    };
  }
  return { visitor };
}

export type InvestorPage = "figures" | "pitch" | "tour";
const PAGES: Array<{ key: InvestorPage; label: string; path: string }> = [
  { key: "figures", label: "Figures", path: "" },
  { key: "pitch", label: "Pitch deck", path: "/pitch" },
  { key: "tour", label: "Platform tour", path: "/tour" },
];

/** The greeting with the offer button, then the three pages. */
export function InvestorTop({ token, visitor, page }: { token: string; visitor: InvestorVisitor; page: InvestorPage }) {
  const lead = INVESTING_KINDS.has(visitor.kind);
  return (
    <>
      <div className={s.vcBar} data-vc-bar>
        <p className={s.vcWords}>
          {visitor.visits > 1 ? "Welcome back" : "Welcome"}, <b>{visitor.name}</b> · {visitor.company}. JobFlex is raising. Indicative offers are welcome; the founding team, the company structure and the cap table are shared with shortlisted investors after the founders&apos; review.
          {visitor.admin ? <> <em data-admin-test>You are signed in as an admin: this is the page a reader sees. Your entry is kept out of the reader list; an offer from here is emailed as a test.</em></> : null}
        </p>
        <VcOfferButton token={token} visitor={{ name: visitor.name, company: visitor.company, kind: visitor.kind, email: visitor.email, phone: visitor.phone }} lead={lead} />
      </div>
      <nav className={s.pages} aria-label="Investor pages" data-investor-pages>
        {PAGES.map((p) => (
          <Link key={p.key} href={`/investors/${token}${p.path}`} className={s.pageTab} aria-current={p.key === page ? "page" : undefined} data-page-tab={p.key}>
            {p.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
