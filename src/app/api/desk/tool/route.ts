// A tool a call's brief brought (voice/call.mjs: anything but the desk's own). JobFlex's outreach calls bring theirs
// (lib/outreach/server outreachTool); the desk's call to a lead brings do_not_call (lib/aiDesk/leadCalls
// leadCallTool); a call about a lead SmartBook is scheduling — the desk calling them, or them calling the desk — also
// brings request_time and not_interested (lib/smartbook/phone smartBookTool). Any other call brings none, and
// asking here is refused.
import { appBaseUrl } from "@/lib/appUrl";
import { leadCallTool } from "@/lib/aiDesk/leadCalls";
import { outreachTool } from "@/lib/outreach/server";
import { smartBookTool } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const args = r.body.args && typeof r.body.args === "object" ? (r.body.args as Record<string, unknown>) : {};
  const name = str(r.body.name, 60);
  if (r.token.kind === "outreach") {
    const out = await outreachTool(r.token, name, args, (await appBaseUrl()).replace(/\/$/, ""));
    return json(out, out.ok ? 200 : 400);
  }
  const out = r.token.kind === "lead" && name === "do_not_call" ? await leadCallTool(r.token, name, args) : await smartBookTool(r.token, name, args);
  return json(out, out.ok ? 200 : out.error.startsWith("no such tool") ? 404 : 400);
}
