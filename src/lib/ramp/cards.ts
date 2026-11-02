import "server-only";
// RAMP CARDS FROM INSIDE JOBFLEX (2026-10-29, round 2) — server. The owner gives a crew member a card without opening
// Ramp: the person is found in the contractor's Ramp by email (or invited there — Ramp emails them), a fund is made
// for them with the monthly limit the owner typed ("JobFlex · Mike Rivera"), and a physical card is ordered to the
// shop's address. The cards Ramp already has are listed here too, with one switch to freeze a card. An order that
// has to wait for Ramp (the invite still being made, the person not yet onboarded) is remembered in SyncState
// `rampCardOrder:<org>:<email>` and finished on the next look — the hourly sync, Ramp's users.invite_accepted
// webhook, or the card list opening.
import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { toE164 } from "@/lib/phone";
import { rampApiFor } from "./connection";
import type { RampApi } from "./client";
import { cardLimitError, money, parseAddressLine, toCents, type PostalAddress } from "./shared";

const orderKey = (org: string, email: string) => `rampCardOrder:${org}:${email.toLowerCase()}`;

export interface RampCardView {
  id: string;
  kind: "physical" | "virtual";
  holder: string;
  lastFour: string;
  state: string;
  suspended: boolean;
  displayName: string;
  fundId: string | null;
  /** Physical cards on the way: Ramp's fulfillment word and the shipping ETA. */
  shipping: string | null;
  createdAt: string | null;
}

export interface RampCardOrder {
  email: string;
  name: string;
  userId: string | null;
  monthlyLimit: number;
  perPurchaseLimit: number | null;
  ship: PostalAddress;
  rampUserId: string | null;
  taskId: string | null;
  fundId: string | null;
  cardId: string | null;
  lastFour: string | null;
  state: "inviting" | "funding" | "ordering" | "ordered" | "failed";
  note: string | null;
  createdAt: string;
  updatedAt: string;
  by: string;
}

async function readOrder(org: string, email: string): Promise<RampCardOrder | null> {
  const row = await db.syncState.findUnique({ where: { key: orderKey(org, email) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as RampCardOrder;
  } catch {
    return null;
  }
}
async function writeOrder(org: string, o: RampCardOrder): Promise<RampCardOrder> {
  const cursor = JSON.stringify(o);
  await db.syncState.upsert({ where: { key: orderKey(org, o.email) }, create: { key: orderKey(org, o.email), cursor }, update: { cursor } });
  return o;
}
async function allOrders(org: string): Promise<RampCardOrder[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: `rampCardOrder:${org}:` } }, select: { cursor: true }, take: 300 }).catch(() => []);
  const out: RampCardOrder[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.cursor) as RampCardOrder);
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ── the team to pick from ─────────────────────────────────────────────── */

export interface RampTeamMember {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  kind: "crew" | "office";
}
/** Everyone in the company with an email Ramp can invite: the crew (WorkerProfile) and the office (memberships). */
export async function rampTeam(organizationId: string): Promise<RampTeamMember[]> {
  const [workers, members] = await Promise.all([
    db.workerProfile.findMany({ where: { organizationId }, select: { userId: true, displayName: true, phone: true, user: { select: { email: true } } }, take: 300 }).catch(() => []),
    db.membership.findMany({ where: { organizationId }, select: { userId: true, user: { select: { email: true, name: true, smsPhone: true } } }, take: 300 }).catch(() => []),
  ]);
  const out = new Map<string, RampTeamMember>();
  for (const w of workers) {
    const email = (w.user?.email ?? "").trim().toLowerCase();
    if (!email) continue;
    out.set(w.userId, { userId: w.userId, name: w.displayName.trim() || email, email, phone: toE164(w.phone), kind: "crew" });
  }
  for (const m of members) {
    const email = (m.user?.email ?? "").trim().toLowerCase();
    if (!email || out.has(m.userId)) continue;
    out.set(m.userId, { userId: m.userId, name: (m.user?.name ?? "").trim() || email, email, phone: toE164(m.user?.smsPhone ?? null), kind: "office" });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ── the cards Ramp has ────────────────────────────────────────────────── */

export interface RampCardsView {
  cards: RampCardView[];
  orders: RampCardOrder[];
  shipTo: PostalAddress | null;
  shipToRaw: string;
}

export async function rampCards(organizationId: string): Promise<RampCardsView> {
  const got = await rampApiFor(organizationId);
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } }).catch(() => null);
  const shipTo = parseAddressLine(org?.address ?? null);
  if (!got) return { cards: [], orders: [], shipTo, shipToRaw: org?.address ?? "" };
  const { api } = got;
  await resumeRampCardOrders(organizationId).catch(() => 0);
  const [physical, virtual, users] = await Promise.all([api.physicalCards().catch(() => []), api.virtualCards().catch(() => []), api.users().catch(() => [])]);
  const nameOf = new Map(users.map((u) => [u.id ?? "", [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || ""]));
  const cards: RampCardView[] = [
    ...physical.map((c) => ({
      id: c.id ?? "",
      kind: "physical" as const,
      holder: c.cardholder_name?.trim() || nameOf.get(c.cardholder_id ?? "") || "",
      lastFour: c.last_four ?? "",
      state: (c.state ?? "").toLowerCase().replace(/_/g, " "),
      suspended: !!c.is_suspended || c.state === "SUSPENDED",
      displayName: c.display_name ?? "",
      fundId: c.fund_id ?? null,
      shipping: c.fulfillment?.fulfillment_status && c.fulfillment.fulfillment_status !== "DELIVERED" ? `${c.fulfillment.fulfillment_status.toLowerCase()}${c.fulfillment.shipping_eta ? ` · arrives ${c.fulfillment.shipping_eta}` : ""}` : null,
      createdAt: c.created_at ?? null,
    })),
    ...virtual.map((c) => ({
      id: c.id ?? "",
      kind: "virtual" as const,
      holder: nameOf.get(c.user_id ?? "") || "",
      lastFour: c.last_four ?? "",
      state: c.is_card_suspended ? "suspended" : "active",
      suspended: !!c.is_card_suspended,
      displayName: c.display_name ?? "",
      fundId: c.fund_id ?? null,
      shipping: null,
      createdAt: c.created_at ?? null,
    })),
  ].filter((c) => c.id);
  const orders = (await allOrders(organizationId)).filter((o) => o.state !== "ordered" || Date.now() - Date.parse(o.updatedAt) < 14 * 86_400_000);
  return { cards, orders, shipTo, shipToRaw: org?.address ?? "" };
}

