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
//   Smart Proposal's own run (response_format json_object, no tools): a small estimate in the old draft shape.
//   Speech (POST /v1/audio/speech, the Talk mode's voice): 0.3 s of silence as an MP3, so a page plays it and goes on.
//   The Budget card's read (response_format json_schema "budget_read", 2026-11-07): words → the rules' own rows
//   (lib/projectBudgetImport), with a figure changed when the words say "fakecheck"; a picture → a lender's page.
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
  // "Start a kitchen remodel for Sarah Lee, she lives there" → start_project (2026-11-07): the kind from the words,
  // the template from the job's word, the client's name as said; the engine reads it back and a yes makes it.
  const started = /\bstart (?:a |an )?(?:new )?(?:(kitchen|bath|bathroom|deck|roof|fence|addition|basement|whole[- ]house|adu|garage|windows?|painting|service|floors?|hvac|siding) )?(remodel|new build|new construction|new house|build|house|project)\b(?:.*?\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?))?/i.exec(user);
  if (started && !done.has("start_project")) {
    const job = (started[1] ?? "").toLowerCase();
    const kind = /new build|new construction|new house|^(build|house)$/.test(started[2].toLowerCase()) ? "NEW_BUILD" : "REMODEL";
    const template = kind === "NEW_BUILD" ? "home" : job === "bathroom" ? "bath" : job === "whole house" || job === "whole-house" ? "wholehouse" : job === "garage" ? "adu" : job === "window" ? "windows" : job === "floor" ? "floors" : job || null;
    const client = started[3] ?? null;
    const name = client ? `${client.split(" ").pop()} ${job || (kind === "NEW_BUILD" ? "house" : "remodel")}` : `${job || "new"} project`;
    return call("start_project", { name, kind, client, template, occupied: /lives? there|living there|occupied/i.test(user) ? true : null });
  }
  if (done.has("start_project")) return reply("Planned — say yes and I'll start it.");
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
      if (req.url?.includes("/chat/completions")) {
        try {
          const body = JSON.parse(raw || "{}") as { messages?: Msg[]; tools?: unknown[]; response_format?: { type?: string; json_schema?: { name?: string } } };
          // The Budget card's read: a lender's page for a picture, the rules' rows for words.
          if (body.response_format?.type === "json_schema" && body.response_format.json_schema?.name === "budget_read") {
            res.end(JSON.stringify(reply(JSON.stringify(fakeBudgetRead(body.messages ?? [])))));
            return;
          }
          // Smart Proposal's run: JSON out, no tools — the estimate itself.
          if (body.response_format?.type === "json_object" && !body.tools?.length) {
            const prompt = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""))).join("\n");
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
