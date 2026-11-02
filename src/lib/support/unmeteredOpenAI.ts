import "server-only";
// THE PLATFORM'S OWN OPENAI CLIENT — for the AI work JobFlex pays for itself: answering support tickets
// (lib/support/aiSupport) and SmartHelp's answers (lib/smarthelp/server).
//
// The shared client (lib/sdk/openai getOpenAI) bills each call to the request's organization through lib/trialMeter,
// and these calls run inside a CUSTOMER's request — their trial AI budget would pay for our help. So this client is
// not metered: same key, and callers use the same model (resolveOpenAIModel) and sampling rule (samplingOptions).
// Reads OPENAI_BASE_URL like the SDK always does.
import OpenAI from "openai";

export function unmeteredOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 120_000 });
}
