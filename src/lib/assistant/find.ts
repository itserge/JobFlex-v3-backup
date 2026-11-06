import "server-only";
// FINDING WHAT THE PERSON NAMED (2026-11-04): "the Smith roof", "Mike", "the
// Lee fence". One company only, case aside, a few rows each — the model picks
// or asks "1 or 2". Postgres matches case-insensitively with `mode`; SQLite
// (the stand) has no such mode and its LIKE ignores ASCII case anyway, so the
// first refusal falls back to plain `contains` (as lib/adminActivityRead).
import { db } from "@/lib/db";

const TAKE = 6;

type Has = (word: string) => { contains: string };

/** Set once a database refused `mode` (SQLite): every later search goes plain at once. */
let plainOnly = false;

/** Run a search with the case-insensitive filter, or without it where the database has none. */
async function tolerant<T>(run: (has: Has) => Promise<T>): Promise<T> {
  if (!plainOnly) {
    try {
      return await run((w) => ({ contains: w, mode: "insensitive" }) as { contains: string });
    } catch (err) {
      if (!/Unknown argument `mode`/.test(err instanceof Error ? err.message : "")) throw err;
      plainOnly = true;
    }
  }
  return run((w) => ({ contains: w }));
}

/** The words worth searching: "the Smith roof proposal" → ["Smith", "roof"]. */
export function searchWords(q: string): string[] {
  const stop = new Set(["the", "a", "an", "for", "of", "to", "my", "our", "his", "her", "their", "job", "proposal", "estimate", "client", "customer", "project", "from", "yesterday", "today", "at", "on", "and", "with", "visit", "appointment", "meeting"]);
  return q
    .split(/[\s,.;:!?'"()]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stop.has(w.toLowerCase()))
    .slice(0, 4);
}

/** Proposals where every word hits the title, the address or the client's name. */
export async function findProposals(organizationId: string, q: string, scope: { ownerId?: string }) {
  const words = searchWords(q);
  if (!words.length) return [];
  return tolerant((has) =>
    db.proposal.findMany({
      where: { organizationId, ...scope, AND: words.map((w) => ({ OR: [{ title: has(w) }, { address: has(w) }, { client: { name: has(w) } }] })) },
      select: {
        id: true,
        title: true,
        status: true,
        total: true,
        currency: true,
        address: true,
        sentAt: true,
        viewedAt: true,
        viewCount: true,
        createdAt: true,
        client: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  );
}

export async function findClients(organizationId: string, q: string) {
  const t = q.trim().slice(0, 80);
  if (t.length < 2) return [];
  return tolerant((has) =>
    db.client.findMany({
      where: { organizationId, deletedAt: null, OR: [{ name: has(t) }, { email: has(t) }, { phone: has(t) }, { address: has(t) }] },
      select: { id: true, name: true, email: true, phone: true, address: true, city: true },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  );
}

/** Jobs where every word hits the title or the client's name. */
export async function findJobs(organizationId: string, q: string) {
  const words = searchWords(q);
  if (!words.length) return [];
  return tolerant((has) =>
    db.job.findMany({
      where: { organizationId, AND: words.map((w) => ({ OR: [{ title: has(w) }, { client: { name: has(w) } }] })) },
      select: {
        id: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        proposalId: true,
        client: { select: { name: true } },
        events: { select: { id: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" }, take: 1 },
        assignments: { select: { worker: { select: { id: true, displayName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  );
}

export async function findLeads(organizationId: string, q: string) {
  const t = q.trim().slice(0, 80);
  if (t.length < 2) return [];
  return tolerant((has) =>
    db.lead.findMany({
      where: { organizationId, OR: [{ name: has(t) }, { email: has(t) }, { phone: has(t) }, { address: has(t) }] },
      select: { id: true, name: true, status: true, source: true, address: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: TAKE,
    }),
  );
}

/** Visits (appointments) still scheduled, a month back to four ahead, where every word hits the title, the client's or
 *  the lead's name (2026-11-05: "move my visit with Lee to 4"). */
export async function findVisits(organizationId: string, q: string, now = new Date()) {
  const words = searchWords(q);
  if (!words.length) return [];
  return tolerant((has) =>
    db.appointment.findMany({
      where: {
        organizationId,
        status: "SCHEDULED",
        startsAt: { gte: new Date(now.getTime() - 30 * 86_400_000), lte: new Date(now.getTime() + 120 * 86_400_000) },
        AND: words.map((w) => ({ OR: [{ title: has(w) }, { client: { name: has(w) } }, { lead: { name: has(w) } }] })),
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        client: { select: { name: true } },
        lead: { select: { name: true } },
        assignments: { select: { worker: { select: { displayName: true } } } },
      },
      orderBy: { startsAt: "asc" },
      take: TAKE,
    }),
  );
}

/** The crew: every worker who hasn't declined, with whether texts reach them. */
export async function crewOf(organizationId: string) {
  return db.workerProfile.findMany({
    where: { organizationId, inviteStatus: { not: "DECLINED" } },
    select: { id: true, displayName: true, phone: true, smsOptIn: true, specialties: true },
    orderBy: { displayName: "asc" },
    take: 200,
  });
}
