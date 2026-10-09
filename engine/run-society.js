/* =====================================================================
   A PROPER RUN — society deciding, and the country changing because of it
   ---------------------------------------------------------------------
     node engine/run-society.js                    deterministic agents
     node engine/run-society.js --concordia        the sidecar decides
     node engine/run-society.js --compare          both, side by side
     node engine/run-society.js --rounds 12 --shock 5:pandemic

   WHAT --compare IS FOR
   ---------------------
   It runs the SAME government, from the same base, with the same
   shocks, twice: once with society's decisions wired into the engine
   and once with them disconnected, so the only difference between the
   two trajectories is whether what people did mattered.

   If those two runs come out identical, this entire rebuild bought
   nothing and the honest thing is to see that on screen rather than
   assert the opposite in a README. That is why the comparison is a
   first-class mode and not a test buried in a file nobody opens.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const E = require('./meridian-engine.js');
const S = require('./society_round.js');
const D = require('./decide.js');
const LR = require('./longrun.js');
const K = require('./contribution.js');
const IND = require('./industry_round.js');
const FA = require('./firm_action_space.js');
const { runSociety } = require('../harness/loop.js');

const NEWLINE = String.fromCharCode(10);
const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = f => argv.indexOf(f) >= 0;
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const ROUNDS = parseInt(val('--rounds', '12'), 10);
const OPEN = has('--open');                       // run until it stops
const CREDIT = parseFloat(val('--credit', '0')) || 0;
const FIRMS = has('--firms');       // industries decide for themselves
const BASE = val('--base', 'baseline_2050');
/* Which state's LEVERS to govern with, when that differs from the state
   you start in. `--base resilient_2074` begins in 2074 at round 12 and
   has four rounds left to run; `--levers resilient_2074` starts in 2050
   and governs the whole way with that settlement, which is what you
   want to ask whether a strategy holds up over a lifetime. */
const LEVERS_FROM = val('--levers', null);
const WEEK = parseInt(val('--week', '0'), 10) || 0;   // the signature lever

/* Shocks as `--shock 5:pandemic --shock 8:energy_crisis`. */
const SHOCKS = {};
argv.forEach((a, i) => {
  if (a !== '--shock') return;
  const [r, k] = String(argv[i + 1] || '').split(':');
  if (r && k) (SHOCKS[+r] = SHOCKS[+r] || []).push(k);
});

/* ---------------------------------------------------------------------
   A CABINET THAT IS NOT THE POINT
   ---------------------------------------------------------------------
   This script is about SOCIETY, so the government is deliberately a
   fixed, unremarkable one: it holds the levers it inherited. A cabinet
   that reacted cleverly would make it impossible to tell whether a
   change in the trajectory came from citizens or from the government
   responding to citizens, and that is exactly the confound this run
   exists to avoid.
   --------------------------------------------------------------------- */
function steadyCabinet(initial) {
  const levers = JSON.parse(JSON.stringify(initial));
  const fn = async () => ({ levers: levers, rationale: 'holds a steady course' });
  fn.faults = [];
  return fn;
}

function leversFor(base) {
  const lev = JSON.parse(JSON.stringify(base.levers || E.DEFAULT_LEVERS));
  lev.automation_target = {};
  E.ORDER.forEach(k => { lev.automation_target[k] = base.sectors[k].automation; });
  if (lev.care_guarantee_wage == null) lev.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
  return lev;
}

/* ---------------------------------------------------------------------
   THE CREDIT SWEEP
   ---------------------------------------------------------------------
   Runs the same government at several generosities and prints what each
   bought. The peak is the finding, and a single run cannot show a peak.
   --------------------------------------------------------------------- */
