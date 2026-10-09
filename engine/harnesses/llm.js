/* =====================================================================
   LLM HARNESS ADAPTER
   ---------------------------------------------------------------------
   Turns a model into a government.

   Provider-agnostic on purpose: you supply a `call(prompt) -> Promise<string>`
   and this module handles the rest — packaging the world into a briefing,
   extracting the lever block from the reply, and surviving the reply
   being malformed, which it eventually will be.

     const harness = makeLLMHarness({
       call: async (prompt) => (await myModel(prompt)).text,
       persona: 'You are the Chancellor of Meridian...'
     });

   Nothing here needs an API key to test. Pass a `call` that returns a
   canned string and the whole path is exercised.

   WHY THIS IS THE INTERESTING FILE
   --------------------------------
   Everything a team believes about government lives in the prompt, and
   the prompt is prose. But what leaves this file is nine numbers the
   frozen engine consumes. That is the whole trick: semantic inside,
   deterministic at the boundary. Write a better briefing and you get a
   better country — not because the engine rewards good writing, but
   because a better-briefed government makes better choices.
   ===================================================================== */

const E = require('../meridian-engine.js');

/* ---------------------------------------------------------------------
   THE BRIEFING
   ---------------------------------------------------------------------
   What the government is told before it decides. Compact on purpose: a
   model that is shown everything attends to nothing. Every line here is
   something a real cabinet would be handed.
   --------------------------------------------------------------------- */
