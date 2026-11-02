// SmartHelp's pre-written guides: tapped, answered at once, no AI. Pure data — client and server both import it.
//
// WRITTEN FROM THE CODE (2026-10-29). Every button, tab and field named in a step is the label the page renders,
// copied from its JSX or copy table; every `open` is a page in HELP_PAGES; every `show` is a `data-tour` on the real
// element (desk and handheld alike) or a sidebar row (`nav:<href>`). qa/tests/logic/smarthelp-guides.check.ts holds
// the pages and targets to that. A feature change that renames a label updates its guide in the same commit.
//
// Words: one action per step, what they will see next, no URLs or app paths. HVAC sizing is "Manual J-style".
import type { Guide } from "./types";

const DESK = "/dashboard/phone?tab=settings";
const SMARTBOOK = "/dashboard/settings?pane=smartbook";

export const GUIDES: Guide[] = [
  // ── Set it up ──────────────────────────────────────────────────────────────
  {
    id: "ai-desk",
    title: "Set up the AI desk",
    group: "setup",
    icon: "PhoneCall",
    needs: "aiDesk",
    steps: [
      {
        text: "Open AI desk setup. You’ll see Set up the desk, a checklist of four steps: Phone & forwarding, Your business, Booking and Voice & test. Each row opens with Open.",
        open: DESK,
      },
      {
        text: "Open Your business. Under What kind of business are you?, type your trade and press Preset the desk. JobFlex fills in what callers ask a company like yours.",
        open: `${DESK}&step=business`,
        show: "ai-desk:kind",
      },
      {
        text: "Under Describe your business, type it or press Say it instead: what you do, your area, your prices, your warranty. Press Write it professionally — the desk answers callers from it.",
        open: `${DESK}&step=business`,
        show: "ai-desk:describe",
      },
      {
        text: "Check the highlighted parts — callers will hear them as promises. Press Show the next, then fix it, edit it or press Looks right. Press Save the instructions.",
      },
      {
        text: "Open Booking. Pick Your time zone, then Where the desk books visits: Our open hours, or Only hours we reserve.",
        open: `${DESK}&step=booking`,
        show: "ai-desk:hours",
      },
      {
        text: "Open Voice & test. Pick the desk’s voice and press Hear it. Then press Call the desk and talk to it like a customer — nothing from a test call is saved.",
        open: `${DESK}&step=voice`,
        show: "ai-desk:test",
      },
    ],
  },
  {
    id: "ai-desk-calls",
    title: "Send your calls to the AI desk",
    group: "setup",
    icon: "PhoneForwarded",
    steps: [
      {
        text: "Open Phone & forwarding. Under The desk’s number, press Get your number if the desk has none — it takes you to Texting, where the number is set up.",
        open: `${DESK}&step=numbers`,
      },
      {
        text: "Under Your business phone, type the number customers call you on today and press Save.",
        open: `${DESK}&step=numbers`,
      },
      {
        text: "Under How do customers reach the desk?, pick one: They call the desk’s number, My number forwards the calls I miss, or My number forwards every call.",
        open: `${DESK}&step=numbers`,
        show: "ai-desk:forwarding",
      },
      {
        text: "Forwarding is switched on at your phone carrier — JobFlex can’t do it for you. Under Turn it on at your carrier, dial your carrier’s code from your phone and wait for the tone or message that it’s on.",
      },
      {
        text: "Press Test my forwarding. The desk calls your phone; for missed calls, let it ring without answering. When it works you’ll see Forwarding works.",
      },
      {
        text: "Under Who answers, pick The desk answers every call, or Ring my phone first — your phone rings for 25 seconds and the desk takes the calls nobody picks up.",
      },
    ],
  },
  {
    id: "texting",
    title: "Turn on texting",
    group: "setup",
    icon: "MessageSquareText",
    needs: "texting",
    steps: [
      {
        text: "Open Texting. You’ll see Set up texting, four steps: Your number, Your team, Texts to clients and Your own texts.",
        open: "/dashboard/texting",
      },
      {
        text: "Open Your number and press Get your number. If JobFlex lent you a line, the button reads Register this number for texts or Get your own number for texts. It comes with a paid plan.",
        open: "/dashboard/texting#texting-own-number",
        show: "texting:get-number",
      },
      {
        text: "A short form opens with what JobFlex already knows filled in. Write the legal name, EIN and address exactly as on your IRS EIN letter or your state registration.",
      },
      {
        text: "Press Register my number. The number answers calls right away; texts start by themselves once the carriers approve, usually within 3 business days.",
        show: "texting:register",
      },
      {
        text: "Open Your team. On your own row press Add mobile, then Text me a code, type the six-digit code and press Verify.",
      },
    ],
  },
  {
    id: "payments",
    title: "Get paid online",
    group: "setup",
    icon: "CreditCard",
    needs: "payments",
    steps: [
      {
        text: "Open Settings → Integrations / Payments. You’ll see tabs for Stripe, Square and Stax.",
        open: "/dashboard/settings?pane=integrations&sub=stripe",
        show: "payments:processors",
      },
      {
        text: "For Stripe, press Connect with Stripe and sign in to your Stripe account — or press Use API key to paste a key. Back in JobFlex, Stripe reads Connected.",
      },
      {
        text: "With Stripe connected, turn on Accept ACH bank debits so clients can pay from a US bank account. It clears in 1–3 business days.",
      },
      {
        text: "Square works the same way: Connect with Square, or Use access token. For Stax, press Connect Stax (on a phone, Use API key) and paste your Stax API key.",
      },
      {
        text: "Once a client accepts a proposal, a pay button appears on their copy of it.",
      },
    ],
  },
  {
    id: "website",
    title: "Put estimators on your website",
    group: "setup",
    icon: "Globe",
    needs: "website",
    feature: "website",
    steps: [
      {
        text: "Open Settings → Website estimators. You’ll see Your estimators on your website, a card for each estimator.",
        open: "/dashboard/settings?pane=website",
        show: "website:trades",
      },
      {
        text: "Turn a card On — Roof estimator on your website, for example. The card says what it adds to your plan.",
      },
      {
        text: "Choose what The homeowner sees: A price range or The exact figure. Tick Ask for their email too if you want it.",
      },
      {
        text: "Under Your websites, type your site name, like ridgelineroofing.com — the button runs only there. Leave it blank for any site.",
      },
      {
        text: "Press Save (Save and add to my plan when a card is new). Then copy The link, The button or On the page and paste it on your site.",
        show: "website:save",
      },
      {
        text: "Every request lands on Leads under My leads, with the price the homeowner saw.",
        open: "/dashboard/leads",
      },
    ],
  },
  {
    id: "booking",
    title: "Turn on online booking",
    group: "setup",
    icon: "CalendarCheck",
    needs: "booking",
    feature: "booking",
    steps: [
      {
        text: "Open Online booking. Under Hours and rules, tick The booking page is on.",
        open: "/dashboard/booking",
        show: "booking:on",
      },
      {
        text: "Set your Open hours (tick Closed on days off) and the Booking rules, then press Save hours and rules.",
      },
      {
        text: "Check Services customers can book — they come from your trades, with your prices. Press Edit on one to change it.",
      },
      {
        text: "Under Your booking link, press Copy link. Put it on your website, Google profile, email signature and invoices.",
        show: "booking:link",
      },
      {
        text: "New bookings show under Booked online and on your calendar. A new customer becomes a lead.",
      },
    ],
  },
  {
    id: "profile",
    title: "Complete your company profile",
    group: "setup",
    icon: "Building2",
    needs: "profile",
    steps: [
      {
        text: "Open Company. On Branding, type your company’s real name in Company name.",
        open: "/dashboard/company#company-name",
      },
      {
        text: "Under Lead matching, type your Business address — street, city, state, zip. Homeowner leads are matched to it.",
        open: "/dashboard/company",
        show: "profile:lead-address",
      },
      {
        text: "Under Trades you take, tap every trade you do.",
        show: "profile:trades",
      },
      {
        text: "Set Service radius, miles. Leads farther away than that are never offered to you.",
      },
      {
        text: "Keep Accept platform leads on. Changes save by themselves; the badge by Lead matching reads Matching on once leads can reach you.",
      },
    ],
  },
  {
    id: "team",
    title: "Invite your team and crew",
    group: "setup",
    icon: "Users",
    needs: "team",
    steps: [
      {
        text: "Open Workers and press Invite worker.",
        open: "/dashboard/workers",
        show: "team:invite",
      },
      {
        text: "Type their Full name and Email — the email is how they sign in — and their number under Phone (optional). On a computer, tick Text their schedule to this phone to send them their jobs by text.",
      },
      {
        text: "Pick the Role: Installer, Sales, Estimator or Manager. The box under it says what that role will see and do.",
      },
      {
        text: "Press Send invite. They get an email inviting them to join your company.",
      },
    ],
  },
  {
    id: "first-proposal",
    title: "Send a proposal and get it signed",
    group: "setup",
    icon: "Send",
    needs: "proposalSent",
    steps: [
      {
        text: "Make the estimate in any estimator and press its proposal button — Convert to proposal, Save as proposal or Create proposal. The proposal opens as a draft you can still edit.",
      },
      {
        text: "In card 02, The client, pick the client or add a new one, and check the Email — the proposal goes there.",
      },
      {
        text: "Press Save & send. If the client has no email on file, JobFlex asks Where should this go? — type it and the proposal goes out.",
        show: "proposal-send",
      },
      {
        text: "Once it’s saved, you can send it yourself: under Show to client, press Copy client link or Text the link.",
      },
      {
        text: "The client types their name under Your full name and presses Accept proposal. On Proposals, the row goes from Sent to Viewed to Accepted.",
        open: "/dashboard/proposals",
      },
    ],
  },
  {
    id: "branding",
    title: "Your logo and colors on proposals",
    group: "setup",
    icon: "Palette",
    steps: [
      {
        text: "Open Company. Under Logo, press Drop or click (on a phone, Tap to upload) and pick your logo — PNG, JPG, WebP or SVG up to 15 MB.",
        open: "/dashboard/company",
        show: "branding:logo",
      },
      {
        text: "Under Brand color, tap your color. It saves by itself.",
        show: "branding:color",
      },
      {
        text: "The preview shows your email header with the new logo and color.",
      },
      {
        text: "Every proposal your clients open now carries your logo and your color. To take the logo off, press Remove logo.",
      },
    ],
  },
  {
    id: "own-leads",
    title: "Bring in your own leads",
    group: "setup",
    icon: "Inbox",
    steps: [
      {
        text: "Open Leads and press Import leads (on a phone, Import).",
        open: "/dashboard/leads",
        show: "leads:import",
      },
      {
        text: "Pick how: Manual entry, Paste email or File (on a phone: By hand, Paste or CSV).",
      },
      {
        text: "Paste a lead email from Angi, Thumbtack, Yelp, Google, Houzz, Nextdoor or Facebook — it’s tagged with that source by itself. Or drop a CSV file.",
      },
      {
        text: "On a computer, press Add to import list for each one, then Import leads. Nothing reaches the pipeline until you import the batch.",
      },
      {
        text: "For Facebook and Instagram lead forms, open Settings → Integrations → Meta business and press Connect Meta Business. Sign in to Facebook and choose your Page.",
        open: "/dashboard/settings?pane=integrations&sub=meta",
        show: "leads:meta",
      },
      {
        text: "Press Connect leads, then Import leads — duplicates are skipped. If the button says Coming soon, it isn’t open for your account yet.",
      },
    ],
  },
  // SmartBook (2026-10-31): Settings → SmartBook, and the box a Facebook lead ticks to be texted.
  {
    id: "smartbook",
    title: "Turn on SmartBook",
    group: "setup",
    icon: "CalendarCheck",
    steps: [
      {
        text: "Open Settings → SmartBook. You’ll see Times for new leads, with the switch Off. SmartBook offers the open hours you set in Online booking, so turn that on first if it’s off.",
        open: SMARTBOOK,
        show: "smartbook:on",
      },
      {
        text: "Press the switch so it reads Answers new leads. Under Which leads, tick where the leads come from — Facebook and Instagram lead forms come in by themselves once your Page is connected — saving with them ticked turns that on.",
        open: SMARTBOOK,
      },
      {
        text: "Under How it reaches them, keep Text and Email on. Tick One AI call if there’s no answer in 2 business hours to have your AI desk call once — it uses your desk minutes.",
      },
      {
        text: "Under The visit it offers, pick the Visit type and the Times in each message. Under When a customer names their own time, pick Ask me first, or Book it if my calendar is free, then tell me.",
      },
      {
        text: "Press Save, then Send me a test. You get the text and the email a new lead would get — answer like a customer would. Nothing is booked.",
        open: SMARTBOOK,
        show: "smartbook:test",
      },
      {
        text: "When a customer names their own time, you get a text and an email — answer YES, NO or another time. The same request waits on your Calendar under SmartBook requests.",
        open: "/dashboard/calendar",
      },
    ],
  },
  {
    id: "smartbook-facebook",
    title: "Add the texts box to your Facebook form",
    group: "setup",
    icon: "ListChecks",
    steps: [
      {
        text: "Connect your Page first: open Settings → Integrations → Meta business and press Connect Meta Business. Saving SmartBook turns on New leads come in by themselves there, so new leads arrive every few minutes.",
        open: "/dashboard/settings?pane=integrations&sub=meta",
        show: "leads:meta",
      },
      {
        text: "Open Settings → SmartBook. Under The texts box on your Facebook form, press Copy next to the words.",
        open: SMARTBOOK,
        show: "smartbook:consent",
      },
      {
        text: "In Meta Ads Manager, open your lead form. A published form can’t be changed, so duplicate it.",
      },
      {
        text: "Under Privacy, add a custom disclaimer, then add a checkbox and paste the words. Leave it optional. For SmartBook’s AI call, add a second box with the words under For SmartBook’s call, a second box.",
      },
      {
        text: "Publish the copy and use it in your ads. Within a few hours Settings → SmartBook shows how many of your forms have the texts box. A lead who doesn’t tick it gets the times by email.",
      },
    ],
  },
  {
    id: "reviews",
    title: "Ask clients for reviews",
    group: "setup",
    icon: "Star",
    steps: [
      {
        text: "Open Reviews. When you mark a job as completed, the client gets a review link by itself.",
        open: "/dashboard/reviews",
      },
      {
        text: "To ask now, press Request review, pick the Job and press Send request. The client gets the link by email.",
        show: "reviews:request",
      },
      {
        text: "Answers land under Recent reviews; requests not answered yet wait under Awaiting response.",
      },
      {
        text: "Press Public page to see the reviews page your clients can read.",
      },
    ],
  },

  // ── How it works ───────────────────────────────────────────────────────────
  {
    id: "roof",
    title: "How the roof estimator works",
    group: "how",
    icon: "House",
    steps: [
      {
        text: "Open the Roof estimator. Under Measure a roof, type the job’s address in Address and pick the house from the list.",
        open: "/dashboard/roof-estimator",
        show: "roof-address",
      },
      {
        text: "Press Measure this roof. JobFlex reads the roof from aerial data — the squares, the pitch and the edges. It takes a few seconds to a couple of minutes; stay on the page.",
        show: "roof-measure",
      },
      {
        text: "Check Total area, Roofing squares and Roof pitch at the top. GOOGLE AREA means the squares came from Google imagery — confirm the area and enter the pitch.",
        show: "roof-hero",
      },
      {
        text: "Pick the Roof system and the rest of the package. The Estimate total follows every change.",
        show: "roof-package",
      },
      {
        text: "If you see Order measurement report (under Edges, in Measurement source & report), it orders the full aerial report for this roof. It’s billed and usually arrives within 48 hours; its measured lengths then load into the package by themselves.",
      },
      {
        text: "Press Convert to proposal. It opens as a draft you can still edit. Roofs you measured stay under Recent measurements to reopen later.",
        show: "roof-convert",
      },
    ],
  },
  {
    id: "fence",
    title: "How the fence estimator works",
    group: "how",
    icon: "Fence",
    steps: [
      {
        text: "Open the Fence estimator. Type the job’s address in Search an address… and press Find. The map opens on the lot with its property lines.",
        open: "/dashboard/fence-estimator",
        show: "fence-address",
      },
      {
        text: "Click along the fence on the map — dots snap to corners, lot lines and house walls — and double-click to finish. On a phone, tap the points, then Finish run.",
        show: "fence-map",
      },
      {
        text: "Or press Put down the fence to lay fence along the checked property lines.",
        show: "fence-lay",
      },
      {
        text: "Pick the Fence type and the Height. Posts, rails and the price follow.",
        show: "fence-type",
      },
      {
        text: "Under Estimated total, pick Good, Better or Best, then press Convert to proposal.",
        show: "fence-convert",
      },
    ],
  },
  {
    id: "hvac",
    title: "How the HVAC estimator works",
    group: "how",
    icon: "Thermometer",
    steps: [
      {
        text: "Open the HVAC estimator. In The job, Full system is picked; choose another job if it isn’t that, then press Continue with the address.",
        open: "/dashboard/hvac-estimator",
      },
      {
        text: "In The house, type the address and press Look up the house — the house size and the local climate come in. No record? Press Enter it by hand.",
      },
      {
        text: "In What is there, check the Conditioned sq ft — it sizes the system — then press Continue to the design.",
      },
      {
        text: "The design sizes the system with a Manual J-style load for your area’s design day. Pick Good, Better or Best, then press Continue to the estimate.",
        show: "hvac-tiers",
      },
      {
        text: "In The estimate, every line is editable. Press Convert to proposal.",
        show: "hvac-convert",
      },
    ],
  },
  {
    id: "deck",
    title: "Deck Studio: from photo to client",
    group: "how",
    icon: "Box",
    steps: [
      {
        text: "Open Deck Studio. Under What are you building?, pick Deck, Covered deck, Gazebo or Pergola — or Start from a sample. The 3D follows every choice.",
        open: "/dashboard/deck-estimator",
      },
      {
        text: "Under Deck size & house placement (Size & placement for a gazebo or pergola without a deck), set the size — on a deck, Along the house and Out from the house.",
      },
      {
        text: "Under House & ground, at Build the house from a photo, press Upload a photo or Take a photo of the back wall where the deck goes.",
        show: "deck:house-photo",
      },
      {
        text: "Check Here’s what I see — drag any line that’s off — and press Build my house. The house wall in 3D now follows the photo.",
      },
      {
        text: "Press Send to client, type the Client’s name and Mobile, and press Make the link. Then Text it, Email it or Copy link.",
        show: "deck:send",
      },
      {
        text: "Press Save as proposal at the foot of the form. A button with a lock comes with the Deck Studio add-on.",
        show: "deck-price",
      },
    ],
  },
  {
    id: "smart-proposal",
    title: "Smart Proposal for any job",
    group: "how",
    icon: "Sparkles",
    steps: [
      {
        text: "Open Smart Proposal. Under The brief, describe the job the way you’d tell the customer — what, how big, which materials.",
        open: "/dashboard/advanced-ai",
        show: "smart-brief",
      },
      {
        text: "Add the Location — prices follow the region.",
      },
      {
        text: "Press Generate estimate (on a phone, Next first). If it asks a question or two, answer them or press Generate anyway.",
        show: "smart-generate",
      },
      {
        text: "Check the Line items: change what you’d price differently and remove what isn’t in the job.",
        show: "smart-lines",
      },
      {
        text: "Press Save as proposal. It opens as a draft you can still edit.",
        show: "smart-convert",
      },
    ],
  },
  {
    id: "blueprint",
    title: "Estimate from blueprints",
    group: "how",
    icon: "Ruler",
    steps: [
      {
        text: "Open the Blueprint estimator and press Choose the plans — a PDF of the plans, or photos of the sheets.",
        open: "/dashboard/blueprint-estimator",
        show: "blueprint:upload",
      },
      {
        text: "Under Estimate a job, type the job the way you’d say it to your estimator — granite countertops, or drywall with texture and paint.",
      },
      {
        text: "Check Price it for — the city sets regional prices — and press Estimate it.",
      },
      {
        text: "Every quantity comes from the plans, with its page. Press Create proposal, or Edit in Smart Proposal.",
      },
      {
        text: "Only need sizes? Pick Sizes & measurements. A buy list? Pick Materials.",
      },
    ],
  },
  {
    id: "video",
    title: "Estimate from a walkthrough video",
    group: "how",
    icon: "Video",
    steps: [
      {
        text: "Open the Video estimator and press Add video — an MP4 or MOV walkthrough up to 5 minutes. Say the measurements out loud as you walk.",
        open: "/dashboard/video-estimator",
        show: "video:add",
      },
      {
        text: "Fill in the Address. The Project is optional — it’s read from the video if left blank.",
      },
      {
        text: "Press Analyze video. The scope, what was measured from the video and the Line items come back.",
      },
      {
        text: "Check the lines and press Convert to proposal.",
      },
    ],
  },
  {
    id: "projects",
    title: "Projects, change orders and invoices",
    group: "how",
    icon: "FolderKanban",
    steps: [
      {
        text: "Open Projects and open a project. Its Proposals list shows every proposal in it, with its status.",
        open: "/dashboard/projects",
      },
      {
        text: "Press New proposal (on a phone, New proposal in this project) to start one inside the project, or Attach proposal to file one you already made.",
      },
      {
        text: "On a computer, press Change order on a proposal’s row. Add the extra work and press Send for approval — the sheet shows what the Contract becomes.",
      },
      {
        text: "Or open Financials and press Add change order, pick the Job and press Open the sheet.",
        open: "/dashboard/financials",
      },
      {
        text: "To bill, press New invoice on Financials. Pick the Proposal and how it’s paid under Pay by, then press Send invoice. It bills the balance still owing.",
        open: "/dashboard/financials",
      },
    ],
  },
  {
    id: "crew",
    title: "Jobs and the calendar for your crew",
    group: "how",
    icon: "HardHat",
    steps: [
      {
        text: "Open Jobs. When a client accepts a proposal, its job appears here by itself — or press New job.",
        open: "/dashboard/jobs",
      },
      {
        text: "On a computer, open the job’s menu and pick Schedule. Set Starts and Ends, then press Save schedule. The job shows on the Calendar on those days.",
      },
      {
        text: "Pick Assign crew and tap the people who go, then press Save crew (on a phone, Done).",
      },
      {
        text: "Your crew signs in and sees their work under Jobs and Schedule.",
      },
      {
        text: "No login for a worker? On Workers, open them and copy their Worker dashboard link. On it they press Start work, Back on site on later days, and Complete — the office is told.",
        open: "/dashboard/workers",
      },
    ],
  },
];

/** Every Show me target a guide names — the set the AI's own steps may also use (with the nav rows). */
export const GUIDE_TARGETS: ReadonlySet<string> = new Set(
  GUIDES.flatMap((g) => g.steps.flatMap((s) => (s.show ? [s.show] : []))),
);
