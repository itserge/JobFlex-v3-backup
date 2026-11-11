// Messages — Blueprint edition. Pixel-identical port of the canonical messages
// donor (jobflex-messages-blueprint_1.html).
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// The classic messages page is archived at old-design-pages/dashboard/messages.
//
// Not a fixture: the rail, the threads and the team picker are read from the
// database here, and the composer / clear / new-conversation controls call the
// real actions in src/actions/messages.ts (see messages-behavior.ts). The query
// is the archived classic page's — same participant scoping, same per-viewer
// thread naming, same unread helper as the sidebar badge — so both editions
// describe the same inbox.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { getUnreadByConversation } from "@/lib/badgeCounts";
import { roleLabel } from "@/lib/prismaEnums";
import { MessagesContent } from "@/components/v3/messages-blueprint/messages-content";
import type { Conv, Member } from "@/components/v3/messages-blueprint/messages-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Messages",
  description: "Messages — the crew's conversation list and thread on one sheet.",
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: requestedId } = await searchParams;
  // Team messages are a size's on the new plans (Professional and up); open on every Classic plan (lib/customPlan).
  const gate = await customPageGate("team-messages");
  if (gate) return gate;

  let organizationId: string;
  let userId: string;
  let meName: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
    meName = ctx.user.name ?? ctx.user.email ?? "You";
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fmessages");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // Participant-scoped for EVERY role: you see threads you're a member of.
  // Legacy threads predate the participant model (zero participant rows), so
  // their membership is unknowable — they stay visible only to people who
  // actually wrote in them, never to the whole office. Mirrors the visibility
  // rule inside src/actions/messages.ts; keep the two in sync.
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
        // The blueprint thread is a single scrolling transcript with day
        // dividers, so it needs the whole thread rather than the classic page's
        // "last message only + a second query for the open one".
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true, email: true } } },
        },
        // Needed to name a thread per-viewer: a 1:1 thread shows the OTHER
        // person, not the stored title (which holds the recipient's name from
        // the creator's POV and is wrong for everyone else).
        participants: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        job: { select: { title: true } },
      },
    }),
    // Everyone on the team (any role) except the current user — anyone can
    // direct-message or group their teammates (createConversation re-validates
    // recipients against this org's membership).
    db.membership.findMany({
      where: { organizationId, NOT: { userId } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // The same helper the nav badge sums, so the rail and the badge agree.
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

  const rows: Conv[] = conversations
    .map((c) => {
      // Per-viewer clear watermark: "clear thread" stamps clearedAt on MY
      // participant row only, and I stop seeing anything at or before it.
      // The other side's transcript is untouched (see clearConversation).
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
      // Read receipt for the viewer's OWN messages: the moment by which every
      // other participant had read the thread (their min lastReadAt), or null
      // while someone hasn't opened it. Same formula as getReadReceipts in
      // src/actions/messages.ts, which the client polls — keep in sync.
      const others = c.participants.filter((p) => p.userId !== userId);
      const readAt =
        others.length > 0 && others.every((p) => p.lastReadAt)
          ? Math.min(...others.map((p) => (p.lastReadAt as Date).getTime()))
          : null;
      return {
        id: c.id,
        // Prisma also stores "JOB" for crew threads auto-created from a job;
        // the rail only distinguishes one-to-one from many, so JOB reads GROUP.
        kind: (c.kind === "DIRECT" ? "DIRECT" : "GROUP") as Conv["kind"],
        title: displayName(c),
        job: c.job?.title ?? null,
        unread: unread.get(c.id) ?? 0,
        ts: msgs.length ? msgs[msgs.length - 1].ts : c.createdAt.getTime(),
        readAt,
        msgs,
      };
    })
    // Newest activity first — the same order the client keeps as messages land.
    .sort((a, b) => b.ts - a.ts);

  const team: Member[] = members.map((m) => ({
    id: m.userId,
    name: m.user?.name ?? m.user?.email ?? "Member",
    role: roleLabel(m.role),
  }));

  // Only open a thread that is actually in the (scoped) list — never an
  // arbitrary id off the query string.
  const activeId =
    (requestedId && rows.some((r) => r.id === requestedId) ? requestedId : rows[0]?.id) ?? null;

  return (
    <MessagesContent conversations={rows} team={team} meName={meName} activeId={activeId} />
  );
}
