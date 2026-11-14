// THE OPERATOR'S NEW ENGINE (2026-11-13, owner: "understand me better and speak back faster … the best voice
// recognition and even accents"): who gets it while it is tested, the company's own words the ears are given, what
// the new models are asked, the prompt's order (what never changes first, so OpenAI keeps it ready), and the readout.
// Pure — the routes and the screens are walked on the stand (qa/walks/operator-speed.walk.ts).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant-speed.check.ts
import "../_lib/_server-only";
import { KEYWORDS_MAX, MY_WORDS_MAX, NEW_BRAIN_MODEL, NEW_EARS_MODEL, brainOptions, engineFor, keywordsFrom, newEarsParams, parseMyWords, secs, speedLine, streetOf, tidyWord, tidyWords } from "../../../src/lib/assistant/words";
import { parsePrefs, DEFAULT_PREFS } from "../../../src/lib/assistant/prefs";
import { systemPrompt } from "../../../src/lib/assistant/engine";
import { TOOLS } from "../../../src/lib/assistant/tools";
import type { AssistantActor } from "../../../src/lib/assistant/actor";

let bad = 0;
const check = (name: string, ok: boolean, extra: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || extra === "" ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
};

// ── who gets it ────────────────────────────────────────────────────────────────────────────────────────────────────
check("a platform admin is on the new engine unless they switched back", engineFor(true, null) === "new" && engineFor(true, "new") === "new" && engineFor(true, "classic") === "classic");
check("everyone else stays on the engine before, whatever was saved", engineFor(false, null) === "classic" && engineFor(false, "new") === "classic");
check("the settings keep the switch and the words; anything odd reads as unset", parsePrefs(JSON.stringify({ engine: "classic", words: ["Snohomish", "  ", "Snohomish", 7] })).engine === "classic" && parsePrefs(JSON.stringify({ engine: "classic", words: ["Snohomish", "  ", "Snohomish", 7] })).words.join() === "Snohomish" && parsePrefs(JSON.stringify({ engine: "fastest" })).engine === null && DEFAULT_PREFS.engine === null && DEFAULT_PREFS.words.length === 0);

// ── the words ──────────────────────────────────────────────────────────────────────────────────────────────────────
check("a word is one line, no angle brackets, trimmed and cut", tidyWord("  Trex <b>Transcend</b>\nLineage ") === "Trex b Transcend /b Lineage" && tidyWord("x".repeat(80)).length === 48 && tidyWord(7) === "");
check("a list drops the empty, the one-letter and the repeated (case aside)", tidyWords(["Mike", "mike", " ", "A", "Ana", null]).join() === "Mike,Ana");
check("my words: a line or a comma each, sixty at most", parseMyWords("Snohomish\nPresidential shingles, Dmitriy;Trex").join("|") === "Snohomish|Presidential shingles|Dmitriy|Trex" && parseMyWords(Array.from({ length: 90 }, (_, i) => `word${i}`).join("\n")).length === MY_WORDS_MAX);
check("the street of an address, without the house number or the unit", streetOf("12103 202nd St SE, Snohomish, WA 98296") === "202nd St SE" && streetOf("4518B 132nd Ave NE Apt 4") === "132nd Ave NE" && streetOf("77 Lakeview Dr") === "Lakeview Dr" && streetOf("PO Box 12") === "" && streetOf(null) === "");
{
  const k = keywordsFrom({
    mine: ["Presidential shingles", "Dmitriy"],
    crew: ["Mike Alvarez", "Ana"],
    clients: [{ name: "Sarah Lee", address: "12103 202nd St SE", city: "Snohomish" }, { name: "John Smith", address: null, city: "Bellevue" }],
    leads: [{ name: "Kowalczyk Family", address: "77 Lakeview Dr, Kirkland", city: "Kirkland" }],
  });
  check("keywords: my words first, then the crew (full name and first name), the clients and leads", k.slice(0, 8).join("|") === "Presidential shingles|Dmitriy|Mike Alvarez|Mike|Ana|Sarah Lee|John Smith|Kowalczyk Family", k.slice(0, 8));
  check("…then their cities and streets, then the trade's words", k.includes("Snohomish") && k.includes("202nd St SE") && k.includes("Lakeview Dr") && k.includes("EagleView") && k.indexOf("Snohomish") > k.indexOf("Kowalczyk Family") && k.indexOf("EagleView") > k.indexOf("Lakeview Dr"));
  const many = keywordsFrom({ mine: [], crew: [], clients: Array.from({ length: 300 }, (_, i) => ({ name: `Client ${i}`, address: `${i} Elm${i} St`, city: `Town${i}` })) });
  check(`never more than ${KEYWORDS_MAX}, and the names leave room for the places and the brands`, many.length === KEYWORDS_MAX && many.filter((w) => w.startsWith("Client")).length === 75 && many.some((w) => w.startsWith("Town")));
}

