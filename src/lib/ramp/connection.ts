import "server-only";
// A CONTRACTOR'S RAMP CONNECTION (2026-10-29) — server. The tokens Ramp granted JobFlex on this business, encrypted
// in SyncState `ramp:<org>` (lib/crypto/secretBox, like the Meta page token); the business id → org map
// (`rampBiz:<id>`) for webhooks; the webhook id → org map (`rampHook:<id>`) for its verification. Access tokens
// last an hour — rampApiFor renews one a few minutes early with the refresh token and writes it back.
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, isSecretBoxConfigured } from "@/lib/crypto/secretBox";
import { RampApi, rampEnv, rampRevoke, rampToken, type RampEnv } from "./client";

export interface RampConnection {
  businessId: string;
  businessName: string;
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms. */
  expiresAt: number;
  refreshExpiresAt: number | null;
  scope: string;
  connectedAt: string;
  actorId: string;
  /** Ramp's id of our "JobFlex job" field once it exists there. */
  fieldRampId: string | null;
  fieldOptionsAt: string | null;
  webhookId: string | null;
  webhookSecret: string | null;
  webhookVerified: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number;
  lastError: string | null;
  /** Ask the cardholder by text when a swipe came in with no job. */
  askByText: boolean;
  /** Ramp asks the job on every swipe (the field is required for transactions). */
  requireJob: boolean;
  /** Bills from JobFlex are approved bills Ramp pays (true), or drafts someone approves in Ramp (false, the default). */
  billsApproved: boolean;
  /** Bill Pay: the paying entity and its bill-pay bank account, remembered on the first bill. */
  entityId: string | null;
  sourceBankAccountId: string | null;
}

const connKey = (org: string) => `ramp:${org}`;
const bizKey = (businessId: string) => `rampBiz:${businessId}`;
const hookKey = (webhookId: string) => `rampHook:${webhookId}`;

export async function readRampConnection(organizationId: string): Promise<RampConnection | null> {
  if (!isSecretBoxConfigured()) return null;
  const row = await db.syncState.findUnique({ where: { key: connKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    const c = JSON.parse(decryptSecret(row.cursor)) as Partial<RampConnection>;
    if (!c.accessToken || !c.businessId) return null;
    return {
      businessId: c.businessId,
      businessName: c.businessName ?? "",
      accessToken: c.accessToken,
      refreshToken: c.refreshToken ?? null,
      expiresAt: typeof c.expiresAt === "number" ? c.expiresAt : 0,
      refreshExpiresAt: typeof c.refreshExpiresAt === "number" ? c.refreshExpiresAt : null,
      scope: c.scope ?? "",
      connectedAt: c.connectedAt ?? new Date(0).toISOString(),
      actorId: c.actorId ?? "",
      fieldRampId: c.fieldRampId ?? null,
      fieldOptionsAt: c.fieldOptionsAt ?? null,
      webhookId: c.webhookId ?? null,
      webhookSecret: c.webhookSecret ?? null,
      webhookVerified: !!c.webhookVerified,
      lastSyncAt: c.lastSyncAt ?? null,
      lastSyncCount: typeof c.lastSyncCount === "number" ? c.lastSyncCount : 0,
      lastError: c.lastError ?? null,
      askByText: c.askByText !== false,
      requireJob: c.requireJob !== false,
      billsApproved: c.billsApproved === true,
      entityId: c.entityId ?? null,
      sourceBankAccountId: c.sourceBankAccountId ?? null,
    };
  } catch {
    return null;
  }
}

export async function writeRampConnection(organizationId: string, conn: RampConnection): Promise<void> {
  const cursor = encryptSecret(JSON.stringify(conn));
  await db.syncState.upsert({ where: { key: connKey(organizationId) }, create: { key: connKey(organizationId), cursor }, update: { cursor } });
  await db.syncState.upsert({ where: { key: bizKey(conn.businessId) }, create: { key: bizKey(conn.businessId), cursor: organizationId }, update: { cursor: organizationId } });
  if (conn.webhookId) await db.syncState.upsert({ where: { key: hookKey(conn.webhookId) }, create: { key: hookKey(conn.webhookId), cursor: organizationId }, update: { cursor: organizationId } });
}

export async function patchRampConnection(organizationId: string, patch: Partial<RampConnection>): Promise<RampConnection | null> {
  const conn = await readRampConnection(organizationId);
  if (!conn) return null;
  const next = { ...conn, ...patch };
  await writeRampConnection(organizationId, next);
  return next;
}

/** The org behind a Ramp business id (webhooks), or behind a webhook id (its verification). */
export async function orgOfRampBusiness(businessId: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key: bizKey(businessId) }, select: { cursor: true } }).catch(() => null);
  return row?.cursor ?? null;
}
export async function orgOfRampWebhook(webhookId: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key: hookKey(webhookId) }, select: { cursor: true } }).catch(() => null);
  return row?.cursor ?? null;
}

