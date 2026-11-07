"use client";

// BUYING AND DELIVERIES (the buying build, 2026-11-05). Two cards for the desktop and the handheld project page:
//   · Buying — the to-buy list, grouped by stage, from what was sold (refreshMaterials), the Deck Studio takeoff or
//     typed by hand; tick lines and press Order to buy them one way — a supplier (the purchase order is emailed),
//     someone by a link (the crew, the office, a helper — no login), or from stock;
//   · Deliveries — every order: ordered → on its way → delivered, the tracking number pasted (the carrier is
//     guessed), what came in line by line (what did not goes back on the list), what it cost (a Materials expense).
// Every write is actions/projectBuying (estimators and managers); everyone else reads the cards.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDeckMaterials,
  addMaterial,
  addSupplierQuick,
  cancelProjectOrder,
  deleteMaterial,
  logProjectOrderExpense,
  patchProjectOrder,
  placeProjectOrder,
  receiveProjectOrder,
  refreshMaterials,
  updateMaterial,
} from "@/actions/projectBuying";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdBuying, PdMaterial, PdOrder, PdStage } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { DEFAULT_LEAD_DAYS, HOW_LABEL, STATE_LABEL, STATUS_LABEL, dayWords, dueWords, isoDay, materialState, orderByDate, qtyWords, toBuyQty, type OrderHow } from "@/lib/projectBuying/shared";
import s from "./project-hub.module.css";

const exact = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

type OrderDraft = {
  how: OrderHow;
  supplierId: string;
  newSupplier: { name: string; email: string; leadDays: string } | null;
  buyerWorkerId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  orderBy: string;
  expectedAt: string;
  note: string;
  quoted: string;
  qty: Record<string, string>;
};

type LineDraft = { id: string | null; name: string; quantity: string; unit: string; unitCost: string; stageId: string; productUrl: string };

