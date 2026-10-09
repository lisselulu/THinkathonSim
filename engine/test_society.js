/* =====================================================================
   TESTS — the action space, the decider, and the closed loop
   ---------------------------------------------------------------------
     node engine/test_society.js

   Four things are worth testing here and they are not the obvious ones.

   1. THE BLINDNESS HOLDS. Not "we intended it to" — every observation
      that would cross the wire, over a full run, checked for every
      forbidden term. This is the constraint the instrument rests on and
      it fails silently if it fails at all.

   2. THE TWO PRESSURE FUNCTIONS AGREE. `lab/feed.js` and
      `engine/society_round.js` each carry a copy, because one runs in a
      browser and one does not. Two copies of a formula is one formula
      and one bug, so the test asserts they agree cohort by cohort
      across several states rather than trusting that whoever edits one
      remembers the other.

   3. THE LOOP IS ACTUALLY CLOSED. A run where citizens strike must
      produce a different country from one where they do not. It is easy
      to build all of this and wire the last step to nothing.

   4. FAILURE DEGRADES HONESTLY. With the sidecar down, a run completes,
      uses the deterministic chooser, and SAYS SO in `decidedBy`.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const E = require('./meridian-engine.js');
const C = require('./citizen_friction.js');
const A = require('./action_space.js');
const D = require('./decide.js');
const L = require('./lived.js');
const S = require('./society_round.js');
const K = require('./contribution.js');
const F = require('../lab/feed.js');
const { runSociety } = require('../harness/loop.js');

let passed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

const world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'));

function leversFor(base) {
  const lev = JSON.parse(JSON.stringify(base.levers || E.DEFAULT_LEVERS));
  lev.automation_target = {};
  E.ORDER.forEach(k => { lev.automation_target[k] = base.sectors[k].automation; });
  if (lev.care_guarantee_wage == null) lev.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
  return lev;
}
function steady(levers) {
  const f = async () => ({ levers: levers, rationale: 'steady' });
  f.faults = [];
  return f;
}

/* =====================================================================
   0. GUARDRAILS --- these run FIRST, and that is the point
   ---------------------------------------------------------------------
   A typo'd sector name throws deep inside an unrelated test long before
   a check at the bottom of the file could speak, so the suite died with
   a stack trace instead of a sentence naming the typo. A diagnostic that
   only runs when everything already works is not a diagnostic.
   ===================================================================== */
/* ---- STAGE 0 --------------------------------------
   The sector table is about to change. Every assertion here guards a
   failure that is otherwise silent: a NaN that arrives rounds later
   somewhere unrelated, or a page that throws only when someone opens
   it. They are written BEFORE the table moves, on purpose — a guard
   added after the breakage is a post-mortem, not a guard. */

// The engine's own invariants must actually fire when violated.
(function () {
  const problems = [];
  E.ORDER.forEach(k => {
    const c = E.SECTORS[k];
    ['name', 'base_output_bn', 'base_headcount', 'avg_wage', 'automation_r1',
     'productivity', 'human_touch', 'comfort', 'compute_int', 'demand_driver',
     'essential'].forEach(f => {
      if (c[f] === undefined || c[f] === null) problems.push(k + '.' + f);
    });
  });
  ok('every sector carries every field', problems.length === 0, problems.join(', '));

  ok('every sector has a known demand driver',
     E.ORDER.every(k => ['population', 'elderly', 'youth', 'consumption', 'compute']
       .indexOf(E.SECTORS[k].demand_driver) >= 0),
     E.ORDER.filter(k => ['population', 'elderly', 'youth', 'consumption', 'compute']
       .indexOf(E.SECTORS[k].demand_driver) < 0).join(', '));

  ok('every sector has an automation default',
     E.ORDER.every(k => typeof E.DEFAULT_LEVERS.automation_target[k] === 'number'),
     E.ORDER.filter(k => typeof E.DEFAULT_LEVERS.automation_target[k] !== 'number').join(', '));

  /* Round 1 is AUTHORED, not computed — `seed()` copies world-states
     verbatim — so a table change desynchronises the authored baseline
     from what the formula produces, and it only shows at round 2. */
  Object.keys(world.states).forEach(name => {
    const s = world.states[name];
    const missing = E.ORDER.filter(k => !s.sectors || !s.sectors[k]);
    ok('world state carries every sector: ' + name, missing.length === 0, missing.join(', '));
    const extra = Object.keys(s.sectors || {}).filter(k => !E.SECTORS[k]);
    ok('world state names no unknown sector: ' + name, extra.length === 0, extra.join(', '));
  });
})();

/* The citizen corpus names sectors as bare strings with no validation.
   A renamed sector makes `md.services[k]` undefined, then NaN
   sentiment, then NaN civic_unrest fed back into the engine. */
(function () {
  const bad = [];
  C.ARCHETYPES.forEach(p => {
    (p.depends || []).forEach(k => { if (!E.SECTORS[k]) bad.push(p.id + ' -> ' + k); });
    if (!p.depends || !p.depends.length) bad.push(p.id + ' depends on nothing');
  });
  ok('every cohort depends on real sectors', bad.length === 0, bad.join(', '));

  /* A sector nobody depends on is invisible to the feed and to every
     citizen decision — worth knowing about deliberately rather than
     discovering when a new sector never appears in a post. */
  const leaned = {};
  C.ARCHETYPES.forEach(p => (p.depends || []).forEach(k => { leaned[k] = true; }));
  const orphans = E.ORDER.filter(k => !leaned[k]);
  ok('no essential sector is invisible to every cohort',
     orphans.filter(k => E.SECTORS[k].essential).length === 0,
     'orphaned essentials: ' + orphans.filter(k => E.SECTORS[k].essential).join(', '));
})();

/* Sector keys named as string literals elsewhere. Each of these is a
   silent no-op if the key stops existing. */
(function () {
  const named = []
    .concat(A.LABOUR_SECTORS.map(k => ['action_space.LABOUR_SECTORS', k]))
    .concat(A.COVERABLE_SECTORS.map(k => ['action_space.COVERABLE_SECTORS', k]))
    .concat((K.DEFAULT_POLICY.buys || []).map(k => ['contribution.buys', k]));
  const bad = named.filter(([, k]) => !E.SECTORS[k]);
  ok('every sector named in the agent layer exists',
     bad.length === 0, bad.map(([w, k]) => w + ':' + k).join(', '));
})();

/* The city view keeps its own ordered list and a fixed grid. An extra
   sector indexes past the end of SLOTS and throws when the page opens,
   which is the worst possible time to find out. */
(function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lab', 'city.js'), 'utf8');
  const slotMatch = /SLOTS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(src);
  ok('city.js declares its slots', !!slotMatch);
  if (slotMatch) {
    const slots = (slotMatch[1].match(/\[/g) || []).length;
    ok('the city has a slot for every sector', slots >= E.ORDER.length,
       slots + ' slots for ' + E.ORDER.length + ' sectors');
  }
  const metaKeys = E.ORDER.filter(k => src.indexOf(k) < 0);
  ok('the city knows every sector', metaKeys.length === 0, metaKeys.join(', '));
})();

/* The market binds tradable resources to sector keys by name. */
(function () {
  const M = require('./market.js');
  const bad = Object.keys(M.RESOURCES || {})
    .map(r => [r, M.RESOURCES[r].sector])
    .filter(([, k]) => k && !E.SECTORS[k]);
  ok('every tradable resource names a real sector', bad.length === 0,
     bad.map(([r, k]) => r + ':' + k).join(', '));
})();


/* GUARDRAILS FAIL FAST.
   ---------------------------------------------------------------------
   If the sector table is inconsistent, every test after this point is
   meaningless and most of them will crash with a stack trace pointing at
   whichever line happened to dereference the missing key first — which is
   never the line that is wrong. Report and stop, so the first thing on
   screen is the sentence naming the actual problem. */
if (failures.length) {
  console.log('GUARDRAILS FAILED (' + failures.length + ') — the sector table is inconsistent.');
  console.log('Nothing after this point would mean anything, so the run stops here.\n');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}

/* =====================================================================
   1. THE ACTION SPACE
   ===================================================================== */
ok('twelve actions', A.KEYS.length === 12, A.KEYS.length + ' found');
ok('six families', Object.keys(A.FAMILIES).length === 6,
   Object.keys(A.FAMILIES).join(', '));
['prosocial', 'antisocial', 'conforming', 'collective', 'economic', 'political']
  .forEach(f => ok('family present: ' + f, !!A.FAMILIES[f]));

// Every sector named in a consequence must exist, or the engine silently ignores it.
A.KEYS.forEach(k => {
  const c = A.ACTIONS[k].consequence || {};
  ['capacity', 'headcount'].forEach(field => {
    if (!c[field]) return;
    c[field].sectors.forEach(s =>
      ok('known sector in ' + k + '.' + field, !!E.SECTORS[s], s));
  });
});

// Every action needs the prose a model and a page both read.
A.KEYS.forEach(k => {
  ok('action has intent: ' + k, typeof A.ACTIONS[k].intent === 'string' && A.ACTIONS[k].intent.length > 10);
  ok('action has option: ' + k, typeof A.ACTIONS[k].option === 'string' && A.ACTIONS[k].option.length > 10);
});

