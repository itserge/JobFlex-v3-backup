// SUPPORT · THE HANDBOOK the support AI reads (lib/support/aiReply
// supportSystemPrompt): how JobFlex works, written from its code on
// 2026-10-15 and updated from the code on 2026-10-29 — every menu name, page path, button label and message as the
// code has it, each area's common problems and what to tell the customer, and
// for the team an internal code map per area, so a bug report arrives with the
// right place to look.
//
// KEEP IT TRUE. The AI answers customers from these words: when a feature, a
// price rule or a message changes, change its section here in the same commit.
// "(verify)" marks what the code alone could not settle; the rules tell the AI
// not to state those as fact.
//
// THE REPO IS PUBLIC. Nothing here may be customer data, a secret or an env
// var's value — names only. qa/tests/logic/support-ai.check.ts checks the size,
// the areas, and that no key or personal address slipped in.

/** Accounts & access — sign-up, sign-in, passwords, team, roles, support. */
const ACCOUNTS = `## Accounts & access

### Sign-up
**Where:** /auth/register ("Create an account" on sign-in). Same page on phone and desktop. New shops get a 7-day free trial. No account exists until the plan step finishes (Stripe takes the card, or the no-card trial starts).
**JobFlex switches (Admin → Trials) decide the form.** Newest, *Straight to Professional*:
1. "7-DAY FREE TRIAL", a "Plans start at $45/month" card ("One flat monthly price", "No pay-per-report fees"), then "Sign up with Google" (any Google account), or "Your name" + "Email".
2. Card required: "Start Your 7-Day Free Trial" opens Stripe's card page for Professional (unless a pricing-link plan or the ad's tool picks another); under it "$0 today, then <the plan's price> (with this plan) after your free trial." and "Upgrade / downgrade or cancel anytime". No password, no code, no company screen. No card: "Continue" emails a 6-digit code; the code starts the trial.
3. "You're all set, <name>." The owner sees a welcome card ("You're on <plan> — free until <date>", "Compare plans", "Subscription", "Got it") for up to 10 days.
Other settings: *Passwordless* (code, then "Pick a plan.") or *2/3 steps* (password, 8+ characters).
**Email code:** subject "<code> is your JobFlex code"; lasts 10 minutes; 5 wrong tries burn it; "Resend code" after 30 s kills the old one; the email's "Continue in browser" button works in any browser. Unnamed shops are asked "What's your company called?" before their first send.
**Problems:**
- "That email already has an account. Sign in instead." / "That email is already registered. Try signing in instead." → sign in. "That email already signs in with Google. Use Continue with Google below." → no password: Google or a code.
- "That looks like a temporary email address. …" → use a real inbox.
- "That code isn't right. N tries left." / "That code is used up after 5 wrong tries. Send a new code." / "That code expired — codes last 10 minutes. Send a new code." → "Resend code", use the newest email.
- "Too many codes for this address. Try again in …" (5 an hour) / "Too many sign-ups. Try again in …" (20 new accounts/hour per network) → wait.
- "This sign-up timed out. Start again with your email." → over 24 h; start over.
- Left Stripe without paying: "No card yet, nothing charged. …" or "Checkout was cancelled — your account has not been created yet." → nothing created or charged.
- Instagram/Facebook block Google: the button reopens the page in Safari/Chrome (else "Open in browser" / "Copy link"); email works.
- A card sign-up doesn't prove the email: the first Google or code sign-in claims the account and signs out all other devices (sign-up device too).

### Sign-in
**Where:** /auth/login, "Welcome back." One sign-in for everything (the "Open: JobFlex platform / Deck Studio" switch was removed 2026-10-21). Phones (≤768px): own layout, same options.
- "Continue with Google"; or Email → "Email me a code" → 6 digits; or "Use password instead" → Password → "Sign in" ("Forgot password?" below it).
- Sessions last up to 7 days (verify). Use www.jobflex.app.
**Problems:**
- "Email or password is wrong." → wrong password, or none set (Google, code, team-invite accounts) → code, Google, or reset.
- "Too many attempts — try again in N minutes." → 8 tries/email per 15 min or 30/network per minute; wait.
- The code screen always says "If <email> has a JobFlex account, a 6-digit code is on its way." No account → email "No account for this address yet"; codes fail.
- "Google sign-in was refused for that address. …" → Google didn't confirm the address; use email.
- "Sign-in didn't complete. Open www.jobflex.app and try again — …" / "Google sign-in didn't complete. Try again." → retry on www.jobflex.app.
- A Google account with another address lands in sign-up → use the matching one, or a code.
- "This account has no workspace" → address in no company (wrong address, removed, invite not accepted) → registered address, or owner re-invites.
- "Couldn't reach the database just now. Try again." → our side.
- Email "Google sign-in was used on your JobFlex account" → first Google sign-in on a password account. Not them → reset.

### Password
**Forgot:** "Forgot password?" (/auth/forgot) → Email → "Send reset link" → "Check your inbox." (same reply for any address). Email "Reset your JobFlex password" → "Set a new password" → /auth/reset: "New password", "Confirm password" (8+) → "Save password" → "Password updated." The link lasts 1 hour and works once; a new request kills the old one; max 3 emails an hour per address (extras silently dropped). Works for Google/code accounts (sets a first password). A reset signs out other devices (despite the page's side note).
**Signed in:** Settings → Account → Security → "Change password" (needs "Current password") or "Add password". A notice is emailed; other devices stay signed in. Installer/Sales/Estimator can't open Settings → "Forgot password?".
**Problems:** "This link isn't valid." → "Request a new link". Expired or used link → may show a generic error instead of "This reset link is invalid or has expired. Request a new one." (verify) → new link. "Your current password isn't right." / "Too many tries. Try again in …" (8 per 15 min).

### Profile, email, company
- Settings (sidebar gear or name plate) → /dashboard/settings?pane=account. Profile: "Full name", "Email" (locked), "Phone" → "Save changes". Business card: Owner/Admin/Manager only.
- **Customers can't change their login email.** Staff do it (Admin → Users) after confirming identity.
- Company (/dashboard/company) → Branding: "Company name", "Billing email", "Phone", "Website", "Address", "Brand color", "Logo" ("Replace", "Remove logo"); Lead matching: "Business address", "Service radius, miles", "Trades you take", "Accept platform leads". Limited roles can't open it.
- Time zone: AI desk → "AI desk setup" → Booking → "Your time zone" (default America/New_York).

### Team & roles
| Role | Can use |
|---|---|
| Owner | Everything; only role with Subscription/billing |
| Admin, Manager (legacy Accountant/User) | All but Subscription; invite, re-role, remove |
| Sales | Leads, Clients, own Proposals, CRM, Calendar, AI desk, Messages |
| Estimator | Own Proposals, Projects, Smart Proposal, estimators, Messages |
| Installer | Assigned Jobs, Calendar, Messages |
Other pages bounce a limited role home; role changes apply within a minute.
**Invite:** Workers (/dashboard/workers) → "Invite worker" → name, email, phone, rate, specialties, Role (Installer / Sales / Estimator / Manager) → "Send invite". Email "<inviter> invited you to join <company>" → "Accept invite" → "Accept & set up" → "Create a password" → "Create account" → signed in. Row tools: copy link, "Revoke & rotate" (old link dies), "Remove" (access ends at once; job history stays). Owners: add on /dashboard/settings/team (classic page, all roles, 7-day invites).
**Crew sign-in:** /auth/login (password or code). Their /w/<link> sends accepted crew through sign-in to Jobs; crew without a password keep using the link.
**Seats:** each plan caps worker and manager seats; pending invites count; numbers set per plan (verify). At the cap: "Plan limit reached — your plan's worker seats are full. Upgrade under Subscription to invite more."
**Owners:** only an Owner adds, changes or removes an Owner; "Can't remove the last owner." Several Owners allowed; to hand over, make the new person Owner first (verify).
**Problems:** "That worker has already joined. Use Edit or Remove instead." / "<email> already has a <role> account in this company. …" / "<email> is already on the crew at <company>. …" (one company per crew member). "Invite not emailed" → send the copied link. Invitee with a password: "This email already has a JobFlex account. Sign in as <email> first, then open the invite link again." (verify; may show a generic error). **Bug:** /auth/invite asks "Your name" and "Create a password" but saves neither; that password fails → "Email me a code" or "Forgot password?".

### Log out, delete, export
- "Log out" (Settings → Account; sidebar icon for limited roles) and "Log out everywhere" both sign out every device.
- Settings → Account → "Delete account" (badge "Testing", desktop): type the email → "Delete my account". Instant, no undo; also deletes any company they alone belong to (subscription cancelled). Prefer support for closures.
- No button deletes a company or exports all data; support handles it.

### Help & support
- Top-bar "Help" (every role): Bug / Billing / Account / Question, "What happened?", "Send" → "Ticket filed" + 6-character reference + "Our team has been alerted." (else "The email alert did not go out. Quote this reference if you follow up."). 5 tickets per 10 minutes.
- /dashboard/support ("Help Center", every role, Installers, Sales and Estimators included): form + "Your conversations" (own tickets only — nobody sees a colleague's). Each ticket opens as a chat: every message in order (theirs on the right; ours and the AI's, signed JobFlex support, on the left), a Reply box and "Send" at the bottom; new answers appear without reloading. Writing in a Resolved or Closed ticket opens it again. Owners don't see staff tickets.

### Internal — for the team (not for customers)
**Code map**
- Sign-up: app/(auth)/auth/register, v3/auth-register-blueprint, actions/signupOtp + signupCheckout, lib/signupOtp, signupAutoPlan, accountClaim, trialPolicyServer.
- Sign-in/password: lib/auth.ts, components/auth/login-form.tsx, middleware.ts, lib/roleRoutes.ts, actions/auth, accountPassword.
- Settings/company: settings-blueprint/panes/account-pane.tsx, actions/accountSettings, company.
- Team: actions/workers (/w/[token]), team (/auth/invite); lib/orgContext, roleAccess, limitsEngine. Support: actions/support, v3/support-widget.
**Failure modes**
- Thrown action errors are masked in production: /auth/reset, team toasts, worker-invite accept, Help rate limit.
- /auth/invite: acceptInvite(token) drops name and password.
- updateMembershipRole has no last-owner check; a sole Owner can demote themselves on settings/team.
- The worker invite email says 7 days; /w/<token> never expires while PENDING.
- deleteMyAccount is live in production, marked "slated for removal at launch".
- Env (names only): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXTAUTH_URL, NEXTAUTH_SECRET, NEXT_PUBLIC_APP_URL, RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASSWORD (none → no codes, resets or invites), SUPPORT_NOTIFY_EMAIL, TRIAL_REQUIRES_CARD, CARDLESS_TRIALS_PER_DAY.`;

