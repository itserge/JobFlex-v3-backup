// RAMP'S DEVELOPER API, THE DOOR (2026-10-29). One JobFlex app registered in Ramp's Developer Console — its client
// id and secret in the platform's env — and every contractor authorizes it on their own Ramp business
// (Authorization Code grant: docs.ramp.com/developer-api/v1/authorization). Tokens live an hour; the refresh token
// renews them. The stand points RAMP_API_BASE and RAMP_AUTH_BASE at a fake; the sandbox at demo-api.ramp.com.
import type { RampTransaction } from "./shared";

export interface RampEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
  authBase: string;
}
export function rampEnv(): RampEnv | null {
  const clientId = process.env.RAMP_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.RAMP_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.RAMP_REDIRECT_URI?.trim() ?? "";
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBase: (process.env.RAMP_API_BASE?.trim() || "https://api.ramp.com").replace(/\/+$/, ""),
    authBase: (process.env.RAMP_AUTH_BASE?.trim() || "https://app.ramp.com").replace(/\/+$/, ""),
  };
}
export const rampEnabled = (): boolean => rampEnv() !== null;

/** What the contractor grants JobFlex: read the business, its users, transactions and receipts; keep the job field and its options; write memos;
 *  bills, vendors, cards and crew funds. Exactly the app's allowed scopes in Ramp's Developer Console — a scope the app doesn't allow
 *  fails the authorize. Webhooks take no scope of their own (each event needs its read scope), and funds are only created, never read. */
export const RAMP_SCOPES = [
  "business:read", "users:read", "users:write", "transactions:read", "transactions:write", "receipts:read", "accounting:read", "accounting:write", "memos:write",
  "entities:read", "vendors:read", "vendors:write", "bills:read", "bills:write", "cards:read", "cards:write", "funds:write",
] as const;

/** What each scope is for, in the contractor's words — the Ramp guide's table (/integrations/ramp). One per scope. */
export const RAMP_SCOPE_USES: Record<(typeof RAMP_SCOPES)[number], string> = {
  "business:read": "Read your Ramp business's name to show which one is connected.",
  "users:read": "Match Ramp cardholders to your crew, so the right person is texted.",
  "users:write": "Invite a crew member to Ramp when you give them a card.",
  "transactions:read": "Read card swipes (the moment they happen, and every hour) to book them on jobs.",
  "transactions:write": "Write the job and line-item splits back onto the swipe in Ramp.",
  "receipts:read": "Copy the receipt into the job's expense in JobFlex.",
  "accounting:read": "Read the \"JobFlex job\" field and its options.",
  "accounting:write": "Create the \"JobFlex job\" field and keep its options equal to your open jobs. Nothing else in your accounting setup is touched.",
  "memos:write": "Write the job and the tech's answer into the swipe's memo.",
  "entities:read": "Find the business entity and bank account that pays your bills.",
  "vendors:read": "List your vendors when you pay a bill.",
  "vendors:write": "Add a new vendor when you pay someone who is not in Ramp yet.",
  "bills:read": "Follow a bill until it is paid, then book it on the job.",
  "bills:write": "Create the bill in Ramp, coded to the job, with the invoice attached.",
  "cards:read": "List your Ramp cards in JobFlex.",
  "cards:write": "Order a physical card for a crew member; freeze and unfreeze cards.",
  "funds:write": "Create the crew member's spend limit (\"JobFlex · name\") with the monthly and per-purchase limits you set.",
};

export function rampAuthorizeUrl(env: RampEnv, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: env.clientId, redirect_uri: env.redirectUri, scope: RAMP_SCOPES.join(" "), state });
  return `${env.authBase}/v1/authorize?${q.toString()}`;
}

export interface RampTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number | null;
  scope?: string;
  token_type?: string;
}

