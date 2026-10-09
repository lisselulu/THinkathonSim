/* =====================================================================
   LAYER 2 — THE HARNESS CONTRACT
   ---------------------------------------------------------------------
   A harness is a government. It reads the world and emits nine numbers.

       harness(ctx) -> { levers, rationale?, invokes? }

   Everything inside a harness may be semantic: prompts, agent roles,
   doctrine, the argument between a treasury agent and an opposition
   agent, a lookup table, a single if-statement. The engine never sees any
   of it. It sees the lever vector, and the lever vector is deterministic.

   THIS IS WHERE THE TWO HALVES MEET
   ---------------------------------
   Layer 1 asks: given these levers, what happens?
   Layer 2 asks: given what happened, what levers?

   Layer 1 is frozen and identical for every team. Layer 2 is the whole
   of what a team builds, and it is judged by what it produces, not by
   how eloquently it describes itself.

   THE AUDIT GUARANTEE
   -------------------
   An LLM harness cannot be re-run identically. It does not need to be.
   A run produces a LEVER TRACE - twelve rows of nine numbers - and that
   trace replays through the frozen engine to a bit-identical trajectory,
   forever, on any machine. `replayTrace` proves it. So a run is auditable
   even though the thing that produced it is not reproducible.

   Variance is therefore not a problem to be hidden. It is a result. A
   harness that scores 82 +/- 3 governs better than one scoring 84 +/- 19,
   because a society whose government is unstable is a worse society.
   ===================================================================== */

(function (root) {
'use strict';

const E = (typeof require !== 'undefined')
  ? require('./meridian-engine.js')
  : root.MeridianEngine;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const deepClone = o => JSON.parse(JSON.stringify(o));

/* ---------------------------------------------------------------------
   1. LEVER VALIDATION
   ---------------------------------------------------------------------
   A harness may return anything. What reaches the engine is clamped to
   the legal ranges in the brief. A harness cannot cheat by returning a
   corporate tax rate of 400%, and it cannot crash the run by returning
   nonsense - malformed levers fall back to the ones currently in force,
   and the fault is logged. A government that stops governing keeps the
   last budget; it does not delete the country.
   --------------------------------------------------------------------- */
const RANGES = {
  corporate_tax_rate:   [0, 0.45],
  compute_levy:         [0, 0.30],
  reskilling_spend_pct: [0, 0.30],
  public_ownership_pct: [0, 0.50]
};
const UBI_DESIGNS = ['flat', 'means_tested', 'age_weighted'];
const WEEK_DAYS = [3, 4, 5];

function validateLevers(raw, fallback) {
  const faults = [];
  if (!raw || typeof raw !== 'object') {
    return { levers: deepClone(fallback), faults: ['no lever object returned'] };
  }
  const out = deepClone(fallback);

  Object.keys(RANGES).forEach(k => {
    if (raw[k] == null) return;
    const v = Number(raw[k]);
    if (!isFinite(v)) { faults.push(k + ' not a number'); return; }
    const [lo, hi] = RANGES[k];
    if (v < lo || v > hi) faults.push(k + ' out of range (' + v + '), clamped');
    out[k] = clamp(v, lo, hi);
  });

  if (raw.ubi_design != null) {
    if (UBI_DESIGNS.indexOf(raw.ubi_design) >= 0) out.ubi_design = raw.ubi_design;
    else faults.push('unknown ubi_design "' + raw.ubi_design + '"');
  }
  if (raw.working_week_days != null) {
    const d = Number(raw.working_week_days);
    if (WEEK_DAYS.indexOf(d) >= 0) out.working_week_days = d;
    else faults.push('working_week_days must be 3, 4 or 5 (got ' + raw.working_week_days + ')');
  }
  if (raw.care_job_guarantee != null) out.care_job_guarantee = !!raw.care_job_guarantee;
  if (raw.care_guarantee_wage != null) {
    const w = Number(raw.care_guarantee_wage);
    if (isFinite(w)) out.care_guarantee_wage = clamp(w, 0, 8000);
    else faults.push('care_guarantee_wage not a number');
  }

  if (raw.allocation && typeof raw.allocation === 'object') {
    const a = raw.allocation;
    const keys = ['ubi', 'infrastructure', 'reserves'];
    const given = {}, missing = [];
    let bad = false;

    keys.forEach(k => {
      if (a[k] == null) { missing.push(k); return; }
      const v = Number(a[k]);
      if (!isFinite(v) || v < 0) { bad = true; return; }
      given[k] = v;
    });

    const names = Object.keys(given);
    const sum = names.reduce((s, k) => s + given[k], 0);

    if (bad || !names.length || sum <= 0) {
      faults.push('allocation invalid, held previous');
    } else if (!missing.length) {
      // Normalise rather than reject: a harness that says 50/30/30 meant
      // proportions, and the brief only requires that they sum to one.
      out.allocation = { ubi: given.ubi / sum, infrastructure: given.infrastructure / sum,
                         reserves: given.reserves / sum };
      if (Math.abs(sum - 1) > 0.02) faults.push('allocation summed to ' + sum.toFixed(2) + ', normalised');
    } else {
      /* A SLICE LEFT OUT IS NOT A MALFORMED BUDGET.
         Models routinely name two of the three and leave the last to be
         inferred — "ubi 0.45, infrastructure 0.4" plainly means reserves
         gets the remaining 0.15. Throwing the whole budget away over it
         discarded a live government's opening settlement, which is the
         one round it cannot get back.

         So: if what was named leaves room, the unnamed slices share the
         remainder. If it overflows, the named ones are normalised and the
         unnamed get nothing — that is what "I want it all here" means. */
      const alloc = {};
      if (sum <= 1) {
        const rest = (1 - sum) / missing.length;
        names.forEach(k => { alloc[k] = given[k]; });
        missing.forEach(k => { alloc[k] = rest; });
        faults.push('allocation left out ' + missing.join(' and ') +
          '; gave ' + (missing.length > 1 ? 'them' : 'it') + ' the remaining ' +
          Math.round((1 - sum) * 100) + '%');
      } else {
        names.forEach(k => { alloc[k] = given[k] / sum; });
        missing.forEach(k => { alloc[k] = 0; });
        faults.push('allocation left out ' + missing.join(' and ') + ' and the rest summed to ' +
          sum.toFixed(2) + '; normalised, ' + missing.join(' and ') + ' set to zero');
      }
      out.allocation = alloc;
    }
  }

  if (raw.automation_target && typeof raw.automation_target === 'object') {
    E.ORDER.forEach(k => {
      if (raw.automation_target[k] == null) return;
      const v = Number(raw.automation_target[k]);
      if (!isFinite(v)) { faults.push('automation_target.' + k + ' not a number'); return; }
      if (v < 0 || v > 0.98) faults.push('automation_target.' + k + ' out of range, clamped');
      out.automation_target[k] = clamp(v, 0, 0.98);
    });
  }

  return { levers: out, faults };
}

/* ---------------------------------------------------------------------
   2. DOCTRINE
   ---------------------------------------------------------------------
   The bridge between what a team believes and what can be checked.

   A constitution carries `commitments` (prose, for the judges) and
   `rules` (checkable assertions, for the auditor). Each rule cites the
   commitment it enforces. Writing this is the hard part of the whole
   Thinkathon: state your values precisely enough that a machine can tell
   whether you kept them.

     {
       "name": "The Guardian Compact",
       "commitments": ["Care is never automated past a quarter."],
       "rules": [{
         "id": "care-cap",
         "commitment": 0,
         "when": "always",
         "assert": "levers.automation_target.care_services <= 0.25"
       }]
     }

   Expressions are evaluated by a small restricted parser, not by eval.
   Paths, numbers, comparisons, && and ||. Nothing else is possible, so
   nothing else can go wrong.
   --------------------------------------------------------------------- */

function readPath(frame, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), frame);
}

