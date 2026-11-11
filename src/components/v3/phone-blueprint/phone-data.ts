// Phone blueprint — the page's row SHAPE, plus the donor's demo fixture.
//
// The shape is no longer the donor's abbreviation of `AiPhoneCall`; it is now
// a real projection of that model, filled in src/app/dashboard/phone/page.tsx:
// `rec` carries the actual `recordingUrl` (the <audio> source, not a boolean
// "there is one"), `lead` carries the actual `Lead.id` (so "Open lead" is a
// real link), and `transcript` carries the raw text so a transcript that is
// NOT speaker-labelled can still be shown instead of being thrown away.
//
// CALLS_SEED survives only as the fallback for a mount that supplies no
// entries (there is no such route today — the dashboard page always queries).
// It is a fixture: it has no recordings, so its player never renders.

import type { CallsGo, DeskMode, DeskOutcomeWord, DeskVoice } from "@/lib/aiDesk/shared";

/** One transcript line: [who, text], where `who` is 'caller', 'agent' or
 *  'desk' (the AI desk's side of a call it answered). */
export type CallScriptLine = [string, string];

export type Call = {
  /** `AiPhoneCall.id`. This is what `createLeadFromCall` is called with. */
  id: string;
  from: string;
  to: string;
  /** 'INBOUND' | 'OUTBOUND' — kept as `string`, the page compares it to the
   *  active filter key, which is a plain string. */
  dir: string;
  /** 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' — lower-cased for display. */
  status: string;
  /** Duration in seconds; null while a call is still in progress. */
  dur: number | null;
  /** `AiPhoneCall.recordingUrl` — the audio the sheet's player streams, or
   *  null when Twilio has not posted a recording yet. */
  rec: string | null;
  /** `AiPhoneCall.leadId` — a real Lead cuid once the call has been converted,
   *  null otherwise. Non-null is what flips the sheet from "Create lead" to a
   *  link at /dashboard/leads/<id>. */
  lead: string | null;
  /** Relative label ("25m ago"), computed server-side from `startedAt`. */
  when: string;
  summary: string | null;
  /** `transcript` split into speaker-labelled lines when the text carries
   *  "Caller:" / "Agent:" prefixes; empty otherwise. */
  script: CallScriptLine[];
  /** The raw transcript, rendered as one block when `script` is empty. */
  transcript: string | null;
  /** What the AI desk did on this call (2026-10-13) — null when the desk did
   *  not take it (forwarded, voicemail before the live desk, outbound). */
  desk: CallDesk | null;
  /** The person on the other end (2026-11-11), from the lead the call is on — so the log reads "Mark Ellison",
   *  not "+15095550173". Absent or null: the number is all we know. */
  name?: string | null;
};

/** How the live desk handled a call: read from `SyncState callout:<sid>`
 *  (lib/aiDesk/liveCall CallOutcome), put in words by lib/aiDesk/shared. */
export type CallDesk = {
  word: DeskOutcomeWord;
  /** "booked a visit", "took a message", "handed to you", "answered". */
  label: string;
  /** Seconds the desk was on the line — the minutes the company is charged. */
  seconds: number;
  /** The visit it booked, with the calendar link's two halves. */
  appointment: { id: string; when: string; date: string } | null;
  /** Why it could not take the call, when it could not (OpenAI's words, or the session never opening). */
  error: string | null;
};

/** Stat-strip figures, counted server-side over the whole table rather than
 *  over the 100 rows the log shows. */
export type PhoneStats = {
  today: number;
  week: number;
  leads: number;
  /** The AI desk's minutes this month (calls + browser tests). */
  deskMinutes: number;
};

/** The line under the page title: the number, who answers it, the voice,
 *  the month's minutes (lib/aiDesk/strip). */
export type PhoneDeskStrip = {
  number: string | null;
  go: CallsGo;
  mode: DeskMode;
  companyPhone: string | null;
  voice: DeskVoice;
  minutes: number;
  calls: number;
  tests: number;
  /** The number takes calls (wired the day it was bought; texting waits for approval). */
  on: boolean;
  /** "427 min left" · "12 min left — running low" · "Out of minutes" (lib/aiDesk/minutes). */
  left: string;
  out: boolean;
  low: boolean;
  /** The live desk is wired (VOICE_SERVER_URL + secret) — else callers get the recording. */
  live: boolean;
  /** The owner paused the desk (2026-11-11): calls ring the company phone, or take a message. */
  paused?: boolean;
  /** The company phone forwards every call to the desk, so a paused desk can't send calls back to it. */
  forwardsAll?: boolean;
};

/** The strip's sentence. */
export function deskStripWords(d: PhoneDeskStrip): string {
  if (!d.number) return "No number yet — the desk answers once your company has one.";
  if (!d.on) return `${d.number} — not taking calls yet.`;
  if (d.paused) return `${d.number} — the desk is paused: calls ${d.companyPhone && !d.forwardsAll ? `ring ${d.companyPhone}` : "take a message"} until you turn it back on in AI desk setup.`;
  const live = d.live ? "" : " (the live desk is not connected yet — callers are asked to leave a message)";
  if (d.out && (d.go === "assistant" || d.go === "phone")) return `${d.number} — out of minutes: calls ${d.companyPhone ? `ring ${d.companyPhone}` : "take a message"} until you add minutes.`;
  if (d.go === "assistant") return `${d.number} — the desk answers every call${live}, in the ${d.voice} voice.`;
  if (d.go === "phone") return `${d.number} rings ${d.companyPhone ?? "your company phone"} first; the desk takes what nobody picks up${live}.`;
  return `${d.number} — add your company phone in Company settings, or let the desk answer.`;
}

