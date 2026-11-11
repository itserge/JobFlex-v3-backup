"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser, requireManager, requireOrg, requireRouteAccess, isLimitedRole } from "@/lib/orgContext";
import { pageLockedResult, requirePage } from "@/lib/customPageAccess";
import { db } from "@/lib/db";
import type {
  TradeJob,
  OwnPost,
  ChatMessage,
  ViewerStatus,
  JobStatus,
  Urgency,
  TradeInboxDTO,
  TradeNetworkProfileDTO,
} from "@/app/(mobile)/trade-services/trade-data";

const ROUTE = "/trade-services";
const HIRE_ROUTE = "/dashboard/hire";
const HIDDEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BROADCAST_CAP = 500;

/** Withdrawal tombstone — see `deleteTradeJob`. `TradeJob.status` is a plain
 *  String column (the schema lists its values in a comment, it does not enforce
 *  them), so a fourth value costs no migration. A tombstoned job is gone from
 *  every list — the author's and the recipients' — while the conversations and
 *  messages that hang off it, which recipients authored, survive. */
const DELETED = "DELETED";
/** The one filter every job read has to carry: a withdrawn post is not a post. */
const NOT_DELETED = { status: { not: DELETED } } as const;

// ─── JSON list helpers (SQLite stores arrays as JSON strings) ──────────────
function parseList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function hoursSince(d: Date): number {
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 3_600_000));
}
function daysSince(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}
const URGENCIES = new Set<Urgency>(["low", "medium", "high", "urgent"]);
function asUrgency(s: string | null | undefined): Urgency | undefined {
  return s && URGENCIES.has(s as Urgency) ? (s as Urgency) : undefined;
}

// ─── Opt-in profile ────────────────────────────────────────────────────────
export async function getTradeNetworkProfile(): Promise<TradeNetworkProfileDTO> {
  const user = await requireUser();
  const p = await db.tradeNetworkProfile.findUnique({ where: { userId: user.id } });
  if (!p) return { optIn: false, tradeTypes: [], specialties: [], serviceArea: null };
  return {
    optIn: p.optIn,
    tradeTypes: parseList(p.tradeTypes),
    specialties: parseList(p.specialties),
    serviceArea: p.serviceArea,
  };
}

const optInInput = z.object({
  optIn: z.boolean(),
  tradeTypes: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  specialties: z.array(z.string().trim().min(1).max(60)).max(80).default([]),
  serviceArea: z.string().max(120).optional().nullable(),
});

export async function setTradeNetworkOptIn(raw: unknown): Promise<TradeNetworkProfileDTO> {
  const user = await requireUser();
  const data = optInInput.parse(raw);
  const payload = {
    optIn: data.optIn,
    tradeTypes: JSON.stringify(data.tradeTypes),
    specialties: JSON.stringify(data.specialties),
    serviceArea: data.serviceArea ?? null,
  };
  const p = await db.tradeNetworkProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...payload },
    update: payload,
  });
  revalidatePath(ROUTE);
  return {
    optIn: p.optIn,
    tradeTypes: parseList(p.tradeTypes),
    specialties: parseList(p.specialties),
    serviceArea: p.serviceArea,
  };
}

// ─── Talent directory (cross-org, read-only) ───────────────────────────────
// The hire hub's "Discover talent" door. Lists contractors who switched on
// "Open for work" (TradeNetworkProfile.optIn) at OTHER orgs. Same disclosure
// rule as the inbox mapper above: the display name and company are surfaced,
// never the account email — contact starts by posting a trade job, which
// broadcasts to matching opted-in profiles.
export type DiscoverProfileDTO = {
  id: string;
  name: string;
  company: string | null;
  tradeTypes: string[];
  specialties: string[];
  serviceArea: string | null;
  /** The caller's own company (their row or a teammate's). Listed so a
   *  contractor can see what hirers see, but never contactable. */
  isSelf: boolean;
};

