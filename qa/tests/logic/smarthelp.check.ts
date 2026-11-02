// SmartHelp pure core: guide order, step gating, page registry vs real routes; the AI answer contract, the prompts and
// the person-topic guard (Task 4). Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp.check.ts
import { HELP_PAGES, isHelpPage, pathOf } from "../../../src/lib/smarthelp/pages";
import { guideCards, stepView } from "../../../src/lib/smarthelp/view";
import type { Guide, HelpContext, SetupState } from "../../../src/lib/smarthelp/types";
import {
  PERSON_REPLY,
  UNKNOWN_REPLY,
  cleanAnswer,
  helpTargets,
  personTopic,
  smartHelpAnswerSchema,
  smartHelpSystemPrompt,
  smartHelpUserPrompt,
  targetPage,
  type SmartHelpAnswer,
} from "../../../src/lib/smarthelp/answer";
import { personTopic as personTopicModule, PERSON_REPLY as PERSON_REPLY_MODULE, secretTopic } from "../../../src/lib/smarthelp/personTopic";
import { GUIDES, GUIDE_TARGETS } from "../../../src/lib/smarthelp/guides";
import { customerHandbook } from "../../../src/lib/smarthelp/knowledge";
import { PERSON_ONLY_TOPICS, SUPPORT_AI_RULES } from "../../../src/lib/support/aiReply";
import { NAV_SECTIONS, flattenNavItems } from "../../../src/components/v3/blueprint-shell/nav-map";
import { appRoutes, isRealRoute } from "../../lib/appRoutes";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const setup: SetupState = {
  profile: false, aiDesk: false, texting: false, payments: false,
  booking: false, website: false, team: false, proposalSent: false,
};
const ctx: HelpContext = {
  role: "OWNER", plan: null, lockedHrefs: [], setup,
  features: { booking: true, website: true }, page: "/dashboard",
};
const g = (id: string, group: "setup" | "how", extra: Partial<Guide> = {}): Guide =>
  ({ id, title: id, group, icon: "Sparkles", steps: [], ...extra });

const guides: Guide[] = [
  g("s-done", "setup", { needs: "profile" }),
  g("s-todo1", "setup", { needs: "aiDesk" }),
  g("s-none", "setup"),
  g("s-todo2", "setup", { needs: "texting" }),
  g("h1", "how"),
  g("s-book", "setup", { needs: "booking", feature: "booking" }),
  g("h2", "how"),
];
const c1 = { ...ctx, setup: { ...setup, profile: true } };
const ids = guideCards(guides, c1).map((c) => `${c.id}:${c.state}`);
check("guideCards order", ids.join() === "s-todo1:todo,s-todo2:todo,s-book:todo,s-none:none,s-done:done,h1:none,h2:none", ids);
const off = guideCards(guides, { ...c1, features: { booking: false, website: true } }).map((c) => c.id);
check("feature guide absent when off", !off.includes("s-book"), off);

const open = "/dashboard/phone?tab=settings";
check("INSTALLER blocked by role", stepView({ text: "x", open }, { ...ctx, role: "INSTALLER" }).blocked === "role");
check("OWNER not blocked", stepView({ text: "x", open }, ctx).blocked === undefined);
check("plan-locked page", stepView({ text: "x", open }, { ...ctx, lockedHrefs: ["/dashboard/phone"] }).blocked === "plan");
check("step without open untouched", stepView({ text: "x", show: "a" }, { ...ctx, role: "INSTALLER" }).blocked === undefined);

const routes = appRoutes();
const unreal = HELP_PAGES.filter((p) => !isRealRoute(pathOf(p.path), routes)).map((p) => p.path);
check("every HELP_PAGES path is a real route", unreal.length === 0, unreal);
check("HELP_PAGES paths unique", new Set(HELP_PAGES.map((p) => p.path)).size === HELP_PAGES.length);
check("isRealRoute [id] wildcard", isRealRoute("/dashboard/clients/abc", routes));
check("isRealRoute rejects invented", !isRealRoute("/dashboard/ai-desk", routes));
check("isHelpPage settings pane", isHelpPage("/dashboard/settings?pane=payments"));
check("isHelpPage invented", !isHelpPage("/dashboard/ai-desk"));
check("isHelpPage unlisted pane", !isHelpPage("/dashboard/settings?pane=nope"));
check("pathOf strips query+hash", pathOf("/a/b?x=1#h") === "/a/b");

