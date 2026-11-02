"use client";

// THE CRM BRIEF — the two sheets the CRM opens on: TODAY (the checks) and
// OFFICE (how the company is doing, and what is going on right now).
//
// One React component serves both editions: the desktop Blueprint CRM mounts
// each panel inside its own `.ppanel` section (the behavior module switches the
// tabs, React owns everything inside), and the phone CRM mounts them in its own
// tabs. Mobile-first CSS in ./crm-brief.module.css; every colour is a Blueprint
// token with a fallback, so the sheet reads the same under either shell.
//
// Ticks are optimistic: the row flips at once, the action confirms, a refusal
// flips it back and says why. The parent re-mounts the panel with
// `key={today.dayKey}` so a new day starts clean.

import { useCallback, useState } from "react";
import Link from "next/link";
import { setCrmCheck } from "@/actions/crmBrief";
import { GROUP_LABEL, money, moneyShort, type CheckGroup, type OfficeBrief, type Stat, type TodayBrief, type TodayCheck, type Tone } from "@/lib/crm/brief";
import { Who } from "@/components/v3/who/who";
import s from "./crm-brief.module.css";

type Route = Parameters<typeof Link>[0]["href"];

// ─────────────────────────────────────────────────────────────────────────────
// Small parts
// ─────────────────────────────────────────────────────────────────────────────

const ICON: Record<string, string> = {
  check: "M20 6 9 17l-5-5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  money: "M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 3 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3",
  flag: "M5 21V4h12l-2 4 2 4H5",
  cal: "M3 5h18v16H3zM3 10h18M8 2v6M16 2v6",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
};

function Ic({ id, className }: { id: keyof typeof ICON; className?: string }) {
  return (
    <svg className={className ?? s.ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[id]} />
    </svg>
  );
}

const GROUP_ICON: Record<CheckGroup, keyof typeof ICON> = { money: "money", sales: "flag", schedule: "cal", clients: "heart", team: "users" };
const TONE_CLS: Record<Tone, string> = { danger: s.tDanger, warn: s.tWarn, ok: s.tOk, info: s.tInfo };

