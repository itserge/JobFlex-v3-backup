import crypto from "node:crypto";
import { IntegrationDisabledError } from "./base";
import { withEmailRetry, recipientLabel } from "./emailRetry";
import { decryptSecret, encryptSecret, isSecretBoxConfigured } from "@/lib/crypto/secretBox";

// Scopes: send mail on the user's behalf + read their email address (to show
// "connected as x@gmail.com" and set the From).
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  email: string;
}

/* ── Tokens at rest ──────────────────────────────────────────────────────
   Organization.gmailTokensJson holds a refresh token to a customer's real
   inbox. It is sealed with the same AES-GCM box that keeps Stripe and Square
   secrets (lib/crypto/secretBox), never written as JSON any more. Rows from
   before 2026-09-20 are plain JSON; `openGmailTokens` still reads them so
   nothing breaks mid-migration, and scripts/gmail-tokens-encrypt.ts reseals
   them. */

/** The stored form of a token set — always sealed. Throws without the box. */
export function sealGmailTokens(tokens: GmailTokens): string {
  return encryptSecret(JSON.stringify(tokens));
}

/** Reads a stored token set, sealed or (legacy) plain. Null when unreadable. */
export function openGmailTokens(stored: string | null | undefined): GmailTokens | null {
  if (!stored) return null;
  try {
    const raw = stored.trimStart().startsWith("{") ? stored : decryptSecret(stored);
    const t = JSON.parse(raw) as Partial<GmailTokens>;
    if (typeof t.refreshToken !== "string" || typeof t.email !== "string") return null;
    return { accessToken: t.accessToken ?? "", refreshToken: t.refreshToken, expiryDate: t.expiryDate ?? null, email: t.email };
  } catch {
    return null;
  }
}

/** Whether a stored token set is still the legacy plain JSON. */
export function isLegacyPlainTokens(stored: string | null | undefined): boolean {
  return Boolean(stored && stored.trimStart().startsWith("{"));
}

/** Storing a Gmail grant needs the secret box; connecting without it is refused. */
export function canStoreGmailTokens(): boolean {
  return isSecretBoxConfigured();
}

/** One line about a Google/gaxios error for a log: status, code and message,
 *  never the request config (which carries the Authorization header). */
export function gmailErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 160);
  const e = err as Error & { code?: unknown; status?: unknown; response?: { status?: unknown; data?: { error?: unknown } } };
  const status = e.response?.status ?? e.status ?? e.code;
  const data = e.response?.data?.error;
  const inner = typeof data === "string" ? data : data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : "";
  return [status ? `status ${String(status)}` : "", e.message, inner && inner !== e.message ? inner : ""]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

/** True when Google says the grant is gone for good — an expired or revoked
 *  refresh token (invalid_grant), or a 401/403 on the send itself. */
export function isGmailGrantDead(err: unknown): boolean {
  const text = gmailErrorText(err).toLowerCase();
  return /invalid_grant|token has been expired or revoked|status 401|status 403|insufficient permission|unauthorized_client/.test(text);
}

/** Best-effort: tell Google the grant is no longer wanted. */
export async function revokeGmailToken(refreshToken: string): Promise<boolean> {
  try {
    const { oauth2 } = await loadOAuth();
    await oauth2.revokeToken(refreshToken);
    return true;
  } catch (err) {
    console.warn("[gmail] revoke at Google failed:", gmailErrorText(err));
    return false;
  }
}

export function isGmailOAuthConfigured() {
  return Boolean(
    process.env.GMAIL_OAUTH_CLIENT_ID &&
      process.env.GMAIL_OAUTH_CLIENT_SECRET &&
      process.env.GMAIL_OAUTH_REDIRECT_URI,
  );
}

// Lazy dynamic import — googleapis is heavy and only needed on the Gmail paths
// (matches the rest of the codebase and stays bundle-friendly under Turbopack).
async function loadOAuth() {
  if (!isGmailOAuthConfigured()) {
    throw new IntegrationDisabledError("Gmail", "GMAIL_OAUTH_CLIENT_ID");
  }
  const { google } = await import("googleapis");
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET,
    process.env.GMAIL_OAUTH_REDIRECT_URI,
  );
  return { google, oauth2 };
}

/** Build the Google consent URL. `state` must be a signed value we can verify. */
export async function getGmailAuthUrl(state: string): Promise<string> {
  const { oauth2 } = await loadOAuth();
  return oauth2.generateAuthUrl({
    access_type: "offline", // needed to receive a refresh_token
    prompt: "consent", // force refresh_token even on re-consent
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Exchange the OAuth code for tokens + the connected Gmail address. */
export async function exchangeGmailCode(code: string): Promise<GmailTokens> {
  const { google, oauth2 } = await loadOAuth();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  const userinfo = google.oauth2({ version: "v2", auth: oauth2 });
  const { data } = await userinfo.userinfo.get();
  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? "",
    expiryDate: tokens.expiry_date ?? null,
    email: data.email ?? "",
  };
}

export async function getGmailClient(accessToken: string, refreshToken?: string) {
  const { google, oauth2 } = await loadOAuth();
  oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

/** Send an HTML email through the connected Gmail account. */
export async function sendViaGmail(
  tokens: Pick<GmailTokens, "accessToken" | "refreshToken" | "email">,
  opts: { to: string; subject: string; html: string; fromName?: string; replyTo?: string; headers?: Record<string, string> },
): Promise<void> {
  // Retry transient Gmail failures (429, 5xx, network) up to 3 attempts. A
  // permanent error (401/403 revoked token) is re-thrown at once so orgSend.ts
  // can fall back to Resend quickly rather than stalling on doomed retries.
  await withEmailRetry(`gmail → ${recipientLabel(opts.to)}`, async () => {
    const gmail = await getGmailClient(tokens.accessToken, tokens.refreshToken);
    // Header values are single-line by definition: strip CR/LF so a crafted
    // address or display name cannot inject extra headers (Bcc:, etc.) into
    // the raw MIME message.
    const hv = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
    const from = opts.fromName ? `${hv(opts.fromName)} <${hv(tokens.email)}>` : hv(tokens.email);
    const headers = [
      `From: ${from}`,
      `To: ${hv(opts.to)}`,
      opts.replyTo ? `Reply-To: ${hv(opts.replyTo)}` : "",
      // The letter's List-Unsubscribe and its one-click twin (2026-11-11) — only these two names are carried.
      ...Object.entries(opts.headers ?? {})
        .filter(([k]) => /^list-unsubscribe(-post)?$/i.test(k))
        .map(([k, v]) => `${k}: ${hv(v)}`),
      // RFC 2047 encode the subject so non-ASCII survives.
      `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
    ].filter(Boolean);
    const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${opts.html}`).toString("base64url");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  });
}

// ── Signed OAuth state (CSRF + org binding) ──────────────────────────────────
// The state round-trips through Google, so it must be tamper-proof. HMAC it with
// the app secret and carry the org id + a short expiry.
interface GmailState {
  organizationId: string;
  exp: number;
}

export function signGmailState(organizationId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
  const payload: GmailState = { organizationId, exp: Date.now() + 10 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGmailState(state: string | null): GmailState | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as GmailState;
    if (!payload.organizationId || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
