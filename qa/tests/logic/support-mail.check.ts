// Support replies through the Gmail box (2026-10-18, lib/supportMail): the plus-address, when the box may be read
// at all (production only), and every decision the cron makes on a letter — run against a fake box and a fake
// database, so it is pure: no IMAP, no Prisma, no mail. Plus the preview-deployment email guard.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/support-mail.check.ts
import { ATTACHMENT_NOTE, processInbox, wordsOf, type InboxDeps, type InboxLetter, type InboxPort } from "../../../src/lib/supportMail/core";
import { mailEnvironmentAllowed, supportMailConfig } from "../../../src/lib/supportMail/config";
import { isPlusTicketAddress, plusReplyAddress, refFromSubject, ticketFromPlusAddress, trimQuoted } from "../../../src/lib/supportInbound";
import { allowedOnPreview, previewAllowList, previewRecipients } from "../../../src/lib/emailPreviewGuard";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

(async () => {
  // ── The plus-address ──────────────────────────────────────────────────────
  const box = "app@jobflex.app";
  const secret = "s3cret";
  const T = "cmgx1abcd0001xyz";
  const reply = plusReplyAddress(T, { mailbox: box, secret });
  check("the Reply-To is the box's own plus-address with the signed ticket", /^app\+t-cmgx1abcd0001xyz-[a-f0-9]{20}@jobflex\.app$/.test(reply), reply);
  check("…reads back to its ticket, with a display name and any case", ticketFromPlusAddress(reply, { mailbox: box, secret }) === T && ticketFromPlusAddress(`"JobFlex" <${reply.toUpperCase()}>`, { mailbox: box, secret }) === T);
  check(
    "a forged signature, another box, another domain, another secret: no ticket",
    ticketFromPlusAddress(reply.replace(/-[a-f0-9]{20}@/, "-0123456789abcdef0123@"), { mailbox: box, secret }) === null &&
      ticketFromPlusAddress(reply.replace("app+", "sales+"), { mailbox: box, secret }) === null &&
      ticketFromPlusAddress(reply.replace("jobflex.app", "evil.test"), { mailbox: box, secret }) === null &&
      ticketFromPlusAddress(reply, { mailbox: box, secret: "other" }) === null &&
      ticketFromPlusAddress(box, { mailbox: box, secret }) === null,
  );
  check("a broken one still looks meant for a ticket (so it is parked, not ignored)", isPlusTicketAddress("app+t-xyz-bad@jobflex.app", box) && !isPlusTicketAddress("app@jobflex.app", box) && !isPlusTicketAddress("dana@x.test", box));
  check("[JobFlex REF] read from a subject", refFromSubject("Re: Bad sizing [JobFlex J7RCFS]") === "J7RCFS" && refFromSubject("Re: lunch") === null);
  check("a signature after '-- ' is cut", trimQuoted("Thanks, works now.\n\n-- \nDana Ray\nRay Roofing · 555-0100") === "Thanks, works now.");

  // ── Where the box may be read ─────────────────────────────────────────────
  const prod = { VERCEL_ENV: "production", SMTP_USER: box, SMTP_PASSWORD: "app-pass", AUTH_SECRET: "a" };
  check("production with the SMTP login: on, imap.gmail.com:993, the SMTP box", (() => { const c = supportMailConfig(prod); return c.ok && c.config.host === "imap.gmail.com" && c.config.port === 993 && c.config.user === box && c.config.secret === "a"; })());
  check("SUPPORT_REPLY_SECRET signs instead of AUTH_SECRET; IMAP_* override", (() => { const c = supportMailConfig({ ...prod, SUPPORT_REPLY_SECRET: "r", IMAP_HOST: "imap.x.test", IMAP_USER: "help@x.test", IMAP_PASSWORD: "p" }); return c.ok && c.config.secret === "r" && c.config.host === "imap.x.test" && c.config.user === "help@x.test"; })());
  check("a PREVIEW never reads the real box", !mailEnvironmentAllowed({ ...prod, VERCEL_ENV: "preview" }) && !supportMailConfig({ ...prod, VERCEL_ENV: "preview" }).ok);
  check("…nor a laptop, unless SUPPORT_MAIL_LOCAL=1", !supportMailConfig({ ...prod, VERCEL_ENV: undefined }).ok && supportMailConfig({ ...prod, VERCEL_ENV: undefined, SUPPORT_MAIL_LOCAL: "1" }).ok);
  check("SUPPORT_MAIL_OFF=1 switches it off even on production", !supportMailConfig({ ...prod, SUPPORT_MAIL_OFF: "1" }).ok);
  check("no password or no box: off, and says why", (() => { const a = supportMailConfig({ ...prod, SMTP_PASSWORD: "" }); const b = supportMailConfig({ ...prod, SMTP_USER: "" }); return !a.ok && /password/.test(a.why) && !b.ok && /mailbox/.test(b.why); })());

  // ── The cron on a fake box ────────────────────────────────────────────────
  const customer = "dana@ray.test";
  const tid = T;
  const other = "cmgx1abcd0002zzz";
  let n = 0;
  const raw: Record<number, string> = {};
  const letters: InboxLetter[] = [];
  const add = (l: Partial<InboxLetter>, body: string, extraHeaders = "", contentType = "text/plain; charset=utf-8") => {
    const uid = ++n;
    const letter: InboxLetter = { uid, from: customer, to: [reply], cc: [], deliveredTo: [], subject: "Re: Roof estimate [JobFlex 01XYZZ]", messageId: `<m${uid}@ray.test>`, inReplyTo: null, references: [], headers: {}, ...l };
    letters.push(letter);
    raw[uid] = `From: ${letter.from}\r\nTo: ${letter.to.join(", ")}\r\nSubject: ${letter.subject}\r\nMessage-ID: ${letter.messageId}\r\n${extraHeaders}Content-Type: ${contentType}\r\n\r\n${body}`;
    return uid;
  };
  const uCustomer = add({}, "Thanks — that fixed it.\r\n\r\nOn Fri, Oct 17, 2026 at 9:14 AM JobFlex <app@jobflex.app> wrote:\r\n> Hi Dana,\r\n> try 7/12.");
  const uTeam = add({ from: `JobFlex <${box}>` }, "We pushed the fix tonight.\r\n\r\n-- \r\nJobFlex support");
  const uStranger = add({ from: "mallory@evil.test" }, "let me in");
  const uForged = add({ to: [reply.replace(/-[a-f0-9]{20}@/, "-0123456789abcdef0123@")] }, "forged");
  const uAuto = add({ subject: "Automatic reply: Re: Roof estimate", headers: { "auto-submitted": "auto-replied" } }, "I'm away until Monday.");
  const uDup = add({ messageId: "<seen-before@ray.test>" }, "the same letter again");
  const uHtml = add({}, '<div>Here is the <b>HTML</b> reply<br>second line</div><blockquote class="gmail_quote">old letter</blockquote>', "", "text/html; charset=utf-8");
  const uAttach = add(
    {},
    '--BOUND\r\nContent-Type: text/plain\r\n\r\nPhoto of the roof attached.\r\n--BOUND\r\nContent-Type: image/jpeg\r\nContent-Disposition: attachment; filename="roof.jpg"\r\nContent-Transfer-Encoding: base64\r\n\r\n/9j/4AAQSkZJRgABAQ==\r\n--BOUND--\r\n',
    "MIME-Version: 1.0\r\n",
    'multipart/mixed; boundary="BOUND"',
  );
  const uThread = add({ to: [box], inReplyTo: "<our-letter-1@jobflex.app>", subject: "Re: your answer" }, "Replying to your email (the app ignored Reply-To).");
  const uRef = add({ to: ["support@jobflex.app"], subject: "Re: Roof estimate [JobFlex XYZZY2]" }, "Found it by the ref.");
  const uOwnNotice = add({ from: `JobFlex <${box}>`, to: [box], subject: "Re: Roof estimate [JobFlex XYZZY2] — Ray Roofing replied" }, "Our own notice to the inbox.");
  const uPersonal = add({ from: "friend@x.test", to: [box], subject: "Lunch?" }, "Lunch on Friday?");
  const uParked = add({ from: "mallory@evil.test", unmatchedBefore: true }, "parked last time");
  const uEmpty = add({}, "\r\nOn Fri, Oct 17, 2026 at 9:14 AM JobFlex <app@jobflex.app> wrote:\r\n> only the quote");

  const done = new Set<number>();
  const unmatched = new Set<number>();
  const posted: Array<{ ticketId: string; from: string; body: string; emailMessageId: string | null }> = [];
  const port: InboxPort = {
    unseen: async (limit) => letters.filter((l) => !done.has(l.uid)).slice(-limit),
    source: async (uid) => raw[uid],
    done: async (uid) => void done.add(uid),
    unmatched: async (uid) => void unmatched.add(uid),
    stopped: async (uid) => void done.add(uid),
  };
  const deps: InboxDeps = {
    mailbox: box,
    secret,
    ticketByRef: async (ref) => (ref === "XYZZY2" ? other : null),
    ticketByMessageIds: async (ids) => (ids.includes("our-letter-1@jobflex.app") ? tid : null),
    sender: async (_t, address) => (address === box ? { from: "team", authorUserId: null, authorName: "JobFlex support" } : address === customer ? { from: "customer", authorUserId: "u1", authorName: "Dana Ray" } : null),
    alreadyHave: async (id) => id === "seen-before@ray.test",
    post: async (i) => {
      posted.push({ ticketId: i.ticketId, from: i.from, body: i.body, emailMessageId: i.emailMessageId });
      return true;
    },
  };
  const report = await processInbox(port, deps, { limit: 50 });
  const out = (uid: number) => report.letters.find((l) => l.uid === uid);
  const postOf = (uid: number) => posted.find((p) => p.emailMessageId === `m${uid}@ray.test`);

  check("the customer's reply joins the ticket, the quoted letter cut, marked read", out(uCustomer)?.outcome === "added" && postOf(uCustomer)?.from === "customer" && postOf(uCustomer)?.body === "Thanks — that fixed it." && done.has(uCustomer), JSON.stringify(postOf(uCustomer)));
  check("a reply from our own box is the team's message, the signature cut", out(uTeam)?.outcome === "added" && postOf(uTeam)?.from === "team" && postOf(uTeam)?.body === "We pushed the fix tonight.");
  check("a stranger's letter is parked: JobFlex/Unmatched, left unread", (out(uStranger) as { why?: string })?.why === "stranger" && unmatched.has(uStranger) && !done.has(uStranger));
  check("a forged token is parked as bad-token", (out(uForged) as { why?: string })?.why === "bad-token" && unmatched.has(uForged) && !done.has(uForged));
  check("an out-of-office is dropped (read, processed), nothing added", (out(uAuto) as { why?: string })?.why === "auto-reply" && done.has(uAuto) && !postOf(uAuto));
  check("a letter already in the conversation (its Message-ID) is dropped, not added twice", (out(uDup) as { why?: string })?.why === "duplicate" && done.has(uDup) && !posted.some((p) => p.emailMessageId === "seen-before@ray.test"));
  check("an HTML-only reply is read as text, the quoted block left out", postOf(uHtml)?.body === "Here is the HTML reply\nsecond line", JSON.stringify(postOf(uHtml)?.body));
  check("an attachment is not carried — the note says so", postOf(uAttach)?.body === `Photo of the roof attached.\n\n${ATTACHMENT_NOTE}`, JSON.stringify(postOf(uAttach)?.body));
  check("a mail app that ignored Reply-To: found by In-Reply-To (a letter we sent)", out(uThread)?.outcome === "added" && postOf(uThread)?.ticketId === tid);
  check("…or by [JobFlex REF] in the subject", out(uRef)?.outcome === "added" && postOf(uRef)?.ticketId === other);
  check("our own notice to the inbox (from the box, no plus-address) is never taken as 'the team said'", out(uOwnNotice)?.outcome === "not-ours" && !done.has(uOwnNotice) && !unmatched.has(uOwnNotice));
  check("a person's own mail in the box is not touched", out(uPersonal)?.outcome === "not-ours" && !done.has(uPersonal) && !unmatched.has(uPersonal));
  check("a letter parked by an earlier run is left to the person", out(uParked)?.outcome === "not-ours" && !postOf(uParked));
  check("a reply with nothing but the quote is parked as empty", (out(uEmpty) as { why?: string })?.why === "empty" && unmatched.has(uEmpty));
  check("the run's counts", report.checked === letters.length && report.added === 6 && report.dropped === 2 && report.unmatched === 3, JSON.stringify({ ...report, letters: undefined }));
  const again = await processInbox(port, deps, { limit: 50 });
  check("a second run adds nothing new (what was done is read; what was parked waits for a person)", again.added === 0 && posted.length === 6);
  const words = await wordsOf("Content-Type: text/plain\r\n\r\n" + "x".repeat(5000));
  check("a very long reply is clipped to the message limit", words.body.length === 4000 && words.body.endsWith("…"));

  // ── Email from a preview deployment ───────────────────────────────────────
  check("production and local: no filtering", previewRecipients(["dana@ray.test"], { VERCEL_ENV: "production" }) === null && previewRecipients(["dana@ray.test"], {}) === null);
  check("a preview sends only to @jobflex.app by default", JSON.stringify(previewRecipients(["dana@ray.test", "Ivan <app@jobflex.app>"], { VERCEL_ENV: "preview" })) === JSON.stringify(["Ivan <app@jobflex.app>"]) && previewRecipients(["dana@ray.test"], { VERCEL_ENV: "preview" })?.length === 0);
  check("PREVIEW_EMAIL_ALLOW: single addresses and whole domains", JSON.stringify(previewAllowList({ PREVIEW_EMAIL_ALLOW: " Me@Gmail.com , @qa.test " })) === JSON.stringify(["me@gmail.com", "@qa.test"]) && allowedOnPreview("ME@gmail.com", ["me@gmail.com"]) && allowedOnPreview("x@qa.test", ["@qa.test"]) && !allowedOnPreview("x@evilqa.test", ["@qa.test"]));

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
