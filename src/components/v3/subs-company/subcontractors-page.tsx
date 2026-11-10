"use client";
// THE COMPANY'S SUBCONTRACTORS (2026-11-08, the subcontractors plan, part 1): the directory across every project —
// search by name or company, filter by trade or by what needs attention (insurance expired or expiring, a license
// not active, no W-9), each sub's card with their history (requests, quotes, awards, paid) and the paper on file —
// and the Contractor sheet to add or edit. Every write is actions/projectSubs; the desk and the phone share it.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { DocViewer, type ViewerDoc } from "@/components/v3/docs/doc-viewer";
import type { DirectoryRow, DocRow } from "@/lib/projectSubs/server";
import { LICENSE_LABEL, W9_LABEL, contractorFlags, dollars, insuranceWords, licenseStatusOf, w9StatusOf } from "@/lib/projectSubs/shared";
import { docSize } from "@/lib/subDocs/shared";
import { ContractorSheet, draftOf, type ContractorDraft } from "@/components/v3/subs-section/contractor-sheet";
// Part 3 (2026-11-08): the state register's word on a sub, and the company's JobFlex Network listing.
import { saveCompanyNetwork, verifyContractorLicenseNow } from "@/actions/projectSubs";
import { LICENSE_KIND_LABEL, parseRegisterNote, type NetworkSettings } from "@/lib/subFinder/shared";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "@/components/v3/subs-section/subs.module.css";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function SubcontractorsPage({ today, rows: initial, canManage, network }: { today: string; rows: DirectoryRow[]; canManage: boolean; network: NetworkSettings }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(initial);
  const [net, setNet] = useState<NetworkSettings>(network);
  const [netDraft, setNetDraft] = useState<NetworkSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [editing, setEditing] = useState<ContractorDraft | null>(null);
  const [open, setOpen] = useState<DirectoryRow | null>(null);
  const [viewing, setViewing] = useState<ViewerDoc | null>(null);

  const trades = useMemo(() => [...new Set(rows.flatMap((r) => r.trades))].sort(), [rows]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return rows.filter((r) => (!words || `${r.name} ${r.company ?? ""} ${r.contactName ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`.toLowerCase().includes(words)) && (!trade || r.trades.includes(trade)) && (!onlyFlagged || r.flags.length > 0));
  }, [rows, q, trade, onlyFlagged]);

  const docOf = (d: DocRow): ViewerDoc => ({ id: d.id, name: d.name, href: `/api/subs/doc/${d.id}`, contentType: d.contentType, downloadHref: `/api/subs/doc/${d.id}?download=1`, meta: `${d.kind === "W9" ? "W-9" : "Insurance"} · ${longDay(d.createdAt)}${d.bytes ? ` · ${docSize(d.bytes)}` : ""}` });

  return (
    // `h.w` is the hub stylesheet's scope (`.w.w .x` rules): a wrapper, since `.w` sets display: block and the page is a grid.
    <div className={h.w}>
    <div className={s.page} data-subs-company>
      <header className={s.head}>
        <div>
          <p className={s.kicker}>Remodeling · Subcontractors</p>
          <h1 className={s.title}>Subcontractors</h1>
          <p className={s.sub}>
            {rows.length} on the list · {rows.filter((r) => r.flags.length).length} need attention
          </p>
        </div>
        <div className={s.acts}>
          <a className={h.btnSm} href="/dashboard/quotes" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Quotes &amp; Proposals
          </a>
          {canManage ? (
            <button type="button" className={h.btnSm} onClick={() => setNetDraft({ ...net, contact: { ...net.contact } })} data-subs-network-open>
              {net.on ? "On the JobFlex Network" : "JobFlex Network"}
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className={h.btnPrimary} onClick={() => setEditing(draftOf(null))} data-subs-add-contractor>
              + Contractor
            </button>
          ) : null}
        </div>
      </header>

      {note ? (
        <p className={h.note} role="status" data-subs-company-note>
          {note}
        </p>
      ) : null}

      <div className={s.filters} data-subs-filters>
        <input type="search" placeholder="Name, company, phone, email" value={q} onChange={(e) => setQ(e.target.value)} data-subs-search />
        <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade" data-subs-filter-trade>
          <option value="">Every trade</option>
          {trades.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className={h.check} style={{ margin: 0 }}>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} data-subs-filter-flagged />
          <span>Needs attention</span>
        </label>
      </div>

      {shown.length ? (
        <div className={s.table}>
          <div className={`${s.row} ${s.rowHead}`} style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) auto" }}>
            <span>Sub</span>
            <span>Reach</span>
            <span>Paper</span>
            <span>With you</span>
            <span />
          </div>
          {shown.map((r) => (
            <div key={r.id} className={s.row} style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,1fr) auto" }} data-subs-contractor data-subs-contractor-name={r.name}>
              <div className={s.name}>
                <button type="button" className={s.linkBtn} onClick={() => setOpen(r)} data-subs-open-profile>
                  {r.name}
                </button>
                {r.company ? <span className={s.muted}> · {r.company}</span> : null}
                <div className={s.mono}>{r.trades.join(" · ") || "no trade yet"}</div>
              </div>
              <div className={s.muted}>
                {r.phone ?? ""}
                {r.phone && r.email ? <br /> : null}
                {r.email ?? ""}
              </div>
              <div>
                {r.flags.map((f) => (
                  <span key={f.kind} className={`${s.pill} ${f.late ? s.pillLate : s.pillWait}`}>
                    {f.text}
                  </span>
                ))}
                {!r.flags.length ? <span className={`${s.pill} ${s.pillIn}`}>{insuranceWords(r.insuranceUntil, today)}</span> : null}
              </div>
              <div className={s.muted}>
                {r.asked} asked · {r.quoted} quoted · {r.awarded} awarded
                <br />
                {r.paidTotal ? `${dollars(r.paidTotal)} paid` : "nothing paid yet"}
                {r.lastAskedAt ? ` · last ${longDay(r.lastAskedAt)}` : ""}
              </div>
              <div className={h.stageActs}>
                {canManage ? (
                  <button type="button" className={h.btnSm} onClick={() => setEditing(draftOf(r))} data-subs-edit-contractor>
                    Edit
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.empty}>{rows.length ? "Nobody matches." : "No contractors yet — add the ones you work with, or add them from a project's request."}</p>
      )}

      <BlueprintSheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} description={open ? [open.company, open.trades.join(", "), open.address].filter(Boolean).join(" · ") : undefined}>
        {open ? (
          // The hub's scope again (the sheet is portalled to <body>, outside the page's wrapper) — a wrapper, never
          // on the sheet's box, whose flex column `.w`'s display: block would undo.
          <div className={h.w}>
          <div className={h.form} data-subs-profile>
            <div className={s.tiles}>
              <div className={s.tile}>
                <div className={s.tileLbl}>Asked</div>
                <div className={s.tileVal}>{open.asked}</div>
              </div>
              <div className={s.tile}>
                <div className={s.tileLbl}>Quoted</div>
                <div className={s.tileVal}>{open.quoted}</div>
              </div>
              <div className={s.tile}>
                <div className={s.tileLbl}>Awarded</div>
                <div className={s.tileVal}>{open.awarded}</div>
              </div>
              <div className={s.tile}>
                <div className={s.tileLbl}>Paid</div>
                <div className={s.tileVal}>{dollars(open.paidTotal)}</div>
              </div>
              <div className={s.tile} data-subs-profile-contracts>
                <div className={s.tileLbl}>Contracts</div>
                <div className={s.tileVal}>{open.contracts}</div>
                <div className={s.tileSub}>{open.contracts ? `${dollars(open.contractsTotal)} signed` : "none signed"}</div>
              </div>
            </div>
            <dl className={s.facts}>
              {open.contactName ? <Fact label="Contact" value={open.contactName} /> : null}
              {open.phone ? <Fact label="Phone" value={open.phone} /> : null}
              {open.email ? <Fact label="Email" value={open.email} /> : null}
              {open.website ? <Fact label="Website" value={open.website} /> : null}
              {open.serviceAreas ? <Fact label="Service area" value={open.serviceAreas} /> : null}
              <Fact label="License" value={`${open.license ?? "—"} · ${LICENSE_LABEL[licenseStatusOf(open.licenseStatus)]}`} />
              <Fact label="Insurance" value={`${insuranceWords(open.insuranceUntil, today)}${open.insuranceCarrier ? ` · ${open.insuranceCarrier}` : ""}${open.insurancePolicy ? ` · ${open.insurancePolicy}` : ""}`} />
              {open.bondAmount != null ? <Fact label="Bond" value={`${dollars(open.bondAmount)}${open.bondUntil ? ` to ${open.bondUntil}` : ""}`} /> : null}
              <Fact label="W-9" value={W9_LABEL[w9StatusOf(open.w9Status)]} />
              {open.notes ? <Fact label="Notes" value={open.notes} /> : null}
            </dl>
            {(() => {
              // Part 3: what the state register said about this sub, when it was last checked.
              const reg = parseRegisterNote(open.registerJson);
              return (
                <div className={h.field} data-subs-register>
                  <span className={h.lab}>The state register</span>
                  {reg ? (
                    <p style={{ margin: 0, fontSize: 13.5 }} data-subs-register-words>
                      <b>{LICENSE_KIND_LABEL[reg.kind]}</b> {reg.license}
                      {reg.specialties.length ? ` · ${reg.specialties.join(", ")}` : ""}
                      {reg.expires ? ` · ${reg.expires < today ? "expired" : "expires"} ${reg.expires}` : ""}
                      {reg.insurance?.cancelled ? ` · insurance cancelled ${reg.insurance.cancelled}` : reg.insurance?.expires ? ` · insured to ${reg.insurance.expires}${reg.insurance.carrier ? ` (${reg.insurance.carrier.trim()})` : ""}` : " · no insurance on record"}
                      {reg.bond?.amount ? ` · bond $${Math.round(reg.bond.amount).toLocaleString("en-US")}${reg.bond.impaired ? " (impaired)" : ""}` : ""}
                      {reg.principal ? ` · ${reg.principal}` : ""}
                      <span className={s.muted}> · checked {longDay(reg.checkedAt)}</span>
                    </p>
                  ) : (
                    <p className={s.muted} style={{ margin: 0, fontSize: 13 }}>
                      {open.registerCheckedAt ? `Not found in the register (checked ${longDay(open.registerCheckedAt)}).` : "Not checked yet."}
                    </p>
                  )}
                </div>
              );
            })()}
            <div className={h.field}>
              <span className={h.lab}>Paper on file</span>
              {open.documents.length ? (
                open.documents.map((d) => (
                  <div key={d.id} className={h.check}>
                    <span>
                      {d.kind === "W9" ? "W-9" : "Insurance"} · {d.name} ·{" "}
                      <button type="button" className={s.linkBtn} onClick={() => setViewing(docOf(d))} data-subs-open-doc>
                        open
                      </button>
                    </span>
                  </div>
                ))
              ) : (
                <p className={h.empty}>Nothing kept yet — Edit keeps a W-9 or a certificate.</p>
              )}
            </div>
            {canManage ? (
              <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                <button type="button" className="bps-btn bps-btn--primary" onClick={() => { setEditing(draftOf(open)); setOpen(null); }}>
                  Edit
                </button>
                <button
                  type="button"
                  className="bps-btn bps-btn--ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    void (async () => {
                      setBusy(`verify:${open.id}`);
                      try {
                        const r = await verifyContractorLicenseNow(open.id);
                        // The flags are the server's; recomputed here so a lapse shows on the row at once.
                        setRows((cur) => cur.map((x) => (x.id === r.row.id ? { ...x, ...r.row, flags: contractorFlags(r.row, today) } : x)));
                        setOpen((cur) => (cur && cur.id === r.row.id ? { ...cur, ...r.row } : cur));
                        setNote(r.words);
                        startTransition(() => router.refresh());
                      } catch (err) {
                        setNote(err instanceof Error ? err.message : "The register did not answer.");
                      } finally {
                        setBusy(null);
                      }
                    })()
                  }
                  data-subs-verify
                >
                  {busy === `verify:${open.id}` ? "Checking…" : "Check the register"}
                </button>
              </div>
            ) : null}
          </div>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* Part 3: the company's own listing on the JobFlex Network — found by other JobFlex companies as a sub. */}
      <BlueprintSheet open={netDraft !== null} onClose={() => setNetDraft(null)} title="JobFlex Network" description="Other JobFlex companies searching for a sub in your trades and area see your company — with the contact you give here, nothing else.">
        {netDraft ? (
          <div className={h.w}>
            <div className={h.form} data-subs-network-sheet>
              <label className={h.check}>
                <input type="checkbox" checked={netDraft.on} onChange={(e) => setNetDraft({ ...netDraft, on: e.target.checked })} data-subs-network-on /> List my company as a subcontractor
              </label>
              <div className={h.field}>
                <span className={h.lab}>The trades you take on</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                  {TRADE_TYPES.map((t) => (
                    <label key={t} className={h.check} style={{ fontSize: 13 }}>
                      <input type="checkbox" checked={netDraft.trades.includes(t)} onChange={(e) => setNetDraft({ ...netDraft, trades: e.target.checked ? [...netDraft.trades, t] : netDraft.trades.filter((x) => x !== t) })} data-subs-network-trade={t} /> {t}
                    </label>
                  ))}
                </div>
              </div>
              <label className={h.field}>
                <span className={h.lab}>Where you work</span>
                <input className={h.input} value={netDraft.serviceAreas} maxLength={300} onChange={(e) => setNetDraft({ ...netDraft, serviceAreas: e.target.value })} placeholder="Kirkland, Bellevue, Redmond — or King County, or Washington" data-subs-network-areas />
              </label>
              <div className={s.sheetGrid}>
                <label className={h.field}>
                  <span className={h.lab}>Contact name</span>
                  <input className={h.input} value={netDraft.contact.name} maxLength={120} onChange={(e) => setNetDraft({ ...netDraft, contact: { ...netDraft.contact, name: e.target.value } })} data-subs-network-contact />
                </label>
                <label className={h.field}>
                  <span className={h.lab}>Phone</span>
                  <input className={h.input} value={netDraft.contact.phone} maxLength={40} onChange={(e) => setNetDraft({ ...netDraft, contact: { ...netDraft.contact, phone: e.target.value } })} data-subs-network-phone />
                </label>
                <label className={h.field}>
                  <span className={h.lab}>Email</span>
                  <input className={h.input} value={netDraft.contact.email} maxLength={200} onChange={(e) => setNetDraft({ ...netDraft, contact: { ...netDraft.contact, email: e.target.value } })} data-subs-network-email />
                </label>
              </div>
              <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="bps-btn bps-btn--primary"
                  disabled={busy !== null}
                  onClick={() =>
                    void (async () => {
                      setBusy("network");
                      try {
                        const saved = await saveCompanyNetwork(netDraft);
                        setNet(saved);
                        setNetDraft(null);
                        setNote(saved.on ? `Listed on the JobFlex Network for ${saved.trades.join(", ") || "any trade"}.` : "Taken off the JobFlex Network.");
                        startTransition(() => router.refresh());
                      } catch (err) {
                        setNote(err instanceof Error ? err.message : "That didn't save.");
                      } finally {
                        setBusy(null);
                      }
                    })()
                  }
                  data-subs-network-save
                >
                  Save
                </button>
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setNetDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </BlueprintSheet>

      <ContractorSheet
        draft={editing}
        setDraft={(fn) => setEditing((cur) => fn(cur))}
        documents={editing?.id ? (rows.find((r) => r.id === editing.id)?.documents ?? []) : []}
        onSaved={(row) => {
          setRows((cur) => {
            const prev = cur.find((r) => r.id === row.id);
            const next: DirectoryRow = { ...row, flags: contractorFlags(row, today), asked: prev?.asked ?? 0, quoted: prev?.quoted ?? 0, awarded: prev?.awarded ?? 0, paidTotal: prev?.paidTotal ?? 0, lastAskedAt: prev?.lastAskedAt ?? null, documents: prev?.documents ?? [], contracts: prev?.contracts ?? 0, contractsTotal: prev?.contractsTotal ?? 0 };
            return (prev ? cur.map((r) => (r.id === row.id ? next : r)) : [...cur, next]).sort((a, b) => a.name.localeCompare(b.name));
          });
          setEditing(null);
          startTransition(() => router.refresh());
        }}
        onDocument={(doc) => setRows((cur) => cur.map((r) => (r.id === doc.contractorId ? { ...r, documents: [doc, ...r.documents] } : r)))}
        onClose={() => setEditing(null)}
      />
      <DocViewer doc={viewing} onClose={() => setViewing(null)} />
    </div>
    </div>
  );
}

// The section's own facts classes, not the hub's: the hub scopes its `.facts` family to its card (`.w.w`), and a
// BlueprintSheet is portalled to <body>, outside any card — there the hub's rules never apply and the labels read
// like values.
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.fact}>
      <dt className={s.factLbl}>{label}</dt>
      <dd className={s.factVal}>{value}</dd>
    </div>
  );
}
