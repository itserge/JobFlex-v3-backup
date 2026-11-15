// THE HOUSE PHOTO, SERVER SIDE (2026-10-23) — server only, shared by the studio's door (actions/deckEstimator, behind
// the studio's gate) and the client's (actions/deckClientDesign, the link's token the key): the picture checked, kept in
// the private store under a folder the caller names, and read by the vision model.
//
// THE READ MOVED TO GPT-6 (2026-10-26). It ran on gpt-5 (deprecated by OpenAI since) and fell back to gpt-4o, asked for
// "a JSON object" of fractions read off a grid drawn over the picture — and the owner's photos came back with windows
// the size of garage doors and a corner the wrong way round, run after run. Now: the Responses API, the answer held to a
// schema (lib/deck/houseRead houseReadSchema), positions in the picture's own pixels, a GPT-6 model — gpt-6-luna by
// default (OPENAI_HOUSE_MODEL; the close look OPENAI_HOUSE_CLOSE_MODEL), its thinking OPENAI_HOUSE_EFFORT. A model the
// key's project lacks falls back to the estimators' vision model, said once in the log. Two things new in the answer:
// what the picture IS — a room, a car, a plan drawing is refused with a word to the user and nothing is built (owner:
// "first we gotta make sure it's the house") — and the house's own silhouette, so the passes after it read only the
// house ("and we can copy only the house").

import { randomUUID } from "node:crypto";
import { logServerError } from "@/lib/server-events";
import { runVisionStructured, type VisionEffort } from "@/lib/sdk/openaiVision";
import { ensureModel, friendlyAIError, getVisionModel, isOpenAIEnabled } from "@/lib/sdk/openai";
import { HOUSE_READ_PROMPT_PX, HOUSE_ZOOM_NOTE_PX, fromStructured, houseReadSchema, lookPastOf, parseHouseRead, type HouseLookPast, type HouseRead, type HouseSubject, type SubjectKind } from "@/lib/deck/houseRead";
import { HOUSE_CORNER_PROMPT, houseCornerSchema, type HouseCornerAnswer } from "@/lib/deck/houseCorner";
import { putPrivate } from "@/lib/media/privateStore";
import { mediaHref } from "@/lib/media/signedLink";

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** The studio shrinks a photo to about 1,600 px before sending it; this is the ceiling, not the aim. */
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
/** The model the house photo reads with when OPENAI_HOUSE_MODEL says nothing (owner, 2026-10-26: Luna for everything). */
export const HOUSE_MODEL_DEFAULT = "gpt-6-luna";

export type DeckPhotoResult = { ok: true; url: string; href: string; w: number; h: number } | { ok: false; error: string };
export type HousePhotoRead =
  | { ok: true; read: HouseRead; /** Which model answered. */ model: string; /** What the model said the picture is. */ subject?: HouseSubject; /** What stands in front of the wall, to keep out of the picture. */ lookPast?: HouseLookPast[] }
  | { ok: false; error: string; configured: boolean; /** The picture is not the outside of a house: nothing to drag lines onto, the user is told. */ reason?: "not-a-house" };

/** The picture in a form, checked: a JPEG, PNG or WebP the browser already shrank. */
export function photoOf(form: FormData): { ok: true; file: File } | { ok: false; error: string } {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No picture was sent." };
  if (!PHOTO_TYPES.has(file.type)) return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "That picture is too big — it should have been shrunk first. Try again." };
  return { ok: true, file };
}

/**
 * The picture kept in the PRIVATE store under `folder` (it ends with "/"). Back come the stored URL and a 15-minute
 * read link. `inline: false` — a caller whose design cannot carry a picture as a data URL (the client's, saved as it
 * goes) — gets an empty URL when the server has no file store, and keeps the house without the picture.
 */
