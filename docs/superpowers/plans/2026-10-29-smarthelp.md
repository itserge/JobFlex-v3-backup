# SmartHelp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SmartHelp row at the top of every JobFlex sidebar opens a help panel: instant step-by-step guides, an AI that answers any how-to question from the handbook, Open / Show me buttons on each step, and a hand-off to a person.

**Architecture:** Pure modules in `src/lib/smarthelp/` (types, page registry, guides, ordering, answer contract, prompts) carry every rule and are tested by `qa/tests/logic/*.check.ts` scripts. One server module reads the person's context and calls the model through the support AI's unmetered client; server actions in `src/actions/smartHelp.ts` serve the client panel. The panel mounts inside `SupportWidget`, so it exists everywhere the Help composer exists; launchers sit in all five nav surfaces.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, zod 3, openai 6.16, lucide-react, Prisma (SyncState only), tsx-run QA checks.

**Spec:** `docs/superpowers/specs/2026-10-29-smarthelp-design.md` (read it first; this plan argues from it).

**Worktree:** `~/Documents/JobFlex-smarthelp`, branch `smarthelp` off `origin/main` 5d3bb418. Nothing is pushed without the owner's explicit "push".

## Global Constraints

- **No Prisma schema change.** Everything new is stored in `SyncState` (`key` → `cursor` string).
- **The repo is PUBLIC.** No customer data, secrets, env var values or personal addresses in code, guides, handbook or tests.
- **DESIGN.md:** no gradients, rounded pills, glass, blurred shadows; square corners; hairline ink frames; Lucide icons (`lucide-react`); status colours only for state. The SmartHelp block: `--ink` fill, white bold "SmartHelp", white square with Lucide `Sparkles` in ink, square "ASK" tag in a 1.5px white frame, hard `3px 3px 0 var(--accent)` shadow.
- **Words:** HVAC sizing is "Manual J-style", never "Manual J". Button and page names in guides are copied from the code as they are on main.
- **Numbers:** panel 380px wide at ≥1024px; bottom sheet 85dvh at ≤768px; 20 questions per person per hour; 300 per organization per day; the AI gets the last 6 turns; question log kept 90 days; confidence below 60 → no steps, "Ask a person".
- **The AI is the platform's cost:** never `getOpenAI()` / `lib/trialMeter`; always the unmetered client (Task 5).
- **Person-only topics** (cancel/downgrade, refunds, credits, discounts, deleting account or data, ownership, security, legal, chargebacks, passwords/codes, "a person"): no steps, ever; Ask a person first.
- **Production safety:** `.env.local` / `.env.production.local` are PRODUCTION. Never run a DB-writing script against them. QA walks run on a local stand with its own database (recipe: `~/.claude/projects/-Users-dmitriyapetenok-Documents-SmartSpace-Pro/memory/jobflex-local-stand.md`).
- **Commits:** on `smarthelp` only, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`.
- **QA check style:** `qa/tests/logic/<name>.check.ts`, a `check(name, ok, extra)` counter and `process.exit(bad ? 1 : 0)` (see `qa/tests/logic/support-ai.check.ts`). Run with `NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/<name>.check.ts`.

## Review Focus

1. **A question in another language** (Spanish, Russian) → the answer is in that language, but button and page names stay exactly as JobFlex prints them. *Test: Task 4, prompt carries the rule; Task 10 walk asks in Spanish.*
2. **A role that can't open the page** (an INSTALLER or SALES asking how to set up the AI desk) → no Open / Show me buttons on that step; it says "Ask your account owner to …". *Test: Task 1 `stepView` with `role: "INSTALLER"`.*
3. **The model invents a page or button** (`/dashboard/ai-desk`, `show: "save-button"`) → that Open / Show me is dropped and the step's text stays; never a link to a 404. *Test: Task 4 `cleanAnswer`.*
4. **The model fails** (timeout, error, malformed JSON) **or the limit is hit** → a plain message, the guides still work, Ask a person still works; the panel never breaks. *Test: Task 4 schema mends junk; Task 5 `askSmartHelp` error paths; Task 10 walk with the fake model returning garbage.*
5. **Person topics said indirectly** ("stop charging my card", "I want my money back", "close my account", "delete everything", Spanish "cancelar mi suscripción") → person, never steps — both before the model (`personTopic`) and after it (`commitsMoneyOrData` on the produced text). *Test: Task 4.*

---

### Task 1: The pure core — types, page registry, guide ordering, step gating

**Files:**
- Create: `src/lib/smarthelp/types.ts`, `src/lib/smarthelp/pages.ts`, `src/lib/smarthelp/view.ts`, `qa/lib/appRoutes.ts`
- Test: `qa/tests/logic/smarthelp.check.ts`

**Interfaces:**
- Produces (types.ts):
  - `type SetupKey = "profile" | "aiDesk" | "texting" | "payments" | "booking" | "website" | "team" | "proposalSent"`
  - `type SetupState = Record<SetupKey, boolean>`
  - `type HelpStep = { text: string; open?: string; show?: string }` — `open` is an app path (may carry `?query`/`#hash`), `show` a `data-tour` target name.
  - `type Guide = { id: string; title: string; group: "setup" | "how"; icon: string /* lucide-react export name */; steps: HelpStep[]; needs?: SetupKey; feature?: "booking" | "website" }`
  - `type HelpContext = { role: string | null; plan: string | null; lockedHrefs: string[]; setup: SetupState; features: { booking: boolean; website: boolean }; page: string }`
  - `type GuideCard = { id: string; title: string; group: "setup" | "how"; icon: string; state: "todo" | "done" | "none" }`
  - `type StepView = HelpStep & { blocked?: "role" | "plan" }`
