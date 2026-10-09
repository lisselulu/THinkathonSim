/* =====================================================================
   WHAT EACH INDUSTRY IS FOR
   ---------------------------------------------------------------------
   Every sector is scored out of 100 by ONE formula:

     target = Q_BASE + Q_CAPACITY·access + Q_INFRA·reliability
                     - Q_HUMAN·human_touch·overAutomation
                     + Q_STAFF·delivery + guarantee + friction

   Four dimensions, the same four for everybody, in the same proportions
   for everybody. Healthcare and Finance are judged identically apart
   from two coefficients. A hospital and a bank are not good at the same
   things and should not be measured as though they were.

   THE FIX, AND THE TRAP IN IT
   ---------------------------
   Each sector gets a MISSION and a scorecard of weighted dimensions. The
   obvious next step — letting each industry's agent decide what its own
   KPIs are — is the trap, and it is worth naming because it looks like
   more autonomy rather than less rigour. An agent that sets its own
   targets can declare success on transactions processed while the
   country starves, and no number anywhere would contradict it.

   So: the scorecard is AUTHORED HERE and measured deterministically from
   engine state. The agent's agency is in HOW it hits the targets, never
   in what they are. That keeps the score falsifiable, which is the only
   thing that makes it worth anything.

   THE OLD FORMULA IS A SPECIAL CASE
   ---------------------------------
   It is the scorecard where every sector weights the same four
   dimensions in the same proportions. Setting a sector's weights to
   mirror the global coefficients reproduces its old behaviour, which is
   what makes this safe to introduce gradually: `MISSION_WEIGHT` blends
   between the two and is zero until the blend has been looked at.

   WEIGHTS SUM TO 1 within a sector, so a scorecard is a statement about
   PRIORITY rather than about intensity. A sector cannot be made better
   simply by caring about more things.
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   THE DIMENSIONS
   ---------------------------------------------------------------------
   Each is a signal roughly in [-1, +1], computed from what the engine
   already has. `scale` converts a weight of 1.0 into a full-strength
   effect on the 100-point scale, and is set so that a sector weighting
   a dimension the way the old global formula implicitly did produces
   approximately its old number.
   --------------------------------------------------------------------- */
const DIMENSIONS = {
  access:       { scale: 120, blurb: 'is there enough of it for everyone asking' },
  delivery:     { scale:  80, blurb: 'are there enough people to actually deliver it' },
  humanity:     { scale: 400, blurb: 'is a person still doing the part that has to be a person' },
  reliability:  { scale: 100, blurb: 'is the infrastructure underneath it maintained' },
  affordability:{ scale:  60, blurb: 'can people pay for it without going without something else' },
  equity:       { scale:  70, blurb: 'when it is rationed, who goes without' }
};

/* ---------------------------------------------------------------------
   THE MISSIONS
   ---------------------------------------------------------------------
   The `mission` line is what the industry is FOR, in one sentence. It is
   read by a human, and in due course by that industry's agent, which is
   why it is written as an obligation rather than a description.
   --------------------------------------------------------------------- */
