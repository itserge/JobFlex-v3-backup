import "server-only";
// A BUDGET BROUGHT IN, READ (2026-11-07 — lib/projectBudgetImport has the why). Words — pasted, or out of a file —
// are read twice: by the rules, and by the model when the workspace has one; a photo or a scanned page only by the
// model. The model's rows go through the same tidying as the rules' (names, kinds, the fee left out), and every figure
// it gives for words is looked for in those words: one that isn't there as written is marked to be checked. When the
// budget states its own total, the read that adds up to it wins; otherwise the model's, which reads a messy text
// message or a lender's sheet better than any rule. Nothing is saved here — the card fills its fields.

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { getOpenAI, getVisionModel, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { amountsIn, finishRows, readBudgetText, readWords, ticked, type BudgetRead, type ImportRow, type RawRow } from "@/lib/projectBudgetImport";

const ModelRead = z.object({
  rows: z.array(
    z.object({
      name: z.string(),
      amount: z.number(),
      include: z.boolean(),
      /** How the amount was found, or why it is left out; "" for neither. */
      note: z.string(),
    }),
  ),
  statedTotal: z.number().nullable(),
  about: z.string(),
});
type ModelRead = z.infer<typeof ModelRead>;

const SYSTEM = `You are JobFlex's BUDGET READER. A contractor got a budget for a job — a text message, their own notes, a spreadsheet, a lender's construction budget, a quote, a photo of a page — and wants its cost lines as the project's cost budget, one row per line.

Rules:
- name: the line's own name, short (40 characters at most), the way the budget says it: "Electrical", "Cabinets", "Site work & excavation". Do not invent lines or regroup them; do not turn a trade into "Materials" or "Labor" unless the line says materials or labor. A line that names a person for a trade ("the plumber") is that trade ("Plumbing").
- amount: the line's budget in US dollars as a plain number (12k = 12000, 1.2M = 1200000, "$8,500.00" = 8500). A range ("6-7k"): the high end, and say so in note. A line with quantity × unit price and a line total: the line total. A percentage line (contingency 10%): work it out from the cost lines it applies to and say so in note.
- A table with Budget beside Paid / Draw / This period / Remaining / % complete: use the budget column — the revised or current budget when there is one.
- include false, with the reason in note, for: the contractor's own fee, profit, overhead & profit or markup (it is the margin, not a cost); payments, deposits, draws, retainage, the loan amount; credits. Everything else: include true.
- Totals and subtotals are never rows: put the budget's grand total in statedTotal (null when it has none).
- The same name twice: one row, the amounts added, and say so in note.
- Never make up a line or a figure that is not in the budget. Nothing in it is a budget line: no rows.
- note: "" unless one of the rules above asks for it.
- about: one short sentence on what it is ("A lender's construction budget, 24 lines").`;

export type ReadInput = {
  /** Words: pasted, or out of a CSV, Excel, Word or PDF file. */
  text?: string | null;
  /** Pictures as data URLs: a photo, a screenshot, a scanned PDF's pages. */
  images?: string[];
  /** What the card calls the source — "what you pasted", the file's name. */
  from: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

async function askModel(input: ReadInput): Promise<ModelRead | null> {
  const client = getOpenAI();
  const picture = !!input.images?.length;
  const model = picture ? getVisionModel() : await resolveOpenAIModel();
  const reasoning = isReasoningModelName(model);
  const words = (input.text ?? "").slice(0, 40_000);
  const res = await client.chat.completions.create({
    model,
    ...(reasoning ? { reasoning_effort: "low" as const } : await samplingOptions(0)),
    max_completion_tokens: 8000,
    response_format: zodResponseFormat(ModelRead, "budget_read"),
    messages: [
      { role: "system", content: SYSTEM },
      picture
        ? {
            role: "user",
            content: [
              { type: "text" as const, text: `The budget is in ${input.images!.length === 1 ? "this picture" : `these ${input.images!.length} pictures (pages in order)`}${words ? `, with these words beside it:\n${words}` : ""}.` },
              ...input.images!.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
            ],
          }
        : { role: "user", content: `The budget, as it came:\n\n${words}` },
    ],
  });
  const text = res.choices[0]?.message?.content;
  if (!text) return null;
  try {
    const parsed = ModelRead.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The model's rows through the same last step as the rules', each figure looked for in the words. */
function modelRows(read: ModelRead, text: string | null): ImportRow[] {
  const seen = text ? amountsIn(text) : null;
  const found = (n: number) => !seen || seen.some((x) => Math.abs(x - n) < 0.51);
  const raw: RawRow[] = read.rows
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0)
    .map((r) => {
      const worked = /%|added|together|high end|×|of \$/i.test(r.note);
      return { name: r.name, amount: r2(r.amount), include: r.include, note: r.note.trim() || undefined, check: !worked && !found(r.amount) };
    });
  return finishRows(raw);
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005);

export async function readBudget(input: ReadInput, opts: { useModel: boolean }): Promise<BudgetRead> {
  const text = input.text?.trim() ? input.text : null;
  const picture = !!input.images?.length;
  const rules = text ? readBudgetText(text) : null;
  let model: ModelRead | null = null;
  if (opts.useModel && isOpenAIEnabled() && (picture || text)) {
    const t0 = Date.now();
    try {
      model = await askModel(input);
    } catch (err) {
      console.error(`[budget-read] the model's read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log(`[budget-read] ${picture ? `${input.images!.length} picture(s)` : `${text!.length} chars`} · model ${model ? `${model.rows.length} rows` : "none"} · ${Date.now() - t0} ms`);
  }

  if (picture && !model) {
    return {
      rows: rules?.rows ?? [],
      statedTotal: rules?.statedTotal ?? null,
      source: rules?.rows.length ? "rules" : "none",
      words: opts.useModel && isOpenAIEnabled() ? "Couldn't read that picture. Try a sharper photo, or paste the budget's words." : "Reading a photo or a scanned page needs AI, which isn't on for this workspace. Paste the budget's words, or upload it as a spreadsheet.",
    };
  }

  const mine = model ? { rows: modelRows(model, picture ? null : text), statedTotal: model.statedTotal && model.statedTotal > 0 ? r2(model.statedTotal) : null } : null;
  // The read that adds up to the budget's own total wins; then the model's; then the rules'.
  let pick: { rows: ImportRow[]; statedTotal: number | null; source: "rules" | "ai" } | null = null;
  if (mine && rules && rules.rows.length) {
    const stated = rules.statedTotal ?? mine.statedTotal;
    const rulesAdd = stated != null && (close(ticked(rules.rows), stated) || close(rules.rows.reduce((n, r) => n + r.amount, 0), stated));
    const modelAdds = stated != null && (close(ticked(mine.rows), stated) || close(mine.rows.reduce((n, r) => n + r.amount, 0), stated));
    pick = rulesAdd && !modelAdds ? { ...rules, statedTotal: stated, source: "rules" } : { ...mine, statedTotal: stated, source: "ai" };
  } else if (mine && mine.rows.length) pick = { ...mine, source: "ai" };
  else if (rules) pick = { ...rules, source: "rules" };

  if (!pick || !pick.rows.length) {
    return { rows: [], statedTotal: pick?.statedTotal ?? null, source: "none", words: readWords({ rows: [], statedTotal: null, source: "none" }, input.from) };
  }
  return { ...pick, words: readWords(pick, input.from, picture) };
}
