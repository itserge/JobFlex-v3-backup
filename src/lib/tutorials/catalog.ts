// THE TUTORIALS (owner, 2026-11-11: "add tutorials in a sidebar on the bottom … and upload their home builder,
// remodelers, Deck Studio, CRM and Fence Studio tutorials"; the AI desk, Texting and Smart Proposal films joined the
// same day). Plain
// data, safe on the server and in the browser.
//
// The films are made outside this repository (the video kit on the owner's machine) and live in the PRIVATE Vercel
// Blob store under fixed names — tutorials/<slug>-<version>.mp4 and .jpg — never in the repository, which is public.
// Only a signed-in page hands out links to them, each good for a few hours (./links). A re-filmed tutorial goes up
// under the next version (-v2) and its row here moves to it, so a cached copy of the old film is never mixed in.
//
// The chapters are the films' own chapter cards: each starts where its card appears, read off the film's voice
// timeline (the same clock the film is cut to — checked against the CRM film's own chapter list). The films carry
// their subtitles in the picture, so the player adds none.

export type TutorialChapter = {
  /** Seconds into the film. */
  at: number;
  title: string;
  /** What the chapter covers, as its card says it. */
  about: string;
};

export type Tutorial = {
  slug: string;
  /** The tool's name as the sidebar prints it. */
  tool: string;
  title: string;
  /** Who it is made for. */
  audience: string;
  summary: string;
  /** The page the tutorial teaches; the viewer's own tools come first (the sidebar's own rule decides). */
  toolHref: string;
  /** Seconds. */
  duration: number;
  /** The file version in the store (tutorials/<slug>-<version>.mp4). */
  version: string;
  chapters: readonly TutorialChapter[];
};

/** The film (mp4) or its title frame (jpg) in the store. */
export function tutorialFile(t: Pick<Tutorial, "slug" | "version">, kind: "mp4" | "jpg"): string {
  return `tutorials/${t.slug}-${t.version}.${kind}`;
}

/** The links a page hands the browser, by slug (./links). */
export type TutorialLinks = Record<string, { video: string; poster: string }>;

/** 0:00 · 4:12 · 1:02:03 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "8 min" — the length a card and a button quote. */
export function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** The chapter playing at `seconds` (the last one started), or -1 before the first. */
export function chapterAt(t: Pick<Tutorial, "chapters">, seconds: number): number {
  let k = -1;
  t.chapters.forEach((c, i) => {
    if (seconds + 0.25 >= c.at) k = i;
  });
  return k;
}

