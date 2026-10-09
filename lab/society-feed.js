/* =====================================================================
   THE FEED, FROM A REAL RUN
   ---------------------------------------------------------------------
   The page used to build its own country. `/api/feed` called
   `runTrajectory` to compute twelve rounds in one go, then asked
   `feedFor` what people would have said about each of them. Two things
   followed from that, and both were invisible from the page:

     * the trajectory was computed before anyone reacted, so nothing a
       citizen did could appear in it; and
     * the decisions were the arithmetic chooser's, so there was nowhere
       for an agent to plug in even if one existed.

   This module runs the CLOSED loop instead — `harness/loop.js` with a
   decider — and turns each round's decisions into posts. What the page
   shows is then a record of what agents actually chose, in a country
   that changed because they chose it.

   WORDS ARE STILL DRESSING
   ------------------------
   The division of labour is unchanged and worth restating, because it
   is what keeps the feed cheap to run and impossible to fake:

        agents decide WHAT      (society/, or arithmetic)
        the engine prices it    (frozen)
        a model writes HOW IT SOUNDS  (optional, last)

   The templated line is always computed. Voicing replaces the words and
   nothing else; a feed whose model is down is a feed with plainer prose,
   never a feed that stops or a country that changes.

   RUNS ARE CACHED, AND THAT IS NOT AN OPTIMISATION
   ------------------------------------------------
   Twelve agents deciding twelve rounds is around 144 model calls. If
   the page recomputed on every request, scrubbing from round 4 to round
   5 would re-run the entire country — and, because agents carry memory
   and a local model is not deterministic, it would come back a
   DIFFERENT country each time. The cache is what makes the page a view
   of one run rather than a slot machine.
   ===================================================================== */

'use strict';

const path = require('path');
const fs = require('fs');

const E = require(path.join(__dirname, '..', 'engine', 'meridian-engine.js'));
const C = require(path.join(__dirname, '..', 'engine', 'citizen_friction.js'));
const A = require(path.join(__dirname, '..', 'engine', 'action_space.js'));
const D = require(path.join(__dirname, '..', 'engine', 'decide.js'));
const FEED = require(path.join(__dirname, 'feed.js'));
const { runSociety } = require(path.join(__dirname, '..', 'harness', 'loop.js'));

const BY_ID = {};
C.ARCHETYPES.forEach(p => { BY_ID[p.id] = p; });

const ROOT = path.join(__dirname, '..');

/* Levers from the studio arrive as whatever the page had in
   localStorage, which may predate a field the engine has since gained.
   Fill the gaps from the scenario rather than trusting the payload. */
function normaliseLevers(given, src, week) {
  const base = leversFor(src, week);
  const out = Object.assign({}, base, given);
  if (!out.automation_target || !Object.keys(out.automation_target).length) {
    out.automation_target = base.automation_target;
  }
  if (out.care_guarantee_wage == null) out.care_guarantee_wage = base.care_guarantee_wage;
  if (week) out.working_week_days = week;
  return out;
}

function leversFor(src, week) {
  const levers = JSON.parse(JSON.stringify(src.levers));
  levers.automation_target = {};
  E.ORDER.forEach(k => { levers.automation_target[k] = src.sectors[k].automation; });
  if (week) levers.working_week_days = week;
  if (levers.care_guarantee_wage == null) levers.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
  return levers;
}

/* ---------------------------------------------------------------------
   ONE ROUND'S ACTIONS -> POSTS
   ---------------------------------------------------------------------
   `societyRound` returns decisions; a feed needs posts. The shape below
   is the one `feed.html` already renders, so the page does not need to
   learn a second format — plus the few fields that only exist once
   agents are choosing: what they ASKED for before the world checked it,
   and how much of the cohort has already left.
   --------------------------------------------------------------------- */
function postsFor(society, prev, next) {
  const d = C.macroDelta(prev, next);

  const posts = society.actions.map(a => {
    const p = BY_ID[a.id];
    const b = A.ACTIONS[a.key];

    /* Not everyone posts every round. Silence is data: a quiet feed in
       a collapsing country means people have given up rather than that
       nothing is wrong. Same rule as the deterministic feed, so the two
       views are comparable. */
    const loud = a.pressure > 22 || a.key === 'flourish' || a.key === 'strike' ||
                 a.key === 'emigrate' || (a.full_weight > 0.1 && a.pressure > 14);

    return {
      id: a.id, name: a.name, role: a.role,
      weight: a.full_weight != null ? a.full_weight : a.weight,
      behaviour: a.key, family: b.family, label: b.label, tone: b.tone,
      slack: a.slack, pressure: a.pressure, concern: a.concern,
      text: FEED.say(p, a.key, { total: a.pressure, worst: a.concern }, d, next),
      note: a.pressure < 12
        ? (b.family === 'prosocial' ? 'has time to spare' : 'nothing pressing')
        : 'worried about ' + a.concern,
      prosocial_kind: a.prosocial_kind,

      /* AGENT-ONLY FIELDS.
         `asked` is what the agent chose before admissibility ran. When
         it differs from `behaviour` the world refused the choice, and
         the page says so rather than hiding it — a run where agents
         keep asking for the impossible is a run whose prompt needs
         work, and that should be visible, not buried in a log. */
      asked: a.asked !== a.key ? a.asked : null,
      redirected: a.redirected || null,
      departed: a.departed || 0,
      _loud: loud
    };
  });

  const heard = posts.filter(x => x._loud);
  heard.forEach(x => { delete x._loud; });
  posts.forEach(x => { delete x._loud; });

  heard.sort((x, y) => (y.behaviour === 'flourish' ? 1 : 0) - (x.behaviour === 'flourish' ? 1 : 0) ||
                       y.pressure - x.pressure);

  return heard;
}

