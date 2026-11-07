// THE CLIENT'S LINK TO THEIR ROOM (Home Design Studio, 2026-10-19 — the next step after the estimate: "design it for
// the clients", the homeowner sees the room in 3D, picks between the contractor's options and approves). Pure.
//
// A link is one SyncState row `designclient:<token>` (no table of its own, like the deck's client links): a snapshot
// of the design (the room, its walls and everything placed — not the plan's drawn lines), the options the contractor
// offers — for each finish a few choices, the first the design's own — and what the estimate needs to price any mix of
// them (the job's market, the shop's own line prices, its products, the estimate's choices), so the client's page shows
// the price of each choice with the same engine the studio prices with. What the client picks is kept as they go, and
// approving sends it back: the contractor's bell, an email, and "Apply their choices" in the studio. The shop's list of
// its links is one more row, `designclients:<orgId>`, newest first.
import type { DesignDoc, Finishes, RoomKind } from "./model";
import { estimateTotal, priceDesign, takeoff, type EstimateOptions } from "./estimate";
import type { BoxRow, EmailDoc } from "../email/doc";
import type { DesignProduct } from "./inventory";
import { CABINET_COLORS, COUNTERS, FLOORS, HARDWARE_HEX, PAINTS, SPLASHES, counterPreset, floorPreset, splashPreset } from "./library";
import { kindOfLabel, roomFinishes } from "./roomKinds";

export const LINK_PREFIX = "designclient:";
export const INDEX_PREFIX = "designclients:";
export const linkKey = (token: string) => `${LINK_PREFIX}${token}`;
export const indexKey = (orgId: string) => `${INDEX_PREFIX}${orgId}`;
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** A shop keeps this many links; the oldest goes when a new one is made. */
export const LINK_MAX = 60;
/** A link stays open this long. */
export const LINK_DAYS = 90;
export const NOTE_MAX = 1500;
/** The bell's kind when a client approves (actions/notifications opens meta.href). */
export const DESIGN_CLIENT_APPROVED = "DESIGN_CLIENT_APPROVED";

/** The finishes a client can be offered a choice of. */
export type Slot = "cabinets" | "counter" | "backsplash" | "floor" | "wall" | "hardware";
export type Choice = { key: string; name: string; hex: string };
export type ClientOption = { slot: Slot; title: string; choices: Choice[] };
export type Picks = Partial<Record<Slot, string>>;

export type ClientPricing = { factor: number; place: string; opts: EstimateOptions; book: Record<string, number>; products: DesignProduct[] };

export type RoomClientLink = {
  v: 1;
  token: string;
  orgId: string;
  createdBy: string | null;
  byName: string | null;
  createdAt: string;
  expiresAt: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientId: string | null;
  designId: string | null;
  room: string;
  roomName: string;
  title: string;
  address: string | null;
  doc: DesignDoc;
  options: ClientOption[];
  showPrice: boolean;
  pricing: ClientPricing;
  picks: Picks;
  picksAt: string | null;
  openedAt: string | null;
  note: string;
  status: "open" | "approved";
  approvedAt: string | null;
  approvedName: string | null;
  approvedTotal: number | null;
  appliedAt: string | null;
};

/* ── What each room offers ─────────────────────────────────────────────────────────────────────────────────────── */

const SLOTS_BY_KIND: Record<RoomKind, Slot[]> = {
  kitchen: ["cabinets", "counter", "backsplash", "floor", "wall", "hardware"],
  bath: ["cabinets", "counter", "floor", "wall", "hardware"],
  laundry: ["cabinets", "floor", "wall"],
  pantry: ["floor", "wall"],
  bedroom: ["floor", "wall"],
  living: ["floor", "wall"],
  dining: ["floor", "wall"],
  office: ["floor", "wall"],
  closet: ["floor", "wall"],
  entry: ["floor", "wall"],
  garage: ["floor", "wall"],
  outdoor: ["floor"],
  other: ["floor", "wall"],
};

export const SLOT_TITLE: Record<Slot, string> = {
  cabinets: "Cabinets",
  counter: "Countertop",
  backsplash: "Backsplash",
  floor: "Floor",
  wall: "Wall paint",
  hardware: "Hardware",
};

/** The slots a room of this kind offers (a bath's cabinets are its vanity, its counter the vanity top). */
export function slotsFor(kind: RoomKind | undefined): Slot[] {
  return SLOTS_BY_KIND[kind ?? "other"] ?? SLOTS_BY_KIND.other;
}
export const slotTitle = (slot: Slot, kind: RoomKind | undefined) => (kind === "bath" && slot === "cabinets" ? "Vanity" : kind === "bath" && slot === "counter" ? "Vanity top" : SLOT_TITLE[slot]);