/* ── giving a card ─────────────────────────────────────────────────────── */

export interface RampCardOrderInput {
  userId: string | null;
  email: string;
  name: string;
  monthlyLimit: number;
  perPurchaseLimit: number | null;
  ship: PostalAddress;
}

/** The person in Ramp by email, with whatever status; null when Ramp has never heard of them. */
async function rampUserByEmail(api: RampApi, email: string): Promise<{ id: string; status: string } | null> {
  const users = await api.users().catch(() => []);
  const u = users.find((x) => (x.email ?? "").trim().toLowerCase() === email);
  return u?.id ? { id: u.id, status: u.status ?? "" } : null;
}

/** One order pushed as far as Ramp lets it go today: user → fund → card. Whatever stops it is written on the order. */
async function advanceOrder(organizationId: string, api: RampApi, o: RampCardOrder): Promise<RampCardOrder> {
  const stamp = () => ({ updatedAt: new Date().toISOString() });
  try {
    if (!o.rampUserId) {
      const found = await rampUserByEmail(api, o.email);
      if (found) o = { ...o, rampUserId: found.id, ...stamp() };
      else if (o.taskId) {
        const t = await api.userTask(o.taskId);
        const st = (t.status ?? "").toUpperCase();
        if (st === "SUCCESS" && t.data?.user_id) o = { ...o, rampUserId: t.data.user_id, ...stamp() };
        else if (st === "ERROR") return writeOrder(organizationId, { ...o, state: "failed", note: `Ramp could not invite ${o.email}: ${t.data?.error ?? "no reason given"}.`, ...stamp() });
        else return writeOrder(organizationId, { ...o, state: "inviting", note: "Ramp is sending the invite.", ...stamp() });
      } else {
        const [first, ...rest] = o.name.trim().split(/\s+/);
        const task = await api.inviteUser({ email: o.email, first_name: first || o.email.split("@")[0], last_name: rest.join(" ") || "—", idempotency_key: `jobflex-card-${organizationId.slice(-8)}-${o.email}`.slice(0, 120), role: "BUSINESS_USER" });
        o = { ...o, taskId: task.id, state: "inviting", note: `Ramp is inviting ${o.email} — they get an email from Ramp to accept.`, ...stamp() };
        // A few seconds' patience: most invites are made at once.
        for (let i = 0; i < 5 && !o.rampUserId; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const t = await api.userTask(task.id).catch(() => null);
          const st = (t?.status ?? "").toUpperCase();
          if (st === "SUCCESS" && t?.data?.user_id) o = { ...o, rampUserId: t.data.user_id, ...stamp() };
          else if (st === "ERROR") return writeOrder(organizationId, { ...o, state: "failed", note: `Ramp could not invite ${o.email}: ${t?.data?.error ?? "no reason given"}.`, ...stamp() });
        }
        if (!o.rampUserId) return writeOrder(organizationId, o);
      }
    }
    if (!o.fundId) {
      o = await writeOrder(organizationId, { ...o, state: "funding", ...stamp() });
      const fund = await api.createFund({
        user_id: o.rampUserId,
        display_name: `JobFlex · ${o.name}`.slice(0, 60),
        is_shareable: false,
        permitted_spend_types: { physical_card: true, virtual_card: true, reimbursements: false },
        spending_restrictions: { interval: "MONTHLY", limit: { amount: toCents(o.monthlyLimit), currency_code: "USD" }, ...(o.perPurchaseLimit ? { transaction_amount_limit: { amount: toCents(o.perPurchaseLimit), currency_code: "USD" } } : {}) },
      });
      o = { ...o, fundId: fund.id, ...stamp() };
    }
    if (!o.cardId) {
      o = await writeOrder(organizationId, { ...o, state: "ordering", ...stamp() });
      const card = await api.createPhysicalCard({ user_id: o.rampUserId!, fund_id: o.fundId, shipping_address: { address1: o.ship.address1, address2: o.ship.address2 ?? null, city: o.ship.city, state: o.ship.state, postal_code: o.ship.postal_code, country: o.ship.country || "US" } });
      o = { ...o, cardId: card.id ?? "ordered", lastFour: card.last_four ?? null, state: "ordered", note: card.fulfillment?.shipping_eta ? `On its way — arrives about ${card.fulfillment.shipping_eta}.` : "Ordered — Ramp ships it to the address given.", ...stamp() };
    }
    return writeOrder(organizationId, o);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ramp refused.";
    // A card for someone who has not accepted the invite yet: Ramp says so; the order waits for users.invite_accepted.
    const waiting = !o.cardId && /invite|onboard|not active|pending/i.test(msg);
    return writeOrder(organizationId, { ...o, state: waiting ? "inviting" : "failed", note: waiting ? `Waiting for ${o.name} to accept Ramp's invite; the card is ordered the moment they do.` : msg.slice(0, 240), ...stamp() });
  }
}

