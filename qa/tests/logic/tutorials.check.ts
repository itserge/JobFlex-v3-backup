// The Tutorials page (2026-11-11, lib/tutorials/catalog + the sidebar's Learn row): every role and every workspace
// reaches it, and every film's chapters are in order and inside the film. Pure — no server, no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/tutorials.check.ts
import { TUTORIALS, chapterAt, clock, minutes, tutorialBySlug, tutorialFile } from "../../../src/lib/tutorials/catalog";
import { flattenNavItems, navSectionsFor } from "../../../src/components/v3/blueprint-shell/nav-map";
import { isPathAllowed, ROLE_ROUTE_GATES } from "../../../src/lib/roleRoutes";
import { navAllowed } from "../../../src/lib/editions";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const PAGE = "/dashboard/tutorials";
const hrefsOf = (role: string | null, workspace?: "platform" | "deck") =>
  navSectionsFor(role, [], [], workspace ? { workspace, unlocked: [] } : undefined).flatMap((s) => flattenNavItems(s.items).map((i) => i.href));

// ── who reaches it
for (const role of ["OWNER", "ADMIN", "MANAGER", "INSTALLER", "SALES", "ESTIMATOR"]) {
  const hrefs = hrefsOf(role);
  check(`${role}: the sidebar's last row is Tutorials`, hrefs.at(-1) === PAGE, hrefs.at(-1));
}
for (const role of Object.keys(ROLE_ROUTE_GATES)) check(`${role}: the route gate lets the page open`, isPathAllowed(ROLE_ROUTE_GATES[role], PAGE));
check("the Deck Studio workspace keeps the row", navAllowed("deck", PAGE) && hrefsOf("OWNER", "deck").includes(PAGE));
check("a custom plan's lock never covers it", hrefsOf("OWNER").includes(PAGE) && !navSectionsFor("OWNER", ["/dashboard/crm", "/dashboard/fence-estimator"]).flatMap((s) => s.items).find((i) => i.href === PAGE)?.locked);

// ── the films
check("six tutorials, the owner's five and the AI desk", TUTORIALS.map((t) => t.slug).join(",") === "new-home,remodel,deck-studio,crm,fence-studio,ai-desk");
check("slugs are unique", new Set(TUTORIALS.map((t) => t.slug)).size === TUTORIALS.length);
for (const t of TUTORIALS) {
  const at = t.chapters.map((c) => c.at);
  check(`${t.slug}: chapters start at 0:00, in order, inside the film`, at[0] === 0 && at.every((x, i) => i === 0 || x > at[i - 1]) && at.at(-1)! < t.duration, `${at.length} chapters, last ${clock(at.at(-1)!)} of ${clock(t.duration)}`);
  check(`${t.slug}: its files are versioned`, /^tutorials\/[a-z-]+-v\d+\.mp4$/.test(tutorialFile(t, "mp4")) && tutorialFile(t, "jpg") === tutorialFile(t, "mp4").replace(/mp4$/, "jpg"), tutorialFile(t, "mp4"));
  check(`${t.slug}: teaches a page in the sidebar`, hrefsOf("OWNER").includes(t.toolHref) || hrefsOf("OWNER").some((h) => h === t.toolHref));
}

// ── the small helpers
check("clock: 0:00 · 3:27 · 1:02:03", clock(0) === "0:00" && clock(207.9) === "3:27" && clock(3723) === "1:02:03");
check("minutes: 8 min, never 0", minutes(506) === "8 min" && minutes(20) === "1 min");
const deck = tutorialBySlug("deck-studio")!;
check("chapterAt: the chapter started, the one before at its edge", chapterAt(deck, 0) === 0 && chapterAt(deck, 208) === 6 && chapterAt(deck, 206.9) === 6 && chapterAt(deck, 206) === 5);
check("an unknown slug opens nothing", tutorialBySlug("nope") === null && tutorialBySlug(null) === null);

console.log(bad ? `\n${bad} failed` : "\nall ok");
if (bad) process.exit(1);