const HARDWARE_NAME: Record<Finishes["hardware"]["finish"], string> = { black: "Matte black", brass: "Brushed brass", nickel: "Brushed nickel", chrome: "Polished chrome" };

/** Every choice a slot can take (the library's presets, by a stable key). */
export function choicesOf(slot: Slot): Choice[] {
  switch (slot) {
    case "cabinets":
      return CABINET_COLORS.map((c) => ({ key: c.name, name: c.name, hex: c.hex }));
    case "counter":
      return COUNTERS.map((c) => ({ key: c.id, name: c.name, hex: c.hex }));
    case "backsplash":
      return SPLASHES.map((c) => ({ key: c.id, name: c.name, hex: c.hex || "#e8e6e1" }));
    case "floor":
      return FLOORS.map((c) => ({ key: c.id, name: c.name, hex: c.hex }));
    case "wall":
      return PAINTS.map((c) => ({ key: c.name, name: c.name, hex: c.hex }));
    case "hardware":
      return (Object.keys(HARDWARE_HEX) as Array<Finishes["hardware"]["finish"]>).map((k) => ({ key: k, name: HARDWARE_NAME[k], hex: HARDWARE_HEX[k] }));
  }
}

/** The choice a room's finishes have now, in a slot. */
export function currentChoice(f: Finishes, slot: Slot): Choice {
  switch (slot) {
    case "cabinets":
      return { key: f.cabinets.name, name: f.cabinets.name, hex: f.cabinets.color };
    case "counter": {
      const c = counterPreset(f.counter.id);
      return { key: c.id, name: c.name, hex: c.hex };
    }
    case "backsplash": {
      const s = splashPreset(f.backsplash.id);
      return { key: s.id, name: s.name, hex: s.hex || "#e8e6e1" };
    }
    case "floor": {
      const p = floorPreset(f.floor.id);
      return { key: p.id, name: p.name, hex: p.hex };
    }
    case "wall":
      return { key: f.wall.name, name: f.wall.name, hex: f.wall.color };
    case "hardware":
      return { key: f.hardware.finish, name: HARDWARE_NAME[f.hardware.finish], hex: HARDWARE_HEX[f.hardware.finish] };
  }
}

/** A room's finishes with one slot set to a choice (everything else about the finish — sheen, pattern, edge — kept). */
export function withChoice(f: Finishes, slot: Slot, key: string): Finishes {
  const c = choicesOf(slot).find((x) => x.key === key);
  if (!c) return f;
  switch (slot) {
    case "cabinets":
      return { ...f, cabinets: { ...f.cabinets, name: c.name, color: c.hex } };
    case "counter":
      return { ...f, counter: { ...f.counter, id: c.key } };
    case "backsplash":
      return { ...f, backsplash: { ...f.backsplash, id: c.key } };
    case "floor":
      return { ...f, floor: { ...f.floor, id: c.key } };
    case "wall":
      return { ...f, wall: { ...f.wall, name: c.name, color: c.hex, code: undefined } };
    case "hardware":
      return { ...f, hardware: { ...f.hardware, finish: c.key as Finishes["hardware"]["finish"] } };
  }
}

/** The design with the client's picks applied to the room (only choices the link offers count). */
export function applyPicks(doc: DesignDoc, room: string, options: readonly ClientOption[], picks: Picks): DesignDoc {
  let f = roomFinishes(doc, room);
  for (const o of options) {
    const key = picks[o.slot];
    if (key && o.choices.some((c) => c.key === key)) f = withChoice(f, o.slot, key);
  }
  return { ...doc, finishes: { ...(doc.finishes ?? {}), [room]: f } };
}

/** The client's picks laid on the studio's design ("Apply their choices"): any real choice of the room's slots. */
export function applyChosen(doc: DesignDoc, room: string, picks: Picks): DesignDoc {
  const slots = slotsFor(kindOfLabel(doc, room));
  let f = roomFinishes(doc, room);
  for (const slot of slots) {
    const key = picks[slot];
    if (key && choicesOf(slot).some((c) => c.key === key)) f = withChoice(f, slot, key);
  }
  return { ...doc, finishes: { ...(doc.finishes ?? {}), [room]: f } };
}