/** Donor: `const SHOP_NUMBER = '(425) 555-0100';` */
export const SHOP_NUMBER: string = '(425) 555-0100';

/** Donor: `let callsData = [ … ]`, re-typed onto the shape above. Fixture
 *  rows carry no `recordingUrl`, so `rec` is null throughout. */
export const CALLS_SEED: Call[] = [
  { id: 'c1', from: '(425) 555-0142', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 214, rec: null, lead: null, when: '25m ago', transcript: null, desk: null,
    summary: 'Homeowner in Bothell wants a full reroof quote — two layers of shingles, wants it before October.',
    script: [
      ['caller', 'Hi, I saw your truck on Maple Ave. I need a quote for a new roof.'],
      ['agent', 'Happy to help. Is this for a single-family home, and do you know roughly the age of the roof?'],
      ['caller', "It's a rambler, roof is about twenty-two years old. There's two layers up there I think."],
      ['agent', "Got it — tear-off of two layers. What's the address, and when would you like us out?"],
      ['caller', '4812 Maple Ave in Bothell. Any time this week works, I work from home.'],
      ['agent', "Perfect. I'll have someone out Thursday morning with a written estimate."]
    ] },
  { id: 'c2', from: '(425) 555-0177', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 96, rec: null, lead: null, when: '2h ago', transcript: null, desk: null,
    summary: 'Deck rebuild in Bellevue — existing frame is solid, wants composite decking and railings.',
    script: [
      ['caller', 'Calling about a deck. The frame is fine but the boards are shot.'],
      ['agent', 'Composite or wood? And roughly how many square feet?'],
      ['caller', 'Composite. About three hundred and twenty feet, plus railings and stairs.'],
      ['agent', "I'll get an estimate over to you today."]
    ] },
  { id: 'c3', from: '(425) 555-0119', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 47, rec: null, lead: null, when: '4h ago', transcript: null, desk: null,
    summary: 'Wrong number — caller was looking for a plumbing outfit.',
    script: [['caller', 'Is this Delgado Plumbing?'], ['agent', "No, this is Bell Roofing & Fence. I think you've got the wrong number."]] },
  { id: 'c4', from: SHOP_NUMBER, to: '(425) 555-0148', dir: 'OUTBOUND', status: 'COMPLETED', dur: 133, rec: null, lead: null, when: '5h ago', transcript: null, desk: null,
    summary: 'Called D. Reyes to confirm the cedar fence start date and material drop.',
    script: [
      ['agent', 'Hi Diego, just confirming we start the fence Friday and the cedar drops Thursday afternoon.'],
      ['caller', "That works. Gate on the north side, right?"],
      ['agent', "That's right, single walk gate on the north run."]
    ] },
  { id: 'c5', from: '(425) 555-0201', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 168, rec: null, lead: null, when: '1d ago', transcript: null, desk: null,
    summary: 'Fence gate sags and drags — also wants 40 ft of adjoining fence repaired.',
    script: [
      ['caller', 'My gate is dragging on the ground and a few pickets are rotted.'],
      ['agent', 'Sounds like the post has shifted. We can reset the post and swap the bad pickets.'],
      ['caller', 'How soon could you look at it?'],
      ['agent', "We're out that way Tuesday — I'll put you on the list."]
    ] },
  { id: 'c6', from: '(425) 555-0166', to: SHOP_NUMBER, dir: 'INBOUND', status: 'IN_PROGRESS', dur: null, rec: null, lead: null, when: '1d ago', transcript: null, desk: null,
    summary: null, script: [] },
  { id: 'c7', from: '(425) 555-0114', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 71, rec: null, lead: null, when: '2d ago', transcript: null, desk: null,
    summary: 'Gutter replacement in Redmond, full perimeter, wants guards included.',
    script: [
      ['caller', 'I need gutters replaced all the way around, and I want the leaf guards.'],
      ['agent', "Single story? I'll price the guards separately so you can see both options."]
    ] },
  { id: 'c8', from: '(425) 555-0158', to: SHOP_NUMBER, dir: 'INBOUND', status: 'FAILED', dur: 6, rec: null, lead: null, when: '2d ago', transcript: null, desk: null,
    summary: null, script: [] },
  { id: 'c9', from: SHOP_NUMBER, to: '(425) 555-0132', dir: 'OUTBOUND', status: 'COMPLETED', dur: 89, rec: null, lead: null, when: '3d ago', transcript: null, desk: null,
    summary: 'Follow-up on proposal #2851 — homeowner is comparing two bids, decides this week.',
    script: [
      ['agent', 'Checking in on the reroof estimate we sent Monday.'],
      ['caller', "Still looking at it — I've got one more bid coming Thursday."],
      ['agent', "Understood. Call me with any questions on the scope."]
    ] },
  { id: 'c10', from: '(425) 555-0195', to: SHOP_NUMBER, dir: 'INBOUND', status: 'COMPLETED', dur: 38, rec: null, lead: null, when: '4d ago', transcript: null, desk: null,
    summary: 'Vendor calling about a delivery window for shingles.',
    script: [['caller', 'Delivery is scheduled for Thursday between eight and noon.'], ['agent', 'Works for us, thanks.']] }
];
