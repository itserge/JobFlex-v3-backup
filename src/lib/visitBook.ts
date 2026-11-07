// EQUIPMENT ON FILE AND THE VISIT REPORT — THE BOOK (2026-09-23), server
// only. The rules live in lib/equipment; this is what touches the database:
// a home's units, filed by hand, off a nameplate, by the HVAC estimator or
// by the crew; and the tune-up report the crew writes on a visit, sent to
// the client and readable on a public page.

import { db } from "@/lib/db";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { appBaseUrl } from "@/lib/appUrl";
import { equipmentAdvice, equipmentLine, readingFieldsFor, readingFindings, reportSummary, sortFindings, visitKindFromTitle, type EquipmentKind, type Finding, type VisitKind } from "@/lib/equipment";

const ORG_SELECT = { id: true, name: true, slug: true, timezone: true, logoUrl: true, gmailSettingsJson: true, gmailTokensJson: true, billingEmail: true, phone: true } as const;

/**
 * The HVAC estimator's "existing system" becomes the client's unit on file
 * when an estimate converts (actions/hvacEstimator). One row per kind per
 * client from this source; a row the office typed is never overwritten.
 */
export async function fileEquipmentFromModel(organizationId: string, clientId: string, existing: { kind?: string; tons?: number; fuel?: string; refrigerant?: string; yearMade?: number; brand?: string; model?: string } | null | undefined): Promise<boolean> {
  if (!existing || !existing.kind || existing.kind === "none") return false;
  const kind = existing.kind as EquipmentKind;
  const had = await db.clientEquipment.findFirst({ where: { organizationId, clientId, kind }, select: { id: true, source: true } });
  const data = { kind, tons: existing.tons ?? null, fuel: existing.fuel ?? null, refrigerant: existing.refrigerant ?? null, yearMade: existing.yearMade ?? null, brand: existing.brand ?? null, model: existing.model ?? null };
  if (had) {
    if (had.source !== "estimator") return false;
    await db.clientEquipment.update({ where: { id: had.id }, data });
    return true;
  }
  await db.clientEquipment.create({ data: { ...data, organizationId, clientId, source: "estimator", label: "From the HVAC estimate" } });
  return true;
}

// ── the visit ───────────────────────────────────────────────────────────────

export interface VisitView {
  appointment: { id: string; title: string; startsAt: Date; endsAt: Date; status: string; notes: string | null };
  client: { id: string; name: string; email: string | null; phone: string | null; address: string } | null;
  equipment: Array<{ id: string; line: string; advice: string | null; filterSize: string | null; kind: string }>;
  planVisit: { id: string; label: string; planName: string; status: string } | null;
  report: { id: string; techName: string | null; kind: VisitKind; readings: Record<string, string>; findings: Finding[]; recommendations: string | null; summary: string | null; publicToken: string; sentAt: Date | null } | null;
  kind: VisitKind;
  timeZone: string;
}

export async function loadVisit(appointmentId: string, organizationId: string): Promise<VisitView | null> {
  const a = await db.appointment.findFirst({
    where: { id: appointmentId, organizationId },
    include: { client: true, lead: { select: { name: true, email: true, phone: true, address: true, city: true, state: true } }, planVisit: { include: { plan: { select: { name: true } } } }, report: true, organization: { select: { timezone: true } } },
  });
  if (!a) return null;
  const equipment = a.clientId ? await db.clientEquipment.findMany({ where: { organizationId, clientId: a.clientId }, orderBy: { createdAt: "asc" } }) : [];
  const report = a.report;
  const kind: VisitKind = report ? (report.kind as VisitKind) : visitKindFromTitle(a.title);
  const client = a.client
    ? { id: a.client.id, name: a.client.name, email: a.client.email, phone: a.client.phone, address: [a.client.address, a.client.city, a.client.state].filter(Boolean).join(", ") }
    : a.lead
      ? { id: "", name: a.lead.name, email: a.lead.email, phone: a.lead.phone, address: [a.lead.address, a.lead.city, a.lead.state].filter(Boolean).join(", ") }
      : null;
  return {
    appointment: { id: a.id, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status, notes: a.notes },
    client,
    equipment: equipment.map((e) => ({ id: e.id, line: equipmentLine(e), advice: equipmentAdvice(e), filterSize: e.filterSize, kind: e.kind })),
    planVisit: a.planVisit ? { id: a.planVisit.id, label: a.planVisit.label, planName: a.planVisit.plan.name, status: a.planVisit.status } : null,
    report: report
      ? { id: report.id, techName: report.techName, kind: report.kind as VisitKind, readings: parseReadings(report.readingsJson), findings: parseFindings(report.findingsJson), recommendations: report.recommendations, summary: report.summary, publicToken: report.publicToken, sentAt: report.sentAt }
      : null,
    kind,
    timeZone: a.organization.timezone || "America/New_York",
  };
}

