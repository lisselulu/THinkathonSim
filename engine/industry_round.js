/* =====================================================================
   ONE ROUND OF INDUSTRY
   ---------------------------------------------------------------------
   Thirteen sector agents, deciding what to do about their business, in
   the same shape as the twelve citizens deciding what to do about their
   lives. Deliberately parallel: same decider contract, same
   observe/decide/check/price sequence, same honest-fallback discipline.

   WHAT MAKES THIS NOT A SECOND CITIZEN CORPUS
   -------------------------------------------
   A firm is optimising its MISSION, not its mood and not its margin. It
   is told what its industry is for, which dimension of that it is
   currently failing, and what it may legally do about it — and margin is
   one input to that, never the whole of it.

   The interesting runs are the ones where a firm's mission and its
   citizens' interests pull apart: a hospital that could protect its
   margin by automating past the point where the care is still care, and
   the cohorts who depend on it watching that happen.

   WHAT A FIRM MAY SEE
   -------------------
   Its own accounts, the prices it pays, the demand it faces, and the
   ceiling the government set. NOT the treasury, NOT the score, NOT the
   citizen feed. `assertBlind(text, 'firm')` enforces a different list
   from the citizens' — a firm that cannot read its own tax rate cannot
   run a business, and a firm that can read the national score is playing
   a game it is not in.
   ===================================================================== */

'use strict';

