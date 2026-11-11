// The standard stock items per trade (2026-09-20) come off the estimators
// themselves: every material line the fence, roof and HVAC engines price
// over their own catalogs. No database, no model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/inventory-presets.check.ts
import { presetItems } from "../../../src/lib/inventoryPresets";
import { stockKey } from "../../../src/lib/inventory";
import { explodeLines, fenceTypeForLine } from "../../../src/lib/inventoryBom";
import { parseSavedTakeoff, savedTakeoffMeta } from "../../../src/lib/fence/savedTakeoff";
import { computeFenceTakeoff } from "../../../src/lib/fence/takeoff";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const names = (t: "fence" | "roof" | "hvac") => presetItems(t).map((i) => i.name);
const has = (t: "fence" | "roof" | "hvac", re: RegExp) => names(t).some((n) => re.test(n));
const UNITS = new Set(["each", "linear ft", "sqft", "square", "lot", "bag", "box", "gal", "roll", "bundle", "hour"]);

const fence = names("fence");
check(`the fence list is the fence estimator's own materials (${fence.length} items)`, fence.length >= 12, fence.slice(0, 8).join(" | "));
check("posts, rails, pickets or boards, concrete, screws and gate posts are on it — components, never a 'package'", has("fence", /post/i) && has("fence", /rail|2x4|2 x 4|2×4/i) && has("fence", /picket|board|panel|1x6|1×6/i) && has("fence", /concrete/i) && has("fence", /screw|nail|fastener/i) && has("fence", /gate/i) && !has("fence", /package/i), fence.filter((n) => /post|rail|picket|board|concrete|gate/i.test(n)).slice(0, 8).join(" | "));
check("cedar and pressure-treated both appear", has("fence", /cedar/i) && has("fence", /pressure|PT\b|treated/i));

const roof = names("roof");
check(`the roof list is the roof estimator's own materials (${roof.length} items)`, roof.length >= 15, roof.slice(0, 8).join(" | "));
check("shingles, starter, underlayment, ice & water, drip edge and nails are on it", has("roof", /shingle/i) && has("roof", /starter/i) && has("roof", /underlayment/i) && has("roof", /ice/i) && has("roof", /drip edge/i) && has("roof", /nail|fastener/i));
check("metal and flat systems bring their own lines", has("roof", /metal|standing seam|panel/i) && has("roof", /membrane|tpo|epdm/i));

const hvac = names("hvac");
check(`the HVAC list is the HVAC estimator's own materials (${hvac.length} items)`, hvac.length >= 12, hvac.slice(0, 8).join(" | "));
check("equipment, line set, thermostat and a pad or bracket are on it", has("hvac", /condenser|heat pump|furnace|air handler/i) && has("hvac", /line ?set/i) && has("hvac", /thermostat/i) && has("hvac", /pad|bracket|stand/i));

for (const t of ["fence", "roof", "hvac"] as const) {
  const items = presetItems(t);
  check(`${t}: no labor, fees or rentals on the shelf list`, items.every((i) => !/permit|fee|labor|install|dumpster|disposal|rental|crane|hoist|warranty/i.test(i.name)), items.filter((i) => /permit|fee|labor|install|dumpster|disposal|rental|crane|hoist|warranty/i.test(i.name)).map((i) => i.name).join(" | "));
  check(`${t}: every unit is one the warehouse counts in, no duplicates by meaning`, items.every((i) => UNITS.has(i.unit)) && new Set(items.map((i) => stockKey(i.name))).size === items.length, [...new Set(items.map((i) => i.unit))].join(","));
}

// A fence proposal's package line, read back through the estimator's takeoff.
const parts = explodeLines("fence", [{ name: "Cedar privacy — 6' fence package", quantity: 104, unit: "ln ft" }, { name: "Single gate — framed & hung", quantity: 1, unit: "ea" }, { name: "Stain & seal (both faces)", quantity: 600, unit: "sqft" }]);
check("a 104 ft cedar privacy package with a gate becomes its posts, rails, pickets, concrete, nails, caps and the gate kit", fenceTypeForLine("Cedar privacy — 6' fence package")?.id === "cedar-privacy" && parts.some((l) => /line posts/i.test(l.name) && l.quantity >= 8) && parts.some((l) => /gate posts/i.test(l.name)) && parts.some((l) => /concrete/i.test(l.name) && l.quantity > 20) && parts.some((l) => /screw|nail/i.test(l.name)) && parts.some((l) => /gate kit|hinge/i.test(l.name)) && parts.some((l) => /post caps/i.test(l.name)) && !parts.some((l) => /package|single gate/i.test(l.name)), parts.map((l) => `${l.quantity} ${l.unit} ${l.name}`).slice(0, 8).join(" | "));
check("a line that is not a package passes through untouched", parts.some((l) => l.name === "Stain & seal (both faces)" && l.quantity === 600));
check("the components are named exactly as the standard items, so they match on the shelf", parts.filter((l) => !/stain/i.test(l.name)).every((l) => presetItems("fence").some((p) => stockKey(p.name) === stockKey(l.name))), parts.filter((l) => !presetItems("fence").some((p) => stockKey(p.name) === stockKey(l.name))).map((l) => l.name).join(" | "));

