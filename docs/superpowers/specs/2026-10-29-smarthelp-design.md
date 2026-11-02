# SmartHelp — design

**Date:** 2026-10-29
**Status:** draft for the owner's approval
**Surfaces:** every signed-in app page (desk sidebar, handheld drawer / More, the `(mobile)` pages) · `/admin/support`
**Builds on:** the support handbook (`lib/support/handbook.ts`), the support AI's own OpenAI client (`lib/support/aiSupport.ts`), the first-estimate tour's spotlight (`lib/onboarding/tour-paths.ts`, `components/v3/onboarding-tour`, `data-tour` targets), the Help composer (`components/v3/support-widget`)

## Why

The owner (2026-10-29): *"an option called SmartHelp … a different color … in the sidebar … where the AI answers all the questions — how everything works in JobFlex, where to look, how the estimators work … pre-loaded buttons the contractor can click, like how to set up the AI desk, SMS, the estimator link, and most features that need a little knowledge, and the AI tells him how to do it, one, two, three, four … super smart."*

JobFlex has grown far past what a new contractor can find alone: eight estimating tools, CRM, calendar and booking, an AI phone desk, texting, payments, website estimators, crew apps. There are no "how do I…" requests yet, but paid sign-ups now arrive daily and every one of them meets this. SmartHelp answers before anyone has to file a ticket, and it shows them where to click instead of describing it.

## What it is

A colored **SmartHelp** row in the sidebar opens a panel. In the panel:

1. **An ask box** — any question, in the contractor's own words, in any language (it answers in the language asked).
2. **Guide buttons** — pre-written, step-by-step guides for the setups that need a little knowledge, grouped "Set it up" and "How it works". A tap answers at once: numbered steps, no AI call.
3. **Answers as steps.** Every answer (a guide or the AI's) is numbered steps. A step that happens on a page carries **Open** (go to that page; the panel stays open) and, where the page has a known target, **Show me** (go there and light the exact button or field, the tour's spotlight).
4. **"Still stuck? Ask a person"** at the foot — opens the existing Help composer with the question already in it, so it becomes a normal support ticket.

## Decisions

