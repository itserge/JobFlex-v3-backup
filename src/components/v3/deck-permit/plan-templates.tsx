"use client";
// THE CONTRACTOR'S OWN TEMPLATES, ON SCREEN (2026-11-10). Owner: "when constructor he did his preset with deleting
// what he don't need it, that he can make save as a template and he run his decks with exact template of the permit
// set and the construction set, the way he wants it after deleting and adjusting the original permit set."
//
// In the Edit's panel: Save as a template (both sets as they stand, under a name, and whether every new deck starts
// with it), the company's templates (put one on this deck, pick the one new decks start with, delete one), and a word
// about the template's typed-over cards this deck does not take (its own card reads differently — another size).
// The edits and the rule for a typed-over card: lib/deck/plans/edits; kept by lib/deck/planTemplatesStore.
import * as React from "react";
import { MAX_TEMPLATES, editsFromTemplate, nothingToSave, templateName, type PlanTemplateIndex, type PlanTemplateInfo } from "@/lib/deck/plans/edits";
import { deleteDeckPlanTemplate, readDeckPlanTemplate, saveDeckPlanTemplate, setDefaultDeckPlanTemplate } from "@/actions/deckPlanTemplates";
import type { PlanEditApi } from "@/components/v3/deck-plans/plan-edit";
import s from "./deck-permit.module.css";

/** The company's templates and the way to replace the list after a change. */
export interface TemplatesProp {
  index: PlanTemplateIndex;
  set(index: PlanTemplateIndex): void;
}
export const NO_TEMPLATES: PlanTemplateIndex = { v: 1, defaultId: null, list: [] };

