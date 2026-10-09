/* =====================================================================
   THE TOURNAMENT
   ---------------------------------------------------------------------
   Every harness governs its own copy of the same country, under the same
   shocks. Ranked on the mean across schedules; separated on the worst.

     node engine/run-tournament.js
     node engine/run-tournament.js --runs 5      (for LLM harnesses)
     node engine/run-tournament.js --cross       (also run cross-play)
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const E = require('./meridian-engine.js');
const H = require('./harness.js');
const REF = require('./harnesses/reference.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'));
const BASE = world.states.baseline_2050;

/* The season. Every harness faces all four; a government that only works
   under "Fair weather" has not been tested. */
const SCHEDULES = [
  { name: 'Fair weather', schedule: {} },
  { name: 'Pandemic r5',  schedule: { 5: ['pandemic'] } },
  { name: 'Supply squeeze', schedule: { 4: ['food_import_disruption'], 8: ['chip_export_controls'] } },
  { name: 'Hard season',  schedule: { 3: ['energy_price_spike'], 6: ['pandemic', 'food_import_disruption'],
                                      9: ['cyber_attack'] } }
];

const args = process.argv.slice(2);
const runs = args.includes('--runs') ? +args[args.indexOf('--runs') + 1] || 1 : 1;
const doCross = args.includes('--cross');

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const bar = n => '='.repeat(n);

(async function main() {
  console.log('\n' + bar(78));
  console.log('  MERIDIAN HARNESS TOURNAMENT');
  console.log('  engine v' + E.version + ' · harness v' + H.version +
              ' · ' + runs + ' run' + (runs > 1 ? 's' : '') + ' per schedule');
  console.log(bar(78));

  /* --- 1. verify every harness replays before scoring any of it ------- */
  console.log('\nAUDIT — does each run replay to a bit-identical trajectory?');
  for (const e of REF.entries) {
    const run = await H.runHarness(e.harness, {
      base: BASE, shocks: SCHEDULES[1].schedule, constitution: e.constitution
    });
    const v = H.verifyTrace(run.trace, run.trajectory, {
      base: BASE, shocks: SCHEDULES[1].schedule
    });
    console.log('  ' + pad(e.name, 12) + (v.ok
      ? 'replays exactly over ' + v.rounds + ' rounds'
      : 'FAILED — ' + v.reason));
  }

  /* --- 2. the tournament proper --------------------------------------- */
  const T = await H.tournament(REF.entries, SCHEDULES, { base: BASE, runs: runs });

  console.log('\n' + bar(78));
  console.log('  STANDINGS');
  console.log(bar(78));
  console.log('  ' + pad('harness', 12) + lpad('mean', 6) + lpad('worst', 7) +
              lpad('spread', 8) + '   ' + T.schedules.map(s => lpad(s.slice(0, 13), 14)).join(''));
  console.log('  ' + '-'.repeat(74));
  T.rows.forEach(r => {
    console.log('  ' + pad(r.name, 12) + lpad(r.overall, 6) + lpad(r.worst, 7) +
      lpad(r.spread, 8) + '   ' +
      r.cells.map(c => lpad(c.mean + (c.sd ? '±' + c.sd : '') + (c.gates.length ? '!' : ''), 14)).join(''));
  });
  console.log('\n  ! = a hard gate was breached under that schedule');
  if (runs > 1) console.log('  ± = standard deviation across ' + runs + ' runs of the same harness');

  /* --- 3. did they keep their own word? -------------------------------- */
  console.log('\n' + bar(78));
  console.log('  CONSTITUTIONAL AUDIT — fair weather');
  console.log(bar(78));
  for (const e of REF.entries) {
    const run = await H.runHarness(e.harness, {
      base: BASE, shocks: {}, constitution: e.constitution
    });
    const d = run.doctrine;
    console.log('\n  ' + e.name + ' — "' + e.constitution.name + '"');
    console.log('  ' + d.rules_held + '/' + d.rules_checked + ' commitments held  ' +
      '(score ' + run.score.total + ')');
    d.results.forEach(r => {
      const mark = r.held ? 'kept  ' : 'BROKEN';
      const detail = r.held ? '' :
        '  rounds ' + r.breached_rounds.slice(0, 6).join(',') +
        (r.breached_rounds.length > 6 ? '…' : '');
      console.log('    ' + mark + '  ' + pad(r.id, 20) + detail);
      if (!r.held && r.commitment) console.log('            "' + r.commitment + '"');
    });
    if (run.faults.length) {
      console.log('    faults: ' + run.faults.length);
      run.faults.slice(0, 3).forEach(f => console.log('      r' + f.round + ' ' + f.fault));
    }
  }

  /* --- 4. cross-play --------------------------------------------------- */
  if (doCross) {
    console.log('\n' + bar(78));
    console.log('  CROSS-PLAY — each harness under each constitution (pandemic r5)');
    console.log('  Does the harness govern, or has it only learned its own preferences?');
    console.log(bar(78));
    const grid = await H.crossPlay(REF.entries, SCHEDULES[1].schedule, { base: BASE });
    console.log('  ' + pad('harness \\ constitution', 24) +
      REF.entries.map(e => lpad(e.name, 13)).join(''));
    console.log('  ' + '-'.repeat(66));
    grid.forEach(row => {
      console.log('  ' + pad(row.harness, 24) + row.cells.map(c =>
        lpad(c.score + '/' + c.compliance + '%' + (c.own ? '*' : ' '), 13)).join(''));
    });
    console.log('\n  cell = score / share of that constitution\'s commitments kept');
    console.log('  * = the harness running under the constitution it was written for');
  }

  console.log('\n' + bar(78) + '\n');
})();
