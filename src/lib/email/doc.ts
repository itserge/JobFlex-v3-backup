// The shape every JobFlex email is expressed in. Callers build one of these;
// renderEmail() owns every pixel of the markup. Never hand-assemble email HTML.
export type Tone = "neutral" | "ok" | "warn" | "bad";

// Status tones map to the 3-tone blueprint status colors. They appear ONLY on
// chips and kickers, never on the CTA or a border (principle 22).
export const TONE_COLOR: Record<Tone, string> = {
  neutral: "#0a0a0a",
  ok: "#3a7d44",
  warn: "#b88420",
  bad: "#a83232",
};

export type Lockup =
  | { kind: "org"; name: string; logoUrl?: string | null }
  | { kind: "platform" };

export type BoxRow =
  | { type: "item"; name: string; amount: string }
  | { type: "field"; label: string; value: string }
  | { type: "rate"; label: string; rate: string; amount: string }
  | { type: "anchor"; label: string; value: string }
  | { type: "cond"; label: string; chip: string; tone?: Tone }
  /** A choice the reader taps, one per row (SmartBook's offered times, 2026-10-31): the choice in ink, its action in
   *  blue — both the same link. Several choices are peers (hairlines between them). */
  | { type: "choice"; label: string; action: string; href: string };

export interface EmailDoc {
  subject: string;
  lockup: Lockup;
  kicker?: { text: string; tone?: Tone };
  headline: string;
  /** Paragraphs above the box. */
  prose?: string[];
  /** At most one box per email (principle 12). `cond` must be last. */
  box?: BoxRow[];
  /** Mutually exclusive with `link` — a button only when there is an action (06·a). */
  cta?: { label: string; href: string };
  link?: { label: string; href: string };
  /** Paragraphs below the CTA. */
  after?: string[];
  /** Mono fine print, below a hairline. */
  fine?: string;
  footer: { name: string; contact?: string; ref?: string };
}
