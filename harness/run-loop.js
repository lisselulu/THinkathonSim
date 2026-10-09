/* =====================================================================
   WATCH A SOCIETY GOVERN ITSELF
   ---------------------------------------------------------------------
       node harness/run-loop.js                        deterministic
       node harness/run-loop.js --live                 with a real model
       node harness/run-loop.js --shock pandemic:5
       node harness/run-loop.js --constitution constitutions/mine.md
       node harness/run-loop.js --harness guardian     a reference gov't

   Twelve rounds, printed as they happen: what the cabinet changed, what
   the country made of it, and what that cost. Ends with the two things
   that matter — does the trace replay, and what does the auditor say.

   With no flags this needs no model, no key and no network. The citizens
   still read the room; they just do it deterministically and without
   quotes. That run is fully reproducible, and running it twice must give
   you the same country twice.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'engine/meridian-engine.js'));
const REF = require(path.join(ROOT, 'engine/harnesses/reference.js'));
const { makeCabinet, loadConstitution } = require('./cabinet.js');
const { runSociety, replaySociety, tracesAgree } = require('./loop.js');
const AUD = require('./auditor.js');
const { createClient } = require('./llm_client.js');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && args[i + 1][0] !== '-' ? args[i + 1] : true) : def;
};

const LIVE = args.includes('--live');
const CON_PATH = flag('constitution', 'constitutions/tampines-compact.md');
const REF_NAME = flag('harness', null);

/* --shock pandemic:5 --shock energy_price_spike:9 */
const shocks = {};
args.forEach((a, i) => {
  if (a !== '--shock') return;
  const [name, round] = String(args[i + 1] || '').split(':');
  if (!E.SHOCKS[name]) return;
  const r = Number(round) || 5;
  (shocks[r] = shocks[r] || []).push(name);
});

const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'))
  .states.baseline_2050;

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n) => String(Math.round(v)).padStart(n);

/* What actually changed between two lever packages, in words. */
function changed(a, b) {
  const out = [];
  ['corporate_tax_rate', 'compute_levy', 'reskilling_spend_pct', 'public_ownership_pct']
    .forEach(k => {
      if (a[k] !== b[k]) out.push(k.replace(/_/g, ' ') + ' ' + a[k] + '->' + b[k]);
    });
  const aa = a.allocation || {}, ba = b.allocation || {};
  if (Math.abs((aa.ubi || 0) - (ba.ubi || 0)) > 0.005) {
    out.push('allocation ' + Math.round(ba.ubi * 100) + '/' +
      Math.round(ba.infrastructure * 100) + '/' + Math.round(ba.reserves * 100));
  }
  if (a.ubi_design !== b.ubi_design) out.push('design -> ' + b.ubi_design);
  if (a.working_week_days !== b.working_week_days) out.push(b.working_week_days + '-day week');
  if (!!a.care_job_guarantee !== !!b.care_job_guarantee) {
    out.push(b.care_job_guarantee ? 'care guarantee ON' : 'care guarantee OFF');
  }
  const at = a.automation_target || {}, bt = b.automation_target || {};
  const moved = E.ORDER.filter(k => Math.abs((at[k] || 0) - (bt[k] || 0)) > 0.005);
  if (moved.length) out.push('automation: ' + moved.length + ' sector(s)');
  return out.length ? out.join(', ') : 'held everything';
}

