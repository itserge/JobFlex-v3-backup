// THE SIGN-UP FORM, WATCHED (2026-10-14): the shared words (boxes, reasons, sides, scrubbing) and the live line's
// story from a visit's events (lib/traffic-live formWatchOf / formSentence) — where they are, which box, every
// problem and whose side, away and back, the leave and its verdict.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-watch.check.ts
import { OUR_CODE_MARK, fieldName, isBrowserFailure, isBrowserNoise, isOutsideScriptError, ourWords, problemOf, reasonOfMessage, reasonSide, reasonWords, scrubWords, sideOf, stackHasOurFile } from "../../../src/lib/signup-watch-shared";
import { buildAlertQuery, signupAlertsOf } from "../../../src/lib/signup-dropoff";
import { formSentence, formWatchOf, type LiveEvent } from "../../../src/lib/traffic-live";
import { setSignupPosition, signupLeaveKind, signupLeavingTo } from "../../../src/lib/signup-watch";
import { TRAFFIC_EVENTS as E } from "../../../src/lib/traffic-contract";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── words ──
check("boxes by id; trades and code by pattern; unknown ids are never named", fieldName("email") === "Email" && fieldName("password2") === "Confirm password" && fieldName("biz2") === "Business name" && fieldName("otpCode") === "Code" && fieldName("search") === null && fieldName("") === null);
check("our failures read as ours", ["server_error", "email_send_failed", "check_failed", "rate_limited", "page_error", "slow_form", "network", "offer_changed"].every((r) => reasonSide(r) === "ours"));
check("the form's refusals read as theirs", ["missing", "email_invalid", "wrong", "expired", "email_taken", "biz_missing"].every((r) => reasonSide(r) === "theirs"));
check("an unknown reason is theirs, in plain words", reasonSide("whatever_new") === "theirs" && reasonWords("whatever_new") === "whatever new");
check("the server's words map to reasons", reasonOfMessage("Something went wrong on our side. Try again in a minute.") === "server_error" && reasonOfMessage("Couldn't send the email. Check the address and try again.") === "email_send_failed" && reasonOfMessage("Too many codes from this network. Try again in 4 min.") === "rate_limited" && reasonOfMessage("That email is already registered. Try signing in instead.") === "email_taken" && reasonOfMessage("Your trial offer changed. Reload this page") === "offer_changed" && reasonOfMessage("Hmm") === "refused");
check("words that leave the browser carry no address and no long numbers", scrubWords("We sent it to maria@cascade.vc, ref 12345678") === "We sent it to [email], ref [n]");

// ── a visit, event by event ──
const t0 = Date.UTC(2026, 9, 14, 20, 0, 0);
let seq = 0;
const ev = (event: string, atS: number, p: Partial<LiveEvent> = {}): LiveEvent => ({
  person: "p1", distinctId: "d1", event, at: t0 + atS * 1000 + seq++, pathname: "/auth/register", url: "https://www.jobflex.app/auth/register", sessionId: "s1",
  hostname: "www.jobflex.app", environment: "production", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", referrer: "", device: "Mobile", browser: "Safari", os: "iOS",
  country: "", region: "", city: "", placement: "", label: "", orgId: "", userId: "", step: "", outcome: "", plan: "", verified: "", lat: null, lon: null, countryCode: "", regionCode: "", click: "", ua: "Mozilla/5.0", browserType: "", ...p,
});
const typing = [
  ev("$pageview", 0),
  ev(E.step, 1, { step: "1" }),
  ev(E.signupField, 3, { phase: "in", field: "Name", screen: "account" }),
  ev(E.signupField, 9, { phase: "out", field: "Name", ms: "6000", filled: "true", valid: "true", edits: "12", screen: "account" }),
  ev(E.signupField, 10, { phase: "in", field: "Email", screen: "account" }),
];
let f = formWatchOf(typing, t0 + 30_000)!;
check("typing: on the account screen, in the Email box now, Name done", f.screen === "Account" && f.inBox?.field === "Email" && f.boxes.length === 1 && f.boxes[0].field === "Name" && f.boxes[0].secs === 6 && f.boxes[0].edits === 12 && f.verdict === null, JSON.stringify(f));
check("…the sentence says where they are and which box", /^On the account screen for .*, in the Email box since/.test(formSentence(f, true, t0 + 30_000)), formSentence(f, true, t0 + 30_000));