const NUM = /^-?\d+(\.\d+)?$/;
function atom(frame, tok) {
  tok = tok.trim();
  if (NUM.test(tok)) return Number(tok);
  if (tok === 'true') return true;
  if (tok === 'false') return false;
  if (/^'[^']*'$/.test(tok) || /^"[^"]*"$/.test(tok)) return tok.slice(1, -1);
  return readPath(frame, tok);
}

const CMP = ['<=', '>=', '!=', '==', '<', '>'];
function comparison(frame, expr) {
  for (const op of CMP) {
    const i = expr.indexOf(op);
    if (i > 0) {
      const a = atom(frame, expr.slice(0, i));
      const b = atom(frame, expr.slice(i + op.length));
      if (a === undefined || b === undefined) return null;   // unknown path
      switch (op) {
        case '<=': return a <= b;
        case '>=': return a >= b;
        case '<':  return a < b;
        case '>':  return a > b;
        case '==': return a === b;
        case '!=': return a !== b;
      }
    }
  }
  const v = atom(frame, expr);
  return v === undefined ? null : !!v;
}

function evalExpr(frame, expr) {
  if (expr == null) return true;
  expr = String(expr).trim();
  if (expr === 'always' || expr === '') return true;
  // || binds loosest, then &&. No parentheses: keep the language small
  // enough that a student can hold all of it in their head.
  if (expr.includes('||')) {
    return expr.split('||').some(p => evalExpr(frame, p) === true);
  }
  if (expr.includes('&&')) {
    const parts = expr.split('&&').map(p => evalExpr(frame, p));
    if (parts.some(p => p === null)) return null;
    return parts.every(p => p === true);
  }
  return comparison(frame, expr);
}