/* ---------------------------------------------------------------------
   A WHOLE RUN, ROUND BY ROUND
   ---------------------------------------------------------------------
   The government is deliberately a steady one: the feed exists to show
   what SOCIETY did, and a cabinet reacting cleverly in the background
   would make it impossible to tell whether a change on the page came
   from citizens or from a government responding to them.
   --------------------------------------------------------------------- */
async function runFeed(opts) {
  opts = opts || {};
  const scenario = opts.scenario || 'resilient_2074';
  const week = opts.week || 4;
  const rounds = opts.rounds || 12;

  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'));
  const src = world.states[scenario] || world.states.resilient_2074;

  /* THE TEAM'S OWN GOVERNMENT, WHEN THERE IS ONE.
     The feed page publishes the studio's live levers with its request.
     Without this the agents would be reacting to a demo scenario while
     the header said "watching your society", which is the one lie this
     page must never tell. */
  const levers = opts.levers ? normaliseLevers(opts.levers, src, week)
                             : leversFor(src, week);

  const cabinet = async () => ({ levers: levers, rationale: 'holds a steady course' });
  cabinet.faults = [];

  const decide = opts.decide || D.deterministic();
  if (typeof decide.reset === 'function') await decide.reset(opts.seed == null ? 1 : opts.seed);

  const run = await runSociety({
    base: world.states.baseline_2050,
    cabinet: cabinet, initialLevers: levers,
    rounds: rounds, shocks: opts.shocks || {}, decide: decide
  });

  const byRound = {};
  run.society.forEach((s, i) => {
    const prev = run.trajectory[i];
    const next = run.trajectory[i + 1];
    if (!prev || !next) return;

    const posts = postsFor(
      { actions: s.actions.map(a => Object.assign({}, a, {
          name: BY_ID[a.id].name, role: BY_ID[a.id].role,
          full_weight: BY_ID[a.id].weight,
          concern: a.concern || 'material',
          prosocial_kind: A.ACTIONS[a.key].family === 'prosocial'
            ? (a.key === 'flourish' ? 'surplus' : 'deficit') : null
        })) },
      prev, next);

    byRound[s.round] = {
      round: s.round, year: s.year, posts: posts,
      trending: s.shares.slice(0, 3),
      mood: {
        unrest: s.unrest,
        sentiment_unrest: s.sentiment_unrest,
        furious: s.share_furious == null ? 0 : s.share_furious,
        flourishing: Math.round(s.shares.reduce((a, x) =>
          a + (x.key === 'flourish' ? x.share : 0), 0)),
        coping: Math.round(s.shares.reduce((a, x) =>
          a + (x.key === 'mutual_aid' ? x.share : 0), 0))
      },
      decidedBy: s.source
    };
  });

  return {
    scenario: scenario, week: week,
    decidedBy: run.decidedBy,
    rounds: byRound,
    trajectory: run.trajectory,
    faults: run.faults,
    score: run.score
  };
}

/* ---------------------------------------------------------------------
   THE CACHE
   ---------------------------------------------------------------------
   Keyed on everything that would change the run. An in-flight run is
   cached as its PROMISE, so twelve near-simultaneous requests from a
   page that just loaded produce one run rather than twelve.
   --------------------------------------------------------------------- */
const cache = new Map();

/* A short, stable digest of anything that changes the country. Two
   teams on the same server must not share a cached run because they
   happened to pick the same scenario name. */
function digest(v) {
  /* An empty object and nothing at all are the same country. The page
     sends `shocks: {}` where a script sends none, and without this they
     hash differently and each pays for its own full agent run of an
     identical world — minutes, on a local model, for nothing. */
  if (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) v = null;
  const s = JSON.stringify(v == null ? null : v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function keyFor(o) {
  return [o.scenario || 'resilient_2074', o.week || 4, o.rounds || 12,
          o.decider || 'deterministic', o.seed == null ? 1 : o.seed,
          digest(o.levers || null), digest(o.shocks || null)].join('|');
}

function cachedRun(opts) {
  const key = keyFor(opts);
  if (cache.has(key)) return cache.get(key);
  const promise = runFeed(opts).catch(err => {
    // A failed run must not be cached, or the page never recovers.
    cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

function invalidate(opts) {
  if (!opts) { cache.clear(); return 'all'; }
  const key = keyFor(opts);
  cache.delete(key);
  return key;
}

function cacheState() {
  return { runs: cache.size, keys: Array.from(cache.keys()) };
}

module.exports = { runFeed, cachedRun, invalidate, cacheState, postsFor, keyFor };
