/* =====================================================================
   THE MERIDIAN SIMULATION — LAYER 1 ENGINE
   ---------------------------------------------------------------------
   world state + lever settings  ->  next world state

   Deterministic. There is no randomness anywhere in this file. Shocks are
   drawn by the facilitator from a sealed deck and passed IN as arguments.

   READ THIS FILE. You are meant to. Reason about it, argue with the
   constants, plan against it. You may not modify it during the run.

   THE ONE THING TO UNDERSTAND
   ---------------------------
   Nothing in here has an opinion about whether automation is good. The
   engine only does bookkeeping, and the bookkeeping forms a ring:

       automation removes headcount
         -> headcount is a wage bill
            -> wages are household income
               -> household income becomes consumption
                  -> consumption is the demand sectors sell into
                     -> sales are the profit you tax
                        -> tax funds the UBI that replaced the wages

   Margins, profit, GDP, quality and cohesion are all DERIVED from that
   ring. The demand cliff is not written down anywhere as a rule. It is
   what happens when you go round the ring enough times.

   The single most important line in this file is marked THE CLIFF.
   ===================================================================== */

(function (root) {
'use strict';

/* ---------------------------------------------------------------------
   0. HELPERS
   --------------------------------------------------------------------- */
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const lerp = (a, b, t) => a + (b - a) * t;
const round2 = v => Math.round(v * 100) / 100;
const deepClone = o => JSON.parse(JSON.stringify(o));

/* ---------------------------------------------------------------------
   1. EXOGENOUS DEMOGRAPHY
   ---------------------------------------------------------------------
   Population is not a lever. Singapore 2050-2074 ages and shrinks
   whatever you do. Anchored to the published baseline, interpolated
   between anchors.

   This is the ground the whole simulation stands on: demand for care and
   healthcare climbs every round while the working-age base that could
   staff it falls every round.
   --------------------------------------------------------------------- */
const DEMOGRAPHY_ANCHORS = [
  { round: 1,  total: 5940000, age_0_19: 950000, age_20_64: 3325000, age_65_plus: 1665000 },
  { round: 5,  total: 5830000, age_0_19: 900000, age_20_64: 3150000, age_65_plus: 1780000 },
  { round: 6,  total: 5780000, age_0_19: 880000, age_20_64: 3090000, age_65_plus: 1810000 },
  { round: 10, total: 5650000, age_0_19: 790000, age_20_64: 2910000, age_65_plus: 1950000 },
  { round: 12, total: 5520000, age_0_19: 810000, age_20_64: 2760000, age_65_plus: 1950000 }
];

/* Beyond the last anchor the published projection runs out and we are
   on our own. Holding the final anchor flat -- which is what this did --
   means a hundred-year run has a static population and the ageing
   crisis simply stops deepening, quietly making long runs easier than
   short ones.

   Instead the final observed trend continues, damped toward zero over
   about three decades, with floors. Damping rather than straight-line
   extrapolation because a linear continuation eventually produces
   negative children; a demographic transition decelerates as it
   completes. This is EXTRAPOLATION, not projection, and anything past
   round 12 should be read as "the trend, continued" rather than as a
   forecast. */
/* ---------------------------------------------------------------------
   DEMOGRAPHY THAT RESPONDS TO WHAT HAPPENS
   ---------------------------------------------------------------------
   The anchor curve is the population a society would have if nothing it
   did mattered. `exogenous.demography` is what agents decided instead:
   households choosing to have children or not, people emigrating and
   arriving. And when agents are deciding, old-age mortality answers to
   the health service, because that is physics, not a choice.

   The divergence from the anchor is carried as `_popAdjust` and only
   exists once something has diverged, so a run with no agents produces
   exactly the states it always did.
   --------------------------------------------------------------------- */
function adjustDemography(anchor, prev, d) {
  const adjIn = prev && prev._popAdjust ? prev._popAdjust : null;
  if (!adjIn && !d) return anchor;
  const adj = {
    age_0_19: adjIn ? adjIn.age_0_19 : 0,
    age_20_64: adjIn ? adjIn.age_20_64 : 0,
    age_65_plus: adjIn ? adjIn.age_65_plus : 0
  };
  if (d) {
    const years = 2;
    const birthsMult = clamp(Number(d.births_mult == null ? 1 : d.births_mult) || 0, 0.3, 2);
    adj.age_0_19 += Math.round((birthsMult - 1) * P.BIRTHS_PER_ROUND);
    const moved = (Number(d.immigration) || 0) - (Number(d.emigration) || 0);
    adj.age_20_64 += Math.round(clamp(moved, -400000, 400000));
    const hq = (prev && prev.sectors && prev.sectors.healthcare)
      ? prev.sectors.healthcare.quality : P.Q_BASE;
    const failure = clamp((60 - hq) / 60, 0, 1);
    const elders = (prev && prev.population) ? prev.population.by_age.age_65_plus : anchor.age_65_plus;
    adj.age_65_plus -= Math.round(elders * MORTALITY_65_PLUS * years * P.HEALTH_MORTALITY_SENS * failure);
  }
  const out = {
    round: anchor.round,
    age_0_19: Math.max(0, anchor.age_0_19 + adj.age_0_19),
    age_20_64: Math.max(0, anchor.age_20_64 + adj.age_20_64),
    age_65_plus: Math.max(0, anchor.age_65_plus + adj.age_65_plus)
  };
  out.total = out.age_0_19 + out.age_20_64 + out.age_65_plus;
  out._adj = adj;
  return out;
}

/* Demography under ticks. What people decided (children, leaving) arrives
   tick by tick and is HELD until the yearly refresh, then applied once, so
   a departure is never counted twice and never lost. `k` is the stretch
   of time the refresh covers, in two-year rounds. */
function demographyTick(prev, d, tNext, due, k) {
  const was = prev._demoPending || { births: 0, n: 0, emigration: 0, immigration: 0 };
  const pending = { births: was.births, n: was.n, emigration: was.emigration, immigration: was.immigration };
  if (d) {
    pending.births += clamp(Number(d.births_mult == null ? 1 : d.births_mult) || 0, 0.3, 2);
    pending.n += 1;
    pending.emigration += Number(d.emigration) || 0;
    pending.immigration += Number(d.immigration) || 0;
  }
  if (!due) {
    const b = prev.population.by_age;
    return { total: prev.population.total, age_0_19: b.age_0_19, age_20_64: b.age_20_64, age_65_plus: b.age_65_plus,
             _adj: prev._popAdjust || null, _pending: pending };
  }
  const anchor = demography(1 + tNext / 2);
  const adjIn = prev._popAdjust || null;
  const acted = pending.n > 0;
  if (!adjIn && !acted) return Object.assign({}, anchor, { _adj: null, _pending: { births: 0, n: 0, emigration: 0, immigration: 0 } });
  const adj = {
    age_0_19: adjIn ? adjIn.age_0_19 : 0, age_20_64: adjIn ? adjIn.age_20_64 : 0, age_65_plus: adjIn ? adjIn.age_65_plus : 0
  };
  if (acted) {
    adj.age_0_19 += Math.round((pending.births / pending.n - 1) * P.BIRTHS_PER_ROUND * k);
    adj.age_20_64 += Math.round(clamp(pending.immigration - pending.emigration, -400000, 400000));
    const hq = prev.sectors.healthcare ? prev.sectors.healthcare.quality : P.Q_BASE;
    const failure = clamp((60 - hq) / 60, 0, 1);
    adj.age_65_plus -= Math.round(prev.population.by_age.age_65_plus * MORTALITY_65_PLUS * 2 * k * P.HEALTH_MORTALITY_SENS * failure);
  }
  const out = {
    age_0_19: Math.max(0, anchor.age_0_19 + adj.age_0_19),
    age_20_64: Math.max(0, anchor.age_20_64 + adj.age_20_64),
    age_65_plus: Math.max(0, anchor.age_65_plus + adj.age_65_plus)
  };
  out.total = out.age_0_19 + out.age_20_64 + out.age_65_plus;
  out._adj = adj;
  out._pending = { births: 0, n: 0, emigration: 0, immigration: 0 };
  return out;
}

function demography(rnd) {
  const a = DEMOGRAPHY_ANCHORS;
  if (rnd <= a[0].round) return Object.assign({}, a[0]);

  const last = a[a.length - 1], prev = a[a.length - 2];
  if (rnd > last.round) {
    const span = last.round - prev.round;
    const beyond = rnd - last.round;
    /* Each additional round contributes less than the one before, so the
       cumulative move converges instead of running away. */
    const HALF_LIFE = 15;               // rounds, ~30 years
    const damped = HALF_LIFE * (1 - Math.pow(0.5, beyond / HALF_LIFE));
    const step = k => (last[k] - prev[k]) / span * damped;
    const out = {
      round: rnd,
      age_0_19:    Math.max(250000, Math.round(last.age_0_19 + step('age_0_19'))),
      age_20_64:   Math.max(800000, Math.round(last.age_20_64 + step('age_20_64'))),
      age_65_plus: Math.max(400000, Math.round(last.age_65_plus + step('age_65_plus')))
    };
    out.total = out.age_0_19 + out.age_20_64 + out.age_65_plus;
    return out;
  }
  if (rnd === last.round) return Object.assign({}, last);
  for (let i = 0; i < a.length - 1; i++) {
    if (rnd >= a[i].round && rnd <= a[i + 1].round) {
      const t = (rnd - a[i].round) / (a[i + 1].round - a[i].round);
      return {
        round: rnd,
        total:       Math.round(lerp(a[i].total,       a[i + 1].total,       t)),
        age_0_19:    Math.round(lerp(a[i].age_0_19,    a[i + 1].age_0_19,    t)),
        age_20_64:   Math.round(lerp(a[i].age_20_64,   a[i + 1].age_20_64,   t)),
        age_65_plus: Math.round(lerp(a[i].age_65_plus, a[i + 1].age_65_plus, t))
      };
    }
  }
}

/* ---------------------------------------------------------------------
   2. SECTOR CONFIGURATION
   ---------------------------------------------------------------------
   base_output_bn  annual output at round 1, SGD bn (the ten sum to 782)
   base_headcount  round-1 employment
   avg_wage        SGD/year per worker, 2050 terms
   automation_r1   round-1 automation
   productivity    output gain per unit of automation. High where output
                   scales with machines (finance, retail, transport). Low
                   where the service IS the human contact (care).
   human_touch     how badly quality suffers once automation passes
                   `comfort`. Care is 1.0. Finance is ~0.
   comfort         the automation level beyond which human_touch bites
   compute_int     compute + energy drawn per unit of automated output.
                   THIS IS THE BILL ATTACHED TO EVERY POINT OF AUTOMATION.
   demand_driver   what this sector's demand scales with
   essential       counts toward "worst essential service" and the
                   quality-below-40 fail gate
   --------------------------------------------------------------------- */
const SECTORS = {
  healthcare: {
    name: 'Healthcare', base_output_bn: 58, base_headcount: 200000, avg_wage: 88000,
    automation_r1: 0.22, productivity: 0.45, human_touch: 0.70,
    comfort: 0.58, compute_int: 0.06, demand_driver: 'elderly', essential: true
  },
  care_services: {
    name: 'Care Services', base_output_bn: 36, base_headcount: 210000, avg_wage: 52000,
    automation_r1: 0.12, productivity: 0.25, human_touch: 1.00,
    comfort: 0.30, compute_int: 0.04, demand_driver: 'elderly', essential: true
  },
  education_research: {
    name: 'Education & Research', base_output_bn: 42, base_headcount: 170000, avg_wage: 82000,
    automation_r1: 0.20, productivity: 0.40, human_touch: 0.90,
    comfort: 0.42, compute_int: 0.07, demand_driver: 'youth', essential: true
  },
  transport_logistics: {
    name: 'Transport & Logistics', base_output_bn: 60, base_headcount: 180000, avg_wage: 62000,
    automation_r1: 0.45, productivity: 0.85, human_touch: 0.10,
    comfort: 0.92, compute_int: 0.09, demand_driver: 'population', essential: true
  },
  energy_utilities: {
    name: 'Energy & Utilities', base_output_bn: 48, base_headcount: 55000, avg_wage: 120000,
    /* Productivity 1.70, not 1.20. The combined Compute & Energy sector
       carried 1.80, and splitting it off at 1.20 quietly took the grid's
       ability to scale with automation away: demand still rose with the
       whole economy's automation while supply no longer could, so the
       grid ran at 140-155% of capacity and dragged its own quality to 46.
       A split has to carry the parent's elasticity across, not just its
       output. */
    automation_r1: 0.55, productivity: 1.70, human_touch: 0.00,
    comfort: 0.98, compute_int: 0.03, demand_driver: 'compute', essential: true
  },
  compute_telecom: {
    name: 'Compute & Telecom', base_output_bn: 79, base_headcount: 80000, avg_wage: 135000,
    automation_r1: 0.60, productivity: 1.80, human_touch: 0.00,
    comfort: 0.98, compute_int: 0.05, demand_driver: 'compute', essential: true
  },
  housing_construction: {
    name: 'Housing & Construction', base_output_bn: 50, base_headcount: 150000, avg_wage: 68000,
    automation_r1: 0.30, productivity: 0.70, human_touch: 0.20,
    comfort: 0.82, compute_int: 0.05, demand_driver: 'population', essential: true
  },
  food_agri: {
    name: 'Food & Agri', base_output_bn: 34, base_headcount: 100000, avg_wage: 54000,
    automation_r1: 0.35, productivity: 0.60, human_touch: 0.20,
    comfort: 0.85, compute_int: 0.06, demand_driver: 'population', essential: true
  },
  manufacturing: {
    name: 'Manufacturing', base_output_bn: 130, base_headcount: 260000, avg_wage: 78000,
    automation_r1: 0.50, productivity: 1.10, human_touch: 0.10,
    comfort: 0.94, compute_int: 0.10, demand_driver: 'consumption', essential: false
  },
  finance: {
    name: 'Finance', base_output_bn: 115, base_headcount: 200000, avg_wage: 145000,
    automation_r1: 0.55, productivity: 0.95, human_touch: 0.05,
    comfort: 0.95, compute_int: 0.10, demand_driver: 'consumption', essential: false
  },
  retail_commerce: {
    name: 'Retail & Commerce', base_output_bn: 85, base_headcount: 320000, avg_wage: 48000,
    automation_r1: 0.50, productivity: 0.80, human_touch: 0.15,
    comfort: 0.90, compute_int: 0.08, demand_driver: 'consumption', essential: true
  },
  public_admin: {
    name: 'Public Administration', base_output_bn: 25, base_headcount: 100000, avg_wage: 84000,
    automation_r1: 0.25, productivity: 0.50, human_touch: 0.60,
    comfort: 0.55, compute_int: 0.06, demand_driver: 'population', essential: true
  },
  public_safety: {
    name: 'Public Safety', base_output_bn: 20, base_headcount: 100000, avg_wage: 76000,
    automation_r1: 0.28, productivity: 0.55, human_touch: 0.50,
    comfort: 0.66, compute_int: 0.06, demand_driver: 'population', essential: true
  }
};
const ORDER = Object.keys(SECTORS);
const ESSENTIAL = ORDER.filter(k => SECTORS[k].essential);

/* ---------------------------------------------------------------------
   3. BEHAVIOURAL AND FISCAL CONSTANTS
   ---------------------------------------------------------------------
   Every number here is a modelling choice, exposed so you can argue with
   it. None of them are secret. If you think MPC_UBI should not exceed
   MPC_WAGE, say so in your pitch and show what changes.
   --------------------------------------------------------------------- */
const P = {
  /* automation dynamics */
  AUTOMATION_STEP_UP:   0.14,  // most a sector can automate in one round
  AUTOMATION_STEP_DOWN: 0.05,  // falls back slowly: machines are bought, not rented
  IRREVERSIBLE_ABOVE:   0.80,  // past this, re-employing humans is penalised (spec 5)
  IRREVERSIBLE_DRAG:    0.55,  // ...cutting the down-step by this share

  /* labour */
  WEEK_SPREAD: 0.55,           // shorter week spreads work over more heads
  WEEK_OUTPUT: 0.30,           // ...and cuts output, but less than proportionally
  GUARANTEE_WAGE_DEFAULT: 3200,// SGD/month for a guaranteed care job
  GUARANTEE_INTAKE: 0.055,     // share of the unemployed taken on each round

  /* household income -> consumption */
  MPC_WAGE:    0.72,  // marginal propensity to consume out of wages
  MPC_UBI:     0.94,  // ...out of UBI: transfers go to people who spend them
  MPC_CAPITAL: 0.28,  // ...out of capital income: mostly saved
  CONSUMPTION_INERTIA: 0.45,   // households smooth spending between rounds

  /* tax bases */
  LABOUR_TAX_RATE: 0.20,       // personal income tax on the wage bill
  CONSUMPTION_TAX: 0.08,       // GST
  OTHER_TAX_GDP:   0.042,      // land, vehicle, duties - scales with GDP
  CAPITAL_RETURN_RATE: 0.1867, // return on automated capital (calibrated below)
  DIVIDEND_PROFIT_SHARE: 0.5,  // owning machines also claims operating profit

  /* investment: what firms do with the profit you did NOT take.
     This is the other half of the corporate tax trade-off. Tax hard and
     you collect more this round and have less to collect from later. */
  DEPRECIATION: 0.14,          // capital stock lost per round without reinvestment
  BASE_INVEST_RATE: 0.17,      // round-1 retained profit / GDP
  INVEST_TAX_ELASTICITY: 1.30, // reinvestment lost per point of tax above 19%
  INVEST_LEVY_ELASTICITY: 0.85,// ...and per point of compute levy above 5%
  LEVY_ADOPTION_BRAKE: 1.60,   // compute levy slows how fast you CAN automate

  /* spending */
  UBI_ADMIN_EFFICIENCY: { flat: 0.97, means_tested: 0.90, age_weighted: 0.95 },
  MEANS_TEST_COVERAGE: 0.55,   // share of the population that qualifies
  AGE_WEIGHT_SENIOR: 1.6,      // 65+ receive 1.6 shares under age-weighting

  /* prices */
  BASE_INFLATION: 0.021,
  IMPORT_SHARE: 0.55,          // of the consumption basket. SG imports nearly all food
  COMPUTE_SCARCITY_PASSTHROUGH: 0.09,

  /* SCARCITY PRICING (docs/EVIDENCE.md section 6).
     Compute and energy demand is driven by how automated the economy
     is. Until now that demand met a finite capacity and the only
     consequence was RATIONING -- a quality shortfall -- with the price
     drifting at a flat 1% a round regardless. A society could triple
     its automation and the energy price would not notice.

     Now the price responds to how tight the sector is:

         tightness = demand / capacity        (last round's realised)
         pressure  = (tightness - SLACK)      above the slack band only
         price    *= 1 + ELASTICITY * pressure^CONVEXITY

     CONVEXITY > 1 because scarcity bites nonlinearly: the last ten per
     cent of spare capacity costs far more than the first. Below
     SLACK_BAND nothing happens, because an economy running comfortably
     under capacity has no reason to bid prices up.

     The price already reaches households (via the price index, and so
     effective_ubi_index) and already raises the cost of running
     automated capacity (via computeCost). Both channels existed; this
     is what makes them respond to the team's own automation policy
     rather than only to shocks. */
  SCARCITY_SLACK_BAND: 0.92,   // tightness below this is comfortable
  SCARCITY_ELASTICITY: 0.55,   // price response per unit of pressure
  SCARCITY_CONVEXITY: 1.6,     // >1: the last of the capacity is dear
  SCARCITY_RELIEF: 0.25,       // how fast prices fall when slack returns
  SCARCITY_PRICE_CEILING: 6.0, // a price index, not a cliff

  /* PER-SECTOR CAPITAL (stage 3 foundations).
     ------------------------------------------------------------------
     `capitalIndex` is a single economy-wide scalar, so a sector running a
     40% margin and one running -10% receive the IDENTICAL capital
     multiplier next round. Nothing in the model rewards a sector for
     being profitable, which is why growth cannot compound: there is no
     positive feedback loop anywhere in the supply side.

     `_sectorCapital` fixes that by accumulating each sector's own
     retained earnings. It is COMPUTED from this round but applied to
     capacity only in proportion to SECTOR_CAPITAL_WEIGHT, which is zero
     here on purpose. At zero the term is exactly 1 and every existing run
     is byte-identical; the weight is raised when non-linear growth lands,
     and until then the figure is observable and testable without moving
     a single result. */
  SECTOR_CAPITAL_WEIGHT: 1,      // 0 = off. Raised when growth lands.
  SECTOR_CAPITAL_DEPRECIATION: 0.14,
  SECTOR_CAPITAL_FLOOR: 0.35,
  SECTOR_CAPITAL_CEILING: 2.2,


  /* quality */
  QUALITY_INERTIA: 0.38,       // share of the gap to target closed per round
  Q_BASE: 64,
  Q_CAPACITY: 42,
  Q_INFRA: 26,
  Q_HUMAN: 135,
  Q_STAFF: 20,
  Q_GUARANTEE: 10,

  /* MISSION-BASED QUALITY (stage 4).
     ------------------------------------------------------------------
     Quality is one formula for all thirteen sectors: the same four
     dimensions in the same proportions, so a hospital and a bank are
     judged identically apart from two coefficients. `sector_missions.js`
     gives each industry its own scorecard instead.

     Blended rather than swapped, and at weight 0 the blend is exactly
     the old target, so this introduces the machinery without moving a
     result. Raising it is a deliberate, separately reviewable act. */
  MISSION_WEIGHT: 1,

  /* ==================================================================
     NON-LINEAR GROWTH (stage 5)
     ==================================================================
     Three mechanisms, each replacing a piece of a model in which
     automation buys a fixed, immediate, one-off increase in capacity.
     All three start at zero weight; a calibration pass raises them
     together, because they interact and tuning them one at a time
     would fit each to the absence of the others.

     1. THE PRODUCTIVITY J-CURVE.
        Automation does not pay on arrival. The complementary work —
        reorganising, retraining, rewriting the process around the
        machine — is real, expensive and unmeasured, so measured
        productivity DIPS before it rises. `_autoExperience` lags
        `automation`; the gap is automation the sector has bought and
        not yet learned to use, and it costs output.
        (Brynjolfsson, Rock & Syverson 2021; David 1990.)

     2. THE LEARNING CURVE.
        Unit cost falls with CUMULATIVE production, not with the level.
        This is the mechanism that makes AI exponential rather than
        merely large: every unit of compute consumed makes the next one
        cheaper, so a society far along the curve gets more automation
        per dollar than one starting out. (Wright's law.)

     3. BASS DIFFUSION.
        Adoption is an S-curve, not a ramp. `AUTOMATION_STEP_UP` applies
        the same 0.14 whether a sector sits at 0.12 or 0.90, which is a
        constant-rate line. The Bass form `(p + q·F)(1 − F)` is slow
        while few have adopted, fastest in the middle, and saturates.
        (Bass 1969; Rogers, Diffusion of Innovations.) */

  J_CURVE_WEIGHT: 1,
  J_ABSORB_RATE: 0.45,     // share of the unabsorbed gap learned per round
  J_DIP: 0.35,             // output cost per unit of unabsorbed automation
  /* The other half of the J, and the half that makes it a J rather than
     a tax. Automation that has been ABSORBED pays more than the naive
     linear gain, because the reorganisation it forced is itself
     productive — that is the whole finding, not a caveat to it. Without
     this the mechanism only ever costs output and a team would rightly
     conclude that automating is never worth it. */
  J_MATURE: 1.40,          // multiplier on the gain from absorbed automation

  LEARNING_WEIGHT: 1,
  LEARNING_EXPONENT: 0.15, // cost ~ cumulative^(-b). b=0.15 is ~10% per doubling
  LEARNING_FLOOR: 0.45,    // experience never makes compute free

  DIFFUSION_WEIGHT: 1,
  BASS_P: 0.030,           // innovation: who moves with nobody to copy
  BASS_Q: 0.380,           // imitation: how strongly the adopted pull the rest
  BASS_SCALE: 1.30,        // so the PEAK rate matches the old constant step

  /* reskilling */
  RESKILL_LAG: 3,              // rounds before it pays off (spec 5)
  RESKILL_POTENCY: 2.6e6,      // people moved high->low exposure per $bn
  EXPOSURE_SENSITIVITY: 1.2,   // share of the workforce newly exposed per
                               // point of economy-wide automation growth

  /* social */
  COHESION_INERTIA: 0.45,
  LEGITIMACY_INERTIA: 0.40,
  GINI_INERTIA: 0.50,

  /* civic friction: what people withhold when they have had enough.
     Below the threshold a society grumbles and works; above it, it stops
     cooperating — absence, go-slows, boycotts, things not maintained. */
  UNREST_THRESHOLD: 50,
  UNREST_DRAG: 0.55,        // share of output lost at total unrest
  UNREST_SERVICE_DRAG: 26,  // quality points lost from care and health at the same

  /* AGENT CHANNELS. Read only when agents supply the matching exogenous
     input or a team enacts a policy; otherwise nothing below is touched.
     They are conversion constants, not behaviour: WHETHER people work,
     spend, leave or have children is decided by agents, and these say
     what that decision costs or yields in the kernel's units. */
  LABOUR_PARTICIPATION: 0.80,  // share of 20-64 who work when labour_supply is 1
  PRICE_ELASTICITY: 0.8,       // demand response to a sector's own price markup
  MARKUP_PASSTHROUGH: 0.6,     // share of the average markup that reaches household prices
  HEALTH_MORTALITY_SENS: 1.2,  // excess over-65 deaths per unit of healthcare failure
  BIRTHS_PER_ROUND: 60000,     // ~30k births a year; agent birth decisions scale this
  PROVIDE_EFFICIENCY: 0.8,     // capacity bought per bn of direct public provision
  PROVIDE_MAX_BOOST: 0.4,      // most capacity direct provision can add to one sector
  POLL_WEIGHT: 1.0,            // share of cohesion/legitimacy read from agent polls when present

  /* TICKS. The kernel can advance by any length of time: `step(..., { dt })`
     with dt in years. Two years is the original round and reproduces it
     exactly. A month (1/12) is a tick.

     Every constant above is written for a two-year round. Under ticks each
     is converted by what kind of thing it is, never by hand:
       a level       (output, wages, tax rates, a price cap)   unchanged
       a flow        (births, automation steps, reserves)      x  dt/2
       an inertia    (quality, cohesion, capital wearing out)  1-(1-x)^(dt/2)
       a growth rate (inflation, scarcity)                     (1+g)^(dt/2)
     so a half-life stays a half-life and a year's inflation stays a year's
     inflation however finely time is cut.

     Things that move slowly are REFRESHED less often, in ticks. A refresh
     covers all the time since the last one, so nothing is lost: capital
     looked at quarterly still wears out three months' worth. */
  CADENCE: { demography: 12, exposure: 12, capital: 3, automation: 3 }
};

/* ---------------------------------------------------------------------
   4. SHOCK DECK
   ---------------------------------------------------------------------
   The engine never draws. Shocks are handed in. Each is a set of
   multipliers and offsets applied for the round it is active.
   --------------------------------------------------------------------- */
const SHOCKS = {
  pandemic: {
    label: 'Respiratory pandemic',
    demand: { healthcare: 1.45, care_services: 1.30, retail_commerce: 0.82, transport_logistics: 0.72 },
    quality: { healthcare: -22, care_services: -14 },
    cohesion: -6, output_mult: 0.93
  },
  food_import_disruption: {
    label: 'Food import disruption',
    demand: { food_agri: 1.05 },
    capacity_mult: { food_agri: 0.55 },
    quality: { food_agri: -20 },
    import_price: 0.22, cohesion: -5
  },
  energy_price_spike: {
    label: 'Energy price spike',
    capacity_mult: { energy_utilities: 0.80 },
    quality: { energy_utilities: -12, transport_logistics: -6 },
    compute_price: 0.45, import_price: 0.08, cohesion: -3
  },
  chip_export_controls: {
    label: 'Chip export controls',
    capacity_mult: { compute_telecom: 0.72 },
    automation_ceiling: -0.10,
    compute_price: 0.60, quality: { compute_telecom: -10 }, cohesion: -2
  },
  cyber_attack: {
    label: 'Infrastructure cyber attack',
    quality: { finance: -18, compute_telecom: -16, energy_utilities: -12, public_safety: -10 },
    capacity_mult: { finance: 0.85, compute_telecom: 0.86, energy_utilities: 0.90 },
    cohesion: -4, legitimacy: -5
  },
  /* endogenous - fired by your own state, not by chance (spec 6) */
  civil_unrest: {
    label: 'Civil unrest',
    quality: { public_safety: -14, retail_commerce: -10 },
    output_mult: 0.94, cohesion: -8, legitimacy: -8
  },
  fiscal_crisis: {
    label: 'Fiscal crisis',
    borrowing_penalty: 0.35, legitimacy: -10, cohesion: -4
  },
  service_failure_cascade: {
    label: 'Service failure cascade',
    quality: { healthcare: -8, care_services: -10, education_research: -8, retail_commerce: -8 },
    cohesion: -7, legitimacy: -6
  }
};

/* ---------------------------------------------------------------------
   5. DEFAULT LEVERS — the round-1 published settings
   --------------------------------------------------------------------- */
const DEFAULT_LEVERS = {
  automation_target: {
    healthcare: 0.22, care_services: 0.12, education_research: 0.20,
    transport_logistics: 0.45, energy_utilities: 0.55, compute_telecom: 0.60,
    housing_construction: 0.30, food_agri: 0.35, manufacturing: 0.50,
    finance: 0.55, retail_commerce: 0.50, public_admin: 0.25, public_safety: 0.28
  },
  corporate_tax_rate: 0.19,
  compute_levy: 0.05,
  allocation: { ubi: 0.45, infrastructure: 0.40, reserves: 0.15 },
  ubi_design: 'flat',            // flat | means_tested | age_weighted
  reskilling_spend_pct: 0.08,
  public_ownership_pct: 0.05,
  working_week_days: 5,          // 5 | 4 | 3
  care_job_guarantee: false,
  care_guarantee_wage: P.GUARANTEE_WAGE_DEFAULT
};

/* A sector missing from `automation_target` reaches `clamp(undefined, …)`
   as NaN, and a NaN automation poisons capacity, headcount, compute
   demand and every margin from round 2 onward without throwing. */
(function assertDefaultLevers() {
  const missing = ORDER.filter(k => typeof DEFAULT_LEVERS.automation_target[k] !== 'number');
  if (missing.length) {
    throw new Error('DEFAULT_LEVERS.automation_target is missing: ' + missing.join(', '));
  }
  const extra = Object.keys(DEFAULT_LEVERS.automation_target).filter(k => !SECTORS[k]);
  if (extra.length) {
    throw new Error('DEFAULT_LEVERS.automation_target names non-sectors: ' + extra.join(', '));
  }
})();

/* ---------------------------------------------------------------------
   6. SELF-CALIBRATION
   ---------------------------------------------------------------------
   Rather than carrying magic numbers, the engine solves each sector's
   non-wage cost share so that round 1 reproduces the published baseline
   margins exactly. Change a wage or an output above and the calibration
   follows automatically.
   --------------------------------------------------------------------- */
const R1_MARGINS = {
  healthcare: 0.09, care_services: -0.09, education_research: -0.04,
  transport_logistics: 0.16, energy_utilities: 0.14, compute_telecom: 0.21,
  housing_construction: 0.12, food_agri: 0.07, manufacturing: 0.19,
  finance: 0.24, retail_commerce: 0.11, public_admin: -0.06, public_safety: -0.02
};

/* ---------------------------------------------------------------------
   THE SECTOR TABLE MUST BE COMPLETE, AND IT MUST SAY SO AT LOAD TIME
   ---------------------------------------------------------------------
   Every check below guards a failure that is otherwise SILENT and
   arrives as NaN somewhere unrelated, rounds later.

   A sector with no `R1_MARGINS` entry makes `COST_SHARE[k]` NaN, which
   makes `otherCost` NaN, which makes `profit` NaN, which makes GDP, the
   tax take, the UBI and every indicator NaN — and nothing throws. The
   run completes. It produces a trajectory. Every number in it is NaN
   and the first place anyone notices is a blank chart.

   These throw rather than warn for the same reason `assertBlind` does:
   a guard that can be ignored is a guard that will be.
   --------------------------------------------------------------------- */
const DEMAND_DRIVERS = ['population', 'elderly', 'youth', 'consumption', 'compute'];
const SECTOR_FIELDS = ['name', 'base_output_bn', 'base_headcount', 'avg_wage',
                       'automation_r1', 'productivity', 'human_touch', 'comfort',
                       'compute_int', 'demand_driver', 'essential'];

(function assertSectorTable() {
  const problems = [];

  ORDER.forEach(k => {
    const c = SECTORS[k];
    SECTOR_FIELDS.forEach(f => {
      if (c[f] === undefined || c[f] === null) problems.push(k + ' is missing `' + f + '`');
    });
    if (typeof R1_MARGINS[k] !== 'number') {
      problems.push(k + ' has no R1_MARGINS entry (COST_SHARE would be NaN)');
    }
    if (DEMAND_DRIVERS.indexOf(c.demand_driver) < 0) {
      problems.push(k + ' has demand_driver "' + c.demand_driver +
        '", which is not one of: ' + DEMAND_DRIVERS.join(', ') + ' (demand would be NaN)');
    }
    if (!(c.base_output_bn > 0)) problems.push(k + ' has no positive base_output_bn');
  });

  // A margin for a sector that does not exist is a rename nobody finished.
  Object.keys(R1_MARGINS).forEach(k => {
    if (!SECTORS[k]) problems.push('R1_MARGINS names "' + k + '", which is not a sector');
  });

  if (problems.length) {
    throw new Error('the sector table is inconsistent:\n  - ' + problems.join('\n  - '));
  }
})();

const COST_SHARE = {};
ORDER.forEach(k => {
  const c = SECTORS[k];
  const out = c.base_output_bn;
  const wages = c.base_headcount * c.avg_wage / 1e9;
  const comp = c.compute_int * c.automation_r1 * out;
  // out - wages - compute - cost_share*out = margin*out   =>  solve cost_share
  COST_SHARE[k] = (out - wages - comp - R1_MARGINS[k] * out) / out;
  if (!isFinite(COST_SHARE[k])) {
    throw new Error('COST_SHARE for ' + k + ' is not finite — round 1 cannot be reproduced');
  }
});

/* Round-1 aggregates, derived once, used as the index bases. */
const MISSIONS = (typeof require !== 'undefined')
  ? require('./sector_missions.js')
  : (typeof window !== 'undefined' ? window.MeridianMissions : null);

const CAL = (function () {
  const wageBill = ORDER.reduce((a, k) => a + SECTORS[k].base_headcount * SECTORS[k].avg_wage / 1e9, 0);
  const grossProfit = ORDER.reduce((a, k) => a + SECTORS[k].base_output_bn * R1_MARGINS[k], 0);
  const autoCapital = ORDER.reduce((a, k) => a + SECTORS[k].automation_r1 * SECTORS[k].base_output_bn, 0);
  const capitalReturn = P.CAPITAL_RETURN_RATE * autoCapital;
  const corporateProfit = grossProfit + capitalReturn;
  const ubiTotal = 680 * 12 * 5940000 / 1e9;             // the published round-1 UBI
  const dividend = 0.05 * (capitalReturn + P.DIVIDEND_PROFIT_SHARE * grossProfit);
  const capitalToHouseholds = (corporateProfit - dividend) * 0.35;
  const spend = P.MPC_WAGE * wageBill + P.MPC_UBI * ubiTotal + P.MPC_CAPITAL * capitalToHouseholds;
  const gdp = ORDER.reduce((a, k) => a + SECTORS[k].base_output_bn, 0);
  return {
    WAGE_BILL: wageBill, GROSS_PROFIT: grossProfit, CAPITAL_RETURN: capitalReturn,
    CORPORATE_PROFIT: corporateProfit, UBI_TOTAL: ubiTotal, SPEND: spend, GDP: gdp,
    UBI_MONTHLY: 680,
    INFRA: 118 * 0.92 * 0.40,   // round-1 infrastructure spend, the maintenance yardstick
    AUTO_WEIGHTED: autoCapital / gdp
  };
})();

/* ---------------------------------------------------------------------
   7. THE STEP FUNCTION
   ---------------------------------------------------------------------
       step(state, levers, activeShocks) -> next state
   Pure. Same inputs, same outputs, on every machine, every time.
   --------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   THE POLICY GRAMMAR
   ---------------------------------------------------------------------
   A constitution is prose. What reaches the kernel is a list of policy
   objects in a small grammar, compiled from that prose by the government
   agent (agents/policy.js). The kernel knows how to execute the GRAMMAR,
   not any particular policy, so a team can enact something nobody here
   anticipated as long as it can be said in these six verbs:

     tax          a base at a rate
     transfer     money to a group, per person per month
     regulate     a limit on automation, prices or wages
     provide      public money straight into a sector's capacity
     institution  the same, with a name and a mandate
     announce     words only: citizens hear it, the kernel does not

   Anything that fails validation is dropped here and reported by the
   compiler, never silently half-applied.
   --------------------------------------------------------------------- */
const POLICY_GRAMMAR = {
  tax: { bases: ['profit', 'wages', 'compute', 'capital_income', 'energy', 'land', 'consumption'],
         rate: [0, 0.5] },
  transfer: { to: ['all', 'elderly', 'youth', 'working_age', 'unemployed', 'low_income', 'carers'],
              sgd_month: [0, 5000] },
  regulate: { what: { automation_cap: [0, 0.98], price_cap: [0.6, 1.8], wage_floor: [0.5, 2] } },
  provide: { budget_bn: [0, 60] },
  institution: { budget_bn: [0, 60] },
  announce: {}
};
/* Shares of the population a transfer reaches when the group is not a
   band the engine already counts. Approximate, and labelled as such. */
const TRANSFER_SHARE = { low_income: 0.20, carers: 0.05 };

function validatePolicy(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const type = raw.type;
  const g = POLICY_GRAMMAR[type];
  if (!g) return { ok: false, reason: 'unknown policy type "' + type + '"' };
  const num = (v, lo, hi, name) => {
    const x = Number(v);
    if (!isFinite(x)) return { err: name + ' must be a number' };
    if (x < lo || x > hi) return { err: name + ' must be between ' + lo + ' and ' + hi };
    return { v: x };
  };
  const sectorOk = (k, allowAll) => (allowAll && k === 'all') || ORDER.indexOf(k) >= 0;
  if (type === 'tax') {
    if (g.bases.indexOf(raw.base) < 0) return { ok: false, reason: 'tax base must be one of ' + g.bases.join(', ') };
    const r = num(raw.rate, g.rate[0], g.rate[1], 'rate'); if (r.err) return { ok: false, reason: r.err };
    return { ok: true, value: { type: type, base: raw.base, rate: r.v, name: raw.name || null } };
  }
  if (type === 'transfer') {
    if (g.to.indexOf(raw.to) < 0) return { ok: false, reason: 'transfer must go to one of ' + g.to.join(', ') };
    const r = num(raw.sgd_month, g.sgd_month[0], g.sgd_month[1], 'sgd_month'); if (r.err) return { ok: false, reason: r.err };
    return { ok: true, value: { type: type, to: raw.to, sgd_month: r.v, name: raw.name || null } };
  }
  if (type === 'regulate') {
    const range = g.what[raw.what];
    if (!range) return { ok: false, reason: 'regulate.what must be one of ' + Object.keys(g.what).join(', ') };
    const needsSector = raw.what !== 'wage_floor';
    if (needsSector && !sectorOk(raw.sector, true)) return { ok: false, reason: 'unknown sector "' + raw.sector + '"' };
    const r = num(raw.limit, range[0], range[1], 'limit'); if (r.err) return { ok: false, reason: r.err };
    return { ok: true, value: { type: type, what: raw.what, sector: needsSector ? raw.sector : null,
                                limit: r.v, name: raw.name || null } };
  }
  if (type === 'provide' || type === 'institution') {
    if (!sectorOk(raw.sector, false)) return { ok: false, reason: 'unknown sector "' + raw.sector + '"' };
    const r = num(raw.budget_bn, g.budget_bn[0], g.budget_bn[1], 'budget_bn'); if (r.err) return { ok: false, reason: r.err };
    const v = { type: type, sector: raw.sector, budget_bn: r.v, name: raw.name || null };
    if (type === 'institution') {
      if (!raw.name) return { ok: false, reason: 'an institution needs a name' };
      v.mandate = String(raw.mandate || '').slice(0, 400);
    }
    return { ok: true, value: v };
  }
  // announce
  const text = String(raw.text || '').trim();
  if (!text) return { ok: false, reason: 'an announcement needs text' };
  return { ok: true, value: { type: type, text: text.slice(0, 600) } };
}

function compilePolicies(list) {
  const out = { active: false, autoCap: {}, priceCap: {}, wageFloor: null, provide: {},
                taxes: [], transfers: [], announcements: [] };
  (Array.isArray(list) ? list : []).forEach(raw => {
    const v = validatePolicy(raw);
    if (!v.ok) return;
    const x = v.value;
    out.active = true;
    if (x.type === 'tax') out.taxes.push(x);
    else if (x.type === 'transfer') out.transfers.push(x);
    else if (x.type === 'announce') out.announcements.push(x.text);
    else if (x.type === 'provide' || x.type === 'institution') {
      out.provide[x.sector] = (out.provide[x.sector] || 0) + x.budget_bn;
    } else if (x.what === 'wage_floor') {
      out.wageFloor = out.wageFloor == null ? x.limit : Math.max(out.wageFloor, x.limit);
    } else {
      const target = x.what === 'automation_cap' ? out.autoCap : out.priceCap;
      (x.sector === 'all' ? ORDER : [x.sector]).forEach(k => {
        target[k] = target[k] == null ? x.limit : Math.min(target[k], x.limit);
      });
    }
  });
  return out;
}

function step(state, levers, activeShocks, exogenous, opts) {
  /* `exogenous` is what reached this society from OUTSIDE it: goods and
     credits settled by the trade layer at the end of last round. Optional,
     and defaults to nothing, so a society that trades with nobody behaves
     exactly as it did before trade existed.

       { reserves_bn, capacity: {sector: mult}, headcount: {sector: n},
         cohesion_bonus, legitimacy_bonus, civic_unrest }

     `civic_unrest` (0-100) is what the citizen agents made of last round.
     It is computed OUTSIDE the engine and handed in for the same reason
     trade is: a model's reading of a mood must not change what the same
     levers produce, or cross-team comparison dies and a trace stops
     replaying. Recorded in the trace, replayed from it, so the feedback
     loop is real and the engine stays pure.

     Imports raise a sector's capacity without the society having built it.
     Exports lower it. Neither touches a lever: trade is not a tenth lever,
     it is a change in the ground the levers act on. */
  const exo = exogenous || {};
  const exoCap = exo.capacity || {};
  const exoHead = exo.headcount || {};
  const L = Object.assign({}, DEFAULT_LEVERS, levers || {});
  L.allocation = Object.assign({}, DEFAULT_LEVERS.allocation, (levers || {}).allocation);
  L.automation_target = Object.assign({}, DEFAULT_LEVERS.automation_target, (levers || {}).automation_target);

  /* AGENT CHANNELS. Each is optional; absent, the kernel computes what it
     always computed. Present, a DECISION that people or firms made
     replaces the formula that used to stand in for it:

       households  { propensity, labour_supply, withheld: {sector: share} }
       polls       { trust, belonging }            0-100, agent-reported
       demography  { births_mult, emigration, immigration }
       firms[k]    { automation, markup, wage_offer }

     The kernel still does the arithmetic. Agents choose; accounting and
     physics follow. */
  const exoHouse = exo.households || null;
  const exoPolls = exo.polls || null;
  const exoDemo = exo.demography || null;
  /* WHAT PEOPLE DID THAT MOVES MARKETS OR ESCAPES TAX. Two channels for
     open-ended action, both inert when absent:
       demand[k]      households moved their custom toward or away from k
       informal_share share of work and spending that happened off the books,
                      so it serves people but the treasury never sees it */
  const exoDemand = exo.demand || {};
  const informalShare = clamp(Number(exo.informal_share) || 0, 0, 0.5);
  const pol = compilePolicies(L.policies);

  /* A shock is either a name from the deck or an EVENT from the
     environment director: { id, label, effects: {same fields as the deck} }.
     Organisers can invent the weather without the kernel learning new
     physics, because an event is expressed in the deck's own vocabulary. */
  const events = (activeShocks || []).filter(s =>
    typeof s === 'string' ? !!SHOCKS[s] : !!(s && s.effects));
  const names = events.map(s => typeof s === 'string' ? s : (s.label || s.id || 'event'));
  const S = events.map(s => typeof s === 'string' ? SHOCKS[s] : s.effects);
  const shockSum = (field, key) => S.reduce((a, s) => a + ((s[field] && s[field][key]) || 0), 0);
  const shockMult = (field, key) => S.reduce((a, s) => a * ((s[field] && s[field][key]) || 1), 1);
  const shockScalar = f => S.reduce((a, s) => a + (s[f] || 0), 0);
  const shockScalarMult = f => S.reduce((a, s) => a * (s[f] || 1), 1);

  const prev = state;
  /* NO ROUND CAP.
     This was `Math.min(12, ...)`, which silently froze both the round
     and the year at 2072: step a state past twelve and you got 2072
     again, and again, with the demography stuck at its last anchor. A
     run could not fail loudly, it just stopped advancing while still
     returning states that looked valid.

     Runs are now open-ended. A team may govern for as long as their
     strategy holds, which is the point -- proving a policy survives
     sixty years is a stronger claim than surviving twenty-four, and a
     failing run should be ended by its failure rather than by the
     calendar. See `collapse()` below and docs/EVIDENCE.md section 8. */
  const nextRound = prev.meta.round + 1;

  /* TIME. How long this step is, and what that does to every rate. */
  const dt = (opts && Number(opts.dt)) || 2;
  const tickMode = dt !== 2;
  const K = dt / 2;                                   // this step, in two-year rounds
  const tick = tickMode ? (prev.meta.tick || 0) + 1 : null;
  /* Counted from the tick number, not accumulated: twelve twelfths must be a year exactly. */
  const tNext = tickMode ? Math.round(tick * dt * 1e6) / 1e6 : null;
  const due = n => !tickMode || tick % P.CADENCE[n] === 0;
  const kOf = n => (tickMode ? K * P.CADENCE[n] : 1);  // the time one refresh of this kind covers
  const inertia = (x, k) => (k === 1 ? x : 1 - Math.pow(1 - x, k));
  /* Published figures are rounded. Carried rounded, a month's worth of
     change would vanish every month, so under ticks the unrounded values
     travel alongside. */
  const ex = tickMode ? (prev._exact || {}) : null;
  const exQ = ex && ex.quality ? ex.quality : null;
  const exA = ex && ex.automation ? ex.automation : null;

  const demo = tickMode ? demographyTick(prev, exoDemo, tNext, due('demography'), kOf('demography'))
                        : adjustDemography(demography(nextRound), prev, exoDemo);

  /* --- 7.1 prices -----------------------------------------------------
     Import inflation is the reason a nominal UBI lies to you. A society
     can raise the dollar figure every round and still make its people
     poorer. Only real_ubi_index is scored. */
  /* SCARCITY, FROM LAST ROUND'S REALISED TIGHTNESS.
     Deliberately lagged. Demand and capacity for this round are not
     known until the sector loop below, and letting price depend on a
     quantity that depends on price is a circularity with no obvious
     fixed point. A one-round lag is also how prices actually behave:
     they respond to observed scarcity, not to scarcity that has not
     happened yet. */
  const lastTight = prev._computeTightness == null ? 1 : prev._computeTightness;
  const scarcityPressure = Math.max(0, lastTight - P.SCARCITY_SLACK_BAND);
  const scarcityPush = scarcityPressure > 0
    ? P.SCARCITY_ELASTICITY * Math.pow(scarcityPressure, P.SCARCITY_CONVEXITY)
    /* Slack pulls prices back down, but more slowly than scarcity pushes
       them up. Capacity built for a boom does not un-build itself, and
       prices are stickier downward than upward. */
    : -P.SCARCITY_RELIEF * Math.min(0.25, P.SCARCITY_SLACK_BAND - lastTight);

  const computePrice = clamp(
    (prev._computePrice || 1) * (tickMode ? Math.pow(Math.max(0.01, 1 + shockScalar('compute_price') * 0.6 + 0.01 + scarcityPush), K)
                                          : (1 + shockScalar('compute_price') * 0.6 + 0.01 + scarcityPush)),
    0.5, P.SCARCITY_PRICE_CEILING);
  const importPush = shockScalar('import_price');
  const inflation = (1 + P.BASE_INFLATION + P.IMPORT_SHARE * importPush +
     P.COMPUTE_SCARCITY_PASSTHROUGH * (computePrice - 1) * 0.5);
  const priceIndex = (prev._priceIndex || 1) * (tickMode ? Math.pow(Math.max(0.01, inflation), K) : inflation);

  /* The price level households face: the base index, plus whatever share
     of LAST round's average firm markup passes through to them. Lagged
     for the same reason scarcity is. With no firm pricing, exactly the
     base index. */
  const prevMarkup = prev._markupIndex == null ? 1 : prev._markupIndex;
  const priceLevel = priceIndex * (1 + P.MARKUP_PASSTHROUGH * (prevMarkup - 1));

  /* --- 7.2 working week ----------------------------------------------- */
  const weekDays = L.working_week_days;
  const weekSpread = Math.pow(5 / weekDays, P.WEEK_SPREAD); // >1 when the week is shorter
  const weekOutput = Math.pow(weekDays / 5, P.WEEK_OUTPUT); // <1 when the week is shorter

  /* --- 7.3 demand drivers ---------------------------------------------
     `consumption` is where last round's household spending re-enters the
     economy. THIS IS THE RETURNING ARROW IN THE CIRCULAR FLOW. */
  const d1 = DEMOGRAPHY_ANCHORS[0];
  const drivers = {
    population: demo.total / d1.total,
    elderly: demo.age_65_plus / d1.age_65_plus,
    youth: demo.age_0_19 / d1.age_0_19,
    consumption: prev.indicators.consumption_index / 100,
    compute: 1
  };

  /* --- 7.4 automation moves toward the lever, never jumps to it -------- */
  const ceiling = 1 + shockScalar('automation_ceiling');
  // The compute levy taxes automation directly, and so slows how fast a
  // society can adopt it even when the lever says "go".
  const levyBrake = clamp(1 - P.LEVY_ADOPTION_BRAKE * (L.compute_levy - 0.05), 0.25, 1.4);
  /* WHAT THE FIRMS DECIDED, IF ANYONE ASKED THEM.
     ------------------------------------------------------------------
     `exo.firms[sector].automation` is a firm's own chosen level. When it
     is present the government's lever stops being a TARGET and becomes a
     CEILING: firms may sit anywhere beneath it and the state cannot make
     them climb. That is the realistic reading of an automation policy —
     a government can forbid, tax and subsidise, but it cannot compel a
     firm to invest — and it is what makes the compute levy interesting
     rather than decorative.

     Absent, which it is until firm agents exist, every line below
     behaves exactly as it did: the lever is the target.

     `automation_ceiling` is accepted as an alias for `automation_target`
     so a team can write the lever under the name that now describes what
     it does, without invalidating any saved settlement. */
  const exoFirms = exo.firms || {};
  const leverFor = k => {
    const src = (L.automation_ceiling && L.automation_ceiling[k] != null)
      ? L.automation_ceiling : L.automation_target;
    return src[k];
  };

  const automation = {};
  const autoDue = due('automation'), Ka = kOf('automation');
  ORDER.forEach(k => {
    const cur = exA && exA[k] != null ? exA[k] : prev.sectors[k].automation;
    if (!autoDue) { automation[k] = cur; return; }
    const cap = clamp(Math.min(leverFor(k), pol.autoCap[k] != null ? pol.autoCap[k] : Infinity), 0, ceiling);
    const firmAsked = exoFirms[k] && exoFirms[k].automation;
    /* The firm's choice, never above the ceiling. With no firm, the
       ceiling IS the target and nothing changes. */
    const tgt = (typeof firmAsked === 'number' && isFinite(firmAsked))
      ? clamp(Math.min(firmAsked, cap), 0, ceiling) : cap;
    let stepMax;
    if (tgt > cur) {
      /* How fast a sector CAN absorb automation, as a function of how
         far it already has. Blended with the old constant step so the
         curve can be introduced without moving a result. */
      const F = clamp(cur / Math.max(0.01, cap), 0, 1);
      const bass = (P.BASS_P + P.BASS_Q * F) * (1 - F) * P.BASS_SCALE;
      const shaped = (1 - P.DIFFUSION_WEIGHT) * P.AUTOMATION_STEP_UP +
                     P.DIFFUSION_WEIGHT * bass;
      stepMax = shaped * levyBrake;
    } else {
      stepMax = P.AUTOMATION_STEP_DOWN;
      // Irreversibility: some doors close behind you.
      if (cur > P.IRREVERSIBLE_ABOVE) stepMax *= (1 - P.IRREVERSIBLE_DRAG);
      // Reskilling spend buys back some of that lost optionality.
      stepMax *= (1 + 3.0 * L.reskilling_spend_pct);
    }
    stepMax *= Ka;                    // a quarter's worth of adoption, not two years'
    automation[k] = clamp(cur + clamp(tgt - cur, -stepMax, stepMax), 0, 0.98);
  });

  /* --- what the sectors have LEARNED to use ---------------------------
     Experience chases automation rather than equalling it. A sector that
     jumps from 0.3 to 0.8 in one round has bought capacity it cannot yet
     run; a sector that has sat at 0.8 for a decade has absorbed it. */
  const prevExperience = prev._autoExperience || {};
  const autoExperience = {};
  ORDER.forEach(k => {
    const had = prevExperience[k] == null ? prev.sectors[k].automation : prevExperience[k];
    autoExperience[k] = autoDue ? had + (automation[k] - had) * inertia(P.J_ABSORB_RATE, Ka) : had;
  });

  /* --- the learning curve ---------------------------------------------
     Cumulative compute consumed, indexed to round 1. Cost falls as the
     index rises, floored so experience never makes compute free. */
  const cumulativeIn = prev._computeCumulative == null ? 1 : prev._computeCumulative;
  const learningRaw = Math.pow(Math.max(1, cumulativeIn), -P.LEARNING_EXPONENT);
  const learningFactor = (1 - P.LEARNING_WEIGHT) +
    P.LEARNING_WEIGHT * clamp(learningRaw, P.LEARNING_FLOOR, 1);

  // Compute & Energy demand is driven by how automated everything else is.
  // Automation is not free, and this is where the bill is rendered.
  const autoWeighted = ORDER.reduce((a, k) => a + automation[k] * SECTORS[k].base_output_bn, 0) / CAL.GDP;
  drivers.compute = Math.pow(autoWeighted / CAL.AUTO_WEIGHTED, 1.05) * drivers.population;

  /* --- 7.5 the real economy, sector by sector -------------------------- */
  const sectors = {};
  const exactQuality = {};
  const sectorMargin = {};
  let wageBill = 0, employedTotal = 0, grossProfit = 0, gdp = 0, publicSubsidy = 0;
  let computeCostTotal = 0, markupNum = 0, markupDen = 0;
  const sectorOutput = {};

  /* LABOUR PEOPLE CHOSE TO SUPPLY. When households decide how much to work,
     the economy can only staff what they offer: working-age people times
     participation times their willingness. Compared with last round's
     employment, so a shortage bites with a lag, as it does. */
  let labourAvail = 1;
  if (exoHouse && exoHouse.labour_supply != null && isFinite(Number(exoHouse.labour_supply))) {
    const supply = demo.age_20_64 * P.LABOUR_PARTICIPATION * clamp(Number(exoHouse.labour_supply), 0, 1.3);
    labourAvail = clamp(supply / Math.max(1, prev.population.employed_total), 0, 1);
  }
  const withheldOf = k => (exoHouse && exoHouse.withheld && exoHouse.withheld[k] != null)
    ? clamp(Number(exoHouse.withheld[k]) || 0, 0, 0.9) : 0;
  let computeTightness = 1;

  /* CIVIC FRICTION. Nothing happens below the threshold — a grumbling
     society still turns up. Past it the loss climbs with the square of how
     far past, because withdrawal of cooperation compounds: one absence is
     covered, a third of the shift absent closes the line. */
  const unrest = clamp(Number(exo.civic_unrest) || 0, 0, 100);
  const over = Math.max(0, unrest - P.UNREST_THRESHOLD) / (100 - P.UNREST_THRESHOLD);
  const unrestDrag = 1 - P.UNREST_DRAG * over * over;
  const unrestServiceHit = P.UNREST_SERVICE_DRAG * over * over;

  // Infrastructure money voted LAST round builds THIS round's capacity.
  const infraRatio = (prev._infraSpend_bn || CAL.INFRA) / CAL.INFRA;
  // The capital stock firms did or did not reinvest in, last round.
  const capitalIndex = prev._capitalIndex == null ? 1 : prev._capitalIndex;
  /* Per-sector capital carried forward. Absent on a state written before
     this existed, which is why every read defaults to 1 rather than
     assuming the key is there. */
  const prevSectorCapital = prev._sectorCapital || {};
  const sectorCapitalIn = k => (prevSectorCapital[k] == null ? 1 : prevSectorCapital[k]);
  /* The applied term. At weight 0 this is exactly 1 for every sector and
     the multiplication below is a no-op. */
  const sectorCapitalTerm = k =>
    1 - P.SECTOR_CAPITAL_WEIGHT + P.SECTOR_CAPITAL_WEIGHT * sectorCapitalIn(k);

  ORDER.forEach(k => {
    const c = SECTORS[k], p = prev.sectors[k];

    /* WHAT THE FIRMS CHARGE AND PAY. A markup above 1 is a price rise:
       it earns more per unit and sells fewer. A price cap from a policy
       binds on it. With neither, markup is exactly 1 and nothing moves. */
    const firm = exoFirms[k] || {};
    let markup = (typeof firm.markup === 'number' && isFinite(firm.markup)) ? clamp(firm.markup, 0.6, 1.8) : 1;
    if (pol.priceCap[k] != null) markup = Math.min(markup, pol.priceCap[k]);
    let wageMult = (typeof firm.wage_offer === 'number' && isFinite(firm.wage_offer)) ? clamp(firm.wage_offer, 0.6, 1.6) : 1;
    if (pol.wageFloor != null) wageMult = Math.max(wageMult, pol.wageFloor);

    // What the population is asking this sector for.
    const demand = c.base_output_bn * drivers[c.demand_driver] * (shockMult('demand', k) || 1) *
                   (markup === 1 ? 1 : Math.pow(markup, -P.PRICE_ELASTICITY)) *
                   (exoDemand[k] == null ? 1 : clamp(Number(exoDemand[k]) || 1, 0.5, 1.5));

    // What the sector could produce if every buyer turned up.
    /* THE J-CURVE. `experience` is automation the sector has learned to
       use; the gap above it is capacity bought and not yet absorbed, and
       it costs output until the complementary work is done. At weight 0
       experience is ignored and this is the old affine gain. */
    const experience = autoExperience[k];
    const unabsorbed = Math.max(0, automation[k] - experience);
    const legacyGain = 1 + c.productivity * (automation[k] - c.automation_r1);
    const jGain = 1 + c.productivity * P.J_MATURE * (experience - c.automation_r1)
                    - P.J_DIP * c.productivity * unabsorbed;
    const prodGain = (1 - P.J_CURVE_WEIGHT) * legacyGain + P.J_CURVE_WEIGHT * jGain;
    let capacityAbs = c.base_output_bn * prodGain * weekOutput * capitalIndex *
                      sectorCapitalTerm(k) *
                      (shockMult('capacity_mult', k) || 1) * shockScalarMult('output_mult') *
                      (exoCap[k] || 1) *          // imported or exported capacity
                      unrestDrag;                 // and what people withhold

    /* Public money put straight into this sector by a policy. */
    if (pol.provide[k]) {
      capacityAbs *= 1 + Math.min(P.PROVIDE_MAX_BOOST, pol.provide[k] * P.PROVIDE_EFFICIENCY / c.base_output_bn);
    }
    /* LABOUR WITHHELD. A strike removes the work of the people actually
       striking, in the sector they actually work in, and only the human
       share of that sector's output: a 90%-automated line barely notices
       a walkout, a care home closes. The router computes `withheld` from
       who took part; the kernel only applies it. */
    const labourLoss = 1 - (1 - withheldOf(k)) * labourAvail;
    if (labourLoss > 0) capacityAbs *= (1 - labourLoss * clamp(1 - automation[k], 0.02, 1));

    // The people needed to run it at that level.
    const labourRequired = c.base_headcount * (1 - automation[k]) / (1 - c.automation_r1) *
                           (capacityAbs / c.base_output_bn) * weekSpread;
    let headcount = Math.max(0, Math.round(labourRequired));

    // Care job guarantee: the state hires into care, deliberately at a loss.
    if (L.care_job_guarantee && k === 'care_services') {
      const unemployed = Math.max(0, prev.population.by_age.age_20_64 - prev.population.employed_total);
      const hired = Math.round(unemployed * P.GUARANTEE_INTAKE);
      headcount += hired;
      // Care is the one sector where more hands genuinely means more care
      // delivered - it is the least automatable thing in the economy.
      capacityAbs *= (1 + 0.55 * hired / Math.max(1, labourRequired));
    }

    /* Skilled labour lent by another society. It staffs the sector and it
       draws the same wage as anyone else - borrowed hands are not free. */
    if (exoHead[k]) headcount = Math.max(0, headcount + Math.round(exoHead[k]));

    /* ================== THE CLIFF ==================
       Output is SOLD, not merely made. You cannot sell into demand that
       is not there. Every automation decision eventually arrives back
       here as a smaller `demand`, and this one `min` is what turns a
       productivity boom into a depression. */
    const output = Math.min(capacityAbs, demand);
    /* =============================================== */

    const capacity = capacityAbs / demand;
    const wages = headcount * c.avg_wage * wageMult / 1e9;
    /* WRIGHT'S LAW. Every unit of compute consumed makes the next one
       cheaper, so a society far along the curve gets more automation per
       dollar than one starting out. This is the mechanism that makes AI
       compound rather than merely be large. */
    const computeCost = c.compute_int * automation[k] * output * computePrice * learningFactor;
    const otherCost = COST_SHARE[k] * output;
    const profit = output * markup - wages - computeCost - otherCost;

    /* Quality is a target the sector drifts toward, never jumps to.
       Services are sticky: they take rounds to break and rounds to fix. */
    const capTerm = P.Q_CAPACITY * clamp(capacity - 1, -0.55, 0.35);
    const infraTerm = P.Q_INFRA * clamp(infraRatio - 1, -0.9, 0.9);
    const overAuto = Math.max(0, automation[k] - c.comfort);
    const humanTerm = -P.Q_HUMAN * c.human_touch * overAuto;
    const staffTerm = P.Q_STAFF * clamp(headcount / Math.max(1, labourRequired) - 1, -0.5, 0.6);
    const guarTerm = (L.care_job_guarantee && (k === 'care_services' || k === 'healthcare')) ? P.Q_GUARANTEE : 0;
    /* Unrest is felt first where people meet the state: the ward, the
       waiting room, the school gate. */
    const frictionTerm = (k === 'care_services' || k === 'healthcare' ||
                          k === 'public_safety' || k === 'education_research' ||
                          k === 'public_admin') ? -unrestServiceHit : 0;

    const legacyTarget = P.Q_BASE + capTerm + infraTerm + humanTerm +
                         staffTerm + guarTerm + frictionTerm;

    /* --- the sector's own scorecard ------------------------------------
       The same readings the legacy terms use, normalised to roughly
       [-1, 1] so a mission weight means the same thing everywhere. */
    const accessSignal = clamp(capacity - 1, -0.55, 0.35);
    const deliverySignal = clamp(headcount / Math.max(1, labourRequired) - 1, -0.5, 0.6);
    const humanitySignal = -c.human_touch * overAuto;
    const reliabilitySignal = clamp(infraRatio - 1, -0.9, 0.9);
    /* Affordability reads the household price index for most sectors and
       the compute price for the two that sell compute and power, because
       that is the price their customers actually face. */
    const priceFelt = (k === 'energy_utilities' || k === 'compute_telecom')
      ? computePrice : priceLevel;
    const affordabilitySignal = clamp(-(priceFelt - 1) * 0.6, -1, 0.4);
    /* EQUITY IS A PROXY, and a weak one: the engine has no per-cohort
       access figure, so it reads how much of the population is exposed
       to losing its income and charges rationing more heavily when that
       share is large. Rationing always falls hardest on the people with
       fewest alternatives. A real measure would read the worst-served
       cohort directly, which means the citizen corpus reaching the
       engine; that is a bigger change and is not this one. */
    const exposedShare = prev.population && prev.population.by_exposure
      ? prev.population.by_exposure.high / Math.max(1, prev.population.total) : 0.22;
    const equitySignal = Math.min(0, capacity - 1) * (0.5 + exposedShare);

    const scored = MISSIONS.scoreAgainstMission(k, {
      access: accessSignal, delivery: deliverySignal, humanity: humanitySignal,
      reliability: reliabilitySignal, affordability: affordabilitySignal,
      equity: equitySignal
    }, P.Q_BASE);
    /* The guarantee and the unrest friction sit outside the scorecard:
       one is a policy the state bought, the other is damage done to the
       sector from outside it. Neither is something the industry is FOR. */
    const missionTarget = scored.target + guarTerm + frictionTerm;

    const target = clamp(
      (1 - P.MISSION_WEIGHT) * legacyTarget + P.MISSION_WEIGHT * missionTarget, 0, 100);
    const q0 = exQ && exQ[k] != null ? exQ[k] : p.quality;
    const qualityExact = clamp(q0 + (target - q0) * inertia(P.QUALITY_INERTIA, K) + shockSum('quality', k) * K, 0, 100);
    const quality = tickMode ? Math.round(qualityExact) : clamp(Math.round(
      p.quality + (target - p.quality) * P.QUALITY_INERTIA + shockSum('quality', k)), 0, 100);
    if (tickMode) exactQuality[k] = qualityExact;

    sectors[k] = {
      automation: round2(automation[k]),
      headcount: headcount,
      capacity: round2(capacity),
      quality: quality,
      margin: round2(output > 0 ? profit / output : 0),
      note: p.note
    };
    /* `capacity` is supply/demand, so its reciprocal is how tight the
       sector is. Recorded for compute & energy because that is where
       automation policy shows up as scarcity, and next round's price
       reads it. */
    if (k === 'energy_utilities') {
      computeTightness = capacity > 0.01 ? 1 / capacity : 100;
    }

    wageBill += wages;
    computeCostTotal += computeCost;
    markupNum += output * markup;
    markupDen += output;
    sectorOutput[k] = output;
    employedTotal += headcount;
    grossProfit += profit;
    sectorMargin[k] = output > 0 ? profit / output : 0;
    gdp += output;

    /* An essential service that loses money does not close. The state
       covers the loss. That bill lands on the same budget the UBI comes
       out of, and it grows exactly when the tax base is shrinking. */
    if (c.essential && profit < 0) publicSubsidy += -profit;
  });

  /* --- 7.6 capital, profit and the revenue base ------------------------ */
  const autoCapital = ORDER.reduce(
    (a, k) => a + automation[k] * (gdp * SECTORS[k].base_output_bn / CAL.GDP), 0);
  const capitalReturn = P.CAPITAL_RETURN_RATE * autoCapital;
  const corporateProfit = grossProfit + capitalReturn;

  /* Public ownership: a claim on the machines themselves. This is the one
     revenue stream that does not depend on taxing a shrinking profit base,
     which is why it is the sovereign-wealth answer to the loop. */
  const publicDividend = L.public_ownership_pct *
    (capitalReturn + P.DIVIDEND_PROFIT_SHARE * Math.max(0, grossProfit));
  const taxableProfit = Math.max(0, corporateProfit - publicDividend);

  const computeOutput = gdp * SECTORS.compute_telecom.base_output_bn / CAL.GDP;

  const taxRevenue =
    L.corporate_tax_rate * taxableProfit +
    L.compute_levy * computeOutput * (automation.compute_telecom / SECTORS.compute_telecom.automation_r1) +
    P.LABOUR_TAX_RATE * wageBill * (1 - informalShare) +        // collapses as wages vanish
    P.CONSUMPTION_TAX * (prev._consumptionSpend_bn || CAL.SPEND) * (1 - informalShare) + // and as demand does
    P.OTHER_TAX_GDP * gdp;

  /* --- 7.7 the budget ---------------------------------------------------
     Obligations come off the top. Only what survives them is yours to
     split. This is why a society can hold its allocation lever perfectly
     still and still watch its UBI fall: the numerator shrank. */
  /* POLICY TAXES AND SPENDING. New taxes fund the same budget split as
     every other revenue. Transfers and direct provision come off the top
     as obligations, like the care guarantee does. All zero without
     policies. */
  const capitalToHouseholdsGross = Math.max(0, corporateProfit - publicDividend) * 0.35;
  let wageTaxBn = 0, capitalTaxBn = 0, profitTaxBn = 0, otherPolicyTaxBn = 0;
  pol.taxes.forEach(t => {
    if (t.base === 'wages') wageTaxBn += t.rate * wageBill;
    else if (t.base === 'capital_income') capitalTaxBn += t.rate * capitalToHouseholdsGross;
    else if (t.base === 'profit') profitTaxBn += t.rate * taxableProfit;
    else if (t.base === 'compute') otherPolicyTaxBn += t.rate * computeCostTotal;
    else if (t.base === 'energy') otherPolicyTaxBn += t.rate * (sectorOutput.energy_utilities || 0);
    else if (t.base === 'land') otherPolicyTaxBn += t.rate * (sectorOutput.housing_construction || 0);
    else if (t.base === 'consumption') otherPolicyTaxBn += t.rate * (prev._consumptionSpend_bn || CAL.SPEND);
  });
  const policyRevenue = wageTaxBn + capitalTaxBn + profitTaxBn + otherPolicyTaxBn;
  const recipientsOf = to => {
    if (to === 'all') return demo.total;
    if (to === 'elderly') return demo.age_65_plus;
    if (to === 'youth') return demo.age_0_19;
    if (to === 'working_age') return demo.age_20_64;
    if (to === 'unemployed') return Math.max(0, demo.age_20_64 - prev.population.employed_total);
    return Math.round(demo.total * (TRANSFER_SHARE[to] || 0));
  };
  const transfersBn = pol.transfers.reduce((acc, t) => acc + t.sgd_month * 12 * recipientsOf(t.to) / 1e9, 0);
  const provideBn = Object.keys(pol.provide).reduce((acc, k) => acc + pol.provide[k], 0);
  const policySpend = transfersBn + provideBn;

  const income = taxRevenue + publicDividend + policyRevenue;

  // The care job guarantee is a deliberate public loss.
  let guaranteeCost = 0;
  if (L.care_job_guarantee) {
    const cs = SECTORS.care_services;
    const organic = cs.base_headcount * (1 - automation.care_services) / (1 - cs.automation_r1);
    const extra = Math.max(0, sectors.care_services.headcount - organic);
    guaranteeCost = extra * (L.care_guarantee_wage || P.GUARANTEE_WAGE_DEFAULT) * 12 / 1e9;
  }

  const reskillSpend = income * L.reskilling_spend_pct;
  /* A TEAM'S OWN WAYS OF SHARING OUT. Beyond the payment everyone gets, a
     team may pay people for what they DO: a credit for community service,
     say. Who earned what is worked out from what residents actually did,
     outside the kernel, and arrives here as an annual amount:
       distribution.paid_bn      what the schemes owe in total
       distribution.from_ubi_bn  the part meant to come out of the payment's
                                 own pot (the rest is new money, an
                                 obligation like any other)
     Money carved from the pot lowers everyone's payment and is handed to
     the people who earned it, so it redistributes without costing more. */
  const dist = exo.distribution || null;
  const distAsked = dist ? Math.max(0, Number(dist.paid_bn) || 0) : 0;
  const distFromUbiAsked = dist ? clamp(Number(dist.from_ubi_bn) || 0, 0, distAsked) : 0;
  const distNew = distAsked - distFromUbiAsked;
  const obligations = dist ? reskillSpend + publicSubsidy + guaranteeCost + policySpend + distNew
                           : reskillSpend + publicSubsidy + guaranteeCost + policySpend;
  const spendable = income - obligations;

  const a = L.allocation;
  const allocSum = (a.ubi + a.infrastructure + a.reserves) || 1;
  // When obligations exceed income, the shortfall is financed - the UBI
  // and infrastructure still have to be paid, and reserves absorb it.
  const ubiPotWhole = Math.max(0, spendable) * a.ubi / allocSum;
  /* A scheme cannot take more from the pot than is in it. */
  const distCarved = dist ? Math.min(ubiPotWhole, distFromUbiAsked) : 0;
  const ubiPot = dist ? ubiPotWhole - distCarved : ubiPotWhole;
  const distPaid = distNew + distCarved;
  const infraBn = Math.max(0, spendable) * a.infrastructure / allocSum;
  const reserveAdd = spendable >= 0
    ? spendable * a.reserves / allocSum
    : spendable; // the whole shortfall lands on reserves

  /* --- 7.8 UBI ----------------------------------------------------------- */
  const eff = P.UBI_ADMIN_EFFICIENCY[L.ubi_design] || 0.97;
  let shares;
  if (L.ubi_design === 'means_tested') shares = demo.total * P.MEANS_TEST_COVERAGE;
  else if (L.ubi_design === 'age_weighted') shares = (demo.total - demo.age_65_plus) + demo.age_65_plus * P.AGE_WEIGHT_SENIOR;
  else shares = demo.total;

  const ubiTotalPaid = ubiPot * eff;
  // The per-SHARE payment. Under age-weighting a senior receives 1.6 of
  // these; under means-testing only the qualifying 55% receive one.
  const ubiBaseShare = Math.round((ubiTotalPaid * 1e9) / (shares * 12));
  // The headline figure is the MEAN payment per resident, so that three
  // very different UBI designs can be compared on one axis without the
  // design itself flattering or penalising the number.
  const ubiMonthly = Math.round((ubiTotalPaid * 1e9) / (demo.total * 12));
  const realUbiIndex = Math.round((ubiMonthly / priceLevel) / CAL.UBI_MONTHLY * 100);

  /* --- 7.9 reserves ------------------------------------------------------ */
  // Credits settled by the trade layer land here, before the shock penalty.
  /* The budget is an annual rate; a step adds its share of it. */
  let reserves = (ex && ex.reserves != null ? ex.reserves : prev.fiscal.reserves_bn) + reserveAdd * K + (exo.reserves_bn || 0);
  if (reserves < 0) reserves -= Math.abs(reserves) * shockScalar('borrowing_penalty') * K;

  /* --- 7.9b reinvestment: what firms do with the profit you left them ----
     The other half of the corporate tax trade-off (spec 5). Take more now
     and there is less capital stock to tax later. The compute levy bites
     the same way. Nothing here is a penalty for "greed" - it is simply
     that machines wear out and somebody has to pay to replace them. */
  const retained = Math.max(0, corporateProfit * (1 - L.corporate_tax_rate) - publicDividend * 0.5 - profitTaxBn);
  const investRate = retained / Math.max(1, gdp);
  const taxDrag = clamp(1 - P.INVEST_TAX_ELASTICITY * (L.corporate_tax_rate - 0.19), 0.15, 1.15);
  const levyDrag = clamp(1 - P.INVEST_LEVY_ELASTICITY * (L.compute_levy - 0.05), 0.30, 1.15);
  // A firm cannot build capacity faster than the economy can absorb it,
  // however much profit it is sitting on. Ratio caps at 1.
  const privateReinvest = clamp(investRate / P.BASE_INVEST_RATE, 0, 1) * taxDrag * levyDrag;
  // Machines the PUBLIC owns are maintained out of the infrastructure
  // vote, not out of retained private profit. This is the mechanism
  // behind the spec's claim that public ownership answers the loop: it
  // decouples keeping the capital stock alive from how hard you tax.
  const publicReinvest = clamp(infraRatio, 0, 1.4);
  const own = clamp(L.public_ownership_pct, 0, 1);
  // A quarter of the capital stock is public whoever owns the firms -
  // grid, roads, port, data centres. Starve infrastructure to fund cash
  // payouts and the economy that funds the payouts physically shrinks.
  const reinvestment = 0.75 * ((1 - own) * privateReinvest + own * publicReinvest) +
                       0.25 * publicReinvest;
  const capDue = due('capital'), Kc = kOf('capital');
  const wear = (1 - P.DEPRECIATION + P.DEPRECIATION * reinvestment);
  const nextCapitalIndex = !capDue ? capitalIndex : clamp(
    capitalIndex * (tickMode ? Math.pow(Math.max(0.01, wear), Kc) : wear), 0.30, 1.9);

  /* --- per-sector capital ----------------------------------------------
     THE MISSING FEEDBACK LOOP. A sector's own margin funds its own stock,
     so a profitable sector outgrows a failing one instead of both
     receiving the same economy-wide multiplier.

     Margin is measured against the round-1 margin the sector was
     CALIBRATED to, not against zero. Care services run at -0.09 by design
     and are not a failing business; judging every sector against the same
     absolute bar would have care and education decay to the floor in
     every run whatever a government did, which is a statement about the
     scoring, not about the country.

     The economy-wide reinvestment term still applies, because the public
     share of the stock is maintained out of the infrastructure vote
     whoever owns the firms. */
  const nextSectorCapital = {};
  ORDER.forEach(k => {
    const baseline = R1_MARGINS[k];
    const actual = sectorMargin[k] == null ? baseline : sectorMargin[k];
    /* Relative to its own calibrated margin, and bounded so one
       catastrophic round cannot wipe a stock that took decades. */
    const own = clamp(1 + (actual - baseline) * 2.0, 0.25, 1.75);
    const blended = 0.6 * own + 0.4 * reinvestment;
    const wearK = (1 - P.SECTOR_CAPITAL_DEPRECIATION +
                            P.SECTOR_CAPITAL_DEPRECIATION * blended);
    nextSectorCapital[k] = !capDue ? sectorCapitalIn(k) : clamp(
      sectorCapitalIn(k) * (tickMode ? Math.pow(Math.max(0.01, wearK), Kc) : wearK),
      P.SECTOR_CAPITAL_FLOOR, P.SECTOR_CAPITAL_CEILING);
  });

  /* --- 7.10 HOUSEHOLD INCOME -> CONSUMPTION ------------------------------
     The ring closes here. Wages fell because of automation. UBI rises to
     replace them. But UBI is funded by taxing profit, and profit needs
     somebody to sell to. If the transfer does not fully replace the lost
     wage income - and it rarely does, because only part of the profit is
     taxed and only part of the tax becomes UBI - consumption falls, and
     next round every sector's `demand` is lower.

     Go round this ring twelve times and you have the Thinkathon. */
  const capitalToHouseholds = capitalToHouseholdsGross - capitalTaxBn;
  const netWages = wageBill - wageTaxBn;
  const transferIncome = dist ? ubiTotalPaid + transfersBn + distPaid : ubiTotalPaid + transfersBn;
  const nominalHouseholdIncome = netWages + transferIncome + capitalToHouseholds;

  /* HOW MUCH HOUSEHOLDS CHOOSE TO SPEND. With household agents, the
     propensity is theirs: the weighted share of income they decided to
     spend rather than save, in a frightening year or a hopeful one. The
     three constants below are what stood in for that decision before
     anybody was asked, and they remain the calibration check agents are
     measured against. */
  const agentPropensity = exoHouse && exoHouse.propensity != null && isFinite(Number(exoHouse.propensity))
    ? clamp(Number(exoHouse.propensity), 0.05, 1.2) : null;
  const desiredSpendReal = agentPropensity != null
    ? agentPropensity * nominalHouseholdIncome / priceLevel
    : (P.MPC_WAGE * netWages +
       P.MPC_UBI * transferIncome +
       P.MPC_CAPITAL * capitalToHouseholds) / priceLevel;

  const consumptionExact = lerp(
    desiredSpendReal / CAL.SPEND * 100,
    ex && ex.consumption != null ? ex.consumption : prev.indicators.consumption_index,
    tickMode ? Math.pow(P.CONSUMPTION_INERTIA, K) : P.CONSUMPTION_INERTIA);
  const consumptionIndex = Math.round(consumptionExact);

  /* --- 7.11 reskilling shifts people between exposure bands -------------
     Pays off three rounds late, which is why it feels like a waste when
     you fund it and like a miracle when you did. */
  /* The lag is six years however time is cut. */
  const lagSteps = tickMode ? Math.round(P.RESKILL_LAG * 2 / dt) : P.RESKILL_LAG;
  const reskillAll = (prev._reskillHistory || []).concat([reskillSpend]);
  const reskillHistory = tickMode ? reskillAll.slice(-(lagSteps + 2)) : reskillAll;
  const expDue = due('exposure'), Ke = kOf('exposure');
  const matured = reskillHistory.length > lagSteps
    ? reskillHistory[reskillHistory.length - 1 - lagSteps] : 0;
  const moved = expDue ? Math.round(matured * P.RESKILL_POTENCY * Ke / 1000) * 1000 : 0;

  const pe = prev.population.by_exposure;
  const scale = demo.age_20_64 / prev.population.by_age.age_20_64;
  let hi = Math.round(pe.high * scale), md = Math.round(pe.medium * scale);
  let lo = Math.max(0, demo.age_20_64 - hi - md);

  // Reskilling moves people DOWN the exposure ladder: high -> medium -> low.
  const shiftHi = Math.min(hi, Math.round(moved * 0.6));
  const shiftMd = Math.min(md, Math.round(moved * 0.4));
  hi -= shiftHi;
  md = md - shiftMd + shiftHi;
  lo += shiftMd;

  /* ...and automation pushes them back UP it. A job that was safe from
     the machines last round is not necessarily safe from them this one.
     Without this the ladder is a one-way ratchet and every worker in
     Meridian ends up classified "low exposure" in an economy that has
     automated ninety per cent of everything. */
  const prevAutoWeighted = tickMode && prev._exposureAuto != null ? prev._exposureAuto : ORDER.reduce(
    (a, k) => a + prev.sectors[k].automation * SECTORS[k].base_output_bn, 0) / CAL.GDP;
  const exposed = !expDue ? 0 : Math.round(
    Math.max(0, autoWeighted - prevAutoWeighted) * demo.age_20_64 * P.EXPOSURE_SENSITIVITY);
  const upLo = Math.min(lo, Math.round(exposed * 0.6));
  const upMd = Math.min(md, Math.round(exposed * 0.4));
  lo -= upLo;
  md = md + upLo - upMd;
  hi += upMd;
  lo = Math.max(0, demo.age_20_64 - hi - md);

  /* --- 7.12 social indicators -------------------------------------------- */
  const employmentRate = employedTotal / demo.age_20_64;
  const worstEssential = Math.min.apply(null, ESSENTIAL.map(k => sectors[k].quality));

  /* EFFECTIVE purchasing power. Spec 4: "A household on $3,000 a month
     where the hospital sits at quality 42 is poorer than a household on
     $2,000 where the hospital sits at 84. Cash is worth only what it can
     buy." When the services a household depends on are failing, it must
     buy privately what the state no longer provides, and the same dollar
     goes less far. This, not the nominal figure, is what is scored. */
  const serviceAccess = clamp(0.30 + 0.70 * clamp((worstEssential - 20) / 55, 0, 1), 0.30, 1.0);
  const effectiveUbiIndex = Math.round(realUbiIndex * serviceAccess);

  const capitalShare = corporateProfit / Math.max(1, gdp);
  const transferShare = (dist ? ubiTotalPaid + distPaid : ubiTotalPaid) / Math.max(1, nominalHouseholdIncome);
  const giniTarget = clamp(
    0.355 + 0.42 * capitalShare - 0.30 * transferShare -
    0.14 * L.public_ownership_pct - 0.05 * (employmentRate - 0.30), 0.15, 0.70);
  const giniExact = lerp(giniTarget, ex && ex.gini != null ? ex.gini : prev.indicators.gini,
                         tickMode ? Math.pow(P.GINI_INERTIA, K) : P.GINI_INERTIA);
  const gini = round2(giniExact);

  const cohesionTarget = clamp(
    18 +
    30 * clamp(employmentRate / 0.70, 0, 1) +
    24 * clamp((worstEssential - 30) / 50, 0, 1) +
    16 * clamp(realUbiIndex / 160, 0, 1) +
    30 * (0.45 - gini) +
    (L.care_job_guarantee ? 4 : 0) +
    (weekDays <= 4 ? 3 : 0), 0, 100);
  /* MEASURED, NOT COMPUTED. When agents report how much they belong and
     how far they trust the government, those reports ARE the target: the
     formula above is a theory of what people value, and a poll is what
     they actually said. */
  const pollOf = key => (exoPolls && exoPolls[key] != null && isFinite(Number(exoPolls[key])))
    ? clamp(Number(exoPolls[key]), 0, 100) : null;
  const belongingPoll = pollOf('belonging');
  const cohesionGoal = belongingPoll == null ? cohesionTarget
    : (1 - P.POLL_WEIGHT) * cohesionTarget + P.POLL_WEIGHT * belongingPoll;
  const c0 = ex && ex.cohesion != null ? ex.cohesion : prev.indicators.cohesion;
  const cohesionExact = clamp(c0 + (cohesionGoal - c0) * inertia(P.COHESION_INERTIA, K) +
    (shockScalar('cohesion') + (exo.cohesion_bonus || 0) - over * 14) * K, 0, 100);
  const cohesion = tickMode ? Math.round(cohesionExact) : clamp(Math.round(
    prev.indicators.cohesion + (cohesionGoal - prev.indicators.cohesion) * P.COHESION_INERTIA +
    shockScalar('cohesion') + (exo.cohesion_bonus || 0) - over * 14), 0, 100);

  const legitimacyTarget = clamp(
    14 +
    32 * clamp((worstEssential - 25) / 55, 0, 1) +
    24 * clamp(realUbiIndex / 170, 0, 1.05) +
    24 * clamp(cohesion / 85, 0, 1) +
    (reserves > 0 ? 6 : -16), 0, 100);
  const trustPoll = pollOf('trust');
  const legitimacyGoal = trustPoll == null ? legitimacyTarget
    : (1 - P.POLL_WEIGHT) * legitimacyTarget + P.POLL_WEIGHT * trustPoll;
  const l0 = ex && ex.legitimacy != null ? ex.legitimacy : prev.indicators.legitimacy;
  const legitimacyExact = clamp(l0 + (legitimacyGoal - l0) * inertia(P.LEGITIMACY_INERTIA, K) +
    (shockScalar('legitimacy') + (exo.legitimacy_bonus || 0)) * K, 0, 100);
  const legitimacy = tickMode ? Math.round(legitimacyExact) : clamp(Math.round(
    prev.indicators.legitimacy + (legitimacyGoal - prev.indicators.legitimacy) * P.LEGITIMACY_INERTIA +
    shockScalar('legitimacy') + (exo.legitimacy_bonus || 0)), 0, 100);

  /* --- 7.13 endogenous shocks arm themselves for NEXT round -------------- */
  const endogenous = [];
  if (cohesion < 35) endogenous.push('civil_unrest');
  /* In deficit for two years running, however many steps that is. */
  const negYears = reserves < 0 ? (prev._negYears || 0) + dt : 0;
  if (tickMode ? negYears >= 2 : (reserves < 0 && prev.fiscal.reserves_bn < 0)) endogenous.push('fiscal_crisis');
  if (worstEssential < 40) endogenous.push('service_failure_cascade');
  // Sustained fury is its own shock, whatever the cohesion formula says.
  if (unrest >= 75 && endogenous.indexOf('civil_unrest') < 0) endogenous.push('civil_unrest');

  /* --- 7.14 assemble ------------------------------------------------------ */
  return {
    meta: {
      state_label: prev.meta.state_label,
      society_name: prev.meta.society_name,
      round: nextRound,
      year: tickMode ? 2050 + Math.floor(tNext + 1e-9) : 2048 + nextRound * 2,
      narrative: prev.meta.narrative,
      /* Under ticks: which tick this is, the month it falls in, the years
         elapsed, and how long a tick is. */
      ...(tickMode ? { tick: tick, month: (tick % 12) + 1, t: Math.round(tNext * 1e6) / 1e6, dt: dt } : {})
    },
    population: {
      total: demo.total,
      by_age: { age_0_19: demo.age_0_19, age_20_64: demo.age_20_64, age_65_plus: demo.age_65_plus },
      by_exposure: { high: hi, medium: md, low: lo },
      employed_total: employedTotal
    },
    sectors: sectors,
    fiscal: {
      gdp_bn: round2(gdp),
      corporate_profit_bn: round2(corporateProfit),
      tax_revenue_bn: round2(taxRevenue),
      public_dividend_bn: round2(publicDividend),
      reserves_bn: round2(reserves),
      allocation: { ubi: a.ubi, infrastructure: a.infrastructure, reserves: a.reserves }
    },
    indicators: {
      ubi_monthly_sgd: ubiMonthly,
      ubi_base_share_sgd: ubiBaseShare,
      real_ubi_index: realUbiIndex,
      effective_ubi_index: effectiveUbiIndex,
      employment_rate: round2(employmentRate),
      gini: gini,
      cohesion: cohesion,
      legitimacy: legitimacy,
      consumption_index: consumptionIndex,
      civic_unrest: unrest
    },
    levers: deepClone(L),
    trade: prev.trade || { reputation: 50, active_contracts: [] },
    shocks: names.slice(),
    personas: prev.personas || [],
    news: [],
    score: { total: 0, gates_failed: [] },

    /* engine carry-forward. Prefixed _, not part of the published schema. */
    _priceIndex: priceIndex,
    _computePrice: computePrice,
    _computeTightness: round2(computeTightness),
    _capitalIndex: nextCapitalIndex,
    _autoExperience: autoExperience,
    /* One round's compute draw added to the running total. `autoWeighted`
       is the economy's automation share, so this is "how much compute has
       this society ever consumed", indexed to round 1. */
    _computeCumulative: cumulativeIn + Math.max(0, autoWeighted / CAL.AUTO_WEIGHTED) * K,
    _sectorCapital: nextSectorCapital,
    _infraSpend_bn: infraBn,
    _consumptionSpend_bn: desiredSpendReal * priceLevel,
    _reskillHistory: reskillHistory,
    _endogenousNext: endogenous,
    _wageBill_bn: round2(wageBill),
    _ubiTotalPaid_bn: round2(ubiTotalPaid),
    _guaranteeCost_bn: round2(guaranteeCost),
    _publicSubsidy_bn: round2(publicSubsidy),
    _obligations_bn: round2(obligations),
    _spendable_bn: round2(spendable),
    _worstEssential: worstEssential,
    _unrestDrag: round2(unrestDrag),
    /* Written only once an agent channel or a policy has been used, so a
       run without either produces the same states, key for key. */
    ...((markupDen > 0 && (markupNum !== markupDen || prev._markupIndex != null))
      ? { _markupIndex: markupNum / markupDen } : {}),
    ...(demo._adj ? { _popAdjust: demo._adj } : {}),
    ...(dist ? { _distribution_bn: { paid: round2(distPaid), from_the_payment: round2(distCarved), new_money: round2(distNew) } } : {}),
    ...(tickMode ? {
      _exact: { quality: exactQuality, automation: automation, reserves: reserves, consumption: consumptionExact,
                gini: giniExact, cohesion: cohesionExact, legitimacy: legitimacyExact },
      _demoPending: demo._pending, _negYears: negYears,
      _exposureAuto: expDue ? autoWeighted : prevAutoWeighted
    } : {}),
    ...(pol.active ? { _policyRevenue_bn: round2(policyRevenue), _policySpend_bn: round2(policySpend),
                       _transfers_bn: round2(transfersBn) } : {})
  };
}


/* ---------------------------------------------------------------------
   7b. HOUSEHOLD RESPONSE
   ---------------------------------------------------------------------
   The forty households respond to conditions, identically in every
   society - that is what makes cross-team comparison mean anything. This
   is the deterministic part. A household voice agent may render Mdm Tan's
   round in first person however it likes, but it may not change this
   number, and the number is what the auditor sees.

   Each household leans on different parts of the state depending on where
   it sits in the life course.
   --------------------------------------------------------------------- */
function personaDeps(age) {
  if (age >= 65) return ['care_services', 'healthcare'];
  if (age < 25) return ['education_research', 'retail_commerce'];
  return ['healthcare', 'retail_commerce'];
}

function updatePersonas(personas, state, prev, years) {
  /* `years` is how long has passed; two is the original round. */
  years = years || 2;
  const settle = years === 2 ? 0.42 : 1 - Math.pow(1 - 0.42, years / 2);
  const ind = state.indicators;
  const purchasing = ind.effective_ubi_index != null ? ind.effective_ubi_index : ind.real_ubi_index;
  return (personas || []).map(p => {
    const age = p.age + years;
    const deps = personaDeps(age);
    const services = deps.reduce((a, k) => a + (state.sectors[k] ? state.sectors[k].quality : 60), 0) / deps.length;

    // Working-age households also carry the labour market; retirees do not.
    const workWeight = (age >= 65 || age < 20) ? 0 : 1;
    const target = clamp(
      14 +
      34 * clamp(services / 85, 0, 1.05) +
      30 * clamp(purchasing / 150, 0, 1.05) +
      18 * workWeight * clamp(ind.employment_rate / 0.6, 0, 1) +
      (workWeight ? 0 : 14) +
      10 * clamp((0.45 - ind.gini) / 0.2, 0, 1), 0, 100);

    // Wellbeing is sticky: lives do not turn around in a single round.
    const wellbeing = clamp(Math.round(p.wellbeing + (target - p.wellbeing) * settle), 0, 100);
    return Object.assign({}, p, { age: age, wellbeing: wellbeing });
  });
}

/* ---------------------------------------------------------------------
   7c. BULLETIN
   ---------------------------------------------------------------------
   Deterministic facts, not narration. The news bureau agent dresses these
   up; it does not get to invent them, and it does not get to leave one
   out. Every society reporting the same round from the same state reports
   the same facts.
   --------------------------------------------------------------------- */
function bulletin(state, prev) {
  const out = [];
  const ind = state.indicators, pind = prev.indicators;
  const money = v => '$' + Math.round(v).toLocaleString('en-SG');

  (state.shocks || []).forEach(k => {
    if (SHOCKS[k]) out.push(SHOCKS[k].label + ' declared. Emergency measures in force.');
  });

  const dU = ind.ubi_monthly_sgd - pind.ubi_monthly_sgd;
  if (Math.abs(dU) >= 20) {
    out.push('Universal payment ' + (dU > 0 ? 'raised to ' : 'cut to ') + money(ind.ubi_monthly_sgd) +
      ' a month' + (ind.real_ubi_index < pind.real_ubi_index && dU > 0
        ? ', though prices rose faster and purchasing power fell.' : '.'));
  }

  ORDER.forEach(k => {
    const q = state.sectors[k].quality, pq = prev.sectors[k].quality;
    if (q < 40 && pq >= 40) out.push(SECTORS[k].name + ' falls below the critical service threshold.');
    else if (q >= 40 && pq < 40) out.push(SECTORS[k].name + ' recovers above the critical threshold.');
    else if (q >= 65 && pq < 65) out.push(SECTORS[k].name + ' returns to a healthy service level.');
  });

  const dE = (ind.employment_rate - pind.employment_rate) * 100;
  if (Math.abs(dE) >= 3) {
    out.push('Employment ' + (dE > 0 ? 'rises' : 'falls') + ' ' + Math.abs(dE).toFixed(0) +
      ' points to ' + Math.round(ind.employment_rate * 100) + '% of working age.');
  }

  if (state.fiscal.reserves_bn < 0 && prev.fiscal.reserves_bn >= 0) {
    out.push('Reserves exhausted. The budget is now financed by borrowing.');
  }
  if (ind.cohesion < 35 && pind.cohesion >= 35) {
    out.push('Cohesion falls below the unrest threshold.');
  }
  if (ind.consumption_index < 80 && pind.consumption_index >= 80) {
    out.push('Household spending falls below 80% of its 2050 level; firms report thinning order books.');
  }

  if (!out.length) {
    out.push('No change of record. Universal payment holds at ' + money(ind.ubi_monthly_sgd) +
      ', worst essential service at ' + state._worstEssential + '.');
  }
  return out.slice(0, 4);
}

/* ---------------------------------------------------------------------
   8. TRAJECTORY
   ---------------------------------------------------------------------
   Run levers forward from round 1. `leversFor` may be a plain object
   (hold these levers for all twelve rounds - this is what the live lab
   does while you drag) or a function of round (replay a real game where
   the team changed their mind every round).
   --------------------------------------------------------------------- */
function seed(baseState) {
  const s = deepClone(baseState);
  s._priceIndex = 1;
  s._computePrice = 1;
  s._computeTightness = 1;
  s._capitalIndex = 1;
  s._autoExperience = {};
  ORDER.forEach(k => { s._autoExperience[k] = s.sectors[k].automation; });
  s._computeCumulative = 1;
  s._sectorCapital = {};
  ORDER.forEach(k => { s._sectorCapital[k] = 1; });
  s._infraSpend_bn = CAL.INFRA;
  s._consumptionSpend_bn = CAL.SPEND;
  s._reskillHistory = [118 * 0.08];
  s._endogenousNext = [];
  s._worstEssential = Math.min.apply(null, ESSENTIAL.map(k => s.sectors[k].quality));
  if (s.indicators.effective_ubi_index == null) {
    const acc = clamp(0.30 + 0.70 * clamp((s._worstEssential - 20) / 55, 0, 1), 0.30, 1.0);
    s.indicators.effective_ubi_index = Math.round(s.indicators.real_ubi_index * acc);
  }
  if (s.indicators.ubi_base_share_sgd == null) s.indicators.ubi_base_share_sgd = s.indicators.ubi_monthly_sgd;
  if (s.indicators.civic_unrest == null) s.indicators.civic_unrest = 0;
  return s;
}

/** A deck name, or an environment-director event carrying its effects. */
function isShock(x) {
  return typeof x === 'string' ? !!SHOCKS[x] : !!(x && typeof x === 'object' && x.effects);
}

function runTrajectory(baseState, leversFor, shockSchedule, rounds, exogenousFor) {
  rounds = rounds || 12;
  const getLevers = typeof leversFor === 'function' ? leversFor : () => leversFor;
  const sched = shockSchedule || {};
  const out = [seed(baseState)];

  for (let r = 1; r < rounds; r++) {
    const prev = out[out.length - 1];
    const drawn = (sched[r + 1] || []).slice();
    // Endogenous shocks armed last round fire now.
    (prev._endogenousNext || []).forEach(e => { if (drawn.indexOf(e) < 0) drawn.push(e); });
    const next = step(prev, getLevers(r + 1), drawn.filter(isShock),
                      exogenousFor ? exogenousFor(r + 1) : null);
    next.personas = updatePersonas(prev.personas, next, prev);
    next.news = bulletin(next, prev);
    out.push(next);
  }
  return out;
}

/* ---------------------------------------------------------------------
   9. SCORING — the Societal Resilience Index
   ---------------------------------------------------------------------
   Scored across the WHOLE trajectory, not the final round. You cannot fix
   round 9 in round 12. Two design choices do most of the work:

     - UBI is scored on purchasing power indexed to round 1, never on the
       dollar figure. Import inflation can raise a nominal UBI while the
       people receiving it get poorer.
     - Services are scored on your WORST sector, never the average, so you
       cannot sacrifice healthcare to fund transport.
   --------------------------------------------------------------------- */
function score(traj, constitution, opts) {
  const n = traj.length;
  /* Scored on EFFECTIVE purchasing power, never the dollar figure and
     never even the inflation-adjusted figure: a large cheque in a society
     whose hospitals have failed does not buy a large life. */
  const realUbi = traj.map(s => s.indicators.effective_ubi_index != null
    ? s.indicators.effective_ubi_index : s.indicators.real_ubi_index);
  const meanReal = realUbi.reduce((x, y) => x + y, 0) / n;
  // Round 1 is 100 by definition, so it is excluded: everyone would
  // otherwise be handed the minimum-UBI marks for free.
  const minReal = Math.min.apply(null, realUbi.slice(1));

  const worstEver = Math.min.apply(null,
    traj.map(s => Math.min.apply(null, ESSENTIAL.map(k => s.sectors[k].quality))));

  const last = traj[n - 1];
  const meanCohesion = traj.reduce((x, s) => x + s.indicators.cohesion, 0) / n;
  const meanGini = traj.reduce((x, s) => x + s.indicators.gini, 0) / n;

  /* Constitutional fidelity: how far the levers drifted from the founding
     settings the team sealed in week one, before they knew what was
     coming. Drift is not automatically a sin - at judging you are asked
     whether you can justify it - but it is measured.

     WHY THIS TAKES A PRE-COMPUTED FIGURE
     ------------------------------------
     These fifteen marks are the only ones a team's WRITING can earn, and
     until now they were awarded for free. The block below reads
     `constitution.levers` - a numeric block that only the JSON-authored
     constitutions in `engine/harnesses/reference.js` carry. A markdown
     constitution, which is what `harness/cabinet.js` parses and what the
     spec asks teams to write, has no such key, so `terms` stayed zero,
     `fidelity` stayed 1, and every prose-authored government collected
     all fifteen marks whatever it did.

     `harness/auditor.js` has computed the real figure all along -
     unminuted departures, rules broken, rounds ungoverned, clause
     coverage, volatility - and was wired to nothing. It needs the TRACE,
     which a scoring function over a trajectory does not have, so the
     caller computes it and passes it in:

         E.score(traj, con, { constitutional_drift: audit.constitutional_drift })

     The lever-block comparison is kept as the fallback for callers with
     no trace, so nothing that scored before scores differently now. */
  let fidelity = 1;
  if (opts && typeof opts.constitutional_drift === 'number' &&
      isFinite(opts.constitutional_drift)) {
    fidelity = clamp(1 - opts.constitutional_drift, 0, 1);
  } else if (constitution && constitution.levers) {
    const c = constitution.levers, f = last.levers;
    let drift = 0, terms = 0;
    ['corporate_tax_rate', 'compute_levy', 'reskilling_spend_pct', 'public_ownership_pct'].forEach(k => {
      if (c[k] != null) { drift += Math.abs(f[k] - c[k]); terms++; }
    });
    if (c.allocation && c.allocation.ubi != null) { drift += Math.abs(f.allocation.ubi - c.allocation.ubi); terms++; }
    if (c.care_job_guarantee != null && c.care_job_guarantee !== f.care_job_guarantee) { drift += 0.25; terms++; }
    if (c.working_week_days != null) { drift += Math.abs(f.working_week_days - c.working_week_days) * 0.12; terms++; }
    fidelity = terms ? clamp(1 - (drift / terms) * 2.2, 0, 1) : 1;
  }

  const components = {
    sustained_real_ubi: 25 * clamp(Math.sqrt(clamp(meanReal, 0, 260) / 260), 0, 1),
    minimum_ubi: 15 * clamp(minReal / 130, 0, 1),
    worst_service: 20 * clamp((worstEver - 25) / 58, 0, 1),
    cohesion_equality: 15 * (0.6 * clamp(meanCohesion / 100, 0, 1) +
                             0.4 * clamp((0.50 - meanGini) / 0.25, 0, 1)),
    constitutional_fidelity: 15 * fidelity,
    fiscal_sustainability: 10 * (0.6 * clamp(last.fiscal.reserves_bn / 90, 0, 1) +
                                 0.4 * (traj.every(s => s.fiscal.reserves_bn >= 0) ? 1 : 0))
  };
  Object.keys(components).forEach(k => { components[k] = Math.round(components[k] * 10) / 10; });
  let total = Object.keys(components).reduce((x, k) => x + components[k], 0);

  /* Hard gates CAP the total. They do not merely subtract from it. */
  const gates = [];
  if (traj.some(s => s.fiscal.reserves_bn < 0)) gates.push('insolvency');
  ESSENTIAL.forEach(k => {
    for (let i = 1; i < n; i++) {
      if (traj[i].sectors[k].quality < 40 && traj[i - 1].sectors[k].quality < 40) {
        gates.push('service_critical_' + k);
        break;
      }
    }
  });
  if (last.indicators.legitimacy < 25) gates.push('legitimacy_collapse');
  if (gates.length) total = Math.min(total, 45 - 6 * (gates.length - 1));

  return {
    total: Math.max(0, Math.round(total)),
    gates_failed: gates,
    components: components,
    diagnostics: {
      mean_real_ubi: Math.round(meanReal),
      min_real_ubi: minReal,
      worst_essential_ever: worstEver,
      mean_cohesion: Math.round(meanCohesion),
      mean_gini: round2(meanGini),
      final_reserves_bn: last.fiscal.reserves_bn,
      final_ubi_monthly: last.indicators.ubi_monthly_sgd
    }
  };
}


/* ---------------------------------------------------------------------
   10. VITALS — the people behind the curve
   ---------------------------------------------------------------------
   A population line falling from 5.94 to 5.52 million is not a line. It
   is roughly twenty-eight thousand babies a year and rather more funerals,
   and a society that only ever sees the line has been taught the wrong
   thing.

   Nothing here is invented. Both numbers are already implied by the age
   bands the engine carries; this reads them back out. Deaths come from the
   over-65 band at a mortality rate calibrated to give Singapore's real
   birth rate as the residual; births are then whatever must have happened
   for the total to land where it did.

   None of it is scored. It is true, and it is for the news bureau.
   --------------------------------------------------------------------- */
const MORTALITY_65_PLUS = 0.025;   // per year, over-65 band

function vitals(prev, next) {
  const years = 2;
  const p0 = prev.population, p1 = next.population;

  const deaths = Math.round(p0.by_age.age_65_plus * MORTALITY_65_PLUS * years);
  // Total change is births minus deaths, so births fall out of it.
  const births = Math.max(0, Math.round((p1.total - p0.total) + deaths));

  // Flows between the bands: who turned 65, who left school for the
  // labour market that may not have a job for them.
  const turned65 = Math.max(0, Math.round((p1.by_age.age_65_plus - p0.by_age.age_65_plus) + deaths));
  const leftSchool = Math.max(0, Math.round(births - (p1.by_age.age_0_19 - p0.by_age.age_0_19)));

  const jobsLost = Math.max(0, p0.employed_total - p1.employed_total);
  const jobsMade = Math.max(0, p1.employed_total - p0.employed_total);

  return {
    years: years,
    births: births, deaths: deaths,
    births_per_year: Math.round(births / years),
    deaths_per_year: Math.round(deaths / years),
    turned_65: turned65,
    left_school: leftSchool,
    jobs_lost: jobsLost, jobs_created: jobsMade,
    net_population: p1.total - p0.total
  };
}

/* ---------------------------------------------------------------------
   11. INTERPOLATION — the years between the checkpoints
   ---------------------------------------------------------------------
   The engine settles the world every two years, but the world does not
   wait for it. A round's state is not a photograph of one instant, it is
   where the society had got to by then — so reading the path between two
   checkpoints is legitimate, and it is the difference between watching a
   society live and clicking through twelve slides.

   `t` runs 0 to 1 across the round. Continuous quantities move; counts
   round; anything a government chose rather than the world produced —
   levers, the ubi design, the shock list — holds until the round turns.
   --------------------------------------------------------------------- */
function interpolate(a, b, t) {
  t = clamp(t, 0, 1);
  if (t <= 0) return deepClone(a);
  if (t >= 1) return deepClone(b);
  const L = (x, y) => x + (y - x) * t;
  const Li = (x, y) => Math.round(L(x, y));
  const out = deepClone(a);

  out.meta.round = a.meta.round;
  out.meta.year = a.meta.year;
  out.meta.year_exact = Math.round((a.meta.year + t * 2) * 10) / 10;
  out.meta.progress = Math.round(t * 100) / 100;

  const pa = a.population, pb = b.population;
  out.population.total = Li(pa.total, pb.total);
  ['age_0_19', 'age_20_64', 'age_65_plus'].forEach(k => {
    out.population.by_age[k] = Li(pa.by_age[k], pb.by_age[k]);
  });
  ['high', 'medium', 'low'].forEach(k => {
    out.population.by_exposure[k] = Li(pa.by_exposure[k], pb.by_exposure[k]);
  });
  out.population.employed_total = Li(pa.employed_total, pb.employed_total);

  ORDER.forEach(k => {
    const sa = a.sectors[k], sb = b.sectors[k], so = out.sectors[k];
    so.automation = round2(L(sa.automation, sb.automation));
    so.capacity = round2(L(sa.capacity, sb.capacity));
    so.margin = round2(L(sa.margin, sb.margin));
    so.headcount = Li(sa.headcount, sb.headcount);
    // Quality is what colours the city, so let it move smoothly too.
    so.quality = Li(sa.quality, sb.quality);
  });

  ['gdp_bn', 'corporate_profit_bn', 'tax_revenue_bn', 'public_dividend_bn', 'reserves_bn']
    .forEach(k => {
      if (a.fiscal[k] != null && b.fiscal[k] != null) out.fiscal[k] = round2(L(a.fiscal[k], b.fiscal[k]));
    });

  const ia = a.indicators, ib = b.indicators, io_ = out.indicators;
  io_.ubi_monthly_sgd = Li(ia.ubi_monthly_sgd, ib.ubi_monthly_sgd);
  if (ia.ubi_base_share_sgd != null) io_.ubi_base_share_sgd = Li(ia.ubi_base_share_sgd, ib.ubi_base_share_sgd);
  io_.real_ubi_index = Li(ia.real_ubi_index, ib.real_ubi_index);
  if (ia.effective_ubi_index != null) io_.effective_ubi_index = Li(ia.effective_ubi_index, ib.effective_ubi_index);
  io_.employment_rate = Math.round(L(ia.employment_rate, ib.employment_rate) * 1000) / 1000;
  io_.gini = round2(L(ia.gini, ib.gini));
  io_.cohesion = Li(ia.cohesion, ib.cohesion);
  io_.legitimacy = Li(ia.legitimacy, ib.legitimacy);
  io_.consumption_index = Li(ia.consumption_index, ib.consumption_index);

  // Households age continuously; their wellbeing drifts with the world.
  if (Array.isArray(a.personas) && Array.isArray(b.personas)) {
    out.personas = a.personas.map((pa2, i) => {
      const pb2 = b.personas[i] || pa2;
      const q = deepClone(pa2);
      q.age = Math.floor(L(pa2.age, pb2.age));
      q.wellbeing = Li(pa2.wellbeing, pb2.wellbeing);
      return q;
    });
  }

  // A shock is declared, not eased into; the same goes for the bulletin.
  out.shocks = (t >= 0.5 ? b : a).shocks;
  out.news = (t >= 0.5 ? b : a).news;
  return out;
}

/* --------------------------------------------------------------------- */
root.MeridianEngine = {
  step: step,
  seed: seed,
  updatePersonas: updatePersonas,
  bulletin: bulletin,
  runTrajectory: runTrajectory,
  score: score,
  demography: demography,
  vitals: vitals,
  interpolate: interpolate,
  MORTALITY_65_PLUS: MORTALITY_65_PLUS,
  SECTORS: SECTORS,
  ORDER: ORDER,
  ESSENTIAL: ESSENTIAL,
  SHOCKS: SHOCKS,
  POLICY_GRAMMAR: POLICY_GRAMMAR,
  isShock: isShock,
  validatePolicy: validatePolicy,
  compilePolicies: compilePolicies,
  adjustDemography: adjustDemography,
  DEFAULT_LEVERS: DEFAULT_LEVERS,
  PARAMS: P,
  COST_SHARE: COST_SHARE,
  /* The margin each sector was CALIBRATED to. Industry agents need
     it to tell 'we are doing badly' from 'this is what this
     industry always does' — care services run at -0.09 by design,
     and a firm judging itself against zero would be permanently
     convinced it was failing. */
  R1_MARGINS: R1_MARGINS,
  CAL: CAL,
  /* What each industry is FOR. Exposed rather than stored on the state:
     a mission does not change round to round, so putting it in every
     sector block of every round would be noise in the trace and churn in
     the world-state schema. Reports and industry agents read it here. */
  MISSIONS: MISSIONS ? MISSIONS.MISSIONS : null,
  DIMENSIONS: MISSIONS ? MISSIONS.DIMENSIONS : null,
  version: '1.0.0'
};

})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).MeridianEngine;
}
