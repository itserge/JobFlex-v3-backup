// THE OPERATOR'S NEW EARS AND BRAIN — THE PURE PART (2026-11-13). Owner: "improve AI operator to understand me better
// and speak back faster … the best of the best voice recognition and even accents".
//
// Two things a speech model gets wrong with an accent are the words it has never seen: a client's surname, a crew
// member's name, a street, a brand. So the ears are GIVEN them: the company's own words, as the speech model's
// `keywords` — the person's own list first ("my words", Settings → AI Operator), then the crew, the newest clients
// and leads, their cities and streets, and the trade's brands. Pure: the server part (./speed) reads the records.
//
// And which engine a person gets while it is tested: the new one for platform admins unless they switch back,
// the one before for everyone else (the same "only me first" rule as lib/assistant/open).

export type OperatorEngine = "new" | "classic";

/** The engine a person talks to: platform admins the new one unless they picked the one before; everyone else the one before. */
export function engineFor(isPlatformAdmin: boolean, pick: OperatorEngine | null | undefined): OperatorEngine {
  if (!isPlatformAdmin) return "classic";
  return pick === "classic" ? "classic" : "new";
}

/** OpenAI's models for the new engine (developers.openai.com/api/docs/models, read 2026-11-13). The ones before
 *  (gpt-4o-mini-transcribe, whisper-1, gpt-4o) are retired by OpenAI in January and February 2027. */
export const NEW_EARS_MODEL = "gpt-transcribe";
export const NEW_BRAIN_MODEL = "gpt-6-luna";

/** How many words a person may keep, how long one may be, and how many the ears are given in all. */
export const MY_WORDS_MAX = 60;
export const WORD_MAX_CHARS = 48;
export const KEYWORDS_MAX = 100;

/** Words the trade says that a speech model splits or respells. */
export const TRADE_WORDS: readonly string[] = ["JobFlex", "EagleView", "Trex", "TimberTech", "Fiberon", "Owens Corning", "OC Lumber", "Wisetack", "HVAC", "Smart Proposal", "Deck Studio", "soffit", "fascia", "drip edge", "underlayment"];

/** One word or name as the ears may be given it: a single line, no angle brackets (the API refuses them), trimmed. */
export function tidyWord(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[<>\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, WORD_MAX_CHARS).trim();
}