async function creditSweep(base, levers) {
  const opt = K.optimum();
  console.log('contribution credit: peak at ' + Math.round(opt.rate * 100) +
    '%, harm above ' + Math.round(K.breakEven() * 100) + '%' + NEWLINE);
  console.log('rate   prosocial   cohesion   reserves   what the curve says');
  console.log('-----  ---------   --------   --------   -------------------');

  for (const rate of [0, 0.1, 0.28, 0.5, 0.75, 1.0]) {
    const run = await runSociety({
      base: base, cabinet: steadyCabinet(levers), initialLevers: levers,
      rounds: 12, shocks: SHOCKS, decide: D.deterministic(),
      credit: rate > 0 ? { rate: rate } : null
    });
    const pro = run.society.reduce((a, s) => a + s.shares
      .filter(x => x.key === 'flourish' || x.key === 'mutual_aid')
      .reduce((b, x) => b + x.share, 0), 0) / Math.max(1, run.society.length);
    const last = run.trajectory[run.trajectory.length - 1];
    const c = K.crowding(rate);
    console.log(
      String(rate).padEnd(7) +
      (Math.round(pro) + '%').padStart(8) +
      String(Math.round(last.indicators.cohesion)).padStart(11) +
      String(Math.round(last.fiscal.reserves_bn)).padStart(11) +
      '   ' + (c > 0.02 ? 'recruiting' : c < -0.02 ? 'crowding out' : 'neutral'));
  }
  console.log(NEWLINE + 'Maximising the lever buys less than finding the peak,');
  console.log('and costs more. That is the exercise.');
}

