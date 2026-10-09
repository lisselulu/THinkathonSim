/* =====================================================================
   LIVED EXPERIENCE — what a citizen is allowed to know
   ---------------------------------------------------------------------
   Nobody in Meridian has read the budget.

   A resident does not know the corporate tax rate. They do not know the
   allocation split, the compute levy, the automation targets, the
   reserves, the gini coefficient, or that a thing called "effective
   purchasing power" is what their government is scored on. They know the
   queue at the clinic, what the coffee costs, whether their nephew found
   work, and whether the bus still comes.

   THIS IS NOT DECORATION. IT IS THE POINT.
   ----------------------------------------
   A government reads the dashboard. A society reads its own life. The
   entire value of the feed as an early-warning instrument depends on
   those being different views of the same country — if citizens could
   see the levers, they would simply narrate the dashboard back, and a
   team would learn nothing from reading them that they could not read
   faster from a chart.

   It also protects against a subtler failure. A model shown "corporate
   tax rose to 0.38" will write a citizen complaining about corporate
   tax, which is not how people talk. A model shown "the clinic now books
   six weeks out" writes someone complaining about the wait, which is.
   The blindness makes the output better as well as more honest.

   HOW IT IS ENFORCED
   ------------------
   `livedExperience()` constructs a NEW object containing only
   permitted fields. It never passes the state through with omissions,
   because omission-by-convention decays: someone adds a field upstream
   and it silently leaks. Building up from nothing means a new indicator
   is invisible to citizens until somebody deliberately exposes it.

   `assertBlind()` checks a finished prompt for forbidden terms and is
   wired into the tests, so the constraint fails loudly rather than
   quietly eroding.
   ===================================================================== */

'use strict';