/** Plans, trials & billing — Stripe, plan changes, cancel, failed payments, refunds policy. */
const BILLING = `## Plans, trials & billing

Billing is owner-only ("Only the account owner can change the plan"). Prices, names, features and limits live in /admin/plans — never quote a number below as current; read it from /pricing or the customer's Subscription page.

### Plans
- **On sale:** Starter, Professional (highlighted) and the top plan (slug \`enterprise\`, shown as "Advanced"; seed name "Enterprise" — verify). Seed defaults in code: $29 / $79 / $199 a month; yearly = 10 × monthly, shown as "2 months free". The sign-up card's "Plans start at $45/month" is fixed wording on that screen, not read from the plans (verify the live prices on /pricing).
- **What differs:** the feature list and numeric limits set in /admin/plans. In code no tool is locked by tier on these plans (all feature flags open); limits are. A missing limit = unlimited. Seed: Starter workers 1, Professional workers 3, top plan no limits (verify live).
- **Limits:** monthly, reset on the billing-cycle day (estimatorUses = AI estimator runs, proposals, jobs, projects, leads, messages, reviews…); lifetime (clients, workers, teamSeats = office seats + pending invites, managers).
- **AI desk minutes / month (calendar month):** the plan's own limit, else Starter 0, Professional 150, top plan 500.
- **Texts/month shown:** Starter 250, Professional 1,000, top plan 4,000.
- **Deck Studio:** an add-on, never part of a plan: the 7-day trial has the whole studio; after it, on any plan (Custom and yearly too), the studio is a preview until the owner adds Deck Studio for $79/mo ($790/yr on a yearly plan) — ticked with the plan ("Add Deck Studio" over the plan cards, or the Deck Studio row on Stripe's checkout page), or later from the Deck estimator or Subscription. Shops that bought it at $49/mo ($490/yr) before 2026-10-26 keep $49 on every plan change on the same term (Subscription shows "$49/mo (your price)"). Complimentary plans and JobFlex admins always have it; so does the one older Custom plan that bought the Deck estimator page before it left sale ("Included in your Custom plan" — no separate add-on, the page stays at its $10/mo). That page is not sold any more: for everyone else Deck Studio is only the add-on.
- **Custom plan ("Build your plan", $20 + $10/page):** off sale unless switched on; existing custom customers keep it.
- **Free plan:** not sold; what a cancelled, unpaid or ended-trial account becomes. Data stays; limits from the hidden "free" row (seed: 5 proposals, 3 estimator runs a month…). Closed: Smart Proposal, roof/fence/video/HVAC/deck estimators, Calendar, Leads, Workers, Company, AI desk, texting. Online payments stay. Message: "Your plan has ended, so <page> is closed. Choose a plan on Subscription to open it again."

### Sign-up and the free trial
- **Length:** 7 days for every new sign-up. **One trial per company:** a company that ever had a subscription or trial pays at once on any later checkout.
- **Card required (default):** plan step → Stripe card page, $0 today; the plan price is charged when the trial ends unless cancelled. The account exists only once Stripe's page completes ("Checkout was cancelled — your account has not been created yet."). A started sign-up lasts 24 hours ("That signup expired. Start again.").
- **"Straight to Professional" (admin switch; default is "Visitor picks a plan"):** name + email or Google → Stripe card page for Professional, monthly. No password, no plan cards, no email code with a card. A plan chosen on /pricing wins; an ad for a tool Professional lacks picks the cheapest plan with it. Backing out of Stripe (its back arrow or the browser's Back) shows all the plan cards with Professional picked — pressing any card opens Stripe for that plan; if Stripe's page doesn't open, the cards show "Secure checkout didn't open — pick a plan to try again". Coming back later without a card (the same email again, the code's link, or signing in to a shop with no plan) goes straight to Stripe's card page. Sign in later with Google or an emailed code (confirms the address, signs out other sessions). The welcome card: "You can change your plan any time — in Subscription."
- **No-card trial (admin switch, off by default):** email confirmation link (24 h). Refusals: "Free trials without a card are full for today…" · "This email has already had a free trial. Sign in, or start with a card on the plan page." · "<domain> has already had a free trial. Ask your team's owner to add you, or contact us."
- **No-card trial caps (until a card is added):** 3 roof measurements, 3 fence lookups, 3 HVAC lookups, 10 AI runs; no EagleView reports/paid re-measures, Manual J reports, outgoing texts or own number. Message, e.g.: "You've used the 10 AI runs the free trial includes without a card. Add a card to unlock full limits — nothing is charged until the trial ends." Dialog "Add a card to unlock full limits" → **Add a card** opens /dashboard/trial. A card lifts the caps at once.
- **Card trial end:** about 48 hours before, the owner gets "Your first week on JobFlex — <plan> continues <day>": the week's numbers, the price, nothing to do if it fits, cancel before the day and nothing is charged. If that first charge fails, the paid tools stay open for 3 days after the trial's end, then pause until the card goes through.
- **No-card trial end:** emails "2 days left in your JobFlex trial" / "Your JobFlex trial ends today"; no card → Free. Win-back emails days 1, 3, 5, 12; day 5 offers 10% off for 3 months (valid 14 days), applied by itself via "Get <plan> back — 10% off" on /dashboard/trial.

### Codes and discounts
- Field "Promo or referral code" → **Apply** on the sign-up plan step (monthly sign-ups can also type one on Stripe's page). Errors: "Enter a code first." · "That code is not valid."
- Partner codes: percent set per code, first month only (on a yearly bill: one month's worth). Referral code: 10% off the new shop's first month; the referrer gets a credit of 50% of one month after the new shop's first payment.
- Codes work only on a company's first subscription — upgrades and returns get no code and no code field.

### Changing plans — Subscription → **Upgrade plan** (/dashboard/upgrade)
Press **Upgrade / Downgrade / Switch to annual / Switch to monthly** on a card, then confirm.
- During a trial: plan swapped, trial runs on, nothing charged ("Nothing was charged. Your trial runs on.").
- Up a tier, same term: switched now on the card on file, the difference charged today with the unused days of the current plan credited ("Prorated: you're charged the difference now, unused days are credited"; the dialog shows "Charged today: $X · includes $Y back for the unused part of your current plan"). The billing date stays. A Custom plan moving up still goes through Stripe's page, with no credit.
- Monthly → annual: charged today minus the unused part of the month; the cycle restarts ("Pay $X and switch"). Annual → monthly: booked for the end of the paid year ("Switches to monthly on <date>", **Cancel switch** undoes it).
- Cheaper plan, same term: immediate, "Nothing is charged today", nothing refunded.
- Errors: "Card declined — update your card." (nothing changed) · "Your last payment didn't go through. Update your card first, then change the plan." · "That is already your plan." · "A plan change is already under way. Wait a moment and look again."
- Admin price edits never change an existing subscriber's price.

### Cancel and keep
1. Settings → Billing (/dashboard/settings?pane=billing) → **Manage subscription** (owner only; others see "Ask your owner") → **Cancel subscription** at the foot of that window. It is the only place a plan is cancelled; the window also shows the plan, its price and term, the next date and the card.
2. "Before you go" → **Continue to cancel** (or **Keep <plan>**). On a trial, or within 14 days after it ended, a third button **Request a trial extension**: "How many more days would help?" (7 / 14) and "What do you still want to try?" (optional) → **Send request** → "Request sent — We'll answer by email within one business day." Nothing is cancelled. One open request per company; pressing it again shows "Request pending". A JobFlex admin approves (email "Your trial is extended until <date>") or declines (email "We couldn't extend your trial this time"). Support cannot promise an extension — the admins decide.
3. "Cancel <plan>?" → tick at least one "Why are you cancelling?" reason (Other needs 3–500 characters of their own words; until then the button is off with a hint) → **Cancel subscription**.
- Effect: "You keep <plan> until <date> — the cycle you've already paid for — and you won't be billed again. Then your account moves to the Free plan. Nothing is refunded for the days you don't use." Email: "Your plan switches to Free on <date>". Cancelling during a trial: no charge.
- Undo before the date: **Keep <plan>** (Settings → Billing or Subscription). After: "Your plan has already switched to Free. Choose a plan to start again." — paid at once, no new trial.
- Comp plans: "Your plan is complimentary — there's nothing to cancel."

### Failed payment
- Stripe retries; tools stay open meanwhile. Ribbon "Payment failed · Check your payment." → **Review payment** (Subscription). Card "Payment needs attention": **Review & pay $X**, **Update card**, **Check payment status**, next try date. Others see "Ask the owner to update the card."
- Emails: "Your JobFlex payment didn't go through"; on Stripe's last try "Your JobFlex plan has moved to Free — the payment didn't go through". Then tools close (Free; timing follows Stripe's retry settings — verify) until a plan is chosen at /dashboard/upgrade.
- Saving a new card pays the open invoice at once.

### Card, invoices, receipts
- No Stripe customer portal. The owner changes the card in the app on an active, trialing or past-due plan: Settings → Billing → **Manage subscription** → Card → **Update card**, or Subscription → Billing information → **Update payment card** ("A new card will also be used to pay any outstanding invoices."). Also **Update card** after a failed payment or a declined plan change, and **Add a card** on a no-card trial. Plans set up by JobFlex (not billed to a card here) → the team.
- Invoices: Subscription → Billing history (last 12; $0 trial invoices and voided attempts hidden). Click the number to open Stripe's invoice/receipt ("Receipts open on Stripe · amounts in USD"). "Next bill" = Stripe's preview incl. discounts and credit.
- Billing contact: Settings → Billing ("Where invoices and dunning notices go.").

### Add-ons and per-use charges
- **AI desk packs:** 300 minutes for $29, never expire. AI desk → AI desk setup → "Minutes left" → "Add 300 minutes — $29" → "Charge $29 to <card>?" → **Charge it** (or Stripe's page). Auto top-up buys a pack at 5 minutes left and emails each time. Browser test calls use minutes. Out of minutes: "calls ring your company phone, or take a message, until you add minutes."
- **Own texting number:** JobFlex gets and pays for a toll-free number; needs a paid plan ("Your own number comes with a paid plan."). At the month's allowance texting stops until the next month — nothing is billed past it; the screen says "At the allowance, texts stop until next month — upgrade for more." and sending opens "SMS allowance used — upgrade or wait for the next cycle".
- **Website estimators** (early — only once JobFlex opens them to every account; verify): one add-on per trade, each a line on the plan's own subscription (one bill, one card): Roof $179/mo, HVAC $79/mo, Fence $99/mo, Deck Studio $150/mo, Smart Proposal $99/mo; a yearly plan pays 10 × the month. Added on Save in Settings → Website estimators ("Save and add to my plan"): on a card trial "Nothing charged today" — billed with the plan when the trial ends; on a paid plan the rest of the period is charged at once; turned off: "the unused days come back as a credit on your next bill". Only the account owner can add or take one off. On a trial without a card: "Free during your trial", then the price on a paid plan. Complimentary plans include them; on the Free plan a trade can't be turned on until a plan is picked; on a plan not billed to a card here: "write to us from Help and we'll add it". A line keeps the price it was bought at.
- **Paid leads (Lead Center):** price per lead, charged on Accept; no refunds by policy.
- **Monthly paid lookups per plan** (/admin/plans "Paid lookups"; default Free 3 / 1, Starter 15 / 10, Professional 40 / 25, Advanced 100 / 60): roof measurements (EagleView) and Manual J reports (Cool Calc) per billing cycle. A roof already measured or a report already made is free and not counted. Past the number: the plan-limit dialog "No roof measurements left" / "No manual j reports left".
- **Daily ceilings for everyone:** 30 new roof measurements and 5 re-measures a day; 20 Cool Calc reports an hour, 30 a day.

### Plan-limit dialog
- Title "No <limit> left" (or "Plan limit reached"). Body: "You've used all the <limit> included in your plan. Upgrade to keep going now, or wait until the limit resets next cycle." (seats: "Upgrade to add more."). Buttons **See plans** (/dashboard/upgrade) / **Keep my plan**. Usage card: "Limits reset each billing cycle · hitting one never blocks existing work".

### Refunds (terms §2)
"JobFlex is a subscription, and charges are non-refundable." A charge made because the subscription was not canceled beforehand "is not refunded, in whole or in part, and unused time is not credited. The only exceptions are where the law requires a refund or where we expressly offer one in writing." Cancellation stops the next charge and leaves access through the paid period. **The support AI never promises refunds — it routes the request to the owner.** Never promise a refund, credit, discount or free minutes; record the request for the team.

### Internal — for the team (not for customers)
- **Code map (src/):** \`lib/planCatalogServer\`, \`prisma/seed.ts\`; limits \`lib/limitsEngine\`; lapse \`lib/planStatus\`, \`lib/freePlan\`; sign-up \`actions/signupCheckout\`, \`api/checkout/signup\`, \`lib/signupAutoPlan\`, \`lib/trialPolicyServer\`; trials \`lib/cardlessTrial\`, \`lib/trialMeter\`, \`lib/trialWinback\`; plan change \`lib/planChange\`, \`api/checkout/subscription\`; cancel \`actions/billing\` + the manage window \`components/billing/FreeSwitch\` (data \`lib/settings/loadSettingsData\`: canUpdateCard, noCancel); failures \`lib/cardUpdate\`, \`actions/billingRecovery\`; first-charge grace \`lib/planStatus\` LAPSE_GRACE_MS + \`lib/stripeStatus\` firstChargeFailed; "two days left" \`lib/trialEndingMail\` + \`lib/email/build/trial.ts\`; desk \`lib/aiDesk/*\`; website add-ons \`lib/webAddon\` (webBillingMode; prices in \`lib/webEstimator\` WEB_TRADE), \`lib/webAddonBilling\`, \`actions/webEstimator\`, open switch SyncState \`webEstimator:open\`; Deck add-on \`lib/deckAddon\`, \`lib/deckAddonBilling\`. Webhook \`api/webhooks/stripe\`. Crons \`api/cron/reconcile-stripe\`, \`trials\`, \`trial-winback\`.
- **Admin-only:** /admin/plans (price edits auto-sync to Stripe; "Sync to Stripe" retries); /admin/trials (card switch, steps, plan at sign-up); /admin/users ("Change billed plan", "Grant plan (no charge)", usage reset of monthly keys); the contractor email's "10% off · 3 months"; lead refunds. Subscription refunds/credits: Stripe dashboard only.
- **Env names:** STRIPE_SECRET_KEY, STRIPE_SECRET_KEY_TEST, STRIPE_WEBHOOK_SECRET, STRIPE_ALLOW_LIVE_WRITES, TRIAL_REQUIRES_CARD, CARDLESS_TRIALS_PER_DAY, CUSTOM_PLAN_ENABLED, CRON_SECRET. Errors: "Stripe is not configured." · "That plan isn't available for checkout yet." (unsynced price) · "Couldn't open checkout."
- **Known gaps:** card check / "ON HOLD" (card-check) exists only on the unmerged \`card-check\` branch — not live. /dashboard/trial still says "the workspace turns read-only" — since 2026-10-14 it moves to Free. Billing contact is not synced to Stripe, so Stripe receipts go to the sign-up email (verify). The sign-up's "Plans start at $45/month" is hard-coded in \`components/v3/auth-register-blueprint/passwordless-step.tsx\` — check it after a price edit in /admin/plans.`;

