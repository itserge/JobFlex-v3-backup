// ONLINE BOOKING — THE OFFICE PAGE (2026-09-23; redrawn 2026-10-28). The office side of /book/<slug>: the link and
// how to put it everywhere, the numbers, the visits booked, the hours and the rules, the services offered (smart
// defaults from the shop's trades, every one editable). Server rendered; every button is a form bound to a server
// action — the same actions, the same field names as before the redraw (owner, 2026-10-28: "save every
// functionality, nothing changes in how the workflow works").
//
// The redraw (owner: "fully redesign the online booking page", with the design-clarity skill): the page answers
// three questions in order — is my page on and where is it, who booked, what do I offer and when — at a size that
// reads at a glance. Plain stylesheet, every rule under `.jf-booking` (booking.css).

import Link from "next/link";
import type { Route } from "next";
import { cancelBookingOffice, markBookingDone, removeBookingService, resetBookingServices, saveBookingService, saveBookingSettings } from "@/actions/booking";
import type { BookingDashboard } from "@/lib/bookingBook";
import { CopyField } from "./copy-field";
import "./booking.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KIND_LABEL: Record<string, string> = { diagnostic: "Repair / diagnostic", "tune-up": "Tune-up", emergency: "Same-day", estimate: "Estimate", consult: "Consultation", other: "Other" };
const STATUS_WORD: Record<string, string> = { BOOKED: "Booked", RESCHEDULED: "Moved", CANCELED: "Canceled", DONE: "Done" };

