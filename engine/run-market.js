/* =====================================================================
   THE SHARED WORLD
   ---------------------------------------------------------------------
   Three societies, one clock, one market.

     node engine/run-market.js
     node engine/run-market.js --shock 6=pandemic,food_import_disruption
     node engine/run-market.js --asymmetric      (a different shock each)
     node engine/run-market.js --ledger          (print every event)
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const E = require('./meridian-engine.js');
const H = require('./harness.js');
const M = require('./market.js');
const REF = require('./harnesses/reference.js');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'));
const BASE = world.states.baseline_2050;

const args = process.argv.slice(2);
const showLedger = args.includes('--ledger');
const asymmetric = args.includes('--asymmetric');

let shocks = { 6: ['pandemic'], 9: ['food_import_disruption'] };
const si = args.indexOf('--shock');
if (si >= 0 && args[si + 1]) {
  shocks = {};
  args[si + 1].split(';').forEach(pair => {
    const [r, list] = pair.split('=');
    shocks[+r] = (list || '').split(',').filter(Boolean);
  });
}
if (asymmetric) {
  // Different weather for each society: the strongest argument for trade
  // is that the shock did not land on everyone at once.
  shocks = {
    Accelerate: { 5: ['chip_export_controls'] },
    Guardian:   { 6: ['food_import_disruption'] },
    Steward:    { 7: ['energy_price_spike'] }
  };
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const bar = n => '='.repeat(n);

(async function main() {
  console.log('\n' + bar(78));
  console.log('  MERIDIAN — THE SHARED WORLD');
  console.log('  engine v' + E.version + ' · harness v' + H.version + ' · market v' + M.version);
  console.log('  weather: ' + (asymmetric ? 'asymmetric — a different shock for each society'
    : JSON.stringify(shocks)));
  console.log(bar(78));

  const run = await H.runMarket(REF.entries, { base: BASE, shocks: shocks, rounds: 12 });

  /* --- what happened round by round ------------------------------------ */
  console.log('\nTHE MARKET, ROUND BY ROUND');
  run.roundLog.forEach(r => {
    if (!r.events.length) return;
    console.log('\n  round ' + r.round);
    r.events.forEach(e => {
      const mark = e.event === 'default' ? '  !! ' : (e.event === 'aid' ? '  ++ ' : '     ');
      console.log(mark + e.text);
    });
  });

  /* --- standings -------------------------------------------------------- */
  console.log('\n' + bar(78));
  console.log('  STANDINGS');
  console.log(bar(78));
  console.log('  ' + pad('society', 13) + lpad('score', 6) + lpad('rep', 5) +
    lpad('deliv', 7) + lpad('default', 9) + lpad('aid', 5) + lpad('worst svc', 11) +
    lpad('UBI', 8) + '  gates');
  console.log('  ' + '-'.repeat(74));
  run.results.forEach(r => {
    const last = r.trajectory[r.trajectory.length - 1];
    const worst = Math.min.apply(null, E.ESSENTIAL.map(k => last.sectors[k].quality));
    console.log('  ' + pad(r.name, 13) + lpad(r.score.total, 6) + lpad(r.reputation, 5) +
      lpad(r.delivered, 7) + lpad(r.defaulted, 9) + lpad(r.aid_given, 5) +
      lpad(worst, 11) + lpad('$' + last.indicators.ubi_monthly_sgd, 8) +
      '  ' + (r.score.gates_failed.length ? r.score.gates_failed.length + ' breached' : '—'));
  });

  /* --- the audit guarantee, under trade -------------------------------- */
  console.log('\n' + bar(78));
  console.log('  AUDIT — does a traded society still replay exactly?');
  console.log(bar(78));
  run.results.forEach(r => {
    const sched = asymmetric ? (shocks[r.name] || {}) : shocks;
    const replayed = H.replayMarketTrace(r.trace, { base: BASE, shocks: sched });
    const strip = s => { const c = JSON.parse(JSON.stringify(s));
      Object.keys(c).forEach(k => { if (k.charAt(0) === '_') delete c[k]; });
      delete c.trade; return JSON.stringify(c); };
    let ok = replayed.length === r.trajectory.length;
    for (let i = 0; ok && i < replayed.length; i++) {
      if (strip(replayed[i]) !== strip(r.trajectory[i])) ok = false;
    }
    console.log('  ' + pad(r.name, 13) + (ok
      ? 'replays exactly over ' + replayed.length + ' rounds, trade included'
      : 'FAILED to replay'));
  });

  /* --- faults, loudly. A silent harness failure looks like a strategy. -- */
  const faulted = run.results.filter(r => r.faults.length);
  if (faulted.length) {
    console.log('\n' + bar(78));
    console.log('  FAULTS');
    console.log(bar(78));
    faulted.forEach(r => {
      console.log('  ' + r.name + ' — ' + r.faults.length);
      r.faults.slice(0, 5).forEach(f => console.log('    r' + f.round + '  ' + f.fault));
      if (r.faults.length > 5) console.log('    ... and ' + (r.faults.length - 5) + ' more');
    });
  }

  /* --- the whole ledger ------------------------------------------------- */
  if (showLedger) {
    console.log('\n' + bar(78));
    console.log('  PUBLIC LEDGER — ' + run.ledger.length + ' events');
    console.log(bar(78));
    run.ledger.forEach(e => console.log('  r' + lpad(e.round, 2) + '  ' +
      pad(e.event, 10) + e.text));
  } else {
    const d = run.ledger.filter(e => e.event === 'delivered').length;
    const f = run.ledger.filter(e => e.event === 'default').length;
    const a = run.ledger.filter(e => e.event === 'aid').length;
    console.log('\n  ledger: ' + run.ledger.length + ' events — ' + d + ' delivered, ' +
      f + ' defaulted, ' + a + ' aid transfers.  Run with --ledger to read all of it.');
  }

  console.log('\n' + bar(78) + '\n');
})();
