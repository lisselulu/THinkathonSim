/* =====================================================================
   RUN THE TEAMS
   ---------------------------------------------------------------------
   Reads the bundles teams exported from the Team Console and runs them
   against each other in one shared world.

     node engine/run-bundle.js                 # everything in bundles/
     node engine/run-bundle.js --dir mybundles
     node engine/run-bundle.js --solo          # each team alone, no market
     node engine/run-bundle.js --asymmetric    # a different shock each

   A bundle is what the console's Export tab produces:

     { "team": "...", "constitution": {...},
       "harness": { "kind": "policy", "policy": {...} } }
                 or { "kind": "llm", "persona": "...", "briefing_preamble": "..." }

   An LLM bundle needs a model to call. Point MERIDIAN_LLM at a module
   exporting `async call(prompt) -> string`; without one, LLM teams run
   on a stand-in that holds its opening position, so a mixed field still
   runs and the missing piece is reported rather than silently skipped.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const E = require('./meridian-engine.js');
const H = require('./harness.js');
const P = require('./harnesses/policy.js');
const LLM = require('./harnesses/llm.js');

const root = path.join(__dirname, '..');
const world = JSON.parse(fs.readFileSync(path.join(root, 'world-states.json'), 'utf8'));
const BASE = world.states.baseline_2050;

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DIR = path.join(root, argOf('--dir', 'bundles'));
const SOLO = args.includes('--solo');
const ASYM = args.includes('--asymmetric');

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const bar = n => '='.repeat(n);

/* --- the model, if a team brought one -------------------------------- */
let modelCall = null;
if (process.env.MERIDIAN_LLM) {
  try {
    const mod = require(path.resolve(process.env.MERIDIAN_LLM));
    modelCall = mod.call || mod;
    if (typeof modelCall !== 'function') modelCall = null;
  } catch (e) {
    console.log('  could not load MERIDIAN_LLM: ' + e.message);
  }
}

/* --- turn a bundle into a government ---------------------------------- */
function harnessFor(bundle, notes) {
  const h = bundle.harness || {};
  if (h.kind === 'llm') {
    if (!modelCall) {
      notes.push(bundle.team + ': an LLM harness with no model attached — ' +
        'it will hold its opening position. Set MERIDIAN_LLM to run it properly.');
      return () => ({ levers: {}, rationale: 'no model attached' });
    }
    return LLM.makeLLMHarness({
      call: modelCall,
      persona: (h.persona || '') + (h.briefing_preamble ? '\n\n' + h.briefing_preamble : '')
    });
  }
  const check = P.validatePolicy(h.policy || {});
  check.faults.forEach(f => notes.push(bundle.team + ': ' + f));
  check.warnings.forEach(w => notes.push(bundle.team + ' (warning): ' + w));
  return P.makePolicyHarness(h.policy || {});
}

function loadBundles() {
  if (!fs.existsSync(DIR)) {
    console.log('\n  No bundle directory at ' + DIR);
    console.log('  Export a bundle from the Team Console and save it there as <team>.json\n');
    process.exit(1);
  }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  if (!files.length) {
    console.log('\n  No .json bundles in ' + DIR + '\n');
    process.exit(1);
  }
  return files.map(f => {
    const b = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!b.team) b.team = path.basename(f, '.json');
    b._file = f;
    return b;
  });
}

const SHOCK_MENU = ['pandemic', 'food_import_disruption', 'energy_price_spike',
                    'chip_export_controls', 'cyber_attack'];