// ── Task 4: the answer contract, the prompts, the person-topic guard ─────────
const expectTopic = (topic: ReturnType<typeof personTopic>, qs: string[]) => {
  const wrong = qs.filter((q) => personTopic(q) !== topic).map((q) => `${q} → ${personTopic(q)}`);
  check(`personTopic → ${topic}`, wrong.length === 0, wrong);
};
expectTopic("leaving", [
  "how do I cancel", "stop charging my card", "downgrade my plan", "cancelar mi suscripción", "close my account",
  "How do I cancel my subscription?", "I want to cancel.", "cancel my JobFlex account", "pause my subscription",
  "switch me to the free plan", "quiero darme de baja", "Cancelar mi suscripcion por favor", "how do I stop paying for this",
  "turn off auto-renew", "отменить подписку", "cancel the Deck Studio add-on", "Quiero cancelar",
  // fix round 1 — "cancel" with a reason attached; Spanish and English said other ways
  "I want to cancel. The estimates are wrong.", "How do I cancel? I don't use the calendar",
  "pausar mi suscripción", "no quiero seguir pagando", "quiero dejar JobFlex", "quiero dejar de usar JobFlex",
  "ya no quiero el servicio", "no renovar mi plan",
  "don't renew my plan", "how do I turn off billing", "how do I get off the paid plan",
]);
expectTopic("money", [
  "I want my money back", "can I get a discount on my bill", "refund please", "I was charged twice",
  "quiero un reembolso", "can you give me a credit on my account", "I'll file a chargeback", "devuélvanme mi dinero",
  // fix round 1
  "quiero mi dinero de vuelta", "me cobraron sin autorización",
  "can you waive this month?", "please credit my account", "can I get my last payment back",
  // fix round 2 — first-person forms the narrowed money patterns still catch
  "I need some credit for the outage", "credit us please", "can you waive it?", "I'll open a dispute with my bank",
  "we will dispute the charge", "compensate me for the downtime", "can I get a free month?", "give us an extra month",
  "you billed us for a cancelled report", "can I get a better price?", "¿me pueden dar un descuento?",
]);
expectTopic("data", [
  "delete everything", "delete my account", "borrar mi cuenta", "erase all my data", "удалить мой аккаунт",
  // fix round 1
  "quiero que borren mi cuenta", "eliminen todos mis datos", "I want all my data gone",
]);
expectTopic("security", [
  "someone logged into my account", "I think I was hacked", "my password is hunter22", "alguien entró a mi cuenta",
  "here is my card 4242 4242 4242 4242",
  // fix round 1
  "I got an email asking for my JobFlex password",
  // fix round 2 — a secret next to a client word is still a secret: never sent to the model
  "my customer's card is 4242 4242 4242 4242, how do I charge it?",
  "the client gave me card 4111111111111111 exp 12/27, how do I take the payment?",
  "my password is Hunter22! and my client can't open the proposal",
  "my verification code is 482913 but texting won't turn on", "mi contraseña es Casa2024 y no puedo entrar",
  // fix round 2 — the incident wording the narrowed word patterns still catch
  "my email was compromised", "I got a phishing email pretending to be JobFlex", "I noticed a suspicious login on my account",
  "someone gained unauthorized access to my account", "me robaron la cuenta",
]);
expectTopic("person", [
  "let me talk to a human", "can I speak to a real person", "quiero hablar con una persona", "transfer ownership to my partner",
  "make Maria the owner", "my lawyer will hear about this", "this is a scam", "this app is a rip off", "add another owner",
  "Хочу поговорить с человеком",
  // fix round 1
  "can someone call me", "I need help from a person", "ask a person", "how do I reach support",
  "I want to speak to your manager", "que alguien me llame", "Нужен живой человек", "соедините с поддержкой",
]);
expectTopic(null, [
  "how do I send a proposal by text", "add a discount line to a proposal", "change my credit card",
  "delete a line item", "how do I cancel a job", "cancel an appointment", "how do I cancel a visit on the calendar",
  "cancelar una cita", "how do clients cancel their booking", "how do I cancel a client's service plan",
  "how do I change my password", "upgrade my plan", "switch to annual", "delete a proposal", "my card was declined",
  "how do I get paid by credit card", "add a discount to the invoice", "unsubscribe a client from reminders",
  "how do I talk to my team", "how do I use a referral code", "make Maria a manager", "someone on my team can't log into my account",
  "delete everything on this proposal", "how do I set up the AI desk", "Cancel my plan set download", "How do I cancel an invoice I sent?",
  "¿Cómo cancelo una visita?", "my phone number is 801 555 1234", "how do my clients talk to someone after hours", "how do I pause a job",
  "¿Cómo devuelvo una llamada?", "Sue from my team can't log in", "make sure the owner gets the texts", "go to the free roof estimator",
  "I don't need the plan set", "can my clients get credit through financing", "call 801 555 1234 or 801 555 4321",
  "change the owner's phone number", "how do I talk to people who visit my website", "how do I stop taking card payments",
  // fix round 1 — the AI desk talks about live people and customer service
  "how do I have the AI desk forward calls to a live person", "does the AI desk sound like a real human?",
  "set up customer service hours on the AI desk", "how do callers talk to someone after hours",
  "how do I transfer my business number to the AI desk",
  // fix round 1 — the contractor's own discounts, credit and refunds to clients
  "can I offer a discount for paying cash?", "can we give a discount to veterans?", "can homeowners get credit through financing",
  "refund a deposit to a homeowner", "compensation for my sales reps",
  // fix round 1 — cancelling, stopping and deleting work, not the account
  "cancel a task", "cancel a contract", "cancel a subcontractor", "cancel a financing application", "charge a cancellation fee",
  "stop charging a deposit on proposals", "downgrade a worker's role", "How do clients cancel?",
  "delete my company's logo", "remove my company info from the invoice", "delete my company profile picture",
  // fix round 1 — owners of other things, hacks that aren't break-ins
  "change the owner of a lead", "any hacks to make proposals faster?",
  // fix round 1 — self-review probe of feature questions near the new patterns
  "can you call me back when a lead comes in", "how do I get help from a person on my crew",
  "how do I see the account credit on my invoice", "pause my membership plans for clients", "is there a free month for referrals",
  "phishing emails to my clients", "dejar de cobrar el depósito", "turn off billing emails", "leave jobflex a review",
  "what happens to a booking when I cancel?", "if a homeowner wants to cancel, what do they press?", "Can my crew cancel?",
  "the cancel button doesn't work", "how does the AI desk transfer to a real person", "connect callers to customer service",
  "who is the owner of this lead", "my password is not working", "unsubscribe me from texts",
  "no quiero seguir pagando a mi trabajador", "borrar la cuenta de un trabajador", "how do I end my trial early and pay now",
  "don't renew the client's plan", "how do I issue a credit to a client", "my client wants a refund",
]);
// fix round 2 — feature questions the round-1 patterns misfired on (findings N2, N3).
expectTopic(null, [
  "When I cancel, what happens to the booking?", "If I cancel, does the client get a text?", "I clicked Cancel. Is my roof estimate lost?",
  "¿Qué pasa cuando alguien me llama y no contesto?", "¿Puedo dejar JobFlex abierto todo el día en la computadora de la oficina?",
  "No quiero seguir usando Google Calendar, ¿cómo uso el calendario de JobFlex?", "how do I pause billing on a membership for the winter?",
  "don't auto-renew my membership plans, how do I make them end after a year?", "can you waive the deposit on a proposal?",
  "I'd like my info removed from the proposal footer", "how can my installers talk to a supervisor from the job page?",
  "I never got the text asking for my code when I set up texting", "will you call me, or text me, when a new lead comes in?",
  "¿Cómo pueden los que llaman hablar con alguien después del horario?", "¿Cómo hago que las llamadas pasen a una persona real?",
  "¿Cómo puedo eliminar la información de mi empresa de la factura?", "where do I put my refund policy on proposals?",
  "how do I give a discount on my membership plans?", "when a lead fills in the website estimator, can they talk to someone right away?",
  "is the roof measurement checked by a real person?", "how do I add the co-owner's name to the client so both can sign?",
  "the house sold, how do I change the client to the new owner?", "in the HVAC estimator, how do I switch to the cheaper tier?",
]);

