// Writes lib/assistant/catalog.generated.ts from the tools' cards (2026-11-06) — the labels, groups, builds, steps,
// PIN and scheduled flags the client reads. Run after adding or changing a tool:
//   npm run assistant:catalog
// The registry check (qa/tests/logic/assistant-registry.check.ts) fails the build when the file is stale.
import "../qa/tests/_lib/_server-only";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOLS } from "../src/lib/assistant/tools";
import { catalogFrom, catalogSource } from "../src/lib/assistant/registryCatalog";

const file = resolve(__dirname, "../src/lib/assistant/catalog.generated.ts");
const next = catalogSource(catalogFrom(TOOLS));
let before = "";
try {
  before = readFileSync(file, "utf8");
} catch {
  /* first time */
}
if (before === next) {
  console.log(`catalog unchanged: ${Object.keys(catalogFrom(TOOLS)).length} tools`);
} else {
  writeFileSync(file, next);
  console.log(`catalog written: ${Object.keys(catalogFrom(TOOLS)).length} tools → ${file}`);
}
