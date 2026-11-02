// SmartHelp · THE PERSON-TOPIC GUARD — the questions only a person answers, caught before the model so no call is
// made: leaving (cancel, downgrade, stop the charges), money (refunds, credits, discounts on the bill), data (deleting
// the account or all of it), security (a secret pasted in, someone in the account), a person (asked for, ownership,
// the law, anger). English, Spanish and some Russian. Pure regexes; lib/smarthelp/answer re-exports it.
//
// PRECISION FIRST (controller's rulings, 2026-10-30). A false positive here blocks a real how-to with no model call; a
// miss still meets the model's PERSON_ONLY_TOPICS rule, commitsMoneyOrData and the cancel/delete/extension button
// guard after it (cleanAnswer). So:
//   · SECRETS run always, before any exemption — a pasted card number, password, sign-in code or PIN never reaches
//     OpenAI. secretTopic() is that check on its own: the one an "Answer it anyway" ask (Task 5) can never skip. A long
//     digit string is a card only if it passes the Luhn check (tracking numbers, square footages mostly don't).
//   · Every other pattern is said in the first person about their own JobFlex ("I want to cancel", "can you refund
//     me", "my subscription") or ends the sentence there ("how do I turn off billing?"). A word alone — refund,
//     chargeback, cancel, real person, owner — is never enough: contractors refund deposits, cancel visits, forward
//     calls to a live person and change a lead's owner every day.
//   · "Membership" is the contractor's own product (HVAC service plans), never their JobFlex plan.
//   · qa/tests/logic/smarthelp.check.ts holds a precision corpus of realistic feature questions that must all be null.
//     A pattern that trips one is narrowed or removed, never excused.
//
// CAUGHT AFTER THE MODEL — said these ways, a question is left to the model's rules (patterns removed for precision):
//   "How can I cancel my membership?" · "end my subscription" · "I want to cancel my estimates are wrong" (no stop) ·
//   "what's your refund policy?" · "chargeback" alone · "fraudulent charge" · "free month?" · "where's my account
//   credit?" · "is there a discount for annual?" · "can you call me?" · "talk to someone" with no "I want to" ·
//   "cerrar la cuenta" (without "mi") · "dejar de cobrar" · "plan más barato" · "отписаться" · "GDPR request" ·
//   "data deletion" · "suspicious email" · "my card was stolen" · "How do I cancel? My clients don't use it" (a client
//   or AI desk word anywhere keeps a bare cancel null) · "my account was hacked and my proposals are gone" (a work word
//   switches the break-in words off — never the secret detectors) · "I'll file a chargeback on the job's deposit" and
//   other MONEY_LOOSE phrasings that name the work.

export type PersonTopic = "leaving" | "money" | "data" | "security" | "person";

