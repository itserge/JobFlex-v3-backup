"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { withFeature } from "@/lib/customPageAccess";

// TEAM MESSAGES ARE A SIZE'S (Base + Tools, 2026-11-10: Professional and up): every action here asks the page gate
// for "team-messages" after the session — open on every Classic plan, as before (lib/customPlan classicEquivalent).
function teamOrg() {
  return withFeature(requireOrg(), "team-messages");
}

const createInput = z.object({
  title: z.string().optional(),
  // Org-member user ids to add to the thread (the creator is always added).
  participantIds: z.array(z.string()).default([]),
  kind: z.enum(["DIRECT", "GROUP"]).default("DIRECT"),
});

// Anyone on the team can open a thread with other members (workers included) —
// a direct thread is the creator + one person; a group is the creator + many.
// The creator is always a participant so it shows for them. Recipients are
// validated against THIS org's membership below, so the blast radius of any
// role is limited to people already on the same team.
export async function createConversation(raw: unknown) {
  const { organizationId, user } = await teamOrg();
  await enforcePlanLimit(organizationId, "conversationsStarted");
  const data = createInput.parse(raw ?? {});

  // Only let real members of THIS org be added (never a raw id from the client).
  const validMemberIds = new Set(
    (
      await db.membership.findMany({
        where: { organizationId, userId: { in: data.participantIds } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  const participantUserIds = Array.from(
    new Set([user.id, ...data.participantIds.filter((id) => validMemberIds.has(id))]),
  );

  const c = await db.conversation.create({
    data: {
      organizationId,
      title: data.title?.trim() || null,
      kind: participantUserIds.length > 2 ? "GROUP" : data.kind,
      participants: { create: participantUserIds.map((userId) => ({ userId })) },
    },
  });
  revalidatePath("/dashboard/messages");
  return { id: c.id };
}

// True when the caller may read/post/clear this conversation: a participant, or —
// for a legacy thread that predates participants (no participant rows) — someone
// who authored a message in it. Membership of legacy threads is unknowable, so
// authorship is the only signal; they are never open to the whole office.
// Callers pass `messages` pre-filtered to the caller's own (take: 1).
function canAccess(
  conv: { participants: { userId: string }[]; messages: { id: string }[] },
  userId: string,
) {
  const isParticipant = conv.participants.some((p) => p.userId === userId);
  const legacyAuthor = conv.participants.length === 0 && conv.messages.length > 0;
  return isParticipant || legacyAuthor;
}

export async function postMessage(conversationId: string, body: string) {
  // requireOrg (not requireManager) so limited roles can reply in their threads.
  const { organizationId, user } = await teamOrg();
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: { select: { userId: true } },
      messages: { where: { authorId: user.id }, select: { id: true }, take: 1 },
    },
  });
  if (!conv || conv.organizationId !== organizationId) throw new Error("Not found");
  if (!canAccess(conv, user.id)) {
    throw new Error("You can only reply in your own threads.");
  }

  const trimmed = body.trim();
  if (!trimmed) return;
  await enforcePlanLimit(organizationId, "messagesSent");
  const m = await db.message.create({
    data: { conversationId: conv.id, authorId: user.id, body: trimmed },
  });
  revalidatePath("/dashboard/messages");
  // The row id + stamp go back so the client can swap its optimistic `tmp-`
  // message for the database row — editing needs the real id. Additive:
  // MessagesInbox awaits this action without reading the return.
  return { ok: true, id: m.id, ts: m.createdAt.getTime() };
}

// Author-only body rewrite. No editedAt column and no "(edited)" marker — the
// owner's call (2026-08-12): editing ships without a schema change. The same
// participant gate as postMessage does not apply — being the author is the
// gate, and authorship already implies the poster passed it once. That leans
// on an invariant that holds today: ConversationParticipant rows are never
// deleted (createConversation / ensureJobConversation only create,
// markConversationRead only updates). If a remove-from-thread feature ever
// lands, add a membership re-check here, or a removed author could still
// rewrite history in a thread they can no longer see.
export async function editMessage(messageId: string, body: string) {
  const { organizationId, user } = await teamOrg();
  const trimmed = body.trim();
  if (!trimmed) throw new Error("A message can't be edited to nothing.");
  const m = await db.message.findUnique({
    where: { id: messageId },
    include: { conversation: { select: { organizationId: true } } },
  });
  if (!m || m.conversation.organizationId !== organizationId) throw new Error("Not found");
  if (m.authorId !== user.id) throw new Error("You can only edit your own messages.");
  await db.message.update({ where: { id: m.id }, data: { body: trimmed } });
  revalidatePath("/dashboard/messages");
  return { ok: true };
}

// Read receipts for every thread the caller can see, computed from the same
// lastReadAt stamps markConversationRead writes — the REAL read state, not a
// client-side guess. Per conversation: the epoch-ms moment by which every
// OTHER participant had read the thread (their minimum lastReadAt), or null
// while at least one of them has never opened it. A viewer's own message is
// "read" when its timestamp is ≤ that moment. Legacy threads (no participant
// rows) have no read state to report and return null. The messages page polls
// this to flip Delivered → Read live.
export async function getReadReceipts() {
  const { organizationId, user } = await teamOrg();
  const convs = await db.conversation.findMany({
    // Mirrors the visibility rule in the messages page.tsx and
    // clearAllConversations below — keep the three in sync.
    where: {
      organizationId,
      OR: [
        { participants: { some: { userId: user.id } } },
        {
          AND: [
            { participants: { none: {} } },
            { messages: { some: { authorId: user.id } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      participants: { select: { userId: true, lastReadAt: true } },
    },
  });
  return convs.map((c) => {
    const others = c.participants.filter((p) => p.userId !== user.id);
    const readAt =
      others.length > 0 && others.every((p) => p.lastReadAt)
        ? Math.min(...others.map((p) => (p.lastReadAt as Date).getTime()))
        : null;
    return { id: c.id, readAt };
  });
}

// Live inbox poll (2026-08-21). One round trip returns everything the open
// messages page needs to stay honest without a reload: read receipts for
// every visible thread, plus every message newer than `afterTs` — including
// messages in threads the client has never seen (someone just started a chat
// with you), which arrive with enough metadata to append a rail row. Messages
// behind the caller's clearedAt watermark are never resurfaced. The client
// passes the newest message timestamp it knows; strictly-newer rows come
// back, and the client dedupes by id (its own optimistic sends echo here).
export async function pollMessages(afterTs: number) {
  const { organizationId, user } = await teamOrg();
  const since = new Date(Number.isFinite(afterTs) ? afterTs : Date.now());
  const convs = await db.conversation.findMany({
    // Same visibility rule as the messages page — keep in sync.
    where: {
      organizationId,
      OR: [
        { participants: { some: { userId: user.id } } },
        {
          AND: [
            { participants: { none: {} } },
            { messages: { some: { authorId: user.id } } },
          ],
        },
      ],
    },
    include: {
      participants: { include: { user: { select: { id: true, name: true, email: true } } } },
      messages: {
        where: { createdAt: { gt: since } },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      job: { select: { title: true } },
    },
  });

  const receipts: { id: string; readAt: number | null }[] = [];
  const updates: {
    id: string;
    kind: "DIRECT" | "GROUP";
    title: string;
    job: string | null;
    msgs: { id: string; who: string; me: boolean; ts: number; body: string }[];
  }[] = [];

  for (const c of convs) {
    const others = c.participants.filter((p) => p.userId !== user.id);
    receipts.push({
      id: c.id,
      readAt:
        others.length > 0 && others.every((p) => p.lastReadAt)
          ? Math.min(...others.map((p) => (p.lastReadAt as Date).getTime()))
          : null,
    });
    const mine = c.participants.find((p) => p.userId === user.id);
    const cleared = mine?.clearedAt?.getTime() ?? 0;
    const fresh = c.messages.filter((m) => m.createdAt.getTime() > cleared);
    if (fresh.length === 0) continue;
    // Per-viewer thread name — same formula as the page's displayName.
    const title =
      c.kind === "DIRECT" && others.length > 0
        ? (others[0].user?.name ?? others[0].user?.email ?? "Conversation")
        : (c.title ??
          (others.length > 0
            ? others.map((p) => p.user?.name ?? p.user?.email ?? "Member").join(", ")
            : "Conversation"));
    updates.push({
      id: c.id,
      kind: c.kind === "DIRECT" ? "DIRECT" : "GROUP",
      title,
      job: c.job?.title ?? null,
      msgs: fresh.map((m) => ({
        id: m.id,
        who: m.author?.name ?? m.author?.email ?? "Anonymous",
        me: m.authorId === user.id,
        ts: m.createdAt.getTime(),
        body: m.body,
      })),
    });
  }
  return { receipts, updates };
}

// Stamps this thread as read for the caller — drives the unread-messages
// badge in the sidebar/tab bar. No revalidatePath: the badge recomputes on
// the layout's next render, same as every other self-clearing surface.
export async function markConversationRead(conversationId: string) {
  const { user } = await teamOrg();
  await db.conversationParticipant.updateMany({
    where: { conversationId, userId: user.id },
    data: { lastReadAt: new Date() },
  });
}

// Clear a single thread — FOR THE CALLER ONLY. It used to deleteMany the
// Message rows, which silently emptied the thread for every participant; now
// it stamps the caller's `clearedAt` watermark and every read path filters
// messages behind it. The other side keeps their transcript. lastReadAt is
// stamped too, so the unread badge can't count messages the caller just chose
// not to see. Legacy threads (no participant rows — membership unknowable)
// keep the old hard wipe: there is no participant row to carry a watermark.
export async function clearConversation(conversationId: string) {
  const { organizationId, user } = await teamOrg();
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: { select: { userId: true } },
      messages: { where: { authorId: user.id }, select: { id: true }, take: 1 },
    },
  });
  if (!conv || conv.organizationId !== organizationId) throw new Error("Not found");
  if (!canAccess(conv, user.id)) throw new Error("Not allowed");
  if (conv.participants.length === 0) {
    await db.message.deleteMany({ where: { conversationId: conv.id } });
  } else {
    const now = new Date();
    await db.conversationParticipant.updateMany({
      where: { conversationId: conv.id, userId: user.id },
      data: { clearedAt: now, lastReadAt: now },
    });
  }
  revalidatePath("/dashboard/messages");
  return { ok: true };
}

// Clear every thread the caller can see — for the CALLER only (see
// clearConversation). Participating threads get the clearedAt watermark;
// legacy no-participant threads they authored in keep the hard wipe.
// Mirrors the visibility rule on the messages page — keep the two in sync.
export async function clearAllConversations() {
  const { organizationId, user } = await teamOrg();
  const convs = await db.conversation.findMany({
    where: {
      organizationId,
      OR: [
        { participants: { some: { userId: user.id } } },
        {
          AND: [
            { participants: { none: {} } },
            { messages: { some: { authorId: user.id } } },
          ],
        },
      ],
    },
    select: { id: true, participants: { select: { userId: true }, take: 1 } },
  });
  if (convs.length === 0) return { ok: true, cleared: 0 };
  const now = new Date();
  const participating = convs.filter((c) => c.participants.length > 0).map((c) => c.id);
  const legacy = convs.filter((c) => c.participants.length === 0).map((c) => c.id);
  if (participating.length > 0) {
    await db.conversationParticipant.updateMany({
      where: { conversationId: { in: participating }, userId: user.id },
      data: { clearedAt: now, lastReadAt: now },
    });
  }
  if (legacy.length > 0) {
    await db.message.deleteMany({ where: { conversationId: { in: legacy } } });
  }
  revalidatePath("/dashboard/messages");
  return { ok: true, cleared: convs.length };
}

// The messages page's whole server read as ONE callable action (2026-08-21),
// for the handheld surface: ResponsiveDashboardShell mounts MobileMessages
// props-less on /dashboard/messages, so it cannot receive the desktop page's
// server-component read as props and asks this action for the same book
// instead — the pattern getCalendarSeed set for the calendar. The logic below
// is src/app/dashboard/messages/page.tsx VERBATIM: same participant-scoped
// visibility (keep in sync with the rule above), same per-viewer display
// names, same clearedAt message filter, same readAt receipt formula, same
// unread helper. Types are the blueprint's own (type-only — erased at build,
// so the "use server" export rule is untouched). Dependencies the rest of
// this file doesn't use are imported inside the function, keeping this a
// pure append.
type SeedConv = import("@/components/v3/messages-blueprint/messages-data").Conv;
type SeedMember = import("@/components/v3/messages-blueprint/messages-data").Member;
type SeedShape = import("@/components/v3/messages-blueprint/messages-data").MessagesSeed;

export async function getMessagesSeed(): Promise<SeedShape> {
  const [{ getUnreadByConversation }, { roleLabel }] = await Promise.all([
    import("@/lib/badgeCounts"),
    import("@/lib/prismaEnums"),
  ]);
  const { organizationId, user } = await teamOrg();
  const userId = user.id;
  const meName = user.name ?? user.email ?? "You";

  const conversationWhere = {
    organizationId,
    OR: [
      { participants: { some: { userId } } },
      {
        AND: [{ participants: { none: {} } }, { messages: { some: { authorId: userId } } }],
      },
    ],
  };

  const [conversations, members, unread] = await Promise.all([
    db.conversation.findMany({
      where: conversationWhere,
      orderBy: { createdAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, email: true } } },
        },
        participants: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        job: { select: { title: true } },
      },
    }),
    db.membership.findMany({
      where: { organizationId, NOT: { userId } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getUnreadByConversation(organizationId, userId),
  ]);

  function displayName(c: (typeof conversations)[number]): string {
    const others = c.participants.filter((p) => p.userId !== userId);
    if (c.kind === "DIRECT" && others.length > 0) {
      const o = others[0].user;
      return o?.name ?? o?.email ?? "Conversation";
    }
    if (c.title) return c.title;
    if (others.length > 0) {
      return others.map((p) => p.user?.name ?? p.user?.email ?? "Member").join(", ");
    }
    return "Conversation";
  }

  const rows: SeedConv[] = conversations
    .map((c) => {
      // Per-viewer clear watermark — see clearConversation above.
      const clearedAt =
        c.participants.find((p) => p.userId === userId)?.clearedAt?.getTime() ?? 0;
      const msgs = c.messages
        .filter((m) => m.createdAt.getTime() > clearedAt)
        .map((m) => ({
          id: m.id,
          who: m.author?.name ?? m.author?.email ?? "Anonymous",
          me: m.authorId === userId,
          ts: m.createdAt.getTime(),
          body: m.body,
        }));
      // Same receipt formula as getReadReceipts above — keep in sync.
      const others = c.participants.filter((p) => p.userId !== userId);
      const readAt =
        others.length > 0 && others.every((p) => p.lastReadAt)
          ? Math.min(...others.map((p) => (p.lastReadAt as Date).getTime()))
          : null;
      return {
        id: c.id,
        kind: (c.kind === "DIRECT" ? "DIRECT" : "GROUP") as SeedConv["kind"],
        title: displayName(c),
        job: c.job?.title ?? null,
        unread: unread.get(c.id) ?? 0,
        ts: msgs.length ? msgs[msgs.length - 1].ts : c.createdAt.getTime(),
        readAt,
        msgs,
      };
    })
    .sort((a, b) => b.ts - a.ts);

  const team: SeedMember[] = members.map((m) => ({
    id: m.userId,
    name: m.user?.name ?? m.user?.email ?? "Member",
    role: roleLabel(m.role),
  }));

  // No ?c= deep link on the handheld surface: the newest thread, or nothing.
  return { conversations: rows, team, meName, activeId: rows[0]?.id ?? null };
}
