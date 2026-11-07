// The Projects flow, walked start to finish on a kitchen remodel (2026-11-06) — the rules it found wrong (tsx, no framework):
//   npx tsx qa/tests/logic/projects-flow.check.ts
// · Buying: "Shaker cabinets, supplied and installed" is something to buy; "Permits and inspections" is not.
// · The order covers the "Order …" task that names what it holds, and only that one.
// · The crew's phone shows the stage on the calendar for today, not the first one the office left open.
// · A stage marked done no longer flags its materials or a late delivery.
import { buyingFlags, isMaterialLine, orderCoversTask } from "../../../src/lib/projectBuying/shared";
import { stageForDay } from "../../../src/lib/projectStages/shared";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log("ok  ", name);
  else {
    failed += 1;
    console.log("FAIL", name, detail ?? "");
  }
}

const line = (name: string, materialCost: number, laborCost: number) => ({ name, quantity: 1, materialCost, laborCost });
check("cabinets supplied and installed are bought", isMaterialLine(line("Shaker cabinets, supplied and installed", 9800, 2900)));
check("quartz counters templated and installed are bought", isMaterialLine(line("Quartz countertops, templated and installed", 4300, 1200)));
check("permits and inspections are not", !isMaterialLine(line("Permits and inspections", 650, 0)));
check("demolition and haul-away is work", !isMaterialLine(line("Demolition and haul-away", 400, 1800)));
check("a dumpster is a charge", !isMaterialLine(line("Dumpster rental", 450, 0)));
check("install labor is work", !isMaterialLine(line("Install labor", 0, 1200)));
check("a plain material line is bought", isMaterialLine(line("Tile backsplash", 600, 1200)));

check("the cabinets order ticks Order cabinets", orderCoversTask("Order cabinets", ["Shaker cabinets, supplied and installed"]));
check("…and not Order countertops", !orderCoversTask("Order countertops", ["Shaker cabinets, supplied and installed"]));
check("tile alone leaves Order the tile, the vanity and the fixtures", !orderCoversTask("Order the tile, the vanity and the fixtures", ["Tile backsplash"]));
check("a task that isn't an order is never ticked", !orderCoversTask("Set the cabinets", ["Shaker cabinets"]));

const st = (name: string, status: string, a: string | null, b: string | null) => ({ name, status, weight: 1, tasks: [], startsAt: a, endsAt: b });
const kitchen = [st("Selections and materials", "ACTIVE", "2026-11-09", "2026-11-13"), st("Demolition", "PLANNED", "2026-11-16", "2026-11-17"), st("Rough-in", "PLANNED", "2026-11-18", "2026-11-24")];
check("demolition day shows Demolition", stageForDay(kitchen, "2026-11-16")?.name === "Demolition");
check("a day in no stage shows the current one", stageForDay(kitchen, "2026-11-15")?.name === "Selections and materials");
check("a stage with no dates falls back to the current one", stageForDay([st("A", "PLANNED", null, null)], "2026-11-16")?.name === "A");

const today = new Date("2026-12-16T12:00:00Z");
const flags = buyingFlags(
  {
    materials: [
      { quantity: 1, orderedQty: 0, receivedQty: 0, stageName: "Rough-in", stageStart: "2026-11-18", stageDone: true },
      { quantity: 1, orderedQty: 0, receivedQty: 0, stageName: "Final", stageStart: "2026-12-15", stageDone: false },
    ],
    orders: [
      { status: "ORDERED", expectedAt: "2026-12-05", label: "Order 2 (Rose City Tile & Stone)", stageDone: true },
      { status: "ORDERED", expectedAt: "2026-12-10", label: "Order 3 (ABC)", stageDone: false },
    ],
  },
  today,
);
check("a done stage's materials don't flag", !flags.some((f) => f.text.startsWith("Rough-in")), flags);
check("an open stage past its order-by day still flags", flags.some((f) => f.text.startsWith("Final")), flags);
check("a done stage's late order doesn't flag", !flags.some((f) => f.text.startsWith("Order 2")), flags);
check("an open stage's late order still flags", flags.some((f) => f.text.startsWith("Order 3")), flags);

console.log(failed ? `\n${failed} FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
