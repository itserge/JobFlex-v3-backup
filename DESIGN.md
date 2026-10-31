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
shell keeps the switch.

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

Read [implementation notes](docs/design/implementation.md) when editing an
existing interactive surface, and [mobile notes](docs/design/mobile.md) for
handheld work. These describe code hazards, not alternative visual themes.

Before delivery, verify the changed surface in its actual shell at desktop
width and 390×844. Check long content, focus, overflow, touch targets, loading,
empty/error/connected states as applicable, and all preserved actions. Use
relevant existing lint/type checks. Report what was actually verified; a
redirect or compilation alone is not visual verification. Do not create test
scaffolding, change the data layer, commit or publish unless authorized.