export interface RampVendor {
  id: string;
  name: string;
  display_name?: string | null;
  is_active?: boolean;
  contacts?: string[];
  address?: { address_line_1: string; address_line_2?: string; city: string; state?: string; postal_code: string; country: string } | null;
  addresses?: Array<{ id: string; address_line_1: string; city: string; state?: string; postal_code: string; country: string; is_default: boolean; pay_to_name?: string }>;
  default_payment_method?: { policy?: unknown; update_source?: string | null } | null;
  default_entity_id?: string | null;
}
export interface RampBill {
  id: string;
  amount?: { amount: number; currency_code?: string; minor_unit_conversion_rate?: number | null } | null;
  approval_status?: string | null;
  status?: string | null;
  status_summary?: string | null;
  paid_at?: string | null;
  archived_at?: string | null;
  deep_link_url?: string;
  due_at?: string;
  issued_at?: string;
  invoice_number?: string;
  invoice_urls?: string[];
  attachments?: Array<{ attachment_type?: string; id: string; url?: string }>;
  payment?: { payment_method?: string | null; amount?: { amount: number; minor_unit_conversion_rate?: number | null } | null } | null;
  vendor?: { id: string; name: string } | null;
  draft_bill_id?: string | null;
  memo?: string;
}

export class RampApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: string) {
    super(message);
    this.name = "RampApiError";
  }
}