/** Only picks the link offers, keyed by its slots. */
export function cleanPicks(raw: unknown, options: readonly ClientOption[]): Picks {
  const out: Picks = {};
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const o of options) {
    const v = r[o.slot];
    if (typeof v === "string" && o.choices.some((c) => c.key === v)) out[o.slot] = v;
  }
  return out;
}

/**
 * The options a room offers by default: in each of its slots, the design's own choice first, then two the client might
 * like — where the price moves with the choice, one that costs less and one that costs more (the studio prices them
 * with `priceOf`); where it doesn't (a paint colour, a cabinet colour), the nearest looks in the library.
 */
export function suggestOptions(doc: DesignDoc, room: string, priceOf: (slot: Slot, key: string) => number): ClientOption[] {
  const kind = kindOfLabel(doc, room);
  const f = roomFinishes(doc, room);
  const out: ClientOption[] = [];
  for (const slot of slotsFor(kind)) {
    const cur = currentChoice(f, slot);
    const all = choicesOf(slot).filter((c) => c.key !== cur.key);
    if (!all.length) continue;
    const base = priceOf(slot, cur.key);
    const priced = all.map((c) => ({ c, d: priceOf(slot, c.key) - base }));
    const cheaper = priced.filter((x) => x.d < -1).sort((a, b) => b.d - a.d)[0];
    const dearer = priced.filter((x) => x.d > 1).sort((a, b) => a.d - b.d)[0];
    const picks: Choice[] = [];
    if (cheaper) picks.push(cheaper.c);
    if (dearer) picks.push(dearer.c);
    // Fill with the next looks along the library, wrapping round from the design's own.
    const ring = choicesOf(slot);
    const at = Math.max(0, ring.findIndex((c) => c.key === cur.key));
    for (let i = 1; picks.length < 2 && i < ring.length; i++) {
      const c = ring[(at + i) % ring.length];
      if (c.key !== cur.key && !picks.some((p) => p.key === c.key)) picks.push(c);
    }
    out.push({ slot, title: slotTitle(slot, kind), choices: [cur, ...picks.slice(0, 2)] });
  }
  return out;
}

/** Options as the browser sent them, kept only where every choice is a real one (the design's own first). */
export function cleanOptions(raw: unknown, doc: DesignDoc, room: string): ClientOption[] {
  const kind = kindOfLabel(doc, room);
  const allowed = new Set(slotsFor(kind));
  const f = roomFinishes(doc, room);
  const out: ClientOption[] = [];
  for (const o of Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []) {
    const slot = String(o?.slot) as Slot;
    if (!allowed.has(slot) || out.some((x) => x.slot === slot)) continue;
    const cur = currentChoice(f, slot);
    const keys = (Array.isArray(o.choices) ? (o.choices as Array<Record<string, unknown>>) : []).map((c) => String(c?.key ?? ""));
    const choices = [cur, ...choicesOf(slot).filter((c) => keys.includes(c.key) && c.key !== cur.key)].slice(0, 4);
    if (choices.length >= 2) out.push({ slot, title: slotTitle(slot, kind), choices });
  }
  return out;
}

/* ── The link's life ───────────────────────────────────────────────────────────────────────────────────────────── */

export function parseLink(cursor: string | null | undefined): RoomClientLink | null {
  if (!cursor) return null;
  try {
    const l = JSON.parse(cursor) as RoomClientLink;
    return l && l.v === 1 && typeof l.token === "string" && l.doc && Array.isArray(l.options) ? l : null;
  } catch {
    return null;
  }
}

export type LinkRow = Pick<RoomClientLink, "token" | "clientName" | "roomName" | "title" | "designId" | "room" | "createdAt" | "openedAt" | "picksAt" | "status" | "approvedAt" | "approvedName" | "approvedTotal" | "appliedAt" | "picks" | "note" | "showPrice"> & { expired: boolean; picked: string[] };

export function linkRow(l: RoomClientLink, now: number): LinkRow {
  const picked = l.options.filter((o) => l.picks[o.slot] && l.picks[o.slot] !== o.choices[0].key).map((o) => `${o.title}: ${o.choices.find((c) => c.key === l.picks[o.slot])?.name ?? ""}`);
  return {
    token: l.token,
    clientName: l.clientName,
    roomName: l.roomName,
    title: l.title,
    designId: l.designId,
    room: l.room,
    createdAt: l.createdAt,
    openedAt: l.openedAt,
    picksAt: l.picksAt,
    status: l.status,
    approvedAt: l.approvedAt,
    approvedName: l.approvedName,
    approvedTotal: l.approvedTotal,
    appliedAt: l.appliedAt,
    picks: l.picks,
    note: l.note,
    showPrice: l.showPrice,
    expired: Date.parse(l.expiresAt) < now,
    picked,
  };
}

