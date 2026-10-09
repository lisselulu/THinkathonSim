/* =====================================================================
   THE POLICY INTERPRETER — a government written as data
   ---------------------------------------------------------------------
   A harness is normally a function you write. This runs one you DECLARE.

     {
       "opening": { "corporate_tax_rate": 0.28, ... },
       "rules": [
         { "when": "worstEssential < 60",
           "then": [ { "shift": "ubi->infrastructure", "points": 5 },
                     { "nudge": "automation_target.care_services", "by": -0.1 } ] }
       ],
       "trade": { "style": "reciprocal", "never_sell": ["food"] }
     }

   That is the Steward reference harness with its if-statements turned
   inside out. Everything it can do, a policy can do — which is the point:
   a team that cannot write JavaScript is not thereby prevented from
   writing a government, and a team that can may still find it easier to
   argue about a doctrine they can read in one screen.

   THE LADDER
   ----------
     1. fill in a form            -> this policy JSON
     2. edit the policy JSON      -> same interpreter
     3. write a harness in JS     -> harnesses/reference.js
     4. write your own prompt     -> harnesses/llm.js

   A team may climb it mid-event without starting again. Rung 1 and rung 4
   both emit lever vectors, and the engine cannot tell them apart.

   Conditions use exactly the same little expression language as the
   constitution's checkable rules, so there is one thing to learn and it
   is used twice.
   ===================================================================== */

/* Runs on the server and, for the Simulation page's trial, in the browser.
   The page loads the engine and the harness first; trade needs the market
   layer and only ever runs server-side. */
const IN_NODE = typeof require !== 'undefined' && typeof module !== 'undefined';
const E = IN_NODE ? require('../meridian-engine.js') : window.MeridianEngine;
const H = IN_NODE ? require('../harness.js') : window.MeridianHarness;
const tradePolicy = IN_NODE ? require('./trade-policy.js').tradePolicy : null;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* Lever paths a policy may touch, and the range each is held to. The
   interpreter refuses to write anywhere else, so a malformed policy
   cannot reach into the engine. */
const BOUNDS = {
  corporate_tax_rate:   [0, 0.45],
  compute_levy:         [0, 0.30],
  reskilling_spend_pct: [0, 0.30],
  public_ownership_pct: [0, 0.50],
  care_guarantee_wage:  [0, 8000]
};
const ENUMS = {
  ubi_design: ['flat', 'means_tested', 'age_weighted'],
  working_week_days: [3, 4, 5]
};
const ALLOC = ['ubi', 'infrastructure', 'reserves'];

