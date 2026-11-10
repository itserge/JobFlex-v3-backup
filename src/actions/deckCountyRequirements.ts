"use server";
// THE COUNTY'S REQUIREMENTS, MATCHED TO THE PERMIT SET (2026-11-09, the plan set's Edit, part 2): read the
// department's checklist (a file, pictures of its pages, its words) or find it online for the place and what is being
// built, then check the set against it (lib/deck/countyRequirements, lib/deck/plans/countyMatch). Nothing is changed
// here — the contractor reviews the answer and applies what they tick. Behind the plan set's own gate.

import { z } from "zod";
import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { logServerError } from "@/lib/server-events";
import { rateLimitShared } from "@/lib/rateLimit";
import { friendlyAIError, isOpenAIEnabled } from "@/lib/sdk/openai";
import { OfficeFileError, docxText, xlsxText } from "@/lib/officeText";
import { checkRead, placeKey, requirementsWords, type CountyCheck, type SetSummary } from "@/lib/deck/plans/countyMatch";
import { BUILD_KINDS, askCheck, findOnline, readKeptList, writeKeptList, type BuildKind, type KeptList } from "@/lib/deck/countyRequirements";

type Gate = { ok: true; organizationId: string } | { ok: false; error: string };
async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level !== "full") return { ok: false, error: "Matching the county's requirements is part of Deck Studio." };
    return { ok: true, organizationId: ctx.organizationId };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

const Place = z.object({ state: z.string().max(4), county: z.string().max(80), city: z.string().max(80).nullable().optional() });
type PlaceIn = z.infer<typeof Place>;
const words = (p: PlaceIn) => (p.city ? `the City of ${p.city}, ${p.state} (in ${p.county}${/county|parish|borough/i.test(p.county) ? "" : " County"})` : `${p.county}${/county|parish|borough/i.test(p.county) ? "" : " County"}, ${p.state}`);

const Summary = z.object({
  set: z.enum(["permit", "crew"]),
  sheets: z.array(z.object({ id: z.string().max(60), no: z.string().max(12), name: z.string().max(80), out: z.boolean(), need: z.boolean() })).max(30),
  cards: z
    .array(z.object({ id: z.string().max(160), sheet: z.string().max(60), sheetNo: z.string().max(12), label: z.string().max(120), drawing: z.boolean(), addable: z.boolean(), need: z.boolean(), text: z.string().max(600) }))
    .max(160),
  figures: z.string().max(1200),
  paper: z.string().max(40),
  place: z.string().max(160),
});

export type CheckResult =
  | { ok: true; check: CountyCheck; from: "upload" | "paste" | "online" | "kept" | "ask"; sources: Array<{ title: string; url: string }>; keptAt: string | null; saved: boolean }
  | { ok: false; error: string };

const buildOf = (v: unknown): BuildKind => ((BUILD_KINDS as readonly string[]).includes(String(v)) ? (v as BuildKind) : "deck-attached");

/** What the department wants, kept for this place and build — to offer it before anything is uploaded. */
export async function keptCountyRequirements(input: { place: PlaceIn | null; build: string }): Promise<{ ok: true; kept: Omit<KeptList, "words"> | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const p = Place.safeParse(input.place);
  const key = p.success ? placeKey(p.data.state, p.data.county, p.data.city) : null;
  if (!key) return { ok: true, kept: null };
  const kept = await readKeptList(g.organizationId, key, buildOf(input.build));
  if (!kept) return { ok: true, kept: null };
  const { words: _w, ...rest } = kept;
  void _w;
  return { ok: true, kept: rest };
}

/**
 * Check the set against the department's requirements, or turn the contractor's own words into changes (mode ask).
 * FormData: mode (upload | find | kept | ask), set (the set's summary,
 * JSON), place (JSON: state, county, city), build (what is being built), text, file, image × 4 (JPEG/PNG/WebP), refresh.
 */
