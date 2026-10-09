/* =====================================================================
   CONTRIBUTION CREDIT — paying people for what they give
   ---------------------------------------------------------------------
   Citizens earn credit for prosocial acts that are not their job —
   volunteering, running the block's repair shop, covering a care service
   the state stopped providing. Credit buys things. The question the
   simulation exists to ask is what that does to the giving.

   THE HOLE THIS FILLS
   -------------------
   Prosocial behaviour was modelled as costless altruism. An agent chose
   `flourish` or `mutual_aid`, the country gained capacity and cohesion,
   and the person gained nothing at all. That is a one-way loop and it
   was the least defensible thing in the model: a society where the only
   income is a universal payment, and where contributing is pure
   sacrifice, has no account of why anybody would keep contributing.

   WHY THIS IS NOT A BONUS MULTIPLIER
   ----------------------------------
   Because the evidence says a bonus multiplier is wrong, and a
   simulation that gets this backwards teaches the wrong lesson with
   great confidence.

   Paying people for prosocial acts can REDUCE those acts. Titmuss on
   voluntary versus paid blood donation; Deci, Koestner & Ryan's
   meta-analysis on the undermining of intrinsic motivation; Gneezy &
   Rustichini's Haifa daycare study, where fining late parents made
   lateness WORSE because it converted a social obligation into a
   priced service. Frey & Jegen named the mechanism: motivation
   crowding.

   So the response here has a peak. A small reward recruits people who
   would not otherwise have shown up. A large one tells everybody that
   showing up is work, and the people who were there for other reasons
   stop being there for those reasons.

        net effect = extrinsic recruitment - intrinsic displaced

        recruitment   RECRUIT * (1 - e^(-SATURATION * rate))
                      saturating: the first dollar recruits far more
                      people than the tenth
        displaced     DISPLACE * rate
                      linear: every increase in the reward tells more
                      people that this is work rather than a gift

     The first draft used `extrinsic + e^(-crowd * rate) - 1`, which
     cannot have an interior peak for ANY coefficients: its derivative
     is monotone, so the curve either rises forever (no crowding out at
     all) or falls from zero (crowding out immediately, with no
     recruiting range). It read as plausible and it was the wrong shape.
     A saturating gain against a linear loss is the shape the literature
     actually describes, and it peaks.

   At zero generosity both terms cancel and nothing changes, which is
   the correct null. Somewhere above zero there is an optimum. Above
   that, paying more buys less. **Finding the peak is the exercise** —
   and a team that maximises the lever will do worse than one that
   thinks about it, which is the entire pedagogical point.

   Sources and the argument for the shape: docs/EVIDENCE.md section 5.

   WHAT IT COSTS
   -------------
   Credit is a claim on real services, so redeeming it is a real
   expense. It is drawn from reserves through the exogenous channel the
   engine already accepts, which means this whole file changes no engine
   code and carries no JS/Python parity obligation. A scheme that
   appeared to be free would be worse than no scheme.
   ===================================================================== */

'use strict';