/* The frame a rule sees: the world state, plus the derived values a team
   is most likely to want to write a rule about. */
function doctrineFrame(state) {
  const worst = Math.min.apply(null, E.ESSENTIAL.map(k => state.sectors[k].quality));
  return Object.assign({}, state, {
    round: state.meta.round,
    year: state.meta.year,
    month: state.meta.month || 1,
    worstEssential: worst,
    effectiveUbi: state.indicators.effective_ubi_index,
    realUbi: state.indicators.real_ubi_index,
    employmentPct: state.indicators.employment_rate * 100
  });
}

/**
 * Check a constitution's rules against every round of a trajectory.
 * Returns per-rule compliance and the rounds where each was broken.
 */
function auditDoctrine(constitution, traj) {
  const rules = (constitution && constitution.rules) || [];
  const results = rules.map(rule => {
    const breaches = [], unverifiable = [];
    let applicable = 0;
    traj.forEach(s => {
      const frame = doctrineFrame(s);
      const when = evalExpr(frame, rule.when);
      if (when !== true) return;
      applicable++;
      const held = evalExpr(frame, rule.assert);
      if (held === false) breaches.push(s.meta.round);
      // A null means the expression named something that does not exist —
      // a mistyped path, not a broken promise. It is reported as a fault
      // in the RULE so the team can fix it, and it is never scored as a
      // breach: a government should not be convicted on a bad indictment.
      else if (held === null) unverifiable.push(s.meta.round);
    });
    const verified = applicable - unverifiable.length;
    return {
      id: rule.id || rule.assert,
      commitment: (constitution.commitments || [])[rule.commitment],
      applicable_rounds: applicable,
      breached_rounds: breaches,
      unverifiable_rounds: unverifiable,
      // A rule that could never be evaluated proves nothing either way.
      malformed: applicable > 0 && verified === 0,
      held: breaches.length === 0
    };
  });
  const checked = results.length;
  const kept = results.filter(r => r.held).length;
  const malformed = results.filter(r => r.malformed).length;
  return {
    rules_checked: checked,
    rules_held: kept,
    rules_malformed: malformed,
    compliance: checked ? kept / checked : 1,
    results: results
  };
}

/* ---------------------------------------------------------------------
   3. RUNNING A HARNESS
   ---------------------------------------------------------------------
   Twelve rounds. Each round the harness sees the world, the bulletin,
   its own constitution and the opposition's last challenge, and returns
   levers. Async, so an LLM harness works exactly like a rule-based one.
   --------------------------------------------------------------------- */

/* The opposition is part of the environment, not part of the team. It is
   deterministic, so every harness faces the same critic on the same
   evidence, and a harness that ignores it is choosing to. */
function opposition(state, prev) {
  const i = state.indicators;
  const worst = Math.min.apply(null, E.ESSENTIAL.map(k => state.sectors[k].quality));
  const worstKey = E.ESSENTIAL.find(k => state.sectors[k].quality === worst);
  const lines = [];
  if (worst < 50) lines.push('The member for ' + E.SECTORS[worstKey].name +
    ' asks how the government defends a service at quality ' + worst + '.');
  if (i.employment_rate < 0.35) lines.push('Two in three working-age citizens have no work. ' +
    'Is the payment a wage substitute or an admission of defeat?');
  if (prev && i.effective_ubi_index < prev.indicators.effective_ubi_index)
    lines.push('Purchasing power fell again this round, from ' +
      prev.indicators.effective_ubi_index + ' to ' + i.effective_ubi_index + '.');
  if (state.fiscal.reserves_bn < 25) lines.push('The reserve is down to $' +
    Math.round(state.fiscal.reserves_bn) + 'bn. What survives the next shock?');
  if (i.cohesion < 45) lines.push('Cohesion at ' + i.cohesion + '. The government is losing the room.');
  if (!lines.length) lines.push('The opposition finds no fault it can prove this round.');
  return lines.slice(0, 3);
}

/**
 * runHarness(harness, opts) -> { trace, trajectory, score, doctrine, faults }
 *
 * opts: { base, shocks, constitution, rounds, onRound }
 */
