// EagleView Measurement Orders API client + measurement-JSON parser.
//
// SERVER-ONLY: this module reads EAGLEVIEW_CLIENT_ID/SECRET and mints bearer
// tokens — it must never be imported into a client component. Import it only
// from "use server" action files (mirrors how src/lib/maps.ts is used).
//
// Auth quirk (the thing that blocks every first integration): the OAuth token
// is minted on the PRODUCTION host (apicenter.eagleview.com) while the API
// calls go to the SANDBOX host (sandbox.apicenter.eagleview.com). Hitting the
// sandbox host for the token returns an Apigee "environment is not defined"
// 500. Both hosts are overridable via env.

import { ExternalCallError, externalFetch, type ExternalFailureKind } from "@/lib/externalCall";
import { instantTotalsOf } from "@/lib/roofDiagram/instantTotals";
import { notePaidCall } from "@/lib/trialMeter";
const TOKEN_BASE = process.env.EAGLEVIEW_TOKEN_BASE_URL || "https://apicenter.eagleview.com";
const API_BASE = process.env.EAGLEVIEW_API_BASE_URL || "https://sandbox.apicenter.eagleview.com";

export function isEagleViewEnabled(): boolean {
  return Boolean(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET);
}

// ── Debug (2026-09-08, owner's call: ON until told otherwise) ─────────────────
// Every Property Data order, refusal and token mint is logged with the identity
// behind it (client id, the org claim in the token, both hosts, the packs), and
// the same detail rides on the thrown message so the browser console and the
// toast show it too. EAGLEVIEW_DEBUG=false silences all of it.
export const EV_DEBUG = process.env.EAGLEVIEW_DEBUG !== "false";
export function evDebug(...args: unknown[]): void {
  if (EV_DEBUG) console.info("[eagleview:debug]", ...args);
}
/** The `org` claim of the last minted token — the account EagleView bills. */
let tokenOrg: string | null = null;
export function eagleViewIdentity(): { clientId: string; org: string | null; tokenHost: string; propertyHost: string } {
  const id = process.env.EAGLEVIEW_CLIENT_ID ?? "";
  return {
    clientId: id ? `${id.slice(0, 6)}…${id.slice(-4)}` : "(unset)",
    org: tokenOrg,
    tokenHost: TOKEN_BASE,
    propertyHost: process.env.EAGLEVIEW_PROPERTY_API_BASE_URL || "https://apis.eagleview.com",
  };
}

// EagleView file-type codes (from the Measurement Orders Postman collection).
export const EV_FILE = {
  MEASUREMENT_JSON: 107, // "EV Measurement JSON" — geometry: points/lines/faces
  AUTOCAD_DXF: 26, //       vector wireframe
  EAGLEVIEW_XML: 18, //     same data as JSON, in XML
  REPORT_PDF: 206, //       human-readable report
} as const;

// The roofing-contractor product ("Bid Perfect", PrimaryProductId 110) and the
// default 48-hour delivery (DeliveryProductId 8). Confirm the live catalog with
// getAvailableProducts() before relying on these for real orders.
export const EV_PRODUCT = {
  BID_PERFECT: 110,
  DELIVERY_REGULAR: 8,
  MEASUREMENT_INSTRUCTION_PRIMARY: 3,
} as const;

// ── Auth ─────────────────────────────────────────────────────────────────────
// Client-credentials token, cached in-module until ~2 min before expiry. Server
// processes are long-lived, so this avoids a token round-trip on every call.
// ── timeouts and retries ────────────────────────────────────────────────────
//
// Modelled on solarFetch (solar.ts), and for the same reason it was written:
// on 2026-08-28 one 15 s abort with no retry threw away a whole reconstruction.
// The audit that followed found EagleView in the same state — four calls with a
// ceiling and no retry, and one helper, evFetch, with NO CEILING AT ALL, which
// is the legacy Reports API: getAvailableProducts, getReportSummary,
// getMeasurementModel and getReportFile could hang forever.
//
// What is retried is what a second ask could answer differently. 4xx other than
// 429 is an ANSWER — the request was understood and refused — and asking again
// turns a fast no into a slow one. 429, 5xx, aborts and dropped connections are
// the cases where nothing was answered at all.

/** One attempt's ceiling. The value the billed calls already carried. */
const EV_TIMEOUT_MS = 20_000;
/** One try plus two retries. */
const EV_ATTEMPTS = 3;
/** First pause before retrying; doubles (1 s, 2 s). */
const EV_BACKOFF_MS = 1_000;

/** Why an EagleView call could not be answered — typed so callers need not read messages. */
export type EvFailureKind =
  /** The request hung or the connection broke. Trying again is right. */
  | "timeout"
  /** Credentials or entitlement. Ours to fix, not the user's, and not retryable. */
  | "auth"
  /** EagleView answered and the answer is no data for this address. */
  | "no-data"
  /** Rate limited or a server fault — worth a second ask. */
  | "busy"
  | "error";

export class EagleViewUnavailableError extends Error {
  constructor(
    message: string,
    readonly kind: EvFailureKind,
    readonly op: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "EagleViewUnavailableError";
  }
}

const evKindFor = (k: ExternalFailureKind): EvFailureKind =>
  k === "auth" ? "auth" : k === "no-data" ? "no-data" : k === "unreachable" ? "timeout" : "error";

/**
 * One EagleView request, with a ceiling and retries — the shared external-call
 * contract, with EagleView's own kind names kept because callers already read
 * them. 202 is passed through: the Property Data poll uses it for "not ready
 * yet", which is an answer, not a failure.
 */
async function evRequest(url: string, init: RequestInit, op: string, attempts = EV_ATTEMPTS): Promise<Response> {
  try {
    return await externalFetch("eagleview", op, url, init, {
      timeoutMs: EV_TIMEOUT_MS,
      attempts,
      backoffMs: EV_BACKOFF_MS,
      acceptStatuses: [202],
    });
  } catch (err) {
    if (!(err instanceof ExternalCallError)) throw err;
    throw new EagleViewUnavailableError(err.message, evKindFor(err.kind), op, err.httpStatus);
  }
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const id = process.env.EAGLEVIEW_CLIENT_ID;
  const secret = process.env.EAGLEVIEW_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EagleView is not configured");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await evRequest(
    `${TOKEN_BASE}/oauth2/v1/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    "auth",
  );
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 120) * 1000,
  };
  try {
    const payload = JSON.parse(Buffer.from(data.access_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
    tokenOrg = String(payload.org ?? payload.orgId ?? "") || null;
  } catch {
    tokenOrg = null;
  }
  evDebug("token minted", { host: TOKEN_BASE, org: tokenOrg, expiresIn: data.expires_in });
  return data.access_token;
}

/**
 * The legacy Reports API. Until 2026-08-28 this had NO timeout: four exported
 * methods went through it and any one of them could hang indefinitely. Not on
 * the roof-diagram path, which is why it survived that long — but a call with
 * no ceiling is a call that will eventually hold something open.
 */
async function evFetch(path: string, init?: RequestInit): Promise<Response> {
  const send = async (token: string) =>
    evRequest(
      `${API_BASE}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      },
      `reports ${path.split("?")[0]}`,
    );

  // A cached token can outlive its validity (key rotation, revocation, or a
  // server that restarted the clock). One forced re-mint distinguishes a stale
  // token from a genuinely unauthorized request, so callers never see a 401
  // that a refresh would have fixed. evRequest surfaces 401 as an auth-kind
  // EagleViewUnavailableError rather than a Response, so the retry hangs off
  // the error path.
  try {
    return await send(await getToken());
  } catch (err) {
    if (
      err instanceof EagleViewUnavailableError &&
      err.kind === "auth" &&
      err.httpStatus === 401 &&
      tokenCache
    ) {
      tokenCache = null;
      return send(await getToken());
    }
    throw err;
  }
}

