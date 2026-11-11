// MINUTES AND PACKS — server only (the rules are pure, in lib/aiDesk/shared).
//
//   includedDeskMinutes  the plan's "AI desk minutes" limit (the plan editor), or the tier's default
//   readDeskPacks        the pack balance and its history — SyncState `deskpacks:<orgId>`
//   addPackSeconds       a pack lands on the balance, once per reference (lib/aiDesk/packs buys them)
//   deskBalanceFor       where the company stands: included minutes first, then packs
//   settleDeskUse        after a call or a test: this month's overage comes off the packs; auto
//                        top-up buys a pack when the balance runs out; the owner is told once a
//                        month when the desk is out
//   tellOwner            the three emails (out of minutes, pack added by auto top-up, its card refused)
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { getOrgPlanById } from "@/lib/orgPlan";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { isPageLocked } from "@/lib/customPageAccess";
import { toolsDeskMinutes } from "@/lib/toolPlans/allowances";
import { sendEmail } from "@/lib/sdk/resend";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { DESK_MINUTES_CUSTOM_WITH_PHONE, DESK_MINUTES_DEFAULT, DESK_PACK, deskBalance, dollars, EMPTY_PACKS, parseDeskPacks, TOP_UP_AT_SECONDS, unsettledPackSeconds, type DeskBalance, type DeskPackRecord, type DeskPacks, type DeskPackVia } from "./shared";
import { patchDeskUse, readDeskUse } from "./usage";

const packsKey = (organizationId: string) => `deskpacks:${organizationId}`;

/** The plan's limit when the plan row sets one (0 counts); else the tier's default. */
export async function includedDeskMinutes(organizationId: string): Promise<number> {
  const status = await checkPlanLimit(organizationId, "deskMinutes", 0, { actorId: null }).catch(() => null);
  if (status && !status.exempt && status.limit !== null && Number.isFinite(status.limit) && status.limit >= 0) return status.limit;
  // The new plans (Base + Tools): Advanced/Complete include the desk, a smaller size that adds it gets fewer, none
  // without it (lib/toolPlans/allowances). Null for a Classic shop.
  const tools = await toolsDeskMinutes(organizationId).catch(() => null);
  if (tools !== null) return tools;
  const [plan, sub] = await Promise.all([getOrgPlanById(organizationId).catch(() => "FREE" as const), readAccessSubscription(organizationId).catch(() => null)]);
  if ((sub?.plan ?? "").toUpperCase() === "CUSTOM") return (await isPageLocked(organizationId, "phone").catch(() => true)) ? 0 : DESK_MINUTES_CUSTOM_WITH_PHONE;
  return DESK_MINUTES_DEFAULT[plan] ?? 0;
}

