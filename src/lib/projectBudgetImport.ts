// A BUDGET BROUGHT IN (owner, 2026-11-07: "someone has already preliminary budget like in a text message or in a
// notes or in a file, or it's was from the bank … make option to upload budget like with the file or paste and you
// would create the rows for the budgets from that sheet. And make it super smart").
//
// The rules that read pasted words into budget rows, and the tidying every read goes through — the rules' own and
// the model's (lib/projectBudgetRead). Pure: no database, no model, no framework; the card runs none of it itself.
//
//   one row per cost line — its own name kept ("Electrical", "Cabinets"); a line named like one of the six
//                           (materials, labor, subs, permits, equipment, other) lands on the six;
//   the amount as written — $12,500 · 12.5k · 1.2M · a range's high end · quantity × unit price · a share of the rest
//                           (contingency 10%);
//   left out, unticked    — the contractor's own fee or profit (the margin, not a cost), payments, draws, deposits,
//                           the loan, credits. Totals are never rows: the file's total is kept to check the rows by;
//   tables                — CSV, a spreadsheet's tabs, a PDF's columns, a "|" table: the budget column found by its
//                           head (a lender's sheet carries Paid / This draw / Remaining beside it), a Category column
//                           grouped when its names repeat.

import { MAX_KINDS, isBudgetCategory, normalizeKind } from "./projectBudget";

/** One row read from a budget, as the card shows it before anything is saved. */
export type ImportRow = {
  /** The line's own name, tidied ("Electrical", "Site work & excavation") — at most 40 characters. */
  name: string;
  /** The key it saves under: one of the six, or its own name (lib/projectBudget customKinds). */
  kind: string;
  amount: number;
  /** Ticked: it goes into the budget. A fee, a payment or a credit comes unticked, with the reason in `note`. */
  include: boolean;
  /** How the amount was found, or why the row is unticked. */
  note?: string;
  /** The model's figure isn't in the words as written — the card marks it to be checked (lib/projectBudgetRead). */
  check?: boolean;
  /** A range's low end, when the amount is its high end ("6-7k"). */
  low?: number;
};

export type BudgetRead = {
  rows: ImportRow[];
  /** The budget's own total ("Total", "Grand total"), to check the rows against; null when it states none. */
  statedTotal: number | null;
  /** Where the rows came from: the rules below, the model, or nothing could be read. */
  source: "rules" | "ai" | "none";
  /** One or two sentences for the card: what was read, whether it adds up, what was left out. */
  words: string;
};

/** A row on its way: before the duplicates are added together and the shares worked out. */
export type RawRow = { name: string; amount: number; include?: boolean; note?: string; pct?: number; check?: boolean; low?: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
export const dollarsText = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// ── names ──

/** Words kept in capitals when a shouting line is turned to Title case. */
const ACRONYMS = new Set(["HVAC", "ADU", "MEP", "GC", "LVP", "LVT", "PEX", "ABS", "PVC", "OSB", "CMU", "EV", "AC", "DIY", "TI", "CO", "A/C", "O&P", "OH&P", "R/R", "R&R"]);
const SMALL = new Set(["and", "or", "of", "the", "a", "an", "for", "to", "with", "&"]);
/** Filler a text message puts between a name and its amount ("electrical is about 12k"). */
const TRAIL = /(?:\s+|^)(?:is|are|was|were|be|will|would|should|could|about|around|approx\.?|approximately|roughly|maybe|probably|est\.?|estimated|estimate|budget(?:ed)?|for|at|of|costs?|cost me|runs?|came to|comes to|came in at|quoted|quote|=|:|~|@|\$|usd)\s*$/i;

/** A budget line's name tidied for a row: no bullet, number, code, leader dots or filler; Title case for a shouting
 *  line; at most 40 characters, cut at a word. Empty when there are no letters in it. */
export function tidyName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/\.{3,}|…+|_{3,}|-{3,}|·{2,}/g, " ");
  // Bullets, list numbers ("1.", "a)"), lender and CSI cost codes ("01-100", "03 30 00", "1000 General …").
  s = s.replace(/^[\s>*•·▪◦‣⁃+\-–—]+/, "");
  s = s.replace(/^\(?\d{1,3}[.)]\s+/, "").replace(/^\(?[a-zA-Z][.)]\s+/, "").replace(/^(?:and|plus|also|then|&)\s+/i, "");
  s = s.replace(/\s*\(?\d+(?:\.\d+)?\s?%\)?\s*$/, "");
  s = s.replace(/^\d{2}[\s.-]\d{2}[\s.-]\d{2}\s+/, "").replace(/^\d{1,3}-\d{2,4}\s+/, "").replace(/^(?!20[2-3]\d\b)\d{3,6}\s+(?=[A-Za-z]{3})(?!(?:sf|sq|ft|lf|amp|gal)\b)/i, "");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/^[\s:=\-–—.,;|*~#]+/, "").replace(/[\s:=\-–—.,;|*~#@(]+$/, "");
    s = s.replace(TRAIL, "");
    if (s === before) break;
  }
  s = s.replace(/\(\s*\)/g, "").replace(/\s+/g, " ").trim();
  if (!/[a-zA-Z]{2}/.test(s)) return "";
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    s = s
      .split(" ")
      .map((w, i) => (ACRONYMS.has(w) ? w : i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(" ");
  }
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (s.length > 40) {
    const cut = s.slice(0, 41);
    const at = cut.lastIndexOf(" ");
    s = (at > 20 ? cut.slice(0, at) : s.slice(0, 40)).replace(/[\s,;:&/-]+$/, "");
  }
  return s;
}

