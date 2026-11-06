"use server";

// THE LAWN & LANDSCAPE ESTIMATOR'S SERVER SIDE (2026-10-18 — owner: "a landscaper types the client's address and
// sees how much grass to service … estimate it and keep them on a service plan"; admin preview).
//   readLawnProperty — the address → the lot, the USDA aerial photo, every pixel classed, the slope (lib/lawn/read).
//   saveLawnDraft / listLawnDrafts / loadLawnDraft / deleteLawnDraft — SyncState `lawndraft:<org>:<id>`, at most 60.
//   readLawnSettings / saveLawnSettings — the company's lawn rates, SyncState `lawnsettings:<org>`.
//   findLawnClients — the client picker.
//   convertLawnToProposal — the priced yard → a draft proposal (trade "lawn"), the yard riding along as an activity.
//   createLawnPlan — the season's calendar → a service plan for the client (trade "lawn", billed monthly), its visits
//     kept beside it for the plan engine to book; sent to the client to accept when asked.
//   loadRouteWeek / balanceMowingDays / rainDelay — the route days: a week's lawn visits in driving order, the yards
//     given a mowing weekday by where they are, a rained-out day pushed to the next.
import { cleanShapes } from "@/lib/lawn/shapes";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE } from "@/lib/planLimits";
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { logServerError } from "@/lib/server-events";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { readProperty, ReadError } from "@/lib/lawn/read";
import type { LawnSite } from "@/lib/lawn/site";
import { cleanLawnSettings, cleanOptions, DEFAULT_LAWN_SETTINGS, type LawnSettings, type ServiceOptions } from "@/lib/lawn/pricing";
import { toSchedule, type PlanVisit } from "@/lib/lawn/calendar";
import { readLawnSchedule, writeLawnSchedule } from "@/lib/lawn/planStore";
import { balanceDays, driveMinutes, nextWorkday, onWeekday, orderStops } from "@/lib/lawn/routes";
import { atLocalHour } from "@/lib/servicePlans";
import { geocodePlace } from "@/lib/maps";
import { censusGeocode } from "@/lib/hvac/publicGeo";
import { sendPlan } from "@/lib/servicePlanBook";
import { lawnConvertSchema, writeLawnProposal } from "@/lib/lawn/proposalWrite";

