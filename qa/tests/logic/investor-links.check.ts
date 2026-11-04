// SEVERAL INVESTOR LINKS (owner, 2026-11-04: "create two or three … keep it unassigned … send it to people … they fill
// it up and it says link is not active"): the settings keep a list of links, each live until it is closed on its own.
// The pure half — what is read back from what is stored, the one link of before as the first of the list, and what a
// reader of one link is given of the settings (none of the other links).
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-links.check.ts
import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { cleanSettings, forReaders, type InvestorReport } from "../../../src/lib/investors";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== "" ? ` :: ${JSON.stringify(detail)}` : ""}`);
};

const A = "linkAAAAAAAAAAAAAAAAAAAA", B = "linkBBBBBBBBBBBBBBBBBBBB", C = "linkCCCCCCCCCCCCCCCCCCCC";

// Before 2026-11-04 the settings held one link.
const legacy = cleanSettings({ linkToken: A, linkEnabled: true, linkMadeAt: "2026-11-03T10:00:00.000Z" });
check("the one link of before is read as the first of the list, live, with its making time", legacy.links.length === 1 && legacy.links[0].token === A && legacy.links[0].enabled && legacy.links[0].madeAt === "2026-11-03T10:00:00.000Z", legacy.links);
check("…and is still the newest live link", legacy.linkToken === A && legacy.linkEnabled && legacy.linkMadeAt === "2026-11-03T10:00:00.000Z");
const legacyOff = cleanSettings({ linkToken: A, linkEnabled: false, linkMadeAt: "2026-11-03T10:00:00.000Z" });
check("a switched-off link of before stays closed", legacyOff.links.length === 1 && !legacyOff.links[0].enabled && legacyOff.linkToken === null && !legacyOff.linkEnabled);
check("no link at all: an empty list, nothing live", cleanSettings({}).links.length === 0 && cleanSettings({}).linkToken === null && !cleanSettings({}).linkEnabled);

// The list as stored now, newest first.
const many = cleanSettings({
  links: [
    { token: C, madeAt: "2026-11-04T12:00:00.000Z", enabled: true },
    { token: B, madeAt: "2026-11-04T11:00:00.000Z", enabled: false },
    { token: A, madeAt: "2026-11-04T10:00:00.000Z", enabled: true },
  ],
  // a stale single-link field is read past: the list wins
  linkToken: B,
  linkEnabled: true,
});
check("three links kept in their order, each with its own switch", many.links.map((l) => `${l.token.slice(4, 5)}${l.enabled ? "+" : "-"}`).join(" ") === "C+ B- A+", many.links);
check("the newest LIVE link is the one the page head and the PDF use — not a closed one, not a stale field", many.linkToken === C && many.linkMadeAt === "2026-11-04T12:00:00.000Z" && many.linkEnabled);
const allClosed = cleanSettings({ links: [{ token: C, madeAt: "x", enabled: false }, { token: A, madeAt: "y", enabled: false }] });
check("every link closed: none live", allClosed.linkToken === null && !allClosed.linkEnabled && allClosed.links.length === 2);
const junk = cleanSettings({ links: [{ token: "short", madeAt: "x", enabled: true }, { token: A, enabled: true }, { token: A, madeAt: "dup", enabled: true }, null, 7] });
check("a bad token, a repeat and junk are dropped; a missing making time reads as empty", junk.links.length === 1 && junk.links[0].token === A && junk.links[0].madeAt === "", junk.links);
check("other settings are untouched by the links", many.approveReaders === true && many.horizonDays === 180);

// A reader of one link never receives the others.
const report = { settings: many, spend: { entries: [{ id: "x" }], byPlatform: [] }, insights: { any: 1 } } as unknown as InvestorReport;
const shown = forReaders(report).settings;
check("the public page gets no link list and no token", shown.links.length === 0 && shown.linkToken === null && shown.linkMadeAt === null, shown);
check("…and still none of the hand-booked spend or Meta's own figures", forReaders(report).spend.entries.length === 0 && forReaders(report).insights === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
