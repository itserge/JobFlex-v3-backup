// THE JOBFLEX ASSISTANT · THE FAKE MODEL (2026-11-04) — a stand-in for OpenAI's
// chat completions WITH TOOLS, for the Assistant's runs on the local stand.
// Point the stand's OPENAI_BASE_URL at it (http://127.0.0.1:4601/v1). Never a
// real key, never a real call. It plays the model's part the way the prompt
// asks: look up first, then call ONE change tool with the ids the lookup gave,
// or ask "1 or 2" when two things match. Dates come from the "Today's date is"
// line of the system prompt, so a run on any day reads the same.
//   "what's on tomorrow" / "… friday"           → schedule(that day) → the list
//   "what needs attention" / "who owes"           → today → the checks
//   "send <words>" [an email]                    → find(proposal) → send_proposal (or "1 or 2")
//   "put|move|schedule <words> on <day> [with <name>]" → find(job) + crew → schedule_job
//   "tell everybody <message>" / "text <name> <message>" → crew → text_crew
//   "remind <words>"                              → find(proposal) → payment_reminder
//   "how much did we make" / "profit"             → money(this month | last month)
//   "unsigned" / "follow up"                      → open_proposals
//   "build|price|estimate … deck|pergola|gazebo 12 by 16 [roof] [for <name>]" → find(any) → build_deck (slice 3)
//   "build|price|estimate <anything else> [for <name>]" → find(any) → build_estimate
//   "change …" / "make it …" / "use …"            → change_deck | change_estimate on the newest built (the system prompt's list)
//   "send it"                                      → send_proposal on the newest built
//   "roof … at <address> [<n> sq ft, two-story, <material>]" → build_roof; "hvac|furnace|heat pump … at <address> <n> sq ft" → build_hvac
//   "the yard at <address>" → lawn_site; "price … mowing|fertilizer … at <address> | <n> sq ft" → build_lawn (2026-11-05)
//   "what's left to choose on <project>" → selections; "<they> picked <item> for <project> from <vendor> for $N" → choose_selection;
//   "add a <name> selection to <project>[, due YYYY-MM-DD][, allowance $N]" → add_selection; "mark <stage> done on <project>" → set_stage;
//   "<inspection> on <project> passed|failed" → inspection_result (2026-11-07, part 3)
//   "start a new build for <Name>, call it <X> — septic, a well, a basement, two stories, the bank…" → start_project + the lot's answers;
//   "what's the next gate on <project>" → next_gate (2026-11-07, part 4)
//   "where are we over|what's the margin|where can I save $N on <project>" → money_plan (2026-11-07, part 5)
//   "what's funded on <project>" → draws; "request draw three on <project>" → request_draw; "the bank funded draw two on <project>" → fund_draw (2026-11-07, part 6)
//   "the lender's link|page for <project>" → lender_link (2026-11-08, part 7)
//   Smart Proposal's own run (response_format json_object, no tools): a small estimate in the old draft shape.
//   Speech (POST /v1/audio/speech, the Talk mode's voice): 0.3 s of silence as an MP3, so a page plays it and goes on.
//   The Budget card's read (response_format json_schema "budget_read", 2026-11-07): words → the rules' own rows
//   (lib/projectBudgetImport), with a figure changed when the words say "fakecheck"; a picture → a lender's page.
//   The estimate reader (json_schema "quote_read", 2026-11-08, the subcontractors plan, part 2): words → the figures
//   by regex (the fixtures in qa/fixtures/docs); a PDF file part or a picture → XYZ Electric's $23,500 proposal; a
//   file named "blank" → nothing to read. The comparer (json_schema "compare_words") → two sentences from the fields.
//   NODE_PATH="" npx --no-install tsx qa/fixtures/assistant-fake-openai.ts     (FAKE_OPENAI_PORT, default 4601)
import http from "node:http";
import { readBudgetText } from "../../src/lib/projectBudgetImport";

const PORT = Number(process.env.FAKE_OPENAI_PORT || 4601);
/** 0.3 s of silence, 24 kHz mono MP3 (ffmpeg anullsrc). */
const SILENT_MP3 = Buffer.from("SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYyLjMuMTAwAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAAPAAAGYAAtLS0tLS08PDw8PDw8S0tLS0tLWlpaWlpaWmlpaWlpaWl4eHh4eHiHh4eHh4eHlpaWlpaWlqWlpaWlpbS0tLS0tLTDw8PDw8PD0tLS0tLS4eHh4eHh4fDw8PDw8PD///////8AAAAATGF2YzYyLjExAAAAAAAAAAAAAAAAJANgAAAAAAAABmBrl8IEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TErAAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=", "base64");
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Msg = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

let seq = 0;
const callId = () => `call_${++seq}`;