| Question | Decision |
| --- | --- |
| Where the row sits | **First row of the sidebar**, above "Work", on the desk sidebar (both shells that draw one: `components/layout/Sidebar.tsx` and the blueprint shell's `sidebar.tsx` via `nav-map.ts`), the handheld drawer, and the tab bar's More sheet below 768px. |
| Its look | **A solid ink block** (owner, 2026-10-29: "a", from three mockups): the one filled row in the sidebar — `--ink` fill, white bold "SmartHelp", a white square holding the Lucide `Sparkles` icon in ink, a square-cornered "ASK" tag in a 1.5px white frame, and a hard 3px `--accent` offset shadow. Flat, square, no gradient, no pill and no status colour, so it keeps DESIGN.md (an amber gradient was shown and set aside because DESIGN.md reserves amber for warnings and bans gradients and pills). The panel's header repeats the block. Record the row in DESIGN.md's sidebar section as an owner-approved entry. |
| The panel | **A right-hand panel, 380px**, beside the page (the page is not covered or dimmed). Below 768px a **bottom sheet** (~85% height). It stays open across page changes inside the app. Esc / ✕ closes it. |
| Guide buttons vs. AI | **Guides are pre-written data, not AI.** A guide tap is instant, free and always the same. The AI answers only typed questions. |
| What the AI knows | **The support handbook's customer-facing text** (every `### Internal — for the team` block stripped before it reaches the prompt), **the guides**, and **this person's context** (below). Nothing else; it says so when it doesn't know and offers "Ask a person". |
| The person's context sent with a question | Current page path, role, plan name and which pages the plan locks, and a short **setup state** (below). No client, lead or money data. |
| Setup state | Read-only facts that make answers and button order personal: company profile complete (`lib/leadSetup`), AI desk set up / number live, texting number verified, a payment processor connected (`lib/payments/connections`), online booking on, website estimators on, team members invited, first proposal sent. Guides for unfinished setups float to the top with a dot; finished ones show ✓. |
| Roles | **Everyone signed in sees SmartHelp.** Guides and Open/Show me buttons only point at pages the role may open (`ROLE_ROUTE_GATES` / `isPathAllowed`); a guide for a page the role can't open says "Ask your account owner to …" instead. A page the plan locks says which plan has it, with **Upgrade** for owners. |
| Who pays for the AI | **The platform**, through the support AI's own unmetered client (same key, `resolveOpenAIModel`, `samplingOptions`) — never the contractor's trial AI budget (`lib/trialMeter`). |
| Limits | 20 questions per person per hour, 300 per organization per day (SyncState rate keys, like `rl:support:*`); over the limit, the box says when it reopens and points at the guides and "Ask a person". |
| Memory of the chat | The open conversation lives in the browser tab (sessionStorage); the AI gets the last 6 turns. Nothing is saved to the account. |
| What the owner learns | Every typed question is logged (SyncState, no schema change): text, page, role, plan, answered / "didn't help" / sent to a person. `/admin/support` gets a **SmartHelp** tab: newest questions, the top unanswered ones, and the 👍/👎 counts per guide — so the owner sees what contractors struggle with and which guide to add next. |
| Answer feedback | 👍 / 👎 under each answer. 👎 offers "Ask a person". |
| Questions only a person answers | **SmartHelp follows the support AI's own rules** (`SUPPORT_AI_RULES`, `commitsMoneyOrData` in `lib/support/aiReply.ts`) — the owner's rules for answering customers. Cancelling or downgrading, refunds, credits, discounts, deleting the account or data, ownership changes, security or legal matters, an angry message, or an answer it is not sure of: **no steps**. It says a person will help and puts **Ask a person** first, pre-filled. The cancel flow stays the owner's (trial-extension and "Today's price — yours for life" cards first, commit 111e5667); SmartHelp never short-cuts it with 1-2-3 cancel steps. Shared from one place, not copied (my call). |
| What "Ask a person" does | **It reaches a person** (my call — the button says so). The ticket is filed through the Help composer as usual, marked as coming from SmartHelp and carrying what SmartHelp already said. The support AI still reads it but **only drafts** (as on a `needsHuman` ticket) — it never auto-sends the same answer back; a person sends. This is the one change to the support AI: its answer gate learns the SmartHelp mark. |
| What the log keeps | Company, person, role, plan, page, the question, **SmartHelp's answer**, the outcome (👍/👎/asked a person) and the time — so the owner can follow up with a contractor who struggled and catch a wrong step. Platform admins only; kept 90 days (my call). |

## The guides (first set)

Each guide is data: `{ id, title, group, icon, roles?, when? (setup-state key), steps: [{ text, open?: path, show?: targetId }] }`, in `src/lib/smarthelp/guides.ts`. **Every step's words, page paths and button names are written from the code as it is on main at build time**, the way the handbook was.

*Set it up:* the AI desk (describe your business → review the marked answers → booking hours → number and call forwarding) · texting / SMS (number, verification) · estimators on your website (the link and the embed) · get paid online (Stripe / Square / Stax, ACH) · online booking page · company profile so leads can find you (address, trades) · invite your team and crew · your logo and colors on proposals · bring in your own leads (Facebook and others the code supports) · reviews.

*How it works:* the roof estimator (how the roof is measured, when a report is used) · the fence estimator (drawing on the map) · the HVAC estimator (Manual J-style sizing — never "Manual J") · Deck Studio (photo → 3D wall, sending a design to a client) · Smart Proposal for any job · blueprint and video estimates · send a proposal and get it signed · projects, change orders and invoices · the calendar and jobs for the crew.

The builder may merge, split or rename these after reading the code; the set above is the minimum.

## "Show me"

Reuses the tour's spotlight, not a second one. Targets are attributes on the real elements (`data-tour` exists on 48 elements; SmartHelp adds the ones its guides need, on the desk and the handheld markup alike). Open/Show me navigates with the app router, waits for the target, scrolls it into view and lights it until the person clicks it or moves on. If the target isn't on the page (a role, a plan, a changed page), the step's text still names the button, and the panel says "Look for **<label>** on this page".

## Keeping it true

- A QA check (`qa/tests/logic/smarthelp.check.ts`) fails the build-time checks when a guide's `open` path is not a real route, a `show` target id is not found in `src/`, or the stripped handbook still contains "Internal".
- The handbook is brought up to date with main **as part of this work** — it was written 2026-10-15 and misses the website estimators, the house estimators, the AI desk's intake and reserved hours, Deck Studio from a photo, the plan changes since. Its header rule stands: a feature change updates its section in the same commit; SmartHelp's guides join that rule.

## Goals

- A contractor who taps a guide gets correct, numbered steps and can reach each step's page in one tap.
- A typed question about anything JobFlex does gets a right answer in their language, or an honest "I don't know — ask a person".
- The owner sees what people ask.

## Non-goals

- SmartHelp does not change anything in the account (no "do it for me").
- No voice. No homeowner, worker-link or public pages. Not inside `/admin`.
- No replacement of the Help composer or the support AI; SmartHelp hands over to them (the one change: a SmartHelp hand-off is held for a person).
- No schema change.

## Anti-goals (a failure even if it works)

- Steps that name a button, page or price that doesn't exist — worse than no answer.
- Leaking the handbook's internal code map, env var names or another customer's anything.
- Charging the contractor's trial AI budget for help.
- A panel that covers the page they're trying to follow the steps on, or a launcher that fights the Help plate or the handheld create button for the same corner.

## Left to the builder

The panel's exact layout and motion inside the ink-block identity above and DESIGN.md; the guide icons; how setup-state facts are read (one server read per panel open, cached briefly); the prompt wording; the AI's answer format (structured steps with optional `open`/`show`, validated against the guide/route lists before display — unknown paths are dropped, not shown); the admin tab's layout; the QA walk (desk + 390px phone).