export async function discoverTradeProfiles(): Promise<DiscoverProfileDTO[]> {
  const { organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  const rows = await db.tradeNetworkProfile.findMany({
    where: { optIn: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      tradeTypes: true,
      specialties: true,
      serviceArea: true,
      user: {
        select: {
          name: true,
          memberships: {
            select: { organizationId: true, organization: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  // Own-company rows were filtered out until 2026-09-02; now they are kept
  // and flagged, and sorted to the top, so a contractor can find themselves.
  return rows
    .map((p) => ({
      id: p.id,
      name: p.user.name ?? p.user.memberships[0]?.organization.name ?? "A contractor",
      company: p.user.memberships[0]?.organization.name ?? null,
      tradeTypes: parseList(p.tradeTypes),
      specialties: parseList(p.specialties),
      serviceArea: p.serviceArea,
      isSelf: p.user.memberships.some((m) => m.organizationId === organizationId),
    }))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
}

/** "I'm interested" on a talent-directory row — the door from the HIRER side
 *  (owner, 2026-08-23: the directory had no way to contact anyone). The listed
 *  contractor gets an email and a bell notice naming the interested company;
 *  nothing else is written — the conversation happens wherever they take it. */
export async function contactTalentProfile(profileId: string): Promise<{ ok: true }> {
  const { user, organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  const prof = await db.tradeNetworkProfile.findUnique({
    where: { id: profileId },
    select: { optIn: true, userId: true },
  });
  if (!prof || !prof.optIn) throw new Error("This profile is no longer listed.");
  if (prof.userId === user.id) throw new Error("That is your own profile.");
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  const from = {
    fromName: user.name ?? org?.name ?? "A contractor",
    fromCompany: org?.name ?? null,
  };
  // The bell first, and awaited: one insert, and it is what the "Sent" state
  // is asserting.
  try {
    const { recordTalentContacted } = await import("@/lib/notify");
    await recordTalentContacted(prof.userId, from);
  } catch (err) {
    console.warn("[tradeServices] talent-contact bell failed:", err);
  }
  // The email is a Gmail SMTP handshake — seconds, and nothing on screen waits
  // on it. `after()` runs it once the response has been sent, so the button
  // stops pretending the mail server's latency is the user's problem.
  after(async () => {
    try {
      const { emailTalentContacted } = await import("@/lib/notify");
      await emailTalentContacted(prof.userId, from);
    } catch (err) {
      console.warn("[tradeServices] talent-contact email failed:", err);
    }
  });
  return { ok: true };
}

// ─── Inbox (recipient view: New / Engaged / Hidden) ─────────────────────────
type RecipientRow = {
  status: string;
  notInterestedAt: Date | null;
  tradeJob: {
    id: string;
    title: string;
    description: string;
    tradeType: string;
    specialties: string;
    location: string | null;
    budget: string | null;
    timeWindow: string | null;
    urgency: string | null;
    status: string;
    createdAt: Date;
    authorOrgId: string;
    author: { name: string | null };
  };
};

function mapInboxJob(row: RecipientRow, orgNames: Map<string, string>): TradeJob {
  const j = row.tradeJob;
  return {
    id: j.id,
    title: j.title,
    description: j.description,
    tradeType: j.tradeType,
    specialties: parseList(j.specialties),
    location: j.location ?? undefined,
    budget: j.budget ?? undefined,
    timeWindow: j.timeWindow ?? undefined,
    urgency: asUrgency(j.urgency),
    status: j.status as JobStatus,
    // The INBOX does not surface the poster's account email — a broadcast
    // recipient did not ask to be handed one. (The Hire & Work BOARD does, at
    // `listOpenTradeJobs`: a post there exists to be answered by email, and
    // that disclosure is the owner's explicit call, 2026-09-03.)
    postedByName: j.author.name ?? orgNames.get(j.authorOrgId) ?? "A contractor",
    postedByCompany: orgNames.get(j.authorOrgId) ?? undefined,
    hoursAgo: hoursSince(j.createdAt),
    viewerStatus: row.status as ViewerStatus,
    hiddenDaysAgo: row.notInterestedAt ? daysSince(row.notInterestedAt) : undefined,
  };
}

export async function getTradeInbox(): Promise<TradeInboxDTO> {
  const user = await requireUser();
  const cutoff = new Date(Date.now() - HIDDEN_TTL_MS);

  const rows = await db.tradeJobRecipient.findMany({
    where: {
      recipientId: user.id,
      // A post the author withdrew disappears from the recipient's inbox too —
      // it is no longer work anyone can take.
      tradeJob: NOT_DELETED,
      OR: [
        { status: "NEW" },
        { status: "INTERESTED" },
        { status: "NOT_INTERESTED", notInterestedAt: { gte: cutoff } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true,
      notInterestedAt: true,
      tradeJob: {
        select: {
          id: true,
          title: true,
          description: true,
          tradeType: true,
          specialties: true,
          location: true,
          budget: true,
          timeWindow: true,
          urgency: true,
          status: true,
          createdAt: true,
          authorOrgId: true,
          author: { select: { name: true } },
        },
      },
    },
  });

  // Batch-resolve poster org names (authorOrgId is a provenance scalar, not a FK).
  const orgIds = Array.from(new Set(rows.map((r) => r.tradeJob.authorOrgId)));
  const orgs = orgIds.length
    ? await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      })
    : [];
  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));

  const mapped = rows.map((r) => mapInboxJob(r, orgNames));
  return {
    newJobs: mapped.filter((j) => j.viewerStatus === "NEW"),
    engaged: mapped.filter((j) => j.viewerStatus === "INTERESTED"),
    hidden: mapped.filter((j) => j.viewerStatus === "NOT_INTERESTED"),
  };
}

// ─── My Posts (author view) ─────────────────────────────────────────────────
/** One shape, one mapper: the list read and the single-row read after an edit
 *  must not be able to drift apart. */
const ownPostSelect = {
  id: true,
  title: true,
  // The detail panel reads the full brief, and the edit form writes it back —
  // both need the column the list view never used to ask for.
  description: true,
  tradeType: true,
  specialties: true,
  location: true,
  budget: true,
  timeWindow: true,
  urgency: true,
  status: true,
  createdAt: true,
  _count: { select: { recipients: true } },
  recipients: { where: { status: "INTERESTED" }, select: { id: true } },
} as const;

type OwnPostRow = {
  id: string;
  title: string;
  description: string;
  tradeType: string;
  specialties: string;
  location: string | null;
  budget: string | null;
  timeWindow: string | null;
  urgency: string | null;
  status: string;
  createdAt: Date;
  _count: { recipients: number };
  recipients: { id: string }[];
};

function mapOwnPost(j: OwnPostRow): OwnPost {
  return {
    id: j.id,
    title: j.title,
    description: j.description,
    tradeType: j.tradeType,
    specialties: parseList(j.specialties),
    location: j.location ?? undefined,
    budget: j.budget ?? undefined,
    timeWindow: j.timeWindow ?? undefined,
    urgency: asUrgency(j.urgency),
    status: j.status as JobStatus,
    hoursAgo: hoursSince(j.createdAt),
    broadcastCount: j._count.recipients,
    interestedCount: j.recipients.length,
  };
}

/** JobFlex reviews the poster's company has collected — the Reviews feature's
 *  completed requests, aggregated per org. `avg` is null until one is rated. */
export type ReviewSummaryDTO = {
  avg: number | null;
  count: number;
  /** Newest two with a written comment, for the detail's review lines. */
  latest: { rating: number; comment: string; client: string | null; when: string }[];
};

const NO_REVIEWS: ReviewSummaryDTO = { avg: null, count: 0, latest: [] };

/** One post on the Hire & Work board, with everything the detail sheet prints. */
export type NetworkJobDTO = {
  id: string;
  title: string;
  description: string;
  tradeType: string;
  specialties: string[];
  location: string | null;
  budget: string | null;
  hoursAgo: number;
  /** The posting company, and the poster's display name. */
  company: string;
  postedBy: string;
  /** How to reach them. Surfaced on purpose (owner, 2026-09-03): a post is an
   *  invitation to be contacted, and email is the channel the board runs on.
   *  The phone is the company's, from its settings — null when unset. */
  email: string;
  phone: string | null;
  reviews: ReviewSummaryDTO;
  /** Posted by the viewer's own COMPANY — someone here wrote it, maybe a
   *  colleague. Gates "I'm interested", which the server refuses org-internally. */
  isMine: boolean;
  /** Written by the viewer THEMSELVES. Gates Edit and the "You" stamp: a
   *  colleague's post is your company's, but only its author may change it,
   *  and `getMyTradeJobs` is author-scoped, so stamping every org-mate's post
   *  "You" offered an Edit button that could never find its row. */
  isOwnPost: boolean;
  /** The viewer's recipient state, or null when they have not acted on it. */
  viewerStatus: "NEW" | "INTERESTED" | "NOT_INTERESTED" | null;
  /** Hands raised on this post. */
  interestedCount: number;
};

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Per-org rating aggregate plus the two newest written reviews. One groupBy
 *  for the numbers, then one small read per rated org for the quotes — the
 *  board lists at most 200 posts, so the org set stays small. */
async function reviewSummaries(orgIds: string[]): Promise<Map<string, ReviewSummaryDTO>> {
  const out = new Map<string, ReviewSummaryDTO>();
  if (!orgIds.length) return out;
  const rated = { status: "COMPLETED", rating: { not: null } } as const;
  const agg = await db.reviewRequest.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: orgIds }, ...rated },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const quotes = await Promise.all(
    agg.map((a) =>
      db.reviewRequest.findMany({
        where: { organizationId: a.organizationId, ...rated, comment: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 2,
        select: {
          rating: true,
          comment: true,
          completedAt: true,
          createdAt: true,
          client: { select: { name: true } },
        },
      }),
    ),
  );
  agg.forEach((a, i) => {
    out.set(a.organizationId, {
      avg: a._avg.rating,
      count: a._count.rating,
      latest: quotes[i]
        .filter((q) => q.rating != null && q.comment && q.comment.trim())
        .map((q) => ({
          rating: q.rating as number,
          comment: (q.comment as string).trim(),
          client: q.client?.name ?? null,
          when: monthLabel(q.completedAt ?? q.createdAt),
        })),
    });
  });
  return out;
}

/** Every OPEN post on the network, newest first — the whole board, the
 *  viewer's own posts included (owner, 2026-09-02: "I can't see the job I
 *  posted, from any account"). Bodies and contact details are public to the
 *  network by design: a post exists to be read and answered by strangers. */
export async function listOpenTradeJobs(): Promise<NetworkJobDTO[]> {
  const { user, organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  const jobs = await db.tradeJob.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      description: true,
      tradeType: true,
      specialties: true,
      location: true,
      budget: true,
      createdAt: true,
      authorId: true,
      authorOrgId: true,
      author: { select: { name: true, email: true } },
      recipients: { where: { recipientId: user.id }, select: { status: true }, take: 1 },
      _count: { select: { recipients: { where: { status: "INTERESTED" } } } },
    },
  });
  const orgIds = Array.from(new Set(jobs.map((j) => j.authorOrgId)));
  const [orgs, reviews] = await Promise.all([
    orgIds.length
      ? db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
    reviewSummaries(orgIds),
  ]);
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  return jobs.map((j) => {
    const org = orgById.get(j.authorOrgId);
    const company = org?.name ?? "A contractor";
    const rs = j.recipients[0]?.status;
    return {
      id: j.id,
      title: j.title,
      description: j.description,
      tradeType: j.tradeType,
      specialties: parseList(j.specialties),
      location: j.location,
      budget: j.budget,
      hoursAgo: hoursSince(j.createdAt),
      company,
      postedBy: j.author.name ?? company,
      email: j.author.email,
      phone: org?.phone ?? null,
      reviews: reviews.get(j.authorOrgId) ?? NO_REVIEWS,
      isMine: j.authorOrgId === organizationId,
      isOwnPost: j.authorId === user.id,
      viewerStatus: rs === "NEW" || rs === "INTERESTED" || rs === "NOT_INTERESTED" ? rs : null,
      interestedCount: j._count.recipients,
    };
  });
}

export async function getMyTradeJobs(): Promise<OwnPost[]> {
  const user = await requireUser();
  const jobs = await db.tradeJob.findMany({
    where: { authorId: user.id, ...NOT_DELETED },
    orderBy: { createdAt: "desc" },
    select: ownPostSelect,
  });
  return jobs.map(mapOwnPost);
}

// ─── Matching engine (consent-gated, cross-org, 500 cap) ────────────────────
async function findMatchingRecipients(
  tradeType: string,
  specialties: string[],
  excludeUserId: string,
): Promise<string[]> {
  const orFilters: { tradeTypes?: { contains: string }; specialties?: { contains: string } }[] =
    [{ tradeTypes: { contains: `"${tradeType}"` } }];
  for (const s of specialties) orFilters.push({ specialties: { contains: `"${s}"` } });

  const candidates = await db.tradeNetworkProfile.findMany({
    where: { optIn: true, userId: { not: excludeUserId }, OR: orFilters },
    select: { userId: true, tradeTypes: true, specialties: true },
    take: 2000,
  });

  const wantSpecialties = new Set(specialties);
  const matched: string[] = [];
  for (const c of candidates) {
    const profTrades = new Set(parseList(c.tradeTypes));
    const profSkills = parseList(c.specialties);
    const tradeHit = profTrades.has(tradeType);
    const skillHit = profSkills.some((s) => wantSpecialties.has(s));
    if (tradeHit || skillHit) matched.push(c.userId);
    if (matched.length >= BROADCAST_CAP) break;
  }
  return matched;
}

// ─── Create / broadcast ─────────────────────────────────────────────────────
const createInput = z.object({
  // No floor on length (owner, 2026-09-02): a title is required, the brief
  // is whatever the author wrote. The ceilings are storage sanity only.
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).default(""),
  tradeType: z.string().trim().min(1).max(60),
  specialties: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  location: z.string().trim().max(160).optional().nullable(),
  budget: z.string().trim().max(80).optional().nullable(),
  timeWindow: z.string().trim().max(120).optional().nullable(),
  urgency: z.enum(["low", "medium", "high", "urgent"]).optional().nullable(),
});

export async function createTradeJob(raw: unknown): Promise<{ id: string; broadcastCount: number }> {
  const { user, organizationId } = await requireManager();
  const data = createInput.parse(raw);

  // Lightweight anti-spam: cap broadcasts per author per minute.
  const recent = await db.tradeJob.count({
    where: { authorId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (recent >= 5) {
    throw new Error("You're posting too fast. Give it a minute and try again.");
  }

  const job = await db.tradeJob.create({
    data: {
      authorId: user.id,
      authorOrgId: organizationId,
      title: data.title,
      description: data.description,
      tradeType: data.tradeType,
      specialties: JSON.stringify(data.specialties),
      location: data.location ?? null,
      budget: data.budget ?? null,
      timeWindow: data.timeWindow ?? null,
      urgency: data.urgency ?? null,
      status: "OPEN",
    },
    select: { id: true },
  });

  const recipientIds = await findMatchingRecipients(data.tradeType, data.specialties, user.id);
  if (recipientIds.length) {
    await db.$transaction(
      recipientIds.map((rid) =>
        db.tradeJobRecipient.create({
          data: { tradeJobId: job.id, recipientId: rid, status: "NEW" },
        }),
      ),
    );
  }

  revalidatePath(ROUTE);
  revalidatePath(HIRE_ROUTE);
  return { id: job.id, broadcastCount: recipientIds.length };
}

// ─── Recipient responses ────────────────────────────────────────────────────
export async function respondToTradeJob(
  jobId: string,
  status: "INTERESTED" | "NOT_INTERESTED",
): Promise<{ ok: true }> {
  const user = await requireUser();
  if (status !== "INTERESTED" && status !== "NOT_INTERESTED") {
    throw new Error("Invalid response");
  }
  // Authz: a user can only act on their OWN recipient row.
  const rec = await db.tradeJobRecipient.findUnique({
    where: { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } },
    select: { id: true, tradeJob: { select: { authorId: true, status: true } } },
  });
  if (!rec) throw new Error("This job was not sent to you.");
  // Don't let recipients express interest / open chats on closed jobs.
  if (status === "INTERESTED" && rec.tradeJob.status !== "OPEN") {
    throw new Error("This job is no longer open.");
  }

  await db.tradeJobRecipient.update({
    where: { id: rec.id },
    data: {
      status,
      interestedAt: status === "INTERESTED" ? new Date() : null,
      notInterestedAt: status === "NOT_INTERESTED" ? new Date() : null,
    },
  });

  if (status === "INTERESTED") {
    await db.tradeJobConversation.upsert({
      where: { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } },
      create: { tradeJobId: jobId, authorId: rec.tradeJob.authorId, recipientId: user.id },
      update: { updatedAt: new Date() },
    });
  }
  if (status === "INTERESTED") {
    // The poster hears about the raised hand — bell + email, best-effort:
    // a mail failure must never fail the response that triggered it.
    try {
      const { notifyTradeInterest } = await import("@/lib/notify");
      await notifyTradeInterest(jobId, user.id);
    } catch (err) {
      console.warn("[tradeServices] interest notify failed:", err);
    }
  }
  revalidatePath(ROUTE);
  return { ok: true };
}

export async function restoreTradeJob(jobId: string): Promise<{ ok: true }> {
  const user = await requireUser();
  const rec = await db.tradeJobRecipient.findUnique({
    where: { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } },
    select: { id: true },
  });
  if (!rec) throw new Error("This job was not sent to you.");
  await db.tradeJobRecipient.update({
    where: { id: rec.id },
    data: { status: "NEW", notInterestedAt: null, interestedAt: null },
  });
  revalidatePath(ROUTE);
  return { ok: true };
}

// ─── Author status changes ──────────────────────────────────────────────────
export async function setTradeJobStatus(
  jobId: string,
  status: "FILLED" | "CANCELLED",
): Promise<{ ok: true }> {
  const user = await requireUser();
  if (status !== "FILLED" && status !== "CANCELLED") throw new Error("Invalid status");
  // Authz: only the author can change a job's status.
  const job = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: { authorId: true, status: true },
  });
  if (!job || job.authorId !== user.id) throw new Error("Only the poster can do that.");
  if (job.status === DELETED) throw new Error("This post was deleted.");
  await db.tradeJob.update({ where: { id: jobId }, data: { status } });
  if (status === "FILLED") {
    // Everyone who raised a hand hears the outcome — best-effort, see above.
    try {
      const { notifyTradeFilled } = await import("@/lib/notify");
      await notifyTradeFilled(jobId);
    } catch (err) {
      console.warn("[tradeServices] filled notify failed:", err);
    }
  }
  revalidatePath(ROUTE);
  revalidatePath(HIRE_ROUTE);
  return { ok: true };
}

// ─── Author edit / withdraw ─────────────────────────────────────────────────
// Owner ask, 2026-08-24: a post used to be write-once — a typo in the rate or
// the wrong trade meant cancelling and re-broadcasting. Both actions below are
// author-only, checked against the row on the server; the id from the client is
// never trusted for anything but the lookup.
//
// The gate is `requireUser()` + an author check, matching `setTradeJobStatus`
// rather than `createTradeJob`'s `requireManager()`. Creating a broadcast is a
// manager act; correcting or withdrawing YOUR OWN broadcast should not stop
// working because your role changed after you posted it.

const updateInput = z.object({
  // No floor on length (owner, 2026-09-02): a title is required, the brief
  // is whatever the author wrote. The ceilings are storage sanity only.
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).default(""),
  tradeType: z.string().trim().min(1).max(60),
  specialties: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  location: z.string().trim().max(160).optional().nullable(),
  budget: z.string().trim().max(80).optional().nullable(),
  timeWindow: z.string().trim().max(120).optional().nullable(),
  urgency: z.enum(["low", "medium", "high", "urgent"]).optional().nullable(),
});

