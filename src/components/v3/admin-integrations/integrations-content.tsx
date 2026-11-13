"use client";

// ADMIN INTEGRATIONS — /admin/integrations, blueprint.
//
// One row per external service: its name, the env keys that drive it, and its
// state. Two states are evidence and the rest are configuration, so the words
// differ and the legend says which is which once, at the top:
//
//   Live            — the service answered a request made for this render.
//                     Only Stripe and PostHog can reach this state; they are
//                     the only two with a live check in the codebase.
//   Configured      — every env key on the row is present. Nothing contacted.
//   Not configured  — at least one key is missing.
//
// Key NAMES are printed; key VALUES never leave the server. Nothing here reads
// a secret's contents, not even its length.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStripeModeAction } from "@/actions/admin";
import type { Route } from "next";
import type { IntegrationGroup, IntegrationStatus, LiveProbe } from "@/lib/sdk/integrations";
import type { PackRow } from "@/lib/eagleviewEntitlements";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import { Ic } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import { IntegrationLinks } from "./integration-links";
import i from "./integrations.module.css";

const HEALTH = "/admin/health" as Route;

export type LiveState = "ok" | "error" | "off";
export type LiveMap = Partial<Record<LiveProbe, LiveState>>;

const GROUPS: { key: IntegrationGroup; title: string }[] = [
  { key: "payments", title: "Payments" },
  { key: "messaging", title: "Email & SMS" },
  { key: "property", title: "Property data" },
  { key: "platform", title: "Platform" },
];

function state(it: IntegrationStatus, live: LiveMap): { cls: string; label: string } {
  const probe = it.probe ? live[it.probe] : undefined;
  if (probe === "ok") return { cls: "chip ok", label: "Live" };
  if (probe === "error") return { cls: `chip ${s.chipDanger}`, label: "Error" };
  return it.enabled
    ? { cls: `chip ${s.chipInk}`, label: "Configured" }
    : { cls: `chip ${s.chipMuted}`, label: "Not configured" };
}