async function main() {
  const world = JSON.parse(fs.readFileSync(path.join(root, 'world-states.json'), 'utf8'));
  const base = world.states[BASE];
  if (!base) {
    console.error('no such state: ' + BASE + '\navailable: ' + Object.keys(world.states).join(', '));
    process.exit(1);
  }
  let levers = leversFor(base);
  if (LEVERS_FROM) {
    const src = world.states[LEVERS_FROM];
    if (!src) {
      console.error('no such state for --levers: ' + LEVERS_FROM);
      process.exit(1);
    }
    levers = leversFor(src);
    console.log('governing from ' + BASE + ' with the ' + LEVERS_FROM + ' settlement' + NEWLINE);
  }
  if (WEEK) {
    levers.working_week_days = WEEK;
    console.log('working week: ' + WEEK + ' days' + NEWLINE);
  }

  /* ---- which agents ------------------------------------------------ */
  let decide = D.deterministic();
  if (has('--concordia')) {
    const url = val('--url', 'http://127.0.0.1:8765');
    const remote = D.remote({ url: url, onFault: f => console.error('  ! ' + f) });
    const h = await remote.health();
    console.log('Concordia sidecar at ' + url);
    if (!h.ok || !h.can_decide) {
      console.log('  NOT USABLE: ' + (h.detail || JSON.stringify(h)));
      console.log('  start it with:  python society/server.py');
      console.log('  continuing with the deterministic baseline.\n');
    } else {
      console.log('  ready — ' + h.model + ', concordia installed\n');
      await remote.reset(1);
      decide = remote;
    }
  }

  if (has('--credit-sweep')) { await creditSweep(base, levers); return; }

  /* ---- the run ----------------------------------------------------- */
  if (CREDIT > 0) console.log('credit: ' + K.describe({ rate: CREDIT }) + NEWLINE);

  /* ---- and who decides for the industries -------------------------- */
  let decideFirms = null;
  if (FIRMS) {
    decideFirms = IND.deterministic();
    if (has('--concordia')) {
      const url = val('--url', 'http://127.0.0.1:8765');
      const remote = D.remote({
        url: url, actions: FA.ACTIONS, menu: FA.menu, scope: 'firm',
        fallback: IND.deterministic(),
        fallbackFor: b => IND.deterministicChoose(b.id, b.sector, b.ctx),
        onFault: f => console.error('  ! ' + String(f).slice(0, 160))
      });
      const h = await remote.health();
      if (h.ok && h.can_decide) { await remote.reset(2); decideFirms = remote; }
      else console.log('  industries fall back to arithmetic: ' +
        (h.detail || 'sidecar not ready') + NEWLINE);
    }
    console.log('industries decide for themselves; the lever is a CEILING' + NEWLINE);
  }

  const run = await runSociety({
    base: base, cabinet: steadyCabinet(levers), initialLevers: levers,
    rounds: ROUNDS, shocks: SHOCKS, decide: decide,
    until: OPEN ? 'collapse' : undefined,
    credit: CREDIT > 0 ? { rate: CREDIT } : null,
    decideFirms: decideFirms
  });

  console.log('DECIDED BY: ' + run.decidedBy);
  console.log('year   unrest (mood)  what the country is doing');
  console.log('-----  -------------  ---------------------------------------------');
  run.society.forEach(s => {
    const top = s.shares.slice(0, 3).map(x => x.label + ' ' + x.share + '%').join(', ');
    console.log(String(s.year).padEnd(6) +
      (s.unrest + ' (' + s.sentiment_unrest + ')').padEnd(15) + top);
  });

  /* An open-ended run is reported by decade and by survival, because a
     single total is not comparable across lengths. */
  if (OPEN && run.longrun) {
    const L = run.longrun;
    console.log(NEWLINE + 'ended: ' + run.ended.why);
    console.log('survived ' + L.survived_years + ' years (' +
      L.from_year + '-' + L.to_year + ') | trend: ' + L.trend.verdict);
    console.log(NEWLINE + 'decade         pp    low  worst  cohesion  legit');
    console.log('-------------  ----  ----  -----  --------  -----');
    L.decades.forEach(d => console.log(
      (d.from_year + '-' + d.to_year).padEnd(14) +
      String(d.purchasing_power).padStart(5) +
      String(d.purchasing_power_low).padStart(6) +
      String(d.worst_service).padStart(7) +
      String(d.cohesion).padStart(10) +
      String(d.legitimacy).padStart(7) +
      (d.complete ? '' : '  (partial)')));
    if (L.collapse.collapsed) {
      console.log(NEWLINE + 'collapse: ' + L.collapse.detail +
        ' - began ' + L.collapse.began_year);
    }
    console.log(NEWLINE + L.score_note);
  }

  /* What the industries did, when they were asked. */
  if (FIRMS && run.industry && run.industry.length) {
    console.log(NEWLINE + 'INDUSTRY DECIDED BY: ' + run.firmsDecidedBy);
    console.log('year   what the thirteen industries are doing');
    console.log('-----  ---------------------------------------------------');
    run.industry.forEach(x => console.log(
      String(x.year).padEnd(7) +
      x.shares.slice(0, 3).map(s => s.label + ' ' + s.count).join(', ')));

    /* Where the ceiling actually bound. A team that set 95% and sees
       firms stop short is reading a finding, not a bug. */
    const last = run.industry[run.industry.length - 1];
    const short = last.decisions.filter(d => d.ceiling - d.automation > 0.08);
    if (short.length) {
      console.log(NEWLINE + 'industries sitting well below the ceiling they were allowed:');
      short.slice(0, 5).forEach(d => console.log('  ' + d.name.padEnd(24) +
        Math.round(d.automation * 100) + '% of a permitted ' +
        Math.round(d.ceiling * 100) + '%'));
      console.log('  (the government may not compel investment; it can only permit it)');
    }
  }

  /* Scarcity, when it did anything worth reporting. */
  const endState = run.trajectory[run.trajectory.length - 1];
  if (endState._computeTightness != null && endState._computeTightness > 1.0) {
    console.log(NEWLINE + 'energy: demand at ' +
      Math.round(endState._computeTightness * 100) + '% of capacity, price index ' +
      (Math.round(endState._computePrice * 100) / 100));
  }

  /* Who the credit scheme left out. */
  if (CREDIT > 0 && run.society.length) {
    const lastRound = run.society[run.society.length - 1];
    if (lastRound.credit) {
      console.log(NEWLINE + 'credit: ' + lastRound.credit.participation + '% earning, ' +
        lastRound.credit.excluded_share + '% locked out' +
        (lastRound.credit.locked_out && lastRound.credit.locked_out.length
          ? ' (' + lastRound.credit.locked_out.slice(0, 3).join(', ') + ')' : ''));
    }
  }


  const last = run.trajectory[run.trajectory.length - 1];
  console.log('\nfinal: score ' + Math.round(run.score.total) +
    ' | purchasing power ' + Math.round(last.indicators.effective_ubi_index) +
    ' | worst essential ' +
    Math.round(Math.min.apply(null, E.ESSENTIAL.map(k => last.sectors[k].quality))));
  if (run.faults.length) {
    console.log('faults: ' + run.faults.length + ' (first: ' +
      JSON.stringify(run.faults[0]).slice(0, 120) + ')');
  }

  /* ---- the control -------------------------------------------------
     The same trace, replayed with the action-derived exogenous stripped
     out. Everything else — levers, shocks, unrest-from-mood — is
     identical, so any difference between the two trajectories is
     attributable to what people did and to nothing else. */
  if (has('--compare')) {
    const { replaySociety } = require('../harness/loop.js');
    const stripped = JSON.parse(JSON.stringify(run.trace));
    stripped.forEach(t => {
      if (!t.exogenous) return;
      ['capacity', 'headcount', 'cohesion_bonus', 'legitimacy_bonus', 'reserves_bn']
        .forEach(k => delete t.exogenous[k]);
    });
    const ctrl = replaySociety(base, stripped, SHOCKS);
    const cLast = ctrl[ctrl.length - 1];

    /* WHERE they diverge matters more than where they end up. A country
       that has hit the floor is at the floor either way, and reporting
       only the final year would say "society changed nothing" about a
       run in which society changed a great deal on the way down. */
    let firstDiv = null, maxDiv = 0, maxAt = null;
    for (let i = 0; i < Math.min(run.trajectory.length, ctrl.length); i++) {
      const dd = Math.abs(run.trajectory[i].indicators.effective_ubi_index -
                          ctrl[i].indicators.effective_ubi_index);
      if (dd > 1e-9 && firstDiv === null) firstDiv = run.trajectory[i].meta.year;
      if (dd > maxDiv) { maxDiv = dd; maxAt = run.trajectory[i].meta.year; }
    }

    const worst = t => Math.round(Math.min.apply(null, E.ESSENTIAL.map(k => t.sectors[k].quality)));
    console.log('\nCONTROL — the same government and the same trace, with');
    console.log('society\'s decisions stripped out of the engine\'s inputs.');
    console.log('  purchasing power ' + Math.round(cLast.indicators.effective_ubi_index) +
      '   (vs ' + Math.round(last.indicators.effective_ubi_index) + ' when society acts)');
    console.log('  worst essential  ' + worst(cLast) + '   (vs ' + worst(last) + ')');
    console.log('  score            ' + Math.round(E.score(ctrl).total) +
      '   (vs ' + Math.round(run.score.total) + ')');

    if (firstDiv === null) {
      console.log('\n  The two runs are IDENTICAL. Society made no difference to this');
      console.log('  government, which is a finding, not a bug — check what people');
      console.log('  actually chose above before concluding the wiring is broken.');
    } else {
      console.log('\n  diverges from ' + firstDiv + ', widest at ' + maxAt +
        ' (' + maxDiv.toFixed(1) + ' points of purchasing power)');
      if (Math.round(E.score(ctrl).total) === Math.round(run.score.total)) {
        console.log('  Both runs finish at the same score because they finish at the');
        console.log('  FLOOR. Society changed the path, not the destination. Compare');
        console.log('  under a government that does not collapse to see it in the total.');
      }
    }
  }

  if (has('--json')) {
    const out = path.join(root, 'dist', 'society-run.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ decidedBy: run.decidedBy,
      society: run.society, score: run.score, faults: run.faults }, null, 2));
    console.log('\nwrote ' + path.relative(root, out));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
