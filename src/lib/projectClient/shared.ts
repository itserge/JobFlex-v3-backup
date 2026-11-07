// THE CLIENT'S PROJECT PAGE AND FILES — the rules (the client build, 2026-11-06). Pure.
//
//   · the file kinds — what a project keeps: the contract, the permit, the plans, the warranty, an invoice.
//   · what a file may be — an image or a PDF uploaded (8 MB, a server action's limit), or a link to where it lives.
//   · the words — the page's progress line, the update's text, the next days.

export const FILE_KINDS = ["CONTRACT", "PERMIT", "PLAN", "WARRANTY", "INVOICE", "OTHER"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  CONTRACT: "Contract",
  PERMIT: "Permit",
  PLAN: "Plans",
  WARRANTY: "Warranty",
  INVOICE: "Invoice",
  OTHER: "Document",
};

export function fileKindOf(s: string | null | undefined): FileKind {
  const up = (s ?? "").toUpperCase();
  return (FILE_KINDS as readonly string[]).includes(up) ? (up as FileKind) : "OTHER";
}

/** A kind read off a file's name: "Permit card.pdf" → PERMIT, "Signed contract" → CONTRACT. */
export function guessFileKind(name: string): FileKind {
  const s = name.toLowerCase();
  if (/permit|inspection card/.test(s)) return "PERMIT";
  if (/contract|agreement|signed/.test(s)) return "CONTRACT";
  if (/plan|drawing|blueprint|layout|elevation|design/.test(s)) return "PLAN";
  if (/warrant/.test(s)) return "WARRANTY";
  if (/invoice|receipt|bill\b/.test(s)) return "INVOICE";
  return "OTHER";
}

/** What an upload may be: an image or a PDF, as a data URL. */
export const FILE_DATA_URL = /^data:(image\/(png|jpe?g|webp|gif|heic|heif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
export const FILE_MAX_BYTES = 8 * 1024 * 1024;

/** A link the office pasted: http(s) only. */
export function safeFileLink(raw: string): string | null {
  const s = raw.trim();
  return /^https?:\/\/\S+$/i.test(s) && s.length <= 2000 ? s : null;
}

export function bytesWords(n: number | null | undefined): string | null {
  if (!n) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "40% done · on Drywall and paint" / "Every stage done" / "Getting started". */
export function progressWords(done: number | null, stageNow: string | null): string {
  if (done == null) return "Getting started";
  if (done >= 100 || !stageNow) return "Every stage done";
  return `${done}% done · on ${stageNow}`;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Mon, Nov 9 and Tue, Nov 10" from the next days on site. */
export function nextDaysWords(days: ReadonlyArray<string>): string | null {
  const d = [...new Set(days)].sort().slice(0, 3);
  if (!d.length) return null;
  const labels = d.map(dayLabel);
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The text message with the update — short, the link last. */
export function clientUpdateText(input: { company: string; project: string; progress: string; next: string | null; note: string | null; link: string }): string {
  const parts = [`${input.company}: ${input.project} — ${input.progress}.`];
  if (input.next) parts.push(`Next on site: ${input.next}.`);
  if (input.note) parts.push(input.note.trim().slice(0, 160));
  parts.push(`Your project page: ${input.link}`);
  return parts.join(" ");
}
