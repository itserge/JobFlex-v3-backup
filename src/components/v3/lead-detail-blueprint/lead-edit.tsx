"use client";

// EDIT A LEAD (owner, 2026-11-10: "leads come from Facebook … they don't have an address yet, just a phone number.
// After we get all the information, edit this lead and fill it in, so it goes through the CRM with everything").
// The contact card's Edit details: the Blueprint sheet (a desk dialog, a bottom sheet on a phone) with the name,
// phone, email, the job's address in its four parts, and the project. Saving goes through actions/leads
// updateLeadDetails → lib/leads/edit: what differs changes, an emptied field is cleared, the trail says what, and the
// client record the lead already is gets its blanks filled. The phone's Leads list opens it with `?edit=1`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { updateLeadDetails } from "@/actions/leads";
import { splitLeadAddress } from "@/lib/leads/details";
import styles from "./lead-detail.module.css";

const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => styles[n as string] ?? n).join(" ");

export type LeadEditFields = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  projectType: string | null;
};

type Form = Record<keyof LeadEditFields, string>;

const formOf = (l: LeadEditFields): Form => ({
  name: l.name ?? "",
  phone: l.phone ?? "",
  email: l.email ?? "",
  address: l.address ?? "",
  city: l.city ?? "",
  state: l.state ?? "",
  zip: l.zip ?? "",
  projectType: l.projectType ?? "",
});

export function LeadEdit({ leadId, initial, autoOpen = false }: { leadId: string; initial: LeadEditFields; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = (v: boolean) => {
    busyRef.current = v;
    setBusyState(v);
  };
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const opened = useRef(false);

  const openSheet = useCallback(() => {
    setForm(formOf(initial));
    setError(null);
    setNote(null);
    setOpen(true);
  }, [initial]);

  // The phone's Leads list sends "Edit details" here as ?edit=1: open once, then drop the flag so a refresh
  // doesn't open it again.
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    openSheet();
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch {
      /* the flag stays in the address bar; harmless */
    }
  }, [autoOpen, openSheet]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    // The last refusal is about what was there; once a field changes it no longer stands.
    setError(null);
  };

  // A whole line pasted into the street ("1420 Maple St, Seattle, WA 98101") lands in its four fields — only
  // while the city, state and ZIP are still empty, so nothing typed there is replaced.
  function splitStreet() {
    if (form.city.trim() || form.state.trim() || form.zip.trim()) return;
    const parts = splitLeadAddress(form.address);
    if (!parts.city) return;
    setForm((f) => ({ ...f, address: parts.address ?? "", city: parts.city ?? "", state: parts.state ?? "", zip: parts.zip ?? "" }));
  }

  async function save() {
    if (busyRef.current) return;
    if (!form.name.trim()) {
      setError("The lead needs a name.");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await updateLeadDetails(leadId, {
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        projectType: form.projectType,
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setOpen(false);
      setNote({ tone: "ok", text: r.message });
      if (r.changed) router.refresh();
    } catch {
      setError("The lead couldn't be saved just now. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // Stable, so the sheet's Escape listener is not re-bound on every keystroke; a save in flight keeps it open.
  const closeSheet = useCallback(() => {
    if (!busyRef.current) setOpen(false);
  }, []);

  return (
    <div className={cx("edit-row")}>
      <button type="button" className={cx("btn", "btn-ghost", "btn--sm", "edit-btn")} onClick={openSheet} aria-haspopup="dialog" data-lead-edit>
        <PencilLine size={14} strokeWidth={2.2} aria-hidden="true" />
        Edit details
      </button>
      <p className={cx("visits-note", "edit-note")} data-tone={note?.tone} role="status" aria-live="polite" data-lead-edit-note>
        {note?.text ?? ""}
      </p>

      <BlueprintSheet
        open={open}
        onClose={closeSheet}
        title="Edit lead"
        description="What you fill in here also fills the blanks on their client record."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={() => void save()} disabled={busy} data-lead-edit-save>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form
          className="bps-form"
          data-lead-edit-form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="bps-fld bps-fld--wide">
            <span>Name</span>
            <input ref={nameRef} className="bps-in" name="name" value={form.name} maxLength={120} onChange={set("name")} autoComplete="off" required />
          </label>
          <label className="bps-fld">
            <span>Phone</span>
            <input className="bps-in" name="phone" type="tel" inputMode="tel" value={form.phone} maxLength={40} onChange={set("phone")} placeholder="(425) 555-0112" autoComplete="off" />
          </label>
          <label className="bps-fld">
            <span>Email</span>
            <input className="bps-in" name="email" type="email" inputMode="email" value={form.email} maxLength={200} onChange={set("email")} placeholder="name@mail.com" autoComplete="off" />
          </label>
          <label className="bps-fld bps-fld--wide">
            <span>Job street address</span>
            <input className="bps-in" name="address" value={form.address} maxLength={200} onChange={set("address")} onBlur={splitStreet} placeholder="1420 Maple St" autoComplete="off" />
          </label>
          <label className={cx("bps-fld", "edit-city")}>
            <span>City</span>
            <input className="bps-in" name="city" value={form.city} maxLength={80} onChange={set("city")} autoComplete="off" />
          </label>
          <label className={cx("bps-fld", "edit-st")}>
            <span>State</span>
            <input className="bps-in" name="state" value={form.state} maxLength={40} onChange={set("state")} placeholder="WA" autoComplete="off" />
          </label>
          <label className={cx("bps-fld", "edit-zip")}>
            <span>ZIP</span>
            <input className="bps-in" name="zip" inputMode="numeric" value={form.zip} maxLength={20} onChange={set("zip")} placeholder="98101" autoComplete="off" />
          </label>
          <label className="bps-fld bps-fld--wide">
            <span>Project</span>
            <input className="bps-in" name="projectType" value={form.projectType} maxLength={80} onChange={set("projectType")} placeholder="Deck, roof repair, fence…" autoComplete="off" />
          </label>
          {error ? (
            <p className="bps-err" role="alert" data-lead-edit-error>
              {error}
            </p>
          ) : null}
          {/* Enter in a field saves, as the footer's button does. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </BlueprintSheet>
    </div>
  );
}
