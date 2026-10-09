/* =====================================================================
   END-TO-END: a society governs itself for twenty-four years
   ---------------------------------------------------------------------
       node tests/test_simulation_loop.js
       node tests/test_simulation_loop.js --live      (needs a model server)

   The default run needs no API key, no network and no model. Every
   semantic component is exercised through a FAKE model that returns the
   awkward things real small models return — prose with no JSON, a fence
   it forgot to close, single quotes, out-of-range numbers, a clause id
   that does not exist, and once, a hard throw. If the loop survives that,
   it will survive a laptop running Ollama in a room with bad wifi.

   What is asserted, in order:

     1. the constitution parses out of markdown into cited clauses
     2. twelve rounds run unattended, start to finish
     3. the citizen corpus produces unrest, and unrest reaches the engine
     4. a furious society actually loses output — the loop is CLOSED
     5. the emitted trace replays bit-for-bit with no model in the room
     6. every model failure degraded to the caretaker instead of stopping
     7. the auditor produces a drift figure, deterministically
     8. running the audit twice gives the identical number

   (5) and (8) are the two that matter most. Together they are the whole
   claim of the platform: a government may be as semantic as you like, and
   the run is still a reproducible, scorable object.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'engine/meridian-engine.js'));
const C = require(path.join(ROOT, 'engine/citizen_friction.js'));
const { makeCabinet, loadConstitution, parseConstitution } = require(path.join(ROOT, 'harness/cabinet.js'));
const { runSociety, replaySociety, tracesAgree } = require(path.join(ROOT, 'harness/loop.js'));
const AUD = require(path.join(ROOT, 'harness/auditor.js'));
const { createClient } = require(path.join(ROOT, 'harness/llm_client.js'));

const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'))
  .states.baseline_2050;

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')); }
}

/* ---------------------------------------------------------------------
   A MODEL THAT MISBEHAVES ON PURPOSE
   ---------------------------------------------------------------------
   Same interface as `llm_client.createClient()`, so nothing under test
   knows the difference. Round by round it returns a different flavour of
   wrong, and the assertions below check the loop absorbed each one.
   --------------------------------------------------------------------- */
