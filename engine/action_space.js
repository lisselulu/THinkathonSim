/* =====================================================================
   THE ACTION SPACE — what a citizen may decide to do
   ---------------------------------------------------------------------
   Sources: docs/EVIDENCE.md sections 2.1-2.4. The taxonomy is
   Hirschman's exit/voice/loyalty plus the two responses he does not
   cover, which are the two this project exists to study.

   Twelve behaviours across six families. This file is the ONE definition
   of them. It previously lived inside `lab/feed.js`, where it was a
   private const in a factory closure: the deterministic chooser could
   see it, and nothing else could. That was survivable while arithmetic
   made every decision. It stops being survivable the moment an agent
   outside this process has to pick from the same menu, because two
   copies of a taxonomy are one taxonomy and one bug.

   So: the list lives here, `actionsJson()` writes it out for the Python
   side, and a test asserts the two agree.

   WHAT IS NEW HERE: CONSEQUENCE
   -----------------------------
   Each behaviour carries what it DOES to the country, expressed in the
   exogenous inputs the engine already accepts — capacity multipliers,
   headcount, reserves, cohesion, legitimacy.

   This is the part that makes a run stop being a narration of itself.
   Before this, citizen behaviour reached the engine through exactly one
   channel: `civic_unrest`, computed from weighted mean SENTIMENT. A
   population that struck and a population that quietly endured produced
   an identical country as long as they felt the same. Feeling was
   modelled; doing was decorative.

   Now a strike removes capacity from the sectors the strikers actually
   work in. Mutual aid ADDS capacity to health and care, because a
   society covering for a collapsed service really does hold it up for a
   while — and that, mechanically, is the surplus/deficit distinction
   this project is about. Organising costs the government legitimacy.
   Emigration removes the people who left, and they were the mobile ones.

   MAGNITUDES ARE DELIBERATELY SMALL
   ---------------------------------
   Every coefficient is per unit of POPULATION WEIGHT — a behaviour
   chosen by a cohort standing for 9% of the country contributes 0.09 of
   its coefficient. Full national participation in a general strike costs
   about 18% of capacity in the struck sectors; realistic participation
   costs two or three. That is the intended order of magnitude.

   The same reasoning as `traits.js`: this must be a real channel and a
   secondary one. If society's mood could outweigh the budget, teams
   would be governing a weather system rather than an economy.
   ===================================================================== */

'use strict';

/* Sectors people withdraw labour FROM, and sectors neighbours can prop
   up. Care and healthcare appear in the second list because informal
   provision genuinely substitutes there; nobody's neighbours run a
   power station, so Compute & Energy is absent by design. */
const LABOUR_SECTORS = ['healthcare', 'transport_logistics', 'retail_commerce',
                        'care_services', 'food_agri', 'education_research',
                        'manufacturing', 'housing_construction'];
const COVERABLE_SECTORS = ['care_services', 'healthcare', 'food_agri'];