const E = require('./meridian-engine.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* Everything a citizen must never see, checked against generated text.
   Lever names, scoring language, and the internal vocabulary of the
   engine. */
const FORBIDDEN = [
  'corporate_tax', 'corporate tax', 'compute_levy', 'compute levy',
  'reskilling_spend', 'public_ownership', 'public ownership',
  'allocation', 'automation_target', 'ubi_design', 'means_tested',
  'age_weighted', 'care_job_guarantee', 'working_week_days',
  'gini', 'effective_ubi', 'real_ubi', 'purchasing power index',
  'reserves_bn', 'gdp', 'tax revenue', 'cohesion', 'legitimacy',
  'lever', 'levers', 'the engine', 'indicator', 'score', 'gate'
];

/* ---------------------------------------------------------------------
   TRANSLATION
   ---------------------------------------------------------------------
   Engine quantities into things a person would actually notice. The
   thresholds are coarse on purpose: nobody perceives their healthcare
   system as "43.7".
   --------------------------------------------------------------------- */
function serviceFeel(q) {
  if (q >= 78) return 'excellent — better than you remember it being';
  if (q >= 65) return 'fine — it works when you need it';
  if (q >= 52) return 'slower than it was, but it works';
  if (q >= 40) return 'strained — you plan around it now';
  if (q >= 28) return 'bad — you have started asking neighbours instead';
  if (q >= 15) return 'barely there — most people have given up on it';
  return 'gone in all but name';
}

function moneyFeel(index) {
  if (index >= 125) return 'goes further than it used to; there is something left at the end of the month';
  if (index >= 105) return 'covers the month with a little spare';
  if (index >= 92) return 'covers the month, about the same as it always did';
  if (index >= 78) return 'does not go as far as it did; you have started checking prices';
  if (index >= 60) return 'is short. You have cut things you did not expect to cut';
  if (index >= 40) return 'does not cover the month. You are choosing between things';
  return 'is not enough to live on and everybody knows it';
}

function workFeel(pct, working) {
  if (working) {
    if (pct >= 55) return 'your job feels safe enough';
    if (pct >= 42) return 'people around you have been let go; you have not, yet';
    if (pct >= 30) return 'most of the people you trained with are out of work';
    return 'you are one of the few people you know who still has work';
  }
  if (pct >= 55) return 'there is work about, if you can get to it';
  if (pct >= 42) return 'work is hard to come by and you have been looking a while';
  if (pct >= 30) return 'there is essentially nothing, and it has been years';
  return 'nobody you know has found work in a very long time';
}

/* ---------------------------------------------------------------------
   THE VIEW
   ---------------------------------------------------------------------
   Built from nothing, field by field. Anything not named here is not
   visible to a citizen, now or when somebody adds a new indicator.
   --------------------------------------------------------------------- */
function livedExperience(p, prev, next) {
  const i = next.indicators;
  const pay = Math.round(i.ubi_monthly_sgd);
  const payPrev = Math.round(prev.indicators.ubi_monthly_sgd);
  const buys = i.effective_ubi_index;
  const empPct = Math.round(i.employment_rate * 100);

  // The services THIS person leans on, not the national average.
  const mine = p.depends.map(k => ({
    name: E.SECTORS[k].name,
    feel: serviceFeel(next.sectors[k].quality),
    direction: next.sectors[k].quality - prev.sectors[k].quality
  }));

  /* Prices, expressed the way people actually track them. The engine
     carries an inflation index; a person carries the price of coffee. */
  const priceMove = payPrev > 0
    ? Math.round(((pay / Math.max(1, payPrev)) - 1) * 100) : 0;

  return {
    year: next.meta.year,

    // What arrives, and what it does.
    payment_sgd: pay,
    payment_changed_by: pay - payPrev,
    money_feels: moneyFeel(buys),

    // What it buys, in the places this person goes.
    services: mine,
    services_getting: mine.every(m => m.direction >= 0) ? 'better'
      : mine.every(m => m.direction <= 0) ? 'worse' : 'mixed',

    // Work, from where they stand.
    work_feels: workFeel(empPct, p.working),

    /* What is being talked about. The engine's bulletin is already
       written as public events rather than as indicators, so it is the
       one internal structure a citizen may legitimately see. */
    talk_of_the_town: (next.news || []).slice(0, 3),

    // A shock is a thing that happens to you, not a modifier.
    something_happened: (next.shocks || []).map(k => (E.SHOCKS[k] || {}).label || k),

    // How long this has been going on — memory, not a reading.
    years_like_this: null   // filled by the caller from cohort memory
  };
}

/* ---------------------------------------------------------------------
   THE GUARD
   ---------------------------------------------------------------------
   Run over any text about to be shown to a citizen agent. Returns the
   terms that leaked, empty when clean.
   --------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   TWO KINDS OF BLINDNESS
   ---------------------------------------------------------------------
   A citizen and a firm are not entitled to the same ignorance.

   A resident does not know the corporate tax rate; a firm PAYS it, and
   pretending otherwise would produce a company that cannot read its own
   cost base. A firm legitimately sees prices, demand, its own margin and
   headcount, and published macro figures. What a firm must NOT see is the
   treasury's position, the score it is not playing for, the citizen feed,
   or the engine's own vocabulary.

   The list was global, with no scope, which meant a firm agent would
   either be handed a citizen's blindfold — and be unable to reason about
   its own business — or have the guard removed, which is how a guard
   stops existing. Scoping it keeps it enforceable for both.
   --------------------------------------------------------------------- */
const SCOPES = {
  citizen: FORBIDDEN,
  /* Everything a firm may not see. Note what is ABSENT and deliberately
     allowed: tax rates, the compute levy, prices, gdp — a firm reads all
     of those off its own accounts and the newspaper. */
  firm: [
    'reserves_bn', 'tax revenue', 'score', 'gate', 'the engine',
    'cohesion', 'legitimacy', 'gini', 'civic_unrest', 'sentiment',
    'effective_ubi', 'real_ubi', 'purchasing power index', 'ubi_design',
    'means_tested', 'age_weighted', 'lever', 'levers'
  ]
};

function leaks(text, scope) {
  const list = SCOPES[scope || 'citizen'] || FORBIDDEN;
  const t = String(text || '').toLowerCase();
  return list.filter(w => t.indexOf(w) >= 0);
}

function assertBlind(text, scope) {
  const who = scope || 'citizen';
  const bad = leaks(text, who);
  if (bad.length) {
    throw new Error('a ' + who + ' was about to be shown information it may not have: ' +
      bad.join(', '));
  }
  return true;
}

module.exports = { livedExperience, serviceFeel, moneyFeel, workFeel,
                   leaks, assertBlind, FORBIDDEN, SCOPES };
