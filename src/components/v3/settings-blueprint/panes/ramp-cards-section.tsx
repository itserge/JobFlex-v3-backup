"use client";
// RAMP CARDS — the cards themselves, on the Integrations card (2026-10-29, round 2). The cards the company's Ramp
// has (holder, last four, state, a freeze switch), the orders still going through Ramp, and "Give a card": pick a
// crew member, a monthly limit, where it ships — Ramp invites them if need be, makes the fund, orders the card.
import { useCallback, useEffect, useState } from "react";
import { CreditCard, Snowflake, Sun } from "lucide-react";
import { orderRampCardAction, readRampCards, setRampCardSuspendedAction } from "@/actions/ramp";
import type { RampCardOrder, RampCardsView } from "@/lib/ramp/cards";
import type { RampTeamMember } from "@/lib/ramp/cards";
import { toast } from "@/components/ui/Toast";
import styles from "../meta-connection.module.css";
import layout from "./integration-cards.module.css";

type View = RampCardsView & { team: RampTeamMember[] };
type Form = { who: string; name: string; email: string; monthly: string; perPurchase: string; address1: string; address2: string; city: string; state: string; zip: string };

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;
const ORDER_WORDS: Record<RampCardOrder["state"], string> = { inviting: "Ramp is inviting them", funding: "Setting the limit", ordering: "Ordering the card", ordered: "Ordered", failed: "Not ordered" };