(async function () {

let client = null;
if (LIVE) {
  client = createClient();
  const h = await client.health();
  if (!h.up) {
    console.log('\n  ' + client.config.baseUrl + ' is not answering (' + h.error + ').');
    console.log('  Start a model server, or drop --live to run deterministically.\n');
    process.exit(1);
  }
  console.log('\n  model: ' + client.config.model + ' at ' + client.config.baseUrl);
}

let con = loadConstitution(path.join(ROOT, CON_PATH));
const tracePath = path.join(os.tmpdir(), 'meridian-run-' + process.pid + '.jsonl');

/* Either a constitution-bound cabinet, or one of the three reference
   governments, so you can compare a model against a known quantity. */
let cabinet, label;
if (REF_NAME) {
  const entry = REF.entries.find(e => e.name.toLowerCase().startsWith(String(REF_NAME).toLowerCase()));
  if (!entry) {
    console.log('  no such reference harness. try: ' + REF.entries.map(e => e.name).join(', '));
    process.exit(1);
  }
  cabinet = entry.harness;
  con = entry.constitution || con;      // audit it against its OWN document
  label = entry.name + ' (reference)';
} else {
  cabinet = makeCabinet({ constitution: con, client: client, tracePath: tracePath });
  label = con.name + (client ? ' — governed by ' + client.config.model : ' — CARETAKER (no model)');
}

console.log('\n' + '='.repeat(78));
console.log('  ' + label);
console.log('  shocks: ' + (Object.keys(shocks).length
  ? Object.keys(shocks).map(r => shocks[r].join('+') + ' in round ' + r).join(', ')
  : 'fair weather'));
console.log('='.repeat(78) + '\n');

/* The unrest column is what the engine CONSUMED this round — last round's
   reading. The reaction printed under a row is what the country made of
   THIS round, and it is what the next row will be charged for. */
console.log('  yr    pay   buys  worst  cohes  unrest   the country reacts');
console.log('  ' + '-'.repeat(74));

let prevLevers = null;
const run = await runSociety({
  base: BASE, cabinet: cabinet, constitution: con, rounds: 12, shocks: shocks,
  client: client,
  onRound: (round, state, room) => {
    const i = state.indicators;
    const worst = Math.min.apply(null, E.ESSENTIAL.map(k => state.sectors[k].quality));
    const u = i.civic_unrest;
    const bar = u >= 75 ? '#### cooperation gone' : u >= 50 ? '##   costing output' : '';
    console.log('  ' + state.meta.year + ' ' + num(i.ubi_monthly_sgd, 6) +
      num(i.effective_ubi_index, 7) + num(worst, 7) + num(i.cohesion, 7) +
      num(u, 7) + '  ' + bar);
    const d = room.dispatches[0];
    if (d && room.civic_unrest >= 40) {
      console.log('           -> reads ' + room.civic_unrest + ': ' + d.name + ', ' +
        d.role + ' — ' + (d.quote || 'worried about ' + d.concern));
    }
  }
});

/* The decisions, alongside the numbers they produced. */
console.log('\n  THE MINUTES');
run.trace.forEach((t, i) => {
  const what = prevLevers ? changed(prevLevers, t.levers) : 'opening settlement';
  prevLevers = t.levers;
  console.log('  r' + pad(t.round, 3) + pad((t.cites || []).join(',') || '—', 8) + what);
});

/* --- the two questions that matter --------------------------------- */
console.log('\n  ' + '-'.repeat(74));
const replay = replaySociety(BASE, run.trace, shocks);
const agrees = tracesAgree(run.trajectory, replay);
console.log('  REPLAY   ' + (agrees
  ? 'the trace reproduces this run exactly, with no model in the room'
  : 'MISMATCH — something reached the engine without being written down'));

const s = run.score;
console.log('  SCORE    ' + s.total + '/100    gates: ' +
  ((s.gates_failed || []).join(', ') || 'none'));
console.log('           ' + Object.keys(s.components)
  .map(k => k.replace(/_/g, ' ') + ' ' + s.components[k]).join('   '));

if (run.faults.length) {
  console.log('\n  FAULTS   ' + run.faults.length + ' recorded, none fatal:');
  run.faults.slice(0, 8).forEach(f => console.log('    r' + pad(f.round, 4) + f.fault));
  if (run.faults.length > 8) console.log('    … and ' + (run.faults.length - 8) + ' more');
}

if (fs.existsSync(tracePath)) {
  const rows = fs.readFileSync(tracePath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log('\n' + AUD.formatReport(await AUD.audit({
    constitution: con, trace: rows, trajectory: run.trajectory, client: client
  })).split('\n').map(l => '  ' + l).join('\n'));
  console.log('\n  telemetry: ' + tracePath);
}

console.log('');
process.exit(agrees ? 0 : 1);

})().catch(err => { console.error('\n', err); process.exit(1); });
