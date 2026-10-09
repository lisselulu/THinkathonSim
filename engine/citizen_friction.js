/* =====================================================================
   CITIZEN FRICTION — what 5.9 million people make of your budget
   ---------------------------------------------------------------------
   A society is not a spreadsheet with a conscience bolted on. Governments
   fail because people stop cooperating: they strike, they boycott, they
   stop turning up, they vote you out. This module is where that enters
   the model.

   Twelve stratified archetypes stand in for the population — spanning
   income percentile, exposure to automation, and age. Each round they are
   shown what actually changed and asked what they make of it. Their
   answers aggregate into one number, `civic_unrest` (0-100), which the
   engine takes as friction on capacity.

   WHY THIS IS NOT INSIDE THE ENGINE
   ---------------------------------
   A model's reading of a mood cannot be allowed to change what the same
   levers produce, or cross-team comparison dies and a trace stops
   replaying. So unrest is computed OUT here, passed IN as exogenous, and
   recorded in the trace — exactly as trade is. The feedback loop is real;
   the engine stays pure.

   AND WHY IT WORKS WITHOUT A MODEL
   --------------------------------
   `reactDeterministic` reads the same signals from the same state and
   returns the same shape. No API key, no server, no network: the loop
   still closes, the tests still run, and a Thinkathon whose model server
   falls over at 2pm carries on. The model adds voice and nuance; it is
   not load-bearing for the simulation to function.
   ===================================================================== */

'use strict';

const E = require('./meridian-engine.js');

/* ---------------------------------------------------------------------
   THE CORPUS
   ---------------------------------------------------------------------
   Twelve people who between them cover the ways this economy can treat
   somebody. `weight` is the share of the population each stands for, and
   they sum to 1. `depends` names the services whose decay they feel
   first; `exposure` is how directly the machines came for their work.
   --------------------------------------------------------------------- */
const ARCHETYPES = [
  { id:'A01', name:'Rahim bin Yusof', role:'logistics coordinator, 34',
    weight:.11, income:45, exposure:'high', working:true,
    depends:['retail_commerce','transport_logistics'],
    voice:'Watched the depot go from forty people to four. Still employed, and knows it is luck.' },
  { id:'A02', name:'Mdm Tan Ah Choo', role:'retired cleaner, 68',
    weight:.09, income:12, exposure:'n/a', working:false,
    depends:['care_services','healthcare'],
    voice:'Lives alone on the payment and small savings. Counts the cost of everything.' },
  { id:'A03', name:'Sister Grace Lim', role:'nurse, 45',
    weight:.08, income:58, exposure:'low', working:true,
    depends:['healthcare','care_services'],
    voice:'The one job the machines could not take. Works the shifts nobody else will.' },
  { id:'A04', name:'Nurul Aisyah', role:'ITE graduate, 22',
    weight:.07, income:8, exposure:'high', working:false,
    depends:['education_research','manufacturing'],
    voice:'Trained for work that stopped existing while she was training for it.' },
  { id:'A05', name:'Daniel Ong', role:'owns automated capital, 52',
    weight:.04, income:97, exposure:'low', working:true,
    depends:['finance','compute_telecom'],
    voice:'Owns three of the warehouses that stopped needing people. Comfortable, and quietly uneasy.' },
  { id:'A06', name:'Farah Idris', role:'gig artisan, 27',
    weight:.09, income:24, exposure:'medium', working:true,
    depends:['retail_commerce','transport_logistics'],
    voice:'Six income streams, none of them a job. Good months and months of nothing.' },
  { id:'A07', name:'Wei Sheng', role:'data centre technician, 31',
    weight:.05, income:71, exposure:'low', working:true,
    depends:['compute_telecom','energy_utilities'],
    voice:'Keeps the machines running. Aware that this is why he still has work.' },
  { id:'A08', name:'Priya Raman', role:'single parent, part-time retail, 36',
    weight:.10, income:19, exposure:'high', working:true,
    depends:['education_research','care_services','retail_commerce'],
    voice:'Hours cut twice. Childcare and the payment are the whole budget.' },
  { id:'A09', name:'Lim Boon Hock', role:'hawker, 49',
    weight:.07, income:33, exposure:'medium', working:true,
    depends:['food_agri','retail_commerce'],
    voice:'Sells to people who have less money than they used to. Feels demand before economists do.' },
  { id:'A10', name:'Mr Krishnan', role:'chronic illness, 74',
    weight:.08, income:10, exposure:'n/a', working:false,
    depends:['healthcare','care_services'],
    voice:'Three appointments a month. Notices a waiting list before it appears in a statistic.' },
  { id:'A11', name:'Cheryl Goh', role:'secondary teacher, 41',
    weight:.06, income:54, exposure:'medium', working:true,
    depends:['education_research','public_admin','public_safety'],
    voice:'Teaches children whose parents have no work. Sees what that does before anyone else.' },
  { id:'A12', name:'Marcus Teo', role:'displaced analyst, 44',
    weight:.16, income:28, exposure:'high', working:false,
    depends:['retail_commerce','finance','housing_construction'],
    voice:'Earned well for twenty years. Now on the payment, and has not said so at dinner.' }
];

