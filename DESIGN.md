# JobFlex — current Blueprint design

This is the single design specification for JobFlex, for Codex, Claude,
Impeccable and agents with no conversation history. Updated September 23, 2026.
Use it for new work and restyling. Update this file when an owner-approved
design decision changes; do not maintain a second theme specification.

## Intent and hierarchy

JobFlex serves small US contracting businesses, at a desk, on a jobsite and
in front of clients. A surface should reveal its purpose, current state and
next action at a glance. Keep working data and actions visible. Use short,
specific copy; move secondary explanations into an accessible disclosure.

The current Blueprint is a crisp engineering sheet: drafting-paper background,
white surfaces, ink frames, strong uppercase headings and restrained blue
actions. Structure comes from alignment, spacing and continuous rules.
No soft SaaS cards, rounded pills, glass, gradients, blurred shadows, grain
over text, ornamental drawing numbers or decorative metrics.

## Authority and working examples

1. This specification defines the design intent.
2. [globals.css](src/app/globals.css) defines the shared token values.
3. These maintained components demonstrate the current treatment:
   - [Meta connection](src/components/v3/settings-blueprint/meta-connection.tsx)
     and its [styles](src/components/v3/settings-blueprint/meta-connection.module.css):
     framed card, status stamp, annotation labels, section rules and action row.
   - [Roofing inventory desktop](src/components/v3/roofing-inventory/roofing-inventory-desktop.tsx)
     and [styles](src/components/v3/roofing-inventory/roofing-inventory-desktop.module.css):
     dense working tables, filters, clear item hierarchy and management actions.
   - [Roofing inventory mobile](src/components/v3/roofing-inventory/roofing-inventory-mobile.tsx)
     and [styles](src/components/v3/roofing-inventory/roofing-inventory-mobile.module.css):
     a dedicated handheld composition of the same functionality.

Examples show patterns, not a template to copy into every page. A quiet table
label or text action need not become a stamp. Match each element's role.
Existing components outside this list are implementation context, not automatic
approval of every visual choice. Prior prototypes and historical notes do not
override this specification. If code and this document conflict, flag the
specific discrepancy rather than silently selecting another theme.

## Tokens and surfaces

Use CSS custom properties; do not paste a palette into new components.

| Purpose | Existing token |
| --- | --- |
| Drafting-paper background | `--paper` |
| White surface | `--paper-deep`; `--sheet` in mobile scopes that define it |
| Main text and frames | `--ink` |
| Body / secondary text | `--ink-soft` / `--ink-muted` |
| Quiet repeated row separators | `--ink-line` |
| Primary blue / hover / soft fill | `--accent` / `--accent-ink` / `--accent-soft` |
| Success / warning / error | `--emerald` / `--amber` / `--rose` |
| Sans / annotation type | `--font-sans` / `--font-mono` |
| Near-square corners | `--r-sm` (2px) |
| Motion | `--ease-out`, `--ease-soft`, `--ease-draw` |

