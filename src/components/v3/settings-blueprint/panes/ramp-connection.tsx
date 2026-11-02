"use client";
// RAMP CARDS — the Integrations card (2026-10-29, owner: "build it for JobFlex, same as ServiceTitan"). Connect the
// company's Ramp business; from then on every swipe on a Ramp card lands on its job with the receipt, the tech is
// asked the job the moment it happens, and the office places the rest from Financials → Expenses.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, CreditCard, Link2, RefreshCw, Unplug } from "lucide-react";
import { disconnectRamp, setRampSwitches, syncRampNow } from "@/actions/ramp";
import { toast } from "@/components/ui/Toast";
import type { RampData } from "../settings-data";
import { Toggle } from "../ui";
import { RampCardsSection } from "./ramp-cards-section";
import styles from "../meta-connection.module.css";
import layout from "./integration-cards.module.css";

const NOTICE: Record<string, { title: string; sub: string }> = {
  connected: { title: "Ramp connected", sub: "The JobFlex job field is in your Ramp, the last thirty days of card spend are on their jobs, and new swipes arrive on their own." },
  denied: { title: "Ramp was not connected", sub: "Ramp reported that access was declined. Nothing changed." },
  invalid_state: { title: "Ramp was not connected", sub: "The sign-in took too long or was opened from another tab. Try again from this page." },
  failed: { title: "Ramp was not connected", sub: "Ramp did not complete the authorization. Try again in a minute; if it keeps failing, write to support." },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export function RampConnection({ data: initial, mobile = false }: { data: RampData; mobile?: boolean }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<"sync" | "disconnect" | "switch" | null>(null);
  const params = useSearchParams();
  const notice = NOTICE[params.get("ramp") ?? ""];
  const status = data.connected ? "Connected" : data.enabled ? "Not connected" : "Coming soon";
  const primary = `${styles.button} ${styles.primary}`;

  async function sync() {
    setBusy("sync");
    try {
      const r = await syncRampNow();
      if (!r.ok) throw new Error(r.error);
      setData((d) => ({ ...d, ...r.view }));
      toast.success("Ramp read", `${r.read} transactions read · ${r.booked} booked on jobs · ${r.needsJob} waiting for a job · ${r.updated} updated${r.billsPaid ? ` · ${r.billsPaid} bill${r.billsPaid > 1 ? "s" : ""} paid` : ""}.`);
    } catch (error) {
      toast.error("Ramp sync failed", error instanceof Error ? error.message : "Try again in a minute.");
    } finally {
      setBusy(null);
    }
  }
  async function flip(key: "askByText" | "requireJob" | "billsApproved", value: boolean) {
    setBusy("switch");
    const before = data;
    setData((d) => ({ ...d, [key]: value }));
    try {
      const r = await setRampSwitches({ [key]: value });
      if (!r.ok) throw new Error(r.error);
      setData((d) => ({ ...d, ...r.view }));
    } catch (error) {
      setData(before);
      toast.error("Not saved", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Ramp? Expenses already on jobs stay; new swipes stop arriving.")) return;
    setBusy("disconnect");
    try {
      await disconnectRamp();
      setData((d) => ({ ...d, connected: false, businessName: "", lastSyncAt: null, lastError: null, fieldReady: false, webhookReady: false }));
      toast.success("Ramp disconnected", "Card spend no longer lands on the jobs.");
    } catch (error) {
      toast.error("Couldn't disconnect", error instanceof Error ? error.message : "Try again in a minute.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${styles.root} ${layout.surface} ${mobile ? `${styles.mobile} ${layout.mobile}` : ""}`} aria-label="Ramp connection" data-ramp-card>
      <header className={styles.header}>
        <div className={styles.brand}><CreditCard size={22} aria-hidden="true" /><h2>Ramp cards</h2></div>
        <span className={`${styles.status} ${data.connected ? styles.connected : ""}`} data-ramp-status>
          {data.connected && <Check size={14} aria-hidden="true" />}{status}
        </span>
      </header>
      <div className={styles.body}>
        {notice && <div className={styles.notice} role="status"><strong>{notice.title}</strong><p>{notice.sub}</p></div>}
        {data.lastError && <div className={styles.error} role="alert"><strong>Ramp needs attention</strong><p>{data.lastError}</p></div>}
        {data.connected ? (
          <div className={styles.page}>
            <div>
              <p className={styles.label}>Connected business</p>
              <h3 className={layout.account} data-ramp-business>{data.businessName || "Ramp"}</h3>
              <p className={styles.label} style={{ marginTop: 6 }}>
                Since {when(data.connectedAt)} · last read {when(data.lastSyncAt)}{data.lastSyncAt ? ` (${data.lastSyncCount} transactions)` : ""} · job field {data.fieldReady ? "in place" : "not yet"} · live updates {data.webhookReady ? "on" : "waiting for Ramp to verify"}
              </p>
            </div>
            {data.canManage && (
              <div className={styles.actions}>
                <button className={primary} type="button" disabled={busy !== null} onClick={() => void sync()} data-ramp-sync>
                  <RefreshCw size={16} aria-hidden="true" />{busy === "sync" ? "Reading…" : "Sync now"}
                </button>
                <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void disconnect()} data-ramp-disconnect>
                  <Unplug size={16} aria-hidden="true" />{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.intro}>
            <h3>Every card swipe on its job, the moment it happens</h3>
            <p>
              Connect your Ramp business. Your techs&apos; Ramp cards keep working as they do; each purchase lands on the job it was for, with the receipt, and the office sees the job&apos;s cost
              while the job runs. No Ramp account yet? Ramp is free for the business — cards, bill pay and receipts — and approves most LLCs and corporations in a day or two.
            </p>
            <div className={layout.connectActions}>
              {!data.enabled ? (
                <button className={primary} type="button" disabled>Coming soon</button>
              ) : data.canManage ? (
                <a className={primary} href={data.connectHref} data-ramp-connect><Link2 size={18} aria-hidden="true" />Connect Ramp</a>
              ) : (
                <p className={styles.label}>An owner or manager connects it.</p>
              )}
              <a className={styles.button} href="https://ramp.com" target="_blank" rel="noreferrer">Open an account at ramp.com</a>
            </div>
          </div>
        )}
      </div>
      <div className={layout.section}>
        <h3 className={layout.sectionTitle}>How it works</h3>
        <ol className={layout.scopes}>
          <li>A tech buys at the supply house with their Ramp card. Ramp asks them which job — the open jobs are a list in Ramp, kept current by JobFlex — and for the receipt photo.</li>
          <li>The purchase lands on that job&apos;s expenses, approved, with the receipt and the cardholder&apos;s name. The owner&apos;s trail says &ldquo;Ramp card: $212.40 at Home Depot on Smith roof — Mike&rdquo;.</li>
          <li>A swipe with no job: the tech gets a text from your company&apos;s line — &ldquo;$212.40 at Home Depot — which job? Reply 1 Smith roof · 2 Lopez deck…&rdquo; — and the reply books it. Until then it waits under Financials → Expenses → Needs a job, where the office can place it.</li>
          <li>Refunds come back as negative lines; an amount that changes when a charge clears is corrected on the job. Your accounting export stays on Ramp&apos;s side — nothing is entered twice.</li>
          <li>One receipt, two jobs: split it in Ramp (each line its own job) or from Financials with &ldquo;Split…&rdquo; — one expense per part, and Ramp gets the same split.</li>
          <li>Vendor bills: Financials → Expenses → &ldquo;Pay a vendor bill&rdquo; makes the bill in Ramp, coded to the job, invoice attached. Ramp pays it (ACH or check); the day it pays, the money is on the job.</li>
          <li>Cards: give a crew member a card from here — Ramp invites them, sets the monthly limit you typed, ships the card. Freeze one in a tap.</li>
        </ol>
        {data.connected && data.canManage && (
          <>
            <div className={layout.toggleRow}>
              <div><strong>Ramp asks the job on every swipe</strong><p>The JobFlex job field is required on transactions in Ramp, so the tech picks the job in Ramp&apos;s own prompt.</p></div>
              <Toggle checked={data.requireJob} onChange={(v) => void flip("requireJob", v)} ariaLabel="Ramp asks the job on every swipe" />
            </div>
            <div className={layout.toggleRow}>
              <div><strong>Text the tech when a swipe has no job</strong><p>From your company&apos;s line, to the cardholder&apos;s mobile on file; the reply books it.</p></div>
              <Toggle checked={data.askByText} onChange={(v) => void flip("askByText", v)} ariaLabel="Text the tech when a swipe has no job" />
            </div>
            <div className={layout.toggleRow}>
              <div><strong>Bills from JobFlex are approved — Ramp pays them</strong><p>Off: a bill goes to Ramp&apos;s inbox and someone approves it there before anything pays. On: it goes in approved and Ramp pays it on the due date.</p></div>
              <Toggle checked={data.billsApproved} onChange={(v) => void flip("billsApproved", v)} ariaLabel="Bills from JobFlex are approved and paid by Ramp" />
            </div>
          </>
        )}
      </div>
      {data.connected && data.canManage && <RampCardsSection canManage={data.canManage} />}
    </section>
  );
}