// Build a human error from a failed response. The sandbox is a mock — it 400s
// any address it has no canned scenario for ("...InvalidRequest does not
// exist!"), which would otherwise surface as a cryptic "failed (400)".
async function evError(res: Response, op: string): Promise<Error> {
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* no body */
  }
  if (res.status === 400 && /does not exist|InvalidRequest/i.test(detail)) {
    return new Error(
      "The EagleView sandbox only prices/orders its built-in test addresses. Use the sample roofs above, or connect a production EagleView account to measure a real address.",
    );
  }
  // 401 here means the token minted fine but the API host rejected it — almost
  // always a host/credential mismatch rather than a bad key. Sandbox keys hit
  // against the production host answer "Authorization has been denied for this
  // request."; the sandbox answers "invalid AccessToken" for a bad token. Name
  // the host in the message, because the failure is invisible from the UI.
  if (res.status === 401) {
    const denied = /Authorization has been denied/i.test(detail);
    return new Error(
      denied
        ? `EagleView rejected these credentials for ${API_BASE}. Sandbox keys only work against the sandbox host — set EAGLEVIEW_API_BASE_URL to https://sandbox.apicenter.eagleview.com (or unset it to use the default), then redeploy.`
        : `EagleView authorization failed for ${API_BASE} (401)${detail ? `: ${detail.slice(0, 140)}` : ""}. Check EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET.`,
    );
  }
  return new Error(`${op} failed (${res.status})${detail ? `: ${detail.slice(0, 140)}` : ""}`);
}

// ── API methods ──────────────────────────────────────────────────────────────
export interface EvProduct {
  productID: number;
  name: string;
  description: string | null;
  priceMin: number;
  priceMax: number;
  isTemporarilyUnavailable: boolean;
}

export async function getAvailableProducts(): Promise<EvProduct[]> {
  const res = await evFetch("/v2/Product/GetAvailableProducts");
  if (!res.ok) throw await evError(res, "GetAvailableProducts");
  return (await res.json()) as EvProduct[];
}

export interface EvOrderInput {
  address: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  lat?: number;
  lng?: number;
  primaryProductId?: number;
  deliveryProductId?: number;
  measurementInstructionType?: number;
  poNumber?: string;
  referenceId?: string;
}

function orderBody(input: EvOrderInput) {
  return {
    OrderReports: [
      {
        ReportAddresses: [
          {
            Address: input.address,
            City: input.city,
            State: input.state,
            Zip: input.zip,
            Country: input.country ?? "US",
            Latitude: input.lat ?? null,
            Longitude: input.lng ?? null,
          },
        ],
        PrimaryProductId: input.primaryProductId ?? EV_PRODUCT.BID_PERFECT,
        DeliveryProductId: input.deliveryProductId ?? EV_PRODUCT.DELIVERY_REGULAR,
        MeasurementInstructionType:
          input.measurementInstructionType ?? EV_PRODUCT.MEASUREMENT_INSTRUCTION_PRIMARY,
        AddOnProductIds: null,
        PONumber: input.poNumber ?? null,
        ReferenceID: input.referenceId ?? null,
        ChangesInLast4Years: false,
      },
    ],
  };
}

// Price an order WITHOUT placing it — no charge. Returns the raw price payload.
export async function priceOrder(input: EvOrderInput): Promise<unknown> {
  const res = await evFetch("/v2/Order/PriceOrder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody(input)),
  });
  if (!res.ok) throw await evError(res, "PriceOrder");
  return res.json();
}

// Place a BILLABLE order. Returns the new report id. Callers must gate this
// behind an explicit, confirmed user action.
export async function placeOrder(input: EvOrderInput): Promise<{ reportId: number; raw: unknown }> {
  const res = await evFetch("/v2/Order/PlaceOrder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody(input)),
  });
  if (!res.ok) throw await evError(res, "PlaceOrder");
  await notePaidCall("eagleview", "report");
  const raw = (await res.json()) as Record<string, unknown>;
  const reportId = Number(
    (raw?.ReportId as number) ??
      (Array.isArray((raw as any)?.Reports) ? (raw as any).Reports[0]?.ReportId : undefined),
  );
  if (!Number.isFinite(reportId)) throw new Error("PlaceOrder returned no reportId");
  return { reportId, raw };
}

// Report header: status (for polling) + summary measurements EagleView computes
// server-side (area, line lengths, facet count, cost). Geometry comes from the
// separate measurement-JSON file (getMeasurementJson).
export interface EvReportSummary {
  reportId: number;
  status: string;
  statusId: number;
  displayStatus: string;
  completed: boolean;
  deliveryFilesAvailable: boolean;
  totalCost: number | null;
  areaSqft: number | null;
  predominantPitch: string | null;
  totalRoofFacets: number | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  raw: Record<string, unknown>;
}

export async function getReportSummary(reportId: number): Promise<EvReportSummary> {
  const res = await evFetch(`/v3/Report/GetReport?reportId=${encodeURIComponent(String(reportId))}`);
  if (!res.ok) throw await evError(res, "GetReport");
  const r = (await res.json()) as Record<string, any>;
  const status = String(r.Status ?? "");
  return {
    reportId: Number(r.ReportId ?? reportId),
    status,
    statusId: Number(r.StatusId ?? 0),
    displayStatus: String(r.DisplayStatus ?? status),
    // A report is usable once its delivery files exist, regardless of the
    // header status text (sandbox sample data can lag at "In Process").
    completed: Boolean(r.DeliveryFilesAvailable) || /complete/i.test(status),
    deliveryFilesAvailable: Boolean(r.DeliveryFilesAvailable),
    totalCost: r.TotalCost != null ? Number(r.TotalCost) : null,
    areaSqft: r.Area != null ? Number(r.Area) : null,
    predominantPitch: r.Pitch != null ? String(r.Pitch) : null,
    totalRoofFacets: r.TotalRoofFacets != null ? Number(r.TotalRoofFacets) : null,
    street: r.Street ?? null,
    city: r.City ?? null,
    state: r.State ?? null,
    zip: r.Zip ?? null,
    raw: r,
  };
}

// Fetch the EV Measurement JSON (the geometry export). Returns the parsed,
// app-friendly RoofModel.
export async function getMeasurementModel(reportId: number): Promise<RoofModel> {
  const res = await evFetch(
    `/v1/File/GetReportFileAnyFormat?fileType=${EV_FILE.MEASUREMENT_JSON}&reportId=${encodeURIComponent(String(reportId))}`,
  );
  if (!res.ok) throw await evError(res, "GetMeasurementJson");
  const raw = await res.json();
  return parseRoofModel(raw, reportId);
}

// Signed/authed download URL for the DXF or PDF (proxied through evFetch by the
// caller; EagleView itself requires the bearer, so these are fetched server-side).
export function reportFilePath(reportId: number, fileType: number): string {
  return `/v1/File/GetReportFileAnyFormat?fileType=${fileType}&reportId=${reportId}`;
}

export async function getReportFile(reportId: number, fileType: number): Promise<Response> {
  return evFetch(reportFilePath(reportId, fileType));
}

// ── Diagnostics ────────────────────────────────────────────────────────────────
// Connection health for the roof estimator. Returns NON-secret status only —
// hosts, HTTP codes, error text, product counts — NEVER the token or the
// client id/secret. Lets a manager see, in production, whether the key works and
// (critically) whether calls hit the SANDBOX host or the PRODUCTION host.
export interface EvDiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface EvDiagnostics {
  configured: boolean;
  apiBase: string;
  tokenBase: string;
  isSandboxApi: boolean;
  checks: EvDiagnosticCheck[];
}

