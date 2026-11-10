// THE PLAN SET'S EDIT (2026-11-09; owner, after a Tennessee contractor found the permit set too busy: "a button on
// very top called edit … you can delete that card, or you can edit that card and remove some information and maybe add
// something else"). The edits kept on top of the drawn set: a card's words cleaned to a few tags (no script, no style,
// no picture, no link), its classes kept as tokens, the design's words fingerprinted to tell when they change, sheets
// taken out without renumbering the others, sheets added after the G sheets (permit) or at the end (crew).
// Pure: no React, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/plan-edits.check.ts
import { addedAfter, bringBack, cleanCardHtml, dropAdded, dropSheet, editCount, editedSheets, editsFromTemplate, emptySetEdits, fingerprint, isBlank, isOut, mapCardClasses, MAX_TEMPLATES, normalizePlanEdits, normalizeTemplateIndex, nothingToSave, sheetEditId, SIMPLE_OUT, takeOut, templateFrom, templateName, type PlanEdits, type SetEdits } from "../../../src/lib/deck/plans/edits";
import { crewSheetList, permitSheetList } from "../../../src/lib/deck/plans/sheets";
import { buildStructure } from "../../../src/lib/deck/structure";
import { defaultDeckDesign } from "../../../src/lib/deck/design";

let bad = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
};

/* ── cleaning a card's words ─────────────────────────────────────────────── */
{
  const a = cleanCardHtml('<div class="h x">Footing schedule<span>6 footings</span></div><table class="t"><tbody><tr><td class="k">F1</td><td colspan="2">Landing pad</td></tr></tbody></table>');
  check("keeps the tables, the spans and the classes", a === '<div class="h x">Footing schedule<span>6 footings</span></div><table class="t"><tbody><tr><td class="k">F1</td><td colspan="2">Landing pad</td></tr></tbody></table>', a);
  const b = cleanCardHtml('<div onclick="alert(1)" style="color:red" data-x="1">Hi<script>alert(2)</script><img src=x onerror=alert(3)><svg><text>drawn</text></svg><a href="javascript:alert(4)">link</a></div>');
  check("drops every script, event, style, picture, drawing and link", b === "<div>Hilink</div>", b);
  const c = cleanCardHtml("<ol><li>One<li>Two</ol><b>open");
  check("closes what was left open, in order", c === "<ol><li>One<li>Two</li></li></ol><b>open</b>", c);
  const d = cleanCardHtml("a < b && c > d &amp; e &lt;tag&gt;");
  check("escapes loose brackets and ampersands, keeps entities", d === "a &lt; b &amp;&amp; c &gt; d &amp; e &lt;tag&gt;", d);
  const e = cleanCardHtml('<!-- note --><scr<script>ipt>alert(1)</script><style>p{}</style><div>ok</div>');
  check("comments, nested script tricks and style blocks go", !/script|alert\(1\)<|style|note/.test(e) && e.endsWith("<div>ok</div>"), e);
  const f = cleanCardHtml('<td colspan="99" rowspan="2" class="a&quot;b">x</td>');
  check("a span out of range and a class with a quote are dropped", f === '<td rowspan="2">x</td>', f);
  check("a card is cut to its size limit", cleanCardHtml(`<div>${"x".repeat(90_000)}</div>`).length <= 40_000);
}

/* ── classes as tokens, and back ─────────────────────────────────────────── */
{
  const live = '<div class="plan-set-module__a1__h">H</div><ol class="plan-set-module__a1__notes other"><li>x</li></ol>';
  const toTok: Record<string, string> = { "plan-set-module__a1__h": "p:h", "plan-set-module__a1__notes": "p:notes" };
  const stored = mapCardClasses(cleanCardHtml(live), (c) => toTok[c] ?? null);
  check("the build's class names are kept as tokens (an unknown one dropped)", stored === '<div class="p:h">H</div><ol class="p:notes"><li>x</li></ol>', stored);
  const nextBuild: Record<string, string> = { "p:h": "ps_h_zz9", "p:notes": "ps_notes_zz9" };
  const back = mapCardClasses(stored, (t) => nextBuild[t] ?? null);
  check("and drawn with the next build's names", back === '<div class="ps_h_zz9">H</div><ol class="ps_notes_zz9"><li>x</li></ol>', back);
}

