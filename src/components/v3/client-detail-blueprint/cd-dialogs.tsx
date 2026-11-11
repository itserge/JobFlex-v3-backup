"use client";

// CLIENT DETAIL / BLUEPRINT — the two dialogs behind Edit and Message.
//
// NO NEW DIALOG VOCABULARY. Both wear `mdl pmdl`, the frame the proposals
// module already publishes (`.content .pmdl .mdl-box / .mdl-head / .mdl-body /
// .mdl-foot / .mf / .mf-lbl / .mf-in`), and both open and close through
// blueprint-shell/mdl-motion so the enter and exit match every other dialog in
// the app. That module is always on — blueprint-shell applies its `.bp` class
// on every route — so a page deliberately absent from PAGE_STYLES can still
// draw the house dialog. This is also why they are not Radix: the project's
// modals are hand-rolled, and the in-house ones already carry the motion
// contract a library would replace.
//
// THE MOTION HELPERS ARE IMPERATIVE, so each dialog holds a ref and drives the
// element rather than swapping a `display` style from state. `closeMdl` needs
// the exit to play before `.open` comes off, and a React render that unmounted
// the box would cut the exit — the same asymmetry mdl-motion.ts was written to
// remove.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { updateClient } from "@/actions/clients";
import { clientChannels, messageClient, type ClientChannel } from "@/actions/clientMessage";
import { isPlanLimitFailure } from "@/lib/planLimits";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { closeMdl, openMdl } from "@/components/v3/blueprint-shell/mdl-motion";
import { joinAddress } from "./client-detail-data";
import { ClampedName, Ic, cx } from "./cd-ui";
import styles from "./client-detail.module.css";
import { ensureCompanyName } from "@/components/company-name/company-name-gate";

/** Where the two gates send the reader. Both are real routes. */
const TEXTING_ROUTE = "/dashboard/texting" as Route;
const GMAIL_ROUTE = "/dashboard/settings/gmail" as Route;

/** Server actions reject with text written for the reader ("Name is required",
 *  "Client not found"). Show that; fall back only for the transport failures
 *  that carry no useful message. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  // A zod `.parse` throw arrives as a JSON ARRAY of issues, and printing it
  // raw puts `[{"code":"too_big","maximum":120,…}]` in front of a contractor.
  // The reachable one here is a client name longer than the column allows —
  // imported books have them — so the issue's own message is what shows.
  if (msg.startsWith("[")) {
    try {
      const issues = JSON.parse(msg) as { message?: string; path?: (string | number)[] }[];
      const first = issues.find((i) => i?.message);
      if (first?.message) {
        const field = first.path?.[0];
        return field ? `${String(field)}: ${first.message}` : first.message;
      }
    } catch {
      // Not JSON after all — fall through and show what came back.
    }
  }
  return msg;
}

/**
 * The open/close contract, once, for both dialogs.
 *
 * Timeouts are tracked so an unmount mid-close cannot fire mdl-motion's cleanup
 * into a detached element — the same reason every behavior module in this
 * codebase owns an `after()` helper.
 */
function useMdl(onOpen?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [isOpen, setIsOpen] = useState(false);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const close = useCallback(() => {
    if (ref.current) closeMdl(ref.current, after);
    setIsOpen(false);
  }, [after]);

  const open = useCallback(() => {
    if (!ref.current) return;
    openMdl(ref.current);
    setIsOpen(true);
    onOpen?.();
  }, [onOpen]);

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, []);

  // Escape closes, and stops there: the shell binds its own Escape for the
  // command palette and the handheld nav drawer, and one key press should not
  // dismiss two things.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  return { ref, open, close, isOpen };
}

/**
 * True once `pending` has been true for `delay` ms, and false the instant it
 * stops.
 *
 * A dialog whose contents arrive in 40ms must not flash a spinner — that reads
 * as a page fault, not as loading. A dialog whose contents take a second must
 * not sit empty, because an empty sheet reads as broken. 300ms is the gap the
 * house uses between "instant" and "say something".
 */
function useSlowFlag(pending: boolean, delay = 300): boolean {
  const [slow, setSlow] = useState(false);
  // The reset lives in the CLEANUP rather than in the body: a synchronous
  // setState in an effect body is a cascading render (and the lint rule that
  // says so), while a cleanup that fires when `pending` goes false is exactly
  // the moment the flag should drop.
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => setSlow(true), delay);
    return () => {
      clearTimeout(id);
      setSlow(false);
    };
  }, [pending, delay]);
  return slow;
}