/** Edit a post that is still OPEN. A FILLED or CANCELLED post is a record of
 *  something that already happened, and the people who acted on it read the
 *  terms they acted on — those stay frozen.
 *
 *  The recipient list is deliberately NOT recomputed. Everyone already notified
 *  keeps the post in their inbox with the corrected text; changing the trade
 *  does not fire a second broadcast at a fresh audience (that is a new post,
 *  and re-broadcasting on every keystroke-level edit is how a network becomes
 *  spam). */
export async function updateTradeJob(jobId: string, raw: unknown): Promise<OwnPost> {
  const user = await requireUser();
  const data = updateInput.parse(raw);

  const existing = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: { authorId: true, status: true },
  });
  if (!existing || existing.authorId !== user.id) {
    throw new Error("Only the poster can edit this post.");
  }
  if (existing.status === DELETED) throw new Error("This post was deleted.");
  if (existing.status !== "OPEN") {
    throw new Error("Only an open post can be edited. Reopen it or post a new one.");
  }

  const job = await db.tradeJob.update({
    where: { id: jobId },
    data: {
      title: data.title,
      description: data.description,
      tradeType: data.tradeType,
      specialties: JSON.stringify(data.specialties),
      location: data.location ?? null,
      budget: data.budget ?? null,
      timeWindow: data.timeWindow ?? null,
      urgency: data.urgency ?? null,
    },
    select: ownPostSelect,
  });

  revalidatePath(ROUTE);
  revalidatePath(HIRE_ROUTE);
  return mapOwnPost(job);
}