Some existing mobile scopes give `--paper-deep` a recessed-paper meaning.
Inspect the consuming scope; use `var(--sheet, var(--paper-deep))` for a shared
white card where appropriate. Do not globally repurpose a token to fix one card.
Use existing semantic status tones where available; otherwise derive a soft
fill from the status token. Status color conveys state, not decoration.
One owner-approved exception (September 26, 2026): where the estimators sit
side by side as choices (the lead page's Estimate this job), each wears one
identity hue on its card edge and icon plate — Smart Proposal `--blueprint`,
roof `--danger`, fence `--success`, HVAC `--sky`, manual proposal `--ink`.
Amber stays reserved there for what an estimator still needs.
A second (owner, 2026-10-17, overriding the 2026-10-16 entry that made them
ordinary rows): the sidebar's Estimating tools, desk and drawer, give each
tool one colour from `--tool-smart`, `--tool-plan`, `--tool-roof`,
`--tool-fence`, `--tool-video`, `--tool-hvac`, `--tool-deck` (globals.css).
A tool row is one line: a white icon square in an ink frame on a hard offset
shadow in the tool's colour, the square filled with that colour while the
tool is open; then the name (no caption under it), "Soon" beside it when it
is coming. The tools sit in one bay with no frame and no grid. A subpage
toggle is a small white square in a 1.5px ink frame with a down arrow (up
when open); a subpage row (an inventory) has the same ink, size and weight
as the rows above it, indented on a guide line. The one other reader of
`--tool-*` (owner, 2026-10-18) is the cancel window "Before you go"
([FreeSwitch](src/components/billing/FreeSwitch.tsx)): a band of hard-edged
tool-colour segments across the top of the box; the company's own numbers
(proposals sent, what they quoted, clients — a zero is left out, none at all
hides the row) as white tiles in an ink frame topped and numbered in a tool
colour, one row on a desk, the amount across over the two counts on a phone;
each "what the plan gives" line on a flat square filled with its own tool
colour and a white icon; the keep date in bold; "Keep <plan>"
one full-width blue button with a resting 3px ink offset; "Continue to
cancel" a 14px bold ink link under it, never small or grey. On a trial (or
up to 14 days after it) a framed white "Request a trial extension" sits
between them and opens a small form in the same box: two square radios
(7 / 14 days), an optional text box, "Send request" in the big button's
place, "Back" as the link (owner, 2026-10-20). The confirmation "Cancel
<plan>?" asks "Why are you cancelling?" — square checkboxes in one
hairline-framed list, 44px rows, the picked row on `--accent-soft`, the
confirm button off with a one-line hint until a reason is ticked. Owner rule
(2026-10-18): no shadow or offset behind a coloured square or dot, and none
on number tiles — flat colour only.
The handheld drawer folds each estimator's inventory the same way (2026-10-17).
Owner refinement (2026-10-18): Automation precedes Money. Estimator links use
32px icon squares and 13px names, shifted slightly left; section labels retain
their existing position and size. Drawer targets remain at least 44px.
The AI desk (owner, 2026-10-16): its two tabs, Calls | AI desk setup, are one
framed switch, the open tab filled with ink. The setup is a checklist card —
a full-width row per step (numbered square, name, status stamp, an
"Open"/"Close" control with a chevron), the open step's part unfolding under
its own row. Every step starts closed unless a link names one (2026-10-17).
Texting (owner, 2026-10-17) uses the same checklist on the desk and the phone:
one status line in its tone, then "Set up texting" with Number, Team, Clients
and Your own texts as rows; the extras stay as two cards at the foot. The
estimators' working cards (Blueprint, Roof) mark their steps with the Smart
estimator's squares (estimators-blueprint/work-square).
The Blueprint estimator's result (owner, 2026-10-17): the estimate is the
wide main column with a subtotal on every trade group; "Found on your plans"
stands beside it and stays in view; the total and Create proposal sit at the
top; the run's timing lives under "Notes and checks".

Light mode only. Keep the existing drafting grid behind content, never over
type. Resting cards have no shadow (`--shadow-sm` and `--shadow-md` are `none`).
An existing hard ink hover treatment may be retained on interactive controls;
do not give static cards decorative elevation. One owner-approved exception
(2026-09-26): the subscription plan cards on the landing pricing section and
on signup step 3 are white with a hard offset shadow, no blur: ink on every
plan, blueprint blue on the "Most picked" one. The offset is 3px, 4px under
a pointer (owner, 2026-10-12), on every one of those cards.
Subscription overview exception (owner, 2026-10-16; reworked 2026-10-17):
plan cards show their first four features, the rest behind one toggle that
opens every card of the row at once, sliding open (grid rows 0fr → 1fr).
Usage lists only what the plan caps — the first three rows in view, the rest
behind the same kind of fold; a resource with no cap is not listed. Other plan
surfaces keep their lists open.

Plan cards, everywhere a customer sees them (owner, 2026-10-12): one
Monthly | Annual switch over the row ([PlanTermSwitch](src/components/billing/PlanTermSwitch.tsx)),
never per-card term buttons; its Annual half always wears a sticker on its
bottom-right corner — filled `--emerald`, the "Most picked" type, a 2px hard
offset, 9px past the switch's edge — "2–3 months free" (the range of whole
free months), or "Save up to $N" when none is whole. On Annual a card's head
carries a filled `--emerald` "3 MONTHS FREE" stamp (the "Most picked" size,
whole months only) at its right edge, on the plan name's line; the price
stands alone, and under it one line "You save $135 a year", `--emerald`,
bold, 15px; "Billed yearly" when the year saves nothing. On Monthly a quiet
"Billed monthly" and nothing about the year, the stamp's place kept so no
card moves on the switch. Never a percentage or a struck price. Lists are always open (no "Show all"),
the cards of a row are one subgrid so prices and first rows align, and the
row has as many columns as cards, each capped, centred. On a desk the signup
plan step fits the window from 800px tall without a scroll, and the sheet is
the row's width: logo, steps, head, cards and terms share one left and one
right edge.
The sign-in pages (register, login, forgot, reset, invite, worker invite,
phone login) carry the real product mark ([ProductMark](src/components/brand/ProductMark.tsx),
the sidebar's and the landing's `/jobflex-mark.png`), not a drawn "J" square:
24px of ink beside a 20px "JobFlex" (22px on a phone), 8px apart, centred on
the letters. The custom plan is a card in the row on the plan step and the
upgrade page; on the landing and /pricing it stays the wide "Build your plan"
plate under the row.
The signup plan step on a phone (≤768px, owner 2026-10-14; it replaced the
two-to-a-row grid of 2026-10-12) is one swiped row of full cards with scroll
snap: one card in the middle (81–84% of a 360–430px screen, capped at 420px
on a tablet), its neighbours showing 24px at either edge, square dots under
the row (one per card, the middle one filled, 44px targets). It opens on the
most-picked plan, or on the plan the link or the tab names (a cancelled
Checkout), centred before the first paint. The card in the middle is the
choice (the blue frame); a tap on a card chooses it and brings it to the
middle. The cards stay one subgrid in columns, so every card is the row's
height and neither the switch nor a swipe moves anything; the page scrolls
down, nothing scrolls inside a card. Every card keeps its own whole list and
its own start button at its foot. There the year's stamp is the "Most
picked" plate's size at the name's right edge, and the saving or "Billed
monthly" is one 12px line (weight 600) under the price.