type Gate = { ok: true; organizationId: string; userId: string; role: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The lawn estimator isn't open to this role." };
    if (!(await canUseLawnEstimator(ctx.user))) return { ok: false, error: "The lawn estimator is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id, role: String(ctx.role) };
  } catch {
    return { ok: false, error: "Sign in again to use the lawn estimator." };
  }
}

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** The address (or a point, or the contractor's own lot line) → the property read. */
export async function readLawnProperty(raw: unknown): Promise<{ ok: true; site: LawnSite } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = z.object({ address: z.string().max(300).optional(), lat: z.number().optional(), lng: z.number().optional(), ring: z.array(latLng).min(3).max(400).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That address couldn't be read." };
  try {
    await enforceRateLimit(`lawn-read:${g.organizationId}`, 80, HOUR, "property reads");
    const site = await readProperty(parsed.data);
    return { ok: true, site };
  } catch (err) {
    if (err instanceof ReadError) return { ok: false, error: err.message };
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    logServerError("lawn-read", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The aerial photo couldn't be read right now — try again in a minute." };
  }
}

/* ── Drafts ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const PREFIX = "lawndraft:";
const DRAFT_MAX = 60;
const draftKey = (org: string, id: string) => `${PREFIX}${org}:${id}`;

export type LawnDraft = {
  site: LawnSite;
  options: ServiceOptions;
  /** The services ticked for the estimate. */
  picked: string[];
  clientId: string | null;
  title: string;
};
export type LawnDraftRow = { id: string; title: string; address: string; updatedAt: string; by: string | null; lawnSqft: number | null };
type StoredDraft = { v: 1; updatedAt: string; by: string | null; lawnSqft: number | null; draft: LawnDraft };

function readStored(cursor: string): StoredDraft | null {
  try {
    const o = JSON.parse(cursor) as StoredDraft;
    return o && o.v === 1 && o.draft?.site?.v === 1 ? o : null;
  } catch {
    return null;
  }
}

function cleanDraft(raw: unknown): LawnDraft | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const site = o?.site as LawnSite | undefined;
  if (!site || site.v !== 1 || typeof site.labels !== "string" || !site.grid || !Array.isArray(site.lot?.ring)) return null;
  if (site.labels.length > 2_000_000) return null;
  return {
    site: { ...site, shapes: cleanShapes(site.shapes) },
    options: cleanOptions(o?.options),
    picked: Array.isArray(o?.picked) ? (o!.picked as unknown[]).filter((x): x is string => typeof x === "string" && x.length < 40).slice(0, 30) : [],
    clientId: typeof o?.clientId === "string" && o.clientId.length < 64 ? o.clientId : null,
    title: typeof o?.title === "string" ? o.title.trim().slice(0, 160) : "",
  };
}

export async function saveLawnDraft(input: { id?: string | null; draft: unknown; lawnSqft?: number | null }): Promise<{ ok: true; id: string; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const draft = cleanDraft(input.draft);
  if (!draft) return { ok: false, error: "There's nothing to save yet." };
  const id = input.id && /^[a-f0-9-]{8,40}$/i.test(input.id) ? input.id : randomUUID();
  const updatedAt = new Date().toISOString();
  const who = await db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }).catch(() => null);
  const body = JSON.stringify({ v: 1, updatedAt, by: who?.name ?? who?.email ?? null, lawnSqft: Number.isFinite(input.lawnSqft) ? Math.round(Number(input.lawnSqft)) : null, draft } satisfies StoredDraft);
  try {
    const key = draftKey(g.organizationId, id);
    const exists = await db.syncState.findUnique({ where: { key }, select: { key: true } });
    if (!exists) {
      const all = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
      if (all.length >= DRAFT_MAX) {
        const oldest = all.map((r) => ({ key: r.key, at: readStored(r.cursor)?.updatedAt ?? "" })).sort((a, b) => a.at.localeCompare(b.at))[0];
        if (oldest) await db.syncState.delete({ where: { key: oldest.key } }).catch(() => {});
      }
    }
    await db.syncState.upsert({ where: { key }, create: { key, cursor: body }, update: { cursor: body } });
    return { ok: true, id, updatedAt };
  } catch (err) {
    logServerError("lawn-save", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The estimate could not be saved — it's still on this page; try again in a moment." };
  }
}

export async function listLawnDrafts(): Promise<{ ok: true; drafts: LawnDraftRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const rows = await db.syncState.findMany({ where: { key: { startsWith: `${PREFIX}${g.organizationId}:` } }, select: { key: true, cursor: true } });
    const drafts = rows
      .map((r) => {
        const s = readStored(r.cursor);
        return s ? { id: r.key.slice(`${PREFIX}${g.organizationId}:`.length), title: s.draft.title || s.draft.site.address, address: s.draft.site.address, updatedAt: s.updatedAt, by: s.by, lawnSqft: s.lawnSqft } : null;
      })
      .filter((d): d is LawnDraftRow => !!d)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, drafts };
  } catch (err) {
    logServerError("lawn-list", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your lawn estimates could not be listed right now." };
  }
}

export async function loadLawnDraft(id: string): Promise<{ ok: true; id: string; draft: LawnDraft; updatedAt: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That estimate was not found." };
  const row = await db.syncState.findUnique({ where: { key: draftKey(g.organizationId, id) }, select: { cursor: true } }).catch(() => null);
  const s = row ? readStored(row.cursor) : null;
  if (!s) return { ok: false, error: "That estimate was not found." };
  return { ok: true, id, draft: s.draft, updatedAt: s.updatedAt };
}

export async function deleteLawnDraft(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^[a-f0-9-]{8,40}$/i.test(id)) return { ok: false, error: "That estimate was not found." };
  await db.syncState.deleteMany({ where: { key: draftKey(g.organizationId, id) } }).catch(() => {});
  return { ok: true };
}

/* ── The company's lawn rates ────────────────────────────────────────────────────────────────────────────────── */

const settingsKey = (org: string) => `lawnsettings:${org}`;