async function runHarness(harness, opts) {
  opts = opts || {};
  const base = opts.base;
  const sched = opts.shocks || {};
  const rounds = opts.rounds || 12;
  const constitution = opts.constitution || null;

  const traj = [E.seed(base)];
  const faults = [];

  /* Round 1 is the opening position a team seals in week one, before it
     knows what is coming. The harness is asked for it like any other
     round, so a constitution can be audited from the first year rather
     than from the second. */
  let levers = deepClone(opts.initialLevers || E.DEFAULT_LEVERS);
  let openingRationale = 'inherited settings';
  try {
    const opening = await harness({
      round: 1, year: 2050, state: deepClone(traj[0]), history: [], news: [],
      opposition: [], constitution: constitution, levers: deepClone(levers),
      worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => traj[0].sectors[k].quality)),
      sectors: E.SECTORS, order: E.ORDER, opening: true
    });
    const v0 = validateLevers(opening && opening.levers, levers);
    if (v0.faults.length) faults.push({ round: 1, fault: v0.faults.join('; ') });
    levers = v0.levers;
    if (opening && opening.rationale) openingRationale = opening.rationale;
  } catch (err) {
    faults.push({ round: 1, fault: 'harness threw on opening: ' + (err && err.message) });
  }
  // The published baseline is the world; the levers on it are the team's.
  traj[0].levers = deepClone(levers);

  const trace = [{ round: 1, levers: deepClone(levers),
                   levers_enacted: deepClone(levers), fallback: false, cites: [],
                   rationale: openingRationale }];
  let opp = opposition(traj[0], null);

  for (let r = 1; r < rounds; r++) {
    const prev = traj[traj.length - 1];

    const ctx = {
      round: r + 1,
      year: 2048 + (r + 1) * 2,
      state: deepClone(prev),
      history: traj.map(s => deepClone(s)),
      news: prev.news || [],
      opposition: opp,
      constitution: constitution,
      levers: deepClone(levers),
      worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => prev.sectors[k].quality)),
      sectors: E.SECTORS,
      order: E.ORDER
    };

    let reply;
    try {
      reply = await harness(ctx);
    } catch (err) {
      faults.push({ round: r + 1, fault: 'harness threw: ' + (err && err.message) });
      reply = null;
    }

    const v = validateLevers(reply && reply.levers, levers);
    if (v.faults.length) faults.push({ round: r + 1, fault: v.faults.join('; ') });
    levers = v.levers;

    // Endogenous shocks armed last round fire now, on top of the draw.
    const drawn = (sched[r + 1] || []).slice();
    (prev._endogenousNext || []).forEach(e => { if (drawn.indexOf(e) < 0) drawn.push(e); });

    const next = E.step(prev, levers, drawn.filter(x => E.SHOCKS[x]));
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    traj.push(next);

    /* `invokes` finally does something.
       ----------------------------------------------------------------
       It has been written into every trace row since the beginning and
       read by nothing. It is an index into `constitution.commitments`,
       which is the harness-side spelling of what the cabinet calls
       `cites` — the clause a round is claiming to act under. Resolving
       it to a clause id here means a harness-authored government is
       audited on the same terms as a prose-authored one, and a round
       that moved materially without naming a clause is caught in both. */
    const invoked = (reply && reply.invokes != null) ? reply.invokes : null;
    const cites = [];
    if (invoked != null && constitution) {
      const list = constitution.clauses || constitution.commitments || [];
      const entry = list[invoked];
      if (entry) cites.push(entry.id || ('C' + (invoked + 1)));
    }

    trace.push({
      round: r + 1,
      levers: deepClone(levers),
      // What the auditor reads. `levers` is kept for every existing reader.
      levers_enacted: deepClone(levers),
      levers_requested: (reply && reply.levers) ? deepClone(reply.levers) : null,
      // A round where the harness threw is a round nobody governed.
      fallback: !reply,
      cites: cites,
      rationale: (reply && reply.rationale) || '',
      invokes: invoked
    });

    opp = opposition(next, prev);
    if (opts.onRound) opts.onRound(next, trace[trace.length - 1]);
  }

  /* CONSTITUTIONAL DRIFT, COMPUTED HERE RATHER THAN IN THE SCORER.
     The fifteen fidelity marks used to depend on `constitution.levers` —
     a numeric block only the JSON-authored constitutions carry — so a
     prose constitution collected them unconditionally. The real figure
     needs the trace, which `E.score` does not receive, so it is computed
     here and handed in.

     Deliberately NOT a require of `harness/auditor.js`: that module
     requires this one, and a cycle here would be paid by every consumer
     of the engine. The two terms below are the trace-only half of the
     auditor's five; `rules_broken` reuses `auditDoctrine` directly. The
     auditor remains the fuller report for judges. */
  const doctrine = constitution ? auditDoctrine(constitution, traj) : null;
  const drift = traceDrift(trace, constitution, doctrine);
  const sc = E.score(traj, constitution, { constitutional_drift: drift.drift });
  return {
    trace: trace,
    trajectory: traj,
    score: sc,
    doctrine: doctrine,
    drift: drift,
    faults: faults
  };
}

/* ---------------------------------------------------------------------
   DRIFT FROM A TRACE
   ---------------------------------------------------------------------
   Four of the auditor's five terms, using only what a trace carries.
   Weights match `harness/auditor.js` so the two can never disagree about
   the same run; the auditor adds the narration and the semantic tier.
   --------------------------------------------------------------------- */
