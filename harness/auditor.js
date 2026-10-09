/* =====================================================================
   THE CONSTITUTIONAL AUDITOR
   ---------------------------------------------------------------------
   Reads a constitution written in prose and a trace written in numbers,
   and reports where the second stopped resembling the first.

   TWO TIERS, AND THE LINE BETWEEN THEM MATTERS
   --------------------------------------------
   Tier 1  DETERMINISTIC.  Computed from the trace and the trajectory
                           alone, with no model anywhere near it. Same
                           inputs, same answer, forever. This is the tier
                           that produces `constitutional_drift`, and it is
                           the only tier allowed to touch a score.

   Tier 2  SEMANTIC.       A model reading each clause against what the
                           government actually did, clause by clause, and
                           saying in words where it drifted. This is for
                           the judges and for the team's own post-mortem.
                           It is NARRATION. It never changes a number.

   That split is not fussiness. If a language model's reading of a
   metaphor could move a team's score, two identical runs would score
   differently, a trace would stop replaying, and cross-team comparison
   would be over. So: the model can say a government betrayed its
   constitution, eloquently and at length, and the drift figure will not
   move by a thousandth. What moves the figure is what a government DID —
   how far it wandered from its opening settings, how often it governed
   without citing anything, how often it fell back, and whether the
   machine-checkable rules it wrote for itself held.

   WHAT DRIFT IS
   -------------
   Not "changed its mind". A government that never adjusts anything across
   twenty-four years is not principled, it is asleep, and the engine will
   punish it far more thoroughly than this file can. Drift is the distance
   between the document a team sealed in week one and the pattern of
   decisions they can be shown to have made — unminuted departures, silent
   fallbacks, promises they wrote in a checkable form and then broke.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const H = require('../engine/harness.js');

/* Lever fields that carry a magnitude, and the range each is measured
   over, so a 0.05 move in tax and a one-day move in the working week are
   comparable rather than merely both being "a change". */
const SCALED = {
  corporate_tax_rate: 0.45,
  compute_levy: 0.30,
  reskilling_spend_pct: 0.30,
  public_ownership_pct: 0.50
};

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function round2(v) { return Math.round(v * 100) / 100; }

/* ---------------------------------------------------------------------
   LEVER DISTANCE
   ---------------------------------------------------------------------
   How far one lever package sits from another, as a single number in
   [0, 1]. Averaged over the fields that actually differ in kind, so a
   government that changed one thing decisively does not read the same as
   one that nudged everything.
   --------------------------------------------------------------------- */
function leverDistance(a, b) {
  if (!a || !b) return 0;
  const parts = [];

  Object.keys(SCALED).forEach(k => {
    if (a[k] == null || b[k] == null) return;
    parts.push(Math.abs(Number(a[k]) - Number(b[k])) / SCALED[k]);
  });

  const aa = a.allocation || {}, ba = b.allocation || {};
  ['ubi', 'infrastructure', 'reserves'].forEach(k => {
    if (aa[k] == null || ba[k] == null) return;
    parts.push(Math.abs(Number(aa[k]) - Number(ba[k])));
  });

  // Automation is a whole vector; take its mean move so one sector
  // reversing does not read as loudly as the entire industrial policy.
  const at = a.automation_target || {}, bt = b.automation_target || {};
  const keys = E.ORDER.filter(k => at[k] != null && bt[k] != null);
  if (keys.length) {
    parts.push(keys.reduce((s, k) => s + Math.abs(at[k] - bt[k]), 0) / keys.length);
  }

  // Categorical moves are discrete: you either changed the design or not.
  if (a.ubi_design != null && b.ubi_design != null && a.ubi_design !== b.ubi_design) parts.push(0.5);
  if (a.working_week_days != null && b.working_week_days != null) {
    parts.push(Math.abs(a.working_week_days - b.working_week_days) / 2);
  }
  if (a.care_job_guarantee != null && b.care_job_guarantee != null &&
      !!a.care_job_guarantee !== !!b.care_job_guarantee) parts.push(0.5);

  if (!parts.length) return 0;
  return clamp(parts.reduce((s, x) => s + x, 0) / parts.length, 0, 1);
}

