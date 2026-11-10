// SUBCONTRACTORS, PART 3 — Find, the pure rules (2026-11-08): the register's rows read into the directory's words,
// the license kinds, insurance and bond picks, name matching, the three sources merged with the saved ones marked
// and the order, the address words, the JobFlex Network's settings and match, the result saved as a contractor, the
// register note kept on a row, and the office's line when a sub's standing changes.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/sub-finder.check.ts
import "../_lib/_server-only";
import {
  LICENSE_KIND_LABEL,
  TRADE_SPECIALTIES,
  areaWordsOf,
  bondRowOf,
  cityZipOf,
  contractorFromResult,
  formatPhone,
  haversineMi,
  insuranceRowOf,
  licenseKindOf,
  licenseWords,
  mergeResults,
  nameWordsFor,
  networkMatches,
  networkSettingsOf,
  normalizeName,
  parseRegisterNote,
  pickInsurance,
  registerNoteOf,
  registerRowOf,
  specialtiesFor,
  standingChangeWords,
  titleCase,
  type RegisterRow,
} from "../../../src/lib/subFinder/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

// ── the register's rows ──
const raw = { businessname: "@ YOUR SERVICE HOME APPL RPR", contractorlicensenumber: "YOURSYS884LO", contractorlicensetypecode: "CC", address1: "13106 133RD PL NE", city: "KIRKLAND", state: "WA", zip: "98034", phonenumber: "4258149462", licenseeffectivedate: "2012-06-20T00:00:00.000", licenseexpirationdate: "2028-07-13T00:00:00.000", specialtycode1desc: "GENERAL", specialtycode2desc: "None", ubi: "602152596", primaryprincipalname: "HOLLAND, HUBIE FRANKLIN", statuscode: "A", contractorlicensestatus: "ACTIVE" };
const r = registerRowOf(raw)!;
check("a register row reads into the directory's words: license, phone formatted, ISO days, specialties without 'None'", r.license === "YOURSYS884LO" && r.phone === "(425) 814-9462" && r.expires === "2028-07-13" && r.effective === "2012-06-20" && r.specialties.join() === "GENERAL" && r.kind === "ACTIVE" && r.principal === "HOLLAND, HUBIE FRANKLIN" && r.zip === "98034", r);
check("a row without a license or a name is nothing", registerRowOf({ businessname: "X" }) === null && registerRowOf({ contractorlicensenumber: "A1" }) === null);
check("the register's status words become four kinds", licenseKindOf("ACTIVE") === "ACTIVE" && licenseKindOf("RE-LICENSED") === "ACTIVE" && licenseKindOf("EXPIRED") === "EXPIRED" && licenseKindOf("OUT OF BUSINESS") === "EXPIRED" && licenseKindOf("SUSPENDED") === "SUSPENDED" && licenseKindOf("REVOKED DUE DEPT ERR") === "SUSPENDED" && licenseKindOf("") === "UNKNOWN" && licenseKindOf(null) === "UNKNOWN" && LICENSE_KIND_LABEL.SUSPENDED === "License suspended");
const ins = insuranceRowOf({ contractorlicensenumber: "YOURSYS884LO", insurancecompany: "Travelers Cas Insurance Co of ", insurancepolicyno: "6809M273603", insuranceamt: "1000000.0000", effectivedate: "2022-01-01T00:00:00.000", expirationdate: "2027-01-01T00:00:00.000" })!;
check("an insurance row: carrier, policy, the amount as a number, the days", ins.carrier === "Travelers Cas Insurance Co of" && ins.policy === "6809M273603" && ins.amount === 1_000_000 && ins.expires === "2027-01-01" && ins.cancelled === null);
const bond = bondRowOf({ contractorlicensenumber: "YOURSYS884LO", bondfirmname: "RLI Ins Co", bondamt: "30000.0000", bondeffectivedate: "2024-07-13T00:00:00.000", bondexpirationdate: "Until Canceled", bondimpaired: "N" })!;
check("a bond row: 'Until Canceled' is no expiry; impaired reads as a yes/no", bond.amount === 30_000 && bond.expires === null && bond.effective === "2024-07-13" && !bond.impaired && bondRowOf({ contractorlicensenumber: "A", bondimpaired: "Y" })!.impaired);
check("the one insurance to show: live over cancelled, the latest expiry", pickInsurance([{ ...ins, expires: "2026-01-01", cancelled: "2025-06-01" }, { ...ins, expires: "2026-06-01" }, { ...ins, expires: "2027-01-01" }])?.expires === "2027-01-01" && pickInsurance([{ ...ins, cancelled: "2025-06-01" }])?.cancelled === "2025-06-01" && pickInsurance([]) === null);
check("phones and names for the eye", formatPhone("4258149462") === "(425) 814-9462" && formatPhone("14258149462") === "(425) 814-9462" && formatPhone("555-0101") === "555-0101" && titleCase("XYZ ELECTRIC LLC") === "XYZ Electric LLC".replace("XYZ", "Xyz") && titleCase("RIDGE FRAMING LLC") === "Ridge Framing LLC");

