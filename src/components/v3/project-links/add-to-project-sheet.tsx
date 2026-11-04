"use client";

// ADD TO PROJECT — the sheet behind "Add to project" on a client (owner,
// 2026-09-18: "give me the option to move the client to the project, and keep
// all his proposals under the same project").
//
// One component for every surface. Portalled to <body> and styled from the
// global tokens only, so it looks the same under the desktop shell (which
// zooms its own root) and the handheld shell (which does not carry the
// desktop module classes). A centred dialog on desktop, a bottom sheet at
// 768px and below.
//
// What it does, in the order a contractor thinks it:
//   1. Which project — a new one, named for the client and the street, or an
//      open one (this client's own first).
//   2. Which proposals go with the client — every proposal not already in a
//      project is ticked; one in ANOTHER project is shown and left unticked,
//      so nothing is pulled out of a project without a deliberate tick.
//   3. One button that says exactly what will happen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { toast } from "@/components/ui/Toast";
import { lockScroll } from "@/lib/scrollLock";
import { addClientToProject, clientProjectOptions, type ClientProjectOptions } from "@/actions/projectLinks";
import { ADD_TO_PROJECT_EVENT, type AddToProjectDetail } from "./open-add-to-project";
import s from "./add-to-project-sheet.module.css";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const statusWord = (st: string) => st.charAt(0) + st.slice(1).toLowerCase();

type Mode = "new" | "existing";
type Done = { projectId: string; projectName: string; moved: number };