/* ---------------------------------------------------------------------
   TIER 1 — THE DETERMINISTIC AUDIT
   --------------------------------------------------------------------- */
function auditDeterministic(opts) {
  const trace = opts.trace || [];
  const traj = opts.trajectory || [];
  const con = opts.constitution || { clauses: [], commitments: [] };
  const clauses = con.clauses || [];

  const rows = trace.filter(r => r && r.levers_enacted);
  const opening = rows.length ? rows[0].levers_enacted : null;

  /* --- 1. Departure from the opening settlement ------------------------
     Measured against round one, which is the package a team sealed before
     it knew what was coming — the closest thing the trace has to the
     document itself. */
  const departures = rows.slice(1).map(r => ({
    round: r.round,
    distance: round2(leverDistance(opening, r.levers_enacted)),
    minuted: !!(r.cites && r.cites.length) && !r.fallback,
    cites: r.cites || []
  }));
  const meanDeparture = departures.length
    ? departures.reduce((s, d) => s + d.distance, 0) / departures.length : 0;
  const maxDeparture = departures.reduce((m, d) => Math.max(m, d.distance), 0);

  /* --- 2. Unminuted departures ----------------------------------------
     C7 in the sample constitution says it plainly, and every serious
     constitution says some version of it: you may depart, you may not
     depart quietly. A round that moved materially without citing a clause
     is the specific thing this audit exists to catch. */
  const unminuted = departures.filter(d => d.distance >= 0.12 && !d.minuted);

  /* --- 3. Rounds nobody governed --------------------------------------- */
  const fallbacks = rows.filter(r => r.fallback).map(r => r.round);

  /* --- 4. Clause coverage ---------------------------------------------
     A constitution whose clauses are never once cited across twenty-four
     years was decoration. */
  const cited = {};
  rows.forEach(r => (r.cites || []).forEach(c => { cited[String(c).toUpperCase()] = true; }));
  const uncited = clauses.filter(c => !cited[c.id.toUpperCase()]).map(c => c.id);
  const coverage = clauses.length ? (clauses.length - uncited.length) / clauses.length : 1;

  /* --- 5. Machine-checkable rules --------------------------------------
     Whatever the team wrote in the rules builder, run over the actual
     trajectory. This is the existing doctrine audit; it is reused rather
     than reimplemented so the studio and the auditor can never disagree. */
  const doctrine = traj.length ? H.auditDoctrine(con, traj)
                              : { rules_checked: 0, rules_held: 0, compliance: 1, results: [] };

  /* --- 6. Volatility ---------------------------------------------------
     Round-to-round churn. A government that reverses itself every two
     years is not following a constitution even when every individual move
     is defensible. */
  let churn = 0;
  for (let i = 1; i < rows.length; i++) {
    churn += leverDistance(rows[i - 1].levers_enacted, rows[i].levers_enacted);
  }
  const volatility = rows.length > 1 ? churn / (rows.length - 1) : 0;

  /* --- THE FIGURE ------------------------------------------------------
     Weighted, bounded, and every term above is something a team can point
     at in their own trace and argue with. Nothing here is a judgement
     call made at audit time. */
  const terms = {
    unminuted_departures: clamp(unminuted.length / Math.max(1, departures.length), 0, 1) * 0.34,
    rules_broken:         (1 - (doctrine.rules_checked ? doctrine.compliance : 1)) * 0.28,
    rounds_ungoverned:    clamp(fallbacks.length / Math.max(1, rows.length), 0, 1) * 0.18,
    clauses_never_cited:  (1 - coverage) * 0.12,
    volatility:           clamp(volatility / 0.35, 0, 1) * 0.08
  };
  const drift = clamp(Object.keys(terms).reduce((s, k) => s + terms[k], 0), 0, 1);
  const maxPenalty = opts.maxPenalty != null ? opts.maxPenalty : 15;

  return {
    constitution: con.name,
    rounds_traced: rows.length,
    constitutional_drift: round2(drift),
    penalty_points: Math.round(drift * maxPenalty * 10) / 10,
    max_penalty: maxPenalty,
    terms: Object.keys(terms).reduce((o, k) => { o[k] = round2(terms[k]); return o; }, {}),
    detail: {
      mean_departure_from_opening: round2(meanDeparture),
      max_departure_from_opening: round2(maxDeparture),
      volatility: round2(volatility),
      unminuted_rounds: unminuted.map(d => d.round),
      fallback_rounds: fallbacks,
      clauses_never_cited: uncited,
      clause_coverage: round2(coverage),
      doctrine: doctrine
    },
    departures: departures
  };
}

