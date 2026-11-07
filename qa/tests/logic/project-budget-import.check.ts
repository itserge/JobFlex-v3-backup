// A BUDGET BROUGHT IN, AND THE PRESETS — the pure core (2026-11-07, owner: "someone has already preliminary budget like
// in a text message or in a notes or in a file, or it's was from the bank … make preset budgets … for each possible
// job"). A text message, notes, a spreadsheet's tabs, a CSV, a lender's sheet, an Excel and a Word file read into
// rows; the fee and the payments left out; the budget's own total checked; every preset's shares and split.
// Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/project-budget-import.check.ts
import "../_lib/_server-only";
import { deflateRawSync } from "node:zlib";
import { MAX_KINDS } from "../../../src/lib/projectBudget";
import { amountsIn, finishRows, kindFor, readBudgetText, readLine, readWords, ticked, tidyName, totalKind, tradeName, type ImportRow } from "../../../src/lib/projectBudgetImport";
import { BUDGET_PRESETS, PRESET_GROUPS, presetByKey, presetForTrade, sharesOf, splitTotal } from "../../../src/lib/projectBudgetPresets";
import { STAGE_TEMPLATES } from "../../../src/lib/projectStages/shared";
import { docxText, xlsxText } from "../../../src/lib/officeText";
import { readBudget } from "../../../src/lib/projectBudgetRead";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}
const brief = (rows: ImportRow[]) => rows.map((r) => `${r.include ? "" : "-"}${r.name}=${r.amount}`);
const has = (rows: ImportRow[], name: string, amount: number, include = true) => rows.some((r) => r.name === name && Math.abs(r.amount - amount) < 0.01 && r.include === include);

// ── names, kinds, totals ──
check("names: bullets, list numbers, cost codes, leaders and filler go", tidyName("- Electrical") === "Electrical" && tidyName("3. Plumbing:") === "Plumbing" && tidyName("01-100 Plans & engineering") === "Plans & engineering" && tidyName("03 30 00 Concrete") === "Concrete" && tidyName("Cabinets .....") === "Cabinets" && tidyName("framing is about") === "Framing" && tidyName("and permits") === "Permits");
check("names: a shouting line in Title case, the trade acronyms kept", tidyName("SITE PREP / EXCAVATION") === "Site Prep / Excavation" && tidyName("HVAC ROUGH IN") === "HVAC Rough In" && tidyName("WINDOWS AND DOORS") === "Windows and Doors");
check("names: at most 40 characters, cut at a word; no letters is no name", tidyName("Interior trim, doors, hardware, closet shelving and mirrors").length <= 40 && tidyName("$ 12,500") === "" && tidyName("--") === "");
check("names: a trade named by who does it is the trade", tradeName("plumber") === "Plumbing" && tradeName("The electrician") === "Electrical" && tradeName("tile guy") === "Tile" && tradeName("Cabinets") === "Cabinets");
check("kinds: the six by their names and plain words; anything else keeps its own", kindFor("Materials") === "MATERIALS" && kindFor("labor") === "LABOR" && kindFor("Subs") === "SUBCONTRACTORS" && kindFor("Permits & fees") === "PERMITS" && kindFor("Equipment & rentals") === "EQUIPMENT" && kindFor("Misc") === "OTHER" && kindFor("Electrical") === "Electrical" && kindFor("Dumpster") === "Dumpster");
check("totals: the budget's own total, a section's, and a cost line", totalKind("Total") === "stated" && totalKind("GRAND TOTAL") === "stated" && totalKind("Total project cost") === "stated" && totalKind("Subtotal") === "sub" && totalKind("Kitchen total") === "sub" && totalKind("Hard costs total") === "sub" && totalKind("Electrical") === null);