export async function readLawnSettings(): Promise<{ ok: true; settings: LawnSettings; own: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await db.syncState.findUnique({ where: { key: settingsKey(g.organizationId) }, select: { cursor: true } }).catch(() => null);
  if (!row) return { ok: true, settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  try {
    return { ok: true, settings: cleanLawnSettings(JSON.parse(row.cursor)), own: true };
  } catch {
    return { ok: true, settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  }
}

export async function saveLawnSettings(raw: unknown): Promise<{ ok: true; settings: LawnSettings } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const settings = cleanLawnSettings(raw);
  try {
    const cursor = JSON.stringify(settings);
    await db.syncState.upsert({ where: { key: settingsKey(g.organizationId) }, create: { key: settingsKey(g.organizationId), cursor }, update: { cursor } });
    return { ok: true, settings };
  } catch (err) {
    logServerError("lawn-settings", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "Your rates could not be saved — try again in a moment." };
  }
}

/* ── Clients ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export type LawnClient = { id: string; name: string; email: string | null; phone: string | null; address: string | null };

export async function findLawnClients(q: string): Promise<{ ok: true; clients: LawnClient[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const t = q.trim().slice(0, 80);
  const select = { id: true, name: true, email: true, phone: true, address: true } as const;
  const where = t
    ? { organizationId: g.organizationId, deletedAt: null, OR: [{ name: { contains: t, mode: "insensitive" as const } }, { email: { contains: t, mode: "insensitive" as const } }, { phone: { contains: t } }, { address: { contains: t, mode: "insensitive" as const } }] }
    : { organizationId: g.organizationId, deletedAt: null };
  try {
    const rows = await db.client.findMany({ where, select, orderBy: { updatedAt: "desc" }, take: 8 });
    return { ok: true, clients: rows };
  } catch {
    // SQLite (the stand) has no case-insensitive mode.
    const rows = await db.client.findMany({ where: { organizationId: g.organizationId, deletedAt: null, ...(t ? { OR: [{ name: { contains: t } }, { email: { contains: t } }, { phone: { contains: t } }, { address: { contains: t } }] } : {}) }, select, orderBy: { updatedAt: "desc" }, take: 8 }).catch(() => []);
    return { ok: true, clients: rows };
  }
}

/* ── The proposal ────────────────────────────────────────────────────────────────────────────────────────────── */

// The line and convert schemas and the proposal itself live in lib/lawn/proposalWrite (2026-11-05), shared with the AI Operator.

export async function convertLawnToProposal(raw: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const quota = await checkPlanLimit(g.organizationId, "proposalsCreated");
  if (!quota.allowed) return { ok: false, code: "PLAN_LIMIT_REACHED", error: PLAN_LIMIT_MESSAGE };
  const parsed = lawnConvertSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `The estimate didn't validate — ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim() };
  const data = parsed.data;
  try {
    // Started from a project, a client's page or a lead, the picker recorded where this estimate files (lib/filingContext).
    const filing = await readFilingContext(g.organizationId);
    const id = await writeLawnProposal({ organizationId: g.organizationId, userId: g.userId, role: g.role }, data, filing);
    if (filing) await clearFilingContext();
    return { ok: true, id };
  } catch (err) {
    logServerError("lawn-convert", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The proposal could not be saved. Try again in a moment." };
  }
}

/* ── The service plan ────────────────────────────────────────────────────────────────────────────────────────── */

const visitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service: z.string().max(40),
  label: z.string().trim().min(1).max(120),
  minutes: z.number().int().min(5).max(1440),
  price: z.number().min(0).max(1_000_000),
  checklist: z.array(z.string().max(300)).max(12),
});
const planSchema = z.object({
  clientId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(600).default(""),
  address: z.string().max(300).nullable().optional(),
  monthly: z.number().min(0).max(100_000),
  visits: z.array(visitSchema).min(1).max(120),
  benefits: z.array(z.string().max(200)).max(20).default([]),
  send: z.boolean().default(false),
  place: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
});

/** The season → a service plan: monthly billing at a twelfth of the season, every visit booked when it starts. */
export async function createLawnPlan(raw: unknown): Promise<{ ok: true; planId: string; sent: boolean; emailed: boolean; acceptHref: string | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `The plan didn't validate — ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim() };
  const d = parsed.data;
  try {
    const client = await db.client.findFirst({ where: { id: d.clientId, organizationId: g.organizationId, deletedAt: null }, select: { id: true, name: true } });
    if (!client) return { ok: false, error: "Pick the client first." };
    const plan = await db.servicePlan.create({
      data: {
        organizationId: g.organizationId,
        clientId: client.id,
        status: "DRAFT",
        name: d.name,
        description: d.description || null,
        trade: "lawn",
        visitsPerYear: d.visits.length,
        termMonths: 12,
        priceCents: Math.round(d.monthly * 100),
        billing: "MONTHLY",
        discountPct: 0,
        benefitsJson: JSON.stringify(d.benefits),
        priorityScheduling: true,
        waivedDiagnostic: false,
        propertyAddress: d.address?.trim() || null,
      },
    });
    await writeLawnSchedule(plan.id, toSchedule(d.visits as PlanVisit[], d.place ? { lat: d.place.lat, lng: d.place.lng, address: d.address?.trim() || null } : null));
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, summary: `Put ${client.name} on a lawn plan — ${d.visits.length} visits, $${Math.round(d.monthly).toLocaleString("en-US")} a month`, meta: { trade: "lawn", planId: plan.id } }).catch(() => {});
    let sent = false;
    let emailed = false;
    let acceptHref: string | null = null;
    if (d.send) {
      const r = await sendPlan(plan.id, g.userId);
      sent = r.ok;
      emailed = r.emailed;
      acceptHref = r.href || null;
    }
    revalidatePath("/dashboard/service-plans");
    return { ok: true, planId: plan.id, sent, emailed, acceptHref };
  } catch (err) {
    logServerError("lawn-plan", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The plan could not be saved. Try again in a moment." };
  }
}

