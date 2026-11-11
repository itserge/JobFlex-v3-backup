// EDIT A LEAD (lib/leads/details, 2026-11-10): the one-line address split, the form's checks, the trail's words, and
// the CSV's address columns (components/v3/leads-blueprint/leads-data parseCsvRows).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/lead-edit.check.ts
import { cleanLeadPatch, leadChangeWords, splitLeadAddress, type LeadEditField } from "../../../src/lib/leads/details";
import { parseCsvRows } from "../../../src/components/v3/leads-blueprint/leads-data";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── the one-line address ──
const s1 = splitLeadAddress("1420 Maple St, Seattle, WA 98101");
check("street, city, ST zip", eq(s1, { address: "1420 Maple St", city: "Seattle", state: "WA", zip: "98101" }), JSON.stringify(s1));
const s2 = splitLeadAddress("1420 Maple St, Bothell wa 98011-1234");
check("no comma before the state, lower case, zip+4", eq(s2, { address: "1420 Maple St", city: "Bothell", state: "WA", zip: "98011-1234" }), JSON.stringify(s2));
const s3 = splitLeadAddress("88 Ridge Ave N, Apt 4, Seattle, WA");
check("a unit stays with the street; no zip", eq(s3, { address: "88 Ridge Ave N, Apt 4", city: "Seattle", state: "WA", zip: null }), JSON.stringify(s3));
const s4 = splitLeadAddress("  1420   Maple St , Seattle , WA 98101, USA ");
check("spaces and a trailing USA", eq(s4, { address: "1420 Maple St", city: "Seattle", state: "WA", zip: "98101" }), JSON.stringify(s4));
check("a street alone stays whole", eq(splitLeadAddress("1420 Maple St"), { address: "1420 Maple St", city: null, state: null, zip: null }));
check("a city and state alone stay whole (not a street)", eq(splitLeadAddress("Bothell, WA"), { address: "Bothell, WA", city: null, state: null, zip: null }));
check("a spelled-out state stays whole", splitLeadAddress("1420 Maple St, Seattle, Washington 98101").city === null);
check("empty is empty", eq(splitLeadAddress("  "), { address: null, city: null, state: null, zip: null }) && eq(splitLeadAddress(null), { address: null, city: null, state: null, zip: null }));

// ── the form's checks ──
const c1 = cleanLeadPatch({ name: "  Dana  Reed ", phone: "", email: " dana@example.com ", address: " 1420 Maple St ", zip: "98011" });
check("trimmed, '' → null, keys kept", c1.ok && eq(c1.patch, { name: "Dana Reed", phone: null, email: "dana@example.com", address: "1420 Maple St", zip: "98011" }), JSON.stringify(c1));
check("a key left out stays out", c1.ok && !("city" in c1.patch) && !("projectType" in c1.patch));
const c2 = cleanLeadPatch({ name: " " });
check("the name can't be cleared", !c2.ok && /name/.test(c2.error));
check("an email has to read as one", !cleanLeadPatch({ email: "dana at example" }).ok);
check("a phone needs 7 digits", !cleanLeadPatch({ phone: "555-01" }).ok && cleanLeadPatch({ phone: "(425) 555-0112" }).ok);
check("a ZIP has to look like one", !cleanLeadPatch({ zip: "98011!!" }).ok && cleanLeadPatch({ zip: "98011-1234" }).ok && cleanLeadPatch({ zip: "V6B 1A1" }).ok);
check("too long is refused, by name", (() => { const r = cleanLeadPatch({ city: "x".repeat(81) }); return !r.ok && /city/.test(r.error); })());
check("nothing given is fine (nothing changes)", (() => { const r = cleanLeadPatch({}); return r.ok && eq(r.patch, {}); })());

// ── the trail's words ──
const before = { name: "Dana Reed", phone: "+14255550112", email: null, address: null, city: null, state: null, zip: null, projectType: "Deck" } as Record<LeadEditField, string | null>;
const after = { ...before, phone: "+14255550199", email: "dana@example.com", address: "1420 Maple St", zip: "98011", projectType: null };
const w = leadChangeWords(before, after, ["phone", "email", "address", "zip", "projectType"]);
check("added / changed / removed, in that order", w === "added the email, street address and ZIP; changed the phone; removed the project", w);
check("one field", leadChangeWords(before, { ...before, city: "Bothell" }, ["city"]) === "added the city");

// ── the CSV's address columns ──
const csv = [
  "Name,Email Address,Phone,Street Address,City,State,ZIP Code,Project",
  'Dana Reed,dana@example.com,(425) 555-0112,1420 Maple St,Bothell,WA,98011,Deck',
  'Owen Cole,,(509) 555-0168,,,,,Fence',
].join("\n");
const rows = parseCsvRows(csv);
check("two rows", rows.length === 2);
check("'Email Address' is the email, not the street", rows[0].email === "dana@example.com" && rows[0].address === "1420 Maple St", JSON.stringify(rows[0]));
check("city / state / ZIP columns", rows[0].city === "Bothell" && rows[0].state === "WA" && rows[0].zip === "98011");
check("blank address cells are null", rows[1].address === null && rows[1].city === null && rows[1].zip === null);
const one = parseCsvRows('name,phone,address\nMia Park,(206) 555-0101,"88 Ridge Ave N, Seattle, WA 98109"');
check("one address column keeps the whole line (the import splits it)", one[0].address === "88 Ridge Ave N, Seattle, WA 98109" && one[0].city === null);
const old = parseCsvRows("name,email,phone,project,description\nDana,d@x.test,4255550112,Roof,Old file");
check("an old file without address columns still reads", old[0].name === "Dana" && old[0].project === "Roof" && old[0].address === null && old[0].description === "Old file");
const noHead = parseCsvRows("Dana,d@x.test,4255550112,Roof,Words");
check("no header: the old column guesses, no address", noHead[0].name === "Dana" && noHead[0].phone === "4255550112" && noHead[0].address === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
