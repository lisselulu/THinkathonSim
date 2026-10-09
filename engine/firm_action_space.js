/* =====================================================================
   WHAT AN INDUSTRY MAY DECIDE TO DO
   ---------------------------------------------------------------------
   The citizens' action space asks "what do you do about your life". This
   one asks "what do you do about your business", and it is deliberately
   the same SHAPE — same fields, same `needs` predicates, same
   `consequence` block — so it flows through `admissible()` and the
   decider contract without either learning a second format.

   WHAT A FIRM IS OPTIMISING
   -------------------------
   Not profit. Its MISSION, from `sector_missions.js`, of which margin is
   one input and never the whole of it. A hospital that is profitable and
   turning people away has failed at the thing it is for; so has a bank
   that is enormously profitable and lending to nobody.

   That is also what stops this being a second citizen corpus with a
   different vocabulary: a firm and a citizen in the same sector want
   genuinely different things, and the interesting runs are the ones
   where those pull apart.

   THE GOVERNMENT SETS A CEILING, NOT A TARGET
   -------------------------------------------
   `invest_automation` moves toward the ceiling and can never pass it.
   A team that sets 95% and watches firms stop at 60% is reading a
   finding — the levy made it unprofitable — and the studio has to say so
   or it reads as breakage.
   ===================================================================== */

'use strict';

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* Per-round step sizes. Small on purpose: a firm adjusts, it does not
   reinvent itself every two years, and the diffusion curve caps how fast
   automation can actually move anyway. */
const STEP = { automation: 0.12, headcount: 0.08, capacity: 0.06 };

const ACTIONS = {
  /* ---- the automation decision -------------------------------------- */
  invest_automation: {
    family: 'invest', label: 'automating further', tone: 'mid',
    intent: 'putting money into machines that do more of the work',
    option: 'Invest in automation. Push further toward what the regulator allows.',
    /* You cannot invest out of a loss forever. This is the predicate that
       makes the compute levy and the corporate tax rate bite on
       BEHAVIOUR rather than only on the accounts. */
    /* Relative to this industry's own calibrated margin. */
    needs: { margin: -0.02 },
    consequence: { automation: +STEP.automation, capacity: -0.02 }
  },
  hold: {
    family: 'steady', label: 'holding the line', tone: 'quiet',
    intent: 'changing nothing and seeing how the year goes',
    option: 'Hold. Change nothing this round.',
    needs: {}, consequence: {}
  },
  divest_automation: {
    family: 'invest', label: 'pulling back from automation', tone: 'mid',
    intent: 'winding back machines and putting people back on the work',
    option: 'Pull back from automation. Put people back on the work.',
    needs: {},
    consequence: { automation: -STEP.automation, headcount: +0.04 }
  },

  /* ---- the labour decision ------------------------------------------ */
  hire: {
    family: 'labour', label: 'hiring', tone: 'good',
    intent: 'taking people on because there is work for them',
    needs: { margin: 0.0 },
    option: 'Hire. There is work here for more people than are doing it.',
    consequence: { headcount: +STEP.headcount, capacity: +0.03 }
  },
  lay_off: {
    family: 'labour', label: 'laying off', tone: 'bad',
    intent: 'cutting headcount to protect the margin',
    option: 'Lay people off. The wage bill is what is killing us.',
    needs: {},
    consequence: { headcount: -STEP.headcount, capacity: -0.02, legitimacy: -1 }
  },

  /* ---- the capacity decision ---------------------------------------- */
  expand_capacity: {
    family: 'capacity', label: 'building', tone: 'good',
    intent: 'building more of whatever this industry runs on',
    option: 'Build. More plant, more lines, more of whatever we run on.',
    /* Building is expensive and slow, which is why an industry that has
       been squeezed for years cannot simply build its way out. */
    needs: { margin: 0.03 },
    consequence: { capacity: +STEP.capacity, reserves_bn: -0.6 }
  },
  cut_costs: {
    family: 'capacity', label: 'cutting costs', tone: 'bad',
    intent: 'trimming everything that is not immediately necessary',
    option: 'Cut costs. Defer the maintenance, trim what nobody will miss this year.',
    needs: {},
    /* The classic false economy, and the reason it is here: it protects
       the margin this round and costs capacity for several. */
    consequence: { capacity: -0.05, cohesion: -1 }
  },

  /* ---- the political decision --------------------------------------- */
  lobby: {
    family: 'political', label: 'lobbying', tone: 'bad',
    intent: 'pressing the government to lift the limits on us',
    option: 'Lobby. Press the government to lift the limits on what we may do.',
    needs: {},
    /* Lobbying does NOT raise the ceiling. A firm may spend legitimacy
       asking; whether the ceiling moves is the government's decision and
       belongs to the cabinet, not to this table. Modelling it as
       automatically effective would hand industry a lever over policy
       that no mechanism in the simulation justifies. */
    consequence: { legitimacy: -3 }
  }
};