const VOCAB = {
  /* What a condition can read. `group` is only for laying them out. */
  terms: [
    { id: 'worstEssential', label: 'Weakest essential service', unit: '0 to 100', group: 'The country' },
    { id: 'effectiveUbi', label: 'What the payment buys, counting services', unit: '2050 = 95', group: 'The country' },
    { id: 'realUbi', label: 'What the payment buys, counting prices only', unit: '2050 = 100', group: 'The country' },
    { id: 'employmentPct', label: 'Working-age people in work', unit: 'percent', group: 'The country' },
    { id: 'indicators.ubi_monthly_sgd', label: 'The monthly payment', unit: 'S$', group: 'The country' },
    { id: 'indicators.consumption_index', label: 'Household spending', unit: '2050 = 100', group: 'The country' },
    { id: 'population.total', label: 'Residents', unit: 'people', group: 'The country' },
    { id: 'indicators.cohesion', label: 'Cohesion', unit: '0 to 100', group: 'Society' },
    { id: 'indicators.legitimacy', label: 'Legitimacy', unit: '0 to 100', group: 'Society' },
    { id: 'indicators.civic_unrest', label: 'Civic unrest', unit: '0 to 100', group: 'Society' },
    { id: 'indicators.gini', label: 'Inequality (Gini)', unit: '0 to 1', group: 'Society' },
    { id: 'fiscal.reserves_bn', label: 'Reserves', unit: 'S$bn', group: 'The treasury' },
    { id: 'fiscal.gdp_bn', label: 'Output (GDP)', unit: 'S$bn a year', group: 'The treasury' },
    { id: 'fiscal.tax_revenue_bn', label: 'Tax revenue', unit: 'S$bn a year', group: 'The treasury' },
    { id: 'year', label: 'The year', unit: 'e.g. 2056', group: 'Time' },
    { id: 'month', label: 'The month', unit: '1 to 12', group: 'Time' }
  ],
  /* ...and, for each of the thirteen industries, sectors.<industry>.<this>. */
  perIndustry: [
    { id: 'quality', label: 'service quality', unit: '0 to 100' },
    { id: 'automation', label: 'share automated', unit: '0 to 1' },
    { id: 'capacity', label: 'capacity against demand', unit: '1 = meets demand' },
    { id: 'headcount', label: 'people employed', unit: 'people' },
    { id: 'margin', label: 'margin', unit: '-1 to 1' }
  ],
  operators: [['<', 'is below'], ['<=', 'is at most'], ['>', 'is above'], ['>=', 'is at least'], ['==', 'is exactly'], ['!=', 'is not']],
  joins: [['&&', 'and'], ['||', 'or']],
  /* What an action can change. */
  shift: { label: 'Move budget share', unit: 'percentage points', step: 1,
           targets: [].concat.apply([], ALLOC.map(a => ALLOC.filter(b => b !== a).map(b => a + '->' + b))) },
  levers: [
    { id: 'corporate_tax_rate', label: 'Corporate tax', range: BOUNDS.corporate_tax_rate, kind: 'share' },
    { id: 'compute_levy', label: 'Tax on automation', range: BOUNDS.compute_levy, kind: 'share' },
    { id: 'reskilling_spend_pct', label: 'Reskilling', range: BOUNDS.reskilling_spend_pct, kind: 'share' },
    { id: 'public_ownership_pct', label: 'Public ownership', range: BOUNDS.public_ownership_pct, kind: 'share' },
    { id: 'care_guarantee_wage', label: 'Care job wage', range: BOUNDS.care_guarantee_wage, kind: 'sgd' },
    { id: 'ubi_design', label: 'How the payment is shared', values: [['flat', 'equally'], ['means_tested', 'means-tested'], ['age_weighted', 'more for the old']], kind: 'choice' },
    { id: 'working_week_days', label: 'Working week', values: [['5', '5 days'], ['4', '4 days'], ['3', '3 days']], kind: 'choice' },
    { id: 'care_job_guarantee', label: 'Care job guarantee', values: [['true', 'on'], ['false', 'off']], kind: 'choice' }
  ],
  /* ...and automation_target.<industry>, the ceiling on each industry. */
  industryLever: { prefix: 'automation_target.', label: 'automation ceiling', range: [0, 0.98], kind: 'share' }
};

function isAutomationPath(path) {
  const bits = String(path).split('.');
  return bits.length === 2 && bits[0] === 'automation_target' && E.ORDER.indexOf(bits[1]) >= 0;
}

function readLever(L, path) {
  if (isAutomationPath(path)) return L.automation_target[path.split('.')[1]];
  if (path.indexOf('allocation.') === 0) return L.allocation[path.split('.')[1]];
  return L[path];
}

function writeLever(L, path, value, faults) {
  if (isAutomationPath(path)) {
    L.automation_target[path.split('.')[1]] = clamp(Number(value), 0, 0.98);
    return;
  }
  if (path.indexOf('allocation.') === 0) {
    const k = path.split('.')[1];
    if (ALLOC.indexOf(k) < 0) { faults.push('no allocation slice "' + k + '"'); return; }
    L.allocation[k] = clamp(Number(value), 0, 1);
    normaliseAllocation(L);
    return;
  }
  if (BOUNDS[path]) {
    const [lo, hi] = BOUNDS[path];
    L[path] = clamp(Number(value), lo, hi);
    return;
  }
  if (ENUMS[path]) {
    if (ENUMS[path].indexOf(value) >= 0 || ENUMS[path].indexOf(Number(value)) >= 0) {
      L[path] = ENUMS[path].indexOf(value) >= 0 ? value : Number(value);
    } else {
      faults.push(path + ' must be one of ' + ENUMS[path].join(', '));
    }
    return;
  }
  if (path === 'care_job_guarantee') { L.care_job_guarantee = !!value; return; }
  faults.push('a policy may not set "' + path + '"');
}

