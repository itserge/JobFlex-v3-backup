// CARDS IN A SUPPORT ANSWER (owner, 2026-10-29: on "how do I cancel?" put the extend-the-trial card FIRST, then the price
// that stays theirs for life, then the steps — "smart, short, understandable, attractive"). An answer stays plain text —
// the team edits it in a textarea, it is stored and emailed as text — and a paragraph that starts with a tag is drawn as a
// card wherever an answer is shown (the email, the Help window, the support page, the admin thread):
//
//   [offer] Two more weeks, free                      ← the tag, then the card's title on the same line
//   Haven't had time to really try it? Reply "yes"…   ← the card's text: the paragraph's next lines
//
// [offer] — something we can do for them (blue).  [note] — something to know before deciding (ink).
// Pure and client-safe: the Help window and the admin page import it.

export type ReplyCardKind = "offer" | "note";
export type ReplyBlock = { kind: "text"; text: string } | { kind: ReplyCardKind; title: string; text: string };

const TAG = /^\[(offer|note)\][ \t]*/i;

/** The answer's paragraphs (blank lines split them), a tagged one as a card. A tag with nothing after it is dropped. */
export function replyBlocks(body: string): ReplyBlock[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p): ReplyBlock[] => {
      const m = TAG.exec(p);
      if (!m) return [{ kind: "text", text: p }];
      const rest = p.slice(m[0].length);
      const nl = rest.indexOf("\n");
      const title = (nl < 0 ? rest : rest.slice(0, nl)).trim();
      const text = (nl < 0 ? "" : rest.slice(nl + 1)).trim();
      if (!title && !text) return [];
      return [{ kind: m[1].toLowerCase() as ReplyCardKind, title: title || text, text: title ? text : "" }];
    });
}

/** The same answer for a plain-text email: a card's title in capitals over its text, no tags. */
export function replyPlainText(body: string): string {
  return replyBlocks(body)
    .map((b) => (b.kind === "text" ? b.text : [b.title.toUpperCase(), b.text].filter(Boolean).join("\n")))
    .join("\n\n");
}

/** Whether a draft carries a card (the admin page shows how it will look). */
export const hasReplyCard = (body: string): boolean => body.split(/\n\s*\n/).some((p) => TAG.test(p.trim()));