/* ── Route days ──────────────────────────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 86400000;
const localDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Where the crew starts: the shop's address, geocoded once and kept. */
async function shopAt(organizationId: string): Promise<{ lat: number; lng: number } | null> {
  const key = `lawnshop:${organizationId}`;
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } }).catch(() => null);
  if (row) {
    try {
      const p = JSON.parse(row.cursor) as { lat?: number; lng?: number; address?: string };
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { lat: p.lat!, lng: p.lng! };
    } catch {
      /* look it up again */
    }
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } });
  const a = org?.address?.trim();
  if (!a) return null;
  const g = (await geocodePlace(a).catch(() => null)) ?? (await censusGeocode(a).catch(() => null));
  if (!g) return null;
  await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify({ lat: g.lat, lng: g.lng, address: a }) }, update: { cursor: JSON.stringify({ lat: g.lat, lng: g.lng, address: a }) } }).catch(() => {});
  return { lat: g.lat, lng: g.lng };
}

export type RouteStop = { visitId: string; appointmentId: string; client: string; phone: string | null; address: string | null; label: string; minutes: number; startsAt: string; driveFromPrev: number; located: boolean };
export type RouteDay = { date: string; stops: RouteStop[]; driveMinutes: number; crewMinutes: number };

async function lawnPlans(organizationId: string) {
  const plans = await db.servicePlan.findMany({ where: { organizationId, trade: "lawn", status: "ACTIVE" }, select: { id: true, name: true, propertyAddress: true, client: { select: { name: true, phone: true } } } });
  const places = new Map<string, { lat: number; lng: number } | null>();
  for (const p of plans) places.set(p.id, (await readLawnSchedule(p.id))?.place ?? null);
  return { plans, places };
}

/** The week's lawn visits, day by day, each day in driving order from the shop. */
export async function loadRouteWeek(input: { weekStart: string }): Promise<{ ok: true; days: RouteDay[]; plans: number; unlocated: number; shop: boolean; timeZone: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)) return { ok: false, error: "That week couldn't be read." };
  try {
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { timezone: true } });
    const tz = org?.timezone || "America/New_York";
    const from = atLocalHour(new Date(`${input.weekStart}T00:00:00Z`), 0, tz);
    const to = new Date(from.getTime() + 7 * DAY_MS);
    const { plans, places } = await lawnPlans(g.organizationId);
    const byPlan = new Map(plans.map((p) => [p.id, p]));
    const visits = plans.length
      ? await db.servicePlanVisit.findMany({ where: { planId: { in: plans.map((p) => p.id) }, status: "SCHEDULED", appointment: { startsAt: { gte: from, lt: to }, status: { not: "CANCELED" } } }, select: { id: true, planId: true, label: true, appointment: { select: { id: true, startsAt: true, endsAt: true } } } })
      : [];
    const shop = await shopAt(g.organizationId);
    const groups = new Map<string, typeof visits>();
    for (const v of visits) {
      if (!v.appointment) continue;
      const k = localDay(v.appointment.startsAt, tz);
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    const days: RouteDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = localDay(new Date(from.getTime() + i * DAY_MS + 12 * 3600000), tz);
      const list = groups.get(date) ?? [];
      const stops = list.map((v) => {
        const p = byPlan.get(v.planId)!;
        const at = places.get(v.planId) ?? null;
        return { id: v.id, at: at ?? { lat: 0, lng: 0 }, located: !!at, minutes: Math.round((v.appointment!.endsAt.getTime() - v.appointment!.startsAt.getTime()) / 60000), v, p };
      });
      const located = stops.filter((s) => s.located);
      const { order, driveMinutes: drive } = orderStops(shop, located);
      const all = [...order, ...stops.filter((s) => !s.located)];
      let prev = shop;
      days.push({
        date,
        driveMinutes: drive,
        crewMinutes: all.reduce((a, s) => a + s.minutes, 0),
        stops: all.map((s) => {
          const d = s.located && prev ? driveMinutes(prev, s.at) : 0;
          if (s.located) prev = s.at;
          return { visitId: s.v.id, appointmentId: s.v.appointment!.id, client: s.p.client.name, phone: s.p.client.phone, address: s.p.propertyAddress, label: s.v.label, minutes: s.minutes, startsAt: s.v.appointment!.startsAt.toISOString(), driveFromPrev: d, located: s.located };
        }),
      });
    }
    return { ok: true, days, plans: plans.length, unlocated: [...places.values()].filter((x) => !x).length, shop: !!shop, timeZone: tz };
  } catch (err) {
    logServerError("lawn-routes", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The route days couldn't be read right now." };
  }
}