## Typography

- Keep Inter through `--font-sans`; do not choose a new font per page.
- Page and card headings: weight 800–900, uppercase, compact line height.
  Large headings use tight tracking; small section titles can use slight
  positive tracking. Typical working sizes: page 28–32px, card 16–20px,
  key entity 22–24px, section 12–14px. Fit the page's existing hierarchy.
- Body and user data stay readable, typically 13–16px, with normal casing.
  Do not uppercase paragraphs, editable input values or whole tables.
- Use JetBrains Mono only for short annotations, units and technical labels,
  usually 10–12px with measured tracking. Do not make navigation, paragraphs
  or large amounts monospace.
- Amounts use Inter with tabular numerals; important totals use weight 800–900.
- Status stamps: near-square frame, 10–11px, weight 800, uppercase, tracking
  about .1em, a semantic border and soft fill. Always include readable text.
- Keep the global font-rendering settings; no page-specific smoothing reset.
- Owner-approved (2026-10-10), the passwordless sign-up and the sign-in code
  form: field labels 12px JetBrains Mono caps, about .05em tracking, ink;
  notes under fields 12.5px Inter in `--ink-soft`; inputs white. The older
  9.5–10.5px mono labels read badly on a phone; new auth forms use this.
  An emailed code (owner, 2026-10-12) is always six white upright boxes, one
  per digit — 44×58, 6px apart, a 2px ink frame and no shadow, the next box
  framed blue with a caret, all six red on an error — drawn over ONE real field
  ([OtpCodeField](src/components/auth/otp-code-field.tsx)); no copy of it.

## Layout, frames and controls

- Main card frames: 1.5–2px ink. Major internal boundaries: 1px ink,
  edge-to-edge within the frame. Use quieter separators for repeated rows.
  Adjacent borders must not double in thickness or cross labels or links.
- Use a 4px spacing scale. Start with 24px desktop card padding and 20px
  mobile padding; 8px within a label/value group, 16–24px between groups.
  Adapt density to the task rather than filling unused space with copy.
- Keep one clear primary action per task group: blue surface, white text,
  visible ink border, near-square corners and a concise verb label.
  The Meta card's primary actions use bold uppercase text; quieter secondary
  actions may use normal casing as in the inventory reference.
- Controls must have visible focus, hover, disabled and busy states. Disabled
  styling must not be mistaken for an available action. Minimum mobile hit
  area is 44×44px; labelled full-width actions are useful on narrow cards.
- Фильтры, метки, бейджи — без теней и offset-сдвигов за цветными
  квадратами/точками; без моно-капса в чипах (owner, 2026-10-18).
  Filters, tags and badges: no shadow or offset behind a coloured square or
  dot, and no monospace caps in chips.
- Filter bar (owner, 2026-10-18 — the segmented control was chosen over
  underlined tabs): Leads (All / From JobFlex / Your own leads + Source) and
  Proposals (status + Type) filter with one white plate, square corners, a
  1.5px `--hair` frame, segments split by 1px `--hair` rules, 36px tall on a
  desk (44px on a phone). The picked segment has a light blueprint fill
  (`--accent-soft`), blueprint text and a 2px blueprint bar along its foot;
  the others are ink with the count a grey number. Inter 13.5–14px, 500–600,
  never caps. Type / Source is a separate button with the same frame and
  height — "Type:" grey, the value ink, a ▾ — opening a white, square menu
  framed in 1.5px ink, each colour a flat 8px dot. No shadow or offset on the
  plate, the segments or the dots. On a phone the segments slide sideways
  with a fade on the side that holds more. Row tags keep the same language:
  a flat dot and plain text (● JobFlex, ● Facebook, ● HVAC · HVAC estimator).
  Desk: [filter-bar.css](src/components/v3/blueprint-shell/filter-bar.css);
  phone: the `.fbar` rules in the mobile Leads and Proposals modules.
