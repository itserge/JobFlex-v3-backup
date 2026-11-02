# SmartBook — design

> **Joined with main (2026-10-31):** Facebook leads now come through main's Meta auto-import (`lib/meta/autoImport`, every 5 minutes, its own switch), and SmartBook's one call is the AI desk's own call to a lead (`lib/aiDesk/leadCalls`). See the plan's last section.

**Date:** 2026-10-31
**Status:** draft for the owner's approval
**Surfaces:** Settings → SmartBook · the calendar's Requests · the lead page (desk and handheld) · the customer's pick-a-time page `/b/[token]` (short, for the text) · texts and emails both ways · the AI desk on a call
**Builds on:** Meta connect (`lib/meta/connections.ts`, one Page row per workspace, b7834736), the booking engine (`availableSlots` in `lib/booking.ts`; `deskAvailabilityFor`, `createBooking` in `lib/bookingBook.ts`), the AI desk (`openTimes` / `bookVisit` in `lib/aiDesk/liveCall.ts`, the tools in `voice/call.mjs`), texting (`sendText` / `textOffice` in `lib/sms/send.ts`, inbound `api/twilio/sms`, consent `lib/sms/consent.ts`), email (`sendOrgEmail`), the OpenAI client (`lib/sdk/openai.ts`)

## Why

The owner (2026-10-31): *"the calendar from JobFlex would offer availability by text or email or calling from AI desk … to schedule the appointment that contractor will come and visit … when customer agrees … let us know by text, email … if customer offers his date and time … 'let me check on that, and we'll get back to you shortly' … we confirm if we can or not, or we need to reschedule … then you go back to the client … super smart, convenient … easy for clients and easy for contractors."* And: *"No leads come automatically. Meta."*

Today, on main:
- **No new lead is contacted by anything.** A Facebook lead only appears when someone presses Import (`importMetaBatch`); nothing texts, emails or calls it.
- A customer's text reply is forwarded to the office as a text and logged, **not tied to the lead** (the inbound route matches clients, not leads).
- Customers book only open times (booking page, AI desk). **There is no "the customer asked for another time → the contractor confirms" step.**

The first company to answer a lead usually gets the job. SmartBook answers within about a minute, around the clock (quiet hours respected), and it doesn't let go until there is a visit on the calendar or a clear "no".

## The customer's side

1. **A lead arrives.** A Facebook lead comes in within about 2 minutes (see *Meta leads arrive by themselves*), or from a website estimator, the Lead Center, or a message left with the AI desk.
2. **Within a minute: a text and an email.** At night (21:00–08:00 company time) the email goes at once and the text waits until 08:00.
   > Hi Sarah, it's Mike's Roofing — thanks for asking about a roof replacement. We can come by for a free estimate:
   > 1) Tue Nov 4, 10–12
   > 2) Wed Nov 5, 1–3
   > 3) Thu Nov 6, 8–10
   > Reply 1, 2 or 3, or tell me a day and time that suits you better. More times: jobflex.app/b/x7k2 · Reply STOP to opt out
   
   The email says the same, each time is a button, with **Other times** and **Suggest a time** buttons. Every button and the text's link open the pick page, which shows all open times and a box for the customer's own time. Pages ask for a tap to confirm, so a mail scanner opening links books nothing.
3. **The customer replies in their own words, in any language, and gets answers in that language.**
   - **Picks one** ("2", "Wednesday works", "the afternoon one"). Booked at once: *"You're all set: Wed Nov 5, arriving 1–3 pm at 123 Main St. Reply here if anything changes."* The contractor is told.
   - **Suggests their own time** ("can you do Saturday morning?"): *"Let me check that with Mike and get back to you shortly."* The contractor is asked (below). Whatever the contractor answers goes back to the customer.
   - **Says what suits them** ("mornings are better", "anytime after 3"): new times that match.
   - **Asks a question.** Answered only from what the company already wrote for its AI desk (greeting, FAQ, knowledge). It never gives a price, promise or detail that isn't there. Otherwise: *"Good question — I'll pass that to Mike."* The contractor gets the question, and the conversation goes back to the times.
   - **Not interested / wrong number:** a polite close and no more messages. The lead is marked.
   - **STOP:** the existing opt-out.
   - **Angry, complicated, or past 12 AI replies:** handed to the contractor (*"Sarah wrote: … — reply here and I'll pass it on, or call her"*). SmartBook goes quiet on that lead.