const E = require('./meridian-engine.js');
const FA = require('./firm_action_space.js');
const MIS = require('./sector_missions.js');
const L = require('./lived.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   HOW A SECTOR IS DOING, IN ITS OWN TERMS
   ---------------------------------------------------------------------
   Coarse words rather than numbers, for the same reason `lived.js` does
   it for citizens: a model handed `{"margin": 0.043}` reasons about a
   data structure, and one handed "thin, and thinner than last year"
   reasons about a business.
   --------------------------------------------------------------------- */
function marginFeel(m, baseline) {
  const d = m - baseline;
  if (d >= 0.08) return 'healthy, better than this industry usually manages';
  if (d >= 0.02) return 'comfortable';
  if (d >= -0.02) return 'about normal for this industry';
  if (d >= -0.08) return 'thin';
  return 'losing money on every unit we sell';
}

function demandFeel(capacity) {
  if (capacity <= 0.85) return 'we cannot meet what is being asked of us';
  if (capacity <= 0.98) return 'we are running close to flat out';
  if (capacity <= 1.15) return 'supply and demand are roughly matched';
  if (capacity <= 1.5) return 'we have more capacity than anyone is buying';
  return 'most of what we built is sitting idle';
}

function staffFeel(headcount, prevHeadcount) {
  const d = prevHeadcount > 0 ? headcount / prevHeadcount - 1 : 0;
  if (d > 0.03) return 'we took people on this year';
  if (d < -0.03) return 'we are smaller than we were';
  return 'headcount is about where it was';
}

/* ---------------------------------------------------------------------
   WHAT AN INDUSTRY IS SHOWN
   ---------------------------------------------------------------------
   Built field by field from nothing, the same discipline as
   `livedExperience`: a new indicator added upstream is invisible here
   until somebody deliberately exposes it.
   --------------------------------------------------------------------- */
function observationFor(k, prev, next, ctx) {
  const sector = next.sectors[k];
  const was = prev.sectors[k];
  const mission = MIS.MISSIONS[k];
  const baseline = (ctx && ctx.baselineMargin != null) ? ctx.baselineMargin : 0;

  return {
    id: k,
    name: E.SECTORS[k].name,
    role: 'the ' + E.SECTORS[k].name + ' industry of Meridian',
    /* The mission is the objective function, stated in words. It is
       AUTHORED, never chosen by the agent: an industry that sets its own
       targets can declare success while the country starves. */
    mission: mission ? mission.mission : null,
    what_we_are_judged_on: mission
      ? Object.keys(mission.kpi).sort((a, b) => mission.kpi[b] - mission.kpi[a])
          .map(d => d + ' (' + Math.round(mission.kpi[d] * 100) + '%)')
      : [],

    year: next.meta.year,
    margin_feels: marginFeel(sector.margin, baseline),
    demand_feels: demandFeel(sector.capacity),
    staff_feels: staffFeel(sector.headcount, was.headcount),

    automation_now: Math.round(sector.automation * 100),
    /* The ceiling, and how much room is left under it. This is the whole
       point of the ceiling reading: a firm knows what it is allowed to
       do and chooses within it. */
    automation_ceiling: ctx && ctx.ceiling != null ? Math.round(ctx.ceiling * 100) : 98,
    room_to_automate: ctx && ctx.ceiling != null
      ? Math.max(0, Math.round((ctx.ceiling - sector.automation) * 100)) : 0,

    /* The prices this industry actually pays. A firm reads these off its
       own invoices; a citizen may not see them. */
    energy_costs: ctx && ctx.energyPrice != null
      ? (ctx.energyPrice > 1.6 ? 'far more than they did and still climbing'
         : ctx.energyPrice > 1.15 ? 'noticeably more than they did'
         : 'about what they always did') : 'about what they always did',

    service_level: sector.quality,
    something_happened: (next.shocks || []).map(s => (E.SHOCKS[s] || {}).label || s),
    last_time_we: (ctx && ctx.prevKey) || null
  };
}

/* ---------------------------------------------------------------------
   THE DETERMINISTIC FIRM
   ---------------------------------------------------------------------
   The control, and what runs when the sidecar is down. It is a plain
   priority ladder, and like the citizens' it is the baseline the agents
   are measured against — so the difference between a run decided here
   and one decided by Concordia IS the contribution of firm agency.
   --------------------------------------------------------------------- */
function deterministicChoose(k, sector, ctx) {
  const baseline = ctx.baselineMargin;
  const margin = sector.margin;
  const room = ctx.ceiling - sector.automation;
  const trend = ctx.marginTrend == null ? 0 : ctx.marginTrend;
  /* What automating would COST. Compute and energy are the bill attached
     to every point of automation, and the levy is charged on top. A firm
     that ignored both would chase the ceiling however dear it got, which
     is exactly what the first version of this ladder did: it checked
     only "am I comfortable and is there room", so a punitive levy
     changed the RATE of adoption and never the DECISION. */
  const dear = (ctx.energyPrice == null ? 1 : ctx.energyPrice) > 1.35;

  // Losing money badly: cut, whatever else is true.
  if (margin < baseline - 0.10) return 'cut_costs';
  /* Investing into rising input costs and a falling margin is how a firm
     automates itself out of business. It stops instead. */
  if (dear && trend < -0.005) return margin > baseline ? 'hold' : 'cut_costs';
  // Cannot meet demand and can afford to build: build.
  if (sector.capacity < 0.95 && margin > baseline + 0.03) return 'expand_capacity';
  // Cannot meet demand, cannot afford to build, but may automate.
  if (sector.capacity < 0.95 && room > 0.05) return 'invest_automation';
  // Idle capacity and a thin margin: shed labour before plant.
  if (sector.capacity > 1.35 && margin < baseline) return 'lay_off';
  // Comfortable and constrained by the ceiling: press on it.
  if (margin > baseline + 0.06 && room <= 0.02) return 'lobby';
  // Comfortable with room: automate.
  if (margin > baseline + 0.02 && room > 0.05) return 'invest_automation';
  // Healthy and short-staffed for the demand: hire.
  if (margin > baseline && sector.capacity < 1.1) return 'hire';
  return 'hold';
}

function deterministic() {
  async function decide(batch) {
    const out = {};
    batch.forEach(b => { out[b.id] = deterministicChoose(b.id, b.sector, b.ctx); });
    return { choices: out, source: 'deterministic' };
  }
  decide.source = 'deterministic';
  return decide;
}

/* ---------------------------------------------------------------------
   THE ROUND
   ---------------------------------------------------------------------
     const r = await industryRound(prev, next, { decide, memory, levers });

   Returns { decisions, exogenous, memory, source, faults }.
   --------------------------------------------------------------------- */
async function industryRound(prev, next, opts) {
  opts = opts || {};
  const decide = opts.decide || deterministic();
  const memory = opts.memory || { prevKey: {} };
  memory.prevKey = memory.prevKey || {};
  const levers = opts.levers || next.levers || E.DEFAULT_LEVERS;
  const faults = [];

  const ceilingOf = k => {
    const src = (levers.automation_ceiling && levers.automation_ceiling[k] != null)
      ? levers.automation_ceiling : (levers.automation_target || {});
    const v = src[k];
    return typeof v === 'number' ? v : next.sectors[k].automation;
  };

  /* ---- 1. what each industry is living through --------------------- */
  const batch = E.ORDER.map(k => {
    const ctx = {
      ceiling: ceilingOf(k),
      /* Which way the margin is MOVING, not only where it is. A firm
         deciding whether to invest cares far more about the direction of
         its own accounts than about their level. */
      marginTrend: next.sectors[k].margin - prev.sectors[k].margin,
      baselineMargin: (E.R1_MARGINS && E.R1_MARGINS[k] != null) ? E.R1_MARGINS[k] : 0,
      energyPrice: next._computePrice == null ? 1 : next._computePrice,
      prevKey: memory.prevKey[k] || null
    };
    return {
      id: k, sector: next.sectors[k], ctx: ctx,
      observation: observationFor(k, prev, next, ctx)
    };
  });

  /* The guard, with the FIRM scope. A firm may read its own tax rate and
     the prices it pays; it may not read the treasury or the score. */
  try {
    batch.forEach(b => L.assertBlind(JSON.stringify(b.observation), 'firm'));
  } catch (err) {
    faults.push('blindness: ' + err.message);
    return finish(await deterministic()(batch), 'deterministic (blindness guard)');
  }

  /* ---- 2. they decide ---------------------------------------------- */
  let result;
  try {
    result = await decide(batch, { round: next.meta.round, year: next.meta.year });
  } catch (err) {
    faults.push('decider threw: ' + (err && err.message));
    result = await deterministic()(batch);
  }
  if (result.partial) result.partial.forEach(f => faults.push(f));

  return finish(result, result.source);

  /* ---- 3, 4, 5: admissibility, memory, consequence ----------------- */
  function finish(res, source) {
    const decisions = batch.map(b => {
      const asked = res.choices[b.id] || 'hold';
      const adm = FA.admissible(asked, {
        margin: b.sector.margin,
        baselineMargin: b.ctx.baselineMargin,
        atCeiling: (b.ctx.ceiling - b.sector.automation) <= 0.02,
        noLabour: false
      });
      if (adm.redirected) faults.push(b.id + ': ' + adm.redirected);

      const a = FA.ACTIONS[adm.key];
      return {
        sector: b.id, name: E.SECTORS[b.id].name,
        asked: asked, key: adm.key, redirected: adm.redirected,
        family: a.family, label: a.label, tone: a.tone,
        margin: b.sector.margin, capacity: b.sector.capacity,
        automation: b.sector.automation, ceiling: b.ctx.ceiling,
        mission: MIS.MISSIONS[b.id] ? MIS.MISSIONS[b.id].mission : null
      };
    });

    decisions.forEach(d => { memory.prevKey[d.sector] = d.key; });

    const exogenous = FA.consequences(decisions.map(d => ({
      sector: d.sector, key: d.key, automation: d.automation, ceiling: d.ceiling
    })));

    return {
      round: next.meta.round, year: next.meta.year,
      decisions: decisions, exogenous: exogenous, memory: memory,
      source: source || 'deterministic', faults: faults
    };
  }
}

/** Weighted share of industries taking each action, for a strip. */
function shares(decisions) {
  const out = {};
  decisions.forEach(d => { out[d.key] = (out[d.key] || 0) + 1; });
  return Object.keys(out)
    .sort((a, b) => out[b] - out[a])
    .map(k => ({ key: k, label: FA.ACTIONS[k].label,
                 count: out[k], share: Math.round(out[k] / decisions.length * 100) }));
}

module.exports = { industryRound, shares, observationFor, deterministic,
                   deterministicChoose, marginFeel, demandFeel };