/* Sanity: the population is fully accounted for. */
const WEIGHT_SUM = ARCHETYPES.reduce((a, p) => a + p.weight, 0);

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   WHAT EACH PERSON IS SHOWN
   ---------------------------------------------------------------------
   Not the whole world state — what changed, for them. A round's delta in
   the terms a person would actually notice.
   --------------------------------------------------------------------- */
function macroDelta(prev, next) {
  const worst = s => Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
  const d = (a, b) => Math.round((b - a) * 10) / 10;
  return {
    round: next.meta.round,
    year: next.meta.year,
    payment_now: next.indicators.ubi_monthly_sgd,
    payment_change: next.indicators.ubi_monthly_sgd - prev.indicators.ubi_monthly_sgd,
    purchasing_power: next.indicators.effective_ubi_index,
    purchasing_power_change: d(prev.indicators.effective_ubi_index, next.indicators.effective_ubi_index),
    employment_pct: Math.round(next.indicators.employment_rate * 100),
    employment_change: d(prev.indicators.employment_rate * 100, next.indicators.employment_rate * 100),
    worst_service: worst(next),
    worst_service_change: d(worst(prev), worst(next)),
    inequality: next.indicators.gini,
    shocks: (next.shocks || []).map(k => (E.SHOCKS[k] || {}).label || k),
    services: E.ORDER.reduce((o, k) => {
      o[k] = { quality: next.sectors[k].quality,
               change: next.sectors[k].quality - prev.sectors[k].quality };
      return o;
    }, {})
  };
}

/* ---------------------------------------------------------------------
   THE DETERMINISTIC READING
   ---------------------------------------------------------------------
   How each archetype feels, computed from the same state the engine
   already carries. Runs with no model, no network, and no key — which is
   what makes the whole loop dependable rather than a demo.
   --------------------------------------------------------------------- */
function reactDeterministic(prev, next) {
  const md = macroDelta(prev, next);
  const reactions = ARCHETYPES.map(p => {
    // The services this person actually leans on, not the average.
    const svc = p.depends.reduce((a, k) => a + md.services[k].quality, 0) / p.depends.length;
    const svcMove = p.depends.reduce((a, k) => a + md.services[k].change, 0) / p.depends.length;

    /* Poorer households live closer to the edge of every number, so the
       same cut lands harder. This is the whole reason a stratified corpus
       beats one average citizen. */
    const exposureToCuts = 1 + (60 - clamp(p.income, 0, 100)) / 100;

    let discontent = 0;
    discontent += clamp((62 - svc) * 0.9, -25, 45);                    // services
    discontent += clamp(-svcMove * 2.2, -12, 22);                      // and their direction
    discontent += clamp((100 - md.purchasing_power) * 0.30, -18, 36) * exposureToCuts;
    discontent += clamp(-md.purchasing_power_change * 1.6, -12, 26) * exposureToCuts;
    if (p.working === false && p.exposure !== 'n/a') {
      discontent += clamp((45 - md.employment_pct) * 0.55, -8, 26);    // no work, and no prospect
    }
    if (p.exposure === 'high') discontent += clamp((45 - md.employment_pct) * 0.30, -6, 16);
    if (p.income > 85) discontent -= 8;                                // owners are insulated
    discontent += md.shocks.length * 6;

    const sentiment = clamp(Math.round(50 - discontent), -100, 100);   // +50 content, -100 furious
    return {
      id: p.id, name: p.name, role: p.role, weight: p.weight,
      sentiment: sentiment,
      concern: dominantConcern(p, md, svc),
      quote: null                                    // the model supplies voice; this does not
    };
  });
  return { reactions: reactions, delta: md, source: 'deterministic' };
}