function Icon({ d }: { d: string }) {
  return (
    <svg className="bk-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const I = {
  open: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  cal: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4",
  check: "M20 6 9 17l-5-5",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  visit: "M3 12h13M12 6l6 6-6 6",
}

export function BookingContent({ data }: { data: BookingDashboard }) {
  const { settings, link, upcoming, stats, timeZone, trades } = data;
  const day = (d: Date) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  const time = (d: Date) => d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const embed = `<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 18px;background:#1854a0;color:#fff;border-radius:8px;font:600 14px system-ui;text-decoration:none">Book a visit online</a>`;
  const live = upcoming.filter((b) => b.status !== "CANCELED");
  return (
    <div className="jf-booking">
      <header className="bk-head">
        <div>
          <div className="bk-kicker">Delivery · Online booking</div>
          <h1 className="bk-title">Online booking</h1>
        </div>
        <div className="bk-head-acts">
          <span className={`bk-state ${settings.enabled ? "is-on" : "is-off"}`} data-booking-state>
            <i aria-hidden="true" />
            {settings.enabled ? "Page is on" : "Page is off"}
          </span>
          <Link className="bk-btn bk-btn--ghost" href={"/dashboard/calendar" as Route}>
            <Icon d={I.cal} />
            Calendar
          </Link>
          <a className="bk-btn bk-btn--primary" href={link} target="_blank" rel="noreferrer" data-booking-link>
            <Icon d={I.open} />
            Open the booking page
          </a>
        </div>
      </header>

      {/* THE LINK and THE NUMBERS, side by side (owner, 2026-10-28: "two columns in a single row", the numbers 2×2). */}
      <div className="bk-top">
      {/* THE LINK — the page's first job: where it is, and one tap to copy it. */}
      <section className="bk-card bk-link" data-booking-share data-tour="booking:link">
        <div className="bk-link-main">
          <h2 className="bk-h2">Your booking link</h2>
          <p className="bk-lead">Put it on your website, Google profile, email signature, invoices and trucks.</p>
          <CopyField value={link} label="Booking link" copyLabel="Copy link" />
        </div>
        <details className="bk-more">
          <summary>Button for your website</summary>
          <p className="bk-note">Paste this into your website’s page — it shows a blue “Book a visit online” button.</p>
          <CopyField value={embed} label="Button code for your website" multiline copyLabel="Copy code" />
        </details>
        <details className="bk-more">
          <summary>What the booking page does</summary>
          <ul className="bk-list">
            <li>The services come from your trades, with your prices.</li>
            <li>A customer on a service plan gets their member price by their email.</li>
            <li>A repair call asks the two questions that matter, so the tech arrives knowing the job.</li>
            <li>A new customer becomes a lead, with the visit on your calendar.</li>
            <li>The reminder goes out the day before; they can move or cancel from their own link.</li>
          </ul>
        </details>
      </section>

      {/* THE NUMBERS */}
      <div className="bk-kpis" data-booking-kpis>
        <div className="bk-kpi">
          <div className="bk-kpi-lbl">Booked this week</div>
          <div className="bk-kpi-val" data-kpi="week">{stats.thisWeek}</div>
          <div className="bk-kpi-sub">{stats.next30} in the next 30 days</div>
        </div>
        <div className="bk-kpi">
          <div className="bk-kpi-lbl">Services offered</div>
          <div className="bk-kpi-val" data-kpi="services">{stats.services}</div>
          <div className="bk-kpi-sub">{trades.length ? `From ${trades.join(", ")}` : "Set your trades in Company"}</div>
        </div>
        <div className="bk-kpi">
          <div className="bk-kpi-lbl">Booking page</div>
          <div className={`bk-kpi-val ${settings.enabled ? "is-on" : "is-off"}`} data-kpi="enabled">{settings.enabled ? "On" : "Off"}</div>
          <div className="bk-kpi-sub">{settings.crews} crew{settings.crews === 1 ? "" : "s"} · {settings.slotMinutes}-min slots · {settings.leadHours}h notice</div>
        </div>
        <div className="bk-kpi">
          <div className="bk-kpi-lbl">All time</div>
          <div className="bk-kpi-val" data-kpi="all">{stats.allTime}</div>
          <div className="bk-kpi-sub">Visits booked online</div>
        </div>
      </div>
      </div>

      {/* WHO BOOKED */}
      <section className="bk-card" data-booking-upcoming>
        <div className="bk-card-h">
          <h2 className="bk-h2">Booked online</h2>
          <span className="bk-count">{live.length} coming up</span>
        </div>
        {upcoming.length === 0 ? (
          <div className="bk-empty">
            <strong>Nothing booked yet.</strong> Share your link — the first booking lands here and on your calendar.
          </div>
        ) : (
          <ul className="bk-visits">
            {upcoming.map((b) => (
              <li key={b.id} className={`bk-visit is-${b.status.toLowerCase()}`} data-booking-row={b.status}>
                <div className="bk-when">
                  <span className="bk-when-d">{day(b.when)}</span>
                  <span className="bk-when-t">{time(b.when)}</span>
                </div>
                <div className="bk-who">
                  {b.clientId ? (
                    <Link className="bk-who-n" href={`/dashboard/client-detail?client=${b.clientId}` as Route}>{b.name}</Link>
                  ) : b.leadId ? (
                    <Link className="bk-who-n" href={`/dashboard/leads/${b.leadId}` as Route}>{b.name}</Link>
                  ) : (
                    <span className="bk-who-n">{b.name}</span>
                  )}
                  {[b.phone, b.email, b.address].some(Boolean) && <span className="bk-sub">{[b.phone, b.email, b.address].filter(Boolean).join(" · ")}</span>}
                </div>
                <div className="bk-svc">
                  <span className="bk-svc-n">
                    {b.serviceLabel}
                    {b.member ? <span className="bk-tag bk-tag--member">Member</span> : b.leadId ? <span className="bk-tag bk-tag--lead">New lead</span> : null}
                  </span>
                  {b.answers.length > 0 && <span className="bk-sub">{b.answers.map((a) => `${a.label} ${a.value}`).join(" · ")}</span>}
                  {b.notes && <span className="bk-sub">“{b.notes}”</span>}
                </div>
                <span className={`bk-status is-${b.status.toLowerCase()}`}>{STATUS_WORD[b.status] ?? b.status.toLowerCase()}</span>
                <div className="bk-acts">
                  {b.appointmentId && b.status !== "CANCELED" && (
                    <Link className="bk-btn bk-btn--primary bk-btn--sm" href={`/dashboard/visits/${b.appointmentId}` as Route}>
                      Visit
                    </Link>
                  )}
                  {b.status !== "CANCELED" && b.status !== "DONE" && (
                    <form action={markBookingDone.bind(null, b.id)}>
                      <button className="bk-btn bk-btn--ok bk-btn--sm" type="submit">
                        <Icon d={I.check} />
                        Done
                      </button>
                    </form>
                  )}
                  {b.status !== "CANCELED" && (
                    <form action={cancelBookingOffice.bind(null, b.id)}>
                      <button className="bk-btn bk-btn--danger bk-btn--sm" type="submit">
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="bk-two">
        {/* WHEN — the hours and the rules */}
        <section className="bk-card" data-booking-settings>
          <div className="bk-card-h">
            <h2 className="bk-h2">Hours and rules</h2>
          </div>
          <form action={saveBookingSettings} className="bk-form">
            <label className="bk-switch" data-tour="booking:on">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
              <span className="bk-switch-box" aria-hidden="true" />
              <span>
                <strong>The booking page is on</strong>
                <em>Off: the page asks customers to call instead.</em>
              </span>
            </label>
            <fieldset className="bk-hours">
              <legend className="bk-h3">Open hours</legend>
              {settings.hours.map((h, i) => (
                <div key={i} className="bk-hour">
                  <span className="bk-hour-d">{DAYS[i]}</span>
                  <label className="bk-chk">
                    <input type="checkbox" name={`closed_${i}`} defaultChecked={!h} />
                    Closed
                  </label>
                  <input className="bk-in bk-in--time" name={`open_${i}`} type="time" defaultValue={h?.open ?? "08:00"} aria-label={`${DAYS[i]} opens`} />
                  <span className="bk-to">to</span>
                  <input className="bk-in bk-in--time" name={`close_${i}`} type="time" defaultValue={h?.close ?? "17:00"} aria-label={`${DAYS[i]} closes`} />
                </div>
              ))}
            </fieldset>
            {/* The five rules as one even grid: every number the same width, its unit fastened to it. */}
            <div className="bk-h3">Booking rules</div>
            <div className="bk-rules">
              <label className="bk-fld">
                <span className="bk-lbl">Slot every</span>
                <span className="bk-ig"><input className="bk-in" name="slotMinutes" type="number" min="15" max="240" defaultValue={settings.slotMinutes} /><em>min</em></span>
              </label>
              <label className="bk-fld">
                <span className="bk-lbl">Notice needed</span>
                <span className="bk-ig"><input className="bk-in" name="leadHours" type="number" min="0" max="168" defaultValue={settings.leadHours} /><em>hours</em></span>
              </label>
              <label className="bk-fld">
                <span className="bk-lbl">Crews out at once</span>
                <span className="bk-ig"><input className="bk-in" name="crews" type="number" min="1" max="20" defaultValue={settings.crews} /><em>crews</em></span>
              </label>
              <label className="bk-fld">
                <span className="bk-lbl">Arrival window</span>
                <span className="bk-ig"><input className="bk-in" name="arrivalWindow" type="number" min="0" max="480" defaultValue={settings.arrivalWindow} /><em>min</em></span>
                <span className="bk-hint">0 = an exact time</span>
              </label>
              <label className="bk-fld">
                <span className="bk-lbl">Days ahead to offer</span>
                <span className="bk-ig"><input className="bk-in" name="horizonDays" type="number" min="3" max="60" defaultValue={settings.horizonDays} /><em>days</em></span>
              </label>
            </div>
            <label className="bk-fld">
              <span className="bk-lbl">A line at the top of the page (optional)</span>
              <input className="bk-in" name="intro" defaultValue={settings.intro ?? ""} placeholder="Serving Snohomish County since 2009 — pick a time and we'll be there." />
            </label>
            <div className="bk-form-acts">
              <button className="bk-btn bk-btn--primary" type="submit">Save hours and rules</button>
            </div>
          </form>
        </section>

        {/* WHAT — the services */}
        <section className="bk-card" data-booking-services>
          <div className="bk-card-h">
            <h2 className="bk-h2">Services customers can book</h2>
            <span className="bk-count">{settings.services.length} offered</span>
          </div>
          <div className="bk-svcs">
            {settings.services.map((s) => (
              <details key={s.key} className="bk-svc-row" data-booking-service={s.key}>
                <summary>
                  <span className="bk-svc-main">
                    <strong>{s.label}</strong>
                    <span className="bk-svc-meta">
                      {KIND_LABEL[s.kind] ?? s.kind} · {s.minutes} min{s.questions?.length ? ` · ${s.questions.length} question${s.questions.length === 1 ? "" : "s"}` : ""}
                      {s.urgent ? <span className="bk-tag bk-tag--urgent">Same day</span> : null}
                    </span>
                  </span>
                  <span className="bk-svc-price">
                    {s.priceText}
                    {s.memberPriceText ? <em>Members: {s.memberPriceText}</em> : null}
                  </span>
                  <span className="bk-edit">Edit</span>
                </summary>
                <ServiceForm s={s} />
              </details>
            ))}
            <details className="bk-svc-row bk-svc-row--add">
              <summary>
                <span className="bk-svc-main">
                  <strong>
                    <Icon d={I.plus} />
                    Add a service
                  </strong>
                </span>
              </summary>
              <ServiceForm />
            </details>
          </div>
          <form action={resetBookingServices} className="bk-reset">
            <button className="bk-btn bk-btn--ghost bk-btn--sm" type="submit">Reset to the smart defaults for my trades</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function ServiceForm({ s }: { s?: BookingDashboard["settings"]["services"][number] }) {
  return (
    <form action={saveBookingService} className="bk-form bk-svc-form">
      {s && <input type="hidden" name="key" value={s.key} />}
      {s && <input type="hidden" name="trade" value={s.trade} />}
      <label className="bk-fld">
        <span className="bk-lbl">Name</span>
        <input name="label" className="bk-in" defaultValue={s?.label ?? ""} required minLength={2} />
      </label>
      <div className="bk-grid">
        <label className="bk-fld">
          <span className="bk-lbl">Kind</span>
          <select name="kind" className="bk-in" defaultValue={s?.kind ?? "diagnostic"}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label className="bk-fld">
          <span className="bk-lbl">Length</span>
          <span className="bk-ig"><input name="minutes" className="bk-in" type="number" min="15" max="480" defaultValue={s?.minutes ?? 60} /><em>min</em></span>
        </label>
        <label className="bk-fld">
          <span className="bk-lbl">Price the customer reads</span>
          <input name="priceText" className="bk-in" defaultValue={s?.priceText ?? ""} placeholder="$129 diagnostic, applied to the repair" />
        </label>
        <label className="bk-fld">
          <span className="bk-lbl">Members read instead (optional)</span>
          <input name="memberPriceText" className="bk-in" defaultValue={s?.memberPriceText ?? ""} placeholder="Diagnostic waived for members" />
        </label>
      </div>
      <label className="bk-fld">
        <span className="bk-lbl">One line about it</span>
        <input name="description" className="bk-in" defaultValue={s?.description ?? ""} />
      </label>
      <label className="bk-fld">
        <span className="bk-lbl">Questions — one per line: “Question? | option, option” (options optional)</span>
        <textarea name="questions" className="bk-in bk-ta" defaultValue={(s?.questions ?? []).map((q) => (q.options ? `${q.label} | ${q.options.join(", ")}` : q.label)).join("\n")} />
      </label>
      <label className="bk-chk">
        <input type="checkbox" name="urgent" defaultChecked={s?.urgent ?? false} />
        Can start today (skips the notice)
      </label>
      <div className="bk-form-acts">
        <button className="bk-btn bk-btn--primary" type="submit">{s ? "Save" : "Add service"}</button>
        {s && (
          <button className="bk-btn bk-btn--danger" type="submit" formAction={removeBookingService.bind(null, s.key)}>
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