/** POST /developer/v1/token with the app's Basic credentials. */
export async function rampToken(env: RampEnv, form: Record<string, string>): Promise<RampTokenResponse> {
  const r = await fetch(`${env.apiBase}/developer/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) throw new RampApiError(r.status, `Ramp token request failed (${r.status})`, text.slice(0, 400));
  const json = JSON.parse(text) as RampTokenResponse;
  if (!json.access_token) throw new RampApiError(r.status, "Ramp returned no access token", text.slice(0, 400));
  return json;
}

export interface RampPage<T> {
  data: T[];
  page?: { next?: string | null };
}

/** The API with one business's access token. */
export class RampApi {
  constructor(private readonly env: RampEnv, private readonly accessToken: string) {}

  private async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = path.startsWith("http") ? new URL(path) : new URL(`${this.env.apiBase}/developer/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) throw new RampApiError(r.status, `Ramp ${method} ${url.pathname} failed (${r.status})`, text.slice(0, 600));
    return (text ? JSON.parse(text) : {}) as T;
  }
  get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.call<T>("GET", path, undefined, query);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>("POST", path, body);
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>("PATCH", path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.call<T>("DELETE", path);
  }
  /** A multipart upload (a bill's invoice): the body is a FormData, the content type the browser's. */
  async postForm<T>(path: string, form: FormData): Promise<T> {
    const r = await fetch(`${this.env.apiBase}/developer/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" }, body: form, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    const text = await r.text();
    if (!r.ok) throw new RampApiError(r.status, `Ramp POST ${path} failed (${r.status})`, text.slice(0, 600));
    return (text ? JSON.parse(text) : {}) as T;
  }
  /** Every page of a list, following `page.next`, never past `max` rows. */
  async listAll<T>(path: string, query: Record<string, string>, max = 2000): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      const page: RampPage<T> = first ? await this.get<RampPage<T>>(path, query) : await this.get<RampPage<T>>(next as string);
      first = false;
      out.push(...(page.data ?? []));
      next = page.page?.next ?? null;
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  }

  business(): Promise<{ id?: string; business_name_legal?: string; business_name_on_card?: string; active?: boolean }> {
    return this.get("/business");
  }
  transactions(since: Date | null, max = 1000): Promise<RampTransaction[]> {
    const q: Record<string, string> = { page_size: "100" };
    if (since) q.from_date = since.toISOString();
    return this.listAll<RampTransaction>("/transactions", q, max);
  }
  transaction(id: string): Promise<RampTransaction> {
    return this.get(`/transactions/${encodeURIComponent(id)}`);
  }
  receipt(id: string): Promise<{ id?: string; receipt_url: string; transaction_id?: string }> {
    return this.get(`/receipts/${encodeURIComponent(id)}`);
  }
  users(): Promise<Array<{ id?: string; email?: string; phone?: string | null; first_name?: string; last_name?: string; status?: string; role?: string }>> {
    return this.listAll("/users", { page_size: "100" }, 500);
  }
  user(id: string): Promise<{ id?: string; email?: string; phone?: string | null; first_name?: string; last_name?: string }> {
    return this.get(`/users/${encodeURIComponent(id)}`);
  }
  memo(transactionId: string, memo: string): Promise<{ id?: string; memo?: string }> {
    return this.post(`/memos/${encodeURIComponent(transactionId)}`, { memo: memo.slice(0, 500) });
  }
  createField(body: { id: string; name: string; input_type: "SINGLE_CHOICE"; is_required_for: string[]; is_splittable: boolean }): Promise<{ ramp_id?: string; id?: string; is_required_for?: string[] }> {
    return this.post("/accounting/fields", body);
  }
  updateField(rampId: string, body: { is_required_for?: string[]; is_splittable?: boolean; name?: string }): Promise<{ ramp_id?: string }> {
    return this.patch(`/accounting/fields/${encodeURIComponent(rampId)}`, body);
  }
  fieldOptions(fieldRampId: string): Promise<Array<{ id?: string; ramp_id?: string; value?: string; is_active?: boolean; visibility?: string }>> {
    return this.listAll("/accounting/field-options", { field_id: fieldRampId, page_size: "100" }, 2000);
  }
  uploadFieldOptions(fieldRampId: string, options: Array<{ id: string; value: string }>): Promise<{ uploaded?: string[] }> {
    return this.post("/accounting/field-options", { field_id: fieldRampId, options });
  }
  updateFieldOption(optionRampId: string, body: { value?: string; visibility?: "HIDDEN" | "VISIBLE"; reactivate?: boolean }): Promise<{ ramp_id?: string }> {
    return this.patch(`/accounting/field-options/${encodeURIComponent(optionRampId)}`, body);
  }
  createWebhook(endpointUrl: string, eventTypes: string[]): Promise<{ id: string; secret: string; status?: string }> {
    return this.post("/webhooks", { endpoint_url: endpointUrl, event_types: eventTypes });
  }
  verifyWebhook(id: string, challenge: string): Promise<{ success?: boolean }> {
    return this.post(`/webhooks/${encodeURIComponent(id)}/verify`, { challenge });
  }
  deleteWebhook(id: string): Promise<unknown> {
    return this.delete(`/webhooks/${encodeURIComponent(id)}`);
  }
  inviteUser(body: { email: string; first_name: string; last_name: string; idempotency_key: string; role: "BUSINESS_USER" }): Promise<{ id: string }> {
    return this.post("/users/deferred", body);
  }
  userTask(taskId: string): Promise<{ status?: string; data?: { user_id?: string; error?: string } }> {
    return this.get(`/users/deferred/status/${encodeURIComponent(taskId)}`);
  }
  /** The split written back: lines in minor units with their coding; an empty list unsplits. */
  splitTransaction(id: string, lineItems: Array<{ amount: number; memo?: string | null; accounting_field_selections?: Array<{ field_id?: string | null; field_external_id?: string | null; field_option_id?: string | null; field_option_external_id?: string | null }> }>): Promise<RampTransaction> {
    return this.patch(`/transactions/${encodeURIComponent(id)}`, { line_items: lineItems });
  }
  // ── Bill Pay ──
  entities(): Promise<Array<{ id: string; entity_name?: string; is_primary?: boolean | null; default_bill_pay_payment_account_id?: string | null; payment_accounts?: Array<{ id: string; account_name?: string; account_number_last_four?: string; currency?: string }>; accounts?: Array<{ bank_account_id?: string | null; usage_type?: string | null }> }>> {
    return this.listAll("/entities", { page_size: "50" }, 50);
  }
  vendors(): Promise<RampVendor[]> {
    return this.listAll("/vendors", { page_size: "100" }, 1000);
  }
  createVendor(body: { name: string; business_vendor_contacts: { email: string; first_name?: string; last_name?: string; phone?: string }; address?: { address_line_1: string; address_line_2?: string | null; city: string; state?: string | null; postal_code: string; country: string; pay_to_name?: string | null }; request_payment_details?: boolean; default_entity_id?: string | null; external_vendor_id?: string | null; country?: string | null }): Promise<RampVendor> {
    return this.post("/vendors", body);
  }
  vendorAccounts(vendorId: string): Promise<Array<{ id: string; is_default?: boolean; payment_method?: string; account_number_last_four?: string | null }>> {
    return this.listAll(`/vendors/${encodeURIComponent(vendorId)}/accounts`, { page_size: "50" }, 50);
  }
  vendorContacts(vendorId: string): Promise<Array<{ id: string; email: string; is_default?: boolean }>> {
    return this.listAll(`/vendors/${encodeURIComponent(vendorId)}/contacts`, { page_size: "50" }, 50);
  }
  /** An approved bill: Ramp pays it by the payment details given. */
  createBill(body: Record<string, unknown>): Promise<RampBill> {
    return this.post("/bills", body);
  }
  /** A draft bill: lands in Ramp's inbox for a person to approve there. */
  createDraftBill(body: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>> {
    return this.post("/bills/drafts", body);
  }
  submitDraftBill(draftId: string): Promise<RampBill> {
    return this.post(`/bills/drafts/${encodeURIComponent(draftId)}/submit`, {});
  }
  bill(id: string): Promise<RampBill> {
    return this.get(`/bills/${encodeURIComponent(id)}`);
  }
  draftBill(id: string): Promise<Record<string, unknown>> {
    return this.get(`/bills/drafts/${encodeURIComponent(id)}`);
  }
  /** The invoice on the bill (or the draft). Ramp takes PDFs here, not pictures. */
  uploadBillAttachment(billId: string, file: { bytes: Buffer; filename: string; contentType: string }, attachmentType: "INVOICE" | "FILE", draft = false): Promise<{ id: string }> {
    const form = new FormData();
    form.set("attachment_type", attachmentType);
    form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.contentType }), file.filename);
    return this.postForm(draft ? `/bills/drafts/${encodeURIComponent(billId)}/attachments` : `/bills/${encodeURIComponent(billId)}/attachments`, form);
  }
  // ── Cards ──
  createFund(body: Record<string, unknown>): Promise<{ id: string; display_name?: string; state?: string }> {
    return this.post("/funds", body);
  }
  physicalCards(): Promise<Array<{ id?: string; cardholder_id?: string; cardholder_name?: string; display_name?: string; last_four?: string; state?: string; is_suspended?: boolean; fund_id?: string | null; fulfillment?: { fulfillment_status?: string; shipping_eta?: string } | null; created_at?: string }>> {
    return this.listAll("/cards/physical", { page_size: "100" }, 500);
  }
  virtualCards(): Promise<Array<{ id?: string; user_id?: string; fund_id?: string | null; is_card_suspended?: boolean; display_name?: string; last_four?: string; created_at?: string }>> {
    return this.listAll("/cards/virtual", { page_size: "100" }, 500);
  }
  createPhysicalCard(body: { user_id: string; fund_id?: string | null; shipping_address: { address1: string; address2?: string | null; city: string; state?: string | null; postal_code: string; country: string } }): Promise<{ id?: string; last_four?: string; display_name?: string; state?: string; fulfillment?: { shipping_eta?: string } | null }> {
    return this.post("/cards/physical", body);
  }
  suspendCard(id: string, suspended: boolean): Promise<unknown> {
    return suspended ? this.post(`/cards/physical/${encodeURIComponent(id)}/suspension`, {}) : this.delete(`/cards/physical/${encodeURIComponent(id)}/suspension`);
  }
}

/** Revoke a token on disconnect; a failure is not the contractor's problem. */
export async function rampRevoke(env: RampEnv, token: string): Promise<void> {
  try {
    await fetch(`${env.apiBase}/developer/v1/token/revoke`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* revoked or not, the connection is gone on our side */
  }
}
