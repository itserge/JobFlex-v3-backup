# SmartBook — implementation plan

Design: `docs/superpowers/specs/2026-10-31-smartbook-design.md` (owner's decisions 2026-10-31: one AI call after 2 hours without a reply, switch off by default; text only leads who agreed; every plan and the trial).

No schema change: records in `SyncState`, the timeline in `ActivityEvent`, bookings through `createBooking`. Batches of about five pieces, each stopped for the owner's review (CLAUDE.md).

## Batch 1 — the engine (server; no new screens)

1. **`src/lib/smartbook/settings.ts`** (pure)
   - `SmartBookSettings` holds:
     - `on` and `onSince`;
     - `sources` (facebook, website, jobflex, desk, other);
     - `text`, `email`, `call`;
     - `serviceKey`, `offers` (2–4), `ownTime: "ask" | "auto"`, `firstMessage`.
   - It also has its defaults, `parseSmartBookSettings`, and `sourceAllowed(settings, lead.source)`, which goes through `leadSourceOf`.
2. **`src/lib/smartbook/offers.ts`** (pure)
   - `pickOffers` chooses the soonest time, then another day in the other half of the day, and so on. It skips held times and follows a customer's preference (days, part of the day, after/before, a date).
   - `quickRead` reads "1" / "2" / "yes" / "no" / "stop" without the model.
   - `proposalInstant` turns a day and time into an instant on the company's clock.
   - `slotsAt` answers whether a proposed time is open.
3. **`src/lib/smartbook/words.ts`** (pure)
   - Every customer line: the first text, booked, checking, still checking, confirmed, the contractor's other time, sorry-taken, the two nudges, the close, the hand-off.
   - Every contractor line: the request, booked, a question passed on, a hand-off, a reminder.
   - The template filler `{first name} {company} {service} {times}`.
4. **`src/lib/smartbook/understand.ts`** (server, the model)
   - `readCustomer` returns a zod-checked object: intent (pick, propose, prefer, question, not-interested, cancel, reschedule, thanks, human, other), the pick, the proposal (day, time or part of the day), the preference, an answer drawn only from the desk's FAQ, the language, and whether the message is angry.
   - `readContractor` returns yes / no / other time / unclear, with the time.
   - `translate` covers a lead who writes in another language.
   - Both run on `getOpenAI` + `resolveOpenAIModel` with JSON output. With no model, they fall back to `quickRead`.
5. **`src/lib/smartbook/store.ts` and `src/lib/smartbook/engine.ts`** (server)
   - Conversations live under `smartbook:c:<org>:<lead>`, with three indexes:
     - `smartbook:p:<org>:<E164>`, phone to lead;
     - `smartbook:t:<token>`, the pick page's token;
     - `smartbook:h:<org>:<ms>`, a held time.
   - Each update is optimistic, the way Meta connect does it.
   - The engine's functions:
     - `startSmartBook(leadId)`
     - `onCustomerText` and `onContractorText`
     - `answerRequest`, shared by text, email and the app
     - `pickByToken` and `proposeByToken`, for the pick page in batch 2
     - `runSmartBook(now)`, which the cron calls for the steps that are due
   - Sends go through `sendText` (falling back to email when a text is SKIPPED or refused) and `sendOrgEmail`. Every message is an `ActivityEvent` on the lead.
6. **Booking**
   - `createBooking` gets a `smartbook` channel, which books onto the existing lead, and a `confirmed` start, which skips the open-slot check because the contractor said yes.
   - `visitVia` gains the `smartbook` tag.
   - `recordTextConsent` gains the sources `facebook-form`, `website`, `lead-center` and `email-tap`.
7. **Meta leads by themselves**
   - `syncMetaLeads(org)` in `lib/meta/connections.ts` reads leads newer than the last check on every form, with a watermark in `meta:auto:<org>`.
   - It reads each form's consent checkboxes once (`legal_content`) and stores consent from `custom_disclaimer_responses`.
   - It creates the same rows as Import, then calls `notifyLeadCreated` and `startSmartBook`.
   - The plan's lead limit stops it, with a daily note to the owner.
8. **The inbound text route**
   - Before the forward: a team phone with a waiting request goes to `onContractorText`; a phone with a live conversation goes to `onCustomerText`.
   - Anything SmartBook doesn't handle (handed off, paused) falls through to today's forward.
9. **The cron** `/api/cron/smartbook`, every 2 minutes in `vercel.json`: the Meta sync for each connected workspace, then the due steps.
10. **The hooks:** `startSmartBook` after website leads (`createWebLead`), Lead Center accepts and desk messages. Leads added by hand or by CSV are not started unless the setting says so.
11. **Notification pref key** `smartbook-request` (text and email, office). Booked visits use the existing `appointment-booked` and `booking-online` keys.
12. **`qa/tests/logic/smartbook.check.ts`:** offers and spreading, holds, `quickRead`, proposal instants, the words, the settings parser, and the conversation steps against a fixture reader.

Review: run on the local stand with no real texts (the `SmsMessage` rows show every text that would go). Show the owner a full conversation.

## Batch 2 — the customer's pages and emails (built 2026-10-31)

As built: the pick page is `/b/[token]` (short, for the text) and the company's answer page `/b/r/[token]`; the email
renderer gained a `choice` row (a time to tap); the website estimators needed no new box — every one already requires
"<company> may call, text or email me", so a website lead is texted. Checked in a real browser at 1440×900 and 390×844.

The plan as written:

- The pick page `/book/pick/[token]` (portal, desk and 390px): the offered times, all open times, and "Suggest a time".
- The first email with a button for each time, plus "Prefer texts? Tap here", which records consent.
- The website estimators' consent box.
- The contractor's request email (Confirm · Other times · Suggest a time). The buttons open a page that asks for one tap, so mail scanners book nothing.

## Batch 3 — the contractor's screens (built 2026-10-31)

As built:
- **Settings → SmartBook** is its own Settings item, because Settings has no Leads section. It is one form on desk and phone (`components/v3/smartbook/smartbook-settings`) that loads and saves itself (`actions/smartBookOffice`), like Website estimators. The call switch shows "Next update" and saves off.
- **"Send me a test"** makes the person pressing it the customer, by text and email. Nothing is booked or held, and nobody else hears of it. For two hours their texts go to the test, as the customer, and as the company once the test asks for a time.
- **The calendar's Requests** card sits above the calendar on desk and phone, drawn only when a request waits, for the office and sales reps (a rep sees their own leads). A Yes that books redraws the grid (`jf:calendar-reload`).
- **The lead page's card** sits under the contact card. It shows the stamp, the times, the request with its three answers, the conversation, and Pause / Restart / Offer times.
- **The leads list** shows "SmartBook · Needs you" under the stage, on desk and phone.
- **A text or email sent from the client record** pauses SmartBook for that person.
- **Checked** in a real browser at 1440×900 and 390×844 (39 checks), plus a stand run of every new engine step.

The plan as written:

- Settings → Leads → SmartBook (desk and handheld): the switch, sources, channels, visit type, own-time rule, the first message with its preview, "Send me a test", and the Facebook consent words to copy.
- The calendar's Requests card (desk and handheld).
- The lead page: the conversation, its status, Pause / Restart, and Offer times.
- The leads list's status chip.

## Batch 4 — the phone (built 2026-10-31)

As built (`lib/smartbook/phone.ts`), with no change to the voice server:
- **The voice server's routing:** it sends open_times / book_visit / take_message to the desk's own routes, which ask `leadForToken` first, and any other tool a brief brings to `/api/desk/tool`.
- **A SmartBook lead calling in:** the desk's brief knows their times, request or visit. It brings the desk's tools plus `request_time` and `not_interested`. Booking, messages and requests act on their own lead and conversation, never a second lead.
- **Desk messages:** the desk asks about texts before `take_message`, and a "Texts: yes" line is the caller's consent (source `phone-call`).
- **The one call:** placed from the company's number (`deskNumberFor`) with answering-machine detection, through `/api/twilio/voice/smartbook` (+ `/after`, `/status`), with token kind `smartbook`. It goes only when the desk is live, the plan has the desk, minutes are left and the lead agreed to calls. Otherwise the lead's timeline says why and the text nudge follows.
- **What the call does:** a person gets the desk on SmartBook's script (5 min cap, the company's voice); a machine gets a short voicemail. Minutes and the transcript go through `finishCall`, and the call is on the Phone page as an outbound row on the lead.
- **Checked:** stand runs of every step, the routes over HTTP, and the voice server's own tests (14 pass).