function dominantConcern(p, md, svc) {
  const pains = [
    ['services', (62 - svc) * 0.9],
    ['the payment', (100 - md.purchasing_power) * 0.30],
    ['no work', p.working === false ? (45 - md.employment_pct) * 0.55 : -99],
    ['a shock', md.shocks.length ? 18 : -99]
  ].sort((a, b) => b[1] - a[1]);
  return pains[0][1] > 4 ? pains[0][0] : 'nothing in particular';
}

/* ---------------------------------------------------------------------
   THE AGGREGATE
   ---------------------------------------------------------------------
   One number the engine can take as friction, plus the three voices worth
   putting on a screen.
   --------------------------------------------------------------------- */
function aggregate(result) {
  const rs = result.reactions;
  // Weighted mean sentiment -> unrest. -100 sentiment is 100 unrest.
  const mean = rs.reduce((a, r) => a + r.sentiment * r.weight, 0) / WEIGHT_SUM;
  let unrest = clamp(Math.round((50 - mean) * 0.9), 0, 100);

  /* A society where most are content and a tenth are desperate is not the
     same as one where everybody is mildly put out, and it is usually the
     more dangerous of the two. The spread is part of the reading. */
  const furious = rs.filter(r => r.sentiment < -35)
                    .reduce((a, r) => a + r.weight, 0) / WEIGHT_SUM;
  unrest = clamp(Math.round(unrest + furious * 30), 0, 100);

  const loudest = rs.slice().sort((a, b) => a.sentiment - b.sentiment).slice(0, 3);
  return {
    civic_unrest: unrest,
    mean_sentiment: Math.round(mean),
    share_furious: Math.round(furious * 100),
    dispatches: loudest.map(r => ({
      name: r.name, role: r.role, sentiment: r.sentiment,
      concern: r.concern, quote: r.quote
    })),
    reactions: rs,
    source: result.source
  };
}

/* ---------------------------------------------------------------------
   THE MODEL READING
   ---------------------------------------------------------------------
   One batched call for the whole corpus rather than twelve — a local
   model answering twelve prompts a round, twelve rounds, five teams is
   720 calls and an afternoon. One call also lets the model see the
   population together, which is what you want it reasoning about.

   Any failure falls back to the deterministic reading and says so. The
   round never fails because a model did.
   --------------------------------------------------------------------- */
function buildPrompt(prev, next) {
  const md = macroDelta(prev, next);
  const arrow = v => (v > 0 ? '+' + v : String(v));
  const svc = E.ORDER.map(k =>
    '  ' + E.SECTORS[k].name.padEnd(21) + String(md.services[k].quality).padStart(3) +
    '  (' + arrow(md.services[k].change) + ')').join('\n');
  const people = ARCHETYPES.map(p =>
    '  ' + p.id + '  ' + p.name + ' — ' + p.role +
    '\n        income percentile ' + p.income + ', AI exposure ' + p.exposure +
    ', ' + (p.working ? 'in work' : 'not in work') +
    '\n        leans on: ' + p.depends.map(k => E.SECTORS[k].name).join(', ') +
    '\n        ' + p.voice).join('\n');

  return `Meridian, ${md.year}. Round ${md.round} of 12.

You are reading the mood of a city-state of 5.9 million people after this round's
budget. Twelve residents stand in for the population. Answer as each of them.

WHAT CHANGED THIS ROUND
  Universal payment      $${md.payment_now}/month  (${arrow(md.payment_change)})
  What it actually buys  ${md.purchasing_power} vs 100 in 2050  (${arrow(md.purchasing_power_change)})
  Employment             ${md.employment_pct}%  (${arrow(md.employment_change)} points)
  Worst public service   ${md.worst_service}/100  (${arrow(md.worst_service_change)})
  Inequality (gini)      ${md.inequality}
  In force               ${md.shocks.length ? md.shocks.join(', ') : 'nothing unusual'}

SERVICE QUALITY, 0-100
${svc}

THE TWELVE
${people}

For each person give a sentiment from -100 to 100:
  +50 and up   content, things are working
  0            uneasy, watching
  -40          angry, would sign something
  -80 and down would strike, riot, or leave

Judge from where THEY stand, not from the averages. A cut lands harder on
someone with nothing behind them. Somebody whose hospital is failing does not
care that transport improved. An owner of automated capital may be doing well
while the city is not.

Reply with nothing but a \`\`\`json fenced object:

{
  "reactions": [
    { "id": "A01", "sentiment": -30, "concern": "no work",
      "quote": "one sentence in their own voice, under 20 words" }
  ]
}

All twelve, in order, ids exactly as given.`;
}

