"use client";
// The change-order sheet — a crew lead on a phone, plywood found on tear-off
// day, sent to the client in under a minute:
//   1. the type is pre-picked (plywood), the material pre-selected for the
//      roof, the price pre-filled from the company's own last price;
//   2. areas: sheets × 32, length × width, or sq ft straight in — several
//      named areas on one order;
//   3. a reason and photos from the camera;
//   4. one tap: Send. The running total, tax and the client's new contract
//      total sit above the buttons the whole time.
// Mounted as a plain React child on the job pages and as a React island on
// the proposals page (the MaterialsSheet precedent). Either way it renders
// through a PORTAL to <body>: the blueprint pages reset margin and padding on
// everything under `.content`, which flattened the sheet's own layout when it
// rendered in place (2026-09-13, live screenshot).
import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ChevronDown, Copy, ExternalLink, Link2, Pencil, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  createChangeOrder,
  deleteChangeOrder,
  getChangeOrderContext,
  markChangeOrderApproved,
  sendChangeOrder,
  sendChangeOrderInvoice,
  updateChangeOrder,
  uploadChangeOrderPhoto,
  voidChangeOrder,
  type ChangeOrderContext,
  type ChangeOrderRowDto,
} from "@/actions/changeOrders";
import { CO_UNITS, CUSTOM_TYPE, PLYWOOD_TYPE, linesForAreas, totalsForLines, type CoArea, type CoLine, type CoTypeDef, type CoUnit } from "@/lib/changeOrders/types";

const CUSTOM_ITEM = "__custom";
const UNITS: CoUnit[] = CO_UNITS;

type AreaMode = "sheets" | "lw" | "sqft";
interface AreaRow extends CoArea {
  mode: AreaMode;
  sheets: string;
  length: string;
  width: string;
  sqft: string;
}
interface FreeLine {
  id: string;
  name: string;
  quantity: string;
  unit: CoUnit;
  unitPrice: string;
  kind: "material" | "labor";
}

const uid = () => Math.random().toString(36).slice(2, 8);
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

function areaSqft(a: AreaRow, sheetSqft: number): number {
  if (a.mode === "sheets") return r1(num(a.sheets) * sheetSqft);
  if (a.mode === "lw") return r1(num(a.length) * num(a.width));
  return r1(num(a.sqft));
}
function newArea(label = ""): AreaRow {
  return { id: uid(), label, quantity: 0, mode: "sheets", sheets: "", length: "", width: "", sqft: "" };
}

