import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cronAuth";
import { decryptSecret, isSecretBoxConfigured } from "@/lib/crypto/secretBox";
import { encryptTokens, refreshSquareToken } from "@/lib/payments/squareConnect";
import { PaymentConnectionStatus } from "@/lib/prismaEnums";
import { notifyPaymentIssue } from "@/lib/notify";
import { isSquareEnabled } from "@/lib/sdk/square";

export const runtime = "nodejs";

// Square access tokens live 30 days; refresh tokens never expire. Square asks
// platforms to refresh at least weekly, so: daily, anything expiring inside
// 7 days gets a new pair. A failed refresh marks the row RESTRICTED (buttons
// disappear for clients) and tells the owner to reconnect.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSquareEnabled() || !isSecretBoxConfigured()) {
    return NextResponse.json({ skipped: true, reason: "square not configured" });
  }

  const due = await db.paymentConnection.findMany({
    where: {
      provider: "SQUARE",
      status: { not: PaymentConnectionStatus.REVOKED },
      squareRefreshTokenEnc: { not: null },
      OR: [
        { squareTokenExpiresAt: null },
        { squareTokenExpiresAt: { lt: new Date(Date.now() + REFRESH_WINDOW_MS) } },
      ],
    },
  });

  let refreshed = 0;
  let failed = 0;
  for (const conn of due) {
    try {
      const refreshToken = decryptSecret(conn.squareRefreshTokenEnc!);
      const tokens = await refreshSquareToken(refreshToken);
      await db.paymentConnection.update({
        where: { id: conn.id },
        data: {
          ...encryptTokens(tokens),
          squareMerchantId: tokens.merchantId,
          status: PaymentConnectionStatus.ACTIVE,
          lastError: null,
        },
      });
      refreshed += 1;
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "refresh failed";
      console.error("[cron/square-refresh]", conn.organizationId, msg);
      await db.paymentConnection.update({
        where: { id: conn.id },
        data: { status: PaymentConnectionStatus.RESTRICTED, lastError: msg.slice(0, 500) },
      });
      await notifyPaymentIssue({
        organizationId: conn.organizationId,
        title: "Square connection needs renewing",
        detail:
          "We couldn't renew your Square access token, so clients can't pay through Square until you reconnect it in Settings → Integrations / Payments.",
      }).catch(() => {});
    }
  }

  return NextResponse.json({ due: due.length, refreshed, failed });
}