/** Disconnect: the webhook deleted, the tokens revoked, every key gone. The expenses already on jobs stay. */
export async function clearRampConnection(organizationId: string): Promise<void> {
  const conn = await readRampConnection(organizationId);
  const env = rampEnv();
  if (conn && env) {
    if (conn.webhookId) await new RampApi(env, conn.accessToken).deleteWebhook(conn.webhookId).catch(() => null);
    await rampRevoke(env, conn.accessToken);
    if (conn.refreshToken) await rampRevoke(env, conn.refreshToken);
  }
  const keys = [connKey(organizationId), ...(conn ? [bizKey(conn.businessId)] : []), ...(conn?.webhookId ? [hookKey(conn.webhookId)] : [])];
  await db.syncState.deleteMany({ where: { key: { in: keys } } }).catch(() => null);
}

/** Every connected org (the hourly sync). */
export async function connectedRampOrgs(): Promise<string[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: "ramp:" } }, select: { key: true } }).catch(() => []);
  return rows.map((r) => r.key.slice("ramp:".length)).filter(Boolean);
}

const REFRESH_AHEAD_MS = 5 * 60_000;

/**
 * The API for an org, its token fresh: renewed with the refresh token when it is about to expire. Null when there
 * is no connection, the platform has no Ramp app, or the refresh failed — the connection is then marked to reconnect.
 */
export async function rampApiFor(organizationId: string): Promise<{ api: RampApi; conn: RampConnection; env: RampEnv } | null> {
  const env = rampEnv();
  if (!env) return null;
  let conn = await readRampConnection(organizationId);
  if (!conn) return null;
  if (conn.expiresAt - Date.now() < REFRESH_AHEAD_MS) {
    if (!conn.refreshToken) {
      await writeRampConnection(organizationId, { ...conn, lastError: "The Ramp token expired and no refresh token was granted — connect again." });
      return null;
    }
    try {
      const t = await rampToken(env, { grant_type: "refresh_token", refresh_token: conn.refreshToken });
      conn = { ...conn, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000, refreshToken: t.refresh_token ?? conn.refreshToken, lastError: null };
      await writeRampConnection(organizationId, conn);
    } catch (err) {
      await writeRampConnection(organizationId, { ...conn, lastError: `Ramp refused to renew the token (${err instanceof Error ? err.message : "error"}) — connect again.` });
      return null;
    }
  }
  return { api: new RampApi(env, conn.accessToken), conn, env };
}

/** What the Integrations page shows. */
export interface RampView {
  /** The platform has a Ramp app and the secret box: the card can connect. */
  enabled: boolean;
  connected: boolean;
  businessName: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncCount: number;
  lastError: string | null;
  fieldReady: boolean;
  webhookReady: boolean;
  askByText: boolean;
  requireJob: boolean;
  billsApproved: boolean;
  connectHref: string;
}
export async function rampConnectionView(organizationId: string): Promise<RampView> {
  const enabled = rampEnabled() && isSecretBoxConfigured();
  const conn = enabled ? await readRampConnection(organizationId) : null;
  return {
    enabled,
    connected: !!conn,
    businessName: conn?.businessName ?? "",
    connectedAt: conn?.connectedAt ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
    lastSyncCount: conn?.lastSyncCount ?? 0,
    lastError: conn?.lastError ?? null,
    fieldReady: !!conn?.fieldRampId,
    webhookReady: !!conn?.webhookVerified,
    askByText: conn?.askByText ?? true,
    requireJob: conn?.requireJob ?? true,
    billsApproved: conn?.billsApproved ?? false,
    connectHref: "/api/integrations/ramp/connect",
  };
}
export const rampEnabled = (): boolean => rampEnv() !== null;