export function RampCardsSection({ canManage }: { canManage: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ who: "", name: "", email: "", monthly: "2000", perPurchase: "", address1: "", address2: "", city: "", state: "", zip: "" });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const load = useCallback(() => {
    readRampCards()
      .then((v) => {
        setView(v);
        if (v.shipTo) setForm((f) => (f.address1 ? f : { ...f, address1: v.shipTo!.address1, address2: v.shipTo!.address2 ?? "", city: v.shipTo!.city, state: v.shipTo!.state, zip: v.shipTo!.postal_code }));
      })
      .catch(() => setView({ cards: [], orders: [], shipTo: null, shipToRaw: "", team: [] }));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const pickWho = (userId: string) => {
    const m = view?.team.find((t) => t.userId === userId);
    setForm((f) => ({ ...f, who: userId, name: m ? m.name : userId === "other" ? "" : f.name, email: m ? m.email : userId === "other" ? "" : f.email }));
  };
  const order = async () => {
    setBusy("order");
    try {
      const r = await orderRampCardAction({
        userId: form.who && form.who !== "other" ? form.who : null,
        email: form.email,
        name: form.name,
        monthlyLimit: Number(form.monthly),
        perPurchaseLimit: form.perPurchase.trim() ? Number(form.perPurchase) : null,
        ship: { address1: form.address1, address2: form.address2 || null, city: form.city, state: form.state, postal_code: form.zip, country: "US" },
      });
      if (!r.ok) throw new Error(r.error);
      const o = r.order;
      if (o.state === "ordered") toast.success("Card ordered", `${o.name} · ${dollars(o.monthlyLimit)} a month · ${o.note ?? "Ramp ships it."}`);
      else if (o.state === "failed") toast.error("Not ordered", o.note ?? "Ramp refused.");
      else toast.success("Card on its way through Ramp", o.note ?? ORDER_WORDS[o.state]);
      setOpen(false);
      setForm((f) => ({ ...f, who: "", name: "", email: "", perPurchase: "" }));
      load();
    } catch (error) {
      toast.error("Couldn't order the card", error instanceof Error ? error.message : "Try again in a minute.");
    } finally {
      setBusy(null);
    }
  };
  const freeze = async (cardId: string, suspended: boolean, holder: string) => {
    setBusy(cardId);
    try {
      const r = await setRampCardSuspendedAction({ cardId, suspended, holder });
      if (!r.ok) throw new Error(r.error);
      toast.success(suspended ? "Card frozen" : "Card unfrozen", holder ? `${holder}'s card${suspended ? " declines until you unfreeze it." : " works again."}` : "");
      load();
    } catch (error) {
      toast.error("Ramp refused", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusy(null);
    }
  };

  const cards = view?.cards ?? [];
  // An order whose card Ramp already lists (same fund) is that card's row, not a second one.
  const orders = (view?.orders ?? []).filter((o) => o.state !== "ordered" || !cards.some((c) => c.fundId && c.fundId === o.fundId));
  const primary = `${styles.button} ${styles.primary}`;

  return (
    <div className={layout.section} data-ramp-cards>
      <h3 className={layout.sectionTitle}>Cards</h3>
      {!view ? (
        <p className={styles.label}>Reading the cards from Ramp…</p>
      ) : cards.length === 0 && orders.length === 0 ? (
        <p className={styles.label} data-ramp-cards-empty>No cards in this Ramp yet.</p>
      ) : (
        <table className={layout.cardTable} data-ramp-cards-table>
          <thead>
            <tr>
              <th>Who</th>
              <th>Card</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} data-ramp-card-row={c.id}>
                <td>{c.holder || "—"}</td>
                <td><CreditCard size={14} aria-hidden="true" style={{ verticalAlign: -2, marginRight: 6 }} />{c.kind === "virtual" ? "virtual" : "physical"} ···· {c.lastFour || "????"}{c.displayName ? <span className={layout.muted}> · {c.displayName}</span> : null}</td>
                <td>{c.suspended ? "frozen" : c.state || "active"}{c.shipping ? <span className={layout.muted}> · {c.shipping}</span> : null}</td>
                <td>
                  {canManage && c.kind === "physical" && (
                    <button className={styles.textButton} type="button" disabled={busy !== null} onClick={() => void freeze(c.id, !c.suspended, c.holder)} data-ramp-card-freeze>
                      {c.suspended ? <Sun size={14} aria-hidden="true" /> : <Snowflake size={14} aria-hidden="true" />}{busy === c.id ? "…" : c.suspended ? "Unfreeze" : "Freeze"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {orders.map((o) => (
              <tr key={`order-${o.email}`} data-ramp-order-row={o.state}>
                <td>{o.name}</td>
                <td>{o.lastFour ? `physical ···· ${o.lastFour}` : "physical · ordering"}<span className={layout.muted}> · {dollars(o.monthlyLimit)} a month</span></td>
                <td>{ORDER_WORDS[o.state]}{o.note ? <span className={layout.muted}> · {o.note}</span> : null}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage && !open && (
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button className={primary} type="button" onClick={() => setOpen(true)} data-ramp-card-give><CreditCard size={16} aria-hidden="true" />Give a card</button>
        </div>
      )}
      {canManage && open && (
        <div style={{ display: "grid", gap: 16, marginTop: 12 }} data-ramp-card-form>
          <div className={layout.fields}>
            <label className={layout.field}><span>Who</span>
              <select value={form.who} onChange={(e) => pickWho(e.target.value)} data-ramp-card-who>
                <option value="">Pick a person…</option>
                {(view?.team ?? []).map((t) => (
                  <option key={t.userId} value={t.userId}>{t.name} · {t.kind === "crew" ? "crew" : "office"}</option>
                ))}
                <option value="other">Someone else…</option>
              </select>
            </label>
            <label className={layout.field}><span>Monthly limit ($)</span><input type="number" min="50" step="50" inputMode="numeric" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} data-ramp-card-monthly /></label>
            {form.who === "other" && (
              <>
                <label className={layout.field}><span>Name</span><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Mike Rivera" /></label>
                <label className={layout.field}><span>Email (Ramp invites them)</span><input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="mike@summitfence.com" /></label>
              </>
            )}
            <label className={layout.field}><span>Per-purchase limit ($, optional)</span><input type="number" min="1" step="50" inputMode="numeric" value={form.perPurchase} onChange={(e) => set("perPurchase", e.target.value)} placeholder="500" /></label>
          </div>
          <div>
            <p className={styles.label}>Ships to</p>
            <div className={layout.fields}>
              <label className={layout.field}><span>Street</span><input value={form.address1} onChange={(e) => set("address1", e.target.value)} placeholder="100 Main St" data-ramp-card-street /></label>
              <label className={layout.field}><span>Suite (optional)</span><input value={form.address2} onChange={(e) => set("address2", e.target.value)} /></label>
              <label className={layout.field}><span>City</span><input value={form.city} onChange={(e) => set("city", e.target.value)} /></label>
              <label className={layout.field}><span>State · ZIP</span>
                <span style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8 }}>
                  <input value={form.state} maxLength={2} onChange={(e) => set("state", e.target.value.toUpperCase())} placeholder="WA" aria-label="State" />
                  <input value={form.zip} onChange={(e) => set("zip", e.target.value)} placeholder="98033" aria-label="ZIP" inputMode="numeric" />
                </span>
              </label>
            </div>
          </div>
          <p className={styles.label}>Ramp invites them by email if they are not in your Ramp yet, sets a &ldquo;JobFlex · name&rdquo; limit, and ships the card. Every swipe on it lands on a job like any other.</p>
          <div className={styles.actions}>
            <button className={primary} type="button" disabled={busy !== null || !form.who} onClick={() => void order()} data-ramp-card-order>{busy === "order" ? "Ordering through Ramp…" : "Order the card"}</button>
            <button className={styles.button} type="button" disabled={busy !== null} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