const parseReadings = (json: string): Record<string, string> => {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" || typeof x === "number").map(([k, x]) => [k, String(x)]));
  } catch {
    return {};
  }
};
const parseFindings = (json: string): Finding[] => {
  try {
    const v = JSON.parse(json) as unknown[];
    return Array.isArray(v) ? v.filter((f): f is Finding => !!f && typeof (f as Finding).text === "string").map((f) => ({ text: f.text, severity: ["info", "watch", "fix", "urgent"].includes(f.severity) ? f.severity : "info" })) : [];
  } catch {
    return [];
  }
};

/** The tech's lines become findings: "!! text" urgent, "! text" fix, "? text" watch, else info. */
export function findingsFromLines(text: string | null | undefined): Finding[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("!!") ? { text: l.slice(2).trim(), severity: "urgent" as const } : l.startsWith("!") ? { text: l.slice(1).trim(), severity: "fix" as const } : l.startsWith("?") ? { text: l.slice(1).trim(), severity: "watch" as const } : { text: l, severity: "info" as const }))
    .filter((f) => f.text.length > 0);
}

export interface SaveReportInput {
  appointmentId: string;
  organizationId: string;
  techName?: string | null;
  kind: VisitKind;
  readings: Record<string, string>;
  techFindings: string | null;
  recommendations: string | null;
  summary: string | null;
  filterSizeForUnit?: { equipmentId: string; filterSize: string } | null;
}

/** Save (or re-save) the report; the readings' own findings join the tech's. */
export async function saveVisitReport(input: SaveReportInput): Promise<{ id: string; summary: string }> {
  const a = await db.appointment.findFirst({ where: { id: input.appointmentId, organizationId: input.organizationId }, select: { id: true, clientId: true, planVisit: { select: { id: true } } } });
  if (!a) throw new Error("Visit not found");
  const equipment = a.clientId ? await db.clientEquipment.findMany({ where: { organizationId: input.organizationId, clientId: a.clientId }, orderBy: { createdAt: "asc" }, take: 1 }) : [];
  const unit = equipment[0] ?? null;
  const readings = Object.fromEntries(Object.entries(input.readings).filter(([, v]) => v.trim().length).map(([k, v]) => [k, v.trim().slice(0, 80)]));
  const findings = sortFindings([...readingFindings(readings, input.kind), ...findingsFromLines(input.techFindings)]);
  const summary = input.summary?.trim() || reportSummary({ kind: input.kind, findings, equipmentLine: unit ? equipmentLine(unit) : null, advice: unit ? equipmentAdvice(unit) : null });
  const data = { organizationId: input.organizationId, appointmentId: a.id, clientId: a.clientId, planVisitId: a.planVisit?.id ?? null, techName: input.techName?.trim() || null, kind: input.kind, readingsJson: JSON.stringify(readings), findingsJson: JSON.stringify(findings), recommendations: input.recommendations?.trim() || null, summary };
  const row = await db.visitReport.upsert({ where: { appointmentId: a.id }, create: data, update: data, select: { id: true } });
  // A filter size written on the visit goes on the unit, for the next one.
  if (readings.filterSize && unit && !unit.filterSize) {
    const size = readings.filterSize.replace(/,?\s*(replaced|new|changed).*$/i, "").trim();
    if (/\d/.test(size)) await db.clientEquipment.update({ where: { id: unit.id }, data: { filterSize: size.slice(0, 40), source: unit.source } });
  }
  return { id: row.id, summary };
}