/** Estimators — Smart Proposal, roof, fence, deck, HVAC, video, blueprints. */
const ESTIMATORS = `## Estimators

Seven tools, in the sidebar under **Estimating tools** and the topbar **New estimate** dialog (Concrete and Paint there are "In the queue"). Each ends with **Convert to proposal** (Blueprint: **Create proposal**): a DRAFT proposal opens in the builder.

**Rules for every estimator**
- **Roles:** Owner, Admin, Manager: all. Estimator role: all but Video and Deck. Sales and field workers: none ("Estimator or manager access required").
- **Plans:** every standard plan has every estimator but Deck Studio (the $79/mo add-on), each with the plan's monthly uses (the plan cards print them: "20/mo · Roof estimator"); only monthly limits differ (verify numbers in /admin/plans). Custom plan: each is a $10/mo add-on (Blueprint comes with Smart Proposal); missing → "<Name> isn't in your plan." (owner: "Add <Name> for $10/mo"). Canceled, unpaid, expired, ended-trial and Free accounts lose them all ("Your plan has ended, so <Name> is closed. Choose a plan on Subscription to open it again."); past-due keeps them.
- **Estimator uses** (monthly, per billing cycle): one use = one saved Smart Proposal, Video or Blueprint estimate. Those three, the roof "Smart estimate" and HVAC plate/walk reads won't run once it — or **Proposals created** — is spent: dialog "No estimator uses left" / "No proposals created left", **See plans**. Fence, Deck and the roof package check only Proposals created, at convert. HVAC also meters new saves ("No hvac estimates left").
- **Trial without a card:** 3 roof measurements, 3 fence address lookups, 3 HVAC site lookups, 10 AI runs, no EagleView or Manual J reports: "You've used the 10 AI runs the free trial includes without a card. Add a card to unlock full limits — nothing is charged until the trial ends."
- **Caps per company**, "Too many <what>. Try again in N minutes.": hourly AI runs 60 (shared), video analyses 20, blueprint runs 12, site lookups 40 (HVAC), property lookups 30 (fence), aerial roof estimates 30; roof report orders 5 a day.
- **Anywhere:** "JobFlex was updated while this page was open, so this screen is out of date. Reload the page and try again." → reload. "The AI service is busy. Try again in a moment." → retry. "AI is not configured for this workspace." or any text naming a missing AI key on the server → escalate.
- **First-estimate tour:** a new shop gets a "First estimate" card that walks one estimator — roof, fence, HVAC, Smart Proposal, Deck Studio or a manual proposal — from the sidebar to a created proposal, lighting each field ("Do this step to go on"); then "Your first estimate is made" and "Next steps" (send it). **Skip tour** / "Close the tour for now"; back later: "Pick up where you left off?".

### Smart Proposal
\`/dashboard/advanced-ai\`; phones get 3 steps (The brief → Location → Review).
1. **The brief**: describe the job (**Speak the brief** dictates). Optional **Site photos**: up to 6, 18 MB total, read once, not stored.
2. **Location**: "Search address or city…" + State.
3. **Generate estimate**. Up to 3 questions may appear ("What moves this price"): **Use answers** or **Generate anyway**; closing it cancels.
4. Edit lines, tick extras under "Not in your description", set Discount (% or $) and Tax %.
5. **Save as proposal** / **Convert to proposal**: saves (1 estimator use), opens the proposal.

Prices: built-in trade prices × a city/state cost index — no store prices, no company price book. The proposal adds the company's default markup (its total can exceed the screen) and the job state's base tax rate — unless the company prices its own way (below).
**Own pricing — Settings → Estimating (off by default):** an Owner/Admin/Manager turns on "Price estimates my company's way" and sets "Labor is charged" (**Per crew-hour** / **Per person-hour**), "People on a crew", the labor rate, "Materials markup", "Overhead", "Profit", and "Charge sales tax" (**On the whole job** / **On materials only** / **No sales tax**; a blank "Tax rate" = the job state's base rate). It saves by itself; until a rate is typed it says "Enter your labor rate — this turns on once the rate is in." and nothing changes. When on, new Smart Proposal and Video estimates: materials = book cost + the markup (permit fees at cost); labor on its own lines, "Labor · <the work> (crew-hours)", hours × the rate; overhead and profit inside the prices; a note "Priced your company's way (Settings → Estimating): …". A line the AI gave no hours says "Hours worked out from the price book's labor cost — check them" — the contractor edits the hours. The proposal adds no markup on top; tax on materials only is a proposal line "Sales tax on materials (X%)". Roof, fence, HVAC, deck, blueprint and manual proposals are not affected; estimates made earlier keep their prices. Trial: each Generate uses 2 AI runs. Can't reopen a saved estimate (edit the proposal) or read PDFs ("Photos only here — plan sets (PDF) go in the Blueprint estimator.").
**Same brief, same price:** the same brief (same place, photos, prices and settings) within 30 days gets the same estimate back, with no new AI run — "Same brief as <date> — so the same estimate and the same price." **Ask for a fresh estimate** prices it again and keeps the new answer from then on. Anything changed in the brief is a new estimate.
- "The estimator returned no line items — try a more specific description." → add detail.
- "Placeholder pricing — no estimator key is configured on this environment." → sample numbers; escalate.

### Blueprint estimator
\`/dashboard/blueprint-estimator\`.
1. **Choose the plans**: PDFs or sheet photos, max 60 pages total, 120 MB per file (password-protected PDFs fail).
2. "What do you want estimated?": type the job or tap one (Countertops … The whole house), set **Price it for** (City, ST), **Estimate it**.
3. Result: lines marked Measured / Estimated / Not drawn with page links, editable quantities, **Download CSV** (quantities only).
4. **Create proposal** (1 estimator use), **Edit in Smart Proposal**, or **Ask for another job**.

The question card has three tabs: **Estimate a job** (above), **Sizes & measurements** (pick a part — everything, rooms & square feet, floor areas, windows, doors, roof, walls, foundation, drywall… — or type one; every room and size from the plans, nothing priced, **Download PDF**) and **Materials** ("What materials do you need?": pick a trade — everything to buy in the units it is sold in, waste included, each with how it was figured and its sheet; a deck is sized through Deck Studio's tables). HVAC from plans: a Manual J-style load from the sheets.
12 plan sets an hour; a plan set stays open 6 hours ("This blueprint session has expired — open the plans again."). It reads written dimensions (never scales the drawing) and states assumptions, e.g. a 6:12 pitch. Meant for new-house plans; needs a floor plan ("No floor plan could be read from these sheets. Add the floor plans and ask again."). A reload before Create proposal loses it all.
- "Nothing on these plans matches that job. Try naming the trade or the finish." → rephrase.

### Roof estimator
\`/dashboard/roof-estimator\`; price book: **Roofing inventory**.
1. "Measure a roof": Address, City, State, ZIP; pick the suggestion, check the pin.
2. **Measure this roof**.
3. Tiles: Total area, Roofing squares, Roof pitch, Roof facets, Eaves + rakes, Ridge + hips, Valleys.
4. **Build an estimate**: **Roof package** (type, underlayment, edges, flashing, vents, tear-off & extras) or **Smart estimate** (AI).
5. **Convert to proposal**.

Sources: EagleView first (when connected); answers already held and **Recent measurements** reopen free. No roof or an EagleView refusal → Google aerial data in the same click, marked estimated. **Order measurement report** (usually within 48 hours) and **Re-measure — new paid lookup** are billed. No pitch → pick one ("Enter pitch to price."). Without a full report, valleys are estimated from the roof shape — confirm on the photo. **Plywood replacement** (Tear-off & extras): "Not known yet — quote the rate" (rate shown, not in the total), "I know how much", or "Leave it out"; board type; 4 × 8 or 4 × 10 ft sheets. The client sees the roof from the air with one pin, never an outline — by design.
**Which building:** the map shows the pin for the address; drag it (or tap the map: "Measure the building under the pin") onto the building to measure — the vendor's own point can stand on a garage. A typed address with no suggestion picked: "Pick the address from the list so we measure the right building."; "Address not found — pick it from the suggestions". After measuring, the main row reads "Main · Building 1 of N"; every other building on the lot has **Make main** (it measures that building from the same order, nothing new billed) and **Show on map**. A proposal keeps its main building.
**Brand and line** (under "Roof system"): the lines of that system ranked for the job's state ("Top pick", "Your usual", **More brands**, **Any brand**; no address → "Add the roof's address to rank these for its state."). A line moves the material price from your own rate for that roof type by how its price compares with a typical line (labor stays yours); a price you type under "Your rates · <line>" is that line's own, remembered for the next roof.
**Mansard sides** (apartment buildings with a flat top): "Shingle mansard sides", length around and height up the face, priced with its own lines; when the aerial data calls the roof a mansard and nobody measured the sides, they are assumed and said so — change "Around" and "Up the face" to what is there.
Editing: proposal builder → **Edit the roof estimate** (nothing billed) → **Update PRO-…** or **Save as a new proposal**. Signed, paid or completed proposals stay locked ("This proposal is signed by the client, so its price stays as it is…").
- "No roof was found at this address (order …)" → check address and pin.
- "This address is still being measured (order …). Measure again in a minute — the paid order is collected then without a new charge."
- "Couldn't locate that house. Select a complete street address."
- "Google has no high-resolution roof data for this address. …" → use a saved or on-site measurement.
- "This order was refused: the account is not entitled…" or "Roof measurement is unavailable." → escalate.
- Per day: 30 new measurements, 5 re-measures.

### Fence estimator
Page "Fence studio", \`/dashboard/fence-estimator\`; price book: **Fence inventory**. No AI, no estimator uses.
1. "Search an address…" → **Find**: satellite view and property lines load.
2. Tick **Property sides** (street sides start unticked) → **Put down the fence**; or trace: click dots, double-click or Enter to finish, Backspace removes a dot; **Close loop**, **Undo**, **Clear**; **Add run** takes a typed length.
3. Houses are never outlined for you: Buildings → **Trace outline**, click each corner.
4. **Gate** (Single 4 ft, Double 8 ft, Triple 12 ft, Arched 4 ft) or **Door** (Solid/Slatted 3 ft), then click the line; widths are fixed.
5. Type (default Cedar privacy), height, options; slope is automatic; **Draw | 3D** shows 3D.
6. **Convert to proposal**: the client page gets the 3D fence and lot drawing (traced runs only).

Prices: catalog rates × the address's market index (no live store prices), unless set in Fence inventory. A saved fence proposal can't be reopened in the studio.
- "Parcel not found at this point. … Trace the fence manually on the map." → trace by hand.
- "Nothing to convert" → trace or add a run.
- "This organization is at its proposal cap for the period — the next proposal needs a bigger plan."
- "Map surface unavailable" → escalate.

### HVAC estimator
Replacement-first. \`/dashboard/hvac-estimator\`; **HVAC inventory** (service menu tab); **Equipment catalog** via **Manage catalog**.
1. **The job**: Full system, Outdoor unit, Furnace, Heat pump, Water heater, Add cooling, Ductless zone, Ductwork, Service / repair.
2. **The house**: address → **Look up the house** (or **Enter it by hand**): size, year built, county design temperatures. New construction: step 1's "Building from plans? Upload them here." box takes the plan set — its title-block address fills step 2, the house is looked up, and step 3 opens on the plans.
3. **What is there**: walk video (MP4 · MOV · WEBM, max 5 min → **Read the walk**), plate photos (Outdoor plate, Indoor plate, Panel), or type it in. Conditioned square footage is required.
4. **The design**: loads, a catalog unit (Manual S fit), duct checks.
5. **The estimate**: rate-card prices → **Save**, **Convert to proposal**.

The load is a Manual J-style estimate — the screen says "Manual J-based, estimating grade" — not an ACCA-approved calc; for a permit, request the Cool Calc report (when connected) or paste an approved tool's link. Reopen from **Recent estimates** (last 12); saving again updates it, no new count. Catalog: **Add a unit** adds your own; "Set up for XX" turns off units that state bans.
**HVAC services** (sidebar row under the HVAC estimator, every company's office): the service-plan desk — plans you sell, clients on a plan, visits on the schedule, reminders to you — with tabs **Today** (what needs you, each line with its button), **Schedule**, **Clients**, **Plans** (enroll a client, tied to their accepted HVAC proposal) and **Reminders** (heads-up days, a daily digest on the bell, and by text once "Service reminders" is on under Texting). Old Service plans links land here.
- "Couldn't tell the state from that address — add the state (e.g. TX)."
- "The plate couldn't be read — try a closer, straight-on photo."
- "No catalog unit lands within Manual S limits…" → pick or add a unit.
- "Plate and video reading need …" an AI key on the server → type the facts; escalate.

### Video estimator
\`/dashboard/video-estimator\`. One clip — MP4, MOV or WebM, max 5 minutes; say measurements aloud. The video file is never uploaded: the browser pulls 4–14 stills when the clip is added; on Analyze it sends those and the sound (turned into text).
1. **Add video** → optional Job ticket (Project, Address, Notes) → **Analyze video**.
2. Maybe "A few quick questions": **Use answers** / **Price anyway**.
3. **Convert to proposal** saves (1 estimator use); there is no Save, so **Start over** or leaving loses it.

The reading: Measured from video, Site notes, Assumptions, **The work**, **What the work brings with it** (Included / Allowance / To confirm), **Procedure** (materials and labor per step), **Permits & inspections** (if any); then editable Line items priced like Smart Proposal. iPhone Low Power Mode: "This browser reads a clip from a tap only — the stills are pulled when you tap Analyze video." — normal; tap Analyze.
- "Walkthroughs are capped at 5 minutes — this one is m:ss." → trim.
- "That is not a video file — MP4, MOV or WebM."
- "Couldn't pull any frames — <reason>. Tap Retry, or export the clip as MP4 (1080p) and add that." → Retry, then export.
- Subtitle "· no speech heard" → priced from pictures only.
- "Video analysis needs …" an AI key "— add it to enable this estimator." → escalate.

### Deck Studio
**An add-on, $79/mo ($790/yr on a yearly plan); $49/mo ($490/yr) for shops that bought it before 2026-10-26 — their line keeps that price through plan changes on the same term ("$49/mo (your price)"); a change of term takes the add-on off, and it comes back only at today's price.** In the trial: the whole studio; "Add Deck Studio" says "Included in your trial. After the trial, Deck Studio is a $79/mo add-on." and adds nothing — it is never added automatically when the trial ends. The one way it rides a trial: the person picks it with the plan — "Add Deck Studio · +$79/mo" over the plan cards (sign-up, Plans & upgrade, Subscription; "Included in your trial, billed after it"), or the Deck Studio switch on Stripe's checkout page; it is then billed with the plan when the trial ends. After the trial without the add-on the studio is a **Preview**: design anything, but saving, sending and printing ask for the add-on; saved decks stay, open **View only** and still print. The owner adds it with **Add Deck Studio · $79/mo** (the rest of the billing period is charged at once) and removes it on Subscription (the unused part comes back as a credit on the next bill). Cancelling the plan ends the add-on with it.
In preview, a locked button says what needs the add-on, e.g. "Saving, sending and printing are part of Deck Studio — add it to your plan ($79/mo) from the Deck estimator."
**In the studio** (\`/dashboard/deck-estimator\`, sidebar "Deck Studio"): "What are you building?" — Deck, Covered deck, Gazebo or Pergola, or **Start from a sample**; size under "Deck size & house placement" ("Size & placement" for a gazebo or pergola without a deck); the 3D follows every choice. A draft worked on in the last 48 hours is offered back: "Pick up where you left off?".
- **The house from a photo:** "House & ground" → "Build the house from a photo" → **Upload a photo** or **Take a photo** of the back (or side) wall where the deck goes, the whole wall in the picture — or a picture the client sent ("Photos your clients sent"). JobFlex reads the wall, its steps, windows and doors, storeys, roof and colour, then "Here's what I see": drag any line that's off → **Build my house**; the house wall in 3D follows the photo. Only the wall is read — never an existing deck or porch roof — and the photo is never pasted onto the 3D wall. "The wall could not be found in that picture — drag the outline to it, or take the picture square on from the yard." · "That picture could not be opened — use a JPEG or PNG." The client can build their house from a photo on their own design page too.
- **Talk** (or the round mic, "Talk to Deck Studio"): design by voice or by typing, live in 3D; the client can talk to their design too.
- **Permit plans** (the viewer's header): the permit & build set in a new tab — 11 × 17 permit drawings to scale (cover, site plan, foundation, framing, roof, elevations, section, details) and a letter-size construction set for the crew (footing layout, cut list, stringers, build sequence), drawn to the codes JobFlex has for the state, county and city (verify with the local building department). "Permit & build set" opens it from the package step too.
- **Send to client** → "Client's name", "Mobile" → **Make the link** → **Text it**, **Email it** or **Copy link**: a \`/deck-design/<token>\` page (90 days, no prices); the client's "Send my design to <shop>" returns a draft and a notification, filed under that client.
- **Save draft**; **Make proposal** (or **Save as proposal** in the footer); on a proposal opened with **Edit the deck design**: **Update PRO-…** or **Save as a new proposal** (roof lock rules).

### Website estimators
**Early: shown only once JobFlex opens it to every account** — until then only JobFlex admins see it and nothing is billed (verify whether it is open). Settings → **Website estimators** (\`/dashboard/settings?pane=website\`; Owner, Admin, Manager), "Your estimators on your website": the shop's own estimator on its own website, in its own prices. One card per trade: "Roof estimator on your website" ($179/mo), "HVAC estimator on your website" ($79/mo), "Fence estimator on your website" ($99/mo), "Deck Studio on your website" ($150/mo), "Smart Proposal on your website" ($99/mo) — billing under Plans, trials & billing.
1. Turn a card **On**. "The homeowner sees": **A price range** ("How wide · ±N%") or **The exact figure**; "Ask for their email too" (the phone is always asked); on the roof, HVAC and fence cards "What they may pick" (none ticked = all) — the Deck Studio card says "What they design" and Smart Proposal "What they describe" instead; "Under the price" (your own words, or the standard line).
2. "Your websites": the site names the button may run on, like ridgelineroofing.com (blank = any site; the link works anywhere). "Public estimates a month": a cost guard (300 by default) — past it the page rests and still takes the lead.
3. **Save** (**Save and add to my plan (…)** when a card is new). Then copy **The link** (\`jobflex.app/estimate/<your handle>/<trade>\` — for a button, Google Business Profile, Facebook, an email, a QR code), **The button** (one line where a site builder takes "custom HTML" or "embed code") or **On the page** (a frame); **Preview** works once saved. "This company has no public handle yet — the link can't be made." → escalate.
- The homeowner enters the address (roof: the pin; HVAC: the house looked up and sized; fence: drawn on the lot; deck: designed in 3D; Smart Proposal: described with photos), sees the price before tax and presses **Get my full quote** → a lead on **My leads** (source "Website") with the shop's usual new-lead alert; a homeowner who typed an email (it's optional) gets a confirmation email too.
- The lead page shows "From your website estimator" — what they chose and the price they saw — and **Open in the <estimator>**: roof — their aerial measurement is the top row under Recent measurements; HVAC — the house sized and their tier picked; fence — the lot with the fence as they drew it; deck — a draft as they designed it; Smart Proposal — the result with the lines they were priced on. Re-price and send the proposal as usual.

### Internal — for the team (not for customers)
**Code map** (under \`src/\`: pages \`app/dashboard/\`, UI \`components/v3/\`, \`actions/\`, \`lib/\`):
- Smart Proposal: \`advanced-ai-blueprint/\`, phone \`(mobile)/mobile-advanced-ai-v2\`; \`advancedEstimator.ts\`; \`estimate/\`. OpenAI. Own pricing: \`estimate/companyPricing.ts\`, \`actions/companyPricing.ts\`, \`company-pricing/\` (SyncState key companyPricing:<orgId>).
- Blueprint: \`blueprint-estimator/\`; \`planEstimator.ts\` + \`pricePlanTrade\`; \`plans/\`. OpenAI.
- Roof: \`roof-estimator-blueprint/\` (live \`roof-estimator-data-form.tsx\`); \`roofMeasurement.ts\`, \`roofEstimator.ts\`, \`eagleview.ts\`; \`roofPackage/\`. EagleView, Google Solar/Geocoding/Places, OpenAI.
- Fence: \`fence-estimator-blueprint/\`; \`fenceEstimator.ts\`, \`fenceBoundary.ts\`; \`fence/\`. Google, ReportAll, Regrid, OSM Overpass, USGS, Vercel Blob.
- HVAC: \`hvac-estimator-blueprint/\`, \`hvac-catalog/\`; \`hvacEstimator.ts\`; \`hvac/\`. OpenAI, Google, ReportAll, Regrid, USGS, Cool Calc.
- Video: \`video-estimator-blueprint/\`; \`videoEstimator.ts\`, \`api/estimator/video/transcribe\`. OpenAI (Whisper).
- Deck: the page renders \`deck-variant-1/deck-v1-studio.tsx\` (house photo \`deck-v1-house-photo.tsx\`, send \`deck-v1-send.tsx\`), \`deck-estimator-blueprint/\`, \`deck-client-design/\`, voice \`components/v3/deck-voice\`, plan set \`components/v3/deck-plans\` + \`lib/deck/plans\`; \`deckEstimator.ts\` (readHousePhoto, readHouseDepth), \`deckClientDesign.ts\`; \`lib/deck/houseFromPhoto\`, \`deck/access.ts\`, \`deckAddon.ts\`, \`editions.ts\` (\`EDITION_OPEN.deck = true\`). OpenAI (vision), Google, USGS, Resend.
- Website estimators: pane \`settings-blueprint/panes/website-pane.tsx\` + \`web-estimator/web-estimator-form.tsx\`; public pages \`app/(portal)/estimate/[slug]/[trade]\`, \`components/v3/web-estimate/*\`, \`/embed/estimator.js\`; \`lib/webEstimator\` (trades, prices, HANDOFF_WORDS), \`lib/webEstimatorServer\` (settings, counters, lead, alert), \`lib/webHandoff\`, \`lib/estimateSeed\` + \`components/v3/estimate-seed-strip.tsx\` (the estimator hand-off); \`actions/webEstimator\`. SyncState \`webEstimator:<org>\`, \`webEstimatorCounts:<org>:<month>\`, \`webEstimate:<token>\` (1 h), \`webLead:<leadId>\`; open switch \`webEstimator:open\` (admins only until "1").
- Roof building pick: \`actions/roofMeasurement.ts\` (measureRoofInstant mainIndex/included, setMainStructure; provenance.userPin), \`lib/roofDiagram/instantTotals.ts\` (pickMainStructure, pickMainStructureAt); mansard \`roofPackage\` + \`qa/tests/logic/roof-mansard.check.ts\`; brands \`roof-brand-picker.tsx\`, \`roofPackage/brands\` (Prefs.brands, Prefs.brandRates; docs/roof-brands.md).
- Smart Proposal same brief: \`lib/estimate/sameBrief\` (SyncState \`smartsame:<org>:<fingerprint>\`, 30 days, newest 300). Blueprint tabs: \`blueprint-estimator/blueprint-estimator.tsx\`, \`measure-report.tsx\`, \`measure-pdf.tsx\`, \`materials-view.tsx\`; \`lib/plans/measureReport\`.
- HVAC plans in step 1: \`hvac-estimator-form.tsx\` ("Building from plans?"); HVAC services: \`app/dashboard/hvac-estimator/service-desk\`, \`service-desk-blueprint/*\`, \`lib/serviceDesk\`, \`lib/serviceDeskBook\`, \`actions/serviceDesk\` (trail rows SERVICE_REMINDER, SERVICE_LINK, SERVICE_PREFS; daily cron service-plans).
- First-estimate tour: \`lib/onboarding/tour-paths.ts\`, \`lib/onboarding/progress\`, \`components/v3/onboarding-tour/*\`, \`actions/onboarding\`; targets are \`data-tour\` attributes.

**Env var names:** OPENAI_API_KEY, OPENAI_MODEL, OPENAI_VISION_MODEL; GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY; EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET, EAGLEVIEW_API_BASE_URL (defaults to sandbox); flags ROOF_MEASUREMENT_PROVIDER, ROOF_DRAWING_ENABLED; REPORTALL_CLIENT_KEY, REGRID_API_KEY; COOLCALC_CLIENT_ID, COOLCALC_API_KEY, COOLCALC_DEALER_ID; BLOB_READ_WRITE_TOKEN; NEXTAUTH_SECRET or AUTH_SECRET (blueprint sessions); RESEND_API_KEY.

**Known failure modes:**
- Estimator uses = saved AiEstimate rows; roof, fence, HVAC and deck never add to it. A retried Smart/Blueprint save writes another row.
- Thrown refusals (roof Smart estimate, report orders, roof scans; save/convert plan checks) are redacted in production → a generic error, or "JobFlex was updated…" (clientErrorText's stale regex matches the redaction) (verify).
- EagleView 403 → Google fallback; a Google key without Geocoding/Solar breaks lookups.
- Video/HVAC audio uploads in ≤100 s chunks (Vercel 4.5 MB cap); a failed chunk is dropped silently.
- \`/mobile-roof-estimator-v2\`, \`/mobile-fence-estimator-v2\`, \`/mobile-smart-estimate-v1\` are demo fixtures (Convert creates nothing) that still open if typed. Phone Smart Proposal "Margin" never reaches the proposal. Plan-limit dialog may not mount on phones (verify).
- Stale copy: "Real materials with retail pricing" and "priced against live retail" — no store prices since 2026-10-09.
- HVAC catalog "Service menu" → \`/dashboard/hvac-services\`, no route — 404 (real: \`/dashboard/hvac-estimator/inventory?tab=services\`). Cool Calc untested on a live account.
- Website estimators: the settings card says the four trades ("roof, HVAC, fence or deck") while Smart Proposal is the fifth; the Smart Proposal and fence prices were stand-ins when written (owner confirmed fence $99 on 2026-10-27). A lead's estimate is read from SyncState — a lost \`webLead:\` row leaves the lead without its card.
- Deck: Estimator role sees the row, the page redirects it; a failed \`?draft=\`/\`?proposal=\` load opens a blank studio silently.`;