// fix round 3 — NB1: the round-2 first-person money, Spanish and "rep" patterns need the work-word gate (findings r3).
expectTopic(null, [
  "we want reimbursement for job expenses on the Ramp card", "I want reimbursement tracking on jobs",
  "I was overcharged on materials for the Smith job, how do I add a line for it?", "can we get an extra month on the financing for this job?",
  "can you send me a credit memo for the returned shingles order?", "I need to dispute the charge on a supplier invoice",
  "how do I talk to the rep who sold the job?", "I want to speak to the rep assigned to this lead",
  "Ya no queremos el plan porque el cliente se mudó, ¿cómo lo cierro?", "Ya no necesito el servicio, el cliente canceló el trabajo",
  "¿Cómo hago que Stripe deje de cobrarme comisión en los pagos de clientes?", "Quiero bajar el plan del cliente a básico",
  "¿Cómo hago que alguien me ayude a medir el techo?",
]);
// fix round 3 — M2: codes and passwords that aren't secrets.
expectTopic(null, [
  "the confirmation code 482913 for the roof report order", "where do I record the payment authorization code 482913?",
  "¿Dónde pongo el código 482913 del portón en las notas del trabajo?", "el código 104233 del material no aparece en la lista",
  "mi contraseña es 100% correcta pero no entra", "my password is 100% correct but it won't let me in",
]);
// fix round 3 — M3: a PIN is a secret; a pin size is not.
expectTopic("security", ["my pin is 4829"]);
expectTopic(null, ['the pin is 3/8"']);
// fix round 3 — M4: a long digit string is a card only if it passes the Luhn check. Luhn: 4242424242424242,
// 4111111111111111, 5555555555554444 pass; 9400111202062100, 40217500005011, 794644790138495, 2400260018001200 fail.
expectTopic("security", ["my card is 5555555555554444", "here is my card 4242 4242 4242 4242", "the client gave me card 4111111111111111 exp 12/27, how do I take the payment?"]);
expectTopic(null, [
  "the client's tracking number is 9400111202062100", "the parcel number is 40217500005011, where do I attach it to the job?",
  "FedEx tracking 794644790138495 for the materials order", "the four roofs are 2400 2600 1800 1200 square feet",
]);
// fix round 3 — the order rule for a bare cancel: work named BEFORE the cancel is what they cancel; work named only
// AFTER it is their reason for leaving.
expectTopic(null, ["I sent the wrong proposal. How do I cancel?", "The job hasn't started yet. Can I cancel?"]);
expectTopic("leaving", ["I want to cancel. The estimates are wrong.", "How do I cancel? I don't use the calendar"]);
// fix round 3 — secretTopic: the secret check on its own (the one "Answer it anyway" can never skip).
const secretCases = [
  "my customer's card is 4242 4242 4242 4242, how do I charge it?",
  "the client gave me card 4111111111111111 exp 12/27, how do I take the payment?",
  "my password is Hunter22! and my client can't open the proposal",
];
check("secretTopic: a card or a password is security", secretCases.every((q) => secretTopic(q) === "security"), secretCases.map(secretTopic));
check("secretTopic: a leaving question is not a secret", secretTopic("how do I cancel my plan") === null && personTopic("how do I cancel my plan") === "leaving");