/** Where the client is with it, in a few words. */
export function standing(r: Pick<LinkRow, "status" | "openedAt" | "picksAt" | "expired" | "approvedName">): string {
  if (r.status === "approved") return `Approved${r.approvedName ? ` by ${r.approvedName}` : ""}`;
  if (r.expired) return "Link closed";
  if (r.picksAt) return "Choosing";
  if (r.openedAt) return "Opened";
  return "Not opened yet";
}

/** The message the contractor sends with the link (from their own phone or email). */
export function linkMessage(i: { org: string; clientName: string; roomName: string; link: string }): string {
  const first = i.clientName.split(/\s+/)[0] || i.clientName;
  return `Hi ${first}, here's your ${i.roomName.toLowerCase()} design${i.org ? ` from ${i.org}` : ""}: see it in 3D, choose your finishes and approve it here — ${i.link}`;
}

/** The room's total with these picks, unrounded — the studio's engine and the shop's prices as the link carries them. */
function rawTotal(l: Pick<RoomClientLink, "doc" | "room" | "options" | "pricing">, picks: Picks): number | null {
  const doc = applyPicks(l.doc, l.room, l.options, picks);
  const t = takeoff(doc, l.room);
  if (!t) return null;
  return estimateTotal(priceDesign(t, roomFinishes(doc, l.room), l.pricing.opts, l.pricing.factor, l.pricing.book, l.pricing.products));
}

/** The room's total with these picks, before tax — what the server tells the contractor on approval. */
export function linkTotal(l: Pick<RoomClientLink, "doc" | "room" | "options" | "pricing">, picks: Picks): number | null {
  const t = rawTotal(l, picks);
  return t == null ? null : Math.round(t);
}

/** What the client's page gets to price with: the design's own total and what each choice adds or saves. Never the
 *  shop's line prices — a slot's choice prices its own lines (a floor its floor, a backsplash its splash), so the sum
 *  is the total `linkTotal` reaches. */
export type LinkPrices = { base: number; delta: Partial<Record<Slot, Record<string, number>>> };

export function linkPrices(l: Pick<RoomClientLink, "doc" | "room" | "options" | "pricing">): LinkPrices | null {
  const base = rawTotal(l, {});
  if (base == null) return null;
  const delta: LinkPrices["delta"] = {};
  for (const o of l.options) {
    const row: Record<string, number> = {};
    for (const c of o.choices) row[c.key] = Math.round(((rawTotal(l, { [o.slot]: c.key }) ?? base) - base) * 100) / 100;
    delta[o.slot] = row;
  }
  return { base: Math.round(base * 100) / 100, delta };
}

export const pricedTotal = (p: LinkPrices, picks: Picks) => Math.round(p.base + (Object.keys(picks) as Slot[]).reduce((s, k) => s + (p.delta[k]?.[picks[k] ?? ""] ?? 0), 0));

/** "Cabinets: Navy", one a slot — what the client settled on (the design's own where they didn't choose). */
export function chosenWords(options: readonly ClientOption[], picks: Picks): string[] {
  return options.map((o) => `${o.title}: ${(o.choices.find((c) => c.key === picks[o.slot]) ?? o.choices[0]).name}`);
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The email to whoever made the link when the client approves. */
export function approvedEmailDoc(i: { org: { id?: string | null; name: string; logoUrl: string | null; phone: string | null }; name: string; roomName: string; total: number | null; chosen: string[]; note: string; href: string }): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Client", value: i.name },
    { type: "field", label: "Room", value: i.roomName },
    ...i.chosen.map((c) => {
      const at = c.indexOf(": ");
      return { type: "field" as const, label: c.slice(0, at), value: c.slice(at + 2) };
    }),
    ...(i.total != null ? [{ type: "anchor" as const, label: "Before tax", value: money(i.total) }] : []),
  ];
  return {
    subject: `${i.name} approved the ${i.roomName.toLowerCase()} design`,
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl, orgId: i.org.id ?? null },
    kicker: { text: "Design approved", tone: "ok" },
    headline: `${i.name} approved the ${i.roomName.toLowerCase()} design`,
    prose: i.note ? [`“${i.note}”`] : undefined,
    box,
    cta: { label: "Open it in the Design Studio", href: i.href },
    after: ["Apply their choices to the design, then make the proposal."],
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}