const MISSIONS = {
  healthcare: {
    mission: 'Everyone who needs care gets it in time, and nobody is ruined by needing it.',
    /* Access dominates because a hospital that turns people away has
       failed at the thing it is for, however good the care inside is. */
    kpi: { access: 0.34, humanity: 0.24, delivery: 0.18, equity: 0.16, reliability: 0.08 }
  },
  care_services: {
    mission: 'The people who cannot look after themselves are looked after, by someone who knows them.',
    /* The one sector where the human IS the service. Automate it past
       its comfort and there is nothing left worth measuring. */
    kpi: { humanity: 0.40, delivery: 0.24, access: 0.20, equity: 0.16 }
  },
  education_research: {
    mission: 'Every child becomes someone this economy still has a use for, and the country keeps learning things nobody knew.',
    kpi: { humanity: 0.28, delivery: 0.26, access: 0.22, equity: 0.14, reliability: 0.10 }
  },
  transport_logistics: {
    mission: 'People and goods get where they are going, on time, at a price that does not decide who travels.',
    kpi: { access: 0.34, reliability: 0.28, affordability: 0.20, delivery: 0.10, equity: 0.08 }
  },
  energy_utilities: {
    mission: 'The lights stay on, the water runs, and the bill does not choose between them.',
    /* Reliability and affordability, not margin. A grid that is
       profitable and intermittent has failed. */
    kpi: { reliability: 0.34, access: 0.28, affordability: 0.28, delivery: 0.10 }
  },
  compute_telecom: {
    mission: 'The network carries what the country asks of it, and asking more of it is not ruinous.',
    kpi: { access: 0.38, reliability: 0.30, affordability: 0.22, delivery: 0.10 }
  },
  housing_construction: {
    mission: 'Everyone has somewhere to live that they can afford and that is still standing in thirty years.',
    kpi: { affordability: 0.32, access: 0.28, reliability: 0.22, equity: 0.18 }
  },
  food_agri: {
    mission: 'Nobody goes hungry, and the city is not one shipping lane away from finding out it could.',
    kpi: { access: 0.32, affordability: 0.28, reliability: 0.22, equity: 0.18 }
  },
  manufacturing: {
    mission: 'The things this country needs can be made here, by an industry that is still here next decade.',
    kpi: { access: 0.36, reliability: 0.26, delivery: 0.20, affordability: 0.18 }
  },
  finance: {
    /* Scored on whether capital reaches the real economy, NOT on margin.
       A banking sector can be enormously profitable while starving
       everything it is supposed to fund. */
    mission: 'Capital reaches the people and firms that can use it, and the system survives its own bad years.',
    kpi: { reliability: 0.34, access: 0.30, equity: 0.22, delivery: 0.14 }
  },
  retail_commerce: {
    mission: 'People can buy what they need near where they live, at a price they can meet.',
    kpi: { affordability: 0.34, access: 0.30, delivery: 0.20, equity: 0.16 }
  },
  public_admin: {
    mission: 'The state can still do what it decides to do, and a citizen can find out why.',
    kpi: { delivery: 0.32, humanity: 0.26, reliability: 0.22, access: 0.20 }
  },
  public_safety: {
    mission: 'People are safe, and feel safe, without being policed into it.',
    kpi: { delivery: 0.30, humanity: 0.26, access: 0.24, equity: 0.20 }
  }
};

/* ---------------------------------------------------------------------
   VALIDATION
   ---------------------------------------------------------------------
   Weights that do not sum to 1 make a sector quietly easier or harder to
   score than its neighbours, which is exactly the kind of thing nobody
   notices until a team asks why their hospital is doing so well.
   --------------------------------------------------------------------- */
function validate(order) {
  const problems = [];
  (order || Object.keys(MISSIONS)).forEach(k => {
    const m = MISSIONS[k];
    if (!m) { problems.push(k + ' has no mission'); return; }
    if (!m.mission || m.mission.length < 20) problems.push(k + ' has no mission statement');
    const keys = Object.keys(m.kpi || {});
    if (!keys.length) { problems.push(k + ' has no KPI weights'); return; }
    keys.forEach(d => {
      if (!DIMENSIONS[d]) problems.push(k + ' weights an unknown dimension "' + d + '"');
    });
    const sum = keys.reduce((a, d) => a + m.kpi[d], 0);
    if (Math.abs(sum - 1) > 1e-9) {
      problems.push(k + ' KPI weights sum to ' + sum.toFixed(4) + ', not 1');
    }
  });
  Object.keys(MISSIONS).forEach(k => {
    if (order && order.indexOf(k) < 0) problems.push('mission for "' + k + '", which is not a sector');
  });
  return problems;
}

/**
 * Score one sector against its own mission.
 *
 * `signals` are the normalised dimension readings for this sector this
 * round. Returns the 0-100 target plus the per-dimension breakdown, so a
 * team can see WHICH part of the mission is failing rather than being
 * handed one number.
 */
function scoreAgainstMission(key, signals, base) {
  const m = MISSIONS[key];
  const parts = {};
  let total = base;
  if (!m) return { target: total, parts: parts, mission: null };

  Object.keys(m.kpi).forEach(d => {
    const dim = DIMENSIONS[d];
    if (!dim) return;
    const raw = signals[d] == null ? 0 : signals[d];
    const contribution = m.kpi[d] * dim.scale * raw;
    parts[d] = { weight: m.kpi[d], signal: raw, points: contribution };
    total += contribution;
  });

  return { target: total, parts: parts, mission: m.mission };
}

/** The weakest part of a sector's mission, for a report or a prompt. */
function weakest(parts) {
  const keys = Object.keys(parts || {});
  if (!keys.length) return null;
  const worst = keys.sort((a, b) => parts[a].points - parts[b].points)[0];
  return { dimension: worst, points: parts[worst].points,
           blurb: (DIMENSIONS[worst] || {}).blurb };
}

/* Dual export, the same shape market.js uses.
   The browser builds inline this file ahead of the engine, and the
   engine reads `window.MeridianMissions` when there is no `require`.
   A bare `module.exports` here threw in the browser and left MISSIONS
   null, which took every client-side page down at the first sector it
   tried to score. */
const API = { MISSIONS, DIMENSIONS, validate, scoreAgainstMission, weakest };
if (typeof window !== 'undefined') window.MeridianMissions = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
