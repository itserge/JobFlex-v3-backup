// THE CLIENT DESIGNS THE DECK (2026-10-11). Owner: "send the client a link
// where the client can design and send it back … the client doesn't see a
// price; the client can start from blank or from the contractor's design to
// correct and finalize; make it smart and easy for the client." — pure.
//
// A link is one SyncState row `deckclient:<token>` (no table of its own, like
// the studio's drafts): the contractor's design when the link was made
// (`base`), what the client has done so far (`work`, saved as they go), their
// note, and where it came back to. The shop's list of its links is one more
// row, `deckclients:<orgId>`, newest first.
//
// What the client may change is a short list: the kind, the shape and size,
// the height, the stairs, the railing's style, the boards, a lower level, the
// roof's look — and their own house (2026-10-12: they measure its back wall
// outside, its steps and corners, its storeys and colours; lib/deck/
// wallMeasure). The engineering stays the contractor's — the lumber and
// member sizes, the footings, the ledger, the site, the wiring, the rail's
// height — and is put back from `base` whatever the browser sends
// (mergeClientDesign). The frame is then settled to the tables, so what lands
// in the studio is a deck the tables carry. The client's page never prices.

import type { BoxRow, EmailDoc } from "../email/doc";
import { deckingProduct, railColorOf, railType } from "./catalog";
import { deckingColor } from "./deckingColors";
import { applyDeckPatch } from "./checks";
import { defaultDeckDesign, normalizeDeckDesign, ROOF_KIND_LABEL, structureWords, type DeckDesign, type ElectricalDesign, type FixtureKind, type RoofDesign } from "./design";
import { deckShapeForHouse } from "./house";
import { settleDesign } from "./settle";

export const CLIENT_LINK_PREFIX = "deckclient:";
export const CLIENT_INDEX_PREFIX = "deckclients:";
/** A shop keeps this many links; the oldest goes when a new one is made. */
export const CLIENT_LINK_MAX = 60;
/** A link stays open this long after it is made. */
export const CLIENT_LINK_DAYS = 90;
export const clientLinkKey = (token: string) => `${CLIENT_LINK_PREFIX}${token}`;
export const clientIndexKey = (organizationId: string) => `${CLIENT_INDEX_PREFIX}${organizationId}`;
export const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** The studio's draft row (actions/deckEstimator) — the returned design lands in one, so it opens like any draft. */
export const deckDraftKey = (organizationId: string, id: string) => `deckdraft:${organizationId}:${id}`;
export const DECK_DRAFT_MAX = 60;
/** The activity kind the bell shows when a design comes back (actions/notifications reads its meta.href). */
export const DECK_DESIGN_RETURNED = "DECK_DESIGN_RETURNED";
/** The longest note a client can write. */
export const CLIENT_NOTE_MAX = 1500;

export type ClientStart = "mine" | "blank";

/** What the client said they are not sure of — the contractor measures it. */
export type ClientUnsure = "height";

export interface ClientDesignLink {
  v: 1;
  token: string;
  orgId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  clientId: string | null;
  address: string | null;
  /** The contractor's name for it ("Smith deck"). */
  title: string;
  /** True when nobody typed the title — it is the words of the design on the studio's screen when the link was
   *  made, and what comes back is titled by the client's own design instead (2026-10-17). Absent on older links. */
  titleAuto?: boolean;
  start: ClientStart;
  /** The contractor's design when the link was made — or a blank one with the contractor's site, house and lumber. */
  base: DeckDesign;
  /** The client's work so far (null until their first change). */
  work: DeckDesign | null;
  workAt: string | null;
  /** The client's first visit. */
  openedAt: string | null;
  note: string;
  unsure: ClientUnsure[];
  status: "open" | "sent";
  sentAt: string | null;
  sends: number;
  /** The studio draft it came back into — the same one on a second send. */
  draftId: string | null;
  /** The proposal this design belongs to (2026-10-13): made from the studio while it was on one, or tied
   *  when the returned design was priced. The proposal's row and its builder show the link's standing. */
  proposalId: string | null;
  /** The member who made the link, by name — the "designer" the folder names. */
  byName: string | null;
  /** When the contractor last opened what came back; null = not yet. Older than sentAt = a new return. */
  seenAt: string | null;
  /** When what came back was priced onto a proposal (a convert or an update with this link); null = not yet. */
  pricedAt: string | null;
  /** A link the shop's WEBSITE made for a visitor (2026-10-28, lib/webEstimator): nobody knows them yet; the send
   *  makes the lead (`leadId`), and only then does the link join the shop's list. `priced` = the visitor saw a price. */
  web?: { slug: string; leadId: string | null; priced: boolean } | null;
}