function makeFlakyClient(log) {
  let call = 0;

  /* Cabinet replies, cycling through the ways a small model fails. */
  const cabinetReplies = [
    // 1. clean and correct
    () => '```json\n' + JSON.stringify({
      rationale: 'w '.repeat(180).trim(),
      cites: ['C1', 'C5'],
      levers: { corporate_tax_rate: 0.32, allocation: { ubi: 0.55, infrastructure: 0.35, reserves: 0.10 } }
    }) + '\n```',

    // 2. single quotes and a trailing comma — repairJson territory
    () => "Here is my decision.\n```json\n{'rationale': 'short but sincere', " +
          "'cites': ['C1'], 'levers': {'reskilling_spend_pct': 0.12,},}\n```",

    // 3. a fence it never closed
    () => 'The cabinet has considered the ward closures.\n```json\n' + JSON.stringify({
      rationale: 'w '.repeat(200).trim(), cites: ['C2'],
      levers: { allocation: { ubi: 0.45, infrastructure: 0.45, reserves: 0.10 } }
    }),

    // 4. levers wildly out of range — must be clamped, not rejected
    () => '```json\n' + JSON.stringify({
      rationale: 'w '.repeat(160).trim(), cites: ['C5'],
      levers: { corporate_tax_rate: 9.9, compute_levy: -3, working_week_days: 11 }
    }) + '\n```',

    // 5. an invented clause id — schema rejects, client re-asks, and the
    //    fake obliges on the second pass (see `retryFix` below)
    () => '```json\n' + JSON.stringify({
      rationale: 'w '.repeat(170).trim(), cites: ['C99'],
      levers: { corporate_tax_rate: 0.30 }
    }) + '\n```',

    // 6. pure prose, no object anywhere — this one MUST become caretaker
    () => 'The cabinet met for three hours and could not agree on anything, ' +
          'so we have adjourned until the next session.',

    // 7. a hard throw
    () => { throw new Error('connection reset by peer'); },

    // 8. an object buried in prose with no fence at all
    () => 'After long debate: { "rationale": "' + 'w '.repeat(170).trim() +
          '", "cites": ["C3"], "levers": { "public_ownership_pct": 0.2 } } — minuted.',

    // 9. austerity, to drive the country angry and prove the loop closes
    () => '```json\n' + JSON.stringify({
      rationale: 'w '.repeat(180).trim(), cites: ['C7'],
      levers: { allocation: { ubi: 0.95, infrastructure: 0.02, reserves: 0.03 },
                corporate_tax_rate: 0.05,
                automation_target: { care_services: 0.95, healthcare: 0.95, education: 0.95 } }
    }) + '\n```'
  ];

  let cabinetIx = 0;
  let retryFix = false;

  async function json(messages, o) {
    call++;
    const text = String(
      typeof messages === 'string' ? messages
        : messages.map(m => m.content).join('\n'));

    /* Which component is asking? The citizen prompt and the cabinet
       prompt are distinguishable by what they demand back. */
    const isCitizens = /sentiment/i.test(text) && /A0\d/.test(text);
    const isAudit = /constitutional auditor|verdict/i.test(text);

    let raw;
    if (isCitizens) {
      /* A PARTIAL answer — nine of the twelve. Real small models drop
         people from long lists, and the corpus schema tolerates up to four
         missing precisely so a good answer is not thrown away over one.
         The three who are absent must keep their deterministic reading
         rather than vanishing from the population. */
      const said = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09'];
      raw = '```json\n' + JSON.stringify({
        reactions: said.map((id, i) => ({
          id: id,
          sentiment: -15 - i * 7,
          concern: i % 2 ? 'services' : 'the payment',
          quote: 'Speaking for myself, it is getting harder.'
        }))
      }) + '\n```';
    } else if (isAudit) {
      raw = '```json\n' + JSON.stringify({
        clauses: [{ id: 'C1', verdict: 'strained', evidence: 'Services fell through rounds 9-12.' }],
        summary: 'A government that meant it and ran out of money.'
      }) + '\n```';
    } else {
      if (retryFix) { retryFix = false; raw = '```json\n' + JSON.stringify({
        rationale: 'w '.repeat(170).trim(), cites: ['C1'], levers: { corporate_tax_rate: 0.30 }
      }) + '\n```'; }
      else {
        const fn = cabinetReplies[cabinetIx % cabinetReplies.length];
        cabinetIx++;
        if (cabinetIx === 5) retryFix = true;      // the C99 reply re-asks
        raw = fn();                                 // may throw — deliberately
      }
    }

    log.push({ call, kind: isCitizens ? 'citizens' : (isAudit ? 'audit' : 'cabinet') });

    /* Run it through the REAL extraction and schema path, so the parser
       under test is the one that ships. */
    const { extractJson, extractProse } = require(path.join(ROOT, 'harness/llm_client.js'));
    const data = extractJson(raw);
    if (!data) return { data: null, prose: extractProse(raw), text: raw, invalid: 'no JSON found' };
    const check = o && o.schema ? o.schema(data) : { ok: true, value: data };
    if (!check.ok) {
      if (retryFix) return json(messages, o);       // the re-ask, as the real client does
      return { data: null, prose: extractProse(raw), text: raw, invalid: check.reason };
    }
    return { data: check.value, prose: extractProse(raw), text: raw, attempts: 1 };
  }

  return { json, chat: async () => ({ text: '' }), health: async () => ({ up: true }),
           config: { model: 'flaky-fake' } };
}

