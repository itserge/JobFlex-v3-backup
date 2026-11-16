import "server-only";
// AN EXCEL OR WORD FILE AS WORDS (2026-11-07, for a budget brought into a project — lib/projectBudgetImport). Both are
// zip files of XML: the sheets come out as tab-separated lines (the way a spreadsheet pastes), a Word document as
// its paragraphs with its tables' cells tab-separated. No library: the zip's central directory, node's inflate and
// a few patterns are all it takes for what a budget holds. The old binary .xls / .doc are not read (the card says
// to save them as .xlsx or CSV).

import { inflateRawSync } from "node:zlib";

export class OfficeFileError extends Error {}

/** The zip's files by name (only the ones asked for are inflated). */
function zipEntries(buf: Buffer): Map<string, () => Buffer> {
  // The end of the central directory: its signature, searched back from the end (a comment may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new OfficeFileError("That file isn't an Excel or Word file JobFlex can open.");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, () => Buffer>();
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    out.set(name, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new OfficeFileError("That file is damaged.");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new OfficeFileError("That file is packed in a way JobFlex can't open — save it again as .xlsx or CSV.");
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function unescape(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}
/** The text of an XML piece: every <t> (or <w:t>) run joined. */
const runs = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => unescape(m[1])).join("");

/** "B" → 1, "AA" → 26. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** At most this many sheets, and this many rows on each — a budget, not a ledger. */
const MAX_SHEETS = 4;
const MAX_ROWS = 400;

/** An .xlsx file's sheets as tab-separated lines, each sheet under its name. */
export function xlsxText(buf: Buffer): string {
  const sheets = readSheets(buf, MAX_SHEETS, MAX_ROWS);
  const out: string[] = [];
  for (const { name, lines } of sheets.list) {
    if (sheets.total > 1) out.push(name);
    // Every row as wide as the sheet: an empty cell at the end stays a cell, so a column never shifts.
    const width = Math.max(...lines.map((r) => r.length));
    out.push(...lines.map((r) => [...r, ...Array<string>(width - r.length).fill("")].join("\t")), "");
  }
  return out.join("\n").trim();
}

/**
 * AN .XLSX FILE'S SHEETS AS ROWS OF CELLS (2026-11-16, a contractor's book brought over — lib/import): every visible
 * sheet with something on it, each row as wide as its sheet. A client list is a ledger, not a budget: up to ten
 * sheets and 25,000 rows each.
 */
export function xlsxSheets(buf: Buffer, maxSheets = 10, maxRows = 25_000): Array<{ name: string; rows: string[][] }> {
  return readSheets(buf, maxSheets, maxRows).list.map(({ name, lines }) => {
    const width = Math.max(...lines.map((r) => r.length));
    return { name, rows: lines.map((r) => [...r, ...Array<string>(width - r.length).fill("")]) };
  });
}

/** The visible sheets, in the workbook's order, each as its non-empty rows of cells; `total` = how many sheets were listed. */
function readSheets(buf: Buffer, maxSheets: number, maxRows: number): { list: Array<{ name: string; lines: string[][] }>; total: number } {
  const zip = zipEntries(buf);
  const read = (name: string) => zip.get(name)?.().toString("utf8") ?? null;
  const shared: string[] = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runs(si[1], "t"));
  // The sheets in the workbook's own order, by their relationship ids.
  const book = read("xl/workbook.xml") ?? "";
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? "", /Target="([^"]+)"/.exec(m[0])?.[1] ?? ""]));
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => ({ name: unescape(/name="([^"]*)"/.exec(m[0])?.[1] ?? "Sheet"), rid: /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "", hidden: /state="(hidden|veryHidden)"/.test(m[0]) }))
    .filter((s) => !s.hidden)
    .map((s) => {
      const t = target.get(s.rid) ?? "";
      return { name: s.name, path: t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}` };
    });
  const paths = sheets.length ? sheets : [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).map((path, i) => ({ name: `Sheet${i + 1}`, path }));

  const list: Array<{ name: string; lines: string[][] }> = [];
  for (const sheet of paths.slice(0, maxSheets)) {
    const xml = read(sheet.path);
    if (!xml) continue;
    const lines: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (lines.length >= maxRows) break;
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let text = "";
        if (type === "s" && v != null) text = shared[Number(v)] ?? "";
        else if (type === "inlineStr") text = runs(inner, "t");
        else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (v != null) {
          // A number keeps up to cents: a formula's 18000.000000002 reads as 18000.
          const n = Number(v);
          text = type !== "str" && type !== "e" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : unescape(v);
        }
        const at = ref ? columnIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = text.replace(/[\t\r\n]+/g, " ").trim();
      }
      if (cells.some((x) => x)) lines.push(cells);
    }
    if (!lines.length) continue;
    list.push({ name: sheet.name, lines });
  }
  return { list, total: paths.length };
}

/** A .docx file's words: paragraphs as lines, a table's rows as tab-separated lines. */
export function docxText(buf: Buffer): string {
  const zip = zipEntries(buf);
  const xml = zip.get("word/document.xml")?.().toString("utf8");
  if (!xml) throw new OfficeFileError("That Word file has no document in it.");
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const para = (p: string) => runs(p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t> </w:t>"), "w:t").replace(/\s+$/, "");
  const out: string[] = [];
  // Tables and the paragraphs between them, in order.
  for (const piece of body.split(/(<w:tbl>[\s\S]*?<\/w:tbl>)/)) {
    if (piece.startsWith("<w:tbl>")) {
      for (const tr of piece.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const cells = [...tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((tc) => [...tc[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => para(p[1])).join(" ").replace(/\s+/g, " ").trim());
        if (cells.some((c) => c)) out.push(cells.join("\t"));
      }
    } else {
      for (const p of piece.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
        const line = para(p[1]);
        if (line.trim()) out.push(line);
      }
    }
    if (out.length > MAX_ROWS * 2) break;
  }
  return out.join("\n");
}