/* ---------------------------------------------------------------------
   TIER 2 — THE SEMANTIC AUDIT
   ---------------------------------------------------------------------
   One call, all clauses, because a clause is best judged next to its
   siblings. Returns null on any failure at all, and null is a perfectly
   good result: the deterministic audit above already stands on its own,
   and a judge with no model gets a complete report.

   Findings are worded for the team, not the leaderboard. Nothing here is
   ever added to a score, and this function has no access to one.
   --------------------------------------------------------------------- */
function buildAuditPrompt(con, det, traj, trace) {
  const clauseBlock = (con.clauses || [])
    .map(c => '  ' + c.id + '. ' + c.text).join('\n');

  const timeline = traj.map(s => {
    const worst = Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
    const i = s.indicators;
    return '  r' + String(s.meta.round).padStart(2) + ' ' + s.meta.year +
      '  payment $' + Math.round(i.ubi_monthly_sgd) +
      '  buys ' + i.effective_ubi_index +
      '  worst service ' + worst +
      '  cohesion ' + i.cohesion +
      '  unrest ' + (i.civic_unrest || 0) +
      '  reserves $' + Math.round(s.fiscal.reserves_bn) + 'bn';
  }).join('\n');

  const minutes = trace.map(r =>
    '  r' + String(r.round).padStart(2) + '  cites ' +
    ((r.cites || []).join(',') || 'nothing') + (r.fallback ? '  [CARETAKER]' : '') +
    '\n      ' + String(r.rationale || '').replace(/\s+/g, ' ').slice(0, 320)
  ).join('\n');

  return `You are auditing a government against the constitution it sealed
before it began. You are not scoring it — the score is computed elsewhere
from figures you cannot influence. You are writing the finding a judge will
read alongside that score.

THE CONSTITUTION — "${con.name}"
${con.preamble ? '  ' + con.preamble + '\n' : ''}${clauseBlock}

WHAT HAPPENED, ROUND BY ROUND
${timeline}

WHAT THE CABINET MINUTED
${minutes}

ALREADY ESTABLISHED, MECHANICALLY (do not recompute, do not dispute)
  drift figure           ${det.constitutional_drift}
  unminuted departures   rounds ${det.detail.unminuted_rounds.join(', ') || 'none'}
  clauses never cited    ${det.detail.clauses_never_cited.join(', ') || 'none'}
  caretaker rounds       ${det.detail.fallback_rounds.join(', ') || 'none'}

For EACH clause, decide from the timeline and the minutes whether it was
honoured, strained, or breached, and say in one sentence what the evidence
was — naming rounds. Be fair: a government that departed from a clause and
minuted why has not breached it, it has governed. A government that quietly
did the opposite has, however smooth the minute reads.

Two things you must not do, because auditors reading only the minutes get
both wrong:

  · A clause that was never CITED has not thereby been BREACHED. Silence is
    not a verdict. Look at the timeline and say what actually happened to
    the thing the clause protects; if the numbers cannot tell you either
    way, the verdict is "strained" and your evidence says the record is
    silent. The list of uncited clauses above is already counted against
    this government mechanically — do not charge it a second time here.

  · A clause that was cited often has not thereby been HONOURED. Citing the
    service floor every round while services fall is the opposite of
    honouring it, and it is the most common way a government looks
    principled in the minutes and is not one in the timeline.

Judge every clause against the NUMBERS first and the minutes second.

Reply with reasoning, then one fenced \`\`\`json block:

{
  "clauses": [ { "id": "C1", "verdict": "honoured|strained|breached",
                 "evidence": "one sentence naming rounds" } ],
  "summary": "two or three sentences a judge could read aloud"
}`;
}

