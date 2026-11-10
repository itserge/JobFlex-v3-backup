// THE COUNTY'S REQUIREMENTS MATCHED TO THE PERMIT SET (2026-11-09, the plan set's Edit, part 2; owner: "upload his
// file or just a text of what their specific county or city wants to see … and it will remodify that current permit
// set", "look for requirements for decks or detached decks, gazebos for this city or county", "add option that the
// contractor can type in what he wants to see there"). What the model answers is checked against the set before the
// contractor sees it: a card or sheet it names must be there, a figure must read as one, what cannot be placed — and
// any change to the deck itself — is the contractor's to do; a card most departments want, taken out, starts unticked
// unless the contractor asked for it. Ticked changes become ordinary edits; notes, figures and the sheet size go to the
// jurisdiction panel. Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/county-match.check.ts
import { applyChecked, checkRead, figureValue, keptCheck, placeFromWords, placeKey, placeLabel, requirementsWords, setWords, trimOffers, type ModelCheck, type SetSummary } from "../../../src/lib/deck/plans/countyMatch";
import { emptySetEdits, isOut, normalizeKeptCheck, normalizePlanEdits } from "../../../src/lib/deck/plans/edits";

let bad = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
};

const set: SetSummary = {
  set: "permit",
  place: "Knox County, TN",
  paper: "11 × 17",
  figures: "Wind 115 mph · Frost 12 in.",
  sheets: [
    { id: "cover", no: "G-001", name: "Cover sheet", out: false, need: false },
    { id: "notes", no: "G-002", name: "General notes and code compliance", out: false, need: true },
    { id: "site", no: "A-101", name: "Site plan", out: false, need: true },
    { id: "foundation", no: "S-101", name: "Foundation plan", out: false, need: true },
    { id: "elevations", no: "S-201", name: "Elevations", out: false, need: false },
  ],
  cards: [
    { id: "site/view-1", sheet: "site", sheetNo: "A-101", label: "Site plan", drawing: true, addable: false, need: true, text: "Site plan" },
    { id: "site/setbacks", sheet: "site", sheetNo: "A-101", label: "Setbacks", drawing: false, addable: true, need: true, text: "Setbacks rear 63 ft" },
    { id: "site/notes", sheet: "site", sheetNo: "A-101", label: "Site notes", drawing: false, addable: true, need: false, text: "Lot as measured" },
    { id: "foundation/footings", sheet: "foundation", sheetNo: "S-101", label: "Footing schedule", drawing: false, addable: true, need: true, text: "F1 20 in." },
    { id: "foundation/bearing", sheet: "foundation", sheetNo: "S-101", label: "Bearing check", drawing: false, addable: true, need: false, text: "B-1 0.87" },
    { id: "elevations/view-1", sheet: "elevations", sheetNo: "S-201", label: "Front elevation", drawing: true, addable: false, need: false, text: "Front" },
  ],
};
const A = (a: Partial<ModelCheck["items"][number]["action"]> = {}) => ({ kind: "none" as const, sheet: "", after: "", card: "", title: "", lines: [], field: "", value: "", ...a });
const item = (need: string, status: "on_set" | "add" | "you", action = A(), where = "", why = "") => ({ need, quote: `“${need}”`, status, where, why, action });
const read: ModelCheck = {
  department: "Knox County Codes Administration",
  level: "county",
  place: "Knox County, TN",
  about: "A deck permit checklist.",
  items: [
    item("A site plan with setbacks", "on_set", A(), "site/setbacks"),
    item("Footings shown", "on_set", A(), "nowhere/at-all"),
    item("Frost depth 18 in.", "add", A({ kind: "figure", field: "frostIn", value: "18 inches" })),
    item("Wind 999 mph", "add", A({ kind: "figure", field: "windMph", value: "999" })),
    item("Seismic", "add", A({ kind: "figure", field: "sdc", value: "category d1" })),
    item("24 x 36 sheets", "add", A({ kind: "paper", value: "24x36" })),
    item("Lumber stamped", "add", A({ kind: "note", lines: ["All lumber shall be stamped."] })),
    item("Lumber stamped again", "add", A({ kind: "note", lines: ["All lumber shall be stamped."] })),
    item("Inspections list", "add", A({ kind: "card", sheet: "foundation", title: "Inspections", lines: ["Footing", "Framing", "Final"] })),
    item("Septic tank", "add", A({ kind: "card", sheet: "site", after: "site/setbacks", title: "Septic", lines: ["Septic tank 40 ft behind the deck"] })),
    item("Owner's form", "add", A({ kind: "sheet", title: "Owner's statement", lines: ["I, the owner, …"] })),
    item("No elevations", "add", A({ kind: "remove_sheet", sheet: "elevations" })),
    item("No site plan", "add", A({ kind: "remove_sheet", sheet: "site" })),
    item("No bearing table", "add", A({ kind: "remove_card", card: "foundation/bearing" })),
    item("Somewhere unknown", "add", A({ kind: "card", sheet: "S-999", title: "X", lines: ["y"] })),
    item("Guards 42 in.", "add", A({ kind: "design" }), "", "Raise the railing to 42 in. in the studio."),
    item("Affidavit", "you", A(), "", "Sign it."),
    item("Notes card rewritten", "add", A({ kind: "replace_card", card: "site/notes", title: "Site notes", lines: ["Lot from the survey dated 2026-10-01."] })),
    item("A drawing rewritten", "add", A({ kind: "replace_card", card: "site/view-1", lines: ["no"] })),
  ],
};
const c = checkRead(read, set);
const by = (need: string) => c.items.find((i) => i.need === need);
check("on the set, with where it is", by("A site plan with setbacks")?.status === "on_set" && by("A site plan with setbacks")?.whereLabel === "A-101 · Setbacks");
check("a card that isn't there is not pointed at", by("Footings shown")?.status === "on_set" && by("Footings shown")?.where === null);
check("a figure is read as a figure", by("Frost depth 18 in.")?.action?.kind === "figure" && (by("Frost depth 18 in.")?.action as { value: number }).value === 18);
check("a figure out of range is the contractor's", by("Wind 999 mph")?.status === "you");
check("a seismic category reads", (by("Seismic")?.action as { value: string } | null)?.value === "D1");
check("the sheet size", (by("24 x 36 sheets")?.action as { paper: string } | null)?.paper === "D");
check("the same note twice, once", c.items.filter((i) => i.action?.kind === "note").length === 1);
check("a card on a sheet", by("Inspections list")?.action?.kind === "card" && by("Inspections list")?.whereLabel === "S-101 · Foundation plan");
check("a card after the card named", (by("Septic tank")?.action as { after: string | null } | null)?.after === "site/setbacks");
check("a sheet that isn't there: the contractor's", by("Somewhere unknown")?.status === "you");
check("a change to the deck is the contractor's, for the studio", by("Guards 42 in.")?.status === "you" && by("Guards 42 in.")?.design === true && /studio/.test(by("Guards 42 in.")?.why ?? ""));
check("a sheet a department rarely needs, taken out, starts ticked", by("No elevations")?.on === true);
check("the site plan, taken out, starts unticked", by("No site plan")?.on === false && /Most departments ask for it/.test(by("No site plan")?.change ?? ""));
check("a drawing's words are never rewritten", by("A drawing rewritten")?.status === "you" && by("Notes card rewritten")?.action?.kind === "replace_card");
const asked = checkRead(read, set, { asked: true });
check("…unless the contractor asked for it", asked.items.find((i) => i.need === "No site plan")?.on === true);

