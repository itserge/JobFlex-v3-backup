"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The first Stripe read is still running (lib/revenueSaved): the page looks again every ten seconds and opens on it. */
export function RevenueReading() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(t);
  }, [router]);
  return <main style={{ padding: 32 }} role="status"><h1>Revenue</h1><p>Reading subscriptions and payments from Stripe… The first read takes a minute or two; this page opens by itself when it’s done.</p></main>;
}
