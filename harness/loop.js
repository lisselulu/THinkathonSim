/* =====================================================================
   THE LOOP
   ---------------------------------------------------------------------
   One round of Meridian, closed:

        constitution + state
                 |
                 v
            the cabinet          (semantic — may be a model, may not)
                 |  levers
                 v
            the engine           (frozen, deterministic)
                 |  next state
                 v
          the citizen corpus     (semantic — may be a model, may not)
                 |  civic_unrest
                 v
        exogenous input to the NEXT round's step

   Twelve of those and a society has lived twenty-four years.

   THE THING THAT MAKES IT AUDITABLE
   ---------------------------------
   The loop is not deterministic — there are two model calls in it, and
   models are not. What it EMITS is: a trace of the levers and the
   exogenous input actually used, round by round. Hand that trace to
   `replaySociety` and you get the same twelve states back, bit for bit,
   with no model, no network and no key, on any machine, forever.

   So the government can be as semantic as a team likes, and the run is
   still a scorable, reproducible object. Score the trace, not the model.
   Run it five times and the spread is itself a result: a government that
   scores 82 ± 3 is better than one that scores 84 ± 19, because a country
   cannot re-roll.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const H = require('../engine/harness.js');
const C = require('../engine/citizen_friction.js');
const S = require('../engine/society_round.js');
const D = require('../engine/decide.js');
const LR = require('../engine/longrun.js');
const AUDIT = require('./auditor.js');
const IND = require('../engine/industry_round.js');

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------------------------------------------------------------
   MERGING EXOGENOUS INPUTS
   ---------------------------------------------------------------------
   This was `Object.assign`, which is last-writer-wins on every key. For
   the scalars that is right — a later source genuinely overrides. For
   `capacity` and `headcount` it is silently WRONG, because those are
   nested objects: a trade layer delivering imported energy capacity and a
   society withholding labour both write `capacity`, and whichever came
   second replaced the other's entire object rather than combining with
   it. One of the two simply did not happen, with nothing to show for it.

   Nothing has hit this yet because only one population writes capacity
   today. Stage 4 adds a second, and a bug that silently discards half the
   world's effects is worth fixing before it has something to discard.

   Multipliers COMPOSE: two sources each taking 10% leave 0.81, not 0.90.
   --------------------------------------------------------------------- */
const MULTIPLICATIVE = ['capacity', 'headcount', 'demand'];
const ADDITIVE = ['cohesion_bonus', 'legitimacy_bonus', 'reserves_bn', 'informal_share'];

function mergeExogenous() {
  const out = {};
  Array.prototype.forEach.call(arguments, src => {
    if (!src) return;
    Object.keys(src).forEach(key => {
      const v = src[key];
      if (MULTIPLICATIVE.indexOf(key) >= 0 && v && typeof v === 'object') {
        out[key] = out[key] || {};
        Object.keys(v).forEach(sector => {
          const have = out[key][sector] == null ? 1 : out[key][sector];
          out[key][sector] = have * v[sector];
        });
      } else if (ADDITIVE.indexOf(key) >= 0 && typeof v === 'number') {
        out[key] = (out[key] || 0) + v;
      } else if (key === 'firms' && v && typeof v === 'object') {
        /* Per-sector firm decisions merge by sector, so two sources can
           speak about different industries without erasing each other. */
        out.firms = Object.assign({}, out.firms || {});
        Object.keys(v).forEach(sector => {
          out.firms[sector] = Object.assign({}, out.firms[sector] || {}, v[sector]);
        });
      } else {
        out[key] = v;
      }
    });
  });
  return out;
}

/* ---------------------------------------------------------------------
   RUN
   ---------------------------------------------------------------------
     const run = await runSociety({
       base: world.states.baseline_2050,
       cabinet,                       // async ctx -> { levers, rationale }
       constitution: cabinet.constitution,
       rounds: 12,
       shocks: { 5: ['pandemic'] },
       client,                        // optional: gives the citizens a voice
       onRound: r => process.stdout.write('.')
     });

   Returns { trajectory, trace, faults, readings, score }.
   --------------------------------------------------------------------- */
