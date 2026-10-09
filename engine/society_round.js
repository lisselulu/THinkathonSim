/* =====================================================================
   ONE ROUND OF SOCIETY — decided, not narrated
   ---------------------------------------------------------------------
   This is the piece that was missing, and it is worth being precise
   about what was wrong before, because the old arrangement LOOKED
   closed and was not.

   BEFORE
   ------
        cabinet -> levers -> engine -> state -> feed(state)

   The feed read a trajectory that had already been computed to its
   final round. Citizens could not have changed it: by the time anyone
   "reacted", 2074 already existed. What the page showed was a reading
   of a finished country — well-founded, genuinely derived from the
   state, and post-hoc. A team watching it could learn what their
   government DID; they could not watch society push back.

   There was one channel out of society and into the engine —
   `civic_unrest` — and it was computed from weighted mean SENTIMENT.
   So the model of society was: people feel things, and feeling things
   makes the economy slightly worse. What people DID was never an input.
   A population that struck and a population that quietly seethed
   produced an identical country.

   AFTER
   -----
        cabinet -> levers -> engine -> state
                                         |
                                  lived experience   (blind)
                                         |
                                    agents decide    (Concordia, or arithmetic)
                                         |
                                   consequences
                                         |
                        exogenous input to the NEXT round
                                         |
                                     engine ...

   Round N+1 is now a function of what people chose in round N. Mutual
   aid holds up care services; a strike takes capacity out of the
   sectors the strikers work in; the mobile emigrate and take their
   headcount with them. None of it is scripted and none of it is known
   before the round is played.

   WHAT THIS DOES NOT DO
   ---------------------
   It does not make the ENGINE non-deterministic. `E.step` remains a
   pure function of (state, levers, shocks, exogenous), and the
   exogenous object this file produces is written into the trace. Hand
   the trace back to `replaySociety` and the run reproduces exactly,
   with no model and no network. The agents are free; the physics are
   not; and the run is still a scorable object.
   ===================================================================== */

'use strict';

