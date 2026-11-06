"use client";

// ADMIN · AI OPERATOR — /admin/assistant, blueprint.
//
// The capability registry (lib/assistant/registry) as a ledger: one row per tool with its card's label, how it runs,
// the permission it asks for, its version, its state, the week's runs and failures, the last error, and the switch.
// Above it the summary strip (live / off / missing a service / retired, the last hourly check, the deployment), the
// warnings the hourly check would send, and the services the registry leans on. Nothing here is synthesised: the
// states are the registry's, the counts are AssistantAction rows.
//
// Renders ONLY the shell's `.content` children, as a fragment, so the reveal cascade walks `.content > *`.

import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "@/components/ui/Toast";
import { runAssistantReadiness, setAssistantToolDisabled } from "@/actions/adminAssistant";
import type { OperatorReadiness, ToolHealth } from "@/lib/assistant/health";
import { Ic, shortDay } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import a from "./assistant.module.css";

const HEALTH = "/admin/health" as Route;

type Last = { at: string; totals: OperatorReadiness["totals"]; warnings: string[]; deployment: OperatorReadiness["deployment"] } | null;

const GROUP_WORDS: Record<ToolHealth["group"], string> = {
  lookups: "Look things up",
  people: "People",
  visits: "Visits",
  schedule: "The schedule",
  crew: "The crew",
  proposals: "Proposals",
  money: "Money",
  reminders: "Reminders",
  estimates: "Estimates",
  projects: "Projects",
};