- Proposals, owner pass 2026-10-20 (supersedes the bar above for Proposals
  only; Leads unchanged). Filters are the Blueprint plate (`flt-bar--bp` /
  `flt-drop--bp`): 2px ink frame, white, 11.5–12px Inter 800 caps, 1.5px ink
  rules between segments, the picked one a solid blueprint fill with white
  type. Desk: Type sits on the All / Accepted / Completed row at its right
  edge on every tab; Status shows on All only. Phone: two dropdowns side by
  side — Status (All tab only) and Type — each opening across the row. The
  kind tag is a flat 8px SQUARE and one word ("Roof"); "General" (no trade
  read) prints the tool instead ("Manual"). No Smart Proposal button on the
  list — Manual proposal only, white. Contract cards: titles wrap; a payment
  stage is label, then amount with its share, beside small tinted actions —
  Mark paid green, Send invoice blue, Remind amber (soft fill + coloured
  1.5px frame); the desk action bar is one row of cells split by rules, the
  primary a full-height blue cell. Phone cards and strips are white on the
  cream page; views read "3 views" with when under it; status plates sit on
  the foot's bottom edge; accepted/declined gets its own line; no "1mo ago"
  above the title and no "Completed" stamp on Done cards.
- Proposals rows, owner pass 2026-10-23 ("Send proposal or it's been sent",
  "payment options visible at the main proposal row"). Every row carries Send
  (a solid green plate on a draft) or "✓ Sent 3d ago" (soft green, a button
  that sends again while the client has not signed; a plain stamp once signed
  or declined). Under the row, across the table with no rule between them, a
  white payment line: each stage a flat tag — paid green, the next one framed
  in ink with its facts (due / overdue in red / invoice sent / reminded),
  dashed before signing with "Billed after Jane accepts" — and for the next
  stage Mark paid green, Send invoice blue, Remind amber. Sales reps and
  estimators see the stages and what is left, never the billing buttons.
  Phone: the same pieces inside the card, every action 44px.
- The first-estimate tour (owner's brief, 2026-10-26;
  [onboarding-tour](src/components/v3/onboarding-tour/onboarding-tour.tsx)):
  the lit element gets a 2px ink frame with a white hairline outside it and
  a small ink tag "2/6" on its top-left corner; the rest of the page takes
  the sheets' scrim (`--msheet-scrim`), lifted while a field inside the frame
  is being typed in. The dim never takes a click. The card is white in a 2px
  ink frame: a blue 11px caps kicker ("First estimate · step 2 of 6"), a 17px
  900 caps title, 14px body, one blue Next (only on steps with nothing to
  do) and "Skip tour" as an underlined ink link. Desk: beside the element;
  phone: a bottom sheet on the `--msheet-*` geometry, hung from the top when
  the element is a bar on the screen's foot. Numbered squares are flat. The
  sidebar chip is one 44px row: an ink-framed count square, "First estimate"
  and a blue sub-line.
- SmartHelp (owner, 2026-10-29: look "a" of three mockups;
  [smarthelp](src/components/v3/smarthelp/smarthelp.tsx)). The one filled row
  in the sidebar, first in every nav (desk, blueprint, both drawers, More): a
  44px `--ink` block, a white square holding Lucide Sparkles in ink, white
  800 "SmartHelp", a square "ASK" tag in a 1.5px white frame, on a hard
  `3px 3px 0 var(--accent)` shadow; the folded rail shows the square alone.
  No amber, gradient or pill. The panel's header repeats the block. The panel
  is white with a 2px ink edge: 380px beside the page at ≥1024 (the page moves
  over, nothing is covered), over the page at 769–1023, a bottom sheet of
  85dvh on the sheets' scrim at ≤768. Guides are 44px cards in a 1.5px ink
  frame with an ink-framed icon square — a to-do one has a small accent
  square, a done one a ✓. Steps are flat ink-framed number squares; Open is
  white in an ink frame, Show me white in an accent frame, Ask a person the
  one blue button. Show me's light is a 2px accent frame on a hard 4px ink
  shadow, nothing dimmed. Folded (Show me below the desk, Open on a phone) it
  is a 44px ink "Back to SmartHelp" bar at the top middle of the screen — the
  corners are the menu and Help, the foot is the tab bar and create button.