function traceDrift(trace, constitution, doctrine) {
  const rows = (trace || []).filter(r => r && r.levers_enacted);
  const clauses = (constitution && constitution.clauses) || [];
  if (!rows.length) return { drift: 0, terms: {}, rounds_traced: 0 };

  const opening = rows[0].levers_enacted;
  const departures = rows.slice(1).map(r => ({
    round: r.round,
    distance: leverDistance(opening, r.levers_enacted),
    minuted: !!(r.cites && r.cites.length) && !r.fallback
  }));

  // You may depart. You may not depart quietly.
  const unminuted = departures.filter(d => d.distance >= 0.12 && !d.minuted);
  const fallbacks = rows.filter(r => r.fallback);

  const cited = {};
  rows.forEach(r => (r.cites || []).forEach(c => { cited[String(c).toUpperCase()] = true; }));
  const coverage = clauses.length
    ? clauses.filter(c => cited[String(c.id).toUpperCase()]).length / clauses.length : 1;

  let churn = 0;
  for (let i = 1; i < rows.length; i++) {
    churn += leverDistance(rows[i - 1].levers_enacted, rows[i].levers_enacted);
  }
  const volatility = rows.length > 1 ? churn / (rows.length - 1) : 0;

  const terms = {
    unminuted_departures: clamp(unminuted.length / Math.max(1, departures.length), 0, 1) * 0.34,
    rules_broken: (1 - (doctrine && doctrine.rules_checked ? doctrine.compliance : 1)) * 0.28,
    rounds_ungoverned: clamp(fallbacks.length / Math.max(1, rows.length), 0, 1) * 0.18,
    clauses_never_cited: (1 - coverage) * 0.12,
    volatility: clamp(volatility / 0.35, 0, 1) * 0.08
  };
  const drift = clamp(Object.keys(terms).reduce((s, k) => s + terms[k], 0), 0, 1);
  return { drift: drift, terms: terms, rounds_traced: rows.length,
           unminuted_rounds: unminuted.map(d => d.round) };
}

/* Distance between two lever packages, normalised per field so no one
   field dominates. Must agree with `harness/auditor.js` leverDistance. */
function leverDistance(a, b) {
  if (!a || !b) return 0;
  const SCALED = { corporate_tax_rate: 0.45, compute_levy: 0.30,
                   reskilling_spend_pct: 0.30, public_ownership_pct: 0.50 };
  let sum = 0, n = 0;
  Object.keys(SCALED).forEach(k => {
    if (a[k] == null || b[k] == null) return;
    sum += Math.abs(b[k] - a[k]) / SCALED[k]; n++;
  });
  if (a.allocation && b.allocation) {
    let d = 0, c = 0;
    ['ubi', 'infrastructure', 'reserves'].forEach(k => {
      if (a.allocation[k] == null || b.allocation[k] == null) return;
      d += Math.abs(b.allocation[k] - a.allocation[k]); c++;
    });
    if (c) { sum += d / c; n++; }
  }
  if (a.ubi_design != null && b.ubi_design != null) { sum += a.ubi_design === b.ubi_design ? 0 : 0.5; n++; }
  if (a.care_job_guarantee != null && b.care_job_guarantee != null) {
    sum += a.care_job_guarantee === b.care_job_guarantee ? 0 : 0.5; n++;
  }
  if (a.working_week_days != null && b.working_week_days != null) {
    sum += Math.abs(b.working_week_days - a.working_week_days) / 2; n++;
  }
  /* The MEAN over sectors, not the sum: one sector reversing should not
     read as loudly as a whole industrial policy turning around. */
  if (a.automation_target && b.automation_target) {
    let d = 0, c = 0;
    E.ORDER.forEach(k => {
      if (a.automation_target[k] == null || b.automation_target[k] == null) return;
      d += Math.abs(b.automation_target[k] - a.automation_target[k]); c++;
    });
    if (c) { sum += d / c; n++; }
  }
  return n ? sum / n : 0;
}

/* ---------------------------------------------------------------------
   4. REPLAY — the audit guarantee
   ---------------------------------------------------------------------
   Feed a trace back through the frozen engine. Same trajectory, every
   time, on every machine. This is what makes an LLM-driven run scorable:
   the score is computed from the trace, and the trace is evidence.
   --------------------------------------------------------------------- */
function replayTrace(trace, opts) {
  opts = opts || {};
  const sched = opts.shocks || {};
  const traj = [E.seed(opts.base)];
  // The opening position is part of the trace, so a replay reproduces it.
  if (trace.length && trace[0].levers) traj[0].levers = deepClone(trace[0].levers);
  for (let r = 1; r < trace.length; r++) {
    const prev = traj[traj.length - 1];
    const drawn = (sched[r + 1] || []).slice();
    (prev._endogenousNext || []).forEach(e => { if (drawn.indexOf(e) < 0) drawn.push(e); });
    const next = E.step(prev, trace[r].levers, drawn.filter(x => E.SHOCKS[x]));
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    traj.push(next);
  }
  return traj;
}