/* ===================================================================== */
(async function () {

console.log('\nMeridian end-to-end simulation loop — engine v' + E.version + '\n');

/* --- 1. the constitution -------------------------------------------- */
console.log('the constitution');
const conPath = path.join(ROOT, 'constitutions/tampines-compact.md');
const con = loadConstitution(conPath);
ok(con.name === 'The Tampines Compact', 'the name comes off the H1', con.name);
ok(con.clauses.length === 7, 'seven clauses parsed', 'got ' + con.clauses.length);
ok(con.clauses[0].id === 'C1' && /essential service/i.test(con.clauses[0].text),
   'C1 is the service floor');
ok(con.preamble.length > 80, 'the preamble survives as prose');

const messy = parseConstitution('# Loose\n\nsome preamble\n\n- first thing\n- second thing\n');
ok(messy.clauses.length === 2 && messy.clauses[1].id === 'C2',
   'a constitution with no ids still gets ids');
ok(parseConstitution('').clauses.length === 0, 'an empty constitution does not throw');

/* --- 2. twelve rounds, unattended ------------------------------------ */
console.log('\ntwelve rounds, unattended');
const log = [];
const client = makeFlakyClient(log);
const tracePath = path.join(os.tmpdir(), 'meridian-trace-' + process.pid + '.jsonl');

const cabinet = makeCabinet({ constitution: con, client: client, tracePath: tracePath });
const shocks = { 5: ['pandemic'], 9: ['energy_price_spike'] };

const run = await runSociety({
  base: BASE, cabinet: cabinet, constitution: con,
  rounds: 12, shocks: shocks, client: client
});

ok(run.trajectory.length === 12, 'twelve states', 'got ' + run.trajectory.length);
ok(run.trace.length === 12, 'twelve trace rows');
ok(run.trajectory[11].meta.round === 12, 'the last round is 12');
ok(typeof run.score.total === 'number' && run.score.total >= 0 && run.score.total <= 100,
   'a score came out: ' + run.score.total + '/100');

/* --- 3. the citizens, and the feedback path -------------------------- */
console.log('\nthe citizens');
ok(run.readings.length === 11, 'eleven readings of the room');
ok(run.readings.every(r => r.reactions.length === 12), 'all twelve archetypes answer every round');
ok(run.readings.some(r => /^model/.test(r.source)), 'the model reading was used at least once');
const voiced = run.readings.filter(r => r.reactions.some(x => x.quote));
ok(voiced.length > 0, 'citizens are quoted when the model answers');
/* THE INVARIANT: a model may supply the words and never the number.
   civic_unrest is scored, so it must come out the same whether a model
   answered, answered badly, or was not there at all. */
const voicedRounds = run.readings.filter(r => /^model/.test(r.source));
const modelVoiced = voicedRounds.filter(r => r.reactions.some(x => x.model_sentiment != null));
ok(modelVoiced.length > 0, "the model's own sentiments are recorded alongside the scored ones");
ok(modelVoiced.every(r => r.reactions.some(x =>
     x.model_sentiment != null && x.model_sentiment !== x.sentiment)),
   'and they differ from the scored ones — proof the model is not setting them');

const C2 = require(path.join(ROOT, 'engine/citizen_friction.js'));
const detOnly = C2.aggregate(C2.reactDeterministic(run.trajectory[0], run.trajectory[1]));
ok(detOnly.civic_unrest === run.readings[0].civic_unrest,
   'unrest with a model answering equals unrest with no model at all: ' +
   detOnly.civic_unrest);

const partial = run.readings.find(r => /^model/.test(r.source));
ok(partial.reactions.filter(x => x.quote).length === 9 &&
   partial.reactions.filter(x => x.quote === null).length === 3,
   'a partial model answer keeps the deterministic reading for the three it dropped');

const unrest = run.trajectory.map(s => s.indicators.civic_unrest);
ok(unrest[0] === 0, 'round one starts with no unrest');
ok(unrest.some(u => u > 0), 'unrest reaches the engine: ' + unrest.join(' '));

/* --- 4. the loop is actually closed ---------------------------------- *
   Not "unrest was recorded" — unrest COST something. Replay the exact
   same levers with the unrest stripped out and the country must do
   measurably better. If it does not, the feedback is decorative.        */
console.log('\nthe loop closes');
const angry = run.trace.filter(t => t.exogenous && t.exogenous.civic_unrest >= 50);
ok(angry.length > 0, 'the country went past the cooperation threshold in ' +
   angry.length + ' round(s)');

const withUnrest = replaySociety(BASE, run.trace, shocks);
const withoutUnrest = replaySociety(BASE, run.trace.map(t => Object.assign({}, t, {
  exogenous: t.exogenous ? Object.assign({}, t.exogenous, { civic_unrest: 0 }) : null
})), shocks);

const gdpWith = withUnrest[11].fiscal.gdp_bn;
const gdpWithout = withoutUnrest[11].fiscal.gdp_bn;
ok(gdpWithout > gdpWith,
   'withheld cooperation costs real output: $' + Math.round(gdpWith) + 'bn with unrest vs $' +
   Math.round(gdpWithout) + 'bn without');

const worst = s => Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
ok(worst(withoutUnrest[11]) >= worst(withUnrest[11]),
   'and it is felt in the services: worst essential ' + worst(withUnrest[11]) +
   ' vs ' + worst(withoutUnrest[11]));

const drags = withUnrest.map(s => s._unrestDrag).filter(d => d != null && d < 1);
ok(drags.length > 0, 'the drag is recorded on the state for a dashboard to chart');

/* --- 5. THE AUDIT GUARANTEE ------------------------------------------ */
console.log('\nthe audit guarantee');
ok(tracesAgree(run.trajectory, withUnrest),
   'the trace replays bit-for-bit with no model in the room');

const again = replaySociety(BASE, run.trace, shocks);
ok(tracesAgree(withUnrest, again), 'and replays identically a second time');

const tampered = run.trace.map((t, i) => i === 6
  ? Object.assign({}, t, { levers: Object.assign({}, t.levers, { corporate_tax_rate: 0.44 }) })
  : t);
ok(!tracesAgree(run.trajectory, replaySociety(BASE, tampered, shocks)),
   'a tampered trace does NOT replay — the guarantee has teeth');

/* --- 6. every failure degraded, none of them stopped ----------------- */
console.log('\nfailure is survivable');
const rows = fs.readFileSync(tracePath, 'utf8').trim().split('\n').map(JSON.parse);
ok(rows.length === 12, 'the cabinet wrote one telemetry row per round', 'got ' + rows.length);
ok(rows.every(r => r.levers_enacted && r.levers_enacted.allocation),
   'every row records the levers actually ENACTED, not merely requested');

const fellBack = rows.filter(r => r.fallback);
ok(fellBack.length >= 2, 'the caretaker governed the rounds the cabinet could not (' +
   fellBack.map(r => r.round).join(', ') + ')');
ok(fellBack.some(r => /adjourn|no JSON|unusable/i.test(r.fault || r.rationale)),
   'a reply with no JSON in it became a caretaker round');
ok(fellBack.some(r => /connection reset/.test(r.fault || r.rationale)),
   'a thrown model call became a caretaker round');

const clamped = rows.find(r => (r.faults || []).some(f => /clamped|out of range/i.test(f)));
ok(!!clamped, 'out-of-range levers were clamped and the fault recorded, not the round lost');
ok(clamped.levers_enacted.corporate_tax_rate <= 0.45, 'and the clamp held: ' +
   clamped.levers_enacted.corporate_tax_rate);
ok(rows.some(r => (r.faults || []).some(f => /rationale was/.test(f))),
   'a rationale outside 150-250 words is a recorded fault, not a rejection');

ok(run.faults.length > 0, run.faults.length + ' faults recorded across the run, none fatal');
const held = rows.filter(r => r.fallback).every(r =>
  JSON.stringify(r.levers_enacted) === JSON.stringify(rows[r.round - 2].levers_enacted));
ok(held, 'a caretaker round holds the previous levers exactly');

/* --- 7. the auditor --------------------------------------------------- */
console.log('\nthe auditor');
const report = await AUD.audit({
  constitution: con, trace: rows, trajectory: run.trajectory, client: client
});
ok(typeof report.constitutional_drift === 'number' &&
   report.constitutional_drift >= 0 && report.constitutional_drift <= 1,
   'constitutional_drift is in [0,1]: ' + report.constitutional_drift);
ok(report.penalty_points >= 0 && report.penalty_points <= report.max_penalty,
   'penalty ' + report.penalty_points + '/' + report.max_penalty);
ok(report.detail.fallback_rounds.length === fellBack.length,
   'the audit sees the caretaker rounds');
ok(report.terms.rounds_ungoverned > 0, 'and charges for them');
ok(Array.isArray(report.detail.clauses_never_cited), 'it reports the clauses nobody invoked: ' +
   (report.detail.clauses_never_cited.join(', ') || 'none'));
ok(report.findings && report.findings.clauses.length === 1,
   'the semantic findings came back as narration');

/* --- 8. the number does not move ------------------------------------- */
const bare = AUD.auditDeterministic({ constitution: con, trace: rows, trajectory: run.trajectory });
ok(bare.constitutional_drift === report.constitutional_drift,
   'the drift figure is identical with and without a model — narration scores nothing');
const twice = AUD.auditDeterministic({ constitution: con, trace: rows, trajectory: run.trajectory });
ok(twice.constitutional_drift === bare.constitutional_drift &&
   twice.penalty_points === bare.penalty_points,
   'and identical when computed twice');

/* --- the caretaker-only run: no model at all -------------------------- */
console.log('\nno model at all');
const soloTrace = path.join(os.tmpdir(), 'meridian-solo-' + process.pid + '.jsonl');
const solo = makeCabinet({ constitution: con, client: null, tracePath: soloTrace });
const soloRun = await runSociety({ base: BASE, cabinet: solo, constitution: con,
                                   rounds: 12, shocks: shocks, client: null });
ok(soloRun.trajectory.length === 12, 'twelve rounds run with no model configured');
ok(soloRun.readings.every(r => r.source === 'deterministic'),
   'the citizens still read the room, deterministically');
ok(tracesAgree(soloRun.trajectory, replaySociety(BASE, soloRun.trace, shocks)),
   'and that run replays too');
const soloAgain = await runSociety({ base: BASE, cabinet: makeCabinet({ constitution: con }),
                                     constitution: con, rounds: 12, shocks: shocks });
ok(tracesAgree(soloRun.trajectory, soloAgain.trajectory),
   'two model-free runs of the same government are identical');

try { fs.unlinkSync(tracePath); fs.unlinkSync(soloTrace); } catch (e) {}

/* --- optional: against a real model ---------------------------------- */
if (process.argv.indexOf('--live') >= 0) {
  console.log('\nagainst a live model');
  const live = createClient();
  const h = await live.health();
  if (!h.up) {
    console.log('  skipped — ' + live.config.baseUrl + ' is not answering (' + h.error + ')');
  } else {
    console.log('  ' + live.config.model + ' at ' + live.config.baseUrl);
    const lp = path.join(os.tmpdir(), 'meridian-live-' + process.pid + '.jsonl');
    const cab = makeCabinet({ constitution: con, client: live, tracePath: lp });
    const lr = await runSociety({ base: BASE, cabinet: cab, constitution: con, rounds: 12,
                                  shocks: shocks, client: live,
                                  onRound: r => process.stdout.write('  round ' + r + '\r') });
    console.log('  score ' + lr.score.total + '/100, ' + lr.faults.length + ' faults');
    ok(tracesAgree(lr.trajectory, replaySociety(BASE, lr.trace, shocks)),
       'a real model\'s run replays bit-for-bit');
    console.log('\n' + AUD.formatReport(await AUD.audit({
      constitution: con, trace: fs.readFileSync(lp, 'utf8').trim().split('\n').map(JSON.parse),
      trajectory: lr.trajectory, client: live })));
    try { fs.unlinkSync(lp); } catch (e) {}
  }
}

console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n');
process.exit(fail ? 1 : 0);

})().catch(err => { console.error('\nthe test itself threw:\n', err); process.exit(1); });
