// REPLIES BY EMAIL — the switch (2026-11-08, the subcontractors plan, part 2). Read from the environment in one place,
// by the sender (lib/projectSubs/server puts the reply address on the request email) and by the receiver
// (lib/subInbound/server, the webhook). No database here, so either side can import it without a cycle.

import { inboundAddress } from "./shared";

export type InboundConfig = {
  /** SUBS_INBOUND_ENABLED="true" and a domain: request emails carry the reply address. */
  enabled: boolean;
  /** The receiving subdomain (quotes.jobflex.app), lower-cased. */
  domain: string | null;
  /** The webhook's signing secret (whsec_…). */
  secret: string | null;
};

export function inboundConfig(env: NodeJS.ProcessEnv = process.env): InboundConfig {
  const domain = env.SUBS_INBOUND_DOMAIN?.trim().toLowerCase() || null;
  const secret = env.SUBS_INBOUND_WEBHOOK_SECRET?.trim() || null;
  const enabled = env.SUBS_INBOUND_ENABLED?.trim().toLowerCase() === "true" && Boolean(domain);
  return { enabled, domain, secret };
}

/** The Reply-To for a request's email when replies by email are on; null keeps the company's own reply-to. */
export function inboundReplyTo(token: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const c = inboundConfig(env);
  return c.enabled && c.domain ? inboundAddress(token, c.domain) : null;
}