/* ── the ticked changes as edits ─────────────────────────────────────────── */
const ticked = c.items.filter((i) => i.status === "add" && i.on);
const r = applyChecked(ticked, emptySetEdits(), set, "Knox County, TN", (id) => (id === "site/notes" ? "abcd1234" : ""));
check("notes, figures and the sheet size go to the panel", r.notes.length === 1 && r.figures.frostIn === 18 && r.figures.sdc === "D1" && r.paper === "D", r);
const ins = r.edits.added.find((a) => /Inspections/.test(a.html));
check("a card lands after the last card in a column on its sheet", ins?.after === "foundation/bearing", ins);
check("…its words cleaned into the sheets' classes", !!ins && ins.html.startsWith('<div class="p:h">Inspections</div><ol class="p:notes"><li>Footing</li>'), ins?.html);
const sep = r.edits.added.find((a) => /Septic/.test(a.html));
check("a card after the card it was meant for", sep?.after === "site/setbacks");
const owner = r.edits.sheets.find((x) => x.name === "Owner's statement");
check("a sheet added, with its card", !!owner && r.edits.added.some((a) => a.after === `sheet:extra:${owner.id}`));
check("a sheet taken out", r.edits.hidden.includes("sheet:elevations") && !r.edits.hidden.includes("sheet:site"));
check("a card rewritten keeps the design's fingerprint", r.edits.cards["site/notes"]?.was === "abcd1234" && /survey/.test(r.edits.cards["site/notes"]?.html ?? ""));
check("the count", r.count === ticked.length, { count: r.count, ticked: ticked.length });
const two = applyChecked([
  { ...by("Inspections list")!, id: "x1" },
  { ...by("Inspections list")!, id: "x2", action: { kind: "card", sheet: "foundation", after: null, title: "Second", lines: ["b"] } },
], emptySetEdits(), set, "");
check("two cards for one place stay in order", two.edits.added[1].after === two.edits.added[0].id);
const noCol = applyChecked([{ ...by("Inspections list")!, action: { kind: "card", sheet: "elevations", after: null, title: "On elevations", lines: ["z"] } }], emptySetEdits(), set, "Knox County, TN");
check("a sheet with no column: the card goes on a requirements sheet", noCol.edits.sheets.length === 1 && /requirements/i.test(noCol.edits.sheets[0].name) && noCol.edits.added[0].after === `sheet:extra:${noCol.edits.sheets[0].id}`, noCol.edits);

