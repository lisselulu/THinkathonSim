/* =====================================================================
   LONG RUNS — scoring a government that governs for sixty years
   ---------------------------------------------------------------------
   Removing the twelve-round cap was one line. Making a long run MEAN
   something took this file, because the existing score punishes length
   and does so invisibly.

   WHY `score()` CANNOT BE USED ALONE ON AN OPEN-ENDED RUN
   ------------------------------------------------------
   Look at what it measures:

       sustained_real_ubi   the MEAN over the run
       minimum_ubi          the MINIMUM after round 1
       worst_service        the WORST EVER across all rounds

   The means are length-independent. The minima are not: a minimum over
   a longer sequence can only be equal or lower. So a team governing
   IDENTICALLY WELL for sixty years scores strictly below one that
   stopped at twenty-four, because they gave the minimum more chances to
   be bad.

   That is exactly backwards for a platform whose purpose is to let
   students prove a strategy holds up over time. It is also the kind of
   bug that never announces itself: both runs complete, both produce a
   number, and the number quietly rewards stopping early.

   WHAT REPLACES IT
   ----------------
   Two things, neither of which is a single total:

   1. DECADES. The same metrics computed per ten-year window. A strategy
      that holds shows a flat line; one coasting on inherited reserves
      shows decay. That is the claim a student is actually trying to
      make, and a mean over the whole run hides it — a decade of plenty
      and a decade of famine average to something unremarkable.

   2. SURVIVAL. How long the society held above the floor, and what
      ended it. "Held for forty-six years, then insolvency in 2096" says
      more than any score out of a hundred, and it makes ending a
      failing run early the natural move rather than a forfeit.

   `score()` is still computed and still comparable BETWEEN RUNS OF THE
   SAME LENGTH. It is not comparable across lengths, and callers are told
   so rather than left to find out.
   ===================================================================== */

'use strict';