/** Remove a post from the author's list.
 *
 *  Two paths, because the two cases are genuinely different:
 *
 *  - Nobody was ever notified (no `TradeJobRecipient` rows, which also means no
 *    conversation can exist — a thread is only opened from a recipient row).
 *    Nothing downstream refers to this job, so it is HARD deleted. Leaving a
 *    tombstone for a post no human ever saw is litter.
 *
 *  - Anyone was notified. The row is TOMBSTONED (`status: "DELETED"`) instead.
 *    A hard delete here would cascade (`onDelete: Cascade` on
 *    TradeJobRecipient and TradeJobConversation, and from there on
 *    TradeJobMessage) and destroy messages that OTHER people wrote — third
 *    parties who never agreed to have their side of a conversation erased
 *    because the poster tidied up. The tombstone withdraws the post from every
 *    list, the author's and the recipients', while their threads survive.
 *
 *  Either way the caller's own list stops showing it, which is the contract the
 *  button makes. */
export async function deleteTradeJob(
  jobId: string,
): Promise<{ ok: true; hardDeleted: boolean }> {
  const user = await requireUser();
  const job = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: { authorId: true, status: true, _count: { select: { recipients: true } } },
  });
  if (!job || job.authorId !== user.id) {
    throw new Error("Only the poster can delete this post.");
  }
  // Already withdrawn — treat as done rather than erroring on a double click.
  if (job.status === DELETED) return { ok: true, hardDeleted: false };

  const hardDeleted = job._count.recipients === 0;
  if (hardDeleted) {
    await db.tradeJob.delete({ where: { id: jobId } });
  } else {
    await db.tradeJob.update({ where: { id: jobId }, data: { status: DELETED } });
  }

  revalidatePath(ROUTE);
  revalidatePath(HIRE_ROUTE);
  return { ok: true, hardDeleted };
}