/** Proposals, clients, leads, projects, client payments, homeowner portal. */
const PROPOSALS = `## Proposals, clients & projects

### Creating a proposal
- Ways in: topbar **New Estimate** (Manual, Smart Proposal, Blueprint, Roof, Fence, Video, HVAC, Deck Studio); Proposals page **Smart Proposal** / **Manual proposal**; **New proposal** on a client or project page; a lead's "Estimate this job" cards.
- Every proposal opens in the "Manual proposal" builder (\`/dashboard/manual-blueprint\`). Cards: The job, The client, Line items, Show to client (with Copy client link / Text the link once saved), The drawing (fence/deck), Cost adjustment, Scope & notes, Terms, Payment & deposits, Files, The PDF. Bar: **View proposal** (opens the client's page in a new tab, saving first if there are unsaved edits) / **Save** / **Save & send**. Blocks: "Add a title before saving", "Add at least one named line item".
- Never saved: the Terms box ("Prints on the sheet — not stored on the proposal yet") and Files (**Attach a file** uploads nothing).
- Reference: \`PRO-XXXX\` in the app, "Proposal № XXXX" on the client page; the server PDF prints a different "#XXXXXXXX".
- "Valid until" = created + 14 days, display only: nothing expires a proposal or its link; the "Expired" filter stays empty.
- Cap: "Monthly proposal limit reached".

### Prices, discount, tax
- Estimator prices are selling prices: Roof, Fence, HVAC and Deck Studio copy them unchanged. Smart Proposal adds the company's default material/labor markup.
- Cost adjustment: material/labor % are baked into line costs on save (sliders reset to 0); overhead and profit sit inside each line's price, never as lines.
- Discount (% or $) comes off the subtotal before tax, capped at the subtotal. Tax: estimators use the job's state rate, else the company default; the builder starts from the company default (state guess only when that is 0).
- Default markup and tax are set only at \`/dashboard/settings/proposals\` → **Save pricing** (no menu link).
- Estimator proposals get Deposit 30% / Completion 70%; manual ones start empty ("No stages — the balance is due on completion.") and the client sees one "Full payment" stage.

### Logo, colour, pictures, audio
- Company → Branding: Logo "Drop or click" (PNG, JPG, WebP or SVG up to 15 MB), **Replace** / **Remove logo**; Brand color. Logo shows on the client page, email and PDF; colour only on the client page.
- Client page pictures: fence 3D ("Your fence, as it will stand") + "Your fence on the lot"; deck 3D; roof aerial with ONE pin, never an outline (no aerial → no picture).
- "Listen to this proposal" is retired: "Proposal audio is no longer available."

### Sending
- **Save & send** (no email on file → "Where should this go?"), or list ⋯ → **Send to client**: a typed email is saved on the client record; a proposal with no client is filed under the client with that email or a new one ("Add the client's name — this proposal has no client yet."). Empty box → **Mark as sent**: "No email went out — there is no client email. Add one and send it again, or share the client link."
- First send may ask "What's your company called?".
- Email "Your proposal from <Company>", button **Review & accept**, "Price held until <date>". From the JobFlex address, replies to the contractor (Gmail reply-to, else billing email) — or from their Gmail if connected.
- Texts to clients go only from the company's approved texting number, only to phones that ticked "Text me about my visit and estimate from <Company>." on its booking page (else skipped), never in a card-less trial. The link text also needs Texting → "Texts to clients" On and a client email. Else **Text the link** / **Copy client link** (from the contractor's own phone).
- Failure: "Couldn't send the proposal email. Please check the client's email address and try again." — stays unsent.
- **The Proposals list:** a draft's row has a green **Send**; a proposal that was sent shows a tick, **Sent** and how long ago, with **Resend** beside it (signed or declined ones too). Sending again never moves a viewed, accepted or paid proposal back to Sent. Under each row a payment line: every stage and where it stands (paid with the date, due, overdue, invoice sent, reminded; before signing "Billed after <the client> accepts"), with **Mark paid** / **Send invoice** / **Remind** for the next stage — managers only; sales reps and estimators see the stages. Every row names its work and the tool that made it (Deck Studio, the roof/fence/HVAC estimators, Smart Proposal, video, blueprint, by hand); **Type** narrows the list to one kind of work.

### The client's page (\`/portal/q/<id>\`, no login)
- Logo, rating, **Download PDF**, Total, Valid until, pictures, Overview, Estimate detail (Subtotal · Tax · Approved changes · Total due), Scope of work, Payment schedule, Terms & conditions (company-level only; no current screen saves them), phone.
- Show to client → Price per line: "Totals only" or "Labor + material breakdown" (default: "Materials $X · Labor $Y" per line); "Scope of work"; "Signature lines" (builder PDF only).
- A discount has no line on the web page (Subtotal is pre-discount); the server PDF prints "Discount".
- Client opens: Sent → Viewed, Views +1; signed-in team opens don't count. A draft shared by link stays Draft.

### Accept, decline, undo
- "Your full name" + **Accept proposal** ("Enter your full name to accept the proposal."). Name, time, IP kept; an unscheduled job appears (Calendar → Unscheduled); client gets "Thanks for accepting — <Company>".
- No client undo: "An acceptance can't be taken back from this page — contact the contractor." Office: Accepted tab → **Un-accept** (to Draft; "A proposal with paid stages can't go back to draft.").
- Decline needs a note ("A note is required so the team knows why.") → **Confirm decline**; **Revert decline** "Only while this page stays open". Declined + Accept: "This proposal has already been settled." Sending again reopens it.

### Client payments
- Paid to the contractor's own Stripe / Square / Stax (Settings → Integrations / Payments, Owner only) or bank transfer (no platform fee).
- After acceptance only ("Accept the proposal first"); stages in order ("Stages are paid in order — pay the earlier one first.") or Everything. **Make payment** / **Open payment center** → "Pay $X via Stripe". Minimum $0.50 card, $1.00 Square/Stax. Checkout lasts 60 min ("This payment is already being processed in another window."). Nothing set up: "The team will be in touch about payment."
- Return: "Confirming your payment…" → "✓ Payment received — thank you." / "✓ Paid in full — thank you." or "Your payment is taking a moment to confirm…" (rechecked every 30 min). Last stage paid → Paid.
- Managers only: **Mark paid**, **Undo** (manual only), **Mark paid in full**, **Send invoice** (Card — pay online / Bank transfer / Client's choice), **Remind**, **Auto-remind · company/on/off**. Reopening a card-paid job: "Refund it from that dashboard — the proposal syncs back automatically."
- Bank details, Default deposit %, Receipts on payment: phone layout of Settings → Integrations / Payments, Get paid tab, only (verify).

### Monthly payments (Wisetack financing)
- **Not open to customers yet** (2026-10-28): JobFlex turns it on per company from the admin console once the Wisetack partnership is live. Until then no customer sees it; tell anyone who asks that financing through Wisetack is coming and the team will let them know.
- When it is on: **Settings → Integrations / Payments → Financing** (phone: a "Financing · Wisetack" card on the Get paid tab). Owner/Manager only. "What lenders usually look at" (a guide: business name, phone, email, address, website, trade, year started), **Apply with Wisetack** (opens Wisetack's page with the business filled in), or **I already use Wisetack** (links the account by its email). States: Started, In review ("Usually 1–3 business days"), Needs info (**Finish on Wisetack**), Approved, Not approved, Paused; **Check again** asks Wisetack. Approved shows the job limits, "Wisetack's fee: 3.9% of each financed job", the switch "Offer monthly payments on every new proposal" and the company's "check your rate" link.
- Each proposal: builder card "Payment & deposits" → **Offer monthly payments** (starts from the company switch). It locks with the reason: not set up, waiting for Wisetack, under the minimum / over the maximum, paid, plan ended.
- The client: before signing, "Monthly payments are available." + **See what you qualify for**; after signing, **Pay over time** ("Check your rate — it won't affect your credit score.") opens Wisetack for what is owed now. Back on the proposal: "You're approved for $X", "Monthly payments are set", "Not approved this time" (the other ways to pay stay). An accepted loan pays the last stages ("Monthly payments" on those rows); the rest is paid as usual ("The rest: $X").
- The office: proposals row line ("Client approved for $X", "Loan accepted · $X", "Paid $X through Wisetack") and **Send financing link** (texts the client when the company texts its clients, else emails). The crew's **Complete** asks Wisetack to have the client confirm the job is done; Wisetack's payout arrives as a payment (Financing, no JobFlex fee) and the stages it covers read Paid. Texts and the bell: Settings → Notifications "Financing".
- JobFlex never sees a client's credit or income, never states a rate or a monthly figure, and has no say in approvals — those are Wisetack's (verify any specific Wisetack rule with Wisetack support).

### Editing, change orders, delete
- Any status edits in the builder; the client's link updates at once. Locked: paid stages ("…is already paid and can't be removed"), a stage mid-checkout ("…is being paid right now…").
- **Edit the roof estimate** / **Edit the deck design** → Update refuses signed, paid or finished work: "This proposal is signed by the client, so its price stays as it is. Save the new estimate as a new proposal."
- Signed work → **Change order** (managers): **Save draft** / **Send for approval**; client approves at \`/co/…\` with full name + tick ("Tick the box to agree to the change."); **Approved in person**, **Withdraw**. Approved = its own payment stage.
- Duplicate: no button on the current Proposals page (verify).
- **Delete proposal** → **Delete forever**: any status, permanent, link dies.

### Clients, CRM, leads, projects
- Clients → **New client** (Notes "Internal — never printed on a proposal.", "Mark as VIP"). Record: **Edit**, **Add to project**, **Message**, **New proposal**. No delete. Estimators can't add clients ("Sales or manager access required").
- Sales reps/estimators see only their own proposals; others' open as "That proposal is gone — this is a new one".
- CRM: Today, Office, Overview, Customer book, Workflows (manager follow-up rules: status + delay, Email/Text; four starter rules marked Default — Sent day 2/5/10, Viewed day 3 — deleting one turns it off; a status line with "Turn on defaults" when every rule is off; Preview shows the message on a sample proposal), Follow-up queue (hourly; Done stops one).
- Leads: **My leads** / **Incoming** / **Import leads**. On My leads: **All**, **From JobFlex** (the Lead Center's) and **Your own leads**, with "Source:" for your own (website, Angi, Thumbtack, Yelp, Google… or "Where it came from" when added by hand); **Table** / **Board** (New, Routed, Claimed, Contacted, Quoted, Won, Lost). Estimate cards carry the lead's name, address and scope; its client is matched by email/phone or created (estimators only match).
- Facebook and Instagram lead forms: with the Page connected and **New leads come in by themselves** on (Settings → Integrations → Meta business; off at first, and saving SmartBook with Facebook leads ticked turns it on), new leads come in by themselves every 5 minutes from the moment it was turned on, tagged Facebook, and the office is told; **Import leads** there brings in older ones (duplicates skipped). SmartBook can answer them with times (see Operations → SmartBook).
- Projects → **New project**; page: **New proposal**, **Attach proposal**, Budget (**Set budget**, **Log expense**), List / Calendar / Gantt. Sales reps can't create projects.
- The Online booking dashboard (\`/dashboard/booking\`) is early access: customers are redirected. Service plans moved to **HVAC services** under the HVAC estimator (see Estimators), open to every company's office.
- **Mark completed** emails one "How did we do?" (+1 reminder at 7 days); public reviews \`/r/<company>\`.

### Leads from JobFlex (Lead Center)
- JobFlex offers homeowner requests to shops whose Company → Lead matching fits ("Accept platform leads" on, the trade under "Trades you take", inside the "Service radius, miles" of the "Business address"). An offer pops up in the app — "New lead · reserved for you" (or "New lead · sent to you" when the JobFlex team routed it) — with the trade and area, and when they apply "Priced by the homeowner: <range>" and "Exclusive — nobody else gets this lead". It also waits under Leads → **Incoming**.
- **Accept** (a priced lead: **Accept · $X** → "Unlock lead": "Charge $X to <card>?" — "Lead purchases are not refundable." — → **Charge $X**, or Stripe's page when no card is on file) or **Pass** (it goes to the next shop). An offer lasts 24 hours, with one reminder in its last 2 hours. After paying: "Lead unlocked — The homeowner's contact details are on the lead now." If another shop got it first: "Lead no longer available — It went to another shop first — your payment is being refunded." Cancelled on Stripe: "Payment cancelled — Nothing was charged. The offer stays open until its time runs out." Lead prices are JobFlex's; refund requests go to the team.
- **Priced by the homeowner:** homeowners can price their own job on JobFlex's homeowner pages (\`/homeowner\`: roof, HVAC, fence, deck or any project — always a range) and send it to a local JobFlex pro; it arrives as a Lead Center lead. Accepted, the lead page shows "Priced by the homeowner on JobFlex" — what they chose and the price they saw, before tax — and **Open in the <estimator>** opens your estimator with it (the same hand-off as a website lead — see Website estimators). The price they saw came from JobFlex's own estimator and prices, not yours: re-price it before you send the proposal.

### Homeowner portal
- No accounts — links only: proposal, \`/co/…\`, \`/plan/…\` ("This link is not active"), \`/request/…\` ("Track your request"), \`/home/<key>\`. Lost: \`/home\` → **Email me the link**.
- \`/homeowner\` is JobFlex's own homeowner page: a homeowner prices the job there (\`/homeowner/price/<trade>\`) and sends it — it becomes a Lead Center lead (above), and their confirmation email links the request page.
- Request page and home dashboard exist only for requests sent through JobFlex; they list the contractor's SENT proposals for a client record created after the request. A pre-existing client won't see it there (email still arrives).

### Common problems
- No email → check the record's email and spam; Activity "…went out from the JobFlex address…" = Gmail failed; resend or copy the link.
- "Link expired" → proposal links never expire; not found = deleted.
- Can't change a signed price → builder edits work; estimator Update doesn't; use a change order.
- Payment missing → wait for the recheck; bank/cash must be marked paid.
- Can't pay → accept first, earlier stage first, minimum, or no processor.
- No text → see the texting rule above; use **Text the link**.
- "Numbers don't add up" → the web page has no discount line; the PDF shows it.
- "Too many requests — try again later." → hourly limit per internet connection (IP) on accept, decline, pay and PDF.

### Internal — for the team (not for customers)
- Code: list \`src/app/dashboard/proposals\` + \`components/v3/proposals-blueprint/proposals-behavior.ts\` (phone \`src/app/(mobile)/mobile-proposals-v2\`); builder \`components/v3/manual-card-lab/manual-blueprint/*\` (bridge = what persists); client page \`src/app/(portal)/portal/q/[publicId]/*\` + \`components/v3/mobile-proposal-client/*\`; actions \`src/actions/{proposals,installments,notify,changeOrders,clients,leads,leadEstimate,projects,servicePlans,followUps,homePortal}.ts\`; APIs \`/api/public-quote/[publicId]/*\`, \`/api/pay/{stripe,square,stax,wisetack}\`, financing \`lib/financing/*\` + \`/api/webhooks/wisetack\` + \`/admin/financing\`, \`/api/proposals/[id]/pdf\`, \`/api/public-co/[token]/*\`, webhooks \`stripe-connect\`, \`stripe-key\`, \`square(-key)\`, \`stax\`; lib \`notify.ts\`, \`email/build/client.ts\`, \`email/orgSend.ts\`, \`sms/send.ts\`, \`payments/*\`, \`paymentSchedule.ts\`, \`proposalPictures.ts\`, \`pdf/ProposalPdf.tsx\`, \`followUps/engine.ts\`, \`requestPortal.ts\`, \`home/portal.ts\`, \`earlyAccess.ts\`. Email copy: \`lib/email/build/client.ts\`; only the bodies of the newest "Proposal sent" / "Thank you" templates (\`/dashboard/settings/email\`) are used, never their subjects.
- Env names: RESEND_API_KEY, EMAIL_FROM, SMTP_*, GMAIL_OAUTH_*, TWILIO_*, STRIPE_SECRET_KEY(_TEST), STRIPE_CONNECT_CLIENT_ID(_TEST), STRIPE_CONNECT_WEBHOOK_SECRET(_TEST), SQUARE_APPLICATION_ID/SECRET, SQUARE_WEBHOOK_SIGNATURE_KEY, PAYMENTS_STAX_LIVE, TOKEN_ENCRYPTION_KEY, PLATFORM_FEE_BPS, WISETACK_API_BASE / WISETACK_API_KEY / WISETACK_WEBHOOK_SECRET / WISETACK_PARTNER_SHARE_BPS, BLOB_READ_WRITE_TOKEN, GOOGLE_MAPS_API_KEY, EAGLEVIEW_*, CRON_SECRET. Skipped texts are SmsMessage rows (SKIPPED: no-number / no-consent / plan-ended).
- Failure → cause: "Couldn't start checkout — please try again." = provider refused the session (key, permissions; logged \`[createCheckout]\`); "This payment method isn't set up on the platform." = platform keys or TOKEN_ENCRYPTION_KEY missing; "…went out from the JobFlex address…" = Gmail grant failed/revoked; SKIPPED no-number = company texting number not approved.
- Proposals row (2026-10-23): Send / Sent and the payment line in \`proposals-behavior.ts\`; kind + tool \`lib/proposalKind\`. Leads: origin filter \`lib/leads/sources\`; Lead Center \`lib/leadCenter/*\` (\`cascade.ts\` OFFER_TTL_MS 24 h, OFFER_REMINDER_MS 2 h; \`purchase.ts\`; \`accept.ts\` copies the homeowner's estimate to \`webLead:<leadId>\`; \`estimate.ts\`, \`estimateStore.ts\`, \`autoPrice.ts\` — per-trade switches, off), \`actions/leadOffers\`, \`actions/leadPurchase\`, \`components/leads/LeadOfferPopup.tsx\` + \`LeadPurchase.tsx\`; lead page \`app/dashboard/leads/[id]/page.tsx\` + \`lead-detail-blueprint/lead-detail-content.tsx\` (website/house card). Homeowner pages \`app/(marketing)/homeowner\`, \`app/(portal)/homeowner/price/[trade]\`, \`lib/home/portalPrice\`, house org \`lib/publicEstimate/store\` houseOrgId (HOUSE_SLUG "jobflex"); admin \`/admin/lead-center\`.
- Risks: "Internal notes" says "Never printed." but both server PDFs print it as "Notes"; **Send to client** now keeps VIEWED/ACCEPTED/COMPLETED/PAID (only sentAt moves; a signed contract schedules no follow-ups) — before 2026-10-23 a re-send flipped them to Sent; the reminder ladder runs only for companies whose reminder mode is "auto", which no reachable screen sets — card "Auto-remind · on" does nothing; the client's own accept/decline never triggers follow-up rules (the first client view does; a queued follow-up is dropped at send time once the proposal is accepted, declined or paid); \`/dashboard/settings/proposals\` saves only pricing (validity, follow-ups, schedule, terms are cosmetic); "Default deposit %" is never applied; duplicate drops the discount; Stax payments show "Paid · manual"; fixtures that save nothing: \`/dashboard/manual-{cards,focus,lines,quiet,sheet,steps}\`, \`/dashboard/estimators/manual\` (desk and phone).`;