function stamp(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function StateChip({ t }: { t: ToolHealth }) {
  switch (t.status) {
    case "live":
      return <span className="chip ok">Live</span>;
    case "off":
      return <span className={`chip ${s.chipDanger}`}>Off</span>;
    case "missing a service":
      return <span className="chip wait">No service</span>;
    default:
      return <span className={`chip ${s.chipMuted}`}>Retired</span>;
  }
}

export function AdminAssistantContent({ data, last }: { data: OperatorReadiness; last: Last }) {
  useAdminMotion();
  const [tools, setTools] = useState(data.tools);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const envOff = new Set((data.warnings.find((w) => w.startsWith("Switched off by the environment")) ?? "").replace(/^[^:]*:\s*/, "").replace(/\.$/, "").split(",").map((x) => x.trim()).filter(Boolean));

  const flip = (t: ToolHealth) => {
    const off = t.status !== "off";
    setBusy(t.id);
    startTransition(async () => {
      const r = await setAssistantToolDisabled(t.id, off);
      setBusy(null);
      if (!r.ok) {
        toast.error("Couldn't switch it", r.error);
        return;
      }
      const disabled = new Set(r.disabled);
      setTools((all) => all.map((x) => (x.deprecated ? x : { ...x, disabled: disabled.has(x.id), status: disabled.has(x.id) ? "off" : x.missing.length ? "missing a service" : "live" })));
      toast.success(off ? `${t.label} is off for everyone` : `${t.label} is back on`, off ? "Not chosen for new work from the next turn; what was planned still runs." : "The model sees it again from the next turn.");
    });
  };
  const runCheck = () => {
    startTransition(async () => {
      const r = await runAssistantReadiness();
      if (!r.ok) toast.error("The check didn't run", r.error);
      else toast.success("Readiness recorded", r.warnings ? `${r.warnings} warning${r.warnings === 1 ? "" : "s"} — see /admin/health` : "No warnings.");
    });
  };

  const live = tools.filter((t) => t.status === "live").length;
  const off = tools.filter((t) => t.status === "off").length;
  const missing = tools.filter((t) => t.status === "missing a service").length;
  const retired = tools.filter((t) => t.status === "deprecated").length;
  const groups = [...new Set(tools.map((t) => t.group))];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · {shortDay(data.generatedAt)}</div>
          <h1 className="page-title">AI Operator</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={runCheck} disabled={pending}>
            <Ic id="i-check" />
            Run the check
          </button>
          <Link className="btn btn-ghost" href={HEALTH}>
            <Ic id="i-link" />
            Health
          </Link>
        </div>
      </div>

      <div className="card">
        <div className={s.mix}>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Live</div>
            <div className={s.mixVal}>{live}</div>
          </div>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Switched off</div>
            <div className={`${s.mixVal} ${off ? a.bad : ""}`}>{off}</div>
          </div>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Missing a service</div>
            <div className={`${s.mixVal} ${missing ? a.warn : ""}`}>{missing}</div>
          </div>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Retired</div>
            <div className={s.mixVal}>{retired}</div>
          </div>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Last hourly check</div>
            <div className={s.mixVal}>{last ? stamp(last.at) : "not yet"}</div>
          </div>
          <div className={s.mixCell}>
            <div className={s.mixLbl}>Deployment</div>
            <div className={`${s.mixVal} ${s.mono}`}>{data.deployment.sha ?? "local"}{data.deployment.env ? ` · ${data.deployment.env}` : ""}</div>
          </div>
        </div>
        <p className={a.note}>
          Every row is a tool&apos;s own card (lib/assistant/tools): the registry, the prompt and the phone&apos;s labels are read from it, so a feature that ships is in use the moment it deploys. The build fails when a card is missing or its arguments can&apos;t be given to the model (qa/tests/logic/assistant-registry.check.ts).
        </p>
      </div>

      {data.warnings.length ? (
        <div className="card">
          <div className="card-head">
            <div className="card-titles">
              <div className="card-title">Warnings</div>
            </div>
            <div className={a.colHead}>What the hourly check sends to the error log</div>
          </div>
          <hr className="card-rule" />
          <ul className={a.warnings}>
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div className="card-titles">
            <div className="card-title">Services the registry leans on</div>
          </div>
          <div className={a.colHead}>Key present · not contacted</div>
        </div>
        <hr className="card-rule" />
        <div className={a.services}>
          {data.services.map((sv) => (
            <div key={sv.dep} className={a.service}>
              <span className={sv.on ? `chip ${s.chipInk}` : `chip ${s.chipMuted}`}>{sv.on ? "Configured" : "Not configured"}</span>
              <span className={a.serviceName}>{sv.label}</span>
              <span className={a.serviceNeed}>{sv.toolsNeeding ? `${sv.toolsNeeding} tool${sv.toolsNeeding === 1 ? "" : "s"} can't run without it` : "no tool depends on it"}</span>
            </div>
          ))}
        </div>
      </div>

      {groups.map((g) => (
        <div className="card" key={g}>
          <div className="card-head">
            <div className="card-titles">
              <div className="card-title">{GROUP_WORDS[g]}</div>
            </div>
            <div className={a.colHead}>Runs · failed, last 7 days</div>
          </div>
          <table className={`${s.tbl} ${s.tblBleed} ${a.tbl}`}>
            <thead>
              <tr>
                <th className={a.cTool}>Tool</th>
                <th>Runs as</th>
                <th>Needs</th>
                <th className={a.cNum}>v</th>
                <th>State</th>
                <th className={a.cNum}>7d</th>
                <th>Last</th>
                <th className={a.cSwitch}>Switch</th>
              </tr>
            </thead>
            <tbody>
              {tools
                .filter((t) => t.group === g)
                .map((t) => {
                  const lockedOff = Boolean(t.deprecated) || envOff.has(t.id);
                  return (
                    <tr key={t.id} className={t.status === "off" ? a.rowOff : ""}>
                      <td className={a.cTool}>
                        <div className={a.toolLabel}>{t.label}</div>
                        <div className={`${a.toolId} ${s.mono}`}>{t.id}</div>
                        {t.lastError ? (
                          <div className={a.lastError}>
                            {stamp(t.lastError.at)} · {t.lastError.text.slice(0, 140)}
                          </div>
                        ) : null}
                      </td>
                      <td className={a.cell}>{t.runs}</td>
                      <td className={`${a.cell} ${s.mono}`}>
                        {t.permission}
                        {t.deps.length ? <div className={a.deps}>{t.deps.map((d) => (t.missing.includes(d) ? `${d} ✕` : d)).join(" · ")}</div> : null}
                      </td>
                      <td className={`${a.cNum} ${s.mono}`}>{t.version}</td>
                      <td>
                        <StateChip t={t} />
                      </td>
                      <td className={`${a.cNum} ${s.mono}`}>
                        {t.done7d}
                        {t.failed7d ? <span className={a.bad}> · {t.failed7d} failed</span> : ""}
                      </td>
                      <td className={`${a.cell} ${s.mono}`}>{t.lastRunAt ? stamp(t.lastRunAt) : "—"}</td>
                      <td className={a.cSwitch}>
                        <button type="button" className={`btn btn-ghost ${a.switch}`} disabled={pending || busy === t.id || lockedOff} onClick={() => flip(t)} title={lockedOff ? (t.deprecated ? "Retired — stays off" : "Switched off by the environment") : t.status === "off" ? "Turn it back on" : "Switch it off for everyone"}>
                          {t.status === "off" ? "Turn on" : "Switch off"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