/* ── the design's words, fingerprinted ───────────────────────────────────── */
{
  check("a fingerprint ignores spacing", fingerprint("F1  12 in.\n\tdeep") === fingerprint(" F1 12 in. deep "));
  check("and changes with a figure", fingerprint("Beam 2-2x10") !== fingerprint("Beam 2-2x12"));
  check("eight hex digits", /^[0-9a-f]{8}$/.test(fingerprint("x")));
}

/* ── edits read back from anywhere ───────────────────────────────────────── */
{
  const n = normalizePlanEdits({
    permit: {
      hidden: ["foundation/bearing", "sheet:elevations", "bad id <x>", 7, "foundation/bearing"],
      cards: { "foundation/footings": { html: '<div class="p:h">F</div><script>x</script>', was: "0a1b2c3d" }, "x y": { html: "z" } },
      added: [{ id: "add-1", after: "foundation/notes", html: "<div>A</div>" }, { id: "add-1", after: "x", html: "dup" }, { id: "add-2" }],
      sheets: [{ id: "sh-1", name: "  " }, { id: "sh-1", name: "dup" }],
      names: { schedules: "  Materials   list ", cover: "" },
    },
    crew: "nonsense",
  });
  check("bad ids, doubles and junk are dropped", JSON.stringify(n.permit.hidden) === '["foundation/bearing","sheet:elevations"]', n.permit.hidden);
  check("a stored card is cleaned again on the way in", n.permit.cards["foundation/footings"]?.html === '<div class="p:h">F</div>' && n.permit.cards["foundation/footings"]?.was === "0a1b2c3d" && !n.permit.cards["x y"], n.permit.cards);
  check("an added card needs an id and a place, once", n.permit.added.length === 1 && n.permit.added[0].id === "add-1", n.permit.added);
  check("an added sheet without a name is 'Additional notes'", n.permit.sheets.length === 1 && n.permit.sheets[0].name === "Additional notes", n.permit.sheets);
  check("names are trimmed, blanks dropped", JSON.stringify(n.permit.names) === '{"schedules":"Materials list"}', n.permit.names);
  check("a set that was nonsense is empty", isBlank(n.crew));
  check("the change count", editCount(n.permit) === 2 + 1 + 1 + 1 + 1, editCount(n.permit));
}

/* ── the sheets with the contractor's changes ────────────────────────────── */
{
  const st = buildStructure(defaultDeckDesign({ state: "WA", frostIn: 18 }));
  const own = permitSheetList(st);
  const e: SetEdits = { ...emptySetEdits(), hidden: ["sheet:elevations"], names: { schedules: "Materials" }, sheets: [{ id: "sh-a", name: "County notes" }, { id: "sh-b", name: "Owner's form" }] };
  const list = editedSheets(own, e, "permit");
  const elev = list.find((x) => x.kind === "elevations");
  check("a sheet taken out stays listed, marked out", !!elev && elev.out && elev.no === "S-201");
  check("the others keep their numbers", list.filter((x) => !x.out && x.kind !== "extra").map((x) => x.no).join(",") === own.filter((x) => x.kind !== "elevations").map((x) => x.no).join(","));
  const sched = list.find((x) => x.kind === "schedules");
  check("a renamed sheet carries its own name too", sched?.name === "Materials" && sched.ownName === "Schedules and materials", sched);
  const extras = list.filter((x) => x.kind === "extra");
  check("added sheets follow the G sheets, numbered on", extras.map((x) => x.no).join(",") === "G-003,G-004" && list[2].kind === "extra" && list[3].kind === "extra", list.map((x) => x.no));
  check("an added sheet's edit id", sheetEditId(extras[0]) === "extra:sh-a" && extras[0].editId === "sheet:extra:sh-a");
  const more = editedSheets(permitSheetList(st, { complianceMore: true }), e, "permit");
  check("…after G-003 when the compliance runs on", more.filter((x) => x.kind === "extra").map((x) => x.no).join(",") === "G-004,G-005", more.map((x) => x.no));
  const crew = editedSheets(crewSheetList(st), { ...emptySetEdits(), sheets: [{ id: "c1", name: "Notes" }] }, "crew");
  const last = crew[crew.length - 1];
  check("on the crew's set an added sheet goes last, on letter", last.kind === "extra" && last.no === `C-${crew.length - 1}` && last.paper === "A", crew.map((x) => x.no));
  check("no edits, the same list", JSON.stringify(editedSheets(own, emptySetEdits(), "permit").map((x) => x.no)) === JSON.stringify(own.map((x) => x.no)));
}