async function runSociety(opts) {
  opts = opts || {};
  /* OPEN-ENDED BY REQUEST.
     `rounds` still works and still means what it did. Pass
     `until: 'collapse'` instead and the run continues until the society
     stops working, stops changing, or hits the backstop -- so a team can
     prove a strategy holds for sixty years, and a failing run ends
     because it failed rather than because the calendar ran out. */
  const openEnded = opts.until === 'collapse' || opts.until === 'stop';
  const rounds = openEnded ? (opts.maxRounds || 200) : (opts.rounds || 12);
  const sched = opts.shocks || {};
  const con = opts.constitution || null;
  const cabinet = opts.cabinet;
  if (typeof cabinet !== 'function') throw new Error('runSociety needs a cabinet function');

  const traj = [E.seed(opts.base)];
  const faults = [];
  const readings = [];
  const note = (round, fault) => faults.push({ round, fault });

  /* Round 1: the opening settlement, sealed before the world moves. The
     cabinet is asked for it like any other round so a constitution can be
     audited from the first year rather than the second. */
  let levers = deepClone(opts.initialLevers || E.DEFAULT_LEVERS);
  let rationale = 'inherited settings';
  let cites = [];
  try {
    const opening = await cabinet({
      round: 1, year: 2050, state: deepClone(traj[0]), history: [], news: [],
      opposition: [], constitution: con, levers: deepClone(levers),
      worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => traj[0].sectors[k].quality)),
      sectors: E.SECTORS, order: E.ORDER, opening: true
    });
    const v = H.validateLevers(opening && opening.levers, levers);
    v.faults.forEach(f => note(1, f));
    levers = v.levers;
    if (opening && opening.rationale) rationale = opening.rationale;
    if (opening && opening.cites) cites = opening.cites;
  } catch (err) {
    note(1, 'cabinet threw on the opening: ' + (err && err.message));
  }
  traj[0].levers = deepClone(levers);

  /* `levers_enacted` is not a duplicate of `levers`.
     ------------------------------------------------------------------
     `harness/auditor.js` filters the trace on `levers_enacted` and this
     loop only ever wrote `levers`, so an audit of a loop run matched
     ZERO rows: drift 0, fidelity 1, every constitutional mark awarded
     for free. The auditor was correct and unreachable.

     The pair is also the audit's point: `levers_requested` is what the
     cabinet asked for, `levers_enacted` is what survived clamping. A
     government that keeps asking for the impossible looks identical to
     one that governs cleanly unless both are written down. */
  const trace = [{ round: 1, levers: deepClone(levers), exogenous: null,
                   levers_enacted: deepClone(levers),
                   levers_requested: deepClone(opts.initialLevers || levers),
                   fallback: false,
                   rationale: rationale, cites: cites }];
  let opp = H.opposition(traj[0], null);
  let room = null;                   // last round's reading of the country
  let society = null;                // last round's DECISIONS, and their cost
  let societyMemory = null;          // what the cohorts carry between rounds
  let industry = null;               // and what the thirteen industries did
  let industryMemory = null;
  /* Industry agency is opt-in. Off, the sectors behave as they always
     did: the government's lever is a target and nothing sits under it. */
  const decideFirms = opts.decideFirms || null;
  const industryLog = [];

  /* Who is deciding what society does. Named once, here, so that the
     answer is the same for every round of a run and is written into the
     result — a run half-decided by a model nobody can identify
     afterwards is not a scorable object. */
  const decide = opts.decide || D.deterministic();
  const societyLog = [];
  let stopped = null;

  for (let r = 1; r < rounds; r++) {
    const prev = traj[traj.length - 1];

    /* ---- 1. the cabinet decides ------------------------------------ */
    const ctx = {
      round: r + 1,
      year: 2048 + (r + 1) * 2,
      state: deepClone(prev),
      history: traj.map(deepClone),
      news: prev.news || [],
      opposition: opp,
      constitution: con,
      levers: deepClone(levers),
      worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => prev.sectors[k].quality)),
      sectors: E.SECTORS, order: E.ORDER
    };

    let reply = null, replyCites = [];
    try {
      reply = await cabinet(ctx);
      if (reply && reply.cites) replyCites = reply.cites;
    } catch (err) {
      note(r + 1, 'cabinet threw: ' + (err && err.message));
    }
    const v = H.validateLevers(reply && reply.levers, levers);
    v.faults.forEach(f => note(r + 1, f));
    levers = v.levers;

    /* ---- 2. what reaches this society from outside itself, AND what
       it did to itself last round ------------------------------------
       Three sources, merged in this order:

         1. the trade layer, if a caller supplies one
         2. WHAT PEOPLE DECIDED TO DO LAST ROUND — capacity withheld by
            strikers, capacity added by neighbours covering for a
            collapsed service, headcount that emigrated, legitimacy
            spent, reserves lost to informal activity
         3. civic unrest, which is now mood PLUS militancy

       (2) is the whole point of the rebuild. Before it, society reached
       the engine only as a sentiment-derived scalar, so what people
       felt was modelled and what they did was not.

       All three are computed OUT here and handed in, so the engine
       stays a pure function of (state, levers, shocks, exogenous) and
       the run stays replayable from the trace alone. */
    /* THE MERGE THAT STAGE 3 EXISTED FOR.
       Two populations now write `capacity` and `headcount` in the same
       round. `Object.assign` would keep whichever came second and
       silently discard the other entirely. */
    const exogenous = mergeExogenous(
      (typeof opts.exogenousFor === 'function' ? opts.exogenousFor(r + 1) : null) || {},
      society ? society.exogenous : {},
      industry ? industry.exogenous : {},
      { civic_unrest: society ? society.unrest : (room ? room.civic_unrest : 0) });

    /* ---- 3. the engine ---------------------------------------------- */
    const drawn = (sched[r + 1] || []).slice();
    (prev._endogenousNext || []).forEach(e => { if (drawn.indexOf(e) < 0) drawn.push(e); });
    const next = E.step(prev, levers, drawn.filter(x => E.SHOCKS[x]), exogenous);
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    traj.push(next);

    /* ---- 4. the country reads the government ------------------------
       `readTheRoom` gives voice to the twelve archetypes when a model is
       available and falls back to the deterministic reading when it is
       not. The NUMBER it produces is deterministic either way; only the
       words are the model's. */
    try {
      room = await C.readTheRoom(prev, next, {
        client: opts.client || null,
        onFault: f => note(r + 1, 'citizens: ' + f)
      });
    } catch (err) {
      note(r + 1, 'citizens threw: ' + (err && err.message));
      room = C.aggregate(C.reactDeterministic(prev, next));
    }
    readings.push(Object.assign({ round: r + 1 }, room));
    if (typeof cabinet.setRoom === 'function') cabinet.setRoom(room);

    /* ---- 5. and then it DOES something about it ---------------------
       Each cohort is shown its own lived experience — never a lever,
       never an indicator, never this dashboard — and decides what to do
       from the twelve-behaviour action space. What they choose becomes
       next round's exogenous input at the top of this loop.

       This is where an agent framework plugs in: `opts.decide` is
       either the arithmetic baseline or the Concordia sidecar, and
       nothing else in the loop changes between them. */
    try {
      society = await S.societyRound(prev, next, {
        decide: decide, memory: societyMemory, credit: opts.credit || null
      });
      societyMemory = society.memory;
      society.faults.forEach(f => note(r + 1, 'society: ' + f));
      societyLog.push({
        round: r + 1, year: next.meta.year, source: society.source,
        unrest: society.unrest, sentiment_unrest: society.sentiment_unrest,
        share_furious: society.share_furious, mean_sentiment: society.mean_sentiment,
        shares: S.shares(society.actions),
        /* Who earned and who was locked out. Returned by
           societyRound and previously dropped here, so the whole
           exclusion report was computed every round and never
           reached a caller. */
        credit: society.credit || null,
        /* THE WHOLE ACTION, not a chosen five fields.
           This used to project {id, key, asked, weight, pressure}, and
           the feed page rendered "slack undefined" on every post and
           attributed every grievance to `material`, because `slack`,
           `concern`, `redirected`, `departed` and `full_weight` were
           dropped on the way out. Anything reading a run downstream
           needs the decision as it was actually made. */
        actions: society.actions.map(a => Object.assign({}, a))
      });
    } catch (err) {
      note(r + 1, 'society threw: ' + (err && err.message));
      society = null;
    }

    /* ---- 6. and the industries decide what to do about their business
       Run AFTER society, so a firm reads the country the citizens have
       just reacted to rather than the one before it. Their decisions
       reach the engine next round, exactly like society's. */
    if (decideFirms) {
      try {
        industry = await IND.industryRound(prev, next, {
          decide: decideFirms, memory: industryMemory, levers: levers
        });
        industryMemory = industry.memory;
        industry.faults.forEach(f => note(r + 1, 'industry: ' + f));
        industryLog.push({
          round: r + 1, year: next.meta.year, source: industry.source,
          shares: IND.shares(industry.decisions),
          decisions: industry.decisions.map(d => Object.assign({}, d))
        });
      } catch (err) {
        note(r + 1, 'industry threw: ' + (err && err.message));
        industry = null;
      }
    }

    trace.push({ round: r + 1, levers: deepClone(levers), exogenous: exogenous,
                 levers_enacted: deepClone(levers),
                 levers_requested: (reply && reply.levers) ? deepClone(reply.levers) : null,
                 /* A caretaker round is one nobody governed. The auditor
                    counts these, and a round that fell back cannot also
                    be a minuted departure. */
                 fallback: !!(reply && reply.fallback),
                 rationale: (reply && reply.rationale) || null, cites: replyCites });

    opp = H.opposition(next, prev);
    if (typeof opts.onRound === 'function') opts.onRound(r + 1, next, room);

    /* Stop when the run has stopped saying anything, not when the
       calendar says so. Checked AFTER the round is complete so the
       failing round itself is in the trajectory -- a collapse you
       cannot see the year of is not a result. */
    if (openEnded) {
      const verdict = LR.shouldStop(traj, opts);
      if (verdict.stop) { stopped = verdict; break; }
    }
  }

  /* A cabinet that handles its own failures still has to report them, or
     a run where the model was down four times looks identical to a clean
     one. */
  (cabinet.faults || []).forEach(f => faults.push(f));

  /* ---- the constitutional audit, and the marks it now carries --------
     Tier 1 only: deterministic, no model, no network. The semantic tier
     in `harness/auditor.js` is narration for judges and deliberately
     affects no number.

     This is what makes the fifteen fidelity marks mean something. It
     reads `levers_enacted`, `cites` and `fallback` off the trace rows
     written above, so it sees the same run the judges will. */
  const audit = AUDIT.auditDeterministic({
    trace: trace, trajectory: traj, constitution: con
  });

  return {
    trajectory: traj,
    trace: trace,
    readings: readings,
    /* What society decided, round by round, and who decided it. Kept
       separate from `readings` because the two answer different
       questions: readings say how the country FELT, society says what
       it DID, and the second is the one that changed the economy. */
    society: societyLog,
    /* What the thirteen industries did, and who decided it. Null when
       firm agency was not asked for. */
    industry: decideFirms ? industryLog : null,
    firmsDecidedBy: decideFirms ? (function () {
      const src = industryLog.map(x => x.source || 'deterministic');
      if (!src.length) return null;
      const counts = {};
      src.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
      const kinds = Object.keys(counts);
      return kinds.length === 1 ? kinds[0]
        : 'mixed: ' + kinds.map(k => k + ' ' + counts[k] + '/' + src.length).join(', ');
    })() : null,
    /* Why the run ended: a collapse, a stall, the backstop, or simply
       the requested number of rounds. */
    ended: stopped || { stop: false, why: 'ran the requested ' + rounds + ' rounds' },
    longrun: openEnded ? LR.report(traj, con) : null,
    /* WHO ACTUALLY DECIDED, not who was asked to.
       This was `decide.source`, which is the INTENT — it says
       "concordia" whether the sidecar answered every round or none of
       them, because the fallback is deliberately silent. A run that
       fell back on every round would have reported itself as
       agent-decided, which is precisely the unfalsifiable claim the
       decider interface exists to prevent.

       Derived from what the rounds actually recorded instead: all
       agent-decided, none, or a named mixture. */
    decidedBy: (function () {
      const sources = societyLog.map(s => s.source || 'deterministic');
      if (!sources.length) return 'nobody (no rounds)';
      const counts = {};
      sources.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
      const kinds = Object.keys(counts);
      if (kinds.length === 1) return kinds[0];
      // A mixed run names the split, so nobody has to guess which half.
      return 'mixed: ' + kinds.sort((a, b) => counts[b] - counts[a])
        .map(k => k + ' ' + counts[k] + '/' + sources.length).join(', ');
    })(),
    faults: faults,
    /* The audit, and the score that now depends on it. Both returned, so
       a team can see exactly which term cost them marks rather than
       being handed a number. */
    audit: audit,
    score: E.score(traj, con, { constitutional_drift: audit.constitutional_drift })
  };
}