// ── what the new models are asked ──────────────────────────────────────────────────────────────────────────────────
{
  const p = newEarsParams("en", "JobFlex words…", ["Sarah Lee", "Snohomish"]);
  check("the ears: gpt-transcribe, the language as a list, the prompt and the keywords", p.model === NEW_EARS_MODEL && NEW_EARS_MODEL === "gpt-transcribe" && p.languages.join() === "en" && p.prompt === "JobFlex words…" && p.keywords?.join() === "Sarah Lee,Snohomish" && !("language" in p));
  const bare = newEarsParams("ru", null, []);
  check("…another language has no English word list, and no keywords are sent when there are none", bare.languages.join() === "ru" && !("prompt" in bare) && !("keywords" in bare));
  check("the brain: a GPT-6 model with its thinking off (a tool call needs that), no temperature", NEW_BRAIN_MODEL === "gpt-6-luna" && brainOptions("gpt-6-luna").reasoning_effort === "none" && brainOptions("gpt-6-luna").temperature === undefined);
  check("…a GPT-5 or o-series model thinks briefly; the others take the temperature they always had", brainOptions("gpt-5.4-mini").reasoning_effort === "low" && brainOptions("o4-mini").reasoning_effort === "low" && brainOptions("gpt-4o").temperature === 0.2 && brainOptions("gpt-4.1").reasoning_effort === undefined);
}

// ── the prompt's order ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const a: AssistantActor = { organizationId: "o1", userId: "u1", role: "OWNER", channel: "app", timezone: "America/Los_Angeles", orgName: "Summit Ridge Roofing", userName: "Dmitriy" };
  const b: AssistantActor = { ...a, organizationId: "o2", userId: "u2", orgName: "Lakeside Decks", userName: "Ana" };
  const t1 = new Date("2026-11-13T18:00:00Z"), t2 = new Date("2026-11-14T03:41:00Z");
  const fa = systemPrompt(a, t1, null, [], TOOLS, "", true, { words: ["Snohomish"] });
  const fb = systemPrompt(b, t2, "Send PRO-12 to Sarah Lee?", ["proposalId=p1"], TOOLS, "", true, { words: [] });
  const cut = (s: string) => s.slice(0, s.indexOf("THIS CONVERSATION"));
  check("new engine: everything before the moment is the same for any company at any time", fa.includes("THIS CONVERSATION") && cut(fa) === cut(fb) && cut(fa).length > 20000, { a: cut(fa).length, b: cut(fb).length });
  check("…and the moment still says who, when, their own words and what waits", /for Summit Ridge Roofing, a contracting business\. You help Dmitriy \(role OWNER\)/.test(fa) && /Today's date is 2026-11-13/.test(fa) && /THEIR OWN WORDS[^\n]*Snohomish/.test(fa) && /WAITING FOR THEIR ANSWER: "Send PRO-12/.test(fb) && !/THEIR OWN WORDS/.test(fb));
  const ca = systemPrompt(a, t1, null, [], TOOLS, "", true);
  check("the engine before: the prompt as it always was — who on the first line, the clock on the second", ca.startsWith("You are the JobFlex AI Operator for Summit Ridge Roofing") && ca.split("\n")[1].startsWith("Now: ") && !ca.includes("THIS CONVERSATION") && !ca.includes("THEIR OWN WORDS"));
  const rules = (s: string) => s.slice(s.indexOf("RULES"), s.indexOf("- SPOKEN"));
  check("the rules and what the tools do are word for word the same on both", rules(fa) === rules(ca) && rules(fa).length > 15000);
}

// ── the readout ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const server = { turnMs: 2100, modelMs: 1900, rounds: 2, model: "gpt-6-luna", engine: "new" as const };
  check("seconds to one decimal", secs(1840) === "1.8 s" && secs(0) === "0.0 s" && secs(-5) === "0.0 s");
  check("a spoken turn: the whole wait from the last word, then its three parts", speedLine({ sentMs: 1800, heardMs: 600, answeredMs: 2300, voiceMs: 500, server }) === "Speed test · 4.6 s from your last word to its voice · sent after 1.8 s (written down in 0.6 s) · answered in 2.3 s (model 1.9 s, 2 rounds, gpt-6-luna) · voice after 0.5 s", speedLine({ sentMs: 1800, heardMs: 600, answeredMs: 2300, voiceMs: 500, server }));
  check("…before the voice starts (or muted) it runs to the answer", speedLine({ sentMs: 1800, heardMs: null, answeredMs: 2300, voiceMs: null, server }) === "Speed test · 4.1 s from your last word to the answer · sent after 1.8 s · answered in 2.3 s (model 1.9 s, 2 rounds, gpt-6-luna)");
  check("a typed turn says only how long the answer took; one answered without the model has no model part", speedLine({ sentMs: null, heardMs: null, answeredMs: 900, voiceMs: null, server }) === "Speed test · answered in 0.9 s (model 1.9 s, 2 rounds, gpt-6-luna)" && speedLine({ sentMs: null, heardMs: null, answeredMs: 300, voiceMs: null, server: { ...server, modelMs: 0, rounds: 0, model: null } }) === "Speed test · answered in 0.3 s");
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