/* Consequences are linear in weight and floored. A general strike must
   not be able to hand the engine a negative capacity. */
(function () {
  const everyone = C.ARCHETYPES.map(p => ({ key: 'strike', weight: p.weight }));
  const x = A.consequences(everyone);
  Object.keys(x.capacity).forEach(k =>
    ok('capacity floored above zero: ' + k, x.capacity[k] >= 0.55 && x.capacity[k] <= 1));
  const none = A.consequences([]);
  ok('no actions, no effect', Object.keys(none.capacity).length === 0 &&
     none.cohesion_bonus === 0 && none.legitimacy_bonus === 0);
})();

/* Admissibility is about circumstance, never about judgement. */
ok('cannot strike without work',
   A.admissible('strike', { working: false }).key === 'organise');
ok('striking while working is untouched',
   A.admissible('strike', { working: true }).key === 'strike');
ok('cannot emigrate without the means',
   A.admissible('emigrate', { working: true, mobility: 0.1 }).key === 'endure');
ok('flourishing without slack becomes mutual aid',
   A.admissible('flourish', { working: true, slack: 0.0 }).key === 'mutual_aid');
ok('unknown action falls back rather than throwing',
   A.admissible('riot', { working: true }).key === 'endure');

/* =====================================================================
   2. THE TWO PRESSURE FUNCTIONS AGREE
   ===================================================================== */
(function () {
  let compared = 0, worst = 0;
  ['baseline_2050', 'boom_2060', 'shock_2058', 'resilient_2074'].forEach(name => {
    const base = world.states[name];
    if (!base) return;
    const lev = leversFor(base);
    const prev = E.seed(base);
    const next = E.step(prev, lev, [], { civic_unrest: 0 });
    const d = C.macroDelta(prev, next);

    C.ARCHETYPES.forEach(p => {
      const mine = S.pressureOf(p, next, d);
      const theirs = F.pressure(p, next, d, S.dispositionOf(p));
      compared++;
      worst = Math.max(worst, Math.abs(mine.total - theirs.total));
      ok('pressure agrees: ' + name + '/' + p.id,
         near(mine.total, theirs.total, 1e-9) && mine.worst === theirs.worst,
         'engine ' + mine.total.toFixed(4) + ' vs feed ' + theirs.total.toFixed(4));

      const ms = S.slackOf(p, next, d), ts = F.slack(p, next, d);
      ok('slack agrees: ' + name + '/' + p.id, near(ms, ts, 1e-9),
         ms.toFixed(4) + ' vs ' + ts.toFixed(4));
    });
  });
  ok('pressure compared across states', compared >= 40, compared + ' comparisons');
  if (worst > 0) failures.push('pressure drift: worst delta ' + worst);
})();

/* The bug that made the rewrite necessary: one catastrophe among three
   non-problems must not average out into a mild inconvenience. */
(function () {
  const p = C.ARCHETYPES.find(x => x.id === 'A02');
  const base = world.states.baseline_2050;
  const lev = leversFor(base);
  const prev = E.seed(base);
  const next = E.step(prev, lev, ['pandemic'], { civic_unrest: 0 });
  const d = C.macroDelta(prev, next);
  const pr = S.pressureOf(p, next, d);
  const maxChannel = Math.max(pr.material, pr.service, pr.work, pr.voice);
  ok('worst channel dominates the total', pr.total >= maxChannel,
     'total ' + pr.total.toFixed(1) + ' < worst channel ' + maxChannel.toFixed(1));
})();

/* The two CHOOSERS must agree too, not just the two pressure functions.
   The page and the simulation may not decide different things about the
   same cohort in the same year. */
(function () {
  let compared = 0;
  ['baseline_2050', 'boom_2060', 'shock_2058', 'resilient_2074'].forEach(name => {
    const base = world.states[name];
    if (!base) return;
    const lev = leversFor(base);
    const prev = E.seed(base);
    const next = E.step(prev, lev, [], { civic_unrest: 0 });
    const d = C.macroDelta(prev, next);

    C.ARCHETYPES.forEach(p => {
      const dis = S.dispositionOf(p);
      const sl = S.slackOf(p, next, d);
      const pr = S.pressureOf(p, next, d);
      [null, 'organise', 'endure'].forEach(prevKey => {
        const mine = D.deterministicChoose(p, pr, sl, S.dispositionOf(p), prevKey);
        const theirs = F.choose(p, pr, sl, S.dispositionOf(p), prevKey);
        compared++;
        ok('chooser agrees: ' + name + '/' + p.id + '/' + prevKey,
           mine === theirs, 'engine ' + mine + ' vs feed ' + theirs);
      });
    });
  });
  ok('choosers compared broadly', compared >= 120, compared + ' comparisons');
})();

/* =====================================================================
   3. BLINDNESS, OVER A WHOLE RUN
   ===================================================================== */
(function () {
  const base = world.states.baseline_2050;
  const lev = leversFor(base);
  let prev = E.seed(base);
  prev.levers = lev;
  let checked = 0;

  for (let r = 1; r < 8; r++) {
    const next = E.step(prev, lev, r === 4 ? ['pandemic'] : [], { civic_unrest: 40 });
    next.news = E.bulletin(next, prev);
    C.ARCHETYPES.forEach(p => {
      const obs = D.observationFor(p, prev, next, { prevKey: 'organise', yearsLikeThis: 4 });
      const bad = L.leaks(JSON.stringify(obs));
      ok('observation is blind: r' + r + '/' + p.id, bad.length === 0, bad.join(', '));
      checked++;
    });
    prev = next;
  }
  ok('blindness checked broadly', checked >= 80, checked + ' observations');

  // And the guard itself must actually fire.
  let threw = false;
  try { D.assertObservationBlind({ note: 'the corporate tax rate is 0.38' }); }
  catch (e) { threw = true; }
  ok('the blindness guard throws on a leak', threw);
})();

/* =====================================================================
   4. THE LOOP IS CLOSED
   ===================================================================== */
