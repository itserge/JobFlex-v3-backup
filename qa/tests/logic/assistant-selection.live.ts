// THE MODEL'S CHOICE OF TOOL, LIVE (2026-11-06, the owner's spec §15 "AI tool-selection testing"): every tool's card
// carries what a person says to get it; this sends each sample through the real model with the Operator's own
// prompt and tool list and checks the first tool it reaches for. Opt-in — it costs a few cents and needs a key:
//   OPENAI_API_KEY=sk-… ASSISTANT_SELECTION_LIVE=1 NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant-selection.live.ts
// Without the flag it says so and exits 0, so the logic suite stays green on the stand and in qa-lab.
import "../_lib/_server-only";
import OpenAI from "openai";
import { TOOLS } from "../../../src/lib/assistant/tools";
import { modelTools, capabilityPrompt } from "../../../src/lib/assistant/registry";
import { systemPrompt } from "../../../src/lib/assistant/engine";
import type { AssistantActor } from "../../../src/lib/assistant/actor";
import { zodFunction } from "openai/helpers/zod";
import type { z } from "zod";

async function main() {
  if (process.env.ASSISTANT_SELECTION_LIVE !== "1" || !process.env.OPENAI_API_KEY || /fake|test/i.test(process.env.OPENAI_BASE_URL ?? "")) {
    console.log("skipped: set ASSISTANT_SELECTION_LIVE=1 and a real OPENAI_API_KEY to run the model's tool choice against every card's samples");
    process.exit(0);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const actor: AssistantActor = { organizationId: "org", userId: "u", role: "OWNER", channel: "app", timezone: "America/Los_Angeles", orgName: "QA Co", userName: "QA" };
  const live = await modelTools();
  const tools = live.map((t) => zodFunction({ name: t.name, description: t.description, parameters: t.params as unknown as z.ZodObject<z.ZodRawShape> }));
  const system = systemPrompt(actor, new Date(), null, [], live);
  void capabilityPrompt;
  let bad = 0;
  let asked = 0;
  for (const t of TOOLS) {
    for (const sample of t.card.samples) {
      asked++;
      const r = await client.chat.completions.create({ model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: sample.say }], tools, tool_choice: "auto", parallel_tool_calls: false });
      const call = r.choices[0]?.message.tool_calls?.find((c) => c.type === "function");
      const got = call?.type === "function" ? call.function.name : "(no tool)";
      // A change that needs an id first is allowed to look it up: find / crew / reminders before the change.
      const lookupFirst = ["find", "crew", "reminders", "schedule"].includes(got) && t.kind === "write";
      const ok = got === t.name || lookupFirst;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "FAIL"} "${sample.say}" → ${got}${ok && got !== t.name ? ` (then ${t.name})` : ""}${ok ? "" : ` :: expected ${t.name}`}`);
    }
  }
  console.log(bad ? `\n${bad} of ${asked} FAILED` : `\nall ok · ${asked} samples`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