// ─── Conversation (recipient side) ──────────────────────────────────────────
function mapMessage(
  m: { id: string; body: string; authorId: string; createdAt: Date },
  meId: string,
): ChatMessage {
  const h = hoursSince(m.createdAt);
  return {
    id: m.id,
    body: m.body,
    mine: m.authorId === meId,
    atLabel: h < 1 ? "Just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`,
  };
}

export async function getTradeConversation(jobId: string): Promise<ChatMessage[]> {
  const user = await requireUser();
  // Authz: a recipient may only read the conversation tied to their own row.
  const convo = await db.tradeJobConversation.findUnique({
    where: { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } },
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, authorId: true, createdAt: true },
      },
    },
  });
  if (!convo) return [];
  return convo.messages.map((m) => mapMessage(m, user.id));
}

export async function sendTradeMessage(jobId: string, body: string): Promise<ChatMessage | null> {
  const user = await requireUser();
  const trimmed = body.trim();
  if (!trimmed) return null;
  // Authz: only a participant (here, the recipient) may post to the thread.
  const convo = await db.tradeJobConversation.findUnique({
    where: { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } },
    select: { id: true, tradeJob: { select: { status: true } } },
  });
  if (!convo) throw new Error("No conversation for this job.");
  if (convo.tradeJob.status === "CANCELLED") {
    throw new Error("This job was cancelled.");
  }
  if (convo.tradeJob.status === DELETED) {
    throw new Error("The poster withdrew this job.");
  }
  const msg = await db.tradeJobMessage.create({
    data: { conversationId: convo.id, authorId: user.id, body: trimmed.slice(0, 4000) },
    select: { id: true, body: true, authorId: true, createdAt: true },
  });
  await db.tradeJobConversation.update({
    where: { id: convo.id },
    data: { updatedAt: new Date() },
  });
  revalidatePath(ROUTE);
  return mapMessage(msg, user.id);
}

