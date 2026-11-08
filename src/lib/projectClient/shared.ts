// THE CLIENT'S PROJECT PAGE AND FILES — the rules (the client build, 2026-11-06). Pure.
//
//   · the file kinds — what a project keeps: the contract, the permit, the plans, the warranty, an invoice.
//   · what a file may be — an image or a PDF uploaded (8 MB, a server action's limit), or a link to where it lives.
//   · the words — the page's progress line, the update's text, the next days.
//   · the homeowner's and the lender's words (2026-11-08, the plan "Projects: Remodel and New construction", part 7):
//     what closes a phase, when a choice is needed by, the photos under their phase, a draw as the borrower and the
//     lender read it (never the office's "ready to request"), cost-plus in the client's words.

import { drawWords, type DrawRead } from "@/lib/projectDraws/shared";

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

// ── the homeowner's and the lender's words (part 7, 2026-11-08) ──────────────

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const utcDays = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

export type ClientPhaseLike = {
  status: "PLANNED" | "ACTIVE" | "DONE";
  gateKind: string;
  gateWords: string | null;
  holding: ReadonlyArray<{ name: string; result: string; date: string | null }>;
  stageCount: number;
  stagesDone: number;
};

/** "Framing" → "Framing inspection"; a name that already says inspection stays. */
export function inspectionNoun(name: string): string {
  return /inspection/i.test(name) ? name : `${name} inspection`;
}

/** What closes the phase, in the homeowner's words: "done" · "Framing inspection booked Nov 12" · "Framing inspection
 *  ahead" · "Framing inspection to be redone" · "closes with your sign-off" · "closes with the lender's OK" — and ""
 *  while the phase is still ahead. Never the office's "waits on" or "holds the stage". */
export function clientGateWords(p: ClientPhaseLike): string {
  if (p.status === "DONE") return "done";
  if (p.status === "PLANNED") return "";
  if (p.gateKind === "INSPECTION") {
    if (!p.holding.length) return p.stageCount > 0 && p.stagesDone === p.stageCount ? "inspections passed" : "";
    return p.holding.map((g) => `${inspectionNoun(g.name)} ${g.result === "FAILED" ? "to be redone" : g.date ? `booked ${shortDay(g.date)}` : "ahead"}`).join(" · ");
  }
  if (p.gateKind === "LENDER") return "closes with the lender's OK";
  return "closes with your sign-off";
}

/** When a choice is needed by, for the homeowner: "needed by Nov 20" · "needed by Nov 20 — soon" (within a week) ·
 *  "needed by Nov 20 — past due" · "the date comes with the schedule" while the stage has no days. */
export function clientDueWords(due: string | null, today: string): string {
  if (!due) return "the date comes with the schedule";
  const days = utcDays(due) - utcDays(today);
  const d = shortDay(due);
  if (days < 0) return `needed by ${d} — past due`;
  if (days <= 7) return `needed by ${d} — soon`;
  return `needed by ${d}`;
}

export type WindowStage = { phaseId: string | null; lane: string | null; startsAt: string | null; endsAt: string | null; doneAt: string | null; position: number };
export type PhaseNameLike = { id: string; name: string; position: number };

/** The photos under the phase whose stage was under way the day each was taken: a stage's window runs from its first
 *  day to the day it was closed (or its planned last day); the house's own stages win over a Site or Shop lane's. The
 *  photos that fall in no window come last, under no name. The groups follow the phases' order. */
export function photosByPhase<P extends { at: string }>(photos: readonly P[], stages: readonly WindowStage[], phases: readonly PhaseNameLike[], dayOf: (iso: string) => string): Array<{ phase: string | null; photos: P[] }> {
  const windows = [...stages]
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.phaseId && s.startsAt)
    .map((s) => ({ phaseId: s.phaseId!, lane: s.lane, from: s.startsAt!.slice(0, 10), to: s.doneAt ? dayOf(s.doneAt) : (s.endsAt ?? s.startsAt!).slice(0, 10) }));
  const groups = new Map<string | null, P[]>();
  for (const ph of photos) {
    const day = dayOf(ph.at);
    const hits = windows.filter((w) => w.from <= day && day <= w.to);
    const hit = hits.find((w) => !w.lane) ?? hits[0] ?? null;
    const key = hit ? hit.phaseId : null;
    groups.set(key, [...(groups.get(key) ?? []), ph]);
  }
  const out: Array<{ phase: string | null; photos: P[] }> = [];
  for (const p of [...phases].sort((a, b) => a.position - b.position)) {
    const mine = groups.get(p.id);
    if (mine?.length) out.push({ phase: p.name, photos: mine });
  }
  const loose = groups.get(null);
  if (loose?.length) out.push({ phase: null, photos: loose });
  return out;
}

/** A draw as the borrower and the lender read it — never the office's "ready to request" or "waits on": "planned —
 *  after Foundation" · "requested Nov 5 · $58,500 to come" · "funded Dec 20 · $6,500 held". */
export function lenderDrawWords(d: DrawRead): string {
  if (d.state === "PLANNED") return `planned${d.phase ? ` — after ${d.phase.name}` : ""}`;
  return drawWords(d);
}

/** Cost-plus in the client's words — the one contract where the client sees the costs. */
export function costPlusWords(s: { feeAmount: number | null; marginPct: number | null }): string {
  const fee = s.feeAmount != null ? `a ${dollars(s.feeAmount)} fee` : s.marginPct != null ? `a ${s.marginPct}% fee` : "the agreed fee";
  return `Your contract is cost-plus: you pay the costs as they come, plus ${fee}.`;
}