function GroupCard({
  title,
  items,
  live,
}: {
  title: string;
  items: IntegrationStatus[];
  live: LiveMap;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">{title}</div>
        </div>
      </div>
      <hr className="card-rule" />
      {items.map((it) => {
        const chip = state(it, live);
        return (
          <div className={`${s.row} ${i.iRow}`} key={it.key}>
            <div className={s.rowMain}>
              <div className={s.rowTitle} title={it.name}>
                {it.name}
              </div>
            </div>
            <span className={chip.cls}>{chip.label}</span>
            <IntegrationLinks id={it.key} />
            {it.setupHref ? (
              <Link className="btn btn-ghost btn-sm" href={it.setupHref as Route}>
                Set up
              </Link>
            ) : null}
            <div className={i.keys}>
              {it.envKeys.map((k) => (
                <span className={s.envk} key={k}>
                  {k}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "2026-11-06 21:54 UTC" — the same on the server and in the browser. */
const utc = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

/** EagleView Property Data packs: what EagleView last said about each one.
 *  The account's entitlement table, read — a refused pack is asked again on
 *  the first paid order a day after its refusal; the imagery (008) only ever
 *  riding along with another pack (lib/eagleviewOrder). */
function EagleViewPacks({ rows }: { rows: PackRow[] | null }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">EagleView packs</div>
          <div className="card-sub">
            What EagleView last answered for each Property Data pack. A refused pack is asked
            again with the first paid order more than 24&nbsp;h after the refusal; nothing on
            this page orders anything.
          </div>
        </div>
      </div>
      <hr className="card-rule" />
      {!rows ? (
        <div className={i.packNote}>The entitlement table could not be read.</div>
      ) : (
        rows.map((r) => {
          const chip =
            r.status === "live"
              ? { cls: "chip ok", label: "Entitled" }
              : r.status === "denied"
                ? { cls: `chip ${s.chipDanger}`, label: "Refused" }
                : { cls: `chip ${s.chipMuted}`, label: "Not checked" };
          return (
            <div className={`${s.row} ${i.iRow}`} key={r.pack}>
              <div className={s.rowMain}>
                <div className={s.rowTitle} title={r.name}>
                  {r.name}
                </div>
                <div className={`${s.rowSub} ${i.packSub}`}>
                  {r.pack.slice(-3)}
                  {r.checkedAt ? ` · ${utc(r.checkedAt)}` : " · never asked"}
                  {r.refusal ? ` · ${r.refusal}` : ""}
                </div>
              </div>
              <span className={chip.cls}>{chip.label}</span>
              {r.unsettled ? <div className={i.packNote}>{r.unsettled}</div> : null}
            </div>
          );
        })
      )}
    </div>
  );
}

/** The live/sandbox payments switch. Its truth is a SyncState row read by the
 *  checkout routes per request (lib/stripeMode) — flipping it changes where
 *  the NEXT checkout session is created, no restart involved. Exported: the
 *  plans page mounts the same control, because "where do these plans charge"
 *  is a question asked while editing plans as much as while wiring keys. */
export function StripeModeSwitch({
  mode,
  modes,
}: {
  mode: "live" | "test";
  modes: { live: boolean; test: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const pick = (next: "live" | "test") => {
    if (next === mode || pending) return;
    setErr(null);
    start(async () => {
      try {
        await setStripeModeAction(next);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not switch.");
      }
    });
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Payments mode</div>
          <div className="card-sub">
            Which Stripe account checkout charges — the live account or the test sandbox.
            Test mode prices from the catalog directly and takes Stripe&apos;s test cards
            (4242&nbsp;4242&nbsp;4242&nbsp;4242).
          </div>
        </div>
      </div>
      <hr className="card-rule" />
      <div className={i.modeRow}>
        {(["live", "test"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={i.modeBtn + (mode === m ? " " + i.modeOn : "")}
            aria-pressed={mode === m}
            disabled={pending || !modes[m]}
            title={modes[m] ? undefined : "No key configured for this mode"}
            onClick={() => pick(m)}
          >
            {m === "live" ? "Live" : "Sandbox"}
            <i>{m === "live" ? "sk_live" : "sk_test"}</i>
          </button>
        ))}
        <span className={i.modeNote}>
          {pending ? "Switching…" : mode === "test" ? "Payments go to the SANDBOX." : "Payments are REAL."}
        </span>
      </div>
      {err ? (
        <div className={i.modeErr} role="alert">
          {err}
        </div>
      ) : null}
    </div>
  );
}

export function AdminIntegrationsContent({
  items,
  live,
  stripeMode,
  stripeModes,
  evPacks,
}: {
  items: IntegrationStatus[];
  live: LiveMap;
  stripeMode: "live" | "test";
  stripeModes: { live: boolean; test: boolean };
  evPacks: PackRow[] | null;
}) {
  useAdminMotion();

  const configured = items.filter((it) => it.enabled).length;
  const cards = GROUPS.map((g) => ({
    ...g,
    items: items.filter((it) => it.group === g.key),
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">
            Platform · {configured} of {items.length} configured
          </div>
          <h1 className="page-title">Integrations</h1>
        </div>
        <div className="page-actions">
          <Link className="btn btn-ghost" href={HEALTH}>
            <Ic id="i-check" />
            Health
          </Link>
        </div>
      </div>

      <div className={i.legend}>
        <span className="chip ok">Live</span>
        <em>answered</em>
        <span className={`chip ${s.chipInk}`}>Configured</span>
        <em>key present</em>
      </div>

      <StripeModeSwitch mode={stripeMode} modes={stripeModes} />

      <div className="grid-11">
        <GroupCard title={cards[0].title} items={cards[0].items} live={live} />
        <GroupCard title={cards[1].title} items={cards[1].items} live={live} />
      </div>

      <div className="grid-11">
        <GroupCard title={cards[2].title} items={cards[2].items} live={live} />
        <GroupCard title={cards[3].title} items={cards[3].items} live={live} />
      </div>

      <EagleViewPacks rows={evPacks} />
    </>
  );
}