/** The row the contractor's list shows. */
export interface ClientLinkRow {
  token: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  title: string;
  start: ClientStart;
  createdAt: string;
  openedAt: string | null;
  workAt: string | null;
  status: "open" | "sent";
  sentAt: string | null;
  draftId: string | null;
  note: string;
  expired: boolean;
  proposalId: string | null;
  byName: string | null;
  seenAt: string | null;
  /** Sent back and not opened since: the one that blooms. */
  unseen: boolean;
  /** What the client designed, in words ("16 × 12 ft deck"), once they have worked on it. */
  words: string | null;
  address: string | null;
  pricedAt: string | null;
  /** The proposal it belongs to, as the list says it (filled by lib/deck/clientLinksServer withProposals). */
  proposal: { ref: string; title: string; status: string; address: string | null } | null;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => str(v, max) || null;
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** A stored link, read back; null when it is not one. */
export function parseClientLink(cursor: string): ClientDesignLink | null {
  try {
    const raw = JSON.parse(cursor) as Record<string, unknown>;
    if (!raw || raw.v !== 1 || typeof raw.token !== "string" || typeof raw.orgId !== "string") return null;
    const base = normalizeDeckDesign(raw.base);
    return {
      v: 1,
      token: raw.token,
      orgId: raw.orgId,
      createdBy: strOrNull(raw.createdBy, 64),
      createdAt: iso(raw.createdAt) ?? new Date(0).toISOString(),
      expiresAt: iso(raw.expiresAt) ?? new Date(0).toISOString(),
      clientName: str(raw.clientName, 80) || "Your client",
      clientPhone: strOrNull(raw.clientPhone, 40),
      clientEmail: strOrNull(raw.clientEmail, 200),
      clientId: strOrNull(raw.clientId, 64),
      address: strOrNull(raw.address, 300),
      title: str(raw.title, 120) || structureWords(base),
      ...(typeof raw.titleAuto === "boolean" ? { titleAuto: raw.titleAuto } : {}),
      start: raw.start === "blank" ? "blank" : "mine",
      base,
      work: raw.work ? normalizeDeckDesign(raw.work) : null,
      workAt: iso(raw.workAt),
      openedAt: iso(raw.openedAt),
      note: str(raw.note, CLIENT_NOTE_MAX),
      unsure: Array.isArray(raw.unsure) ? (raw.unsure.filter((u) => u === "height") as ClientUnsure[]) : [],
      status: raw.status === "sent" ? "sent" : "open",
      sentAt: iso(raw.sentAt),
      sends: typeof raw.sends === "number" && raw.sends >= 0 ? Math.floor(raw.sends) : 0,
      draftId: typeof raw.draftId === "string" && /^[a-f0-9-]{8,40}$/i.test(raw.draftId) ? raw.draftId : null,
      proposalId: typeof raw.proposalId === "string" && /^[\w-]{1,64}$/.test(raw.proposalId) ? raw.proposalId : null,
      byName: strOrNull(raw.byName, 120),
      seenAt: iso(raw.seenAt),
      pricedAt: iso(raw.pricedAt),
      ...(raw.web && typeof raw.web === "object" && typeof (raw.web as { slug?: unknown }).slug === "string"
        ? { web: { slug: str((raw.web as Record<string, unknown>).slug, 64), leadId: strOrNull((raw.web as Record<string, unknown>).leadId, 64), priced: (raw.web as Record<string, unknown>).priced === true } }
        : {}),
    };
  } catch {
    return null;
  }
}

export function clientLinkRow(l: ClientDesignLink, now: number): ClientLinkRow {
  return {
    token: l.token,
    clientName: l.clientName,
    clientPhone: l.clientPhone,
    clientEmail: l.clientEmail,
    title: linkTitle(l),
    start: l.start,
    createdAt: l.createdAt,
    openedAt: l.openedAt,
    workAt: l.workAt,
    status: l.status,
    sentAt: l.sentAt,
    draftId: l.draftId,
    note: l.note,
    expired: Date.parse(l.expiresAt) < now,
    proposalId: l.proposalId,
    byName: l.byName,
    seenAt: l.seenAt,
    unseen: isUnseenReturn(l),
    words: l.work ? structureWords(l.work) : null,
    address: l.address,
    pricedAt: l.pricedAt,
    proposal: null,
  };
}

/* ── THE STAGES (owner, 2026-10-13: "a more understandable flow between the contractor and the client") ─────
   One line of stages both sides read the same way. The client's page shows the same line from their side. */
export type ClientStage = "link" | "opened" | "designing" | "returned" | "seen" | "priced" | "proposal" | "accepted";
export const CLIENT_STAGES: readonly ClientStage[] = ["link", "opened", "designing", "returned", "seen", "priced", "proposal", "accepted"];
export const STAGE_WORDS: Readonly<Record<ClientStage, string>> = {
  link: "Link sent",
  opened: "Opened",
  designing: "Designing",
  returned: "Sent back",
  seen: "You opened it",
  priced: "Priced",
  proposal: "Proposal sent",
  accepted: "Accepted",
};
const DECIDED = new Set(["SENT", "VIEWED", "ACCEPTED", "DECLINED", "COMPLETED", "PAID"]);
/** Where a link stands, as the furthest stage it has reached, and when it got there. */
export function clientStage(l: Pick<ClientLinkRow, "openedAt" | "workAt" | "status" | "sentAt" | "seenAt" | "pricedAt" | "proposal" | "createdAt">): { stage: ClientStage; at: string | null } {
  const p = l.proposal;
  if (l.pricedAt && p && (p.status === "ACCEPTED" || p.status === "COMPLETED" || p.status === "PAID")) return { stage: "accepted", at: null };
  if (l.pricedAt && p && DECIDED.has(p.status)) return { stage: "proposal", at: null };
  if (l.pricedAt) return { stage: "priced", at: l.pricedAt };
  if (l.status === "sent" && l.sentAt) return isUnseenReturn(l) ? { stage: "returned", at: l.sentAt } : { stage: "seen", at: l.seenAt };
  if (l.workAt) return { stage: "designing", at: l.workAt };
  if (l.openedAt) return { stage: "opened", at: l.openedAt };
  return { stage: "link", at: l.createdAt };
}
/** "for Smith backyard deck (PRO-4C1B) · 123 Main St" — the job a link is about, the client's name aside. */
export function jobLine(l: Pick<ClientLinkRow, "title" | "address" | "proposal">): string {
  const p = l.proposal;
  const name = p ? `${p.title} (${p.ref})` : l.title;
  const where = p?.address ?? l.address;
  return where ? `${name} · ${where}` : name;
}

/** Sent back, and the contractor has not opened it since. */
export function isUnseenReturn(l: Pick<ClientDesignLink, "status" | "sentAt" | "seenAt">): boolean {
  if (l.status !== "sent" || !l.sentAt) return false;
  return !l.seenAt || Date.parse(l.seenAt) < Date.parse(l.sentAt);
}

/** Where a client's link stands, in the words every surface uses (the studio folder, the proposal row, the builder). */
export type ClientStanding = "closed" | "returned" | "designing" | "opened" | "waiting";
export function clientStanding(l: Pick<ClientLinkRow, "expired" | "status" | "workAt" | "openedAt">): ClientStanding {
  if (l.status === "sent") return "returned";
  if (l.expired) return "closed";
  if (l.workAt) return "designing";
  if (l.openedAt) return "opened";
  return "waiting";
}
export const STANDING_WORDS: Readonly<Record<ClientStanding, string>> = {
  closed: "Link closed",
  returned: "Sent back",
  designing: "Designing",
  opened: "Opened the link",
  waiting: "Not opened yet",
};
/** "Jane sent back a design · 2 h ago" / "Jane is designing" / "Design link sent to Jane · not opened yet". */
export function standingLine(l: Pick<ClientLinkRow, "clientName" | "expired" | "status" | "workAt" | "openedAt">, ago: (iso: string) => string, at: { sentAt: string | null; workAt: string | null; openedAt: string | null; createdAt: string }): string {
  const first = l.clientName.trim().split(/\s+/)[0] || "The client";
  switch (clientStanding(l)) {
    case "returned":
      return `${first} sent back a design${at.sentAt ? ` · ${ago(at.sentAt)}` : ""}`;
    case "designing":
      return `${first} is designing${at.workAt ? ` · ${ago(at.workAt)}` : ""}`;
    case "opened":
      return `${first} opened the design link${at.openedAt ? ` · ${ago(at.openedAt)}` : ""}`;
    case "closed":
      return `${first}'s design link closed`;
    default:
      return `Design link sent to ${first} · not opened yet`;
  }
}

/** The contractor's design as the client gets it: no photo of the house (it is the shop's private file). */
export function clientCopyOf(design: DeckDesign): DeckDesign {
  return design.photo ? { ...design, photo: null } : design;
}

/** Where the photos a client sends through their link are kept: the shop's private folder, under the link's own. */
export const clientPhotoFolder = (orgId: string, token: string) => `deck-photos/${orgId}/client/${token}/`;

/** A design as the client's page shows it (2026-10-23): the house a photo built stays, the shop's own picture never
 *  reaches the page — only a photo the client sent themselves (`ownPhoto`, a test on its stored URL). */
export function forTheClient(design: DeckDesign, ownPhoto: (url: string) => boolean): DeckDesign {
  const keepHouse = !design.house.photo || ownPhoto(design.house.photo.url);
  if (!design.photo && keepHouse) return design;
  return { ...design, photo: null, house: keepHouse ? design.house : { ...design.house, photo: null } };
}

/** A blank start: the stock deck, on the contractor's site, house and lumber. */
export function blankFor(base: DeckDesign): DeckDesign {
  // The house the contractor drew stays: a blank deck, not a blank house.
  return mergeClientDesign(base, { ...defaultDeckDesign({ state: base.site.state, frostIn: base.frostIn }), house: base.house }, { settle: false });
}

/** The roof's numbers that are the contractor's to choose: its load, members and how it is framed. */
const ROOF_ENGINEERING = ["load", "post", "rafter", "rafterSpacingIn", "header", "ridge", "roofDeck"] as const satisfies ReadonlyArray<keyof RoofDesign>;

/**
 * THE CLIENT'S LIGHTS (2026-10-22): since the client can talk to the design ("add a chandelier", "two patio heaters",
 * "lights on the steps") and see them lit, what they light comes back with the design — it used to be thrown away
 * here. The wiring stays the contractor's: the feed, the panel side and the timer, and on a fixture the contractor
 * had already put in, who supplies it, the 240-volt heater and the shop's own product. One the client adds is as
 * they set it, minus a product name (the shop's to choose).
 */
function mergeFixtures(base: ElectricalDesign, c: ElectricalDesign): ElectricalDesign {
  const had = new Map(base.fixtures.map((f) => [f.id, f]));
  const fixtures = c.fixtures.map((f) => {
    const was = had.get(f.id);
    return was && was.kind === f.kind ? { ...f, supply: was.supply, volts240: was.volts240, custom: was.custom } : { ...f, custom: null };
  });
  return { ...base, fixtures };
}

/** The lights, fans and heaters on a design, counted: ["a chandelier", "2 patio heaters", "an LED strip"]. */
export function litWords(d: DeckDesign): string[] {
  const n = new Map<FixtureKind, number>();
  for (const f of d.electrical.fixtures) n.set(f.kind, (n.get(f.kind) ?? 0) + f.qty);
  return [...n].map(([k, q]) => (q === 1 || k === "string-light" ? FIXTURE_SAID[k][0] : `${q} ${FIXTURE_SAID[k][1]}`));
}

/** A fixture as the contractor and the client read it. */
const FIXTURE_SAID: Record<FixtureKind, [string, string]> = {
  "led-strip": ["an LED strip", "LED strips"],
  "post-cap": ["a lit post cap", "lit post caps"],
  "step-light": ["a step light", "step lights"],
  "string-light": ["string lights", "string lights"],
  sconce: ["a sconce", "sconces"],
  "ceiling-light": ["a ceiling light", "ceiling lights"],
  chandelier: ["a chandelier", "chandeliers"],
  fan: ["a ceiling fan", "ceiling fans"],
  outlet: ["an outlet", "outlets"],
  heater: ["a patio heater", "patio heaters"],
  flood: ["a flood light", "flood lights"],
};

/**
 * The client's design laid over the contractor's: the client's kind, shape,
 * height, stairs, rail style, boards, lower level, roof look and lights;
 * everything else from `base`. Settled to the tables unless `settle: false`.
 */
export function mergeClientDesign(base: DeckDesign, raw: unknown, opts: { settle?: boolean; photoOk?: (url: string) => boolean } = {}): DeckDesign {
  const c = normalizeDeckDesign(raw, { state: base.site.state, frostIn: base.frostIn });
  const sameKind = c.structure === base.structure;
  const roof: RoofDesign = { ...c.roof };
  if (sameKind) for (const k of ROOF_ENGINEERING) (roof as unknown as Record<string, unknown>)[k] = base.roof[k];
  let merged: DeckDesign = normalizeDeckDesign({
    ...c,
    wall: base.wall,
    loadPsf: base.loadPsf,
    soilPsf: base.soilPsf,
    frostIn: base.frostIn,
    framing: base.framing,
    ledger: base.ledger,
    footing: base.footing,
    extras: base.extras,
    site: base.site,
    // The house is the client's: they stand in front of it with a tape — or (2026-10-23) photograph it. The photo it
    // was built from only when it came through their link (`photoOk`); else the contractor's, as it was.
    house: { ...c.house, photo: c.house.photo && opts.photoOk?.(c.house.photo.url) ? c.house.photo : (base.house.photo ?? null) },
    photo: base.photo,
    electrical: mergeFixtures(base.electrical, c.electrical),
    rail: { ...c.rail, heightIn: base.rail.heightIn, postSpacingFt: base.rail.postSpacingFt, customPerFt: base.rail.customPerFt, mount: base.rail.mount, mountBy: base.rail.mountBy, type: c.rail.type === "custom" && base.rail.type !== "custom" ? base.rail.type : c.rail.type },
    // The colour is the client's to pick from the line's own list; a colour typed in is the contractor's.
    decking: { ...c.decking, fastening: base.decking.fastening, fascia: base.decking.fascia, wastePct: base.decking.wastePct, ownColor: base.decking.ownColor },
    roof,
  });
  // The deck and the house agree: a step in the wall under the deck notches it.
  const fit = deckShapeForHouse(merged.shape, merged.house);
  if (JSON.stringify(fit.shape) !== JSON.stringify(merged.shape)) merged = applyDeckPatch(merged, { shape: fit.shape });
  return opts.settle === false ? merged : settleDesign(merged).design;
}

/** "Jane Smith's deck design" — the draft's name in the studio. */
/** The job's name as every surface says it (2026-10-17): a title somebody typed stays; the automatic one — the
 *  words of the design the link started from — follows the client's own design once they have changed it. Older
 *  links (no `titleAuto`) count as automatic when the title is still the starting design's words. */
export function linkTitle(l: Pick<ClientDesignLink, "title" | "titleAuto" | "base" | "work">): string {
  const auto = l.titleAuto ?? l.title === structureWords(l.base).slice(0, 120);
  return auto && l.work ? structureWords(l.work).slice(0, 120) : l.title;
}

export function returnedTitle(link: Pick<ClientDesignLink, "clientName" | "title">): string {
  const who = link.clientName.trim();
  const own = who && who !== "Your client" ? `${who}${/s$/i.test(who) ? "'" : "'s"} design` : "The client's design";
  return `${own} — ${link.title}`.slice(0, 120);
}

/** The text a contractor sends with the link. */
export function clientLinkMessage(i: { org: string; clientName: string; link: string; start: ClientStart }): string {
  const first = i.clientName.trim().split(/\s+/)[0] || "there";
  const what = i.start === "mine" ? "Here is the deck we talked about — change anything you like" : "Design your deck here — pick a style, the size, stairs, railing and boards";
  // "Ridgeline Roofing Co." ends its own sentence — no second full stop.
  const who = (i.org.trim() || "your contractor").replace(/\.+$/, "");
  return `Hi ${first}, it's ${who}. ${what}, and press Send when it looks right: ${i.link}`;
}

/** What changed from the contractor's design, in a client's words, for the contractor's notice. */
export function changesFrom(base: DeckDesign, next: DeckDesign): string[] {
  const out: string[] = [];
  if (base.structure !== next.structure) out.push(`now a ${structureWords(next).toLowerCase()}`);
  if (base.shape.widthFt !== next.shape.widthFt || base.shape.depthFt !== next.shape.depthFt || base.shape.kind !== next.shape.kind) out.push(`size ${next.shape.widthFt} × ${next.shape.depthFt} ft${next.shape.kind === "L" ? " L-shaped" : ""}`);
  if (Math.abs(base.heightIn - next.heightIn) >= 1) out.push(`height ${Math.round(next.heightIn)} in.`);
  if (base.stairs.length !== next.stairs.length) out.push(`${next.stairs.length} ${next.stairs.length === 1 ? "stair" : "stairs"}`);
  if (base.rail.type !== next.rail.type) out.push(next.rail.type === "none" ? "no railing" : `${railType(next.rail.type).label.toLowerCase()} railing`);
  if (base.decking.product !== next.decking.product) out.push(`boards: ${deckingProduct(next.decking.product).label}`);
  const boardColour = deckingColor(next.decking.product, next.decking.color);
  if (boardColour && (base.decking.color !== next.decking.color || base.decking.product !== next.decking.product)) out.push(`board colour: ${boardColour.name}`);
  if (next.rail.type !== "none" && base.rail.color !== next.rail.color && base.rail.type === next.rail.type) out.push(`rail colour: ${railColorOf(next.rail.type, next.rail.color)?.name.toLowerCase() ?? "the usual"}`);
  if (base.lower.on !== next.lower.on) out.push(next.lower.on ? "a lower level" : "no lower level");
  if (base.roof.kind !== next.roof.kind && next.structure !== "deck") out.push(`${ROOF_KIND_LABEL[next.roof.kind].split(" — ")[0].toLowerCase()} roof`);
  const wall = (d: DeckDesign) => JSON.stringify([d.house.leftFt, d.house.rightFt, d.house.jogs.map((j) => [j.atFt, j.dir, j.depthFt])]);
  if (wall(base) !== wall(next)) {
    const total = next.house.leftFt + next.shape.widthFt + next.house.rightFt;
    out.push(`house wall measured: ${total} ft${next.house.jogs.length ? `, ${next.house.jogs.length} ${next.house.jogs.length === 1 ? "step" : "steps"}` : ", straight"}`);
  }
  if (base.house.storeys !== next.house.storeys) out.push(next.house.storeys === 2 ? "two-storey house" : "one-storey house");
  // "lights: a chandelier, 2 patio heaters" — what is lit now, when the client changed it.
  if (litWords(base).join() !== litWords(next).join()) out.push(next.electrical.fixtures.length ? `lights: ${litWords(next).join(", ")}` : "no lights");
  return out;
}

/** The email to the member who made the link when the design comes back. */
export function returnedEmailDoc(i: {
  org: { id?: string | null; name: string; logoUrl: string | null; phone: string | null };
  name: string;
  phone: string | null;
  note: string;
  unsure: ClientUnsure[];
  words: string;
  changes: string[];
  /** The studio draft, absolute. */
  href: string;
  again: boolean;
}): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Client", value: i.name },
    ...(i.phone ? [{ type: "field" as const, label: "Phone", value: i.phone }] : []),
    { type: "field", label: "Design", value: i.words },
    ...(i.changes.length ? [{ type: "field" as const, label: "Changed", value: i.changes.join(", ") }] : []),
    // A condition row is always the last (lib/email/doc).
    ...(i.unsure.includes("height") ? [{ type: "cond" as const, label: "Height", chip: "Measure on site", tone: "warn" as const }] : []),
  ];
  return {
    subject: `${i.name} ${i.again ? "sent their deck design again" : "sent back their deck design"}`,
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl, orgId: i.org.id ?? null },
    kicker: { text: "Deck design", tone: "ok" },
    headline: `${i.name} ${i.again ? "changed their deck design" : "designed their deck"}`,
    prose: i.note ? [`“${i.note}”`] : undefined,
    box,
    cta: { label: "Open it in the Deck Studio", href: i.href },
    after: ["It is saved in your drafts, framed to the code tables. Price it, then convert it to a proposal."],
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}