/* ── kept: the check with the set, the list for the county ───────────────── */
const kept = keptCheck(c, new Set(ticked.map((i) => i.id)), "2026-11-09T12:00:00.000Z", "online", [{ title: "Guide", url: "https://www.knoxcounty.org/x.pdf" }, { title: "bad", url: "javascript:alert(1)" }]);
check("the kept check counts and keeps the to-do", kept.onSet === 2 && kept.added === ticked.length && kept.todo.some((t) => t.design) && kept.todo.some((t) => t.need === "No site plan"));
const back = normalizeKeptCheck(JSON.parse(JSON.stringify(kept)));
check("read back, only http(s) links survive", !!back && back.sources.length === 1 && back.from === "online");
check("it rides with the set's edits", normalizePlanEdits({ permit: { check: kept } }).permit.check?.place === "Knox County, TN");
check("the list in words, for the next deck there", /^Knox County Codes Administration \(Knox County, TN\)/.test(requirementsWords(c)) && /1\. A site plan with setbacks/.test(requirementsWords(c)));
check("the set in words names its cards and figures", /site\/setbacks · A-101 · Setbacks/.test(setWords(set)) && /Wind 115 mph/.test(setWords(set)));
check("a place's key", placeKey("TN", "Knox County", null) === "tn:knox" && placeKey("tn", "Knox", "Knoxville") === "tn:knox:knoxville" && placeKey("", "Knox", null) === null);
check("figure words", figureValue("frostIn", "36 inches") === 36 && figureValue("groundSnowPsf", "1,000") === null && figureValue("edition", "2018 IRC") === "2018 IRC");

