// THE SIGN-UP'S $1 CARD CHECK, AS IT WENT (owner, 2026-11-11 — lib/signupCardHold): the latest trial sign-ups back
// from Stripe, newest first — passed (the hold granted and released), declined (the bank's code; no account was made)
// or skipped (why; the sign-up went on). Same table as the trials below it; stacks on a phone.
import type { CardHoldRecord } from "@/lib/signupCardHold";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import { ago } from "@/components/v3/admin-overview/admin-ui";

export type CardHoldRow = CardHoldRecord & { orgName: string | null };

const WORD: Record<CardHoldRecord["result"], string> = { passed: "Passed", declined: "Declined", skipped: "Skipped" };

export function CardHoldsPanel({ rows, now }: { rows: CardHoldRow[]; now: string }) {
  const declined = rows.filter((r) => r.result === "declined").length;
  const skipped = rows.filter((r) => r.result === "skipped").length;
  return (
    <div className="card" data-card-holds>
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Card check at sign-up</div>
        </div>
        <span className={s.count}>
          {rows.length} latest · {declined} declined · {skipped} skipped
        </span>
      </div>
      <p className={s.note}>
        Every trial sign-up back from Stripe is asked for a $1 hold on the card it saved, released at once. Declined: the bank refused it — no account was made and that Checkout&apos;s subscription was cancelled. Skipped: the check could not be read (3D Secure asked for, a method that takes no hold, Stripe or the network) — the sign-up went on.
      </p>
      {rows.length === 0 ? (
        <div className="empty">No card checks yet.</div>
      ) : (
        <table className={s.tbl}>
          <thead>
            <tr>
              <th>When</th>
              <th>Email</th>
              <th>Plan</th>
              <th>Check</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sessionId} data-card-hold={r.result}>
                <td data-l="When">{ago(r.at, now)}</td>
                <td data-l="Email">
                  <div>
                    <b>{r.email}</b>
                    {r.livemode === false ? <div className={s.sub}>test mode</div> : null}
                  </div>
                </td>
                <td data-l="Plan">
                  <div>
                    {r.plan ?? "—"}
                    {r.interval ? <span className={s.sub}> · {r.interval === "YEAR" ? "yearly" : "monthly"}</span> : null}
                  </div>
                </td>
                <td data-l="Check">
                  <div>
                    <span className={r.result === "passed" ? "chip ok" : r.result === "declined" ? `chip ${s.chipDanger}` : "chip"}>{WORD[r.result]}</span>
                    <div className={s.sub}>
                      {r.result === "declined"
                        ? `${r.code ?? "card_declined"}${r.subCanceled === false ? " · subscription not cancelled yet" : ""}`
                        : r.result === "skipped"
                          ? (r.reason ?? "—")
                          : r.released === false
                            ? "hold not released yet"
                            : "hold released"}
                    </div>
                  </div>
                </td>
                <td data-l="Account">{r.result === "declined" ? "Not made" : r.orgId ? (r.orgName ?? "Made") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A trial row's own line: how its sign-up's card check went. */
export function cardHoldWords(r: CardHoldRecord): string {
  return r.result === "passed" ? "Card check passed" : r.result === "declined" ? `Card check declined (${r.code ?? "card_declined"})` : `Card check skipped (${r.reason ?? "—"})`;
}