// THE PRECISION CORPUS (fix round 2, binding): realistic feature questions from every guide area, in English and
// Spanish, phrased with the words the guard listens for — cancel, pause, stop, credit, refund, discount, delete,
// remove, owner, person, someone, human, code, password, plan. Every one must be null: a person-topic pattern that
// trips one is narrowed or removed (precision beats recall; the model's rules catch what the guard leaves).
const PRECISION_CORPUS: string[] = [
  // AI desk
  "how do I set up the AI desk so it answers my calls?", "can the AI desk cancel an appointment for a caller?",
  "how do I pause the AI desk over the holidays?", "how do I stop the AI desk from answering after 6pm?",
  "can the AI desk transfer a caller to a real person?", "what happens when someone calls and the AI desk can't answer?",
  "how do I make the AI desk voice sound more human?", "how do I remove a reserved hour from the AI desk booking?",
  "¿Cómo configuro el AI desk para que conteste mis llamadas?", "¿Cómo hago que el AI desk pase la llamada a una persona?",
  // texting
  "how do I turn on texting?", "I never got the verification code for my texting number", "the code to verify my phone didn't arrive, what do I do?",
  "how do I stop texting a client who replied STOP?", "can I cancel a scheduled text to a client?", "¿Cómo activo los mensajes de texto?",
  // payments
  "how do I connect Stripe to get paid online?", "can a client pay a proposal by credit card?", "how do I refund a client who paid a deposit by card?",
  "how do I remove Square and use Stripe instead?", "can I stop charging a deposit on small jobs?", "¿Cómo conecto Stripe para cobrar en línea?",
  // website estimators
  "how do I put the roof estimator on my website?", "how do I remove the fence estimator from my website?",
  "can someone who uses my website estimator book a visit right away?", "¿Cómo pongo el estimador de techos en mi página web?",
  // online booking
  "how do I turn on online booking?", "how do clients cancel a booking?", "can a client reschedule or cancel online?",
  "how do I pause online booking for a week?", "¿Cómo cancelo una cita en el calendario?",
  // company profile and branding
  "how do I complete my company profile?", "how do I change my business address for leads?", "how do I delete my company logo?",
  "how do I remove the old logo from my proposals?", "how do I change the color on my proposals?", "¿Cómo quito el logo viejo de las propuestas?",
  // team and workers
  "how do I invite my crew?", "how do I remove a worker who quit?", "how do I delete a worker's account?",
  "how do I change someone's role to manager?", "can someone else on my team log in with their own password?",
  "how do I add another person to my team?", "how do I reset a worker's password?", "¿Cómo invito a mi equipo?", "¿Cómo elimino a un trabajador?",
  // proposals and sending
  "how do I cancel a proposal I already sent?", "how do I delete a draft proposal?", "can the client sign the proposal without a password?",
  "how do I resend a proposal if the client lost the link?", "how do I put a discount on a proposal for a repeat customer?",
  "¿Cómo envío una propuesta por mensaje de texto?", "¿Cómo borro una propuesta?",
  // roof, fence, HVAC
  "how does the roof estimator measure the roof?", "how do I delete a roof report?", "how do I cancel a roof report I ordered by mistake?",
  "how do I draw a fence on the map?", "how do I remove a gate from the fence drawing?",
  "how does the HVAC estimator size the system?", "how do I pick a cheaper equipment option in the HVAC estimator?",
  "can I give a homeowner a discount on the HVAC replacement?",
  // Deck Studio, Smart Proposal, blueprints, video
  "how do I start a deck from a photo?", "how do I send a deck design to a client?", "how do I delete a deck design?",
  "how do I cancel the client link for a deck design?", "how do I use Smart Proposal for a bathroom remodel?",
  "can I give a discount on a Smart Proposal?", "how do I upload a plan set?", "my plans are password-protected PDFs, can I upload them?",
  "how do I delete a plan sheet I uploaded by mistake?", "how do I estimate from a walkthrough video?", "how do I remove a video I uploaded?",
  // reviews and own leads
  "how do I ask clients for reviews?", "can I stop the review request text for one client?", "how do I import my own leads?",
  "how do I delete a lead?", "how do I connect my Facebook leads?", "how do I remove a lead source I don't use anymore?",
  // projects, change orders, invoices
  "how do I make a change order?", "how do I delete a change order?", "how do I cancel an invoice I sent by mistake?",
  "how do I credit a client on an invoice?", "how do I record a refund on an invoice?", "how do I remove a payment I marked by mistake?",
  "¿Cómo hago una orden de cambio?", "¿Cómo cancelo una factura?",
  // crew and jobs, calendar
  "how do I schedule a job for my crew?", "how do I cancel a job and tell the crew?", "how do I pause a job until the materials arrive?",
  "how do I delete an event from the calendar?", "how do I stop a job from showing on the crew's schedule?", "¿Cómo cancelo un trabajo?",
  // service plans and memberships
  "how do I cancel a client's membership?", "how do I stop charging a client's card for their service plan?",
  "how do I pause a membership for the winter?", "can I give members a discount on repairs?", "¿Cómo pauso una membresía de un cliente?",
  // financing
  "how do I turn off financing on my proposals?", "can a homeowner with bad credit still apply for financing?",
  // subscription how-tos (features, not leaving)
  "how do I change my card?", "how do I upgrade my plan?", "how do I switch to annual billing?",
  "where do I see my invoices from JobFlex?", "how do I change my password?", "I forgot my password", "how do I add the Deck Studio add-on?",
  "what plan am I on?", "how do I use a referral code?", "where do I see the card on file?", "¿Cómo cambio mi tarjeta?",
  "¿Cómo cambio mi contraseña?", "¿Cómo subo de plan?",
  // second sweep — untailored questions run against the guard during round 2
  "can I cancel the appointment reminder text?", "how do I cancel my booking page?", "how do I cancel my texting number?",
  "how do I cancel my roof report order?", "how do I cancel my service call for tomorrow?", "I want to cancel my appointment with a client",
  "how do I pause my account notifications?", "can I pause my plan's texting during winter?", "don't charge my card until the client accepts",
  "I don't want to pay for texting, how do I turn it off?", "how do I stop paying for the roof reports?", "can I downgrade the materials on an estimate?",
  "how do I switch to the starter template?", "how do I go back to the free estimate page?", "how do I get off the email list for daily digests?",
  "I'm leaving the office early, can the AI desk take calls?", "I'm done with this estimate, how do I send it?",
  "I don't need this app on my old phone anymore, how do I log out?", "unsubscribe me from the daily digest",
  "How do I cancel? The client changed their mind about the deck.", "how do I turn off billing for one client?", "stop billing my client every month",
  "no more payments on this invoice, how do I close it?", "how do I turn off auto-renew for a client's membership?",
  "can a member cancel their membership online?", "can I get a discount for my client on a roof report?",
  "can I get a better price on shingles through JobFlex?", "how do I credit my account with a client's overpayment?",
  "I need a credit check for financing", "I want a credit line on my invoices for returned materials", "how do I extend the trial for a homeowner?",
  "how do I show discounts on my bill to clients?", "how do I delete my account on the old iPad?", "how do I delete my company from the map of contractors?",
  "how do I remove my data from a proposal?", "how do I wipe my company's leads?", "erase everything on the drawing and start over",
  "How do I delete everything I uploaded today?", "¿Cómo borro todo de la propuesta?", "¿Cómo elimino mis datos de la propuesta?",
  "quiero eliminar mi empresa de la lista", "how do I talk to someone in the office from the job page?",
  "can I speak to the homeowner through JobFlex?", "how do I get a human to answer my calls instead of the AI desk?",
  "I need a person to help me measure the roof", "I want a human touch in my proposals", "how do I contact support from the app?",
  "can I ask a person on my crew to finish the estimate?", "can someone call me when the job is done?", "¿Cómo hablo con un cliente?",
  "necesito un agente para mi negocio de techos", "how do I transfer a lead to another rep?", "how do I transfer the job to another crew?",
  "how do I change the owner on a project?", "who's the account owner?", "how do I make my office manager an admin?",
  "I sold my truck, how do I remove it from equipment?", "we're selling the company next year, will proposals still work?",
  "how do I add my attorney's contract template?", "how do I block scam leads?", "how do I flag a scam caller?",
  "the client threatened a lawsuit, how do I export the proposal?", "my password is too short, what are the rules?",
  "my password is 8 characters, is that enough?", "the code is 6 digits", "the gate code is 4829, where do I put it in the job notes?",
  "job code 482913 for the HOA", "someone changed the price on my proposal", "¿Cómo cancelo mi plan de mantenimiento con un cliente?",
  "¿Cómo pauso mi cuenta de trabajador?", "no quiero seguir pagando por los reportes de techo", "ya no quiero el plan de mantenimiento del cliente",
  "can I pause texting for a client?", "how do I stop the reminders from going out?", "how do I remove the discount from a proposal?",
  "how do I refund a deposit through Stripe?", "where are refunds shown in Financials?", "how do I delete a client?",
  "how do I remove a client's email?", "how do I let someone else access my account to help with proposals?",
  "is there a way to talk to a person at the supplier from JobFlex?", "my owner wants weekly reports, how do I send them?",
  "the owner of the house wants a cheaper option", "can a person sign for the homeowner?", "how do I set the code for the lockbox in job notes?",
  "what's the plan for the HVAC tiers?", "how do I stop the AI desk from booking Sundays?",
  "I want a refund button on my invoices", "I need a refund form for my website", "where is my refund setting?",
  "how do I add credit to my account for AI desk minutes?", "I need credit for AI desk minutes", "can we get a free month for our crew?",
  "quiero un reembolso para mi cliente", "necesito un reembolso del depósito de un cliente", "¿me pueden dar un descuento en materiales?",
  "devuélvanme el depósito del cliente", "how do I delete my account picture?", "how do I chat with my crew?",
  "how can I speak with the client?", "how can we talk to the homeowner after hours?", "how do I talk to an operator on the AI desk?",
  "how do I reach the client by text?", "how do I get in touch with my team?", "transfer ownership of a lead",
  "how do I transfer my business to a new phone?", "how do I make Joe the owner of a job?", "is JobFlex safe from hackers?",
  "how does JobFlex protect against phishing?", "what does a compromised password mean?", "has JobFlex ever had a data breach?",
  "how do I block unauthorized access to my account?", "where do I see suspicious login alerts?",
  "what happens if my phone with JobFlex is stolen?", "me robaron las herramientas del camión, ¿cómo lo anoto?",
  "me robaron el celular, ¿cómo cierro la sesión?", "can my lawyer see the proposals?", "do you have a lawyer-approved contract?",
  "how do I quit JobFlex on my laptop?", "¿Cómo doy de baja a un trabajador?", "¿Cómo puedo cerrar mi cuenta de Stripe?",
  "quiero darme de baja de los mensajes", "¿Cómo cancelo mi cita?", "how do I cancel my subscription to texting alerts?",
];
check(`precision corpus: ${PRECISION_CORPUS.length} feature questions (≥80)`, PRECISION_CORPUS.length >= 80, PRECISION_CORPUS.length);
const corpusHits = PRECISION_CORPUS.filter((q) => personTopic(q) !== null).map((q) => `${q} → ${personTopic(q)}`);
check("precision corpus: every feature question is null", corpusHits.length === 0, corpusHits);