// ─── Hire & Work board (rebuilt 2026-09-03) ─────────────────────────────────

/** Who is looking at the board. Printed on their own post's detail the moment
 *  it is created, before any round trip could read it back. */
export type HireViewerDTO = {
  name: string;
  company: string;
  email: string;
  phone: string | null;
  reviews: ReviewSummaryDTO;
  /** Limited roles (installer / sales / estimator) read the board but cannot
   *  post — `createTradeJob` is manager-gated. */
  canPost: boolean;
};

export async function getHireViewer(): Promise<HireViewerDTO> {
  const { user, organizationId, role } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  const [me, org, reviews] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, phone: true },
    }),
    reviewSummaries([organizationId]),
  ]);
  const company = org?.name ?? "";
  return {
    name: me?.name ?? (company || "You"),
    company,
    email: me?.email ?? "",
    phone: org?.phone ?? null,
    reviews: reviews.get(organizationId) ?? NO_REVIEWS,
    canPost: !isLimitedRole(role),
  };
}

/** "I'm interested" on the board. Unlike `respondToTradeJob`, which only lets
 *  a BROADCAST recipient answer, anyone signed in may raise a hand on any open
 *  post — the board is public to the network by design. The recipient row is
 *  created on the spot, the same conversation slot opens, and the poster hears
 *  it: bell awaited, mail after the response. A second press is a no-op. */