/** Operations & communication — calendar, jobs, crews, inventory, texting, AI desk, emails. */
const OPERATIONS = `## Operations & communication

### Overview, calendar, visits, jobs
- **Overview** (\`/dashboard\`): KPIs, "Revenue Trend", "Recent Activity" (last 10 events), "This Week", "Upcoming Jobs", "Lead Flow" board (New, Routed, Claimed, Contacted, Quoted — drag to move).
- **Calendar** (\`/dashboard/calendar\`): Month / Week / Team (office only). "New event" = Job event, Appointment, **AI desk hours** (hours kept open for the AI desk to book into: For, "Every week, same day and hours" → **Reserve hours**; start and end on the same day) or Blocked time. "Unscheduled" tray: "Drag a job onto a day to schedule it". "Crew inbox" = crew confirmations.
- **A visit** is an Appointment (estimate, inspection, service call), booked by the team, online or by the AI desk; its card says who booked it ("By the AI desk, on a phone call · <date>", "Booked online"). \`/dashboard/visits/<id>\` is the service report: equipment, checklist, readings, findings → "Save and send to the client".
- **Jobs** (\`/dashboard/jobs\`) are installs: All / Scheduled / In progress / Completed / Canceled; "New job", "Schedule job", "Assign crew". A client accepting a proposal creates the job. Unanswered crew show "Not accepted yet".
- **Messages** (\`/dashboard/messages\`) is the team's internal chat. Clients are emailed or texted from the client record.

### Crew on site (worker portal)
- Each worker's link \`/w/<token>\`: "Needs your response" (Accept / Decline), Today, Upcoming. A worker with a password is sent to sign in instead.
- "Start work" → "Back on site" (once a day, later days) → "Complete"/"Mark completed". "Add photos or videos" (Before / Progress / After), "Close day", "Send receipt".
- Errors: "This job is closed.", "Start the job first.", "Today is already on the clock.", "You can only work on a job you are on."
- Completing marks the proposal Completed and emails the client a review request. Start, back on site, complete and the first photos of a batch text the owner, admins and managers whose Text switch is on (never the presser) and land on the bell.
- Files up to 100 MB ("That file is over the 100 MB limit."). "Videos need the company's file storage, which is not switched on yet…" is a platform setting — escalate.

### Workers, Hire & Work
- \`/dashboard/workers\` → "Invite worker" (role Installer / Sales / Estimator / Manager; box "Text their schedule to this phone…") → "Send invite". Mail failed → "Invite not emailed" + a link to copy. "Plan limit reached — your plan's worker seats are full. Upgrade under Subscription to invite more."
- \`/dashboard/hire\` "Hire & Work": Hire = network tradespeople; Work = your own posts.

### Inventory
- Per estimator: \`/dashboard/<roof|fence|hvac|deck>-estimator/inventory\`; tabs "Price book", "Stock" (HVAC: "Service menu").
- "What we stock": "Kept in stock" (counted, reserved by sold jobs, reordered when low) or "Bought per job" (never low; on the sold job's shopping list under Orders). Orders are emailed to the supplier; no address → "<name> has no email yet — add one on the Suppliers card". A daily check posts bell notices for low stock and short jobs starting within two days.

### Texting (SMS)
- JobFlex owns Twilio. Company texts leave **only from the company's own toll-free number, registered in its name**; until approved nothing is texted (email and in-app alerts still work). The six-digit code that verifies a mobile comes from a Twilio number, not the company's.
- **Get it:** Texting (sidebar → Automation, under AI desk: \`/dashboard/texting\`) → "Get your number" → form → "Register my number". Needs an owner/admin/manager, a paid plan (active or past-due, not Free; a trial doesn't count: "Your own texting number comes with a paid plan.") and online booking on (sidebar → Online booking; the error says "Settings → Online booking"). Name, EIN, address exactly as the IRS letter (CP 575) or state registration. Gmail/Yahoo contact → tick "Show this email on my booking page". JobFlex pays.
- **States:** Waiting — calls work now; texts "usually within 3 business days"; checked hourly, "Check now" asks at once; turns on by itself. Approved — "On — approved by the carriers". Sent back — Twilio's reasons listed; fix, "Fix and send again" while the edit window is open, else "…Release the number and start again." Failed — "Something went wrong on the way to Twilio." Releasing the number also ends its calls (AI desk).
- **Who:** Office (owner, admin, manager, accountant), Sales & estimators (their own deals), Crew (assigned, moved/cancelled, ~6 PM tomorrow / ~7 AM today lists). Own row: "Add mobile" → "Text me a code" → "Verify"; others get a welcome text with the STOP line. "Also text": up to 10 extra numbers. "Text clients": proposal link + 6 PM reminder before a visit, **only to clients who ticked "Text me about my visit and estimate…" on the online booking page** — clients added any other way never get texts. "Your own texts": up to 30. "Lead texts from JobFlex" (a switch here) text the company phone, only once JobFlex's own number is approved (verify).
- **Rules:** team texts 8 PM–7 AM (company time) wait until 7 AM (several fold into one "overnight" text); new leads never wait; your own texts to clients never go 9 PM–8 AM. STOP blocks a phone until it texts START. Same text twice in 10 min goes once. 25 per number / 500 per company a day. Replies show on the bell and go to office numbers.
- **Costs:** "N of X texts this month" (Free 50, Starter 250, Professional 1,000, Advanced 4,000); at the allowance texting stops until next month, nothing billed ("SMS allowance used — upgrade or wait for the next cycle"). "The free trial without a card sends no texts except the verification code. Add a card to unlock full limits." Ended plan: "Your plan has ended, so texts from your company's number are paused…"
- **Messages:** "That doesn't look like a US or Canadian mobile number." · "Too many verification texts. Try again in …" (5/hour) · "That's not the code. N tries left." · "That code expired. Ask for a new one." (10 min) · "<number> replied STOP to JobFlex texts. Text START to our number from that phone first." · "Your sign-in has run out. Refresh the page and sign in again — nothing was changed." · "Texts go out from your company's own texting number — get one in Settings → Texting" · "<Client> hasn't agreed to texts yet — clients agree when they book online".

### AI desk
- \`/dashboard/phone\` ("AI desk") has two tabs: **Calls** (call log, transcripts, "Create lead") and **AI desk setup** (\`/dashboard/phone?tab=settings\`; old Settings → AI desk links land here). "Owners and managers set up the AI desk." The desk sends no texts.
- **AI desk setup:** a strip (Desk number, Minutes left, Calls this month, Voice), then "Set up the desk" — four steps, each opened with **Open** ("N of 4 set up"):
  1. **Phone & forwarding** — "The desk's number" (= Texting's number, or a line JobFlex lent; **Get your number** goes to Texting), "Your business phone" (same field as the Company page's phone) → **Save**, "How do customers reach the desk?" (They call the desk's number / My number forwards the calls I miss / My number forwards every call), "Who answers" ("The desk answers every call" / "Ring my phone first", 25 s).
  2. **Your business** — "What kind of business are you?": type the trade → **Preset the desk**. More than 40 trades are preset in depth — what the trade does, its services, its own intake questions and answers to what its callers ask; an unlisted trade gets one written by the AI ("No ready preset — the AI writes one for this business") or the general preset. The parts callers will hear as promises are highlighted ("N to check"): **Show the next**, then fix it, edit it or **Looks right**. "Describe your business" (type or **Say it instead**) → **Write it professionally**; "Anything else the desk should know?" → **Work it into the instructions**; **Save the instructions**. **Preset again** replaces the instructions ("Replace them" — your edits to them are lost). The greeting should say it is a virtual assistant and the call is recorded.
  3. **Booking** — "Your time zone"; "Where the desk books visits": **Our open hours** (any open time on the online booking hours, up to your crew count) or **Only hours we reserve** (only hours kept for the desk; each visit goes to the person whose hours they were; an owner or manager chooses). "Reserve hours": For (a person, or "Anyone at the company"), Repeats (One day / Every week), Day, From, To → **Reserve …**; **Remove** gives them back; "Nothing reserved yet." Salespeople reserve their own on the Calendar (New event → **AI desk hours**). Booking off → messages only.
  4. **Voice & test** — **Hear it**, "Try it by text", **Call the desk** (browser, ≤5 min, nothing saved, uses minutes).
  **Minutes** opens from the strip's "Minutes left".
- **Every call's intake:** the desk asks what fits, one question at a time — the caller's own words, the trade's questions, then address, own or rent, timeline, a budget range and who decides on big jobs, best contact, how they heard of you, access — and writes the answers as labelled lines into the booking's or message's notes: the lead the team reads. The list is "What the desk finds out on every call" in the instructions, editable. An email heard on a call is kept on the lead; nothing is emailed to it.
- **Financing:** once a company is approved for Wisetack financing (not open yet — see Monthly payments), its desk answers the financing question with Wisetack's line; an answer the owner wrote is never replaced.
- **Forwarding** is set at the carrier. Every call: Verizon \`*72\`+number (off \`*73\`); AT&T/T-Mobile \`**21*\`number\`#\` (off \`##21#\`). Missed: Verizon \`*71\`+number; AT&T/T-Mobile \`**004*\`number\`#\` (off \`##004#\`). iPhone: Live Voicemail off. Some carriers won't forward to toll-free. "Test my forwarding" calls the business phone (missed: don't answer, ~30 s).
- **Does:** answers, books open times, takes messages (→ leads), transfers to the business phone; 10 min max. **Doesn't:** text, take payments, book with booking off, answer an unforwarded phone.
- **Minutes:** plan minutes per month (defaults Starter 0, Professional 150, Advanced 500 — verify), then "Add 300 minutes — $29", no expiry; "Auto top-up" at ≤5 min. Out: calls ring the company phone or take a message; owner emailed.
- **Problems:** "Not on your plan — calls ring your phone" · "No number yet — get one in Phone & forwarding" (comes from Texting) · "Answering its number — your forwarding isn't confirmed yet" · "(the live desk is not connected yet — callers are asked to leave a message)" (escalate) · "The desk is out of minutes — add 300 minutes below, then test it." · "…needs the AI service, which is not set up on this workspace." (escalate) · "Too many test calls. Try again in …".

### SmartBook (times for new leads)
- **Where:** Settings → **SmartBook** ("Times for new leads", the same form on a phone). Owners, admins and managers set it up; it is **Off** until someone turns it on and presses **Save**. Every plan and the trial. It offers the open hours of Online booking — "Online booking is off…" in the form means turn that on first.
- **What a lead gets:** within a couple of minutes, 2–4 open times ("Times in each message") by text and email — "1) Tue Nov 3, 10am…", a link to their own page with every open time and **Suggest a time**, and "Reply STOP to opt out". A reply "2" (or a tap on the page or the email's button) books it on their lead: "You're all set…". Their own time ("can you do Saturday at 9?") gets "Let me check … with the team … and get back to you shortly", and the company is asked (below). Questions are answered from the AI desk's instructions; "a person" hands them to the team ("Handed to you"); they're answered in their own language.
- **Which leads ("Which leads"):** Facebook and Instagram lead forms (they come in by themselves every 5 minutes while **New leads come in by themselves** is on in Settings → Integrations → Meta business — saving SmartBook with this ticked turns it on; Import stays for older leads), your website estimators, JobFlex Lead Center leads once accepted, messages left with the AI desk. "Leads you add or import" are off at first — use **Offer times** on the lead. Leads that came in before SmartBook was turned on are left alone.
- **Texts only to people who agreed:** the texts box on the Facebook form, the website form (every estimator already asks), "Text me" on their SmartBook page, or a yes on a call with the AI desk. Everyone else gets the email — a button for each time and "Prefer texts?". Texts leave from the company's own texting number ("No texting number yet — SmartBook emails until you get one in Texting") and count toward the month's texts ("This month's texts are used — SmartBook goes on by email until next month."). A lead that comes in 9 PM–8 AM (company time) gets the email at once and the text at 8 AM. STOP ends texts ("Texts stopped").
- **The Facebook texts box:** Settings → SmartBook → "The texts box on your Facebook form" → **Copy** the words; in Meta Ads Manager duplicate the lead form (a published form can't be changed), under Privacy add a custom disclaimer with a checkbox, leave it optional, publish the copy and use it in the ads. Within a few hours the form says "N of your M Facebook forms have the texts box." A second box ("For SmartBook's call, a second box") is the yes to the AI call.
- **When a customer names their own time ("When a customer names their own time"):** **Ask me first** (default) — everyone who keeps **SmartBook requests** on in Notifications gets a text and an email, and it waits on the Calendar under **SmartBook requests** and on the lead. Answer YES (books it, tells them), NO (they get other open times) or another time ("Monday 2pm" — they're asked to confirm it), by text, from the email's page or with the buttons; whoever answers first wins, later answers get "Already answered — this request isn't waiting any more." No answer: the company is reminded after 1 business hour, the customer hears "Still checking…" after 3, and after a day they're offered other times. **Book it if my calendar is free, then tell me** books a free time inside your hours at once.
- **No reply:** a reminder after 4 business hours (business hours here = 8 AM–8 PM, company time), another the next morning, then fresh times; two days later it stops ("No reply"). With **One AI call if there's no answer in 2 business hours** ticked, the first follow-up is one call from the AI desk, from the company's number, 9 AM–7 PM Monday to Saturday company time (a call due later waits for those hours, unless that's more than 16 hours away — then it skips the call), only to people who agreed to calls (the Facebook calls box; website and Lead Center leads already agreed). It is the AI desk's own call to a lead (the same one as "Have the AI desk call" on the lead page and the desk's **Call new leads**), so there is never a second automatic call: if the desk already called them, SmartBook doesn't. A person hears the times already sent and can book or ask for another time; a voicemail gets a short message pointing at those times, nothing booked; "don't call me" stops SmartBook too; "a person" rings the company phone. It uses desk minutes and shows on the lead's Visits & calls, the AI desk's Calls and the lead's timeline. "SmartBook can't call yet: <why>" in the form uses the desk's own reasons (the live desk isn't on, calls aren't connected, not on the plan or this month's calls used, no desk number, the desk's business details not set up, out of minutes) — it follows up by text and email meanwhile. A lead who answers SmartBook counts as reached, so **Call new leads** leaves them alone; a visit booked through SmartBook moves the lead to Contacted.
- **Calling in:** a SmartBook lead who calls the AI desk is known by their number — the desk offers their times, books or moves the visit, takes their own time as a request, all on the same lead (no second lead).
- **On the lead:** the SmartBook card under the contact card — its status (Times sent, Needs you, Booked, No reply, Not interested, Handed to you, Paused, Texts stopped, Canceled), the times, a waiting request with its three answers, the conversation, and **Pause** / **Restart** / **Offer times**. A text or email sent to the person from the client record pauses SmartBook for them. The leads list shows "SmartBook · <status>" under the stage (desk and phone).
- **Send me a test** (after **Save**): you play the new lead — a text to your verified mobile and an email. Reply like a customer; for two hours your texts go to the test. Nothing is booked or held, nobody else hears of it.
- **Problems:** "Keep Text or Email on — SmartBook needs a way to reach people." · "Nothing is open on your calendar in the next N days…" (check Online booking hours) · a Facebook lead got only an email → the form has no texts box, or they didn't tick it · a lead got nothing → SmartBook off, the source unticked, the lead older than turning it on, or no phone and no email · a customer says the time was taken → it was booked by someone else; they get other times.

### Emails JobFlex sends
- **Client mail** (proposals, receipts, invoices, reminders, change orders, follow-ups, reviews, bookings, visit reports) and supplier orders: from the company's Gmail if connected (Settings → Integrations → Gmail, "Send from my Gmail"), else the JobFlex address (code default \`app@jobflex.app\` — verify) with reply-to = "Reply-to address" or billing email. A failed Gmail send falls back and logs "…Reconnect it in Settings → Integrations → Gmail."
- **Team mail** from JobFlex per each person's Email column (Settings → Notifications); new-lead mail: owner only.
- **Support replies:** reply-to support@jobflex.app, subject "Re: <subject> [JobFlex <ref>]".
- Deliverability: "Connect Gmail" then "Send test email"; set "Reply-to address" (used with or without Gmail).

### Notifications bell, activity trail
- Bell: 12 newest events, filtered by your In-app column ("Send test notification" checks it). Installers see their assignments. Empty: "Nothing yet. New work lands here."
- Trail: every action logs who did it — Recent Activity, job/client Activity, Company → Team activity.

### Internal — for the team (not for customers)
- **Code map** (under \`src/\`): crew \`app/(worker-portal)/w/[token]\`, \`app/api/worker/*\`, \`app/api/crew/*\`, \`lib/jobProgress.ts\`, \`lib/jobMedia.ts\`; jobs \`lib/jobFromProposal.ts\`; inventory \`actions/inventory.ts\`, \`lib/inventoryPolicy.ts\`; texting \`lib/sms/*\` (\`send.ts\` chokepoint, \`registration.ts\`), \`actions/sms.ts\`, \`actions/clientMessage.ts\`, \`app/api/twilio/sms\`; AI desk \`lib/aiDesk/*\` (\`calls.ts\`, \`liveCall.ts\`, \`minutes.ts\`; presets \`tradeCore.ts\` (TRADES, the light half the screen loads) + \`tradePacks/*\` (server) + \`tradePresets.ts\`; intake \`profile.ts\` key "intake" + \`intakeNotes.ts\`; financing answer \`profile.ts\` withFinancingAnswer), \`actions/aiDesk.ts\`, page \`app/dashboard/phone\` + \`components/v3/ai-desk/*\` (\`desk-workspace-header.tsx\` tabs, \`desk-steps.tsx\` checklist, \`desk-brief.tsx\`, \`desk-hours.tsx\`), copy \`settings-blueprint/settings-data.ts\` DESK_COPY; \`?pane=desk\` redirects in \`app/dashboard/settings/page.tsx\`; reserved hours \`lib/deskHours\` + \`actions/deskHours\` (SyncState \`deskHours:<org>\`; calendar kind "desk" in \`calendar-blueprint/calendar-behavior.ts\`), \`app/api/twilio/voice/*\`, \`app/api/desk/*\` (book, message); SmartBook \`lib/smartbook/*\` (\`engine.ts\` the conversation, \`store.ts\` SyncState \`smartbook:c|p|t|h:…\` + settings \`smartbook:settings:<org>\`, \`phone.ts\` the desk's SmartBook callers and what the desk's call to a lead learns from SmartBook, \`office.ts\` the screens' data), \`actions/smartBookOffice.ts\` + \`actions/smartBook.ts\` (public pages), \`components/v3/smartbook/*\`, pages \`app/(portal)/b/[token]\` and \`/b/r/[token]\` (the company's answer); the desk calling a lead \`lib/aiDesk/leadCalls.ts\` (SmartBook's call, the button, Call new leads; SyncState \`leadcall:<leadId>\`, \`app/api/twilio/voice/lead-call/*\`); Facebook auto-import \`lib/meta/autoImport.ts\` (switch \`autoCreate\`, SyncState \`meta:auto:<org>\`; the forms' consent boxes \`meta:boxes:<org>\`); repo \`voice/server.mjs\`, \`voice/call.mjs\`, \`voice/fly.toml\`; email \`lib/sdk/resend.ts\`, \`lib/email/orgSend.ts\`, \`lib/notify.ts\`; bell \`actions/notifications.ts\`; trail \`lib/activityLog.ts\`; handheld \`app/(mobile)/*\`. Docs: \`docs/sms.md\`, \`docs/ai-desk.md\`.
- **Cron:** \`/api/cron/sms-crew\` hourly :15 (held texts, crew lists, reminders, registration checks); \`/api/cron/smartbook\` every 2 minutes (SmartBook's due steps); \`/api/cron/meta-leads\` every 5 minutes (new Facebook leads where the switch is on, handed to SmartBook); \`/api/cron/desk-lead-calls\` every 5 minutes (the AI desk's Call new leads); \`/api/cron/stock-check\` 13:30 UTC.
- **Env names:** \`TWILIO_ACCOUNT_SID\`, \`TWILIO_AUTH_TOKEN\`, \`TWILIO_MESSAGING_SERVICE_SID\`, \`TWILIO_PHONE_NUMBER\`, \`TWILIO_APP_URL\`, \`TWILIO_VERIFY_SERVICE_SID\`, \`TWILIO_JOBFLEX_FROM\`, \`TOKEN_ENCRYPTION_KEY\`, \`VOICE_SERVER_URL\`, \`VOICE_SERVER_SECRET\`, \`VOICE_MODEL\`, \`OPENAI_API_KEY\`, \`RESEND_API_KEY\`, \`EMAIL_FROM\`, \`BLOB_READ_WRITE_TOKEN\`, \`CRON_SECRET\`.
- **Skipped texts:** \`SmsMessage.error\` = \`no-number\`, \`no-consent\`, \`not-configured\`, \`plan-ended\`, \`trial\`, \`cap-*\`. Customers can't see them; \`/admin/integrations/twilio\` lists the 12 latest platform-wide. 30034 = unregistered sender.
- **Admin-only fixes:** platform Twilio off → \`/admin/integrations/twilio\`; live desk off → both \`VOICE_SERVER_*\`; wrong voice webhook → \`/admin/health\` "Point it here"; an unassigned JobFlex line answers for the **oldest company** → "Assign" it; verification details → Twilio console.
- **Surprises (verify):** accountants are on the Office roster but office texts/emails go to OWNER/ADMIN/MANAGER only; new-lead texts go to the owner (and the assigned rep) only; sales/estimator bells are always empty; with platform Twilio off, the AI desk page shows env var names and texting a client says "Texting needs a Twilio number — set one up on the Phone page".`;