check("PERSON_REPLY has a line for every topic, each pointing at Ask a person",
  (["leaving", "money", "data", "security", "person"] as const).every((t) => PERSON_REPLY[t].includes("Ask a person")));

// The NEVER topics moved out of SUPPORT_AI_RULES and back in — proven by shape here: the NEVER heading, the topics, then
// the "less than 60% sure" line, exactly as the support rules read before. The byte pin lives in support-ai.check.ts.
check("SUPPORT_AI_RULES: NEVER heading, PERSON_ONLY_TOPICS, then the 60% line",
  PERSON_ONLY_TOPICS.length > 100 && SUPPORT_AI_RULES.includes(
    `NEVER (set needsHuman=true instead, and still write your best suggested reply for the team to review)\n${PERSON_ONLY_TOPICS}\n- Anything you are less than 60% sure of.\n`,
  ));

// The schema mends junk instead of refusing it.
const junk = smartHelpAnswerSchema.parse({ kind: "nonsense", steps: "x", confidence: 140 });
check("junk mended: kind unknown, steps [], confidence 100", junk.kind === "unknown" && junk.steps.length === 0 && junk.confidence === 100, junk);
check("junk mended: language en, title empty, note null", junk.language === "en" && junk.title === "" && junk.note === null, junk);
const mended = smartHelpAnswerSchema.parse({
  language: " es ", kind: "steps", title: "t".repeat(200), note: "n".repeat(900), confidence: 87.4,
  steps: [{ text: " Open Proposals ", open: " /dashboard/proposals ", show: "" }, "Press New proposal", { text: "" }, 7, ...Array(9).fill({ text: "s".repeat(500) })],
});
check("clean answer keeps its fields (trimmed, rounded)", mended.language === "es" && mended.kind === "steps" && mended.confidence === 87, mended.language);
check("title ≤120, note ≤600", mended.title.length === 120 && mended.note?.length === 600);
check("steps: ≤8, text ≤400, a string step mended, empty/junk steps dropped",
  mended.steps.length === 8 && mended.steps[0].text === "Open Proposals" && mended.steps[1].text === "Press New proposal" && mended.steps[2].text.length === 400,
  mended.steps.map((s) => s.text.slice(0, 20)));