(async function () {
  const base = world.states.baseline_2050;
  const lev = leversFor(base);

  /* A decider that makes everyone strike, against one that makes
     everyone endure. Same government, same shocks, same everything
     else. If the trajectories match, nothing is wired up. */
  function forced(key) {
    /* The PER-ROUND source is what `decidedBy` is derived from, since a
       run must report who actually decided it rather than who was asked
       to. So the stub labels its rounds, not just itself. */
    const f = async batch => ({
      choices: batch.reduce((o, b) => { o[b.id] = key; return o; }, {}),
      source: 'test:' + key
    });
    f.source = 'test:' + key;
    return f;
  }

  const strikeRun = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 8,
    shocks: {}, decide: forced('strike')
  });
  const endureRun = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 8,
    shocks: {}, decide: forced('endure')
  });

  const a = strikeRun.trajectory[strikeRun.trajectory.length - 1];
  const b = endureRun.trajectory[endureRun.trajectory.length - 1];

  ok('a striking country differs from an enduring one',
     !near(a.indicators.effective_ubi_index, b.indicators.effective_ubi_index, 0.01),
     'both ended at purchasing power ' + a.indicators.effective_ubi_index);
  ok('striking is worse than enduring, all else equal',
     E.score(strikeRun.trajectory).total <= E.score(endureRun.trajectory).total,
     'strike ' + E.score(strikeRun.trajectory).total.toFixed(1) +
     ' vs endure ' + E.score(endureRun.trajectory).total.toFixed(1));

  /* Mutual aid props up the services neighbours can actually cover. */
  const aidRun = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 8,
    shocks: {}, decide: forced('mutual_aid')
  });
  const aidCare = aidRun.trajectory[aidRun.trajectory.length - 1].sectors.care_services.quality;
  const endCare = b.sectors.care_services.quality;
  ok('mutual aid holds up care services', aidCare > endCare,
     'aid ' + aidCare.toFixed(1) + ' vs endure ' + endCare.toFixed(1));

  /* Emigration depletes rather than repeating forever. */
  const goRun = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 10,
    shocks: {}, decide: forced('emigrate')
  });
  const leaving = goRun.society.map(s =>
    (s.shares.find(x => x.key === 'emigrate') || { share: 0 }).share);
  ok('emigration depletes over time',
     leaving.length > 3 && leaving[leaving.length - 1] < leaving[0],
     'shares: ' + leaving.join(', '));

  /* The run must say who decided it. */
  ok('run records the decider that actually ran', endureRun.decidedBy === 'test:endure',
     String(endureRun.decidedBy));

  /* The claim must be falsifiable: a run that ASKED for agents and got
     none must not report itself as agent-decided. */
  const liar = D.remote({ url: 'http://127.0.0.1:9', timeoutMs: 500 });
  const lied = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 3,
    shocks: {}, decide: liar
  });
  ok('a run that fell back does not claim concordia',
     !/^concordia$/.test(lied.decidedBy), String(lied.decidedBy));
  ok('society log has a row per round', endureRun.society.length === 7,
     endureRun.society.length + ' rows');

  /* ---- 5. honest degradation ------------------------------------- */
  const dead = D.remote({ url: 'http://127.0.0.1:9', timeoutMs: 700 });
  const h = await dead.health();
  ok('a dead sidecar reports unhealthy', h.ok === false);

  const degraded = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev, rounds: 4,
    shocks: {}, decide: dead
  });
  ok('a run completes with the sidecar down', degraded.trajectory.length === 4);
  ok('and says it fell back', /deterministic/.test(degraded.society[0].source),
     degraded.society[0].source);

  /* ---- 6. the feed page's data path -------------------------------- */
  const SFEED = require('../lab/society-feed.js');

  /* Cache keys must separate two teams' countries. Same scenario, same
     week, different levers is a DIFFERENT run, and sharing one would
     quietly show one team another team's society. */
  const kA = SFEED.keyFor({ scenario: 'resilient_2074', week: 4, levers: { corporate_tax_rate: 0.2 } });
  const kB = SFEED.keyFor({ scenario: 'resilient_2074', week: 4, levers: { corporate_tax_rate: 0.4 } });
  const kC = SFEED.keyFor({ scenario: 'resilient_2074', week: 4, levers: { corporate_tax_rate: 0.2 } });
  ok('different levers are different runs', kA !== kB, kA + ' vs ' + kB);
  ok('the same levers are the same run', kA === kC);
  ok('a decider change is a different run',
     SFEED.keyFor({ decider: 'concordia' }) !== SFEED.keyFor({ decider: 'deterministic' }));

  /* The page renders `posts`; a round must arrive in that shape with
     the words already written, whether or not any model is reachable. */
  const feedRun = await SFEED.runFeed({ scenario: 'resilient_2074', week: 4, rounds: 5 });
  ok('feed run reports its decider', feedRun.decidedBy === 'deterministic', feedRun.decidedBy);
  const roundKeys = Object.keys(feedRun.rounds);
  ok('feed run has rounds', roundKeys.length === 4, roundKeys.join(','));

  const oneRound = feedRun.rounds[roundKeys[roundKeys.length - 1]];
  ok('round carries a year', typeof oneRound.year === 'number');
  ok('round carries mood', oneRound.mood && typeof oneRound.mood.unrest === 'number');
  ok('mood carries what mood ALONE would have been',
     typeof oneRound.mood.sentiment_unrest === 'number');
  /* EVERY FIELD THE PAGE PRINTS MUST SURVIVE THE TRIP.
     The society log used to project a handful of fields out of each
     action, so the page rendered "slack undefined" on every post and
     blamed every grievance on `material`. Tests passed throughout,
     because nothing asserted that a post arrives whole. */
  oneRound.posts.forEach(post => {
    ['slack', 'pressure', 'weight', 'concern', 'label', 'family', 'text']
      .forEach(field => ok('post carries ' + field + ': ' + post.id,
        post[field] !== undefined && post[field] !== null,
        field + ' = ' + post[field]));
    ok('post slack is a number: ' + post.id, typeof post.slack === 'number', String(post.slack));
    ok('post concern is a real channel: ' + post.id,
       ['material', 'service', 'work', 'voice'].indexOf(post.concern) >= 0, post.concern);
  });

  oneRound.posts.forEach(post => {
    ok('post has words: ' + post.id,
       typeof post.text === 'string' && post.text.length > 10, post.text);
    ok('post has a known behaviour: ' + post.id, !!A.ACTIONS[post.behaviour], post.behaviour);
    ok('post families match the action space: ' + post.id,
       post.family === A.ACTIONS[post.behaviour].family);
  });

  /* Levers really do reach the run rather than being accepted and
     dropped — the failure mode that would make "watching your society"
     a lie while every test still passed. */
  /* `allocation` is an object ({ubi, infrastructure, reserves}), not a
     scalar. An earlier version of this test passed a number, which
     `validateLevers` correctly refused — so the run used the inherited
     levers and the two trajectories came back identical. The test was
     wrong, and it is worth keeping the shape visible here so the next
     person does not repeat it. */
  const stingy = await SFEED.runFeed({ scenario: 'resilient_2074', week: 4, rounds: 5,
    levers: { allocation: { ubi: 0.20, infrastructure: 0.50, reserves: 0.30 } } });
  const rich = await SFEED.runFeed({ scenario: 'resilient_2074', week: 4, rounds: 5,
    levers: { allocation: { ubi: 0.75, infrastructure: 0.15, reserves: 0.10 } } });
  const ppi = r => r.trajectory[r.trajectory.length - 1].indicators.effective_ubi_index;
  ok('the posted levers change the country', Math.abs(ppi(stingy) - ppi(rich)) > 0.5,
     'stingy ' + ppi(stingy).toFixed(1) + ' vs generous ' + ppi(rich).toFixed(1));

  /* ---- 7. long runs ------------------------------------------------ */
  const LR = require('./longrun.js');

  /* The cap is gone: a run must actually advance past 2072. This froze
     silently before — the round and the year both stopped while the
     engine kept returning valid-looking states. */
  (function () {
    let st = E.seed(base);
    st.levers = lev;
    for (let i = 0; i < 20; i++) st = E.step(st, lev, [], { civic_unrest: 0 });
    ok('runs advance past the old twelve-round cap', st.meta.round === 21, 'round ' + st.meta.round);
    ok('and the year advances with them', st.meta.year === 2048 + 21 * 2, 'year ' + st.meta.year);
    ok('demography keeps moving past the last anchor',
       st.population.total < 5520000 && st.population.total > 3000000,
       'population ' + st.population.total);
  })();

  /* Decades must partition the run and flag partial windows, or a run
     ending on a good year could report a good decade. */
  (function () {
    const traj = [];
    let st = E.seed(base); st.levers = lev;
    traj.push(st);
    for (let i = 0; i < 12; i++) { st = E.step(st, lev, [], { civic_unrest: 0 }); traj.push(st); }

    const d = LR.decades(traj);
    ok('decades cover the run', d.length === 3, d.length + ' decades from 13 states');
    ok('a full decade is five rounds', d[0].rounds === 5 && d[0].complete === true);
    ok('a short tail is flagged partial',
       d[d.length - 1].complete === (d[d.length - 1].rounds === 5),
       'rounds ' + d[d.length - 1].rounds + ' complete ' + d[d.length - 1].complete);
    ok('decades carry a low as well as a mean',
       d[0].purchasing_power_low <= d[0].purchasing_power);
  })();

  /* THE BUG THIS WHOLE FILE EXISTS FOR: identical governance must not
     score worse merely for being observed longer. */
  (function () {
    const build = n => {
      const traj = [];
      let st = E.seed(base); st.levers = lev;
      traj.push(st);
      for (let i = 0; i < n; i++) { st = E.step(st, lev, [], { civic_unrest: 0 }); traj.push(st); }
      return traj;
    };
    const shortRun = build(11), longRun = build(30);

    const sShort = E.score(shortRun).total, sLong = E.score(longRun).total;
    ok('the raw score does penalise length (documented, not fixed)',
       sLong <= sShort, 'short ' + sShort + ' long ' + sLong);

    /* The decade view is the length-fair one: the first decade of both
       runs is the same decade and must read the same. */
    const dShort = LR.decades(shortRun)[0], dLong = LR.decades(longRun)[0];
    ok('the first decade reads identically regardless of run length',
       dShort.purchasing_power === dLong.purchasing_power &&
       dShort.worst_service === dLong.worst_service,
       dShort.purchasing_power + ' vs ' + dLong.purchasing_power);
  })();

  /* Collapse: detected, dated to when it BEGAN, and reasoned. */
  (function () {
    const traj = [];
    let st = E.seed(base); st.levers = lev;
    traj.push(st);
    for (let i = 0; i < 30; i++) {
      st = E.step(st, lev, i === 4 ? ['pandemic'] : [], { civic_unrest: 90 });
      traj.push(st);
    }
    const c = LR.collapse(traj);
    ok('a failing society is detected as collapsed', c.collapsed === true);
    ok('collapse names a reason',
       ['service', 'purchasing_power', 'insolvency'].indexOf(c.reason) >= 0, String(c.reason));
    ok('collapse is dated to when it began, not when we noticed',
       c.began_year < c.year, c.began_year + ' vs ' + c.year);

    /* A healthy society must not be reported as collapsed — the check
       has to be falsifiable in both directions. */
    const good = [];
    let g = E.seed(base); g.levers = lev;
    good.push(g);
    for (let i = 0; i < 6; i++) { g = E.step(g, lev, [], { civic_unrest: 0 }); good.push(g); }
    ok('a healthy society is not called collapsed', LR.collapse(good).collapsed === false);

    // One bad round is a shock, not a collapse.
    const blip = good.slice();
    ok('a single bad round is not a collapse',
       LR.collapse(blip, { sustain: 3 }).collapsed === false);
  })();

  /* Open-ended runs stop on their own and say why. */
  (function () {
    ok('trend always carries a verdict',
       typeof LR.trend([E.seed(base)]).verdict === 'string');
  })();

  const openRun = await runSociety({
    base: base, cabinet: steady(lev), initialLevers: lev,
    until: 'collapse', shocks: { 5: ['pandemic'] }, decide: forced('strike')
  });
  ok('an open-ended run ends on its own', openRun.ended.stop === true, openRun.ended.why);
  ok('and says why', /collapse|stable|stalled|backstop/.test(openRun.ended.why), openRun.ended.why);
  ok('and reports a long-run view', !!openRun.longrun && openRun.longrun.decades.length > 0);
  ok('the long-run view warns about comparing scores across lengths',
     /equal length/.test(openRun.longrun.score_note));
  ok('an open run outlived the old twelve-round cap or died explaining why',
     openRun.trajectory.length > 12 || openRun.longrun.collapse.collapsed,
     'rounds ' + openRun.trajectory.length);

  /* ---- 8. scarcity pricing ----------------------------------------- */
  (function () {
    const auto = fn => {
      const l = JSON.parse(JSON.stringify(base.levers));
      l.automation_target = {};
      E.ORDER.forEach(k => { l.automation_target[k] = fn(k, base.sectors[k].automation); });
      if (l.care_guarantee_wage == null) l.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
      return l;
    };
    const play = (levers, rounds, exoFor) => {
      let st = E.seed(base); st.levers = levers;
      for (let i = 1; i <= (rounds || 10); i++) {
        st = E.step(st, levers, [], Object.assign({ civic_unrest: 0 },
          exoFor ? exoFor(i) : null));
      }
      return st;
    };

    const baseline = play(auto((k, cur) => cur));
    const starved = play(auto((k, cur) => k === 'energy_utilities' ? cur : 0.95));
    const fed = play(auto((k, cur) => k === 'energy_utilities' ? 0.95 : cur));

    ok('tightness is recorded', typeof baseline._computeTightness === 'number',
       String(baseline._computeTightness));

    /* THE POINT OF THE WHOLE MECHANISM: automating the economy without
       building the energy to run it makes energy scarce and dear. */
    ok('automating without building energy raises tightness',
       starved._computeTightness > baseline._computeTightness * 1.5,
       'starved ' + starved._computeTightness + ' vs baseline ' + baseline._computeTightness);
    ok('and the price follows it up',
       starved._computePrice > baseline._computePrice,
       'starved ' + starved._computePrice + ' vs baseline ' + baseline._computePrice);
    ok('and households pay for it',
       starved.indicators.effective_ubi_index < baseline.indicators.effective_ubi_index,
       'starved ' + starved.indicators.effective_ubi_index +
       ' vs baseline ' + baseline.indicators.effective_ubi_index);

    /* And building the capacity is the answer, not a consolation. */
    ok('building energy capacity relieves scarcity',
       fed._computeTightness < baseline._computeTightness,
       'fed ' + fed._computeTightness + ' vs baseline ' + baseline._computeTightness);
    ok('and prices fall when slack returns',
       fed._computePrice < baseline._computePrice,
       'fed ' + fed._computePrice + ' vs baseline ' + baseline._computePrice);

    /* IMPORTING is the other route, and it must actually work — the
       trade layer delivers capacity as `exogenous.capacity`. */
    const imported = play(auto((k, cur) => k === 'energy_utilities' ? cur : 0.95), 10,
      () => ({ capacity: { energy_utilities: 1.6 } }));
    ok('importing energy relieves scarcity too',
       imported._computeTightness < starved._computeTightness,
       'imported ' + imported._computeTightness + ' vs starved ' + starved._computeTightness);
    ok('and shows up in the price',
       imported._computePrice < starved._computePrice,
       'imported ' + imported._computePrice + ' vs starved ' + starved._computePrice);

    /* Convexity: the response must accelerate, not be linear. */
    const P = E.PARAMS;
    const push = t => {
      const pressure = Math.max(0, t - P.SCARCITY_SLACK_BAND);
      return pressure > 0 ? P.SCARCITY_ELASTICITY * Math.pow(pressure, P.SCARCITY_CONVEXITY) : 0;
    };
    ok('scarcity bites nonlinearly',
       (push(1.4) - push(1.2)) > (push(1.2) - push(1.0)),
       'convexity ' + P.SCARCITY_CONVEXITY);
    ok('a comfortable sector is not charged a scarcity premium', push(0.9) === 0);

    /* The ceiling is a clamp and it does bind in extreme runs. Assert it
       holds rather than pretending it never fires. */
    ok('the price cannot run away', starved._computePrice <= P.SCARCITY_PRICE_CEILING,
       String(starved._computePrice));

    /* Prices must be stickier downward than upward. */
    ok('relief is slower than the push', P.SCARCITY_RELIEF < P.SCARCITY_ELASTICITY,
       P.SCARCITY_RELIEF + ' vs ' + P.SCARCITY_ELASTICITY);
  })();

  /* ---- 9. contribution credit -------------------------------------- */
  // K is required at the top, alongside the other engine modules.

  /* THE SHAPE IS THE WHOLE POINT. A reward that only ever helps would
     teach "just incentivise it", which the evidence contradicts. */
  ok('no scheme, no effect', K.crowding(0) === 0);
  const opt = K.optimum();
  ok('there is an interior optimum', opt.rate > 0.05 && opt.rate < 0.9, JSON.stringify(opt));
  ok('the optimum actually recruits', opt.effect > 0, String(opt.effect));
  const be = K.breakEven();
  ok('generosity eventually does harm', be !== null && be > opt.rate,
     'break-even ' + be + ' vs peak ' + opt.rate);
  ok('a small reward recruits', K.crowding(0.1) > 0, String(K.crowding(0.1)));
  ok('a maximal reward crowds out', K.crowding(1) < 0, String(K.crowding(1)));
  ok('the curve rises to the peak',
     K.crowding(opt.rate) >= K.crowding(opt.rate / 2));
  ok('and falls after it',
     K.crowding(opt.rate) > K.crowding(Math.min(1, opt.rate * 3)));

  /* Contribution, not conformity: a scheme paying for `obey` would be a
     different political object and this one must not become it. */
  ok('obedience earns nothing', !K.EARNS.obey);
  ok('endurance earns nothing', !K.EARNS.endure);
  ok('building something earns', K.EARNS.flourish > 0);
  ok('covering for the state earns', K.EARNS.mutual_aid > 0);

  /* Exclusion must scale with generosity, not merely with existence.
     A token scheme and a maximal one produced identical cohesion
     penalties in the first draft. */
  (function () {
    const acts = [
      { id: 'A01', name: 'a', key: 'flourish', weight: 0.2, slack: 60 },
      { id: 'A10', name: 'Mr Krishnan', key: 'endure', weight: 0.5, slack: 5 }
    ];
    const small = K.effects(acts, { rate: 0.05 });
    const large = K.effects(acts, { rate: 0.9 });
    ok('a token scheme excludes less than a generous one',
       small.cohesion_bonus > large.cohesion_bonus,
       small.cohesion_bonus + ' vs ' + large.cohesion_bonus);
    ok('a generous scheme costs more', large.reserves_bn < small.reserves_bn,
       large.reserves_bn + ' vs ' + small.reserves_bn);
    ok('the scheme is never free', small.reserves_bn < 0, String(small.reserves_bn));
    ok('no scheme costs nothing', K.effects(acts, { rate: 0 }).reserves_bn === 0);

    /* The people who cannot earn are named, every round. */
    const out = K.excluded(acts, { rate: 0.3 });
    const locked = out.filter(x => x.locked_out).map(x => x.name);
    ok('cohorts with no slack are reported as locked out',
       locked.indexOf('Mr Krishnan') >= 0, locked.join(', '));

    /* Gating essentials must visibly harm the services the excluded
       depend on, rather than being a free political choice. */
    const open = K.effects(acts, { rate: 0.6 });
    const gated = K.effects(acts, { rate: 0.6, gates_essentials: true });
    ok('gating essentials harms healthcare',
       (gated.capacity.healthcare || 1) < (open.capacity.healthcare || 1),
       String(gated.capacity.healthcare));
    ok('and costs cohesion', gated.cohesion_bonus < open.cohesion_bonus,
       gated.cohesion_bonus + ' vs ' + open.cohesion_bonus);
    ok('gating is off by default', K.DEFAULT_POLICY.gates_essentials === false);
    ok('the scheme is off by default', K.DEFAULT_POLICY.rate === 0);
  })();

  /* End to end: the lever must be able to change an outcome, or it is
     not a decision. */
  await (function () {
    const resilient = world.states.resilient_2074;
    const rl = leversFor(resilient);
    rl.working_week_days = 4;

    const runAt = async rate => runSociety({
      base: base, cabinet: steady(rl), initialLevers: rl, rounds: 12,
      shocks: {}, credit: { rate: rate }
    });

    return Promise.all([runAt(0), runAt(opt.rate), runAt(1)]).then(([none, peak, max]) => {
      const prosocial = run => {
        const s = run.society;
        return s.reduce((a, x) => a + x.shares
          .filter(y => y.key === 'flourish' || y.key === 'mutual_aid')
          .reduce((b, y) => b + y.share, 0), 0) / s.length;
      };
      const reserves = run => run.trajectory[run.trajectory.length - 1].fiscal.reserves_bn;

      ok('the credit lever changes participation',
         prosocial(peak) > prosocial(none),
         prosocial(none).toFixed(1) + ' -> ' + prosocial(peak).toFixed(1));
      ok('and maximising it is worse than finding the peak',
         prosocial(max) < prosocial(peak),
         'max ' + prosocial(max).toFixed(1) + ' vs peak ' + prosocial(peak).toFixed(1));
      ok('and the scheme is paid for out of reserves',
         reserves(peak) < reserves(none),
         reserves(peak).toFixed(1) + ' vs ' + reserves(none).toFixed(1));
      ok('a round reports who was locked out',
         peak.society[peak.society.length - 1].source !== undefined);
    });
  })();

  /* ---- 10. the constitution is worth marks -------------------------- */
  const CAB = require('../harness/cabinet.js');
  const AUD = require('../harness/auditor.js');

  /* Rules can be written in the same document as the promise. Before
     this, `parseConstitution` returned `rules: []` unconditionally, so a
     markdown-authored team could not break a promise it had written. */
  (function () {
    const md = [
      '# A Compact', '',
      'Some preamble that is not a clause.', '',
      '## Commitments', '',
      '- C1. We keep the lights on.', '',
      '  ```rule',
      '  when: round > 2',
      '  assert: worstEssential >= 50',
      '  ```', '',
      '- C2. We tax profit properly.', '',
      '  ```rule',
      '  assert: levers.corporate_tax_rate >= 0.25',
      '  ```', '',
      '- C3. A promise with no rule at all.'
    ].join('\n');

    const con = CAB.parseConstitution(md, 'test');
    ok('markdown yields clauses', con.clauses.length === 3, String(con.clauses.length));
    ok('markdown now yields rules', con.rules.length === 2, String(con.rules.length));
    ok('a rule carries its when', con.rules[0].when === 'round > 2', con.rules[0].when);
    ok('a rule defaults to always', con.rules[1].when === 'always', con.rules[1].when);
    ok('a rule is tied to its clause', con.rules[1].commitment === 1, String(con.rules[1].commitment));

    /* A fence must not leak into the prose. Its `- ` lines would
       otherwise be parsed as extra clauses. */
    ok('rule blocks do not become clauses',
       con.clauses.every(c => !/assert|when:/.test(c.text)),
       con.clauses.map(c => c.text).join(' | '));

    // A block with no assertion asserts nothing, and is dropped.
    const empty = CAB.parseConstitution(
      '# X\n\n- C1. A promise.\n\n  ```rule\n  when: always\n  ```\n', 't');
    ok('a rule with no assert is dropped', empty.rules.length === 0, String(empty.rules.length));

    // Prose that opens with a year is not clause 2074.
    const yearly = CAB.parseConstitution(
      '# X\n\n2074. We write this before we know.\n\n- C1. A promise.\n', 't');
    ok('a year is not a clause id', yearly.clauses.length === 1, String(yearly.clauses.length));
  })();

  /* The trace must be legible to the auditor. It was not: the auditor
     filters on `levers_enacted` and this loop only wrote `levers`, so
     every audit of a loop run matched zero rows and scored drift 0. */
  await (function () {
    return runSociety({
      base: base, cabinet: steady(lev), initialLevers: lev, rounds: 6, shocks: {}
    }).then(run => {
      ok('trace rows carry levers_enacted',
         run.trace.every(r => !!r.levers_enacted), 'some rows lack it');
      ok('trace rows carry a fallback flag',
         run.trace.every(r => typeof r.fallback === 'boolean'));
      const seen = AUD.auditDeterministic({
        trace: run.trace, trajectory: run.trajectory, constitution: { clauses: [] }
      });
      ok('the auditor can see the whole run', seen.rounds_traced === run.trace.length,
         seen.rounds_traced + ' of ' + run.trace.length);
      ok('a run reports its audit', !!run.audit && typeof run.audit.constitutional_drift === 'number');
    });
  })();

  /* THE BUG THIS SECTION EXISTS FOR.
     Same economy, same levers, same everything — only the written
     promise differs. It must change the marks, or writing is
     decoration. */
  await (function () {
    const conFrom = assertion => CAB.parseConstitution(
      '# T\n\n## Commitments\n\n- C1. A promise.\n\n  ```rule\n  assert: ' +
      assertion + '\n  ```\n', 't');

    const runWith = con => runSociety({
      base: base, cabinet: steady(lev), initialLevers: lev, rounds: 12,
      shocks: {}, constitution: con
    });

    return Promise.all([
      runWith(conFrom('levers.corporate_tax_rate >= 0.05')),   // kept
      runWith(conFrom('levers.corporate_tax_rate >= 0.40'))    // broken
    ]).then(([kept, broken]) => {
      const marks = r => r.score.components.constitutional_fidelity;

      ok('a kept promise holds its rule',
         kept.audit.detail.doctrine.rules_held === 1, JSON.stringify(kept.audit.detail.doctrine));
      ok('a broken promise breaks its rule',
         broken.audit.detail.doctrine.rules_held === 0, JSON.stringify(broken.audit.detail.doctrine));

      ok('breaking a written promise costs fidelity marks',
         marks(broken) < marks(kept), marks(kept) + ' vs ' + marks(broken));
      ok('and costs total score', broken.score.total < kept.score.total,
         kept.score.total + ' vs ' + broken.score.total);
      ok('a prose constitution no longer gets 15 marks for free',
         marks(broken) < 15, String(marks(broken)));

      /* The economy must be identical — otherwise this test is measuring
         the tax rate rather than the promise. */
      ok('the two runs governed identically',
         kept.trajectory[11].indicators.effective_ubi_index ===
         broken.trajectory[11].indicators.effective_ubi_index,
         'the economies differ, so this proves nothing');
    });
  })();

  /* The OTHER scoring path. Teams submit through `runHarness`, not
     through this loop, so the fix has to reach both or the marks are
     still free where it matters most. */
  await (function () {
    const H = require('./harness.js');
    const R = require('./harnesses/reference.js');

    ok('traceDrift is exported', typeof H.traceDrift === 'function');

    return Promise.all(Object.keys(R.harnesses).map(name =>
      H.runHarness(R.harnesses[name], {
        base: base, rounds: 12, constitution: R.CONSTITUTIONS[name] || null
      }).then(run => ({ name: name, run: run }))
    )).then(results => {
      results.forEach(({ name, run }) => {
        ok('harness trace carries levers_enacted: ' + name,
           run.trace.every(r => !!r.levers_enacted));
        ok('harness trace carries a fallback flag: ' + name,
           run.trace.every(r => typeof r.fallback === 'boolean'));
        ok('harness run reports drift: ' + name,
           !!run.drift && typeof run.drift.drift === 'number', JSON.stringify(run.drift));
        ok('the auditor sees every round: ' + name,
           run.drift.rounds_traced === run.trace.length,
           run.drift.rounds_traced + ' of ' + run.trace.length);
        /* A reference government written to match its own constitution
           should keep it. If these start drifting, either a reference or
           the distance metric has broken. */
        ok('a reference harness keeps its own constitution: ' + name,
           run.drift.drift < 0.15, String(run.drift.drift));
      });

      /* `accelerate` is the low bar teams must beat. It used to score
         exactly 15; the assertion is now on the PROPERTY rather than the
         number, because the number moved when manufacturing entered the
         model and will move again whenever the economy is recalibrated.
         A test pinned to a magic number would have to be edited every
         time and would stop meaning anything the second time.

         What must stay true: automating everything as hard as possible
         breaches the hard gates and scores badly. */
      const acc = results.find(r => r.name === 'accelerate');
      ok('accelerate breaches its gates', acc.run.score.gates_failed.length > 0,
         JSON.stringify(acc.run.score.gates_failed));
      ok('accelerate scores badly', acc.run.score.total <= 20, String(acc.run.score.total));

      /* And the two governments that try must beat it, comfortably. */
      const guardian = results.find(r => r.name === 'guardian');
      const steward = results.find(r => r.name === 'steward');
      ok('a real government beats the low bar',
         guardian.run.score.total > acc.run.score.total + 20 &&
         steward.run.score.total > acc.run.score.total + 20,
         'accelerate ' + acc.run.score.total + ', guardian ' + guardian.run.score.total +
         ', steward ' + steward.run.score.total);
    });
  })();

  /* A harness that throws is a round nobody governed, and must be
     counted as one rather than passing silently. */
  await (function () {
    const H = require('./harness.js');
    const broken = () => { throw new Error('deliberate'); };
    return H.runHarness(broken, { base: base, rounds: 6 }).then(run => {
      const ungoverned = run.trace.filter(r => r.fallback).length;
      ok('a throwing harness is recorded as ungoverned', ungoverned === 5,
         ungoverned + ' of ' + run.trace.length);
      ok('and it costs drift', run.drift.terms.rounds_ungoverned > 0,
         JSON.stringify(run.drift.terms));
      ok('and therefore costs fidelity marks',
         run.score.components.constitutional_fidelity < 15,
         String(run.score.components.constitutional_fidelity));
    });
  })();

  /* `invokes` was written into every trace row and read by nothing.
     It now resolves to the clause a round acted under. */
  await (function () {
    const H = require('./harness.js');
    const con = { name: 'T', commitments: ['C1. A promise.', 'C2. Another.'],
                  clauses: [{ id: 'C1', text: 'A promise.' }, { id: 'C2', text: 'Another.' }],
                  rules: [] };
    return H.runHarness(() => ({ levers: {}, invokes: 1, rationale: 'r' }),
                        { base: base, rounds: 4, constitution: con }).then(run => {
      const cited = run.trace.slice(1).every(r => (r.cites || []).indexOf('C2') >= 0);
      ok('invokes resolves to a clause id', cited,
         JSON.stringify(run.trace.map(r => r.cites)));
    });
  })();

  /* The drift channel itself, independent of any run. */
  ok('drift 0 is full marks',
     E.score([E.seed(base), E.seed(base)], null,
             { constitutional_drift: 0 }).components.constitutional_fidelity === 15);
  ok('drift 1 is no marks',
     E.score([E.seed(base), E.seed(base)], null,
             { constitutional_drift: 1 }).components.constitutional_fidelity === 0);
  ok('a nonsense drift falls back rather than scoring NaN',
     isFinite(E.score([E.seed(base), E.seed(base)], null,
                      { constitutional_drift: NaN }).components.constitutional_fidelity));

  /* ---- 12. STAGE 3 FOUNDATIONS -------------------------------------
     All of this must be BEHAVIOUR-NEUTRAL. The point of the stage is to
     put the machinery in place without moving a single existing result,
     so that when growth lands the change can be attributed to growth. */

  /* Per-sector capital: computed, differentiating, and not yet applied. */
  (function () {
    const traj = E.runTrajectory(base, lev, {}, 12);
    const last = traj[traj.length - 1];

    ok('per-sector capital is carried', !!last._sectorCapital);
    ok('every sector has a capital stock',
       E.ORDER.every(k => typeof last._sectorCapital[k] === 'number'),
       JSON.stringify(Object.keys(last._sectorCapital || {})));

    /* THE MISSING FEEDBACK LOOP. Sectors must DIVERGE — that is the whole
       point. A single economy-wide multiplier gave a 40%-margin sector
       and a -10% one the identical number. */
    const vals = E.ORDER.map(k => last._sectorCapital[k]);
    const spread = Math.max.apply(null, vals) - Math.min.apply(null, vals);
    ok('sectors accumulate capital at different rates', spread > 0.01,
       'spread ' + spread.toFixed(4));

    ok('capital stays inside its bounds',
       vals.every(v => v >= E.PARAMS.SECTOR_CAPITAL_FLOOR &&
                       v <= E.PARAMS.SECTOR_CAPITAL_CEILING));

    /* Raised in stage 5. It was zero while the machinery was being put
       in, which is what let that stage be byte-identical; asserting it is
       still zero would now be asserting that growth never landed. */
    ok('the capital weight is live', E.PARAMS.SECTOR_CAPITAL_WEIGHT > 0,
       String(E.PARAMS.SECTOR_CAPITAL_WEIGHT));

    /* Judged against its OWN calibrated margin, not against zero. Care
       services run at -0.09 by design; measuring every sector against the
       same absolute bar would decay care and education to the floor in
       every run whatever a government did. */
    ok('a by-design loss-making sector is not punished as failing',
       last._sectorCapital.care_services > E.PARAMS.SECTOR_CAPITAL_FLOOR * 1.5,
       'care_services capital ' + last._sectorCapital.care_services);
  })();

  /* The `firms` exogenous key, and the ceiling reading of the lever. */
  (function () {
    const hi = leversFor(base);
    E.ORDER.forEach(k => { hi.automation_target[k] = 0.90; });
    const seed = E.seed(base);
    seed.levers = hi;

    const free = E.step(seed, hi, [], {});
    const shy = E.step(seed, hi, [], { firms: { manufacturing: { automation: 0.20 } } });
    const greedy = E.step(seed, hi, [], { firms: { manufacturing: { automation: 0.99 } } });

    ok('with no firms the lever is still the target',
       free.sectors.manufacturing.automation > seed.sectors.manufacturing.automation,
       String(free.sectors.manufacturing.automation));
    ok('a firm may sit below the ceiling',
       shy.sectors.manufacturing.automation < free.sectors.manufacturing.automation,
       shy.sectors.manufacturing.automation + ' vs ' + free.sectors.manufacturing.automation);
    /* The government cannot be overruled upward. This is the whole point
       of calling it a ceiling. */
    ok('a firm cannot exceed the ceiling',
       greedy.sectors.manufacturing.automation === free.sectors.manufacturing.automation,
       greedy.sectors.manufacturing.automation + ' vs ceiling-limited ' +
       free.sectors.manufacturing.automation);
    ok('a firm decision touches only its own sector',
       shy.sectors.finance.automation === free.sectors.finance.automation);

    /* `automation_ceiling` is an accepted alias, so a team can write the
       lever under the name that describes what it does. */
    const aliased = JSON.parse(JSON.stringify(hi));
    aliased.automation_ceiling = JSON.parse(JSON.stringify(hi.automation_target));
    delete aliased.automation_target;
    aliased.automation_target = JSON.parse(JSON.stringify(E.DEFAULT_LEVERS.automation_target));
    const viaAlias = E.step(seed, aliased, [], {});
    ok('automation_ceiling is honoured as an alias',
       viaAlias.sectors.manufacturing.automation === free.sectors.manufacturing.automation,
       viaAlias.sectors.manufacturing.automation + ' vs ' + free.sectors.manufacturing.automation);
  })();

  /* The blindness guard is scoped: a firm and a citizen are not entitled
     to the same ignorance. */
  (function () {
    const throws = (t, scope) => {
      try { L.assertBlind(t, scope); return false; } catch (e) { return true; }
    };
    ok('a citizen may not see the tax rate', throws('the corporate tax rate is 0.38', 'citizen'));
    ok('a firm MAY see the tax rate it pays', !throws('the corporate tax rate is 0.38', 'firm'));
    ok('a firm may see its own margin and demand',
       !throws('your margin is 0.14 and demand rose 3%', 'firm'));
    ok('a firm may NOT see the treasury', throws('reserves_bn is 42', 'firm'));
    ok('a firm may NOT see the score', throws('the score is 74', 'firm'));
    ok('a firm may NOT read the citizen feed', throws('civic_unrest is 80', 'firm'));
    ok('an unknown scope falls back to the strictest',
       throws('the corporate tax rate is 0.38', 'nonsense'));
    ok('the default scope is still the citizen',
       throws('the corporate tax rate is 0.38'));
  })();

  /* The exogenous merge. Two populations both write `capacity`, and
     Object.assign silently kept only the last one. */
  (function () {
    const { mergeExogenous } = require('../harness/loop.js');
    const merged = mergeExogenous(
      { capacity: { healthcare: 0.9 }, cohesion_bonus: 2 },
      { capacity: { healthcare: 0.9, food_agri: 1.2 }, cohesion_bonus: 3 },
      { civic_unrest: 50 });

    ok('capacity multipliers compose rather than overwrite',
       near(merged.capacity.healthcare, 0.81, 1e-9),
       'got ' + merged.capacity.healthcare + ', Object.assign would give 0.9');
    ok('a sector only one source mentions survives',
       merged.capacity.food_agri === 1.2);
    ok('bonuses add', merged.cohesion_bonus === 5, String(merged.cohesion_bonus));
    ok('scalars still take the last word', merged.civic_unrest === 50);

    const firms = mergeExogenous(
      { firms: { manufacturing: { automation: 0.4 } } },
      { firms: { finance: { automation: 0.8 } } });
    ok('firm decisions merge by sector',
       firms.firms.manufacturing.automation === 0.4 && firms.firms.finance.automation === 0.8,
       JSON.stringify(firms.firms));
  })();

  /* ---- 13. STAGE 4: MISSIONS AND KPI-BASED QUALITY ------------------ */
  const MIS = require('./sector_missions.js');

  (function () {
    /* The scorecard is AUTHORED, not chosen by the agent. An industry
       that sets its own targets can declare success on transactions
       processed while the country starves. */
    const problems = MIS.validate(E.ORDER);
    ok('every sector has a valid mission', problems.length === 0, problems.join('; '));

    E.ORDER.forEach(k => {
      const m = MIS.MISSIONS[k];
      const sum = Object.keys(m.kpi).reduce((a, d) => a + m.kpi[d], 0);
      ok('KPI weights sum to 1: ' + k, near(sum, 1, 1e-9), String(sum));
      ok('mission reads as an obligation: ' + k,
         m.mission.length > 30 && /\.$/.test(m.mission), m.mission);
    });

    /* Different industries must be judged on DIFFERENT things, or this
       is the old one-size formula with extra steps. */
    const topOf = k => Object.keys(MIS.MISSIONS[k].kpi)
      .sort((a, b) => MIS.MISSIONS[k].kpi[b] - MIS.MISSIONS[k].kpi[a])[0];
    const tops = {};
    E.ORDER.forEach(k => { tops[topOf(k)] = true; });
    ok('sectors lead on different dimensions', Object.keys(tops).length >= 3,
       'all lead on: ' + Object.keys(tops).join(', '));

    ok('care services is judged first on humanity', topOf('care_services') === 'humanity');
    ok('the grid is judged first on reliability', topOf('energy_utilities') === 'reliability');
    /* Finance scored on whether capital REACHES the economy, not on
       margin. A banking sector can be hugely profitable while starving
       everything it is meant to fund. */
    ok('finance is not judged on margin', !MIS.MISSIONS.finance.kpi.margin);
    ok('no mission weights a dimension the engine cannot measure',
       E.ORDER.every(k => Object.keys(MIS.MISSIONS[k].kpi)
         .every(d => !!MIS.DIMENSIONS[d])));

    /* The weakest part of a mission is reportable, so a team is told
       WHICH promise the industry is failing rather than one number. */
    const w = MIS.weakest({ access: { points: -8 }, delivery: { points: 2 } });
    ok('the weakest dimension is identifiable', w && w.dimension === 'access', JSON.stringify(w));
  })();

  /* Behaviour-neutral at weight 0, and genuinely different at weight 1. */
  (function () {
    ok('mission scoring is live', E.PARAMS.MISSION_WEIGHT > 0,
       String(E.PARAMS.MISSION_WEIGHT));

    /* Save and RESTORE rather than assuming a value. An earlier version
       of this block restored the weight to a hardcoded 0, which was
       correct until stage 5 raised it and then silently disabled mission
       scoring for every test that ran afterwards. */
    const savedMission = E.PARAMS.MISSION_WEIGHT;
    E.PARAMS.MISSION_WEIGHT = 0;
    const baseTraj = E.runTrajectory(base, lev, { 5: ['pandemic'] }, 12);
    const legacy = baseTraj[baseTraj.length - 1];

    E.PARAMS.MISSION_WEIGHT = 1;
    const missionTraj = E.runTrajectory(base, lev, { 5: ['pandemic'] }, 12);
    const scored = missionTraj[missionTraj.length - 1];

    const moved = E.ORDER.filter(k => scored.sectors[k].quality !== legacy.sectors[k].quality);
    ok('turning missions on changes what sectors score', moved.length >= 6,
       moved.length + ' of ' + E.ORDER.length + ' sectors moved');

    /* It must be a RE-WEIGHTING, not a rescaling: no sector should swing
       so far that the scorecard is really a different scale. */
    const swings = E.ORDER.map(k => Math.abs(scored.sectors[k].quality - legacy.sectors[k].quality));
    ok('no sector swings absurdly', Math.max.apply(null, swings) <= 20,
       'largest swing ' + Math.max.apply(null, swings));

    /* And turning it back off must restore exactly. */
    E.PARAMS.MISSION_WEIGHT = 0;
    const again = E.runTrajectory(base, lev, { 5: ['pandemic'] }, 12);
    ok('weight 0 restores the legacy target exactly',
       JSON.stringify(again.map(s => E.ORDER.map(k => s.sectors[k].quality))) ===
       JSON.stringify(baseTraj.map(s => E.ORDER.map(k => s.sectors[k].quality))));
    E.PARAMS.MISSION_WEIGHT = savedMission;
  })();

  /* The shared table: one scorecard, read by both engines. */
  (function () {
    const shared = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'sector_missions.json'), 'utf8'));
    ok('the exported table covers every sector',
       E.ORDER.every(k => !!shared.missions[k]),
       E.ORDER.filter(k => !shared.missions[k]).join(', '));
    ok('the exported weights match the source',
       E.ORDER.every(k => JSON.stringify(shared.missions[k].kpi) ===
                          JSON.stringify(MIS.MISSIONS[k].kpi)),
       'the JSON has drifted from sector_missions.js - re-export it');
    ok('the exported scales match the source',
       Object.keys(MIS.DIMENSIONS).every(d => shared.dimensions[d] === MIS.DIMENSIONS[d].scale));
  })();

  ok('the engine exposes missions for agents and reports',
     !!E.MISSIONS && Object.keys(E.MISSIONS).length === E.ORDER.length);

  /* ---- 14. STAGE 5: NON-LINEAR GROWTH AND DIFFUSION ------------------
     These are LIVE, not behind a zero weight — stage 5 is where the
     dials from stages 3 and 4 were raised. So these guard real
     behaviour, and a regression here changes every run. */
  (function () {
    const P = E.PARAMS;
    const set = w => Object.keys(w).forEach(k => { P[k] = w[k]; });
    const saved = {};
    ['J_CURVE_WEIGHT', 'LEARNING_WEIGHT', 'DIFFUSION_WEIGHT',
     'SECTOR_CAPITAL_WEIGHT', 'MISSION_WEIGHT'].forEach(k => { saved[k] = P[k]; });

    ok('every growth mechanism is switched on',
       Object.keys(saved).every(k => saved[k] === 1), JSON.stringify(saved));

    const auto = target => {
      const l = leversFor(base);
      E.ORDER.forEach(k => { l.automation_target[k] = target; });
      return l;
    };

    /* --- BASS DIFFUSION: an S-curve, not a ramp --------------------- */
    const bassRate = F => (P.BASS_P + P.BASS_Q * F) * (1 - F) * P.BASS_SCALE;
    ok('adoption is slow when few have adopted', bassRate(0.1) < bassRate(0.5),
       bassRate(0.1).toFixed(3) + ' vs ' + bassRate(0.5).toFixed(3));
    ok('and saturates when most have', bassRate(0.9) < bassRate(0.5),
       bassRate(0.9).toFixed(3) + ' vs ' + bassRate(0.5).toFixed(3));
    ok('the peak is mid-adoption',
       bassRate(0.45) > bassRate(0.05) && bassRate(0.45) > bassRate(0.95));

    /* Calibrated so the FASTEST the curve ever goes matches the constant
       step it replaced: diffusion changes the shape, not the ceiling. */
    let peak = 0;
    for (let F = 0; F <= 1; F += 0.005) peak = Math.max(peak, bassRate(F));
    ok('the peak rate matches the old constant step',
       near(peak, P.AUTOMATION_STEP_UP, 0.01),
       peak.toFixed(4) + ' vs ' + P.AUTOMATION_STEP_UP);

    const hi = auto(0.92);
    const curved = E.runTrajectory(base, hi, {}, 12);
    set({ DIFFUSION_WEIGHT: 0 });
    const ramped = E.runTrajectory(base, hi, {}, 12);
    set({ DIFFUSION_WEIGHT: 1 });
    const reach = t => t.findIndex(s => s.sectors.manufacturing.automation >= 0.91);
    ok('the S-curve takes longer to reach the ceiling than the ramp',
       reach(curved) > reach(ramped),
       'curve round ' + reach(curved) + ' vs ramp round ' + reach(ramped));

    /* --- THE J-CURVE: dips, then exceeds ----------------------------
       Isolated with diffusion off, because the S-curve already prevents
       the rush the J-curve punishes. Testing the J through the diffusion
       cap would measure the cap. */
    set({ DIFFUSION_WEIGHT: 0 });
    const withJ = E.runTrajectory(base, hi, {}, 12);
    set({ J_CURVE_WEIGHT: 0 });
    const noJ = E.runTrajectory(base, hi, {}, 12);
    set({ J_CURVE_WEIGHT: 1, DIFFUSION_WEIGHT: 1 });

    const gdpAt = (t, i) => t[i].fiscal.gdp_bn;
    ok('automation costs output before it pays', gdpAt(withJ, 1) < gdpAt(noJ, 1),
       gdpAt(withJ, 1).toFixed(1) + ' vs ' + gdpAt(noJ, 1).toFixed(1));
    ok('and pays more than the naive gain once absorbed',
       gdpAt(withJ, 11) > gdpAt(noJ, 11),
       gdpAt(withJ, 11).toFixed(1) + ' vs ' + gdpAt(noJ, 11).toFixed(1));

    ok('experience lags automation while it is climbing',
       withJ[2]._autoExperience.manufacturing < withJ[2].sectors.manufacturing.automation);
    ok('and catches up once it stops climbing',
       near(withJ[11]._autoExperience.manufacturing,
            withJ[11].sectors.manufacturing.automation, 0.02),
       withJ[11]._autoExperience.manufacturing + ' vs ' +
       withJ[11].sectors.manufacturing.automation);

    /* --- THE LEARNING CURVE ----------------------------------------- */
    const learned = E.runTrajectory(base, hi, {}, 12);
    ok('cumulative compute accumulates',
       learned[11]._computeCumulative > learned[1]._computeCumulative,
       learned[1]._computeCumulative + ' -> ' + learned[11]._computeCumulative);
    const factor = c => Math.max(P.LEARNING_FLOOR, Math.pow(c, -P.LEARNING_EXPONENT));
    ok('unit compute cost falls as experience accumulates',
       factor(learned[11]._computeCumulative) < factor(learned[1]._computeCumulative),
       factor(learned[11]._computeCumulative).toFixed(3) + ' vs ' +
       factor(learned[1]._computeCumulative).toFixed(3));
    ok('but experience never makes compute free',
       factor(1e9) >= P.LEARNING_FLOOR, String(factor(1e9)));

    /* --- growth is no longer linear in automation -------------------- */
    const capOf = target => {
      const t = E.runTrajectory(base, auto(target), {}, 12);
      return t[t.length - 1].sectors.manufacturing.capacity;
    };
    const low = capOf(0.60), mid = capOf(0.75), high = capOf(0.90);
    ok('capacity is not linear in automation',
       Math.abs((high - mid) - (mid - low)) > 0.02,
       'steps ' + (mid - low).toFixed(3) + ' then ' + (high - mid).toFixed(3));

    /* --- per-sector capital now BITES -------------------------------- */
    const t2 = E.runTrajectory(base, leversFor(base), {}, 12);
    const sc = t2[t2.length - 1]._sectorCapital;
    const spread = Math.max.apply(null, E.ORDER.map(k => sc[k])) -
                   Math.min.apply(null, E.ORDER.map(k => sc[k]));
    ok('sectors still diverge on capital', spread > 0.01, String(spread));

    Object.keys(saved).forEach(k => { P[k] = saved[k]; });
  })();

  /* The reference governments must keep their own constitutions under
     the new mechanics, and the teaching order must survive. */
  await (function () {
    const H = require('./harness.js');
    const R = require('./harnesses/reference.js');
    return Promise.all(Object.keys(R.harnesses).map(name =>
      H.runHarness(R.harnesses[name], {
        base: base, rounds: 12, constitution: R.CONSTITUTIONS[name] || null
      }).then(run => ({ name: name, run: run }))
    )).then(rs => {
      const by = {};
      rs.forEach(x => { by[x.name] = x.run; });
      rs.forEach(x => {
        ok('still keeps its own constitution under the new growth: ' + x.name,
           !x.run.doctrine || x.run.doctrine.compliance === 1,
           String(x.run.doctrine && x.run.doctrine.compliance));
      });
      ok('accelerate is still the low bar',
         by.accelerate.score.total < by.guardian.score.total - 20 &&
         by.accelerate.score.total < by.steward.score.total - 20,
         'accel ' + by.accelerate.score.total + ', guardian ' + by.guardian.score.total +
         ', steward ' + by.steward.score.total);
      ok('and still breaches its gates', by.accelerate.score.gates_failed.length > 0);
      /* Steward reads the grid and acts on it; guardian does not. Under
         scarcity plus diffusion that should still be worth something. */
      ok('the government that watches the grid still comes out ahead',
         by.steward.score.total >= by.guardian.score.total,
         'steward ' + by.steward.score.total + ' vs guardian ' + by.guardian.score.total);
    });
  })();

  /* ---- 15. STAGE 6: INDUSTRY AGENTS --------------------------------- */
  const FA = require('./firm_action_space.js');
  const IND = require('./industry_round.js');

  (function () {
    ok('the firm table has actions', FA.KEYS.length >= 6, String(FA.KEYS.length));
    FA.KEYS.forEach(k => {
      const a = FA.ACTIONS[k];
      ok('firm action has an option: ' + k,
         typeof a.option === 'string' && a.option.length > 10);
      ok('firm action has an intent: ' + k,
         typeof a.intent === 'string' && a.intent.length > 10);
    });

    /* Lobbying must NOT move the ceiling. Whether the limit changes is
       the government's decision; modelling it as automatically effective
       would hand industry a lever over policy that nothing justifies. */
    ok('lobbying does not raise the ceiling',
       !FA.ACTIONS.lobby.consequence.automation,
       JSON.stringify(FA.ACTIONS.lobby.consequence));

    /* Margin predicates are relative to what the industry NORMALLY runs
       at. Care services are calibrated to -0.09; an absolute test made
       the two most human-intensive industries incapable of anything but
       cutting. */
    const poorAbsolute = { margin: -0.06, baselineMargin: -0.09 };
    ok('a by-design loss-maker doing well may still invest',
       FA.admissible('invest_automation', poorAbsolute).key === 'invest_automation',
       JSON.stringify(FA.admissible('invest_automation', poorAbsolute)));
    const trulyPoor = { margin: -0.20, baselineMargin: -0.09 };
    ok('and one genuinely failing cannot',
       FA.admissible('invest_automation', trulyPoor).key === 'cut_costs');
    ok('a firm at the ceiling cannot invest further',
       FA.admissible('invest_automation',
         { margin: 0.2, baselineMargin: 0.1, atCeiling: true }).key === 'hold');

    /* EVERY decision must state a level, including the ones that change
       nothing. Silence reads as "no firm here" and the engine climbs to
       the ceiling anyway — which made the ceiling unfalsifiable, because
       declining to invest was indistinguishable from not being asked. */
    const held = FA.consequences([
      { sector: 'finance', key: 'hold', automation: 0.55, ceiling: 0.90 }]);
    ok('holding still states a level', held.firms.finance != null,
       JSON.stringify(held.firms));
    ok('and the level it states is where it already was',
       near(held.firms.finance.automation, 0.55, 1e-9),
       String(held.firms.finance.automation));

    const invested = FA.consequences([
      { sector: 'finance', key: 'invest_automation', automation: 0.55, ceiling: 0.90 }]);
    ok('investing raises the stated level',
       invested.firms.finance.automation > 0.55);
    const capped = FA.consequences([
      { sector: 'finance', key: 'invest_automation', automation: 0.88, ceiling: 0.90 }]);
    ok('and never above the ceiling',
       capped.firms.finance.automation <= 0.90 + 1e-9,
       String(capped.firms.finance.automation));
  })();

  /* An industry round: decisions, blindness, and the exogenous it emits. */
  await (function () {
    const hi = leversFor(base);
    E.ORDER.forEach(k => { hi.automation_target[k] = 0.90; });
    const prev = E.seed(base);
    prev.levers = hi;
    const next = E.step(prev, hi, [], { civic_unrest: 0 });

    return IND.industryRound(prev, next, { levers: hi }).then(r => {
      ok('every industry decides', r.decisions.length === E.ORDER.length,
         r.decisions.length + ' of ' + E.ORDER.length);
      ok('each decision names a real action',
         r.decisions.every(d => !!FA.ACTIONS[d.key]));
      ok('each industry carries its mission',
         r.decisions.every(d => typeof d.mission === 'string' && d.mission.length > 20));
      ok('the round emits firm decisions for the engine',
         Object.keys(r.exogenous.firms).length === E.ORDER.length,
         Object.keys(r.exogenous.firms).length + ' of ' + E.ORDER.length);

      /* A firm sees its own accounts and the prices it pays; it does not
         see the treasury, the score, or the citizen feed. */
      const obs = IND.observationFor('finance', prev, next,
        { ceiling: 0.9, baselineMargin: 0.24, energyPrice: 1.1 });
      ok('a firm observation passes the firm guard',
         L.assertBlind(JSON.stringify(obs), 'firm'));
      ok('a firm observation carries its mission', !!obs.mission);
      ok('and what it is judged on', (obs.what_we_are_judged_on || []).length > 0);
      ok('and how much room the regulator left it',
         typeof obs.room_to_automate === 'number');

      let blocked = false;
      try { L.assertBlind(JSON.stringify({ note: 'reserves_bn is 42' }), 'firm'); }
      catch (e) { blocked = true; }
      ok('a firm may still not see the treasury', blocked);
    });
  })();

  /* THE POINT OF THE WHOLE STAGE.
     A government that permits automation and taxes it hard should get a
     DIFFERENT economy when firms may decline than when they must obey.
     If these two match, the ceiling is decorative. */
  await (function () {
    const lv = (levy, tax) => {
      const l = leversFor(base);
      E.ORDER.forEach(k => { l.automation_target[k] = 0.90; });
      l.compute_levy = levy;
      l.corporate_tax_rate = tax;
      return l;
    };
    const go = (l, firms) => runSociety({
      base: base, cabinet: steady(l), initialLevers: l, rounds: 12,
      shocks: {}, decideFirms: firms
    });
    const punitive = lv(0.28, 0.42);

    return Promise.all([go(punitive, null), go(punitive, IND.deterministic())])
      .then(([obey, choose]) => {
        const autoOf = run => {
          const last = run.trajectory[run.trajectory.length - 1];
          return E.ORDER.reduce((a, k) => a + last.sectors[k].automation, 0) / E.ORDER.length;
        };
        const empOf = run =>
          run.trajectory[run.trajectory.length - 1].indicators.employment_rate;

        ok('taxing automation changes what firms DO, not only how fast',
           autoOf(choose) < autoOf(obey) - 0.05,
           'obey ' + autoOf(obey).toFixed(2) + ' vs choose ' + autoOf(choose).toFixed(2));
        ok('and that shows up in employment',
           empOf(choose) > empOf(obey),
           (empOf(obey) * 100).toFixed(0) + '% vs ' + (empOf(choose) * 100).toFixed(0) + '%');
        ok('a run records who decided for the industries',
           choose.firmsDecidedBy === 'deterministic', String(choose.firmsDecidedBy));
        ok('and reports nothing when they were never asked',
           obey.industry === null && obey.firmsDecidedBy === null);
      });
  })();

  /* Two populations now write capacity in the same round. */
  await (function () {
    const l = leversFor(base);
    return runSociety({
      base: base, cabinet: steady(l), initialLevers: l, rounds: 6,
      shocks: {}, decideFirms: IND.deterministic()
    }).then(run => {
      ok('both populations are logged', run.society.length > 0 && run.industry.length > 0);
      const withBoth = run.trace.filter(t => t.exogenous && t.exogenous.capacity);
      ok('the merged exogenous reaches the trace', withBoth.length > 0);
      ok('the run still replays', !!require('../harness/loop.js')
         .replaySociety(base, run.trace, {}).length);
    });
  })();

  /* ---- report ------------------------------------------------------ */

  if (failures.length) {
    console.log('\nFAILED (' + failures.length + '):');
    failures.slice(0, 25).forEach(f => console.log('  - ' + f));
    if (failures.length > 25) console.log('  ... and ' + (failures.length - 25) + ' more');
    process.exitCode = 1;
  } else {
    console.log(passed + ' passed');
  }
})();