export async function checkCountyRequirements(form: FormData): Promise<CheckResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the department's requirements needs AI, which isn't on for this workspace." };
  let set: SetSummary;
  try {
    set = Summary.parse(JSON.parse(String(form.get("set") ?? "{}")));
  } catch {
    return { ok: false, error: "The set couldn't be read. Reload the page and try again." };
  }
  const placeIn = (() => {
    try {
      const p = Place.safeParse(JSON.parse(String(form.get("place") ?? "null")));
      return p.success ? p.data : null;
    } catch {
      return null;
    }
  })();
  const key = placeIn ? placeKey(placeIn.state, placeIn.county, placeIn.city) : null;
  const build = buildOf(form.get("build"));
  const mode = String(form.get("mode") ?? "upload");
  if (!(await rateLimitShared(`permit-check:${g.organizationId}`, 30, 60 * 60 * 1000)).ok) return { ok: false, error: "That's a lot of checks this hour — try again in a little while." };

  let text = "";
  const images: string[] = [];
  let from: "upload" | "paste" | "online" | "kept" | "ask" = "upload";
  let sources: Array<{ title: string; url: string }> = [];
  let keptAt: string | null = null;
  let place = placeIn ? words(placeIn) : "";
  let department = "";

  try {
    if (mode === "ask") {
      text = String(form.get("text") ?? "").slice(0, 8000);
      if (text.trim().length < 3) return { ok: false, error: "Type what you want on the set." };
      from = "ask";
    } else if (mode === "find" || mode === "kept") {
      if (!placeIn || !key) return { ok: false, error: "JobFlex needs the county first: set the job's address in the studio (the county is read from it), or type the county and state under Title block." };
      const kept = await readKeptList(g.organizationId, key, build);
      const fresh = kept && Date.now() - Date.parse(kept.at) < 120 * 24 * 3600 * 1000;
      if (kept && (mode === "kept" || (fresh && form.get("refresh") !== "1"))) {
        text = kept.words;
        sources = kept.sources;
        keptAt = kept.at;
        place = kept.place || place;
        department = kept.department;
        from = "kept";
      } else {
        if (!(await rateLimitShared(`permit-find:${g.organizationId}`, 10, 60 * 60 * 1000)).ok) return { ok: false, error: "That's a lot of searches this hour — try again in a little while, or upload the department's checklist." };
        const t0 = Date.now();
        const found = await findOnline({ place, city: placeIn.city ?? null, state: placeIn.state }, build);
        console.log(`[permit-find] ${place} · ${build} · ${found ? `${found.text.length} chars, ${found.sources.length} sources` : "nothing"} · ${Date.now() - t0} ms`);
        if (!found) return { ok: false, error: `Couldn't find ${place}'s requirements online. Upload the department's checklist or paste its words.` };
        text = found.text;
        sources = found.sources;
        from = "online";
      }
    } else {
      text = String(form.get("text") ?? "").slice(0, 60_000);
      // A file's words are read out in the browser (a PDF's text layer, a text file) and come as text: it says so.
      from = text.trim() && form.get("source") !== "file" ? "paste" : "upload";
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        from = "upload";
        if (file.size > 10 * 1024 * 1024) return { ok: false, error: "That file is over 10 MB. Save the requirements pages alone, or paste their words." };
        const name = file.name.toLowerCase();
        const buf = Buffer.from(await file.arrayBuffer());
        if (/\.(xlsx|xlsm)$/.test(name)) text = `${text}\n${xlsxText(buf)}`;
        else if (/\.docx$/.test(name)) text = `${text}\n${docxText(buf)}`;
        else if (/\.(csv|tsv|txt|text|md|html?)$/.test(name)) text = `${text}\n${buf.toString("utf8")}`;
        else if (/\.(xls|doc)$/.test(name)) return { ok: false, error: "That's the old Excel or Word format. Save it as .xlsx or .docx (or PDF), or paste its words." };
        else return { ok: false, error: "JobFlex reads PDF, Word, Excel, text and photos. Paste the requirements' words for anything else." };
      }
      for (const img of form.getAll("image").slice(0, 4)) {
        if (!(img instanceof File) || img.size === 0 || img.size > 4 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(img.type)) continue;
        images.push(`data:${img.type};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`);
      }
      if (images.length) from = "upload";
      if (!text.trim() && !images.length) return { ok: false, error: "Upload the department's checklist, paste its words, or let JobFlex find them." };
    }

    const t0 = Date.now();
    const read = await askCheck({ text, images, set, ask: from === "ask" });
    console.log(`[permit-check] ${from} · ${images.length ? `${images.length} picture(s)` : `${text.length} chars`} · ${read ? `${read.items.length} items` : "nothing"} · ${Date.now() - t0} ms`);
    if (!read) return { ok: false, error: images.length ? "Couldn't read that picture. Try a sharper photo, or paste the requirements' words." : "Couldn't read the requirements. Try again, or paste fewer pages." };
    const check = checkRead(read, set, { asked: from === "ask" });
    if (!check.items.length) return { ok: false, error: from === "ask" ? "JobFlex couldn't turn that into a change to the set — say which sheet or card, and what it should say." : "Nothing in that reads as a building department's requirements for the plans." };
    if (!check.place) check.place = place;
    if (!check.department) check.department = department;

    // Kept for the next deck here — by the place the address names, not by what the document says.
    let saved = false;
    if (key && from !== "kept" && from !== "ask") {
      await writeKeptList(g.organizationId, key, build, { place: check.place || place, department: check.department, words: requirementsWords(check), sources, from, at: new Date().toISOString() });
      saved = true;
    }
    return { ok: true, check, from, sources, keptAt, saved };
  } catch (err) {
    if (err instanceof OfficeFileError) return { ok: false, error: err.message };
    logServerError("deck-county-requirements", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: friendlyAIError(err, "the requirements check") };
  }
}