// ── trades ──
check("the trades map to the register's specialty names; electrical has none and falls back to a name word", specialtiesFor("Plumbing").join() === "PLUMBING" && specialtiesFor("Electrical").length === 0 && nameWordsFor("Electrical").join() === "ELECTRIC" && specialtiesFor("Kitchen & Bath").length === 2 && specialtiesFor("Nope").length === 0 && nameWordsFor("Nope").join() === "NOPE" && nameWordsFor(null).length === 0 && Object.keys(TRADE_SPECIALTIES).length >= 20);

// ── matching ──
check("names match without punctuation, case or corporate suffixes", normalizeName("XYZ Electric, LLC") === normalizeName("xyz electric") && normalizeName("A & B Roofing Inc.") === "A AND B ROOFING" && normalizeName("The Cascade Co") === "CASCADE");
const reg = (name: string, license: string, status: string, city = "KIRKLAND"): RegisterRow => ({ ...r, name, license, status, kind: licenseKindOf(status), city, specialties: ["GENERAL"] });
const merged = mergeResults({
  register: [reg("XYZ ELECTRIC LLC", "XYZ1", "ACTIVE"), reg("ABC ELECTRICAL LLC", "ABC1", "SUSPENDED"), reg("OLD TIMER ELECTRIC", "OLD1", "EXPIRED")],
  insurance: new Map([["XYZ1", { ...ins, license: "XYZ1" }]]),
  bond: new Map([["XYZ1", { ...bond, license: "XYZ1" }]]),
  places: [
    { placeId: "p1", name: "XYZ Electric", address: "4410 Rainier Ave S, Kirkland, WA 98034", phone: "(206) 555-0144", website: "https://xyz.example", rating: 4.8, ratingCount: 57, lat: 47.6815, lng: -122.2087, status: "OPERATIONAL" },
    { placeId: "p2", name: "Brightline Electric Co", address: "8 Market St, Kirkland, WA 98033", phone: null, website: null, rating: 4.9, ratingCount: 12, lat: 47.6792, lng: -122.2101, status: "OPERATIONAL" },
  ],
  network: [{ organizationId: "org2", company: "Brightline Electric", trades: ["Electrical"], serviceAreas: "Kirkland", contact: { name: "Pat", phone: null, email: "pat@brightline.example" }, address: null }],
  saved: [{ id: "c-abc", name: "ABC Electrical", placeId: null, license: "abc1" }],
  center: { lat: 47.6, lng: -122.2 },
});
const xyz = merged.find((m) => m.key === "lic:XYZ1")!;
const bright = merged.find((m) => m.placeId === "p2")!;
check("a Google business and a register row of the same name are one result, with both sources, the rating, the license, the insurance and the bond", xyz.sources.join() === "places,register" && xyz.rating === 4.8 && xyz.license?.kind === "ACTIVE" && xyz.license?.insurance?.policy === "6809M273603" && xyz.license?.bond?.amount === 30_000 && xyz.website === "https://xyz.example" && merged.filter((m) => /XYZ/i.test(m.name)).length === 1);
check("a company on JobFlex with the same name joins the Google result and brings its email", bright.sources.join() === "places,network" && bright.email === "pat@brightline.example" && bright.network?.organizationId === "org2");
check("the one already in the directory is marked saved — by license, whatever the case", merged.find((m) => m.key === "lic:ABC1")?.savedId === "c-abc" && xyz.savedId === null);
check("distance from the centre for Google's results, none for the register's", xyz.distanceMi != null && xyz.distanceMi > 5 && xyz.distanceMi < 7 && merged.find((m) => m.key === "lic:OLD1")?.distanceMi === null);
check("the order: active licenses and JobFlex first by rating, unverified next, expired and suspended last", merged.map((m) => m.key).join() === "lic:XYZ1,place:p2,lic:OLD1,lic:ABC1" || merged.map((m) => m.key).join() === "lic:XYZ1,place:p2,lic:ABC1,lic:OLD1", merged.map((m) => `${m.key}:${m.license?.kind ?? "-"}:${m.rating ?? "-"}`));
check("Seattle to Kirkland is about ten miles", Math.abs(haversineMi({ lat: 47.6062, lng: -122.3321 }, { lat: 47.6815, lng: -122.2087 }) - 7.7) < 1.5);