const refused = [...typing,
  ev(E.signupField, 20, { phase: "out", field: "Email", ms: "10000", filled: "true", valid: "true", edits: "18", screen: "account" }),
  ev(E.signupProblem, 21, { reason: "email_taken", side: "theirs", message: "That email is already registered.", screen: "account", field: "" }),
  ev(E.signupLeave, 50, { kind: "closed", screen: "account", field: "", ms: "49000", pageMs: "50000", lastProblem: "email_taken" }),
];
f = formWatchOf(refused, t0 + 60_000)!;
check("refused, then closed: the leave, its screen and the form's verdict", f.left?.kind === "closed" && f.left.screen === "Account" && f.verdict === "theirs" && f.problems[0].words === "Email already has an account", JSON.stringify({ left: f.left, verdict: f.verdict }));
check("…the sentence names the screen, the time and the refusal", /^Left at the account screen after 49 s — right after “Email already has an account”\.$/.test(formSentence(f, false)), formSentence(f, false));

const oursFail = [...typing,
  ev(E.signupProblem, 15, { reason: "email_send_failed", side: "ours", screen: "account" }),
  ev(E.signupProblem, 18, { reason: "wrong", side: "theirs", screen: "code" }),
  ev(E.signupLeave, 40, { kind: "closed", screen: "code", ms: "20000" }),
];
f = formWatchOf(oursFail)!;
check("any failure of ours makes the verdict ours, even with a later refusal", f.verdict === "ours" && /after a failure of ours: the code email didn't send/.test(formSentence(f, false)), formSentence(f, false));

const quiet = [...typing, ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" })];
f = formWatchOf(quiet)!;
check("closed with no error shown: their choice, and the box they were in", f.verdict === "choice" && /in the Email box — no error shown: their choice/.test(formSentence(f, false)), formSentence(f, false));

const toGoogle = [...typing, ev(E.signupLeave, 12, { kind: "google", screen: "account" })];
f = formWatchOf(toGoogle)!;
check("off to Google on purpose is not an abandon", f.verdict === null && formSentence(f, true) === "Went to Google to sign up with it.");

const readingEmail = [ev("$pageview", 0), ev(E.step, 1, { step: "code" }), ev(E.signupAway, 30, { screen: "code", ms: "29000" })];
f = formWatchOf(readingEmail, t0 + 150_000)!;
check("away from the code screen: probably reading the email", f.screen === "Email code" && !!f.away && /most likely reading the email for the code/.test(formSentence(f, true, t0 + 150_000)), formSentence(f, true, t0 + 150_000));
const back = [...readingEmail, ev(E.signupBack, 95, { screen: "code", ms: "65000" })];
f = formWatchOf(back, t0 + 100_000)!;
check("…and back after a minute: no longer away, the return counted", !f.away && f.cameBack?.secs === 65 && /Came back after 1 min away/.test(formSentence(f, true, t0 + 100_000)), formSentence(f, true, t0 + 100_000));

const closedTab = [...typing, ev(E.signupAway, 44.5, { screen: "account", field: "Email" }), ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" })];
f = formWatchOf(closedTab)!;
check("closing a tab hides it first: that away is the close, not a story", !f.away && !!f.left && f.left.awaySecs === undefined && f.verdict === "choice");
const sameSecond = [...typing, ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" }), ev(E.signupAway, 45, { screen: "account", field: "Email" })];
f = formWatchOf(sameSecond)!;
check("…and when the close's away sorts after its leave (whole seconds), still no away", !f.away && f.left?.kind === "closed" && f.verdict === "choice");
const putDown = [...typing, ev(E.signupAway, 30, { screen: "account", field: "Email" }), ev(E.signupLeave, 270, { kind: "closed", screen: "account", field: "Email", ms: "269000" })];
f = formWatchOf(putDown)!;
check("away four minutes, then closed: the leave carries the time away", !f.away && f.left?.awaySecs === 240, JSON.stringify(f.left));

const reloaded = [...quiet, ev("$pageview", 60)];
f = formWatchOf(reloaded)!;
check("a move after the leave (a reload) means they did not leave", f.left === null);
check("a visit that never reached the form has no watch", formWatchOf([ev("$pageview", 0, { pathname: "/" })]) === null);

// ── an outside script's failure (2026-10-16): seen, never ours, never the verdict ──
check("a bare cross-origin \"Script error.\" is an outside script's", isOutsideScriptError("Script error.") && isOutsideScriptError("Script error") && !isOutsideScriptError("Script error.", "https://www.jobflex.app/_next/x.js") && !isOutsideScriptError("Cannot read properties of undefined (reading 'x')") && !isOutsideScriptError("Script error.", "", 12));
check("its side is outside — neither ours nor theirs", reasonSide("outside_script") === "outside" && sideOf("outside", "page_error") === "outside" && sideOf("bogus", "page_error") === "ours" && reasonWords("outside_script") === "Browser error, not ours");
const outside = [...typing, ev(E.signupProblem, 20, { reason: "outside_script", side: "outside", message: "Script error.", screen: "account" }), ev(E.signupLeave, 31, { kind: "closed", screen: "account", field: "Email", ms: "30000" })];
f = formWatchOf(outside, t0 + 60_000)!;
check("a visitor who left after only an outside failure: their choice, not ours to fix", f.verdict === "choice" && f.problems[0]?.side === "outside" && !/ours to fix|failure of ours/.test(formSentence(f, false, t0 + 60_000)), `${f.verdict} · ${formSentence(f, false, t0 + 60_000)}`);
const both = [...typing, ev(E.signupProblem, 18, { reason: "server_error", side: "ours", message: "Something went wrong on our side.", screen: "account" }), ev(E.signupProblem, 20, { reason: "outside_script", side: "outside", message: "Script error.", screen: "account" }), ev(E.signupLeave, 31, { kind: "closed", screen: "account", field: "Email", ms: "30000" })];
check("…a real failure of ours beside it still makes it ours", formWatchOf(both, t0 + 60_000)!.verdict === "ours");
check("an outside failure never raises the alarm, however many visitors met it", signupAlertsOf([{ reason: "outside_script", side: "outside", visits: 9, times: 12, message: "Script error.", screen: "account" }]).length === 0 && signupAlertsOf([{ reason: "server_error", side: "ours", visits: 3, times: 3, message: "", screen: "account" }]).length === 1);

// ── a wallet or an extension injected into the page (2026-11-15: an iPad's Brave, "window.ethereum.selectedAddress"
// read as "page_error · ours"): the browser's, by its words or by an extension's file in the stack — unless one of our
// own files is in the stack.
const HOST = "www.jobflex.app";
const brave = "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')";
const walletWords = [
  brave,
  "TypeError: Cannot redefine property: ethereum",
  "Cannot set property ethereum of #<Window> which has only a getter",
  "TypeError: Cannot read properties of undefined (reading 'solana')",
  "window.solana is not defined",
  "ReferenceError: tronWeb is not defined",
  "TronLink: tronWeb is not ready",
  "web3 is not defined",
  "MetaMask - RPC Error: Internal JSON-RPC error.",
  "Failed to connect to MetaMask",
  "Error: Error in inpage.js",
  "Error at chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/inpage.js:1:1",
  "Error at moz-extension://1b2c3d4e/content.js:4:2",
  "Error at safari-web-extension://ABCD-1234/script.js:9:3",
];
check("a wallet's or an extension's words: the browser's (read back too)", walletWords.every((m) => isBrowserFailure({ message: m }, HOST) && isBrowserNoise(m) && problemOf("page_error", "ours", m).side === "outside"), walletWords.filter((m) => !isBrowserFailure({ message: m }, HOST) || !isBrowserNoise(m)).join(" | "));
check("…the Brave iPad's stored event (page_error · ours) reads back as the browser's", problemOf("page_error", "ours", brave).reason === "browser_error" && problemOf("page_error", "ours", brave).side === "outside");
const extStacks = [
  "TypeError: x is undefined\n    at e.request (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:1:22)",
  "Error: boom\n    at r (moz-extension://0f9a1b2c-aaaa/contentscript.js:5:9)",
  "@safari-web-extension://8B1F2C3D/content.js:12:40",
  "TypeError: null is not an object\n@webkit-masked-url://hidden/:12:345",
];
check("…a plain message with an extension's file in the stack, or as the failing file: the browser's", extStacks.every((st) => isBrowserFailure({ message: "TypeError: x is undefined", stack: st }, HOST)) && isBrowserFailure({ message: "Error: boom", filename: "chrome-extension://abc/inpage.js" }, HOST) && isBrowserFailure({ message: "Error: boom", filename: "safari-extension://abc/x.js" }, HOST));
const ourStack = "TypeError: Cannot read properties of undefined (reading 'ethereum')\n    at h (https://www.jobflex.app/_next/static/chunks/0b3e1f.js:1:2345)\n    at chrome-extension://abc/inpage.js:1:1";
check("our own file in the stack keeps it ours, whatever it names", !isBrowserFailure({ message: "TypeError: Cannot read properties of undefined (reading 'ethereum')", stack: ourStack }, HOST) && !isBrowserFailure({ message: brave, filename: "https://www.jobflex.app/_next/static/chunks/app/page-1a2b.js" }, HOST) && !isBrowserFailure({ message: brave, stack: "at x (/_next/static/chunks/abc.js:1:1)" }, HOST) && stackHasOurFile(ourStack, HOST) && !stackHasOurFile("at x (https://evil.example/_next/static/chunks/abc.js:1:1)", HOST));
check("…the page's own address in the stack is not one of our files (an injected script can report it)", isBrowserFailure({ message: brave, stack: "@https://www.jobflex.app/auth/register:1:200" }, HOST));
const kept = ourWords("TypeError: Cannot read properties of undefined (reading 'ethereum')");
check("…kept as ours, it is marked so and reads back as ours", kept.endsWith(OUR_CODE_MARK) && kept.length <= 140 && scrubWords(kept) === kept && !isBrowserNoise(kept) && !isBrowserFailure({ message: kept }, HOST) && problemOf("page_error", "ours", kept).side === "ours" && ourWords("TypeError: x is not a function") === "TypeError: x is not a function", kept);
check("…and the alert query folds by the same words but never a marked message", buildAlertQuery().includes("ethereum") && buildAlertQuery().includes(`NOT endsWith(ifNull(toString(properties.message), ''), '${OUR_CODE_MARK}')`));
const ours = ["TypeError: Cannot read properties of undefined (reading 'map')", "ReferenceError: setStep is not defined", "TypeError: Load failed", "Error: Minified React error #418", "TypeError: undefined is not an object (evaluating 'e.selectedPlan')", "Error: web3forms rejected the request"];
check("our own failures stay ours — no wallet, no extension in them", ours.filter((m) => m !== "Error: web3forms rejected the request").every((m) => !isBrowserFailure({ message: m, stack: "at f (https://www.jobflex.app/_next/static/chunks/a.js:1:1)" }, HOST) && !isBrowserNoise(m) && problemOf("page_error", "ours", m).side === "ours") && !isBrowserFailure({ message: "Something went wrong on our side." }, HOST));
check("…a word that only starts with a wallet's name is not one (whole words only)", !isBrowserNoise("Error: web3forms rejected the request") && !isBrowserNoise("ethereumish") && !isBrowserNoise("solanas"));
check("the in-app webview's own words stay the browser's even with our file in the stack (unchanged)", isBrowserFailure({ message: "Error invoking postMessage: Java object is gone", stack: "at x (https://www.jobflex.app/_next/static/chunks/a.js:1:1)" }, HOST));

// ── off to Stripe's card page is not a finish (owner, 2026-10-28: PostHog showed the visitor go to Stripe while the
// card said "Finished" — "how do I understand if they signed up or not?"). The form is finished only when the server's
// own completed event is in; a "done" leave without it, after the checkout opened, is the hand-off to the card page.
const toCardOld = [...typing, ev(E.step, 12, { step: "3", screen: "checkout" }), ev(E.attempt, 12.1), ev(E.signupLeave, 14, { kind: "done", screen: "done", ms: "2000" }), ev(E.opened, 14.5)];
f = formWatchOf(toCardOld, t0 + 60_000)!;
check("a 'done' leave with no account made, the checkout opened: the hand-off to Stripe's card page (events before 2026-10-28)", f.left?.kind === "checkout" && f.screen === "Stripe card page" && f.left.screen === "Stripe card page" && f.verdict === null, JSON.stringify({ left: f.left, screen: f.screen }));
check("…the server's own checkout event landing after the leave does not undo the leave", f.left !== null);
check("…and the sentence says they are not signed up yet", /Stripe's card page/.test(formSentence(f, true)) && /not signed up/.test(formSentence(f, true)), formSentence(f, true));
const toCardNew = [...typing, ev(E.step, 12, { step: "3", screen: "checkout" }), ev(E.attempt, 12.1), ev(E.opened, 13), ev(E.signupLeave, 14, { kind: "checkout", screen: "checkout", ms: "2000" })];
f = formWatchOf(toCardNew, t0 + 60_000)!;
check("the watcher's own 'checkout' leave reads the same", f.left?.kind === "checkout" && f.screen === "Stripe card page" && f.verdict === null, JSON.stringify(f.left));
const madeAccount = [...typing, ev(E.step, 12, { step: "3" }), ev(E.attempt, 20), ev(E.completed, 23.5, { verified: "true" }), ev(E.signupLeave, 24, { kind: "done", screen: "done", ms: "3000" })];
f = formWatchOf(madeAccount, t0 + 60_000)!;
check("a 'done' leave beside the server's completed event is the account made", f.left?.kind === "done" && f.screen === "Account made" && f.verdict === null && /account was made/i.test(formSentence(f, false)), `${JSON.stringify(f.left)} · ${formSentence(f, false)}`);
const latched = [...typing, ev(E.step, 12, { step: "3" }), ev(E.signupLeave, 40, { kind: "done", screen: "plan", field: "", ms: "28000" })];
f = formWatchOf(latched, t0 + 60_000)!;
check("a 'done' leave from the plan screen (the done screen that flashed by before the plan step) is a close on the plan screen", f.left?.kind === "closed" && f.left.screen === "Plan" && f.verdict === "choice", JSON.stringify(f.left));

// ── the browser's half: the leave's kind is read at the leave, from where they are, never latched from a screen ──
setSignupPosition({ screen: "done" });
setSignupPosition({ step: "3", screen: "plan" });
check("the watcher: a done screen that flashed by before the plan step leaves no mark — a close on the plan screen is a close", signupLeaveKind() === "closed");
setSignupPosition({ step: "4", screen: "done" });
check("…on the done screen itself, the leave is done", signupLeaveKind() === "done");
signupLeavingTo("checkout");
setSignupPosition({ screen: "done" });
check("…a done screen set after the hand-off to the checkout keeps the leave a checkout", signupLeaveKind() === "checkout");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