function buildBriefing(ctx) {
  const s = ctx.state, i = s.indicators, f = s.fiscal;
  const n = v => Math.round(v).toLocaleString('en-SG');
  const pct = v => Math.round(v * 100) + '%';

  const sectors = E.ORDER.map(k => {
    const x = s.sectors[k];
    const band = x.quality >= 65 ? 'healthy' : (x.quality >= 40 ? 'strained' : 'FAILING');
    return '  ' + E.SECTORS[k].name.padEnd(22) +
      'quality ' + String(x.quality).padStart(3) + ' (' + band + ')' +
      '  automation ' + pct(x.automation).padStart(4) +
      '  capacity ' + pct(x.capacity).padStart(4) +
      '  staff ' + n(x.headcount).padStart(8) +
      '  tolerance ' + pct(E.SECTORS[k].comfort);
  }).join('\n');

  const con = ctx.constitution;
  const conBlock = con
    ? '\nYOUR CONSTITUTION — "' + con.name + '"\n' +
      'You sealed this in week one, before you knew what was coming. You may\n' +
      'depart from it, but you will be asked at judging to justify why.\n' +
      (con.commitments || []).map((c, ix) => '  ' + (ix + 1) + '. ' + c).join('\n') +
      ((con.rules || []).length
        ? '\n  Checked as: ' + con.rules.map(r => r.id + ' [' + r.assert + ']').join(', ')
        : '')
    : '';

  /* The market, when there is one. A society running alone never sees
     this block at all, so a single-world briefing is unchanged. */
  let marketBlock = '';
  if (ctx.market) {
    const mk = ctx.market;
    const sur = Object.keys(mk.surplus)
      .map(k => '    ' + k.padEnd(9) + String(mk.surplus[k]).padStart(10) +
        '   you may export ' + mk.export_caps[k] + ' this round')
      .join('\n');
    const others = mk.societies.map(o =>
      '    ' + o.name.padEnd(14) + 'reputation ' + String(o.reputation).padStart(3) +
      '   worst service ' + String(o.headline.worst_essential).padStart(3) +
      '   reserves $' + Math.round(o.headline.reserves_bn) + 'bn' +
      '\n      on their shelf: ' + Object.keys(o.surplus)
        .filter(k => o.surplus[k] > 0)
        .map(k => k + ' ' + o.surplus[k]).join(', ')).join('\n');
    const table = (mk.offers_to_me || []).length
      ? mk.offers_to_me.map(o => '    [' + o.id + ']  ' + o.from + ' offers you ' +
          o.quantity + ' ' + o.resource + ' for $' + o.price + 'bn' +
          (o.type === 'forward' ? ', delivering in ' + o.deliver_in + ' rounds' : '') +
          (o.note ? '  (' + o.note + ')' : '')).join('\n')
      : '    nothing';
    const mine = (mk.my_open_offers || []).length
      ? mk.my_open_offers.map(o => '    ' + o.to + ': ' + o.quantity + ' ' + o.resource +
          ' for $' + o.price + 'bn — awaiting their answer').join('\n')
      : '    none';
    const said = (mk.messages || []).length
      ? mk.messages.slice(-6).map(m => '    ' + m.from + (m.to ? ' (to you)' : '') +
          ': ' + m.text).join('\n')
      : '    nothing';
    const owed = (mk.my_contracts || []).length
      ? mk.my_contracts.map(c => '    ' + (c.from === mk.me
          ? 'YOU OWE ' + c.to + ' ' + c.quantity + ' ' + c.resource + ' in round ' + c.deliver_round
          : c.from + ' owes you ' + c.quantity + ' ' + c.resource + ' in round ' + c.deliver_round)).join('\n')
      : '    none';

    marketBlock = `

THE MARKET
  Your reputation      ${mk.reputation}/100 — you receive ${mk.terms_multiplier}x on what you sell
  Forward market       ${mk.forward_market_open ? 'open to you' : 'CLOSED — your reputation is below 40'}

  Your surplus, and what you may export this round:
${sur}

  The other societies (everything here is public):
${others}

  Offers on your table — answer these by id:
${table}

  Offers you have made, still unanswered:
${mine}

  Contracts outstanding:
${owed}

  What has been said:
${said}

  Trading rules
    · An offer you make now is answered NEXT round. Deals take two rounds.
    · spot     settles at the end of the round it is accepted
    · forward  delivers in 1-6 rounds. You may promise more than you hold
               today — but if you cannot deliver on the day it is a DEFAULT:
               25 reputation, the payment goes back, and below 40 the
               forward market closes to you for three rounds.
    · aid      no price, no acceptance needed. Costs you the goods, raises
               your legitimacy and their cohesion.
    · credits are the money. You may GIVE them as aid; you cannot sell them.
    · You may export at most 25% of any surplus per round.
    · You may ACCEPT, REJECT or COUNTER anything on your table. A counter
      closes their offer and opens yours running the other way, carrying
      their terms except what you change:
          "responses": { "<their id>": { "price": 4, "quantity": 2 } }
    · Talk in \`message\` all you like. The market never reads it — only the
      objects settle. If your words and your object disagree, the OBJECT wins.`;
  }

  return `ROUND ${ctx.round}${ctx.rounds ? ' of ' + ctx.rounds : ''} — the year is ${ctx.year}.
You govern Meridian, a city-state of ${n(s.population.total)} people.
${conBlock}

WHERE THINGS STAND
  Universal payment      $${n(i.ubi_monthly_sgd)}/month (mean per resident)
  Purchasing power       ${i.real_ubi_index} after inflation, ${i.effective_ubi_index} after service access
  Employment             ${pct(i.employment_rate)} of working age
  Consumption index      ${i.consumption_index}  (round 1 = 100)
  Cohesion / legitimacy  ${i.cohesion} / ${i.legitimacy}
  Gini                   ${i.gini}
  Reserves               $${n(f.reserves_bn)}bn
  GDP / tax revenue      $${n(f.gdp_bn)}bn / $${n(f.tax_revenue_bn)}bn
  Worst essential srv    ${ctx.worstEssential}   (below 40 for two rounds is a hard gate)
  Active shocks          ${(s.shocks || []).map(k => E.SHOCKS[k].label).join(', ') || 'none'}

SECTORS
${sectors}

THIS ROUND'S BULLETIN
${(ctx.news || []).map(x => '  · ' + x).join('\n') || '  · nothing of record'}

THE OPPOSITION SAYS
${(ctx.opposition || []).map(x => '  · ' + x).join('\n') || '  · nothing'}
${marketBlock}

LEVERS CURRENTLY IN FORCE
${JSON.stringify(ctx.levers, null, 2)}

WHAT YOU MAY CHANGE
  corporate_tax_rate    0 to 0.45   revenue now; but profit you leave firms
                                    is reinvested, and reinvestment is what
                                    stops the capital stock depreciating
  compute_levy          0 to 0.30   taxes automation; also slows adoption
  reskilling_spend_pct  0 to 0.30   moves people out of high AI exposure,
                                    pays off three rounds later
  public_ownership_pct  0 to 0.50   a dividend that does not depend on the
                                    profit tax base, and capital maintained
                                    from the infrastructure vote
  allocation            {ubi, infrastructure, reserves}, summing to 1.
                                    Infrastructure buys service quality AND
                                    maintains the capital stock.
  ubi_design            "flat" | "means_tested" | "age_weighted"
  working_week_days     3 | 4 | 5   shorter spreads work, cuts output less
                                    than proportionally
  care_job_guarantee    true|false  hires the unemployed into care at a loss
  automation_target     per sector, 0 to 0.98. Past a sector's tolerance,
                                    service quality falls — hardest where the
                                    service IS the human contact.

REMEMBER
  You are scored on effective purchasing power, on your WORST essential
  service, on cohesion, on fidelity to the constitution above, and on
  whether the society is still solvent in 2074. Not on GDP, and not on the
  headline dollar figure — import inflation can raise a payment while the
  people receiving it get poorer.

  Automation removes wages. Wages are household income. Household income
  is consumption. Consumption is the demand your sectors sell into, and
  those sales are the profit you tax to fund the payment that replaced the
  wages. Removing too many wages too fast eventually removes the tax base
  funding the transfer.

RESPOND WITH
  A short paragraph of reasoning, then one fenced \`\`\`json block.

  Include only what you are CHANGING. Omit anything you are holding.
${ctx.market ? `
  {
    "levers":    { "corporate_tax_rate": 0.3 },
    "offers":    [ { "to": "<society>", "resource": "compute|energy|food|labour|credits",
                     "quantity": 4, "price": 5,
                     "type": "spot|forward|aid", "deliver_in": 2 } ],
    "responses": { "<id>": "accept",
                   "<id>": "reject",
                   "<id>": { "price": 4 } },
    "message":   "one line to the other societies"
  }

  Omit "offers", "responses" or "message" entirely if you are doing none of
  them. A bare object with no "levers" key is read as the levers alone.`
: `
  { "corporate_tax_rate": 0.3, "allocation": { ... } }`}`;
}