/** Lower case, accents off (Spanish "suscripción" → "suscripcion", Russian "й" → "и"), one kind of apostrophe. */
function fold(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── The pieces ───────────────────────────────────────────────────────────────

/** The thought ends here: the end of the message or a sentence mark. */
const STOP = "(?=\\s*($|[.?!,;:]))";
/** …or a reason starts ("I'm leaving JobFlex because…"). */
const REASON = "(?=\\s*($|[.?!,;:]|(because|since|cause|cuz)\\b))";
const REASON_ES = "(?=\\s*($|[.?!,;:]|(porque|ya que|pues)\\b))";
/** Asking for it in the first person, right before the verb. */
const INTENT =
  "(?:i want to|i'd like to|i would like to|i need to|i wanna|i wish to|i'm going to|i am going to|i'm gonna|we want to|we'd like to|we need to|how do i|how can i|how to|how would i|can i|could i|may i|how do we|how can we|can we|let me|please)";
const INTENT_ES = "(?:quiero|queremos|necesito|necesitamos|deseo|quisiera|me gustaria|nos gustaria|como|como puedo|como podemos|puedo|podemos|voy a|vamos a)";
/** Their JobFlex plan — never a plan set, a plan sheet, "plans" (a blueprint's) or a "plan de mantenimiento". */
const PLAN = "plan(?! (?:sets?|sheets?|pages?|views?|drawings?|reviews?|checks?|de ))(?!s\\b|'s)";
/** Their JobFlex account — not its settings, notifications or page. */
const ACCOUNT = "account(?!'s| (?:settings|page|info|details|number|of|for|manager|owner|notifications?|emails?|alerts?|texts?|messages?|activity|history|photo|picture|name))";
const BILLING = "billing(?! (?:reminders?|emails?|notifications?|alerts?|texts?|messages?|address|info|details|history|page|cycle|date|settings|terms))";
const MINE = "(?:my|our|mi|nuestra|nuestro)";
const FILLER = "(?:the|this|a|an|whole|entire|current|free|paid|monthly|yearly|annual|jobflex|jobflex's|pro|professional|starter|advanced|la|el|de|del|una|un)";
/** The contractor's own JobFlex: the plan, the subscription, an add-on, the account, the trial. */
const OWN_THING = `(?:${PLAN}|subscriptions?(?! to (?:alerts?|emails?|notifications?|texts?|the newsletter|newsletters?|updates?|digests?))|${ACCOUNT}|trial|${BILLING}|renewal|auto-?renew\\w*|add-?ons?|deck studio(?! (?:designs?|drawings?|projects?|proposals?|links?|samples?))|jobflex(?! (?:texting|number|line|desk|phone|links?|website|page|estimators?|proposals?))|service(?! (?:calls?|visits?|plans?|appointments?|requests?|tickets?|area|radius|menu|desk|hours|date|address))|suscripcion|subscripcion|cuenta(?! de )|prueba|servicio(?! de ))`;

// ── What makes a question about the contractor's work, not their own account ─

/** Their clients and callers, and anything that is theirs. */
const CLIENT_SIDE =
  /\b(clients?|customers?|homeowners?|clientes?|callers?|service plans?|maintenance plans?|their (card|plan|account|subscription|membership))\b/;
/** Their team. */
const TEAM_SIDE =
  /\b(team|teams|members?|crew|crews|workers?|employees?|staff|subcontractors?|subs|reps?|roles?|users?|technicians?|techs?|installers?|trabajador(es)?|empleados?|equipo|cuadrilla)\b/;
/** Their own people, said so that "the JobFlex team" or "your team" doesn't count. */
const CREW = /\b(crews?|workers?|employees?|staff|subcontractors?|installers?|technicians?|techs?|my team|our team)\b/;
const OWN_PEOPLE = /\b(team|crew|workers?|employees?|staff|partner|manager|members?|office)\b/;
/** The AI desk and the phone, English and Spanish. */
const DESK_SIDE =
  /\b(ai desk|desk|callers?|calls|forward\w*|receptionist|voicemail|after hours|business (number|line)|phone (line|number)|llamadas?|los que llaman|quien(es)? llaman?|llamantes?|despues del horario|fuera del horario|fuera de horario|contestador|buzon|recepcionista|escritorio)\b/;
/** Their work and its documents. */
const WORK_DOC =
  /\b(jobs?|appointments?|visits?|bookings?|reservations?|proposals?|invoices?|estimates?|quotes?|meetings?|events?|orders?|tasks?|contracts?|leads?|projects?|reminders?|inspections?|deposits?|lines?|items?|financ\w*|wisetack|loans?|payment links?|referrals?|memberships?|membresias?|tiers?|options?|materials?|propuestas?|presupuestos?|facturas?|cotizacion\w*|trabajos?|citas?|visitas?|proyectos?|depositos?|anticipos?|referidos?|materiales?)\b/;
const someoneElses = (q: string) => CLIENT_SIDE.test(q) || TEAM_SIDE.test(q);
const featureContext = (q: string) => someoneElses(q) || DESK_SIDE.test(q) || WORK_DOC.test(q);

// ── Security ─────────────────────────────────────────────────────────────────

/** A secret pasted in: a password, a sign-in code, a PIN. Always on: a client's card is still a card. */
const SECRETS: RegExp[] = [
  /\b(my|the|our) (password|passcode|pass) ?(is|was|:|=) ?["']?(?!\d+%)(?=\S*[\d!@#$%^&*])\S{4,}/,
  /\b(mi|la|nuestra) (contrasena|clave) ?(es|era|:|=) ?["']?(?!\d+%)(?=\S*[\d!@#$%^&*])\S{4,}/,
  /\b((verification|one-?time|login|log-?in|sign-?in|security|2fa|authenticat\w*) code|(my|the|our) code) ?:? ?(is |was |= ?)?\d{6}\b/,
  /\bmi codigo ?:? ?(es |era )?\d{6}\b|\bel codigo (es|era) ?:? ?\d{6}\b/,
  /\b(my|our) pin ?(is|was|:|=)? ?\d{4,8}\b/,
];
/** A card number's shape: 4-4-4-n digits with one separator style, or 13–19 digits in a row. */
const CARD_SHAPE = /\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b|\b\d{13,19}\b/g;

/** The Luhn check every card number passes — and most tracking numbers, square footages and invoice numbers don't. */
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function hasCardNumber(q: string): boolean {
  for (const m of q.matchAll(CARD_SHAPE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

/** "security" when the question carries a secret — a card number (Luhn-checked), a password, a sign-in code, a PIN.
 *  personTopic runs it first; it is also the one check an "Answer it anyway" ask can never skip (Task 5). */
export function secretTopic(question: string): "security" | null {
  const q = fold(question);
  return SECRETS.some((r) => r.test(q)) || hasCardNumber(q) ? "security" : null;
}
/** Someone in their account, a stolen login, a phishing attempt — words, so a client or the work switches them off. */
const BREAK_IN: RegExp[] = [
  /\b(hacked|hack into|hacking into)\b/,
  /\b(was|were|been|got|is|are) compromised\b/,
  /\b(was|were|been|got) breached\b|\b(a|the) (data|security) breach (on|in|of|at) (my|our)\b/,
  /\b(got|received|clicked|opened|fell for|report|reporting)( on)?( an?| this| the)? phish\w*|\bphishing (emails?|texts?|links?|messages?) (from|pretending|claiming|asking|that)\b/,
  /\b(there was|there's been|someone (got|gained)|i noticed|we noticed|we had) (an? )?unauthori[sz]ed (access|log ?-?in|sign[- ]?in|use)\b/,
  /\b(i got|i received|there was|there's been|we had|i noticed|we noticed) (a |an |some )?suspicious (log ?-?in|sign[- ]?in|activity|access)\b(?! (alerts?|emails?|notifications?|settings?))|\bsuspicious (log ?-?in|sign[- ]?in|activity) on (my|our) account\b/,
  /\b(stolen|stole)\b.{0,30}\b(account|password|login)\b|\b(account|password|login)\b.{0,30}\b(stolen|stole)\b/,
  /\b(emails?|texts?|messages?|calls?|sms|someone)\b.{0,40}\b(asking|asked|asks|wants|wanted|requesting|requested) (me )?(for )?(my|our) (jobflex )?(password|login)\b/,
  /\b(someone|somebody|a stranger|an? unknown (person|user))( else)? (has |had |have )?(logged|signed|got|gotten|broke|broken|hacked|changed|reset|accessed|is using|was using|has been using|keeps logging)\b.{0,20}\b(my|our) (account|login|password|email)\b/,
  // Spanish
  /\b(hackearon|hackeado|hackeada)\b|\bme robaron (la|mi) (cuenta|contrasena|clave)\b/,
  /\balguien (entro|accedio|inicio sesion|esta usando|uso) (a |en )?(mi|nuestra) cuenta\b/,
  // Russian
  /взлом/,
];

// ── Leaving ──────────────────────────────────────────────────────────────────

/** Said of their own account — counts whatever else the question says. */
const LEAVING_MINE: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+${MINE}\\s+(?:${FILLER}\\s+){0,2}${OWN_THING}\\b`),
  new RegExp(`\\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze)\\s+(my|our)\\s+(jobflex\\s+)?(${ACCOUNT}|subscription|${PLAN})\\b`),
  /\bstop (charging|billing) (me|us|my card|our card|my account)\b/,
  new RegExp(`\\b(don'?t|do not|never) (auto-?)?renew (my|our) (subscription|account|${PLAN})\\b`),
  new RegExp(`\\bdowngrad\\w* (my|our) (subscription|account|${PLAN})\\b`),
  // Spanish
  /\bcerrar (mi|nuestra) cuenta\b(?! de )/,
  /\b(pausar|suspender|congelar|terminar|finalizar) (mi|nuestra) (suscripcion|subscripcion|cuenta(?! de )|plan(?! de ))/,
  /\bno (renovar|renueven|renueve) (mi|nuestra) (suscripcion|subscripcion|cuenta(?! de )|plan(?! de ))/,
  /\bdar(me|nos) de baja\b(?! de (los |las |el |la )?(correos?|emails?|mensajes?|notificaciones?|textos?|sms|alertas?|recordatorios?|boletin|newsletter))/,
  new RegExp(`\\b(quiero|queremos|voy a|vamos a|me gustaria|nos gustaria|necesito|decidi|decidimos) dejar (de usar )?jobflex${REASON_ES}`),
  new RegExp(`\\bno quiero seguir (pagando${REASON_ES}|pagando (por )?(jobflex|esto|el plan|la suscripcion)|usando jobflex|con jobflex)`),
  // Russian
  /отмен[а-я]*\s+(мо[а-я]*\s+)?подписк/,
  /закрыт[а-я]*\s+(мо[а-я]*\s+)?(аккаунт|акк|учетн)/,
];
/** Said without "my" — counts only when nothing in the question is the contractor's work, clients, team or desk. */
const LEAVING: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+(?:${FILLER}\\s+){0,3}${OWN_THING}\\b`),
  new RegExp(`\\bstop (charging|billing)( me| us)?${STOP}`),
  new RegExp(`\\bstop (the (charges|subscription|renewal)|my (subscription|renewal|${PLAN}))\\b`),
  new RegExp(`\\bstop paying${STOP}|\\bstop paying (for )?(jobflex|this|it|the (app|subscription|${PLAN}))\\b`),
  new RegExp(`\\b(don'?t|do not|never) (charge|bill) (me|us|my card)( again| anymore| any more| next month| after (the|my) trial)?${STOP}`),
  new RegExp(`\\b(don'?t|do not) want to (be )?(charged|billed|pay)( again| anymore| any more| next month| after (the|my) trial| for jobflex)?${STOP}`),
  new RegExp(`\\bno more (charges|payments|billing)${STOP}`),
  /\b(turn off|disable|stop|cancel) (the |my )?(auto-?renew\w*|automatic renewal)\b/,
  new RegExp(`\\b(turn off|stop|disable|pause|end) (the |my |all )?billing${STOP}`),
  new RegExp(`\\bdowngrad\\w*( me| us)? (to|onto) (the |a )?(free|starter|cheaper|cheapest|lower|smaller|basic) (${PLAN}|subscription|version)\\b|\\bdowngrad\\w*( me| us)? (to|onto) (the )?(free|starter)${STOP}`),
  new RegExp(`\\b(i want to|i'd like to|i would like to|i need to|how do i|how can i|can i|please) downgrade${STOP}`),
  new RegExp(`\\b(switch|move|go|change|put|drop)( me| us)?( back| down)? (to|onto) (the |a )?(free|cheaper|cheapest|lower|smaller|starter) (${PLAN}|subscription)\\b|\\b(switch|move|go|change|put|drop)( me| us)?( back| down)? (to|onto) (the )?(free|starter)( version)?${STOP}`),
  new RegExp(`\\bget off (the |my |our )?(paid |current )?(subscription|${PLAN})\\b`),
  /\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze)\s+the\s+(jobflex\s+)?(account|subscription)\b(?!'s| of | for )/,
  new RegExp(`\\b(quit|quitting|leave|leaving|stop using|done with|get rid of|cancel)\\s+jobflex${REASON}`),
  new RegExp(`\\bi('m| am) (leaving|quitting)( jobflex)?${REASON}|\\bi('m| am) done with (jobflex|this (app|software))\\b`),
  new RegExp(`\\b(don'?t|do not|no longer) (want|need) (jobflex|this (app|software|subscription)|the subscription|my (subscription|${PLAN}))${REASON}`),
  new RegExp(`\\bunsubscribe (me|us)( from (jobflex|the (${PLAN}|subscription|app)))?${STOP}|\\b(i want to|i'd like to|i need to|how do i|how can i|please) unsubscribe( from (jobflex|the (${PLAN}|subscription|app)|this (app|service)))?${STOP}`),
  // Spanish — "el plan", "el servicio", "dejen de cobrarme" are also a client's plan or Stripe's fee: behind the gate
  new RegExp(`\\bya no (quiero|queremos|necesito|necesitamos) (pagar|jobflex|usar jobflex|la suscripcion|el plan|el servicio)${REASON_ES}`),
  /\b(dejen|deje) de cobrar(me|nos)\b/,
  new RegExp(`\\bno (me|nos) (cobren|cobres|cobre)( mas)?${STOP}`),
  /\bbajar (de |mi |el )?plan\b(?! de )/,
  // Russian
  /понизит[а-я]*\s+тариф/,
  /перейти на (бесплатн|дешевл)[а-я]*\s+тариф/,
];
/** "I want to cancel." / "How do I cancel? I don't use the calendar" / "Quiero cancelar" — cancel right after asking
 *  for it in the first person, and nothing after it but "now" or "please" before the sentence ends. Not "When I
 *  cancel, …", "If I cancel, …" or "I clicked Cancel." */
const BARE_CANCEL = new RegExp(`\\b${INTENT}\\s+cancel\\w*( (now|please|today|anytime|any time|right now|asap))?${STOP}`, "g");
const BARE_CANCEL_ES = new RegExp(`\\b${INTENT_ES}\\s+cancel\\w*( (ya|ahora|hoy|por favor))?${STOP}`, "g");
function bareCancel(q: string): boolean {
  // "How do I cancel? The client changed their mind" is a client's job: a client or the AI desk anywhere keeps it null.
  if (CLIENT_SIDE.test(q) || DESK_SIDE.test(q)) return false;
  for (const m of [...q.matchAll(BARE_CANCEL), ...q.matchAll(BARE_CANCEL_ES)]) {
    // The order rule: work named BEFORE the cancel ("I sent the wrong proposal. How do I cancel?") is what they
    // cancel; work named only after it ("I want to cancel. The estimates are wrong.") is their reason for leaving.
    if (!featureContext(q.slice(0, m.index))) return true;
  }
  return false;
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Not the contractor's own refund policy or terms. */
const NOT_A_POLICY = "(?! (?:polic\\w*|terms|rules|clauses?|sections?|pages?|texts?|options?|buttons?|fields?|lines?|guarantee|forms?|requests?|process|workflow|templates?|settings?))";
const ON_THE_BILL = `( on (my|our|the) (bill|subscription|${PLAN}|renewal|account|jobflex))?`;
/** Their own money back, a credit, a better price — first person. Not when a client's or the team's. */
const MONEY: RegExp[] = [
  new RegExp(`\\brefund (me|us)( please| now| today| asap)?${STOP}`),
  /\brefund,? please\b|^(a )?refund[.!?]*$/,
  new RegExp(`\\b(where is|where's|status of|when will i get|when do i get|i want|i need|waiting (for|on)|haven'?t (got|gotten|received)) (my|our) refund\\b${NOT_A_POLICY}`),
  /\brefund (my|our) (money|payment|subscription|plan|charge|account|last|latest|month)\b/,
  new RegExp(`\\b(i|we) (want|need|would like|'d like|deserve|expect|demand) (a|my|our|some|full) refund\\b${NOT_A_POLICY}`),
  new RegExp(`\\b(can|could|may) (i|we) (get|have) (a|my|our|full) refund\\b${NOT_A_POLICY}`),
  /\b(my|our) money back\b(?! guarantee)/,
  /\b(get|have|want|need) (my|our) (last |latest |first |recent )?(payment|money|charge)s? back\b/,
  new RegExp(`\\b(can|could|would|will) you (please )?waive (this month|this month'?s (bill|charge|fee|payment)|my (bill|fee|charge|payment|subscription)|(the|this) (fee|charge|bill)( for (me|us))?|it)${STOP}`),
  new RegExp(`\\bcredit (me|us)( back)?( please)?${STOP}`),
  /\bcredit (my|our) (account|card|bill)\b/,
  new RegExp(`\\b(i|we) (want|need|deserve|expect) (a |some )?credit( for (the|this|that|last) (month|outage|downtime|trouble|problem|issue|bug|error|mistake))?${STOP}`),
  /\b(extend|extension of|longer|more days on) (my|our|the) (free )?trial\b/,
  /\bdiscounts? (on|for|off|to) (my|our) (bill|billing|subscription|renewal|jobflex)\b/,
  new RegExp(`\\b(can|could|may) (i|we) (get|have|receive) (a |any |some )?(discount|better price|lower price|cheaper price|deal)${ON_THE_BILL}${STOP}`),
  new RegExp(`\\b(can|could|would|will) you (give|offer) (me|us) (a |any |some )?(discount|deal|better price|lower price)${ON_THE_BILL}${STOP}`),
  new RegExp(`\\b(give|offer) (me|us) (a |any |some )?(discount|deal|better price)${STOP}`),
  /\b(i|we) (was|were|have been|'ve been|got|am being|'m being) (charged|billed) (twice|two times|double|again|by mistake|wrongly|without)/,
  /\byou (charged|billed) (me|us)\b/,
  /\b(compensate|reimburse) (me|us)\b/,
  // Spanish
  /\b(mi|nuestro) dinero de vuelta\b/,
  /\bdevolver(me|nos) (mi |el |nuestro )?(dinero|pago|cargo|cobro)\b/,
  /\bdevuelvan(me|nos)\b|\bdevuelve(me|nos)\b/,
  /\bme cobraron (dos veces|de mas|doble|sin autorizacion|sin permiso|sin avisar)\b/,
  /\b(quiero|necesito|quisiera|exijo) (un|mi) reembolso\b/,
  /\breembolsen(me|nos)\b/,
  new RegExp(`\\b(me|nos) (pueden|puede|podrian|podria|dan|da|darian|daria) (dar |hacer )?(un )?descuento( en (mi|nuestra) (suscripcion|mensualidad|cuenta))?${STOP}`),
  // Russian
  /верн[а-я]*\s+(мне\s+|мои\s+)?деньг/,
  /возврат[а-я]*\s+(денег|средств|оплат)/,
];
/** First person too, but also how a contractor talks about the work — a credit memo for a returned order, being
 *  overcharged on materials, disputing a supplier's charge, reimbursing job expenses, an extra month on a client's
 *  financing — so they count only when the question names nothing of the work, clients, team or desk. */
const MONEY_LOOSE: RegExp[] = [
  /\b(can|could|would|will) you (give|issue|send|add|put) (me|us) (a |some |any )?credit\b(?! (cards?|scores?|checks?|approvals?|lines?|limits?|reports?))/,
  /\b(i|we) (was|were|have been|'ve been|got) (double[- ]?(charged|billed)|over-?charged)\b|\byou (over-?charged|double[- ]?charged) (me|us)\b/,
  /\bunauthori[sz]ed (charge|payment) (on|from|to) (my|our)\b/,
  /\b(i|we)('ll| will|'m going to| am going to|'m gonna| might| may| could)( just)? (file|open|start|request|do)( a)? (chargeback|dispute)\b/,
  /\b(i|we)('ll| will|'m going to| am going to|'m gonna| want to| need to)( just)? dispute (the|this|your|a|my) (charge|payment|bill)\b/,
  /\b(i|we) (want|deserve|expect|demand) (some |a |any )?(compensation|reimbursement)\b/,
  /\b(can|could) (i|we) (get|have) (a |one |another |an )?(free|extra) months?\b|\b(give|offer) (me|us) (a |one |another |an )?(free|extra) months?\b/,
];

// ── Data ─────────────────────────────────────────────────────────────────────

/** What may follow "delete my account": the end, or words that keep it the whole account ("permanently", "and …"). */
const WHOLE =
  "(?=\\s*($|[.?!,;:])|\\s+(and|but|so|because|since|for good|forever|permanently|completely|entirely|please|now|today|right away|asap|for me|from (jobflex|your (system|database|platform|servers|records)))\\b)";
const WHOLE_ES =
  "(?=\\s*($|[.?!,;:])|\\s+(y|pero|porque|ya que|para siempre|por completo|completamente|definitivamente|permanentemente|por favor|ahora|hoy|de jobflex|de su sistema|de sus servidores)\\b)";
/** The account, the company or all of their data — never a logo, a profile picture, one line or a data export. */
const DATA: RegExp[] = [
  new RegExp(`\\b(delete|erase|wipe|remove|purge|destroy)\\s+(all\\s+(of\\s+)?)?(my|our)\\s+(jobflex\\s+)?(account|company|organi[sz]ation|workspace|data|personal (data|information|info))${WHOLE}`),
  new RegExp(`\\b(delete|erase|wipe|remove|purge)\\s+the\\s+(jobflex\\s+)?(account|company|organi[sz]ation|workspace)${WHOLE}`),
  /\b(delete|erase|wipe|remove|purge)\s+everything(?=\s*($|[.!?,;:])|\s+(from|in|on|at)\s+(my|our|the)\s+(account|company|jobflex|system|database)\b|\s+(about|for)\s+(me|us|my company)\b|\s+(permanently|forever|for good|and close))/,
  /\b(want|need|like)\b.{0,10}\b(all\s+)?(of\s+)?(my|our)\s+(data|information|info)\b.{0,15}\b(gone|erased|deleted|wiped|removed)(?=\s*($|[.!?,;:]))/,
  /\bright to be forgotten\b/,
  // Spanish
  new RegExp(`\\b(borrar|eliminar|suprimir|borra|elimina|borren|eliminen|borre|elimine)\\s+(toda\\s+|todos\\s+)?(mi|mis|nuestra|nuestros|nuestras)\\s+(cuenta|datos|empresa|compania|negocio)${WHOLE_ES}`),
  /\b(borrar|eliminar|borren|eliminen) todo(?=\s*($|[.!?,;:])|\s+(de|en) (mi|la) (cuenta|empresa)\b)/,
  // Russian
  /удал[а-я]*\s+(мо[а-я]*\s+|все\s+)?(аккаунт|акк|учетн|данн)/,
];

// ── A person ─────────────────────────────────────────────────────────────────

/** Asking for a person in words no feature uses. */
const PERSON_MINE: RegExp[] = [
  /^(i want to |i'd like to |let me |can i |i need to |please )?ask a (real |live )?person\b(?! (on|in|from|at|to) )/,
  new RegExp(`\\b(can|could) (someone|somebody|a person)( from (jobflex|support|your team))? (please )?(call|phone) (me|us)( back)?( please| today| now| asap)?${STOP}`),
  /\b(speak|talk) (to|with) your (manager|supervisor|boss)\b/,
  // Spanish
  /\bque alguien (me|nos) llame\b/,
  // Russian ("живой" folds to "живои", "поддержкой" to "поддержкои")
  /(поговорить|связаться|соедините)\s+с\s+(живым\s+)?(человеком|оператором|поддержко[иы]|менеджером)/,
  /жив(ои|ого|ым)\s+человек/,
];
const PEOPLE = "(?:a |an |some |the )?(?:real |live |actual )?(?:human|person|agent|representative|operator|someone|somebody|support|customer (?:service|support))";
/** Asking for a person in the first person — not when it's about callers, clients or the crew. */
const PERSON_ASKED: RegExp[] = [
  new RegExp(`\\b${INTENT}\\s+(talk|speak|chat)\\s+(to|with)\\s+${PEOPLE}\\b(?! (on|at|in) (my|our|the|a) )`),
  new RegExp(`\\b(i want|i need|i'd like|i would like|get me|connect me (to|with)|put me through to|transfer me to) (to (talk|speak) (to|with) )?(a |an )?(real |live |actual )?(human|person|agent|representative|operator)( please| now| asap)?${STOP}`),
  new RegExp(`\\b(i need|i want|i'd like|i would like|can i get|could i get|can i have) (some )?help from (a |an )?(real |live |actual )?(person|human)( please| now| asap| at jobflex| from jobflex)?${STOP}`),
  new RegExp(`\\b(contact|reach|get (hold of|in touch with)|email|call) (jobflex( support)?|your (support|support team|team)|the (support|jobflex) team|(jobflex )?customer (service|support)|support)${STOP}`),
  /^(a )?(human|real person|live person|customer (service|support))( please)?[.!?]*$/,
  // Spanish
  new RegExp(`\\b${INTENT_ES}\\s+hablar con (una |un |alguna |algun |el |la )?(persona( real)?|humano|ser humano|agente|representante|asesor|operador|alguien|soporte)${STOP}`),
  new RegExp(`\\b(quiero|necesito|quisiera) (una persona( real)?|un humano|un ser humano|un agente)${STOP}`),
];
/** Who owns the account — never the owner of a lead, a client's house or the phone number. */
const OWNERSHIP: RegExp[] = [
  /\btransfer\w*\s+(the\s+|my\s+|our\s+)?(account\s+)?ownership\b/,
  /\btransfer\w*\s+(the\s+|my\s+|our\s+)?(jobflex\s+)?(account|company|business)\s+to\s+(someone|another (person|owner)|my (business )?partner|the new owner|a new owner|the buyer|my (son|daughter|wife|husband))\b/,
  /\b(change|switch|replace|transfer)\s+(the\s+)?(account owner|ownership|owner of (the|my|our) (account|company|business|jobflex))\b/,
  new RegExp(`\\b(change|switch|replace)\\s+(the\\s+)?owner${STOP}`),
  /\bnew account owner\b|\b(the|a) new owner of (the|my|our|this) (account|company|business|jobflex)\b/,
  /\badd (an?|another|a second|a new) (co-?)?owner\b(?!'s)/,
  /\bmake\s+(?!sure\b)(\S+\s+){1,3}(the|an?|co-?)\s*owners?\b(?!'s)/,
  /\b(sold|selling|sell)\s+(my|the|our)\s+(business|company)\b/,
  // Spanish
  /\btransferir (la )?propiedad\b|\btransferir (la |mi )?(cuenta|empresa) a (mi socio|mi socia|otra persona|otro dueno|el nuevo dueno)\b/,
  new RegExp(`\\b(cambiar|nuevo) (el )?(dueno|propietario)( de (la|mi) (cuenta|empresa))?${STOP}`),
];
/** The law and anger — unless it's the work talking ("scam calls", "a client's lawyer"). */
const LAW_OR_ANGER: RegExp[] = [
  /\b(lawyer|attorney|lawsuit|legal action|legal team)\b/,
  /\b(sue|suing) (you|jobflex)\b|\b(subpoena|small claims|class action|better business bureau)\b/,
  /\b(scam\w*|rip[- ]?off|ripped off|wtf|f+u+c+k\w*|bullshit)\b/,
  /\b(abogad\w*|demandar\w*|estafa\w*)\b|\b(poner|presentar|interponer) (una )?demanda\b/,
  /юрист|адвокат|мошенни/,
];

/** A question only a person answers, said any way we know (English, Spanish, some Russian), or null. Precision
 *  first: a feature question that sounds alike is null, and the model's rules catch what this leaves. */
export function personTopic(question: string): PersonTopic | null {
  if (secretTopic(question)) return "security";
  const q = fold(question);
  if (!q) return null;
  const any = (rs: RegExp[]) => rs.some((r) => r.test(q));
  const work = featureContext(q);
  if (!work && !OWN_PEOPLE.test(q) && any(BREAK_IN)) return "security";
  if (any(LEAVING_MINE) || (!work && any(LEAVING)) || bareCancel(q)) return "leaving";
  if ((!someoneElses(q) && any(MONEY)) || (!work && any(MONEY_LOOSE))) return "money";
  if (!someoneElses(q) && any(DATA)) return "data";
  if (any(PERSON_MINE)) return "person";
  if (!CLIENT_SIDE.test(q) && !DESK_SIDE.test(q) && !CREW.test(q) && any(PERSON_ASKED)) return "person";
  if (!CLIENT_SIDE.test(q) && !DESK_SIDE.test(q) && !WORK_DOC.test(q) && any(OWNERSHIP)) return "person";
  if (!work && any(LAW_OR_ANGER)) return "person";
  return null;
}

/** The line a person-topic reply shows (no steps; Ask a person comes first). */
export const PERSON_REPLY: Record<PersonTopic, string> = {
  leaving: "Cancelling or downgrading your plan is something a person on our team helps you with. Press Ask a person — your question goes with it.",
  money: "Refunds, credits and discounts on your bill are answered by a person on our team. Press Ask a person — your question goes with it.",
  data: "Deleting an account or its data is done with a person on our team, so nothing is lost by mistake. Press Ask a person.",
  security: "A person on our team will help with your account's security right away. Press Ask a person — and never share a password, card number or code; we never need them.",
  person: "A person on our team will answer you. Press Ask a person — your question goes with it.",
};
