"use client";

// SMARTBOOK · THE CALENDAR'S REQUESTS (2026-10-31, Batch 3) — desk and phone. Customers who asked for a time of their
// own, waiting on the company: each with the same three answers as the text and the email. Loads itself
// (actions/smartBookOffice), looks again every minute and when the tab comes back, and draws nothing when nothing waits.
// A Yes that books tells the calendar to read its visits again (`onBooked`).
import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { loadSmartBookRequests } from "@/actions/smartBookOffice";
import type { RequestCard } from "@/lib/smartbook/office";
import { RequestAnswer } from "./request-answer";
import styles from "./smartbook.module.css";

export function SmartBookRequests({ mobile = false, onBooked }: { mobile?: boolean; onBooked?: () => void }) {
  const [cards, setCards] = useState<RequestCard[]>([]);
  /** Answered here: kept on screen with their line until the next look. */
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const r = await loadSmartBookRequests().catch(() => null);
    if (!r?.ok) return;
    setCards((prev) => {
      const kept = prev.filter((c) => answered.has(c.leadId) && !r.requests.some((x) => x.leadId === c.leadId));
      return [...r.requests, ...kept];
    });
  }, [answered]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive && document.visibilityState === "visible") void load();
    };
    run();
    const t = window.setInterval(run, 60_000);
    document.addEventListener("visibilitychange", run);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", run);
    };
  }, [load]);

  if (!cards.length) return null;
  const waiting = cards.filter((c) => !answered.has(c.leadId)).length;

  return (
    <section className={`${styles.sb} ${styles.requests}${mobile ? ` ${styles.mobile}` : ""}`} data-nest data-smartbook-requests aria-labelledby="sbReqT">
      <div className={styles.head}>
        <div className={styles.brand}>
          <CalendarClock size={20} aria-hidden="true" />
          <h2 className={styles.title} id="sbReqT">
            SmartBook requests
          </h2>
        </div>
        <span className={styles.stamp} data-tone={waiting ? "amber" : "emerald"}>
          {waiting ? `${waiting} waiting` : "All answered"}
        </span>
      </div>
      <p className={styles.reqIntro}>
        Customers asked for these times. Answer here, by text or from the email — whoever answers first, SmartBook tells the customer.
      </p>
      <div className={styles.reqList}>
        {cards.map((c) => (
          <div key={c.leadId} className={styles.reqItem}>
            <RequestAnswer
              card={c}
              onDone={(r) => {
                setAnswered((s) => new Set(s).add(c.leadId));
                if (r.booked) onBooked?.();
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
