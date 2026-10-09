/* =====================================================================
   CONSTITUTIONS THAT COMPILE
   ---------------------------------------------------------------------
   A team writes prose. The kernel executes a six-verb policy grammar
   (`POLICY_GRAMMAR` in the engine). This file is the compiler between
   them, and it has one rule: nothing is silently dropped. Every
   commitment comes back as enacted policy, as a rejected policy with the
   validation reason, or as untranslatable with an explanation, so a team
   can see exactly how much of what they wrote reached the world.

   Three routes in, strongest first:

     ```policy fences   written by the team, deterministic, always win
     the LLM compiler   reads the prose commitments and proposes policies
     per-round review   the governing agent amends policy as the country
                        changes, within the same grammar

   Also parsed here: the team's RUBRIC weighting and written CASE. They
   are stored for juries and never scored by the simulation.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');

const RUBRIC_ANGLES = ['social_welfare', 'continuity_of_survival', 'quality_of_life', 'economic_profitability'];

/* Written as fields with their allowed values, not as a pattern with
   pipes: a live 7B copied "profit|wages|compute" into a policy verbatim. */
const GRAMMAR_TEXT =
  'Each policy is ONE JSON object in one of these forms. Pick a single value for every field.\n' +
  '1. tax: type "tax"; base is ONE of profit, wages, compute, capital_income, energy, land, consumption; rate from 0 to 0.5; name.\n' +
  '2. transfer: type "transfer"; to is ONE of all, elderly, youth, working_age, unemployed, low_income, carers; sgd_month per person from 0 to 5000; name.\n' +
  '3. automation cap: type "regulate"; what "automation_cap"; sector (one sector, or "all"); limit from 0 to 0.98.\n' +
  '4. price cap: type "regulate"; what "price_cap"; sector (one sector, or "all"); limit from 0.6 to 1.8, where 1.0 is normal prices.\n' +
  '5. wage floor: type "regulate"; what "wage_floor"; limit from 0.5 to 2, where 1.0 is normal wages.\n' +
  '6. provide: type "provide"; sector (one sector); budget_bn in S$ billions a year from 0 to 60.\n' +
  '7. institution: type "institution"; name; mandate; sector; budget_bn from 0 to 60.\n' +
  '8. announce: type "announce"; text the government says publicly.\n' +
  'Sectors: ' + E.ORDER.join(', ') + '.\n' +
  'Examples: {"type":"transfer","to":"elderly","sgd_month":200,"name":"Silver top-up"} ' +
  '{"type":"regulate","what":"automation_cap","sector":"care_services","limit":0.2,"name":"Human care"}';

/* What things cost, so a compiler choosing magnitudes knows what a
   billion buys. A live run compiled a constitution into roughly S$60bn a
   year of new spending with no idea that it starved the monthly payment
   to a fifth of its value before anything else had happened. */
function budgetContext(state) {
  if (!state) return '';
  const pop = state.population.total;
  const f = state.fiscal;
  const perResidentMonth = bn => Math.round(bn * 1e9 / pop / 12);
  const ubiBn = state.indicators.ubi_monthly_sgd * 12 * pop / 1e9;
  return 'The budget, so you can choose proportionate amounts: tax revenue is about S$' + Math.round(f.tax_revenue_bn) +
    'bn a year; the monthly payment to every resident costs about S$' + Math.round(ubiBn) + 'bn a year (S$' +
    state.indicators.ubi_monthly_sgd + ' a month); reserves are S$' + Math.round(f.reserves_bn) + 'bn. ' +
    'S$1bn a year is about S$' + perResidentMonth(1) + ' a month per resident. There are ' +
    Math.round(state.population.by_age.age_65_plus / 1000) + 'k elderly, ' + Math.round(pop * 0.2 / 1000) + 'k low-income and ' +
    Math.round(pop * 0.05 / 1000) + 'k carers. Every new billion of spending comes out of the monthly payment and ' +
    'infrastructure unless you also raise a tax to pay for it. A typical package adds a few billion a year.';
}

/* ---------------------------------------------------------------------
   DETERMINISTIC PARSING — fences, rubric, case
   --------------------------------------------------------------------- */
function fences(md, tag) {
  const out = [];
  const re = new RegExp('```\\s*' + tag + '\\s*\\n([\\s\\S]*?)```', 'gi');
  let m;
  while ((m = re.exec(String(md || ''))) !== null) out.push(m[1]);
  return out;
}