- The AI Operator — called the Assistant until the owner renamed it on 2026-11-05 (2026-11-04, shown to the owner for approval;
  [assistant](src/components/v3/assistant/assistant.module.css)). Its row sits
  right under SmartHelp in every nav, and SmartHelp stays the one filled row:
  white in a 1.5px ink frame, a blue square holding Lucide AudioLines in white,
  ink 800 "AI Operator", a square "NEW" tag framed in blue; no shadow, the hover a
  light blueprint fill; the folded rail shows the square alone; hidden for the
  field crew. The desk panel is SmartHelp's geometry (380px beside the page at
  ≥1024, over it at 769–1023, the two never open together) with a `--paper`
  head ruled in 2px ink. A phone has no sheet: the rows go to the page
  `/mobile-assistant-v1` — the handheld chrome, a `--paper` head (36px blue
  square, 22px 900 caps "AI Operator"), the conversation filling the screen and
  the box on its foot above the home indicator. The conversation is
  SmartBook's square bubbles (the person's white in ink, the Assistant's
  `--accent-soft` in accent). A proposed change is a card in a 2px ink frame:
  a 12px caps label ("Send a proposal", "Schedule"), a square stamp — Needs you
  amber, Done emerald, Didn't go rose, Cancelled / Expired muted — the
  read-back in 15px, and while it waits "Do it" (the one blue button, caps) beside a
  white "Cancel", both 44px. Nothing said yet: a 17px 900 caps line and
  ink-framed 44px example rows. The box is white in 1.5px ink (16px text on a
  phone), a white 44px Talk square (the microphone) and a blue 44px send
  square; this cycle's use under it in 11px mono. Talk is a spoken
  conversation: the square turns rose while it listens and blue while it
  speaks, and a live line sits over the box — what is being heard, "Listening
  — just talk.", "Working on it…", "Speaking…" (rose-tinted, blueprint-tinted
  while speaking). A build (2026-11-05: "build a 12 by 12 deck with a roof for
  Sarah") answers "On it…" in a plain bubble, a "Pricing it…" working line holds
  the place while it prices, and the result is the send card: the price, what
  is in it, "Open it: the proposal" (an 600 underlined link in the card's own
  ink, opened beside the panel), then the send read-back with Do it / Cancel.
  The empty state's first example row after "What's on tomorrow?" is "Build a
  12 × 12 deck with a roof for …". Settings → AI Operator
  ([assistant-settings](src/components/v3/assistant/assistant-settings.module.css))
  is one card in SmartBook's treatment — stamp Linked emerald, Paused amber,
  Not linked / Texting soon muted — with ruled sections In the app, From your
  phone (the linked phone as a 52px ink-framed row; Save to my contacts the
  blue button, Pause texts white, Unlink an underlined text button), Things to
  say. The link code is SmartBook's copy box: 30px 900 tabular digits beside a
  caps Copy cell; on a phone "Text the code from this phone" is a full-width
  blue button that opens Messages with the code typed; the consent words sit
  under it in 12.5px with Terms, Privacy and How it works (/assistant). Batches 1–2 (2026-11-05): a money card (an
  invoice, a financing link) carries a PIN box beside Do it — 96px wide in the
  card's 1.5px ink frame, 18px 800 tabular digits masked, the "PIN" placeholder
  in faint ink — and Do it stays disabled until four digits are typed; the card
  labels are "Add a client", "Update a client", "Add a lead", "Book a visit",
  "Move a visit", "Cancel a visit", "Reminder", "Invoice", "Financing link", and
  a reminder's queued stamp reads "Set" (blueprint) until it lands as Done.
  Settings → AI Operator gains a "PIN for money" section: a 120px white field of
  four masked 20px 900 digits, Save PIN as the one blue button, "Change PIN" /
  "Remove PIN" once set; 1234-style runs and one digit four times are refused. Batch 3: a "Morning briefing and alerts" section of
  ruled rows — the words left, the time select (44px, 1.5px ink) and the one
  button right; "Turn on" is the blue button, "Turn off" the white one.
- The AI Operator on a phone, Rev 2 (owner, 2026-11-05 — THE ONE WRITTEN
  EXCEPTION to the handheld's light paper;
  [operator.css](src/components/v3/assistant/operator.css)). While the Operator
  has the sheet — the page `/mobile-assistant-v1`, or the overlay the dial button
  opens on any phone page — it is a blueprint: white lines on blueprint blue
  (#0b2b5c, the head and foot #071c40), the drafting grid in faint white at 24px,
  Inter and JetBrains Mono as everywhere. The paper comes back when it closes.
  Red is the person (the REC stamp, the rule beside their words as they speak,
  the dial while it listens); white is the Operator's work; yellow is "needs
  you"; green is done. The dial is the one round thing: a canvas ring of 56 bars
  around a 64px button — lively red while it listens, a white sweep while it
  works, a yellow pulse while it waits, green when a build lands, a faint breath
  at rest — with 44px square hints either side (Type / Hands-free; Cancel / Send
  while it listens; Change / Send while it waits). A card: a 10.5px caps label,
  the square stamp, the facts as a ruled two-column sheet (58px mono keys), the
  build's trace as four mono steps with a 3px top rule (green done, white now),
  the deck's own plan drawn on in the Deck Studio's build order (0.6px white
  lines, a 7% white fill), the price in 30px 900, Do it (white, blueprint type)
  / Cancel / the PIN box. The dial button on every phone page is the paper's own
  54px blue square with a 4px ink shadow at 16px from the right, 84px up (clear
  of a tab bar); held, it turns rose and sinks 2px. Nothing else on the phone is
  dark. A fence built from an address (2026-11-05) draws its lot on the card
  the same way: the lot lines dashed in muted white, the house a 12% white
  block, the fence the 2px white line, each gate a 4px yellow dash, north up.
  A roof built from an address (2026-11-05) shows the aerial photo instead —
  the satellite centred on the measurement's pin, saturation eased to 85% on the
  blueprint, the pin a 12px red dot ringed in white — never a drawn outline (the
  owner's rule); HVAC and lawn cards carry their facts and the words only.
- SmartBook (owner, 2026-10-31;
  [smartbook](src/components/v3/smartbook/smartbook.module.css)). One framed
  card treatment for Settings → SmartBook and the calendar's "SmartBook
  requests": a white sheet (`--sheet` where a mobile scope defines it, never
  the recessed `--paper-deep`) in a 2px ink frame, a `--paper` head with a
  blue Lucide icon, an 18px 900 caps title (16px on a phone) and a square
  status stamp — On emerald, Off muted, "N waiting" amber, "All answered"
  emerald. Sections are 1px ink rules with 14px 850 caps headings. Choices are
  ink-framed rows of 52px with a square ink checkbox; the picked row takes
  `--accent-soft` (a picked radio also an accent frame). The on switch is a
  square red/green toggle on a 44px row. The first text's preview is
  a flat `--paper` bubble in a 1.5px ink frame; text to copy sits in a 2px ink
  box with a caps Copy cell on its right (under it on a phone). Warnings are
  amber with a 4px left bar. A request shows the customer's name in 16px 850,
  their own words in italics behind a 3px rule, a square emerald (free) or
  amber (busy) mark before what the calendar holds then, "Yes — book it" in
  blue, "No — offer other times" and "Suggest another time" in white; the
  answer is an emerald line. On the lead page the
  card is the page's own frame: a 12px caps "SmartBook" label, the status
  stamp, the numbered times, and the conversation as square bubbles — theirs
  white in ink, SmartBook's `--accent-soft` in accent, notes centred and
  muted. The leads list's "SmartBook · Needs you" line copies the source line
  under it. Phone: one column, every button full width and 44px, the request
  form stacked, nothing wider than the screen. The customer's own page
  (`/b/<token>`) is the online booking page's sheet (`book-public.css`).
- Roof estimator buildings (owner, 2026-10-26, ticket 8KETUL). Before the
  order the intake map's pin can be dragged (or the map tapped) onto the
  building to measure, with "Measure the building under the pin" in 15px 800
  ink under the map; an address typed without picking a suggestion gets its
  pin from the geocoder and the line "Pick the address from the list so we
  measure the right building." In the report only the buildings in the
  estimate carry a number: the main one is always "Main · Building 1 of N",
  the ticked ones stand under it in turn ("In the
  estimate"), the unticked rows follow with no number. Every other row has a quiet "Make main" button (white, 1.5px ink
  frame, 13px 700, 44px on a phone). The report map outlines every building —
  the main one in blueprint, a ticked one in its colour with its number on a
  flat disc, the rest a thin white line — and a click on an outline selects
  its row. This replaces the 2026-10-10 "pins, no outlines" rule for the
  report map only; the client's picture keeps one pin and no outline.
- Use existing Lucide icons at consistent sizes; decorative icons are hidden
  from assistive technology, icon-only controls have accessible names.
- Preserve all existing actions, validation, units, permissions and data
  states during a redesign. Do not fabricate metrics, statuses or success.
- Reuse the live shared sidebar, navigation map and responsive shell.
  Sidebar subpage toggles are separate buttons with hover and expanded state;
  nested links retain consistent type and a clear indentation guide.

## Mobile and motion

Use the existing viewport switch at **≤768px** and its dynamically imported
mobile component. Exactly one layout tree mounts. Reuse shared logic and data;
compose the mobile surface for handheld use. No UA detection, new zoom system,
copied standalone HTML shell or alternate mobile palette.

Keep lists visible while filtering, selecting and editing. No opacity-zero
entrance dependency or MutationObserver that replays the whole list. Use
short state transitions: about 120–180ms for hover and 200–350ms for a panel.
Support `prefers-reduced-motion`. Loading feedback follows actual work and
keeps the layout stable. Never delay usable content for an animation.

Handheld frames and sheets have one geometry (2026-10-04): a fixed frame is
pinned by its edges and sized 100%, never in `vh`/`dvh`; a bottom sheet hangs
from a box that states its size and reads every number — ceiling, grab, head
and foot padding, scrim, safe area — from the `--msheet-*` table in
`globals.css`. Its body scrolls; its foot stays on screen above the home
indicator. Page-root resets step around nested components (`data-mnav`,
`data-nest`). Details and the guard check: [mobile notes](docs/design/mobile.md).

Long names must wrap or have an accessible way to view the full value. Use
`min-width: 0` on flex/grid children and `overflow-wrap: anywhere` where needed.
Keep key mobile data available; do not hide functionality to make a layout fit.

Public SEO pages (owner, 2026-10-26) — the cost guides `/cost`,
`/cost/<work>` and `/cost/<work>/<city>`
([cost.module.css](src/components/seo-cost/cost.module.css)) — are the one
approved exception to the viewport switch. They render on the server as one
layout tree that a search engine reads whole, so the phone layout is the
default CSS and a single `@media (min-width: 769px)` query widens it for the
desk; no dynamically imported mobile component, no `md:`/`lg:` variants, no
UA detection. The Blueprint holds: drafting-paper page, white cards in ink
frames, uppercase headings, the answer card first, one blue primary action
per block, 44px touch targets, and no framer-motion — the only client code
is the small calculator and the page-view event. The exception covers
content-only public pages with no app state; anything with a signed-in
shell keeps the switch. The same exception covers the homeowner portal `/home/*`
(owner, 2026-10-31).

## Implementation and review

Deck estimator (owner refinements, 2026-10-18): use one continuous scrolling
form in the left column, with all sections available together. No clickable
step strip, Back/Next wizard, or returning-user summary screen. Give each
section its own numbered white card. First choose the structure; second set
its size and house placement, with House & ground inside that same card.
Retain disclosures for optional detail. The compact form
scale lives under `.jf-deck-v1 .v1-q` in `globals.css`: 20px questions, 16px
section headings, 14px working text, 12px annotations, 36px desktop controls,
and 40px dimension steppers. On handheld, preserve 44px targets and 16px input
text. The page title remains 36px (30px handheld).
The form column is 500px on a wide desktop, 440px at middle widths. Use a
12px column gap and 4px above the price footer. Numbered cards and footer
share their outer edges; keep the form scrollbar in the column gap.

Use one Job address field, with its label above and a 520px maximum width.
Keep the compact icon-and-label Drafts menu beside
the title; omit idle save-status text. Remove the region/frost/snow/lumber shorthand
from the header; retain editable footing and code assumptions under House &
ground. Keep price provenance with the estimate. The working estimator has no
Coming soon or admin-preview marketing copy.

Both desktop frames fit the available dashboard viewport, measured through
the existing shell zoom. Keep only the deck price beside Package & price at
the left foot; do not add a summary card above the numbered sections. Detailed
pricing and price sources remain in the package section.
Align the draft name and finish actions with the package content, without a
nested card. Save draft and Send to client share an equal-width row; the primary
proposal action spans the full width below them, including on handheld.
On desktop, ordinary wheel scrolling anywhere in the main workspace, including
over the scene, first scrolls search, title and address away while expanding
both workspaces. Only then do the left cards scroll. Upward scrolling reverses
that order. Dragging still orbits the scene; modified wheel/pinch stays available
for zoom. Escape returns to the top. AI desk, Texting and the estimator use
gentler wheel movement with brief easing; touch and keyboard stay native,
and reduced-motion preferences disable the easing.
The landing and public marketing pages use the same gentle desktop wheel
movement. Handheld website scrolling stays native, as do editable fields,
nested demonstrations and modal scroll locks.
Give the space freed by the step strip to the scene. Title the preview "The deck" (or the selected structure), with
dimensions above compact 3D / Framing plan / House & deck controls. Keep editing
and adding stairs prominent and playback distinct; the view controls (X-ray,
Connections, Night, Reset view) are always shown on their own line under the
playback, two by two where the bar is narrow — no View options fold (owner,
2026-10-21). Handheld keeps normal page scrolling, a 360px preview, and
44px view controls. Retain the Blueprint palette and ink frames. Use cached
still images for structure thumbnails in this estimator and defer starting
layouts until opened. Keep the main 3D scene interactive, rendering on demand
and pausing when offscreen or the browser document is hidden.
During header scrolling, cache layout measurements and keep the 3D surface at
its fully expanded height, anchored to the bottom of the preview. The growing
panel reveals more of that stationary scene; scrolling must not resize the
canvas, change its camera projection, or trigger a WebGL redraw. Real viewport
resizes update the camera and drawing buffer together before rendering.

Projects hub, stages (2026-11-05): the Stages card leads the project page on
desk and handheld, above the proposals — a remodel is read by where it stands.
One row per stage: a 24px round mark (empty · ▶ in progress on ink · ✓ done on
emerald), the name as the fold button, a mono meta line (days, tasks, "3 days
late" in rose), the actions right. Only the stage the project is on opens its
tasks; the rest fold. Tasks are 32px lines (44px handheld) with an ink
check; "photo" is a small amber mono tag, never a camera icon. The % done bar
is the budget card's 10px bar. Templates and the AI draft are small outline
buttons in the empty state, not a wizard; an AI draft shows an emerald note
with Keep. The project's number ("#1042") sits in the kicker after
"Projects" on desk and leads the handheld dateline; the list prints "65% ·
Framing" where it printed the jobs closed, only once the project has stages.

Projects hub, buying (2026-11-05): the Buying card sits under the proposals,
the Deliveries card right after it. The to-buy list is grouped by stage under
a mono caps rule that carries the stage's order-by day; each line is a tick
box (only while something is left to buy), the name, a mono quantity and a
small mono tag — To buy in accent, Ordered in amber, In in emerald, late in
rose. Picked lines raise a sticky bar at the card's foot (ink frame, paper,
the one primary button "Order these"). An order is one ink-framed block that
folds: its head names the order, who it is from and its state tag; open, it
shows the dates in mono, the lines, the tracking field and the actions as
small outline buttons, "Delivered" the one primary. The buyer's page
(/buy/<token>) is the review page's sibling: one 2px ink frame on graph
paper, 52px tick rows, the ink Save button with the accent shadow.

The crew in the field (2026-11-05): the On site block sits on the job page
right under the crew's day buttons, in the crew board's own language — a
white 2px-ink card, mono caps label, uppercase heavy title, 44px rows. A
problem is an amber-framed row with the warning glyph; one that stopped the
work is rose. Tasks are 22px ink checks on dashed rows; a ticked one strikes
through. Deliveries are a row with the one primary "Delivered". Hours are a
120px field with a small outline Save and a mono "32 h this week". "Flag a
problem" is a full-width outline button, never red — the office's stamp is
the red thing. On the project page the On site card uses the hub's row
vocabulary: a problem row's round mark is a rose "!", the open ones lead;
hours and the subs' bills are mono-quantity lines, "owed" in rose, "paid" in
emerald. The crew's home prints "My tasks today" as paper cards with empty
ink squares (no live ticking there — the job page ticks) and "My week" as
three display figures.

Projects hub, the timeline and the finish line (2026-11-06): the Timeline
card sits under Stages and is a chart in the hub's voice, not a Gantt
widget — a 1.5px ink frame, week columns on a paper header strip in mono
caps, one 36px row per stage with the name in a 150px ink-ruled column and
the bar on the track: planned is white with an ink line, in progress is
solid ink, done is emerald, late keeps its fill and takes a rose rule. The
marks ride the bar's edges — ▼ a delivery on the top edge, ◆ an inspection
on the bottom — in the buying card's amber / emerald / rose, with a white
halo so they read on ink. The crew's days are a paper strip of translucent
accent ticks; today is a 2px rose rule with "TODAY" in 9px mono. The chart
scrolls sideways on a phone rather than squeezing (min 520px). "shift" is a
mono-caps text button under the stage's name, red-worded with how late it
is; the sheet reads the plan back as a plain list before the one primary
button. The Finish line card is the stages card's row grammar turned into
seven steps: the round mark (emerald ✓ done, ink ▶ next, empty to do), the
label, a mono detail line, and ONE button on the right — the next step's is
an outline button, a done step's undo is a text link. Punch items fold under
the first step as checkbox lines with a 40px ink-framed thumbnail once the
after photo is in; the "Done + photo" button carries a 14px camera glyph.
Nothing on either card is red except lateness, a failed inspection and
money still owed.

Read [implementation notes](docs/design/implementation.md) when editing an
existing interactive surface, and [mobile notes](docs/design/mobile.md) for
handheld work. These describe code hazards, not alternative visual themes.

Before delivery, verify the changed surface in its actual shell at desktop
width and 390×844. Check long content, focus, overflow, touch targets, loading,
empty/error/connected states as applicable, and all preserved actions. Use
relevant existing lint/type checks. Report what was actually verified; a
redirect or compilation alone is not visual verification. Do not create test
scaffolding, change the data layer, commit or publish unless authorized.
