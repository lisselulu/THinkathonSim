/* =====================================================================
   THE TEAM'S GOVERNMENT, IN AN AGENT RUN
   ---------------------------------------------------------------------
   The Setup page saves a government section in one of two kinds:

     rules   "when <condition>, then shift / nudge / set" — deterministic,
             run by the existing rules interpreter (engine/harnesses/policy.js)
     llm     a briefing (who is governing, doctrine, what wins in conflict,
             how they trade) read by ONE model decision-maker each round,
             which is the existing constitution cabinet (harness/cabinet.js)
             with the briefing in front of everything it reads

   Either way the result is the one thing an agent run needs: a function of
   the round that returns levers, with a rationale and the clauses it cites.

   Two things matter about the model government's calls. They go through
   the run's model pool, so they obey the one-prompt-at-a-time limit, and
   they are written to the decision log, so a run with a model government
   still replays exactly.
   ===================================================================== */

'use strict';

const RULES = require('../engine/harnesses/policy.js');
const { makeCabinet } = require('../harness/cabinet.js');

/** A client with the shape makeCabinet expects, backed by the run's pool. */
function poolClient(pool, keyOf) {
  return {
    config: { model: pool.model },
    async json(messages, o) {
      o = o || {};
      const system = (messages.find(m => m.role === 'system') || {}).content || '';
      const user = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
      const res = await pool.decide({
        key: keyOf(), system: system, user: user, schema: o.schema,
        maxTokens: o.maxTokens || 1200, temperature: 0.4
      });
      return res.data ? { data: res.data, text: res.text, attempts: 1 }
                      : { data: null, text: res.text, invalid: res.error || 'no usable reply' };
    }
  };
}

function briefingText(b) {
  b = b || {};
  return [['Who is governing', b.persona], ['Our doctrine', b.doctrine],
          ['When things conflict, what wins', b.priorities], ['How we trade', b.trading]]
    .filter(x => x[1] && String(x[1]).trim())
    .map(x => x[0] + ':\n' + String(x[1]).trim()).join('\n\n');
}

/**
 * buildGovernment({ government, constitution, pool, team, seed })
 *   -> governmentFn(ctx) | null
 *
 * The function carries `.kind`, `.setRoom(room)` and `.describe()`.
 * Returns null when the team has declared no government at all, and the
 * run then holds its saved levers every round, which it says so.
 */
function buildGovernment(opts) {
  const g = opts.government || null;
  if (!g || !g.kind) return null;

  if (g.kind === 'rules') {
    const rules = RULES.fromSetup(g.rules || []);
    const checks = RULES.checkSetupRules(g.rules || []);
    const harness = RULES.makePolicyHarness({ rules: rules });
    const fn = async function rulesGovernment(ctx) {
      const reply = harness(ctx);
      return {
        levers: reply.levers,
        rationale: reply.rationale,
        cites: [],
        fallback: false,
        fired: reply.fired || [],
        faults: reply.policy_faults || []
      };
    };
    fn.kind = 'rules';
    fn.setRoom = () => {};
    fn.describe = () => ({ kind: 'rules', rules: rules.length,
                           unusable: checks.filter(c => !c.ok).map(c => ({ rule: c.index + 1, problems: c.problems })) });
    return fn;
  }

  if (g.kind === 'llm') {
    let round = 1;
    const cabinet = makeCabinet({
      constitution: opts.constitution || '',
      name: opts.team,
      briefing: briefingText(g.briefing),
      client: opts.pool ? poolClient(opts.pool, () => (opts.seed == null ? 1 : opts.seed) + '|' + (opts.team || 'team') + '|r' + round + '|government') : null
    });
    const fn = async function modelGovernment(ctx) {
      round = ctx.round;
      const before = cabinet.faults.length;
      const reply = await cabinet(ctx);
      return {
        levers: reply.levers,
        rationale: reply.rationale,
        cites: reply.cites || [],
        fallback: !!reply.fallback,
        fired: [],
        faults: cabinet.faults.slice(before).map(f => f.fault)
      };
    };
    fn.kind = 'llm';
    fn.setRoom = room => cabinet.setRoom(room);
    fn.describe = () => ({ kind: 'llm', briefing: !!briefingText(g.briefing), model: opts.pool ? opts.pool.model : null });
    return fn;
  }
  return null;
}

/** The levers a government actually changed this round, in plain names. */
function leverChanges(before, after) {
  const out = [];
  const pct = v => Math.round(v * 100) + '%';
  ['corporate_tax_rate', 'compute_levy', 'reskilling_spend_pct', 'public_ownership_pct'].forEach(k => {
    if (Math.abs((after[k] || 0) - (before[k] || 0)) > 0.004) out.push(k.replace(/_/g, ' ') + ' ' + pct(before[k]) + ' → ' + pct(after[k]));
  });
  ['ubi_design', 'working_week_days', 'care_job_guarantee'].forEach(k => {
    if (before[k] !== after[k]) out.push(k.replace(/_/g, ' ') + ' ' + before[k] + ' → ' + after[k]);
  });
  ['ubi', 'infrastructure', 'reserves'].forEach(k => {
    const a = (before.allocation || {})[k], b = (after.allocation || {})[k];
    if (a != null && b != null && Math.abs(a - b) > 0.004) out.push(k + ' share ' + pct(a) + ' → ' + pct(b));
  });
  Object.keys(after.automation_target || {}).forEach(k => {
    const a = (before.automation_target || {})[k], b = after.automation_target[k];
    if (a != null && Math.abs(a - b) > 0.004) out.push(k.replace(/_/g, ' ') + ' automation ceiling ' + pct(a) + ' → ' + pct(b));
  });
  return out;
}

module.exports = { buildGovernment, poolClient, briefingText, leverChanges };
