// WHO OPENED THE INVESTOR LINK, AND WHAT THEY OFFERED (2026-10-13) — under the Investors page's head. The readers of
// the current link first (each email once: first seen, last seen, how many visits), then any earlier link's; the
// offers newest first, each one a mailto away. The lists live in lib/investorVisitors.
//
// WAITING FOR YOU (owner, 2026-10-20: "don't open the link till we approve it … we will review their info, who they
// are, and approve it"): the requests on the live link come first, oldest first, each with what can be told from the
// request itself (lib/investorGate reviewHints — the email's domain against the company, a free mailbox, whether they
// invest, a yes or no given to the same email before) and one-click look-ups, and Approve / Decline. Every reader row
// says where they stand, and a reader let in can be shut out again.
import type { InvestorOffer, InvestorVisitor } from "@/lib/investorVisitors";
import { INVESTING_KINDS, lookupLinks, offersOf, pendingOf, readersOf, reviewHints, statusOf } from "@/lib/investorGate";
import { ApprovalSwitch, ReaderDecision, ReviewFocus } from "./investor-review";
import s from "./investor-audience.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS_WORD = { pending: "Waiting", approved: "Let in", declined: "Declined" } as const;

export function InvestorAudience({ visitors: allVisitors, offers: allOffers, linkMadeAt, approveReaders = true, review }: { visitors: InvestorVisitor[]; offers: InvestorOffer[]; linkMadeAt: string | null; approveReaders?: boolean; review?: string }) {
  // The admins' own walk-throughs and test offers (2026-10-14) are not readers or offers.
  const visitors = readersOf(allVisitors);
  const offers = offersOf(allOffers);
  const tests = allVisitors.length - visitors.length + (allOffers.length - offers.length);
  const current = visitors.filter((v) => v.linkMadeAt === linkMadeAt);
  const earlier = visitors.filter((v) => v.linkMadeAt !== linkMadeAt);
  const waiting = pendingOf(current);
  const letIn = current.filter((v) => statusOf(v) === "approved").length;
  const investors = current.filter((v) => INVESTING_KINDS.has(v.kind)).length;
  return (
    <section className={s.panel} id="audience" aria-label="Who opened the link" data-investor-audience>
      <div className={s.head}>
        <h2 className={s.title}>Who opened the link</h2>
        <span className={s.sum}>
          {waiting.length ? <b className={s.sumWait}>{waiting.length} waiting · </b> : null}
          {letIn} let in · {investors} investor{investors === 1 ? "" : "s"} · {offers.length} offer{offers.length === 1 ? "" : "s"}
        </span>
      </div>
      <ApprovalSwitch on={approveReaders} waiting={waiting.length} />
      {waiting.length ? (
        <div className={s.requests} data-investor-requests>
          <h3 className={s.reqTitle}>Waiting for you</h3>
          {waiting.map((v) => {
            const same = earlier.filter((e) => e.email === v.email);
            const hints = reviewHints(v, { earlierApproved: same.filter((e) => statusOf(e) === "approved").length, earlierDeclined: same.filter((e) => statusOf(e) === "declined").length });
            return (
              <article key={v.id} className={s.request} data-request={v.id}>
                <div className={s.rTop}>
                  <b className={s.rName}>{v.name}</b>
                  <span className={s.rCo}>{v.company}</span>
                  <span className={INVESTING_KINDS.has(v.kind) ? s.chip : s.chipQuiet}>{v.kind}</span>
                  <span className={s.when}>asked {when(v.at)}</span>
                </div>
                <div className={s.rContact}>
                  <a href={`mailto:${v.email}`}>{v.email}</a>
                  {v.phone ? <> · <a href={`tel:${v.phone}`}>{v.phone}</a></> : null}
                  {v.visits > 1 ? ` · came back ${v.visits - 1}×` : ""}
                </div>
                <ul className={s.hints}>
                  {hints.map((h) => (
                    <li key={h.text} className={h.tone === "good" ? s.hGood : h.tone === "warn" ? s.hWarn : s.hInfo}>
                      {h.text}
                    </li>
                  ))}
                </ul>
                <div className={s.rActs}>
                  <ReaderDecision id={v.id} name={v.name} status="pending" />
                  <span className={s.look}>
                    Look them up:{" "}
                    {lookupLinks(v).map((l, i) => (
                      <span key={l.href}>
                        {i ? " · " : ""}
                        <a href={l.href} target="_blank" rel="noreferrer noopener">
                          {l.label}
                        </a>
                      </span>
                    ))}
                  </span>
                </div>
              </article>
            );
          })}
          <p className={s.hint}>Approve opens their page at once (if it is still open, it opens by itself) and emails them their link. Decline keeps the door shut, politely.</p>
        </div>
      ) : null}
      {review ? <ReviewFocus id={review} /> : null}
      <p className={s.hint}>The link asks each reader for their name, company and what they do{approveReaders ? "; nothing opens until you approve, and you get an email and a text (tick “Investor link requests” for your phone on Admin → Tasks → Team)" : " before the figures open; you get an email each time"}. &ldquo;We accept VC offers&rdquo; on their page sends the offers below — reply to the email, or from here.</p>
      {offers.length ? (
        <div className={s.offers} data-investor-offers>
          {offers.slice(0, 20).map((o) => (
            <article key={o.id} className={s.offer}>
              <div className={s.oTop}>
                <b>{o.company}</b>
                <span className={s.chip}>{o.type}</span>
                <span className={s.when}>{when(o.at)}</span>
              </div>
              <div className={s.oTerms}>
                {o.amount} · {o.instrument}
                {o.valuation ? ` · ${o.valuation}` : ""} · {o.timeline}
              </div>
              {o.message ? <p className={s.msg}>&ldquo;{o.message}&rdquo;</p> : null}
              <div className={s.oFrom}>
                {o.name} · <a href={`mailto:${o.email}?subject=${encodeURIComponent(`JobFlex — your ${o.type.toLowerCase()}`)}`}>{o.email}</a>
                {o.phone ? ` · ${o.phone}` : ""}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {current.length || earlier.length ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Reader</th>
                <th>What they do</th>
                <th>Contact</th>
                <th>Where they stand</th>
                <th>Last seen</th>
                <th className={s.num}>Visits</th>
              </tr>
            </thead>
            <tbody>
              {[...current, ...earlier].slice(0, 100).map((v) => {
                const st = statusOf(v);
                const live = v.linkMadeAt === linkMadeAt;
                return (
                  <tr key={v.id} className={live ? "" : s.old} data-reader={v.email} data-reader-status={st}>
                    <td>
                      <b>{v.name}</b>
                      <span className={s.co}>{v.company}</span>
                    </td>
                    <td>{INVESTING_KINDS.has(v.kind) ? <span className={s.inv}>{v.kind}</span> : v.kind}</td>
                    <td>
                      <a href={`mailto:${v.email}`}>{v.email}</a>
                      {v.phone ? <span className={s.co}>{v.phone}</span> : null}
                    </td>
                    <td>
                      <span className={st === "pending" ? s.stWait : st === "declined" ? s.stNo : s.stYes}>{STATUS_WORD[st]}</span>
                      <span className={s.co}>{v.decidedAt ? `${when(v.decidedAt)}${v.decidedBy ? ` · ${v.decidedBy}` : ""}` : `asked ${when(v.at)}`}</span>
                      {live && st !== "pending" ? <ReaderDecision id={v.id} name={v.name} status={st} /> : null}
                    </td>
                    <td>{when(v.lastSeen)}</td>
                    <td className={s.num}>{v.visits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {earlier.length ? <p className={s.hint}>Greyed rows read an earlier link — a new link asks everyone again.</p> : null}
        </div>
      ) : (
        <p className={s.empty}>Nobody has opened the link yet.</p>
      )}
      {tests ? <p className={s.hint} data-admin-tests>{tests === 1 ? "One entry of your own" : `${tests} entries of your own`} (an admin going through the door while signed in — let in without approval — or a test offer) left out.</p> : null}
    </section>
  );
}
