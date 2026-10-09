#!/usr/bin/env node
/* =====================================================================
   RUN AN AGENT SOCIETY FROM THE COMMAND LINE
   ---------------------------------------------------------------------
     node agents/run-agents.js --constitution constitutions/tampines-compact.md
     node agents/run-agents.js --profile dgx --seeds 5 --team alpha --constitution my.md
     node agents/run-agents.js --events events.json --weather
     node agents/run-agents.js --replay runs/alpha-101/decisions.jsonl --seed 101
     node agents/run-agents.js --calibrate
     node agents/run-agents.js --no-model            (physics only, labelled degraded)

   Options
     --team NAME            team name (default meridian)
     --constitution FILE    markdown constitution (policies, rubric, case)
     --levers STATE         starting levers from a world state (default baseline_2050)
     --profile NAME         local | classroom | dgx   (agents/profiles.json)
     --population N  --substeps N  --rounds N  --concurrency N  --seed N
     --years N              run by the month for N years (ticks); omit for two-year rounds
     --every-residents N  --every-firms N   months between decisions (default 3)
     --live                 pace each month to the clock: half an hour a year
     --seeds N              run an ensemble over the first N standard seeds
     --events FILE          organiser event schedule: [{round, event, severity, duration}]
     --weather              seeded unannounced events
     --cabinet              let the model set levers each round from the constitution
     --assessed             refuse an uncalibrated model  (--allow-uncalibrated to override, recorded)
     --replay FILE          answer every agent from a recorded decision log
     --allow-fallback       let a failed reply become a rule-based decision
                            (off by default: a run waits for the model instead)
     --interpretations FILE use a run's own action meanings (runs/<id>/interpretations.json)
     --amendments FILE      make a run's mid-run changes again (runs/<id>/amendments.json)
     --out DIR              where evidence and logs go (default runs/)
     --calibrate            run the behavioural calibration suite and store the result
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../engine/meridian-engine.js');
const { createPool } = require('./llm_pool.js');
const { runAgentSociety } = require('./society.js');
const { runEnsemble, DEFAULT_SEEDS } = require('./ensemble.js');
const D = require('./director.js');
const CAL = require('./calibration.js');
const EV = require('./evidence.js');
const { parseConstitution } = require('../harness/cabinet.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = f => argv.indexOf(f) >= 0;
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

async function main() {
  const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles.json'), 'utf8'));
  const profile = Object.assign({}, profiles[val('--profile', 'local')] || profiles.local);
  const n = (f, d) => { const v = val(f, null); return v == null ? d : Number(v); };
  const cfg = {
    team: val('--team', 'meridian'),
    population: n('--population', profile.population),
    substeps: n('--substeps', profile.substeps),
    rounds: n('--rounds', profile.rounds),
    concurrency: n('--concurrency', profile.concurrency),
    seed: n('--seed', DEFAULT_SEEDS[0]),
    policyReviewEvery: n('--review-every', profile.policyReviewEvery),
    temperature: n('--temperature', profile.temperature)
  };
  /* --years N runs by the month for N years, as the studio does. Without it
     the run is the older two-year rounds. --every-residents / --every-firms
     set how many months pass between decisions; --live paces each month to
     the clock (2.5 minutes, so a year is half an hour). */
  if (has('--years')) {
    cfg.dt = 1 / 12;
    cfg.years = n('--years', 24);
    cfg.substeps = 1;
    cfg.every = Object.assign({ residents: 3, firms: 3, government: 1 }, profile.every || {});
    if (has('--every-residents')) cfg.every.residents = n('--every-residents', 3);
    if (has('--every-firms')) cfg.every.firms = n('--every-firms', 3);
    if (has('--live')) cfg.tickMs = n('--tick-ms', profile.tickMs || 150000);
  }
  const outDir = path.resolve(val('--out', path.join(ROOT, 'runs')));

  if (has('--calibrate')) {
    const pool = createPool({ mode: 'live', concurrency: cfg.concurrency });
    const h = await pool.health();
    if (!h.up) { console.error('model server is not answering: ' + h.error); process.exit(1); }
    console.log('calibrating ' + pool.model + ' …');
    const result = await CAL.runSuite(pool, {});
    result.checks.forEach(c => console.log('  ' + (c.passed ? 'pass' : 'FAIL') + '  ' + c.name.padEnd(12) + c.detail + '   (expected ' + c.expected + ')'));
    console.log(result.passed ? '\nPASSED — stored in agents/calibration.json' : '\nFAILED — this model will be refused for assessed runs');
    process.exit(result.passed ? 0 : 2);
  }

  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'));
  const base = world.states.baseline_2050;
  const leverState = world.states[val('--levers', 'baseline_2050')];
  if (!leverState) { console.error('no such state for --levers'); process.exit(1); }
  const levers = JSON.parse(JSON.stringify(leverState.levers || E.DEFAULT_LEVERS));

  const conFile = val('--constitution', null);
  const constitution = conFile ? parseConstitution(fs.readFileSync(conFile, 'utf8'), path.basename(conFile, '.md')) : null;
  const schedule = has('--events') ? JSON.parse(fs.readFileSync(val('--events'), 'utf8')) : [];
  const makeDirector = seed => D.createDirector({ seed, schedule, weather: { enabled: has('--weather') } });

  let cabinet = null;
  if (has('--cabinet') && constitution && !has('--no-model')) {
    const { makeCabinet } = require('../harness/cabinet.js');
    const { createClient } = require('../harness/llm_client.js');
    cabinet = makeCabinet({ constitution, client: createClient() });
  }

  const makePool = seed => {
    if (has('--no-model')) return null;
    const dir = path.join(outDir, cfg.team + '-' + seed);
    if (has('--replay')) return createPool({ mode: 'replay', logPath: path.resolve(val('--replay')) });
    const p = createPool({ mode: 'record', logPath: path.join(dir, 'decisions.jsonl'), concurrency: cfg.concurrency,
                           insist: !has('--allow-fallback') });
    p.logPath = path.join(dir, 'decisions.jsonl');
    return p;
  };

  const probe = makePool(cfg.seed);
  if (probe && probe.mode !== 'replay') {
    const h = await probe.health();
    probe.close();
    if (!h.up) {
      console.error('model server is not answering (' + h.error + ').\nStart it, or pass --no-model for a physics-only run labelled degraded.');
      process.exit(1);
    }
  }

  const runOpts = Object.assign({}, cfg, {
    base, levers, constitution, cabinet,
    assessed: has('--assessed'), allowUncalibrated: has('--allow-uncalibrated')
  });
  const progress = e => {
    if (e.type === 'start') console.log('team ' + e.team + ' · seed ' + e.seed + ' · ' + e.population + ' personas · ' +
      e.firms + ' firms · ' + e.substeps + ' sub-step(s) · model ' + (e.model || 'none (degraded)'));
    if (e.type === 'round') {
      const i = e.indicators;
      console.log('  ' + e.year + '  trust ' + pad(e.polls && e.polls.trust) + '  employment ' + Math.round(i.employment_rate * 100) +
        '%  buys ' + pad(i.effective_ubi_index) + '  worst service ' + pad(e.worst_essential) +
        '  unrest ' + pad(i.civic_unrest) + '  agents ' + Math.round(e.agent_share * 100) + '%' +
        (e.events.length ? '  [' + e.events.join(', ') + ']' : '') +
        '\n        ' + e.society.actions.map(a => a.kind + ' ' + a.share + '%').join(', ') +
        (e.society.departed ? '  · ' + e.society.departed.toLocaleString() + ' left' : '') +
        (e.society.organisations ? '  · ' + e.society.organisations + ' organisations' : ''));
    }
  };

  fs.mkdirSync(outDir, { recursive: true });
  if (n('--seeds', 1) > 1) {
    const seeds = DEFAULT_SEEDS.slice(0, n('--seeds', 5));
    const result = await runEnsemble(runOpts, { seeds, makePool, makeDirector, onProgress: progress });
    const file = path.join(outDir, cfg.team + '-ensemble.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log('\nensemble over seeds ' + seeds.join(', '));
    Object.keys(result.distributions).forEach(k => {
      const d = result.distributions[k];
      console.log('  ' + k.padEnd(32) + 'median ' + String(d.median).padEnd(10) + 'p10 ' + String(d.p10).padEnd(10) + 'p90 ' + d.p90);
    });
    console.log('\nwritten ' + file);
    return;
  }

  const pool = makePool(cfg.seed);
  /* --interpretations FILE replays a run with exactly the action meanings it
     used (its interpretations.json), whatever the shared cache says now. */
  const known = has('--interpretations') ? JSON.parse(fs.readFileSync(path.resolve(val('--interpretations')), 'utf8')) : undefined;
  /* --amendments FILE makes the same mid-run changes again (runs/<id>/amendments.json). */
  if (has('--amendments')) runOpts.amendments = JSON.parse(fs.readFileSync(path.resolve(val('--amendments')), 'utf8'));
  const run = await runAgentSociety(Object.assign({}, runOpts, { pool, director: makeDirector(cfg.seed), onProgress: progress,
                                                                 interpretations: known }));
  if (pool) pool.close();
  const dir = path.join(outDir, cfg.team + '-' + cfg.seed);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(run.evidence, null, 2));
  fs.writeFileSync(path.join(dir, 'trace.json'), JSON.stringify(run.trace));
  if (run.actions && run.actions.interpretations) {
    fs.writeFileSync(path.join(dir, 'interpretations.json'), JSON.stringify(run.actions.interpretations, null, 1));
  }
  const p = run.evidence.provenance;
  console.log('\ndecided by agents: ' + p.decided_by_agents_pct.overall + '% (citizens ' + p.decided_by_agents_pct.citizens +
    '%, firms ' + p.decided_by_agents_pct.firms + '%)' + (p.degraded ? '  — DEGRADED: ' + p.degraded_reason : ''));
  console.log('calibration: ' + (p.calibration && p.calibration.passed ? 'passed' : 'not passed'));
  const g = run.evidence.government;
  console.log('policies in force: ' + g.enacted.length + ', rejected: ' + g.rejected.length + ', untranslatable: ' + g.untranslatable.length);
  console.log('organisations formed: ' + run.evidence.society.organisations.length + ', firms entered/left: ' + run.evidence.market.events.length);
  console.log('evidence: ' + path.join(dir, 'evidence.json'));
  if (pool && pool.logPath) console.log('decision log (replay with --replay): ' + pool.logPath);
}

const pad = v => String(v == null ? '-' : v).padStart(3);

main().catch(err => { console.error(err && err.stack || err); process.exit(1); });
