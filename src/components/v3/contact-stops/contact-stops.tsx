"use client";

// "DON'T EMAIL" · "DON'T TEXT" (2026-11-11) — on a client's card and in the Inbox, one component for both and for
// both viewports. Read on open (actions/mailBlock clientContactStops); each switch writes at once:
//   · Don't email — the address on the do-not-email list (lib/mailBlock, source "office") and on this company's own
//     opt-outs (ClientEmailOptOut via "office"): no follow-ups, review requests, SmartBook, campaigns or proposals by
//     email; invoices and receipts still go.
//   · Don't text — the phone in SmsOptOut, which every text asks first (lib/sms/send).
// A stop the person made themselves (an Unsubscribe link, a reply, STOP) shows on and locked: only they can undo it.
// The app's switch (company-pricing-form's .tg): square, red off, green on — the colour carries the state.

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { clientContactStops, setClientDoNotEmail, setClientDoNotText, type ClientContactStops } from "@/actions/mailBlock";
import styles from "./contact-stops.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const tail = (phone: string) => `…${phone.slice(-4)}`;

export function ContactStops({ clientId, variant = "band" }: { clientId: string; variant?: "band" | "strip" }) {
  const [stops, setStops] = useState<ClientContactStops | null>(null);
  const [busy, setBusy] = useState<"email" | "text" | null>(null);

  useEffect(() => {
    let live = true;
    clientContactStops(clientId).then(
      (s) => live && setStops(s),
      () => live && setStops(null),
    );
    return () => {
      live = false;
    };
  }, [clientId]);

  async function flip(which: "email" | "text") {
    if (!stops || busy) return;
    const next = which === "email" ? !stops.noEmail.on : !stops.noText.on;
    setBusy(which);
    try {
      const r = which === "email" ? await setClientDoNotEmail(clientId, next) : await setClientDoNotText(clientId, next);
      if (!r.ok) throw new Error(r.error);
      setStops(r.stops);
      toast.success(
        which === "email" ? (next ? "No more emails" : "Emails can go again") : next ? "No more texts" : "Texts can go again",
        which === "email" ? (next ? "Invoices and receipts still go." : undefined) : undefined,
      );
    } catch (err) {
      toast.error("Couldn't change it", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const row = (which: "email" | "text") => {
    const s = which === "email" ? stops?.noEmail : stops?.noText;
    const has = which === "email" ? !!stops?.email : !!stops?.phone;
    const theirs = s?.by === "them";
    const sub = !stops
      ? "Checking…"
      : !has
        ? which === "email"
          ? "No email on file"
          : "No mobile number on file"
        : theirs
          ? `${which === "email" ? "They unsubscribed" : "They replied STOP"}${s?.at ? ` · ${day(s.at)}` : ""} — only they can undo it`
          : s?.on
            ? `${which === "email" ? "Only invoices and receipts go" : "No texts go"}${s?.at ? ` · since ${day(s.at)}` : ""}`
            : which === "email"
              ? stops.email!
              : tail(stops.phone!);
    const label = which === "email" ? "Don't email" : "Don't text";
    return (
      <div className={cx(styles.row, s?.on && styles.rowOn)} data-contact-stop={which} data-on={s?.on ? "1" : "0"} data-by={s?.by ?? ""}>
        <span className={styles.words}>
          <span className={styles.label}>{label}</span>
          <span className={styles.sub}>{sub}</span>
        </span>
        <button
          type="button"
          role="switch"
          className={styles.tg}
          aria-checked={!!s?.on}
          aria-label={label}
          disabled={!stops || !has || theirs || busy !== null}
          onClick={() => void flip(which)}
          data-contact-stop-switch={which}
        />
      </div>
    );
  };

  return (
    <div data-nest className={cx(styles.stops, variant === "strip" ? styles.strip : styles.band)} aria-label="Stop emails or texts to this client" role="group">
      {row("email")}
      {row("text")}
    </div>
  );
}
