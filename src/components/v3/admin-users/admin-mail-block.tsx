"use client";

// ADMIN · "Unsubscribe from emails" inside the account sheet (2026-11-11).
//
// Where the address stands on the do-not-email list (lib/mailBlock), read on open, and one button: put it on (an
// account owner's JobFlex letters stop too — actions/mailBlock adminBlockEmail) or take it off. What still reaches a
// listed address is said beside the button: sign-in codes, password resets, receipts, invoices, billing notices.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "@/components/ui/Toast";
import { adminBlockEmail, adminMailBlockState, adminUnblockEmail } from "@/actions/mailBlock";
import { SOURCE_LABEL, type MailBlock } from "@/lib/mailBlockShared";
import { longDate } from "@/lib/format";
import shared from "./admin-shared.module.css";
import s from "./admin-users.module.css";
import { makeCx, errorMessage } from "./admin-kit";

const cx = makeCx(s, shared);

export function MailBlockControl({ email }: { email: string }) {
  const [block, setBlock] = useState<MailBlock | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminMailBlockState(email).then(
      (r) => setBlock(r.block),
      () => setBlock(null),
    );
  }, [email]);

  async function flip() {
    if (busy || block === undefined) return;
    setBusy(true);
    try {
      if (block) {
        const r = await adminUnblockEmail(email);
        if (!r.ok) throw new Error(r.error);
        setBlock(null);
        toast.success("Taken off the list", `${email} gets JobFlex emails again.`);
      } else {
        const r = await adminBlockEmail({ email, reason: "Unsubscribed from the account card by a JobFlex admin" });
        if (!r.ok) throw new Error(r.error);
        setBlock(r.block);
        toast.success("Unsubscribed", `${email} gets only sign-in codes, receipts and billing notices now.`);
      }
    } catch (err) {
      toast.error("Couldn't change it", errorMessage(err, "Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("au-mb")} data-mail-block={block ? "on" : block === null ? "off" : "loading"}>
      <p className={cx("au-mb-state")}>
        {block === undefined
          ? "Checking the do-not-email list…"
          : block
            ? `On the do-not-email list · ${SOURCE_LABEL[block.source]}${block.at ? ` · ${longDate(block.at)}` : ""}`
            : "Gets JobFlex emails."}
        {block?.reason ? <span className={cx("au-mb-why")}>{block.reason}</span> : null}
      </p>
      <div className={cx("au-mb-row")}>
        <button type="button" className={cx("btn", block ? "btn-ghost" : "btn-danger", "btn-sm")} onClick={() => void flip()} disabled={busy || block === undefined} data-mail-block-btn>
          {busy ? "Saving…" : block ? "Take off the list" : "Unsubscribe from emails"}
        </button>
        <Link className={cx("btn", "btn-ghost", "btn-sm", "au-mail-link")} href={"/admin/mail/blocked" as Route}>
          Do-not-email list
        </Link>
      </div>
      <p className={cx("au-mb-fine")}>Sign-in codes, password resets, receipts, invoices and billing notices still go.</p>
    </div>
  );
}