export async function keepHousePhoto(form: FormData, folder: string, logAs: { organizationId: string }, opts: { inline?: boolean } = {}): Promise<DeckPhotoResult> {
  const p = photoOf(form);
  if (!p.ok) return p;
  const w = Math.round(Number(form.get("w")));
  const h = Math.round(Number(form.get("h")));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 20000 || h > 20000) return { ok: false, error: "The picture's size could not be read." };
  try {
    const ext = p.file.type === "image/png" ? "png" : p.file.type === "image/webp" ? "webp" : "jpg";
    const body = Buffer.from(await p.file.arrayBuffer());
    const stored = await putPrivate(`${folder}${randomUUID()}.${ext}`, body, p.file.type);
    if (stored.mode === "inline" && opts.inline === false) return { ok: true, url: "", href: "", w, h };
    const href = mediaHref(stored.url) ?? stored.url;
    return { ok: true, url: stored.url, href, w, h };
  } catch (err) {
    logServerError("deck-photo", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: "The picture could not be saved. Try again in a moment." };
  }
}

/** The models the house photo reads with, and how long they think — from the environment, read at call time. */
function houseModels(): { read: string; close: string; effort: VisionEffort } {
  const read = process.env.OPENAI_HOUSE_MODEL?.trim() || HOUSE_MODEL_DEFAULT;
  const close = process.env.OPENAI_HOUSE_CLOSE_MODEL?.trim() || read;
  const e = process.env.OPENAI_HOUSE_EFFORT?.trim();
  return { read, close, effort: e === "low" || e === "high" ? e : "medium" };
}

/** What the user is told when the picture is not the outside of a house. */
const NOT_A_HOUSE: Record<Exclude<SubjectKind, "house-exterior">, string> = {
  "house-interior": "That's the inside of a house. Stand in the yard and take the outside wall the deck will meet, the whole wall in the picture.",
  "other-building": "That looks like a building, but not a house's wall a deck could meet. Take the back (or side) wall of the house from the yard.",
  "not-a-building": "There's no house in that picture. Stand in the yard and take the wall where the deck goes, the whole wall in the frame.",
  unclear: "The house's wall can't be made out in that picture. Take it from the yard in daylight, square on, the whole wall in the frame.",
};
const NO_WALL = "The house's wall could not be found in that picture — take it square on from the yard, the whole wall in it.";

/**
 * THE HOUSE READ OFF ITS PHOTO: the model says what the picture is, then reads the wall's lines and what the 3D house
 * needs besides — every door and window, the roof's shape, the cladding, the wall's sections, the house's silhouette
 * (lib/deck/houseRead HOUSE_READ_PROMPT_PX). The form carries the picture's size in pixels (`w`, `h`), which the model
 * answers in; `look=close` is the wall cut out and enlarged (HOUSE_ZOOM_NOTE_PX).
 */