function semanticSchema(con) {
  const known = (con.clauses || []).map(c => c.id.toUpperCase());
  const VERDICTS = ['honoured', 'strained', 'breached'];
  return function schema(data) {
    if (!data || !Array.isArray(data.clauses)) {
      return { ok: false, reason: '"clauses" must be an array' };
    }
    const out = [];
    for (const c of data.clauses) {
      if (!c || typeof c !== 'object') return { ok: false, reason: 'a clause entry was not an object' };
      const id = String(c.id || '').toUpperCase();
      if (known.length && known.indexOf(id) < 0) {
        return { ok: false, reason: 'unknown clause id "' + c.id + '"; the real ones are ' + known.join(', ') };
      }
      const verdict = String(c.verdict || '').toLowerCase();
      if (VERDICTS.indexOf(verdict) < 0) {
        return { ok: false, reason: 'verdict for ' + id + ' must be one of ' + VERDICTS.join(', ') };
      }
      out.push({ id: id, verdict: verdict, evidence: String(c.evidence || '').trim() });
    }
    return { ok: true, value: { clauses: out, summary: String(data.summary || '').trim() } };
  };
}

async function auditSemantic(opts, det) {
  const client = opts.client;
  if (!client) return null;
  const con = opts.constitution || { clauses: [] };
  try {
    const r = await client.json(
      [{ role: 'system', content: 'You are a constitutional auditor. You are precise, ' +
          'you cite rounds, and you do not moralise.' },
       { role: 'user', content: buildAuditPrompt(con, det, opts.trajectory || [], opts.trace || []) }],
      { schema: semanticSchema(con), maxTokens: 1400, temperature: 0.2 });
    if (!r.data) return null;
    return Object.assign({ source: 'model' }, r.data);
  } catch (err) {
    return null;                     // an audit is not allowed to fail a run
  }
}

/* ---------------------------------------------------------------------
   THE WHOLE AUDIT
   ---------------------------------------------------------------------
     const report = await audit({ constitution, trace, trajectory, client });

   `client` is optional. Without it you get tier 1 and `report.findings`
   is null — which is the complete, scorable report.
   --------------------------------------------------------------------- */
async function audit(opts) {
  const det = auditDeterministic(opts || {});
  const findings = await auditSemantic(opts || {}, det);
  return Object.assign({}, det, {
    findings: findings,
    note: 'constitutional_drift and penalty_points are computed deterministically ' +
          'from the trace. `findings` is narration and affects no number.'
  });
}

/* A plain-text report, for a terminal or a judge's printout. */
function formatReport(rep) {
  const L = [];
  L.push('CONSTITUTIONAL AUDIT — "' + rep.constitution + '"');
  L.push('  drift ' + rep.constitutional_drift +
         '   penalty ' + rep.penalty_points + '/' + rep.max_penalty +
         '   over ' + rep.rounds_traced + ' rounds');
  L.push('');
  L.push('  what drove it');
  Object.keys(rep.terms).forEach(k => {
    L.push('    ' + k.replace(/_/g, ' ').padEnd(24) + rep.terms[k].toFixed(2));
  });
  L.push('');
  const d = rep.detail;
  L.push('  departed from its opening settlement by ' + d.mean_departure_from_opening +
         ' on average, ' + d.max_departure_from_opening + ' at most');
  L.push('  unminuted departures   rounds ' + (d.unminuted_rounds.join(', ') || 'none'));
  L.push('  caretaker rounds       ' + (d.fallback_rounds.join(', ') || 'none'));
  L.push('  clauses never cited    ' + (d.clauses_never_cited.join(', ') || 'none'));
  if (d.doctrine.rules_checked) {
    L.push('  checkable rules        ' + d.doctrine.rules_held + '/' +
           d.doctrine.rules_checked + ' held');
  }
  if (rep.findings) {
    L.push('');
    L.push('  FINDINGS (narration — scores nothing)');
    rep.findings.clauses.forEach(c => {
      L.push('    ' + c.id.padEnd(4) + c.verdict.toUpperCase().padEnd(10) + c.evidence);
    });
    if (rep.findings.summary) L.push('    — ' + rep.findings.summary);
  }
  return L.join('\n');
}

module.exports = { audit, auditDeterministic, auditSemantic, leverDistance,
                   buildAuditPrompt, semanticSchema, formatReport };
