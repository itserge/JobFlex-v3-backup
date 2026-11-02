// SMARTHELP · THE FAKE MODEL (2026-10-30) — a stand-in for OpenAI's chat completions, for the SmartHelp walk
// (qa/walks/smarthelp.walk.ts). Point the stand's OPENAI_BASE_URL at it (http://127.0.0.1:4599/v1); the OpenAI client
// the app builds reads that variable, so nothing in src/ knows. Never a real key, never a real call.
//   SmartHelp's prompt (its user message ends with "THE QUESTION:") — by what the question says:
//     "garbage"  → content that isn't JSON          (the panel's error line)
//     "timeout"  → a 504                             (the panel's error line)
//     Spanish    → a Spanish steps answer            (answered in the language asked)
//     anything else → two steps, the second on a page that doesn't exist (/dashboard/ai-desk) with a made-up Show me
//                     target: cleanAnswer must drop both, and keep the step's words
//   The support AI's prompt (a filed ticket) → a confident answer it would send on its own — so a SmartHelp hand-off
//   that comes back drafted, not sent, shows the hold works.
//   NODE_PATH="" npx --no-install tsx qa/fixtures/smarthelp-fake-openai.ts     (FAKE_OPENAI_PORT, default 4599)
import http from "node:http";

const PORT = Number(process.env.FAKE_OPENAI_PORT || 4599);

type Message = { role: string; content: string };

const SPANISH = /[¿¡ñ]|\b(cómo|como|configuro|escritorio|mi|el|la)\b/i;

function smartHelpAnswer(question: string): { status: number; content: string } {
  if (/garbage/i.test(question)) return { status: 200, content: "this is { not json" };
  if (/timeout/i.test(question)) return { status: 504, content: "" };
  if (SPANISH.test(question)) {
    return {
      status: 200,
      content: JSON.stringify({
        language: "es",
        kind: "steps",
        title: "Así se configura el AI desk",
        steps: [
          { text: "Abre la configuración del AI desk y pulsa Describe your business.", open: "/dashboard/phone?tab=settings&step=business" },
          { text: "Escribe a qué te dedicas y pulsa Write it professionally." },
        ],
        note: null,
        confidence: 90,
      }),
    };
  }
  return {
    status: 200,
    content: JSON.stringify({
      language: "en",
      kind: "steps",
      title: "Here's how to set up the AI desk",
      steps: [
        { text: "Open AI desk setup and press Describe your business.", open: "/dashboard/phone?tab=settings&step=business", show: "ai-desk:describe" },
        { text: "Then press Save the instructions on the AI desk page.", open: "/dashboard/ai-desk", show: "save-button" },
      ],
      note: null,
      confidence: 90,
    }),
  };
}

function supportAnswer(): string {
  return JSON.stringify({
    language: "en",
    category: "how_to",
    summary: "How-to question",
    confidence: 95,
    needsHuman: false,
    humanReason: null,
    reply: "Thanks for reaching out — here is how to do it, step by step.",
    internalNotes: "fake model (SmartHelp walk)",
    factsUsed: [],
    bug: null,
  });
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
  if (req.method === "GET" && req.url?.endsWith("/models")) return send(200, { object: "list", data: [{ id: "gpt-4o", object: "model" }] });
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
    const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const model = body.model || "gpt-4o";
    const asked = user.split("THE QUESTION:\n");
    if (asked.length > 1) {
      const question = asked[asked.length - 1].trim();
      const a = smartHelpAnswer(question);
      console.log(`[fake-openai] smarthelp ${a.status} ← ${JSON.stringify(question.slice(0, 60))}`);
      if (a.status !== 200) return send(a.status, { error: { message: "upstream timed out", type: "server_error" } });
      return send(200, completion(model, a.content));
    }
    console.log("[fake-openai] support ← a ticket");
    return send(200, completion(model, supportAnswer()));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[fake-openai] listening on http://127.0.0.1:${PORT}/v1`));
