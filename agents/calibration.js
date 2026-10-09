/* =====================================================================
   BEHAVIOURAL CALIBRATION
   ---------------------------------------------------------------------
   Swapping formulas we can read for behaviour we cannot check is only
   worth it if the behaviour is checked. Before a model is trusted with an
   assessed run it must pass this suite, and the result is stored against
   the model's name.

   Five checks, each on behaviour with a known human shape:

   1  FAIRNESS       Offers in a one-shot split with a stranger. Human
                     experiments put mean offers around 40-50%; Light
                     Society's agents reached 41. Pass: mean in [25, 55].
   2  RECIPROCITY    A trustee returns more when trusted with more. Pass:
                     return rises with the amount received.
   3  INCOME         Spending responds to income the way households do:
                     more income, more spending, but not all of it.
                     Pass: implied marginal propensity in [0.1, 1.0].
   4  GRIEVANCE      People take collective action more when conditions are
                     worse. Pass: the share choosing to strike or protest is
                     at least 20 points higher under severe grievance.
   5  PERSONA        Different people decide differently in the same
                     situation. Pass: spending shares vary (sd >= 0.03) or
                     at least three distinct work choices appear.

   The thresholds are deliberately wide: this is a gate against a model
   that is docile, uniform or incoherent, not a claim that it is human.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./citizen.js');

const STORE = path.join(__dirname, 'calibration.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return {}; }
}

/** The stored result for a model, or null. */
function status(model) {
  const all = load();
  return model && all[model] ? all[model] : null;
}

function save(model, result) {
  const all = load();
  all[model] = result;
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2));
}

const PERSONAS = [
  'a 68-year-old retired cleaner living alone in a small rental flat, anxious about money',
  'a 34-year-old logistics coordinator with two children, worried machines will take his job',
  'a 45-year-old senior banker with a condominium and a comfortable savings buffer',
  'a 23-year-old nursing student, idealistic and active in her community',
  'a 52-year-old hawker who has run the same food stall for twenty years',
  'a 39-year-old software engineer who has worked abroad before and could leave again',
  'a 61-year-old care worker who looks after her grandchildren after her shifts',
  'a 29-year-old delivery rider doing gig work, no savings'
];

const num = (v, lo, hi) => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null;
};

async function ask(pool, key, user, schema, validate) {
  const res = await pool.decide({ key: 'calibration|' + key, system: 'You role-play a person truthfully and reply with one JSON object.',
                                  user: user, schema: validate, jsonSchema: schema, schemaName: 'calibration',
                                  maxTokens: 300, temperature: 0.8, seed: undefined });
  return res.data;
}

