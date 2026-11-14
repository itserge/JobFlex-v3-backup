"use client";

/* Meta StartTrial (ad owner, 2026-10-22), the browser half of lib/metaStartTrial: drawn by the dashboard layout
   only while the event is due. Sent once per company — the browser remembers the company, so a reload or a later
   visit sends nothing — and only when the pixel is on the page; the pixel's script can land a moment after this
   mounts, so it is waited for briefly. */

import * as React from "react";
import type { MetaStartTrialEvent } from "@/lib/metaStartTrial";

const SENT_PREFIX = "jf_meta_start_trial:";
const WAIT_MS = 10_000;
const sentHere = new Set<string>();

export function MetaStartTrial({ event }: { event: MetaStartTrialEvent }) {
  React.useEffect(() => {
    const key = SENT_PREFIX + event.organizationId;
    if (sentHere.has(key)) return;
    try {
      if (window.localStorage.getItem(key)) {
        sentHere.add(key);
        return;
      }
    } catch {
      /* storage blocked: this page still remembers below */
    }
    const started = Date.now();
    let timer = 0;
    const send = () => {
      if (sentHere.has(key)) return;
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (typeof fbq !== "function") {
        if (Date.now() - started < WAIT_MS) timer = window.setTimeout(send, 200);
        return;
      }
      // An unpriced trial (lib/metaStartTrial) still counts: the event goes without a value rather than not at all.
      fbq(
        "track",
        "StartTrial",
        event.value === null
          ? { content_name: event.contentName }
          : { value: event.value, currency: event.currency, predicted_ltv: event.predictedLtv, content_name: event.contentName },
      );
      sentHere.add(key);
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        /* storage blocked: once per page load then */
      }
    };
    send();
    return () => window.clearTimeout(timer);
  }, [event]);
  return null;
}
