import "server-only";
// EVERY COMPANY'S TIME ZONE ON AUTO (owner, 2026-11-07: "fix everybody's time zone, on auto, if they have their
// company address or state"). Every hour, from api/cron/follow-ups: each live company still on the default zone whose
// business address (its state) or phone (its area code) says it keeps another one gets that one. Only the default
// ever moves — a zone somebody chose (settings, or the Operator's "set our time zone to Pacific") is never touched —
// and a company with neither an address nor a phone stays as it is until it adds one; the company page then sets the
// zone on save (actions/company.ts), and this sweep catches whatever that missed.

import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, timezoneFixFor } from "@/lib/usTimezone";

export type OrgTimezoneSweepResult = { scanned: number; fixed: number; failed: number };

export async function runOrgTimezoneSweep(): Promise<OrgTimezoneSweepResult> {
  const out: OrgTimezoneSweepResult = { scanned: 0, fixed: 0, failed: 0 };
  const orgs = await db.organization.findMany({
    where: { deletedAt: null, timezone: DEFAULT_TIMEZONE, OR: [{ address: { not: null } }, { phone: { not: null } }] },
    select: { id: true, name: true, address: true, phone: true },
    take: 2000,
  });
  out.scanned = orgs.length;
  for (const o of orgs) {
    const tz = timezoneFixFor(DEFAULT_TIMEZONE, { address: o.address, phone: o.phone });
    if (!tz) continue;
    try {
      // The default in the WHERE too: a zone chosen between the read and this write stays.
      const r = await db.organization.updateMany({ where: { id: o.id, timezone: DEFAULT_TIMEZONE }, data: { timezone: tz } });
      if (r.count) {
        out.fixed++;
        console.info(`[org-timezones] ${o.name} (${o.id}) → ${tz}`);
      }
    } catch (err) {
      out.failed++;
      console.warn("[org-timezones] not set:", o.id, err instanceof Error ? err.message : err);
    }
  }
  return out;
}