/* ---------------------------------------------------------------------
   PARSING
   ---------------------------------------------------------------------
   Models return prose with a JSON block in it, usually. Take the last
   fenced block, fall back to the last balanced object, and if neither
   works return null so the runner holds the previous levers and logs a
   fault. A government that cannot make itself understood does not get to
   improvise on the country's behalf.
   --------------------------------------------------------------------- */
function extractLevers(text) {
  if (!text || typeof text !== 'string') return null;

  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  for (let i = fenced.length - 1; i >= 0; i--) {
    try { return JSON.parse(fenced[i]); } catch (e) { /* try the next one */ }
  }
  // No usable fence: scan for the last balanced {...} and try that.
  let depth = 0, end = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') { if (depth === 0) end = i; depth++; }
    else if (c === '{') {
      depth--;
      if (depth === 0 && end > i) {
        try { return JSON.parse(text.slice(i, end + 1)); } catch (e) { end = -1; }
      }
    }
  }
  return null;
}

/* A reply may be either a bare lever object (the single-world shape) or a
   full envelope carrying levers, offers, responses and a message. Accept
   both: a student who has not started trading yet should not have to
   change their prompt to keep working. */
function unpackReply(parsed) {
  if (!parsed || typeof parsed !== 'object') return { levers: null };
  const isEnvelope = ['levers', 'offers', 'responses', 'message', 'messages']
    .some(k => Object.prototype.hasOwnProperty.call(parsed, k));
  if (!isEnvelope) return { levers: parsed };
  return {
    levers: parsed.levers || null,
    offers: Array.isArray(parsed.offers) ? parsed.offers : undefined,
    responses: (parsed.responses && typeof parsed.responses === 'object') ? parsed.responses : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    messages: (parsed.messages && typeof parsed.messages === 'object') ? parsed.messages : undefined
  };
}