/** The report goes to the client (email with the public page); the visit is done. */
/** `actorId`: the tech or office member who sent it; null when nobody is signed in. */
export async function sendVisitReport(appointmentId: string, organizationId: string, actorId?: string | null): Promise<{ ok: boolean; emailed: boolean; href: string }> {
  const a = await db.appointment.findFirst({ where: { id: appointmentId, organizationId }, include: { client: true, lead: { select: { name: true, email: true } }, report: true, planVisit: { select: { id: true } }, organization: { select: ORG_SELECT } } });
  if (!a || !a.report) return { ok: false, emailed: false, href: "" };
  const href = `${await appBaseUrl()}/report/${a.report.publicToken}`;
  const to = a.client?.email ?? a.lead?.email ?? null;
  const name = a.client?.name ?? a.lead?.name ?? "there";
  const findings = parseFindings(a.report.findingsJson);
  const org = a.organization;
  let emailed = false;
  if (to) {
    try {
      const orgName = org.name ?? "Your contractor";
      const doc: EmailDoc = {
        subject: `Your visit report from ${orgName}`,
        lockup: { kind: "org", name: orgName, logoUrl: org.logoUrl, orgId: organizationId },
        kicker: { text: "Visit report", tone: findings.some((f) => f.severity === "urgent") ? "bad" : findings.some((f) => f.severity === "fix") ? "warn" : "ok" },
        headline: a.title,
        prose: [`Hi ${name.split(" ")[0]}, here is what we found on ${a.startsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: org.timezone || "America/New_York" })}.`, a.report.summary ?? ""].filter(Boolean),
        box: findings.slice(0, 6).map((f) => ({ type: "cond" as const, label: f.text.slice(0, 120), chip: f.severity === "urgent" ? "Now" : f.severity === "fix" ? "Repair" : f.severity === "watch" ? "Watch" : "Note", tone: f.severity === "urgent" ? "bad" : f.severity === "fix" ? "warn" : "neutral" })),
        cta: { label: "Read the full report", href },
        after: a.report.recommendations ? [a.report.recommendations] : undefined,
        footer: { name: orgName, contact: org.billingEmail ?? org.phone ?? undefined },
      };
      const { subject, html } = renderEmail(doc);
      const r = await sendOrgEmail(org, { to, subject, html });
      emailed = !!r && (r as { ok?: boolean }).ok !== false;
    } catch (err) {
      console.warn(`[visitBook] report not emailed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await db.$transaction(async (tx) => {
    await tx.visitReport.update({ where: { id: a.report!.id }, data: { sentAt: new Date() } });
    await tx.appointment.update({ where: { id: a.id }, data: { status: "COMPLETED" } });
    if (a.planVisit) await tx.servicePlanVisit.update({ where: { id: a.planVisit.id }, data: { status: "DONE", doneAt: new Date() } });
    await tx.activityEvent.create({ data: { organizationId, actorId: actorId ?? null, kind: "VISIT_REPORT_SENT", clientId: a.clientId, summary: `${name}: visit report sent — ${findings.filter((f) => f.severity === "fix" || f.severity === "urgent").length} repair${findings.filter((f) => f.severity === "fix" || f.severity === "urgent").length === 1 ? "" : "s"} recommended`, meta: JSON.stringify({ href: `/dashboard/visits/${a.id}` }) } });
  });
  return { ok: true, emailed, href };
}

export interface PublicReport {
  orgName: string;
  orgSlug: string;
  orgPhone: string | null;
  orgEmail: string | null;
  clientName: string;
  title: string;
  date: string;
  techName: string | null;
  kind: VisitKind;
  summary: string | null;
  readings: Array<{ label: string; value: string; unit?: string; ok?: [number, number]; off: boolean }>;
  findings: Finding[];
  recommendations: string | null;
  equipment: Array<{ line: string; advice: string | null }>;
  bookingEnabled: boolean;
}

export async function loadPublicReport(token: string): Promise<PublicReport | null> {
  const r = await db.visitReport.findUnique({ where: { publicToken: token }, include: { appointment: { select: { title: true, startsAt: true, lead: { select: { name: true } } } }, client: { select: { name: true, id: true } }, organization: { select: { ...ORG_SELECT, bookingSettingsJson: true } } } });
  if (!r) return null;
  const readings = parseReadings(r.readingsJson);
  const kind = r.kind as VisitKind;
  const fields = readingFieldsFor(kind);
  const rows = Object.entries(readings).map(([key, value]) => {
    const f = fields.find((x) => x.key === key);
    const n = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    const off = !!(f?.ok && Number.isFinite(n) && (n < f.ok[0] || n > f.ok[1]));
    return { label: f?.label ?? key, value, unit: f?.unit, ok: f?.ok, off };
  });
  const equipment = r.client ? await db.clientEquipment.findMany({ where: { organizationId: r.organizationId, clientId: r.client.id }, orderBy: { createdAt: "asc" } }) : [];
  let bookingEnabled = false;
  try {
    bookingEnabled = !r.organization.bookingSettingsJson || (JSON.parse(r.organization.bookingSettingsJson) as { enabled?: boolean }).enabled !== false;
  } catch {
    bookingEnabled = true;
  }
  return {
    orgName: r.organization.name ?? "Your contractor",
    orgSlug: r.organization.slug,
    orgPhone: r.organization.phone,
    orgEmail: r.organization.billingEmail,
    clientName: r.client?.name ?? r.appointment.lead?.name ?? "",
    title: r.appointment.title,
    date: r.appointment.startsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: r.organization.timezone || "America/New_York" }),
    techName: r.techName,
    kind,
    summary: r.summary,
    readings: rows,
    findings: parseFindings(r.findingsJson),
    recommendations: r.recommendations,
    equipment: equipment.map((e) => ({ line: equipmentLine(e), advice: equipmentAdvice(e) })),
    bookingEnabled,
  };
}