- Produces (pages.ts): `HELP_PAGES: ReadonlyArray<{ path: string; name: string }>` — every page the AI may link (≈40: Overview, each estimator, Proposals, Clients, Leads, Projects, CRM, Calendar, Online booking, Jobs, Workers, Company, Company team, AI desk, Texting, Messages, Reviews, Reports, Financials, Settings and each settings pane used by guides, Subscription). `pathOf(open: string): string` strips `?…` and `#…`. `isHelpPage(open: string): boolean`.
- Produces (view.ts): `guideCards(guides: Guide[], ctx: HelpContext): GuideCard[]`; `stepView(step: HelpStep, ctx: HelpContext): StepView`.
- Produces (qa/lib/appRoutes.ts): `appRoutes(root = "src/app"): string[]` (route patterns from every `page.tsx`, route groups `(x)` removed, `[id]` kept) and `isRealRoute(path: string, routes: string[]): boolean` (`[seg]` matches any one segment).

- [ ] **Step 1: Write the failing checks** in `qa/tests/logic/smarthelp.check.ts`:
  - `guideCards`: setup guides with `needs` false come first with `state: "todo"`, in registry order; then setup guides without `needs` (`"none"`); then `needs` true (`"done"`); "how" guides keep registry order after them. A guide with `feature: "booking"` is absent when `ctx.features.booking` is false.
  - `stepView({ text: "x", open: "/dashboard/phone?tab=settings" }, { …ctx, role: "INSTALLER" }).blocked === "role"` (`roleMayOpen` from `lib/orgContext` is false for INSTALLER on `/dashboard/phone`); for `role: "OWNER"` `blocked` is undefined.
  - `stepView` with `lockedHrefs: ["/dashboard/phone"]` → `blocked === "plan"` (`isCustomBlockedPath` from `lib/customPlan`).
  - Every `HELP_PAGES[i].path` satisfies `isRealRoute(path, appRoutes())`; paths are unique.
  - `isHelpPage("/dashboard/settings?pane=payments") === true`; `isHelpPage("/dashboard/ai-desk") === false`.
