"use client";
// THE COMPANY PULSE (Smart CRM part 7, 2026-11-10) — the Office sheet's scorecard, on the desk and on the phone:
// six numbers against the period before, a few sentences worth a look, how fast new leads hear back (and who is
// still waiting), the win rate per salesperson, and the sources that brought the work.
//
// It sits inside OfficePanel's `.brief`, so it wears that sheet's classes and tokens; only what the sheet has no
// word for is in company-pulse.module.css. The numbers are asked for when the section first comes into view — the
// desk's Office panel is in the page but hidden until its tab is opened — and again when the period is switched.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { getCompanyPulse } from "@/actions/pulse";
import { money, moneyShort, type Tone } from "@/lib/crm/brief";
import { PERIOD_LABEL, PULSE_PERIODS, waitWords, type PulsePeriod, type SpeedBucketKey } from "@/lib/pulse/shared";
import type { PulseRead } from "@/lib/pulse/server";
import { Who } from "@/components/v3/who/who";
import b from "./crm-brief.module.css";
import p from "./company-pulse.module.css";

const TONE_CLS: Record<Tone, string> = { danger: b.tDanger, warn: b.tWarn, ok: b.tOk, info: b.tInfo };
const BUCKET_CLS: Record<SpeedBucketKey, string> = { "5m": p.kFast, "1h": p.kHour, day: p.kDay, later: p.kLater, waiting: p.kWaiting, untimed: p.kUntimed };

function Person({ userId, name, role }: { userId: string | null; name: string; role: string | null }) {
  return userId ? <Who who={{ id: userId, name, role }} compact /> : <span className={p.nobody}>{name}</span>;
}

