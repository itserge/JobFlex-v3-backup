"use client";

// THE PAGE-VIEW BEACON (2026-09-24). Mounted by the signed-in layouts (every
// company since 2026-11-04); on every route change it tells actions/pageView
// which screen opened — half a second late, so a redirect bounce is not a
// view. Renders nothing, never throws.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { logPageView } from "@/actions/pageView";

export function PageViewBeacon() {
  const pathname = usePathname();
  // The last path actually sent — set when the call goes out, not when the
  // timer is armed: React's development double-mount runs the cleanup (which
  // clears the timer) and then the effect again, and a path marked "sent" on
  // arming would never be sent at all.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || sent.current === pathname) return;
    const t = setTimeout(() => {
      sent.current = pathname;
      logPageView(pathname).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}
