// THE CREW IN THE FIELD — the pure half (the crew build, 2026-11-05): hours, problems flagged from site, the
// crew's tasks and deliveries on a job, the crew's own day. Words and arithmetic only; the database half is
// ./server.ts.

/** Hours typed by the crew: a quarter-hour grid, never more than a day. */
export function tidyHours(raw: number | string | null | undefined): number | null {
  const n = typeof raw === "string" ? Number(raw.replace(/[^\d.]/g, "")) : raw;
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(24, Math.round(n * 4) / 4);
}

/** "8 h" / "7.5 h". */
export function hoursWords(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/\.?0+$/, "")} h`;
}

/** Labor from hours: each row at the rate it was typed with; a row with no rate costs nothing (the office sets rates). */
export function hoursCost(rows: ReadonlyArray<{ hours: number; rate: number | null }>): number {
  return Math.round(rows.reduce((n, r) => n + (r.rate && r.rate > 0 ? r.hours * r.rate : 0), 0) * 100) / 100;
}

/** The week a day belongs to, Monday to Sunday, as "YYYY-MM-DD" keys (the company's day keys). */
export function weekOf(dayKey: string): { from: string; to: string } {
  const d = new Date(`${dayKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const from = new Date(d.getTime() - dow * 86_400_000);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** What a flagged problem reads as on the list and the project: the first words, and whether it stopped the work. */
export function flagWords(f: { note: string; blocking: boolean; jobTitle?: string | null }): string {
  const note = f.note.trim().replace(/\s+/g, " ");
  const short = note.length > 60 ? `${note.slice(0, 57).trimEnd()}…` : note;
  return `${f.blocking ? "Work stopped" : "Problem"}${f.jobTitle ? ` on ${f.jobTitle}` : ""}: ${short}`;
}

export type FieldFlag = { kind: "problem"; text: string };

/** The project's flag for open problems, the blocking ones first. */
export function problemFlags(flags: ReadonlyArray<{ note: string; blocking: boolean; jobTitle?: string | null; status: string }>): FieldFlag[] {
  const open = flags.filter((f) => f.status === "OPEN");
  if (!open.length) return [];
  const worst = open.find((f) => f.blocking) ?? open[0];
  return [{ kind: "problem", text: open.length === 1 ? flagWords(worst) : `${open.length} problems on site — ${flagWords(worst)}` }];
}