const ACTIONS = {
  /* ---- prosocial ---------------------------------------------------- */
  flourish: {
    family: 'prosocial', label: 'building something', tone: 'good',
    /* What the person has decided, in their own terms. Shown to a model
       that is writing their words, and to an agent choosing. */
    intent: 'using spare time on something for other people, and pleased about it',
    option: 'Put your spare time into something for other people — a class, a repair shop, a choir, the block.',
    /* Requires genuine slack. An agent may pick it anyway; `admissible`
       is what stops a starving cohort reporting that it is thriving. */
    needs: { slack: 0.35 },
    consequence: { cohesion: 6 }
  },
  mutual_aid: {
    family: 'prosocial', label: 'covering for the state', tone: 'mid',
    intent: 'covering, with neighbours, for something the state has stopped doing properly',
    option: 'Organise with neighbours to cover something the state has stopped doing properly.',
    needs: {},
    consequence: { cohesion: 3, capacity: { sectors: COVERABLE_SECTORS, mult: 0.10 } }
  },

  /* ---- conforming --------------------------------------------------- */
  endure: {
    family: 'conforming', label: 'getting on with it', tone: 'quiet',
    intent: 'getting on with it, with nothing much to report',
    option: 'Get on with it. Say nothing, change nothing.',
    needs: {}, consequence: {}
  },
  obey: {
    family: 'conforming', label: 'trusting the plan', tone: 'quiet',
    intent: 'trusting that the plan is working, and inclined to be patient',
    option: 'Trust that the plan is working and be patient a while longer.',
    needs: {}, consequence: { legitimacy: 2 }
  },

  /* ---- political ---------------------------------------------------- */
  debate: {
    family: 'political', label: 'arguing about it', tone: 'mid',
    intent: 'arguing publicly about whether things are actually working',
    option: 'Argue in public about whether any of this is actually working.',
    needs: {}, consequence: { legitimacy: -2 }
  },
  activism: {
    family: 'political', label: 'campaigning', tone: 'mid',
    intent: 'campaigning for one specific thing to be fixed',
    option: 'Campaign for one specific thing to be fixed.',
    needs: {}, consequence: { legitimacy: -5, cohesion: 1 }
  },

  /* ---- economic ----------------------------------------------------- */
  save: {
    family: 'economic', label: 'holding back', tone: 'mid',
    intent: 'holding money back because the future looks uncertain',
    option: 'Hold your money back. Spend nothing you do not have to.',
    needs: {},
    /* Demand withdrawal. The engine has no exogenous demand hook, so
       this lands as a small capacity effect in the sectors that live on
       discretionary spending, which is where it would actually show. */
    consequence: { capacity: { sectors: ['retail_commerce', 'food_agri', 'manufacturing'], mult: -0.06 } }
  },
  withdraw: {
    family: 'economic', label: 'going through the motions', tone: 'bad',
    intent: 'doing the bare minimum and no longer volunteering anything',
    option: 'Do the bare minimum. Stop volunteering anything you are not made to give.',
    needs: { working: true },
    consequence: { capacity: { sectors: LABOUR_SECTORS, mult: -0.07 }, cohesion: -3 }
  },
  emigrate: {
    family: 'economic', label: 'leaving', tone: 'bad',
    intent: 'leaving the country for good',
    option: 'Leave the country for good.',
    /* Leaving is available only to those who could actually go, which is
       the entire point of modelling it: a country in trouble does not
       lose a random slice of its people. */
    needs: { mobility: 0.5 },
    consequence: { headcount: { sectors: LABOUR_SECTORS, mult: -0.12 },
                   capacity: { sectors: LABOUR_SECTORS, mult: -0.08 },
                   cohesion: -4 }
  },

  /* ---- collective --------------------------------------------------- */
  organise: {
    family: 'collective', label: 'organising', tone: 'bad',
    intent: 'trying to get other people together to act about it',
    option: 'Try to get other people together to act about it.',
    needs: {},
    consequence: { legitimacy: -8, cohesion: 2 }
  },
  strike: {
    family: 'collective', label: 'striking', tone: 'bad',
    intent: 'stopping cooperating, together with others',
    option: 'Stop cooperating, together with everyone else who will.',
    /* You cannot withhold labour you are not being asked for. An
       unemployed cohort that wants to escalate organises; it does not
       strike, and an agent that picks `strike` while out of work is
       redirected rather than obeyed. */
    needs: { working: true, escalation: 'organise' },
    consequence: { capacity: { sectors: LABOUR_SECTORS, mult: -0.18 },
                   legitimacy: -10 }
  },

  /* ---- antisocial --------------------------------------------------- */
  breakrules: {
    family: 'antisocial', label: 'going around the rules', tone: 'bad',
    intent: 'working around the rules to get by',
    option: 'Work around the rules to get by. Everyone else is.',
    needs: {},
    /* Leakage, not theatre: informal activity that no longer passes
       through the accounts a state can see. */
    consequence: { reserves_bn: -1.4, legitimacy: -4, cohesion: -3 }
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
   An agent picks from a menu; the world decides whether the pick was
   possible. This is NOT a way to overrule an agent's judgement — every
   test here is about circumstance, never about whether the choice was
   wise. A 74-year-old on a chronic illness who decides to emigrate has
   made a coherent decision and cannot act on it.

   Returns the key actually taken, plus a note when it was redirected, so
   a run can be audited for how often the model asked for the impossible.
   --------------------------------------------------------------------- */
function admissible(key, ctx) {
  const a = ACTIONS[key];
  if (!a) return { key: 'endure', redirected: 'unknown action "' + key + '"' };
  const n = a.needs || {};

  if (n.working === true && !ctx.working) {
    // Escalate sideways rather than silently downgrading to nothing.
    const alt = n.escalation && ACTIONS[n.escalation] ? n.escalation : 'endure';
    return { key: alt, redirected: key + ' needs work to withhold' };
  }
  if (n.mobility != null && (ctx.mobility || 0) < n.mobility) {
    return { key: 'endure', redirected: key + ' needs the means to go' };
  }
  if (n.slack != null && (ctx.slack || 0) < n.slack) {
    /* Wanting to build something while having nothing spare is not
       flourishing, it is mutual aid — the same act, the other meaning,
       which is the distinction the whole simulation turns on. */
    return { key: 'mutual_aid', redirected: key + ' needs slack to spend' };
  }
  return { key: key, redirected: null };
}

/* ---------------------------------------------------------------------
   CONSEQUENCE
   ---------------------------------------------------------------------
   Weighted actions -> the exogenous object `E.step` already takes.

   `taken` is [{ key, weight }] — one entry per cohort that acted, with
   its share of the population. Everything is linear in weight, so a
   behaviour chosen by nobody costs nothing and a behaviour chosen by
   everyone costs its full coefficient.
   --------------------------------------------------------------------- */
function consequences(taken) {
  const capacity = {};
  const headcount = {};
  let cohesion = 0, legitimacy = 0, reserves = 0;

  (taken || []).forEach(t => {
    const a = ACTIONS[t.key];
    if (!a) return;
    const c = a.consequence || {};
    const w = Number(t.weight) || 0;

    if (c.cohesion) cohesion += c.cohesion * w;
    if (c.legitimacy) legitimacy += c.legitimacy * w;
    if (c.reserves_bn) reserves += c.reserves_bn * w;

    if (c.capacity) {
      c.capacity.sectors.forEach(k => {
        capacity[k] = (capacity[k] == null ? 1 : capacity[k]) + c.capacity.mult * w;
      });
    }
    if (c.headcount) {
      c.headcount.sectors.forEach(k => {
        headcount[k] = (headcount[k] == null ? 1 : headcount[k]) + c.headcount.mult * w;
      });
    }
  });

  /* Floors. A society can withhold a great deal of its cooperation and
     it cannot withhold more than all of it; without a floor a stacked
     round could hand the engine a negative capacity and produce a
     sector with negative output, which is not a dramatic result, it is
     a crash presented as one. */
  Object.keys(capacity).forEach(k => { capacity[k] = Math.max(0.55, capacity[k]); });
  Object.keys(headcount).forEach(k => { headcount[k] = Math.max(0.70, headcount[k]); });

  return {
    capacity: capacity,
    headcount: headcount,
    cohesion_bonus: Math.round(cohesion * 10) / 10,
    legitimacy_bonus: Math.round(legitimacy * 10) / 10,
    reserves_bn: Math.round(reserves * 100) / 100
  };
}

/** The menu an agent chooses from, as plain data. */
function menu() {
  return KEYS.map(k => ({
    key: k, family: ACTIONS[k].family, label: ACTIONS[k].label,
    option: ACTIONS[k].option
  }));
}

/** Everything Python needs, so the taxonomy is never retyped. */
function actionsJson() {
  return JSON.stringify({
    version: 1,
    actions: KEYS.reduce((o, k) => {
      const a = ACTIONS[k];
      o[k] = { family: a.family, label: a.label, tone: a.tone,
               intent: a.intent, option: a.option, needs: a.needs };
      return o;
    }, {}),
    families: FAMILIES
  }, null, 2);
}

module.exports = { ACTIONS, KEYS, FAMILIES, admissible, consequences,
                   menu, actionsJson, LABOUR_SECTORS, COVERABLE_SECTORS };