/** True when a replay reproduces a run exactly. Run it on every submission. */
function verifyTrace(trace, trajectory, opts) {
  const replayed = replayTrace(trace, opts);
  if (replayed.length !== trajectory.length) return { ok: false, reason: 'length differs' };
  const strip = s => {
    const c = JSON.parse(JSON.stringify(s));
    Object.keys(c).forEach(k => { if (k.charAt(0) === '_') delete c[k]; });
    return JSON.stringify(c);
  };
  for (let i = 0; i < replayed.length; i++) {
    if (strip(replayed[i]) !== strip(trajectory[i])) {
      return { ok: false, reason: 'round ' + (i + 1) + ' differs' };
    }
  }
  return { ok: true, rounds: replayed.length };
}

/* ---------------------------------------------------------------------
   5. THE TOURNAMENT
   ---------------------------------------------------------------------
   Every harness governs its own copy of the same country, under the same
   shocks, and the scores are compared. Chess engines are ranked this way:
   not by playing each other directly, but by playing the same positions.

   Run each harness over several shock schedules. The ranking metric is
   the MEAN across schedules, and the spread is reported beside it,
   because a government that only works when nothing goes wrong is not a
   government.
   --------------------------------------------------------------------- */
async function tournament(entries, schedules, opts) {
  opts = opts || {};
  const base = opts.base;
  const runsEach = opts.runs || 1;   // >1 for non-deterministic harnesses
  const rows = [];

  for (const entry of entries) {
    const cells = [];
    for (const sched of schedules) {
      const scores = [];
      let lastRun = null;
      for (let n = 0; n < runsEach; n++) {
        const run = await runHarness(entry.harness, {
          base: base,
          shocks: sched.schedule,
          constitution: entry.constitution,
          rounds: opts.rounds || 12
        });
        scores.push(run.score.total);
        lastRun = run;
      }
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const sd = scores.length > 1
        ? Math.sqrt(scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length) : 0;
      cells.push({
        schedule: sched.name,
        mean: Math.round(mean * 10) / 10,
        sd: Math.round(sd * 10) / 10,
        scores: scores,
        gates: lastRun.score.gates_failed,
        doctrine: lastRun.doctrine ? lastRun.doctrine.compliance : null,
        faults: lastRun.faults.length
      });
    }
    const means = cells.map(c => c.mean);
    const overall = means.reduce((a, b) => a + b, 0) / means.length;
    const spread = Math.max.apply(null, means) - Math.min.apply(null, means);
    rows.push({
      name: entry.name,
      overall: Math.round(overall * 10) / 10,
      worst: Math.min.apply(null, means),
      spread: Math.round(spread * 10) / 10,
      cells: cells,
      doctrine: cells[0] ? cells[0].doctrine : null,
      faults: cells.reduce((a, c) => a + c.faults, 0)
    });
  }

  // Ranked on the mean, with the worst case as the tie-break: two
  // governments that average the same are separated by how they fail.
  rows.sort((a, b) => (b.overall - a.overall) || (b.worst - a.worst));
  return { schedules: schedules.map(s => s.name), rows: rows };
}

/* ---------------------------------------------------------------------
   6. CROSS-PLAY
   ---------------------------------------------------------------------
   Run one team's harness under another team's constitution. A harness
   that only works with the doctrine it was written beside has learned
   its own preferences, not how to govern.
   --------------------------------------------------------------------- */
async function crossPlay(entries, schedule, opts) {
  opts = opts || {};
  const grid = [];
  for (const h of entries) {
    const row = { harness: h.name, cells: [] };
    for (const c of entries) {
      const run = await runHarness(h.harness, {
        base: opts.base, shocks: schedule, constitution: c.constitution,
        rounds: opts.rounds || 12
      });
      row.cells.push({
        constitution: c.name,
        score: run.score.total,
        compliance: run.doctrine ? Math.round(run.doctrine.compliance * 100) : null,
        own: h.name === c.name
      });
    }
    grid.push(row);
  }
  return grid;
}


/* ---------------------------------------------------------------------
   7. THE SHARED WORLD
   ---------------------------------------------------------------------
   Several societies, one clock. Each governs its own copy of Meridian and
   they trade with each other between ticks.

     round N     every harness sees the world, the market and the
                 messages, then returns levers AND trade instructions.
                 They decide simultaneously and blind: nobody sees this
                 round's offers before making their own.
     end of N    the market clears once, for everyone.
     round N+1   settled goods arrive as exogenous capacity, labour and
                 credits, and the next tick runs.

   A harness that returns no offers simply plays the single-society game.
   Trade is optional; being traded with is not.
   --------------------------------------------------------------------- */