export async function readDeskPacks(organizationId: string): Promise<DeskPacks> {
  const row = await db.syncState.findUnique({ where: { key: packsKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  return row ? parseDeskPacks(row.cursor) : { ...EMPTY_PACKS, history: [] };
}

export async function saveDeskPacks(organizationId: string, packs: DeskPacks): Promise<void> {
  const key = packsKey(organizationId);
  const cursor = JSON.stringify(packs);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** A pack on the balance — once per reference (a Stripe payment id; an admin's note). */
export async function addPackSeconds(organizationId: string, rec: { minutes: number; cents: number; via: DeskPackVia; ref: string | null }): Promise<{ added: boolean; packs: DeskPacks }> {
  const packs = await readDeskPacks(organizationId);
  if (rec.ref && packs.history.some((h) => h.ref === rec.ref)) return { added: false, packs };
  const entry: DeskPackRecord = { at: new Date().toISOString(), minutes: rec.minutes, cents: rec.cents, via: rec.via, ref: rec.ref };
  const next: DeskPacks = { ...packs, seconds: packs.seconds + rec.minutes * 60, autoFailedAt: null, history: [entry, ...packs.history].slice(0, 24) };
  await saveDeskPacks(organizationId, next);
  return { added: true, packs: next };
}

export async function setAutoTopUp(organizationId: string, on: boolean): Promise<DeskPacks> {
  const next: DeskPacks = { ...(await readDeskPacks(organizationId)), autoTopUp: on, autoFailedAt: null };
  await saveDeskPacks(organizationId, next);
  return next;
}

export async function deskBalanceFor(organizationId: string): Promise<DeskBalance> {
  const [included, use, packs] = await Promise.all([includedDeskMinutes(organizationId), readDeskUse(organizationId), readDeskPacks(organizationId)]);
  return deskBalance(included, use, packs);
}

/** After use was noted (liveCall finishCall, actions/aiDesk endDeskTest). Never throws. */
export async function settleDeskUse(organizationId: string): Promise<DeskBalance | null> {
  try {
    const [included, use, packs] = await Promise.all([includedDeskMinutes(organizationId), readDeskUse(organizationId), readDeskPacks(organizationId)]);
    let p = packs;
    let u = use;
    const delta = unsettledPackSeconds(included, use);
    if (delta > 0) {
      // This month's overage beyond the included minutes comes off the pack balance.
      p = { ...packs, seconds: Math.max(0, packs.seconds - delta) };
      await saveDeskPacks(organizationId, p);
      u = await patchDeskUse(organizationId, { packSeconds: use.packSeconds + delta });
    }
    let balance = deskBalance(included, u, p);
    const failedLately = p.autoFailedAt ? Date.now() - Date.parse(p.autoFailedAt) < 86_400_000 : false;
    if (balance.remainingSeconds <= TOP_UP_AT_SECONDS && p.autoTopUp && !failedLately) {
      const { autoBuyPack } = await import("./packs");
      const r = await autoBuyPack(organizationId).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "The card could not be charged." }));
      if (r.ok) balance = await deskBalanceFor(organizationId);
      else {
        await saveDeskPacks(organizationId, { ...(await readDeskPacks(organizationId)), autoFailedAt: new Date().toISOString() });
        await tellOwner(organizationId, "auto-failed", r.error);
      }
    }
    if (balance.out && !u.outNoticeAt) {
      await patchDeskUse(organizationId, { outNoticeAt: new Date().toISOString() });
      await tellOwner(organizationId, "out", null);
    }
    return balance;
  } catch (err) {
    console.warn("[aiDesk] settle failed:", err);
    return null;
  }
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.jobflex.app").replace(/\/+$/, "");

/** The owner's address: the first OWNER member, else the billing email. */
export async function ownerOf(organizationId: string): Promise<{ userId: string | null; email: string | null; name: string }> {
  const [org, owner] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, billingEmail: true } }),
    db.membership.findFirst({ where: { organizationId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { userId: true, user: { select: { email: true } } } }).catch(() => null),
  ]);
  return { userId: owner?.userId ?? null, email: owner?.user.email ?? org?.billingEmail ?? null, name: org?.name ?? "your company" };
}

export type OwnerNotice = "out" | "auto-failed" | "auto-bought";

/** One email to the owner; the trail gets a line either way. Never throws. */
export async function tellOwner(organizationId: string, notice: OwnerNotice, detail: string | null): Promise<void> {
  try {
    const owner = await ownerOf(organizationId);
    const link = `${appUrl()}/dashboard/settings?pane=desk`;
    const pack = `${DESK_PACK.minutes} minutes for ${dollars(DESK_PACK.cents)}`;
    const letters: Record<OwnerNotice, { subject: string; lines: string[]; trail: string }> = {
      out: {
        subject: `The AI desk is out of minutes — ${owner.name}`,
        lines: [`Your AI desk has used all of its minutes this month.`, `Until you add minutes, calls to your number ring your company phone, or take a message.`, `Add ${pack} here: ${link}`, `Turn on auto top-up there and this won't happen again.`],
        trail: "The AI desk ran out of minutes — calls ring the company phone or take a message",
      },
      "auto-failed": {
        subject: `Auto top-up couldn't charge your card — ${owner.name}`,
        lines: [`JobFlex tried to add ${pack} to your AI desk, but the card on file could not be charged${detail ? `: ${detail}` : "."}`, `Update the card, or add minutes by hand, here: ${link}`, `We'll try the card again tomorrow if auto top-up stays on.`],
        trail: `Auto top-up could not charge the card${detail ? ` — ${detail}` : ""}`,
      },
      "auto-bought": {
        subject: `${DESK_PACK.minutes} minutes added to your AI desk — ${owner.name}`,
        lines: [`Your AI desk ran low, so auto top-up added ${pack}${detail ? ` (${detail})` : ""}.`, `The minutes don't expire. Your packs and the switch are here: ${link}`],
        trail: `Auto top-up added ${DESK_PACK.minutes} minutes (${dollars(DESK_PACK.cents)})${detail ? ` — ${detail}` : ""}`,
      },
    };
    const l = letters[notice];
    await logActivity({ organizationId, actorId: null, kind: TRAIL_KINDS.SETTINGS, summary: l.trail }).catch(() => null);
    if (!owner.email) return;
    const text = `${l.lines.join("\n\n")}\n\n— JobFlex`;
    const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0a0a0a">${l.lines.map((x) => `<p>${x.replace(link, `<a href="${link}">${link}</a>`)}</p>`).join("")}<p>— JobFlex</p></div>`;
    await sendEmail({ to: owner.email, subject: l.subject, html, text }).catch(() => null);
  } catch {
    /* a notice never breaks a call */
  }
}