4. **No reply:** one nudge after 4 business hours, one the next day with fresh times, then it stops with a *No reply* status. The contractor can restart it. With calls on, one AI call goes out after 2 business hours (decision 1).
5. **They call the company number.** The AI desk knows the caller (the lead's phone) and the times they were offered. It can book one of those or any open time. It can also take their own time as a request — a new desk tool, `request_time`, that runs the same confirm step.
6. **Later changes.** "Can we move it?" brings new times; a pick that is free is booked at once. "Cancel" cancels the booking, and the contractor is told.

## The contractor's side

- **Booked:** a text and an email. *"📅 SmartBook booked Sarah Lee — roof replacement — Wed Nov 5, 1–3 pm — 123 Main St (Facebook lead)."* On the calendar it is a normal appointment, marked "via SmartBook" like "via AI desk" today (`aptSource`).
- **The customer asked for a time:**
  > Sarah Lee (Facebook · roof replacement) asks for Sat Nov 8 at 9 am. Your calendar is free then. Reply YES to confirm, NO to offer her other times, or reply another day and time.

  When the time isn't free, the text says why: *"You have the Johnson job 8–12 then."*
  - **Replies in plain words** are understood: "yes", "ok", "can't — monday 2pm?", "sat 11 instead". When several requests are waiting, each text carries its number (#2) and a bare "yes" gets asked "which one?".
  - **The email** has Confirm · Offer other times · Suggest a time.
  - **The calendar's Requests and the lead page** show the same card with the same three buttons. The first person to answer wins; everyone else sees it's answered.
  - **No answer in 1 business hour:** one reminder. The customer hears *"Still checking — thanks for your patience"* after 3 business hours. After 24 hours the customer is offered open times again.
- **The whole conversation is on the lead's timeline** (desk and handheld), both ways.
- **The leads list shows a status:** Times sent · Needs you · Booked · No reply · Not interested · Handed to you.
- **The contractor can always step in.** *Pause SmartBook* sits on the lead page. A text or email the contractor sends to the lead from the app also pauses it, because a person took over.

## Decisions (owner, 2026-10-31)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Does SmartBook phone leads? | **One AI call if a lead hasn't answered the text or email in 2 hours**, in business hours. It is off until the contractor switches it on, uses the plan's AI desk minutes, and goes only to leads who agreed to calls (US rules treat an AI voice like a robocall). It reuses the outbound-call path that JobFlex's own outreach already uses (`placeCall`, answering-machine detection) and the voice server, with SmartBook's tools: `open_times`, `book_visit`, `request_time`, `take_message`, `end_call`. A voicemail gets a short message and the text's link, and nothing is booked. |
| 2 | Who is texted? | **Only leads who agreed:** a ticked consent box on the Facebook form (Meta's "custom disclaimer"), on a website estimator (every one already requires "<company> may call, text or email me about this …") or on the booking page, or a Lead Center lead (consent through `LeadSource`). Settings shows the contractor the exact words to add to the Facebook form, and SmartHelp gets a guide for it. Everyone else gets the email at once, with *"Prefer texts? Tap here"*: the tap records consent (`recordTextConsent`) and texting starts. Consent is kept per company and phone, as today. |
| 3 | Which plans? | **Every plan and the trial.** Texts and call minutes come out of the plan's allowances, as every text and desk call does today; when they run out, SmartBook continues by email and says so in Settings. |

## Settings — Settings → SmartBook (its own item: Settings has no Leads section)

| Setting | Default |
| --- | --- |
| SmartBook on | Off. The owner turns it on and sees a preview first. |
| Which leads | Facebook, website estimators, Lead Center, AI-desk messages: on. Added by hand or CSV: off (often old lists). Those leads get an **Offer times** button on the lead page instead. |
| How | Text and Email on; "Call if no reply in 2 hours" off (decision 1). |
| The visit | Which booking visit type (the first "estimate" one), the arrival window, 3 times offered, earliest per the booking lead time. Times come from the same hours the AI desk offers (`deskAvailabilityFor`: open hours or reserved desk hours). |
| A time the customer suggests | **"Ask me first"** (the owner's flow). Or *"Book it if my calendar is free, then tell me"*. |
| Who is asked and told | Through notification preferences: one new key, `smartbook-request` (a time to confirm, a question, a hand-off — owner, office and the rep on the lead). A booked visit uses the keys every booking uses (`appointment-booked` text, `booking-online` email, which says "SmartBook booked"). |
| The first message | Editable with {first name}, {company}, {service}, {times}, plus a live preview. |
| Send me a test | Runs the whole conversation with the owner's own phone and email, the owner as the customer: real open times, nothing booked or held, nobody else told; for two hours their texts go to the test. |

## What makes it smart

- **It spreads the times out.** It offers the soonest open time, another day, and the other half of the day. One lead never gets three Monday mornings.
- **It never offers one time to two people.** An offered time is held for that lead for 2 hours while other times exist. Every time is re-checked at the moment it's booked; one that went meanwhile gets *"That one just got taken — how about … or …?"*
- **It understands people the way they write.** "next Tuesday after 3", "anytime Friday", "2", in any language, with answers in that language.
- **It checks the calendar for the contractor.** Every customer-suggested time comes with the contractor's calendar at that time.
- **The contractor answers in a text, in plain words.** No app needed to confirm.
- **One assistant across text, email, the pick page and the phone.** Whatever the customer uses, it knows the conversation.
- **It stays polite and legal.** It keeps quiet hours, honours STOP and consent, stays inside the plan's text allowance, and says it's the company's scheduling assistant.

## Meta leads arrive by themselves

- **A new 2-minute cron** reads each connected workspace's Page for leads newer than its last check. It uses the stored Page token and the permissions already approved: no new Meta review.
- **They become the same rows Import makes**, deduplicated by `WebhookEvent`, so Import and the cron never make a lead twice. The Import button stays, for history.
- **Facebook's time of the lead and the form's consent-box answer are kept** (`custom_disclaimer_responses`), for decision 2.
- **New Facebook leads tell the contractor**, as website leads do today (`notifyLeadCreated`). They also start SmartBook when it is on.
- **The plan's lead limit reached:** leads wait, and the owner is told once a day.
- **Later, if 2 minutes is too slow:** Meta's instant push needs the `pages_manage_metadata` permission and another review.

## Data — no schema change

The project's own way, the same as Meta connect, the AI desk settings and SmartHelp: records live in the existing `SyncState` key/value table.
- `smartbook:settings:<org>` holds the settings.
- `smartbook:<org>:<lead>` holds each conversation: status, offered times, the customer's request, counters, the next step's time, and the pick-page token.
- `smartbook:phone:<org>:<E164>` lets a reply find its lead.
- `smartbook:hold:<org>:<time>` holds an offered time.

The timeline is `ActivityEvent` rows with `leadId` (TEXT / SMS_REPLY / EMAIL / BOOKING_NEW). A booking is made by `createBooking`, so the Lead, Appointment and Booking rows, the manage link, reminders and the office's calendar all work as today.

New server code (CLAUDE.md: needs the owner's approval):
- `lib/smartbook/*`
- `actions/smartBook.ts`
- the cron `/api/cron/smartbook` (every 2 minutes: the Meta check and the steps that are due)
- the inbound text route learns leads and contractor replies
- the desk's call brief and its one new tool
- the page `/b/[token]`

## The AI

- **One model call per incoming message.** It reads the message, the conversation, the offered times and the company's desk answers, and returns JSON: what the person wants, which time, a proposed day or time range, the language, and a reply.
- **Code decides; the AI only understands and words.** Times come only from the booking engine; the AI never books or promises by itself.
- **The platform pays for it**, through the same client as the desk's profile writer. The cost is fractions of a cent per message.
- **Texts count against the plan's text allowance** as every text does today.
- **Limits:** 12 AI replies per conversation and 200 new conversations per company a day.

## Not in this build

- **Reading typed email replies.** The Gmail grant is send-only, so emails work through buttons and the pick page. A typed reply still lands in the contractor's inbox, as now.
- Route-aware offers (prefer the days the crew is already near the customer).
- Meta's instant push, and Google Calendar sync.

## Tested

- **Logic checks:** picking and spreading times, holds, the conversation's steps, and reply understanding against a fixture model.
- **A walk on the local stand** (fake model, no real texts), on desk and at 390×844. The steps:
  1. A fake Facebook lead arrives and a text goes out.
  2. "2" books the visit.
  3. "Saturday 9?" sends the contractor a text.
  4. "yes" sends the customer a confirmation.
  5. The pick page and the desk's `request_time` do the same.