- [ ] **Step 2: Run it** — `NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp.check.ts` → fails (modules missing).
- [ ] **Step 3: Implement** the four files. `view.ts` is client-safe (no `server-only`, no `db`): import `roleMayOpen` only if `lib/orgContext` is client-safe; if it is not, import `ROLE_ROUTE_GATES` + `isPathAllowed` from `lib/roleRoutes` and repeat `roleMayOpen`'s one line. `appRoutes` walks the directory with `fs`.
- [ ] **Step 4: Run it** → `all passed`.
- [ ] **Step 5: Commit** — `feat(smarthelp): core types, page registry, guide ordering, step gating`.

### Task 2: The guides, written from the code, with their Show me targets

**Files:**
- Create: `src/lib/smarthelp/guides.ts`
- Modify: the pages the guides point at — add `data-tour="<name>"` to each element a `show` names, on the desk markup and the handheld markup alike (nav rows already carry `data-tour="nav:<href>"`; reuse those).
- Test: `qa/tests/logic/smarthelp-guides.check.ts`

**Interfaces:**
- Consumes: `Guide`, `HelpStep`, `SetupKey` (Task 1); `appRoutes`, `isRealRoute` (Task 1); `isHelpPage` (Task 1).
- Produces: `GUIDES: Guide[]`; `GUIDE_TARGETS: ReadonlySet<string>` (every `show` used by a guide).

- [ ] **Step 1: Write the failing checks:** ids unique; 2–6 steps each; titles ≤ 40 characters; every `open` is `isHelpPage` and a real route; every `show` appears in `src/` as `data-tour="<show>"` or is a `nav:<href>` whose href is in `nav-map.ts`; the setup group contains guides with `needs` `"aiDesk"`, `"texting"`, `"payments"`, `"website"`, `"booking"`, `"profile"`, `"team"`; no guide text contains "Manual J" unless followed by "-style"; no text contains `http`.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Research, then write the guides.** For each guide in the spec's "first set", read the page's component and copy the real labels. Known starting points: AI desk `/dashboard/phone?tab=settings&step=business|booking|numbers|voice`, button "Describe your business" (`desk-brief.tsx`), tab "Phone & forwarding"; texting `/dashboard/texting`, "Get your number" → "Register my number"; payments `/dashboard/settings?pane=payments`; website estimators `/dashboard/settings?pane=website`; booking `/dashboard/booking`, switch "The booking page is on" (feature `booking`); profile `/dashboard/company#company-name`; team `/dashboard/company/team`, "Invite" → "Send invite"; first proposal: the estimators' Send. Steps describe what the person sees ("You'll see …").
- [ ] **Step 4: Add the `data-tour` targets** the guides name (one attribute per element; no other change to those pages).
- [ ] **Step 5: Run** both checks → `all passed`.
- [ ] **Step 6: Commit** — `feat(smarthelp): first guides from the code + their targets`.

### Task 3: The handbook, brought up to date, and its customer-facing cut

**Files:**
- Modify: `src/lib/support/handbook.ts` (sections only; keep its header rules)
- Create: `src/lib/smarthelp/knowledge.ts`
- Test: `qa/tests/logic/smarthelp-knowledge.check.ts`; keep `qa/tests/logic/support-ai.check.ts` green (adjust only its size bound if the handbook grows past it).

**Interfaces:**
- Produces: `customerHandbook(): string` — `SUPPORT_HANDBOOK` with every `### Internal — for the team (not for customers)` block removed up to the next `##`/`###` heading of equal or higher level.

