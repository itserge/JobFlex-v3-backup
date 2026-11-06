"use client";

// ON SITE, FOR THE OFFICE (the crew build, 2026-11-05). One card for the desktop and the handheld project page:
// the problems the crew flagged from site (resolved here, with a word on what was done), the crew's hours this
// week at the rate of the day (Labor on the project), and the subs' bills — paid, or still owed to them. Writes:
// actions/projectField (estimators and managers); everyone else reads the card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSubBill, resolveProblem, setSubBillPaid } from "@/actions/projectField";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdField } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { hoursWords } from "@/lib/crewField/shared";
import s from "./project-hub.module.css";

const exact = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ProjectFieldCard({ projectId, field, canManage }: { projectId: string; field: PdField; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [sub, setSub] = useState<{ vendor: string; amount: string; note: string; spentAt: string; paid: boolean } | null>(null);
  const [subErr, setSubErr] = useState<string | null>(null);

  const open = field.problems.filter((p) => p.status === "OPEN");
  const resolved = field.problems.filter((p) => p.status !== "OPEN");
  const owed = field.subs.filter((x) => !x.paidAt).reduce((n, x) => n + x.amount, 0);
  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSub() {
    if (!sub) return;
    if (!sub.vendor.trim()) return setSubErr("Who is the sub?");
    const amount = Number(sub.amount.replace(/[^\d.]/g, ""));
    if (!(amount > 0)) return setSubErr("How much?");
    const draft = sub;
    setSub(null);
    await run("sub", async () => {
      await addSubBill({ projectId, vendor: draft.vendor.trim(), amount, note: draft.note.trim() || null, spentAt: draft.spentAt || null, paid: draft.paid });
    });
  }

  const empty = !field.problems.length && !field.hoursWeek.length && !field.subs.length && !field.hoursAll.hours;

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="On site" data-project-field>
        <div className={s.head}>
          <h3 className={s.title}>On site</h3>
          <span className={s.headSub}>
            {open.length ? (
              <>
                <b>{open.length}</b> problem{open.length === 1 ? "" : "s"} open
              </>
            ) : field.hoursAll.hours ? (
              <>
                <b>{hoursWords(field.hoursAll.hours)}</b> logged{field.hoursAll.cost ? ` · ${exact(field.hoursAll.cost)} labor` : ""}
              </>
            ) : (
              "Problems from the crew, their hours, the subs' bills"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} onClick={() => { setSubErr(null); setSub({ vendor: "", amount: "", note: "", spentAt: todayISO(), paid: false }); }} data-sub-add>
                + Sub bill
              </button>
            </div>
          ) : null}
        </div>

        {open.length ? (
          <div className={s.stageList} data-problems>
            {open.map((p) => (
              <div key={p.id} className={s.row} data-problem data-problem-blocking={p.blocking ? "1" : "0"}>
                <span className={s.mark} aria-hidden="true" style={{ color: "#fff", borderColor: "var(--rose)", background: "var(--rose)" }}>
                  !
                </span>
                <span className={s.name} style={{ cursor: "default" }}>
                  {p.blocking ? "Work stopped — " : ""}
                  {p.note}
                </span>
                <div className={s.meta}>
                  <span>{p.jobTitle}</span>
                  <span>
                    {p.by ?? "crew"} · {p.when}
                  </span>
                </div>
                {canManage ? (
                  <div className={s.rowActs}>
                    <button
                      type="button"
                      className={s.btnSm}
                      disabled={busy !== null}
                      data-problem-resolve
                      onClick={() => {
                        const resolution = window.prompt("What was done about it?", "");
                        if (resolution == null) return;
                        void run(`resolve:${p.id}`, () => resolveProblem(p.id, resolution));
                      }}
                    >
                      Resolved
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {resolved.length ? (
          <p className={s.headSub} style={{ marginTop: 10 }}>
            <button type="button" className={s.lineBtn} onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide" : "Show"} {resolved.length} resolved
            </button>
            {showResolved ? resolved.map((p) => <span key={p.id} style={{ display: "block", marginTop: 4 }}>{p.jobTitle}: {p.note}{p.resolution ? ` — ${p.resolution}` : ""}</span>) : null}
          </p>
        ) : null}

        {field.hoursWeek.length ? (
          <div className={s.group} data-hours-week>
            <div className={s.groupHead}>
              <span>Hours this week</span>
              <span>· {day(`${field.week.from}T12:00:00Z`)} – {day(`${field.week.to}T12:00:00Z`)}</span>
            </div>
            {field.hoursWeek.map((w) => (
              <div key={w.workerId} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                <span className={s.lineName}>{w.name}</span>
                <span className={s.qty}>{hoursWords(w.hours)}</span>
                <span className={s.qty}>{w.cost ? exact(w.cost) : "no rate set"}</span>
              </div>
            ))}
          </div>
        ) : null}

        {field.subs.length ? (
          <div className={s.group} data-subs>
            <div className={s.groupHead}>
              <span>Subs</span>
              <span>· {owed > 0 ? `${exact(owed)} still owed` : "all paid"}</span>
            </div>
            {field.subs.map((x) => (
              <div key={x.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }} data-sub-bill>
                <span className={s.lineName}>
                  {x.vendor ?? "Sub"}
                  <span className={s.lineSub} style={{ display: "block" }}>
                    {[x.note, day(x.spentAt)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={s.qty}>{exact(x.amount)}</span>
                {canManage ? (
                  <button type="button" className={`${s.tag} ${x.paidAt ? s.tagIn : s.tagLate}`} style={{ cursor: "pointer", background: "none" }} disabled={busy !== null} onClick={() => void run(`paid:${x.id}`, () => setSubBillPaid(x.id, !x.paidAt))} data-sub-paid={x.paidAt ? "1" : "0"}>
                    {x.paidAt ? `paid ${day(x.paidAt)}` : "owed — mark paid"}
                  </button>
                ) : (
                  <span className={`${s.tag} ${x.paidAt ? s.tagIn : s.tagLate}`}>{x.paidAt ? "paid" : "owed"}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {empty ? <div className={s.empty}>Nothing from site yet. The crew&apos;s hours, the problems they flag and the subs&apos; bills land here.</div> : null}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      <BlueprintSheet
        open={sub !== null}
        onClose={() => setSub(null)}
        title="A sub's bill"
        description="Goes on the project as a Subcontractors cost. Mark it paid when you pay it."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setSub(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void saveSub()} data-sub-save>
              Add
            </button>
          </>
        }
      >
        {sub ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Sub</span>
              <input className="bps-in" value={sub.vendor} onChange={(e) => setSub({ ...sub, vendor: e.target.value })} placeholder="Lakeside Tile & Stone" autoFocus data-sub-vendor />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Amount ($)</span>
              <input className="bps-in" inputMode="decimal" value={sub.amount} onChange={(e) => setSub({ ...sub, amount: e.target.value })} placeholder="2,400" data-sub-amount />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Dated</span>
              <input className="bps-in" type="date" value={sub.spentAt} onChange={(e) => setSub({ ...sub, spentAt: e.target.value })} />
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">For</span>
              <input className="bps-in" value={sub.note} onChange={(e) => setSub({ ...sub, note: e.target.value })} placeholder="Tile, kitchen and bath" maxLength={500} />
            </label>
            <label className={`bps-fld bps-fld--wide ${s.check}`}>
              <input type="checkbox" checked={sub.paid} onChange={(e) => setSub({ ...sub, paid: e.target.checked })} />
              <span className="bps-lbl" style={{ margin: 0 }}>
                Paid already
              </span>
            </label>
            {subErr ? <div className="bps-err bps-fld--wide">{subErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