/* ── where the job is, as a contractor types it (2026-11-10: "nashville TN" left Find greyed out) ── */
{
  const P = (t: string) => placeFromWords(t);
  const eq = (t: string, want: unknown) => JSON.stringify(P(t)) === JSON.stringify(want);
  check("a city and a state, no comma, lower case", eq("nashville TN", { state: "TN", county: "", city: "Nashville" }), P("nashville TN"));
  check("a city, a comma, the state's name", eq("Nashville, Tennessee", { state: "TN", county: "", city: "Nashville" }), P("Nashville, Tennessee"));
  check("a county", eq("Knox County, TN", { state: "TN", county: "Knox County", city: null }), P("Knox County, TN"));
  check("a county without a comma, lower case", eq("knox county tn", { state: "TN", county: "Knox County", city: null }), P("knox county tn"));
  check("a city in its county", eq("Knoxville, Knox County, TN", { state: "TN", county: "Knox County", city: "Knoxville" }), P("Knoxville, Knox County, TN"));
  check("a whole address: the street and the ZIP are skipped", eq("1234 Simple St, Knoxville, TN 37919", { state: "TN", county: "", city: "Knoxville" }), P("1234 Simple St, Knoxville, TN 37919"));
  check("a parish, and a two-word state", eq("Jefferson Parish, Louisiana", { state: "LA", county: "Jefferson Parish", city: null }) && eq("Charleston, West Virginia", { state: "WV", county: "", city: "Charleston" }) && eq("Kansas City, Kansas", { state: "KS", county: "", city: "Kansas City" }));
  check("the City of …, and its own capitals kept", eq("City of McMinnville, OR", { state: "OR", county: "", city: "McMinnville" }), P("City of McMinnville, OR"));
  check("no state, no place", P("nashville") === null && P("") === null && P("Knox County") === null && P("TN") === null && P("Tennessee") === null);
  check("a street with no commas is not guessed at", P("1234 Simple St Knoxville TN") === null);
  check("two letters that are no state", P("Nashville, ZZ") === null);
  check("back into words", placeLabel(P("knoxville, knox county, tn")) === "Knoxville, Knox County, TN" && placeLabel(P("nashville TN")) === "Nashville, TN" && placeLabel(null) === "");
  check("a city alone has a key of its own", placeKey("TN", "", "Nashville") === "tn:-:nashville" && placeKey("TN", "", null) === null && placeKey("TN", "Davidson County", "Nashville") === "tn:davidson:nashville");
}