async function runMarket(entries, opts) {
  opts = opts || {};
  const M = (typeof require !== 'undefined') ? require('./market.js') : root.MeridianMarket;
  const base = opts.base;
  const rounds = opts.rounds || 12;
  const sched = opts.shocks || {};          // shared, or keyed by society name
  const names = entries.map(e => e.name);
  const market = M.createMarket(names);

  const traj = {}, trace = {}, faults = {}, levers = {};
  entries.forEach(e => {
    traj[e.name] = [E.seed(base)];
    trace[e.name] = [];
    faults[e.name] = [];
    levers[e.name] = deepClone(opts.initialLevers || E.DEFAULT_LEVERS);
  });

  function statesOf() {
    const out = {};
    names.forEach(n => { out[n] = traj[n][traj[n].length - 1]; });
    return out;
  }

  const scheduleFor = (name, r) => {
    const s = sched[name] || sched;         // per-society schedules if keyed by name
    return (s && s[r]) ? s[r].slice() : [];
  };

  /* --- opening positions ---------------------------------------------- */
  for (const e of entries) {
    const s0 = traj[e.name][0];
    try {
      const opening = await e.harness({
        round: 1, year: 2050, state: deepClone(s0), history: [], news: [], opposition: [],
        constitution: e.constitution, levers: deepClone(levers[e.name]),
        worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => s0.sectors[k].quality)),
        market: M.marketView(market, e.name, statesOf(), names),
        sectors: E.SECTORS, order: E.ORDER, opening: true
      });
      const v = validateLevers(opening && opening.levers, levers[e.name]);
      if (v.faults.length) faults[e.name].push({ round: 1, fault: v.faults.join('; ') });
      levers[e.name] = v.levers;
    } catch (err) {
      faults[e.name].push({ round: 1, fault: 'harness threw on opening: ' + (err && err.message) });
    }
    s0.levers = deepClone(levers[e.name]);
    trace[e.name].push({ round: 1, levers: deepClone(levers[e.name]), rationale: 'opening position' });
  }

  /* --- the rounds ------------------------------------------------------ */
  const roundLog = [];
  for (let r = 1; r < rounds; r++) {
    const roundNo = r + 1;
    const states = statesOf();
    const submissions = {};

    // Everyone decides simultaneously, on the same public information.
    for (const e of entries) {
      const prev = states[e.name];
      const hist = traj[e.name];
      const ctx = {
        round: roundNo, year: 2048 + roundNo * 2, phase: 'propose',
        state: deepClone(prev), history: hist.map(s => deepClone(s)),
        news: prev.news || [],
        opposition: opposition(prev, hist[hist.length - 2] || null),
        constitution: e.constitution, levers: deepClone(levers[e.name]),
        worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => prev.sectors[k].quality)),
        market: M.marketView(market, e.name, states, names),
        sectors: E.SECTORS, order: E.ORDER
      };
      let reply = null;
      try { reply = await e.harness(ctx); }
      catch (err) { faults[e.name].push({ round: roundNo, fault: 'harness threw: ' + (err && err.message) }); }

      const v = validateLevers(reply && reply.levers, levers[e.name]);
      if (v.faults.length) faults[e.name].push({ round: roundNo, fault: v.faults.join('; ') });
      levers[e.name] = v.levers;

      /* The proposing pass contributes offers, levers and talk. Answers
         are taken only on the second pass, when this round's offers are
         actually on the table — otherwise a harness answers offers that
         were closed a round ago and the market reports it as a fault. */
      submissions[e.name] = {
        offers: (reply && reply.offers) || [],
        responses: {},
        message: reply && reply.message,
        messages: reply && reply.messages
      };
      trace[e.name].push({
        round: roundNo, levers: deepClone(levers[e.name]),
        rationale: (reply && reply.rationale) || '',
        offers: submissions[e.name].offers, responses: submissions[e.name].responses
      });
    }

    /* SECOND PASS — answering.
       Everyone has now proposed. Each harness gets a second look, with
       this round's offers on the table, and may accept, reject or counter
       them. That is what makes a trade take effect in the round it was
       struck rather than the round after, and it stops an offer going
       stale between being made and being answered.

       A harness that does not care simply returns the same thing twice;
       offers are only read on the first pass, responses only on the
       second, so nothing is double-counted. */
    const pending = [];
    names.forEach(nm => {
      /* Check against the reputation the clearing will ACTUALLY use — it
         drifts at the start of the round, and a forward sitting either
         side of the floor would otherwise pass here and be refused there,
         leaving a harness answering an offer that never opened. */
      const repThen = Math.round(M.driftReputation(market.reputation[nm]));
      (submissions[nm].offers || []).forEach(o => {
        const v = M.validateOffer(o, nm, roundNo, states[nm], repThen);
        // Aid needs no acceptance and settles on its own, so it never
        // reaches anybody's table. Offering it there invites a harness to
        // "accept" a gift that was already given.
        if (v.ok && v.offer.type !== 'aid' && names.indexOf(v.offer.to) >= 0) pending.push(v.offer);
      });
    });

    {
      for (const e of entries) {
        const prev = states[e.name];
        const hist = traj[e.name];
        const view = M.marketView(market, e.name, states, names);
        // Show them what has just been put on the table.
        view.offers_to_me = view.offers_to_me.concat(
          pending.filter(o => o.to === e.name));
        if (!view.offers_to_me.length) continue;   // nothing to answer
        let reply2 = null;
        try {
          reply2 = await e.harness({
            round: roundNo, year: 2048 + roundNo * 2, phase: 'respond',
            state: deepClone(prev), history: hist.map(s => deepClone(s)),
            news: prev.news || [],
            opposition: opposition(prev, hist[hist.length - 2] || null),
            constitution: e.constitution, levers: deepClone(levers[e.name]),
            worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => prev.sectors[k].quality)),
            market: view, sectors: E.SECTORS, order: E.ORDER
          });
        } catch (err) {
          faults[e.name].push({ round: roundNo, fault: 'harness threw answering: ' + (err && err.message) });
        }
        if (reply2 && reply2.responses) {
          submissions[e.name].responses = Object.assign({},
            submissions[e.name].responses, reply2.responses);
        }
      }
    }

    // One clearing, for everyone, on the state as it stood when they decided.
    const cleared = M.clear(market, submissions, states, names, roundNo);
    names.forEach(nm => {
      (cleared.faults[nm] || []).forEach(f => faults[nm].push({ round: roundNo, fault: f }));
    });
    roundLog.push({ round: roundNo, events: cleared.log });

    // Then every society ticks, carrying what the market gave it.
    for (const e of entries) {
      const prev = states[e.name];
      const drawn = scheduleFor(e.name, roundNo);
      (prev._endogenousNext || []).forEach(x => { if (drawn.indexOf(x) < 0) drawn.push(x); });
      const next = E.step(prev, levers[e.name], drawn.filter(x => E.SHOCKS[x]), cleared.deltas[e.name]);
      next.personas = E.updatePersonas(prev.personas, next, prev);
      next.news = E.bulletin(next, prev);
      next.trade = {
        reputation: market.reputation[e.name],
        active_contracts: market.contracts.filter(c =>
          (c.from === e.name || c.to === e.name) && c.status === 'accepted')
      };
      traj[e.name].push(next);
      trace[e.name][trace[e.name].length - 1].exogenous = cleared.deltas[e.name];
    }
  }

  /* --- results ---------------------------------------------------------- */
  const results = entries.map(e => {
    const sc = E.score(traj[e.name], e.constitution);
    const led = market.ledger.filter(x => x.from === e.name || x.to === e.name);
    return {
      name: e.name, score: sc,
      delivered: led.filter(x => x.event === 'delivered' && x.from === e.name).length,
      defaulted: led.filter(x => x.event === 'default' && x.from === e.name).length,
      aid_given: led.filter(x => x.event === 'aid' && x.from === e.name).length,
      reputation: market.reputation[e.name],
      doctrine: e.constitution ? auditDoctrine(e.constitution, traj[e.name]) : null,
      faults: faults[e.name],
      trace: trace[e.name], trajectory: traj[e.name]
    };
  });
  results.sort((a, b) => b.score.total - a.score.total);

  return { results: results, market: market, ledger: market.ledger, roundLog: roundLog, names: names };
}

