"use client";

// COMBINE INTO ONE PROPOSAL (owner, 2026-11-04: "make sure that all separated estimates, if there exist, they can be
// combined in one big proposal"). Under the project's proposals, on the desktop and the handheld page, once two or
// more are still open (draft, sent, viewed): pick them, name the new one, and actions/projectHub
// combineProjectProposals writes one draft with every line at the price it was quoted, archives the originals and
// the builder opens on it. Sold proposals are contracts and are never folded in.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { combineProjectProposals } from "@/actions/projectHub";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdProposal } from "@/components/v3/project-detail-blueprint/project-detail-data";
import s from "./project-hub.module.css";

const OPEN = new Set(["DRAFT", "SENT", "VIEWED"]);
const whole = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function ProjectCombine({ projectId, projectName, proposals }: { projectId: string; projectName: string; proposals: PdProposal[] }) {
  const router = useRouter();
  const open = proposals.filter((p) => OPEN.has(p.status));
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (open.length < 2) return null;

  const chosen = open.filter((p) => picked.has(p.id));
  const sentOnes = chosen.filter((p) => p.status !== "DRAFT");

  function start() {
    setPicked(new Set(open.map((p) => p.id)));
    setTitle(`${projectName} — full proposal`);
    setErr(null);
    setSheet(true);
  }

  async function combine() {
    if (chosen.length < 2) return setErr("Pick two or more proposals");
    if (!title.trim()) return setErr("Name the new proposal");
    setBusy(true);
    setErr(null);
    try {
      const { id } = await combineProjectProposals({ projectId, proposalIds: chosen.map((p) => p.id), title: title.trim() });
      router.push(`/dashboard/manual-blueprint?proposal=${id}` as Route);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not combine them");
      setBusy(false);
    }
  }

  return (
    <div className={s.w}>
      <div className={s.strip} data-project-combine>
        <span>
          <b>{open.length} open proposals</b> on this project ({whole(open.reduce((n, p) => n + p.total, 0))}). Send the client one
          proposal for all of it?
        </span>
        <button type="button" className={s.btnPrimary} onClick={start} data-project-combine-open>
          Combine into one proposal
        </button>
      </div>

      <BlueprintSheet
        open={sheet}
        onClose={() => !busy && setSheet(false)}
        title="Combine into one proposal"
        description="A new draft with every line at the price you quoted, each line named for the proposal it came from. The ones you combine are archived."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setSheet(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={combine} disabled={busy || chosen.length < 2} data-project-combine-save>
              {busy ? "Combining…" : `Combine ${chosen.length} · ${whole(chosen.reduce((n, p) => n + p.total, 0))}`}
            </button>
          </>
        }
      >
        <div className="bps-form">
          <label className="bps-fld bps-fld--wide">
            <span className="bps-lbl">New proposal</span>
            <input className="bps-in" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </label>
          <div className="bps-fld bps-fld--wide">
            <span className="bps-lbl">Combine</span>
            <div className="bps-plate">
              {open.map((p) => (
                <label key={p.id} className={`${s.check} ${s.pick}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={(e) =>
                      setPicked((cur) => {
                        const next = new Set(cur);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      })
                    }
                  />
                  <span className={s.pickName}>{p.title}</span>
                  <span className={s.pickMeta}>
                    {p.status.toLowerCase()} · {whole(p.total)}
                  </span>
                </label>
              ))}
            </div>
          </div>
          {sentOnes.length ? (
            <p className="bps-hint bps-fld--wide">
              {sentOnes.length === 1 ? `"${sentOnes[0].title}" was sent` : `${sentOnes.length} of them were sent`} to the client — once
              archived, send the new one in their place.
            </p>
          ) : null}
          {err ? <div className="bps-err bps-fld--wide">{err}</div> : null}
        </div>
      </BlueprintSheet>
    </div>
  );
}