/** A list of words: tidied, the empty and the repeated dropped (case does not make a word new), cut at `max`. */
export function tidyWords(list: readonly unknown[], max = KEYWORDS_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const w = tidyWord(raw);
    const key = w.toLowerCase();
    if (w.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** "My words" as typed in Settings: one a line, or with commas. */
export function parseMyWords(text: string): string[] {
  return tidyWords(text.split(/[\n,;]+/), MY_WORDS_MAX);
}

/** The street of an address, without the house number or the unit: "12103 202nd St SE, Apt 4" → "202nd St SE". */
export function streetOf(address: string | null | undefined): string {
  if (!address) return "";
  const first = address.split(",")[0] ?? "";
  const street = first.replace(/^\s*\d+[A-Za-z]?(?:\s*[-/]\s*\d+)?\s+/, "").replace(/\s+(?:apt|unit|suite|ste|#)\.?\s*[\w-]+\s*$/i, "").trim();
  // A street is a name and a type, or a numbered street: a bare number or a P.O. box is not one.
  return /[A-Za-z]{2,}/.test(street) && !/^p\.?\s*o\.?\s*box/i.test(street) ? street : "";
}

export interface WordSources {
  mine: readonly string[];
  crew: readonly string[];
  /** newest first */
  clients: ReadonlyArray<{ name: string | null; address?: string | null; city?: string | null }>;
  leads?: ReadonlyArray<{ name: string | null; address?: string | null; city?: string | null }>;
}

/**
 * The keywords the ears are given this turn, the most useful first: the person's own words, the crew (full names
 * and first names), the clients' and leads' names, the cities, the streets, the trade's words — `KEYWORDS_MAX` in all.
 * Names fill at most three quarters, so a long client list never crowds out the streets and the brands.
 */
export function keywordsFrom(src: WordSources): string[] {
  const people = [...src.clients, ...(src.leads ?? [])];
  const crew = src.crew.flatMap((n) => {
    const name = tidyWord(n);
    const first = name.split(" ")[0] ?? "";
    return first && first !== name ? [name, first] : [name];
  });
  const names = tidyWords([...src.mine, ...crew, ...people.map((p) => p.name)], Math.floor(KEYWORDS_MAX * 0.75));
  const places = [...people.map((p) => p.city), ...people.map((p) => streetOf(p.address))];
  return tidyWords([...names, ...places, ...TRADE_WORDS], KEYWORDS_MAX);
}

/** What the speech model is asked: the new model takes `languages` (a list), a prompt and the keywords. */
export function newEarsParams(language: string, prompt: string | null, keywords: readonly string[]): { model: string; languages: string[]; prompt?: string; keywords?: string[] } {
  return { model: NEW_EARS_MODEL, languages: [language], ...(prompt ? { prompt } : {}), ...(keywords.length ? { keywords: [...keywords] } : {}) };
}

/** A GPT-6 model answers a tool call over Chat Completions only with its thinking off (OpenAI's model page: "function
 *  calling only with reasoning_effort set to none"); a GPT-5 or o-series model thinks briefly; the others take a temperature. */
export function brainOptions(model: string): { reasoning_effort?: "none" | "low"; temperature?: number } {
  if (/^gpt-6/.test(model)) return { reasoning_effort: "none" };
  if (/^(gpt-5|o[1-9])/.test(model)) return { reasoning_effort: "low" };
  return { temperature: 0.2 };
}

/** One turn's times, for the admin's readout: the whole turn on the server, the model's share, its rounds, the model. */
export interface TurnSpeed {
  turnMs: number;
  modelMs: number;
  rounds: number;
  model: string | null;
  engine: OperatorEngine;
}

/** Seconds to one decimal, as the readout prints them: 1840 → "1.8 s". */
export const secs = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

/** One turn as the page timed it (the admin's readout while the new engine is tested). */
export interface SpeedReadout {
  /** spoken: from their last word to the request going out (the pause it waits for, and the writing down) */
  sentMs: number | null;
  /** …of which the last piece's writing down took this long */
  heardMs: number | null;
  /** from the request going out to the answer arriving (the network, the server's turn, the conversation read) */
  answeredMs: number;
  /** from the answer arriving to its sound starting; null when it was not read out (typed, muted) or not yet */
  voiceMs: number | null;
  server: TurnSpeed | null;
}

/** The readout's line: "4.6 s from your last word to its voice · sent after 1.8 s · answered in 2.3 s (model 1.9 s,
 *  2 rounds, gpt-6-luna) · voice after 0.5 s"; a typed turn says only how long the answer took. */
export function speedLine(r: SpeedReadout): string {
  // A turn answered without the model (a yes, a no, an undo) has no model part.
  const brain = r.server && r.server.rounds ? ` (model ${secs(r.server.modelMs)}, ${r.server.rounds} round${r.server.rounds === 1 ? "" : "s"}${r.server.model ? `, ${r.server.model}` : ""})` : "";
  const answered = `answered in ${secs(r.answeredMs)}${brain}`;
  if (r.sentMs === null) return `Speed test · ${answered}${r.voiceMs !== null ? ` · voice after ${secs(r.voiceMs)}` : ""}`;
  const total = r.sentMs + r.answeredMs + (r.voiceMs ?? 0);
  return `Speed test · ${secs(total)} from your last word to ${r.voiceMs !== null ? "its voice" : "the answer"} · sent after ${secs(r.sentMs)}${r.heardMs !== null ? ` (written down in ${secs(r.heardMs)})` : ""} · ${answered}${r.voiceMs !== null ? ` · voice after ${secs(r.voiceMs)}` : ""}`;
}
