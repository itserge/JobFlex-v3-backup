// SMARTBOOK · THE FAKE MODEL (2026-10-31) — a stand-in for OpenAI's chat completions, for SmartBook's runs on the
// local stand. Point the stand's OPENAI_BASE_URL at it (http://127.0.0.1:4598/v1); the OpenAI client the app builds
// reads that variable, so nothing in src/ knows. Never a real key, never a real call. Dates are worked out from the
// "Now:" line SmartBook's prompts carry, so a run at any date reads the same.
//   A customer's message (the user message ends "THE MESSAGE:") — by what it says:
//     "saturday … 9am" / "sábado … 10"  → propose that Saturday at that hour (Spanish → lang "es")
//     "morning"                          → prefer mornings
//     "warranty"                         → a question the company's facts answer
//     "metal"                            → a question they don't (answer null)
//     "not interested" / "no thanks"     → not-interested
//     "person" / "call me"               → human
//     "cancel"                           → cancel;   "thank"  → thanks;   anything else → other
//   The company's reply (ends "THE REPLY:") — "monday … 2pm" → another time; "yes" / "no"; else unclear.
//   A translation → the text with "[es] " in front.
//   NODE_PATH="" npx --no-install tsx qa/fixtures/smartbook-fake-openai.ts     (FAKE_OPENAI_PORT, default 4598)
import http from "node:http";

const PORT = Number(process.env.FAKE_OPENAI_PORT || 4598);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type Message = { role: string; content: string };

/** "Now: Monday, November 2, 2026, 10:00 AM (…)" → that date. */
function nowOf(system: string): Date {
  const m = /Now: \w+, (\w+) (\d{1,2}), (\d{4})/.exec(system);
  if (!m) return new Date();
  return new Date(Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2], 12));
}
function nextDow(now: Date, dow: number): string {
  const d = new Date(now);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== dow);
  return d.toISOString().slice(0, 10);
}
function hourOf(text: string, dflt: string): string {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(text);
  if (!m) return dflt;
  let h = +m[1];
  if (/^p/i.test(m[3] ?? "") && h < 12) h += 12;
  if (!m[3] && h >= 1 && h <= 6) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

function customer(message: string, system: string) {
  const now = nowOf(system);
  const base = { intent: "other", pick: null, proposal: null, prefer: null, question: null, answer: null, lang: "en", angry: false };
  const t = message.toLowerCase();
  if (/sábado|sabado/.test(t)) return { ...base, intent: "propose", lang: "es", proposal: { day: nextDow(now, 6), time: hourOf(t, "10:00"), part: null } };
  for (const [i, name] of DAYS.entries()) {
    if (t.includes(name) && /\d/.test(t)) return { ...base, intent: "propose", proposal: { day: nextDow(now, i), time: hourOf(t, "09:00"), part: null } };
  }
  if (/morning/.test(t)) return { ...base, intent: "prefer", prefer: { part: "morning" } };
  if (/warranty/.test(t)) return { ...base, intent: "question", question: "Do you give a warranty?", answer: /warranty/i.test(system) ? "Yes — every roof comes with a 10-year workmanship warranty." : null };
  if (/metal/.test(t)) return { ...base, intent: "question", question: "Do you do metal roofs?", answer: null };
  if (/not interested|no thanks|hired/.test(t)) return { ...base, intent: "not-interested" };
  if (/person|call me/.test(t)) return { ...base, intent: "human" };
  if (/cancel/.test(t)) return { ...base, intent: "cancel" };
  if (/thank/.test(t)) return { ...base, intent: "thanks" };
  return base;
}

function contractor(reply: string, system: string) {
  const now = nowOf(system);
  const t = reply.toLowerCase();
  for (const [i, name] of DAYS.entries()) if (t.includes(name)) return { decision: "other", day: nextDow(now, i), time: hourOf(t, "09:00"), ref: null };
  if (/\byes\b|ok/.test(t)) return { decision: "yes", day: null, time: null, ref: null };
  if (/\bno\b|can'?t/.test(t)) return { decision: "no", day: null, time: null, ref: null };
  return { decision: "unclear", day: null, time: null, ref: null };
}

function completion(model: string, content: string) {
  return {
    id: `chatcmpl-fake-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content, refusal: null }, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

const server = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && /\/models(\/[^/]+)?$/.test(req.url ?? "")) {
    const id = /\/models\/([^/?]+)/.exec(req.url ?? "")?.[1];
    return send(200, id ? { id: decodeURIComponent(id), object: "model" } : { object: "list", data: [{ id: "gpt-4o", object: "model" }] });
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) return send(404, { error: { message: "not faked" } });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body: { model?: string; messages?: Message[] } = {};
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: { message: "bad json" } });
    }
    const messages = body.messages ?? [];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const model = body.model || "gpt-4o";
    if (system.startsWith("Translate the text message")) {
      console.log("[fake-openai] translate");
      return send(200, completion(model, JSON.stringify({ text: `[es] ${user}` })));
    }
    const msg = user.split("THE MESSAGE:\n");
    if (msg.length > 1) {
      const out = customer(msg[msg.length - 1].trim(), system);
      console.log(`[fake-openai] customer ${out.intent} ← ${JSON.stringify(msg[msg.length - 1].trim().slice(0, 60))}`);
      return send(200, completion(model, JSON.stringify(out)));
    }
    const rep = user.split("THE REPLY:\n");
    if (rep.length > 1) {
      const out = contractor(rep[rep.length - 1].trim(), system);
      console.log(`[fake-openai] company ${out.decision} ← ${JSON.stringify(rep[rep.length - 1].trim().slice(0, 60))}`);
      return send(200, completion(model, JSON.stringify(out)));
    }
    return send(200, completion(model, "{}"));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[fake-openai] listening on http://127.0.0.1:${PORT}/v1`));