export async function runEagleViewDiagnostics(): Promise<EvDiagnostics> {
  const apiBase = API_BASE;
  const tokenBase = TOKEN_BASE;
  const isSandboxApi = /sandbox/i.test(apiBase);
  const checks: EvDiagnosticCheck[] = [];
  const configured = isEagleViewEnabled();

  if (!configured) {
    checks.push({
      name: "Credentials",
      ok: false,
      detail: "EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET are not set.",
    });
    return { configured, apiBase, tokenBase, isSandboxApi, checks };
  }
  checks.push({ name: "Credentials present", ok: true, detail: "CLIENT_ID and CLIENT_SECRET are set." });

  // 1) OAuth token — minted on the token host (always the production apicenter).
  try {
    await getToken();
    checks.push({ name: "OAuth token", ok: true, detail: `Minted OK against ${tokenBase}.` });
  } catch (e: unknown) {
    checks.push({
      name: "OAuth token",
      ok: false,
      detail: `Failed against ${tokenBase}: ${e instanceof Error ? e.message : "unknown error"}`,
    });
    return { configured, apiBase, tokenBase, isSandboxApi, checks };
  }

  // 2) A real, NON-billable API call against the API host. Proves the key is
  //    valid AND that we're pointed at the right host: a production key hitting
  //    the sandbox host (or vice-versa) fails here with a 401/403.
  try {
    const res = await evFetch("/v2/Product/GetAvailableProducts");
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const count = Array.isArray(data) ? data.length : "?";
      checks.push({
        name: "API call · GetAvailableProducts",
        ok: true,
        detail: `HTTP ${res.status} · ${count} products · host ${apiBase}`,
      });
    } else {
      const body = await res.text().catch(() => "");
      checks.push({
        name: "API call · GetAvailableProducts",
        ok: false,
        detail: `HTTP ${res.status} · host ${apiBase}${body ? ` · ${body.slice(0, 160)}` : ""}`,
      });
    }
  } catch (e: unknown) {
    checks.push({
      name: "API call · GetAvailableProducts",
      ok: false,
      detail: `Request threw: ${e instanceof Error ? e.message : "unknown"} · host ${apiBase}`,
    });
  }

  return { configured, apiBase, tokenBase, isSandboxApi, checks };
}

// ── Measurement-JSON parser ───────────────────────────────────────────────────
// Shape (XML-as-JSON, "@"-prefixed attributes):
//   EAGLEVIEW_EXPORT.STRUCTURES.ROOF[].{ POINTS.POINT[], LINES.LINE[], FACES.FACE[] }
//   POINT  @id, @data:"x,y,z" (feet)
//   LINE   @id, @path:"C5,C6", @type: EAVE|RIDGE|VALLEY|RAKE|HIP|FLASHING|STEPFLASH|OTHER
//   FACE   @designator, @type: ROOF|ROOFPENETRATION, POLYGON{ @path, @pitch, @unroundedsize, @orientation }

export type EvLineType =
  | "EAVE"
  | "RIDGE"
  | "VALLEY"
  | "RAKE"
  | "HIP"
  | "FLASHING"
  | "STEPFLASH"
  | "OTHER";

export const EV_LINE_TYPES: EvLineType[] = [
  "EAVE",
  "RIDGE",
  "VALLEY",
  "RAKE",
  "HIP",
  "FLASHING",
  "STEPFLASH",
  "OTHER",
];

export interface RoofPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}
export interface RoofLine {
  id: string;
  type: EvLineType;
  aId: string;
  bId: string;
  lengthFt: number;
}
export interface RoofFace {
  id: string;
  designator: string;
  pitch: number; //       rise per 12 (e.g. 10 = 10/12)
  areaSqft: number;
  orientation: number; // degrees
  lineIds: string[];
  /**
   * По-гранный провенанс сшивки (приказ 2026-08-30): «fill» — грань не
   * измерена по DSM (нет доверенного кластера с опорой), её плоскостная
   * невязка не судится R03, площадь идёт в «заполнено». Модель несёт свой
   * провенанс сама — оба валидатора читают его из одного места.
   */
  provenance?: "measured-dsm" | "fill";
}
// Where a model's geometry came from. "eagleview" is an ordered, human-QC'd
// report — contract-grade. "synthetic" is reconstructed from Google Solar DSM
// imagery (src/lib/roofRecon.ts): free and instant, but an ESTIMATE, and gated
// out of the pricing path in the estimator UI.
// "instant" = reconstructed facets calibrated to EagleView Instant Property
// Data (numbers are EagleView's) — priceable, unlike a bare "synthetic" model.
export type RoofModelSource = "eagleview" | "synthetic" | "instant";

export interface RoofProvenance {
  imageryQuality: string; //  Solar API HIGH / MEDIUM / LOW
  imageryDate?: string; //    e.g. "2023-07-11" — can be years stale
  pixelSizeM: number; //      DSM ground sample distance
  facetsFound: number;
  facetsDropped: number;
}

export interface RoofModel {
  /** Разрешающая ширина измерения (полное окно нормалей DSM-реконструкции,
   *  ft): грань уже неё — лента ниже разрешения, собственного уклона не
   *  несёт (R04 её не судит). Присутствует только у измеренных моделей. */
  resolutionFt?: number;
  reportId?: number;
  source?: RoofModelSource; //     absent = "eagleview" (all pre-existing models)
  provenance?: RoofProvenance; // synthetic models only
  location: {
    address?: string;
    city?: string;
    state?: string;
    postal?: string;
    lat?: number;
    lng?: number;
  };
  northOrientation: number;
  points: RoofPoint[];
  lines: RoofLine[];
  faces: RoofFace[]; //        ROOF facets only
  penetrations: RoofFace[]; // ROOFPENETRATION (chimneys/vents)
  totals: {
    areaSqft: number;
    squares: number;
    facetCount: number;
    predominantPitch: number;
    footageByType: Record<EvLineType, number>;
    bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  };
}

// xml-as-json collapses single-element arrays to a bare object — normalize.
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
const num = (v: unknown): number => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
const normLineType = (t: unknown): EvLineType => {
  const u = String(t ?? "").toUpperCase();
  return (EV_LINE_TYPES as string[]).includes(u) ? (u as EvLineType) : "OTHER";
};