/* ---------------------------------------------------------------------
   REPLAY
   ---------------------------------------------------------------------
   The trace, played back through the frozen engine with nothing else in
   the room. If this does not reproduce the run exactly, something in the
   loop above reached the engine without being written down, and that is a
   bug in the platform rather than in a team's government.
   --------------------------------------------------------------------- */
function replaySociety(base, trace, shocks) {
  const sched = shocks || {};
  const traj = [E.seed(base)];
  traj[0].levers = deepClone(trace[0].levers);

  for (let i = 1; i < trace.length; i++) {
    const prev = traj[traj.length - 1];
    const drawn = (sched[trace[i].round] || []).slice();
    (prev._endogenousNext || []).forEach(e => { if (drawn.indexOf(e) < 0) drawn.push(e); });
    const next = E.step(prev, trace[i].levers, drawn.filter(x => E.SHOCKS[x]), trace[i].exogenous);
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    traj.push(next);
  }
  return traj;
}

/** Bit-for-bit comparison, ignoring the narration the engine never read. */
function tracesAgree(a, b) {
  const strip = t => JSON.stringify(t.map(s => {
    const c = deepClone(s);
    delete c.news; delete c.personas;
    return c;
  }));
  return strip(a) === strip(b);
}

module.exports = { runSociety, replaySociety, tracesAgree, mergeExogenous };