/** ```policy blocks: a JSON object, a JSON array, or key: value lines. */
function parsePolicyFences(md) {
  const found = [];
  fences(md, 'policy').forEach(body => {
    const t = body.trim();
    try {
      const v = JSON.parse(t);
      (Array.isArray(v) ? v : [v]).forEach(x => found.push(x));
      return;
    } catch (e) { /* key: value form */ }
    const obj = {};
    t.split(/\r?\n/).forEach(line => {
      const kv = /^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i.exec(line);
      if (!kv) return;
      const n = Number(kv[2]);
      obj[kv[1].toLowerCase()] = isFinite(n) && kv[2].trim() !== '' ? n : kv[2].replace(/^["']|["']$/g, '');
    });
    if (Object.keys(obj).length) found.push(obj);
  });
  return found;
}

/**
 * The rubric weighting, from a ```rubric fence of `angle: weight` lines,
 * and the case, from the text under a heading containing "case".
 * Stored as the team wrote it. Never scored.
 */
function parseRubric(md) {
  const text = String(md || '');
  const weights = {};
  fences(text, 'rubric').forEach(body => body.split(/\r?\n/).forEach(line => {
    const kv = /^\s*([a-z _]+?)\s*[:=]\s*([\d.]+)/i.exec(line);
    if (!kv) return;
    const key = kv[1].toLowerCase().trim().replace(/\s+/g, '_');
    const angle = RUBRIC_ANGLES.find(a => a === key || a.indexOf(key) === 0 || key.indexOf(a.split('_')[0]) === 0);
    if (angle) weights[angle] = Number(kv[2]);
  }));
  const lines = text.split(/\r?\n/);
  const caseLines = [];
  let inCase = false;
  lines.forEach(line => {
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { inCase = /\bcase\b/i.test(h[1]); return; }
    if (inCase && !/^\s*```/.test(line)) caseLines.push(line);
  });
  const missing = RUBRIC_ANGLES.filter(a => weights[a] == null);
  return {
    angles: RUBRIC_ANGLES.slice(),
    weights: weights,
    case: caseLines.join('\n').trim(),
    complete: missing.length === 0,
    missing: missing
  };
}

/* ---------------------------------------------------------------------
   THE COMPILER
   --------------------------------------------------------------------- */
function validateCompile(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const policies = Array.isArray(raw.policies) ? raw.policies : [];
  const untranslatable = Array.isArray(raw.untranslatable) ? raw.untranslatable : [];
  return { ok: true, value: { policies: policies, untranslatable: untranslatable } };
}

const COMPILE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['policies', 'untranslatable'],
  properties: {
    policies: { type: 'array', items: { type: 'object' } },
    untranslatable: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['commitment', 'why'],
      properties: { commitment: { type: 'string' }, why: { type: 'string' } } } }
  }
};

/** Validate a list against the kernel grammar; return enacted and rejected. */
function check(list, origin) {
  const enacted = [], rejected = [];
  (list || []).forEach(p => {
    const v = E.validatePolicy(p);
    if (v.ok) enacted.push(Object.assign({ origin: origin }, v.value));
    else rejected.push({ policy: p, reason: v.reason, origin: origin });
  });
  return { enacted, rejected };
}

/**
 * compileConstitution(pool, constitution, opts)
 *   constitution: the parsed object from harness/cabinet.js (has .source, .clauses)
 *   -> { policies, rejected, untranslatable, rubric, source }
 */
async function compileConstitution(pool, con, opts) {
  opts = opts || {};
  const md = con.source || '';
  const fromFences = check(parsePolicyFences(md), 'written');
  const result = { policies: fromFences.enacted.slice(), rejected: fromFences.rejected.slice(),
                   untranslatable: [], rubric: parseRubric(md), source: 'fences' };

  const prose = (con.clauses || []).map(c => c.id + '. ' + c.text);
  if (!pool || !prose.length) return result;

  const res = await pool.decide({
    key: (opts.keyPrefix || 'compile') + '|constitution',
    system: 'You translate a government\'s written constitution into concrete policies. ' +
      'You never invent commitments the text does not make. Reply with one JSON object only.',
    user: 'Constitution: ' + (con.name || '') + '\n' + (con.preamble ? con.preamble + '\n' : '') +
      prose.join('\n') + '\n\n' + GRAMMAR_TEXT + '\n\n' + budgetContext(opts.state) + '\n\n' +
      'Return {"policies": [...], "untranslatable": [{"commitment": "...", "why": "..."}]}. ' +
      'Translate each commitment that implies a concrete measure. Choose realistic magnitudes. ' +
      'Put commitments that are values, conditions or procedures with no measure in untranslatable. ' +
      'Include one or two announce policies stating the government\'s public promises in plain words.',
    schema: validateCompile, jsonSchema: COMPILE_SCHEMA, schemaName: 'constitution_policies',
    maxTokens: 1400, seed: opts.seed, temperature: 0.2
  });
  if (!res.data) {
    result.untranslatable.push({ commitment: '(all prose)', why: 'the policy compiler got no usable reply: ' + res.error });
    return result;
  }
  const fromModel = check(res.data.policies, 'compiled');
  /* A written policy wins over a compiled one of the same kind on the
     same target, so a team can always override the compiler. */
  const writtenKeys = new Set(result.policies.map(policyKey));
  fromModel.enacted.forEach(p => { if (!writtenKeys.has(policyKey(p))) result.policies.push(p); });
  result.rejected = result.rejected.concat(fromModel.rejected);
  result.untranslatable = res.data.untranslatable.map(u => ({ commitment: String(u.commitment || ''), why: String(u.why || '') }));
  result.source = 'fences+compiled';
  return result;
}

function policyKey(p) {
  return [p.type, p.base || p.to || p.what || '', p.sector || ''].join(':');
}

/* ---------------------------------------------------------------------
   PER-ROUND REVIEW — the governing agent amends policy
   --------------------------------------------------------------------- */
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reasoning', 'add', 'repeal', 'announce'],
  properties: {
    reasoning: { type: 'string' },
    add: { type: 'array', items: { type: 'object' } },
    repeal: { type: 'array', items: { type: 'integer' } },
    announce: { type: 'string' }
  }
};
function validateReview(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  return { ok: true, value: {
    reasoning: String(raw.reasoning || '').slice(0, 800),
    add: Array.isArray(raw.add) ? raw.add.slice(0, 6) : [],
    repeal: Array.isArray(raw.repeal) ? raw.repeal.map(Number).filter(n => Number.isInteger(n)) : [],
    announce: String(raw.announce || '').slice(0, 600)
  } };
}

/**
 * The government sees everything: it reads the dashboard. What it may do
 * is bounded by the grammar, and what it says publicly is all the
 * citizens will ever hear of its reasoning.
 */
async function reviewPolicies(pool, con, policies, ctx) {
  const s = ctx.state, i = s.indicators;
  const worst = Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
  const summary = [
    'Year ' + s.meta.year + '. Payment S$' + i.ubi_monthly_sgd + '/month, purchasing power ' + i.effective_ubi_index +
      ', employment ' + Math.round(i.employment_rate * 100) + '%, legitimacy ' + i.legitimacy + ', cohesion ' + i.cohesion +
      ', reserves S$' + Math.round(s.fiscal.reserves_bn) + 'bn, weakest essential service ' + worst + '.',
    'Industries: ' + E.ORDER.map(k => E.SECTORS[k].name + ' ' + s.sectors[k].quality).join(', ') + '.',
    ctx.society ? 'What people are doing: ' + (ctx.society.action_shares || []).slice(0, 5)
      .map(a => a.kind + ' ' + a.share + '%').join(', ') + '. Reported trust ' + (ctx.polls && ctx.polls.trust) + '/100.' : '',
    (ctx.voices || []).length ? 'Voices from the feed: ' + ctx.voices.slice(0, 5).map(v => '"' + v + '"').join(' ') : '',
    (ctx.events || []).length ? 'Events: ' + ctx.events.map(e => e.label).join(', ') + '.' : ''
  ].filter(Boolean).join('\n');
  const current = policies.map((p, idx) => idx + ': ' + JSON.stringify(stripOrigin(p))).join('\n') || '(none)';

  const res = await pool.decide({
    key: ctx.keyPrefix + '|policy-review',
    system: 'You are the governing cabinet of Meridian, bound by your constitution. Reply with one JSON object only.',
    user: 'Your constitution:\n' + (con.commitments || []).join('\n') + '\n\n' + summary +
      '\n\nPolicies in force (index: policy):\n' + current + '\n\n' + GRAMMAR_TEXT + '\n\n' + budgetContext(s) +
      '\n\nDecide whether to change policy. Return {"reasoning": "...", "add": [policies], ' +
      '"repeal": [indexes], "announce": "a public statement, or empty"}. Change nothing if nothing needs changing.',
    schema: validateReview, jsonSchema: REVIEW_SCHEMA, schemaName: 'policy_review',
    maxTokens: 900, seed: ctx.seed, temperature: 0.3
  });
  if (!res.data) return { policies: policies, changed: false, error: res.error, source: 'failed' };
  const repeal = new Set(res.data.repeal.filter(n => n >= 0 && n < policies.length));
  const kept = policies.filter((p, idx) => !repeal.has(idx) || p.origin === 'written');
  const added = check(res.data.add, 'amended');
  const announce = res.data.announce ? check([{ type: 'announce', text: res.data.announce }], 'amended').enacted : [];
  const next = kept.concat(added.enacted, announce);
  return {
    policies: next, changed: repeal.size > 0 || added.enacted.length > 0 || announce.length > 0,
    reasoning: res.data.reasoning, rejected: added.rejected,
    repealed: policies.filter((p, idx) => repeal.has(idx) && p.origin !== 'written'),
    protected: policies.filter((p, idx) => repeal.has(idx) && p.origin === 'written'),
    source: res.source
  };
}

function stripOrigin(p) { const c = Object.assign({}, p); delete c.origin; return c; }

/** What the kernel receives: grammar objects only. */
function forKernel(policies) { return (policies || []).map(stripOrigin); }

module.exports = { compileConstitution, reviewPolicies, parsePolicyFences, parseRubric, check, forKernel,
                   budgetContext, GRAMMAR_TEXT, RUBRIC_ANGLES };