// ── one line of words ──
check("line: name and amount, every way it is written", (() => {
  const one = (l: string) => readLine(l)[0];
  return one("Electrical 12,500")?.amount === 12500 && one("Plumbing 8k")?.amount === 8000 && one("Framing — $22,000.00")?.amount === 22000 && one("Roof: 1.2M")?.amount === 1_200_000 && one("Permit fee $485")?.amount === 485 && one("Paint 900")?.amount === 900;
})());
check("line: a text message's run of items, amount after or before", (() => {
  const a = readLine("electric 12k, plumbing 8k and drywall 6.5k");
  const b = readLine("12k electrical, 8k plumbing, 6.5k drywall");
  const c = readLine("Bathroom: tile 4500 vanity 1200 plumber 2800");
  return a.length === 3 && a[2].amount === 6500 && b.length === 3 && b[0].name === "Electrical" && c.length === 3 && c[0].name === "Tile" && c[2].amount === 2800;
})(), [readLine("electric 12k, plumbing 8k and drywall 6.5k"), readLine("Bathroom: tile 4500 vanity 1200 plumber 2800")]);
check("line: a range's high end, the low end noted; quantity × unit price; a share", (() => {
  const r = readLine("Countertops 6-7k")[0];
  const q = readLine("Drywall 3,200 sf @ $2.10")[0];
  const p = readLine("Contingency 10%")[0];
  return r.amount === 7000 && r.low === 6000 && /high end/.test(r.note ?? "") && q.amount === 6720 && /3,200 × \$2\.1/.test(q.note ?? "") && p.pct === 0.1;
})(), [readLine("Countertops 6-7k"), readLine("Drywall 3,200 sf @ $2.10")]);
check("line: dates, phones, sizes, addresses and counts are never money", readLine("Deck 12x16 — call 425-555-1234 by 11/20").length === 0 && readLine("CONSTRUCTION BUDGET — 1418 ALDER WAY").length === 0 && readLine("200 amp panel $4,500")[0]?.amount === 4500 && readLine("2x4 studs 120 pcs $840")[0]?.amount === 840);
check("line: a credit in brackets comes unticked", readLine("Window credit (1,200)")[0]?.include === false);

// ── a whole paste ──
const sms = readBudgetText("hey so for the kessler job electric 12k, plumbing 8k and drywall 6.5k. framing about 22,000 and permits $1,850");
check("paste: a text message — five lines, the chatter dropped, “electric” the trade, permits on the six", sms.rows.length === 5 && has(sms.rows, "Electrical", 12000) && has(sms.rows, "Framing", 22000) && sms.rows.find((r) => r.name === "Permits")?.kind === "PERMITS", brief(sms.rows));
const notes = readBudgetText(`Kitchen budget
- Demo/haul away: $2,400
- Cabinets ..... 18,500
- Countertops (quartz) 6-7k
- Appliances – client supplying
- Electrical 4,200
- Plumbing 3,100
- Contingency 10%
Total 38,000`);
check("paste: notes — the heading and the line with no amount skipped, the share worked out from the rest", notes.rows.length === 6 && has(notes.rows, "Contingency", 3520) && notes.statedTotal === 38000 && !notes.rows.some((r) => /appliances|kitchen/i.test(r.name)), brief(notes.rows));
check("paste: the ranges at their high end explain a total that's lower", /ranges are counted at their high end/.test(readWords({ ...notes, source: "rules" }, "what you pasted")), readWords({ ...notes, source: "rules" }, "what you pasted"));
const sheet = readBudgetText("Item\tQty\tUnit\tUnit cost\tTotal\nFraming lumber\t1\tls\t8,400.00\t8,400.00\nDrywall\t3200\tsf\t2.10\t6,720.00\nElectrical rough\t1\tls\t5,500.00\t5,500.00\nSubtotal\t\t\t\t20,620.00\nOverhead & profit 15%\t\t\t\t3,093.00\nTotal\t\t\t\t23,713.00");
check("paste: a spreadsheet's tabs — the Total column, the subtotal dropped, overhead & profit unticked", sheet.rows.length === 4 && has(sheet.rows, "Drywall", 6720) && has(sheet.rows, "Overhead & profit", 3093, false) && sheet.statedTotal === 23713, brief(sheet.rows));
check("paste: the gap to the total is the fee left out — said so", /the \$3,093 between is the Overhead & profit left out below/.test(readWords({ ...sheet, source: "rules" }, "the sheet")), readWords({ ...sheet, source: "rules" }, "the sheet"));
const lender = readBudgetText(`Category,Description,Budget,Paid to date,Remaining
Site work,Excavation,"$8,000","$8,000",$0
Site work,Utilities,"$12,000","$4,000","$8,000"
Foundation,Footings & walls,"$42,000","$0","$42,000"
Framing,Lumber & labor,"$61,500",$0,"$61,500"
Electrical,Rough & finish,"$18,000",$0,"$18,000"
Electrical,Fixtures allowance,"$3,500",$0,"$3,500"
Builder fee,,"$22,000",$0,"$22,000"
Total,,"$167,000","$12,000","$155,000"`);
check("paste: a lender's CSV — the Budget column (not Paid, not Remaining), grouped by Category, the builder fee unticked", lender.rows.length === 5 && has(lender.rows, "Site work", 20000) && has(lender.rows, "Electrical", 21500) && has(lender.rows, "Builder fee", 22000, false) && lender.statedTotal === 167000 && ticked(lender.rows) === 145000, brief(lender.rows));
const bank = readBudgetText(`CONSTRUCTION BUDGET — 1418 ALDER WAY
01-100 Plans & engineering     4,800
02-100 SITE PREP / EXCAVATION  14,000
06-100 FRAMING                 72,000
15-400 PLUMBING                21,000
Builder's fee (10%)            11,180
TOTAL                          123,000`);
check("paste: a lender's page of columns — codes dropped, thousands' commas not read as a CSV", bank.rows.length === 5 && has(bank.rows, "Plans & engineering", 4800) && has(bank.rows, "Framing", 72000) && has(bank.rows, "Builder's fee", 11180, false) && bank.statedTotal === 123000, brief(bank.rows));
const piped = readBudgetText("| Trade | Budget |\n|---|---|\n| Electrical | $12,500 |\n| Plumbing | $8,000 |\n| Tile | $4,000 |");
check("paste: a typed table with bars", piped.rows.length === 3 && has(piped.rows, "Plumbing", 8000), brief(piped.rows));
check("paste: nothing that reads as a budget is no rows", readBudgetText("Can you come by Tuesday to look at the deck?").rows.length === 0);