export function CompanyPulse() {
  const root = useRef<HTMLElement>(null);
  const asked = useRef(0);
  const [data, setData] = useState<PulseRead | null>(null);
  const [period, setPeriod] = useState<PulsePeriod | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (next: PulsePeriod | null) => {
    const mine = ++asked.current;
    setBusy(true);
    setErr(null);
    if (next) setPeriod(next);
    const res = await getCompanyPulse(next ?? undefined).catch(() => ({ ok: false as const, error: "Couldn't count the numbers. Try again." }));
    // A slower answer to an older tap never lands on top of a newer one.
    if (mine !== asked.current) return;
    setBusy(false);
    if (!res.ok) {
      setPaused("paused" in res && res.paused === true);
      return setErr(res.error);
    }
    setData(res.pulse);
    setPeriod(res.pulse.period);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || asked.current) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => void load(null), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (asked.current || !entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void load(null);
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  // The Monday mail's button and the Operator's "open it" end in #pulse: bring the section up once its tab is showing
  // (on the desk the Office panel is hidden until the sheet's script opens it, a moment after this mounts).
  useEffect(() => {
    if (window.location.hash !== "#pulse") return;
    let tries = 0;
    const t = setInterval(() => {
      const el = root.current;
      if (el && el.offsetParent !== null) {
        clearInterval(t);
        el.scrollIntoView({ block: "start" });
      } else if (++tries > 15) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, []);

  const maxBucket = data ? Math.max(1, ...data.speed.buckets.map((x) => x.count)) : 1;

  return (
    <section className={`${b.sec} ${p.pulse}`} ref={root} id="pulse" data-company-pulse aria-busy={busy}>
      <div className={p.headRow}>
        <h3 className={b.secH}>
          Company pulse {data ? <span className={b.secSub}>{data.range}</span> : null}
        </h3>
        {/* On the Free plan there is nothing to switch between — only the way back to a plan. */}
        {paused ? null : (
          <div className={p.seg} role="group" aria-label="Period">
            {PULSE_PERIODS.map((k) => (
              <button key={k} type="button" className={`${p.segB} ${period === k ? p.segOn : ""}`} aria-pressed={period === k} disabled={busy && period === k} onClick={() => void load(k)} data-pulse-period={k}>
                {PERIOD_LABEL[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {err ? (
        <div className={b.err} role="alert">
          {err}{" "}
          {paused ? (
            <Link href={"/dashboard/subscription" as Route} className={b.ghost}>
              See plans
            </Link>
          ) : (
            <button type="button" className={b.ghost} onClick={() => void load(period)}>
              Try again
            </button>
          )}
        </div>
      ) : null}

      {!data && !err ? (
        <div className={p.wait} data-pulse-wait>
          Counting leads, replies and proposals…
        </div>
      ) : null}

      {data ? (
        <div className={`${p.body} ${busy ? p.dim : ""}`} data-pulse-body={data.period}>
          <div className={p.tiles} data-pulse-stats>
            {data.stats.map((t) => (
              <div key={t.key} className={`${b.tile} ${t.tone ? TONE_CLS[t.tone] : ""}`} data-pulse-stat={t.key}>
                <div className={b.tileL}>{t.label}</div>
                <div className={`${b.tileV} ${p.tileV}`}>{t.value}</div>
                <div className={b.tileS}>{t.sub}</div>
                {t.delta ? <span className={`${b.delta} ${TONE_CLS[t.delta.tone]}`}>{t.delta.words}</span> : null}
              </div>
            ))}
          </div>

          {data.quiet ? (
            <div className={p.quiet} data-pulse-quiet>
              Nothing came in, went out or was paid in {data.label.toLowerCase()}. Try a longer period.
            </div>
          ) : null}

          {data.notes.length > 0 && (
            <ul className={p.notes} data-pulse-notes aria-label="Worth a look">
              {data.notes.map((n) => (
                <li key={n.key} className={`${p.note} ${TONE_CLS[n.tone]}`} data-pulse-note={n.key}>
                  <span className={p.noteDot} aria-hidden="true" />
                  {n.href ? (
                    <Link href={n.href as Route} className={p.noteLink}>
                      {n.text}
                    </Link>
                  ) : (
                    <span>{n.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!data.quiet && (
            <>
              <div className={b.two}>
                {/* SPEED TO LEAD */}
                <section className={b.sec} data-pulse-speed>
                  <h3 className={b.secH}>
                    Speed to lead <span className={b.secSub}>{data.speed.medianMin === null ? "no reply on record" : `first reply in ${waitWords(data.speed.medianMin)} (the middle lead)`}</span>
                  </h3>
                  <ol className={p.buckets}>
                    {data.speed.buckets
                      .filter((x) => x.count > 0 || (x.key !== "untimed" && x.key !== "later"))
                      .map((x) => (
                        <li key={x.key} className={`${p.bucket} ${BUCKET_CLS[x.key]}`} data-pulse-bucket={x.key}>
                          <span className={p.bL}>{x.label}</span>
                          <span className={p.bWrap}>
                            <span className={p.bBar} style={{ width: x.count ? `${Math.max(4, (x.count / maxBucket) * 100)}%` : "0%" }} />
                          </span>
                          <span className={p.bN}>{x.count}</span>
                        </li>
                      ))}
                  </ol>
                  {data.speed.waiting.length > 0 && (
                    <div className={p.waiting} data-pulse-waiting>
                      <div className={p.waitingT}>Still waiting for a first reply</div>
                      <ul className={b.top}>
                        {data.speed.waiting.map((l) => (
                          <li key={l.id}>
                            <Link href={l.href as Route} className={b.topRow}>
                              <span className={b.topL}>
                                {l.name}
                                <em className={p.waitWho}> · {l.owner ?? "not assigned"}</em>
                              </span>
                              <span className={b.topV}>{l.since}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {data.speed.waitingMore > 0 && (
                        <Link href={"/dashboard/leads" as Route} className={p.more}>
                          and {data.speed.waitingMore} more in Leads
                        </Link>
                      )}
                    </div>
                  )}
                  {data.speed.people.length > 0 && (
                    <table className={b.team} data-pulse-speed-people>
                      <thead>
                        <tr>
                          <th>Whose leads</th>
                          <th className={b.num}>Leads</th>
                          <th className={b.num}>First reply</th>
                          <th className={b.num}>Waiting</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.speed.people.map((m) => (
                          <tr key={m.userId ?? "none"}>
                            <td>
                              <Person {...m} />
                            </td>
                            <td className={b.num}>{m.leads}</td>
                            <td className={b.num}>{m.medianMin === null ? "—" : waitWords(m.medianMin)}</td>
                            <td className={`${b.num} ${m.waiting ? p.bad : ""}`}>{m.waiting || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                {/* WIN RATE */}
                <section className={b.sec} data-pulse-wins>
                  <h3 className={b.secH}>
                    Win rate by salesperson <span className={b.secSub}>won ÷ decided in the period</span>
                  </h3>
                  {data.wins.rows.length === 0 ? (
                    <div className={b.colEmpty}>No proposal was sent or decided in {data.label.toLowerCase()}.</div>
                  ) : (
                    <table className={b.team} data-pulse-win-table>
                      <thead>
                        <tr>
                          <th>Who</th>
                          <th className={b.num}>Sent</th>
                          <th className={b.num}>Won</th>
                          <th className={b.num}>Rate</th>
                          <th className={b.num}>Won $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.wins.rows.map((r) => (
                          <tr key={r.userId ?? r.name} data-pulse-win-row={r.userId ?? "none"}>
                            <td>
                              <Person {...r} />
                            </td>
                            <td className={b.num}>{r.sent}</td>
                            <td className={b.num}>{r.won + r.lost ? `${r.won} of ${r.won + r.lost}` : "—"}</td>
                            <td className={b.num}>{r.rate === null ? "—" : `${r.rate}%`}</td>
                            <td className={b.num}>{r.wonValue ? moneyShort(r.wonValue) : "—"}</td>
                          </tr>
                        ))}
                        {data.wins.rows.length > 1 && (
                          <tr className={p.totalRow} data-pulse-win-row="company">
                            <td>Company</td>
                            <td className={b.num}>{data.wins.total.sent}</td>
                            <td className={b.num}>{data.wins.total.won + data.wins.total.lost ? `${data.wins.total.won} of ${data.wins.total.won + data.wins.total.lost}` : "—"}</td>
                            <td className={b.num}>{data.wins.total.rate === null ? "—" : `${data.wins.total.rate}%`}</td>
                            <td className={b.num}>{data.wins.total.wonValue ? moneyShort(data.wins.total.wonValue) : "—"}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              {/* SOURCES */}
              <section className={b.sec} data-pulse-sources>
                <h3 className={b.secH}>
                  Best lead sources <span className={b.secSub}>leads that came in during the period, and what they became</span>
                </h3>
                {data.sources.length === 0 ? (
                  <div className={b.colEmpty}>No lead came in during {data.label.toLowerCase()}.</div>
                ) : (
                  <table className={b.team}>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th className={b.num}>Leads</th>
                        <th className={b.num}>Won</th>
                        <th className={b.num}>Won $</th>
                        <th className={`${b.num} ${p.wide}`}>Collected</th>
                        <th className={`${b.num} ${p.wide}`}>Per won job</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.key} data-pulse-source={s.key}>
                          <td className={p.srcL}>{s.label}</td>
                          <td className={b.num}>{s.leads}</td>
                          <td className={b.num}>{s.won}</td>
                          <td className={b.num}>{s.wonValue ? moneyShort(s.wonValue) : "—"}</td>
                          <td className={`${b.num} ${p.wide}`}>{s.collected ? moneyShort(s.collected) : "—"}</td>
                          <td className={`${b.num} ${p.wide}`}>{s.costPerJob === null ? "—" : money(s.costPerJob)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <Link href={"/dashboard/pipeline?view=sources" as Route} className={p.more}>
                  {data.sourcesMore > 0 ? `${data.sourcesMore} more in the source report` : "Open the source report"}
                </Link>
              </section>
            </>
          )}

          <p className={p.fine}>
            First reply runs from the moment a lead comes in to the first call, text, email or booked visit on record; a Lead Center lead counts from the moment you accept it. A proposal is won on the day it is signed and lost on the day it is declined, cancelled or runs out.
            {data.capped ? " This is a very busy period: only the newest 5,000 leads and proposals were counted." : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}
