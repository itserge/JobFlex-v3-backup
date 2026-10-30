"use client";

// YOUR DETAILS, in Blueprint (2026-10-30): what the homeowner told us, edited
// in place — the next project starts with these. The email stays as it is:
// it is the identity the home hangs on. Same actions as before
// (actions/homePortal updateHomeDetails, emailMyHomeLink).

import * as React from "react";
import { useRouter } from "next/navigation";
import { emailMyHomeLink, updateHomeDetails } from "@/actions/homePortal";
import type { HomeDashboard } from "@/lib/home/portal";
import { phoneShown } from "./view";
import s from "./portal.module.css";

export function DetailsForm({ homeKey, details }: { homeKey: string; details: HomeDashboard["details"] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState(details);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await updateHomeDetails({ key: homeKey, name: f.name, phone: f.phone, address: f.address, city: f.city, state: f.state, zip: f.zip });
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setNote({ ok: false, text: "That didn't save — check the fields and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function sendLink() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await emailMyHomeLink(homeKey);
      setNote({ ok: r.ok, text: r.ok ? r.note : r.error });
    } catch {
      setNote({ ok: false, text: "That didn't send — try again in a minute." });
    } finally {
      setBusy(false);
    }
  }

  const cityState = [details.city, details.state].filter(Boolean).join(", ");
  const where = [
    details.address,
    cityState && !details.address.toLowerCase().includes(cityState.toLowerCase()) ? cityState : "",
    details.zip && !details.address.includes(details.zip) ? details.zip : "",
  ].filter(Boolean).join(", ");

  return (
    <div className={s.stack} style={{ gap: 14 }}>
      {!open ? (
        <>
          <dl className={s.facts}>
            <div><dt>Name</dt><dd>{details.name}</dd></div>
            <div><dt>Email</dt><dd>{details.email}</dd></div>
            <div><dt>Phone</dt><dd>{details.phone ? phoneShown(details.phone) : "—"}</dd></div>
            <div><dt>Home</dt><dd>{where || "—"}</dd></div>
          </dl>
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={() => setOpen(true)} data-details-edit>Edit details</button>
            <button type="button" className={s.btnText} disabled={busy} onClick={() => void sendLink()}>{busy ? "Sending…" : "Email me this link"}</button>
          </div>
        </>
      ) : (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className={s.formRow}>
            <label className={s.field}><span>Name</span><input value={f.name} onChange={set("name")} autoComplete="name" required maxLength={80} name="home-name" /></label>
            <label className={s.field}><span>Phone</span><input value={f.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" maxLength={40} name="home-phone" /></label>
          </div>
          <label className={s.field}><span>Street address</span><input value={f.address} onChange={set("address")} autoComplete="street-address" maxLength={160} name="home-address" /></label>
          <div className={`${s.formRow} ${s.formRow3}`}>
            <label className={s.field}><span>City</span><input value={f.city} onChange={set("city")} autoComplete="address-level2" maxLength={80} name="home-city" /></label>
            <label className={s.field}><span>State</span><input value={f.state} onChange={set("state")} autoComplete="address-level1" maxLength={40} name="home-state" /></label>
            <label className={s.field}><span>ZIP</span><input value={f.zip} onChange={set("zip")} autoComplete="postal-code" inputMode="numeric" maxLength={16} name="home-zip" /></label>
          </div>
          <p className={s.fine}>Your email, {details.email}, is how we know it&apos;s you — it stays as it is.</p>
          <div className={s.actions}>
            <button type="submit" className={s.btnPrimary} disabled={busy || f.name.trim().length < 2}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={s.btnText} disabled={busy} onClick={() => { setF(details); setOpen(false); }}>Cancel</button>
          </div>
        </form>
      )}
      {note && <p className={note.ok ? s.ok : s.err} role={note.ok ? "status" : "alert"}>{note.text}</p>}
    </div>
  );
}