/** A trade named by who does it ("plumber", "the electrician", "tile guy") → the trade, so it lands on the same kind as
 *  every other budget's. */
const TRADE_OF: Array<[RegExp, string]> = [
  [/^(the\s+)?plumbers?('?s)?(\s+(guy|labou?r|work))?$/i, "Plumbing"],
  [/^(the\s+)?electric(ians?('?s)?)?(\s+(guy|labou?r|work))?$/i, "Electrical"],
  [/^(the\s+)?painters?('?s)?(\s+(guy|labou?r))?$/i, "Painting"],
  [/^(the\s+)?framers?('?s)?(\s+(guy|crew|labou?r))?$/i, "Framing"],
  [/^(the\s+)?roofers?('?s)?(\s+(guy|crew|labou?r))?$/i, "Roofing"],
  [/^(the\s+)?(tile\s+(guy|setter|installer)|tilers?)$/i, "Tile"],
  [/^(the\s+)?(drywall(ers?|\s+guy|\s+crew)|sheetrock(ers?)?)$/i, "Drywall"],
  [/^(the\s+)?carpenters?('?s)?$/i, "Carpentry"],
  [/^(the\s+)?(hvac\s+(guy|sub|contractor)|heating\s+guy)$/i, "HVAC"],
  [/^(the\s+)?(concrete\s+(guy|sub|crew)|mason(s|ry\s+guy)?)$/i, "Concrete"],
  [/^(the\s+)?landscapers?$/i, "Landscaping"],
  [/^(the\s+)?(excavator|digger|dirt\s+guy)$/i, "Excavation"],
  [/^(the\s+)?insulators?$/i, "Insulation"],
];
export function tradeName(name: string): string {
  for (const [re, trade] of TRADE_OF) if (re.test(name.trim())) return trade;
  return name;
}

/** The key a row saves under: the six when its name is one of them (or a plain word for one), else its own name. */
export function kindFor(name: string): string {
  const k = normalizeKind(name);
  if (isBudgetCategory(k)) return k;
  const low = name.toLowerCase().trim();
  if (/^(materials?|supplies|materials? (costs?|&\s*supplies|and supplies))$/.test(low)) return "MATERIALS";
  if (/^(labou?r|labou?r costs?|crew|wages|crew labou?r)$/.test(low)) return "LABOR";
  if (/^(sub-?contractors?|subs?|sub-?contracted( work)?|sub costs?)$/.test(low)) return "SUBCONTRACTORS";
  if (/^(permits?|fees|permits? (and|&) fees|permit fees|permitting)$/.test(low)) return "PERMITS";
  if (/^(equipment|rentals?|equipment rentals?|equipment (and|&) rentals?|tools? (and|&) equipment)$/.test(low)) return "EQUIPMENT";
  if (/^(misc\.?|miscellaneous|other|other costs?|misc\.? costs?|extras)$/.test(low)) return "OTHER";
  return k;
}

// ── what a line is ──

/** A total line: "stated" (the budget's whole total), "sub" (a section's), or null (a cost line). */
export function totalKind(name: string): "stated" | "sub" | null {
  const low = name.toLowerCase();
  if (/\bsub-?\s?totals?\b/.test(low)) return "sub";
  if (!/\b(totals?|sum)\b/.test(low)) return null;
  const rest = low.replace(/\b(grand|project|overall|estimated|est|total|totals|sum|cost|costs|budget|construction|estimate|price|amount|all|of|the|job|home|house|build|remodel|contract|hard|soft|for|budgeted|line items?)\b/g, "").replace(/[^a-z]/g, "");
  if (!rest) return /\b(hard|soft)\b/.test(low) ? "sub" : "stated";
  return "sub";
}

const FEE = /\b(profit|overhead|o\s?&\s?p|oh\s?&\s?p|ohp|mark-?up|margin|builder'?s?\s+fee|contractor'?s?\s+fee|gc\s+fee|general\s+contractor'?s?\s+fee|management\s+fee|cm\s+fee|construction\s+management\s+fee|our\s+fee)\b/i;
const PAYMENT = /\b(deposits?|down\s?payments?|draw\s*#?\s*\d*|draws|retainage|retention|paid|payments?|loan(?!\s+(?:fees?|interest|costs?|closing))|financing|appraised|appraisal|equity|owner\s+contribution|balance\s+due|amount\s+due|received)\b/i;
const CREDIT = /\b(credits?|refunds?|discounts?|rebates?)\b/i;

/** Why a line would come unticked: the margin, a payment, a credit — or null for a cost. */
export function leftOutReason(name: string): string | null {
  if (FEE.test(name)) return "The builder's fee or profit — your margin, not a cost. Tick it to keep it in.";
  if (CREDIT.test(name)) return "A credit, not a cost. Tick it to keep it in.";
  if (PAYMENT.test(name)) return "A payment or the loan, not a cost. Tick it if it is one.";
  return null;
}

// ── amounts ──

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const SUFFIX = String.raw`k|K|m|M|mm|MM|mil|million|thousand|grand`;
/** A money-ish number: an optional "(", "$", the number, a k/M suffix. */
const MONEY = new RegExp(String.raw`(\()?(\$\s?|USD\s?)?(${NUM})(?:\s?(${SUFFIX})\b)?(\))?`, "g");
/** What makes a number a quantity, not money: the unit right after it. */
const UNIT_AFTER = /^\s?(?:sf\b|sq\.?\s?ft|square\s+f(?:ee|oo)t|s\.f\.|ft\b|feet|foot|lf\b|l\.f\.|lin\.?\s?ft|in\b|inch|"|'|amps?\b|a\b|v\b|volts?|gal|gallons?|pcs\b|pieces?|ea\b|each\b|hrs?\b|hours?|days?\b|weeks?\b|months?\b|yds?\b|yards?|cy\b|tons?\b|lbs?\b|%|x\s?\d|×|squares?\b|sq\b|bf\b|bd\.?\s?ft|windows?\b|doors?\b|units?\b|sheets?\b|bags?\b|boxes?\b|rolls?\b|cans?\b|studs?\b|posts?\b|panels?\b|people\b|guys?\b|men\b|workers?\b|stories\b|story\b|bed|bath|br\b|ba\b|cars?\b|mm\b|cm\b|m2\b|year|yr|mo\b|psi\b|btu|ton\b|seer|kw|w\b|sets?\b|pairs?\b|lots?\b|acres?)/i;

const SUFFIX_X: Record<string, number> = { k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mm: 1e6, mil: 1e6, million: 1e6 };

/** A number as written ("12,500.00", "12.5k", "1.2M", "$8") → dollars, or null. */
export function moneyOf(raw: string): number | null {
  const m = new RegExp(String.raw`^\s*\(?\s?(?:\$|USD\s?)?\s?(${NUM})\s?(${SUFFIX})?\)?\s*$`).exec(raw.replace(/[−–]/g, "-").replace(/^-\s?/, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return r2(n * (m[2] ? SUFFIX_X[m[2].toLowerCase()] ?? 1 : 1));
}

type Tok = { at: number; end: number; value: number; strong: boolean; credit: boolean; low?: number; unitPrice?: boolean; small?: boolean };

/** Dates, phone numbers, sizes ("2x4", "12x16"), years, "#2" — numbers in a line that are never its money. */
function mask(line: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return line
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, blank)
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, blank)
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, blank)
    .replace(/\b\d+(?:\.\d+)?\s?[x×]\s?\d+(?:\.\d+)?(?:\s?[x×]\s?\d+(?:\.\d+)?)?\b/gi, blank)
    .replace(/#\s?\d[\d-]*/g, blank)
    .replace(/\b(?:phase|stage|step|draw|lot|unit|room|floor|level|line|item|no\.?|option|week|day)\s?\d+\b/gi, blank)
    .replace(/\b\d+\/\d+\b/g, blank);
}

function tokens(line: string): { money: Tok[]; pct: Array<{ at: number; end: number; value: number }>; qty: Array<{ at: number; value: number }> } {
  const masked = mask(line);
  const money: Tok[] = [];
  const qty: Array<{ at: number; value: number }> = [];
  const pct: Array<{ at: number; end: number; value: number }> = [];
  for (const m of masked.matchAll(MONEY)) {
    const at = m.index ?? 0;
    let end = at + m[0].length;
    const raw = m[3];
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    // A letter glued on before it ("R30", "2x") is part of a word.
    if (at > 0 && /[A-Za-z]/.test(masked[at - 1] ?? "") && !m[2]) continue;
    const after = masked.slice(end);
    if (!m[2] && !m[4] && /^\s?%/.test(after)) {
      pct.push({ at, end: end + after.indexOf("%") + 1, value: n / 100 });
      continue;
    }
    if (!m[2] && !m[4] && UNIT_AFTER.test(after)) {
      qty.push({ at, value: n });
      continue;
    }
    // A letter glued on after it ("2nd", "3rd", "4ft") is a word too.
    if (!m[4] && /^[A-Za-z]/.test(after) && !/^(k|m)\b/i.test(after)) continue;
    const dollar = !!m[2];
    const suffix = m[4] ? SUFFIX_X[m[4].toLowerCase()] ?? 1 : 1;
    const value = n * suffix;
    const strong = dollar || suffix > 1 || /,\d{3}/.test(raw) || /\.\d{2}$/.test(raw);
    // A bare small number or a year is a count, a size or a date, not money — unless it opens a range ("6-7k").
    const opensRange = /^\s*(?:-|–|—|to)\s*\$?\d/i.test(after);
    if (!strong && !opensRange && (value < 10 || (value >= 1990 && value <= 2035 && /^\d{4}$/.test(raw)))) continue;
    const credit = !!m[1] && !!m[5];
    if (m[5] && !m[1]) end -= 1;
    // "@ $2.10", "$2.10/sf", "$45 per hour": a unit price.
    const before = masked.slice(Math.max(0, at - 4), at);
    const unitPrice = /@\s*$/.test(before) || /^\s?(?:\/\s?(?:sf|sq|ft|lf|ea|hr|hour|unit|day)|per\s+\w+|each\b|ea\b|a\s+(?:sq|foot|ft|hour))/i.test(after);
    money.push({ at, end, value: r2(value), strong, credit, unitPrice, small: !strong && value < 10 });
  }
  // Ranges: "8-10k", "$8,000 – $10,000", "8 to 10k" — the high end, the low end noted.
  for (let i = 0; i + 1 < money.length; i++) {
    const a = money[i];
    const b = money[i + 1];
    const between = masked.slice(a.end, b.at);
    if (!/^\s*(?:-|–|—|to)\s*$/i.test(between)) continue;
    let low = a.value;
    // "8-10k": the suffix reaches back over a bare number.
    if (!a.strong && b.value >= 1000 && low * 1000 <= b.value) low = low * 1000;
    if (low > b.value) continue;
    money.splice(i, 2, { at: a.at, end: b.end, value: b.value, strong: true, credit: a.credit || b.credit, low });
  }
  return { money: money.filter((m) => !m.small), pct, qty };
}

/** Every amount the words carry (the ends of a range too) — what a model's figure is checked against. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split(/\t|\|/)) {
      const t = tokens(cell);
      for (const m of t.money) {
        out.push(m.value);
        if (m.low != null) out.push(m.low);
      }
      const whole = moneyOf(cell.trim());
      if (whole != null) out.push(whole);
      // A spreadsheet cell's bare number ("4500") is money in an amount column.
      for (const q of t.qty) out.push(q.value);
    }
  }
  return out;
}

// ── one line of words ──

/** The rows one line of words carries: "Electrical 12,500" · "electric 12k, plumbing 8k and drywall 6.5k" ·
 *  "$12,500 – electrical" · "Drywall 3,200 sf @ $2.10" · "Contingency 10%". */
export function readLine(line: string): RawRow[] {
  const { money, pct, qty } = tokens(line);
  // The amounts and the shares ("10%") in the order they come.
  const marks: Array<Tok & { pct?: number }> = [...money, ...pct.map((p) => ({ at: p.at, end: p.end, value: 0, strong: false, credit: false, pct: p.value }))].sort((a, b) => a.at - b.at);
  const lettered = (s: string) => tidyName(s).length > 0;
  // A bare number with words after it and nothing after those is an address or a count in a heading
  // ("BUDGET — 1418 ALDER WAY"), not an amount — when the line has words before it too.
  const last = marks[marks.length - 1];
  if (last && !last.strong && last.pct === undefined && lettered(line.slice(last.end)) && lettered(line.slice(0, last.at))) marks.pop();
  if (!marks.length) return [];
  const textBefore = (i: number) => line.slice(i === 0 ? 0 : marks[i - 1].end, marks[i].at);

  // Amount first ("12k electrical, 8k plumbing"): each amount takes the words after it.
  const amountFirst = !lettered(textBefore(0)) && lettered(line.slice(marks[marks.length - 1].end));
  type Seg = { name: string; toks: typeof marks };
  const segs: Seg[] = [];
  if (amountFirst) {
    marks.forEach((m, i) => {
      const words = line.slice(m.end, i + 1 < marks.length ? marks[i + 1].at : line.length);
      if (lettered(words) || !segs.length) segs.push({ name: words, toks: [m] });
      else segs[segs.length - 1].toks.push(m);
    });
  } else {
    marks.forEach((m, i) => {
      const words = textBefore(i);
      if (lettered(words) || !segs.length) segs.push({ name: words, toks: [m] });
      else segs[segs.length - 1].toks.push(m);
    });
  }

  // A run of three items or more names each in a word or two; a first name far longer than the rest still carries
  // the message's opening ("lee bath tile 4500, vanity 1200, …") — it keeps as many words as the longest of the others.
  const names = segs.map((g) => itemWords(g.name.replace(/\s(?:and|&|plus|\+)\s*$/i, "")).trim());
  if (names.length >= 3) {
    const longest = Math.max(...names.slice(1).map((n) => n.split(/\s+/).length));
    const first = names[0].split(/\s+/);
    if (first.length > longest) names[0] = first.slice(-Math.max(1, longest)).join(" ");
  }
  const out: RawRow[] = [];
  for (const [si, seg] of segs.entries()) {
    const name = tidyName(names[si]);
    if (!name) continue;
    const moneys = seg.toks.filter((t) => t.pct === undefined);
    if (!moneys.length) {
      const p = seg.toks.find((t) => t.pct !== undefined);
      if (p?.pct) out.push({ name, amount: 0, pct: p.pct });
      continue;
    }
    // The line's total is its last strong amount (qty @ price = total); a lone unit price is multiplied out.
    const strong = moneys.filter((t) => t.strong);
    const pick = (strong.length ? strong : moneys)[(strong.length ? strong : moneys).length - 1];
    let amount = pick.value;
    let note: string | undefined;
    if (pick.unitPrice && moneys.length === 1) {
      const q = qty.find((x) => x.at < pick.at);
      if (q) {
        amount = r2(q.value * pick.value);
        note = `${q.value.toLocaleString("en-US")} × ${dollarsText(pick.value)}`;
      } else note = "A unit price — check the amount.";
    }
    if (pick.low != null) note = `${dollarsText(pick.low)}–${dollarsText(pick.value)} — the high end.`;
    const row: RawRow = { name, amount, note, low: pick.low };
    if (pick.credit) {
      row.include = false;
      row.note = "A credit, not a cost. Tick it to keep it in.";
    }
    out.push(row);
  }
  return out;
}

/** Chatter a text message puts before its first item ("hey so for the kessler job electric 12k"). */
const CHATTER = new Set(["hey", "hi", "hello", "so", "ok", "okay", "for", "the", "my", "our", "your", "we", "i", "it", "its", "it's", "job", "project", "budget", "here", "heres", "here's", "what", "like", "need", "needs", "then", "also", "is", "are", "was", "this", "that", "thats", "that's", "think", "looking", "figure", "figured", "guess", "rough", "roughly", "numbers", "number"]);

/** The item a run of words names: after a heading's colon ("Bathroom: tile"), the last clause, and past any chatter
 *  when it runs long. */
function itemWords(raw: string): string {
  let s = raw;
  const colon = s.lastIndexOf(":");
  if (colon >= 0 && tidyName(s.slice(colon + 1))) s = s.slice(colon + 1);
  const clauses = s.split(/[.;!?]\s+|,\s+|\s[-–—]\s/).filter((c) => tidyName(c));
  if (clauses.length) s = clauses[clauses.length - 1];
  s = s.replace(/^[\s,;:.+&\-–—]+/, "").replace(/^(?:and|plus|also|then)\s+/i, "");
  const words = s.trim().split(/\s+/);
  if (words.length > 4) {
    let cut = -1;
    words.forEach((w, i) => {
      if (CHATTER.has(w.toLowerCase().replace(/[^a-z']/g, ""))) cut = i;
    });
    if (cut >= 0 && cut < words.length - 1) s = words.slice(cut + 1).join(" ");
  }
  return s;
}

// ── tables ──

/** One CSV line into its fields (quotes and doubled quotes honored). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** Which way a pasted text is a table: tabs (a spreadsheet, a PDF's columns), "|" (a typed table), CSV — or none. */
function tableShape(lines: string[]): "tab" | "pipe" | "csv" | null {
  const full = lines.filter((l) => l.trim());
  const many = (f: (l: string) => number) => full.filter((l) => f(l) >= 2).length >= Math.max(2, Math.ceil(full.length * 0.4));
  if (many((l) => l.split("\t").filter((c) => c.trim()).length)) return "tab";
  if (many((l) => l.split("|").filter((c) => c.trim()).length)) return "pipe";
  // CSV: three lines or more with the same count of fields, one column mostly numbers — and commas that are not a
  // number's thousands ("Framing 72,000" is a line of words).
  const listy = (l: string) => /,/.test(l.replace(/"[^"]*"/g, "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1"));
  if (full.filter(listy).length < Math.max(3, full.length * 0.6)) return null;
  const rows = full.map(csvFields);
  const counts = new Map<number, number>();
  for (const r of rows) if (r.length >= 2) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const [width, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (width >= 2 && n >= 3 && n >= full.length * 0.6) {
    const same = rows.filter((r) => r.length === width);
    for (let c = 0; c < width; c++) if (same.filter((r) => moneyOf(r[c]) != null).length >= same.length * 0.5) return "csv";
  }
  return null;
}

const NAME_HEAD = /\b(item|items|description|desc|category|categories|trade|trades|line|name|scope|work|phase|division|cost\s?code\s?desc|activity|task|area|what)\b/i;
const CATEGORY_HEAD = /\b(category|categories|trade|trades|division|phase|group|type|kind)\b/i;
/** The heads a budget column goes by, best first; the ones that are never the budget. */
const AMOUNT_HEADS: RegExp[] = [/\b(revised|current|adjusted)\s+(budget|amount|contract)\b/i, /\b(budget|budgeted|scheduled\s+value|sov|contract\s+amount|original\s+budget)\b/i, /\btotal\b/i, /\b(amount|cost|costs|estimate|estimated|price|value|\$)\b/i];
const NOT_AMOUNT = /\b(paid|draws?|previous|prior|this\s+(period|draw|request)|to\s+date|remaining|balance|left|%|percent|complete|retainage|variance|over\/?under|qty|quantity|units?|rate|unit\s+(cost|price)|each|date|invoice|check|vendor|notes?|#|no\.)\b/i;

/** A table's rows: the name column, the budget column, a Category column grouped when it repeats. */
function readTable(rows: string[][]): { rows: RawRow[]; totals: Array<{ kind: "stated" | "sub"; amount: number }> } {
  const out: RawRow[] = [];
  const totals: Array<{ kind: "stated" | "sub"; amount: number }> = [];
  // A PDF's line loses its empty cells ("TOTAL  214,445  14,050  200,395" under Line · Description · Budget · Draw ·
  // Remaining): when the table's last column is money, a shorter row with no empty cell ending in money is set flush
  // right, under the money columns. A spreadsheet's row keeps its empty cells and is left as it is.
  const maxLen = Math.max(...rows.map((r) => r.length));
  const longRows = rows.filter((r) => r.length === maxLen);
  const isMoney = (c: string | undefined) => !!c?.trim() && moneyOf(c.trim()) != null;
  if (longRows.filter((r) => isMoney(r[maxLen - 1])).length >= longRows.length * 0.6) {
    rows = rows.map((r) => (r.length < maxLen && isMoney(r[r.length - 1]) && r.every((c) => c.trim()) ? [...Array<string>(maxLen - r.length).fill(""), ...r] : r));
  }
  const width = maxLen;
  const cell = (r: string[], c: number) => (r[c] ?? "").trim();
  // The head: the first row with words in two cells and no money in any.
  let headAt = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = rows[i];
    const words = r.filter((c) => /[a-zA-Z]{2}/.test(c)).length;
    if (words >= 2 && !r.some((c) => moneyOf(c) != null && /\d/.test(c))) {
      headAt = i;
      break;
    }
  }
  const head = headAt >= 0 ? rows[headAt].map((h) => h.trim()) : [];
  const body = rows.slice(headAt + 1).filter((r) => r.some((c) => c.trim()));
  const moneyShare = (c: number) => body.filter((r) => moneyOf(cell(r, c)) != null && cell(r, c) !== "").length / Math.max(1, body.length);
  const textShare = (c: number) => body.filter((r) => /[a-zA-Z]{2}/.test(cell(r, c))).length / Math.max(1, body.length);

  // The budget column.
  let amountCol = -1;
  if (head.length) {
    for (const re of AMOUNT_HEADS) {
      const c = head.findIndex((h, i) => re.test(h) && !NOT_AMOUNT.test(h.replace(re, "")) && !(re === AMOUNT_HEADS[3] && NOT_AMOUNT.test(h)) && moneyShare(i) > 0.3);
      if (c >= 0) {
        amountCol = c;
        break;
      }
    }
  }
  if (amountCol < 0) {
    // No head names it: the right-most column that is money on most rows and not a column a head rules out.
    for (let c = width - 1; c >= 0; c--) {
      if (head[c] && NOT_AMOUNT.test(head[c])) continue;
      if (moneyShare(c) >= 0.5) {
        amountCol = c;
        break;
      }
    }
  }
  if (amountCol < 0) return { rows: [], totals };

  // The name: a description-like head, else the first mostly-words column; a category column whose names repeat
  // groups the rows ("Electrical" five times → one Electrical row).
  const textCols = [...Array(width).keys()].filter((c) => c !== amountCol && textShare(c) >= 0.5);
  let nameCol = textCols.find((c) => head[c] && NAME_HEAD.test(head[c]) && !CATEGORY_HEAD.test(head[c])) ?? textCols.find((c) => head[c] && NAME_HEAD.test(head[c])) ?? textCols[0] ?? -1;
  const catCol = textCols.find((c) => c !== nameCol && head[c] && CATEGORY_HEAD.test(head[c]));
  // A Category or Trade column is how a budget is kept ("Electrical", "Plumbing") — its rows grouped under it, unless it
  // names only a couple of groups across many rows ("Hard costs" / "Soft costs").
  let grouped = false;
  if (catCol !== undefined) {
    const names = body.map((r) => cell(r, catCol).toLowerCase()).filter(Boolean);
    const distinct = new Set(names).size;
    if (distinct >= 3 || names.length <= 3) {
      nameCol = catCol;
      grouped = true;
    }
  }
  if (nameCol < 0) return { rows: [], totals };

  let section = "";
  for (const r of body) {
    const rawName = cell(r, nameCol) || r.filter((c, i) => i !== amountCol && /[a-zA-Z]{2}/.test(c)).join(" ");
    const name = tidyName(rawName);
    const amount = moneyOf(cell(r, amountCol));
    if (!name) continue;
    if (amount == null || amount === 0) {
      // A row of words alone is a section head ("SITE WORK").
      if (!r.some((c, i) => i !== nameCol && c.trim())) section = name;
      continue;
    }
    const t = totalKind(name) ?? (section && totalKind(`${section} ${name}`) === "stated" ? "sub" : null);
    if (t) {
      totals.push({ kind: t, amount });
      continue;
    }
    const credit = /^\s*\(.*\)\s*$/.test(cell(r, amountCol)) || /^\s*[-−]/.test(cell(r, amountCol));
    const row: RawRow = { name, amount: Math.abs(amount) };
    if (credit) {
      row.include = false;
      row.note = "A credit, not a cost. Tick it to keep it in.";
    }
    if (grouped) row.note = undefined;
    out.push(row);
  }
  return { rows: out, totals };
}

// ── the whole read ──

/** The rows a pasted budget carries — text, a text message, notes, a table — read by the rules alone. */
export function readBudgetText(text: string): { rows: ImportRow[]; statedTotal: number | null } {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[  ]/g, " ")
    .split("\n")
    // Trailing spaces go; trailing tabs stay — they are a spreadsheet's empty cells.
    .map((l) => l.replace(/[ \u00a0]+$/, ""))
    .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l));
  const raw: RawRow[] = [];
  const totals: Array<{ kind: "stated" | "sub"; amount: number }> = [];
  const shape = tableShape(lines);

  if (shape) {
    const split = (l: string) => (shape === "tab" ? l.split("\t") : shape === "pipe" ? l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|") : csvFields(l));
    const isRow = (l: string) => (shape === "csv" ? csvFields(l).length >= 2 : split(l).filter((c) => c.trim()).length >= 2);
    // The table's lines, and any line of words around it read as words.
    const t = readTable(lines.filter(isRow).map(split));
    raw.push(...t.rows);
    totals.push(...t.totals);
    for (const l of lines.filter((l) => l.trim() && !isRow(l))) collect(readLine(l), raw, totals);
  } else {
    for (const l of lines) if (l.trim()) collect(readLine(l), raw, totals);
  }
  const stated = totals.filter((t) => t.kind === "stated").map((t) => t.amount);
  return { rows: finishRows(raw), statedTotal: stated.length ? Math.max(...stated) : null };
}

/** A line's rows into the read: its totals kept apart, the rest as rows. */
function collect(rows: RawRow[], raw: RawRow[], totals: Array<{ kind: "stated" | "sub"; amount: number }>) {
  for (const r of rows) {
    const t = totalKind(r.name);
    if (t && r.pct === undefined) totals.push({ kind: t, amount: r.amount });
    else raw.push(r);
  }
}

/** Every read's last step (the rules' and the model's): names tidied and keyed, the left-out lines unticked, shares
 *  worked out from the rows they ride on, the same name added together, and at most MAX_KINDS rows ticked. */
export function finishRows(raw: RawRow[]): ImportRow[] {
  const rows: Array<ImportRow & { pct?: number }> = [];
  for (const r of raw) {
    const name = tradeName(tidyName(r.name));
    if (!name || totalKind(name)) continue;
    if (!(r.amount > 0) && !r.pct) continue;
    const reason = leftOutReason(name);
    const include = r.include ?? !reason;
    rows.push({ name, kind: kindFor(name), amount: r2(Math.max(0, r.amount)), include, note: r.note ?? (include ? undefined : (reason ?? undefined)), pct: r.pct, check: r.check, ...(r.low != null ? { low: r2(r.low) } : {}) });
  }
  // "Contingency 10%": a share of the ticked cost rows that are not shares themselves.
  const base = rows.filter((r) => r.include && !r.pct).reduce((n, r) => n + r.amount, 0);
  for (const r of rows) {
    if (!r.pct) continue;
    r.amount = r2(base * r.pct);
    r.note = `${Math.round(r.pct * 1000) / 10}% of ${dollarsText(base)}`;
  }
  // The same kind twice (ticked): one row, the amounts added.
  const out: ImportRow[] = [];
  const at = new Map<string, number>();
  const merged = new Map<string, number>();
  for (const r of rows) {
    if (!(r.amount > 0)) continue;
    const key = r.kind.toLowerCase();
    const i = r.include ? at.get(key) : undefined;
    if (i !== undefined) {
      out[i] = { ...out[i], amount: r2(out[i].amount + r.amount), check: out[i].check || r.check };
      merged.set(key, (merged.get(key) ?? 1) + 1);
      continue;
    }
    if (r.include) at.set(key, out.length);
    const { pct: _pct, ...row } = r;
    void _pct;
    out.push(row);
  }
  for (const [key, n] of merged) {
    const i = at.get(key)!;
    out[i] = { ...out[i], note: `${n} lines added together${out[i].note ? ` · ${out[i].note}` : ""}` };
  }
  // A budget can carry more lines than the card holds kinds: past the limit they go under Other, added together.
  const ticked = out.filter((r) => r.include && !isBudgetCategory(r.kind));
  if (ticked.length > MAX_KINDS) {
    const spill = new Set(ticked.slice(MAX_KINDS - 1));
    const extra = [...spill].reduce((n, r) => n + r.amount, 0);
    const kept = out.filter((r) => !spill.has(r));
    const other = kept.find((r) => r.include && r.kind === "OTHER");
    if (other) {
      other.amount = r2(other.amount + extra);
      other.note = `${spill.size} more lines added in`;
    } else kept.push({ name: "Other", kind: "OTHER", amount: r2(extra), include: true, note: `${spill.size} more lines, added together` });
    return kept;
  }
  return out;
}

/** The sum of the ticked rows. */
export const ticked = (rows: ReadonlyArray<Pick<ImportRow, "include" | "amount">>) => r2(rows.filter((r) => r.include).reduce((n, r) => n + r.amount, 0));

/** The card's sentence on a read: how many lines from where, what they add up to, the budget's own total against
 *  them, and what came unticked. */
export function readWords(read: { rows: ImportRow[]; statedTotal: number | null; source: "rules" | "ai" | "none" }, from: string, picture = false): string {
  if (!read.rows.length) return `No budget lines found in ${from}. Each line needs a name and an amount — "Electrical 12,500".`;
  const sum = ticked(read.rows);
  const n = read.rows.filter((r) => r.include).length;
  const parts = [`${n} ${n === 1 ? "line" : "lines"} from ${from} — ${dollarsText(sum)}.`];
  if (read.statedTotal != null) {
    const gap = r2(read.statedTotal - sum);
    if (Math.abs(gap) <= Math.max(1, read.statedTotal * 0.001)) parts.push(`That matches the ${dollarsText(read.statedTotal)} total on it.`);
    else if (gap > 0) {
      // The difference is often exactly what came unticked — the builder's fee on a lender's sheet.
      const outSum = read.rows.filter((r) => !r.include).reduce((n, r) => n + r.amount, 0);
      const names = read.rows.filter((r) => !r.include).map((r) => r.name);
      parts.push(
        Math.abs(outSum - gap) <= Math.max(1, read.statedTotal * 0.001)
          ? `The total on it says ${dollarsText(read.statedTotal)}: the ${dollarsText(gap)} between is the ${names.slice(0, 2).join(" and ")} left out below — tick ${names.length === 1 ? "it" : "them"} and it matches.`
          : `The total on it says ${dollarsText(read.statedTotal)} — ${dollarsText(gap)} more than these lines; a line may not have been read, or one is left out below.`,
      );
    }
    else {
      // The ranges read at their high end may be the whole difference.
      const spread = read.rows.filter((r) => r.include && r.low != null).reduce((n, r) => n + (r.amount - (r.low ?? r.amount)), 0);
      parts.push(`The total on it says ${dollarsText(read.statedTotal)} — ${dollarsText(-gap)} less than these lines; ${spread >= -gap - 0.5 ? "the ranges are counted at their high end" : "check for a line counted twice"}.`);
    }
  }
  const out = read.rows.filter((r) => !r.include);
  const explained = read.statedTotal != null && parts[parts.length - 1].includes("left out below — tick");
  if (out.length && !explained) parts.push(`Left out: ${out.slice(0, 3).map((r) => `${r.name} (${dollarsText(r.amount)})`).join(", ")}${out.length > 3 ? ` and ${out.length - 3} more` : ""} — tick to keep.`);
  if (picture) parts.push("Read from a picture — check each figure against it.");
  else if (read.rows.some((r) => r.check)) parts.push("The marked figures aren't in it as written — check them.");
  return parts.join(" ");
}
