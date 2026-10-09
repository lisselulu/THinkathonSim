/* =====================================================================
   ENSEMBLES: WHAT "FAIR" MEANS ONCE RUNS VARY
   ---------------------------------------------------------------------
   With agents deciding, the same government no longer produces the same
   country every time. The agreed answer:

   - every team gets IDENTICAL seeds, so the same population, the same
     social graph and the same seeded weather
   - every team faces IDENTICAL organiser events
   - final results are reported across FIVE seeds as distributions: what
     usually happens (the median) and what happens in the bad runs (the
     10th percentile), never a single lucky run
   - every run keeps its decision log, so any one of them replays exactly

   A government whose worst run is survivable is a different kind of
   government from one whose median is excellent and whose worst run is
   a collapse. Both are visible here; which matters more is the team's
   argument to make.
   ===================================================================== */

'use strict';

const path = require('path');
const EV = require('./evidence.js');
const { runAgentSociety } = require('./society.js');

const DEFAULT_SEEDS = [101, 202, 303, 404, 505];

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 1000) / 1000;
}

function distributions(summaries) {
  const keys = Object.keys(summaries[0] || {});
  const out = {};
  keys.forEach(k => {
    const vals = summaries.map(s => s[k]).filter(v => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
    out[k] = { median: quantile(vals, 0.5), p10: quantile(vals, 0.1), p90: quantile(vals, 0.9),
               min: vals.length ? vals[0] : null, max: vals.length ? vals[vals.length - 1] : null, n: vals.length };
  });
  return out;
}

/**
 * runEnsemble(runOptions, { seeds, makePool, makeDirector, onProgress })
 * `makePool(seed)` returns a pool per run, so each run records its own log.
 */
async function runEnsemble(runOpts, o) {
  o = o || {};
  const seeds = o.seeds || DEFAULT_SEEDS;
  const runs = [];
  for (const seed of seeds) {
    const pool = o.makePool ? o.makePool(seed) : runOpts.pool;
    const director = o.makeDirector ? o.makeDirector(seed) : runOpts.director;
    const run = await runAgentSociety(Object.assign({}, runOpts, {
      seed, pool, director,
      onProgress: e => { if (o.onProgress) o.onProgress(Object.assign({ seed }, e)); }
    }));
    if (pool && pool.close) pool.close();
    runs.push({ seed, summary: EV.summary(run), evidence: run.evidence, logPath: pool && pool.logPath });
  }
  return {
    team: runOpts.team, seeds: seeds,
    distributions: distributions(runs.map(r => r.summary)),
    runs: runs.map(r => ({ seed: r.seed, summary: r.summary, degraded: r.evidence.provenance.degraded })),
    evidence: runs.map(r => r.evidence),
    note: 'Identical seeds and events for every team. Medians show what usually happens; p10 shows the bad runs.'
  };
}

module.exports = { runEnsemble, distributions, quantile, DEFAULT_SEEDS };
