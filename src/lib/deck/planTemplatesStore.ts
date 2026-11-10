import "server-only";
// THE CONTRACTOR'S OWN PLAN-SET TEMPLATES, KEPT BY THE COMPANY (2026-11-10).
// Owner: "he can make save as a template and he run his decks with exact
// template of the permit set and the construction set, the way he wants it
// after deleting and adjusting the original permit set." A short list of them
// per company (their names, which one new decks start with) and each
// template's edits in a row of its own. SyncState, no schema change — like the
// edits themselves (lib/deck/planEditsStore).

import { db } from "@/lib/db";
import { MAX_EDITS_JSON, normalizePlanEdits, normalizeTemplateIndex, templateFrom, type PlanEdits, type PlanTemplateIndex, type PlanTemplateInfo } from "./plans/edits";

const indexKey = (organizationId: string) => `deckplantemplates:${organizationId}`;
const bodyKey = (organizationId: string, id: string) => `deckplantemplate:${organizationId}:${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;

export async function readTemplateIndex(organizationId: string): Promise<PlanTemplateIndex> {
  try {
    const row = await db.syncState.findUnique({ where: { key: indexKey(organizationId) }, select: { cursor: true } });
    return normalizeTemplateIndex(row?.cursor ? JSON.parse(row.cursor) : null);
  } catch {
    return normalizeTemplateIndex(null);
  }
}

export async function writeTemplateIndex(organizationId: string, index: PlanTemplateIndex): Promise<PlanTemplateIndex> {
  const clean = normalizeTemplateIndex(index);
  const cursor = JSON.stringify(clean);
  await db.syncState.upsert({ where: { key: indexKey(organizationId) }, create: { key: indexKey(organizationId), cursor }, update: { cursor } });
  return clean;
}

/** A template's edits, or null when it is gone. */
export async function readTemplate(organizationId: string, id: string): Promise<PlanEdits | null> {
  try {
    const row = await db.syncState.findUnique({ where: { key: bodyKey(organizationId, id) }, select: { cursor: true } });
    if (!row?.cursor) return null;
    return templateFrom(normalizePlanEdits(JSON.parse(row.cursor)));
  } catch {
    return null;
  }
}

/** Keeps a template's edits; false when they are over the size limit. */
export async function writeTemplate(organizationId: string, id: string, body: PlanEdits): Promise<boolean> {
  const cursor = JSON.stringify(templateFrom(body));
  if (cursor.length > MAX_EDITS_JSON) return false;
  const key = bodyKey(organizationId, id);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return true;
}

export async function deleteTemplate(organizationId: string, id: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: bodyKey(organizationId, id) } });
}

/** The template new decks start with — its name and its edits — or null. */
export async function defaultTemplate(organizationId: string, index: PlanTemplateIndex): Promise<{ info: PlanTemplateInfo; body: PlanEdits } | null> {
  const info = index.defaultId ? index.list.find((x) => x.id === index.defaultId) : null;
  if (!info) return null;
  const body = await readTemplate(organizationId, info.id);
  return body ? { info, body } : null;
}
