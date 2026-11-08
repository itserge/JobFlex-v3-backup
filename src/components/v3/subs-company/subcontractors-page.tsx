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
import { LICENSE_LABEL, W9_LABEL, dollars, insuranceWords, licenseStatusOf, w9StatusOf } from "@/lib/projectSubs/shared";
import { docSize } from "@/lib/subDocs/shared";
import { ContractorSheet, draftOf, type ContractorDraft } from "@/components/v3/subs-section/contractor-sheet";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "@/components/v3/subs-section/subs.module.css";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function SubcontractorsPage({ today, rows: initial, canManage }: { today: string; rows: DirectoryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(initial);
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
            <button type="button" className={h.btnPrimary} onClick={() => setEditing(draftOf(null))} data-subs-add-contractor>
              + Contractor
            </button>
          ) : null}
        </div>
      </header>

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
              </div>
            ) : null}
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
            const next: DirectoryRow = { ...row, flags: prev?.flags ?? [], asked: prev?.asked ?? 0, quoted: prev?.quoted ?? 0, awarded: prev?.awarded ?? 0, paidTotal: prev?.paidTotal ?? 0, lastAskedAt: prev?.lastAskedAt ?? null, documents: prev?.documents ?? [] };
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
