/* Harness layer regression tests.  node engine/test_harness.js
   No API key needed: the LLM path is exercised with a fake model. */

const fs = require('fs');
const path = require('path');
const E = require('./meridian-engine.js');
const H = require('./harness.js');
const REF = require('./harnesses/reference.js');
const LLM = require('./harnesses/llm.js');

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'))
  .states.baseline_2050;

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')); }
}

(async function () {
console.log('\nMeridian harness tests — harness v' + H.version + ', engine v' + E.version + '\n');

/* --- the audit guarantee: every run must replay exactly -------------- */
console.log('replay');
for (const e of REF.entries) {
  for (const sched of [{}, { 5: ['pandemic'] }, { 3: ['energy_price_spike'], 9: ['cyber_attack'] }]) {
    const run = await H.runHarness(e.harness, { base: BASE, shocks: sched, constitution: e.constitution });
    const v = H.verifyTrace(run.trace, run.trajectory, { base: BASE, shocks: sched });
    ok(v.ok, e.name + ' replays under ' + (Object.keys(sched).join(',') || 'fair weather'), v.reason);
  }
}

/* --- lever validation ------------------------------------------------- */
console.log('\nlever validation');
const fb = E.DEFAULT_LEVERS;
let v = H.validateLevers({ corporate_tax_rate: 9.9 }, fb);
ok(v.levers.corporate_tax_rate === 0.45, 'tax clamps to 0.45');
ok(v.faults.length === 1, 'out-of-range logs a fault');
v = H.validateLevers({ working_week_days: 11 }, fb);
ok(v.levers.working_week_days === 5, 'illegal week length holds previous');
v = H.validateLevers({ ubi_design: 'communism' }, fb);
ok(v.levers.ubi_design === 'flat', 'unknown ubi design holds previous');
v = H.validateLevers({ allocation: { ubi: 50, infrastructure: 30, reserves: 20 } }, fb);
ok(Math.abs(v.levers.allocation.ubi - 0.5) < 1e-9, 'allocation normalises to sum 1');
/* A SLICE LEFT OUT IS NOT A MALFORMED BUDGET.
   Models name two of the three and leave the last to be inferred. This
   once threw away a live government's opening settlement — the one round
   it cannot get back — so the remainder is now filled in and the guess is
   recorded as a fault rather than the budget being discarded. */
v = H.validateLevers({ allocation: { ubi: 0.45, infrastructure: 0.4 } }, fb);
ok(Math.abs(v.levers.allocation.reserves - 0.15) < 1e-9, 'an omitted slice takes the remainder');
ok(Math.abs(v.levers.allocation.ubi - 0.45) < 1e-9, 'and the named slices are left exactly alone');
ok(/left out reserves/.test(v.faults.join(' ')), 'the inference is recorded as a fault');

v = H.validateLevers({ allocation: { ubi: 0.8, infrastructure: 0.7 } }, fb);
ok(Math.abs(v.levers.allocation.reserves) < 1e-9, 'named slices that overflow leave the omitted one at zero');
ok(Math.abs(v.levers.allocation.ubi + v.levers.allocation.infrastructure - 1) < 1e-9,
   'and are normalised between themselves');

v = H.validateLevers({ allocation: { ubi: 0.5 } }, fb);
ok(Math.abs(v.levers.allocation.infrastructure - 0.25) < 1e-9 &&
   Math.abs(v.levers.allocation.reserves - 0.25) < 1e-9,
   'two omitted slices split the remainder evenly');

v = H.validateLevers({ allocation: { ubi: 0.5, infrastructure: -0.2, reserves: 0.7 } }, fb);
ok(Math.abs(v.levers.allocation.ubi - fb.allocation.ubi) < 1e-9,
   'a negative slice is still rejected outright');
ok(/invalid/.test(v.faults.join(' ')), 'and says so');

v = H.validateLevers({ automation_target: { care_services: 5 } }, fb);
ok(v.levers.automation_target.care_services === 0.98, 'automation clamps to 0.98');
v = H.validateLevers(null, fb);
ok(v.levers.corporate_tax_rate === fb.corporate_tax_rate, 'null reply holds previous levers');

/* --- doctrine audit --------------------------------------------------- */
console.log('\ndoctrine');
const impossible = {
  name: 'Impossible',
  commitments: ['Care is never automated.', 'Reserves never below $500bn.'],
  rules: [
    { id: 'no-care-auto', commitment: 0, when: 'always', assert: 'levers.automation_target.care_services <= 0.01' },
    { id: 'huge-reserve', commitment: 1, when: 'round > 1', assert: 'fiscal.reserves_bn >= 500' }
  ]
};
let r = await H.runHarness(REF.harnesses.guardian, { base: BASE, shocks: {}, constitution: impossible });
ok(r.doctrine.compliance === 0, 'an unkeepable constitution scores 0% compliance');
ok(r.doctrine.results[0].breached_rounds.length === 12, 'breach recorded in every round');

const typo = { name: 'Typo', commitments: ['x'],
  rules: [{ id: 'bad-path', commitment: 0, when: 'always', assert: 'indicators.cohesionn >= 50' }] };
r = await H.runHarness(REF.harnesses.guardian, { base: BASE, shocks: {}, constitution: typo });
ok(r.doctrine.results[0].malformed === true, 'a mistyped path is flagged malformed');
ok(r.doctrine.results[0].breached_rounds.length === 0, '...and is NOT counted as a breach');

for (const e of REF.entries) {
  r = await H.runHarness(e.harness, { base: BASE, shocks: {}, constitution: e.constitution });
  ok(r.doctrine.compliance === 1, e.name + ' keeps its own constitution in fair weather');
}

/* --- expression language --------------------------------------------- */
console.log('\nexpressions');
const frame = { indicators: { cohesion: 50 }, worstEssential: 62, round: 4,
                levers: { ubi_design: 'flat', care_job_guarantee: true } };
ok(H.evalExpr(frame, 'worstEssential >= 60') === true, '>= true');
ok(H.evalExpr(frame, 'worstEssential >= 70') === false, '>= false');
ok(H.evalExpr(frame, "levers.ubi_design == 'flat'") === true, 'string equality');
ok(H.evalExpr(frame, 'levers.care_job_guarantee == true') === true, 'boolean equality');
ok(H.evalExpr(frame, 'round > 2 && worstEssential >= 60') === true, '&&');
ok(H.evalExpr(frame, 'round > 90 || worstEssential >= 60') === true, '||');
ok(H.evalExpr(frame, 'always') === true, '"always"');
ok(H.evalExpr(frame, 'nonsense.path >= 1') === null, 'unknown path returns null');

/* --- fault tolerance -------------------------------------------------- */
console.log('\nfault tolerance');
r = await H.runHarness(() => ({ levers: { corporate_tax_rate: 99 } }), { base: BASE, shocks: {} });
ok(r.trajectory.length === 12, 'a garbage harness still completes 12 rounds');
ok(r.faults.length > 0, '...and logs faults');
r = await H.runHarness(c => { if (c.round === 5) throw new Error('timeout'); return REF.harnesses.guardian(c); },
  { base: BASE, shocks: {} });
ok(r.trajectory.length === 12, 'a throwing harness still completes 12 rounds');
ok(r.faults.some(f => /threw/.test(f.fault)), '...and records the throw');

/* --- LLM adapter, with a fake model ----------------------------------- */
console.log('\nllm adapter');
ok(JSON.stringify(LLM.extractLevers('x ```json {"a":1} ```')) === '{"a":1}', 'fenced json');
ok(JSON.stringify(LLM.extractLevers('I pick {"a":2} now')) === '{"a":2}', 'bare object');
ok(JSON.stringify(LLM.extractLevers('```json {"a":1} ``` then ```json {"b":2} ```')) === '{"b":2}', 'last fence wins');
ok(LLM.extractLevers('no json here') === null, 'prose only returns null');
ok(LLM.extractLevers('') === null, 'empty returns null');

let calls = 0;
const fake = async () => { calls++; return 'Holding steady.\n```json\n{"public_ownership_pct":0.4}\n```'; };
r = await H.runHarness(LLM.makeLLMHarness({ call: fake }), { base: BASE, shocks: {} });
ok(calls === 12, 'llm harness calls the model once per round');
ok(r.faults.length === 0, 'well-formed replies produce no faults');
ok(r.trajectory[11].levers.public_ownership_pct === 0.4, 'llm levers reach the engine');
ok(H.verifyTrace(r.trace, r.trajectory, { base: BASE, shocks: {} }).ok, 'llm run replays exactly');

calls = 0;
const cab = LLM.makeCabinetHarness({ call: async () => { calls++; return '```json\n{}\n```'; } });
await H.runHarness(cab, { base: BASE, shocks: {} });
ok(calls === 36, 'cabinet harness makes three calls per round');

const briefing = LLM.buildBriefing({
  round: 4, year: 2056, state: E.seed(BASE), news: ['x'], opposition: ['y'],
  constitution: REF.CONSTITUTIONS.guardian, levers: E.DEFAULT_LEVERS, worstEssential: 71
});
ok(briefing.includes('Guardian Compact'), 'briefing carries the constitution');
ok(briefing.includes('Care Services'), 'briefing carries every sector');
ok(briefing.includes('tolerance'), 'briefing states each sector\'s automation tolerance');

/* --- tournament ------------------------------------------------------- */
console.log('\ntournament');
const T = await H.tournament(REF.entries, [
  { name: 'fair', schedule: {} }, { name: 'pandemic', schedule: { 5: ['pandemic'] } }
], { base: BASE });
ok(T.rows.length === 3, 'three entries ranked');
ok(T.rows[0].overall >= T.rows[1].overall, 'ranked by mean, descending');
ok(T.rows.every(x => x.cells.length === 2), 'every entry ran every schedule');
ok(T.rows.find(x => x.name === 'Accelerate').cells.every(c => c.gates.length > 0),
   'the cautionary reference harness breaches gates as designed');

const grid = await H.crossPlay(REF.entries, {}, { base: BASE });
ok(grid.length === 3 && grid[0].cells.length === 3, 'cross-play produces a full 3x3 grid');
ok(grid.every(row => row.cells.some(c => c.own)), 'each row marks its own constitution');

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
})();