function todayOf(system: string): Date {
  const m = /Today's date is (\d{4})-(\d{2})-(\d{2})/.exec(system);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date();
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function dayFrom(text: string, today: Date): string {
  if (/\btomorrow\b/.test(text)) return iso(new Date(today.getTime() + 86_400_000));
  if (/\btoday\b/.test(text)) return iso(today);
  const i = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(text));
  if (i < 0) return iso(new Date(today.getTime() + 86_400_000));
  const d = new Date(today);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== i);
  return iso(d);
}
function subject(text: string): string {
  return text
    .replace(/\b(send|put|move|schedule|remind|the|a|an|proposal|on|to|for|with \w+|about|payment|please|it|job)\b/gi, " ")
    .replace(new RegExp(`\\b(${DAYS.join("|")}|tomorrow|today)\\b`, "gi"), " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reply(content: string | null, calls?: ToolCall[]) {
  return {
    id: `chatcmpl-fake-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "fake-assistant",
    choices: [{ index: 0, message: { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
const call = (name: string, args: unknown) => reply(null, [{ id: callId(), type: "function", function: { name, arguments: JSON.stringify(args) } }]);

/** What the model "said" for this request so far: the tool results after the last user message, by tool name. */
function soFar(messages: Msg[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let last = -1;
  messages.forEach((m, i) => { if (m.role === "user") last = i; });
  const names = new Map<string, string>();
  for (const m of messages.slice(last + 1)) {
    for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
    if (m.role === "tool" && m.tool_call_id) {
      try { out.set(names.get(m.tool_call_id) ?? "?", JSON.parse(m.content ?? "null")); } catch { out.set(names.get(m.tool_call_id) ?? "?", null); }
    }
  }
  return out;
}

type Found = { proposals?: Array<{ id: string; title: string; client: string | null; total: string }>; jobs?: Array<{ id: string; title: string; client: string | null; proposalId: string | null }>; workers?: Array<{ id: string; name: string }>; clients?: Array<{ id: string; name: string }>; leads?: Array<{ id: string; name: string }> };

/** Smart Proposal's estimate, in the old quote-draft shape lib/estimate/legacy-estimate reads. */
function fakeEstimate(prompt: string) {
  const type = /Project type: ([^\n]+)/.exec(prompt)?.[1]?.trim() || "Job";
  const roof = /roof/i.test(type), fence = /fence/i.test(type);
  const lineItems = roof
    ? [
        { name: "Tear-off and disposal, one layer", measurementType: "unit", quantity: 22, unitPrice: 95, materialCost: 20, laborCost: 75, total: 2090 },
        { name: "Architectural shingles", measurementType: "unit", quantity: 22, unitPrice: 240, materialCost: 150, laborCost: 90, total: 5280 },
        { name: "Synthetic underlayment", measurementType: "unit", quantity: 22, unitPrice: 45, materialCost: 30, laborCost: 15, total: 990 },
        { name: "Drip edge and flashing", measurementType: "fixed", fixedPrice: 650, total: 650 },
      ]
    : fence
      ? [
          { name: "Cedar privacy fence, 6 ft", measurementType: "linearft", quantity: 150, unitPrice: 38, materialCost: 22, laborCost: 16, total: 5700 },
          { name: "Walk gate", measurementType: "unit", quantity: 1, unitPrice: 450, materialCost: 280, laborCost: 170, total: 450 },
        ]
      : [
          { name: `${type} — materials`, measurementType: "fixed", fixedPrice: 2400, total: 2400 },
          { name: `${type} — labor`, measurementType: "hour", quantity: 24, unitPrice: 85, total: 2040 },
        ];
  return { title: `${type} estimate`, summary: `${type}, priced on the stand.`, scope: ["Prepare the site", "Do the work", "Clean up and haul away"], pricing: { lineItems, notes: ["A fake estimate from the stand's model."] }, timeline: "3 days" };
}
type Crew = { workers: Array<{ id: string; name: string; texts: boolean }> };

function answer(body: { messages: Msg[] }) {
  const messages = body.messages ?? [];
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const text = user.toLowerCase();
  const today = todayOf(system);
  const done = soFar(messages);

  for (const [, v] of done) {
    const o = v as { notAllowed?: string; notDone?: string; error?: string } | null;
    if (o?.notAllowed) return reply(o.notAllowed);
    if (o?.notDone) return reply(o.notDone);
    if (o?.error) return reply(`That didn't work: ${o.error}`);
  }

  // The estimators by voice (2026-11-05): a roof, HVAC or lawn care at an address — before the generic build rule,
  // which would price them with Smart Proposal. The address: "at 14 Oak St, Tacoma WA" / "address: …".
  // "14 Oak St, Tacoma WA" — up to the end, a sentence's end, or the next ", 2,400 …" / ", the lawn …" clause.
  const addrOf = (t: string) => /\b(?:address is|address:|here'?s the address:?|the property is|the yard at|the house at|at|for|of)\s+(\d+\s+[A-Za-z][A-Za-z0-9 .]*?(?:,\s*[A-Za-z][A-Za-z .]*?)?(?:,?\s+[A-Z]{2}\b)?)(?=\s*(?:,\s*(?:\d|the\b|and\b|with\b|a\b|about\b)|\.\s|$))/i.exec(t)?.[1]?.trim() ?? null;
  const sqftOf = (t: string) => { const m = /([\d,]{3,7})\s*(?:sq\.?\s*ft|square f(?:ee|oo)t|sqft)/i.exec(t); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const storeysOf = (t: string) => { const m = /\b(one|two|three|1|2|3)[- ](?:stor(?:e)?y|stories|floors?)\b/i.exec(t); return m ? ({ one: 1, two: 2, three: 3 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1]) : null; };
  const builtTrade = (trade: string) => new RegExp(`proposalId=(\\S+) · "[^"]*" · ${trade} \\(change it`).exec(system)?.[1] ?? null;
  const isChange = /^\s*(change|make it|make|use|the (best|good|better) one|go with)\b/.test(text);
  const ROOF_WORDS = /\b(standing.?seam|metal panel|metal|3.?tab|three.?tab|impact|designer|concrete tile|clay tile|tile|cedar shake|shake|synthetic slate|slate|tpo|epdm|membrane|architectural(?: shingles?)?|shingles?)\b/i;
  // A change names the trade by its "built lately" line, not by a trade word: "make it standing seam" after a roof,
  // "the best one" after HVAC, "every other week" after a lawn.
  if (((/\broof\b/.test(text) && addrOf(user)) || (isChange && builtTrade("roof") && ROOF_WORDS.test(user))) && !/\b(deck|pergola)\b/.test(text)) {
    const material = ROOF_WORDS.exec(user)?.[1] ?? null;
    const layers = /\b(two|2|three|3) layers?\b/i.exec(text);
    return call("build_roof", { address: addrOf(user), clientId: null, leadId: null, material, existing: /\bnow\b.*\b(metal|tile|shake)\b/.exec(text)?.[1] ?? null, storeys: storeysOf(text), homeSqft: sqftOf(text), tearOffLayers: layers ? ({ two: 2, three: 3 } as Record<string, number>)[layers[1]] ?? Number(layers[1]) : null, replaces: isChange ? builtTrade("roof") : null });
  }
  if ((/\b(hvac|furnace|heat pump|air condition|a\/?c unit|new ac\b|mini.?split|ductless|water heater|new system)\b/.test(text) && addrOf(user)) || (isChange && builtTrade("HVAC") && /\b(best|good|better|premium|value|cheapest|heat pump|furnace|system|unit|1|2|3)\b/.test(text))) {
    const job = /water heater/.test(text) ? "water-heater" : /mini.?split|ductless/.test(text) ? "ductless" : /furnace only|just the furnace|new furnace/.test(text) ? "replace-furnace" : /add (ac|cooling|air)/.test(text) ? "add-ac" : /convert|heat pump conversion/.test(text) ? "heat-pump-conversion" : /outdoor unit|condenser only|just the (ac|condenser)/.test(text) ? "replace-outdoor" : "replace-system";
    const tier = /\b(best|premium)\b/.test(text) ? "best" : /\b(good|cheapest|value)\b/.test(text) ? "good" : /\bbetter\b/.test(text) ? "better" : null;
    const year = /\bbuilt (?:in )?(19\d\d|20\d\d)\b/.exec(text);
    return call("build_hvac", { address: addrOf(user), clientId: null, leadId: null, job, sqft: sqftOf(text), storeys: storeysOf(text), yearBuilt: year ? Number(year[1]) : null, existing: null, gas: /\bno gas\b|all.?electric/.test(text) ? false : null, outdoorKind: /heat pump/.test(text) && !/conversion/.test(text) ? "heat-pump" : null, tier, replaces: isChange ? builtTrade("HVAC") : null });
  }
  if ((/\b(lawn|mow|mowing|yard|landscap)\w*\b/.test(text) && (addrOf(user) || sqftOf(text))) || (isChange && builtTrade("lawn") && /\b(week|mow|fertiliz|aerat|cleanup|mulch|snow|gutter|shrub|hedge)\w*\b/.test(text))) {
    // "the yard at …" alone reads it; "price …" prices it.
    if (!/\b(price|estimate|quote|mow|mowing|fertiliz|aerat|cleanup|mulch)\w*\b/.test(text) && addrOf(user)) return call("lawn_site", { address: addrOf(user) });
    const services = ([["mow", /\bmow/], ["fert", /fertiliz/], ["aerate", /aerat/], ["overseed", /overseed/], ["dethatch", /dethatch/], ["springCleanup", /spring clean/], ["fallCleanup", /fall (leaf )?clean/], ["mulch", /mulch/], ["bedWeeding", /bed weed/], ["shrubs", /shrub/], ["hedges", /hedge/], ["irrigationStart", /sprinkler start|start.?up/], ["irrigationBlowout", /blowout|winteriz/], ["gutters", /gutter/], ["snow", /snow/]] as const).filter(([, re]) => re.test(text)).map(([id]) => id);
    const beds = /([\d,]{2,6})\s*(?:sq\.?\s*ft|square feet)\s*(?:of )?beds?/i.exec(user);
    return call("build_lawn", { address: addrOf(user), lawnSqft: sqftOf(text), bedSqft: beds ? Number(beds[1].replace(/,/g, "")) : null, clientId: null, leadId: null, frequency: /every other week|bi.?weekly|every two weeks/.test(text) ? "biweekly" : /weekly|every week/.test(text) ? "weekly" : null, services: services.length ? services : null, fertRounds: null, mulchDepthIn: null, stories: storeysOf(text), snowPushes: null, replaces: isChange ? builtTrade("lawn") : null });
  }

  // Spec §11 (2026-11-06): several changes in one sentence — "put X on Thursday with Mike and tell Mike to bring the
  // ladder". The engine answers a planned change with { planned: true } and asks for the next; the second step is the
  // crew text; with both planned, a short sentence ends the turn.
  const hourOf = (t: string): string | null => {
    const h = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
    return h ? `${String((+h[1] % 12) + (h[3] === "pm" ? 12 : 0)).padStart(2, "0")}:${h[2] ?? "00"}` : null;
  };
  const planned = (name: string) => Boolean((done.get(name) as { planned?: boolean } | undefined)?.planned);
  if (planned("schedule_job") || planned("book_visit")) {
    if (planned("text_crew")) return reply("Both are planned — say yes and I'll do them in order.");
    const next = /\band (?:tell|text) (\w+) (?:to )?(.+)$/i.exec(user);
    if (next) {
      const c = done.get("crew") as Crew | undefined;
      if (!c) return call("crew", {});
      const w = c.workers.find((x) => x.name.toLowerCase().startsWith(next[1].toLowerCase()));
      return call("text_crew", { workerIds: w ? [w.id] : null, message: next[2].trim().replace(/[.]$/, "") });
    }
    return reply("Planned — say yes to do it.");
  }
  // Spec §12 (2026-11-06): the business questions — job profit and spending — answered from the tools' figures.
  if (/\b(losing money|making money|job profit|open jobs doing)\b/.test(text)) {
    const r = done.get("jobs_money") as { which: string; jobs: Array<{ title: string; profit: string; cost: string }>; note: string } | undefined;
    const which = /losing/.test(text) ? "losing" : /open/.test(text) ? "open" : "best";
    if (!r) return call("jobs_money", { which });
    return reply(r.jobs.length ? r.jobs.map((j) => `${j.title}: profit ${j.profit} (cost ${j.cost})`).join("; ") : r.note);
  }
  if (/\bspen[dt]\b|\bspending\b/.test(text)) {
    const r = done.get("spending") as { period: string; total: string; byCategory: Array<{ category: string; amount: string }>; receipts: number } | undefined;
    const cat = /\bon ([a-z]+)/.exec(text)?.[1] ?? null;
    const period = /last month/.test(text) ? "last_month" : /this month/.test(text) ? "this_month" : "last_30_days";
    if (!r) return call("spending", { period, category: cat && !/^(what|the|it)$/.test(cat) ? cat : null });
    return reply(r.receipts ? `${r.period}: ${r.total} — ${r.byCategory.map((c) => `${c.category} ${c.amount}`).join(", ")}.` : `Nothing booked ${r.period.startsWith("the") ? "in " : "for "}${r.period}.`);
  }

  // "Who do we have for carpentry?" → contractors(trade) → the names.
  const whoFor = /\b(?:who do we have|which \w+ do we use|list our contractors)(?: for ([a-z ]+?))?\s*\??$/i.exec(user);
  if (whoFor) {
    const r = done.get("contractors") as { contractors?: Array<{ name: string; trade: string | null }> } | undefined;
    if (!r) return call("contractors", { trade: whoFor[1]?.trim() ?? null });
    const cs = r.contractors ?? [];
    return reply(cs.length ? `${cs.map((c) => `${c.name}${c.trade ? ` (${c.trade})` : ""}`).join(", ")}.` : "Nobody on the list yet.");
  }
  // Contractors (2026-11-07): "ask the framers for a quote on the Lee house framing" → ask_quotes; "any quotes back on
  // the framing" → quotes; "award the framing to Ridge Framing" → award_quote. The project comes from the records
  // or a find; the stand's drive names it outright.
  const askQ = /\bask (?:the )?([a-z]+?s?)\b.*?\bfor a quote on (?:the )?(.+?) (?:framing|foundation|roof|plumbing|electrical|drywall|finishes|site work|stage|work)\b/i.exec(user);
  if (askQ && !done.has("ask_quotes")) {
    const stage = /\b(framing|foundation|roof|plumbing|electrical|drywall|finishes|site work)\b/i.exec(user)?.[1] ?? null;
    const found = done.get("find") as Found | undefined;
    const pid = found?.projects?.[0]?.id ?? null;
    if (!pid) return call("find", { query: askQ[2].trim(), kind: "project" });
    return call("ask_quotes", { projectId: pid, stage, trade: askQ[1].replace(/s$/, ""), contractors: null });
  }
  if (done.has("ask_quotes")) return reply("Asked — say yes and the requests go out.");
  const anyQ = /\b(any quotes|who quoted|quotes back|what did .* quote)\b.*?\bon (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (anyQ) {
    const r = done.get("quotes") as { quotes?: Array<{ contractor: string; status: string; amount: number | null; best: boolean }> } | undefined;
    if (!r) {
      const found = done.get("find") as Found | undefined;
      const pid = found?.projects?.[0]?.id ?? null;
      if (!pid) return call("find", { query: anyQ[2].trim().replace(/\b(framing|foundation|roof)\b/i, "").trim(), kind: "project" });
      return call("quotes", { projectId: pid, stage: /\b(framing|foundation|roof)\b/i.exec(user)?.[1] ?? null });
    }
    const qs = r.quotes ?? [];
    return reply(qs.length ? qs.map((q) => `${q.contractor}: ${q.status === "QUOTED" && q.amount != null ? `$${q.amount.toLocaleString("en-US")}${q.best ? " (lowest)" : ""}` : q.status.toLowerCase()}`).join("; ") + "." : "No quotes yet.");
  }
  const awardQ = /\baward (?:the )?(\w+) (?:on (?:the )?(.+?) )?to ([A-Z][\w ]+?)\s*$/i.exec(user);
  if (awardQ && !done.has("award_quote")) {
    const found = done.get("find") as Found | undefined;
    const pid = found?.projects?.[0]?.id ?? null;
    if (!pid) return call("find", { query: (awardQ[2] ?? "").trim() || "house", kind: "project" });
    return call("award_quote", { projectId: pid, contractor: awardQ[3].trim(), stage: awardQ[1] });
  }
  if (done.has("award_quote")) return reply("Planned — say yes to award it.");
  // Selections and gates (2026-11-07, part 3): "what's left to choose on the Bennett kitchen" → selections; "the Bennetts
  // picked the shaker cabinets from Pacific Cabinet Supply for $8,400" → choose_selection; "add a tile selection to the
  // Smith bath, due 2026-11-20, allowance $2,000" → add_selection; "mark the rough-in done on the Bennett kitchen" →
  // set_stage (refused by the engine while its inspection holds); "the rough-in on the Bennett kitchen passed" →
  // inspection_result. The project comes from a find, as the contractors' rules do.
  const projectFound = (query: string) => {
    const found = done.get("find") as Found | undefined;
    return found?.projects?.[0]?.id ?? (query ? null : null);
  };
  const leftQ = /\b(?:what(?:'s| is) left to choose|selections? (?:left|open|late)|what did they (?:pick|choose))\b.*?\bon (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (leftQ) {
    const r = done.get("selections") as { selections?: Array<{ name: string; words: string; chosen: string | null; price: string | null }>; note?: string } | undefined;
    if (!r) {
      const pid = projectFound(leftQ[1]);
      if (!pid) return call("find", { query: leftQ[1].trim(), kind: "project" });
      return call("selections", { projectId: pid, only: /late/i.test(user) ? "late" : /did they/i.test(user) ? "chosen" : "open" });
    }
    const xs = r.selections ?? [];
    return reply(xs.length ? xs.map((x) => `${x.name}: ${x.chosen ? `${x.chosen}${x.price ? ` ${x.price}` : ""}` : x.words}`).join("; ") + "." : (r.note ?? "Nothing to choose."));
  }
  const pickedQ = /\b(?:picked|chose|went with) (?:the )?(.+?) (?:for|on) (?:the )?(.+?)(?:,| from | for \$|$)/i.exec(user);
  if (pickedQ && !done.has("choose_selection")) {
    const pid = projectFound(pickedQ[2]);
    if (!pid) return call("find", { query: pickedQ[2].trim().replace(/\bkitchen|bath|deck|house\b/gi, "").trim() || pickedQ[2].trim(), kind: "project" });
    const vendor = /\bfrom ([A-Z][\w&' ]+?)(?:,| for|$)/.exec(user)?.[1]?.trim() ?? null;
    const price = /\$([\d,]+(?:\.\d+)?)/.exec(user);
    const item = pickedQ[1].trim();
    const sel = /\b(cabinet|counter|tile|floor|fixture|light|appliance|paint|window|door|trim|siding|roof|vanity|glass)\w*/i.exec(user)?.[0] ?? item;
    return call("choose_selection", { projectId: pid, selection: sel, chosen: item, vendor, price: price ? Number(price[1].replace(/,/g, "")) : null });
  }
  if (done.has("choose_selection")) return reply("Planned — say yes to record it.");
  const addSel = /\badd (?:a |an )?(.+?) selection to (?:the )?(.+?)(?:,|$)/i.exec(user);
  if (addSel && !done.has("add_selection")) {
    const pid = projectFound(addSel[2]);
    if (!pid) return call("find", { query: addSel[2].trim(), kind: "project" });
    const day = /\bdue (\d{4}-\d{2}-\d{2})/.exec(user)?.[1] ?? null;
    const allowance = /allowance \$?([\d,]+)/i.exec(user);
    const stage = /\bfor (?:the )?(\w[\w ]*?) stage\b/i.exec(user)?.[1] ?? null;
    return call("add_selection", { projectId: pid, name: addSel[1].trim().replace(/^\w/, (c) => c.toUpperCase()), stage, dueBy: day, allowance: allowance ? Number(allowance[1].replace(/,/g, "")) : null });
  }
  if (done.has("add_selection")) return reply("Planned — say yes to add it.");
  const stageDone = /\b(?:mark (?:the )?(.+?) (?:as )?done on (?:the )?(.+?)|(?:the )?(.+?) on (?:the )?(.+?) (?:is|are) done)\s*$/i.exec(user);
  if (stageDone && !done.has("set_stage")) {
    const stage = (stageDone[1] ?? stageDone[3]).trim();
    const proj = (stageDone[2] ?? stageDone[4]).trim();
    const pid = projectFound(proj);
    if (!pid) return call("find", { query: proj, kind: "project" });
    return call("set_stage", { projectId: pid, stage, status: "DONE" });
  }
  if (done.has("set_stage")) return reply("Planned — say yes to mark it.");
  const inspQ = /\b(?:the )?(.+?) (?:inspection )?on (?:the )?(.+?) (passed|failed)\b/i.exec(user);
  if (inspQ && !done.has("inspection_result")) {
    const pid = projectFound(inspQ[2]);
    if (!pid) return call("find", { query: inspQ[2].trim(), kind: "project" });
    return call("inspection_result", { projectId: pid, inspection: inspQ[1].trim(), result: inspQ[3].toUpperCase() as "PASSED" | "FAILED", note: null });
  }
  if (done.has("inspection_result")) return reply("Planned — say yes to record it.");
  // "Start a kitchen remodel for Sarah Lee, she lives there" → start_project (2026-11-07): the kind from the words,
  // the template from the job's word, the client's name as said; the engine reads it back and a yes makes it.
  const started = /\bstart (?:a |an )?(?:new )?(?:(kitchen|bath|bathroom|deck|roof|fence|addition|basement|whole[- ]house|adu|garage|windows?|painting|service|floors?|hvac|siding) )?(remodel|new build|new construction|new house|build|house|project)\b(?:.*?\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?))?/i.exec(user);
  if (started && !done.has("start_project")) {
    const job = (started[1] ?? "").toLowerCase();
    const kind = /new build|new construction|new house|^(build|house)$/.test(started[2].toLowerCase()) ? "NEW_BUILD" : "REMODEL";
    const template = kind === "NEW_BUILD" ? "home" : job === "bathroom" ? "bath" : job === "whole house" || job === "whole-house" ? "wholehouse" : job === "garage" ? "adu" : job === "window" ? "windows" : job === "floor" ? "floors" : job || null;
    const client = started[3] ?? null;
    const called = /\bcall it (?:the )?([A-Z][\w ]+?)(?:\s*[—-]|,|$)/.exec(user)?.[1]?.trim() ?? null;
    const name = called ?? (client ? `${client.split(" ").pop()} ${job || (kind === "NEW_BUILD" ? "house" : "remodel")}` : `${job || "new"} project`);
    // The lot's words (part 4): septic, a well, a basement/slab, two stories, a shop, a lender/the bank, power from the pole, all electric, fiber.
    const lot = kind === "NEW_BUILD" ? {
      sewer: /\bseptic\b/i.test(user) ? "SEPTIC" : /\bsewer\b/i.test(user) ? "SEWER" : null,
      water: /\bwell\b/i.test(user) ? "WELL" : /city water|water at the street/i.test(user) ? "WATER" : null,
      foundation: /\bbasement\b/i.test(user) ? "BASEMENT" : /\bslab\b/i.test(user) ? "SLAB" : /crawl/i.test(user) ? "CRAWL" : null,
      stories: /two stor|2 stor|two-stor/i.test(user) ? 2 : /one stor|single stor|rambler/i.test(user) ? 1 : null,
      garage: /no garage/i.test(user) ? false : /\bgarage\b/i.test(user) ? true : null,
      shop: /\b(shop|barn|pole building)\b/i.test(user) ? true : null,
      lender: /lender|the bank|financ|construction loan/i.test(user) ? true : /cash|no lender/i.test(user) ? false : null,
      power: /from the pole|power at the pole/i.test(user) ? "POLE" : /power at the lot/i.test(user) ? "AT_LOT" : null,
      gas: /all.?electric|no gas/i.test(user) ? false : /\bgas\b/i.test(user) ? true : null,
      fiber: /\bfiber\b/i.test(user) ? true : null,
    } : { sewer: null, water: null, foundation: null, stories: null, garage: null, shop: null, lender: null, power: null, gas: null, fiber: null };
    return call("start_project", { name, kind, client, template, occupied: /lives? there|living there|occupied/i.test(user) ? true : null, ...lot });
  }
  if (done.has("start_project")) return reply("Planned — say yes and I'll start it.");
  // The money (part 5): "where are we over on X" / "what's the margin on X" / "where can I save 20,000 on X" → money_plan.
  const moneyQ = /\b(?:where are we over|what(?:'s| is) the margin|where can i save(?: \$?([\d,]+))?)\b.*?\bon (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (moneyQ) {
    const r = done.get("money_plan") as { headline?: string; over?: Array<{ phase: string; over: string }> | string; margin?: string | null; profit?: string | null; suggestions?: Array<{ what: string; saves: string }>; note?: string } | undefined;
    const ask = /over/i.test(moneyQ[0]) && !/save/i.test(moneyQ[0]) ? "over" : /margin/i.test(moneyQ[0]) ? "margin" : "save";
    if (!r) {
      const pid = projectFound(moneyQ[2]);
      if (!pid) return call("find", { query: moneyQ[2].trim(), kind: "project" });
      return call("money_plan", { projectId: pid, ask, amount: moneyQ[1] ? Number(moneyQ[1].replace(/,/g, "")) : null });
    }
    if (ask === "over") return reply(`${r.headline ?? ""}${Array.isArray(r.over) && r.over.length ? ` — ${r.over.map((o) => `${o.phase} ${o.over} over`).join(", ")}` : ""}`.trim() + ".");
    if (ask === "margin") return reply(r.margin ?? r.profit ?? r.note ?? "No margin to measure yet.");
    return reply(r.suggestions?.length ? r.suggestions.map((x) => `${x.what} (${x.saves})`).join("; ") + "." : "Nothing to save on yet.");
  }

  // Draws (part 6): "what's funded on X" → draws; "request draw three on X" → request_draw; "the bank funded draw two on X" → fund_draw.
  const fundedQ = /\b(?:what(?:'s| is) funded|which draw is next|how much (?:has the bank|is) (?:released|held))\b.*?\bon (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (fundedQ) {
    const r = done.get("draws") as { funded?: string; held?: string; next?: string; note?: string } | undefined;
    if (!r) {
      const pid = projectFound(fundedQ[1]);
      if (!pid) return call("find", { query: fundedQ[1].trim(), kind: "project" });
      return call("draws", { projectId: pid });
    }
    return reply(r.note ?? `${r.funded} funded${r.held && r.held !== "$0" ? `, ${r.held} held` : ""}. Next: ${r.next}`);
  }
  const reqDraw = /\brequest (?:the )?(?:draw )?(\w+)(?: draw)? on (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (reqDraw && !done.has("request_draw")) {
    const pid = projectFound(reqDraw[2]);
    if (!pid) return call("find", { query: reqDraw[2].trim(), kind: "project" });
    return call("request_draw", { projectId: pid, draw: reqDraw[1] });
  }
  if (done.has("request_draw")) return reply("Planned — say yes to request it.");
  const fundQ = /\b(?:the bank|the lender) funded (?:draw )?(\w+)(?:,? \$?([\d,]+))? on (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (fundQ && !done.has("fund_draw")) {
    const pid = projectFound(fundQ[3]);
    if (!pid) return call("find", { query: fundQ[3].trim(), kind: "project" });
    return call("fund_draw", { projectId: pid, draw: fundQ[1], amount: fundQ[2] ? Number(fundQ[2].replace(/,/g, "")) : null });
  }
  if (done.has("fund_draw")) return reply("Planned — say yes to record it.");
  // The lender's page (part 7): "the lender's link for X" / "make the bank's page for X" → lender_link.
  const lenderQ = /\b(?:lender'?s?|bank'?s?) (?:link|page)\b.*?\bfor (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (lenderQ && !done.has("lender_link")) {
    const pid = projectFound(lenderQ[1]);
    if (!pid) return call("find", { query: lenderQ[1].trim(), kind: "project" });
    return call("lender_link", { projectId: pid });
  }
  if (done.has("lender_link")) return reply("Planned — say yes to make it.");
  // "What's the next gate on the Drive house?" → next_gate (part 4).
  const gateQ = /\b(?:what(?:'s| is) the next gate|where are we|which phase)\b.*?\bon (?:the )?(.+?)(?:\?|$)/i.exec(user);
  if (gateQ) {
    const r = done.get("next_gate") as { current?: { phase: string; gate: string } | null; done?: number; total?: number; note?: string } | undefined;
    if (!r) {
      const pid = projectFound(gateQ[1]);
      if (!pid) return call("find", { query: gateQ[1].trim(), kind: "project" });
      return call("next_gate", { projectId: pid });
    }
    return reply(r.current ? `${r.current.phase} — gate: ${r.current.gate}. ${r.done} of ${r.total} phases done.` : (r.note ?? "Every phase is done."));
  }
  // "Do we have a client named Lee?" → find(client) → the names (the records then remember them).
  const named1 = /\b(?:do we have|is there|find) (?:a |the )?(?:client|customer)(?: named| called)? ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i.exec(user);
  if (named1) {
    const f = done.get("find") as Found | undefined;
    if (!f) return call("find", { query: named1[1], kind: "client" });
    const cs = f.clients ?? [];
    return reply(cs.length ? `Yes: ${cs.map((c) => c.name).join(", ")}.` : `No client named ${named1[1]}.`);
  }
  // Spec §4 (2026-11-06): "him" / "her" / "it" — the records the prompt lists for this conversation, their ids as given.
  const recorded = (kind: string) => new RegExp(`- ${kind} "([^"]+)" · \\w+Id=(\\S+)`).exec(system);
  if (/\b(with|for) (him|her)\b/.test(text) && /\b(book|schedule) (a |an )?(visit|appointment)\b/.test(text)) {
    const c = recorded("client") ?? recorded("lead");
    if (c) return call("book_visit", { title: /\bmeasure\b/i.test(user) ? "Measure" : null, clientId: recorded("client") ? c[2] : null, leadId: recorded("client") ? null : c[2], date: dayFrom(text, today), start: hourOf(text) ?? "10:00", end: null, workerIds: null, notes: null });
  }

  // Slice 3: build, change, send what was built (the newest in the system prompt's "built lately" list).
  const lately = /proposalId=(\S+) · "[^"]*" · (deck|estimate)/.exec(system);
  if (/\b(build|price|estimate|quote)\b/.test(text) && !/^\s*(change|make it|use)\b/.test(text)) {
    const name = /\bfor (\w+)/i.exec(user)?.[1];
    const f = done.get("find") as Found | undefined;
    if (name && !f) return call("find", { query: name, kind: "any" });
    const clientId = f?.clients?.[0]?.id ?? null;
    const leadId = clientId ? null : (f?.leads?.[0]?.id ?? null);
    if (/\b(deck|pergola|gazebo)\b/.test(text)) {
      const size = /(\d+(?:\.\d+)?)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)/.exec(text);
      if (!size) return reply("How big is it — feet along the house, and how far out?");
      const cover = /\broof\b|covered/.test(text) ? "roof" : /pergola/.test(text) ? "pergola" : /gazebo/.test(text) ? "gazebo" : "none";
      return call("build_deck", { clientId, leadId, address: null, widthFt: +size[1], depthFt: +size[2], heightFt: null, cover, boards: /composite|cedar|trex|pressure.treated/.exec(text)?.[0] ?? null, rail: /aluminum|cable|glass/.exec(text)?.[0] ?? null, stairs: /\bstairs?\b/.test(text) ? true : null, more: null });
    }
    const projectType = /roof/.test(text) ? "Roof replacement" : /fence/.test(text) ? "Fence" : /paint/.test(text) ? "Interior painting" : "General repair";
    return call("build_estimate", { projectType, description: user, clientId, leadId, address: null });
  }
  if (/^\s*(change|make it|use)\b/.test(text) && lately) return call(lately[2] === "deck" ? "change_deck" : "change_estimate", { proposalId: lately[1], change: user.replace(/^\s*change( it)?[:,]?\s*/i, "") || user });
  if (/\bsend it\b/.test(text) && lately) return call("send_proposal", { proposalId: lately[1], email: /\S+@\S+\.\w+/.exec(user)?.[0] ?? null, clientName: null });

  // Batches 1–2 (2026-11-05): people, visits, reminders, a crew text each, money.
  const emailIn = /\S+@\S+\.\w+/.exec(user)?.[0] ?? null;
  const phoneIn = /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.exec(user)?.[0] ?? null;
  const named = (after: RegExp) => after.exec(user)?.[1] ?? null;
  if (/\b(add|new) (a |an )?(client|customer)\b/.test(text)) {
    const name = named(/(?:client|customer):?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? "Someone";
    const address = /,\s*([^,]*\b(?:St|Ave|Rd|Dr|Ln|Blvd)\b[^,]*)/.exec(user)?.[1]?.trim() ?? null;
    return call("add_client", { name, phone: phoneIn, email: emailIn, address, city: null, state: null, zip: null, notes: null });
  }
  const chg = /\b(?:change|update) (\w+)'?s (phone|email|address) to (.+)$/i.exec(user);
  if (chg) {
    const f = done.get("find") as Found | undefined;
    if (!f) return call("find", { query: chg[1], kind: "client" });
    const c = f.clients?.[0];
    if (!c) return reply("I couldn't find that client.");
    const field = chg[2].toLowerCase();
    const v = chg[3].trim().replace(/[.]$/, "");
    return call("update_client", { clientId: c.id, name: null, phone: field === "phone" ? v : null, email: field === "email" ? v : null, address: field === "address" ? v : null, city: null, state: null, zip: null, notes: null });
  }
  if (/\b(add|new) (a )?lead\b/.test(text)) {
    const name = named(/lead:?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? "Someone";
    const wants = /\bwants? (?:a |an )?([^,.]+)/i.exec(user)?.[1]?.trim() ?? null;
    return call("add_lead", { name, phone: phoneIn, email: emailIn, address: null, projectType: wants, description: null, source: /\breferral\b/i.test(user) ? "referral" : null });
  }
  if (/\bbook (a |an )?(visit|appointment)\b/.test(text)) {
    const f = done.get("find") as Found | undefined;
    const who = named(/\bwith ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? subject(user);
    if (!f) return call("find", { query: who || user, kind: "any" });
    const c = f.clients?.[0];
    const l = c ? null : f.leads?.[0];
    if (!c && !l) return reply("I couldn't find that person.");
    return call("book_visit", { title: /\bmeasure\b/i.test(user) ? "Measure" : null, clientId: c?.id ?? null, leadId: l?.id ?? null, date: dayFrom(text, today), start: hourOf(text) ?? "10:00", end: null, workerIds: null, notes: null });
  }
  if (/\b(move|cancel) (the |my )?(visit|appointment)\b/.test(text)) {
    const f = done.get("find") as (Found & { visits?: Array<{ id: string; title: string; with: string | null }> }) | undefined;
    const who = named(/\bwith ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? subject(user);
    if (!f) return call("find", { query: who || user, kind: "visit" });
    const v = f.visits?.[0];
    if (!v) return reply("I couldn't find that visit.");
    if (/\bcancel\b/.test(text)) return call("cancel_visit", { visitId: v.id });
    return call("move_visit", { visitId: v.id, date: dayFrom(text, today), start: hourOf(text), end: null });
  }
  if (/\bremind me\b/.test(text)) {
    const what = /\bto (.+?)[.!]?$/i.exec(user)?.[1] ?? user;
    return call("remind_me", { what, date: dayFrom(text, today), time: hourOf(text) ?? "15:00" });
  }
  if (/\breminders?\b/.test(text) && /\b(what|which|list|have|cancel)\b/.test(text)) {
    const r = done.get("reminders") as { reminders: Array<{ id: string; what: string; when: string | null }> } | undefined;
    if (!r) return call("reminders", {});
    if (/\bcancel\b/.test(text)) {
      if (done.get("cancel_reminder")) return reply("Cancelled that reminder.");
      if (!r.reminders.length) return reply("You have no reminders set.");
      return call("cancel_reminder", { reminderId: r.reminders[0].id });
    }
    return reply(r.reminders.length ? r.reminders.map((x) => `${x.when}: ${x.what}`).join("; ") : "You have no reminders set.");
  }
  const each = /\btell (\w+) (.+?) and (\w+) (.+)$/i.exec(user);
  if (each && !/\b(everybody|everyone)\b/i.test(user)) {
    const c = done.get("crew") as Crew | undefined;
    if (!c) return call("crew", {});
    const pick = (n: string) => c.workers.find((w) => w.name.toLowerCase().startsWith(n.toLowerCase()));
    const a = pick(each[1]);
    const b = pick(each[3]);
    if (!a || !b) return reply("I couldn't find those crew members.");
    return call("text_crew_each", { items: [{ workerId: a.id, message: each[2].trim() }, { workerId: b.id, message: each[4].trim().replace(/[.]$/, "") }] });
  }
  // The fence from an address (2026-11-05): the site, then the layout in words.
  const addr = /\b(?:address is|address:|here'?s the address:?|the property is|at)\s+(\d+\s+[A-Za-z0-9 .]+?(?:,\s*[A-Za-z .]+)*(?:\s+[A-Z]{2})?)\s*$/i.exec(user);
  if (addr && !/\bfence\b/.test(text)) return call("fence_site", { address: addr[1].trim() });
  // A fence said outright, or a change to the fence built lately ("move the gate to the left").
  const fenceLately = /· fence \(change it/.test(system);
  if ((/\bfence\b/.test(text) || fenceLately) && /\b(backyard|back yard|from the house|lot line|property line|gate)\b/.test(text)) {
    const off = /(\d+)\s*(?:ft|feet|foot)?\s*(?:out |back |away )?from the (?:back of the )?house/.exec(text);
    const gates = [...text.matchAll(/gate (?:on|to|at) the (left|right|rear|back)/g)].map((m) => ({ where: (m[1] === "back" ? "rear" : m[1]) as "left" | "right" | "rear", widthFt: null }));
    const height = /(\d)\s*(?:ft|feet|foot)\b(?!\s*(?:from|out))/.exec(text);
    const fenceType = /\b(cedar|vinyl|chain link|aluminum|composite|picket|privacy|board on board|shadowbox|horizontal|pine|pressure treated)\b/.exec(text)?.[1] ?? null;
    const replaces = /^\s*(change|move|make|put)\b/.test(text) ? (/proposalId=(\S+) · "[^"]*" · fence/.exec(system)?.[1] ?? null) : null;
    return call("build_fence", { address: null, clientId: null, leadId: null, rearOffsetFt: off ? +off[1] : 20, rearOnLotLine: /rear (?:lot|property) line|back (?:lot|property) line|to the (?:lot|property) line at the back/.test(text), gates, type: fenceType, heightFt: height ? +height[1] : null, removeExisting: /\b(remove|tear out|take out) the old\b/.test(text), replaces });
  }
  if (/\boverdue\b/.test(text) && /\b(everyone|everybody|all)\b/.test(text)) return call("remind_overdue", {});
  if (/\b(invoice|financing)\b/.test(text)) {
    const f = done.get("find") as Found | undefined;
    // The real model asks for the name alone; the words around it are not in any title.
    const who = user.replace(/\b(invoice|send|the|financing|link|a|an|for|to|please)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (!f) return call("find", { query: who || user, kind: "proposal" });
    const p = f.proposals?.[0];
    if (!p) return reply("I couldn't find that proposal.");
    if (/\bfinancing\b/.test(text)) return call("financing_link", { proposalId: p.id, via: "auto" });
    return call("send_invoice", { proposalId: p.id, installmentId: null, method: /\bbank\b/.test(text) ? "bank" : /\bcard\b/.test(text) ? "card" : "any" });
  }

  if (/\bsend\b/.test(text)) {
    const f = done.get("find") as Found | undefined;
    if (!f) return call("find", { query: subject(user) || user, kind: "proposal" });
    const ps = f.proposals ?? [];
    if (!ps.length) return reply("I couldn't find a proposal like that.");
    if (ps.length > 1) return reply(`Which one? ${ps.map((p, i) => `${i + 1}) ${p.title} — ${p.client ?? "no client"}, ${p.total}`).join("  ")}`);
    const email = /\S+@\S+\.\w+/.exec(user)?.[0] ?? null;
    return call("send_proposal", { proposalId: ps[0].id, email, clientName: null });
  }

  if (/\b(put|move|schedule)\b/.test(text)) {
    const f = done.get("find") as Found | undefined;
    const head = user.split(/\band (?:tell|text)\b/i)[0];
    if (!f) return call("find", { query: subject(head) || head, kind: "any" });
    const c = done.get("crew") as Crew | undefined;
    const withName = /\bwith (\w+)/i.exec(user)?.[1];
    if (withName && !c) return call("crew", {});
    const worker = withName && c ? c.workers.find((w) => w.name.toLowerCase().startsWith(withName.toLowerCase())) : null;
    const job = f.jobs?.[0] ?? null;
    const proposal = job ? null : (f.proposals?.[0] ?? null);
    if (!job && !proposal) return reply("I couldn't find that job.");
    const hour = /\b(\d{1,2})\s*(am|pm)\b/.exec(text);
    const start = hour ? `${String((+hour[1] % 12) + (hour[2] === "pm" ? 12 : 0)).padStart(2, "0")}:00` : null;
    return call("schedule_job", { jobId: job?.id ?? null, proposalId: job ? null : proposal!.id, date: dayFrom(text, today), start, end: null, workerIds: worker ? [worker.id] : null });
  }

  if (/\b(tell|text)\b/.test(text)) {
    const c = done.get("crew") as Crew | undefined;
    if (!c) return call("crew", {});
    const everyone = /\b(everybody|everyone|all|crew)\b/.test(text);
    const name = everyone ? null : /\b(?:tell|text) (\w+)/i.exec(user)?.[1];
    const w = name ? c.workers.find((x) => x.name.toLowerCase().startsWith(name.toLowerCase())) : null;
    const message = (user.split(/:\s*/)[1] ?? user.replace(/^(tell|text)\s+(everybody|everyone|the crew|all|\w+)\s*(that\s+)?/i, "")).trim();
    return call("text_crew", { workerIds: w ? [w.id] : null, message: message || user });
  }

  if (/\bremind\b/.test(text)) {
    const f = done.get("find") as Found | undefined;
    if (!f) return call("find", { query: subject(user) || user, kind: "proposal" });
    const p = f.proposals?.[0];
    if (!p) return reply("I couldn't find that proposal.");
    return call("payment_reminder", { proposalId: p.id, installmentId: null });
  }

  if (/\b(make|made|money|profit|revenue)\b/.test(text)) {
    const m = done.get("money") as Record<string, unknown> | undefined;
    if (!m) return call("money", { period: /last month/.test(text) ? "last_month" : "this_month" });
    return reply(`${m.period}: collected ${m.collected}, expenses ${m.expenses}, profit ${m.profit}.`);
  }

  if (/\b(unsigned|follow up|not signed|aren'?t signed|open proposals)\b/.test(text)) {
    const o = done.get("open_proposals") as { proposals: Array<{ title: string; client: string | null; opened: string }> } | undefined;
    if (!o) return call("open_proposals", {});
    return reply(o.proposals.length ? o.proposals.map((p) => `${p.title} (${p.client ?? "no client"}) — ${p.opened}`).join("; ") : "Nothing is waiting on a signature.");
  }

  if (/\b(owe|attention|today)\b/.test(text) && !/\b(on|schedule)\b/.test(text)) {
    const t = done.get("today") as { line?: string; checks?: Array<{ title: string }> } | undefined;
    if (!t) return call("today", {});
    return reply(`${t.line ?? ""} ${(t.checks ?? []).map((c) => c.title).join("; ")}`.trim() || "Nothing needs you today.");
  }

  if (/\b(on|schedule|calendar|busy)\b/.test(text) || /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    const s = done.get("schedule") as { items?: Array<{ when: string; title: string; crew: string[] }> } | undefined;
    if (!s) return call("schedule", { from: dayFrom(text, today), to: null });
    const items = s.items ?? [];
    return reply(items.length ? items.map((i) => `${i.when}: ${i.title}${i.crew.length ? ` (${i.crew.join(", ")})` : ""}`).join("; ") : "Nothing on the calendar that day.");
  }

  return reply("I can help with your schedule, proposals, crew texts, payment reminders and money. What do you need?");
}

/** What the model would read off a budget: a picture is a lender's page; words are read by the rules, with one figure
 *  off when they say "fakecheck" (so the card's "not in it as written" shows). */
function fakeBudgetRead(messages: Msg[]) {
  const user = messages.find((m) => m.role === "user") as unknown as { content: string | Array<{ type: string; text?: string }> } | undefined;
  const parts = typeof user?.content === "string" ? [{ type: "text", text: user.content }] : (user?.content ?? []);
  if (parts.some((p) => p.type === "image_url")) {
    return {
      rows: [
        { name: "Plans & engineering", amount: 4800, include: true, note: "" },
        { name: "Permits & impact fees", amount: 9250, include: true, note: "" },
        { name: "Site prep & excavation", amount: 14000, include: true, note: "" },
        { name: "Foundation", amount: 38500, include: true, note: "" },
        { name: "Framing", amount: 72000, include: true, note: "" },
        { name: "Roofing", amount: 16400, include: true, note: "" },
        { name: "Plumbing", amount: 21000, include: true, note: "" },
        { name: "Electrical", amount: 19000, include: true, note: "" },
        { name: "Builder's fee", amount: 19495, include: false, note: "The builder's fee — your margin, not a cost." },
      ],
      statedTotal: 214445,
      about: "A lender's construction budget, 9 lines.",
    };
  }
  const words = parts.map((p) => p.text ?? "").join("\n").replace(/^The budget, as it came:\s*/, "");
  const read = readBudgetText(words);
  return {
    rows: read.rows.map((r, i) => ({ name: r.name, amount: /fakecheck/i.test(words) && i === 0 ? r.amount + 111 : r.amount, include: r.include, note: r.note ?? "" })),
    statedTotal: read.statedTotal,
    about: `A budget, ${read.rows.length} lines.`,
  };
}

/** THE ESTIMATE READER'S FAKE (2026-11-08, the subcontractors plan, part 2; lib/subQuotes): words → the figures read
 *  out of them by a few regexes (the fixtures' lines: "Total $23,500", "Labor … $14,000", "Deposit 30% ($7,050)",
 *  "Valid until: …"); a PDF file part or a picture → XYZ Electric's $23,500 proposal read "from the pages" — unless the
 *  file's name says "blank", then nothing to read. An instruction to the reader in the words is flagged, never obeyed. */
function fakeQuoteRead(messages: Msg[]) {
  const user = messages.find((m) => m.role === "user") as unknown as { content: string | Array<{ type: string; text?: string; file?: { filename?: string } }> } | undefined;
  const parts = typeof user?.content === "string" ? [{ type: "text", text: user.content }] : (user?.content ?? []);
  const fig = (value: number | null, source: string | null, confidence: "high" | "medium" | "low" = "high") => ({ value, source: value != null ? source : null, confidence });
  const none = fig(null, null, "low");
  const picture = parts.find((p) => p.type === "file" || p.type === "image_url");
  if (picture) {
    if (/blank/i.test(picture.file?.filename ?? "")) {
      return { contractor: null, proposalNumber: null, date: null, total: none, labor: none, materials: none, taxes: none, permits: none, deposit: none, paymentSchedule: null, scope: null, exclusions: [], duration: null, start: null, warranty: null, validUntil: null, conditions: [], flags: ["Nothing to read on the page."], about: "A blank page." };
    }
    return {
      contractor: "XYZ Electric LLC",
      proposalNumber: "2041",
      date: "November 8, 2026",
      total: fig(23500, "Total $23,500"),
      labor: fig(14000, "Labor — Two licensed electricians, 5 working days — $14,000"),
      materials: fig(8200, "Materials — Wire, boxes, breakers, 200 A panel, devices — $8,200"),
      taxes: fig(850, "Sales tax — WA, on materials — $850"),
      permits: fig(450, "Permit and inspections — City of Kirkland — $450"),
      deposit: fig(7050, "Deposit 30% ($7,050) on signing", "medium"),
      paymentSchedule: "Deposit 30% ($7,050) on signing · 40% at the rough-in inspection · 30% on final inspection. Net 15 days per invoice.",
      scope: "Rough-in wiring for the kitchen and the new bathroom per the plans dated Nov 1, 2026: 14 circuits, 28 boxes; new 200 A panel; GFCI/AFCI; permit and both inspections included.",
      exclusions: ["Decorative fixtures and their installation", "Drywall patching, painting and trim repair", "Low-voltage, data and audio wiring", "Utility fees and any service entrance upgrade"],
      duration: "about 5 working days on site",
      start: "within two weeks of signing",
      warranty: "Two years on labor from the final inspection; the manufacturer's warranty on materials.",
      validUntil: "December 8, 2026",
      conditions: ["This price holds for 30 days", "Changes in scope are priced in writing before the work proceeds", "Site access 7 am to 5 pm, Monday to Friday", "Hidden conditions (knob-and-tube, aluminum wiring, asbestos) are outside this price"],
      flags: [],
      about: "A two-page electrical proposal from XYZ Electric LLC, $23,500, read from the pages.",
    };
  }
  const words = parts.map((p) => p.text ?? "").join("\n");
  const grab = (re: RegExp) => {
    const m = re.exec(words);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const line = (re: RegExp) => re.exec(words)?.[0] ?? null;
  const total = grab(/Total\s*:?\s*\$\s?([\d,]+)/i);
  const labor = grab(/Labor[^$\n]{0,120}\$\s?([\d,]+)/i);
  const materials = grab(/Materials[^$\n]{0,120}\$\s?([\d,]+)/i);
  const taxes = grab(/Sales tax[^$\n]{0,80}\$\s?([\d,]+)/i);
  const permits = grab(/Permit[^$\n]{0,80}\$\s?([\d,]+)/i);
  const deposit = grab(/Deposit[^$\n]{0,40}\$\s?([\d,]+)/i);
  const validUntil = /Valid until:?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(words)?.[1] ?? (/Valid (\d+) days/i.test(words) ? `${/Valid (\d+) days/i.exec(words)![1]} days from the date` : null);
  const days = /(\d+) working days/i.exec(words)?.[1] ?? null;
  const flags: string[] = [];
  if (/ignore the (project )?budget|approve this quote/i.test(words)) flags.push("The document carries an instruction to the reader; ignored.");
  const contractor = /^([A-Z][A-Za-z&' ]+(?:LLC|Inc\.?|Electrical|Electric|Plumbing|Framing))/m.exec(words)?.[1]?.trim() ?? null;
  const xyz = /XYZ Electric/i.test(words);
  return {
    contractor,
    proposalNumber: /Proposal #\s?([\w-]+)/i.exec(words)?.[1] ?? null,
    date: /Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(words)?.[1] ?? null,
    total: total != null ? fig(total, line(/Total\s*:?\s*\$\s?[\d,]+/i)) : none,
    labor: labor != null ? fig(labor, line(/Labor[^$\n]{0,120}\$\s?[\d,]+/i)) : none,
    materials: materials != null ? fig(materials, line(/Materials[^$\n]{0,120}\$\s?[\d,]+/i)) : none,
    taxes: taxes != null ? fig(taxes, line(/Sales tax[^$\n]{0,80}\$\s?[\d,]+/i)) : none,
    permits: permits != null ? fig(permits, line(/Permit[^$\n]{0,80}\$\s?[\d,]+/i)) : none,
    deposit: deposit != null ? fig(deposit, line(/Deposit[^$\n]{0,40}\$\s?[\d,]+/i), "medium") : none,
    paymentSchedule: line(/Deposit 30%[^.]*\.(?: Net[^.]*\.)?/i),
    scope: xyz ? "Rough-in wiring for the kitchen and the new bathroom: 14 circuits, 28 boxes; a new 200 A panel; GFCI/AFCI; permit and both inspections included." : /rough-in/i.test(words) ? "Electrical rough-in." : null,
    // pdf.js splits the "fi" ligature when it extracts text ("fi xtures"), so the test allows the gap.
    exclusions: /Decorative\s+fi\s?xtures/i.test(words) ? (xyz ? ["Decorative fixtures and their installation", "Drywall patching, painting and trim repair", "Low-voltage, data and audio wiring", "Utility fees and any service entrance upgrade"] : ["Decorative fixtures"]) : [],
    duration: days ? `about ${days} working days on site` : null,
    start: /within two weeks of signing/i.test(words) ? "within two weeks of signing" : null,
    warranty: line(/Two years on labor[^.]*\./i),
    validUntil,
    conditions: xyz ? ["This price holds for 30 days", "Changes in scope are priced in writing before the work proceeds", "Site access 7 am to 5 pm, Monday to Friday"] : [],
    flags,
    about: `${contractor ?? "A sub"}'s ${/Revised proposal/i.test(words) ? "revised " : ""}proposal${total != null ? `, $${total.toLocaleString("en-US")}` : ""}, read from the words.`,
  };
}

/** THE COMPARER'S FAKE (part 2): two deterministic sentences from the fields the app sent — who is lowest and by how
 *  much, what the lowest excludes, who is over the budget share. */
function fakeCompareWords(messages: Msg[]) {
  const user = messages.find((m) => m.role === "user");
  const text = typeof user?.content === "string" ? user.content : "";
  let data: { budgetShare?: number | null; quotes?: Array<{ sub: string; price: number; exclusions?: string[]; overBudgetBy?: number | null }> } = {};
  try {
    data = JSON.parse(text.slice(text.indexOf("{"))) as typeof data;
  } catch {
    data = {};
  }
  const qs = [...(data.quotes ?? [])].sort((a, b) => a.price - b.price);
  if (qs.length < 2) return { words: "One priced quote so far; nothing to compare yet." };
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const [low, ...rest] = qs;
  const first = `${low.sub} is lowest at ${money(low.price)}; ${rest.map((r) => `${r.sub} is ${money(r.price)}, ${money(r.price - low.price)} more`).join("; ")}.`;
  const ex = low.exclusions?.length ? `${low.sub} excludes ${low.exclusions.slice(0, 2).join(" and ").toLowerCase()}` : `${low.sub} lists no exclusions`;
  const over = qs.filter((q) => (q.overBudgetBy ?? 0) > 0);
  const budget = data.budgetShare != null ? (over.length ? `; ${over.map((q) => q.sub).join(" and ")} ${over.length === 1 ? "is" : "are"} over the ${money(data.budgetShare)} share` : `; all are within the ${money(data.budgetShare)} share`) : "";
  return { words: `${first} ${ex}${budget}.` };
}

/** THE STATE REGISTER'S FAKE (2026-11-08, the subcontractors plan, part 3; lib/subFinder/register): a handful of
 *  Kirkland contractors in L&I's three files, filtered by the pieces of the SoQL $where the app sends — the city, the
 *  ZIP, "active only", the specialty list, the name words, the license list. */
const FAKE_REGISTER: Array<Record<string, string>> = [
  { businessname: "XYZ ELECTRIC LLC", contractorlicensenumber: "XYZELEL902KD", contractorlicensetypecode: "CC", address1: "4410 RAINIER AVE S", city: "KIRKLAND", state: "WA", zip: "98034", phonenumber: "2065550144", licenseeffectivedate: "2019-03-01T00:00:00.000", licenseexpirationdate: "2028-03-01T00:00:00.000", specialtycode1desc: "GENERAL", specialtycode2desc: "LIMITED ENERGY", ubi: "603111222", primaryprincipalname: "RUIZ, DANA", statuscode: "A", contractorlicensestatus: "ACTIVE" },
  { businessname: "CASCADE ELECTRIC INC", contractorlicensenumber: "CASCAEI884MN", contractorlicensetypecode: "CC", address1: "120 CENTRAL WAY", city: "KIRKLAND", state: "WA", zip: "98033", phonenumber: "4255550133", licenseeffectivedate: "2015-06-10T00:00:00.000", licenseexpirationdate: "2027-06-10T00:00:00.000", specialtycode1desc: "GENERAL", ubi: "602555333", primaryprincipalname: "NGUYEN, MINH", statuscode: "A", contractorlicensestatus: "ACTIVE" },
  { businessname: "ABC ELECTRICAL LLC", contractorlicensenumber: "ABCELEL123AA", contractorlicensetypecode: "CC", address1: "900 6TH ST S", city: "KIRKLAND", state: "WA", zip: "98033", phonenumber: "4255550199", licenseeffectivedate: "2016-01-04T00:00:00.000", licenseexpirationdate: "2027-01-04T00:00:00.000", specialtycode1desc: "GENERAL", ubi: "602777888", primaryprincipalname: "BROOKS, ANA", statuscode: "S", contractorlicensestatus: "SUSPENDED", contractorlicensesuspenddate: "2026-09-01T00:00:00.000" },
  { businessname: "RIDGE FRAMING LLC", contractorlicensenumber: "RIDGEFL901PQ", contractorlicensetypecode: "CC", address1: "77 LAKEVIEW DR", city: "KIRKLAND", state: "WA", zip: "98034", phonenumber: "4255550111", licenseeffectivedate: "2018-09-15T00:00:00.000", licenseexpirationdate: "2027-09-15T00:00:00.000", specialtycode1desc: "Framing and Rough Carpentry", ubi: "603444555", primaryprincipalname: "OKAFOR, SAM", statuscode: "A", contractorlicensestatus: "ACTIVE" },
  { businessname: "NORTHWEST PLUMBING", contractorlicensenumber: "NORTHPL777KD", contractorlicensetypecode: "CC", address1: "15 MAIN ST", city: "BELLEVUE", state: "WA", zip: "98004", phonenumber: "4255550122", licenseeffectivedate: "2014-02-02T00:00:00.000", licenseexpirationdate: "2027-02-02T00:00:00.000", specialtycode1desc: "PLUMBING", ubi: "602999111", primaryprincipalname: "LEE, JUNE", statuscode: "A", contractorlicensestatus: "ACTIVE" },
  { businessname: "LEE CARPENTRY", contractorlicensenumber: "LEECAC555RT", contractorlicensetypecode: "CC", address1: "3 PINE ST", city: "SEATTLE", state: "WA", zip: "98101", phonenumber: "2065550177", licenseeffectivedate: "2012-05-05T00:00:00.000", licenseexpirationdate: "2025-05-05T00:00:00.000", specialtycode1desc: "Cabinets, Millwork and Finish Carpentry", ubi: "601222333", primaryprincipalname: "LEE, MARK", statuscode: "E", contractorlicensestatus: "EXPIRED" },
];
const FAKE_INSURANCE: Array<Record<string, string>> = [
  { contractorlicensenumber: "XYZELEL902KD", businessname: "XYZ ELECTRIC LLC", insurancecompany: "Northwest Mutual Ins Co", insurancepolicyno: "NWM-7781", insuranceamt: "1000000.0000", effectivedate: "2025-11-20T00:00:00.000", expirationdate: "2027-11-20T00:00:00.000" },
  { contractorlicensenumber: "CASCAEI884MN", businessname: "CASCADE ELECTRIC INC", insurancecompany: "Travelers Cas Insurance Co", insurancepolicyno: "6809M1", insuranceamt: "1000000.0000", effectivedate: "2025-01-01T00:00:00.000", expirationdate: "2027-01-01T00:00:00.000" },
  { contractorlicensenumber: "ABCELEL123AA", businessname: "ABC ELECTRICAL LLC", insurancecompany: "Old Line Ins Co", insurancepolicyno: "OL-22", insuranceamt: "500000.0000", effectivedate: "2025-12-31T00:00:00.000", expirationdate: "2026-12-31T00:00:00.000", canceldate: "2026-08-15T00:00:00.000" },
  { contractorlicensenumber: "RIDGEFL901PQ", businessname: "RIDGE FRAMING LLC", insurancecompany: "Liberty Mutual", insurancepolicyno: "LM-3390", insuranceamt: "2000000.0000", effectivedate: "2026-03-01T00:00:00.000", expirationdate: "2027-03-01T00:00:00.000" },
];
const FAKE_BOND: Array<Record<string, string>> = [
  { contractorlicensenumber: "XYZELEL902KD", businessname: "XYZ ELECTRIC LLC", bondfirmname: "RLI Ins Co", bondamt: "12000.0000", bondeffectivedate: "2019-03-01T00:00:00.000", bondexpirationdate: "Until Canceled", bondimpaired: "N" },
  { contractorlicensenumber: "ABCELEL123AA", businessname: "ABC ELECTRICAL LLC", bondfirmname: "Western Surety", bondamt: "12000.0000", bondeffectivedate: "2016-01-04T00:00:00.000", bondexpirationdate: "Until Canceled", bondimpaired: "Y", bondimpaireddate: "2026-09-01T00:00:00.000" },
  { contractorlicensenumber: "RIDGEFL901PQ", businessname: "RIDGE FRAMING LLC", bondfirmname: "Hartford", bondamt: "6000.0000", bondeffectivedate: "2018-09-15T00:00:00.000", bondexpirationdate: "Until Canceled", bondimpaired: "N" },
];
function fakeRegister(dataset: string, where: string): Array<Record<string, string>> {
  const w = where.toUpperCase();
  const unq = (s: string) => s.split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
  const likes = [...w.matchAll(/LIKE '%([^%']+)%'/g)].map((m) => m[1]);
  const city = /UPPER\(CITY\) = '([^']+)'/.exec(w)?.[1] ?? null;
  const zip = /\bZIP = '([^']+)'/.exec(w)?.[1] ?? null;
  const activeOnly = /CONTRACTORLICENSESTATUS IN/.test(w);
  const licenseIn = /CONTRACTORLICENSENUMBER\) IN \(([^)]+)\)/.exec(w)?.[1];
  const licenses = licenseIn ? unq(licenseIn) : null;
  const specIn = /specialtycode1desc in \(([^)]+)\)/i.exec(where)?.[1];
  const specialties = specIn ? unq(specIn) : null;
  const rows = dataset === "ciwg-agsx" ? FAKE_INSURANCE : dataset === "bzff-4fmt" ? FAKE_BOND : FAKE_REGISTER;
  return rows.filter((r) => {
    if (licenses && !licenses.includes(r.contractorlicensenumber.toUpperCase())) return false;
    if (dataset !== "m8qx-ubtq") return true;
    if (city && r.city.toUpperCase() !== city) return false;
    if (zip && r.zip !== zip) return false;
    if (activeOnly && !["ACTIVE", "RE-LICENSED"].includes(r.contractorlicensestatus)) return false;
    if (specialties && !specialties.includes(r.specialtycode1desc) && !specialties.includes(r.specialtycode2desc ?? "")) return false;
    if (likes.length && !likes.some((l) => r.businessname.toUpperCase().includes(l))) return false;
    return true;
  });
}
/** GOOGLE'S FAKE (part 3): three electricians near Kirkland — two the register knows, one it does not. */
function fakePlaces(body: { textQuery?: string }) {
  const electric = /electric/i.test(body.textQuery ?? "");
  const place = (id: string, name: string, address: string, phone: string, website: string | null, rating: number, count: number, lat: number, lng: number) => ({ id, displayName: { text: name, languageCode: "en" }, formattedAddress: address, nationalPhoneNumber: phone, ...(website ? { websiteUri: website } : {}), rating, userRatingCount: count, businessStatus: "OPERATIONAL", location: { latitude: lat, longitude: lng } });
  return {
    places: electric
      ? [place("pl_xyz", "XYZ Electric LLC", "4410 Rainier Ave S, Kirkland, WA 98034", "(206) 555-0144", "https://xyzelectric.example", 4.8, 57, 47.6815, -122.2087), place("pl_cascade", "Cascade Electric", "120 Central Way, Kirkland, WA 98033", "(425) 555-0133", "https://cascade-electric.example", 4.5, 21, 47.6768, -122.2059), place("pl_bright", "Brightline Electric Co", "8 Market St, Kirkland, WA 98033", "(425) 555-0188", null, 4.9, 12, 47.6792, -122.2101)]
      : [place("pl_ridge", "Ridge Framing LLC", "77 Lakeview Dr, Kirkland, WA 98034", "(425) 555-0111", null, 4.6, 9, 47.69, -122.21), place("pl_nwp", "Northwest Plumbing", "15 Main St, Bellevue, WA 98004", "(425) 555-0122", "https://nwplumbing.example", 4.2, 33, 47.61, -122.2)],
  };
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url?.includes("/audio/speech")) {
        res.setHeader("content-type", "audio/mpeg");
        res.end(SILENT_MP3);
        return;
      }
      res.setHeader("content-type", "application/json");
      // The state register (data.wa.gov) and Google Places, for Find (the subcontractors plan, part 3).
      if (req.url?.includes("/resource/")) {
        const u = new URL(req.url, "http://127.0.0.1");
        const dataset = (u.pathname.split("/").pop() ?? "").replace(/\.json$/, "");
        res.end(JSON.stringify(fakeRegister(dataset, u.searchParams.get("$where") ?? "")));
        return;
      }
      if (req.url?.includes("/v1/places:searchText")) {
        let body: { textQuery?: string } = {};
        try {
          body = JSON.parse(raw || "{}") as { textQuery?: string };
        } catch {
          body = {};
        }
        res.end(JSON.stringify(fakePlaces(body)));
        return;
      }
      if (req.url?.includes("/chat/completions")) {
        try {
          const body = JSON.parse(raw || "{}") as { messages?: Msg[]; tools?: unknown[]; response_format?: { type?: string; json_schema?: { name?: string } } };
          // The estimate reader and the comparer (the subcontractors plan, part 2).
          if (body.response_format?.type === "json_schema" && body.response_format.json_schema?.name === "quote_read") {
            res.end(JSON.stringify(reply(JSON.stringify(fakeQuoteRead(body.messages ?? [])))));
            return;
          }
          if (body.response_format?.type === "json_schema" && body.response_format.json_schema?.name === "compare_words") {
            res.end(JSON.stringify(reply(JSON.stringify(fakeCompareWords(body.messages ?? [])))));
            return;
          }
          // The Budget card's read: a lender's page for a picture, the rules' rows for words.
          if (body.response_format?.type === "json_schema" && body.response_format.json_schema?.name === "budget_read") {
            res.end(JSON.stringify(reply(JSON.stringify(fakeBudgetRead(body.messages ?? [])))));
            return;
          }
          // Smart Proposal's run: JSON out, no tools — the estimate itself.
          if (body.response_format?.type === "json_object" && !body.tools?.length) {
            const prompt = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");
            // The client brief (lib/clientMemory, 2026-11-08): where they stand + facts. Deterministic: the name is
            // read off the prompt; a known cedar decking fact is superseded by composite, the way a changed mind is.
            if (prompt.includes("CLIENT BRIEF")) {
              const name = /CLIENT: ([^·\n]+)/.exec(prompt)?.[1]?.trim() ?? "the client";
              const cedar = /- \[([a-z0-9]+)\] \(DECISION\) Decking: cedar/i.exec(prompt);
              const newFacts: Array<Record<string, unknown>> = [];
              if (!prompt.includes("Prefers texts in the morning")) newFacts.push({ category: "PREFERENCE", fact: "Prefers texts in the morning", sourceKind: "TEXT", sourceId: null, supersedesId: null });
              if (cedar) newFacts.push({ category: "DECISION", fact: "Decking: composite (changed from cedar)", sourceKind: "EMAIL", sourceId: null, supersedesId: cedar[1] });
              res.end(JSON.stringify(reply(JSON.stringify({
                summary: `${name} signed the epoxy garage job and paid the deposit; the deck proposal is out and they asked for composite instead of cedar. Waiting on the updated proposal and a start date.`,
                nextAction: "Send the updated deck proposal",
                newFacts,
              }))));
              return;
            }
            res.end(JSON.stringify(reply(JSON.stringify(fakeEstimate(prompt)))));
            return;
          }
          res.end(JSON.stringify(answer(body as { messages: Msg[] })));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: String(err) } }));
        }
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not faked" } }));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`assistant fake model on http://127.0.0.1:${PORT}/v1`));