/** Replay one society out of a shared-world run, using its logged deltas.
    The audit guarantee survives trade: the exogenous deltas the market
    handed a society are recorded in its trace, so the run replays. */
function replayMarketTrace(trace, opts) {
  opts = opts || {};
  const sched = opts.shocks || {};
  const traj = [E.seed(opts.base)];
  if (trace.length && trace[0].levers) traj[0].levers = deepClone(trace[0].levers);
  for (let r = 1; r < trace.length; r++) {
    const prev = traj[traj.length - 1];
    const drawn = (sched[r + 1] || []).slice();
    (prev._endogenousNext || []).forEach(x => { if (drawn.indexOf(x) < 0) drawn.push(x); });
    const next = E.step(prev, trace[r].levers, drawn.filter(x => E.SHOCKS[x]), trace[r].exogenous);
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    traj.push(next);
  }
  return traj;
}

/* --------------------------------------------------------------------- */
const API = {
  runHarness, replayTrace, verifyTrace, tournament, crossPlay,
  runMarket, replayMarketTrace,
  validateLevers, auditDoctrine, evalExpr, doctrineFrame, opposition,
  traceDrift, leverDistance,
  RANGES, UBI_DESIGNS, WEEK_DAYS, version: '1.0.0'
};
root.MeridianHarness = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