/** Troubleshooting & how JobFlex is built — errors, devices, data, the team's code map. */
const TROUBLESHOOTING = `## Troubleshooting & how JobFlex is built

### Errors a customer can hit anywhere

In production a server action's *thrown* error text is hidden; only *returned* errors show word for word, so one fault can look different per screen.

| Customer sees | Meaning and what to do |
|---|---|
| "JobFlex was updated while this page was open, so this screen is out of date. Reload the page and try again." | A new version went live mid-session. Smart Proposal and the video/blueprint estimators also show it for ANY hidden server error. Reload; if it returns at once, it's a bug. |
| "This page needs a refresh" | A deploy (or flaky network) left a phone screen missing a code file; the app first reloads once on its own. Tap Reload. |
| "Minified React error #441" or "An error occurred in the Server Components render. The specific message is omitted in production builds…" | An action failed, reason hidden (expired sign-in, deploy, dropped connection or server error). Refresh, sign in if asked, retry. If it repeats it's a bug: note time, page, button. |
| "This page hit an error." / "Something went wrong." | Page crashed. Try again / Reload; the "Reference …" code is the digest in our logs. |
| "Something went wrong. Check your connection and try again." | No answer from the server. Check the signal, retry. |
| "Too many <things>. Try again in <a minute / N minutes>." | A rate limit (below). Wait that long. |
| "Too many requests — try again later." | Public client pages (proposal accept/decline/PDF, reviews, change orders), per network. |
| "Too many attempts — try again in N minute(s)." | Sign-in brake: 8 tries per address per 15 min or 30 per network per minute — not a wrong password. |
| "Session expired — please sign in again" / "Your sign-in has run out. Refresh the page and sign in again — nothing was changed." | Sessions last 7 days; any log out or password reset signs out every device. Sign in again. |
| "Plan limit reached" / "No <thing> left" | Plan cap (/admin/plans). "See plans" → /dashboard/upgrade; monthly caps reset next cycle. |
| "Your free trial has ended. Add a card to keep working — everything you made is still here." | No-card trial over: read-only until a card is added (/dashboard/trial). |
| "…the free trial includes without a card. Add a card to unlock full limits — nothing is charged until the trial ends." | No-card trial caps: 3 roof measurements, 3 fence and 3 HVAC lookups, 10 AI runs; no texts, own numbers, EagleView or Manual J reports. |
| "This needs an active plan. Choose a plan on Subscription to turn it on." / "Your plan has ended, so <X> is closed. Choose a plan on Subscription to open it again." | Paid feature, no active plan. |
| "…is not configured" / "…isn't set up on this server" / "AI is not configured for this workspace." | A platform key is missing or rejected. Escalate. |
| "The AI service is busy. Try again in a moment." | OpenAI 429/5xx. Retry shortly. |

**Rate limits** (per company unless noted):
- Per hour: AI runs 60 (shared: Smart Proposal, roof, fence, HVAC), photo and receipt reads 60, HVAC site lookups 40, property lookups, roof scans and aerial roof estimates 30 each, video analyses 20, blueprint runs 12
- Per day: EagleView orders 5, new roof measurements 30, re-measures 5
- Per user: verification texts 5/h, support tickets 5 per 10 min. Sign-ups: 20/h per network and browser
- Email codes: valid 10 min, dead after 5 wrong tries, at least 30 s between sends

**Uploads:**
- Job photos/videos and homeowner-folder files: 100 MB each with private storage on; without it, photos 4 MB and no videos ("Pictures up to 4 MB for now — videos need JobFlex's file storage, which is being switched on."). Production's mode: verify.
- Worker-portal photos and receipts 4 MB; change-order photos 5 MB; review photos 4 MB; logo 15 MB (SVG 1 MB); walkthrough videos 5 min

### Phones, tablets, browsers

- **Layout:** at ≤768 px wide, /dashboard and most main pages switch live to the phone design; others stay desktop. Width decides, not device.
- **Install:** a web manifest allows "Add to Home Screen" (standalone). No service worker (no offline); no native app in the code.
- **Browsers:** no custom target, so Next.js 16 defaults: Chrome/Edge/Firefox 111+, Safari 16.4+. Dictation mic: Chrome, Edge, Safari (hidden in Firefox).
- **In-app browsers** (Instagram, Facebook/Messenger, LINE, TikTok) hide Google sign-in (Google refuses it there); email sign-up and "Open in browser" remain.
- **Google sign-in** started anywhere but www.jobflex.app can fail with "Sign-in didn't complete. Open www.jobflex.app and try again — starting from another address breaks the Google hand-off."
- **iPhone:** the video estimator extracts .MOV audio itself (Safari can't decode it) and in Low Power Mode pulls stills on the Analyze tap; failure reads "Couldn't pull any frames — … Tap Retry, or export the clip as MP4 (1080p) and add that." Photo pickers skip HEIC, so iPhones send JPEG.

### Data, privacy, security

- **Storage:** records in Postgres (Neon); files in Vercel Blob. Job photos/videos, receipts and homeowner-folder files: private store if configured (see Uploads), signed links valid 15 min. Proposal, review and change-order photos: public store (open to anyone with the URL).
- **Secrets:** passwords bcrypt-hashed; service tokens and payment keys AES-256-GCM.
- **Roles:** Owner/Admin/Manager — everything. Installer — jobs (read-only), calendar, messages. Sales — leads, clients, proposals, CRM, calendar, phone, messages. Estimator — proposals, estimators, projects, messages. Owner only: subscription, card, Stripe/Square.
- **JobFlex admins** see all accounts, subscriptions, member activity (incl. proposals) and tickets; there is no "sign in as customer".
- **Deleting:** Settings → Account → "Delete account" (badge "Testing") reads: "Removes you and any company you are the only member of. Immediate, no undo." Companies with other members keep their data. A 30-day company soft-delete exists in code; no page offers it.
- **Policies** (/privacy, /terms; Jobflex LLC, support@jobflex.app): privacy requests by email, subject "Privacy request" (Meta: "Meta data deletion"); charges are non-refundable except where the law requires it or JobFlex offers one in writing — refund requests go to the owner, never promised by support; cancel in Settings → Billing (separate from deleting).

### How support works

- **Filing:** a Help button on every signed-in app screen, all roles: one message (≤5,000 characters) plus a chip — Bug, Billing, Account, Question.
- **Confirmation:** "Ticket filed" with a 6-character reference (the ticket id's last 6 characters, uppercase), then "Our team has been alerted." or "The email alert did not go out. Quote this reference if you follow up."
- **One conversation per ticket:** our answers show in the ticket's chat at /dashboard/support and are emailed as "Re: <subject> [JobFlex <REF>]" to the filer (else owner, else billing email), with the last few messages and an "Open conversation" button. The customer replies in that chat (every role, own tickets only; the Help window's "Open the conversation" and the email's button both go there); replying to the email works too — the reply is added to the same conversation within a few minutes (attachments are not carried over; they stay in the email).
- **Stated response time:** "Typical reply within one business day".

### Internal — for the team (not for customers)

**Routes (src/app).**
- \`dashboard/\`: Blueprint pages and ResponsiveDashboardShell.
- \`(dashboard)/\`: older classic pages (support, hire…).
- \`(mobile)/mobile-*-v2\`: phone builds.
- \`(portal)\`: public token pages: /portal/q/[publicId] (proposal), /co, /review, /book, /home, /plan, /report, /request.
- \`(worker-portal)\` /w/[token]; also \`(admin)\`, \`(auth)\`, \`(marketing)\`, \`(influencer)\`.
- \`api/\`: webhooks/* (Stripe, Connect, Square, Stax, PayPal), twilio/*, desk/* (voice server), cron/*, public-quote/*, media/f (signed reads).
- \`middleware.ts\`: redirects, a cookie-only sign-in gate and role gates.

**Code.**
- Server actions: src/actions/*.ts (122), plus a few beside their pages.
- Guards: lib/orgContext (requireUser/Org/Manager/Owner, requirePlatformAdmin).
- lib/: estimate (Smart Proposal), roofRecon, fence, deck, hvac, plans, payments, sms, aiDesk, leadCenter, media (private files), sdk (vendor wrappers).

**Integrations → env names.**
- DB: POSTGRES_URL, POSTGRES_URL_NON_POOLING; the build swaps the SQLite schema for Postgres.
- Auth: NEXTAUTH_URL, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET.
- OpenAI: OPENAI_API_KEY, OPENAI_MODEL (unset/unentitled → gpt-4o); whisper-1 for walkthroughs; AI desk gpt-4o-mini-tts, gpt-4o-mini-transcribe, VOICE_MODEL (default gpt-realtime-mini).
- Stripe: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID, STRIPE_CONNECT_WEBHOOK_SECRET. Live-key writes need STRIPE_ALLOW_LIVE_WRITES=true.
- Twilio: the /admin/integrations/twilio settings, else TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER.
- Fly.io voice service: VOICE_SERVER_URL, VOICE_SERVER_SECRET.
- Email: RESEND_API_KEY, then SMTP_HOST/USER/PASSWORD, else nothing sent; SUPPORT_NOTIFY_EMAIL.
- Blob: BLOB_READ_WRITE_TOKEN (public), BLOB_PRIVATE_READ_WRITE_TOKEN (private).
- EagleView: EAGLEVIEW_CLIENT_ID/SECRET (EAGLEVIEW_API_BASE_URL unset → sandbox).
- Google Maps/Solar: GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY.
- SerpAPI: SERPAPI_API_KEY.
- PostHog: NEXT_PUBLIC_POSTHOG_KEY, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID.
- Also: REGRID_API_KEY, REPORTALL_CLIENT_KEY, COOLCALC_*, META_*, SQUARE_*, PAYPAL_*, TOKEN_ENCRYPTION_KEY, CRON_SECRET, ADMIN_USERNAME/PASSWORD.

**Errors & health.**
- \`logServerError\` logs "[server-error] <scope>" and sends PostHog \`server_error\` (scope, kind, code, where, organizationId, digest; never the message). instrumentation.ts \`onRequestError\` catches the rest.
- Browser crashes: \`$exception\` with the digest (not when analytics is opted out).
- /admin/health: DB probe, Stripe API/key mode/live-writes, PostHog, email, Twilio, Blob, 24 h Stripe webhooks + last failure, last reconcile, CRON_SECRET, AI desk.
- integrations-health emails admins daily while anything is down.

**Crons** (vercel.json, UTC; CRON_SECRET required in production):
- 10 min: support-ai (answers any new ticket the support AI missed); 15 min: lead-offers, signup-watch; 30 min: payments-reconcile; hourly: follow-ups, sms-crew, trials; 6 h: reconcile-stripe.
- Daily: square-refresh, integrations-health, daily-cleanup (rotates /w links idle for 6 months), purge-deleted-orgs, clear-commissions, process-approved-payouts, meta-ad-spend, stock-check, service-plans, payment-reminders, trial-winback, review-reminders, home-plans, lead-setup-reminders, traffic-digest.
- geocode-orgs: not scheduled.

**Admin pages for support.**
- /admin/users: accounts and plans; edit email/name, admin flag, delete, Stripe sync.
- /admin/support: all tickets, with email replies.
- /admin/trials: trials scored for tour-like use.
- /admin/subscribers: paying and Free companies (cancelled hidden).
- /admin/trial-requests: trial-extension asks, with what the trial was used for; Approve 7/14 days or Deny.
- /admin/cancellations: every cancellation with its reasons.
- Also /admin/traffic/signups, /admin/activity (member trails, proposals readable), /admin/plans, /admin/integrations.

**Where to look first**

| Symptom | Look at |
|---|---|
| Sign-in, lockout | lib/auth.ts, login-form.tsx, actions/signupOtp.ts; SyncState \`rl:login:email:<address>\` |
| "Session expired", role blocked | middleware.ts, lib/orgContext.ts (credentialVersion), lib/roleRoutes.ts |
| Stale text, #441 | lib/staleDeploy.ts, chunk-recovery-boundary.tsx, next.config.ts deploymentId (needs Vercel Skew Protection — verify) |
| "Too many …" | lib/rateLimit.ts (SyncState \`rl:<key>\` plus per-instance memory), lib/paidCaps.ts |
| Plan limit, trial lock | lib/limitsEngine.ts, lib/planLimits.ts, lib/trialLock.ts, lib/trialMeter.ts |
| Uploads | lib/jobMediaShared.ts, lib/media/*, lib/receiptImage.ts |
| "Not configured", AI | lib/sdk/*, lib/integrationsHealth.ts |
| No email/texts | lib/sdk/resend.ts, lib/notify.ts, lib/sdk/twilio.ts |
| Payment stuck | api/webhooks/*, lib/webhookEnvelope.ts, reconcile crons |
| Missing column after deploy | The build never migrates Neon; apply the schema by hand |
| Ticket limit shows generic text | submitSupportTicket throws it; production hides it |`;

export const SUPPORT_HANDBOOK = [ACCOUNTS, BILLING, ESTIMATORS, PROPOSALS, OPERATIONS, TROUBLESHOOTING].join("\n\n");