check("a step's open trimmed, an empty show left out",
  mended.steps[0].open === "/dashboard/proposals" && !("show" in mended.steps[0]) && !("open" in mended.steps[1]), mended.steps[0]);

// cleanAnswer: only real pages, only known targets, nothing below 60% sure, no money or data said, roles respected.
const targets = helpTargets();
const ans = (a: Partial<SmartHelpAnswer>): SmartHelpAnswer =>
  ({ language: "en", kind: "steps", title: "Set up the AI desk", steps: [], note: null, confidence: 90, ...a });
const business = "/dashboard/phone?tab=settings&step=business";
const clean = cleanAnswer(ans({
  steps: [
    { text: "Open the AI desk", open: "/dashboard/ai-desk" },
    { text: "Press Preset the desk", open: business, show: "not-a-target" },
    { text: "Type your trade", open: business, show: "ai-desk:kind" },
    { text: "Press Proposals in the sidebar", show: "nav:/dashboard/proposals" },
    { text: "Press Nowhere", show: "nav:/dashboard/nowhere" },
  ],
}), ctx, targets);
check("an invented page: text kept, open dropped", clean.steps[0].text === "Open the AI desk" && !("open" in clean.steps[0]), clean.steps[0]);
check("an invented target: show dropped, open kept", clean.steps[1].open === business && !("show" in clean.steps[1]), clean.steps[1]);
check("a real page + target kept", clean.steps[2].open === business && clean.steps[2].show === "ai-desk:kind", clean.steps[2]);
check("a sidebar row target kept; an invented one dropped", clean.steps[3].show === "nav:/dashboard/proposals" && !("show" in clean.steps[4]));
check("kind and title kept on a sure answer", clean.kind === "steps" && clean.title === "Set up the AI desk" && clean.steps.length === 5);
const unsure = cleanAnswer(ans({ confidence: 55, steps: [{ text: "x", open: "/dashboard" }] }), ctx, targets);
check("confidence 55 → unknown, no steps", unsure.kind === "unknown" && unsure.steps.length === 0 && unsure.title.length > 0, unsure);
const unsureEs = cleanAnswer(ans({ language: "es", title: "Cómo cobrar en línea", confidence: 40, steps: [{ text: "x" }] }), ctx, targets);
check("forced unknown keeps the model's own title (the asker's language), says why in the note",
  unsureEs.kind === "unknown" && unsureEs.title === "Cómo cobrar en línea" && unsureEs.note === UNKNOWN_REPLY && unsureEs.steps.length === 0, unsureEs);
check("forced unknown with no title of its own: the unknown line",
  cleanAnswer(ans({ title: "", confidence: 10 }), ctx, targets).title === UNKNOWN_REPLY);
const money = cleanAnswer(ans({ steps: [{ text: "We'll refund last month to your card." }] }), ctx, targets);
check("a step that commits money → person, no steps, the money line", money.kind === "person" && money.steps.length === 0 && money.title === PERSON_REPLY.money && money.note === null, money);
const dataNote = cleanAnswer(ans({ kind: "explain", note: "We will delete your account today.", steps: [] }), ctx, targets);
check("a note that commits data → person, the data line", dataNote.kind === "person" && dataNote.title === PERSON_REPLY.data && dataNote.note === null, dataNote);
const cancelSteps = cleanAnswer(ans({ steps: [{ text: "Open Settings → Billing" }, { text: "Press Manage subscription, then Cancel subscription." }] }), ctx, targets);
check("steps that name the cancel button → person, the leaving line", cancelSteps.kind === "person" && cancelSteps.steps.length === 0 && cancelSteps.title === PERSON_REPLY.leaving, cancelSteps);
const deleteSteps = cleanAnswer(ans({ steps: [{ text: "Press Delete account" }] }), ctx, targets);
check("steps that name the delete button → person, the data line", deleteSteps.kind === "person" && deleteSteps.title === PERSON_REPLY.data, deleteSteps);
const personEs = cleanAnswer(ans({ kind: "person", language: "es", title: "Una persona te ayudará", note: "Te devolveremos el dinero: a refund is on its way." }), ctx, targets);
check("model said person but its note commits money: its title kept, the note dropped",
  personEs.kind === "person" && personEs.title === "Una persona te ayudará" && personEs.note === null, personEs);
const unknownEs = cleanAnswer(ans({ kind: "unknown", title: "No estoy seguro", note: "Press Cancel subscription." }), ctx, targets);
check("model said unknown but named the cancel button: person, its title kept", unknownEs.kind === "person" && unknownEs.title === "No estoy seguro" && unknownEs.note === null, unknownEs);
const titleTrips = cleanAnswer(ans({ kind: "person", title: "We'll refund you today", note: null }), ctx, targets);
check("model's person title that commits money is not kept", titleTrips.kind === "person" && titleTrips.title === PERSON_REPLY.money, titleTrips);
const stepsEs = cleanAnswer(ans({ language: "es", title: "Cómo cancelar", steps: [{ text: "Pulsa Cancel subscription" }] }), ctx, targets);
check("model gave steps and the guard fired: the topic line, not the model's title", stepsEs.title === PERSON_REPLY.leaving, stepsEs);
const extension = cleanAnswer(ans({ steps: [{ text: "Press Request a trial extension and pick 14 days." }] }), ctx, targets);
check("the trial-extension button → person, the money line (as personTopic files trial extensions)",
  extension.kind === "person" && extension.title === PERSON_REPLY.money, extension);
const unsureNote = cleanAnswer(ans({ language: "es", title: "Cómo cobrar en línea", note: "No estoy seguro de este paso.", confidence: 30, steps: [{ text: "x" }] }), ctx, targets);
check("forced unknown keeps the model's own note when it has one",
  unsureNote.kind === "unknown" && unsureNote.title === "Cómo cobrar en línea" && unsureNote.note === "No estoy seguro de este paso.", unsureNote);