const A = require('./action_space.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   THE POLICY
   ---------------------------------------------------------------------
   `rate` is the generosity of the scheme, 0 to 1. Zero is no scheme at
   all and is the default: a team must choose to build this, and choose
   how far to take it.
   --------------------------------------------------------------------- */
const DEFAULT_POLICY = {
  rate: 0,

  /* WHETHER CREDIT GATES ESSENTIALS.
     Available, and off by default, and it should stay off by default.

     Look at who cannot earn: Mr Krishnan (chronic illness, 74), Mdm Tan
     Ah Choo (retired cleaner, 68), Priya Raman (single parent already
     working part-time). Gating healthcare on contribution excludes
     precisely the people who most need it — a poverty trap with extra
     steps.

     It is exposed as a lever rather than forbidden because a team
     should be able to try it and watch what it does to those three
     cohorts. Discovering it is a trap is worth more than being told. */
  gates_essentials: false,

  /* What credit buys when it does not gate essentials. Discretionary
     things: getting about, and having a life. */
  buys: ['retail_commerce', 'transport_logistics']
};

/* ---------------------------------------------------------------------
   WHICH ACTS EARN
   ---------------------------------------------------------------------
   Contribution, not conformity. `obey` is in the action space and a
   scheme that paid for it would be a different political object — one
   that buys compliance rather than participation. This project models
   the first and says so.
   --------------------------------------------------------------------- */
const EARNS = {
  flourish: 1.0,      // building something with genuine spare capacity
  mutual_aid: 1.0,    // covering for a service the state stopped providing
  activism: 0.15      // civic participation, but it is not care work
};

/* ---------------------------------------------------------------------
   CROWDING
   ---------------------------------------------------------------------
   RECRUIT      the most a reward can ever recruit
   SATURATION   how quickly it gets there
   DISPLACE     intrinsic motivation lost per unit of generosity

   All three are Placeholder magnitudes. The SHAPE is evidenced; the
   numbers are not fitted to any published elasticity, and
   docs/EVIDENCE.md section 5 says so plainly.

   They put the peak near a rate of 0.28 and the break-even near 0.71 —
   generosity above about seventy per cent does outright harm. Those two
   figures are what a team should be arguing with rather than trusting,
   and `optimum()` and `breakEven()` compute them rather than hard-coding
   them so that changing a coefficient cannot leave the documentation
   quietly wrong.
   --------------------------------------------------------------------- */
const RECRUIT = 0.45;      // how much a reward can ever recruit
const SATURATION = 4.0;    // how fast it gets there
const DISPLACE = 0.60;     // intrinsic motivation lost per unit generosity

/**
 * How the appetite for prosocial action changes at this generosity.
 * Zero at rate zero; positive while recruitment dominates; negative once
 * crowding does.
 */
function crowding(rate) {
  const r = clamp(Number(rate) || 0, 0, 1);
  if (r === 0) return 0;
  const recruited = RECRUIT * (1 - Math.exp(-SATURATION * r));
  const displaced = DISPLACE * r;
  return recruited - displaced;
}

/** The generosity at which `crowding` is greatest, found numerically. */
function optimum() {
  let best = 0, bestVal = 0;
  for (let r = 0; r <= 1.0001; r += 0.005) {
    const v = crowding(r);
    if (v > bestVal) { bestVal = v; best = r; }
  }
  return { rate: Math.round(best * 1000) / 1000, effect: Math.round(bestVal * 1000) / 1000 };
}

/** Where paying more starts doing outright harm. */
function breakEven() {
  let last = 0;
  for (let r = 0.005; r <= 1.0001; r += 0.005) {
    const v = crowding(r);
    if (v <= 0 && last > 0) return Math.round(r * 1000) / 1000;
    last = v;
  }
  return null;
}

/* ---------------------------------------------------------------------
   WHAT A COHORT CAN EARN
   ---------------------------------------------------------------------
   Earning requires being ABLE to contribute. A cohort with no slack and
   no capacity to give is not choosing to withhold; it has nothing
   spare. This is what makes gating essentials a trap rather than an
   incentive, and the model must reproduce that faithfully or the trap
   will not show.
   --------------------------------------------------------------------- */
function earnedBy(action, policy) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  if (!p.rate) return 0;
  const weightPerAct = EARNS[action.key] || 0;
  if (!weightPerAct) return 0;
  return weightPerAct * p.rate * (action.weight || 0);
}

/* ---------------------------------------------------------------------
   WHO IS LEFT OUT
   ---------------------------------------------------------------------
   Reported explicitly, every round, because it is the finding most
   likely to be missed. A scheme can raise contribution overall and
   still exclude the cohorts that needed it most, and an aggregate
   number will not say so.
   --------------------------------------------------------------------- */
function excluded(actions, policy) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  if (!p.rate) return [];
  return actions
    .filter(a => !EARNS[a.key])
    .map(a => ({
      id: a.id, name: a.name, role: a.role,
      weight: a.weight, did: a.key,
      /* Could this cohort have earned, had it chosen to? Someone with
         no slack could not, and that distinction is the whole argument
         against gating essentials. */
      could_have: (a.slack || 0) >= 35,
      locked_out: (a.slack || 0) < 35
    }));
}

/* ---------------------------------------------------------------------
   THE EFFECTS
   ---------------------------------------------------------------------
   Delivered through exogenous inputs the engine already takes, so
   nothing in `meridian-engine.js` changes and JS/Python parity is
   untouched.
   --------------------------------------------------------------------- */