// ── the last step ──
check("finish: the same name twice is one row, the amounts added and said so", (() => {
  const r = finishRows([{ name: "Electrical", amount: 1000 }, { name: "electrical", amount: 500 }, { name: "Plumbing", amount: 200 }]);
  return r.length === 2 && r[0].amount === 1500 && /2 lines added together/.test(r[0].note ?? "");
})());
check(`finish: past ${MAX_KINDS} kinds the rest go under Other, added together`, (() => {
  const r = finishRows(Array.from({ length: MAX_KINDS + 10 }, (_, i) => ({ name: `Line number ${i + 1}`, amount: 100 })));
  const own = r.filter((x) => x.include && x.kind !== "OTHER");
  return own.length === MAX_KINDS - 1 && r.find((x) => x.kind === "OTHER")?.amount === 1100 && ticked(r) === (MAX_KINDS + 10) * 100;
})());
check("finish: every amount the words carry, for checking the model's", (() => {
  const a = amountsIn("Electrical 12k\nTile 6-7k\nPaint\t900");
  return [12000, 6000, 7000, 900].every((n) => a.includes(n));
})());

// ── an Excel and a Word file ──
/** A zip of the given files, stored or deflated (the reader skips the CRC). */
function zip(files: Record<string, string>, deflate: boolean): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = Buffer.from(body, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xlsx = zip(
  {
    "xl/workbook.xml": `<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Old" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Line item</t></si><si><t>Budget</t></si><si><t>Paid</t></si><si><t>Cabinets &amp; hardware</t></si><si><r><t>Electri</t></r><r><t>cal</t></r></si><si><t>Total</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>18500.000000002</v></c><c r="C2"><v>5000</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3"><v>0</v></c><c r="B3"><v>9250</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Plumbing</t></is></c><c r="B4"><f>SUM(1)</f><v>6100</v></c></row><row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5"><v>33850</v></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hidden 999</t></is></c></row></sheetData></worksheet>`,
  },
  true,
);
const xText = xlsxText(xlsx);
const xRead = readBudgetText(xText);
check("excel: the visible sheet as tabs, shared and rich strings, a formula's value, the Budget column", xRead.rows.length === 3 && has(xRead.rows, "Cabinets & hardware", 18500) && has(xRead.rows, "Electrical", 9250) && has(xRead.rows, "Plumbing", 6100) && xRead.statedTotal === 33850 && !/Hidden/.test(xText), { xText, rows: brief(xRead.rows) });
const docx = zip(
  {
    "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Bathroom budget for the Lees</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tile</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$4,500</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Vanity</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$1,200</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Glass door</w:t></w:r><w:r><w:tab/><w:t>1,100</w:t></w:r></w:p></w:body></w:document>`,
  },
  false,
);
const dRead = readBudgetText(docxText(docx));
check("word: the table's rows and a tabbed paragraph", dRead.rows.length === 3 && has(dRead.rows, "Tile", 4500) && has(dRead.rows, "Glass door", 1100), { text: docxText(docx), rows: brief(dRead.rows) });
check("excel/word: a file that is not a zip is refused in words", (() => {
  try {
    xlsxText(Buffer.from("not a zip at all, just words"));
    return false;
  } catch (err) {
    return /can open/.test(String(err));
  }
})());

check("tables: a spreadsheet's empty last cell keeps the columns where they are", (() => {
  const r = readBudgetText("Item\tBudget\tNotes\nCabinets\t18500\t\nTile\t4200\tclient picks\nPermit\t450\t");
  return r.rows.length === 3 && has(r.rows, "Cabinets", 18500) && has(r.rows, "Permit", 450);
})(), brief(readBudgetText("Item\tBudget\tNotes\nCabinets\t18500\t\nTile\t4200\tclient picks\nPermit\t450\t").rows));
check("tables: a PDF's row that lost its empty cell is set under the money columns", (() => {
  const r = readBudgetText("Line\tDescription\tBudget\tDraw 1\tRemaining\n1\tPlans & engineering\t4,800\t4,800\t0\n2\tFraming\t72,000\t0\t72,000\nTOTAL\t76,800\t4,800\t72,000");
  return r.rows.length === 2 && has(r.rows, "Framing", 72000) && r.statedTotal === 76800;
})(), readBudgetText("Line\tDescription\tBudget\tDraw 1\tRemaining\n1\tPlans & engineering\t4,800\t4,800\t0\n2\tFraming\t72,000\t0\t72,000\nTOTAL\t76,800\t4,800\t72,000"));
check("line: a message's long opening is cut to the items' length", readLine("hey so for the lee bath tile 4500, vanity 1200, glass door 1,100")[0]?.name === "Bath tile");

// ── the presets ──
check("presets: twenty, keys unique, in the three groups", BUDGET_PRESETS.length === 20 && new Set(BUDGET_PRESETS.map((p) => p.key)).size === BUDGET_PRESETS.length && BUDGET_PRESETS.every((p) => PRESET_GROUPS.includes(p.group)));
check("presets: every stage template has its preset", STAGE_TEMPLATES.every((t) => presetByKey(t.key)), STAGE_TEMPLATES.filter((t) => !presetByKey(t.key)).map((t) => t.key));
for (const p of BUDGET_PRESETS) {
  const sum = p.rows.reduce((n, [, x]) => n + x, 0);
  const names = p.rows.map(([n]) => n.toLowerCase());
  check(`presets: ${p.label} — shares sum to 100, names unique and short, a contingency`, sum === 100 && new Set(names).size === names.length && p.rows.every(([n, x]) => n.length <= 40 && x > 0 && Number.isInteger(x)) && names.includes("contingency"), { sum });
}
check("presets: a total splits into whole dollars that add up to it exactly", BUDGET_PRESETS.every((p) => [1, 999, 48_250, 85_000, 412_345].every((t) => splitTotal(p.rows, t).reduce((n, r) => n + r.amount, 0) === t)));
check("presets: their lines land on the six where they name one", (() => {
  const k = splitTotal(presetByKey("kitchen")!.rows, 50_000);
  const d = splitTotal(presetByKey("deck")!.rows, 20_000);
  return k.find((r) => r.name === "Permits & fees")?.kind === "PERMITS" && d.find((r) => r.name === "Labor")?.kind === "LABOR" && d.find((r) => r.name === "Equipment & rentals")?.kind === "EQUIPMENT" && k.find((r) => r.name === "Cabinets")?.kind === "Cabinets";
})());
check("presets: a trade points at one; a spec home has no price to read a cost share from", presetForTrade("Roofing") === "roof" && presetForTrade("Kitchen & Bath") === "kitchen" && presetForTrade(null) === null && presetByKey("spec")?.cost === null && (presetByKey("home")?.cost ?? 0) > 0.7);
check("presets: another project's budget as shares, split over a new total", (() => {
  const sh = sharesOf([{ category: "MATERIALS", amount: 6000 }, { category: "Tile", amount: 4000 }]);
  const r = splitTotal(sh, 20_000);
  return r.length === 2 && r[0].kind === "MATERIALS" && r[0].amount === 12000 && r[1].amount === 8000;
})());

// ── the read, without a model ──
void (async () => {
  const r = await readBudget({ text: "Electrical 12,500\nPlumbing 8k\nBuilder fee 2,000\nTotal 22,500", from: "what you pasted" }, { useModel: false });
  check("read: words without a model are read by the rules, with the sentence", r.source === "rules" && r.rows.length === 3 && /2 lines from what you pasted — \$20,500/.test(r.words) && /the \$2,000 between is the Builder fee/.test(r.words), r);
  const p = await readBudget({ images: ["data:image/jpeg;base64,AAAA"], from: "photo.jpg" }, { useModel: false });
  check("read: a picture without a model says it needs AI", p.source === "none" && /needs AI/.test(p.words));
  console.log(bad ? `\n${bad} FAILED` : "\nall ok");
  process.exit(bad ? 1 : 0);
})();