/** Re-time one local day's lawn visits along their route: the first at `startHour`, each after the last plus the drive. */
async function retimeDay(organizationId: string, date: string, tz: string, shop: { lat: number; lng: number } | null, places: Map<string, { lat: number; lng: number } | null>, startHour: number) {
  const from = atLocalHour(new Date(`${date}T00:00:00Z`), 0, tz);
  const to = new Date(from.getTime() + DAY_MS);
  const visits = await db.servicePlanVisit.findMany({ where: { organizationId, status: "SCHEDULED", plan: { trade: "lawn", status: "ACTIVE" }, appointment: { startsAt: { gte: from, lt: to }, status: { not: "CANCELED" } } }, select: { id: true, planId: true, appointment: { select: { id: true, startsAt: true, endsAt: true } } } });
  const stops = visits.filter((v) => v.appointment && places.get(v.planId)).map((v) => ({ id: v.id, at: places.get(v.planId)!, minutes: Math.round((v.appointment!.endsAt.getTime() - v.appointment!.startsAt.getTime()) / 60000), v }));
  const { order } = orderStops(shop, stops);
  let t = atLocalHour(new Date(`${date}T00:00:00Z`), startHour, tz).getTime();
  let prev = shop;
  for (const s of order) {
    if (prev) t += driveMinutes(prev, s.at) * 60000;
    prev = s.at;
    const start = new Date(t);
    const end = new Date(t + s.minutes * 60000);
    await db.appointment.update({ where: { id: s.v.appointment!.id }, data: { startsAt: start, endsAt: end } });
    await db.servicePlanVisit.update({ where: { id: s.v.id }, data: { dueAt: start } });
    t = end.getTime();
  }
}

/** Every yard on the plans gets a mowing weekday by where it is — nearby yards on the same day, the days about even —
 *  and its coming mowings move to that weekday of their own week, re-timed along the route. */
