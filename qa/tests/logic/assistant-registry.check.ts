// THE CAPABILITY REGISTRY'S GATE (2026-11-06, the owner's spec §15): every tool the AI Operator can run must carry a
// complete card, arguments the model can be given strictly, a sample that parses, a permission that exists — and the
// client's catalog must be what the cards say. Fails the build when any of it is off; runs in qa-lab's logic suite.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant-registry.check.ts
import "../_lib/_server-only";
import { TOOLS, TOOL_GROUPS } from "../../../src/lib/assistant/tools";
import { CAPABILITIES } from "../../../src/lib/assistant/roles";
import { catalogFrom, catalogSource } from "../../../src/lib/assistant/registryCatalog";
import { CATALOG } from "../../../src/lib/assistant/catalog.generated";
import { capabilityPrompt, paramsSchema } from "../../../src/lib/assistant/registry";
import { factsOf } from "../../../src/lib/assistant/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
}

const EFFECTS = new Set(["read", "record", "draft", "schedule", "message", "money"]);
const names = TOOLS.map((t) => t.name);
check("registry: every tool has a distinct snake_case name", new Set(names).size === names.length && names.every((n) => /^[a-z][a-z_]+$/.test(n)), names);

for (const t of TOOLS) {
  const c = t.card;
  const id = t.name;
  check(`${id}: a card with a label, a purpose and a line for the prompt`, Boolean(c.label.trim()) && c.purpose.trim().length > 10 && c.when.trim().length > 20);
  check(`${id}: a group the prompt knows and an effect the cards allow`, TOOL_GROUPS.includes(c.group) && EFFECTS.has(c.effect), { group: c.group, effect: c.effect });
  check(`${id}: works on at least one business object`, c.objects.length > 0);
  check(`${id}: a version from 1 and the day it shipped`, Number.isInteger(c.version) && c.version >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(c.since));
  check(`${id}: asks for a permission that exists`, (CAPABILITIES as readonly string[]).includes(t.need), t.need);
  check(`${id}: a read tool reads; a write tool changes something`, t.kind === "read" ? c.effect === "read" : c.effect !== "read");
  if (t.kind === "write") {
    check(`${id}: a build (a draft without a yes) says so with steps; anything else has none`, t.instant ? c.effect === "draft" && (c.steps?.length ?? 0) >= 2 : !c.steps);
    check(`${id}: money takes the PIN — and only money`, (c.effect === "money") === ["send_invoice", "financing_link", "pay_sub_invoice"].includes(id));
    if (t.scheduled) check(`${id}: a scheduled tool is a reminder`, c.group === "reminders");
  }
  // The arguments as the model gets them: a strict object — every field present, so each is required.
  let schema: { type?: string; required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean } | null = null;
  try {
    schema = paramsSchema(t) as typeof schema;
  } catch (err) {
    schema = null;
    check(`${id}: the arguments render to a JSON schema`, false, err instanceof Error ? err.message : String(err));
  }
  if (schema) {
    const props = Object.keys(schema.properties ?? {});
    check(`${id}: a strict object — every argument required, nothing extra`, schema.type === "object" && schema.additionalProperties === false && props.every((k) => (schema!.required ?? []).includes(k)), { props, required: schema.required });
  }
  check(`${id}: at least one sample of what a person says`, c.samples.length >= 1 && c.samples.every((s) => s.say.trim().length > 3));
  for (const [i, sample] of c.samples.entries()) {
    const r = t.params.safeParse(sample.args);
    check(`${id}: sample ${i + 1} parses — "${sample.say.slice(0, 50)}"`, r.success, r.success ? undefined : r.error.issues.slice(0, 3));
    if (t.kind === "write" && t.instant && r.success) check(`${id}: sample ${i + 1} gives the card its facts`, factsOf(id, sample.args).length >= 1, factsOf(id, sample.args));
  }
}

// The client's catalog is what the cards say.
const fresh = catalogFrom(TOOLS);
check("catalog: lib/assistant/catalog.generated.ts matches the tools' cards (else: npm run assistant:catalog)", catalogSource(fresh) === catalogSource(CATALOG), {
  missing: Object.keys(fresh).filter((n) => !(n in CATALOG)),
  stale: Object.keys(fresh).filter((n) => n in CATALOG && JSON.stringify(fresh[n]) !== JSON.stringify(CATALOG[n])),
  gone: Object.keys(CATALOG).filter((n) => !(n in fresh)),
});

// The prompt names every live tool, under its group, and no group is empty of its guide's tools.
const prompt = capabilityPrompt(TOOLS);
check("prompt: every tool has its line", TOOLS.every((t) => prompt.includes(`- ${t.name}: `)), TOOLS.filter((t) => !prompt.includes(`- ${t.name}: `)).map((t) => t.name));
check("prompt: the groups come in order", TOOL_GROUPS.map((g) => prompt.indexOf(`\n- ${TOOLS.find((t) => t.card.group === g)?.name ?? "∅"}: `)).filter((i) => i >= 0).every((v, i, a) => i === 0 || v > a[i - 1]));
check("prompt: a retired tool keeps its line out", !capabilityPrompt(TOOLS.filter((t) => t.name !== "build_deck")).includes("- build_deck: "));

console.log(bad ? `\n${bad} FAILED` : `\nall ok · ${TOOLS.length} tools`);
process.exit(bad ? 1 : 0);