- [ ] **Step 1: Write the failing checks:** the cut contains no "Internal —", no "Code map", no `src/`, no `lib/`, no `actions/`, nothing matching `/\b[A-Z][A-Z0-9_]{3,}_(KEY|SECRET|TOKEN|URL|ID)\b/`; it still contains "## Accounts & access"; it mentions "Website estimators", "Describe your business", "Deck Studio" photo, and the AI desk's booking hours (the areas added in Step 3).
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Update the handbook** for what shipped since 2026-10-15 (`git log --since=2026-10-15 --oneline origin/main -- src/app src/components src/actions src/lib` is the reading list): website estimators, house estimators/Lead Center as contractors see it, AI desk intake presets and reserved hours, Deck Studio from a photo, Deck Studio add-on and plan prices as the catalog has them, anything else a contractor meets. Same voice and format as the existing sections; "(verify)" where the code can't settle it.
- [ ] **Step 4: Implement `customerHandbook()`**.
- [ ] **Step 5: Run** both checks → pass.
- [ ] **Step 6: Commit** — `docs(support): handbook up to date with main; smarthelp: customer-facing cut`.

### Task 4: The answer contract, the prompts and the person-topic guard

**Files:**
- Create: `src/lib/smarthelp/answer.ts`
- Modify: `src/lib/support/aiReply.ts` — move the NEVER topics into `export const PERSON_ONLY_TOPICS: string` and use it inside `SUPPORT_AI_RULES` (text unchanged).
- Test: extend `qa/tests/logic/smarthelp.check.ts`

**Interfaces:**
- Consumes: Task 1 types/view/pages; `customerHandbook()` (Task 3); `GUIDES` (Task 2); `commitsMoneyOrData`, `PERSON_ONLY_TOPICS` (aiReply).
- Produces:
  - `personTopic(question: string): "leaving" | "money" | "data" | "security" | "person" | null`
  - `smartHelpAnswerSchema` (zod, mends rather than refuses, like `supportAiAnswerSchema`): `{ language: string; kind: "steps" | "explain" | "person" | "unknown"; title: string (≤120); steps: HelpStep[] (≤8, text ≤400); note: string | null (≤600); confidence: number 0–100 }`; `type SmartHelpAnswer = z.infer<typeof smartHelpAnswerSchema>`
  - `type SmartHelpReply = { kind: "steps" | "explain" | "person" | "unknown"; title: string; steps: StepView[]; note: string | null }`
  - `cleanAnswer(a: SmartHelpAnswer, ctx: HelpContext, targets: ReadonlySet<string>): SmartHelpReply`
  - `smartHelpSystemPrompt(): string`; `smartHelpUserPrompt(input: { question: string; history: Array<{ q: string; a: string }>; ctx: HelpContext }): string`
  - `PERSON_REPLY: Record<NonNullable<ReturnType<typeof personTopic>>, string>` — the short line shown for each person topic.

- [ ] **Step 1: Write the failing checks:**
  - `personTopic` → `"leaving"` for "how do I cancel", "stop charging my card", "downgrade my plan", "cancelar mi suscripción", "close my account"; `"money"` for "I want my money back", "can I get a discount on my bill"; `"data"` for "delete everything"; `"security"` for "someone logged into my account"; `"person"` for "let me talk to a human"; `null` for "how do I send a proposal by text", "add a discount line to a proposal", "change my credit card".
  - `smartHelpAnswerSchema.parse({ kind: "nonsense", steps: "x", confidence: 140 })` → `kind "unknown"`, `steps []`, `confidence 100`.
  - `cleanAnswer`: a step with `open: "/dashboard/ai-desk"` keeps its text and loses `open`; `show: "not-a-target"` is dropped; `confidence 55` → `kind "unknown"` with `steps []`; a step whose text matches `commitsMoneyOrData` → `kind "person"`; an INSTALLER's `/dashboard/phone` step has `blocked "role"` and no `open`/`show`.
  - The system prompt contains `PERSON_ONLY_TOPICS`, "Manual J-style", the instruction to answer in the language of the question while keeping JobFlex's button and page names exactly as written, the `HELP_PAGES` list, every guide title, and the customer handbook; it contains no "Internal —".
  - The user prompt includes at most the last 6 history turns, the page, role and plan, and the setup facts as plain words ("Payments: not connected").
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement `answer.ts`** and the `PERSON_ONLY_TOPICS` extraction (keep `support-ai.check.ts` green).
- [ ] **Step 4: Run** both checks → pass.
- [ ] **Step 5: Commit** — `feat(smarthelp): answer contract, prompts, person-topic guard`.

