// One project inside the home portal (2026-10-30) — /home/[key]/project/[token].
// Reached through the home's key, so it can carry what only the home may do
// (photos into the job folder, a note to the contractor); the request's own
// page (/request/[token]) stays as the emails' link and never learns the key.
//
// Phone: one column in the order a homeowner needs it — where it stands and
// the next step, the contractor, a change to approve, the quote, the next
// visit, photos, a note, what they asked for, the history. Desk: the work on the left, the people and the record on
// the right.
import Link from "next/link";
import type { HomeDashboard } from "@/lib/home/portal";
import type { PortalProposal, RequestPortalView } from "@/lib/requestPortal";
import { publicReviewsPath } from "@/lib/reviews/publicSummary";
import { LocalTime } from "@/components/portal/live-time";
import { Icon, PortalFrame, StatusTrack } from "./portal-frame";
import { FolderBox } from "./folder-box";
import { MessageBox } from "./message-box";
import { RerouteSheet } from "./reroute-sheet";
import { QUOTE_STAGE, STEPS, homeHref, houseLine, isOpenQuote, isWonQuote, nextStep, plainEvent, projectTitle, quoteHref, quotePdfHref, stageOf, usd, usdCents } from "./view";
import s from "./portal.module.css";

const pct = (fraction: number) => `${Math.round(fraction * 100 * 100) / 100}%`;
const signed = (n: number) => (n < 0 ? `−${usdCents.format(-n)}` : `+${usdCents.format(n)}`);

