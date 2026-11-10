"use client";
// "Client's page" on a client's record (2026-11-10, Smart CRM part 5): the client's one lasting link — copy it, open
// it as they see it, text or email it, see when they last opened it, or replace it (the old link stops).

import { useState } from "react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { getClientHomeLink, replaceClientHomeLink, sendClientHomeLink } from "@/actions/clientHome";

type Link = { href: string; opened: string; canText: boolean; canEmail: boolean };

export function ClientPageLink({ clientId, clientName, children }: { clientId: string; clientName: string; children: (open: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  function show() {
    setOpen(true);
    setNote(null);
    setConfirmReplace(false);
    setLink(null);
    getClientHomeLink(clientId)
      .then(setLink)
      .catch(() => setNote({ ok: false, text: "The link couldn't be made. Try again." }));
  }

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNote(null);
    try {
      setNote({ ok: true, text: await fn() });
    } catch (x) {
      setNote({ ok: false, text: x instanceof Error ? x.message : "That didn't go through." });
    } finally {
      setBusy(null);
    }
  }

  const first = clientName.split(" ")[0] || "the client";
  return (
    <>
      {children(show)}
      <BlueprintSheet open={open} onClose={() => !busy && setOpen(false)} title={`${first}'s page`} description="One link for everything: their proposals and payments, what waits for their OK, the schedule, documents, and messages — they can write back from it.">
        <div className="bps-form" data-client-page-sheet>
          {link ? (
            <>
              <label className="bps-fld bps-fld--wide">
                <span className="bps-lbl">Their link · {link.opened}</span>
                <input className="bps-in" readOnly value={link.href} onFocus={(e) => e.currentTarget.select()} data-client-page-href />
              </label>
              <div className="bps-fld bps-fld--wide" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="bps-btn bps-btn--sm"
                  disabled={!!busy}
                  onClick={() =>
                    void run("copy", async () => {
                      try {
                        await navigator.clipboard.writeText(link.href);
                        return "Copied — paste it into a text or an email.";
                      } catch {
                        return "Select the link above and copy it.";
                      }
                    })
                  }
                  data-client-page-copy
                >
                  Copy
                </button>
                <a className="bps-btn bps-btn--sm" href={`${link.href}?preview=1`} target="_blank" rel="noopener noreferrer" data-client-page-open>
                  Open as they see it
                </a>
                <button
                  type="button"
                  className="bps-btn bps-btn--sm bps-btn--primary"
                  disabled={!!busy || !link.canText}
                  title={link.canText ? undefined : "No phone on file"}
                  onClick={() =>
                    void run("sms", async () => {
                      const r = await sendClientHomeLink(clientId, "sms");
                      if ("error" in r) throw new Error(r.error);
                      return r.delivered ? `Texted to ${r.to}.` : `Saved — texting is off here, so nothing went to ${r.to}.`;
                    })
                  }
                  data-client-page-text
                >
                  Text it
                </button>
                <button
                  type="button"
                  className="bps-btn bps-btn--sm bps-btn--primary"
                  disabled={!!busy || !link.canEmail}
                  title={link.canEmail ? undefined : "No email on file"}
                  onClick={() =>
                    void run("email", async () => {
                      const r = await sendClientHomeLink(clientId, "email");
                      if ("error" in r) throw new Error(r.error);
                      return `Emailed to ${r.to}.`;
                    })
                  }
                  data-client-page-email
                >
                  Email it
                </button>
              </div>
              {confirmReplace ? (
                <div className="bps-fld bps-fld--wide" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span className="bps-hint" style={{ flex: "1 1 220px" }}>
                    A new link — the old one stops opening. For a link that went to the wrong person.
                  </span>
                  <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setConfirmReplace(false)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="bps-btn bps-btn--sm"
                    disabled={!!busy}
                    onClick={() =>
                      void run("replace", async () => {
                        const r = await replaceClientHomeLink(clientId);
                        setLink({ ...link, href: r.href, opened: "never opened" });
                        setConfirmReplace(false);
                        return "A new link — send it to them again.";
                      })
                    }
                    data-client-page-replace-yes
                  >
                    Replace the link
                  </button>
                </div>
              ) : (
                <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => setConfirmReplace(true)} data-client-page-replace>
                  Replace the link…
                </button>
              )}
            </>
          ) : !note ? (
            <p className="bps-note">Making the link…</p>
          ) : null}
          {note ? (
            <p className={note.ok ? "bps-note" : "bps-err"} role="status" data-client-page-note style={note.ok ? { color: "var(--bps-success)", fontWeight: 700 } : undefined}>
              {note.text}
            </p>
          ) : null}
        </div>
      </BlueprintSheet>
    </>
  );
}