/* ── added cards and sheets taken away again ─────────────────────────────── */
{
  const e: SetEdits = {
    ...emptySetEdits(),
    added: [
      { id: "add-a", after: "foundation/notes", html: "<div>A</div>" },
      { id: "add-b", after: "add-a", html: "<div>B</div>" },
      { id: "add-c", after: "sheet:extra:sh-1", html: "<div>C</div>" },
      { id: "add-d", after: "add-c", html: "<div>D</div>" },
    ],
    sheets: [{ id: "sh-1", name: "Notes" }],
    names: { "extra:sh-1": "Renamed" },
  };
  const x = dropAdded(e, "add-a");
  check("deleting an added card moves the next one up", x.added.length === 3 && addedAfter(x, "foundation/notes").map((a) => a.id).join() === "add-b", x.added);
  const y = dropSheet(e, "sh-1");
  check("deleting an added sheet takes its cards with it", y.sheets.length === 0 && y.added.map((a) => a.id).join() === "add-a,add-b" && !y.names["extra:sh-1"], y);
}

/* ── the Simple set (part 3) ─────────────────────────────────────────────── */
{
  const st = buildStructure(defaultDeckDesign({ state: "TN", frostIn: 12 }));
  const own = permitSheetList(st);
  const simple: SetEdits = { ...emptySetEdits(), simple: true };
  const kept = editedSheets(own, simple, "permit").filter((x) => !x.out);
  check("the Simple set: cover, site plan, foundation, framing, section, details", kept.map((x) => x.no).join(",") === "G-001,A-101,S-101,S-102,S-301,S-501", kept.map((x) => x.no));
  check("its cards out without writing them into the edits", isOut(simple, "foundation/bearing") && isOut(simple, "cover/check") && simple.hidden.length === 0 && !isOut(simple, "foundation/footings"));
  const back = bringBack(simple, "foundation/bearing");
  check("a card the Simple set left out comes back on its own", !isOut(back, "foundation/bearing") && (back.shown ?? []).includes("foundation/bearing") && isOut(back, "foundation/layout"));
  check("…and goes back out the same way", isOut(takeOut(back, "foundation/bearing"), "foundation/bearing") && !(takeOut(back, "foundation/bearing").shown ?? []).includes("foundation/bearing"));
  const mine = takeOut(simple, "framing/notes");
  check("a card of the contractor's own choosing goes into the edits", mine.hidden.includes("framing/notes") && isOut(mine, "framing/notes"));
  const full = { ...mine, simple: false, shown: [] };
  check("Full brings the Simple set's cards back and keeps the contractor's own", !isOut(full, "foundation/bearing") && !isOut(full, "sheet:notes") && isOut(full, "framing/notes"));
  check("every Simple id names a sheet or a card", SIMPLE_OUT.every((id) => /^sheet:[a-z0-9]+$/.test(id) || /^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)));
  const n = normalizePlanEdits({ permit: { simple: true, shown: ["foundation/bearing", "bad id"] } });
  check("read back: Simple and what was brought back", n.permit.simple === true && JSON.stringify(n.permit.shown) === '["foundation/bearing"]');
}