// ── addresses ──
check("city, state and ZIP out of an address", JSON.stringify(cityZipOf("1200 Example St, Kirkland, WA 98034")) === JSON.stringify({ city: "Kirkland", state: "WA", zip: "98034" }) && cityZipOf("4410 Rainier Ave S, Seattle, WA 98118, USA").city === "Seattle" && cityZipOf("Main St, Bellevue WA 98004").city === "Bellevue" && cityZipOf(null).city === null);
check("the area words a service area could name", areaWordsOf("1200 Example St, Kirkland, WA 98034").join() === "Kirkland,98034,WA,Washington");

// ── the JobFlex Network ──
const net = networkSettingsOf(JSON.stringify({ on: true, trades: ["Electrical", " Plumbing "], serviceAreas: "Kirkland, Bellevue", contact: { name: "Dana", phone: "(206) 555-0144", email: "bids@xyz.example" }, since: "2026-11-08T00:00:00.000Z" }));
check("the settings parse and tidy; nothing is off; a broken blob is off", net.on && net.trades.join() === "Electrical,Plumbing" && net.contact.email === "bids@xyz.example" && !networkSettingsOf(null).on && !networkSettingsOf("{").on && networkSettingsOf(null).trades.length === 0);
check("a listed company matches its trade in its area, not another trade, not another town; no areas means everywhere", networkMatches(net, "Electrical", ["Kirkland", "98034", "WA"]) && !networkMatches(net, "Roofing", ["Kirkland"]) && !networkMatches(net, "Electrical", ["Tacoma", "98402"]) && networkMatches({ ...net, serviceAreas: "" }, "Plumbing", ["Tacoma"]) && !networkMatches({ ...net, on: false }, "Electrical", ["Kirkland"]) && networkMatches(net, null, ["Kirkland"]));

// ── words and the saved sub ──
check("the license line under a result", licenseWords(xyz.license, "2026-11-08") === "Active license XYZ1 · GENERAL · expires Jul 13, 2028 · insured to Jan 1, 2027 (Travelers Cas Insurance Co of) · bond $30,000" && licenseWords(null, "2026-11-08") === "No license on record here" && /insurance cancelled Jun 1, 2025/.test(licenseWords({ ...xyz.license!, insurance: { ...ins, cancelled: "2025-06-01" } }, "2026-11-08")), licenseWords(xyz.license, "2026-11-08"));
const saved = contractorFromResult(xyz, "Electrical");
check("a result saved as a contractor carries the trade, the license and its state, the insurance and the bond, the principal, source SEARCH", saved.trade === "Electrical" && saved.trades.join() === "Electrical" && saved.license === "XYZ1" && saved.licenseStatus === "ACTIVE" && saved.insuranceUntil === "2027-01-01" && saved.insuranceCarrier === "Travelers Cas Insurance Co of" && saved.bondAmount === 30_000 && saved.bondUntil === null && saved.contactName === "HOLLAND, HUBIE FRANKLIN" && saved.source === "SEARCH" && saved.phone === "(206) 555-0144");
check("a JobFlex-only result is source NETWORK with its contact", contractorFromResult({ ...bright, placeId: null, sources: ["network"] }, null).source === "NETWORK" && contractorFromResult(bright, null).source === "SEARCH");
const note = registerNoteOf(reg("XYZ ELECTRIC LLC", "XYZ1", "ACTIVE"), { ...ins, license: "XYZ1" }, { ...bond, license: "XYZ1" }, "2026-11-08T05:00:00.000Z");
check("the register's note on a row round-trips; a broken one is null", parseRegisterNote(JSON.stringify(note))?.license === "XYZ1" && parseRegisterNote(JSON.stringify(note))?.insurance?.policy === "6809M273603" && parseRegisterNote(JSON.stringify(note))?.kind === "ACTIVE" && parseRegisterNote("{}") === null && parseRegisterNote(null) === null);
check("the office's line when a sub's standing changes — and silence when nothing did", standingChangeWords("ABC Electrical", "ACTIVE", "SUSPENDED", false) === "ABC Electrical: license was suspended (the state register)." && standingChangeWords("XYZ", "EXPIRED", "ACTIVE", true) === "XYZ: license is active again and insurance lapsed (the state register)." && standingChangeWords("XYZ", "ACTIVE", "ACTIVE", false) === null && standingChangeWords("XYZ", "ACTIVE", "UNKNOWN", false) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