/** The house loading mark: a pulsing blueprint square beside a mono caption
 *  (the `.sp-busy` pattern from the estimate console). `spPulse` is published
 *  in dashboard-blueprint/blueprint-global.css. */
function Busy({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.busy} role="status" aria-live="polite">
      <span className={styles.busyDot} aria-hidden="true" />
      {children}
    </div>
  );
}

/** ≤768px, live. The handheld branches below are LAYOUT decisions read from
 *  the viewport, never from a user agent string. */
function useHandheld(): boolean {
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setHandheld(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return handheld;
}

/* ============================================================
   EDIT — the client's own particulars
   ============================================================ */

export type ClientEditValues = {
  name: string;
  email: string;
  phone: string;
  /** Street line. */
  address: string;
  /** Unit / suite / access note — the second line of the same column. NOT
   *  editable here: the form has no box for it, but the value is carried in and
   *  re-joined on save so an existing second line survives an edit. */
  address2: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

export type EditHandle = { open: () => void };

/**
 * ONE ADDRESS FIELD, matching the create form.
 *
 * The dialog used to ask for street / city / state / ZIP in four boxes while
 * every other client form in the app asks for one address. Two shapes for one
 * fact is how a book ends up with half its rows parsed and half not, so this
 * one asks the way the create form asks: an address, and the free-text notes
 * that were previously readable on the page but not editable anywhere.
 *
 * THREE THINGS TRAVEL WITHOUT A BOX: city, state and zip — columns on the row
 * that the band above prints — and the address's SECOND LINE. `updateClient`
 * writes every key it is handed, so dropping any of them from the payload would
 * blank a column on the first save. `values.address2` is still seeded from the
 * record and still re-joined by `joinAddress` on submit; there is simply no
 * input bound to it any more (owner's call — a "Suite, unit, or access note"
 * box is a line the handheld form has no room for and the create form never
 * offered). A record that already carries a second line keeps it, and keeps
 * printing it in the particulars band.
 */
export function ClientEditDialog({
  clientId,
  initial,
  handleRef,
}: {
  clientId: string | null;
  initial: ClientEditValues;
  handleRef: React.RefObject<EditHandle | null>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reopening re-seeds from the record, so a cancelled edit is genuinely
  // cancelled rather than lingering in the box until a reload.
  const seed = useCallback(() => {
    setValues(initial);
    setError(null);
    // Focus after the enter animation has a frame to start, matching the
    // estimator picker's rAF-then-focus.
    requestAnimationFrame(() => requestAnimationFrame(() => firstFieldRef.current?.focus()));
  }, [initial]);

  // Destructured, not held as `mdl.*`: reading a property off an object that
  // carries a ref inside a render is what react-hooks/refs flags, and the two
  // callbacks are stable anyway.
  const { ref: mdlRef, open: openMdlDialog, close } = useMdl(seed);
  useEffect(() => {
    handleRef.current = { open: openMdlDialog };
  }, [handleRef, openMdlDialog]);

  const set =
    (k: keyof ClientEditValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !clientId) return;
    setBusy(true);
    setError(null);
    try {
      const { address, address2, ...rest } = values;
      await updateClient(clientId, { ...rest, address: joinAddress(address, address2) });
      close();
      // The page is a server component reading the row it just changed, so the
      // refresh IS the update — no local copy of the client to keep in step.
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mdl pmdl" ref={mdlRef} role="dialog" aria-modal="true" aria-labelledby="cdEditTitle">
      <div className="mdl-bg" onClick={close} />
      <div className={cx("mdl-box", styles.mdlWide)}>
        <div className="mdl-head mdl-head--row">
          <span id="cdEditTitle">Edit client</span>
          <button className="mdl-x" type="button" onClick={close} aria-label="Close dialog">
            <Ic name="x" />
          </button>
        </div>

        <form className={cx("mdl-body", styles.mdlScroll)} onSubmit={submit} noValidate>
          <div className="mf">
            <label className="mf-lbl" htmlFor="cdName">
              Client name
            </label>
            <input
              className="mf-in"
              id="cdName"
              ref={firstFieldRef}
              value={values.name}
              onChange={set("name")}
              autoComplete="off"
            />
          </div>

          <div className={styles.mdlRow}>
            <div className="mf">
              <label className="mf-lbl" htmlFor="cdEmail">
                Email
              </label>
              <input
                className="mf-in"
                id="cdEmail"
                type="email"
                value={values.email}
                onChange={set("email")}
                autoComplete="off"
              />
            </div>
            <div className="mf">
              <label className="mf-lbl" htmlFor="cdPhone">
                Phone
              </label>
              <input
                className="mf-in"
                id="cdPhone"
                type="tel"
                value={values.phone}
                onChange={set("phone")}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mf">
            <label className="mf-lbl" htmlFor="cdAddress">
              Address
            </label>
            <input
              className="mf-in"
              id="cdAddress"
              value={values.address}
              onChange={set("address")}
              placeholder="14208 NE 182nd St, Woodinville, WA 98072"
              autoComplete="off"
            />
          </div>

          <div className="mf">
            <label className="mf-lbl" htmlFor="cdNotes">
              Notes
            </label>
            <textarea
              className={cx("mf-in", styles.mdlArea)}
              id="cdNotes"
              value={values.notes}
              onChange={set("notes")}
              rows={4}
              placeholder="Gate code, dog in the yard, prefers texts after 5…"
            />
          </div>
        </form>

        {error ? <div className="mf-err mf-err--boxed">{error}</div> : null}

        <div className="mdl-foot">
          <button className="btn btn-ghost" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className={cx("btn", "btn-primary", busy && "is-busy")}
            type="button"
            onClick={submit}
            disabled={busy}
          >
            <Ic name="check" />
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MESSAGE — one composer, two channels, three ways out
   ============================================================ */

export type MessageHandle = { open: () => void };

/** Gmail's and Outlook's documented compose deep links. Everything is
 *  percent-encoded: a subject with an ampersand in it would otherwise start a
 *  new query parameter and truncate itself. */
function gmailCompose(to: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

function outlookCompose(to: string, subject: string, body: string): string {
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(
    to,
  )}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** `sms:` takes the number in the path and the text in the query. The stray
 *  `?&` is deliberate — it is the form iOS has always parsed, and Android
 *  ignores the empty first parameter. */
function smsLink(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
}

/**
 * Email or text, chosen at the top of the box.
 *
 * THE CHANNELS ARE READ FROM THE SERVER when the dialog opens rather than
 * inferred from the props: whether the org has a Twilio number or a connected
 * Gmail is not something the record page knows, and a channel that only fails
 * after the message is typed is worse than one that says why it is off before a
 * word is written. While that read is in flight the body shows the house
 * spinner rather than an empty sheet — but only after 300ms, so a fast answer
 * never flashes one.
 *
 * THREE WAYS OUT, and which ones exist depends on what is configured:
 *   · in-app send — email through the org's connected Gmail, SMS through Twilio;
 *   · webmail handoff — a prefilled Gmail or Outlook compose in a new tab, which
 *     needs no integration at all and is the answer for an org that has not
 *     connected anything;
 *   · the phone's own messenger — on handheld, an `sms:` link, same reasoning.
 */
export function ClientMessageDialog({
  clientId,
  clientName,
  handleRef,
}: {
  clientId: string | null;
  clientName: string;
  handleRef: React.RefObject<MessageHandle | null>;
}) {
  const router = useRouter();
  const handheld = useHandheld();
  const [channel, setChannel] = useState<ClientChannel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [reach, setReach] = useState<{
    email: string | null;
    phone: string | null;
    smsConfigured: boolean;
    emailConfigured: boolean;
  } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Only true between opening the dialog and the channels landing. `error`
  // ends the wait too — a failed read must not spin forever.
  const [loading, setLoading] = useState(false);
  const slow = useSlowFlag(loading);

  const seed = useCallback(() => {
    setSubject("");
    setBody("");
    setError(null);
    setSent(null);
    setReach(null);
    if (clientId) {
      setLoading(true);
      clientChannels(clientId)
        .then((r) => {
          setReach(r);
          // Open on the channel that can actually reach them. Email leads when
          // both work — it carries a subject and a paper trail; a text is the
          // fallback for a client with no address on file.
          setChannel(r.email ? "email" : "sms");
        })
        .catch((err) => setError(actionError(err)))
        .finally(() => setLoading(false));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => bodyRef.current?.focus()));
  }, [clientId]);

  // Destructured, not held as `mdl.*`: reading a property off an object that
  // carries a ref inside a render is what react-hooks/refs flags, and the two
  // callbacks are stable anyway.
  const { ref: mdlRef, open: openMdlDialog, close } = useMdl(seed);
  useEffect(() => {
    handleRef.current = { open: openMdlDialog };
  }, [handleRef, openMdlDialog]);

  const email = reach?.email ?? "";
  const phone = reach?.phone ?? "";

  // WHAT EACH CHANNEL CAN DO, separated into "is there an address at all" and
  // "can this app do the sending". The first kills the composer — there is
  // nowhere to type to. The second only kills the in-app Send, because the
  // handoff routes below need no integration.
  const emailReachable = !reach || !!reach.email;
  const smsReachable = !reach || !!reach.phone;
  const emailSendable = !!reach?.email && !!reach.emailConfigured;
  // On handheld the send is the phone's own messenger, which does not care
  // whether the org rents a Twilio number.
  const smsSendable = !!reach?.phone && (handheld || !!reach.smsConfigured);

  const composerOff =
    channel === "email"
      ? !emailReachable
      : !smsReachable || (!handheld && !!reach && !reach.smsConfigured);

  const canSend =
    channel === "email" ? emailSendable : !!reach?.phone && !!reach.smsConfigured;

  async function send() {
    if (busy || !clientId || !canSend) return;
    // The first message to a client names the business first (lib/orgName).
    if (!(await ensureCompanyName())) return;
    setBusy(true);
    setError(null);
    try {
      const res = await messageClient({ clientId, channel, subject, body });
      // The month's texts are used: the plan dialog says so (lib/sms/send).
      if (isPlanLimitFailure(res)) {
        reportPlanLimitResult(res);
        return;
      }
      // `delivered: false` means the transport is switched off in this
      // environment and the message went to a server log. Saying "Sent" there
      // would be a lie the contractor only discovers from the client.
      setSent(
        res.delivered
          ? `${res.channel === "email" ? "Emailed" : "Texted"} ${res.to}`
          : `Logged against the record — the ${res.channel === "email" ? "email" : "SMS"} transport is switched off in this environment, so nothing left the building.`,
      );
      setBody("");
      setSubject("");
      // The send is logged as an ActivityEvent, and the Activity card is
      // reading that table — so the refresh puts the message on the record.
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  const subjectLine = subject.trim() || "A message about your project";

  return (
    <div className="mdl pmdl" ref={mdlRef} role="dialog" aria-modal="true" aria-labelledby="cdMsgTitle">
      <div className="mdl-bg" onClick={close} />
      <div className={cx("mdl-box", styles.mdlWide)}>
        <div className="mdl-head mdl-head--row">
          <span id="cdMsgTitle" className={styles.mdlTitle}>
            Message <ClampedName>{clientName}</ClampedName>
          </span>
          <button className="mdl-x" type="button" onClick={close} aria-label="Close dialog">
            <Ic name="x" />
          </button>
        </div>

        <div className={cx("mdl-body", styles.mdlScroll)}>
          {/* The channel is a two-button group, not a select: there are exactly
              two and both are worth reading at a glance.

              NEITHER CHIP IS EVER DISABLED, even when its channel cannot be
              used. A disabled chip refuses the click and explains nothing —
              the reason ("no phone on file", "texting needs a Twilio number")
              only renders for the SELECTED channel, so disabling the one with
              the problem is exactly how you hide the answer from the person
              looking for it. Selecting it shows the reason and it is the Send
              button that stays off.

              The group carries its own LABEL and its own bottom margin. It used
              to sit flush against the field label under it, and two stacked
              labels 6px apart read as one control with two names. */}
          <div className={styles.chanBlock}>
            <span className={styles.chanLbl} id="cdChanLbl">
              Send by
            </span>
            <div className={styles.chips} role="group" aria-labelledby="cdChanLbl">
              <button
                type="button"
                aria-pressed={channel === "email"}
                className={cx(styles.chip, channel === "email" && styles.chipOn)}
                onClick={() => setChannel("email")}
              >
                Email
              </button>
              <button
                type="button"
                aria-pressed={channel === "sms"}
                className={cx(styles.chip, channel === "sms" && styles.chipOn)}
                onClick={() => setChannel("sms")}
              >
                Text
              </button>
            </div>
          </div>

          {loading ? (
            slow ? (
              <Busy>Checking how this client can be reached…</Busy>
            ) : null
          ) : (
            <>
              {channel === "email" ? (
                <div className="mf">
                  <label className="mf-lbl" htmlFor="cdSubject">
                    Subject
                  </label>
                  <input
                    className="mf-in"
                    id="cdSubject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="About your roof proposal"
                    autoComplete="off"
                    disabled={composerOff}
                  />
                </div>
              ) : null}

              <div className="mf">
                <label className="mf-lbl" htmlFor="cdBody">
                  Message
                </label>
                <textarea
                  className={cx("mf-in", styles.mdlArea)}
                  id="cdBody"
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder={
                    channel === "email"
                      ? "Hi — following up on the garage re-roof…"
                      : "Hi — following up on the garage re-roof."
                  }
                  disabled={composerOff}
                />
              </div>

              {/* THE GATES. One line each, and every one of them names the page
                  that fixes it — a warning that does not say where to go is a
                  dead end with punctuation. */}
              {channel === "email" && reach && !reach.email ? (
                <div className="mf-note">
                  <ClampedName>{clientName}</ClampedName> has no email on file — add one with Edit.
                </div>
              ) : null}

              {channel === "email" && reach?.email && !reach.emailConfigured ? (
                <div className="mf-note">
                  <Link className={styles.noteLink} href={GMAIL_ROUTE}>
                    Connect your Gmail in Settings
                  </Link>{" "}
                  to send email from JobFlex. Until then, open a draft in Gmail or Outlook below.
                </div>
              ) : null}

              {channel === "sms" && reach && !reach.phone ? (
                <div className="mf-note">
                  <ClampedName>{clientName}</ClampedName> has no phone number on file — add one with Edit.
                </div>
              ) : null}

              {channel === "sms" && reach?.phone && !reach.smsConfigured ? (
                <div className="mf-note">
                  Texting is not switched on yet —{" "}
                  <Link className={styles.noteLink} href={TEXTING_ROUTE}>
                    see the Texting page
                  </Link>
                  {handheld ? ". Meanwhile, Open in Messages hands this to your phone." : "."}
                </div>
              ) : null}

              {/* THE HANDOFF. Needs no integration, so it is offered whether or
                  not the org has connected anything — it is the same message,
                  composed in the reader's own mail client. */}
              {channel === "email" && reach?.email ? (
                <div className={styles.handoff}>
                  <span className={styles.chanLbl}>Or open a draft in</span>
                  <div className={styles.chips}>
                    <a
                      className={styles.chip}
                      href={gmailCompose(email, subjectLine, body)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Gmail
                    </a>
                    <a
                      className={styles.chip}
                      href={outlookCompose(email, subjectLine, body)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Outlook
                    </a>
                  </div>
                </div>
              ) : null}

              {sent ? <div className="mf-note">{sent}</div> : null}
            </>
          )}
        </div>

        {error ? <div className="mf-err mf-err--boxed">{error}</div> : null}

        <div className="mdl-foot">
          <button className="btn btn-ghost" type="button" onClick={close}>
            Close
          </button>

          {/* On handheld the text channel leaves the app: the send button is an
              `sms:` link so the phone's own messenger opens with the number and
              the typed message already in it. Nothing is logged against the
              record for that route — the send happens outside the app, and a
              log entry for a message the contractor might still cancel would be
              a fiction on the client's file. */}
          {channel === "sms" && handheld && smsSendable ? (
            <a
              className={cx("btn", "btn-primary", body.trim().length === 0 && "is-busy")}
              href={smsLink(phone, body)}
              aria-disabled={body.trim().length === 0}
              onClick={(e) => {
                if (body.trim().length === 0) e.preventDefault();
              }}
            >
              <Ic name="send" />
              Open in Messages
            </a>
          ) : (
            <button
              className={cx("btn", "btn-primary", busy && "is-busy")}
              type="button"
              onClick={send}
              disabled={busy || loading || !canSend || body.trim().length === 0}
            >
              <Ic name="send" />
              {busy ? "Sending…" : channel === "email" ? "Send email" : "Send text"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