export async function balanceMowingDays(input: { days?: number; startHour?: number }): Promise<{ ok: true; moved: number; perDay: Array<{ weekday: number; yards: number; minutes: number }> } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const days = Math.max(1, Math.min(6, Math.round(input.days ?? 5)));
  const startHour = Math.max(5, Math.min(11, Math.round(input.startHour ?? 8)));
  try {
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { timezone: true } });
    const tz = org?.timezone || "America/New_York";
    const { plans, places } = await lawnPlans(g.organizationId);
    const located = plans.filter((p) => places.get(p.id));
    if (!located.length) return { ok: false, error: "No lawn plan has its property's location yet — plans made from the lawn estimator carry it." };
    const now = new Date();
    const mows = await db.servicePlanVisit.findMany({ where: { planId: { in: located.map((p) => p.id) }, status: "SCHEDULED", dueAt: { gt: now }, label: { startsWith: "Mow" } }, select: { id: true, planId: true, dueAt: true, appointment: { select: { id: true, startsAt: true, endsAt: true } } } });
    const minutesOf = new Map<string, number>();
    for (const v of mows) if (v.appointment && !minutesOf.has(v.planId)) minutesOf.set(v.planId, Math.round((v.appointment.endsAt.getTime() - v.appointment.startsAt.getTime()) / 60000));
    const stops = located.map((p) => ({ id: p.id, at: places.get(p.id)!, minutes: minutesOf.get(p.id) ?? 45 }));
    // As few days as the work fills (seven hours on site and driving a day, driving about a quarter on top), never more
    // than the crew mows — six small yards are one day's route, not one a day.
    const total = stops.reduce((a, x) => a + x.minutes, 0);
    const routeDays = Math.max(1, Math.min(days, Math.ceil((total * 1.25) / 420)));
    const dayOf = balanceDays(stops, routeDays);
    const touched = new Set<string>();
    let moved = 0;
    for (const v of mows) {
      if (!v.appointment) continue;
      const weekday = (dayOf.get(v.planId) ?? 0) + 1;
      let target = onWeekday(new Date(`${localDay(v.appointment.startsAt, tz)}T00:00:00Z`), weekday);
      if (target.getTime() < now.getTime() - DAY_MS) target = new Date(target.getTime() + 7 * DAY_MS);
      const date = target.toISOString().slice(0, 10);
      const start = atLocalHour(target, startHour, tz);
      const len = v.appointment.endsAt.getTime() - v.appointment.startsAt.getTime();
      if (localDay(v.appointment.startsAt, tz) !== date) moved++;
      await db.appointment.update({ where: { id: v.appointment.id }, data: { startsAt: start, endsAt: new Date(start.getTime() + len) } });
      await db.servicePlanVisit.update({ where: { id: v.id }, data: { dueAt: start } });
      touched.add(date);
    }
    const shop = await shopAt(g.organizationId);
    for (const date of touched) await retimeDay(g.organizationId, date, tz, shop, places, startHour);
    const perDay = Array.from({ length: routeDays }, (_, i) => ({ weekday: i + 1, yards: stops.filter((s) => dayOf.get(s.id) === i).length, minutes: stops.filter((s) => dayOf.get(s.id) === i).reduce((a, s) => a + s.minutes, 0) }));
    await logActivity({ organizationId: g.organizationId, actorId: g.userId, kind: TRAIL_KINDS.ESTIMATE, summary: `Balanced the mowing days — ${located.length} yards over ${days} days, ${moved} mowings moved`, meta: { trade: "lawn" } }).catch(() => {});
    revalidatePath("/dashboard/calendar");
    return { ok: true, moved, perDay };
  } catch (err) {
    logServerError("lawn-balance", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The mowing days couldn't be balanced right now." };
  }
}

/** Rained out: the day's lawn visits move to the next working day, after that day's own route. */
export async function rainDelay(input: { date: string }): Promise<{ ok: true; moved: number; to: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "That day couldn't be read." };
  try {
    const org = await db.organization.findUnique({ where: { id: g.organizationId }, select: { timezone: true } });
    const tz = org?.timezone || "America/New_York";
    const from = atLocalHour(new Date(`${input.date}T00:00:00Z`), 0, tz);
    const visits = await db.servicePlanVisit.findMany({ where: { organizationId: g.organizationId, status: "SCHEDULED", plan: { trade: "lawn", status: "ACTIVE" }, appointment: { startsAt: { gte: from, lt: new Date(from.getTime() + DAY_MS) }, status: { not: "CANCELED" } } }, select: { id: true, appointment: { select: { id: true, startsAt: true, endsAt: true } } } });
    const toDay = nextWorkday(new Date(`${input.date}T00:00:00Z`));
    const to = toDay.toISOString().slice(0, 10);
    for (const v of visits) {
      if (!v.appointment) continue;
      const shift = toDay.getTime() - new Date(`${input.date}T00:00:00Z`).getTime();
      await db.appointment.update({ where: { id: v.appointment.id }, data: { startsAt: new Date(v.appointment.startsAt.getTime() + shift), endsAt: new Date(v.appointment.endsAt.getTime() + shift) } });
      await db.servicePlanVisit.update({ where: { id: v.id }, data: { dueAt: new Date(v.appointment.startsAt.getTime() + shift) } });
    }
    const { places } = await lawnPlans(g.organizationId);
    await retimeDay(g.organizationId, to, tz, await shopAt(g.organizationId), places, 8);
    revalidatePath("/dashboard/calendar");
    return { ok: true, moved: visits.length, to };
  } catch (err) {
    logServerError("lawn-rain", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The day couldn't be moved right now." };
  }
}