function normaliseAllocation(L) {
  const a = L.allocation;
  const sum = ALLOC.reduce((t, k) => t + (Number(a[k]) || 0), 0);
  if (sum <= 0) { L.allocation = { ubi: 0.34, infrastructure: 0.33, reserves: 0.33 }; return; }
  ALLOC.forEach(k => { a[k] = (Number(a[k]) || 0) / sum; });
}

/* --------------------------------------------------------------------- */
/* Actions. Three verbs, deliberately: a doctrine that needs a fourth is
   usually a doctrine that has stopped being a doctrine.                  */
function applyAction(L, action, faults) {
  if (!action || typeof action !== 'object') { faults.push('action is not an object'); return; }

  // set: put a lever at a value
  if (action.set != null) {
    writeLever(L, action.set, action.value, faults);
    return;
  }

  // nudge: move a lever by an amount, in its own units
  if (action.nudge != null) {
    const cur = readLever(L, action.nudge);
    if (cur == null || typeof cur !== 'number') {
      faults.push('cannot nudge "' + action.nudge + '" — not a number');
      return;
    }
    writeLever(L, action.nudge, cur + Number(action.by || 0), faults);
    return;
  }

  /* shift: move budget between allocation slices, in percentage points.
     Written "ubi->infrastructure" because that is how a treasurer says
     it, and because it keeps the split summing to one by construction. */
  if (action.shift != null) {
    const m = /^\s*(\w+)\s*->\s*(\w+)\s*$/.exec(String(action.shift));
    if (!m) { faults.push('shift must read "from->to", e.g. "ubi->infrastructure"'); return; }
    const [, from, to] = m;
    if (ALLOC.indexOf(from) < 0 || ALLOC.indexOf(to) < 0) {
      faults.push('shift must name two of: ' + ALLOC.join(', '));
      return;
    }
    const pts = Math.abs(Number(action.points || 0)) / 100;
    const floor = Number(action.floor != null ? action.floor : 0.15);   // never strip a slice bare
    const take = Math.max(0, Math.min(pts, L.allocation[from] - floor));
    L.allocation[from] -= take;
    L.allocation[to] += take;
    return;
  }

  faults.push('an action needs one of: set, nudge, shift');
}

/* A shape-complete stand-in world, carrying every path a rule is allowed
   to name and no values worth reading. Its only job is to tell a typo
   apart from a doctrine: any path present here resolves, anything else
   comes back null and is reported as a mistake at the desk. */
function probeFrame() {
  const sectors = {};
  E.ORDER.forEach(k => {
    sectors[k] = { automation: 0.5, headcount: 1, capacity: 1, quality: 60, margin: 0 };
  });
  return {
    meta: { round: 1, year: 2050, month: 1 }, round: 1, year: 2050, month: 1,
    sectors: sectors,
    indicators: {
      ubi_monthly_sgd: 0, ubi_base_share_sgd: 0, real_ubi_index: 100,
      effective_ubi_index: 100, employment_rate: 0.5, gini: 0.35,
      cohesion: 60, legitimacy: 60, consumption_index: 100, civic_unrest: 0
    },
    fiscal: {
      gdp_bn: 0, corporate_profit_bn: 0, tax_revenue_bn: 0, public_dividend_bn: 0,
      reserves_bn: 0, allocation: { ubi: 0.4, infrastructure: 0.4, reserves: 0.2 }
    },
    population: {
      total: 0, by_age: { age_0_19: 0, age_20_64: 1, age_65_plus: 0 },
      by_exposure: { high: 0, medium: 0, low: 0 }, employed_total: 0
    },
    levers: JSON.parse(JSON.stringify(E.DEFAULT_LEVERS)),
    worstEssential: 60, effectiveUbi: 100, realUbi: 100, employmentPct: 50
  };
}

