import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { accessRole, fullAccessFor } from "@/lib/fullAccessRule";
import { clientIp, rateLimitShared, MINUTE } from "@/lib/rateLimit";

/** The database did not answer during sign-in. Reaches the browser as
 *  `error=CredentialsSignin&code=db` — a retry, not a wrong password. */
class DbUnavailable extends CredentialsSignin {
  code = "db";
}
/** The sign-in brake fired (too many attempts for this address or from this
 *  IP). It used to answer `null` — "Email or password is wrong" — so a person
 *  locked out by an automated run kept retyping a password that was right
 *  (2026-09-20). Reaches the client as `code=throttled-<minutes>`; the limit
 *  itself is unchanged, and it fires the same for any address, existing or
 *  not, so the message never says whether an account is there. */
class Throttled extends CredentialsSignin {
  code: string;
  constructor(retryAfterMs: number) {
    super();
    this.code = `throttled-${Math.max(1, Math.ceil(retryAfterMs / 60_000))}`;
  }
}

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      activeOrgId?: string | null;
      role?: string | null;
      orgName?: string | null;
      // Discriminates an app USER (org member) from a platform INFLUENCER
      // (separate login, no org). The JWT identifies WHO; server guards
      // re-read the DB to authorize WHAT (defends against the 7-day stale JWT).
      principal?: string | null;
      influencerId?: string | null;
      // Credential epoch stamped at sign-in; requireUser rejects the session when
      // it drifts from the DB (password reset bumps it). Absent on pre-existing
      // JWTs → treated as 0, which matches a never-reset user.
      credentialVersion?: number | null;
    };
  }
  interface User {
    /** Influencer sign-in only: Influencer.sessionVersion at the moment of sign-in. */
    sessionVersion?: number;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  // Errors land on the sign-in page with ?error=…, where the page prints a
  // sentence instead of NextAuth's bare /api/auth/error JSON (owner, 2026-09-03).
  pages: { signIn: "/auth/login", error: "/auth/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // Always show Google's account chooser. Without it, a browser that has
      // already consented is bounced through Google invisibly, so the landing's
      // "Sign up with Google" looked like it skipped Google and went straight
      // to the signup form (owner's report, 2026-09-04).
      authorization: { params: { prompt: "select_account" } },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "").toLowerCase().trim();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;
        // Cross-instance brake on credential stuffing / bcrypt CPU burn. The
        // same "wrong credentials" answer, so a refused attempt looks like a miss.
        const ip = await clientIp();
        const [byIp, byEmail] = await Promise.all([
          rateLimitShared(`login:ip:${ip}`, 30, MINUTE),
          rateLimitShared(`login:email:${email}`, 8, 15 * MINUTE),
        ]);
        if (!byIp.ok || !byEmail.ok) throw new Throttled(Math.max(byIp.retryAfterMs, byEmail.retryAfterMs));
        let user: { id: string; email: string; name: string | null; image: string | null; hashedPassword: string | null } | null;
        try {
          user = await db.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, image: true, hashedPassword: true, activeOrgId: true },
          });
        } catch (err) {
          // A database that cannot be reached is not a wrong password and not
          // a misconfiguration. Auth.js maps any plain throw here to
          // `error=Configuration` — the page then said "check server logs,
          // often the database isn't connected" for what was one dropped
          // Neon connection (2026-09-12). A CredentialsSignin with its own
          // code reaches the client as `code=db`, which the login pages name.
          console.error("[auth] user lookup failed:", err instanceof Error ? err.message : err);
          throw new DbUnavailable();
        }
        if (!user?.hashedPassword) return null;
        const ok = await bcrypt.compare(password, user.hashedPassword);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
    // The signup hand-off. A User created by completePendingSignup (after a
    // paid Stripe checkout) is signed in with a single-use ticket instead of
    // being sent to the login wall — see lib/signinTicket.ts. No password
    // crosses the wire and no rate-limit bypass exists: a ticket is spent on
    // first presentation and lives five minutes.
    Credentials({
      id: "signup-ticket",
      name: "Signup ticket",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(raw) {
        const ticket = String(raw?.ticket ?? "");
        if (!ticket) return null;
        const ip = await clientIp();
        const byIp = await rateLimitShared(`signup-ticket:ip:${ip}`, 20, MINUTE);
        if (!byIp.ok) return null;
        const { consumeSigninTicket } = await import("@/lib/signinTicket");
        const userId = await consumeSigninTicket(ticket);
        if (!userId) return null;
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, image: true },
        });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    // Separate influencer login surface, same NextAuth instance. Authenticates
    // against the Influencer table (not User), so it carries no org/membership.
    Credentials({
      id: "influencer",
      name: "Influencer",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "").toLowerCase().trim();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;
        // Cross-instance brake on credential stuffing / bcrypt CPU burn. The
        // same "wrong credentials" answer, so a refused attempt looks like a miss.
        const ip = await clientIp();
        const [byIp, byEmail] = await Promise.all([
          rateLimitShared(`login:ip:${ip}`, 30, MINUTE),
          rateLimitShared(`login:email:${email}`, 8, 15 * MINUTE),
        ]);
        if (!byIp.ok || !byEmail.ok) return null;
        const inf = await db.influencer.findUnique({
          where: { email },
          select: { id: true, email: true, displayName: true, hashedPassword: true, status: true, sessionVersion: true },
        });
        if (!inf?.hashedPassword) return null;
        // Suspended/terminated influencers cannot obtain a session at all
        // (guards also re-check status on every privileged call).
        if (inf.status === "SUSPENDED" || inf.status === "TERMINATED") return null;
        const ok = await bcrypt.compare(password, inf.hashedPassword);
        if (!ok) return null;
        return { id: inf.id, email: inf.email, name: inf.displayName, sessionVersion: inf.sessionVersion };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user?.email) return false;
      if (account?.provider === "google") {
        const email = user.email;
        const existing = await db.user.findUnique({
          where: { email },
          select: { id: true, hashedPassword: true },
        });
        if (existing) {
          /* A password account already owns this address. Google may still
             sign it in when Google itself vouches for the address
             (`email_verified`) — the pre-account-takeover risk is a provider
             that does NOT verify, and Google does. An unverified Google
             address is still refused (owner's report of AccessDenied on a
             Google signup for an email that was already registered,
             2026-09-03). */
          if (existing.hashedPassword) {
            const verified =
              (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
            if (!verified) {
              console.warn("[auth] google refused: unverified address on a password account", email);
              return false;
            }
            /* AUDIT TRAIL for the link. Google vouching for the address is
               the same trust a password reset places in the inbox, but the
               owner should still hear about it: an ActivityEvent on their org
               and a mail to the address itself. Both best-effort — a mail
               outage must not turn into a sign-in outage. */
            console.info("[auth] google linked to a password account", email);
            void (async () => {
              try {
                const member = await db.membership.findFirst({
                  where: { userId: existing.id },
                  select: { organizationId: true },
                });
                if (member) {
                  await db.activityEvent.create({
                    data: {
                      organizationId: member.organizationId,
                      actorId: existing.id,
                      kind: "AUTH_GOOGLE_LINKED",
                      summary: `Google sign-in was used for ${email} for the first time`,
                    },
                  });
                }
                const { sendEmail } = await import("@/lib/sdk/resend");
                await sendEmail({
                  to: email,
                  subject: "Google sign-in was used on your JobFlex account",
                  kind: "security",
                  html: `<p>Someone signed in to your JobFlex account (${email}) with Google just now.</p><p>If that was you, nothing to do. If it wasn't, reset your password from the sign-in page right away — that signs every session out.</p>`,
                });
              } catch (err) {
                console.warn("[auth] google-link notice failed:", err);
              }
            })();
          }
          /* AN ACCOUNT FROM THE SHORT SIGN-UP (no code, lib/accountClaim):
             Google vouching for the address claims it — every other session
             ends and the address is marked confirmed. Unvouched: refused. */
          const { isUnclaimed, claimIfUnclaimed } = await import("@/lib/accountClaim");
          if (await isUnclaimed(existing.id)) {
            if ((profile as { email_verified?: boolean } | undefined)?.email_verified !== true) return false;
            await claimIfUnclaimed(existing.id);
          }
          return true;
        }
        /* A NEW ADDRESS. Nothing is created here any more (owner's rule,
           2026-09-03: no account without a paid plan). The Google-verified
           identity is parked (lib/googleSignup) and the visitor is sent into
           the signup at step 2 with it; the account exists only when checkout
           comes back. Returning a URL from this callback is Auth.js's
           "refuse, and go here instead". */
        const verified =
          (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
        if (!verified) return false;
        /* A throwaway-mail domain behind a Google account (a Workspace on a
           disposable domain) is refused before it is parked: the register
           page says why on step 1 (lib/disposableEmail). */
        const { isDisposableEmail } = await import("@/lib/disposableEmail");
        if (isDisposableEmail(email)) return "/auth/register?gerr=disposable";
        try {
          const { stashGoogleSignup, googleSignupReturnUrl } = await import("@/lib/googleSignup");
          const handle = await stashGoogleSignup({
            email,
            name: user.name ?? null,
            image: user.image ?? null,
          });
          return await googleSignupReturnUrl(handle);
        } catch (e) {
          console.error("[auth] could not park the Google identity for signup:", e);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      // Influencer login (separate Credentials provider) — no org/membership lookup.
      if (account?.provider === "influencer" && user) {
        token.id = user.id;
        token.principal = "INFLUENCER";
        token.influencerId = user.id;
        token.activeOrgId = null;
        token.role = null;
        token.orgName = null;
        // The partner's credential epoch, stamped once (see `cv` below for why
        // it is never rewritten on refresh). A password change bumps the row;
        // requireInfluencer refuses the old stamp on every request, and the
        // refresh below ends the session outright.
        token.sv = user.sessionVersion ?? 0;
        token.svCheckedAt = Date.now();
        return token;
      }
      if (!user && token.principal === "INFLUENCER" && token.influencerId) {
        const checkedAt = typeof token.svCheckedAt === "number" ? token.svCheckedAt : 0;
        if (Date.now() - checkedAt > 60_000) {
          const row = await db.influencer.findUnique({
            where: { id: String(token.influencerId) },
            select: { sessionVersion: true },
          });
          if (!row) return null;
          if ((row.sessionVersion ?? 0) !== (typeof token.sv === "number" ? token.sv : 0)) return null;
          token.svCheckedAt = Date.now();
        }
        return token;
      }
      if (user?.email) {
        const dbUser = await db.user.findUnique({
          where: { email: user.email },
          include: {
            memberships: {
              include: { organization: { select: { id: true, name: true } } },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.principal = "USER";
          token.influencerId = null;
          token.cv = dbUser.credentialVersion ?? 0;
          const m = dbUser.memberships[0];
          token.activeOrgId = dbUser.activeOrgId ?? m?.organizationId ?? null;
          // The middleware's route gate reads this: a platform admin's seat never narrows it (lib/fullAccess).
          token.role = accessRole(m?.role, fullAccessFor(dbUser, m));
          token.orgName = m?.organization?.name ?? null;
          token.orgCheckedAt = Date.now();
        }
      }

      // Keep the org claims honest between logins. The role/org above were
      // stamped at sign-in and otherwise live for the JWT's 7 days — so a role
      // change (promotion, demotion, org switch) left middleware's route-gate
      // enforcing the OLD role until the user signed out. Server guards always
      // re-read the DB, but the middleware gate bounced every nav click to the
      // stale role's home page. Re-read the membership on a short TTL so the
      // token converges within a minute of any role change.
      if (!user && token.principal !== "INFLUENCER" && token.id) {
        const checkedAt = typeof token.orgCheckedAt === "number" ? token.orgCheckedAt : 0;
        if (Date.now() - checkedAt > 60_000) {
          const dbUser = await db.user.findUnique({
            where: { id: String(token.id) },
            include: {
              memberships: {
                include: { organization: { select: { id: true, name: true } } },
                orderBy: { createdAt: "asc" },
              },
            },
          });
          // Revocation is decided HERE, not healed here. The credential epoch
          // (`cv`) is stamped once at sign-in and must never be rewritten from
          // the DB on refresh — doing so made every stolen token valid again
          // within a minute of a password reset (requireUser compared the DB
          // value against a copy of itself). A drift, or a deleted user, ends
          // the session: returning null clears the cookie on route-handler
          // paths and yields no session in RSC/server actions.
          if (!dbUser) return null;
          const stampedCv = typeof token.cv === "number" ? token.cv : 0;
          if ((dbUser.credentialVersion ?? 0) !== stampedCv) return null;
          const m =
            dbUser.memberships.find((x) => x.organizationId === dbUser.activeOrgId) ??
            dbUser.memberships[0];
          token.activeOrgId = dbUser.activeOrgId ?? m?.organizationId ?? null;
          // The middleware's route gate reads this: a platform admin's seat never narrows it (lib/fullAccess).
          token.role = accessRole(m?.role, fullAccessFor(dbUser, m));
          token.orgName = m?.organization?.name ?? null;
          token.orgCheckedAt = Date.now();
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? "");
        session.user.activeOrgId = (token.activeOrgId as string | null) ?? null;
        session.user.role = (token.role as string | null) ?? null;
        session.user.orgName = (token.orgName as string | null) ?? null;
        // Default to USER so pre-existing JWTs (issued before this field) behave.
        session.user.principal = (token.principal as string | null) ?? "USER";
        session.user.influencerId = (token.influencerId as string | null) ?? null;
        session.user.credentialVersion =
          token.principal === "INFLUENCER" ? ((token.sv as number | null) ?? 0) : ((token.cv as number | null) ?? 0);
      }
      return session;
    },
  },
});