### Task 5: The server — context, the ask, limits, the log

**Files:**
- Create: `src/lib/support/unmeteredOpenAI.ts`, `src/lib/smarthelp/log.ts` (pure), `src/lib/smarthelp/server.ts`, `src/actions/smartHelp.ts`
- Modify: `src/lib/support/aiSupport.ts` — `supportClient()` becomes an import of `unmeteredOpenAI()` (behaviour unchanged).
- Test: `qa/tests/logic/smarthelp-log.check.ts` (pure log helpers)

**Interfaces:**
- Consumes: Tasks 1–4; `requireOrg` (`lib/orgContext`: `{ user, organizationId, role }`); `getBlockedCustomPages` (`lib/customPageAccess`); `rateLimitShared(key, max, windowMs)` (`lib/rateLimit`); `resolveOpenAIModel`, `samplingOptions` (`lib/sdk/openai`); setup reads: `readDeskSettings(orgId).profile !== null` (`lib/aiDesk/numbers`), `readRegistration(orgId).stage === "approved"` (`lib/sms/registration`), `getPaymentConnectionStatus(orgId)` any `.state === "connected"` (`lib/payments/connections`), `Organization.bookingSettingsJson !== null`, `readWebSettings(orgId)` any `trades[t].on` (`lib/webEstimatorServer`), membership count > 1 or a live invite, `proposal.findFirst({ sentAt: { not: null } })`, `!leadSetupNeed(orgId).needs && !isOrgNameUnset(orgId)`; features: `canSeeEarlyAccess(email)` for booking, `webEstimatorOpen()` for website.
- Produces:
  - `unmeteredOpenAI(): OpenAI` — `new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 120_000 })`.
  - `readSetupState(orgId: string): Promise<SetupState>` — eight reads in parallel, each failure → `false`.
  - `helpContextFor(ctx: { organizationId: string; role: string | null; user: { email?: string | null } }, page: string): Promise<HelpContext>`
  - Log (pure part in `server.ts`'s sibling `src/lib/smarthelp/log.ts`): `type QuestionLog = { id: string; at: string; orgId: string; orgName: string; userId: string; userName: string | null; role: string | null; plan: string | null; page: string; question: string; answer: string; kind: SmartHelpReply["kind"]; outcome: "none" | "up" | "down" | "person" }`; `logKey(at: Date, rand: string): string` → `smarthelp:q:<ISO>-<rand>`; `guideKey(id: string): string` → `smarthelp:g:<id>`; `replyText(r: SmartHelpReply): string` (numbered plain text, ≤2000 chars).
  - Actions (`"use server"`):
    - `smartHelpPanel(page: string): Promise<{ cards: GuideCard[]; ctx: HelpContext }>`
    - `guideFor(id: string, page: string): Promise<{ guide: { id: string; title: string; steps: StepView[] } } | { error: string }>` — also counts the open in `smarthelp:g:<id>` `{ opens, up, down }`.
    - `askSmartHelp(input: { question: string; history: Array<{ q: string; a: string }>; page: string }): Promise<{ reply: SmartHelpReply; logId: string } | { error: string; retryAfterMs?: number }>` — question 1–1000 chars after trim; `personTopic` hit → `{ kind: "person" }` reply without a model call (still logged); then `rateLimitShared("smarthelp:u:<userId>", 20, 3_600_000)` and `("smarthelp:o:<orgId>", 300, 86_400_000)`; model call with `response_format: { type: "json_object" }`, `samplingOptions(0.2)`; parse → `cleanAnswer`; any throw → `{ error: "SmartHelp couldn't answer just now. The guides below still work, or ask a person." }`.
    - `rateSmartHelp(target: { logId: string } | { guideId: string }, verdict: "up" | "down"): Promise<{ ok: true } | { ok: false; error: string }>` — only the asker may rate their log entry; rate-limited 30/10 min.
  - Writing a log entry also deletes `smarthelp:q:*` rows whose `updatedAt` is older than 90 days (at most once an hour per instance).

- [ ] **Step 1: Write the failing checks** for `log.ts`: `logKey` sorts by time as strings; `replyText` numbers steps "1. …", drops Open/Show me, clips at 2000; a person-topic reply's text is the `PERSON_REPLY` line.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement** `unmeteredOpenAI.ts`, `log.ts`, `server.ts` (`import "server-only"`), `actions/smartHelp.ts`.
- [ ] **Step 4: Run** the check → pass; `npm run typecheck` → 0 errors.
- [ ] **Step 5: Commit** — `feat(smarthelp): server context, ask action, limits, question log`.

### Task 6: "Ask a person" reaches a person

**Files:**
- Modify: `src/components/v3/support-widget/support-widget.tsx` (OpenDetail at ~205, `openSupportComposer` ~215, `show()` ~552, submit ~763), `src/actions/support.ts` (`ticketInput` 23–36, `submitSupportTicket` 80), `src/lib/support/aiReply.ts` (`deliveryFor`), `src/lib/support/aiSupport.ts` (where `deliveryFor` is called)
- Test: extend `qa/tests/logic/support-ai.check.ts`

**Interfaces:**
- Produces:
  - `openSupportComposer(opener?: HTMLElement | null, prefill?: { message: string; category?: "technical" | "billing" | "account" | "general"; origin?: "smarthelp"; logId?: string }): void`
  - `ticketInput` gains optional `origin: z.literal("smarthelp").optional()` and `smartHelpLogId: z.string().max(80).optional()`; on create, `SyncState supportOrigin:<ticketId>` = `{"origin":"smarthelp","logId":…}`; the log entry's outcome becomes `"person"`.
  - `deliveryFor(a: SupportAiAnswer, mode: SupportAiMode, origin?: "smarthelp"): Delivery` — `origin === "smarthelp"` → `{ send: false, reason: "Came from SmartHelp — a person sends this one." }` (checked after the mode check).
- [ ] **Step 1: Write the failing check:** `deliveryFor(howTo, "auto", "smarthelp")` is `{ send: false }` with that reason; `deliveryFor(howTo, "auto")` still sends.
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement**; the composer's `show()` fills `message`/`category` from the prefill and keeps `origin`/`logId` for the submit; `aiSupport` reads `supportOrigin:<ticketId>` before `deliveryFor`.
- [ ] **Step 4: Run** → pass; typecheck → 0.
- [ ] **Step 5: Commit** — `feat(support): SmartHelp hand-offs are held for a person`.

### Task 7: Show me — one spotlight, shared with the tour

**Files:**
- Create: `src/lib/onboarding/targets.ts`, `src/components/v3/smarthelp/spotlight.tsx`, `src/components/v3/smarthelp/spotlight.module.css`
- Modify: `src/components/v3/onboarding-tour/onboarding-tour.tsx` (`findTarget` ~80, `framed` ~136 now import from `targets.ts`; behaviour unchanged)

**Interfaces:**
- Produces:
  - `firstVisibleTarget(names: string[], doc?: Document): HTMLElement | null` — the tour's rule: `[data-tour="<name>"]`, skip `!isShown`, `aria-hidden` ancestors, failed `checkVisibility`, off-screen sideways; prefer one in the viewport.
  - `frameOf(r: DOMRect): { top: number; left: number; width: number; height: number } | null`
  - `showMe(target: string, label: string): void` (module store + DOM event `jf:smarthelp-show`); `<SmartHelpSpotlight />` — after a `showMe`, polls every 250ms for up to 8s; found → `scrollIntoView({ block: "center" })`, a fixed 2px `--accent` frame with a 4px offset ink shadow (no dim), repainted on scroll/resize; cleared on a click inside the target, Esc, a route change, or after 15s; not found → emits `jf:smarthelp-miss` with the label.
- [ ] **Step 1:** Extract `firstVisibleTarget`/`frameOf` and switch the tour to them.
- [ ] **Step 2: Verify the tour is unchanged** — run the tour's existing QA (`git grep -l onboarding qa/tests` — run each) and `npm run typecheck` → pass.
- [ ] **Step 3: Implement** `spotlight.tsx` + CSS.
- [ ] **Step 4:** `npm run typecheck` and `npm run lint:changed` → clean.
- [ ] **Step 5: Commit** — `feat(smarthelp): Show me spotlight, shared target lookup with the tour`.

### Task 8: The panel and its five launchers

**Files:**
- Create: `src/components/v3/smarthelp/smarthelp.tsx`, `src/components/v3/smarthelp/smarthelp.module.css`, `src/components/v3/smarthelp/smarthelp-row.tsx`
- Modify: `src/components/v3/support-widget/support-widget.tsx` (render `<SmartHelpRoot />` when `signedIn`, so SmartHelp exists wherever Help does); `src/components/layout/Sidebar.tsx` (row before the groups, ~line 248); `src/components/v3/blueprint-shell/sidebar.tsx` (between `#sbIndicator` ~301 and `sections.map` ~304; NOT class `.sb-link` — `shell-behavior.ts` treats those as nav links); `src/components/v3/mobile-shell/mobile-nav.tsx` (between `<TourChip>` ~449 and the nav ~452; close the drawer, then open); `src/app/(mobile)/mobile-v2/mobile-dashboard.tsx` (its drawer copy ~1439); `src/components/layout/MobileTabBar.tsx` (a row above "Help" in the More sheet ~284, opened on the next frame like Help); `src/app/globals.css` (`@media (min-width:1024px){ html[data-smarthelp-open] body { padding-right: 380px } }`); `DESIGN.md` (sidebar section: the SmartHelp block as an owner-approved entry, 2026-10-29)

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6, 7.
- Produces: `openSmartHelp(opener?: HTMLElement | null): void` (DOM event `jf:smarthelp`); `<SmartHelpRoot />`; `<SmartHelpRow variant="desk" | "blueprint" | "drawer" | "more" onBeforeOpen?: () => void />` with `data-tour="smarthelp"`.
- Behaviour fixed by the spec: ≥1024px a right panel 380px (page padded, not covered); 769–1023px the panel overlays and, on Show me, folds to a 44px "Back to SmartHelp" bar; ≤768px a bottom sheet 85dvh that closes on Open/Show me and reopens from the bar. Open state and the conversation live in `sessionStorage` (`smarthelp:open`, `smarthelp:chat`, last 20 turns; every read/write in try/catch). Esc / ✕ close. Header = the ink block. Ask box (≤1000 chars, Enter sends, Shift+Enter newline). "Set it up" and "How it works" groups from `smartHelpPanel(pathname)`; todo cards carry a dot, done cards a ✓. A guide tap renders `guideFor` steps; typed questions render `askSmartHelp` replies. Each step: number, text, **Open** (`router.push`) and **Show me** (`router.push` then `showMe`) unless `blocked` — then "Ask your account owner to open <page name>." (role) or "<page name> is on another plan." + **Upgrade** for owners (plan). `jf:smarthelp-miss` → "Look for **<label>** on this page." 👍/👎 under each answer (`rateSmartHelp`); 👎 and every `person`/`unknown` reply show **Ask a person** first, which calls `openSupportComposer(btn, { message: <question + replyText>, category, origin: "smarthelp", logId })`. Errors and limits show their message inline; guides stay usable.
- [ ] **Step 1: Build** the panel, the row, the five insertions, the mount, the CSS rule, the DESIGN.md entry.
- [ ] **Step 2:** `npm run typecheck`, `npm run lint:changed` → clean.
- [ ] **Step 3: Commit** — `feat(smarthelp): the panel and its launchers in every nav`.

### Task 9: What the owner sees — /admin/support → SmartHelp

**Files:**
- Create: `src/components/v3/admin-support/smarthelp-admin.tsx`; `listSmartHelp()` in `src/lib/smarthelp/server.ts`
- Modify: `src/app/(admin)/admin/support/page.tsx` (`?view=smarthelp`; a `role="tablist"` "Tickets | SmartHelp" using `ui.seg/segBtn/segOn` from `admin-influencers/admin-ui.module.css`, as `admin-tasks-content.tsx:290` does; guard stays `requirePlatformAdmin()`)
- Test: extend `qa/tests/logic/smarthelp-log.check.ts`

**Interfaces:**
- Produces: `listSmartHelp(opts?: { limit?: number }): Promise<{ questions: QuestionLog[]; guides: Array<{ id: string; title: string; opens: number; up: number; down: number }> }>` in `server.ts` (newest 200 by key); pure, in `log.ts`, `smartHelpSummary(questions: QuestionLog[], now: Date): { week: number; up: number; down: number; person: number; unanswered: QuestionLog[] }` (unanswered = kind `unknown`/`person` or outcome `down`, last 7 days).
- [ ] **Step 1: Write the failing check** for `smartHelpSummary` (counts over a fixed list, the 7-day edge, unanswered picks).
- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → pass; typecheck → 0.
- [ ] **Step 5:** The view: four facts (questions this week, 👍, 👎, sent to a person), "Not answered" list, "Newest" table (company, person, role, page, question, answer excerpt, outcome, time), guides table (opens, 👍, 👎).
- [ ] **Step 6: Commit** — `feat(admin): SmartHelp questions on the support page`.

### Task 10: End-to-end walk on a local stand

**Files:**
- Create: `qa/walks/smarthelp.walk.ts` (Playwright, desk 1440×900 + phone 390×844), a fixture model server for `OPENAI_BASE_URL` in `qa/fixtures/smarthelp-fake-openai.ts` that answers SmartHelp prompts with: a valid steps answer with one invented path, a Spanish answer when the question is Spanish, garbage JSON for "garbage", a 504 for "timeout".

- [ ] **Step 1:** Start a stand per the memory recipe with its OWN database and `OPENAI_BASE_URL` pointing at the fixture. Never production env files.
- [ ] **Step 2: Walk (each line a check):** the row opens SmartHelp from the classic sidebar, the blueprint sidebar, the phone drawer, the mobile-v2 drawer and More; a todo guide is first with its dot; "Set up the AI desk" shows numbered steps; Open goes to the page and the panel stays (desk); Show me lights the target and a click clears it; the phone sheet closes on Open and comes back from the bar; a typed question renders steps and the invented path has no Open; Spanish in → Spanish out; "garbage" and "timeout" → the error line, guides still work; "how do I cancel" → person reply with Ask a person first, no steps; Ask a person opens the Help composer pre-filled; the filed ticket's AI record is held/drafted, not sent; an INSTALLER sees "Ask your account owner"; the 21st question in an hour is refused with when it reopens; the admin SmartHelp view lists the questions with 👍/👎 and the guide counts; no console errors.
- [ ] **Step 3:** All QA logic checks: `for f in qa/tests/logic/smarthelp*.check.ts qa/tests/logic/support-ai.check.ts; do NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json "$f" || break; done` → all pass; the FULL `npm run typecheck` → 0 errors; `npm run lint` → 0 warnings.
- [ ] **Step 4: Commit** — `test(smarthelp): end-to-end walk + fixture model`.