/** The owner gives a card: the order made and pushed as far as Ramp allows right now. */
export async function orderRampCard(organizationId: string, input: RampCardOrderInput, by: { userId: string | null; name: string }): Promise<{ ok: true; order: RampCardOrder } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "The person needs an email — Ramp invites them there." };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the person." };
  const bad = cardLimitError(input.monthlyLimit, input.perPurchaseLimit);
  if (bad) return { ok: false, error: bad };
  if (!input.ship.address1 || !input.ship.city || !input.ship.state || !input.ship.postal_code) return { ok: false, error: "Where does the card ship? Street, city, state and ZIP." };
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  const existing = await readOrder(organizationId, email);
  if (existing && existing.state !== "failed" && existing.state !== "ordered") return { ok: false, error: `A card for ${existing.name} is already on its way through Ramp (${existing.state}).` };
  const now = new Date().toISOString();
  const order: RampCardOrder = { email, name, userId: input.userId, monthlyLimit: Math.round(input.monthlyLimit), perPurchaseLimit: input.perPurchaseLimit ? Math.round(input.perPurchaseLimit) : null, ship: { ...input.ship, country: input.ship.country || "US" }, rampUserId: null, taskId: null, fundId: null, cardId: null, lastFour: null, state: "inviting", note: null, createdAt: now, updatedAt: now, by: by.name };
  const done = await advanceOrder(organizationId, got.api, order);
  await logActivity({
    organizationId,
    actorId: by.userId,
    kind: TRAIL_KINDS.SETTINGS,
    summary: done.state === "ordered" ? `Ramp card ordered for ${name} — ${money(done.monthlyLimit)} a month${done.perPurchaseLimit ? `, ${money(done.perPurchaseLimit)} a purchase` : ""}, ships to ${done.ship.address1}, ${done.ship.city}` : done.state === "failed" ? `Ramp card for ${name} not ordered: ${done.note ?? "Ramp refused"}` : `Ramp card for ${name} started — ${done.note ?? "waiting for Ramp"}`,
    meta: { area: "ramp", email, state: done.state, fundId: done.fundId, cardId: done.cardId, monthlyLimit: done.monthlyLimit },
  });
  return { ok: true, order: done };
}

/** Orders still waiting on Ramp, pushed again (the hourly sync, the invite-accepted webhook, the list opening). */
export async function resumeRampCardOrders(organizationId: string): Promise<number> {
  const waiting = (await allOrders(organizationId)).filter((o) => o.state === "inviting" || o.state === "funding" || o.state === "ordering");
  if (!waiting.length) return 0;
  const got = await rampApiFor(organizationId);
  if (!got) return 0;
  let finished = 0;
  for (const o of waiting) {
    const r = await advanceOrder(organizationId, got.api, o);
    if (r.state === "ordered") {
      finished += 1;
      await logActivity({ organizationId, actorId: null, kind: TRAIL_KINDS.SETTINGS, summary: `Ramp card ordered for ${r.name} — ${money(r.monthlyLimit)} a month, ships to ${r.ship.address1}, ${r.ship.city}`, meta: { area: "ramp", email: r.email, fundId: r.fundId, cardId: r.cardId } });
    }
  }
  return finished;
}

/** Freeze or unfreeze a physical card. */
export async function setRampCardSuspended(organizationId: string, cardId: string, suspended: boolean, by: { userId: string | null; name: string }, holder: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const got = await rampApiFor(organizationId);
  if (!got) return { ok: false, error: "Ramp is not connected." };
  try {
    await got.api.suspendCard(cardId, suspended);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Ramp refused." };
  }
  await logActivity({ organizationId, actorId: by.userId, kind: TRAIL_KINDS.SETTINGS, summary: `${suspended ? "Froze" : "Unfroze"} ${holder ? `${holder}'s` : "a"} Ramp card`, meta: { area: "ramp", cardId, suspended } });
  return { ok: true };
}
