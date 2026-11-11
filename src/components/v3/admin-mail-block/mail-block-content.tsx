"use client";

// ADMIN DO NOT EMAIL — BLUEPRINT
// /admin/mail/blocked (2026-11-11)
//
// The do-not-email list (lib/mailBlock): one row per address — why, how it got there, when, whose it is. The search
// lives in the URL (?q=) and the server reads it; the page pages the rows (usePagedList). "Add an address" puts one on
// by hand (an account owner's JobFlex letters stop too); "Remove" takes one off at once. Furniture from the
// partner-money kit (admin-influencers/admin-ui) and the search of /admin/mail/log.

import { useMemo, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { usePagedList } from "@/lib/usePagedList";
import { Pagination } from "@/components/ui/Pagination";
import { toast } from "@/components/ui/Toast";
import { TEAM_TZ } from "@/lib/adminTasks/teamShared";
import { SOURCE_LABEL, type MailBlockSource } from "@/lib/mailBlockShared";
import { adminBlockEmail, adminUnblockEmail } from "@/actions/mailBlock";
import { Chip, Empty, Ic, KpiStrip, actionError, cx, useReveal, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./mail-block.module.css";

export interface MailBlockRow {
  email: string;
  reason: string;
  source: MailBlockSource;
  at: string | null;
  by: string | null;
  /** The company that marked it "Don't email", or whose account link it was. */
  company: string | null;
  /** The accounts this address owns. */
  owns: string[];
}

const SOURCE_TONE: Record<MailBlockSource, Tone> = { link: "bp", reply: "wait", admin: "mute", office: "ok" };
const PAGE_SIZE = 25;
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TZ, month: "short", day: "numeric", year: "numeric" });

export function AdminMailBlockContent({ rows, total, q }: { rows: MailBlockRow[]; total: number; q: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const router = useRouter();
  const [busy, startNav] = useTransition();
  const go = (next: string) => startNav(() => router.push((next ? `/admin/mail/blocked?q=${encodeURIComponent(next)}` : "/admin/mail/blocked") as Route, { scroll: false }));

  const [draft, setDraft] = useState(q);
  const [addr, setAddr] = useState("");
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const list = useMemo(() => rows, [rows]);
  const { page, pageCount, setPage, pageItems } = usePagedList(list, PAGE_SIZE);
  const counts = useMemo(() => {
    const c: Record<MailBlockSource, number> = { link: 0, reply: 0, admin: 0, office: 0 };
    for (const r of rows) c[r.source] += 1;
    return c;
  }, [rows]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving("add");
    try {
      const r = await adminBlockEmail({ email: addr, reason: why.trim() || null });
      if (!r.ok) throw new Error(r.error);
      toast.success("Added", `${r.block.email} gets no more marketing or automatic emails.`);
      setAddr("");
      setWhy("");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't add it", actionError(err));
    } finally {
      setSaving(null);
    }
  }

  async function remove(email: string) {
    if (saving) return;
    setSaving(email);
    try {
      const r = await adminUnblockEmail(email);
      if (!r.ok) throw new Error(r.error);
      toast.success("Removed", `${email} gets emails again.`);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't remove it", actionError(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div ref={rootRef} className={styles.root} data-mail-block-page>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Mail</div>
          <h1 className="page-title">Do not email</h1>
        </div>
      </div>

      <KpiStrip
        cells={[
          { label: "On the list", value: String(total), accent: true },
          { label: "Unsubscribe link", value: String(counts.link) },
          { label: "Replied stop", value: String(counts.reply) },
          { label: "Admin or company", value: String(counts.admin + counts.office) },
        ]}
      />

      <section className="card rv">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Add an address</div>
            <div className="card-sub">No marketing or automatic emails to it — campaigns, follow-ups, reminders, win-back — from JobFlex or any company on it. Proposals, invoices, receipts, sign-in codes, billing notices and replies still go.</div>
          </div>
        </div>
        <form className={styles.add} onSubmit={add}>
          <label className={styles.fld}>
            <span className={styles.lbl}>Email</span>
            <input className={styles.in} type="email" inputMode="email" autoCapitalize="none" spellCheck={false} required value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="name@company.com" data-mail-block-add />
          </label>
          <label className={styles.fld}>
            <span className={styles.lbl}>Why (optional)</span>
            <input className={styles.in} value={why} maxLength={200} onChange={(e) => setWhy(e.target.value)} placeholder="Asked on the phone" />
          </label>
          <button type="submit" className={cx("btn", "btn-primary", styles.addBtn)} disabled={!!saving || !addr.trim()}>
            {saving === "add" ? "Adding…" : "Add to the list"}
          </button>
        </form>
      </section>

      <form
        className={cx(styles.find, "rv")}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(draft.trim().toLowerCase());
        }}
      >
        <Ic name="search" />
        <input className={styles.findIn} type="search" inputMode="email" autoCapitalize="none" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Address or part of one" aria-label="Find an address" data-mail-block-find />
        {draft || q ? (
          <button
            type="button"
            className={styles.findX}
            aria-label="Clear the search"
            onClick={() => {
              setDraft("");
              go("");
            }}
          >
            <Ic name="x" />
          </button>
        ) : null}
        <button type="submit" className={cx("btn", "btn-primary", ui.btnSm)} disabled={busy}>
          {busy ? "Loading…" : "Search"}
        </button>
      </form>

      <section className={cx("card", "rv", busy && styles.busy)} aria-busy={busy}>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Addresses</div>
            <div className="card-sub">{q ? `Holding “${q}” · ${rows.length} of ${total}` : `Newest first · ${total}`}</div>
          </div>
        </div>
        {list.length === 0 ? (
          <Empty>{q ? "No address on the list holds that." : "Nobody has asked to stop yet."}</Empty>
        ) : (
          <>
            <div className={cx(ui.tr, ui.th, styles.cols)} aria-hidden="true">
              <span>Address</span>
              <span>Why</span>
              <span>How</span>
              <span>Since</span>
              <span />
            </div>
            <ul className={styles.list} aria-label="Addresses on the do-not-email list">
              {pageItems.map((r) => (
                <li key={r.email} className={cx(ui.tr, styles.cols, styles.item)} data-mail-block-row={r.email}>
                  <span className={ui.tdWide}>
                    <span className={ui.tdLbl}>Address</span>
                    <span className={styles.addr}>{r.email}</span>
                    {r.owns.length ? <span className={styles.sub}>Owns {r.owns.join(", ")}</span> : null}
                  </span>
                  <span className={ui.tdWide}>
                    <span className={ui.tdLbl}>Why</span>
                    <span className={styles.why}>{r.reason || "—"}</span>
                    {r.company || r.by ? <span className={styles.sub}>{[r.company, r.by].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  <span>
                    <span className={ui.tdLbl}>How</span>
                    <Chip tone={SOURCE_TONE[r.source]}>{SOURCE_LABEL[r.source]}</Chip>
                  </span>
                  <span className={styles.when}>
                    <span className={ui.tdLbl}>Since</span>
                    {r.at ? DAY.format(new Date(r.at)) : "—"}
                  </span>
                  <span className={styles.act}>
                    <button type="button" className={cx("btn", "btn-ghost", ui.btnSm)} onClick={() => void remove(r.email)} disabled={!!saving} data-mail-block-remove={r.email}>
                      {saving === r.email ? "Removing…" : "Remove"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div data-nest className={styles.pager}>
              <Pagination page={page} pageCount={pageCount} onPage={setPage} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