function extractRationale(text) {
  if (!text) return '';
  const before = String(text).split('```')[0].trim();
  return before.replace(/\s+/g, ' ').slice(0, 400);
}

/* ---------------------------------------------------------------------
   THE ADAPTER
   --------------------------------------------------------------------- */
function makeLLMHarness(opts) {
  opts = opts || {};
  const call = opts.call;
  if (typeof call !== 'function') throw new Error('makeLLMHarness needs a call(prompt) function');
  const persona = opts.persona ||
    'You are the Chancellor of Meridian. You are a careful, numerate head of ' +
    'government who reads the whole board before moving, and who would rather ' +
    'be defensible than impressive.';
  const retries = opts.retries == null ? 1 : opts.retries;

  return async function llmHarness(ctx) {
    const prompt = persona + '\n\n' + buildBriefing(ctx);
    let text = null, levers = null;

    for (let attempt = 0; attempt <= retries && !levers; attempt++) {
      text = await call(attempt === 0 ? prompt
        : prompt + '\n\nYour previous reply had no readable JSON block. ' +
                   'Reply again, ending with a fenced ```json block.');
      levers = extractLevers(text);
    }

    const reply = unpackReply(levers);
    return Object.assign({}, reply, {
      rationale: extractRationale(text),
      raw: opts.keepRaw ? text : undefined
    });
  };
}

/* ---------------------------------------------------------------------
   A MULTI-AGENT HARNESS
   ---------------------------------------------------------------------
   The shape most teams should aim for. Three voices, one decision:

     Treasury proposes    — what the numbers say
     Opposition objects   — what it costs, and who pays it
     Chancellor decides   — and is the only one who emits levers

   This is what "harness engineering" means here. The agents argue in
   language; exactly one number vector leaves the building. Add a Sector
   Chief, a Household Advocate, an Auditor who checks the proposal against
   the constitution before it ships — the contract does not change.
   --------------------------------------------------------------------- */
function makeCabinetHarness(opts) {
  opts = opts || {};
  const call = opts.call;
  if (typeof call !== 'function') throw new Error('makeCabinetHarness needs a call(prompt) function');

  return async function cabinet(ctx) {
    const brief = buildBriefing(ctx);

    const proposal = await call(
      'You are the Treasury of Meridian. Read the briefing and propose a lever ' +
      'package for this round. Argue from the numbers. Be specific and be brief.\n\n' + brief);

    const objection = await call(
      'You are the Opposition. Attack the Treasury\'s proposal below on behalf of ' +
      'the people who will bear its costs. Name the households who lose. Be brief.\n\n' +
      brief + '\n\nTREASURY PROPOSES\n' + proposal);

    const decision = await call(
      'You are the Chancellor. You have heard both. Decide.\n\n' + brief +
      '\n\nTREASURY PROPOSES\n' + proposal +
      '\n\nOPPOSITION OBJECTS\n' + objection +
      '\n\nGive one paragraph of reasoning, then a fenced ```json block of only ' +
      'the levers you are changing.');

    return Object.assign({}, unpackReply(extractLevers(decision)), {
      rationale: extractRationale(decision),
      deliberation: opts.keepRaw ? { proposal, objection, decision } : undefined
    });
  };
}

module.exports = { makeLLMHarness, makeCabinetHarness, buildBriefing,
                   extractLevers, extractRationale, unpackReply };
