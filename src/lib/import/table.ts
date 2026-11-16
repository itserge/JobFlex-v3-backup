// A FILE AS A TABLE (2026-11-16, bringing a contractor's book over from another program — lib/import) — pure.
//
// The other programs hand their data out as CSV (Housecall Pro, Jobber, ServiceTitan, Google Contacts…) or Excel. Here
// a file's words become one table: its header row and its rows, every row as wide as the header.
//
//   · the separator is found, not assumed: a comma, a semicolon (Europe's Excel), a tab (a sheet pasted) or a bar;
//   · quoted cells keep their commas, their line breaks and their doubled quotes ("12"" pipe");
//   · a report's title lines above the table ("Jobs report", "Nov 1 – Nov 30") are stepped over: the header is the
//     first row that is as wide as the table and reads as names, not numbers;
//   · rows with nothing in them are dropped; cells are trimmed.

export interface Table {
  headers: string[];
  rows: string[][];
  /** Each row's line in the file as the person sees it (1 = the first line), so a skipped row can be found there. */
  lines?: number[];
  /** The file has more rows than MAX_TABLE_ROWS: only the first ones were read, and the page says so. */
  more?: boolean;
}

/** The most rows one file brings in (a contractor's whole book, ten years of jobs). */
export const MAX_TABLE_ROWS = 25_000;

const SEPARATORS = [",", ";", "\t", "|"] as const;

/** Every row of `text` split on `sep`, quotes honoured. */
function splitRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > MAX_TABLE_ROWS + 50) break;
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim()));
}

/** The separator that splits the first lines into the most, and the same number of, cells. */
function pickSeparator(text: string): string {
  const head = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best: string = ",";
  let bestScore = -1;
  for (const sep of SEPARATORS) {
    const counts = head.map((l) => splitRows(l, sep)[0]?.length ?? 1);
    const most = Math.max(1, ...counts);
    if (most < 2) continue;
    // How many lines share the widest count: a real separator gives the table's every line one width.
    const steady = counts.filter((n) => n === most).length;
    const score = steady * 100 + most;
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

/** A cell that reads as a column's name: words, not a number, a date or an amount. */
const nameLike = (c: string) => /[a-z]/i.test(c) && !/^[\d\s$€£.,:/()+-]+$/.test(c) && c.length <= 80;

/** Rows (already split) as a table: the header found, every row padded or cut to its width, empty rows dropped. */
export function tableOf(raw: string[][]): Table {
  const kept = raw.map((r, i) => ({ r, line: i + 1 })).filter(({ r }) => r.some((c) => c !== ""));
  const rows = kept.map((k) => k.r);
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.slice(0, 60).map((r) => r.filter((c) => c !== "").length));
  // The header: within the first twenty rows, the first that fills most of the table's width with names.
  let h = 0;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const filled = rows[i].filter((c) => c !== "");
    if (filled.length >= Math.max(2, Math.ceil(width * 0.6)) && filled.filter(nameLike).length >= filled.length * 0.7) {
      h = i;
      break;
    }
  }
  const headerRow = rows[h];
  // Trailing empty header cells with nothing under them are no columns.
  let cols = headerRow.length;
  while (cols > 1 && !headerRow[cols - 1] && !rows.slice(h + 1, h + 200).some((r) => (r[cols - 1] ?? "") !== "")) cols--;
  const seen = new Map<string, number>();
  const headers = headerRow.slice(0, cols).map((c, i) => {
    const name = c || `Column ${i + 1}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    return n > 1 ? `${name} (${n})` : name;
  });
  // The splitter and the Excel reader stop a little past the ceiling, so a file that holds more is told by its count.
  const more = kept.length - (h + 1) > MAX_TABLE_ROWS;
  const body = kept
    .slice(h + 1, h + 1 + MAX_TABLE_ROWS)
    .map(({ r, line }) => ({ r: Array.from({ length: cols }, (_, i) => r[i] ?? ""), line }))
    .filter(({ r }) => r.some((c) => c !== ""))
    // A row that repeats the header (a report printed in pages) is no row.
    .filter(({ r }) => r.join("\u0001").toLowerCase() !== headers.join("\u0001").toLowerCase());
  return { headers, rows: body.map((b) => b.r), lines: body.map((b) => b.line), ...(more ? { more } : {}) };
}

/** CSV, TSV or any delimited text as a table. */
export function parseDelimited(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) return { headers: [], rows: [] };
  return tableOf(splitRows(clean, pickSeparator(clean)));
}
