import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL_OPERATOR_NAME, LEGAL_SECURITY_EMAIL, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex · Security",
  description: "How JobFlex protects workspace data, connected accounts like Ramp, and how to report a security issue.",
  alternates: { canonical: "/security" },
};

// SECURITY (2026-11-01) — the controls as the code has them: lib/crypto/secretBox (AES-256-GCM), lib/media/privateStore
// (private Vercel Blob), lib/ramp (scopes, signed webhooks, revoke on disconnect), lib/auth (bcrypt, rate-limited
// sign-in). Change this page when those change; no claim here without the code behind it.
export default function SecurityPage() {
  const mail = <a href={`mailto:${LEGAL_SECURITY_EMAIL}`}>{LEGAL_SECURITY_EMAIL}</a>;
  return (
    <LegalPage title="Security" number="03" summary="How we protect your workspace and the accounts you connect to it, and how to report a problem." updated={LEGAL_UPDATED.security}>
      <p>
        {LEGAL_OPERATOR_NAME} (&ldquo;JobFlex&rdquo;) builds business software for contractors. This page
        describes the safeguards we use today. It is part of how we handle information under our{" "}
        <Link href="/privacy">Privacy policy</Link>.
      </p>
      <h2 id="access">1. Who can access data</h2>
      <p>
        Only the founder has administrative access to JobFlex&apos;s production systems: hosting, database,
        file storage, and source code. No other employee or contractor has that access. Inside the product,
        each company works in its own workspace and sees only its own records; connecting, disconnecting,
        and managing an integration such as Ramp requires an owner or manager role in that workspace.
      </p>
      <h2 id="infrastructure">2. Infrastructure and storage</h2>
      <ul>
        <li><strong>Hosting:</strong> the application runs on Vercel and is served only over HTTPS.</li>
        <li><strong>Database:</strong> a managed PostgreSQL database (Neon), reached only over TLS.</li>
        <li><strong>Files:</strong> receipts and other private documents are kept in a private Vercel Blob
          store and served only to the workspace they belong to.</li>
        <li><strong>Passwords:</strong> stored only as bcrypt hashes; sign-in attempts are rate-limited.</li>
      </ul>
      <h2 id="connections">3. Connected accounts</h2>
      <p>
        When you connect a service such as Ramp, Square, Meta, or Gmail, JobFlex receives OAuth tokens rather
        than your password. Tokens are encrypted at rest with AES-256-GCM before they are stored, under a key
        held only in our hosting provider&apos;s encrypted environment settings and never in source code.
        Tokens are used only on our servers and are refreshed automatically before they expire.
      </p>
      <p>
        For Ramp specifically: JobFlex requests only the scopes the integration uses, and does not request
        access to full card numbers. Events Ramp sends to JobFlex are accepted only after their HMAC-SHA256
        signature is verified. When a workspace disconnects Ramp, JobFlex deletes its webhook in Ramp, revokes
        the access and refresh tokens with Ramp, and deletes the stored connection. Expenses already booked to
        your jobs stay in your workspace&apos;s records.
      </p>
      <h2 id="use">4. How connected data is used</h2>
      <p>
        Data from a connected account is used only to provide that integration&apos;s features to the
        workspace that connected it. We do not sell it or share it with other customers.
      </p>
      <h2 id="certifications">5. Certifications</h2>
      <p>
        JobFlex is an early-stage company and does not currently hold a SOC 2, ISO 27001, or third-party
        penetration-test report. We will update this page if that changes.
      </p>
      <h2 id="report">6. Reporting a security issue</h2>
      <p>
        If you believe you have found a vulnerability or that your account has been accessed without
        permission, email {mail}. Please include enough detail to reproduce the issue, and give us a
        reasonable time to fix it before disclosing it publicly. We will provide security-incident notices
        when applicable law requires them.
      </p>
    </LegalPage>
  );
}