(async function main() {
  const bundles = loadBundles();
  const notes = [];

  console.log('\n' + bar(78));
  console.log('  MERIDIAN — ' + bundles.length + ' team' + (bundles.length > 1 ? 's' : '') +
              (SOLO ? ', each alone' : ', one shared world'));
  console.log('  ' + bundles.map(b => b.team + ' (' + ((b.harness || {}).kind || '?') + ')').join(' · '));
  console.log(bar(78));

  const entries = bundles.map(b => ({
    name: b.team,
    harness: harnessFor(b, notes),
    constitution: b.constitution || null
  }));

  // Weather. Asymmetric is the case that makes trade matter.
  let shocks = { 5: ['pandemic'], 9: ['food_import_disruption'] };
  if (ASYM) {
    shocks = {};
    entries.forEach((e, i) => {
      const round = 4 + (i % 4);
      shocks[e.name] = { [round]: [SHOCK_MENU[i % SHOCK_MENU.length]] };
    });
  }

  if (notes.length) {
    console.log('\nBEFORE WE START');
    notes.forEach(n => console.log('  · ' + n));
  }

  let results;
  if (SOLO) {
    results = [];
    for (const e of entries) {
      const r = await H.runHarness(e.harness, {
        base: BASE, shocks: ASYM ? (shocks[e.name] || {}) : shocks, constitution: e.constitution
      });
      results.push({ name: e.name, score: r.score, doctrine: r.doctrine, faults: r.faults,
                     trajectory: r.trajectory, trace: r.trace,
                     delivered: 0, defaulted: 0, aid_given: 0, reputation: 50 });
    }
    results.sort((a, b) => b.score.total - a.score.total);
  } else {
    const run = await H.runMarket(entries, { base: BASE, shocks: shocks, rounds: 12 });
    results = run.results;
    if (run.ledger.length) {
      console.log('\nTHE MARKET');
      run.roundLog.forEach(r => {
        if (!r.events.length) return;
        console.log('  round ' + r.round);
        r.events.forEach(ev => console.log(
          (ev.event === 'default' ? '    !! ' : ev.event === 'aid' ? '    ++ ' : '       ') + ev.text));
      });
    }
  }

  /* --- standings -------------------------------------------------------- */
  console.log('\n' + bar(78));
  console.log('  STANDINGS');
  console.log(bar(78));
  console.log('  ' + pad('team', 16) + lpad('score', 6) + lpad('worst svc', 11) +
    lpad('UBI', 9) + lpad('rep', 5) + lpad('kept', 7) + lpad('faults', 8) + '  gates');
  console.log('  ' + '-'.repeat(74));
  results.forEach(r => {
    const last = r.trajectory[r.trajectory.length - 1];
    const worst = Math.min.apply(null, E.ESSENTIAL.map(k => last.sectors[k].quality));
    const kept = r.doctrine ? r.doctrine.rules_held + '/' + r.doctrine.rules_checked : '—';
    console.log('  ' + pad(r.name, 16) + lpad(r.score.total, 6) + lpad(worst, 11) +
      lpad('$' + last.indicators.ubi_monthly_sgd, 9) + lpad(r.reputation, 5) +
      lpad(kept, 7) + lpad(r.faults.length, 8) + '  ' +
      (r.score.gates_failed.length ? r.score.gates_failed.length + ' breached' : '—'));
  });

  /* --- did they keep their own word? ------------------------------------ */
  const withDoctrine = results.filter(r => r.doctrine && r.doctrine.rules_checked);
  if (withDoctrine.length) {
    console.log('\n' + bar(78));
    console.log('  CONSTITUTIONAL AUDIT');
    console.log(bar(78));
    withDoctrine.forEach(r => {
      console.log('\n  ' + r.name);
      r.doctrine.results.forEach(x => {
        console.log('    ' + (x.held ? 'kept  ' : 'BROKEN') + '  ' + pad(x.id, 22) +
          (x.held ? '' : 'rounds ' + x.breached_rounds.slice(0, 8).join(',')) +
          (x.malformed ? '   [rule names something that does not exist]' : ''));
        if (!x.held && x.commitment) console.log('              "' + x.commitment + '"');
      });
    });
  }

  /* --- the audit guarantee ---------------------------------------------- */
  console.log('\n' + bar(78));
  console.log('  AUDIT — every run replays to a bit-identical trajectory');
  console.log(bar(78));
  results.forEach(r => {
    const sched = ASYM ? (shocks[r.name] || {}) : shocks;
    const replayed = SOLO
      ? H.replayTrace(r.trace, { base: BASE, shocks: sched })
      : H.replayMarketTrace(r.trace, { base: BASE, shocks: sched });
    const strip = s => { const c = JSON.parse(JSON.stringify(s));
      Object.keys(c).forEach(k => { if (k.charAt(0) === '_') delete c[k]; });
      delete c.trade; return JSON.stringify(c); };
    let ok = replayed.length === r.trajectory.length;
    for (let i = 0; ok && i < replayed.length; i++) {
      if (strip(replayed[i]) !== strip(r.trajectory[i])) ok = false;
    }
    console.log('  ' + pad(r.name, 16) + (ok ? 'replays exactly' : 'FAILED to replay'));
  });

  const faulted = results.filter(r => r.faults.length);
  if (faulted.length) {
    console.log('\n' + bar(78));
    console.log('  FAULTS');
    console.log(bar(78));
    faulted.forEach(r => {
      console.log('  ' + r.name + ' — ' + r.faults.length);
      r.faults.slice(0, 4).forEach(f => console.log('    r' + f.round + '  ' + f.fault));
      if (r.faults.length > 4) console.log('    ... and ' + (r.faults.length - 4) + ' more');
    });
  }

  console.log('\n' + bar(78) + '\n');
})();