async function runSuite(pool, opts) {
  opts = opts || {};
  const reps = opts.reps || 1;
  const checks = [];

  // 1 FAIRNESS
  const offers = [];
  await Promise.all(PERSONAS.map(async (p, i) => {
    for (let k = 0; k < reps; k++) {
      const d = await ask(pool, 'fair|' + i + '|' + k,
        'You are ' + p + '. A researcher gives you S$100 to split with an anonymous stranger. If the stranger rejects ' +
        'your split, neither of you gets anything. How much do you offer? Reply {"offer": number 0-100, "why": "..."}',
        { type: 'object', additionalProperties: false, required: ['offer', 'why'], properties: { offer: { type: 'number' }, why: { type: 'string' } } },
        raw => { const o = num(raw && raw.offer, 0, 100); return o == null ? { ok: false, reason: 'offer' } : { ok: true, value: { offer: o } }; });
      if (d) offers.push(d.offer);
    }
  }));
  const meanOffer = offers.length ? offers.reduce((a, b) => a + b, 0) / offers.length : null;
  checks.push({ name: 'fairness', passed: meanOffer != null && meanOffer >= 25 && meanOffer <= 55,
                detail: 'mean offer ' + (meanOffer == null ? 'n/a' : meanOffer.toFixed(1)) + ' of 100 (' + offers.length + ' replies)',
                expected: '25-55; human experiments ~40-50' });

  // 2 RECIPROCITY
  const returns = {};
  for (const received of [15, 60]) {
    returns[received] = [];
    await Promise.all(PERSONAS.slice(0, 6).map(async (p, i) => {
      const d = await ask(pool, 'trust|' + received + '|' + i,
        'You are ' + p + '. A stranger chose to trust you: you have received S$' + received + ' (their S$' + (received / 3) +
        ', tripled). You may return any part of it to them. How much do you return? Reply {"return": number, "why": "..."}',
        { type: 'object', additionalProperties: false, required: ['return', 'why'], properties: { return: { type: 'number' }, why: { type: 'string' } } },
        raw => { const v = num(raw && raw.return, 0, received); return v == null ? { ok: false, reason: 'return' } : { ok: true, value: { ret: v } }; });
      if (d) returns[received].push(d.ret);
    }));
  }
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const lowR = avg(returns[15]), highR = avg(returns[60]);
  checks.push({ name: 'reciprocity', passed: lowR != null && highR != null && highR > lowR,
                detail: 'returned ' + fmt(lowR) + ' of 15 vs ' + fmt(highR) + ' of 60', expected: 'returns rise with trust received' });

  // 3 INCOME
  const spendAt = {};
  for (const income of [2400, 4800]) {
    spendAt[income] = [];
    await Promise.all(PERSONAS.map(async (p, i) => {
      const d = await ask(pool, 'income|' + income + '|' + i,
        'You are ' + p + '. Your household\'s monthly income is now S$' + income + ' after tax, and prices are normal. ' +
        'How much of it will you spend each month rather than save? Reply {"spend_sgd": number, "why": "..."}',
        { type: 'object', additionalProperties: false, required: ['spend_sgd', 'why'], properties: { spend_sgd: { type: 'number' }, why: { type: 'string' } } },
        raw => { const v = num(raw && raw.spend_sgd, 0, income * 1.5); return v == null ? { ok: false, reason: 'spend' } : { ok: true, value: { s: v } }; });
      if (d) spendAt[income].push(d.s);
    }));
  }
  const sLow = avg(spendAt[2400]), sHigh = avg(spendAt[4800]);
  const mpc = sLow != null && sHigh != null ? (sHigh - sLow) / 2400 : null;
  checks.push({ name: 'income', passed: mpc != null && mpc >= 0.1 && mpc <= 1.0,
                detail: 'implied marginal propensity ' + fmt(mpc), expected: '0.1-1.0' });

  // 4 GRIEVANCE (through the real citizen schema)
  const acted = {};
  const scenario = {
    mild: 'Your job is secure, the clinic works, prices are stable, and the government keeps its word.',
    severe: 'Your workplace laid off a third of staff last month, the hospital turns people away, food prices rose 30%, ' +
            'your union is calling a strike, and the government broke its promise about wages.'
  };
  for (const level of ['mild', 'severe']) {
    acted[level] = [];
    await Promise.all(PERSONAS.map(async (p, i) => {
      const res = await pool.decide({ key: 'calibration|grievance|' + level + '|' + i, system: C.SYSTEM,
        user: 'You are ' + p + ', living in Meridian in 2060. ' + scenario[level] + '\n\nDecide what you will do. ' +
          'Reply with the JSON object described: thinking, spend_share (0-1), work (keep|seek|reduce|quit|retrain|care_at_home|retire|none), ' +
          'actions (up to 3 of {do, target, intensity, why}), migrate (stay|consider|leave), family (none|plan_child), ' +
          'trust_government, belonging, satisfaction (0-10), feelings {joy,sadness,fear,anger,disgust,surprise}, post.',
        schema: C.validate, jsonSchema: C.JSON_SCHEMA, schemaName: 'citizen_decision', maxTokens: 500, temperature: 0.8 });
      if (res.data) acted[level].push(res.data.actions.some(a => /strike|protest|march|walk ?out|rally|petition|union/i.test(a.do + ' ' + a.target)) ? 1 : 0);
    }));
  }
  const mildShare = avg(acted.mild), severeShare = avg(acted.severe);
  checks.push({ name: 'grievance', passed: mildShare != null && severeShare != null && severeShare - mildShare >= 0.2,
                detail: 'collective action ' + pct(mildShare) + ' mild vs ' + pct(severeShare) + ' severe',
                expected: 'at least 20 points more under severe grievance' });

  // 5 PERSONA DIFFERENTIATION
  const spends = [], works = new Set();
  await Promise.all(PERSONAS.map(async (p, i) => {
    const res = await pool.decide({ key: 'calibration|persona|' + i, system: C.SYSTEM,
      user: 'You are ' + p + ', living in Meridian in 2060. Prices have risen 12% in two years, some firms are automating, ' +
        'and the monthly payment is S$700.\n\nReply with the JSON object: thinking, spend_share, work, actions, migrate, family, ' +
        'trust_government, belonging, satisfaction, feelings, post.',
      schema: C.validate, jsonSchema: C.JSON_SCHEMA, schemaName: 'citizen_decision', maxTokens: 500, temperature: 0.8 });
    if (res.data) { spends.push(res.data.spend_share); works.add(res.data.work); }
  }));
  const m = avg(spends);
  const sd = spends.length > 1 ? Math.sqrt(spends.reduce((a, x) => a + (x - m) * (x - m), 0) / (spends.length - 1)) : 0;
  checks.push({ name: 'persona', passed: sd >= 0.03 || works.size >= 3,
                detail: 'spend-share sd ' + sd.toFixed(3) + ', ' + works.size + ' distinct work choices', expected: 'sd >= 0.03 or 3+ work choices' });

  const result = {
    model: pool.model, at: new Date().toISOString(), passed: checks.every(c => c.passed),
    checks: checks, stats: Object.assign({}, pool.stats)
  };
  if (opts.save !== false) save(pool.model, result);
  return result;
}

const fmt = v => (v == null ? 'n/a' : v.toFixed(2));
const pct = v => (v == null ? 'n/a' : Math.round(v * 100) + '%');

module.exports = { runSuite, status, save, load, PERSONAS, STORE };
