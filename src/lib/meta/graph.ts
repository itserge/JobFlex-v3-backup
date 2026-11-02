import crypto from "node:crypto";
import { z } from "zod";
import { isSecretBoxConfigured } from "@/lib/crypto/secretBox";

// A User-token Facebook Login for Business configuration is required. Never
// request ad/campaign fields: this integration only imports submitted leads.
export const META_LEAD_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "leads_retrieval", "pages_manage_ads", "ads_management"];
export const metaId = z.string().regex(/^\d{1,40}$/);
export const metaPageSchema = z.object({ id: metaId, name: z.string().max(500), access_token: z.string().min(1) });
export const metaLeadSchema = z.object({
  id: metaId,
  created_time: z.string().optional(),
  // Meta omits values for unanswered fields (including optional inbox_url).
  // Keep those fields empty instead of rejecting every lead in the batch.
  field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()).default([]) })).default([]),
  // The form's own consent boxes (Meta's "custom disclaimer"), as the person ticked them — read by the automatic
  // sync for SmartBook (2026-10-31); the import does not ask for them.
  custom_disclaimer_responses: z.array(z.object({ checkbox_key: z.string(), is_checked: z.union([z.boolean(), z.string(), z.number()]).optional() })).optional().catch(undefined),
});
export type MetaLead = z.infer<typeof metaLeadSchema>;

function version() {
  const value = process.env.META_GRAPH_VERSION || "v25.0";
  if (!/^v\d+\.0$/.test(value)) throw new Error("Invalid Meta API version configuration.");
  return value;
}
export function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_LOGIN_CONFIG_ID && process.env.META_REDIRECT_URI && isSecretBoxConfigured());
}
export function metaAllowed(email?: string | null) {
  return metaConfigured() && (process.env.META_LEADS_PUBLIC === "true" || (process.env.META_LEADS_TEST_USERS || "").split(",").map(v => v.trim().toLowerCase()).includes((email || "").toLowerCase()) && Boolean(email));
}
export class MetaApiError extends Error {
  constructor(public code: number, public retryable: boolean) {
    super(code === 190 ? "Meta authorization expired. Disconnect and reconnect your Page." : code === 10 || code === 200 ? "Meta denied lead access. Check app permissions, Page access, and Leads Access in Meta Business settings." : "Meta could not complete the request. Try again and check the app's lead permissions.");
  }
}

// The QA Lab's fake Facebook (qa/walks/smartbook.walk.ts, 2026-10-31): META_GRAPH_BASE, only in QA test mode — the
// lib/qaTestMode gate, read here without the database — and never on Vercel production.
function graphBase() {
  const fake = process.env.META_GRAPH_BASE?.trim();
  const qa = process.env.QA_TEST_MODE === "1" && !!process.env.QA_SECRET && process.env.VERCEL_ENV !== "production";
  return fake && qa ? fake.replace(/\/$/, "") : "https://graph.facebook.com";
}

async function graphRequest(path: string, params: Record<string, string>, token?: string, method = "GET") {
  const url = new URL(`${graphBase()}/${version()}/${path}`);
  const query = new URLSearchParams(params);
  if (token) query.set("appsecret_proof", crypto.createHmac("sha256", process.env.META_APP_SECRET!).update(token).digest("hex"));
  if (method === "GET") url.search = query.toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(method !== "GET" ? { body: query.toString() } : {}),
    });
  } catch { throw new MetaApiError(0, true); }
  // Never log Meta's raw error/request: they can include tokens and lead PII.
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const code = Number(body.error?.code || response.status);
    throw new MetaApiError(code, response.status >= 500 || response.status === 429 || [1, 2, 4, 17, 32, 613].includes(code));
  }
  return body as unknown;
}
export async function metaGraph(path: string, token: string, params: Record<string, string> = {}, method = "GET") {
  return graphRequest(path, params, token, method);
}

