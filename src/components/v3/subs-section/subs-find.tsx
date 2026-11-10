"use client";
// FIND — the section's tab (2026-11-08, the subcontractors plan, part 3). Subs the company does not have yet, near the
// project: Washington's contractor register (license, specialties, bond, insurance), Google Places (ratings,
// websites) and the JobFlex Network (companies on JobFlex that opted in), as one list. The trade comes from the
// stages, the address from the project; each result has Call, Website, Details, Add to My subs and Request quote —
// the last saves the sub and opens the request sheet with them ticked. Texts go to a sub only once saved, from the
// request flow, under the texting rules. The writes are actions/projectSubs (estimators and managers).

import { useState } from "react";
import { findProjectSubs, saveFoundSub } from "@/actions/projectSubs";
import type { PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";
import type { ContractorRow } from "@/lib/projectSubs/server";
import { tradeForStage } from "@/lib/projectSubs/shared";
import type { FindRead } from "@/lib/subFinder/server";
import { LICENSE_KIND_LABEL, licenseWords, type FinderResult } from "@/lib/subFinder/shared";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "./subs.module.css";

const SOURCE_LABEL = { register: "State register", places: "Google", network: "JobFlex" } as const;

export function SubsFind({ projectId, stages, siteAddress, canManage, onSaved, onRequest }: { projectId: string; stages: PdStage[]; siteAddress: string | null; canManage: boolean; onSaved: (row: ContractorRow) => void; onRequest: (contractorId: string, trade: string | null) => void }) {
  const firstTrade = stages.map((st) => tradeForStage(st.name)).find((t): t is string => Boolean(t)) ?? "";
  const [trade, setTrade] = useState<string>(firstTrade);
  const [address, setAddress] = useState(siteAddress ?? "");
  const [radius, setRadius] = useState("25");
  const [words, setWords] = useState("");
  const [lapsed, setLapsed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [read, setRead] = useState<FindRead | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);

  async function search() {
    setBusy("search");
    setNote(null);
    try {
      setRead(await findProjectSubs({ projectId, trade: trade || null, address: address.trim() || null, radiusMi: Number(radius) || 25, words: words.trim() || null, includeLapsed: lapsed }));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The search didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  async function save(r: FinderResult): Promise<string> {
    const out = await saveFoundSub({ result: r, trade: trade || null });
    setSaved((cur) => ({ ...cur, [r.key]: out.row.id }));
    if (!out.existed) onSaved(out.row);
    return out.row.id;
  }

  async function act(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setNote(null);
    try {
      const w = await fn();
      if (w) setNote(w);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const savedIdOf = (r: FinderResult) => r.savedId ?? saved[r.key] ?? null;

  return (
    <section className={h.card} aria-label="Find subcontractors" data-subs-find>
      <div className={h.head}>
        <h3 className={h.title}>Find</h3>
        <span className={h.headSub}>subs near the project from the state register, Google and the JobFlex Network — the ones you already have are marked</span>
      </div>
      <div className={s.filters} style={{ marginTop: 10 }} data-subs-find-form>
        <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade" data-subs-find-trade>
          <option value="">Any trade</option>
          {TRADE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Near this address" style={{ minWidth: 260, flex: "1 1 260px" }} aria-label="Near" data-subs-find-address />
        <select value={radius} onChange={(e) => setRadius(e.target.value)} aria-label="Within" data-subs-find-radius>
          <option value="10">Within 10 mi</option>
          <option value="25">Within 25 mi</option>
          <option value="50">Within 50 mi</option>
        </select>
        <input type="text" value={words} onChange={(e) => setWords(e.target.value)} placeholder="A name (optional)" style={{ width: 180 }} aria-label="Name" data-subs-find-words />
        <label className={h.check} style={{ fontSize: 13 }}>
          <input type="checkbox" checked={lapsed} onChange={(e) => setLapsed(e.target.checked)} data-subs-find-lapsed /> Expired and suspended too
        </label>
        <button type="button" className={h.btnPrimary} disabled={busy !== null} onClick={() => void search()} data-subs-find-go>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
      </div>

      {note ? (
        <p className={h.note} role="status" data-subs-find-note>
          {note}
        </p>
      ) : null}
      {read?.notes.map((n, i) => (
        <p key={i} className={s.muted} style={{ margin: "6px 0 0", fontSize: 12.5 }} data-subs-find-source-note>
          {n}
        </p>
      ))}

      {read ? (
        <p className={s.muted} style={{ margin: "10px 0 6px", fontSize: 12.5 }} data-subs-find-counts>
          {read.results.length} found{read.address ? ` near ${read.address}` : ""} · {read.counts.register} in the state register · {read.counts.places} on Google · {read.counts.network} on JobFlex
        </p>
      ) : null}

      {read && read.results.length ? (
        <div className={s.table} data-subs-find-results>
          {read.results.map((r) => {
            const savedId = savedIdOf(r);
            const kind = r.license?.kind ?? null;
            const tone = kind === "ACTIVE" ? s.pillIn : kind === "EXPIRED" || kind === "SUSPENDED" ? s.pillLate : s.pillWait;
            return (
              <div key={r.key} className={s.row} style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1.2fr) auto" }} data-subs-find-result data-subs-find-key={r.key} data-subs-find-saved={savedId ? "1" : undefined}>
                <div>
                  <div className={s.name}>
                    {r.name}
                    {r.sources.map((src) => (
                      <span key={src} className={s.mono} style={{ marginLeft: 8, fontSize: 10.5 }} data-subs-find-source={src}>
                        {SOURCE_LABEL[src]}
                      </span>
                    ))}
                    {savedId ? (
                      <span className={`${s.pill} ${s.pillIn}`} style={{ marginLeft: 8 }} data-subs-find-saved-pill>
                        In My subs
                      </span>
                    ) : null}
                  </div>
                  <div className={s.mono}>{[r.address, r.distanceMi != null ? `${r.distanceMi} mi` : null].filter(Boolean).join(" · ")}</div>
                  <div style={{ marginTop: 4 }}>
                    <span className={`${s.pill} ${tone}`} data-subs-find-license={kind ?? "none"}>
                      {r.license ? LICENSE_KIND_LABEL[r.license.kind] : r.network ? "On JobFlex" : "License not in the register"}
                    </span>
                    {r.rating != null ? (
                      <span className={s.mono} style={{ marginLeft: 8 }} data-subs-find-rating>
                        ★ {r.rating.toFixed(1)}
                        {r.ratingCount != null ? ` (${r.ratingCount})` : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className={s.muted} style={{ fontSize: 12.5, marginTop: 2 }}>{licenseWords(r.license, today)}</div>
                  {open === r.key ? (
                    <dl className={s.facts} style={{ marginTop: 8 }} data-subs-find-details>
                      {r.license ? (
                        <>
                          <Fact label="License" value={`${r.license.number}${r.license.status ? ` · ${r.license.status}` : ""}${r.license.expires ? ` · to ${r.license.expires}` : ""}`} />
                          {r.license.specialties.length ? <Fact label="Specialties" value={r.license.specialties.join(", ")} /> : null}
                          {r.license.principal ? <Fact label="Principal" value={r.license.principal} /> : null}
                          {r.license.ubi ? <Fact label="UBI" value={r.license.ubi} /> : null}
                          <Fact label="Insurance" value={r.license.insurance ? `${r.license.insurance.carrier ?? "on record"}${r.license.insurance.amount ? ` · $${Math.round(r.license.insurance.amount).toLocaleString("en-US")}` : ""}${r.license.insurance.expires ? ` · to ${r.license.insurance.expires}` : ""}` : "none on record"} />
                          <Fact label="Bond" value={r.license.bond ? `${r.license.bond.firm ?? ""}${r.license.bond.amount ? ` · $${Math.round(r.license.bond.amount).toLocaleString("en-US")}` : ""}${r.license.bond.expires ? ` · to ${r.license.bond.expires}` : " · until cancelled"}${r.license.bond.impaired ? " · impaired" : ""}` : "none on record"} />
                        </>
                      ) : null}
                      {r.network ? (
                        <>
                          <Fact label="On JobFlex" value={`${r.network.trades.join(", ") || "any trade"}${r.network.serviceAreas ? ` · ${r.network.serviceAreas}` : ""}`} />
                          {r.network.contact.name || r.network.contact.email || r.network.contact.phone ? <Fact label="Contact" value={[r.network.contact.name, r.network.contact.phone, r.network.contact.email].filter(Boolean).join(" · ")} /> : null}
                        </>
                      ) : null}
                      {r.website ? <Fact label="Website" value={r.website} /> : null}
                      {r.placeId ? <Fact label="On Google" value={r.ratingCount != null ? `${r.ratingCount} review${r.ratingCount === 1 ? "" : "s"}` : "listed"} /> : null}
                    </dl>
                  ) : null}
                </div>
                <div className={s.mono} style={{ alignSelf: "start" }}>
                  {r.phone ? <div>{r.phone}</div> : null}
                  {r.email ? <div>{r.email}</div> : null}
                  {r.website ? <div style={{ overflowWrap: "anywhere" }}>{r.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</div> : null}
                </div>
                <div className={h.stageActs} style={{ justifyContent: "flex-end", flexWrap: "wrap", alignSelf: "start" }}>
                  {r.phone ? (
                    <a className={h.btnSm} href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-subs-find-call>
                      Call
                    </a>
                  ) : null}
                  {r.website ? (
                    <a className={h.btnSm} href={r.website} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-subs-find-site>
                      Website
                    </a>
                  ) : null}
                  <button type="button" className={h.btnSm} onClick={() => setOpen((cur) => (cur === r.key ? null : r.key))} data-subs-find-details-btn>
                    {open === r.key ? "Less" : "Details"}
                  </button>
                  {canManage && !savedId ? (
                    <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => void act(`save:${r.key}`, async () => { await save(r); return `${r.name} is in My subs.`; })} data-subs-find-add>
                      Add to My subs
                    </button>
                  ) : null}
                  {canManage ? (
                    <button type="button" className={h.btnPrimary} style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }} disabled={busy !== null} onClick={() => void act(`request:${r.key}`, async () => { const id = savedId ?? (await save(r)); onRequest(id, trade || null); return null; })} data-subs-find-request>
                      Request quote
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : read ? (
        <p className={h.empty}>Nobody found — widen the circle, drop the trade, or type a name.</p>
      ) : (
        <p className={h.empty}>Pick the trade and press Search. The address is the project&apos;s; change it to look somewhere else.</p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.fact}>
      <dt className={s.factLbl}>{label}</dt>
      <dd className={s.factVal}>{value}</dd>
    </div>
  );
}