export function ProjectBuyingCard({ projectId, buying, stages, canManage }: { projectId: string; buying: PdBuying; stages: PdStage[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<OrderDraft | null>(null);
  const [orderErr, setOrderErr] = useState<string | null>(null);
  const [line, setLine] = useState<LineDraft | null>(null);
  const [lineErr, setLineErr] = useState<string | null>(null);
  const [openOrders, setOpenOrders] = useState<Set<string>>(new Set());
  const [receiving, setReceiving] = useState<{ order: PdOrder; got: Record<string, string> } | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState(buying.suppliers);

  const refresh = () => startTransition(() => router.refresh());
  const today = useMemo(() => new Date(), []);
  const stageOf = (id: string | null) => stages.find((x) => x.id === id) ?? null;

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setErr(null);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  // ── the list, by stage ──
  const groups = useMemo(() => {
    const by = new Map<string, { key: string; name: string; start: string | null; done: boolean; lines: PdMaterial[] }>();
    for (const m of buying.materials) {
      const key = m.stageId ?? "none";
      if (!by.has(key)) by.set(key, { key, name: m.stageName ?? "No stage yet", start: m.stageStart, done: Boolean(m.stageDone), lines: [] });
      by.get(key)!.lines.push(m);
    }
    return [...by.values()];
  }, [buying.materials]);
  const toBuy = buying.materials.filter((m) => toBuyQty(m) > 0);
  const inFull = buying.materials.filter((m) => materialState(m) === "in").length;
  const onOrder = buying.materials.filter((m) => materialState(m) === "ordered" || materialState(m) === "part").length;
  const pickedLines = toBuy.filter((m) => picked.has(m.id));

  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function startOrder() {
    if (!pickedLines.length) return;
    // The stage most picked lines belong to sets the order-by day: its first day less the lead time.
    const counts = new Map<string, number>();
    for (const m of pickedLines) if (m.stageId) counts.set(m.stageId, (counts.get(m.stageId) ?? 0) + 1);
    const stageId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const st = stageOf(stageId);
    const firstSupplier = suppliers[0];
    const lead = firstSupplier?.leadDays ?? DEFAULT_LEAD_DAYS;
    setOrderErr(null);
    setOrder({
      how: "SUPPLIER",
      supplierId: firstSupplier?.id ?? "",
      newSupplier: firstSupplier ? null : { name: "", email: "", leadDays: "" },
      buyerWorkerId: "",
      buyerName: "",
      buyerEmail: "",
      buyerPhone: "",
      orderBy: isoDay(orderByDate(st?.startsAt, lead)) ?? "",
      expectedAt: isoDay(st?.startsAt) ?? "",
      note: "",
      quoted: "",
      qty: Object.fromEntries(pickedLines.map((m) => [m.id, String(toBuyQty(m))])),
    });
  }

  async function submitOrder() {
    if (!order) return;
    const lines = pickedLines.map((m) => ({ materialId: m.id, quantity: num(order.qty[m.id] ?? "0") })).filter((l) => l.quantity > 0);
    if (!lines.length) return setOrderErr("Give at least one line a quantity");
    let supplierId = order.supplierId;
    setBusy("order");
    setOrderErr(null);
    try {
      if (order.how === "SUPPLIER" && order.newSupplier) {
        if (!order.newSupplier.name.trim()) throw new Error("Name the supplier");
        const made = await addSupplierQuick({ name: order.newSupplier.name, email: order.newSupplier.email || null, leadDays: order.newSupplier.leadDays ? Number(order.newSupplier.leadDays) : null });
        setSuppliers((cur) => [...cur, made].sort((a, b) => a.name.localeCompare(b.name)));
        supplierId = made.id;
      }
      if (order.how === "SUPPLIER" && !supplierId) throw new Error("Pick the supplier");
      const worker = buying.crew.find((w) => w.id === order.buyerWorkerId) ?? null;
      if (order.how === "BUYER" && !worker && !order.buyerName.trim()) throw new Error("Who is buying it? Pick a crew member or type a name");
      const r = await placeProjectOrder({
        projectId,
        how: order.how,
        lines,
        supplierId: order.how === "SUPPLIER" ? supplierId : null,
        buyer: order.how === "BUYER" ? { name: worker?.name ?? order.buyerName.trim(), email: order.buyerEmail.trim() || null, phone: order.buyerPhone.trim() || null, workerId: worker?.id ?? null } : null,
        orderBy: order.orderBy || null,
        expectedAt: order.expectedAt || null,
        note: order.note || null,
        quotedTotal: order.quoted ? num(order.quoted) : null,
      });
      const sent = [r.email === "sent" ? "emailed" : null, r.text === "sent" ? "texted" : null].filter(Boolean).join(" and ");
      setNote(
        order.how === "SUPPLIER"
          ? `Order ${r.number} placed — ${r.lines} line${r.lines === 1 ? "" : "s"}. ${r.email === "sent" ? "The purchase order was emailed to the supplier." : r.email === "failed" ? "The purchase order email didn't go — send it yourself." : "The supplier has no email — send the order yourself."}`
          : order.how === "BUYER"
            ? `Order ${r.number} placed — ${r.lines} line${r.lines === 1 ? "" : "s"}. ${sent ? `The buyer was ${sent} the link.` : "Copy the link from the order and send it to the buyer."}`
            : `Order ${r.number} — ${r.lines} line${r.lines === 1 ? "" : "s"} taken from stock.`,
      );
      setOrder(null);
      setPicked(new Set());
      refresh();
    } catch (e) {
      setOrderErr(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  function openLine(m: PdMaterial | null) {
    setLineErr(null);
    setLine(m ? { id: m.id, name: m.name, quantity: String(m.quantity), unit: m.unit, unitCost: m.unitCost != null ? String(m.unitCost) : "", stageId: m.stageId ?? "", productUrl: m.productUrl ?? "" } : { id: null, name: "", quantity: "1", unit: "each", unitCost: "", stageId: stages.find((x) => x.status !== "DONE")?.id ?? "", productUrl: "" });
  }

  async function saveLine() {
    if (!line) return;
    if (!line.name.trim()) return setLineErr("Name the material");
    if (!(num(line.quantity) > 0)) return setLineErr("How many?");
    const data = { name: line.name.trim(), quantity: num(line.quantity), unit: line.unit.trim() || "each", unitCost: line.unitCost ? num(line.unitCost) : null, stageId: line.stageId || null, productUrl: line.productUrl.trim() || null };
    const id = line.id;
    setLine(null);
    await run(`line:${id ?? "new"}`, async () => {
      if (id) await updateMaterial(id, data);
      else await addMaterial(projectId, data);
    });
  }

  const toggleOrder = (id: string) =>
    setOpenOrders((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function orderWho(o: PdOrder): string {
    return o.how === "SUPPLIER" ? (o.supplier?.name ?? "Supplier") : o.how === "BUYER" ? (o.buyerName ?? "A buyer") : "Our stock";
  }

  function orderWhen(o: PdOrder): string[] {
    const out: string[] = [];
    if (o.status === "CANCELED") return ["canceled"];
    if (o.orderedAt) out.push(`ordered ${dayWords(o.orderedAt)}`);
    if (o.shippedAt && (o.status === "SHIPPED" || o.deliveredAt)) out.push(`shipped ${dayWords(o.shippedAt)}`);
    if (o.deliveredAt) out.push(`delivered ${dayWords(o.deliveredAt)}`);
    else if (o.expectedAt) out.push(`expected ${dueWords(o.expectedAt, today)}`);
    if (o.how === "BUYER") out.push(o.buyerSeenAt ? `link opened ${dayWords(o.buyerSeenAt)}` : "link not opened yet");
    return out;
  }

  const lateOrder = (o: PdOrder) => (o.status === "ORDERED" || o.status === "SHIPPED") && o.expectedAt != null && isoDay(o.expectedAt)! < isoDay(today)!;

  const activeOrders = buying.orders.filter((o) => o.status !== "CANCELED");

  return (
    <div className={s.w}>
      {/* ═══ BUYING ═══ */}
      <section className={s.card} aria-label="Buying" data-project-buying>
        <div className={s.head}>
          <h3 className={s.title}>Buying</h3>
          <span className={s.headSub}>
            {buying.materials.length ? (
              <>
                <b>{toBuy.length}</b> to buy{onOrder ? ` · ${onOrder} on order` : ""}{inFull ? ` · ${inFull} in` : ""}
              </>
            ) : (
              "What the project has to buy, bought in parts"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              {buying.unseeded > 0 || !buying.materials.length ? (
                <button type="button" className={s.btnSm} disabled={busy !== null} data-buying-seed onClick={() => void run("seed", async () => `${(await refreshMaterials(projectId)).added} lines added from what was sold.`)}>
                  From the proposals
                </button>
              ) : null}
              {buying.deckTakeoff ? (
                <button type="button" className={s.btnSm} disabled={busy !== null} data-buying-takeoff onClick={() => void run("takeoff", async () => {
                  const r = await addDeckMaterials(projectId);
                  return r.added ? `${r.added} lines added from the deck takeoff (${r.from}).` : "The deck takeoff is on the list already.";
                })}>
                  Deck takeoff
                </button>
              ) : null}
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openLine(null)} data-buying-add>
                + Line
              </button>
            </div>
          ) : null}
        </div>

        {buying.materials.length ? (
          groups.map((g) => {
            const buyable = g.lines.filter((m) => toBuyQty(m) > 0);
            const allPicked = buyable.length > 0 && buyable.every((m) => picked.has(m.id));
            const by = g.start ? orderByDate(g.start, suppliers[0]?.leadDays ?? DEFAULT_LEAD_DAYS) : null;
            return (
              <div key={g.key} className={s.group} data-buying-group>
                <div className={s.groupHead}>
                  <span>{g.name}</span>
                  {g.start ? <span>· starts {dayWords(g.start)}</span> : null}
                  {/* A done stage has no order-by day left to miss (2026-11-06: a finished rough-in read "order by 43 days ago" in red). */}
                  {g.done ? <span>· stage done</span> : by && buyable.length ? <span className={isoDay(by)! < isoDay(today)! ? s.tagLate : ""}>· order by {dueWords(by, today)}</span> : null}
                  {canManage && buyable.length ? (
                    <button type="button" className={s.btnSm} style={{ marginLeft: "auto" }} onClick={() => setPicked((cur) => {
                      const next = new Set(cur);
                      for (const m of buyable) if (allPicked) next.delete(m.id); else next.add(m.id);
                      return next;
                    })}>
                      {allPicked ? "Unselect" : "Select all"}
                    </button>
                  ) : null}
                </div>
                {g.lines.map((m) => {
                  const state = materialState(m);
                  const left = toBuyQty(m);
                  return (
                    <div key={m.id} className={s.line} data-buying-line data-buying-state={state}>
                      {canManage && left > 0 ? <input type="checkbox" checked={picked.has(m.id)} onChange={() => togglePick(m.id)} aria-label={`Order ${m.name}`} /> : <span />}
                      <span className={s.lineName}>
                        {m.productUrl ? (
                          <a href={m.productUrl} target="_blank" rel="noreferrer">
                            {m.name}
                          </a>
                        ) : (
                          m.name
                        )}
                      </span>
                      <span className={s.qty}>{qtyWords(m.quantity, m.unit)}</span>
                      <span className={`${s.tag} ${state === "to-buy" ? s.tagBuy : state === "in" ? s.tagIn : s.tagOrdered}`}>{state === "part" ? `${qtyWords(m.receivedQty, m.unit)} in` : STATE_LABEL[state]}</span>
                      <span className={s.lineSub}>
                        {[m.store, m.unitCost != null ? `${exact(m.unitCost)} each` : null, left > 0 && left < m.quantity ? `${qtyWords(left, m.unit)} still to buy` : null, m.source === "CHANGE_ORDER" ? "change order" : m.source === "TAKEOFF" ? "deck takeoff" : null].filter(Boolean).join(" · ")}
                        {canManage ? (
                          <>
                            {" "}
                            <button type="button" className={s.lineBtn} onClick={() => openLine(m)} aria-label={`Edit ${m.name}`}>
                              edit
                            </button>
                            {m.orderedQty <= 0 ? (
                              <button type="button" className={s.lineBtn} onClick={() => void run(`del:${m.id}`, () => deleteMaterial(m.id))} aria-label={`Remove ${m.name}`}>
                                remove
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })
        ) : (
          <div className={s.empty} data-buying-empty>
            Nothing on the list yet. {canManage ? "Press From the proposals to bring in what was sold, or add lines by hand." : ""}
          </div>
        )}
        {canManage && pickedLines.length ? (
          <div className={s.selBar} data-buying-selbar>
            <b>{pickedLines.length} line{pickedLines.length === 1 ? "" : "s"} picked</b>
            <button type="button" className={s.btnPrimary} onClick={startOrder} data-buying-order>
              Order these
            </button>
            <button type="button" className={s.btnSm} onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        {note ? <div className={s.note}>{note}</div> : null}
        {err ? <div className={s.err}>{err}</div> : null}
      </section>

      {/* ═══ DELIVERIES ═══ */}
      <section className={s.card} aria-label="Deliveries" data-project-deliveries style={{ marginTop: 22 }}>
        <div className={s.head}>
          <h3 className={s.title}>Deliveries</h3>
          <span className={s.headSub}>
            {activeOrders.length ? (
              <>
                <b>{activeOrders.filter((o) => o.status === "ORDERED" || o.status === "SHIPPED").length}</b> on the way · {activeOrders.filter((o) => o.status === "DELIVERED" || o.status === "PARTIAL").length} delivered
              </>
            ) : (
              "Every order, from placed to on site"
            )}
          </span>
        </div>
        {buying.orders.length ? (
          buying.orders.map((o) => {
            const isOpen = openOrders.has(o.id);
            const late = lateOrder(o);
            return (
              <div key={o.id} className={s.order} data-order data-order-status={o.status}>
                <div className={s.orderHead} onClick={() => toggleOrder(o.id)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? (e.preventDefault(), toggleOrder(o.id)) : null)}>
                  <b className={s.propName}>
                    Order {o.number} · {orderWho(o)}
                  </b>
                  <span className={`${s.tag} ${o.status === "DELIVERED" ? s.tagIn : o.status === "PARTIAL" || late ? s.tagLate : o.status === "CANCELED" ? "" : s.tagOrdered}`}>{late ? "Late" : STATUS_LABEL[o.status as keyof typeof STATUS_LABEL] ?? o.status}</span>
                  <span className={s.propMeta}>
                    {o.lines.length} line{o.lines.length === 1 ? "" : "s"}
                    {o.stageName ? ` · ${o.stageName}` : ""}
                    {o.paidTotal != null ? ` · ${exact(o.paidTotal)} paid` : o.quotedTotal != null ? ` · ${exact(o.quotedTotal)} quoted` : ""}
                  </span>
                </div>
                {isOpen ? (
                  <div className={s.orderBody}>
                    <div className={s.orderMeta}>
                      {orderWhen(o).map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                      {o.carrier ? <span>{o.carrier}</span> : null}
                    </div>
                    {o.note ? <div style={{ fontSize: 13 }}>{o.note}</div> : null}
                    {o.buyerNote ? <div style={{ fontSize: 13 }}>Buyer: {o.buyerNote}</div> : null}
                    <div>
                      {o.lines.map((l) => (
                        <div key={l.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                          <span className={s.lineName} style={{ fontWeight: 600 }}>{l.name}</span>
                          <span className={s.qty}>{qtyWords(l.quantity, l.unit)}</span>
                          <span className={`${s.tag} ${l.status === "RECEIVED" ? s.tagIn : l.status === "MISSING" ? s.tagLate : l.status === "BOUGHT" ? s.tagOrdered : ""}`}>
                            {l.status === "RECEIVED" ? "in" : l.status === "MISSING" ? `${qtyWords(l.quantity - l.receivedQty, l.unit)} missing` : l.status === "BOUGHT" ? "bought" : "open"}
                          </span>
                        </div>
                      ))}
                    </div>
                    {o.how === "BUYER" ? (
                      <div className={s.track}>
                        <span className={s.link} data-order-link>{o.link}</span>
                        <button type="button" className={s.btnSm} onClick={() => void navigator.clipboard?.writeText(o.link).then(() => setNote("Link copied."))}>
                          Copy link
                        </button>
                      </div>
                    ) : null}
                    {canManage && o.status !== "CANCELED" ? (
                      <>
                        {o.status === "ORDERED" || o.status === "SHIPPED" ? (
                          <div className={s.track}>
                            <input value={tracking[o.id] ?? o.trackingNumber ?? ""} onChange={(e) => setTracking((cur) => ({ ...cur, [o.id]: e.target.value }))} placeholder="Tracking number or link" aria-label="Tracking number" data-order-tracking />
                            <button type="button" className={s.btnSm} disabled={busy !== null || (tracking[o.id] ?? o.trackingNumber ?? "") === (o.trackingNumber ?? "")} onClick={() => void run(`track:${o.id}`, () => patchProjectOrder(o.id, { trackingNumber: tracking[o.id] ?? "" }))}>
                              Save
                            </button>
                            {o.trackingUrl ? (
                              <a className={s.btnSm} href={o.trackingUrl} target="_blank" rel="noreferrer" style={{ display: "inline-grid", placeItems: "center" }}>
                                Track
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={s.stageActs} style={{ justifyContent: "flex-start" }}>
                          {o.status === "ORDERED" ? (
                            <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`ship:${o.id}`, () => patchProjectOrder(o.id, { status: "SHIPPED" }))} data-order-shipped>
                              On its way
                            </button>
                          ) : null}
                          {o.status === "ORDERED" || o.status === "SHIPPED" ? (
                            <button type="button" className={s.btnPrimary} style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }} disabled={busy !== null} onClick={() => setReceiving({ order: o, got: Object.fromEntries(o.lines.map((l) => [l.id, String(l.quantity)])) })} data-order-delivered>
                              Delivered
                            </button>
                          ) : null}
                          {o.status === "PARTIAL" ? (
                            <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setReceiving({ order: o, got: Object.fromEntries(o.lines.map((l) => [l.id, String(l.receivedQty)])) })}>
                              More came in
                            </button>
                          ) : null}
                          {o.status === "DELIVERED" || o.status === "PARTIAL" ? (
                            <button
                              type="button"
                              className={s.btnSm}
                              disabled={busy !== null}
                              data-order-cost
                              onClick={() => {
                                const v = window.prompt("What did it cost, all in?", o.paidTotal != null ? String(o.paidTotal) : o.quotedTotal != null ? String(o.quotedTotal) : "");
                                if (v == null) return;
                                if (!(num(v) > 0)) {
                                  setNote("Type what it cost — nothing was logged.");
                                  return;
                                }
                                void run(`cost:${o.id}`, async () => {
                                  await logProjectOrderExpense(o.id, num(v));
                                  return `${exact(num(v))} logged as a Materials expense on the project.`;
                                });
                              }}
                            >
                              {o.expenseId ? "Change the cost" : "Log the cost"}
                            </button>
                          ) : null}
                          {o.status === "ORDERED" || o.status === "SHIPPED" ? (
                            <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => window.confirm(`Cancel order ${o.number}? Its lines go back on the to-buy list.`) && void run(`cancel:${o.id}`, () => cancelProjectOrder(o.id))} data-order-cancel>
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className={s.empty}>No orders yet. Tick lines on the list above and press Order these.</div>
        )}
      </section>

      {/* ═══ ORDER THESE ═══ */}
      <BlueprintSheet
        open={order !== null}
        onClose={() => busy === null && setOrder(null)}
        title="Order these"
        description={`${pickedLines.length} line${pickedLines.length === 1 ? "" : "s"}. One order, one way to buy.`}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setOrder(null)} disabled={busy !== null}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void submitOrder()} disabled={busy !== null} data-order-save>
              {busy === "order" ? "Placing…" : order?.how === "SUPPLIER" ? "Place the order" : order?.how === "BUYER" ? "Send the list" : "Take from stock"}
            </button>
          </>
        }
      >
        {order ? (
          <div className="bps-form">
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">How</span>
              <div className="bps-seg">
                {(["SUPPLIER", "BUYER", "STOCK"] as OrderHow[]).map((h) => (
                  <button key={h} type="button" className={order.how === h ? "is-on" : ""} onClick={() => setOrder({ ...order, how: h })} data-order-how={h}>
                    {HOW_LABEL[h]}
                  </button>
                ))}
              </div>
            </div>
            {order.how === "SUPPLIER" ? (
              order.newSupplier ? (
                <>
                  <label className="bps-fld bps-fld--wide">
                    <span className="bps-lbl">Supplier</span>
                    <input className="bps-in" value={order.newSupplier.name} onChange={(e) => setOrder({ ...order, newSupplier: { ...order.newSupplier!, name: e.target.value } })} placeholder="ABC Lumber" data-order-supplier-name />
                  </label>
                  <label className="bps-fld">
                    <span className="bps-lbl">Their email (the PO goes there)</span>
                    <input className="bps-in" type="email" value={order.newSupplier.email} onChange={(e) => setOrder({ ...order, newSupplier: { ...order.newSupplier!, email: e.target.value } })} placeholder="orders@abclumber.com" />
                  </label>
                  <label className="bps-fld">
                    <span className="bps-lbl">Delivers in (days)</span>
                    <input className="bps-in" inputMode="numeric" value={order.newSupplier.leadDays} onChange={(e) => setOrder({ ...order, newSupplier: { ...order.newSupplier!, leadDays: e.target.value.replace(/\D/g, "") } })} placeholder={String(DEFAULT_LEAD_DAYS)} />
                  </label>
                  {suppliers.length ? (
                    <button type="button" className="bps-btn bps-btn--ghost bps-fld--wide" onClick={() => setOrder({ ...order, newSupplier: null })}>
                      Pick one you have instead
                    </button>
                  ) : null}
                </>
              ) : (
                <label className="bps-fld bps-fld--wide">
                  <span className="bps-lbl">Supplier</span>
                  <select
                    className="bps-in"
                    value={order.supplierId}
                    onChange={(e) => {
                      if (e.target.value === "__new") return setOrder({ ...order, newSupplier: { name: "", email: "", leadDays: "" } });
                      const sup = suppliers.find((x) => x.id === e.target.value);
                      const st = stageOf(pickedLines.find((m) => m.stageId)?.stageId ?? null);
                      setOrder({ ...order, supplierId: e.target.value, orderBy: isoDay(orderByDate(st?.startsAt, sup?.leadDays ?? DEFAULT_LEAD_DAYS)) ?? order.orderBy });
                    }}
                    data-order-supplier
                  >
                    {suppliers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.email ? "" : " (no email)"}
                      </option>
                    ))}
                    <option value="__new">+ New supplier…</option>
                  </select>
                </label>
              )
            ) : null}
            {order.how === "BUYER" ? (
              <>
                <label className="bps-fld bps-fld--wide">
                  <span className="bps-lbl">Who buys it</span>
                  <select className="bps-in" value={order.buyerWorkerId} onChange={(e) => setOrder({ ...order, buyerWorkerId: e.target.value })} data-order-buyer>
                    <option value="">Someone else (type their name below)</option>
                    {buying.crew.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.texts ? " · gets a text" : w.email ? " · gets an email" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!order.buyerWorkerId ? (
                  <>
                    <label className="bps-fld">
                      <span className="bps-lbl">Name</span>
                      <input className="bps-in" value={order.buyerName} onChange={(e) => setOrder({ ...order, buyerName: e.target.value })} placeholder="Carlos" data-order-buyer-name />
                    </label>
                    <label className="bps-fld">
                      <span className="bps-lbl">Email (the link goes there)</span>
                      <input className="bps-in" type="email" value={order.buyerEmail} onChange={(e) => setOrder({ ...order, buyerEmail: e.target.value })} placeholder="carlos@example.com" />
                    </label>
                  </>
                ) : null}
                <p className="bps-hint bps-fld--wide">They open the link, tick what they bought and type what they paid — no sign-in. You can copy the link from the order and send it any way you like.</p>
              </>
            ) : null}
            {order.how === "STOCK" ? <p className="bps-hint bps-fld--wide">These lines are marked in from your own stock at once. The truck list on the job is unchanged.</p> : null}
            {order.how !== "STOCK" ? (
              <>
                <label className="bps-fld">
                  <span className="bps-lbl">Order by</span>
                  <input className="bps-in" type="date" value={order.orderBy} onChange={(e) => setOrder({ ...order, orderBy: e.target.value })} />
                </label>
                <label className="bps-fld">
                  <span className="bps-lbl">Expected on site</span>
                  <input className="bps-in" type="date" value={order.expectedAt} onChange={(e) => setOrder({ ...order, expectedAt: e.target.value })} />
                </label>
                <label className="bps-fld">
                  <span className="bps-lbl">Quoted ($, optional)</span>
                  <input className="bps-in" inputMode="decimal" value={order.quoted} onChange={(e) => setOrder({ ...order, quoted: e.target.value })} placeholder="4,200" />
                </label>
              </>
            ) : null}
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Note {order.how === "SUPPLIER" ? "to the supplier" : order.how === "BUYER" ? "to the buyer" : ""}</span>
              <input className="bps-in" value={order.note} onChange={(e) => setOrder({ ...order, note: e.target.value })} maxLength={1000} placeholder={order.how === "SUPPLIER" ? "Deliver to the back alley; call before" : ""} />
            </label>
            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">The lines</span>
              <div className="bps-plate">
                {pickedLines.map((m) => (
                  <div key={m.id} className={s.pick} style={{ alignItems: "center", gap: 8 }}>
                    <span className={s.pickName}>{m.name}</span>
                    <input className="bps-in" style={{ width: 88, minHeight: 36 }} inputMode="decimal" value={order.qty[m.id] ?? ""} onChange={(e) => setOrder({ ...order, qty: { ...order.qty, [m.id]: e.target.value } })} aria-label={`Quantity of ${m.name}`} />
                    <span className={s.pickMeta}>{m.unit}</span>
                  </div>
                ))}
              </div>
            </div>
            {orderErr ? <div className="bps-err bps-fld--wide">{orderErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* ═══ ONE LINE ═══ */}
      <BlueprintSheet
        open={line !== null}
        onClose={() => setLine(null)}
        title={line?.id ? "Edit line" : "Add a line"}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setLine(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void saveLine()} data-line-save>
              {line?.id ? "Save" : "Add"}
            </button>
          </>
        }
      >
        {line ? (
          <div className="bps-form">
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Material</span>
              <input className="bps-in" value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} maxLength={200} placeholder="2×10×16 PT joists" autoFocus data-line-name />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">How many</span>
              <input className="bps-in" inputMode="decimal" value={line.quantity} onChange={(e) => setLine({ ...line, quantity: e.target.value })} />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Unit</span>
              <input className="bps-in" value={line.unit} onChange={(e) => setLine({ ...line, unit: e.target.value })} maxLength={20} placeholder="each" />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Cost each ($, optional)</span>
              <input className="bps-in" inputMode="decimal" value={line.unitCost} onChange={(e) => setLine({ ...line, unitCost: e.target.value })} />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">For which stage</span>
              <select className="bps-in" value={line.stageId} onChange={(e) => setLine({ ...line, stageId: e.target.value })}>
                <option value="">No stage</option>
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Product link (optional)</span>
              <input className="bps-in" value={line.productUrl} onChange={(e) => setLine({ ...line, productUrl: e.target.value })} placeholder="https://…" />
            </label>
            {lineErr ? <div className="bps-err bps-fld--wide">{lineErr}</div> : null}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* ═══ WHAT CAME IN ═══ */}
      <BlueprintSheet
        open={receiving !== null}
        onClose={() => busy === null && setReceiving(null)}
        title={receiving ? `Order ${receiving.order.number} delivered` : ""}
        description="What came in, line by line. Anything short goes back on the to-buy list and the office is told."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setReceiving(null)} disabled={busy !== null}>
              Cancel
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={busy !== null}
              data-receive-save
              onClick={() => {
                if (!receiving) return;
                const o = receiving.order;
                const lines = o.lines.map((l) => ({ lineId: l.id, receivedQty: num(receiving.got[l.id] ?? "0") }));
                setReceiving(null);
                void run(`receive:${o.id}`, async () => {
                  const r = await receiveProjectOrder(o.id, lines);
                  return r.missing.length ? `Delivered — ${r.missing.map((m) => `${m.name} ${qtyWords(m.short, m.unit)} short`).join(", ")}. Back on the list.` : "Delivered in full.";
                });
              }}
            >
              Save
            </button>
          </>
        }
      >
        {receiving ? (
          <div className="bps-form">
            <div className="bps-fld bps-fld--wide">
              <div className="bps-plate">
                {receiving.order.lines.map((l) => (
                  <div key={l.id} className={s.pick} style={{ alignItems: "center", gap: 8 }}>
                    <span className={s.pickName}>{l.name}</span>
                    <input className="bps-in" style={{ width: 88, minHeight: 36 }} inputMode="decimal" value={receiving.got[l.id] ?? ""} onChange={(e) => setReceiving({ ...receiving, got: { ...receiving.got, [l.id]: e.target.value } })} aria-label={`Received of ${l.name}`} data-receive-qty />
                    <span className={s.pickMeta}>of {qtyWords(l.quantity, l.unit)}</span>
                    <button type="button" className="bps-btn bps-btn--ghost" style={{ minHeight: 32, padding: "0 8px" }} onClick={() => setReceiving({ ...receiving, got: { ...receiving.got, [l.id]: "0" } })}>
                      Missing
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <p className="bps-hint bps-fld--wide">Order {receiving.order.number} · {orderWho(receiving.order)}</p>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
