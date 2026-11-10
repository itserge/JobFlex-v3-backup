"use client";
// THE SUB'S HALF of /s/[token] (2026-11-08, the subcontractors plan, part 4): the agreement in full, the files, the
// company's signature, then the sub's — a typed name and "I have read this subcontract and agree to it" — and, once
// signed, both signatures, the signed PDF and the change orders (agree with a typed name, or decline with a reason).
// Writes go through actions/projectSubs contractSign and contractChangeAnswer with the token alone. Styled by the
// buyer's ../../buy/[token]/buy.css (root `.jf-buy`), the quote page's ../../q/[token]/quote.css and ./contract.css.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contractChangeAnswer, contractSign } from "@/actions/projectSubs";
import type { ContractView } from "@/lib/subContracts/server";
import { ContractMoney } from "./contract-money";
import { AGREE_CHANGE_WORDS, CHANGE_LABEL, SIGN_WORDS, changeNo, changeStatusOf, contractNo, signedUsd, usd } from "@/lib/subContracts/shared";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function ContractSign({ token, view }: { token: string; view: ContractView }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ at: string; pdfHref: string | null } | null>(null);
  const [answer, setAnswer] = useState<Record<string, { name: string; reason: string; declining: boolean }>>({});
  const signed = view.signed ?? (done ? { name: name.trim(), at: done.at, ip: null } : null);
  const pdfHref = view.pdfHref ?? done?.pdfHref ?? null;

  async function sign() {
    setBusy("sign");
    setErr(null);
    try {
      if (name.trim().length < 2) throw new Error("Type your full name.");
      if (!agree) throw new Error("Tick the box to agree.");
      const r = await contractSign(token, { name: name.trim(), agree: true });
      if (!r.ok) throw new Error(r.error);
      setDone({ at: r.signedAt, pdfHref: r.pdfHref });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(changeId: string, agreed: boolean) {
    const a = answer[changeId] ?? { name: "", reason: "", declining: false };
    setBusy(changeId);
    setErr(null);
    try {
      const r = await contractChangeAnswer(token, agreed ? { changeId, agree: true, name: a.name.trim() } : { changeId, agree: false, reason: a.reason.trim() || null });
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  const open = view.changes.filter((c) => c.status === "PROPOSED");
  const answered = view.changes.filter((c) => c.status !== "PROPOSED" && c.status !== "VOID");

  return (
    <div className="by-card" data-contract-page data-contract-status={signed ? "EXECUTED" : view.status}>
      <div className="by-head">
        <p className="by-kicker">
          {view.company} · {view.project} · Subcontract {contractNo(view.number)}
        </p>
        <h1 className="by-title">{view.closed ? "This subcontract was withdrawn" : signed ? `Signed: ${view.title}` : `${view.sub}, your subcontract to sign`}</h1>
        <p className="by-sub">
          {view.closed
            ? `${view.company} withdrew it; there is nothing to sign.`
            : signed
              ? `${usd(view.total)} · signed by both parties. Your copy stays at this link.`
              : `${view.title} · ${usd(view.total)}. Read it to the end, then sign at the bottom — typing your name, with the box ticked, is your signature. No sign-in needed.`}
        </p>
      </div>

      {view.closed ? null : (
        <>
          <article className="sc-doc" data-contract-doc>
            {view.sections.map((sec) => (
              <section key={sec.key} className="sc-sec" data-contract-section={sec.key}>
                <h2 className="sc-h">{sec.heading}</h2>
                {sec.key === "scope" || sec.key === "payments" ? (
                  <ul className="sc-list">
                    {sec.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                ) : sec.key === "attachments" ? null : (
                  sec.lines.map((l, i) => (
                    <p key={i} className="sc-p">
                      {l}
                    </p>
                  ))
                )}
              </section>
            ))}
          </article>

          {view.attachments.length ? (
            <div className="qt-files" data-contract-files>
              <p className="by-lab">Attached to the agreement</p>
              <ul>
                {view.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={a.href} target="_blank" rel="noreferrer" data-contract-file>
                      {a.name}
                    </a>
                    <span>{a.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sc-sigs" data-contract-signatures>
            <div className="sc-sig">
              <p className="by-lab">For {view.company}</p>
              <p className="sc-name">{view.companySigned?.name ?? "—"}</p>
              <p className="sc-meta">{view.companySigned ? `Signed ${when(view.companySigned.at)}` : "Not signed"}</p>
            </div>
            <div className="sc-sig">
              <p className="by-lab">For {view.sub}</p>
              <p className="sc-name" data-contract-signed-name>
                {signed?.name ?? "—"}
              </p>
              <p className="sc-meta">{signed ? `Signed ${when(signed.at)}` : "Not signed yet"}</p>
            </div>
          </div>

          {signed ? (
            <>
              <p className="by-closed" data-contract-done>
                {done ? "Signed — thank you." : `Signed ${when(signed.at)}.`} {view.company} has your signature.{" "}
                {pdfHref ? (
                  <a href={pdfHref} data-contract-pdf>
                    Download the signed PDF
                  </a>
                ) : (
                  "The signed PDF is being made; it will be here when you open the link again."
                )}
              </p>
              {open.length ? (
                <div className="sc-changes" data-contract-changes>
                  <p className="by-lab">Change orders waiting for your answer</p>
                  {open.map((c) => {
                    const a = answer[c.id] ?? { name: "", reason: "", declining: false };
                    const set = (patch: Partial<typeof a>) => setAnswer((cur) => ({ ...cur, [c.id]: { ...a, ...patch } }));
                    return (
                      <div key={c.id} className="sc-change" data-contract-change data-contract-change-no={c.number}>
                        <p className="sc-change-head">
                          <b>{changeNo(c.number)}</b> · {signedUsd(c.amount)}
                        </p>
                        <p className="sc-p">{c.scope}</p>
                        {c.reason ? <p className="sc-meta">Why: {c.reason}</p> : null}
                        {a.declining ? (
                          <>
                            <label className="by-field">
                              <span className="by-lab">Why not (optional)</span>
                              <textarea value={a.reason} onChange={(e) => set({ reason: e.target.value })} rows={2} maxLength={500} data-contract-change-reason />
                            </label>
                            <button type="button" className="by-btn" disabled={busy !== null} onClick={() => void decide(c.id, false)} data-contract-change-decline-send>
                              {busy === c.id ? "Sending…" : "Decline the change"}
                            </button>
                            <p className="by-foot">
                              <button type="button" className="qt-pass" onClick={() => set({ declining: false })}>
                                Back
                              </button>
                            </p>
                          </>
                        ) : (
                          <>
                            <label className="by-field">
                              <span className="by-lab">Your full name</span>
                              <input value={a.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" placeholder="Type your name to agree" data-contract-change-name />
                            </label>
                            <p className="sc-meta">{AGREE_CHANGE_WORDS}</p>
                            <button type="button" className="by-btn" disabled={busy !== null} onClick={() => void decide(c.id, true)} data-contract-change-agree>
                              {busy === c.id ? "Sending…" : `Agree to ${changeNo(c.number)}`}
                            </button>
                            <p className="by-foot">
                              Not right?{" "}
                              <button type="button" className="qt-pass" onClick={() => set({ declining: true })} data-contract-change-decline>
                                Decline it
                              </button>
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {answered.length ? (
                <div className="qt-versions" data-contract-changes-done>
                  <p className="by-lab">Change orders</p>
                  <ul>
                    {answered.map((c) => (
                      <li key={c.id}>
                        <b>{changeNo(c.number)}</b> · {signedUsd(c.amount)} · {CHANGE_LABEL[changeStatusOf(c.status)]}
                        {c.decidedName ? ` by ${c.decidedName}` : ""}
                        <span className="qt-vnote">{c.scope}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {view.money ? <ContractMoney token={token} money={view.money} company={view.company} /> : null}
            </>
          ) : view.canSign ? (
            <div className="sc-signbox" data-contract-signbox>
              <label className="by-field">
                <span className="by-lab">Your full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Type your name to sign" data-contract-name />
              </label>
              <label className="sc-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-contract-agree />
                <span>{SIGN_WORDS}</span>
              </label>
              {err ? <p className="by-err">{err}</p> : null}
              <button type="button" className="by-btn" onClick={() => void sign()} disabled={busy !== null} data-contract-sign>
                {busy === "sign" ? "Signing…" : "Sign the subcontract"}
              </button>
              <p className="by-foot">
                The time, your address and your browser are kept with the signature.{view.companyPhone ? ` Questions before you sign: ${view.companyPhone}` : ""}
              </p>
            </div>
          ) : (
            <p className="by-closed">This subcontract is not ready to sign yet.</p>
          )}
          {err && signed ? <p className="by-err">{err}</p> : null}
        </>
      )}
    </div>
  );
}
