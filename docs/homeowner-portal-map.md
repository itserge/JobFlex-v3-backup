# Homeowner portal — map (2026-10-30)

The homeowner's own pages, before the Blueprint rebuild. No account and no
password anywhere: the key in the URL is the login (lib/home/portal header).

## Routes

| Route | File | What it is |
| --- | --- | --- |
| `/home` | `src/app/(portal)/home/page.tsx` + `find-home.tsx` | "Lost the link?" — email field, `emailHomeLink` |
| `/home/[key]` | `src/app/(portal)/home/[key]/page.tsx` | The whole dashboard on one page: welcome band (serif name), stats (Projects / Hired / Invested / With us since), quick links, Needs you, projects, Done on your house, roof ranges, Plan ahead; rail: calendar (2 month grids), contractors, memberships, documents, activity, details |
| `/home/[key]/calendar.ics` | `[key]/calendar.ics/route.ts` | Planned projects (all-day) + contractors' visits (timed) as .ics |
| `/request/[token]` | `src/app/(portal)/request/[token]/page.tsx` + `reroute.tsx` | One project, reached by the request's own token (emails link here); status, 4 steps, contractor, change orders, proposals with lines, visits, "Not the right fit?", what they asked for, activity |
| `/homeowner?home=&plan=&with=` | `src/app/(marketing)/homeowner/*` → `components/v3/homeowner-landing/wizard`, `components/v3/mobile-homeowner` | The public intake wizard prefilled from the home (describe → clarify → scope → contact → done); price box `/homeowner/price/[trade]` |
| `/portal/q/[publicId]` | existing quote page | Read, accept, pay a proposal (Approve happens here) |
| `/co/[token]`, `/plan/[token]`, `/review/[token]`, `/book/[slug]` | existing | Change order, service plan, review, booking |

## Components (all in `src/app/(portal)/home/[key]/`, one `home.module.css`)

`planner.tsx` (Plan ahead), `calendar.tsx` (month grids + upcoming),
`folder-box.tsx` (photos & files, button only, no drop), `message-box.tsx`
(note to the contractor), `details-form.tsx` (your details + email me the link),
`LiveRefresh` / `LocalTime` from `components/portal/live-time.tsx`.

## Server actions and API (unchanged by the rebuild)

- `actions/homePortal`: `emailHomeLink`, `emailMyHomeLink`, `updateHomeDetails`, `addHomePlan`, `updateHomePlan`, `sendHomeMessage`
- `actions/homeFiles`: `deleteHomeFile`; uploads via `lib/home/uploadClient` → `/api/home/[key]/upload-ticket` | `upload-token` (Blob) → `/api/home-file/[id]`
- `actions/homeownerPortal`: `requestAnotherContractor`
- `actions/homeowner`: `submitHomeownerRequest`, `suggestHomeownerQuestions`, `suggestHomeownerScope`
- Data: `loadHomeDashboard` (lib/home/portal), `buildRequestPortal` (lib/requestPortal), `loadWizardPrefill`

## Project states (lib/requestPortal `status2` + what decides them)

| status2 | When | Old label |
| --- | --- | --- |
| WAITING | no current contractor (lead MATCHING / OFFERED / MANUAL_QUEUE, or after "find another") | Finding a pro |
| MATCHED | a contractor took it, no quote yet (or only declined ones) | Matched |
| PROPOSAL | the current contractor sent a quote (NEW / OPENED / DECLINED) | Proposal ready |
| HIRED | a current quote ACCEPTED or PAID | Hired |
| DONE | a current quote COMPLETED | Done |

Also per project: change orders waiting (SENT), upcoming visits (appointments
SCHEDULED), payments (paid / remaining / next due, online or "they'll tell
you"), photo requests from the contractor, messages sent.

New six-step bar: Sent → Contractor matched → Quote received → Approved →
Scheduled (approved and a visit on the calendar) → Done.

## Phone

One column below 960px; top nav hidden below 720px (only the "+ New project"
button stays); quick links lose their captions below 640px; the calendar
still draws two month grids on the phone.

## Off-system (what the rebuild removes)

- Serif title: `--h-serif` (Iowan / Palatino / Georgia) on the welcome name.
- Rounded everything: `--h-r` cards, 7–10px buttons, 999px pills (stamps, chips, count, "next" line), rounded message bubbles.
- Own palette (`--h-*`), gradient welcome band, blue drop shadow on the hero button, soft 1px borders.
- Jargon: "pro", "matched", "proposal", "routing" words in buttons and stamps; INVESTED / HIRED counters showing 0.
