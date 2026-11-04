"use server";

// A PAGE VIEW, RECORDED (2026-09-24) — the trial watch's one write.
//
// Called by components/v3/trial-watch PageViewBeacon on every route change
// inside the signed-in app. In a company's first WATCH_DAYS it stores every
// screen: the route pattern (never the id or the query), the member, and a
// short hash of the address and the user agent — enough to see the same
// device on two trials, never the address itself. Later (owner, 2026-11-04:
// "if logged in, still say working" — lib/investorUsage) each screen is noted
// once a quarter hour per member, with no hashes: enough to know who is at
// work and where. Fire-and-forget: nothing here may become the page's
// problem, including the table not being pushed to production yet.

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { routePattern, WATCH_DAYS } from "@/lib/trialWatch";

const hash16 = (s: string | null | undefined): string | null => (s ? createHash("sha256").update(s).digest("hex").slice(0, 16) : null);

/** Rows older than this go, pruned by one write in five hundred. */
const KEEP_DAYS = 120;
/** Past the first weeks, the same screen is noted again for the same member after this long. */
const LATER_EVERY_MS = 15 * 60_000;

export async function logPageView(pathname: string): Promise<void> {
  try {
    if (typeof pathname !== "string") return;
    const route = routePattern(pathname);
    if (!route) return;
    const ctx = await requireOrg();
    const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { createdAt: true } });
    if (!org) return;
    const who = { organizationId: ctx.organizationId, userId: ctx.user.id, route };
    if (Date.now() - org.createdAt.getTime() > WATCH_DAYS * 86_400_000) {
      const recent = await db.pageView.findFirst({ where: { ...who, at: { gte: new Date(Date.now() - LATER_EVERY_MS) } }, select: { id: true } });
      if (recent) return;
      await db.pageView.create({ data: who });
    } else {
      const h = await headers();
      const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || null;
      const ua = h.get("user-agent")?.slice(0, 400) || null;
      await db.pageView.create({ data: { ...who, ipHash: hash16(ip), uaHash: hash16(ua) } });
    }
    if (Math.random() < 1 / 500) await db.pageView.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
  } catch {
    /* signed out, or the PageView table is not in this database yet — never the page's problem */
  }
}