export function ChangeOrderSheet({
  open,
  onClose,
  jobId,
  proposalId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  jobId?: string;
  proposalId?: string;
  /** After a save or send — the page reloads its list. */
  onDone?: () => void;
}) {
  // No useRouter here on purpose: on the proposals page this sheet is a React
  // ISLAND (react-island.ts) with no App Router context, and useRouter would
  // throw before the first paint. Pages inside the app tree refresh through
  // `onDone`; the island keeps its own list current.
  const [ctx, setCtx] = React.useState<ChangeOrderContext | null>(null);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const [type, setType] = React.useState<CoTypeDef>(PLYWOOD_TYPE);
  const [itemKey, setItemKey] = React.useState<string>(PLYWOOD_TYPE.items[0].key);
  const [customName, setCustomName] = React.useState("");
  const [customThickness, setCustomThickness] = React.useState("");
  const [unitPrice, setUnitPrice] = React.useState("");
  const [areas, setAreas] = React.useState<AreaRow[]>([newArea()]);
  const [free, setFree] = React.useState<FreeLine[]>([]);
  const [title, setTitle] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [photos, setPhotos] = React.useState<Array<{ id: string; url: string }>>([]);
  const [uploading, setUploading] = React.useState(false);
  const [busy, setBusy] = React.useState<"draft" | "send" | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Manager mode: the existing change orders, with their next action each.
  // The form opens on "New change order", or at once when there are none.
  const [orders, setOrders] = React.useState<ChangeOrderRowDto[]>([]);
  const [creating, setCreating] = React.useState(true);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null);
  // Rows open to show their lines, photos and history; a DRAFT can be edited in place.
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Context on open: the parent, tax, the roof family, the company's prices.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  const key = `${jobId ?? ""}|${proposalId ?? ""}`;
  React.useEffect(() => {
    if (!open || openedFor === key) return;
    let cancelled = false;
    getChangeOrderContext({ jobId, proposalId })
      .then((c) => {
        if (cancelled) return;
        setCtx(c);
        setOpenedFor(key);
        setLoadErr(null);
        setOrders(c.orders);
        setCreating(c.orders.length === 0);
        const plywood = c.isRoofing ? c.types.find((t) => t.key === PLYWOOD_TYPE.key) ?? null : null;
        const first = plywood ?? c.types.find((t) => t.key === CUSTOM_TYPE.key) ?? c.types[0] ?? CUSTOM_TYPE;
        setType(first);
        if (first.areas) {
          const fam = c.roofFamily;
          const smart = first.smartDefault ? (fam ? first.smartDefault.byRoofFamily[fam] : undefined) ?? first.smartDefault.fallback : first.items[0]?.key ?? CUSTOM_ITEM;
          setItemKey(smart);
          const pref = c.prefs[`${first.key}:${smart}`];
          const item = first.items.find((i) => i.key === smart);
          setUnitPrice(String(pref?.unitPrice ?? item?.suggestedUnitPrice ?? ""));
          setTitle(first.key === PLYWOOD_TYPE.key ? "Plywood replacement" : first.label);
          setAreas([{ ...newArea(), sheets: pref?.lastQuantity ? String(Math.round(pref.lastQuantity / (first.helpers.sheetSqft ?? 32))) : "" }]);
        } else {
          setTitle("");
          setFree([{ id: uid(), name: "", quantity: "1", unit: "each", unitPrice: "", kind: "material" }]);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : "Couldn't load");
      });
    return () => {
      cancelled = true;
    };
  }, [open, key, jobId, proposalId, openedFor]);

  function pickType(t: CoTypeDef) {
    setType(t);
    setTitle(t.key === PLYWOOD_TYPE.key ? "Plywood replacement" : t.key === "custom" ? "" : t.label);
    const first = t.items[0]?.key ?? CUSTOM_ITEM;
    pickItem(first, t);
    if (!t.areas && free.length === 0) setFree([{ id: uid(), name: "", quantity: "1", unit: t.unit, unitPrice: "", kind: "material" }]);
  }
  function pickItem(k: string, t: CoTypeDef = type) {
    setItemKey(k);
    if (k === CUSTOM_ITEM) {
      setUnitPrice(String(ctx?.prefs[`${t.key}:custom`]?.unitPrice ?? ""));
      return;
    }
    const item = t.items.find((i) => i.key === k);
    const pref = ctx?.prefs[`${t.key}:${k}`];
    setUnitPrice(String(pref?.unitPrice ?? item?.suggestedUnitPrice ?? ""));
  }

  const item = type.items.find((i) => i.key === itemKey) ?? null;
  const itemLabel = itemKey === CUSTOM_ITEM ? customName.trim() || "Custom material" : item?.label ?? "";
  const itemThickness = itemKey === CUSTOM_ITEM ? customThickness.trim() || undefined : item?.thickness;
  const sheetSqft = type.helpers.sheetSqft ?? 32;

  const lines: CoLine[] = React.useMemo(() => {
    const areaLines = type.areas
      ? linesForAreas({
          itemLabel,
          itemKey: itemKey === CUSTOM_ITEM ? "custom" : itemKey,
          thickness: itemThickness,
          unit: type.unit,
          unitPrice: num(unitPrice),
          areas: areas.map((a) => ({ id: a.id, label: a.label, quantity: areaSqft(a, sheetSqft) })),
        })
      : [];
    // Extra lines ride on any type — on a plywood order, the labor or disposal
    // that goes with it; on a generic one, everything.
    const extra = free
      .filter((l) => l.name.trim() && num(l.quantity) > 0)
      .map((l) => ({ key: "custom", name: l.name.trim(), quantity: num(l.quantity), unit: l.unit, unitPrice: num(l.unitPrice), kind: l.kind }));
    return [...areaLines, ...extra];
  }, [type, itemLabel, itemKey, itemThickness, unitPrice, areas, sheetSqft, free]);

  const totals = totalsForLines(lines, ctx?.taxRate ?? 0, true);
  const totalSqft = type.areas ? areas.reduce((s, a) => s + areaSqft(a, sheetSqft), 0) : 0;
  const newContract = ctx?.contractBefore != null ? Math.round((ctx.contractBefore + totals.total) * 100) / 100 : null;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 6)) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("Couldn't read the photo"));
          r.readAsDataURL(f);
        });
        const up = await uploadChangeOrderPhoto(dataUrl, f.name);
        setPhotos((p) => [...p, up]);
      }
    } catch (err) {
      toast.error("Photo not added", err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function reset() {
    setAreas([newArea()]);
    setFree([]);
    setReason("");
    setPhotos([]);
    setCustomName("");
    setCustomThickness("");
    setEditingId(null);
    setOpenedFor(null);
  }

  /** Load a DRAFT back into the form. Area lines carry `meta.area`; anything else is an extra line. */
  function startEdit(o: ChangeOrderRowDto) {
    const t = ctx?.types.find((x) => x.key === o.kind) ?? (o.kind === PLYWOOD_TYPE.key ? PLYWOOD_TYPE : CUSTOM_TYPE);
    setType(t);
    setTitle(o.title);
    setReason(o.reason ?? "");
    setPhotos(o.photos.map((ph) => ({ id: ph.id, url: ph.url })));
    const areaLines = t.areas ? o.lines.filter((l) => l.meta && "area" in l.meta) : [];
    const extra = o.lines.filter((l) => !areaLines.includes(l));
    if (t.areas) {
      const first = areaLines[0];
      const key = first?.key ?? t.items[0]?.key ?? CUSTOM_ITEM;
      const known = t.items.some((i) => i.key === key);
      setItemKey(known ? key : CUSTOM_ITEM);
      if (!known && first) {
        setCustomName(first.name.split(" · ")[0]);
        setCustomThickness(String(first.meta?.thickness ?? ""));
      }
      setUnitPrice(String(first?.unitPrice ?? ""));
      setAreas(areaLines.length ? areaLines.map((l) => ({ ...newArea(String(l.meta?.area ?? "")), mode: "sqft" as AreaMode, sqft: String(l.quantity) })) : [newArea()]);
    }
    setFree(extra.map((l) => ({ id: uid(), name: l.name, quantity: String(l.quantity), unit: l.unit, unitPrice: String(l.unitPrice), kind: l.kind })));
    setEditingId(o.id);
    setCreating(true);
  }
  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(send: boolean) {
    if (!ctx) return;
    if (!title.trim()) {
      toast.error("Give the change a title");
      return;
    }
    if (lines.length === 0) {
      toast.error(type.areas ? "Enter at least one area" : "Add at least one line");
      return;
    }
    if (send && !ctx.clientEmail && !ctx.clientPhone) {
      toast.error("No email or phone on the client", "Add one to the client first, or save as a draft and copy the link.");
      return;
    }
    setBusy(send ? "send" : "draft");
    try {
      const rememberKey = itemKey === CUSTOM_ITEM ? "custom" : itemKey;
      const payload = {
        ...(jobId ? { jobId } : {}),
        ...(proposalId ? { proposalId } : {}),
        kind: type.key,
        title: title.trim(),
        reason: reason.trim() || null,
        lines,
        photos,
        taxable: true,
        send,
        remember: type.areas ? [{ itemKey: rememberKey, unitPrice: num(unitPrice), lastQuantity: totalSqft }] : [],
      };
      const res = editingId ? await updateChangeOrder(editingId, payload) : await createChangeOrder(payload);
      const label = "number" in res ? `Change order #${res.number}` : "Change order";
      if (send) {
        const s = res.sent;
        const how = [s?.email === "sent" ? "email" : null, s?.sms === "sent" ? "text" : null].filter(Boolean).join(" + ");
        toast.success(`${label} sent${how ? ` by ${how}` : ""}`, `${money(res.total)} — the client approves from the link.`);
      } else {
        toast.success(editingId ? "Change order updated" : `${label} saved as a draft`);
      }
      reset();
      reloadOrders();
      onDone?.();
    } catch (err) {
      toast.error("Couldn't save", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  /** The free-line editor: a "more of…" picker off the proposal, then lines with material/labor, measure, price. */
  function linesEditor(heading: string, hint: string | null) {
    if (!ctx) return null;
    return (
      <div>
              {ctx.proposalLines.length > 0 && (
                <div className="mb-3">
                  <div className="quiet-caps mb-1.5">More of something already on the proposal</div>
                  <select
                    className="h-10 w-full rounded-[var(--r-md)] hairline bg-white/70 px-3 text-[14px]"
                    value=""
                    onChange={(e) => {
                      const pl = ctx.proposalLines[Number(e.target.value)];
                      if (!pl) return;
                      setFree((rows) => {
                        const blank = rows.length === 1 && !rows[0].name.trim() && !rows[0].unitPrice ? [] : rows;
                        return [...blank, { id: uid(), name: pl.name, quantity: "1", unit: pl.unit, unitPrice: String(pl.unitPrice), kind: pl.kind }];
                      });
                      if (!title.trim()) setTitle(`More ${pl.name}`.slice(0, 120));
                    }}
                  >
                    <option value="">Pick a line to add more of it…</option>
                    {ctx.proposalLines.map((pl, i) => (
                      <option key={i} value={i}>
                        {pl.name} · {money(pl.unitPrice)}/{pl.unit} · {pl.kind}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[color:var(--ink-muted)] mt-1.5">Same unit and price as the proposal — just enter how much more. Change the price if this work costs differently.</p>
                </div>
              )}
              <div className="quiet-caps mb-1.5">{heading}</div>
              {hint && <p className="text-[11px] text-[color:var(--ink-muted)] -mt-1 mb-1.5">{hint}</p>}
              <div className="space-y-2">
                {free.map((l) => {
                  const lineTotal = Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100;
                  return (
                    <div key={l.id} className="bps-plate space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Input value={l.name} onChange={(e) => setFree((rows) => rows.map((r) => (r.id === l.id ? { ...r, name: e.target.value } : r)))} placeholder={l.kind === "labor" ? "Extra labor — e.g. demo old fence" : "Item — e.g. 6 ft cedar panel"} />
                        <div className="bps-seg">
                          {(["material", "labor"] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setFree((rows) => rows.map((r) => (r.id === l.id ? { ...r, kind: k } : r)))}
                              className={cn("capitalize", l.kind === k && "is-on")}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                        <button type="button" className="h-8 w-8 grid place-items-center text-[color:var(--ink-muted)] hover:text-rose-700 shrink-0" aria-label="Remove line" onClick={() => setFree((rows) => rows.filter((r) => r.id !== l.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-[80px_1fr_100px_1fr] gap-1.5 items-center">
                        <Input type="number" inputMode="decimal" value={l.quantity} onChange={(e) => setFree((rows) => rows.map((r) => (r.id === l.id ? { ...r, quantity: e.target.value } : r)))} placeholder="Qty" aria-label="Quantity" />
                        <select className="h-10 rounded-[var(--r-md)] hairline bg-white/70 px-2 text-[13px]" value={l.unit} aria-label="Unit" onChange={(e) => setFree((rows) => rows.map((r) => (r.id === l.id ? { ...r, unit: e.target.value as CoUnit } : r)))}>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                        <Input type="number" inputMode="decimal" step="0.01" prefix={<span className="text-[11px]">$</span>} value={l.unitPrice} onChange={(e) => setFree((rows) => rows.map((r) => (r.id === l.id ? { ...r, unitPrice: e.target.value } : r)))} placeholder="0.00" aria-label="Unit price" />
                        <span className={cn("text-right tabular text-[13px]", lineTotal < 0 ? "text-rose-700" : "text-[color:var(--ink-soft)]")}>
                          {lineTotal < 0 ? "−" : ""}{money(Math.abs(lineTotal))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFree((rows) => [...rows, { id: uid(), name: "", quantity: "1", unit: "each", unitPrice: "", kind: "material" }])}>
                  Material
                </Button>
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFree((rows) => [...rows, { id: uid(), name: "", quantity: "1", unit: "hour", unitPrice: "", kind: "labor" }])}>
                  Labor
                </Button>
              </div>
              <p className="text-[11px] text-[color:var(--ink-muted)] mt-1.5">Measures: each, sq ft, linear ft, square (100 sq ft of roof), hour, lot. A negative price is a credit back to the client.</p>
      </div>
    );
  }

  const canSend = Boolean(ctx && (ctx.clientEmail || ctx.clientPhone));
  // false on the server and during hydration, true once the client is up —
  // createPortal needs a document, and the sheet is closed until then anyway.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  /** Reload the list after a row action, without reopening the form. */
  function reloadOrders() {
    setOpenedFor(null);
    setCreating(false);
  }
  async function rowAction(id: string, label: string, fn: () => Promise<unknown>, after?: (r: unknown) => void) {
    setRowBusy(id);
    try {
      const r = await fn();
      after?.(r);
      reloadOrders();
      onDone?.();
    } catch (err) {
      toast.error(`Couldn't ${label}`, err instanceof Error ? err.message : undefined);
    } finally {
      setRowBusy(null);
    }
  }
  function copyLink(o: ChangeOrderRowDto) {
    const url = `${window.location.origin}/co/${o.publicToken}`;
    void navigator.clipboard?.writeText(url);
    toast.success("Approval link copied", url);
  }
  const STATUS: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: "Draft", cls: "bg-zinc-100 text-zinc-700" },
    SENT: { label: "Awaiting approval", cls: "bg-amber-100 text-amber-800" },
    APPROVED: { label: "Approved", cls: "bg-emerald-100 text-emerald-800" },
    DECLINED: { label: "Declined", cls: "bg-rose-100 text-rose-800" },
    VOID: { label: "Withdrawn", cls: "bg-zinc-100 text-zinc-500" },
  };

  if (!mounted) return null;
  return createPortal(
    <BlueprintSheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={creating ? (editingId ? "Edit change order" : "New change order") : "Change orders"}
      description={ctx ? (creating ? `${ctx.contextTitle} · #${ctx.nextNumber}` : ctx.contextTitle) : undefined}
      width="min(600px, 100vw)"
      footer={
        !creating ? (
          <div className="flex items-center justify-end gap-2 pr-[72px] sm:pr-0">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : (
        <div className="flex flex-col gap-3 pr-[72px] sm:pr-0">
          <div className="flex items-end justify-between gap-3">
            <div className="text-[12px] text-[color:var(--ink-muted)] leading-snug">
              <div>
                {money(totals.subtotal)}
                {totals.taxTotal > 0 ? ` + ${money(totals.taxTotal)} tax` : " · no tax"}
              </div>
              {newContract != null && <div>Contract becomes <b className="text-[color:var(--ink)]">{money(newContract)}</b></div>}
            </div>
            <div className="text-right">
              <div className="quiet-caps">This change</div>
              <div className={cn("font-display text-[24px] leading-none tabular", totals.total < 0 ? "text-rose-700" : "text-[color:var(--ink)]")}>
                {totals.total < 0 ? "−" : "+"}{money(Math.abs(totals.total))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr] sm:flex sm:justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="outline" loading={busy === "draft"} disabled={!ctx || busy != null} onClick={() => submit(false)}>
              {editingId ? "Save changes" : "Save draft"}
            </Button>
            <Button loading={busy === "send"} disabled={!ctx || busy != null || !canSend} onClick={() => submit(true)} title={canSend ? undefined : "The client has no email or phone"}>
              {editingId ? "Save & send" : "Send for approval"}
            </Button>
          </div>
        </div>
        )
      }
    >
      {loadErr ? (
        <p className="text-[13px] text-rose-700">{loadErr}</p>
      ) : !ctx ? (
        <p className="text-[13px] text-[color:var(--ink-muted)]">Loading…</p>
      ) : !creating ? (
        <div className="space-y-3">
          {orders.length === 0 && <p className="text-[13px] text-[color:var(--ink-muted)]">No change orders yet.</p>}
          {orders.map((o) => {
            const st = STATUS[o.status] ?? STATUS.DRAFT;
            const working = rowBusy === o.id;
            return (
              <div key={o.id} className="bps-plate space-y-2">
                <button type="button" className="w-full text-left flex items-start justify-between gap-3" onClick={() => toggleRow(o.id)} aria-expanded={expanded.has(o.id)}>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium truncate flex items-center gap-1.5">
                      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-[color:var(--ink-muted)] transition-transform", expanded.has(o.id) ? "" : "-rotate-90")} />
                      <span className="truncate">#{o.number ?? "—"} · {o.title}</span>
                    </div>
                    <div className="text-[11px] text-[color:var(--ink-muted)] mt-0.5 pl-5">
                      {o.lines.length ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}` : "one amount"}
                      {o.taxTotal > 0 ? ` · ${money(o.taxTotal)} tax` : ""}
                      {o.approvedName ? ` · signed by ${o.approvedName}` : ""}
                      {o.declineReason ? ` · "${o.declineReason}"` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tabular text-[15px]">{o.total >= 0 ? "+" : "−"}{money(Math.abs(o.total))}</div>
                    <span className={cn("bps-badge mt-1", st.cls)}>{st.label}</span>
                  </div>
                </button>
                {expanded.has(o.id) && (
                  <div className="pl-5 space-y-2 text-[12px]">
                    {o.lines.length > 0 && (
                      <ul className="divide-y divide-[color:var(--ink-line)] hairline rounded-[var(--r-md)] overflow-hidden">
                        {o.lines.map((l, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                            <span className="min-w-0 truncate">
                              {l.name}
                              <span className="text-[color:var(--ink-muted)]"> · {Number.isInteger(l.quantity) ? l.quantity : l.quantity.toFixed(1)} {l.unit} × {money(l.unitPrice)}{l.kind === "labor" ? " · labor" : ""}</span>
                            </span>
                            <span className="tabular shrink-0">{money(Math.round(l.quantity * l.unitPrice * 100) / 100)}</span>
                          </li>
                        ))}
                        {o.taxTotal > 0 && (
                          <li className="flex items-baseline justify-between gap-3 px-2.5 py-1.5 text-[color:var(--ink-muted)]"><span>Sales tax</span><span className="tabular">{money(o.taxTotal)}</span></li>
                        )}
                      </ul>
                    )}
                    {o.reason && <p className="whitespace-pre-wrap text-[color:var(--ink-soft)]">{o.reason}</p>}
                    {o.photos.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {o.photos.map((ph) => (
                          <a key={ph.id} href={ph.url} target="_blank" rel="noopener noreferrer" className="h-14 w-14 rounded-[var(--r-sm)] overflow-hidden hairline">
                            {/* eslint-disable-next-line @next/next/no-img-element -- Blob URL the contractor uploaded */}
                            <img src={ph.url} alt="" className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-[color:var(--ink-muted)]">
                      Created {new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {o.sentAt ? ` · sent ${new Date(o.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                      {o.approvedAt ? ` · approved ${new Date(o.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${o.approvedVia === "in_person" ? " in person" : ""}` : ""}
                      {o.declinedAt ? ` · declined ${new Date(o.declinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                    </div>
                    {o.status !== "DRAFT" && (
                      <a href={`/co/${o.publicToken}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[color:var(--ink)] underline underline-offset-2">
                        <ExternalLink className="h-3 w-3" /> Open the client&apos;s page
                      </a>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {o.status === "DRAFT" && (
                    <>
                      <Button size="sm" variant="outline" disabled={working} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => startEdit(o)}>
                        Edit
                      </Button>
                      <Button size="sm" loading={working} disabled={!canSend} icon={<Send className="h-3.5 w-3.5" />} onClick={() => rowAction(o.id, "send", () => sendChangeOrder(o.id), () => toast.success("Sent for approval"))}>
                        Send for approval
                      </Button>
                      <Button size="sm" variant="ghost" disabled={working} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => rowAction(o.id, "delete", () => deleteChangeOrder(o.id))}>
                        Delete
                      </Button>
                    </>
                  )}
                  {o.status === "SENT" && (
                    <>
                      <Button size="sm" variant="outline" disabled={working} icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => copyLink(o)}>
                        Copy link
                      </Button>
                      <Button size="sm" variant="outline" loading={working} icon={<Check className="h-3.5 w-3.5" />} onClick={() => {
                        const name = window.prompt("Client's full name, as they approved it in person:");
                        if (!name || name.trim().length < 2) return;
                        void rowAction(o.id, "record the approval", () => markChangeOrderApproved(o.id, name.trim()), () => toast.success("Approved in person"));
                      }}>
                        Mark approved
                      </Button>
                      <Button size="sm" variant="ghost" disabled={working} icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => rowAction(o.id, "withdraw", () => voidChangeOrder(o.id))}>
                        Withdraw
                      </Button>
                    </>
                  )}
                  {o.status === "APPROVED" && o.total > 0 && ctx.proposalId && (
                    invoiceFor === o.id ? (
                      <div className="w-full space-y-1.5">
                        <div className="text-[11px] text-[color:var(--ink-muted)]">Send the invoice — how should the client pay?</div>
                        <div className="flex flex-wrap gap-1.5">
                          {ctx.invoice.card && (
                            <Button size="sm" loading={working} onClick={() => rowAction(o.id, "send the invoice", () => sendChangeOrderInvoice(o.id, "card"), (r) => { const x = r as { email: string; sms: string }; toast.success("Invoice sent · card", `email ${x.email}, text ${x.sms}`); setInvoiceFor(null); })}>
                              Card{ctx.invoice.cardVia.length ? ` · ${ctx.invoice.cardVia.join(" / ")}` : ""}
                            </Button>
                          )}
                          {ctx.invoice.bank && (
                            <Button size="sm" variant="outline" loading={working} onClick={() => rowAction(o.id, "send the invoice", () => sendChangeOrderInvoice(o.id, "bank"), (r) => { const x = r as { email: string; sms: string }; toast.success("Invoice sent · bank transfer", `email ${x.email}, text ${x.sms}`); setInvoiceFor(null); })}>
                              Bank transfer
                            </Button>
                          )}
                          {(ctx.invoice.card || ctx.invoice.bank) && (
                            <Button size="sm" variant="ghost" loading={working} onClick={() => rowAction(o.id, "send the invoice", () => sendChangeOrderInvoice(o.id, "any"), (r) => { const x = r as { email: string; sms: string }; toast.success("Invoice sent", `email ${x.email}, text ${x.sms}`); setInvoiceFor(null); })}>
                              Client&apos;s choice
                            </Button>
                          )}
                          {!ctx.invoice.card && !ctx.invoice.bank && (
                            <span className="text-[12px] text-rose-700">No way to pay is set up — connect a processor or add bank-transfer details in Settings → Integrations / Payments.</span>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setInvoiceFor(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button size="sm" disabled={working} icon={<Send className="h-3.5 w-3.5" />} onClick={() => setInvoiceFor(o.id)}>
                          Send invoice
                        </Button>
                        <Button size="sm" variant="ghost" disabled={working} icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copyLink(o)}>
                          Copy link
                        </Button>
                      </>
                    )
                  )}
                </div>
              </div>
            );
          })}
          <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            New change order
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {orders.length > 0 && (
            <button type="button" className="text-[12px] text-[color:var(--ink-muted)] underline underline-offset-2" onClick={() => { reset(); setCreating(false); }}>
              ← Back to the {orders.length} existing change order{orders.length === 1 ? "" : "s"}
            </button>
          )}
          {/* Type */}
          {ctx.types.length > 1 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {ctx.types.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => pickType(t)}
                  className={cn("bps-chip", type.key === t.key && "is-on")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {type.intro && <p className="text-[12px] text-[color:var(--ink-muted)] -mt-2">{type.intro}</p>}

          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type.key === "custom" ? "e.g. Extra 20 ft of fence, west side" : undefined} />

          {type.areas ? (
            <>
              {/* Material */}
              <div>
                <div className="quiet-caps mb-1.5">Material</div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-10 rounded-[var(--r-md)] hairline bg-white/70 px-3 text-[14px]"
                    value={itemKey}
                    onChange={(e) => pickItem(e.target.value)}
                  >
                    {type.items.map((i) => (
                      <option key={i.key} value={i.key}>{i.label}</option>
                    ))}
                    {type.allowCustomItem && <option value={CUSTOM_ITEM}>Custom…</option>}
                  </select>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    prefix={<span className="text-[11px]">$</span>}
                    suffix={<span className="text-[11px]">/{type.unit}</span>}
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    placeholder={item ? String(item.suggestedUnitPrice) : "0.00"}
                  />
                </div>
                {itemKey === CUSTOM_ITEM && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Material name" />
                    <Input value={customThickness} onChange={(e) => setCustomThickness(e.target.value)} placeholder="Thickness (5/8 in)" />
                  </div>
                )}
                <p className="text-[11px] text-[color:var(--ink-muted)] mt-1.5">
                  {ctx.prefs[`${type.key}:${itemKey === CUSTOM_ITEM ? "custom" : itemKey}`]
                    ? "Your own price — installed, material + labor. Change it and it is remembered."
                    : "Suggested price, installed (material + labor). Set your own and it is remembered."}
                </p>
              </div>

              {/* Areas */}
              <div>
                <div className="quiet-caps mb-1.5">Areas to replace</div>
                <div className="space-y-2">
                  {areas.map((a, i) => (
                    <div key={a.id} className="bps-plate space-y-2">
                      <div className="flex items-center gap-2">
                        <Input value={a.label} onChange={(e) => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, label: e.target.value } : r)))} placeholder={i === 0 ? "North slope" : "Around chimney"} />
                        <div className="bps-seg">
                          {(["sheets", "lw", "sqft"] as AreaMode[]).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, mode: m } : r)))}
                              className={cn(a.mode === m && "is-on")}
                            >
                              {m === "sheets" ? "Sheets" : m === "lw" ? "L × W" : "Sq ft"}
                            </button>
                          ))}
                        </div>
                        {areas.length > 1 && (
                          <button type="button" className="h-8 w-8 grid place-items-center text-[color:var(--ink-muted)] hover:text-rose-700" aria-label="Remove area" onClick={() => setAreas((rows) => rows.filter((r) => r.id !== a.id))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {a.mode === "sheets" && (
                          <Input type="number" inputMode="numeric" value={a.sheets} onChange={(e) => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, sheets: e.target.value } : r)))} placeholder="How many" suffix={<span className="text-[11px]">sheets 4×8</span>} />
                        )}
                        {a.mode === "lw" && (
                          <>
                            <Input type="number" inputMode="decimal" value={a.length} onChange={(e) => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, length: e.target.value } : r)))} placeholder="Length" suffix={<span className="text-[11px]">ft</span>} />
                            <span className="text-[color:var(--ink-muted)]">×</span>
                            <Input type="number" inputMode="decimal" value={a.width} onChange={(e) => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, width: e.target.value } : r)))} placeholder="Width" suffix={<span className="text-[11px]">ft</span>} />
                          </>
                        )}
                        {a.mode === "sqft" && (
                          <Input type="number" inputMode="decimal" value={a.sqft} onChange={(e) => setAreas((rows) => rows.map((r) => (r.id === a.id ? { ...r, sqft: e.target.value } : r)))} placeholder="Area" suffix={<span className="text-[11px]">sq ft</span>} />
                        )}
                        <span className="text-[12px] tabular text-[color:var(--ink-soft)] shrink-0 w-[132px] text-right">
                          {areaSqft(a, sheetSqft)} {type.unit} · {money(Math.round(areaSqft(a, sheetSqft) * num(unitPrice) * 100) / 100)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} className="mt-2" onClick={() => setAreas((rows) => [...rows, newArea()])}>
                  Another area
                </Button>
                {totalSqft > 0 && (
                  <div className="text-[12px] text-[color:var(--ink-muted)] mt-1">
                    {totalSqft} {type.unit} total · about {Math.ceil(totalSqft / sheetSqft)} sheet{Math.ceil(totalSqft / sheetSqft) === 1 ? "" : "s"}
                  </div>
                )}
              </div>
              {linesEditor("Other items on this change order", "Optional — extra labor, disposal, anything beyond the sheathing itself.")}
            </>
          ) : (
            linesEditor("Lines", null)
          )}

          {type.reason && (
            <Textarea label="Why" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type.reasonPlaceholder} />
          )}

          {type.photos && (
            <div>
              <div className="quiet-caps mb-1.5">Photos of the damage</div>
              <div className="flex flex-wrap gap-2">
                {photos.map((ph) => (
                  <div key={ph.id} className="relative h-20 w-20 rounded-[var(--r-md)] overflow-hidden hairline">
                    {/* eslint-disable-next-line @next/next/no-img-element -- just uploaded to Blob */}
                    <img src={ph.url} alt="" className="h-full w-full object-cover" />
                    <button type="button" className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded-full bg-black/60 text-white" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((x) => x.id !== ph.id))}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="h-20 w-20 rounded-[var(--r-md)] hairline grid place-items-center text-[color:var(--ink-muted)] hover:text-[color:var(--ink)] bg-white/50"
                  aria-label="Add photo"
                >
                  <Camera className="h-5 w-5" />
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
              </div>
              <p className="text-[11px] text-[color:var(--ink-muted)] mt-1.5">{uploading ? "Uploading…" : "JPEG, PNG or WebP, 5 MB each. The client sees them on the approval page."}</p>
            </div>
          )}

          {type.pricingNote && <p className="text-[11px] text-[color:var(--ink-muted)]">{type.pricingNote}</p>}
        </div>
      )}
    </BlueprintSheet>,
    document.body,
  );
}