/* --------------------------------------------------------------------- */
/**
 * validatePolicy(policy) -> { ok, faults, warnings }
 * Run this in the form before a team commits, so mistakes surface at the
 * desk rather than in round 7.
 */
function validatePolicy(policy) {
  const faults = [], warnings = [];
  if (!policy || typeof policy !== 'object') return { ok: false, faults: ['policy is not an object'] };

  const probe = { levers: JSON.parse(JSON.stringify(E.DEFAULT_LEVERS)) };
  if (policy.opening && typeof policy.opening === 'object') {
    Object.keys(policy.opening).forEach(k => {
      if (k === 'automation_target' || k === 'allocation') return;   // nested, checked below
      writeLever(probe.levers, k, policy.opening[k], faults);
    });
  }

  (policy.rules || []).forEach((r, i) => {
    const label = 'rule ' + (i + 1) + (r.id ? ' (' + r.id + ')' : '');
    if (!r.when) warnings.push(label + ' has no `when`, so it fires every round');
    else {
      // A condition that never resolves is a typo, not a doctrine.
      try {
        const v = H.evalExpr(probeFrame(), r.when);
        if (v === null) warnings.push(label + ': `' + r.when + '` names something that does not exist');
      } catch (e) { faults.push(label + ': condition could not be read'); }
    }
    const acts = Array.isArray(r.then) ? r.then : (r.then ? [r.then] : []);
    if (!acts.length) faults.push(label + ' has no actions');
    acts.forEach(a => applyAction(JSON.parse(JSON.stringify(probe.levers)), a, faults));
  });

  if (!(policy.rules || []).length) {
    warnings.push('no rules: this government will hold its opening position for twelve rounds');
  }
  return { ok: faults.length === 0, faults: faults, warnings: warnings };
}

/* --------------------------------------------------------------------- */
/**
 * makePolicyHarness(policy) -> harness(ctx)
 * Turns a declared policy into a government the runner can drive.
 */
function makePolicyHarness(policy) {
  policy = policy || {};
  const rules = policy.rules || [];
  const trade = policy.trade || {};

  return function policyHarness(ctx) {
    const L = JSON.parse(JSON.stringify(ctx.levers));
    const faults = [], fired = [];

    // Round 1 is the opening position, sealed with the constitution.
    if (ctx.round === 1 || ctx.opening) {
      const open = policy.opening || {};
      if (open.automation_target) {
        E.ORDER.forEach(k => {
          if (open.automation_target[k] != null) {
            L.automation_target[k] = clamp(Number(open.automation_target[k]), 0, 0.98);
          }
        });
      }
      if (open.allocation) {
        ALLOC.forEach(k => { if (open.allocation[k] != null) L.allocation[k] = Number(open.allocation[k]); });
        normaliseAllocation(L);
      }
      Object.keys(open).forEach(k => {
        if (k !== 'automation_target' && k !== 'allocation') writeLever(L, k, open[k], faults);
      });
    } else {
      /* Every rule whose condition holds fires, in the order written. Later
         rules see what earlier ones did, so order is a policy decision and
         not an implementation detail. */
      const frame = H.doctrineFrame(ctx.state);
      rules.forEach((r, i) => {
        let holds;
        try { holds = H.evalExpr(frame, r.when == null ? 'always' : r.when); }
        catch (e) { holds = null; }
        if (holds !== true) return;
        const acts = Array.isArray(r.then) ? r.then : (r.then ? [r.then] : []);
        acts.forEach(a => applyAction(L, a, faults));
        fired.push(r.id || ('rule ' + (i + 1)));
      });
    }

    normaliseAllocation(L);

    /* Trade, declared rather than coded. `never_sell` is the one a team
       reaches for after the round they sold the food they turned out to
       need. */
    let tradeOut = {};
    if (ctx.market && tradePolicy && trade.style !== 'none') {
      tradeOut = tradePolicy(ctx, trade.style || 'reciprocal') || {};
      if (Array.isArray(trade.never_sell) && tradeOut.offers) {
        tradeOut.offers = tradeOut.offers.filter(
          o => o.type === 'aid' || trade.never_sell.indexOf(o.resource) < 0);
      }
      if (trade.aid_when_others_fail === false && tradeOut.offers) {
        tradeOut.offers = tradeOut.offers.filter(o => o.type !== 'aid');
      }
      if (typeof trade.message === 'string' && trade.message.trim()) {
        tradeOut.message = trade.message;
      }
    }

    return Object.assign({}, tradeOut, {
      levers: L,
      rationale: (ctx.round === 1 || ctx.opening)
        ? 'Opening position, as declared.'
        : (fired.length ? 'Fired: ' + fired.join(', ') + '.' : 'No rule fired; holding.'),
      policy_faults: faults.length ? faults : undefined,
      fired: fired
    });
  };
}