// In the order the owner named them.
export const TUTORIALS: readonly Tutorial[] = [
  {
    slug: "new-home",
    tool: "Projects",
    title: "A new home, lot to keys",
    audience: "Home builders",
    summary: "One house carried from the lot to the keys: stages, inspections, the client's choices, the money and the bank's draws.",
    toolHref: "/dashboard/projects",
    duration: 464,
    version: "v1",
    chapters: [
      { at: 0, title: "What a new-home project holds", about: "One project, from the lot to the keys" },
      { at: 17, title: "Where it lives", about: "Three workspaces · New Home Builder · the list" },
      { at: 32, title: "Start a new home", about: "For whom · how you earn · ten questions · the budget" },
      { at: 93, title: "The lot", about: "Parcel · utilities · permits" },
      { at: 128, title: "Stages and tasks", about: "Twelve stages · tasks · start · done" },
      { at: 159, title: "Phases", about: "Ten phases · gates · lead times" },
      { at: 184, title: "The timeline", about: "Lay out the days · bars · shift" },
      { at: 208, title: "Inspections", about: "Eighteen inspections · what each one holds" },
      { at: 236, title: "Selections", about: "Due days · allowances · chosen" },
      { at: 268, title: "Contractors", about: "Request quotes · their own link · award" },
      { at: 291, title: "Money", about: "Budget by phase · costs · where it is heading" },
      { at: 331, title: "Draws and the lender", about: "Five draws · request · funded · the bank's page" },
      { at: 373, title: "The homeowner's page", about: "The link · their choices · the loan · files" },
      { at: 411, title: "Overview and finish line", about: "Do now · people · money · ten last steps" },
    ],
  },
  {
    slug: "remodel",
    tool: "Projects",
    title: "A remodel, start to finish",
    audience: "Remodelers",
    summary: "A kitchen remodel from the sold proposal to the archive: the plan, the materials, the deposit, the crew on site, a change order and the finish line.",
    toolHref: "/dashboard/projects",
    duration: 282,
    version: "v1",
    chapters: [
      { at: 0, title: "The remodel at a glance", about: "A kitchen, run start to finish" },
      { at: 9, title: "Automatic projects", about: "Sold proposals become projects" },
      { at: 33, title: "The sale", about: "Proposal · sent · accepted" },
      { at: 56, title: "The project appears", about: "Numbered · stages · budget · payments" },
      { at: 79, title: "Plan the work", about: "Lay out the days · inspections · the crew" },
      { at: 115, title: "Buy the materials", about: "Order-by dates · purchase orders · deliveries" },
      { at: 140, title: "Take the deposit", about: "Invoice · payment recorded" },
      { at: 152, title: "On site", about: "The crew's phone · problems · hours" },
      { at: 181, title: "A change order", about: "Approved · priced in · shift the rest" },
      { at: 215, title: "Inspections & deliveries", about: "Passed · delivered · costs · margin" },
      { at: 236, title: "The finish line", about: "Punch list · sign-off · review · warranty" },
    ],
  },
  {
    slug: "deck-studio",
    tool: "Deck Studio",
    title: "Deck Studio, every step",
    audience: "Deck builders",
    summary: "Eight questions and the deck is drawn in 3D, framed to the code and priced — shaped by hand, with its accessories, the permit set and the proposal.",
    toolHref: "/dashboard/deck-estimator",
    // v2 (2026-11-15): filmed again on today's studio — eight questions, the page as it is now — with the new tools:
    // shaping by hand, the wall's lock, the double deck, accessories, landings, wide steps, a part's own boards.
    duration: 689,
    version: "v2",
    chapters: [
      { at: 0, title: "What Deck Studio does", about: "Eight questions, a deck in 3D" },
      { at: 15, title: "The page", about: "Questions left · the deck right · the price" },
      { at: 38, title: "What are you building?", about: "Deck · covered deck · gazebo · pergola" },
      { at: 60, title: "Size, house & ground", about: "Shape · height · how it stands · footings" },
      { at: 130, title: "Shape it by hand", about: "The drawing · bays and corners · lock the wall" },
      { at: 190, title: "The double deck", about: "Two floors · the lower deck's own shape" },
      { at: 215, title: "What a deck has", about: "Footings · posts · beams · joists · boards" },
      { at: 256, title: "Materials", about: "Packages · boards · colours · the frame" },
      { at: 320, title: "Railing & stairs", about: "Guard · railing · stairs · landings · wide steps" },
      { at: 369, title: "Accessories", about: "Benches · planters · screen · kitchen · moved in 3D" },
      { at: 410, title: "The roof", about: "Shape · pitch · roofing · on the wall or free" },
      { at: 440, title: "Lights & extras", about: "Fixtures · wiring · night view" },
      { at: 472, title: "The code check", about: "Pass · note · check · auto-fix" },
      { at: 508, title: "The picture's tools", about: "Views · edit in 3D · click a part · talk" },
      { at: 554, title: "Package & price", about: "Your prices · proposal lines · material list" },
      { at: 595, title: "The permit set", about: "Permit set · crew set · county match · template" },
      { at: 633, title: "The client", about: "Link · the client's changes · proposal · accepted" },
    ],
  },
  {
    slug: "crm",
    tool: "CRM",
    title: "The CRM, every screen",
    audience: "Every company",
    summary: "Every client, lead and promise in one place: Today, the Inbox, the Pipeline, Customers and the office tools, and how to set it up.",
    toolHref: "/dashboard/crm",
    duration: 555,
    version: "v1",
    chapters: [
      { at: 0, title: "What the CRM is", about: "Every client, lead and promise in one place" },
      { at: 19, title: "The four screens", about: "Today · Inbox · Pipeline · Customers" },
      { at: 43, title: "Today", about: "What to check · one button for each" },
      { at: 83, title: "Follow-ups waiting for you", about: "Prepared, not sent · send, edit or skip" },
      { at: 114, title: "Promises", about: "Yours · theirs · overdue · kept" },
      { at: 145, title: "The Inbox", about: "One thread per client · what it means · three drafts" },
      { at: 191, title: "The Pipeline", about: "Eight stages · risk · next step · lead sources" },
      { at: 256, title: "Customers & the record", about: "Where they stand · memory · timeline" },
      { at: 313, title: "The client's page", about: "One link · no account · they write back" },
      { at: 343, title: "Workflows", about: "Rules · who sends it · the words" },
      { at: 388, title: "Office", about: "Right now · company pulse · Monday report" },
      { at: 435, title: "Win back", about: "The list · one email · what came of it" },
      { at: 488, title: "Setting it up", about: "Six steps" },
    ],
  },
  {
    slug: "fence-studio",
    tool: "Fence estimator",
    title: "Fence Studio, address to proposal",
    audience: "Fence contractors",
    summary: "Type an address, trace the fence on the lot, and get the price, the material list, the fence in 3D and a proposal the client can sign.",
    toolHref: "/dashboard/fence-estimator",
    duration: 453,
    version: "v1",
    chapters: [
      { at: 0, title: "What Fence Studio does", about: "From an address to a signed proposal" },
      { at: 20, title: "Where it lives", about: "Fence estimator · the address · the lot" },
      { at: 36, title: "The lot", about: "Topo · the low and high corners · the sides" },
      { at: 66, title: "The house", about: "Trace outline · stories · edit" },
      { at: 92, title: "Put down the fence", about: "One button · three runs · the chips" },
      { at: 110, title: "Trace it by hand", about: "Dots · snaps · level, racked, stepped · drag" },
      { at: 153, title: "Gates and doors", about: "Four gates · two doors · steel gate posts" },
      { at: 179, title: "Fence type and your rates", about: "Fifteen types · good, better, best · your price · the Price book" },
      { at: 233, title: "Height and site", about: "Four heights · the 8-foot warning · four site switches" },
      { at: 266, title: "Boards, ground, posts", about: "Cedar grade · fasteners · the dig · post systems · spacing" },
      { at: 316, title: "Runs, takeoff, total", about: "The order list · crew time · the notes" },
      { at: 354, title: "The fence in 3D", about: "Real ground · turn · zoom · walk through" },
      { at: 376, title: "The proposal", about: "Convert · the client · the lines · the link · payments" },
      { at: 415, title: "The client's page", about: "Their fence in 3D · the layout · the estimate · accept" },
    ],
  },
  {
    // Added 2026-11-11 (owner: "now we have AI desk new tutorial video added to the tutorials").
    slug: "ai-desk",
    tool: "AI desk",
    title: "The AI desk: set it up, tune it, see it work",
    audience: "Every company",
    summary: "The phone line that answers for you: its number and forwarding, what it knows about your business, what it says, the hours it books, and a real call from ring to visit.",
    toolHref: "/dashboard/phone",
    duration: 328,
    version: "v1",
    chapters: [
      { at: 0, title: "What the AI desk does", about: "It answers, books visits and takes messages, day and night" },
      { at: 19, title: "Where it lives", about: "Automation · Calls · AI desk setup · the line at the top" },
      { at: 48, title: "Phone and forwarding", about: "Its own number · your phone · forwarding · who answers" },
      { at: 87, title: "Your business", about: "Preset the desk · what it knows · Check this · your own words" },
      { at: 134, title: "Tuning what it says", about: "The greeting · prices · questions · never say · save" },
      { at: 168, title: "Booking", about: "Time zone · hours and visits · reserved hours · the next open times" },
      { at: 199, title: "Voice and test", about: "The voice · try it by text · call the desk · live" },
      { at: 225, title: "Minutes and new leads", about: "Minutes · 300 for $29 · out of minutes · call new leads" },
      { at: 244, title: "A call, start to finish", about: "The Calls tab · the call · the conversation · the visit" },
      { at: 279, title: "Messages and hand-offs", about: "A message · a hand-off · the AI desk filter" },
      { at: 297, title: "Keep it sharp", about: "Read the calls · add answers · never say · preset again" },
    ],
  },
  {
    // Added 2026-11-11 (owner: "make professional tutorial for contractors for texting … now add it to tutorials").
    slug: "texting",
    tool: "Texting",
    title: "Texting, set up and explained",
    audience: "Every company",
    summary: "Your own number in your company's name, your team's texts, texts to clients who said yes, texts of your own — and a text going out and its answer coming back.",
    toolHref: "/dashboard/texting",
    duration: 484,
    version: "v1",
    chapters: [
      { at: 0, title: "What texting in JobFlex is", about: "Clients, team and crew, from one number in your name" },
      { at: 20, title: "The Texting page", about: "What it's for · this month · four steps" },
      { at: 51, title: "Your number", about: "Toll-free · your company's name · the carriers" },
      { at: 125, title: "Your team", about: "Your mobile · their mobiles · what each one gets" },
      { at: 196, title: "Texts to clients", about: "The proposal link · the reminder · only after a yes" },
      { at: 235, title: "Your own texts", about: "When · who · the words · how it reads" },
      { at: 295, title: "A text goes out", about: "Megan's proposal · the evening before" },
      { at: 323, title: "The client answers", about: "To your phone · the Inbox · answer by text" },
      { at: 360, title: "More ways to text", about: "Message · client's page · follow-ups · SmartBook" },
      { at: 389, title: "The crew", about: "Put on a job · tomorrow's list · today's list" },
      { at: 406, title: "Safe by design", about: "STOP · HELP · quiet nights · limits" },
      { at: 438, title: "Setting it up", about: "Five steps" },
    ],
  },
  {
    // Added 2026-11-11 (owner: "create me tutorial how to use Smart Proposal … add it to JobFlex tutorials").
    slug: "smart-proposal",
    tool: "Smart Proposal",
    title: "Smart Proposal: from a few words to a signed job",
    audience: "Every company",
    summary: "Describe a job and add a few photos: a priced estimate, adjusted line by line, a proposal the client signs on their phone — and the same proposal runs the job.",
    toolHref: "/dashboard/advanced-ai",
    duration: 308,
    version: "v1",
    chapters: [
      { at: 0, title: "What Smart Proposal does", about: "A few words and photos in, a priced estimate out, a signed job" },
      { at: 24, title: "Where it lives", about: "Estimating tools · one tool for any job · the examples" },
      { at: 41, title: "Describe the job", about: "The brief · what comes out, what goes in · Speak the brief" },
      { at: 64, title: "Site photos", about: "Up to six · read to price what is there · nothing stored" },
      { at: 83, title: "Location, then Generate", about: "Address and state · the questions that move the price" },
      { at: 119, title: "The estimate", about: "Tasks in order · quantity, unit, material, labor · edit, remove, add" },
      { at: 173, title: "From estimate to proposal", about: "The client · what they see · your margin · payments · send" },
      { at: 218, title: "The client signs", about: "Their phone · their name · Accept proposal" },
      { at: 231, title: "Run the job from it", about: "Contract and payments · change orders · the project it made" },
      { at: 268, title: "Tips", about: "Sizes · what stays · the same brief · read every line" },
    ],
  },
];

export function tutorialBySlug(slug: string | null | undefined): Tutorial | null {
  return TUTORIALS.find((t) => t.slug === slug) ?? null;
}