export async function expressInterest(jobId: string): Promise<{ ok: true; already: boolean }> {
  const { user, organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  const job = await db.tradeJob.findUnique({
    where: { id: jobId },
    select: { authorId: true, authorOrgId: true, status: true },
  });
  if (!job || job.status !== "OPEN") throw new Error("This post is no longer open.");
  if (job.authorId === user.id || job.authorOrgId === organizationId) {
    throw new Error("That is your own post.");
  }
  const key = { tradeJobId_recipientId: { tradeJobId: jobId, recipientId: user.id } };
  const existing = await db.tradeJobRecipient.findUnique({ where: key, select: { status: true } });
  if (existing?.status === "INTERESTED") return { ok: true, already: true };

  const now = new Date();
  await db.tradeJobRecipient.upsert({
    where: key,
    create: { tradeJobId: jobId, recipientId: user.id, status: "INTERESTED", interestedAt: now },
    update: { status: "INTERESTED", interestedAt: now, notInterestedAt: null },
  });
  await db.tradeJobConversation.upsert({
    where: key,
    create: { tradeJobId: jobId, authorId: job.authorId, recipientId: user.id },
    update: { updatedAt: now },
  });
  // The bell and the EMAIL are both awaited here (owner, 2026-09-03: "make a
  // person receive an email if somebody was interested in his work").
  //
  // The email used to run in `after()`, so the button never waited on the SMTP
  // handshake — but a deferred send is also one that nobody can observe, and a
  // notification the poster does not receive is the whole feature missing. The
  // send costs about a second, the button already says "Sending…" while it
  // happens, and a failure is now logged rather than swallowed. Neither call
  // can fail the write: the interest is already committed above.
  try {
    const { recordHireInterest } = await import("@/lib/notify");
    await recordHireInterest(jobId, user.id);
  } catch (err) {
    console.warn("[tradeServices] interest bell failed:", err);
  }
  try {
    const { emailHireInterest } = await import("@/lib/notify");
    const r = await emailHireInterest(jobId, user.id);
    if (r.skipped) {
      console.warn(
        `[tradeServices] interest email NOT sent for job ${jobId} — no transport configured, the poster has trade-reply email off, or they have no address.`,
      );
    }
  } catch (err) {
    console.warn("[tradeServices] interest email failed:", err);
  }
  revalidatePath(HIRE_ROUTE);
  revalidatePath(ROUTE);
  return { ok: true, already: false };
}

// ─── Hire & Work: result-envelope wrappers ──────────────────────────────────
// WHY THESE EXIST. Next REDACTS a thrown server-action error's message in a
// production build — the client receives a generic "an error occurred in the
// Server Components render" paragraph instead. So every user-facing sentence
// the actions above throw ("You're posting too fast", "That is your own post",
// "Only the poster can edit this post") is readable in dev and invisible in
// prod, which is where it matters.
//
// A RETURNED value is not redacted. These wrappers call the same author-gated
// actions and hand back `{ ok, message }`, so the board can print the real
// sentence. The originals keep throwing and keep their signatures, because
// /trade-services and its handheld twin still call them.

export type HireResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/** The message a caught server error should show a human. An unrecognised
 *  error is a fault, not a rule the user broke, so it gets a neutral line. */
function hireMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message.trim() : "";
  // Next's redaction paragraph, a stack, or an empty message are all "a fault
  // happened" — never show them. A short authored sentence is the real thing.
  if (!raw || raw.length > 160 || /server components render|digest property/i.test(raw)) {
    return fallback;
  }
  return raw;
}

/** THE HIRE BOARD IS A SIZE'S on the new plans (Base + Tools, 2026-11-10: Professional and up): the refusal a
 *  person reads, or null to go on — always null on a Classic plan (lib/customPlan classicEquivalent). The Trade
 *  board's own actions above are not the Hire board's and stay open. A signed-out caller is left to the action's
 *  own sign-in check. */
async function hireRefusal(): Promise<string | null> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireOrg());
  } catch {
    return null;
  }
  return (await pageLockedResult(organizationId, "hire"))?.error ?? null;
}

export async function hireExpressInterest(jobId: string): Promise<HireResult<{ already: boolean }>> {
  const locked = await hireRefusal();
  if (locked) return { ok: false, message: locked };
  try {
    const r = await expressInterest(jobId);
    return { ok: true, data: { already: r.already } };
  } catch (err) {
    return { ok: false, message: hireMessage(err, "Couldn't send that. Try again.") };
  }
}

export async function hireCreatePost(
  raw: unknown,
): Promise<HireResult<{ id: string; broadcastCount: number }>> {
  const locked = await hireRefusal();
  if (locked) return { ok: false, message: locked };
  try {
    return { ok: true, data: await createTradeJob(raw) };
  } catch (err) {
    return { ok: false, message: hireMessage(err, "Couldn't post. Try again.") };
  }
}

export async function hireUpdatePost(jobId: string, raw: unknown): Promise<HireResult<OwnPost>> {
  const locked = await hireRefusal();
  if (locked) return { ok: false, message: locked };
  try {
    return { ok: true, data: await updateTradeJob(jobId, raw) };
  } catch (err) {
    return { ok: false, message: hireMessage(err, "Couldn't save. Try again.") };
  }
}

export async function hireDeletePost(jobId: string): Promise<HireResult> {
  const locked = await hireRefusal();
  if (locked) return { ok: false, message: locked };
  try {
    await deleteTradeJob(jobId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, message: hireMessage(err, "Couldn't delete. Try again.") };
  }
}

/** Everyone who raised a hand on one of YOUR posts, with how to reach them.
 *
 *  The interest email tells the poster to open their posts and see who
 *  answered; until this existed, all that was there was a number. Author-gated
 *  against the row — the id from the client is only ever a lookup key. */
export type InterestedPartyDTO = {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  agoHours: number;
};