const E = require('./meridian-engine.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const round1 = v => Math.round(v * 10) / 10;

/* Each round is two years, so five rounds is a decade. */
const ROUNDS_PER_DECADE = 5;

/* ---------------------------------------------------------------------
   THE FLOOR
   ---------------------------------------------------------------------
   What it means for a society to have stopped working. Deliberately not
   "is doing badly" — a society can do badly for a long time and recover,
   and a simulation that ends the moment things get hard teaches
   fragility rather than governance.

   These are the conditions under which the state can no longer deliver
   the thing it exists to deliver.
   --------------------------------------------------------------------- */
const FLOOR = {
  worst_essential: 25,    // an essential service in name only
  purchasing_power: 30,   // the payment does not cover a life
  reserves_bn: 0          // insolvent
};

/* How long a breach must persist before it counts. One bad round is a
   shock; three consecutive is a condition. Six years of an essential
   service being gone is not a rough patch. */
const SUSTAIN = 3;

function worstEssential(s) {
  return Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
}

function ppOf(s) {
  return s.indicators.effective_ubi_index != null
    ? s.indicators.effective_ubi_index : s.indicators.real_ubi_index;
}

/* ---------------------------------------------------------------------
   COLLAPSE
   ---------------------------------------------------------------------
   Returns the first round at which the society had been below the floor
   for SUSTAIN consecutive rounds, with the reason, or null.

   The reason matters more than the fact. "Insolvency in 2096" and
   "healthcare gone by 2074" are different failures of different
   governments, and a run that only reports `collapsed: true` throws away
   the whole lesson.
   --------------------------------------------------------------------- */
function collapse(traj, opts) {
  opts = opts || {};
  const floor = Object.assign({}, FLOOR, opts.floor || {});
  const sustain = opts.sustain || SUSTAIN;

  const breaches = { service: 0, purchasing_power: 0, insolvency: 0 };

  for (let i = 1; i < traj.length; i++) {
    const s = traj[i];

    const bad = {
      service: worstEssential(s) < floor.worst_essential,
      purchasing_power: ppOf(s) < floor.purchasing_power,
      insolvency: s.fiscal.reserves_bn < floor.reserves_bn
    };

    let found = null;
    Object.keys(bad).forEach(k => {
      breaches[k] = bad[k] ? breaches[k] + 1 : 0;
      if (!found && breaches[k] >= sustain) found = k;
    });

    if (found) {
      return {
        collapsed: true,
        round: s.meta.round,
        year: s.meta.year,
        reason: found,
        /* When it STARTED, not when we noticed. The society was already
           failing for `sustain` rounds before this call fired, and
           reporting the detection year would flatter the government by
           six years. */
        began_year: s.meta.year - (sustain - 1) * 2,
        detail: found === 'service'
          ? 'an essential service below ' + floor.worst_essential + ' for ' +
            (sustain * 2) + ' years'
          : found === 'purchasing_power'
            ? 'the payment below ' + floor.purchasing_power + ' for ' + (sustain * 2) + ' years'
            : 'insolvent for ' + (sustain * 2) + ' years'
      };
    }
  }
  return { collapsed: false, round: null, year: null, reason: null };
}

/* ---------------------------------------------------------------------
   STAGNATION
   ---------------------------------------------------------------------
   A separate condition, and a genuinely useful one for open-ended runs:
   nothing is changing any more. A collapsed society pinned at zero will
   sit there producing rounds forever, and a run that has stopped saying
   anything new should stop.

   This is not failure. A stable, healthy society also stagnates by this
   definition, which is correct — it has proved its point and further
   rounds add nothing.
   --------------------------------------------------------------------- */
function stagnant(traj, opts) {
  opts = opts || {};
  const window = opts.window || 5;
  const epsilon = opts.epsilon == null ? 0.5 : opts.epsilon;
  if (traj.length < window + 1) return { stagnant: false };

  const recent = traj.slice(-window);
  const pp = recent.map(ppOf);
  const svc = recent.map(worstEssential);
  const spread = xs => Math.max.apply(null, xs) - Math.min.apply(null, xs);

  if (spread(pp) <= epsilon && spread(svc) <= epsilon) {
    const last = traj[traj.length - 1];
    return {
      stagnant: true,
      since_year: recent[0].meta.year,
      year: last.meta.year,
      healthy: ppOf(last) >= 90 && worstEssential(last) >= 55,
      detail: 'nothing has moved in ' + (window * 2) + ' years'
    };
  }
  return { stagnant: false };
}

/* ---------------------------------------------------------------------
   DECADES
   ---------------------------------------------------------------------
   The same metrics, per ten-year window. This is the artefact a student
   should put in front of a judge: not "we scored 74" but "here is what
   our society looked like in each of six decades, and here is why the
   fourth one dips".
   --------------------------------------------------------------------- */
function decades(traj) {
  const out = [];
  // Round 1 is the sealed opening settlement and is 100 by definition.
  for (let start = 1; start < traj.length; start += ROUNDS_PER_DECADE) {
    const slice = traj.slice(start, start + ROUNDS_PER_DECADE);
    if (!slice.length) break;

    const pp = slice.map(ppOf);
    const svc = slice.map(worstEssential);

    out.push({
      from_year: slice[0].meta.year,
      to_year: slice[slice.length - 1].meta.year,
      rounds: slice.length,
      /* Partial decades are flagged rather than silently averaged in.
         A three-round tail read as a decade would let a run end on a
         good year and call it a good decade. */
      complete: slice.length === ROUNDS_PER_DECADE,

      purchasing_power: round1(mean(pp)),
      purchasing_power_low: Math.round(Math.min.apply(null, pp)),
      worst_service: Math.round(Math.min.apply(null, svc)),
      mean_service: round1(mean(svc)),
      cohesion: Math.round(mean(slice.map(s => s.indicators.cohesion))),
      legitimacy: Math.round(mean(slice.map(s => s.indicators.legitimacy))),
      gini: round1(mean(slice.map(s => s.indicators.gini))),
      reserves_end_bn: round1(slice[slice.length - 1].fiscal.reserves_bn)
    });
  }
  return out;
}

/* ---------------------------------------------------------------------
   TREND
   ---------------------------------------------------------------------
   Is this government's society getting better or worse, decade on
   decade? The whole reason for open-ended runs is to answer this, and
   it should be a number rather than an impression formed from a chart.

   Compares the first complete decade with the last complete one. A
   government whose second half is worse than its first was living off
   something it inherited.
   --------------------------------------------------------------------- */
function trend(traj) {
  const d = decades(traj).filter(x => x.complete);
  if (d.length < 2) {
    /* Always carry a `verdict`, even when there is nothing to judge.
       A caller printing `trend.verdict` should get "not measurable"
       rather than `undefined`, which reads as a bug in their code. */
    return { measurable: false, verdict: 'not measurable', decades: d.length,
             note: 'needs two complete decades (' + (ROUNDS_PER_DECADE * 2) +
                   ' years each); this run has ' + d.length };
  }
  const first = d[0], last = d[d.length - 1];
  const dpp = round1(last.purchasing_power - first.purchasing_power);
  const dsvc = Math.round(last.worst_service - first.worst_service);

  return {
    measurable: true,
    decades: d.length,
    purchasing_power_change: dpp,
    worst_service_change: dsvc,
    /* "Held" is the interesting verdict and the hardest to achieve: a
       society that neither decays nor is propped up by drawing down
       what it started with. */
    verdict: (dpp >= -3 && dsvc >= -3) ? (dpp > 5 || dsvc > 5 ? 'improving' : 'held')
           : (dpp < -15 || dsvc < -15) ? 'decaying badly' : 'decaying',
    from: first.from_year + '-' + first.to_year,
    to: last.from_year + '-' + last.to_year
  };
}

/* ---------------------------------------------------------------------
   THE WHOLE PICTURE
   ---------------------------------------------------------------------
   What a long run should report instead of a single number.
   --------------------------------------------------------------------- */
function report(traj, constitution) {
  const col = collapse(traj);
  const stag = stagnant(traj);
  const first = traj[0], last = traj[traj.length - 1];

  const endYear = col.collapsed ? col.year : last.meta.year;
  const survived = endYear - first.meta.year;

  return {
    from_year: first.meta.year,
    to_year: last.meta.year,
    rounds: traj.length,
    years: last.meta.year - first.meta.year,

    /* The headline for an open-ended run. */
    survived_years: survived,
    collapse: col,
    stagnation: stag,

    decades: decades(traj),
    trend: trend(traj),

    /* Kept, with its limitation stated in the payload rather than in a
       comment nobody reads. A caller comparing two runs of different
       lengths on this number is making a mistake, and now has to ignore
       a field saying so to make it. */
    score: E.score(traj, constitution),
    score_note: 'comparable only between runs of equal length; ' +
                'use `decades` and `trend` across lengths'
  };
}

/** Should an open-ended run stop here? */
function shouldStop(traj, opts) {
  opts = opts || {};
  const maxRounds = opts.maxRounds || 200;   // a hard backstop, not a design limit
  if (traj.length >= maxRounds) {
    return { stop: true, why: 'reached the backstop of ' + maxRounds + ' rounds' };
  }
  const col = collapse(traj, opts);
  if (col.collapsed) {
    return { stop: true, why: 'collapse: ' + col.detail + ' (' + col.year + ')', collapse: col };
  }
  if (opts.stopWhenStagnant !== false) {
    const stag = stagnant(traj, opts);
    if (stag.stagnant) {
      return { stop: true,
               why: (stag.healthy ? 'stable: ' : 'stalled: ') + stag.detail,
               stagnation: stag };
    }
  }
  return { stop: false };
}

module.exports = { collapse, stagnant, decades, trend, report, shouldStop,
                   worstEssential, FLOOR, SUSTAIN, ROUNDS_PER_DECADE };
