"use client";
// Remembers the program a visitor read about on /switch/<program> (2026-11-16, CRM migration plan part 3): after they
// sign up, the Welcome page's "Moving from…" card names it and the import page opens on it. 30 days, this site only.
import { useEffect } from "react";
import { MOVING_COOKIE, type ImportSource } from "@/lib/import/sources";

export function MovingCookie({ source }: { source: ImportSource }) {
  useEffect(() => {
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${MOVING_COOKIE}=${source}; Max-Age=${30 * 24 * 3600}; Path=/; SameSite=Lax${secure}`;
    } catch {
      /* cookies off: the card just says "another program" */
    }
  }, [source]);
  return null;
}
