// SUBCONTRACTOR DOCUMENTS — the rules (2026-11-08, the subcontractors plan, part 1). Pure: what a document may be
// (a PDF or a picture, up to 25 MB), its kinds and their labels, where it lives in the private store, and the words
// the pages use for a file. The database half is ./server.ts; the browser's upload is ./client.ts.

export const DOC_KINDS = ["QUOTE", "INVOICE", "CONTRACT", "WAIVER", "INSURANCE", "W9", "PLAN", "OTHER"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  QUOTE: "Estimate",
  INVOICE: "Invoice",
  CONTRACT: "Contract",
  WAIVER: "Lien waiver",
  INSURANCE: "Insurance certificate",
  W9: "W-9",
  PLAN: "Drawing",
  OTHER: "Document",
};

export function docKindOf(s: string | null | undefined): DocKind {
  const up = (s ?? "").toUpperCase();
  return (DOC_KINDS as readonly string[]).includes(up) ? (up as DocKind) : "OTHER";
}

/** What a sub's document may be: a PDF or a picture of the pages. */
export const DOC_TYPES: readonly string[] = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const DOC_ACCEPT = DOC_TYPES.join(",");
/** 25 MB — a scanned estimate of twenty pages fits; a plan set does not belong here. */
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

const EXT_TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };

/** The content type a file is sent as — by its declared type, else by its name's extension; null when it is neither
 *  a PDF nor a picture. */
export function docTypeOf(contentType: string | null | undefined, name: string | null | undefined): string | null {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (DOC_TYPES.includes(t)) return t;
  const ext = ((name ?? "").split(".").pop() ?? "").toLowerCase();
  return EXT_TYPES[ext] ?? null;
}

export const isPdfType = (t: string | null | undefined) => (t ?? "").toLowerCase() === "application/pdf";
export const isPictureType = (t: string | null | undefined) => (t ?? "").toLowerCase().startsWith("image/");

/** "2.4 MB" / "640 KB". */
export function docSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A file's name cleaned for the store and the page: letters, digits, dots, dashes; 80 characters. */
export function safeDocName(name: string | null | undefined, fallback = "document.pdf"): string {
  const base = (name ?? "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80);
  return base || fallback;
}

/** Where a sub's documents live in the store: subs/<org>/<project or company>/<stamp>-<name>. */
export function docPathname(organizationId: string, projectId: string | null, name: string): string {
  return `subs/${organizationId}/${projectId ?? "company"}/${Date.now()}-${safeDocName(name)}`;
}

/** "V3" — a version's short label. */
export const versionLabel = (n: number) => `V${n}`;

/** The words a document row reads as: "Electrical_Proposal.pdf · 2.4 MB · PDF". */
export function docWords(d: { name: string; bytes: number | null; contentType: string | null }): string {
  const size = docSize(d.bytes);
  const kind = isPdfType(d.contentType) ? "PDF" : isPictureType(d.contentType) ? "picture" : null;
  return [d.name, size, kind].filter(Boolean).join(" · ");
}