/* ── the contractor's own template (2026-11-10: "save as a template and he run his decks with exact template") ── */
{
  const check0 = { place: "Knox County, TN", department: "Codes", at: "2026-11-10T00:00:00.000Z", from: "online" as const, sources: [], onSet: 3, added: 1, todo: [{ need: "Affidavit", why: "Sign it.", design: false }] };
  const deck: PlanEdits = {
    v: 1,
    permit: {
      ...emptySetEdits(),
      simple: true,
      hidden: ["framing/notes", "sheet:site"],
      cards: { "cover/scope": { html: "<div>My scope</div>", was: fingerprint("The scope as drawn") } },
      added: [{ id: "add-a", after: "cover/scope", html: "<div>Call before you dig</div>" }],
      names: { cover: "Cover" },
      check: check0,
    },
    crew: { ...emptySetEdits(), hidden: ["crew-cover/tools"], tpl: { id: "tp-old", name: "Old" } },
  };
  const t = templateFrom(deck);
  check("a template keeps both sets: what was taken out, added, renamed, and Simple", t.permit.simple === true && t.permit.hidden.join() === "framing/notes,sheet:site" && t.permit.added.length === 1 && t.permit.names.cover === "Cover" && t.crew.hidden.join() === "crew-cover/tools", t);
  check("…its typed-over cards marked as the template's, with what they were typed over", t.permit.cards["cover/scope"].tpl === true && t.permit.cards["cover/scope"].was === fingerprint("The scope as drawn") && /My scope/.test(t.permit.cards["cover/scope"].html));
  check("…and neither the county's check nor another template's name", t.permit.check == null && t.crew.check == null && t.permit.tpl == null && t.crew.tpl == null);

  const other: PlanEdits = { v: 1, permit: { ...emptySetEdits(), check: { ...check0, place: "Davidson County, TN" } }, crew: emptySetEdits() };
  const on = editsFromTemplate(t, { id: "tp-1", name: "  My   permit set " }, other);
  check("on a deck: the template's name on both sets", on.permit.tpl?.id === "tp-1" && on.permit.tpl?.name === "My permit set" && on.crew.tpl?.id === "tp-1", [on.permit.tpl, on.crew.tpl]);
  check("…the deck's own county check kept, not the template deck's", on.permit.check?.place === "Davidson County, TN" && on.crew.check == null, on.permit.check);
  check("…and nothing of the deck's own without one", editsFromTemplate(t, { id: "tp-1", name: "" }).permit.check == null && editsFromTemplate(t, { id: "tp-1", name: "" }).permit.tpl?.name === "My template");

  const back = normalizePlanEdits(JSON.parse(JSON.stringify(on)));
  check("read back: the card's mark and the set's template", back.permit.cards["cover/scope"]?.tpl === true && back.permit.tpl?.id === "tp-1" && back.crew.tpl?.name === "My permit set", back.permit.tpl);
  check("a card typed on the deck itself carries no mark", normalizePlanEdits(deck).permit.cards["cover/scope"]?.tpl === undefined);
  check("the template's name is no change of its own", editCount(on.crew) === editCount(deck.crew) && isBlank({ ...emptySetEdits(), tpl: { id: "tp-1", name: "X" } }));

  const blank: PlanEdits = { v: 1, permit: emptySetEdits(), crew: emptySetEdits() };
  check("nothing to save: an untouched deck", nothingToSave(blank));
  check("…but Simple alone is worth saving, and so is one card out on the construction set", !nothingToSave({ ...blank, permit: { ...emptySetEdits(), simple: true } }) && !nothingToSave({ ...blank, crew: takeOut(emptySetEdits(), "crew-cover/tools") }));
  check("…a county check alone is not", nothingToSave({ ...blank, permit: { ...emptySetEdits(), check: check0 } }));

  check("a name: spaces tidied, cut to 60, words only", templateName("  A   B ") === "A B" && templateName("x".repeat(80)).length === 60 && templateName(7) === "" && templateName(null) === "");
  const idx = normalizeTemplateIndex({
    defaultId: "tp-2",
    list: [{ id: "tp-1", name: " One ", at: "2026-11-10T01:02:03.000Z" }, { id: "tp-1", name: "Twice" }, { id: "bad id!", name: "Bad" }, { id: "tp-3", name: "   " }, { id: "tp-2", name: "Two", at: "yesterday" }],
  });
  check("the list read back: no twin, no bad id, no empty name, a date or none", idx.list.map((x) => `${x.id}=${x.name}`).join() === "tp-1=One,tp-2=Two" && idx.list[0].at.startsWith("2026-11-10") && idx.list[1].at === "" && idx.defaultId === "tp-2", idx);
  check("…a default that is not on the list is none", normalizeTemplateIndex({ defaultId: "tp-9", list: [{ id: "tp-1", name: "One" }] }).defaultId === null && normalizeTemplateIndex(null).list.length === 0 && normalizeTemplateIndex("x").defaultId === null);
  check(`…and never more than ${MAX_TEMPLATES}`, normalizeTemplateIndex({ list: Array.from({ length: 20 }, (_, k) => ({ id: `tp-${k}`, name: `T${k}` })) }).list.length === MAX_TEMPLATES);
}

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall ok");