The plan as written:

- The desk's call brief knows a lead's conversation and offered times, and gets the new tool `request_time`.
- `take_message` asks whether the caller agrees to texts.
- The one outbound AI call after 2 business hours without a reply, through the outreach `placeCall` path with SmartBook's tools, using the plan's desk minutes. A voicemail gets the short message.

## Batch 5 — proof and words (built 2026-10-31)

As built:
- **`qa/walks/smartbook.walk.ts`** runs on a local stand, on desk and at 390×844 (a phone's touch and width):
  - it uses the fake model and its own fake Facebook (`META_GRAPH_BASE`, which `lib/meta/graph.ts` honours only in QA test mode, never on Vercel production);
  - it calls the 2-minute job with `CRON_SECRET` and sends the customers' texts signed with a stand-only `TWILIO_AUTH_TOKEN` (Twilio stays off).
  - It covers switching SmartBook on, Facebook leads arriving by themselves (texts box ticked → texted, not ticked → emailed, the calls box), a reply "2" booking, a customer's own time by text and on their page, Yes on the desk calendar, No on the phone calendar, Pause / Restart / Offer times, the leads tags, Send me a test, and the two SmartHelp guides (Open and Show me).
  - It ran against a `next build` + `next start` of this branch: all 46 checks pass.
  - Fixed on the way (owner's OK, 2026-10-31):
    - An owner with a subscription landed on Billing from any Settings link. Both Settings layouts keep every pane mounted, and `components/billing/FreeSwitch.tsx`'s manage window asked for `?tab=billing` whenever its read wasn't live (2026-10-17). On the desk only the address changed; on a phone the page opened on Billing. It now asks only when Billing is the pane on screen (`shown`, via `PaneProps.shown` and the phone's BillingPane).
    - The payments guide's `/dashboard/settings?pane=integrations&sub=stripe` was added to HELP_PAGES (smarthelp-guides.check failed on it).
- **SmartHelp guides** "Turn on SmartBook" and "Add the texts box to your Facebook form" (the planned title was over the 40-character limit). The new page `/dashboard/settings?pane=smartbook` and the targets `smartbook:on`, `smartbook:consent` and `smartbook:test` were added.
- **Handbook:** "SmartBook (times for new leads)" under Operations, a Facebook auto-sync line under Leads, and the code map and cron in Operations' Internal block. SmartHelp's AI reads the same text.
- **DESIGN.md:** the SmartBook entry under Layout, frames and controls.

The plan as written:

- `qa/walks/smartbook.walk.ts` on the stand, on desk and at 390×844, with a fake model and fake Meta.
- The SmartHelp guides "Turn on SmartBook" and "Add the text consent box to your Facebook form".
- The handbook section, DESIGN.md entries for the new surfaces, and a `next build` check.

## Joined with main (2026-10-31, owner's OK)

The same day, main gained the Meta auto-import (a40e7dd9) and the AI desk calling leads (2238636d), both by PHILLyaHI. One of each is kept — theirs — and SmartBook rides on them:

- **Facebook leads:** `lib/meta/autoImport.ts` is the one sweep (`/api/cron/meta-leads`, every 5 minutes, switch "New leads come in by themselves", `meta:auto:<org>` in its `{ pageId, since }` shape). SmartBook's own sync (`syncMetaLeads`, read from the 2-minute job) is gone.
  - The sweep now also reads each form's consent boxes (`meta:boxes:<org>`, six hours fresh, at most 100 forms) and each lead's ticks, with the code-100 fallback.
  - After it files the leads, it sends the office's new-lead notice and starts SmartBook with the texts box as consent.
  - Saving SmartBook on with Facebook ticked turns the switch on (`ensureMetaAutoImport`). The form warns when the switch is off.
- **The one call:** it is the desk's own call to a lead (`lib/aiDesk/leadCalls` `callLead`, automatic, `why: "smartbook"`), so the desk's checks, caps and hours apply, and there's never a second automatic call. `/api/twilio/voice/smartbook/*` and token kind `smartbook` are gone.
  - If the call falls outside the automatic hours (9 AM–7 PM, Monday to Saturday), it waits for them, up to 16 hours, or is skipped.
  - Settings' "can't call yet" line uses `leadCallReadiness`.
- **The desk's call to a SmartBook lead** — any of them: SmartBook's, "Have the AI desk call", Call new leads — learns from `lib/smartbook/phone` `leadCallExtras`:
  - the times sent, plus `request_time` and `not_interested`;
  - a voicemail that points at the times;
  - no "we tried calling" text, since they already have the times;
  - `do_not_call` stops SmartBook too.
  - `leadForToken` gives the lead on kind `lead` while SmartBook is scheduling it, so open_times and book_visit act on the conversation.
- **Reached:** a reply to SmartBook marks the lead contacted (`lib/leads/contacted`, the time only), so Call new leads leaves it alone. A visit booked through SmartBook moves the lead to CONTACTED, as one booked on the calendar does.
- **The lead page:** his Visits & calls card, then SmartBook's card, in his `side` column.
