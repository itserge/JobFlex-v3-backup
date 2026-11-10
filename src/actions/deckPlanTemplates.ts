"use server";
// THE CONTRACTOR'S OWN PLAN-SET TEMPLATES (2026-11-10). Owner: "when
// constructor he did his preset with deleting what he don't need it, that he
// can make save as a template and he run his decks with exact template of the
// permit set and the construction set." Save the two sets as they stand on a
// deck under a name; pick the one every new deck starts with; put one on the
// deck being looked at; delete one. Kept by the company
// (lib/deck/planTemplatesStore); behind the same gate as the set's Edit.

import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { logServerError } from "@/lib/server-events";
import { MAX_TEMPLATES, newEditId, normalizePlanEdits, nothingToSave, templateFrom, templateName, type PlanEdits, type PlanTemplateIndex, type PlanTemplateInfo } from "@/lib/deck/plans/edits";
import { deleteTemplate, readTemplate, readTemplateIndex, writeTemplate, writeTemplateIndex } from "@/lib/deck/planTemplatesStore";

type Gate = { ok: true; organizationId: string } | { ok: false; error: string };
type IndexResult = { ok: true; index: PlanTemplateIndex } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level !== "full") return { ok: false, error: "Templates for the permit set are part of Deck Studio." };
    return { ok: true, organizationId: ctx.organizationId };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can change the templates." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}
const failed = (organizationId: string, err: unknown): { ok: false; error: string } => {
  logServerError("deck-plan-templates", err, { kind: "action", organizationId });
  return { ok: false, error: "That could not be saved. Try again in a moment." };
};

/** Save both sets as they stand on a deck as a template; one with the same name is replaced. */
export async function saveDeckPlanTemplate(input: { name: string; edits: unknown; makeDefault?: boolean }): Promise<({ ok: true; index: PlanTemplateIndex; info: PlanTemplateInfo; replaced: boolean }) | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const name = templateName(input.name);
  if (!name) return { ok: false, error: "Give the template a name." };
  const body = templateFrom(normalizePlanEdits(input.edits));
  if (nothingToSave(body)) return { ok: false, error: "Nothing is changed on these sets yet — take out or change what you want first, then save the template." };
  try {
    const index = await readTemplateIndex(g.organizationId);
    const same = index.list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!same && index.list.length >= MAX_TEMPLATES) return { ok: false, error: `You have ${MAX_TEMPLATES} templates — delete one you no longer use first.` };
    const info: PlanTemplateInfo = { id: same?.id ?? newEditId("tpl"), name, at: new Date().toISOString() };
    if (!(await writeTemplate(g.organizationId, info.id, body))) return { ok: false, error: "The template is too long to keep — take out a long card or two." };
    const list = same ? index.list.map((x) => (x.id === info.id ? info : x)) : [...index.list, info];
    const next = await writeTemplateIndex(g.organizationId, { v: 1, list, defaultId: input.makeDefault ? info.id : index.defaultId === info.id ? null : index.defaultId });
    return { ok: true, index: next, info, replaced: !!same };
  } catch (err) {
    return failed(g.organizationId, err);
  }
}

/** The template every new deck starts with (null: none — new decks start as the studio draws them). */
export async function setDefaultDeckPlanTemplate(id: string | null): Promise<IndexResult> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const index = await readTemplateIndex(g.organizationId);
    if (id && !index.list.some((x) => x.id === id)) return { ok: false, error: "That template is gone." };
    return { ok: true, index: await writeTemplateIndex(g.organizationId, { ...index, defaultId: id }) };
  } catch (err) {
    return failed(g.organizationId, err);
  }
}

export async function deleteDeckPlanTemplate(id: string): Promise<IndexResult> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const index = await readTemplateIndex(g.organizationId);
    if (!index.list.some((x) => x.id === id)) return { ok: true, index };
    const next = await writeTemplateIndex(g.organizationId, { v: 1, list: index.list.filter((x) => x.id !== id), defaultId: index.defaultId === id ? null : index.defaultId });
    await deleteTemplate(g.organizationId, id);
    return { ok: true, index: next };
  } catch (err) {
    return failed(g.organizationId, err);
  }
}

/** A template's edits, to put on the deck being looked at. */
export async function readDeckPlanTemplate(id: string): Promise<{ ok: true; info: PlanTemplateInfo; body: PlanEdits } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const index = await readTemplateIndex(g.organizationId);
  const info = index.list.find((x) => x.id === id);
  const body = info ? await readTemplate(g.organizationId, info.id) : null;
  if (!info || !body) return { ok: false, error: "That template is gone." };
  return { ok: true, info, body };
}