const modelPerson = cleanAnswer(ans({ kind: "person", title: "Una persona te ayudará", note: "Pulsa Ask a person.", steps: [{ text: "x" }] }), ctx, targets);
check("the model's own person reply: its words kept, never steps", modelPerson.kind === "person" && modelPerson.steps.length === 0 && modelPerson.title === "Una persona te ayudará", modelPerson);
const modelUnknown = cleanAnswer(ans({ kind: "unknown", steps: [{ text: "x" }] }), ctx, targets);
check("unknown never carries steps", modelUnknown.kind === "unknown" && modelUnknown.steps.length === 0);
const emptySteps = cleanAnswer(ans({ steps: [], note: "It works on phones too." }), ctx, targets);
check("steps with none left and a note → explain", emptySteps.kind === "explain" && emptySteps.note === "It works on phones too.", emptySteps);
const nothing = cleanAnswer(ans({ steps: [], note: null }), ctx, targets);
check("steps with nothing at all → unknown", nothing.kind === "unknown", nothing);
const installer = { ...ctx, role: "INSTALLER" };
const crew = cleanAnswer(ans({
  steps: [
    { text: "Open the AI desk", open: "/dashboard/phone", show: "nav:/dashboard/phone" },
    { text: "Open Jobs", open: "/dashboard/jobs", show: "nav:/dashboard/jobs" },
    { text: "Press AI desk in the sidebar", show: "nav:/dashboard/phone" },
  ],
}), installer, targets);
check("INSTALLER: /dashboard/phone step blocked by role, no open/show, text kept",
  crew.steps[0].blocked === "role" && !("open" in crew.steps[0]) && !("show" in crew.steps[0]) && crew.steps[0].text === "Open the AI desk", crew.steps[0]);
check("INSTALLER: Jobs step open", crew.steps[1].blocked === undefined && crew.steps[1].open === "/dashboard/jobs" && crew.steps[1].show === "nav:/dashboard/jobs", crew.steps[1]);
check("INSTALLER: a sidebar row they don't have is blocked too", crew.steps[2].blocked === "role" && !("show" in crew.steps[2]), crew.steps[2]);
const locked = cleanAnswer(ans({ steps: [{ text: "Open the AI desk", open: "/dashboard/phone" }] }), { ...ctx, lockedHrefs: ["/dashboard/phone"] }, targets);
check("plan-locked page: blocked plan, no open", locked.steps[0].blocked === "plan" && !("open" in locked.steps[0]), locked.steps[0]);
// A guide target is checked on the page it lives on, whatever the step's Open says.
const shows = cleanAnswer(ans({
  steps: [
    { text: "Type your trade", show: "ai-desk:kind" },
    { text: "Type your trade", open: "/dashboard/ai-desk", show: "ai-desk:kind" },
    { text: "Type your trade", open: "/dashboard/jobs", show: "ai-desk:kind" },
    { text: "Open Jobs", open: "/dashboard/jobs", show: "nav:/dashboard/phone" },
    { text: "Register the number", show: "texting:register" },
  ],
}), installer, targets);
check("INSTALLER: a desk target with no Open is blocked, no Show me", shows.steps[0].blocked === "role" && !("show" in shows.steps[0]), shows.steps[0]);
check("INSTALLER: a desk target with an invented Open is blocked", shows.steps[1].blocked === "role" && !("show" in shows.steps[1]) && !("open" in shows.steps[1]), shows.steps[1]);
check("INSTALLER: a desk target beside a Jobs Open: Show me dropped, Jobs kept",
  shows.steps[2].blocked === undefined && shows.steps[2].open === "/dashboard/jobs" && !("show" in shows.steps[2]), shows.steps[2]);
check("INSTALLER: a sidebar row of another page beside Jobs: Show me dropped",
  shows.steps[3].open === "/dashboard/jobs" && !("show" in shows.steps[3]) && shows.steps[3].blocked === undefined, shows.steps[3]);
check("INSTALLER: the texting guide's register target is blocked", shows.steps[4].blocked === "role" && !("show" in shows.steps[4]), shows.steps[4]);
const deskPlan = cleanAnswer(ans({ steps: [{ text: "Type your trade", show: "ai-desk:kind" }] }), { ...ctx, lockedHrefs: ["/dashboard/phone"] }, targets);
check("plan lock: a desk target with no Open is blocked plan", deskPlan.steps[0].blocked === "plan" && !("show" in deskPlan.steps[0]), deskPlan.steps[0]);
const otherStep = cleanAnswer(ans({ steps: [{ text: "Type your trade", open: "/dashboard/phone?tab=settings", show: "ai-desk:kind" }] }), ctx, targets);
check("OWNER: a target on another desk step than the Open: Show me dropped, Open kept",
  otherStep.steps[0].open === "/dashboard/phone?tab=settings" && !("show" in otherStep.steps[0]), otherStep.steps[0]);
const unpaged = [...GUIDE_TARGETS].filter((t) => { const p = targetPage(t); return !p || !isHelpPage(p); });
check("every guide target has a SmartHelp page it lives on", unpaged.length === 0, unpaged);
check("targetPage: a sidebar row is its own page", targetPage("nav:/dashboard/jobs") === "/dashboard/jobs");
// The model told to give a guide's steps must not be stopped by the guards: every guide, as an answer, passes whole.
const guideAnswers = GUIDES.map((g) => ({ g, r: cleanAnswer(ans({ title: g.title, steps: g.steps.slice(0, 8) }), ctx, targets) }));
const stopped = guideAnswers
  .filter(({ g, r }) => r.kind !== "steps" || r.steps.some((s, i) => s.open !== g.steps[i].open || s.show !== g.steps[i].show || s.blocked))
  .map(({ g }) => g.id);