export function metaLoginUrl(state: string) {
  const url = new URL(`https://www.facebook.com/${version()}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: process.env.META_REDIRECT_URI!, config_id: process.env.META_LOGIN_CONFIG_ID!, response_type: "code", override_default_response_type: "true", state }).toString();
  return url.toString();
}

export class MetaPageAccessError extends Error {}

// A granted Page ID is a discovery hint, never proof of access by itself.
async function verifiedMetaPage(pageId: string, token: string) {
  try {
    const page = metaPageSchema.parse(await metaGraph(pageId, token, { fields: "id,name,access_token" }));
    if (page.id !== pageId) throw new MetaPageAccessError();
    const identity = z.object({ id: metaId }).parse(await metaGraph("me", page.access_token, { fields: "id" }));
    if (identity.id !== pageId) throw new MetaPageAccessError();
    z.object({ data: z.array(z.object({ id: metaId })) }).parse(await metaGraph(`${pageId}/leadgen_forms`, page.access_token, { fields: "id", limit: "1" }));
    return page;
  } catch (error) {
    if (error instanceof MetaApiError && error.retryable) throw error;
    throw new MetaPageAccessError("Meta could not verify lead-form access for this Page.");
  }
}

async function grantedMetaPages(token: string, userId: string) {
  // /me/accounts can omit business-owned Pages. Inspect this app's existing
  // grant instead; this requires no business_management permission or new scope.
  const targetId = z.union([metaId, z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String)]);
  const inspected = z.object({ data: z.object({
    app_id: metaId, user_id: metaId, is_valid: z.boolean(),
    granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(targetId).nullish() })).default([]),
  }) }).parse(await graphRequest("debug_token", { input_token: token }, `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`));
  if (!inspected.data.is_valid) throw new MetaApiError(190, false);
  if (inspected.data.app_id !== process.env.META_APP_ID || inspected.data.user_id !== userId) throw new MetaApiError(200, false);
  const pageScopes = new Set(["pages_show_list", "pages_read_engagement", "pages_manage_ads", "leads_retrieval"]);
  const ids = [...new Set(inspected.data.granular_scopes.filter(scope => pageScopes.has(scope.scope)).flatMap(scope => scope.target_ids ?? []))];
  if (ids.length > 25) throw new Error("Too many Pages. Reconnect and grant access only to the Page you want to connect.");
  const pages: z.infer<typeof metaPageSchema>[] = [];
  // Bound concurrency and skip revoked/unreadable assets without hiding other
  // verified Pages. A transient failure remains retryable instead of no_pages.
  for (let offset = 0; offset < ids.length; offset += 4) {
    const batch = await Promise.all(ids.slice(offset, offset + 4).map(async id => {
      try { return await verifiedMetaPage(id, token); }
      catch (error) { if (error instanceof MetaPageAccessError) return null; throw error; }
    }));
    pages.push(...batch.filter((page): page is z.infer<typeof metaPageSchema> => page !== null));
  }
  return pages;
}

export async function exchangeMetaCode(code: string, requestedPageId?: string) {
  const pageId = requestedPageId === undefined ? undefined : metaId.parse(requestedPageId);
  const tokenSchema = z.object({ access_token: z.string().min(1) });
  const short = tokenSchema.parse(await graphRequest("oauth/access_token", { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: process.env.META_REDIRECT_URI!, code }));
  const long = tokenSchema.parse(await graphRequest("oauth/access_token", { grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: short.access_token }));
  const token = long.access_token;
  const me = z.object({ id: metaId }).parse(await metaGraph("me", token, { fields: "id" }));
  const permissions = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })) }).parse(await metaGraph("me/permissions", token));
  const granted = new Set(permissions.data.filter(v => v.status === "granted").map(v => v.permission));
  if (META_LEAD_PERMISSIONS.some(p => !granted.has(p))) throw new MetaApiError(200, false);
  // Business-owned Pages can be omitted by /me/accounts even when Meta grants
  // a Page token. Resolve only the requested Page, using this OAuth grant.
  if (pageId) return { userId: me.id, pages: [await verifiedMetaPage(pageId, token)] };
  const pages = [];
  let after: string | undefined;
  // Pagination cursor only; never follow an upstream URL containing a token.
  for (let i = 0; i < 20; i++) {
    const batch = z.object({ data: z.array(metaPageSchema), paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional() }).parse(await metaGraph("me/accounts", token, { fields: "id,name,access_token", limit: "100", ...(after ? { after } : {}) }));
    pages.push(...batch.data);
    after = batch.paging?.next ? batch.paging.cursors?.after : undefined;
    if (!after) break;
    if (i === 19) throw new Error("Too many Pages. Reconnect and grant access only to the Page you want to connect.");
  }
  return { userId: me.id, pages: pages.length ? pages : await grantedMetaPages(token, me.id) };
}

export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
export function validMetaSignature(raw: string, header: string | null) {
  if (!process.env.META_APP_SECRET || !header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  return safeEqual(header, `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(raw).digest("hex")}`);
}

export function metaLeadFields(lead: MetaLead) {
  const fields = new Map(lead.field_data.map(v => [v.name, v.values.join(", ").slice(0, 4000)]));
  const read = (...names: string[]) => names.map(n => fields.get(n)).find(Boolean) || null;
  return {
    name: (read("full_name", "name") || [read("first_name"), read("last_name")].filter(Boolean).join(" ") || "Meta lead").slice(0, 250),
    email: read("email"), phone: read("phone_number", "phone"), address: read("street_address", "address"),
    city: read("city"), state: read("state", "province"), zip: read("zip_code", "postal_code", "zip"),
    projectType: read("project_type", "service"),
    description: lead.field_data.map(v => `${v.name}: ${v.values.join(", ")}`).join("\n").slice(0, 20000),
  };
}

// A form's consent boxes, by what they say (SmartBook, 2026-10-31: "text when they agreed"): the box whose words name
// texts or SMS is the yes to texts, the one naming calls the yes to calls; one box may say both.
export const metaFormLegalSchema = z.object({
  legal_content: z.object({ custom_disclaimer: z.object({ checkboxes: z.array(z.object({ key: z.string(), text: z.string().default("") })).default([]) }).optional() }).optional(),
});
export function consentKeysOf(form: z.infer<typeof metaFormLegalSchema>): { text: string | null; call: string | null } {
  const boxes = form.legal_content?.custom_disclaimer?.checkboxes ?? [];
  const words = (b: { text: string }) => b.text.replace(/<[^>]+>/g, " ").toLowerCase();
  const text = boxes.find((b) => /\b(texts?|texting|sms|text messages?|messages)\b/.test(words(b)))?.key ?? null;
  const call = boxes.find((b) => /\b(calls?|calling|phone calls?|call me)\b/.test(words(b)))?.key ?? null;
  return { text, call };
}
export function tickedBoxes(lead: MetaLead): Set<string> {
  return new Set((lead.custom_disclaimer_responses ?? []).filter((r) => r.is_checked === true || r.is_checked === 1 || /^(1|true|yes)$/i.test(String(r.is_checked ?? ""))).map((r) => r.checkbox_key));
}
