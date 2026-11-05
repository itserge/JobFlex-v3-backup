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
//   NODE_PATH="" npx --no-install tsx qa/fixtures/assistant-fake-openai.ts     (FAKE_OPENAI_PORT, default 4601)
import http from "node:http";

const PORT = Number(process.env.FAKE_OPENAI_PORT || 4601);
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

type Found = { proposals?: Array<{ id: string; title: string; client: string | null; total: string }>; jobs?: Array<{ id: string; title: string; client: string | null; proposalId: string | null }>; workers?: Array<{ id: string; name: string }> };
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
    if (!f) return call("find", { query: subject(user) || user, kind: "any" });
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

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/chat/completions")) {
        try {
          res.end(JSON.stringify(answer(JSON.parse(raw || "{}"))));
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