/* ── what the department's list never mentions (2026-11-10: "if you delete what's not required from the current one") ── */
{
  // A whole permit set, and a short list like Nashville's: a site plan, the footings, a paper to sign.
  const whole: SetSummary = {
    ...set,
    sheets: [...set.sheets, { id: "schedules", no: "S-601", name: "Schedules", out: false, need: false }, { id: "details", no: "S-501", name: "Details", out: false, need: false }],
    cards: [
      ...set.cards,
      { id: "cover/framing-picture", sheet: "cover", sheetNo: "G-001", label: "Framing picture", drawing: true, addable: false, need: false, text: "Framing" },
      { id: "cover/check", sheet: "cover", sheetNo: "G-001", label: "Code check", drawing: false, addable: true, need: false, text: "Joists OK" },
      { id: "foundation/layout", sheet: "foundation", sheetNo: "S-101", label: "Footing layout", drawing: false, addable: true, need: false, text: "F1 at 0 ft" },
      { id: "details/detail-pattern", sheet: "details", sheetNo: "S-501", label: "Decking pattern", drawing: true, addable: false, need: false, text: "Pattern" },
    ],
  };
  const short: ModelCheck = { ...read, items: [item("A site plan with setbacks", "on_set", A(), "site/setbacks"), item("Footings shown", "on_set", A(), "foundation/footings"), item("Affidavit", "you", A(), "", "Sign it.")] };
  const c = checkRead(short, whole);
  const trims = c.items.filter((i) => i.trim);
  const ids = trims.map((i) => i.where).join();
  check("parts the list never mentions are offered", ids === "sheet:elevations,sheet:schedules,cover/framing-picture,cover/check,foundation/bearing,foundation/layout,details/detail-pattern", ids);
  check("…every one unticked, a removal, and said in plain words", trims.every((i) => i.on === false && i.status === "add" && (i.action.kind === "remove_sheet" || i.action.kind === "remove_card") && /^Takes /.test(i.change)), trims);
  check("…after the department's own points, under ids of their own", c.items.slice(0, 3).every((i) => !i.trim) && new Set(c.items.map((i) => i.id)).size === c.items.length, c.items.map((i) => i.id));

  const kept = keptCheck(c, new Set(trims.map((i) => i.id)), "2026-11-10T00:00:00.000Z", "online", []);
  check("the kept check counts none of them, taken or not", kept.added === 0 && kept.onSet === 2 && kept.todo.length === 1 && kept.todo[0].need === "Affidavit", kept);
  check("…nor does the list kept for the next deck", !/Not on the department/.test(requirementsWords(c)) && requirementsWords(c).split("\n").length === 4, requirementsWords(c));

  const r = applyChecked([trims[0], trims[4]], emptySetEdits(), whole, "Knox County, TN");
  check("a ticked one takes the sheet or the card out", isOut(r.edits, "sheet:elevations") && isOut(r.edits, "foundation/bearing") && !isOut(r.edits, "sheet:schedules") && r.count === 2, r.edits.hidden);

  // What the list asks for is never offered — by its words, or by where the model found it.
  const wordy: ModelCheck = { ...short, items: [...short.items, item("Front and side elevations", "on_set", A(), ""), item("A lumber and fastener schedule", "on_set", A(), ""), item("Soil bearing capacity stated", "on_set", A(), "")] };
  const w = checkRead(wordy, whole).items.filter((i) => i.trim).map((i) => i.where).join();
  check("a part the list's words ask for is not offered", w === "cover/framing-picture,cover/check,foundation/layout,details/detail-pattern", w);
  const pointing: ModelCheck = { ...short, items: [...short.items, item("Height above grade", "on_set", A(), "elevations/view-1"), item("Member sizes", "on_set", A(), "cover/check")] };
  const pt = checkRead(pointing, whole).items.filter((i) => i.trim).map((i) => i.where).join();
  check("…nor one the model found a requirement on", !/sheet:elevations|cover\/check/.test(pt) && /sheet:schedules/.test(pt), pt);

  const gone: SetSummary = { ...whole, sheets: whole.sheets.map((x) => (x.id === "elevations" || x.id === "foundation" ? { ...x, out: true } : x)) };
  const g = trimOffers(c.items.filter((i) => !i.trim), gone).map((i) => i.where).join();
  check("a sheet already out, and the cards on it, are not offered again", !/sheet:elevations|foundation\//.test(g) && /sheet:schedules/.test(g), g);
  check("nothing offered on the construction set", trimOffers(c.items.filter((i) => !i.trim), { ...whole, set: "crew" }).length === 0);
  check("nothing offered when the contractor asked in his own words", checkRead(short, whole, { asked: true }).items.every((i) => !i.trim));
  check("nothing offered when the list matched nothing on the set", trimOffers([{ ...c.items[2] }], whole).length === 0);
}

/* ── a card rewritten on top of a template's card keeps what that one was typed over ── */
{
  const c = checkRead(read, set, { asked: true });
  const rw = c.items.find((i) => i.need === "Notes card rewritten");
  const e = { ...emptySetEdits(), cards: { "site/notes": { html: "<div>mine</div>", was: "abc12345", tpl: true } } };
  const r = rw ? applyChecked([rw], e, set, "Knox County, TN") : null;
  check("no drawn words to hand: the stored card's fingerprint stays", !!r && r.edits.cards["site/notes"]?.was === "abc12345" && /survey/.test(r.edits.cards["site/notes"]?.html ?? ""), r?.edits.cards);
  const r2 = rw ? applyChecked([rw], e, set, "Knox County, TN", () => "f5e5a9b1") : null;
  check("…and the drawn card's own wins when it is known", !!r2 && r2.edits.cards["site/notes"]?.was === "f5e5a9b1", r2?.edits.cards);
}

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall ok");