export function AddToProjectSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ClientProjectOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setData(null);
    setLoadError(null);
    setError(null);
    setDone(null);
    setBusy(false);
  };

  const close = useCallback(() => {
    setOpen(false);
    if (done) router.refresh();
  }, [done, router]);

  // Opened by openAddToProject(clientId) from any page that mounts the sheet.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { clientId } = (e as CustomEvent<AddToProjectDetail>).detail ?? {};
      if (!clientId) return;
      reset();
      setOpen(true);
      clientProjectOptions(clientId)
        .then((d) => {
          if ("refused" in d) {
            setLoadError(d.refused);
            return;
          }
          setData(d);
          const own = d.projects.find((p) => p.forThisClient);
          setMode(own ? "existing" : "new");
          setProjectId(own?.id ?? d.projects[0]?.id ?? null);
          setName(d.suggestedName);
          setPicked(new Set(d.proposals.filter((p) => !p.projectId || p.projectId === own?.id).map((p) => p.id)));
        })
        .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Couldn't load this client."));
    };
    window.addEventListener(ADD_TO_PROJECT_EVENT, onOpen);
    return () => window.removeEventListener(ADD_TO_PROJECT_EVENT, onOpen);
  }, []);

  // The page behind stays put; Escape closes; focus lands inside.
  useEffect(() => {
    if (!open) return;
    const release = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => boxRef.current?.focus());
    return () => {
      release();
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (open && data && mode === "new") requestAnimationFrame(() => nameRef.current?.focus());
  }, [open, data, mode]);

  const target = mode === "existing" ? (data?.projects.find((p) => p.id === projectId) ?? null) : null;
  // A proposal already in the target project is "here" — shown ticked, not movable.
  const alreadyHere = useCallback((pid: string | null) => Boolean(target && pid === target.id), [target]);
  const moving = useMemo(
    () => (data ? data.proposals.filter((p) => picked.has(p.id) && !alreadyHere(p.projectId)) : []),
    [data, picked, alreadyHere],
  );
  const movingTotal = moving.reduce((n, p) => n + p.total, 0);
  const pulledFrom = moving.filter((p) => p.projectId && !alreadyHere(p.projectId));

  const canSubmit = !!data && !busy && (mode === "new" ? name.trim().length > 0 : !!target);

  async function submit() {
    if (!canSubmit || !data) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addClientToProject({
        clientId: data.client.id,
        ...(mode === "new" ? { newProject: { name: name.trim() } } : { projectId: target!.id }),
        proposalIds: moving.map((p) => p.id),
      });
      setDone(res);
      toast.success(
        mode === "new" ? "Project created" : "Added to project",
        `${data.client.name}${res.moved ? ` and ${res.moved} proposal${res.moved === 1 ? "" : "s"}` : ""} → ${res.projectName}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add to the project.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  const title = data ? `Add ${data.client.name} to a project` : "Add to a project";
  const cta =
    mode === "new"
      ? `Create project${moving.length ? ` with ${moving.length} proposal${moving.length === 1 ? "" : "s"}` : ""}`
      : `Add to project${moving.length ? ` with ${moving.length} proposal${moving.length === 1 ? "" : "s"}` : ""}`;

  return createPortal(
    <div className={s.wrap} role="presentation">
      <div className={s.bg} onClick={close} />
      <div className={s.box} role="dialog" aria-modal="true" aria-labelledby="atp-title" tabIndex={-1} ref={boxRef}>
        <div className={s.head}>
          <div>
            <div className={s.kicker}>Client → project</div>
            <h2 id="atp-title" className={s.title}>
              {done ? "Done" : title}
            </h2>
            {data && !done && data.client.address ? <div className={s.sub}>{data.client.address}</div> : null}
          </div>
          <button type="button" className={s.x} onClick={close} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={s.body}>
          {loadError ? (
            <div className={s.err} role="alert">
              {loadError}
            </div>
          ) : !data ? (
            <div className={s.loading}>Loading the client’s proposals and projects…</div>
          ) : done ? (
            <div className={s.done}>
              <div className={s.doneMark} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <p className={s.doneText}>
                <b>{data.client.name}</b> is in <b>{done.projectName}</b>
                {done.moved ? (
                  <>
                    {" "}
                    with {done.moved} proposal{done.moved === 1 ? "" : "s"}. Their change orders and jobs moved with them.
                  </>
                ) : (
                  "."
                )}{" "}
                New proposals made from the project are filed there too.
              </p>
            </div>
          ) : (
            <>
              {/* 1 — which project */}
              <div className={s.secL}>
                <span className={s.n}>1</span>Project
              </div>
              <div className={s.seg} role="radiogroup" aria-label="New or existing project">
                <button type="button" role="radio" aria-checked={mode === "new"} className={mode === "new" ? s.segOn : s.segBtn} onClick={() => setMode("new")}>
                  New project
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "existing"}
                  className={mode === "existing" ? s.segOn : s.segBtn}
                  onClick={() => setMode("existing")}
                  disabled={data.projects.length === 0}
                >
                  Existing project{data.projects.length ? ` · ${data.projects.length}` : ""}
                </button>
              </div>

              {mode === "new" ? (
                <label className={s.fld}>
                  <span className={s.lbl}>Project name</span>
                  <input
                    ref={nameRef}
                    className={s.in}
                    value={name}
                    maxLength={160}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                  />
                  <span className={s.hint}>Named for the client and the job’s street — change it to anything.</span>
                </label>
              ) : (
                <div className={s.list} role="radiogroup" aria-label="Projects">
                  {data.projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={projectId === p.id}
                      className={projectId === p.id ? `${s.opt} ${s.optOn}` : s.opt}
                      onClick={() => {
                        setProjectId(p.id);
                        // Proposals already in the newly picked project read as "here".
                        setPicked((cur) => {
                          const next = new Set(cur);
                          for (const pr of data.proposals) if (pr.projectId === p.id) next.add(pr.id);
                          return next;
                        });
                      }}
                    >
                      <span className={s.radio} aria-hidden="true" />
                      <span className={s.optMain}>
                        <span className={s.optName}>{p.name}</span>
                        <span className={s.optSub}>
                          {p.forThisClient ? "This client" : (p.clientName ?? "No client yet")} · {p.proposalCount} proposal
                          {p.proposalCount === 1 ? "" : "s"}
                          {p.status !== "ACTIVE" ? ` · ${statusWord(p.status.replace("_", " "))}` : ""}
                        </span>
                      </span>
                      {p.forThisClient ? <span className={s.tag}>Client’s</span> : null}
                    </button>
                  ))}
                </div>
              )}

              {/* 2 — which proposals go with the client */}
              <div className={s.secL}>
                <span className={s.n}>2</span>Proposals that move with {data.client.name}
                {data.proposals.length > 1 ? (
                  <button
                    type="button"
                    className={s.secAct}
                    onClick={() =>
                      setPicked((cur) =>
                        moving.length === data.proposals.filter((p) => !alreadyHere(p.projectId)).length
                          ? new Set(data.proposals.filter((p) => alreadyHere(p.projectId)).map((p) => p.id))
                          : new Set([...cur, ...data.proposals.map((p) => p.id)]),
                      )
                    }
                  >
                    {moving.length === data.proposals.filter((p) => !alreadyHere(p.projectId)).length ? "Untick all" : "Tick all"}
                  </button>
                ) : null}
              </div>
              {data.proposals.length === 0 ? (
                <div className={s.empty}>No proposals yet — the next one made from the project is filed there.</div>
              ) : (
                <ul className={s.props}>
                  {data.proposals.map((p) => {
                    const here = alreadyHere(p.projectId);
                    const on = here || picked.has(p.id);
                    return (
                      <li key={p.id}>
                        <label className={here ? `${s.prop} ${s.propHere}` : s.prop}>
                          <input
                            type="checkbox"
                            className={s.check}
                            checked={on}
                            disabled={here}
                            onChange={(e) =>
                              setPicked((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(p.id);
                                else next.delete(p.id);
                                return next;
                              })
                            }
                          />
                          <span className={s.propMain}>
                            <span className={s.propName}>{p.title}</span>
                            <span className={s.propSub}>
                              {statusWord(p.status)}
                              {here ? " · already in this project" : p.projectName ? ` · in ${p.projectName}` : ""}
                            </span>
                          </span>
                          <span className={s.propAmt}>{money(p.total)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pulledFrom.length ? (
                <div className={s.warn}>
                  {pulledFrom.length === 1 ? "One ticked proposal is" : `${pulledFrom.length} ticked proposals are`} in another project now and
                  will move out of it.
                </div>
              ) : null}
            </>
          )}
          {error ? (
            <div className={s.err} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className={s.foot}>
          {done ? (
            <>
              <button type="button" className={s.ghost} onClick={close}>
                Close
              </button>
              <button
                type="button"
                className={s.primary}
                onClick={() => {
                  setOpen(false);
                  router.push(`/dashboard/projects/${done.projectId}` as Route);
                }}
              >
                Open project
              </button>
            </>
          ) : (
            <>
              <span className={s.sum}>
                {data && moving.length ? (
                  <>
                    <b>{moving.length}</b> proposal{moving.length === 1 ? "" : "s"} · <b>{money(movingTotal)}</b>
                  </>
                ) : data ? (
                  "Only the client moves"
                ) : null}
              </span>
              <button type="button" className={s.primary} disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? "Saving…" : cta}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
