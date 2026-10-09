/* =====================================================================
   THREE REFERENCE HARNESSES
   ---------------------------------------------------------------------
   Three governments with three different theories of what a society is
   for. Each is deliberately simple and fully deterministic — they exist
   so the tournament can be verified without a model API, and so students
   have a floor to beat rather than a blank file.

   Read them as worked examples of the contract, not as good government.
   Any of them can be beaten by a team that thinks harder.

   A harness is a function of the world. That is the entire interface:

       harness(ctx) -> { levers, rationale, invokes }

   `rationale` is read by judges, not by the engine. `invokes` names the
   constitutional commitment the decision rests on, so the auditor can
   check whether a government did what it said it would.
   ===================================================================== */

const E = require('../meridian-engine.js');
const { tradePolicy } = require('./trade-policy.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const worstOf = s => Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));

/* ---------------------------------------------------------------------
   ACCELERATE — "the fastest route to abundance is abundance"
   ---------------------------------------------------------------------
   Automate everything as fast as the levers allow, tax the result hard,
   and pay it out. Growth first; the distribution problem is assumed to
   solve itself once the pie is large enough.
   --------------------------------------------------------------------- */
function accelerate(ctx) {
  const target = {};
  E.ORDER.forEach(k => { target[k] = 0.95; });
  return {
    levers: {
      automation_target: target,
      corporate_tax_rate: 0.34,
      compute_levy: 0.10,
      allocation: { ubi: 0.70, infrastructure: 0.22, reserves: 0.08 },
      ubi_design: 'flat',
      reskilling_spend_pct: 0.04,
      public_ownership_pct: 0.09,
      working_week_days: 5,
      care_job_guarantee: false
    },
    rationale: 'Take every point of productivity available and convert it to cash in hand.',
    invokes: 0,
    ...tradePolicy(ctx, 'extractive')
  };
}

/* ---------------------------------------------------------------------
   GUARDIAN — "a service you cannot use is not a service"
   ---------------------------------------------------------------------
   Automates freely where output scales with machines, and refuses to
   automate the sectors where the service IS the human contact. Owns a
   third of the machines. Runs a four-day week and a care job guarantee.
   Fixed doctrine: it does not react, it commits.
   --------------------------------------------------------------------- */
function guardian(ctx) {
  const target = {
    healthcare: 0.55, care_services: 0.20, education_research: 0.31,
    transport_logistics: 0.89, energy_utilities: 0.84, compute_telecom: 0.86,
    housing_construction: 0.74, food_agri: 0.72, manufacturing: 0.92,
    finance: 0.93, retail_commerce: 0.91, public_admin: 0.60, public_safety: 0.52
  };
  return {
    levers: {
      automation_target: target,
      corporate_tax_rate: 0.28,
      compute_levy: 0.16,
      allocation: { ubi: 0.48, infrastructure: 0.36, reserves: 0.16 },
      ubi_design: 'age_weighted',
      reskilling_spend_pct: 0.12,
      public_ownership_pct: 0.35,
      working_week_days: 4,
      care_job_guarantee: true
    },
    rationale: 'Automate where output scales. Withhold where the service is the person delivering it.',
    invokes: 0,
    ...tradePolicy(ctx, 'protective')
  };
}

/* ---------------------------------------------------------------------
   STEWARD — "govern the worst number on the board"
   ---------------------------------------------------------------------
   The only reference harness that actually reads the world. It holds a
   doctrine and then adjusts every round against whichever constraint is
   currently binding: failing services, a thin reserve, falling
   purchasing power, or cohesion coming apart.

   This is the shape a student harness should take. An LLM version reads
   the same signals and reasons about them in language instead of in
   if-statements — and can weigh several at once, which this cannot.
   --------------------------------------------------------------------- */
function steward(ctx) {
  const s = ctx.state;
  const L = JSON.parse(JSON.stringify(ctx.levers));
  const worst = worstOf(s);
  const ind = s.indicators;
  const why = [];

  // Opening doctrine, set once.
  if (ctx.round === 2) {
    const t = {
      /* The grid and the network are automated HARDER than the sectors
         that draw on them. Splitting compute from energy made this a
         real choice: automating the economy raises compute demand, and a
         government that does not build the supply to meet it watches its
         own service floor fail. Guardian at 0.86 on the grid broke its
         own no-service-failure rule in the last three rounds. */
      healthcare: 0.52, care_services: 0.18, education_research: 0.30,
      transport_logistics: 0.86, energy_utilities: 0.94, compute_telecom: 0.94,
      housing_construction: 0.70, food_agri: 0.68, manufacturing: 0.84,
      finance: 0.90, retail_commerce: 0.86, public_admin: 0.56, public_safety: 0.50
    };
    L.automation_target = t;
    L.corporate_tax_rate = 0.27;
    L.compute_levy = 0.14;
    L.allocation = { ubi: 0.46, infrastructure: 0.38, reserves: 0.16 };
    L.ubi_design = 'age_weighted';
    L.reskilling_spend_pct = 0.12;
    L.public_ownership_pct = 0.38;
    L.working_week_days = 4;
    L.care_job_guarantee = true;
    why.push('Opening doctrine set.');
  }

  // 1. A failing service outranks everything. It is 20 marks and a gate.
  if (worst < 62) {
    const a = L.allocation;
    const shift = worst < 48 ? 0.09 : 0.05;
    const take = Math.min(shift, Math.max(0, a.ubi - 0.30));
    L.allocation = {
      ubi: a.ubi - take,
      infrastructure: a.infrastructure + take,
      reserves: a.reserves
    };
    // Pull back automation in whichever essential sector is worst.
    const k = E.ESSENTIAL.find(x => s.sectors[x].quality === worst);
    if (k && E.SECTORS[k].human_touch > 0.4) {
      L.automation_target[k] = clamp(L.automation_target[k] - 0.10, 0, 0.98);
      why.push(E.SECTORS[k].name + ' at ' + worst + ': pulled automation back and moved ' +
        Math.round(take * 100) + ' points of budget into infrastructure.');
    } else {
      why.push('Worst essential service at ' + worst + ': moved budget into infrastructure.');
    }
  }

  // 2. A thin reserve is how a shock becomes a gate.
  if (s.fiscal.reserves_bn < 45) {
    const a = L.allocation;
    const take = Math.min(0.06, Math.max(0, a.ubi - 0.28));
    L.allocation = { ubi: a.ubi - take, infrastructure: a.infrastructure, reserves: a.reserves + take };
    why.push('Reserves at $' + Math.round(s.fiscal.reserves_bn) + 'bn: rebuilding the buffer.');
  }

  // 3. Services healthy and the reserve deep? Then the cash can rise.
  if (worst >= 72 && s.fiscal.reserves_bn > 140 && ind.effective_ubi_index < 150) {
    const a = L.allocation;
    const give = Math.min(0.05, a.reserves - 0.10, a.infrastructure - 0.28);
    if (give > 0) {
      L.allocation = { ubi: a.ubi + give, infrastructure: a.infrastructure - give * 0.5,
                       reserves: a.reserves - give * 0.5 };
      why.push('Services healthy and reserves deep: raising the payment.');
    }
  }

  // 4. Cohesion coming apart is a political emergency, not an economic one.
  if (ind.cohesion < 48) {
    L.care_job_guarantee = true;
    L.working_week_days = 4;
    L.reskilling_spend_pct = clamp(L.reskilling_spend_pct + 0.03, 0, 0.30);
    why.push('Cohesion at ' + ind.cohesion + ': work guarantee on, week held at four days.');
  }

  // 5. Own more of the machines while the profit base still supports it.
  if (ind.employment_rate < 0.45 && L.public_ownership_pct < 0.45) {
    L.public_ownership_pct = clamp(L.public_ownership_pct + 0.03, 0, 0.50);
    why.push('Wages are thinning: taking a larger share of the machines.');
  }

  // 6. Compute is the bill attached to everything else. Do not let it fail.
  if (s.sectors.energy_utilities.capacity < 0.85) {
    E.ORDER.forEach(k => {
      if (k !== 'energy_utilities') L.automation_target[k] = clamp(L.automation_target[k] - 0.03, 0, 0.98);
    });
    L.automation_target.energy_utilities = 0.92;
    why.push('The grid at ' + Math.round(s.sectors.energy_utilities.capacity * 100) +
      '% of demand: easing adoption elsewhere until it catches up.');
  }

  const trade = tradePolicy(ctx, 'reciprocal');
  if (trade.tradeNotes && trade.tradeNotes.length) why.push('Trade: ' + trade.tradeNotes.join(', ') + '.');

  return {
    levers: L,
    rationale: why.join(' ') || 'Holding. No constraint binding this round.',
    invokes: 0,
    ...trade
  };
}

/* ---------------------------------------------------------------------
   CONSTITUTIONS
   ---------------------------------------------------------------------
   `commitments` are prose, read by judges. `rules` are checkable, read
   by the auditor. Writing a rule that genuinely captures a commitment is
   the hardest and most valuable thing a team does in week one.
   --------------------------------------------------------------------- */
const CONSTITUTIONS = {
  accelerate: {
    name: 'The Abundance Declaration',
    commitments: [
      'Meridian takes every point of productivity that technology offers.',
      'The proceeds are returned to citizens as cash, without means test or condition.',
      'We do not protect work for its own sake.'
    ],
    rules: [
      { id: 'universal-cash', commitment: 1, when: 'always', assert: "levers.ubi_design == 'flat'" },
      { id: 'majority-to-cash', commitment: 1, when: 'always', assert: 'levers.allocation.ubi >= 0.6' },
      { id: 'no-make-work', commitment: 2, when: 'always', assert: 'levers.care_job_guarantee == false' }
    ],
    levers: { corporate_tax_rate: 0.34, compute_levy: 0.10, reskilling_spend_pct: 0.04,
              public_ownership_pct: 0.09, allocation: { ubi: 0.70 }, care_job_guarantee: false,
              working_week_days: 5 }
  },

  guardian: {
    name: 'The Guardian Compact',
    commitments: [
      'No essential service is allowed to fail. Ever, and for any reason.',
      'Care and education are never automated past the point where the person delivering them is the service.',
      'The public owns a meaningful share of the machines that replaced its wages.'
    ],
    rules: [
      { id: 'no-service-failure', commitment: 0, when: 'round > 2', assert: 'worstEssential >= 55' },
      { id: 'care-cap', commitment: 1, when: 'always', assert: 'levers.automation_target.care_services <= 0.25' },
      { id: 'education-cap', commitment: 1, when: 'always', assert: 'levers.automation_target.education_research <= 0.35' },
      { id: 'public-share', commitment: 2, when: 'round > 3', assert: 'levers.public_ownership_pct >= 0.30' }
    ],
    levers: { corporate_tax_rate: 0.28, compute_levy: 0.16, reskilling_spend_pct: 0.12,
              public_ownership_pct: 0.35, allocation: { ubi: 0.48 }, care_job_guarantee: true,
              working_week_days: 4 }
  },

  steward: {
    name: 'The Stewardship Charter',
    commitments: [
      'We govern the worst number on the board, not the headline one.',
      'The reserve is never spent to the point where a shock becomes a crisis.',
      'Care work is paid work, and there is always some of it available.'
    ],
    rules: [
      { id: 'worst-first', commitment: 0, when: 'round > 3', assert: 'worstEssential >= 60' },
      { id: 'buffer', commitment: 1, when: 'round > 2', assert: 'fiscal.reserves_bn >= 30' },
      { id: 'care-work', commitment: 2, when: 'round > 2', assert: 'levers.care_job_guarantee == true' }
    ],
    levers: { corporate_tax_rate: 0.27, compute_levy: 0.14, reskilling_spend_pct: 0.12,
              public_ownership_pct: 0.38, allocation: { ubi: 0.46 }, care_job_guarantee: true,
              working_week_days: 4 }
  }
};

module.exports = {
  harnesses: { accelerate, guardian, steward },
  CONSTITUTIONS,
  entries: [
    { name: 'Accelerate', harness: accelerate, constitution: CONSTITUTIONS.accelerate },
    { name: 'Guardian',   harness: guardian,   constitution: CONSTITUTIONS.guardian },
    { name: 'Steward',    harness: steward,    constitution: CONSTITUTIONS.steward }
  ]
};
