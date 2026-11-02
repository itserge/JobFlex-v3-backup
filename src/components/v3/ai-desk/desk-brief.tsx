"use client";
// STEP 2 · TELL THE DESK ABOUT YOUR COMPANY — preset for the trade (owner, 2026-10-14: "he types the nature of the
// business — remodeling, roofing, tile — you preset all the questions that business needs, use the company's
// information, and he just reviews it and corrects … highlight the sensitive parts he has to look into").
//
//   1 · what kind of business   one field, the trades on file already in it → "Preset the desk"
//                               (actions/aiDesk presetDeskProfile, lib/aiDesk/tradePresets)
//   2 · the instructions        open, every sensitive part highlighted with why — a one-click fix, an edit, or
//                               "Looks right" clears it; Save keeps what is still to check
//   2b · describe the business  the big box, typed or spoken (DictateButton) → "Write it professionally"
//                               (composeDeskProfile): the owner's words corrected into the write-up the desk answers
//                               every question from (profile.knowledge), the structured parts updated and what the AI
//                               changed highlighted; what is covered so far ticks as they talk; "Answer it" puts a
//                               question the desk still has into the box
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { composeDeskProfile, presetDeskProfile, saveDeskProfile } from "@/actions/aiDesk";
import { DictateButton } from "@/components/estimator/DictateButton";
import { briefCoverage, MAX_FAQS, PROFILE_SECTIONS, profileFromFacts, type DeskFaq, type DeskProfile } from "@/lib/aiDesk/profile";
// The light half of the presets — the trades' texts stay on the server (lib/aiDesk/tradeCore).
import { BUSINESS_SUGGESTIONS, faqKey, matchBusinessLabels as matchBusiness, type DeskFix, type DeskReviewItem } from "@/lib/aiDesk/tradeCore";
import { DESK_COPY as C, type DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";
import s from "./ai-desk.module.css";

const asLines = (xs: string[]) => xs.join("\n");
const JUMPS = [
  ["desk-kind", C.navKind],
  ["desk-describe", C.navDescribe],
  ["desk-know", C.navKnow],
  ["desk-instructions", C.navInstructions],
] as const;
type JumpId = (typeof JUMPS)[number][0];
const fromLines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

/** The highlight on a part to check: why, the one-click fixes, and "Looks right". */
function CheckNote({ item, disabled, onFix, onOk }: { item: DeskReviewItem; disabled: boolean; onFix: (f: DeskFix) => void; onOk: () => void }) {
  return (
    <div className={s.checkNote} data-check-note>
      <span className={s.checkTag}>{C.checkThis}</span>
      <span className={s.checkWhy}>{item.why}</span>
      <span className={s.checkActs}>
        {item.fixes?.map((f) => (
          <button key={f.label} type="button" className={s.fix} disabled={disabled} onClick={() => onFix(f)} data-fix={f.label}>
            {f.label}
          </button>
        ))}
        <button type="button" className={`${s.fix} ${s.fixOk}`} disabled={disabled} onClick={onOk} data-looks-right>
          {C.looksRight}
        </button>
      </span>
    </div>
  );
}

export function DeskBrief({ desk, onWritten, onReview }: { desk: DeskSettingsData; onWritten?: (samples: DeskFaq[]) => void; onReview?: (left: number) => void }) {
  const router = useRouter();
  const [business, setBusiness] = useState(desk.business);
  const [brief, setBrief] = useState(desk.brief);
  const [profile, setProfile] = useState<DeskProfile>(desk.profile ?? profileFromFacts(desk.facts));
  const [written, setWritten] = useState(Boolean(desk.profile));
  const [questions, setQuestions] = useState<string[]>(desk.questions);
  const [review, setReviewState] = useState<DeskReviewItem[]>(desk.review);
  // Written and fully checked opens folded (a glance); a preset with parts to check, or a draft, opens to edit.
  const [showDetails, setShowDetails] = useState(!desk.profile || desk.review.length > 0);
  const [samples, setSamples] = useState<DeskFaq[]>([]);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "preset" | "compose" | "save">(null);
  // The part on screen, lit in the tab's own menu: the last part whose top has passed under the menu.
  const [here, setHere] = useState<JumpId>("desk-kind");
  useEffect(() => {
    const els = JUMPS.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      () => {
        if (!els[0].offsetParent) return; // the tab is hidden
        const passed = els.filter((el) => el.getBoundingClientRect().top < 160);
        const last = passed[passed.length - 1] ?? els[0];
        setHere(last.id as JumpId);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "-120px 0px -40% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const setReview = (next: DeskReviewItem[]) => {
    setReviewState(next);
    onReview?.(next.length);
  };
  const marks = useMemo(() => new Map(review.map((r) => [r.key, r])), [review]);
  const clear = (key: string) => {
    if (marks.has(key)) setReview(review.filter((r) => r.key !== key));
  };
  const set = <K extends keyof DeskProfile>(k: K, v: DeskProfile[K]) => {
    setProfile((p) => ({ ...p, [k]: v }));
    clear(k);
    setDirty(true);
  };
  const setFaq = (i: number, next: DeskFaq | null) => {
    const old = profile.faqs[i];
    if (old) clear(faqKey(old.q));
    setProfile((p) => ({ ...p, faqs: next ? p.faqs.map((x, k) => (k === i ? next : x)) : p.faqs.filter((_, k) => k !== i) }));
    setDirty(true);
  };

  const matched = useMemo(() => matchBusiness(business), [business]);
  const coverage = useMemo(() => briefCoverage(`${brief}\n${profile.knowledge}`), [brief, profile.knowledge]);

  const preset = async () => {
    if (written && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setConfirmReplace(false);
    setBusy("preset");
    setNote("");
    setErr("");
    try {
      const r = await presetDeskProfile(business);
      if (r.ok) {
        setProfile(r.profile);
        setQuestions(r.questions);
        setReview(r.review);
        setBusiness(r.business);
        setWritten(true);
        setDirty(false);
        setShowDetails(true);
        setNote(r.note ?? "Preset.");
        onWritten?.([]);
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const compose = async () => {
    setBusy("compose");
    setNote("");
    setErr("");
    try {
      const r = await composeDeskProfile(brief);
      if (r.ok) {
        setProfile(r.profile);
        setQuestions(r.questions);
        setReview(r.review);
        setWritten(true);
        setDirty(false);
        if (r.review.length) setShowDetails(true);
        setNote(r.note ?? "Written.");
        setSamples(r.samples);
        onWritten?.(r.samples);
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't reach JobFlex. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setNote("");
    setErr("");
    try {
      const r = await saveDeskProfile(profile, review.map((x) => x.key));
      if (r.ok) {
        setQuestions(r.questions);
        setReview(r.review);
        setWritten(true);
        setDirty(false);
        setNote(r.note ?? "Saved.");
        router.refresh();
      } else setErr(r.error);
    } catch {
      setErr("Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const nextToCheck = () => {
    const el = document.querySelector<HTMLElement>("[data-desk-setup] [data-check='1']");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
  };

  // A question the desk still has → into the description, the cursor after it, for the owner to answer in their words.
  const answerIt = (q: string) => {
    const next = `${brief.trimEnd()}${brief.trim() ? "\n\n" : ""}${q} `;
    setBrief(next);
    window.setTimeout(() => {
      const el = briefRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const addSuggestion = (word: string) => {
    const now = business.trim();
    if (now.toLowerCase().includes(word.toLowerCase())) return;
    setBusiness(now ? `${now}, ${word}` : word);
  };

  const facts = [desk.facts.name, desk.facts.city ?? "", desk.facts.hoursWords, ...desk.facts.services.slice(0, 3), desk.facts.phone ?? ""].filter(Boolean);
  const disabled = !desk.canManage;

  return (
    <div className={s.root} data-desk-setup data-written={written ? "1" : "0"}>
      {/* the four parts of this tab, one tap away — the tab is long by nature */}
      <nav className={s.subnav} aria-label={C.subnavLabel} data-desk-subnav>
        {JUMPS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={s.subnavBtn}
            aria-current={here === id ? "true" : undefined}
            onClick={() => {
              setHere(id);
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            data-desk-jump={id}
          >
            {label}
            {id === "desk-instructions" && review.length ? <span className={s.subnavCount}>{C.toCheck(review.length)}</span> : null}
          </button>
        ))}
      </nav>
      {/* 1 · what kind of business */}
      <div className={`${s.sec} ${s.card}`} id="desk-kind" data-desk-business data-tour="ai-desk:kind">
        <label className={s.h} htmlFor="desk-business">
          {C.kindTitle}
        </label>
        <div className={s.tryRow}>
          <input
            id="desk-business"
            className={s.in}
            value={business}
            placeholder={C.kindPlaceholder}
            disabled={disabled}
            onChange={(e) => {
              setBusiness(e.target.value);
              setConfirmReplace(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && business.trim().length >= 2 && busy === null) void preset();
            }}
          />
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || disabled || business.trim().length < 2} onClick={() => void preset()} data-desk-preset>
            {busy === "preset" ? C.presetting : written ? C.presetAgain : C.preset}
          </button>
        </div>
        <p className={s.kindHint} data-desk-business-hint>
          {C.kindHint}
        </p>
        {business.trim() ? (
          <div className={s.facts} aria-label={C.kindMatched} data-desk-matched>
            {matched.packs.map((p) => (
              <span key={p.key} className={`${s.fact} ${s.factOk}`}>
                ✓ {p.label}
              </span>
            ))}
            {matched.unknown.map((u) => (
              <span key={u} className={`${s.fact} ${s.factAi}`} title={desk.aiConfigured ? C.kindAi : C.kindGeneric}>
                {u} · {desk.aiConfigured ? C.kindAiShort : C.kindGenericShort}
              </span>
            ))}
          </div>
        ) : null}
        <div className={s.suggest} aria-label={C.kindSuggest}>
          {BUSINESS_SUGGESTIONS.filter((w) => !business.toLowerCase().includes(w.toLowerCase())).slice(0, 10).map((w) => (
            <button key={w} type="button" className={s.suggestBtn} disabled={disabled} onClick={() => addSuggestion(w)}>
              + {w}
            </button>
          ))}
        </div>
        {facts.length ? (
          <div className={s.facts} aria-label={C.knownAlready}>
            <span className={s.factLead}>{C.knownAlready}:</span>
            {facts.map((f) => (
              <span key={f} className={s.fact}>
                {f}
              </span>
            ))}
          </div>
        ) : null}
        {confirmReplace ? (
          <div className={s.confirm} role="alert" data-desk-replace>
            <span>{C.replaceWarn}</span>
            <span className={s.acts}>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void preset()} data-desk-replace-yes>
                {C.replaceYes}
              </button>
              <button type="button" className={s.btn} onClick={() => setConfirmReplace(false)}>
                {C.cancel}
              </button>
            </span>
          </div>
        ) : null}
      </div>

      {/* 2 · the business, in their own words → the professional write-up the desk answers from */}
      <div className={`${s.sec} ${s.card} ${s.describe}`} id="desk-describe" data-desk-describe data-tour="ai-desk:describe">
        <label className={s.h} htmlFor="desk-brief">
          {C.describeTitle}
        </label>
        <p className={s.note}>{C.describeSub}</p>
        <div className={s.coverage} aria-label={C.coverageTitle} data-desk-coverage>
          <span className={s.factLead}>{C.coverageTitle}:</span>
          {coverage.map((c) => (
            <span key={c.key} className={`${s.cover} ${c.covered ? s.coverOn : ""}`} data-covered={c.covered ? "1" : "0"} data-cover={c.key}>
              {c.covered ? "✓ " : ""}
              {c.label}
            </span>
          ))}
        </div>
        <textarea ref={briefRef} id="desk-brief" className={`${s.area} ${s.briefArea}`} value={brief} placeholder={C.briefPlaceholder} disabled={disabled} onChange={(e) => setBrief(e.target.value)} data-desk-brief />
        <DictateButton id="deskBriefDictate" label={C.speak} value={brief} onChange={setBrief} wrapClassName={s.dictate} buttonClassName={s.btn} onClassName={s.dictateOn} noteClassName={s.dictateNote} iconClassName={s.ic} />
        <div className={s.acts}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || disabled || !desk.aiConfigured || !brief.trim()} onClick={() => void compose()} data-desk-compose>
            {busy === "compose" ? C.writing : profile.knowledge ? C.rewritePro : C.writePro}
          </button>
          {!desk.aiConfigured ? <span className={`${s.note} ${s.noteErr}`}>{C.aiOff}</span> : null}
        </div>

        <div className={`${s.sec} ${marks.get("knowledge") ? s.secCheck : ""}`} id="desk-know" data-section="knowledge" data-check={marks.get("knowledge") ? "1" : "0"}>
          <div className={s.secHead}>
            <label className={s.h} htmlFor="desk-knowledge">
              {C.knowTitle}
            </label>
            <span className={s.secHint}>{C.knowHint}</span>
          </div>
          {marks.get("knowledge") ? (
            <CheckNote
              item={marks.get("knowledge")!}
              disabled={disabled}
              onFix={(f) => set("knowledge", f.text)}
              onOk={() => {
                clear("knowledge");
                setDirty(true);
              }}
            />
          ) : null}
          <textarea id="desk-knowledge" className={`${s.area} ${s.knowArea}`} value={profile.knowledge} placeholder={C.knowEmpty} disabled={disabled} onChange={(e) => set("knowledge", e.target.value)} data-desk-knowledge />
          {dirty ? (
            <div className={s.saveBar}>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || disabled} onClick={() => void save()} data-desk-save-knowledge>
                {busy === "save" ? C.saving : C.save}
              </button>
              <span className={s.note}>{C.unsaved}</span>
            </div>
          ) : null}
        </div>

        {samples.length ? (
          <div className={s.samples} data-desk-samples-inline>
            <div className={s.h}>{C.samplesTitle}</div>
            {samples.map((x) => (
              <div key={x.q} className={s.sample}>
                <b>“{x.q}”</b>
                <span>{x.a}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {note ? <p className={`${s.note} ${s.noteOk}`} role="status">{note}</p> : null}
      {err ? <p className={`${s.note} ${s.noteErr}`} role="alert">{err}</p> : null}

      {/* what is still to check */}
      {written && review.length ? (
        <div className={s.checkBanner} data-desk-to-check={review.length}>
          <span>
            <b>{C.toCheck(review.length)}</b> {C.toCheckSub}
          </span>
          <button type="button" className={s.btn} onClick={nextToCheck} data-desk-next-check>
            {C.nextToCheck}
          </button>
        </div>
      ) : null}

      {questions.length ? (
        <div className={s.qs} data-desk-questions>
          <b>{C.questionsTitle}</b>
          <ul>
            {questions.map((q) => (
              <li key={q}>
                {q}{" "}
                <button type="button" className={s.answerIt} disabled={disabled} onClick={() => answerIt(q)} data-answer-it>
                  {C.answerIt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 2 · the instructions, section by section — folded once written and checked */}
      <div className={`${s.sections} ${s.card}`} id="desk-instructions" data-desk-profile data-open={showDetails ? "1" : "0"}>
        <div className={s.secHead}>
          <div>
            <div className={s.h}>{written ? C.profileTitle : C.profileTitleDraft}</div>
            <p className={s.note}>{written ? (review.length ? C.profileSubCheck : C.profileSub) : C.profileSubDraft}</p>
          </div>
          <button type="button" className={s.btn} onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails} data-desk-details>
            {showDetails ? C.hideDetails : C.showDetails}
          </button>
        </div>
        {!showDetails ? (
          <div className={s.glance} data-desk-glance>
            <p>
              <b>Greeting.</b> {profile.greeting || "—"}
            </p>
            {profile.about ? (
              <p>
                <b>About.</b> {profile.about}
              </p>
            ) : null}
            {profile.services.length ? (
              <p>
                <b>Services.</b> {profile.services.join(" · ")}
              </p>
            ) : null}
            {profile.hours ? (
              <p>
                <b>Hours.</b> {profile.hours}
              </p>
            ) : null}
            {profile.pricing ? (
              <p>
                <b>Prices.</b> {profile.pricing}
              </p>
            ) : null}
            {profile.faqs.length ? (
              <p>
                <b>Callers ask.</b> {profile.faqs.map((f) => f.q).join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className={s.fields} hidden={!showDetails}>
          {PROFILE_SECTIONS.map((sec) => {
            const mark = marks.get(sec.key);
            return (
              <div key={sec.key} className={`${s.sec} ${mark ? s.secCheck : ""}`} data-section={sec.key} data-check={mark ? "1" : "0"}>
                <div className={s.secHead}>
                  <label className={s.h} htmlFor={`desk-${sec.key}`}>
                    {sec.label}
                  </label>
                  <span className={s.secHint}>{sec.hint}</span>
                </div>
                {mark ? (
                  <CheckNote
                    item={mark}
                    disabled={disabled}
                    onFix={(f) => set(sec.key, (sec.kind === "list" ? fromLines(f.text) : f.text) as never)}
                    onOk={() => {
                      clear(sec.key);
                      setDirty(true);
                    }}
                  />
                ) : null}
                {sec.kind === "faq" ? (
                  <div className={s.faqs}>
                    {profile.faqs.map((f, i) => {
                      const fm = marks.get(faqKey(f.q));
                      return (
                        <div key={i} className={`${s.faqWrap} ${fm ? s.secCheck : ""}`} data-faq={i} data-check={fm ? "1" : "0"}>
                          <div className={s.faq}>
                            <input className={s.in} value={f.q} placeholder="Question" aria-label={`Question ${i + 1}`} disabled={disabled} onChange={(e) => setFaq(i, { ...f, q: e.target.value })} />
                            <textarea className={`${s.in} ${s.faqA}`} value={f.a} placeholder="The desk's answer" aria-label={`Answer ${i + 1}`} disabled={disabled} rows={2} onChange={(e) => setFaq(i, { ...f, a: e.target.value })} />
                            <button type="button" className={s.x} aria-label={`Remove question ${i + 1}`} disabled={disabled} onClick={() => setFaq(i, null)}>
                              ×
                            </button>
                          </div>
                          {fm ? (
                            <CheckNote
                              item={fm}
                              disabled={disabled}
                              onFix={(fix) => setFaq(i, { ...f, a: fix.text })}
                              onOk={() => {
                                clear(faqKey(f.q));
                                setDirty(true);
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    <div className={s.acts}>
                      <button
                        type="button"
                        className={s.btn}
                        disabled={disabled || profile.faqs.length >= MAX_FAQS}
                        onClick={() => {
                          setProfile((p) => ({ ...p, faqs: [...p.faqs, { q: "", a: "" }] }));
                          setDirty(true);
                        }}
                      >
                        {C.addFaq}
                      </button>
                    </div>
                  </div>
                ) : sec.kind === "list" ? (
                  <textarea id={`desk-${sec.key}`} className={s.area} style={{ minHeight: 76 }} value={asLines(profile[sec.key] as string[])} disabled={disabled} onChange={(e) => set(sec.key, fromLines(e.target.value) as never)} />
                ) : sec.kind === "long" ? (
                  <textarea id={`desk-${sec.key}`} className={s.area} style={{ minHeight: 76 }} value={profile[sec.key] as string} disabled={disabled} onChange={(e) => set(sec.key, e.target.value as never)} />
                ) : (
                  <input id={`desk-${sec.key}`} className={s.in} value={profile[sec.key] as string} disabled={disabled} onChange={(e) => set(sec.key, e.target.value as never)} />
                )}
              </div>
            );
          })}
        </div>
        <div className={s.saveBar}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy !== null || disabled || (!dirty && written)} onClick={() => void save()} data-desk-save>
            {busy === "save" ? C.saving : review.length ? C.save : written ? C.saveChecked : C.save}
          </button>
          {dirty ? <span className={s.note}>{C.unsaved}</span> : null}
          {review.length ? <span className={s.note}>{C.toCheck(review.length)}</span> : null}
        </div>
      </div>

    </div>
  );
}