check("every guide given as an answer keeps all its Open and Show me", stopped.length === 0, stopped);
// …and as an INSTALLER's answer, no Open or Show me survives on a page the role can't open.
const leaks = GUIDES.flatMap((g) =>
  cleanAnswer(ans({ title: g.title, steps: g.steps.slice(0, 8) }), installer, targets).steps.flatMap((s, i) => {
    const pages = [s.open, s.show ? targetPage(s.show) : undefined].filter((p): p is string => !!p);
    return pages.some((p) => stepView({ text: "", open: p }, installer).blocked) ? [`${g.id}#${i + 1}`] : [];
  }),
);
check("every guide as an INSTALLER's answer: no button to a page they can't open", leaks.length === 0, leaks);
const installerKept = GUIDES.flatMap((g) => cleanAnswer(ans({ title: g.title, steps: g.steps }), installer, targets).steps).filter((s) => s.open);
check("…while their own pages keep their buttons (Jobs)", installerKept.some((s) => s.open === "/dashboard/jobs"), installerKept.map((s) => s.open));
check("answer.ts re-exports the guard from personTopic.ts", personTopic === personTopicModule && PERSON_REPLY === PERSON_REPLY_MODULE);
const titleTopics = GUIDES.filter((g) => personTopic(g.title) !== null).map((g) => g.title);
check("no guide title reads as a person topic", titleTopics.length === 0, titleTopics);

// helpTargets: the guides' targets plus a nav:<path> for every SmartHelp page drawn as a sidebar row.
const navRows = new Set(NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items)).filter((i) => !i.preview).map((i) => i.href));
check("helpTargets ⊇ GUIDE_TARGETS", [...GUIDE_TARGETS].every((t) => targets.has(t)));
check("helpTargets has the sidebar rows of SmartHelp pages", targets.has("nav:/dashboard/proposals") && targets.has("nav:/dashboard/phone") && targets.has("nav:/dashboard/subscription"));
check("helpTargets: no pane links, no unlisted or preview rows",
  !targets.has("nav:/dashboard/phone?tab=settings") && !targets.has("nav:/dashboard/service-plans") && !targets.has("nav:/dashboard/lawn-estimator") && !targets.has("nav:/dashboard/hire"));
const navT = [...targets].filter((t) => t.startsWith("nav:")).map((t) => t.slice(4));
check("every nav target is a SmartHelp page and a drawn row", navT.every((p) => isHelpPage(p) && navRows.has(p)), navT);
check("every SmartHelp page drawn as a row is a target", HELP_PAGES.filter((p) => navRows.has(p.path)).every((p) => targets.has(`nav:${p.path}`)));
check("helpTargets is exactly guides + nav rows", targets.size === GUIDE_TARGETS.size + navT.length);

// The system prompt: the same bytes for everyone, carrying the rules, the lists, the guides and the handbook.
const sys = smartHelpSystemPrompt();
check("system prompt memoised and stable", sys === smartHelpSystemPrompt());
check("system prompt carries PERSON_ONLY_TOPICS", sys.includes(PERSON_ONLY_TOPICS));
check('system prompt says "Manual J-style"', sys.includes("Manual J-style"));
const rulesPart = sys.replace(customerHandbook(), "");
check('no "Manual J" without "-style" outside the handbook', !/Manual J(?!-style)/.test(rulesPart), rulesPart.match(/.{40}Manual J(?!-style).{20}/)?.[0]);
check("system prompt: the language of the question, names exactly as written",
  /language of the question/.test(sys) && /button, tab and page names exactly as written/.test(sys));
const missingPages = HELP_PAGES.filter((p) => !sys.includes(`${p.path} — ${p.name}`)).map((p) => p.path);
check("system prompt lists every HELP_PAGES page", missingPages.length === 0, missingPages);
const missingTargets = [...targets].filter((t) => !sys.includes(`- ${t}`));
check("system prompt lists every allowed target", missingTargets.length === 0, missingTargets);
const missingGuides = GUIDES.filter((g) => !sys.includes(g.title)).map((g) => g.id);
check("system prompt carries every guide title", missingGuides.length === 0, missingGuides);
check("system prompt carries the customer handbook", sys.includes(customerHandbook()));
check('system prompt has no "### Internal —" block', !sys.includes("### Internal —") && !sys.includes("Internal — for the team"));
check("system prompt holds nothing about a person", !/OWNER|INSTALLER|not connected/.test(rulesPart));

// The user prompt: the person and the conversation, nothing else.
const history = Array.from({ length: 8 }, (_, i) => ({ q: `question-${i + 1}`, a: `answer-${i + 1}` }));
const user = smartHelpUserPrompt({ question: "How do I get paid online?", history, ctx: { ...ctx, role: "INSTALLER", plan: "Professional", page: "/dashboard/proposals" } });
check("user prompt: only the last 6 turns", !user.includes("question-1") && !user.includes("question-2") && ["3", "4", "5", "6", "7", "8"].every((n) => user.includes(`question-${n}`) && user.includes(`answer-${n}`)), user);
check("user prompt: turns oldest first", user.indexOf("question-3") < user.indexOf("question-8"));
check("user prompt: page, role, plan", user.includes("/dashboard/proposals") && user.includes("Proposals") && user.includes("Installer") && user.includes("Professional"));
check('user prompt: setup facts in words ("Payments: not connected")', user.includes("Payments: not connected") && user.includes("AI desk: not set up"), user);
check("user prompt: a done setup reads as done", smartHelpUserPrompt({ question: "q", history: [], ctx: { ...ctx, setup: { ...setup, payments: true } } }).includes("Payments: connected"));
check("user prompt: the question last", user.trimEnd().endsWith("How do I get paid online?"));
check("user prompt: an INSTALLER's openable pages are named", /can open: .*Jobs/.test(user), user);
check("user prompt: no history, no conversation block", !smartHelpUserPrompt({ question: "q", history: [], ctx }).includes("EARLIER"));
check("user prompt: a feature off reads as not open", smartHelpUserPrompt({ question: "q", history: [], ctx: { ...ctx, features: { booking: false, website: true } } }).includes("Online booking: not open to this account"));

console.log(bad ? `${bad} FAILED` : "all passed");
process.exit(bad ? 1 : 0);