export async function getPostInterest(jobId: string): Promise<HireResult<InterestedPartyDTO[]>> {
  const locked = await hireRefusal();
  if (locked) return { ok: false, message: locked };
  try {
    const user = await requireUser();
    const job = await db.tradeJob.findUnique({
      where: { id: jobId },
      select: { authorId: true },
    });
    if (!job || job.authorId !== user.id) {
      return { ok: false, message: "Only the poster can see who answered." };
    }
    const rows = await db.tradeJobRecipient.findMany({
      where: { tradeJobId: jobId, status: "INTERESTED" },
      orderBy: { interestedAt: "desc" },
      take: 100,
      select: {
        id: true,
        interestedAt: true,
        createdAt: true,
        recipient: {
          select: {
            name: true,
            email: true,
            phone: true,
            memberships: {
              orderBy: { createdAt: "asc" },
              take: 1,
              select: { organization: { select: { name: true, phone: true } } },
            },
          },
        },
      },
    });
    return {
      ok: true,
      data: rows.map((r) => {
        const org = r.recipient.memberships[0]?.organization;
        return {
          id: r.id,
          name: r.recipient.name ?? org?.name ?? "A contractor",
          company: org?.name ?? null,
          email: r.recipient.email,
          phone: r.recipient.phone ?? org?.phone ?? null,
          agoHours: hoursSince(r.interestedAt ?? r.createdAt),
        };
      }),
    };
  } catch (err) {
    return { ok: false, message: hireMessage(err, "Couldn't load that list. Try again.") };
  }
}

// ─── Unseen interest, per post ──────────────────────────────────────────────
// Owner ask, 2026-09-03: a post whose interest you have not looked at yet
// should say so — a counter on the post, and the same number in the bell.
//
// "Looked at" is per POST, not per page: opening Hire & Work does not mean you
// read who answered on post #3. The stamp is a NavSeen row keyed
// `hire-post:<jobId>`, written when that post's interested list is unfolded.
// NavSeen is already (userId, organizationId, key) unique and free-form on
// `key`, so this needs no migration — `markNavSeen` is left alone because it
// validates against the fixed SEEN_SURFACES list.

const POST_SEEN_PREFIX = "hire-post:";

/** The author's own posts, each carrying how many hands raised on it the
 *  author has not looked at yet. Same rows as `getMyTradeJobs`, plus that. */
export type HireOwnPostDTO = OwnPost & {
  /** INTERESTED responses newer than the author's last look at THIS post. */
  newInterest: number;
};

export async function getMyHirePosts(): Promise<HireOwnPostDTO[]> {
  const { user, organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
  await requirePage(organizationId, "hire");
  const jobs = await db.tradeJob.findMany({
    where: { authorId: user.id, ...NOT_DELETED },
    orderBy: { createdAt: "desc" },
    select: ownPostSelect,
  });
  if (!jobs.length) return [];

  const ids = jobs.map((j) => j.id);
  const [seenRows, interested] = await Promise.all([
    db.navSeen.findMany({
      where: {
        userId: user.id,
        organizationId,
        key: { in: ids.map((id) => `${POST_SEEN_PREFIX}${id}`) },
      },
      select: { key: true, seenAt: true },
    }),
    // Every raised hand on these posts, with when. Folded in JS rather than a
    // count-per-post round trip: an author has a handful of posts, and one
    // read cannot drift from another.
    db.tradeJobRecipient.findMany({
      where: { tradeJobId: { in: ids }, status: "INTERESTED" },
      select: { tradeJobId: true, interestedAt: true, createdAt: true },
    }),
  ]);

  const seenAt = new Map(
    seenRows.map((r) => [r.key.slice(POST_SEEN_PREFIX.length), r.seenAt.getTime()]),
  );
  const fresh = new Map<string, number>();
  for (const r of interested) {
    const at = (r.interestedAt ?? r.createdAt).getTime();
    const since = seenAt.get(r.tradeJobId);
    // Never looked at this post → every hand on it is new.
    if (since === undefined || at > since) {
      fresh.set(r.tradeJobId, (fresh.get(r.tradeJobId) ?? 0) + 1);
    }
  }

  return jobs.map((j) => ({ ...mapOwnPost(j), newInterest: fresh.get(j.id) ?? 0 }));
}

/** Stamp one post's interest as read — called when its list is unfolded.
 *  Author-only, checked against the row. */
export async function markPostInterestSeen(jobId: string): Promise<HireResult> {
  try {
    const { user, organizationId } = await requireRouteAccess("/dashboard/hire", "/dashboard/trade");
    await requirePage(organizationId, "hire");
    const job = await db.tradeJob.findUnique({
      where: { id: jobId },
      select: { authorId: true },
    });
    if (!job || job.authorId !== user.id) {
      return { ok: false, message: "Only the poster can do that." };
    }
    const key = `${POST_SEEN_PREFIX}${jobId}`;
    await db.navSeen.upsert({
      where: { userId_organizationId_key: { userId: user.id, organizationId, key } },
      create: { userId: user.id, organizationId, key },
      update: { seenAt: new Date() },
    });
    return { ok: true, data: undefined };
  } catch {
    // Nothing on screen waits on this — the count is cleared optimistically.
    return { ok: false, message: "Couldn't save that." };
  }
}