export async function readHouseImage(form: FormData, logAs: { organizationId: string }): Promise<HousePhotoRead> {
  const p = photoOf(form);
  if (!p.ok) return { ...p, configured: true };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the picture needs the AI key on the server.", configured: false };
  const w = Math.round(Number(form.get("w")));
  const h = Math.round(Number(form.get("h")));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 20000 || h > 20000) return { ok: false, error: "The picture's size could not be read.", configured: true };
  try {
    const dataUrl = `data:${p.file.type};base64,${Buffer.from(await p.file.arrayBuffer()).toString("base64")}`;
    const close = form.get("look") === "close";
    const models = houseModels();
    const wanted = close ? models.close : models.read;
    const fallback = getVisionModel();
    const model = (await ensureModel(wanted)) ? wanted : fallback;
    if (model !== wanted) console.warn(`[deck-house-read] "${wanted}" is not available to this key's project — reading with "${model}". Set OPENAI_HOUSE_MODEL to a GPT-6 model the project is entitled to.`);
    const ask = (m: string) =>
      runVisionStructured({
        schema: houseReadSchema,
        name: "house_read",
        model: m,
        effort: models.effort,
        detail: "original",
        systemPrompt: close ? `${HOUSE_READ_PROMPT_PX}\n${HOUSE_ZOOM_NOTE_PX}` : HOUSE_READ_PROMPT_PX,
        userPrompt: `${close ? "Read the house's wall in this close picture" : "Read this photo"}. The picture is ${w} × ${h} pixels: x runs 0–${w} left to right, y 0–${h} top to bottom. Answer in the schema.`,
        imageUrl: dataUrl,
      });
    let used = model;
    let parsed = await ask(model).catch((err) => {
      // The chosen model failed on its own account (a refused parameter, a model outage): one more try on the fallback.
      if (model === fallback) throw err;
      logServerError("deck-house-read-model", err, { kind: "action", organizationId: logAs.organizationId });
      return null;
    });
    if (!parsed && model !== fallback) {
      used = fallback;
      parsed = await ask(fallback);
    }
    if (!parsed) return { ok: false, error: NO_WALL, configured: true };
    const subject = parsed.subject;
    if (!close && subject.kind !== "house-exterior" && subject.confidence >= 0.5) {
      return { ok: false, error: NOT_A_HOUSE[subject.kind], configured: true, reason: "not-a-house" };
    }
    const read = parseHouseRead(fromStructured(parsed, w, h));
    if (!read) return { ok: false, error: NO_WALL, configured: true };
    return { ok: true, read, model: used, subject, lookPast: lookPastOf(parsed, w, h) };
  } catch (err) {
    logServerError("deck-house-read", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: friendlyAIError(err, "deck-house-read"), configured: true };
  }
}

/** One corner of the wall, asked about by itself (lib/deck/houseCorner). */
export type HouseCornerRead = { ok: true; answer: HouseCornerAnswer; model: string } | { ok: false; error: string; configured: boolean };

/**
 * THE CORNER LOOK (2026-11-13): a close cut of the picture round one vertical line of the wall, and one question —
 * which side of it stands nearer the camera. The form carries the cut (`file`), its size in pixels (`w`, `h`) and the
 * line's x in it (`x`, the cut's middle). The answer is laid on the read in the browser (applyCornerVerdict).
 */
export async function readHouseCornerImage(form: FormData, logAs: { organizationId: string }): Promise<HouseCornerRead> {
  const p = photoOf(form);
  if (!p.ok) return { ok: false, error: p.error, configured: true };
  if (!isOpenAIEnabled()) return { ok: false, error: "Reading the picture needs the AI key on the server.", configured: false };
  const w = Math.round(Number(form.get("w"))), h = Math.round(Number(form.get("h"))), x = Math.round(Number(form.get("x")));
  if (![w, h, x].every(Number.isFinite) || w < 16 || h < 16 || w > 20000 || h > 20000 || x < 0 || x > w) return { ok: false, error: "The picture's size could not be read.", configured: true };
  try {
    const dataUrl = `data:${p.file.type};base64,${Buffer.from(await p.file.arrayBuffer()).toString("base64")}`;
    const models = houseModels();
    const fallback = getVisionModel();
    const model = (await ensureModel(models.close)) ? models.close : fallback;
    const answer = await runVisionStructured({
      schema: houseCornerSchema,
      name: "house_corner",
      model,
      effort: models.effort,
      detail: "original",
      systemPrompt: HOUSE_CORNER_PROMPT,
      userPrompt: `The picture is ${w} × ${h} pixels. The line in question runs up the wall at x = ${x} (the middle of the picture's width). Which side of it stands nearer the camera? Answer in the schema.`,
      imageUrl: dataUrl,
    });
    if (!answer) return { ok: false, error: "The corner could not be read.", configured: true };
    return { ok: true, answer, model };
  } catch (err) {
    logServerError("deck-house-corner", err, { kind: "action", organizationId: logAs.organizationId });
    return { ok: false, error: "The corner could not be read.", configured: true };
  }
}