const KEYS = Object.keys(ACTIONS);
const FAMILIES = KEYS.reduce((o, k) => {
  (o[ACTIONS[k].family] = o[ACTIONS[k].family] || []).push(k);
  return o;
}, {});

/* ---------------------------------------------------------------------
   ADMISSIBILITY
   ---------------------------------------------------------------------
   Circumstance, never judgement. A loss-making firm that decides to
   build has made a coherent decision it cannot finance.
   --------------------------------------------------------------------- */
function admissible(key, ctx) {
  const a = ACTIONS[key];
  if (!a) return { key: 'hold', redirected: 'unknown action "' + key + '"' };
  const n = a.needs || {};

  /* MARGIN IS JUDGED AGAINST WHAT THIS INDUSTRY NORMALLY RUNS AT, not
     against zero. Care services are calibrated to -0.09 and education to
     -0.04 — they are subsidised by design, not failing — and an absolute
     test meant they could never invest or hire however well they were
     doing, which quietly made the two most human-intensive industries
     incapable of anything but cutting. */
  const relative = (ctx.margin == null ? 0 : ctx.margin) -
                   (ctx.baselineMargin == null ? 0 : ctx.baselineMargin);
  if (n.margin != null && relative < n.margin) {
    /* Cannot afford to grow. What a squeezed firm does instead is cut,
       which is exactly the behaviour that makes a downturn compound. */
    return { key: 'cut_costs', redirected: key + ' needs a margin it does not have' };
  }
  if (key === 'invest_automation' && ctx.atCeiling) {
    return { key: 'hold', redirected: 'already at the ceiling the regulator set' };
  }
  if (key === 'hire' && ctx.noLabour) {
    return { key: 'hold', redirected: 'nobody left to hire' };
  }
  return { key: key, redirected: null };
}

/* ---------------------------------------------------------------------
   CONSEQUENCE
   ---------------------------------------------------------------------
   One decision per sector, so unlike the citizen version there is no
   population weighting: a sector's decision applies to that sector.
   Returns the exogenous shape the engine already accepts, plus the
   `firms` block that carries the chosen automation level.
   --------------------------------------------------------------------- */
function consequences(decisions) {
  const out = { capacity: {}, headcount: {}, firms: {},
                cohesion_bonus: 0, legitimacy_bonus: 0, reserves_bn: 0 };

  (decisions || []).forEach(d => {
    const a = ACTIONS[d.key];
    if (!a) return;
    const c = a.consequence || {};
    const k = d.sector;

    /* EVERY decision states a level, including the ones that change
       nothing.
       ------------------------------------------------------------------
       Only the investing actions used to emit `firms[k]`, so a firm that
       chose `hold` said nothing — and the engine reads silence as "no
       firm decision here", falls back to treating the lever as a target,
       and climbs anyway. A firm that had decided to stop watched its own
       automation keep rising, which made the ceiling unfalsifiable: it
       could never bind, because declining to invest was indistinguishable
       from not being asked. */
    const delta = c.automation == null ? 0 : c.automation;
    const ceiling = d.ceiling == null ? 0.98 : d.ceiling;
    out.firms[k] = out.firms[k] || {};
    out.firms[k].automation = clamp(
      (d.automation == null ? 0 : d.automation) + delta, 0, ceiling);
    if (c.capacity) out.capacity[k] = (out.capacity[k] == null ? 1 : out.capacity[k]) + c.capacity;
    if (c.headcount) out.headcount[k] = (out.headcount[k] == null ? 1 : out.headcount[k]) + c.headcount;
    if (c.cohesion) out.cohesion_bonus += c.cohesion;
    if (c.legitimacy) out.legitimacy_bonus += c.legitimacy;
    if (c.reserves_bn) out.reserves_bn += c.reserves_bn;
  });

  // Floors, for the same reason the citizen table has them.
  Object.keys(out.capacity).forEach(k => { out.capacity[k] = Math.max(0.60, out.capacity[k]); });
  Object.keys(out.headcount).forEach(k => { out.headcount[k] = Math.max(0.70, out.headcount[k]); });
  out.cohesion_bonus = Math.round(out.cohesion_bonus * 10) / 10;
  out.legitimacy_bonus = Math.round(out.legitimacy_bonus * 10) / 10;
  out.reserves_bn = Math.round(out.reserves_bn * 100) / 100;
  return out;
}

/** The menu an industry agent chooses from. */
function menu() {
  return KEYS.map(k => ({
    key: k, family: ACTIONS[k].family, label: ACTIONS[k].label, option: ACTIONS[k].option
  }));
}

module.exports = { ACTIONS, KEYS, FAMILIES, STEP, admissible, consequences, menu };
