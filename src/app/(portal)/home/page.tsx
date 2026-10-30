// /home — "lost the link?" (2026-10-03; Blueprint since 2026-10-30). The home
// portal has no password: the homeowner types their email and the link goes
// there, never on screen (lib/home/portal says why). The answer is the same
// whether or not a home exists for the address.
import type { Metadata } from "next";
import Link from "next/link";
import { PortalFrame } from "@/components/v3/homeowner-portal-blueprint/portal-frame";
import { FindHome } from "@/components/v3/homeowner-portal-blueprint/find-home";
import s from "@/components/v3/homeowner-portal-blueprint/portal.module.css";

export const metadata: Metadata = {
  title: "Your home page — JobFlex Home",
  description: "Get the link to your JobFlex home page by email.",
  robots: { index: false, follow: false },
};

export default function FindHomePage() {
  return (
    <PortalFrame homeKey={null} tab={null}>
      <section className={s.card} aria-labelledby="find-title" style={{ maxWidth: 560 }}>
        <div className={s.stack}>
          <p className={s.kicker}>Your home page</p>
          <h1 id="find-title" className={s.h1}>Lost the link?</h1>
          <p className={s.text}>There&apos;s no password — the link is the key. Type the email you used for your project and we&apos;ll send the link there.</p>
        </div>
        <FindHome />
      </section>
      <p className={s.muted}>
        New here? <Link className={s.link} href="/homeowner">Send your first project</Link> — your home page comes with it.
      </p>
    </PortalFrame>
  );
}