function effects(actions, policy) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  const out = { capacity: {}, cohesion_bonus: 0, reserves_bn: 0,
                credits_earned: 0, participation: 0, excluded_share: 0 };
  if (!p.rate) return out;

  let earned = 0, participating = 0;
  actions.forEach(a => {
    const e = earnedBy(a, p);
    if (e > 0) { earned += e; participating += (a.weight || 0); }
  });

  out.credits_earned = Math.round(earned * 1000) / 1000;
  out.participation = Math.round(participating * 100);

  /* THE BILL. Credit is redeemed against real services, so the state
     buys them. Scaled by generosity and by how many people earned. A
     scheme nobody uses costs nothing; a popular, generous one is a
     serious line in the budget. */
  out.reserves_bn = -Math.round(earned * 14 * 100) / 100;

  /* What the contribution actually delivers. This is on TOP of the
     capacity mutual aid already provides in the action space — the
     credit does not create the work, it recruits more of it. */
  p.buys.forEach(k => {
    out.capacity[k] = 1 + 0.06 * earned;
  });

  /* Cohesion rises with participation and falls with exclusion: a
     society where contribution is rewarded and a third of people
     cannot contribute is not more cohesive for it. */
  const lockedOut = excluded(actions, p)
    .filter(x => x.locked_out)
    .reduce((a, x) => a + (x.weight || 0), 0);
  out.excluded_share = Math.round(lockedOut * 100);
  /* Exclusion scales with GENEROSITY, not merely with the scheme
     existing. A token credit that a third of the country cannot earn is
     a minor unfairness; a generous one that the same third cannot earn
     is a visible class of people locked out of things their neighbours
     have, and it costs correspondingly more cohesion.

     The first draft applied the full penalty at any non-zero rate, so a
     1% scheme was as divisive as a 100% one, and every rate produced
     the identical cohesion figure. */
  out.cohesion_bonus = Math.round(
    (participating * 5 - lockedOut * 7 * p.rate) * 10) / 10;

  /* GATING ESSENTIALS.
     The harm is deliberately concrete rather than a penalty term: the
     essential services those locked out depend on get worse, because
     people who cannot pay stop turning up to them. */
  if (p.gates_essentials && lockedOut > 0) {
    ['healthcare', 'care_services'].forEach(k => {
      out.capacity[k] = (out.capacity[k] == null ? 1 : out.capacity[k])
                        - 0.22 * lockedOut * p.rate;
    });
    out.cohesion_bonus = Math.round(
      (out.cohesion_bonus - 12 * lockedOut * p.rate) * 10) / 10;
  }

  Object.keys(out.capacity).forEach(k => {
    out.capacity[k] = Math.max(0.55, Math.round(out.capacity[k] * 1000) / 1000);
  });
  return out;
}

/* ---------------------------------------------------------------------
   THE PULL ON A DECISION
   ---------------------------------------------------------------------
   How much more (or less) attractive prosocial action is under this
   policy, as a threshold shift the decider can apply. Capped for the
   same reason personality is capped: a scheme should move behaviour at
   the margin, not override circumstance. Somebody whose clinic has
   collapsed is not talked out of it by a transport credit.
   --------------------------------------------------------------------- */
function prosocialPull(policy) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  if (!p.rate) return 0;
  /* The multiplier sets how much this lever can matter. At 0.25 the
     whole scheme moved prosocial participation by about one point
     across its entire range, which makes it strictly dominated: a team
     would try it once, see nothing, and correctly ignore it. A lever
     that cannot change an outcome is not a decision.

     At 0.9 the peak is roughly a twelve per cent boost to a cohort's
     spare capacity — enough to tip cohorts over the slack threshold
     that gates prosocial action, and still far below what the working
     week or a collapsed service does. Secondary, not decorative. */
  return clamp(crowding(p.rate), -0.5, 0.5) * 0.9;
}

/** A one-line description a page or a report can print. */
function describe(policy) {
  const p = Object.assign({}, DEFAULT_POLICY, policy || {});
  if (!p.rate) return 'no contribution credit';
  const c = crowding(p.rate);
  const opt = optimum();
  const verdict = c > 0.02 ? 'recruiting' : c < -0.02 ? 'crowding out intrinsic motivation'
                                                      : 'roughly neutral';
  return 'credit at ' + Math.round(p.rate * 100) + '% (' + verdict +
         '; peak is ' + Math.round(opt.rate * 100) + '%)' +
         (p.gates_essentials ? ', gating essentials' : '');
}

module.exports = { DEFAULT_POLICY, EARNS, crowding, optimum, breakEven,
                   earnedBy, excluded, effects, prosocialPull, describe,
                   RECRUIT, SATURATION, DISPLACE };