export function parseRoofModel(raw: any, reportId?: number): RoofModel {
  const root = raw?.EAGLEVIEW_EXPORT ?? raw;
  const loc = root?.LOCATION ?? {};
  const structuresNode = root?.STRUCTURES ?? {};

  // Normalize structures. Single-structure reports put ROOF directly on
  // STRUCTURES ({ @northorientation, ROOF }); multi-structure reports make
  // STRUCTURES an array (xml→json) of such entries (sometimes a numeric-keyed
  // object). Flatten every structure's ROOF(s) into one list.
  const structureList: any[] = Array.isArray(structuresNode)
    ? structuresNode
    : (structuresNode as any).ROOF
      ? [structuresNode]
      : Object.keys(structuresNode)
          .filter((k) => /^\d+$/.test(k))
          .map((k) => (structuresNode as any)[k]);
  const roofs: any[] = [];
  for (const st of structureList) for (const roof of toArray<any>(st?.ROOF)) roofs.push(roof);

  let northOrientation = num((structuresNode as any)["@northorientation"]);
  if (!northOrientation) {
    for (const st of structureList) {
      const n = num(st?.["@northorientation"]);
      if (n) {
        northOrientation = n;
        break;
      }
    }
  }

  const points: RoofPoint[] = [];
  const lines: RoofLine[] = [];
  const faces: RoofFace[] = [];
  const penetrations: RoofFace[] = [];

  // Multiple structures keep their own C/L/F id namespaces; prefix per structure
  // so ids stay unique once merged into one model.
  roofs.forEach((roof, si) => {
    const pfx = roofs.length > 1 ? `s${si}:` : "";
    const ptMap = new Map<string, RoofPoint>();

    for (const pt of toArray<any>(roof?.POINTS?.POINT)) {
      const [x, y, z] = String(pt["@data"] ?? "")
        .split(",")
        .map((s) => num(s));
      const p: RoofPoint = { id: pfx + pt["@id"], x, y, z };
      ptMap.set(p.id, p);
      points.push(p);
    }

    for (const ln of toArray<any>(roof?.LINES?.LINE)) {
      const [a, b] = String(ln["@path"] ?? "")
        .split(",")
        .map((s) => pfx + s.trim());
      const pa = ptMap.get(a);
      const pb = ptMap.get(b);
      const lengthFt =
        pa && pb
          ? Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)
          : 0;
      lines.push({ id: pfx + ln["@id"], type: normLineType(ln["@type"]), aId: a, bId: b, lengthFt });
    }

    for (const fc of toArray<any>(roof?.FACES?.FACE)) {
      const poly = Array.isArray(fc.POLYGON) ? fc.POLYGON[0] : fc.POLYGON;
      const face: RoofFace = {
        id: pfx + fc["@id"],
        designator: String(fc["@designator"] ?? ""),
        pitch: num(poly?.["@pitch"]),
        areaSqft: num(poly?.["@unroundedsize"] ?? poly?.["@size"]),
        orientation: num(poly?.["@orientation"]),
        lineIds: String(poly?.["@path"] ?? "")
          .split(",")
          .filter(Boolean)
          .map((s) => pfx + s.trim()),
      };
      if (String(fc["@type"]).toUpperCase() === "ROOFPENETRATION") penetrations.push(face);
      else faces.push(face);
    }
  });

  // Totals.
  const footageByType = Object.fromEntries(EV_LINE_TYPES.map((t) => [t, 0])) as Record<
    EvLineType,
    number
  >;
  for (const l of lines) footageByType[l.type] += l.lengthFt;

  const areaSqft = faces.reduce((a, f) => a + f.areaSqft, 0);

  // Predominant pitch = the pitch value covering the most roof area.
  const pitchArea = new Map<number, number>();
  for (const f of faces) pitchArea.set(f.pitch, (pitchArea.get(f.pitch) ?? 0) + f.areaSqft);
  let predominantPitch = 0;
  let maxA = -1;
  for (const [pitch, a] of pitchArea) {
    if (a > maxA) {
      maxA = a;
      predominantPitch = pitch;
    }
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const zs = points.map((p) => p.z);
  const bounds = {
    minX: Math.min(...xs, 0),
    maxX: Math.max(...xs, 0),
    minY: Math.min(...ys, 0),
    maxY: Math.max(...ys, 0),
    minZ: Math.min(...zs, 0),
    maxZ: Math.max(...zs, 0),
  };

  return {
    reportId,
    location: {
      address: loc["@address"],
      city: loc["@city"],
      state: loc["@state"],
      postal: loc["@postal"],
      lat: loc["@lat"] != null ? num(loc["@lat"]) : undefined,
      lng: loc["@long"] != null ? num(loc["@long"]) : undefined,
    },
    northOrientation,
    points,
    lines,
    faces,
    penetrations,
    totals: {
      areaSqft,
      squares: areaSqft / 100,
      facetCount: faces.length,
      predominantPitch,
      footageByType,
      bounds,
    },
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// PROPERTY DATA API — instant roof data (production).
//
// This is EagleView's NEW platform (apis.eagleview.com), a different API from
// the Measurement Orders endpoints above: POST /property/v2/request starts an
// asynchronous lookup, GET /property/v2/result/{id} returns it — normally
// within seconds ("instant data"). Auth is the same OAuth token as above.
//
// What it returns is per-structure SUMMARY data — roof area, squares,
// predominant pitch, eave heights, the building outline, material / condition /
// age classifiers, chimney / solar / rooftop-AC flags and imagery tokens — not
// the points/lines/faces geometry a Measurement Orders report carries. The roof
// diagram therefore takes its NUMBERS from here and its facet geometry from the
// aerial reconstruction (src/lib/roofDiagram/calibrate.ts).
//
// Billing: every request that completes spends Property Data credits on the
// production account. There is no free sandbox path for these credentials —
// EagleView's Property Data sandbox needs separate sandbox keys, and these are
// production keys (the sandbox host rejects them by name).
// ═════════════════════════════════════════════════════════════════════════════

const PROPERTY_API_BASE =
  process.env.EAGLEVIEW_PROPERTY_API_BASE_URL || "https://apis.eagleview.com";

/** Property Data "data packs" — the productIds a request may ask for. */
export const PD_PACK = {
  ROOF_AREA: "property_data_id_001",
  PITCH_EAVE: "property_data_id_002",
  MATERIAL_CONDITION: "property_data_id_003",
  ROOF_AGE: "property_data_id_004",
  PROPERTY_DETAILS: "property_data_id_005",
  RISK: "property_data_id_006",
  OUTLINES: "property_data_id_007",
  ORTHO: "property_data_id_008",
  OBLIQUE: "property_data_id_009",
} as const;
export type PdPack = (typeof PD_PACK)[keyof typeof PD_PACK];

/** The two packs the plain "instant figures" call needs. */
export const PD_FIGURE_PACKS: PdPack[] = [PD_PACK.ROOF_AREA, PD_PACK.PITCH_EAVE];

/** The Instant ledger's address key: upper-cased, whitespace-collapsed, equality only. */
export function instantAddressKey(input: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  return [input.address, input.city, input.state, input.zip]
    .map((part) => (part ?? "").toUpperCase().replace(/\s+/g, " ").trim())
    .join("|");
}

/**
 * EagleView refused an order because the ACCOUNT is not entitled to one or
 * more of the packs asked for (HTTP 403, errorCode 10880 "No active
 * entitlement found for one or more products requested in 'product_ids'", or
 * 10036 "missing or incomplete entitlement"). A fact about the credentials,
 * not the address — the caller records it per pack and orders around it.
 * Nothing was billed: EagleView rejects the whole request.
 */
export class PdEntitlementError extends Error {
  constructor(
    message: string,
    readonly packs: readonly PdPack[],
    readonly errorCode: number | null,
    readonly httpStatus = 403,
  ) {
    super(message);
    this.name = "PdEntitlementError";
  }
}

/** EagleView's entitlement error codes: 10880 / 10036 seen in the field (403), 10640 documented (400). */
const PD_ENTITLEMENT_CODES = new Set([10640, 10880, 10036]);

/**
 * Whether a refused Property Data order is an ENTITLEMENT refusal, and which.
 * Any 403 is one (that is how it has always arrived, "explicit deny" included).
 * A 400 is one only when it says so — by code or in words — because a 400 is
 * also what a malformed request gets (10017 empty address, 10875 bad format).
 * Exported for the QA check; null = some other failure.
 */
export function pdEntitlementRefusal(httpStatus: number | undefined, message: string): { status: number; code: number | null } | null {
  const m = message.match(/"errorCode"\s*:\s*(\d+)/);
  const code = m ? Number(m[1]) : null;
  if (httpStatus === 403) return { status: 403, code };
  if (httpStatus === 400 && ((code != null && PD_ENTITLEMENT_CODES.has(code)) || /entitle/i.test(message))) return { status: 400, code };
  return null;
}
/** Everything the roof diagram consumes: figures + outline + flags + ortho. */
export const PD_DIAGRAM_PACKS: PdPack[] = [
  PD_PACK.ROOF_AREA,
  PD_PACK.PITCH_EAVE,
  PD_PACK.MATERIAL_CONDITION,
  PD_PACK.ROOF_AGE,
  PD_PACK.PROPERTY_DETAILS,
  PD_PACK.OUTLINES,
  PD_PACK.ORTHO,
];

export interface InstantStructure {
  areaSqft: number | null;
  squares: number | null;
  /** e.g. "10/12" (the API says value 10, unit "over 12") */
  pitch: string | null;
  /** feet, keyed by facade (E/N/S/W); null when the pack returned nothing */
  eaveHeightFt: Record<string, number> | null;
  /** Ground footprint, square feet. */
  footprintSqft: number | null;
  /** Building outline as lat/lng (EPSG:4326), closed ring; null without pack 007. */
  outline: Array<{ lat: number; lng: number }> | null;
  facetCount: number | null;
  /** Classifiers (pack 003/005); null when unknown. */
  shape: string | null;
  material: string | null;
  conditionRating: string | null;
  roofAgeYears: number | null;
  chimney: boolean | null;
  solarPanels: boolean | null;
  rooftopAcCount: number | null;
  /**
   * EagleView's OWN statement of how much of this roof it could see:
   * `roof_occlusion_none` | `..._minor` | `..._major` (their vocabulary — kept
   * verbatim, never re-scaled here). Null when the classifier is absent.
   * This is a second opinion on the same question our DSM coverage answers.
   */
  occlusion: string | null;
  /** Likewise for canopy over the roof: `tree_overhang_none|_minor|_major`. */
  treeOverhang: string | null;
  /**
   * Per-field confidence exactly as EagleView scored it, keyed by OUR field
   * name. Their `-1` means "not scored" and is dropped rather than recorded as
   * zero confidence. Every one of these used to be thrown away by the value
   * getters, which read `.value` and nothing else — including the 0.189 on
   * `structure_roof_facet_count` that the vertex budget was trusting blindly.
   */
  confidence: Record<string, number> | null;
  /**
   * One polygon per roof MATERIAL — a second, independent outline of the same
   * roof, free in every response. Not a facet segmentation: one material means
   * one polygon. Used only to CHECK the outline we draw from, never to replace
   * it.
   */
  materialRings: Array<{
    material: string | null;
    areaSqft: number | null;
    ring: Array<{ lat: number; lng: number }>;
  }> | null;
}

export interface InstantImage {
  token: string;
  /** "ortho" | "oblique" */
  view: string;
  /** oblique only: north | east | south | west */
  cardinal?: string;
  /** ortho only: neighbours blurred */
  masked?: boolean;
  shotDate?: string;
  /** [minLon, minLat, maxLon, maxLat], EPSG:4326 */
  bbox: [number, number, number, number] | null;
}

export interface InstantRoofData {
  requestId: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  structures: InstantStructure[];
  /** Imagery tokens (fetch bytes with fetchPropertyImage); empty without packs 008/009. */
  imagery: InstantImage[];
  /**
   * EagleView could not place the address at all ("Invalid address", EVPD-10101):
   * no structures, coordinates 0,0. Absent on every other answer, and on rows
   * saved before 2026-10-26 — instantAddressNotFound reads those too.
   */
  notFound?: true;
  totals: {
    areaSqft: number;
    squares: number;
    /** rise per 12 of the largest structure, or null when unparseable */
    predominantPitch: number | null;
    pitchLabel: string | null;
    /** tallest reported eave, feet */
    maxEaveFt: number | null;
    facetCount: number | null;
    footprintSqft: number | null;
  };
}

// Loose result envelope — only the paths the parser reads.
interface PdValue {
  value?: unknown;
  unit?: unknown;
  confidence?: unknown;
}
interface PdResult {
  request?: { status?: string };
  structures?: unknown[];
  response_address?: { full_address?: string };
  response_coordinates?: { lat?: number; lon?: number };
  imagery?: Record<string, { image_token?: string; metadata?: Record<string, unknown> }>;
  info?: { code?: string; message?: string };
}

/** EagleView's own code for an address it could not place (seen 2026-10-26, ticket 8KETUL). */
const PD_INVALID_ADDRESS = "EVPD-10101";

/**
 * Whether an answer says the address was not found. Rows saved before the
 * `notFound` flag carry the same answer as no structures, an empty address and
 * coordinates 0,0 — read that too, so a stored refusal never reads as "no roof".
 */
export function instantAddressNotFound(instant: Pick<InstantRoofData, "notFound" | "structures" | "address" | "lat" | "lng"> | null | undefined): boolean {
  if (!instant) return false;
  if (instant.notFound) return true;
  return !instant.structures?.length && !instant.address && instant.lat === 0 && instant.lng === 0;
}

// Unknown is not zero: Number(null), Number("") and Number(false) all produce
// 0, which then prevents a later pack from filling the missing field.
const pdNumber = (raw: unknown): number | null => {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
// {value, unit, confidence} → number
const pdNum = (v: unknown): number | null => pdNumber((v as PdValue | undefined)?.value);

/** Area in square feet. Unitless legacy fields retain their named unit;
 * an explicit, unfamiliar unit stays unknown rather than being mislabeled. */
const pdAreaSqft = (v: unknown, defaultUnit: "sqft" | "squares" = "sqft"): number | null => {
  const n = pdNum(v);
  if (n == null || n < 0) return null;
  const rawUnit = (v as PdValue | undefined)?.unit;
  if (rawUnit != null && typeof rawUnit !== "string") return null;
  const unit = typeof rawUnit === "string" && rawUnit.trim()
    ? rawUnit.toLowerCase().replace(/²/g, "2").replace(/[\s._^\-]/g, "")
    : defaultUnit;
  if (["sqft", "ft2", "sqfeet", "sqfoot", "squarefeet", "squarefoot"].includes(unit)) return n;
  if (["sqm", "m2", "sqmeters", "sqmetres", "squaremeter", "squaremeters", "squaremetre", "squaremetres"].includes(unit)) {
    return n / (0.3048 * 0.3048);
  }
  if (["square", "squares", "roofingsquare", "roofingsquares"].includes(unit)) return n * 100;
  return null;
};
// classifier → string, with the API's "null"/"unknown" spellings folded to null
const pdStr = (v: unknown): string | null => {
  const raw = (v as PdValue | undefined)?.value;
  if (raw == null) return null;
  const s = String(raw).trim();
  return !s || /^(null|unknown|none)$/i.test(s) ? null : s;
};
// yes/no classifier → boolean
const pdBool = (v: unknown): boolean | null => {
  const s = pdStr(v);
  if (s == null) return null;
  if (/^(yes|true|present)$/i.test(s)) return true;
  if (/^(no|false|absent)$/i.test(s)) return false;
  return null;
};
/**
 * The confidence EagleView attached to a field. Their sentinel for "we did not
 * score this" is -1, which must not be read as zero confidence; anything
 * outside 0..1 is discarded the same way.
 */
const pdConf = (v: unknown): number | null => {
  const n = pdNumber((v as PdValue | undefined)?.confidence);
  return n != null && n >= 0 && n <= 1 ? n : null;
};
// The API splits pitch across the pair — { value: 10, unit: "over 12" } —
// and some responses inline it ("10 over 12"). Normalize both to "10/12".
const pdPitch = (v: unknown): string | null => {
  const o = v as PdValue | null;
  if (typeof o?.value !== "number" && typeof o?.value !== "string") return null;
  if (typeof o.value === "string" && !o.value.trim()) return null;
  const m = `${o.value} ${o.unit ?? ""}`.match(/(\d+(?:\.\d+)?)\s*over\s*(\d+)/i);
  if (m) return `${m[1]}/${m[2]}`;
  const n = pdNumber(o.value);
  return n != null ? `${n}/12` : String(o.value);
};
// GeoJSON-style [[lon,lat],…] outer ring → lat/lng ring
const pdRing = (geom: unknown): Array<{ lat: number; lng: number }> | null => {
  const g = geom as { type?: string; coordinates?: unknown } | undefined;
  const coords = g?.coordinates;
  if (!Array.isArray(coords)) return null;
  // Polygon: [ring, ...holes]; MultiPolygon: [[ring,...],...] — take the first outer ring.
  const ring = (g?.type === "MultiPolygon" ? (coords[0] as unknown[])?.[0] : coords[0]) as unknown;
  if (!Array.isArray(ring)) return null;
  const pts = ring
    .map((p) => (Array.isArray(p) && p.length >= 2 ? { lng: Number(p[0]), lat: Number(p[1]) } : null))
    .filter((p): p is { lng: number; lat: number } => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return pts.length >= 3 ? pts : null;
};

/** Confidence for every scored field, keyed by the name WE use for it. */
function confidenceOf(roof: Record<string, unknown>, st: Record<string, unknown>): Record<string, number> | null {
  const pairs: Array<[string, unknown]> = [
    ["areaSqft", roof.structure_roof_area],
    ["squares", roof.structure_roof_area_squares],
    ["pitch", roof.structure_roof_predominant_pitch],
    ["facetCount", roof.structure_roof_facet_count],
    ["shape", roof.structure_roof_shape],
    ["material", roof.structure_roof_material_primary],
    ["conditionRating", roof.structure_roof_condition_rating],
    ["roofAgeYears", roof.structure_roof_age],
    ["solarPanels", roof.structure_roof_solar_panel_presence],
    ["rooftopAcCount", roof.structure_roof_air_conditioner_count],
    ["occlusion", roof.structure_roof_occlusion_classification],
    ["treeOverhang", roof.structure_tree_overhang_classification],
    ["eaveHeightFt", st.structure_eave_height],
    ["footprintSqft", st.structure_footprint_sqft],
    ["chimney", st.structure_chimney_presence],
  ];
  const out: Record<string, number> = {};
  for (const [name, v] of pairs) {
    const c = pdConf(v);
    if (c != null) out[name] = c;
  }
  return Object.keys(out).length ? out : null;
}

/** The per-material polygons, as lat/lng rings. */
function materialRingsOf(v: unknown): InstantStructure["materialRings"] {
  if (!Array.isArray(v)) return null;
  const out: NonNullable<InstantStructure["materialRings"]> = [];
  for (const entry of v) {
    const e = (entry ?? {}) as { geometry?: unknown; area?: unknown; value?: unknown };
    const ring = pdRing(e.geometry);
    if (!ring) continue;
    out.push({
      material: typeof e.value === "string" ? e.value : null,
      areaSqft: pdAreaSqft(e.area),
      ring,
    });
  }
  return out.length ? out : null;
}

/**
 * Every Property Data key we have ever SEEN — read or deliberately left alone —
 * catalogued from a full nine-pack capture of 419 Prairie Ridge Ln on
 * 2026-08-23 (the only raw body that survived; see ROOF-STATE). Anything
 * arriving outside these sets is NEW, and `unknownPdKeys` says so in the log.
 *
 * This exists because the parser reads 31 paths through a 5-key inline cast and
 * silently drops the rest: without this check, EagleView could start returning
 * facet geometry tomorrow and nothing would notice. The sets are deliberately
 * generous — the point is to surface the genuinely new, not to nag about the
 * fields we already decided not to read.
 */
const PD_SEEN_ROOT = new Set([
  // read
  "request", "structures", "response_address", "response_coordinates", "imagery",
  // seen, not read — property-level products (useful for sales, not geometry)
  "input", "property_images", "pool", "trampoline", "info",
  "property_driveway_condition_rating", "property_lawn_condition_rating",
  "property_fence_presence", "property_fence_material_combustibility",
  "property_yard_debris", "property_accessory_structure_roof_condition_rating",
]);
const PD_SEEN_STRUCTURE = new Set([
  "roof", "structure_eave_height", "structure_geometry", "structure_footprint_sqft",
  "structure_chimney_presence",
  // seen, not read — every response since 2026-09-09 (audit 2026-11-12)
  "structure_centroid",
  "structure_images", "structure_wildfire_mitigation_rating", "structure_setback",
  "structure_hail_vulnerability_rating", "structure_hail_loss_severity_rating",
  "structure_vegetation_setback", "structure_density_zones", "structure_count_zones",
  "structure_wood_deck_presence", "structure_wildfire_vulnerability_rating",
  "vegetation_coverage_zones",
]);
const PD_SEEN_ROOF = new Set([
  "structure_roof_area", "structure_roof_area_squares", "structure_roof_predominant_pitch",
  "structure_roof_facet_count", "structure_roof_shape", "structure_roof_material_primary",
  "structure_roof_condition_rating", "structure_roof_age",
  "structure_roof_solar_panel_presence", "structure_roof_air_conditioner_count",
  "structure_roof_occlusion_classification", "structure_tree_overhang_classification",
  "structure_roof_materials", "structure_roof_condition_elements",
  "structure_roof_extension", "structure_roof_evaporative_cooler_count",
]);
const PD_SEEN_IMAGE_META = new Set(["bbox", "view", "cardinal_direction", "masked", "shot_date"]);

/**
 * Key paths in this response that our catalogue has never seen. Empty is the
 * normal answer; anything else is EagleView shipping something new, and the
 * first place facet geometry would appear if it ever arrives.
 */
export function unknownPdKeys(raw: unknown): string[] {
  const out: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!PD_SEEN_ROOT.has(k)) out.push(k);
  const structures = Array.isArray(r.structures) ? r.structures : [];
  structures.forEach((entry, i) => {
    const st = (entry ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(st)) if (!PD_SEEN_STRUCTURE.has(k)) out.push(`structures[${i}].${k}`);
    const roof = (st.roof ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(roof)) if (!PD_SEEN_ROOF.has(k)) out.push(`structures[${i}].roof.${k}`);
  });
  const imagery = (r.imagery ?? {}) as Record<string, { metadata?: Record<string, unknown> }>;
  const firstImg = Object.values(imagery)[0];
  for (const k of Object.keys(firstImg?.metadata ?? {})) {
    if (!PD_SEEN_IMAGE_META.has(k)) out.push(`imagery.*.metadata.${k}`);
  }
  return out;
}

/**
 * Exported so a STORED raw body (InstantOrder.instantRawJson) can be re-parsed
 * later without paying again — the reason for keeping it at all. A parser
 * change can now be replayed over every body we have.
 */
export function parseInstantResult(raw: PdResult, requestId: string, input: EvOrderInput, completeAddress: string): InstantRoofData {
  const structures: InstantStructure[] = (Array.isArray(raw.structures) ? raw.structures : []).map(
    (entry) => {
      const s = (entry ?? {}) as {
        roof?: Record<string, unknown>;
        structure_eave_height?: PdValue;
        structure_geometry?: unknown;
        structure_footprint_sqft?: unknown;
        structure_chimney_presence?: unknown;
      };
      const roof = s.roof ?? {};
      const eaveRaw = s.structure_eave_height?.value;
      let eave: Record<string, number> | null = null;
      if (eaveRaw && typeof eaveRaw === "object") {
        // Number(null) is 0 — a facade the API left null must be dropped, not
        // reported as a zero-foot eave.
        const entries = Object.entries(eaveRaw as Record<string, unknown>)
          .map(([k, v]) => [k, pdNumber(v)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] != null);
        if (entries.length) eave = Object.fromEntries(entries);
      }
      const areaSqft = pdAreaSqft(roof.structure_roof_area);
      const squaresAreaSqft = pdAreaSqft(roof.structure_roof_area_squares, "squares");
      return {
        areaSqft: areaSqft ?? squaresAreaSqft,
        squares: squaresAreaSqft != null ? squaresAreaSqft / 100 : areaSqft != null ? areaSqft / 100 : null,
        pitch: pdPitch(roof.structure_roof_predominant_pitch),
        eaveHeightFt: eave,
        footprintSqft: pdAreaSqft(s.structure_footprint_sqft),
        outline: pdRing(s.structure_geometry),
        facetCount: pdNum(roof.structure_roof_facet_count),
        shape: pdStr(roof.structure_roof_shape),
        material: pdStr(roof.structure_roof_material_primary),
        conditionRating: pdStr(roof.structure_roof_condition_rating),
        roofAgeYears: pdNum(roof.structure_roof_age),
        chimney: pdBool(s.structure_chimney_presence),
        solarPanels: pdBool(roof.structure_roof_solar_panel_presence),
        rooftopAcCount: pdNum(roof.structure_roof_air_conditioner_count),
        occlusion: pdStr(roof.structure_roof_occlusion_classification),
        treeOverhang: pdStr(roof.structure_tree_overhang_classification),
        confidence: confidenceOf(roof, s),
        materialRings: materialRingsOf(roof.structure_roof_materials),
      };
    },
  );

  const imagery: InstantImage[] = [];
  for (const img of Object.values(raw.imagery ?? {})) {
    if (!img?.image_token) continue;
    const md = (img.metadata ?? {}) as Record<string, unknown>;
    const bb = (md.bbox as { value?: unknown } | undefined)?.value;
    const bbox =
      Array.isArray(bb) && bb.length === 4 && bb.every((n) => Number.isFinite(Number(n)))
        ? (bb.map(Number) as [number, number, number, number])
        : null;
    imagery.push({
      token: String(img.image_token),
      view: String(md.view ?? ""),
      cardinal: md.cardinal_direction != null ? String(md.cardinal_direction) : undefined,
      masked: typeof md.masked === "boolean" ? md.masked : undefined,
      shotDate: md.shot_date != null ? String(md.shot_date) : undefined,
      bbox,
    });
  }

  return {
    requestId,
    address: raw.response_address?.full_address ?? (completeAddress || null),
    lat: raw.response_coordinates?.lat ?? input.lat ?? null,
    lng: raw.response_coordinates?.lon ?? input.lng ?? null,
    structures,
    imagery,
    ...(raw.info?.code === PD_INVALID_ADDRESS && !structures.length ? { notFound: true as const } : {}),
    totals: instantTotalsOf(structures),
  };
}

/** The totals block lives in lib/roofDiagram/instantTotals (client-safe) so the
 *  page and the persisted row derive the same numbers by the same rule; it is
 *  re-exported here for the server callers that always imported it from here. */
export { instantTotalsOf };

/** An exact outline identity, independent of the ring's start and winding.
 * No rounding or proximity matching: nearby buildings must not be merged. */
function instantOutlineKey(ring: InstantStructure["outline"]): string | null {
  if (!ring || ring.length < 3) return null;
  if (ring.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return null;
  const points = ring.map((p) => `${p.lat},${p.lng}`);
  if (points[0] === points[points.length - 1]) points.pop();
  if (points.length < 3) return null;
  const rotations = (ps: string[]) => ps.map((_, i) => [...ps.slice(i), ...ps.slice(0, i)].join(";"));
  return [...rotations(points), ...rotations(points.slice().reverse())].sort()[0];
}

/** Reorder only when every building has one unique, exact counterpart.
 * Packs without outlines still have no trustworthy identity beyond their
 * existing position; partial or approximate matches cannot establish one. */
function alignInstantStructures(reference: readonly InstantStructure[], incoming: readonly InstantStructure[]): readonly InstantStructure[] {
  if (reference.length !== incoming.length || !reference.length) return incoming;
  const referenceKeys = reference.map((s) => instantOutlineKey(s.outline));
  const incomingKeys = incoming.map((s) => instantOutlineKey(s.outline));
  if (referenceKeys.some((k) => k == null) || incomingKeys.some((k) => k == null)) return incoming;
  if (new Set(referenceKeys).size !== reference.length || new Set(incomingKeys).size !== incoming.length) return incoming;
  const byOutline = new Map(incomingKeys.map((key, i) => [key, incoming[i]]));
  if (referenceKeys.some((key) => !byOutline.has(key))) return incoming;
  return referenceKeys.map((key) => byOutline.get(key)!);
}

/**
 * One answer out of several pack orders for the same address (2026-09-08,
 * partial entitlement). The first part is the base — the caller puts the
 * roof-area order (pack 001) there. Exact, unique outlines align structures
 * when available; without them the existing positional match is retained.
 * Every unknown field takes the first later part's non-null value; confidence
 * is merged by field as each pack scores different measurements.
 * Imagery is concatenated and de-duplicated by token. Totals are re-derived
 * from the merged structures, never copied from a part.
 */
export function mergeInstantResults(parts: readonly InstantRoofData[]): InstantRoofData {
  const [base, ...rest] = parts;
  if (!base) throw new Error("mergeInstantResults: nothing to merge");
  if (!rest.length) return base;
  const structures = base.structures.map((s) => ({ ...s }));
  for (const part of rest) {
    const aligned = alignInstantStructures(structures, part.structures);
    aligned.forEach((incoming, i) => {
      if (!structures[i]) {
        structures.push({ ...incoming });
        return;
      }
      const out = structures[i] as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(incoming)) {
        if (k === "confidence" && v != null) {
          out.confidence = { ...incoming.confidence, ...structures[i].confidence };
          continue;
        }
        if (out[k] == null && v != null) out[k] = v;
      }
    });
  }
  const seen = new Set<string>();
  const imagery = parts.flatMap((p) => p.imagery).filter((im) => (seen.has(im.token) ? false : (seen.add(im.token), true)));
  return {
    requestId: base.requestId,
    address: base.address ?? rest.find((p) => p.address)?.address ?? null,
    lat: base.lat ?? rest.find((p) => p.lat != null)?.lat ?? null,
    lng: base.lng ?? rest.find((p) => p.lng != null)?.lng ?? null,
    structures,
    imagery,
    ...(base.notFound ? { notFound: true as const } : {}),
    totals: instantTotalsOf(structures),
  };
}

/** EagleView's display address for an order — also what parseInstantResult falls back on. */
export const instantCompleteAddress = (input: EvOrderInput): string =>
  [input.address, input.city, input.state, input.zip].filter(Boolean).join(", ");

/**
 * Submit a Property Data order and return the moment EagleView accepts it.
 * From that moment the lookup is ORDERED — and by EagleView's model billable —
 * whether or not anyone waits for the result. The caller must record the
 * requestId durably BEFORE polling; a discarded id is a paid result nobody can
 * ever fetch (this is exactly what happened twice on 12117 202nd St SE).
 * The POST carries its own 20 s ceiling — it used to be the one uncovered
 * stage of the paid path, able to hang a user for minutes.
 *
 * IT IS DELIBERATELY NOT RETRIED, unlike every other EagleView call. This POST
 * PLACES A BILLED ORDER, and a timeout does not say whether it was placed —
 * that is the whole reason the catch below says "may or may not have been".
 * Asking again could buy the same roof twice. Retrying would need an
 * idempotency key from EagleView, and there is no evidence they support one.
 * The safe failure is to stop and let the ledger's recovery path collect any
 * order that did land.
 */
export async function submitInstantOrder(
  input: EvOrderInput,
  packs: PdPack[] = PD_FIGURE_PACKS,
): Promise<{ requestId: string; completeAddress: string; packs: PdPack[] }> {
  const token = await getToken();
  // Prefer the address (their geocoder resolves it); coordinates back it up.
  const completeAddress = instantCompleteAddress(input);
  const body =
    completeAddress.length > 0
      ? { address: { completeAddress }, productIds: packs }
      : // Coordinates ride in their OWN object, not inside `address` — the
        // documented shape (developer.eagleview.com, Property Data v2 guides);
        // `{ address: { lat, lon } }` is refused with 400 10875 "multi-line
        // format is not as expected" (verified 2026-09-08).
        { coordinates: { lat: input.lat, lon: input.lng }, productIds: packs };
  const identity = eagleViewIdentity();
  evDebug("property request", { ...identity, packs, address: completeAddress || `${input.lat},${input.lng}` });

  let res: Response;
  try {
    // attempts = 1, and that is the point — see the doc comment above: this
    // POST places a billed order, and a timeout does not say whether it landed.
    res = await evRequest(
      `${PROPERTY_API_BASE}/property/v2/request`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "property request",
      1,
    );
  } catch (err) {
    if (err instanceof EagleViewUnavailableError && err.kind === "timeout") {
      throw new Error("Property Data order submission timed out after 20 s — the order may or may not have been placed.");
    }
    if (err instanceof EagleViewUnavailableError && err.httpStatus === 401 && /sandbox app credentials/i.test(err.message)) {
      throw new Error(
        "These EagleView credentials are for the other environment — Property Data requests must match the account (production keys → apis.eagleview.com).",
      );
    }
    // ENTITLEMENT (403, errorCode 10880 / 10036 / "explicit deny"). EagleView
    // refuses the WHOLE order when any one pack is not entitled, and a refusal
    // is not billed. Verified 2026-09-08 against org 347167560: 001 + 002
    // (roof area, pitch + eave) are entitled, so the entitlement is PARTIAL.
    // The refusal is therefore typed, per pack, and the caller
    // (lib/eagleviewOrder) buys pack by pack — no retry happens here, so that
    // one place decides what is ordered and records the verdict per pack.
    // TWO SHAPES OF THE SAME REFUSAL (2026-11-12). What we saw in the field
    // through 2026-11-06 is 403 / 10880 or 10036; EagleView's own guide (Data
    // Packs, 2026-04-01 onwards) documents 400 / 10640. Before this, a 400 /
    // 10640 fell through as a plain failure: the planner recorded nothing, the
    // pack's old "denied" stood, and a re-check could never reach a verdict.
    const entitlement = err instanceof EagleViewUnavailableError ? pdEntitlementRefusal(err.httpStatus, err.message) : null;
    if (err instanceof EagleViewUnavailableError && entitlement) {
      evDebug("property request REFUSED (entitlement)", { ...identity, packs, detail: err.message.slice(0, 300) });
      const code = entitlement.code;
      throw new PdEntitlementError(
        `EagleView refused the Property Data request for ${packs.join(", ")} (${entitlement.status}${code != null ? ` / ${code}` : ""}): ` +
          `this account is not entitled to one or more of these packs. Account org ${identity.org ?? "?"}, client ${identity.clientId}, host ${identity.propertyHost}. ` +
          "Entitlements are switched on per product in the EagleView developer portal (My Apps → this app → Property Data).",
        packs,
        code,
        entitlement.status,
      );
    }
    evDebug("property request FAILED", { ...identity, packs, error: (err as Error)?.message?.slice(0, 300) });
    throw err;
  }
  const accepted = (await res.json()) as { request?: { id?: string; status?: string } };
  const requestId = accepted?.request?.id;
  if (!requestId) throw new Error("Property Data returned no request id");
  evDebug("property request accepted", { requestId, packs, status: accepted.request?.status });
  // An accepted order is a billed one: one ROOF when it carries the area pack (the detail packs that follow for the
  // same address are the same roof — $2.40 whatever packs it takes, lib/paidApiCosts).
  if (packs.includes(PD_PACK.ROOF_AREA)) await notePaidCall("eagleview", "roof");
  return { requestId, completeAddress, packs };
}

/**
 * Poll result/{requestId} until Complete, a terminal failure, or the ceiling.
 * Returns null while the order is genuinely still processing — the order is
 * NOT lost, only not ready; ask again later with the same id. Throws on
 * failed/rejected/cancelled status and on transport errors.
 */
export async function pollInstantResult(
  requestId: string,
  input: EvOrderInput,
  completeAddress: string,
  maxWaitMs = 30_000,
  opts: {
    /**
     * The response body EXACTLY as EagleView sent it, handed over the moment
     * the order completes, before anything is parsed away.
     *
     * The parser reads 31 paths and drops the rest — including every field's
     * `confidence`, the roof-material polygon and the occlusion classifiers —
     * and until this callback existed the raw body went out of scope and was
     * gone. Two paid lookups can never be re-examined because of that. A caller
     * that can persist it SHOULD: it is the only audit trail of what was
     * actually bought, and the only way a new EagleView field (facet geometry,
     * one day) can be noticed after the fact rather than never.
     */
    onRaw?: (body: string, unknownKeys: string[]) => void;
  } = {},
): Promise<InstantRoofData | null> {
  const token = await getToken();
  const deadline = Date.now() + maxWaitMs;
  let first = true;
  do {
    if (maxWaitMs > 0) await new Promise((r) => setTimeout(r, first ? 1500 : 2000));
    first = false;
    // Idempotent: fetching a result cannot place or change an order, so a
    // hung poll is safe to ask again. The 202 that means "not ready yet" is
    // passed through by evRequest rather than treated as a failure.
    const rr = await evRequest(
      `${PROPERTY_API_BASE}/property/v2/result/${requestId}`,
      { headers: { Authorization: `Bearer ${token}` } },
      "property result",
    );
    // Read the body as TEXT first: `res.json()` would leave nothing to keep.
    const body = await rr.text().catch(() => "");
    let data: PdResult | null = null;
    try {
      data = body ? (JSON.parse(body) as PdResult) : null;
    } catch {
      data = null;
    }
    const status = String(data?.request?.status ?? "");
    if (/complete/i.test(status)) {
      const unknown = unknownPdKeys(data);
      if (unknown.length) {
        console.warn(
          "[eagleview] Property Data order %s returned %d field(s) this codebase has never seen: %s — check whether they carry geometry before ignoring them",
          requestId, unknown.length, unknown.join(", "),
        );
      }
      try {
        opts.onRaw?.(body, unknown);
      } catch (err) {
        // keeping the body is a convenience; it must never fail a paid lookup
        console.warn("[eagleview] raw-body handler threw:", err instanceof Error ? err.message : err);
      }
      return parseInstantResult(data as PdResult, requestId, input, completeAddress);
    }
    if (/fail|error|reject|cancel/i.test(status)) throw new Error(`Property Data request ${status}`);
  } while (Date.now() < deadline);
  return null;
}

/**
 * Order + wait, in one call — the QA harnesses' entry point. The product
 * action does NOT use this: it records the requestId between the two steps
 * (src/actions/roofMeasurement.ts) so a poll timeout cannot orphan a paid
 * order. Here the timeout error at least carries the id, so a harness run
 * that gives up leaves something recoverable in its output.
 */
export async function requestInstantRoofData(
  input: EvOrderInput,
  packs: PdPack[] = PD_FIGURE_PACKS,
  opts: { onRaw?: (body: string, unknownKeys: string[]) => void } = {},
): Promise<InstantRoofData> {
  const { requestId, completeAddress } = await submitInstantOrder(input, packs);
  const parsed = await pollInstantResult(requestId, input, completeAddress, 30_000, opts);
  if (!parsed) {
    throw new Error(
      `Property Data is taking longer than expected — try again in a minute. (order ${requestId} is still processing and can be fetched later)`,
    );
  }
  return parsed;
}

/** Fetch one Property Data image (ortho / oblique PNG) by its token. */
export async function fetchPropertyImage(
  imageToken: string,
  opts: { attempts?: number } = {},
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const token = await getToken();
  const res = await evRequest(
    `${PROPERTY_API_BASE}/property/v2/image/${encodeURIComponent(imageToken)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    "property image",
    opts.attempts,
  );
  return { bytes: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png" };
}