// The fence studio's own list, kept at convert (lib/fence/savedTakeoff, 2026-11-10).
{
  const lines = [
    { name: "Cedar privacy — 6' fence package", quantity: 487.6, unit: "ln ft" },
    { name: "Single gate — framed & hung", quantity: 1, unit: "ea" },
    { name: "Slope steps — extended posts & leveling", quantity: 56, unit: "ea" },
    { name: "Black steel gate posts", quantity: 2, unit: "ea" },
  ];
  const tk = computeFenceTakeoff({ type: "cedar-privacy", heightFt: 6, runs: [{ lengthFt: 491.6, corners: 4, closed: true }], openings: [{ widthFt: 4, kind: "gate", label: "Single gate", variant: "single" }], terrain: "sloped", wastePct: 10, steppedSections: 56, steelGatePosts: true });
  const saved = parseSavedTakeoff(savedTakeoffMeta({ forLf: 487.6, lines: lines.map((l) => l.name), bom: tk.bom }));
  const kept = explodeLines("fence", [...lines, { name: "Gravel for the gate pad", quantity: 3, unit: "bag" }], saved);
  const posts = (ls: typeof kept) => ls.filter((l) => /posts/i.test(l.name) && !/caps/i.test(l.name)).reduce((a, l) => a + l.quantity, 0);
  check("a kept list is the pick list: the loop's 4 corners, 2 black steel gate posts, the 10' step posts — every post once", !!saved && kept.some((l) => /^Corner posts/.test(l.name) && l.quantity === 4) && kept.some((l) => /black steel/.test(l.name) && l.quantity === 2) && !kept.some((l) => /^End posts/.test(l.name)) && posts(kept) === tk.posts.total, `${posts(kept)} of ${tk.posts.total}: ${kept.filter((l) => /posts/.test(l.name)).map((l) => l.name + " " + l.quantity).join(" | ")}`);
  check("…the price lines it stands for are gone, a line added by hand since stays", !kept.some((l) => /^Slope steps|^Black steel gate posts$|fence package/.test(l.name)) && kept.some((l) => l.name === "Gravel for the gate pad" && l.quantity === 3));
  const edited = explodeLines("fence", [{ ...lines[0], quantity: 520 }, ...lines.slice(1)], saved);
  check("an edited fence (the package's footage changed) is rebuilt from its lines, not picked from the old list", edited.some((l) => /^End posts/.test(l.name)), edited.filter((l) => /posts/.test(l.name)).map((l) => l.name).join(" | "));
  check("no kept list, or a broken one: rebuilt from the lines as before", explodeLines("fence", lines, null).some((l) => /^End posts/.test(l.name)) && parseSavedTakeoff("{oops") === null && parseSavedTakeoff(JSON.stringify({ forLf: 1, lines: [], bom: [] })) === null);
  // The rebuilt list no longer takes the gate out a second time, and knows the studio's double gate is 8 ft.
  const one = explodeLines("fence", [{ name: "Cedar privacy — 6' fence package", quantity: 100, unit: "ln ft" }, { name: "Double gate — framed & hung", quantity: 1, unit: "ea" }]);
  const bare = explodeLines("fence", [{ name: "Cedar privacy — 6' fence package", quantity: 100, unit: "ln ft" }]);
  const pickets = (ls: typeof one) => ls.find((l) => /pickets/.test(l.name))?.quantity ?? 0;
  check("rebuilt: a package's 100 lf with a gate keeps 100 lf of pickets (the gate is already out of it)", pickets(one) === pickets(bare) && one.some((l) => l.name === "Gate kit") && !one.some((l) => /Drive gate kit/.test(l.name)), `${pickets(one)} vs ${pickets(bare)}; ${one.filter((l) => /kit/i.test(l.name)).map((l) => l.name).join(",")}`);
  check("rebuilt: a graded cedar package ('· clear cedar') is still read as its fence", fenceTypeForLine("Cedar privacy — 6' fence package · clear cedar")?.id === "cedar-privacy");
}

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