function Ring({ done, total, clear }: { done: number; total: number; clear: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return (
    <div className={`${s.ring} ${clear ? s.ringClear : ""}`} role="img" aria-label={total ? `${done} of ${total} checked` : "Nothing to check"}>
      <svg viewBox="0 0 64 64" className={s.ringSvg}>
        <circle className={s.ringTrack} cx="32" cy="32" r={r} />
        <circle className={s.ringFill} cx="32" cy="32" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className={s.ringTxt}>
        {clear ? (
          <Ic id="check" className={s.ringCheck} />
        ) : (
          <>
            <b>{done}</b>
            <i>of {total}</i>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY
// ─────────────────────────────────────────────────────────────────────────────

export type GotoTab = "queue" | "workflows" | "customers";

export function TodayPanel({ today, onGoto }: { today: TodayBrief; onGoto?: (tab: GotoTab) => void }) {
  const [done, setDone] = useState<Set<string>>(() => new Set(today.checks.filter((c) => c.done).map((c) => c.key)));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const tick = useCallback(
    async (key: string, next: boolean) => {
      setBusy(key);
      setErr(null);
      setDone((prev) => {
        const n = new Set(prev);
        if (next) n.add(key);
        else n.delete(key);
        return n;
      });
      try {
        const res = await setCrmCheck({ key, done: next, dayKey: today.dayKey });
        if (!res.ok) {
          setErr(res.error);
          setDone((prev) => {
            const n = new Set(prev);
            if (next) n.delete(key);
            else n.add(key);
            return n;
          });
        } else {
          setDone(new Set(res.done));
        }
      } catch {
        setErr("Couldn't save that tick. Try again.");
        setDone((prev) => {
          const n = new Set(prev);
          if (next) n.delete(key);
          else n.add(key);
          return n;
        });
      } finally {
        setBusy(null);
      }
    },
    [today.dayKey],
  );

  const total = today.checks.length;
  const doneN = today.checks.filter((c) => done.has(c.key)).length;
  const clear = total > 0 && doneN === total;
  const urgent = today.checks.filter((c) => c.tone === "danger" && !done.has(c.key)).length;
  const line =
    total === 0
      ? today.line
      : clear
        ? `All ${total} checked. Desk is clear.`
        : urgent
          ? `${total - doneN} thing${total - doneN === 1 ? "" : "s"} to check · ${urgent} can't wait`
          : `${total - doneN} thing${total - doneN === 1 ? "" : "s"} to check · nothing on fire`;

  const groups = today.groups.map((g) => ({ ...g, done: today.checks.filter((c) => c.group === g.key && done.has(c.key)).length }));

  return (
    <div className={`${s.brief} ${s.today}`} data-crm-today data-day={today.dayKey} data-total={total} data-done={doneN}>
      <header className={`${s.head} ${clear ? s.headClear : ""}`}>
        <div className={s.headTxt}>
          <div className={s.kicker}>Today · what to check</div>
          <h2 className={s.h}>{today.heading}</h2>
          <p className={s.line} data-crm-line>
            {line}
          </p>
          {groups.length > 0 && (
            <nav className={s.rail} aria-label="Groups">
              {groups.map((g) => (
                <a key={g.key} href={`#crm-group-${g.key}`} className={`${s.railChip} ${g.done === g.count ? s.railDone : ""}`} data-crm-group-chip={g.key}>
                  <Ic id={GROUP_ICON[g.key]} className={s.icSm} />
                  {g.label}
                  <b>
                    {g.done}/{g.count}
                  </b>
                </a>
              ))}
            </nav>
          )}
        </div>
        <Ring done={doneN} total={total} clear={clear} />
      </header>

      {err && (
        <div className={s.err} role="alert">
          {err}
        </div>
      )}

      {total === 0 ? (
        <div className={s.quiet} data-crm-quiet>
          <Ic id="check" className={s.quietIc} />
          <b>Nothing waiting on you.</b>
          <span>No late payments, no unanswered leads, no crew to confirm. Go build something.</span>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} id={`crm-group-${g.key}`} className={s.group} data-crm-group={g.key}>
            <h3 className={s.groupH}>
              <Ic id={GROUP_ICON[g.key]} className={s.icSm} />
              {GROUP_LABEL[g.key]}
              <span className={s.groupN}>
                {g.done}/{g.count}
              </span>
            </h3>
            <ul className={s.cards}>
              {today.checks
                .filter((c) => c.group === g.key)
                .map((c, i) => (
                  <CheckCard key={c.key} check={c} i={i} done={done.has(c.key)} busy={busy === c.key} expanded={open.has(c.key)} onToggleOpen={() => setOpen((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} onTick={(v) => tick(c.key, v)} onGoto={onGoto} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CheckCard({ check: c, i, done, busy, expanded, onToggleOpen, onTick, onGoto }: { check: TodayCheck; i: number; done: boolean; busy: boolean; expanded: boolean; onToggleOpen: () => void; onTick: (v: boolean) => void; onGoto?: (tab: GotoTab) => void }) {
  const showItems = c.items.length > 0 && (!done || expanded);
  const cta =
    c.goto ? (
      // On the desktop sheet the behavior module owns the tabs and switches on
      // any `[data-goto]` click inside `.content`; the phone passes a callback.
      <button type="button" className={s.cta} data-goto={onGoto ? undefined : c.goto} onClick={onGoto ? () => onGoto(c.goto as GotoTab) : undefined} data-crm-cta>
        {c.cta}
        <Ic id="arrow" className={s.icSm} />
      </button>
    ) : c.href ? (
      <Link href={c.href as Route} className={s.cta} data-crm-cta>
        {c.cta}
        <Ic id="arrow" className={s.icSm} />
      </Link>
    ) : null;
  return (
    <li className={`${s.card} ${TONE_CLS[c.tone]} ${done ? s.cardDone : ""}`} style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }} data-crm-check={c.key} data-tone={c.tone} data-done={done ? "1" : "0"}>
      <div className={s.cardTop}>
        <button type="button" className={`${s.tick} ${done ? s.tickOn : ""}`} aria-pressed={done} disabled={busy} onClick={() => onTick(!done)} data-crm-tick title={done ? "Untick" : "Checked — tick it off"}>
          <Ic id="check" className={s.tickIc} />
        </button>
        <div className={s.cardTxt}>
          <div className={s.cardT}>{c.title}</div>
          {!done && <div className={s.cardWhy}>{c.why}</div>}
        </div>
        {c.amount != null && c.amount > 0 && <div className={s.amt}>{money(c.amount)}</div>}
      </div>
      {showItems && (
        <ul className={s.items}>
          {c.items.map((it, k) => {
            const inner = (
              <>
                <span className={s.itemL}>{it.label}</span>
                {it.sub && <span className={s.itemS}>{it.sub}</span>}
                {it.amount != null && <span className={s.itemA}>{money(it.amount)}</span>}
              </>
            );
            return (
              <li key={k} className={s.item}>
                {it.href ? (
                  <Link href={it.href as Route} className={s.itemLink}>
                    {inner}
                  </Link>
                ) : (
                  <span className={s.itemLink}>{inner}</span>
                )}
              </li>
            );
          })}
          {c.more > 0 && (
            <li className={`${s.item} ${s.itemMore}`}>
              {c.href ? (
                <Link href={c.href as Route} className={s.itemLink}>
                  <span className={s.itemL}>+{c.more} more</span>
                </Link>
              ) : (
                <span className={s.itemLink}>
                  <span className={s.itemL}>+{c.more} more</span>
                </span>
              )}
            </li>
          )}
        </ul>
      )}
      <div className={s.cardFoot}>
        {cta}
        {done && c.items.length > 0 && (
          <button type="button" className={s.ghost} onClick={onToggleOpen}>
            {expanded ? "Hide the rows" : `Show the ${c.count === 1 ? "row" : "rows"}`}
          </button>
        )}
        <span className={s.spacer} />
        <span className={s.toneWord}>{c.tone === "danger" ? "can't wait" : c.tone === "warn" ? "today" : c.tone === "ok" ? "good news" : "for the record"}</span>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICE
// ─────────────────────────────────────────────────────────────────────────────

function Delta({ d }: { d: Stat["delta"] }) {
  if (!d) return null;
  return <span className={`${s.delta} ${TONE_CLS[d.tone]}`}>{d.pct == null ? d.words : `${d.pct >= 0 ? "▲" : "▼"} ${d.words}`}</span>;
}

export function OfficePanel({ office, company }: { office: OfficeBrief; company?: string | null }) {
  const names = new Map(office.team.map((m) => [m.userId, { id: m.userId, name: m.name, role: m.role }]));
  const maxFunnel = Math.max(1, ...office.funnel.steps.map((x) => x.count));
  const maxCash = Math.max(1, ...office.cash.buckets.map((b) => b.amount));
  const maxDay = Math.max(1, ...office.week.days.map((d) => d.visits + d.jobs));
  const started = office.now.onSite.filter((j) => j.started).length;

  return (
    <div className={`${s.brief} ${s.office}`} data-crm-office>
      {/* RIGHT NOW */}
      <section className={s.now} data-crm-now>
        <div className={s.nowHead}>
          <span className={s.live}>
            <i />
            Right now
          </span>
          <h2 className={s.h}>{company ? `${company}, right now` : "Right now"}</h2>
          <p className={s.line} data-crm-now-line>
            {office.now.line}
          </p>
        </div>
        <div className={s.nowGrid}>
          <div className={s.nowCol}>
            <div className={s.colT}>
              On site <b>{started}</b>
            </div>
            {office.now.onSite.length === 0 ? (
              <div className={s.colEmpty}>No crews out today.</div>
            ) : (
              <ul className={s.nowList}>
                {office.now.onSite.map((j) => (
                  <li key={j.id} className={`${s.nowRow} ${j.started ? s.nowOn : ""}`}>
                    <Link href={j.href as Route} className={s.nowLink}>
                      <span className={s.dot} />
                      <span className={s.nowL}>
                        {j.title}
                        {j.client ? <em> · {j.client}</em> : null}
                      </span>
                      <span className={s.nowS}>{j.started ? `day ${j.day} open` : "not started"}{j.crew.length ? ` · ${j.crew.join(", ")}` : " · no crew"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={s.nowCol}>
            <div className={s.colT}>
              Visits today <b>{office.now.visits.length}</b>
            </div>
            {office.now.visits.length === 0 ? (
              <div className={s.colEmpty}>No visits today.</div>
            ) : (
              <ul className={s.nowList}>
                {office.now.visits.map((v) => (
                  <li key={v.id} className={`${s.nowRow} ${v.state === "now" ? s.nowOn : v.state === "done" ? s.nowDone : v.state === "next" ? s.nowNext : ""}`}>
                    <span className={s.nowLink}>
                      <span className={s.dot} />
                      <span className={s.nowL}>
                        {v.at} · {v.who ?? v.title}
                      </span>
                      <span className={s.nowS}>
                        {v.state === "now" ? "in progress" : v.state === "next" ? "next up" : v.state === "done" ? "done" : "later"}
                        {v.crew.length ? ` · ${v.crew.join(", ")}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={s.nowCol}>
            <div className={s.colT}>
              Money &amp; eyes
            </div>
            <div className={s.nowBig}>
              <b data-crm-paid-today>{money(office.now.paidToday.amount)}</b>
              <span>{office.now.paidToday.count ? `in today · ${office.now.paidToday.count} payment${office.now.paidToday.count === 1 ? "" : "s"}` : "nothing in yet today"}</span>
            </div>
            {office.now.reading.length > 0 ? (
              <ul className={s.nowList}>
                {office.now.reading.map((r) => (
                  <li key={r.proposalId} className={`${s.nowRow} ${s.nowOn}`}>
                    <Link href={r.href as Route} className={s.nowLink}>
                      <span className={s.dot} />
                      <span className={s.nowL}>{r.client ?? r.title}</span>
                      <span className={s.nowS}>reading the proposal · {r.when}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={s.colEmpty}>No proposal opened today yet.</div>
            )}
          </div>
        </div>
      </section>

      {/* HEALTH */}
      <section className={s.sec}>
        <h3 className={s.secH}>How the company is doing</h3>
        <div className={s.tiles} data-crm-health>
          {office.health.map((t, i) => (
            <div key={t.key} className={`${s.tile} ${t.tone ? TONE_CLS[t.tone] : ""}`} style={{ animationDelay: `${i * 45}ms` }} data-crm-stat={t.key}>
              <div className={s.tileL}>{t.label}</div>
              <div className={s.tileV}>{t.value}</div>
              <div className={s.tileS}>{t.sub}</div>
              <Delta d={t.delta} />
            </div>
          ))}
        </div>
      </section>

      <div className={s.two}>
        {/* FUNNEL */}
        <section className={s.sec}>
          <h3 className={s.secH}>
            Lead to paid <span className={s.secSub}>{office.funnel.label}</span>
          </h3>
          <ol className={s.funnel} data-crm-funnel>
            {office.funnel.steps.map((st) => (
              <li key={st.key} className={s.fstep} data-step={st.key}>
                <span className={s.fL}>{st.label}</span>
                <span className={s.fBarWrap}>
                  <span className={s.fBar} style={{ width: `${Math.max(4, (st.count / maxFunnel) * 100)}%` }} />
                </span>
                <span className={s.fN}>{st.count}</span>
                <span className={s.fV}>{st.value != null && st.value > 0 ? moneyShort(st.value) : ""}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* CASH AHEAD */}
        <section className={s.sec}>
          <h3 className={s.secH}>
            Cash ahead <span className={s.secSub}>{money(office.cash.total)} still owed</span>
          </h3>
          <div className={s.cash} data-crm-cash>
            {office.cash.buckets.map((b) => (
              <div key={b.key} className={`${s.cbar} ${b.amount > 0 ? TONE_CLS[b.tone] : s.cbarZero}`}>
                <span className={s.cAmt}>{b.amount > 0 ? moneyShort(b.amount) : ""}</span>
                <span className={s.cCol}>
                  <span className={s.cFill} style={{ height: `${b.amount > 0 ? Math.max(6, (b.amount / maxCash) * 100) : 2}%` }} />
                </span>
                <span className={s.cL}>{b.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className={s.two}>
        {/* WEEK */}
        <section className={s.sec}>
          <h3 className={s.secH}>
            The week <span className={s.secSub}>{office.week.booked} booked · {office.week.hours} h</span>
          </h3>
          <div className={s.week} data-crm-week>
            {office.week.days.map((d) => (
              <div key={d.key} className={`${s.day} ${d.today ? s.dayToday : ""}`}>
                <span className={s.dayL}>{d.label}</span>
                <span className={s.dayN}>{d.num}</span>
                <span className={s.dayBar}>
                  <span className={s.dayFill} style={{ height: `${Math.max(d.visits + d.jobs > 0 ? 10 : 0, ((d.visits + d.jobs) / maxDay) * 100)}%` }} />
                </span>
                <span className={s.dayC}>{d.visits + d.jobs > 0 ? `${d.visits + d.jobs}` : "·"}</span>
                <span className={s.dayS}>{d.visits + d.jobs > 0 ? `${d.visits}v ${d.jobs}j` : ""}</span>
              </div>
            ))}
          </div>
        </section>

        {/* TEAM */}
        <section className={s.sec}>
          <h3 className={s.secH}>
            The team <span className={s.secSub}>last 30 days</span>
          </h3>
          <table className={s.team} data-crm-team>
            <thead>
              <tr>
                <th>Who</th>
                <th className={s.num}>Sent</th>
                <th className={s.num}>Won</th>
                <th className={s.num}>Won $</th>
                <th className={s.num}>Leads</th>
              </tr>
            </thead>
            <tbody>
              {office.team.map((m) => (
                <tr key={m.userId}>
                  <td>
                    <Who who={{ id: m.userId, name: m.name, role: m.role }} compact />
                    {m.onSite && <span className={s.onSiteTag}>on site</span>}
                  </td>
                  <td className={s.num}>{m.sent}</td>
                  <td className={s.num}>{m.won}</td>
                  <td className={s.num}>{m.wonValue ? moneyShort(m.wonValue) : "—"}</td>
                  <td className={s.num}>{m.leads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className={s.three}>
        {/* CLIENTS */}
        <section className={s.sec}>
          <h3 className={s.secH}>Clients</h3>
          <div className={s.minis} data-crm-clients>
            <div className={s.mini}>
              <b>{office.clients.total}</b>
              <span>clients</span>
            </div>
            <div className={s.mini}>
              <b>{office.clients.newThisMonth}</b>
              <span>new this month</span>
            </div>
            <div className={s.mini}>
              <b>{office.clients.repeat}</b>
              <span>repeat</span>
            </div>
            <div className={`${s.mini} ${office.clients.quiet ? s.tWarn : ""}`}>
              <b>{office.clients.quiet}</b>
              <span>gone quiet</span>
            </div>
          </div>
          {office.clients.top.length > 0 && (
            <ul className={s.top}>
              {office.clients.top.map((c, i) => (
                <li key={c.id}>
                  <Link href={c.href as Route} className={s.topRow}>
                    <span className={s.topN}>{i + 1}</span>
                    <span className={s.topL}>{c.name}</span>
                    <span className={s.topV}>{moneyShort(c.ltv)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* REVIEWS */}
        <section className={s.sec}>
          <h3 className={s.secH}>Reviews</h3>
          <div className={s.stars} data-crm-reviews>
            <b>{office.reviews.avg == null ? "—" : office.reviews.avg.toFixed(1)}</b>
            <span className={s.starRow} aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <Ic key={n} id="star" className={`${s.star} ${office.reviews.avg != null && office.reviews.avg >= n - 0.25 ? s.starOn : ""}`} />
              ))}
            </span>
            <span className={s.starS}>{office.reviews.count ? `${office.reviews.count} review${office.reviews.count === 1 ? "" : "s"} in 90 days` : "no reviews in 90 days"}</span>
          </div>
          {office.reviews.latest.length > 0 && (
            <ul className={s.latest}>
              {office.reviews.latest.map((r, i) => (
                <li key={i}>
                  <span className={s.topL}>{r.client ?? "A client"}</span>
                  <span className={s.topV}>
                    {r.rating ?? "—"} ★ · {r.when}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* PULSE */}
        <section className={s.sec}>
          <h3 className={s.secH}>
            The last day <span className={s.secSub}>what happened</span>
          </h3>
          {office.pulse.length === 0 ? (
            <div className={s.colEmpty}>Quiet day so far.</div>
          ) : (
            <ul className={s.pulse} data-crm-pulse>
              {office.pulse.map((e) => (
                <li key={e.id} className={s.pulseRow}>
                  <span className={s.pulseT}>{e.summary}</span>
                  <span className={s.pulseM}>
                    {e.when}
                    <Who who={e.actorId ? (names.get(e.actorId) ?? { id: e.actorId, name: "Member", role: null }) : null} compact className={s.pulseWho} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
