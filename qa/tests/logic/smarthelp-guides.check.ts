// SmartHelp guides: written from the code, so every page, target and word must exist.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp-guides.check.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Lucide from "lucide-react";
import { GUIDES, GUIDE_TARGETS } from "../../../src/lib/smarthelp/guides";
import { isHelpPage, pathOf } from "../../../src/lib/smarthelp/pages";
import type { SetupKey } from "../../../src/lib/smarthelp/types";
import { NAV_SECTIONS, flattenNavItems } from "../../../src/components/v3/blueprint-shell/nav-map";
import { appRoutes, isRealRoute } from "../../lib/appRoutes";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

/** Every literal data-tour="name" written anywhere in src/. */
function tourNamesInSrc(root = "src"): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(e.name)) {
        for (const m of readFileSync(p, "utf8").matchAll(/data-tour="([^"]+)"/g)) out.add(m[1]);
      }
    }
  };
  walk(root);
  return out;
}

const routes = appRoutes();
const inSrc = tourNamesInSrc();
const navHrefs = new Set(NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items)).map((i) => i.href));
const texts = GUIDES.flatMap((g) => [g.title, ...g.steps.map((s) => s.text)]);

check("there are guides", GUIDES.length >= 10, GUIDES.length);
check("ids unique", new Set(GUIDES.map((g) => g.id)).size === GUIDES.length);
const badSteps = GUIDES.filter((g) => g.steps.length < 2 || g.steps.length > 6).map((g) => `${g.id}:${g.steps.length}`);
check("2-6 steps each", badSteps.length === 0, badSteps);
const longTitles = GUIDES.filter((g) => g.title.length > 40).map((g) => g.title);
check("titles at most 40 characters", longTitles.length === 0, longTitles);
const emptyText = GUIDES.flatMap((g) => g.steps.filter((s) => !s.text.trim()).map(() => g.id));
check("every step has text", emptyText.length === 0, emptyText);

const opens = GUIDES.flatMap((g) => g.steps.filter((s) => s.open).map((s) => s.open!));
const notHelp = opens.filter((o) => !isHelpPage(o));
check("every open is a SmartHelp page", notHelp.length === 0, notHelp);
const notReal = opens.filter((o) => !isRealRoute(pathOf(o), routes));
check("every open is a real route", notReal.length === 0, notReal);

const shows = GUIDES.flatMap((g) => g.steps.filter((s) => s.show).map((s) => s.show!));
const missing = shows.filter((t) => (t.startsWith("nav:") ? !navHrefs.has(t.slice(4)) : !inSrc.has(t)));
check("every show is a data-tour in src or a nav row", missing.length === 0, [...new Set(missing)]);
check(
  "GUIDE_TARGETS is exactly the shows used",
  GUIDE_TARGETS.size === new Set(shows).size && shows.every((t) => GUIDE_TARGETS.has(t)),
  { targets: GUIDE_TARGETS.size, shows: new Set(shows).size },
);

const setupNeeds = GUIDES.filter((g) => g.group === "setup" && g.needs).map((g) => g.needs!);
const wanted: SetupKey[] = ["aiDesk", "texting", "payments", "website", "booking", "profile", "team"];
const absent = wanted.filter((k) => !setupNeeds.includes(k));
check("setup group covers every setup key", absent.length === 0, absent);
check("one setup guide per setup key", new Set(setupNeeds).size === setupNeeds.length, setupNeeds);
const needsOutsideSetup = GUIDES.filter((g) => g.group !== "setup" && g.needs).map((g) => g.id);
check("only setup guides carry needs", needsOutsideSetup.length === 0, needsOutsideSetup);
const byNeed = (k: SetupKey) => GUIDES.find((g) => g.needs === k);
check("website guide is behind the website feature", byNeed("website")?.feature === "website");
check("booking guide is behind the booking feature", byNeed("booking")?.feature === "booking");

const manualJ = texts.filter((t) => /Manual J(?!-style)/.test(t));
check('no "Manual J" without "-style"', manualJ.length === 0, manualJ);
const urls = texts.filter((t) => /http/i.test(t));
check("no URLs in guide text", urls.length === 0, urls);
const paths = texts.filter((t) => /\/dashboard|\?pane=|\?tab=/.test(t));
check("no app paths in guide text", paths.length === 0, paths);

const icons = Lucide as unknown as Record<string, unknown>;
const noIcon = GUIDES.filter((g) => !icons[g.icon]).map((g) => `${g.id}:${g.icon}`);
check("every icon is a lucide-react export", noIcon.length === 0, noIcon);

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