const FAILED = "That didn't go through. Try again in a moment.";
const savedOn = (at: string) => (at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/** Name it, say whether new decks start with it, save. */
export function TemplateSaveRow({ api, tpl, onClose }: { api: PlanEditApi; tpl: TemplatesProp; onClose: (said?: string) => void }) {
  const from = api.edits.tpl ?? null;
  const [name, setName] = React.useState(() => from?.name ?? (tpl.index.list.length ? "" : "My permit set"));
  // The box as the contractor left it; until he touches it, see `makeDefault` below.
  const [picked, setPicked] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const clean = templateName(name);
  const same = clean ? tpl.index.list.find((x) => x.name.toLowerCase() === clean.toLowerCase()) : undefined;
  const full = !same && tpl.index.list.length >= MAX_TEMPLATES;
  // The box always says what will be true after the save: ticked for the very first template and when saving over
  // the one new decks already start with; a later template never takes that over without a tick.
  const makeDefault = picked ?? (!tpl.index.list.length || (!!same && same.id === tpl.index.defaultId));
  const save = async () => {
    if (!clean || busy) return;
    // A card being typed into is kept first, so the template has it.
    api.finishTyping(true);
    const edits = api.snapshot();
    if (nothingToSave(edits)) {
      setError("Nothing is changed on these sets yet — take out or change what you want first, then save the template.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await saveDeckPlanTemplate({ name: clean, edits, makeDefault });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      tpl.set(r.index);
      onClose(`${r.replaced ? "Saved over" : "Saved"} “${r.info.name}” — the permit set and the construction set the way they are now.${r.index.defaultId === r.info.id ? " Every new deck starts with it." : ""}`);
    } catch {
      setBusy(false);
      setError(FAILED);
    }
  };
  return (
    <div className={s.tplSave} data-plan-tpl-save-row>
      <b>Save as a template</b>
      <input
        type="text"
        className={s.sheetName}
        value={name}
        maxLength={60}
        autoFocus
        placeholder="A name — e.g. My permit set"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        aria-label="The template's name"
        data-plan-tpl-name
      />
      <label className={s.sheetTick}>
        <input type="checkbox" checked={makeDefault} onChange={(e) => setPicked(e.target.checked)} data-plan-tpl-default-box />
        <span>Start every new deck with it</span>
      </label>
      <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!clean || busy || full} onClick={() => void save()} data-plan-tpl-save>
        {busy ? "Saving…" : same ? "Save over it" : "Save template"}
      </button>
      <button type="button" className={s.btn} disabled={busy} onClick={() => onClose()}>
        Cancel
      </button>
      <p>
        It keeps both sets the way they are now — the permit set and the construction set: what you took out, renamed, added and typed over, and Full or Simple.
        The drawings and the sizes still come from each deck&apos;s own design, and the county&apos;s figures and to-do list stay with each address.
        {same ? ` You already have “${same.name}” — saving puts this in its place.` : ""}
        {full ? ` You have ${MAX_TEMPLATES} templates — delete one you no longer use first, or use one of their names to save over it.` : ""}
      </p>
      {error ? <div className={s.alertFail} style={{ flex: "1 1 100%" }} data-plan-tpl-error>{error}</div> : null}
    </div>
  );
}

/** The company's templates: put one on this deck, pick the one new decks start with, delete one. */
export function TemplateList({ api, tpl, onSaid }: { api: PlanEditApi; tpl: TemplatesProp; onSaid: (said: string) => void }) {
  const [ask, setAsk] = React.useState<{ id: string; kind: "use" | "delete" } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  if (!tpl.index.list.length) return null;
  const run = async (id: string, work: () => Promise<void>) => {
    setAsk(null);
    setError("");
    setBusy(id);
    try {
      await work();
    } catch {
      setError(FAILED);
    }
    setBusy(null);
  };
  const use = (t: PlanTemplateInfo) =>
    run(t.id, async () => {
      const r = await readDeckPlanTemplate(t.id);
      if (!r.ok) return setError(r.error);
      api.finishTyping(false);
      // Both sets at once (one Undo); the deck keeps its own county checks.
      api.applyAll(editsFromTemplate(r.body, r.info, api.snapshot()));
      onSaid(`“${r.info.name}” is on this deck now — the permit set and the construction set. Undo takes it back.`);
    });
  const setDefault = (id: string | null, at: string) =>
    run(at, async () => {
      const r = await setDefaultDeckPlanTemplate(id);
      if (!r.ok) return setError(r.error);
      tpl.set(r.index);
    });
  const remove = (t: PlanTemplateInfo) =>
    run(t.id, async () => {
      const r = await deleteDeckPlanTemplate(t.id);
      if (!r.ok) return setError(r.error);
      tpl.set(r.index);
    });
  return (
    <div className={s.siteGroup} data-plan-tpl-list>
      <div className={s.siteGroupTitle}>Your templates</div>
      <p className={s.siteSaid}>
        A template is your own version of the two sets. {tpl.index.defaultId ? "Every new deck starts with the one marked; a deck you already changed keeps its own." : "None is picked for new decks, so they start the way the studio draws them."}
      </p>
      {error ? <div className={s.alertFail} data-plan-tpl-error>{error}</div> : null}
      <div className={s.tplRows}>
        {tpl.index.list.map((t) => {
          const isDefault = tpl.index.defaultId === t.id;
          const here = api.edits.tpl?.id === t.id;
          const asking = ask?.id === t.id ? ask.kind : null;
          const off = busy !== null;
          return (
            <div key={t.id} className={s.tplRow} data-plan-tpl-row={t.name}>
              <span>
                <b>{t.name}</b>
                <em>
                  {savedOn(t.at) ? `Saved ${savedOn(t.at)}` : "Saved"}
                  {here ? " · this deck started from it" : ""}
                </em>
                {isDefault ? <span className={s.tplMark} data-plan-tpl-is-default>Every new deck starts with this</span> : null}
              </span>
              <span className={s.siteBtns}>
                <button type="button" className={s.btn} disabled={off} onClick={() => (nothingToSave(api.all) ? void use(t) : setAsk({ id: t.id, kind: "use" }))} data-plan-tpl-use>
                  {busy === t.id ? "Working…" : "Use on this deck"}
                </button>
                <button type="button" className={s.btn} disabled={off} onClick={() => void setDefault(isDefault ? null : t.id, t.id)} data-plan-tpl-default>
                  {isDefault ? "Stop using for new decks" : "Use for new decks"}
                </button>
                <button type="button" className={s.btn} disabled={off} onClick={() => setAsk({ id: t.id, kind: "delete" })} data-plan-tpl-delete>
                  Delete
                </button>
              </span>
              {asking === "use" ? (
                <div className={s.askRow} data-plan-tpl-ask>
                  <span>This puts “{t.name}” in place of what you changed on this deck — on the permit set and the construction set. Undo brings yours back.</span>
                  <button type="button" className={s.btn} onClick={() => setAsk(null)}>Keep mine</button>
                  <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void use(t)} data-plan-tpl-yes>
                    Use the template
                  </button>
                </div>
              ) : asking === "delete" ? (
                <div className={s.askRow} data-plan-tpl-ask>
                  <span>Delete the template “{t.name}”? Decks already made with it keep their sets.{isDefault ? " New decks go back to the way the studio draws them." : ""}</span>
                  <button type="button" className={s.btn} onClick={() => setAsk(null)}>Keep it</button>
                  <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => void remove(t)} data-plan-tpl-yes>
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The template's typed-over cards this deck does not take. A card typed over on one deck carries that deck's words —
 * its sizes, its counts — so it shows on another only where the card it was typed over reads the same; where it does
 * not, the deck's own card is drawn and it is said here, once, until the contractor lets it go or types his own.
 */
export function TemplateSkipped({ api }: { api: PlanEditApi }) {
  const items = Object.entries(api.tplSkip);
  if (!items.length) return null;
  const one = items.length === 1;
  const drop = () =>
    api.change((e) => {
      const cards = { ...e.cards };
      for (const [id] of items) if (cards[id]?.tpl) delete cards[id];
      return { ...e, cards };
    });
  return (
    <div className={s.alerts} data-plan-tpl-skip>
      <div className={s.alertHint}>
        <b>
          {one ? "One card" : `${items.length} cards`} from your template {one ? "is" : "are"} drawn the studio&apos;s way on this deck:
        </b>{" "}
        {items.map(([id, v], i) => (
          <React.Fragment key={id}>
            {i ? "; " : ""}
            <button
              type="button"
              className={s.linkBtn}
              onClick={() => {
                if (!api.editing) api.setEditing(true);
                window.setTimeout(() => api.select(id, true), 0);
              }}
            >
              {v.sheetNo} · {v.label}
            </button>
          </React.Fragment>
        ))}
        . You typed over {one ? "it" : "them"} on a deck where {one ? "it" : "they"} read differently — another size, other figures — so your words would be wrong here. Type your own on this deck if you want.
        {api.canEdit ? (
          <>
            {" "}
            <button type="button" className={s.linkBtn} onClick={drop} data-plan-tpl-skip-ok>
              OK, leave {one ? "it" : "them"} as drawn
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
