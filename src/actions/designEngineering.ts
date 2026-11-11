"use server";

// THE ENGINEERING REQUEST'S SERVER SIDE (Home Design Studio, milestone 5 — 2026-10-17). lib/design/engineering builds
// the request; here it is kept (SyncState `designeng:<token>`), sent to the engineer by email with its link, read back
// by the studio, and answered by the engineer from the link — the one public action, keyed by the token alone and
// rate-limited, writing nothing but the answer.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { isLimitedRole, requireOrg } from "@/lib/orgContext";
import { canUseDesignStudio } from "@/lib/design/access";
import { normalizeDesign } from "@/lib/design/normalize";
import { buildRequest, engKey, ENG_TOKEN_RE, parseRequest, type EngAnswer, type EngRequest } from "@/lib/design/engineering";
import { appBaseUrl } from "@/lib/appUrl";
import { sendEmail } from "@/lib/sdk/resend";
import { clientIp, enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { logServerError } from "@/lib/server-events";

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) return { ok: false, error: "The design studio isn't open to this role." };
    if (!(await canUseDesignStudio(ctx.user))) return { ok: false, error: "The design studio is in preview for admins." };
    return { ok: true, organizationId: ctx.organizationId, userId: ctx.user.id };
  } catch {
    return { ok: false, error: "Sign in again to use the design studio." };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const sendSchema = z.object({
  designId: z.string().max(64).nullable(),
  doc: z.unknown(),
  to: z.string().trim().email().max(200),
  note: z.string().trim().max(2000).optional(),
});

/** Freeze the changes that are the engineer's into a request, keep it, and email the engineer its link. */
export async function sendEngineeringRequest(raw: unknown): Promise<{ ok: true; token: string; url: string; sentAt: string; emailed: boolean } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = sendSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === "to" ? "That email address doesn't look right." : "The request didn't validate." };
  try {
    await enforceRateLimit(`design-eng:${g.organizationId}`, 20, HOUR, "engineering requests");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many requests." };
  }
  const { designId, to, note } = parsed.data;
  try {
    const doc = normalizeDesign(parsed.data.doc);
    const [org, user] = await Promise.all([
      db.organization.findUnique({ where: { id: g.organizationId }, select: { name: true, phone: true } }),
      db.user.findUnique({ where: { id: g.userId }, select: { name: true, email: true } }),
    ]);
    const token = randomBytes(18).toString("base64url");
    const sentAt = new Date().toISOString();
    const req = buildRequest(doc, { token, orgId: g.organizationId, designId, to, note, at: sentAt, from: { company: org?.name ?? "Your contractor", person: user?.name ?? null, email: user?.email ?? null, phone: org?.phone ?? null } });
    if (!req) return { ok: false, error: "Nothing in the design is for an engineer: no bearing wall or outside-wall opening changed." };
    const cursor = JSON.stringify(req);
    if (cursor.length > 900_000) return { ok: false, error: "The plan is too large to send — trim it to the part being changed." };
    await db.syncState.upsert({ where: { key: engKey(token) }, create: { key: engKey(token), cursor }, update: { cursor } });
    const url = `${await appBaseUrl()}/engineering/${token}`;
    const company = req.from.company;
    const rows = req.changes.map((c) => `<li style="margin:0 0 6px"><b>${c.n}. ${esc(c.title)}</b> — ${esc(c.why)}</li>`).join("");
    const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:620px">
<p>${esc(company)} asks for a structural review${req.address ? ` at <b>${esc(req.address)}</b>` : ""}.</p>
${note ? `<p style="background:#f4f4f2;padding:10px 12px;border-radius:4px">${esc(note)}</p>` : ""}
<ol style="padding-left:18px">${rows}</ol>
<p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:700">Open the request — the plan, each change and its questions</a></p>
<p style="color:#555;font-size:13px">You can answer each question on that page; your answer goes straight back to ${esc(company)}. Reply to this email to reach ${esc(req.from.person ?? company)} directly.</p>
</div>`;
    const text = `${company} asks for a structural review${req.address ? ` at ${req.address}` : ""}.\n\n${note ? `${note}\n\n` : ""}${req.changes.map((c) => `${c.n}. ${c.title} — ${c.why}`).join("\n")}\n\nOpen the request (the plan, each change and its questions): ${url}`;
    let emailed = true;
    try {
      await sendEmail({ mailClass: "transactional", to, subject: `Structural review request — ${req.address ?? req.title}`, html, text, ...(req.from.email ? { replyTo: req.from.email } : {}) });
    } catch (err) {
      emailed = false;
      logServerError("design-eng-email", err, { kind: "action", organizationId: g.organizationId });
    }
    return { ok: true, token, url, sentAt, emailed };
  } catch (err) {
    logServerError("design-eng-send", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The request could not be saved. Try again in a moment." };
  }
}

/** The studio reads its request back: seen, answered, and the engineer's answers. */
export async function readEngineeringRequest(token: string): Promise<{ ok: true; seenAt: string | null; answer: EngAnswer | null; url: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!ENG_TOKEN_RE.test(token)) return { ok: false, error: "Unknown request." };
  const row = await db.syncState.findUnique({ where: { key: engKey(token) }, select: { cursor: true } }).catch(() => null);
  const req = parseRequest(row?.cursor);
  if (!req || req.orgId !== g.organizationId) return { ok: false, error: "Unknown request." };
  return { ok: true, seenAt: req.seenAt ?? null, answer: req.answer ?? null, url: `${await appBaseUrl()}/engineering/${token}` };
}

const answerSchema = z.object({
  by: z.string().trim().min(2).max(120),
  license: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(4000).optional(),
  perChange: z.record(z.string().max(80), z.string().trim().max(4000)),
});

/** The engineer answers, from the link (public: the token is the key). */
export async function answerEngineeringRequest(token: string, raw: unknown): Promise<{ ok: true; at: string } | { ok: false; error: string }> {
  if (!ENG_TOKEN_RE.test(String(token))) return { ok: false, error: "This link isn't valid." };
  try {
    await enforceRateLimit(`design-eng-answer:${await clientIp()}`, 12, HOUR, "answers");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Too many answers." };
  }
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === "by" ? "Add your name." : parsed.error.issues[0]?.path[0] === "email" ? "That email address doesn't look right." : "The answer didn't validate." };
  const row = await db.syncState.findUnique({ where: { key: engKey(token) }, select: { cursor: true } }).catch(() => null);
  const req = parseRequest(row?.cursor);
  if (!req) return { ok: false, error: "This request is no longer here." };
  const ids = new Set(req.changes.map((c) => c.id));
  const perChange: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data.perChange)) if (ids.has(k) && v) perChange[k] = v;
  if (!Object.keys(perChange).length && !parsed.data.note) return { ok: false, error: "Answer at least one question, or add a note." };
  const at = new Date().toISOString();
  const answer: EngAnswer = { by: parsed.data.by, ...(parsed.data.license ? { license: parsed.data.license } : {}), ...(parsed.data.email ? { email: parsed.data.email } : {}), ...(parsed.data.note ? { note: parsed.data.note } : {}), perChange, at };
  const next: EngRequest = { ...req, answer };
  await db.syncState.update({ where: { key: engKey(token) }, data: { cursor: JSON.stringify(next) } });
  // The contractor hears at once.
  if (req.from.email) {
    try {
      const url = `${await appBaseUrl()}/dashboard/design-studio${req.designId ? `?design=${encodeURIComponent(req.designId)}` : ""}`;
      await sendEmail({ mailClass: "transactional",
        to: req.from.email,
        subject: `${answer.by} answered your structural review — ${req.address ?? req.title}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:620px"><p><b>${esc(answer.by)}</b>${answer.license ? ` (${esc(answer.license)})` : ""} answered.</p><ol style="padding-left:18px">${req.changes.map((c) => `<li style="margin:0 0 8px"><b>${esc(c.title)}</b><br>${esc(perChange[c.id] ?? "—")}</li>`).join("")}</ol>${answer.note ? `<p>${esc(answer.note)}</p>` : ""}<p><a href="${url}">Open the design</a></p></div>`,
        text: `${answer.by} answered.\n\n${req.changes.map((c) => `${c.title}: ${perChange[c.id] ?? "—"}`).join("\n")}${answer.note ? `\n\n${answer.note}` : ""}\n\n${url}`,
        ...(answer.email ? { replyTo: answer.email } : {}),
      });
    } catch (err) {
      logServerError("design-eng-answer-email", err, { kind: "action", organizationId: req.orgId });
    }
  }
  return { ok: true, at };
}