function reactionSchema(data) {
  if (!data || !Array.isArray(data.reactions)) return { ok: false, reason: 'need a `reactions` array' };
  const byId = {};
  data.reactions.forEach(r => { if (r && r.id) byId[r.id] = r; });
  const missing = ARCHETYPES.filter(p => !byId[p.id]).map(p => p.id);
  if (missing.length > 4) return { ok: false, reason: 'missing reactions for ' + missing.join(', ') };
  return { ok: true, value: byId };
}

/**
 * readTheRoom(prev, next, opts) -> aggregate
 *   opts.client  an llm_client; omit for the deterministic reading
 *   opts.onFault called with a reason when the model could not be used
 */
async function readTheRoom(prev, next, opts) {
  opts = opts || {};
  const fallback = () => aggregate(reactDeterministic(prev, next));
  if (!opts.client) return fallback();

  try {
    const r = await opts.client.json(buildPrompt(prev, next), {
      schema: reactionSchema, temperature: 0.7, maxTokens: 1400
    });
    if (!r.data) {
      if (opts.onFault) opts.onFault('citizens: ' + (r.invalid || 'no usable reply'));
      return fallback();
    }
    /* THE MODEL GIVES THE VOICE. THE ARITHMETIC GIVES THE NUMBER.
       ---------------------------------------------------------------
       `sentiment` stays deterministic, because it becomes civic_unrest,
       which the engine consumes, which moves the score. If a model set it,
       the same twelve levers would produce a different country depending
       on what a 7B model felt like that afternoon, and no two teams could
       be compared.

       That is not hypothetical. When sentiment came from the model, a
       country still paying $657 with its worst service at 67 was read at
       95/100 unrest in round 3 — small models narrate hardship
       dramatically, which is exactly what you want from a quote and
       exactly what you cannot have in a scored input.

       What the model contributes is what it is good at: what this person
       is worried about, and how they would say it. Set
       `sentimentFromModel: true` to hand the number back to the model —
       useful for a demo of how unstable that is, never for a scored run. */
    const det = reactDeterministic(prev, next);
    const trusted = opts.sentimentFromModel === true;
    const merged = det.reactions.map(base => {
      const m = r.data[base.id];
      if (!m) return base;
      const s = Number(m.sentiment);
      return Object.assign({}, base, {
        sentiment: (trusted && isFinite(s)) ? clamp(Math.round(s), -100, 100) : base.sentiment,
        // Kept for the bulletin and for showing students the gap between
        // how a model reads a round and how the arithmetic reads it.
        model_sentiment: isFinite(s) ? clamp(Math.round(s), -100, 100) : null,
        concern: typeof m.concern === 'string' ? m.concern.slice(0, 60) : base.concern,
        quote: typeof m.quote === 'string' ? m.quote.slice(0, 160) : null
      });
    });
    return aggregate({ reactions: merged, delta: det.delta,
                       source: trusted ? 'model' : 'model-voiced' });
  } catch (err) {
    if (opts.onFault) opts.onFault('citizens: ' + (err && err.message));
    return fallback();
  }
}

module.exports = {
  ARCHETYPES, WEIGHT_SUM,
  macroDelta, reactDeterministic, aggregate, readTheRoom, buildPrompt, reactionSchema
};