const A = require('./action_space.js');
const C = require('./citizen_friction.js');
const D = require('./decide.js');
const K = require('./contribution.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   The three readings a cohort's decision rests on. Imported in spirit
   from lab/feed.js — the same functions, because a cohort must not be
   under one pressure on the page and another in the engine.
   --------------------------------------------------------------------- */
function dispositionOf(p) {
  const age = parseInt(String(p.role).replace(/\D+/g, ''), 10) || 40;
  const mobility = clamp((p.income / 100) * 0.5 +
    (age < 35 ? 0.45 : age < 50 ? 0.2 : 0.02) +
    (p.exposure === 'high' ? 0.08 : 0), 0, 1);
  const trust = clamp(0.35 + (p.income / 100) * 0.4 + (p.working ? 0.12 : -0.1), 0, 1);
  const solidarity = clamp(0.75 - (p.income / 100) * 0.5 + (p.working ? 0.1 : 0), 0, 1);
  const ambition = clamp((p.income / 100) * 0.3 + (age < 40 ? 0.45 : 0.15), 0, 1);
  return { age, mobility, trust, solidarity, ambition };
}

function slackOf(p, s, d) {
  const week = s.levers && s.levers.working_week_days ? s.levers.working_week_days : 5;
  const time = p.working ? clamp((5 - week) / 2, 0, 1) * 0.8 + 0.1
                         : (d.purchasing_power >= 105 ? 0.55 : 0.05);
  const standing = 0.45 + (clamp(p.income, 0, 100) / 100) * 1.1;
  const money = clamp((d.purchasing_power * standing - 92) / 42, 0, 1);
  const svc = p.depends.reduce((a, k) => a + d.services[k].quality, 0) / p.depends.length;
  const security = clamp((svc - 55) / 25, 0, 1);
  return clamp(Math.min(time, money, security) * 1.15, 0, 1);
}

function pressureOf(p, s, d) {
  const svc = p.depends.reduce((a, k) => a + d.services[k].quality, 0) / p.depends.length;
  const exposure = 1 + (60 - clamp(p.income, 0, 100)) / 100;
  const material = clamp((100 - d.purchasing_power) * 0.6 * exposure, 0, 100);
  const service = clamp((62 - svc) * 1.5, 0, 100);
  const work = p.working ? clamp((45 - d.employment_pct) * 0.5, 0, 100)
                         : clamp((55 - d.employment_pct) * 0.9, 0, 100);
  const voice = clamp((55 - (s.indicators.legitimacy || 55)) * 1.2, 0, 100);

  /* Recorded in docs/EVIDENCE.md section 4, with the case that
     exposed it.
     WORST CHANNEL DOMINATES — it is not an average, and it used to be.
     ------------------------------------------------------------------
     The original weighted mean (0.32/0.34/0.22/0.12) had a structural
     failure that only showed once behaviour depended on it. In the 2058
     pandemic round, Mdm Tan Ah Choo scored material 53 and service 33
     with work and voice at zero, which the mean rendered as 28 — below
     every escalation threshold in the chooser. The same round's
     sentiment model put her at -63, furious. A retired cleaner who
     cannot afford food and whose clinic has failed was being modelled
     as mildly inconvenienced, because two channels she has no exposure
     to at all were averaged into her distress and diluted it.

     Nobody experiences hardship as a mean. A person with one
     catastrophe and three non-problems is in a catastrophe. So the
     worst channel sets the level and the others add to it, which both
     matches how people behave and reconciles this reading with the
     sentiment model that the engine is already tuned against. */
  const channels = [['material', material], ['service', service],
                    ['work', work], ['voice', voice]];
  const sorted = channels.slice().sort((a, b) => b[1] - a[1]);
  const worstVal = sorted[0][1];
  const restMean = (sorted[1][1] + sorted[2][1] + sorted[3][1]) / 3;
  const total = clamp(worstVal + restMean * 0.35, 0, 100);

  return { material, service, work, voice, total, worst: sorted[0][0] };
}

/* ---------------------------------------------------------------------
   THE ROUND
   ---------------------------------------------------------------------
     const r = await societyRound(prev, next, {
       decide: D.remote({ url }),   // or D.deterministic()
       memory                        // carried between rounds
     });

   Returns { actions, exogenous, unrest, memory, source, faults }.
   --------------------------------------------------------------------- */
async function societyRound(prev, next, opts) {
  opts = opts || {};
  const decide = opts.decide || D.deterministic();
  const memory = opts.memory || { prevKey: {}, sameFor: {}, departed: {} };
  memory.prevKey = memory.prevKey || {};
  memory.sameFor = memory.sameFor || {};
  /* EMIGRATION IS NOT REPEATABLE, and the first draft let it be.
     A cohort that chose to leave was free to choose it again the next
     round, and the next, so a collapsing run showed a third of the
     country emigrating every two years for fourteen years — the same
     third, forever, which is both impossible and flattering: it never
     ran out of people to lose.

     `departed[id]` is the share of a cohort that has already gone.
     Those who leave first are the mobile ones, so what remains is
     progressively less able to follow them, and past half the cohort
     there is nobody left who could go. That is the selective drain the
     project set out to model rather than a recurring event. */
  memory.departed = memory.departed || {};

  const d = C.macroDelta(prev, next);
  const faults = [];

  /* CONTRIBUTION CREDIT.
     `pull` is positive while the scheme recruits and negative once it
     crowds out intrinsic motivation, so a team that maximises the lever
     gets less contribution than one that finds the peak. Applied as a
     slack adjustment because slack is what gates prosocial action: a
     credit that makes volunteering worth it is, behaviourally, a small
     amount of spare capacity. Capped in contribution.js. */
  const credit = opts.credit || null;
  const pull = K.prosocialPull(credit);

  /* ---- 1. what each cohort is living through --------------------- */
  const batch = C.ARCHETYPES.map(p => {
    const dis = dispositionOf(p);
    /* The credit shifts the appetite, never the circumstance: someone
       with nothing spare still has nothing spare, so the adjustment is
       proportional to what slack they already have rather than a gift
       of capacity they do not possess. */
    const rawSlack = slackOf(p, next, d);
    const sl = clamp(rawSlack * (1 + pull), 0, 1);
    const pr = pressureOf(p, next, d);
    // Those who could go went first; the remainder are less able to.
    const gone = clamp(memory.departed[p.id] || 0, 0, 1);
    dis.mobility = clamp(dis.mobility * (1 - gone * 1.6), 0, 1);
    return {
      id: p.id,
      person: p,
      gone: gone,
      disposition: dis,
      slack: sl,
      pressure: pr,
      prevKey: memory.prevKey[p.id] || null,
      observation: D.observationFor(p, prev, next, {
        prevKey: memory.prevKey[p.id] || null,
        yearsLikeThis: (memory.sameFor[p.id] || 0) * 2
      })
    };
  });

  /* ---- 2. they decide -------------------------------------------- */
  let result;
  try {
    result = await decide(batch, { round: next.meta.round, year: next.meta.year });
  } catch (err) {
    faults.push('decider threw: ' + (err && err.message));
    result = await D.deterministic()(batch);
  }
  if (result.partial) result.partial.forEach(f => faults.push(f));

  /* ---- 3. the world decides whether they could ------------------- */
  const actions = batch.map(b => {
    const asked = result.choices[b.id] || 'endure';
    const adm = A.admissible(asked, {
      working: b.person.working,
      mobility: b.disposition.mobility,
      slack: b.slack
    });
    if (adm.redirected) faults.push(b.id + ': ' + adm.redirected);

    /* The share of this cohort still here to act. People who have
       already emigrated cannot strike, cover for a service, or be
       counted in what the country is doing. */
    const present = clamp(1 - (b.gone || 0), 0, 1);

    return {
      id: b.id, name: b.person.name, role: b.person.role,
      weight: b.person.weight * present,
      full_weight: b.person.weight,
      departed: Math.round((b.gone || 0) * 100),
      asked: asked,
      key: adm.key,
      redirected: adm.redirected,
      family: A.ACTIONS[adm.key].family,
      label: A.ACTIONS[adm.key].label,
      tone: A.ACTIONS[adm.key].tone,
      slack: Math.round(b.slack * 100),
      pressure: Math.round(b.pressure.total),
      concern: b.pressure.worst,
      /* The distinction the whole project turns on, computed rather
         than asserted: the same prosocial act means opposite things
         depending on whether there was anything spare. */
      prosocial_kind: A.ACTIONS[adm.key].family === 'prosocial'
        ? (adm.key === 'flourish' ? 'surplus' : 'deficit') : null
    };
  });

  /* ---- 4. memory -------------------------------------------------- */
  actions.forEach(a => {
    memory.sameFor[a.id] = (memory.prevKey[a.id] === a.key)
      ? (memory.sameFor[a.id] || 0) + 1 : 0;
    memory.prevKey[a.id] = a.key;
    /* A round of emigration takes a third of whoever was still able to
       go. Cumulative, capped: a cohort cannot lose more than itself. */
    if (a.key === 'emigrate') {
      const was = memory.departed[a.id] || 0;
      memory.departed[a.id] = clamp(was + (1 - was) * 0.33, 0, 0.85);
    }
  });

  /* ---- 5. what it costs the country ------------------------------- */
  const exogenous = A.consequences(actions.map(a => ({ key: a.key, weight: a.weight })));

  /* The scheme's own effects, merged in: capacity where credit is spent,
     cohesion for participation less exclusion, and the bill. */
  const creditEffects = K.effects(actions, credit);
  Object.keys(creditEffects.capacity).forEach(k => {
    const base = exogenous.capacity[k] == null ? 1 : exogenous.capacity[k];
    exogenous.capacity[k] = Math.max(0.55, base * creditEffects.capacity[k]);
  });
  exogenous.cohesion_bonus = Math.round(
    (exogenous.cohesion_bonus + creditEffects.cohesion_bonus) * 10) / 10;
  exogenous.reserves_bn = Math.round(
    (exogenous.reserves_bn + creditEffects.reserves_bn) * 100) / 100;

  /* Unrest still comes from the deterministic sentiment reading — it is
     a well-calibrated number and the engine is tuned against it — but
     it is now RAISED by what people actually did. Striking and
     organising are not moods.

     Kept as an addition rather than a replacement so that a run made
     before this file existed and one made after remain comparable at
     the bottom of the range, where most governments live. */
  const room = C.aggregate(C.reactDeterministic(prev, next));
  const militancy = actions.reduce((a, x) =>
    a + (x.key === 'strike' ? 45 : x.key === 'organise' ? 25 :
         x.key === 'activism' ? 10 : x.key === 'breakrules' ? 12 : 0) * x.weight, 0);
  const unrest = clamp(Math.round(room.civic_unrest + militancy), 0, 100);
  exogenous.civic_unrest = unrest;

  return {
    round: next.meta.round, year: next.meta.year,
    actions: actions,
    exogenous: exogenous,
    unrest: unrest,
    sentiment_unrest: room.civic_unrest,   // what it would have been on mood alone
    share_furious: room.share_furious,
    mean_sentiment: room.mean_sentiment,
    memory: memory,
    /* Reported every round, because the finding most likely to be missed
       is that a scheme can raise contribution overall while excluding
       the cohorts who needed it most. */
    credit: credit ? Object.assign({ policy: K.describe(credit) }, creditEffects,
                                   { locked_out: K.excluded(actions, credit)
                                       .filter(x => x.locked_out)
                                       .map(x => x.name) }) : null,
    source: result.source || 'deterministic',
    reasoning: result.reasoning || null,
    faults: faults
  };
}

/** Weighted share of the population in each behaviour, for a strip. */
function shares(actions) {
  const out = {};
  actions.forEach(a => { out[a.key] = (out[a.key] || 0) + a.weight; });
  return Object.keys(out)
    .sort((x, y) => out[y] - out[x])
    .map(k => ({ key: k, label: A.ACTIONS[k].label, family: A.ACTIONS[k].family,
                 share: Math.round(out[k] * 100) }));
}

module.exports = { societyRound, shares, dispositionOf, slackOf, pressureOf };