export function ProjectPage({ h, p }: { h: HomeDashboard; p: RequestPortalView }) {
  const stage = stageOf(p);
  const next = nextStep(p, h);
  const cur = p.current;
  const current = p.proposals.filter((q) => q.current);
  const earlier = p.proposals.filter((q) => !q.current);
  const won = current.find(isWonQuote) ?? null;
  const folder = h.folders[p.token] ?? { files: [], requests: [] };
  const messages = h.messages[p.token] ?? [];
  const contractor = h.contractors.find((c) => c.org.id === cur?.org.id) ?? null;

  const status = (
    <section className={s.card} aria-labelledby="status-title" style={{ order: 1 }}>
      <div className={s.stack}>
        <p className={s.kicker}>
          {p.place ? `${p.place} · ` : ""}Sent <LocalTime iso={p.submittedAt} kind="date" tz={h.timeZone} />
        </p>
        <h1 id="status-title" className={s.h1}>{projectTitle(p)}</h1>
      </div>
      <StatusTrack stage={stage} label={`Progress: ${STEPS[stage]}`} />
      <p className={s.next} data-tone={next.tone}>
        <b>What happens next</b>
        <span>
          {next.visit && (
            <>
              <LocalTime iso={next.visit.startsAt} kind="day" tz={next.visit.timeZone} />, <LocalTime iso={next.visit.startsAt} kind="time" tz={next.visit.timeZone} /> ·{" "}
            </>
          )}
          {next.text}
        </span>
      </p>
      {next.action && (
        <div className={s.projectFoot}>
          <a className={next.action.primary ? s.btnPrimary : s.btn} href={next.action.href}>{next.action.label}</a>
        </div>
      )}
    </section>
  );

  const changes = cur && p.changeOrders.length > 0 && (
    <section className={`${s.card} ${s.attention}`} aria-labelledby="co-title" style={{ order: 3 }}>
      <h2 id="co-title" className={s.h2}>{p.changeOrders.length === 1 ? "A change needs your OK" : "Changes need your OK"}</h2>
      <div className={s.rows}>
        {p.changeOrders.map((c) => (
          <div key={c.token} className={s.row}>
            <div className={s.rowHead}>
              <p className={s.h3}>{c.number ? `Change #${c.number} · ` : ""}{c.title}</p>
              {c.total != null && <span className={s.num} style={{ fontWeight: 700 }}>{signed(c.total)}</span>}
            </div>
            {c.proposalTitle && <p className={s.muted}>On “{c.proposalTitle}”</p>}
            <div className={s.actions}><a className={s.btnPrimary} href={`/co/${encodeURIComponent(c.token)}`}>Review and approve</a></div>
          </div>
        ))}
      </div>
    </section>
  );

  const quotes = (
    <section className={s.card} aria-labelledby="quote-title" style={{ order: 4 }} id="quote">
      <h2 id="quote-title" className={s.h2}>{p.proposals.length > 1 ? "Quotes" : "Quote"}</h2>
      {current.length === 0 && (
        <div className={s.empty}>
          <p className={s.text}>
            {cur ? `No quote yet. When ${cur.org.name} sends one, it comes to your email and shows up here.` : "No quote yet. Once a contractor takes your project, their quote shows up here."}
          </p>
        </div>
      )}
      {current.map((q, i) => (
        <div key={q.publicId} className={s.stack} style={{ gap: 14 }}>
          {i > 0 && <div className={s.rule} />}
          <QuoteBlock q={q} tz={h.timeZone} />
        </div>
      ))}
      {earlier.length > 0 && (
        <details className={s.more}>
          <summary>From your earlier {new Set(earlier.map((q) => q.orgId)).size === 1 ? "contractor" : "contractors"} ({earlier.length})</summary>
          <div className={s.stack} style={{ gap: 14 }}>
            {earlier.map((q) => <QuoteBlock key={q.publicId} q={q} tz={h.timeZone} />)}
          </div>
        </details>
      )}
    </section>
  );

  const pro = (
    <section className={s.card} aria-labelledby="pro-title" style={{ order: 2 }} id="contractor">
      <div className={s.cardHead}>
        <h2 id="pro-title" className={s.h2}>Contractor</h2>
        {cur?.matchedAt && <span className={s.muted}>Since <LocalTime iso={cur.matchedAt} kind="date" tz={h.timeZone} /></span>}
      </div>
      {cur ? (
        <>
          <div className={s.stack}>
            <p className={s.h3} style={{ fontSize: 17 }}>{cur.org.name}</p>
            <div className={s.meta}>
              {cur.org.phoneDisplay && <span className={s.num}>{cur.org.phoneDisplay}</span>}
              {cur.org.place && <span>{cur.org.place}</span>}
              {cur.org.rating && (
                <a className={s.link} href={publicReviewsPath(cur.org.slug)} target="_blank" rel="noopener noreferrer">
                  ★ {cur.org.rating.avg.toFixed(1)} · {cur.org.rating.count} review{cur.org.rating.count === 1 ? "" : "s"}
                </a>
              )}
            </div>
          </div>
          {(cur.org.telHref || cur.org.email) ? (
            <div className={s.contact} data-contact>
              {cur.org.telHref && <a className={s.btn} href={cur.org.telHref}><Icon id="phone" small />Call</a>}
              {cur.org.smsHref && <a className={s.btn} href={cur.org.smsHref}><Icon id="sms" small />Text</a>}
              {cur.org.email && <a className={s.btn} href={`mailto:${cur.org.email}`}><Icon id="msg" small />Email</a>}
            </div>
          ) : (
            <p className={s.text}>They have your contact details and will reach out.</p>
          )}
          {contractor?.bookingHref && <a className={s.btnText} href={contractor.bookingHref}>Book a visit online</a>}
          <div className={s.rule} />
          <div className={s.stack} style={{ gap: 8 }}>
            <p className={s.muted}>Not the right fit? You can ask for someone else at any time.</p>
            <div><RerouteSheet token={p.token} orgName={cur.org.name} accepted={!!won} /></div>
          </div>
        </>
      ) : (
        <p className={s.text}>
          {p.previous.length ? `We're finding you a different contractor than ${p.previous[p.previous.length - 1].org.name}.` : "We're finding a local contractor for this project."} You&apos;ll get an email the moment one takes it.
        </p>
      )}
    </section>
  );

  const visits = p.visits.length > 0 && (
    <section className={s.card} aria-labelledby="visit-title" style={{ order: 5 }}>
      <h2 id="visit-title" className={s.h2}>Coming up</h2>
      <ul className={s.events}>
        {p.visits.map((v) => (
          <li key={v.startsAt} className={s.event}>
            <span className={s.eventDate}><b><LocalTime iso={v.startsAt} kind="day" tz={v.timeZone} /></b></span>
            <span className={s.eventBody}>
              <span>{v.title}</span>
              <span className={s.muted}><LocalTime iso={v.startsAt} kind="time" tz={v.timeZone} />–<LocalTime iso={v.endsAt} kind="time" tz={v.timeZone} /> · {v.orgName}</span>
            </span>
          </li>
        ))}
      </ul>
      <a className={s.btnText} href={`${homeHref(h.key)}/calendar.ics`}><Icon id="cal" small />Add to phone calendar</a>
    </section>
  );

  const files = (
    <section className={s.card} aria-labelledby="files-title" style={{ order: 6 }} id="files">
      <div className={s.cardHead}>
        <h2 id="files-title" className={s.h2}>Photos & files</h2>
        <span className={s.muted}>{folder.files.length ? `${folder.files.length} ${folder.files.length === 1 ? "file" : "files"}` : ""}</span>
      </div>
      <FolderBox homeKey={h.key} token={p.token} orgName={cur?.org.name ?? null} files={folder.files} requests={folder.requests} storage={h.storage} timeZone={h.timeZone} />
    </section>
  );

  const message = cur && (
    <section className={s.card} aria-labelledby="message-title" style={{ order: 7 }} id="message">
      <h2 id="message-title" className={s.h2}>Note to {cur.org.name}</h2>
      <MessageBox homeKey={h.key} token={p.token} orgName={cur.org.name} sent={messages} timeZone={h.timeZone} />
    </section>
  );

  const about = (
    <section className={s.card} aria-labelledby="about-title" style={{ order: 8 }}>
      <h2 id="about-title" className={s.h2}>What you asked for</h2>
      {p.estimate && (
        <div className={s.pay} data-request-range>
          <p><b className={s.num}>Your range: {p.estimate.range}</b> · {p.estimate.material} · {p.estimate.basis}</p>
          <p className={s.muted}>{p.estimate.words}</p>
        </div>
      )}
      {p.scope ? <p className={s.text} style={{ whiteSpace: "pre-wrap" }}>{p.scope}</p> : <p className={s.muted}>No description.</p>}
      {(p.trade || p.place) && (
        <dl className={s.facts}>
          {p.trade && <div><dt>Type of work</dt><dd>{p.trade}</dd></div>}
          {p.place && <div><dt>Where</dt><dd>{p.place}</dd></div>}
        </dl>
      )}
    </section>
  );

  const history = p.events.length > 0 && (
    <section className={s.card} aria-labelledby="history-title" style={{ order: 9 }}>
      <h2 id="history-title" className={s.h2}>History</h2>
      <ol className={`${s.events} ${s.history}`}>
        {[...p.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`} className={s.event}>
            <span className={s.eventBody}>
              <span>{plainEvent(e.text)}</span>
              <span className={s.muted}><LocalTime iso={e.at} tz={h.timeZone} />{e.note ? ` · ${plainEvent(e.note)}` : ""}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <PortalFrame homeKey={h.key} house={houseLine(h)} tab="projects" email={h.email}>
      <Link className={s.btnText} href={homeHref(h.key)} style={{ justifySelf: "start", marginTop: -8 }}>← All projects</Link>
      {/* Phone: one column in the order a homeowner needs it (status, contractor, quote, photos…); desk: two. */}
      <div className={`${s.cols} ${s.colsFlow}`}>
        <div className={s.col}>
          {status}
          {changes}
          {quotes}
          {files}
          {message}
        </div>
        <div className={s.col}>
          {pro}
          {visits}
          {about}
          {history}
        </div>
      </div>
    </PortalFrame>
  );
}

/** One quote: what it is, its total, its lines, and the one way in — the quote page, where it is approved and paid. */
function QuoteBlock({ q, tz }: { q: PortalProposal; tz: string }) {
  const st = QUOTE_STAGE[q.stage];
  const open = isOpenQuote(q);
  const contract = Math.round((q.total + q.approvedChanges) * 100) / 100;
  return (
    <article className={s.quote} aria-label={`Quote: ${q.title}`} data-quote-stage={q.stage}>
      <div className={s.rowHead}>
        <div className={s.stack} style={{ gap: 2 }}>
          <p className={s.h3}>{q.title}</p>
          <p className={s.muted}>{q.orgName}{q.sentAt ? <> · sent <LocalTime iso={q.sentAt} kind="date" tz={tz} /></> : null}</p>
        </div>
        <span className={s.stamp} data-tone={st.tone}>{st.label}</span>
      </div>
      <div className={s.quoteTotal}>
        <strong>{usdCents.format(contract)}</strong>
        {q.approvedChanges !== 0 && <span className={s.muted}>with approved changes</span>}
        {open && q.validUntil && <span className={s.muted}>price held until <LocalTime iso={q.validUntil} kind="date" tz={tz} /></span>}
      </div>
      <details className={s.more}>
        <summary>What&apos;s in it</summary>
        <table className={s.lines}>
          <tbody>
            {q.lines.map((li, i) => (
              <tr key={i}><th scope="row">{li.name}</th><td>{usdCents.format(li.total)}</td></tr>
            ))}
            {q.more && <tr className={s.quiet}><th scope="row">{q.more.count} more item{q.more.count === 1 ? "" : "s"}</th><td>{usdCents.format(q.more.total)}</td></tr>}
            {q.taxTotal > 0 && <tr className={s.quiet}><th scope="row">Tax ({pct(q.taxRate)})</th><td>{usdCents.format(q.taxTotal)}</td></tr>}
          </tbody>
          <tfoot>
            <tr className={q.approvedChanges ? undefined : s.grand}><th scope="row">Total</th><td>{usdCents.format(q.total)}</td></tr>
            {q.approvedChanges !== 0 && (
              <>
                <tr className={s.quiet}><th scope="row">Approved changes</th><td>{signed(q.approvedChanges)}</td></tr>
                <tr className={s.grand}><th scope="row">Contract total</th><td>{usdCents.format(contract)}</td></tr>
              </>
            )}
          </tfoot>
        </table>
      </details>
      {isWonQuote(q) && (q.paid > 0 || q.remaining > 0) && (
        <div className={s.pay}>
          <p className={s.num}><b>{q.remaining <= 0 ? "Paid in full" : `${usd.format(q.paid)} paid · ${usd.format(q.remaining)} left`}</b></p>
          {q.nextDue && q.remaining > 0 && (
            <p className={s.muted}>Next: {q.nextDue.label} {usd.format(q.nextDue.amount)}{q.payOnline ? " — pay on the quote" : ` — ${q.orgName} will tell you how to pay`}</p>
          )}
        </div>
      )}
      <div className={s.actions}>
        <a className={open ? s.btnPrimary : s.btn} href={quoteHref(q.publicId)} data-open-quote>{open ? "Open quote to approve" : isWonQuote(q) && q.nextDue && q.remaining > 0 && q.payOnline ? `Pay ${usd.format(q.nextDue.amount)}` : "Open quote"}</a>
        <a className={s.btnText} href={quotePdfHref(q.publicId)} target="_blank" rel="noopener noreferrer"><Icon id="download" small />PDF</a>
      </div>
    </article>
  );
}