/* ---------------------------------------------------------------------
   THE SETUP PAGE'S RULES
   ---------------------------------------------------------------------
   The Setup page saves an action as { verb, target, amount }, which is how
   a form reads. The interpreter takes { shift, points }, { nudge, by } or
   { set, value }. This is the one translation between them, used by the
   agent run on the server and by the trial in the browser, so the two can
   never disagree about what a rule does.
   --------------------------------------------------------------------- */
function fromSetup(rules) {
  return (Array.isArray(rules) ? rules : []).map((r, i) => {
    const then = (Array.isArray(r.then) ? r.then : []).map(a => {
      const target = String(a.target || '').trim();
      const raw = a.amount == null ? '' : String(a.amount).trim();
      const num = raw !== '' && isFinite(Number(raw)) ? Number(raw) : null;
      if (a.verb === 'shift') return { shift: target, points: num == null ? 0 : num };
      if (a.verb === 'nudge') return { nudge: target, by: num == null ? 0 : num };
      const value = raw === 'true' ? true : raw === 'false' ? false : (num == null ? raw : num);
      return { set: target, value: value };
    });
    return { id: r.id || ('rule ' + (i + 1)), when: String(r.when || '').trim() || 'always', then: then };
  });
}

/**
 * What the Setup page shows under each rule: whether it can run, and if not,
 * why. The same checks as validatePolicy, attributed rule by rule.
 */
function checkSetupRules(rules) {
  return fromSetup(rules).map((r, i) => {
    const problems = [];
    try {
      const v = H.evalExpr(probeFrame(), r.when);
      if (v === null) {
        const names = (r.when.match(/[A-Za-z_][A-Za-z0-9_.]*/g) || [])
          .filter(t => ['always', 'true', 'false'].indexOf(t) < 0)
          .filter(t => H.evalExpr(probeFrame(), t) === null);
        problems.push('the condition names something that does not exist' + (names.length ? ': ' + names.join(', ') : ''));
      }
    } catch (e) { problems.push('the condition could not be read'); }
    if (!r.then.length) problems.push('it has no actions');
    const faults = [];
    const probe = JSON.parse(JSON.stringify(E.DEFAULT_LEVERS));
    r.then.forEach(a => applyAction(probe, a, faults));
    faults.forEach(f => problems.push(f));
    return { index: i, ok: problems.length === 0, problems: problems };
  });
}

const RULES_API = { makePolicyHarness, validatePolicy, applyAction, fromSetup, checkSetupRules, BOUNDS, ENUMS, ALLOC, VOCAB };
if (typeof window !== 'undefined') window.MeridianRules = RULES_API;
if (typeof module !== 'undefined' && module.exports) module.exports = RULES_API;
