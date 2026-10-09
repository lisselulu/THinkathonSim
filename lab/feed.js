/* =====================================================================
   THE FEED — society, in its own words
   ---------------------------------------------------------------------
   PROTOTYPE. Everything here is deterministic and templated: no model,
   no network, no key. That is deliberate for two reasons.

   One, it proves the architecture without a GPU in the room — the same
   posts appear on a laptop, in CI, and at the event.

   Two, it establishes the CONTRACT the model will later fill. A post is
   not free-form text. It is a cohort declaring a BEHAVIOUR at an
   INTENSITY, with words attached. The words are the only part a language
   model will ever be allowed to write. Swap the templates for a model and
   nothing downstream changes, because nothing downstream reads the words.

        pressure (arithmetic)  ->  behaviour (chosen)  ->  words (dressing)

   THE ONE IDEA WORTH READING THIS FILE FOR
   ----------------------------------------
   The same behaviour means opposite things depending on SLACK. A
   neighbourhood organising childcare because the state stopped providing
   it is a symptom. The identical act, by people who have time and money
   to spare, is a society flourishing. Same verb, opposite diagnosis, and
   the discriminator is arithmetic: time, money, security.

   A simulation that cannot tell those apart cannot say anything useful
   about a post-work society, which is the entire subject.
   ===================================================================== */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('../engine/meridian-engine.js'),
                             require('../engine/citizen_friction.js'),
                             require('../engine/traits.js'));
  } else {
    root.MeridianFeed = factory(root.MeridianEngine, root.MeridianCitizens,
                                root.MeridianTraits);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (E, C, TRAITS) {
'use strict';

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   1. DISPOSITION
   ---------------------------------------------------------------------
   The corpus does not carry personality yet — that is Phase 1, and it
   will be fitted to real trait distributions rather than invented. Until
   then these are derived from what each archetype already has, so the
   feed is driven by the same facts as the engine rather than by a second
   set of numbers nobody reconciled.

   Every one of these is a placeholder with a known replacement.
   --------------------------------------------------------------------- */
function disposition(p) {
  const age = parseInt(String(p.role).replace(/\D+/g, ''), 10) || 40;

  /* Can this person leave? Qualifications and savings help, age and
     dependants do not. This is the trait that makes emigration
     SELECTIVE — a country in trouble does not lose a random slice of
     its people, it loses the ones who could go. */
  const mobility = clamp(
    (p.income / 100) * 0.5 +
    (age < 35 ? 0.45 : age < 50 ? 0.2 : 0.02) +
    (p.exposure === 'high' ? 0.08 : 0), 0, 1);

  // Owners of capital and the securely employed trust the arrangement.
  const trust = clamp(0.35 + (p.income / 100) * 0.4 + (p.working ? 0.12 : -0.1), 0, 1);

  // Solidarity: who acts WITH others rather than alone.
  const solidarity = clamp(0.75 - (p.income / 100) * 0.5 + (p.working ? 0.1 : 0), 0, 1);

  const ambition = clamp((p.income / 100) * 0.3 + (age < 40 ? 0.45 : 0.15), 0, 1);

  return { age, mobility, trust, solidarity, ambition };
}

/* ---------------------------------------------------------------------
   2. SLACK — the discriminator
   ---------------------------------------------------------------------
   Does this cohort have anything spare? Three things, all of which must
   be present: time, money, and enough security to plan past next month.

   Sources: docs/EVIDENCE.md section 3.

   Slack is what separates a society coping from a society flourishing,
   and the working week is in it because that is the lever a government
   actually holds. Trials of shorter weeks report the freed day going to
   exactly the activities modelled here.
   --------------------------------------------------------------------- */
function slack(p, s, d) {
  const week = s.levers && s.levers.working_week_days ? s.levers.working_week_days : 5;

  // TIME. A shorter week frees it; being out of work does not, because
  // insecure time is not leisure.
  const time = p.working ? clamp((5 - week) / 2, 0, 1) * 0.8 + 0.1
                         : (d.purchasing_power >= 105 ? 0.55 : 0.05);

  /* MONEY, AT THIS COHORT'S OWN POSITION.
     The national purchasing-power index is an average, and slack is not
     an average thing. A capital owner and a retired cleaner living on the
     same payment in the same year do not have the same room to spare, and
     an earlier draft of this function gave them identical numbers — which
     made every cohort pick the same behaviour and produced a country that
     was 100% flourishing for twenty-four consecutive years.

     The payment is flat, so it lifts the bottom far more than the top in
     PROPORTIONAL terms; what it does not do is give someone at the twelfth
     percentile the same discretionary room as someone at the ninetieth. */
  const standing = 0.45 + (clamp(p.income, 0, 100) / 100) * 1.1;
  const money = clamp((d.purchasing_power * standing - 92) / 42, 0, 1);

  // SECURITY. The services this person leans on, working as they should.
  const svc = p.depends.reduce((a, k) => a + d.services[k].quality, 0) / p.depends.length;
  const security = clamp((svc - 55) / 25, 0, 1);

  // All three, or none. A cohort with time and no money has not got slack.
  return clamp(Math.min(time, money, security) * 1.15, 0, 1);
}

/* ---------------------------------------------------------------------
   3. PRESSURE
   ---------------------------------------------------------------------
   How hard this cohort is being squeezed, 0-100, in four channels. The
   engine already computes everything this reads; nothing new is invented.
   --------------------------------------------------------------------- */
function pressure(p, s, d, dis) {
  const svc = p.depends.reduce((a, k) => a + d.services[k].quality, 0) / p.depends.length;

  // Poorer households live closer to the edge of every number.
  const exposure = 1 + (60 - clamp(p.income, 0, 100)) / 100;

  const material = clamp((100 - d.purchasing_power) * 0.6 * exposure, 0, 100);
  const service = clamp((62 - svc) * 1.5, 0, 100);
  const work = p.working ? clamp((45 - d.employment_pct) * 0.5, 0, 100)
                         : clamp((55 - d.employment_pct) * 0.9, 0, 100);
  const voice = clamp((55 - (s.indicators.legitimacy || 55)) * 1.2, 0, 100);

  /* WORST CHANNEL DOMINATES. Must stay identical to `pressureOf` in
     engine/society_round.js — `engine/test_society.js` asserts the two
     agree cohort by cohort, because a country cannot be under one
     pressure on the page and another in the simulation.

     This was a weighted mean until behaviour started depending on it,
     at which point a cohort with one catastrophe and three channels it
     has no exposure to came out reading as mildly inconvenienced. See
     the note in society_round.js for the case that exposed it. */
  const channels = [['material', material], ['service', service],
                    ['work', work], ['voice', voice]];
  const sorted = channels.slice().sort((a, b) => b[1] - a[1]);
  const total = clamp(sorted[0][1] + ((sorted[1][1] + sorted[2][1] + sorted[3][1]) / 3) * 0.35, 0, 100);

  return { material, service, work, voice, total, worst: sorted[0][0] };
}

/* ---------------------------------------------------------------------
   4. CHOOSING A BEHAVIOUR
   ---------------------------------------------------------------------
   The taxonomy: prosocial, antisocial, conforming, collective, economic,
   political. In the real build a model chooses from this space and this
   function is the fallback. The point of writing the fallback FIRST is
   that it defines the vocabulary the model must answer in, and gives us
   a known-good baseline to compare a model against.
   --------------------------------------------------------------------- */
const BEHAVIOURS = {
  flourish:   { family: 'prosocial',  label: 'building something',  tone: 'good' },
  mutual_aid: { family: 'prosocial',  label: 'covering for the state', tone: 'mid' },
  endure:     { family: 'conforming', label: 'getting on with it',  tone: 'quiet' },
  obey:       { family: 'conforming', label: 'trusting the plan',   tone: 'quiet' },
  debate:     { family: 'political',  label: 'arguing about it',    tone: 'mid' },
  activism:   { family: 'political',  label: 'campaigning',         tone: 'mid' },
  save:       { family: 'economic',   label: 'holding back',        tone: 'mid' },
  organise:   { family: 'collective', label: 'organising',          tone: 'bad' },
  strike:     { family: 'collective', label: 'striking',            tone: 'bad' },
  emigrate:   { family: 'economic',   label: 'leaving',             tone: 'bad' },
  withdraw:   { family: 'economic',   label: 'going through the motions', tone: 'bad' },
  breakrules: { family: 'antisocial', label: 'going around the rules', tone: 'bad' }
};

function choose(p, pr, sl, dis, prevKey) {
  /* THRESHOLDS VARY BY COHORT, AND THE VARIATION IS NOW PERSONALITY.
     This used to be `p.id.charCodeAt(1) * 7 + ...` — a hash of the
     string "A07". It varied, which was the stated goal, and a hash and
     a personality produce equally varied output; only one of them can
     be reasoned about, defended in a room, or fitted to published
     norms later.

     It must stay identical to `deterministicChoose` in
     engine/decide.js. Two copies of a decision rule is one rule and one
     bug, so a country cannot decide one thing on this page and another
     in the simulation. */
  const tr = TRAITS.profile(p.id);

  /* Anxious people register a given pressure as intolerable sooner.
     `threat` is capped at ±0.5 by traits.js, so this spans ±8 points on
     a 100-point scale — the magnitude the literature supports, and
     about a sixth of what circumstance moves. */
  const t = clamp(pr.total + tr.threat * 16, 0, 100);

  // The dispositions, nudged by the traits that bear on each.
  dis = {
    age: dis.age,
    solidarity: clamp(dis.solidarity + tr.civic * 0.3, 0, 1),
    mobility: clamp(dis.mobility + tr.venturesome * 0.25, 0, 1),
    trust: clamp(dis.trust + tr.conformity * 0.2, 0, 1),
    ambition: dis.ambition
  };

  /* SLACK FIRST. A cohort with room to spare is not deciding how to
     cope, it is deciding what to do with itself — and that is the
     branch of this function the whole project is about. */
  if (sl > 0.45 && t < 30) return 'flourish';

  if (t < 18) return dis.trust > 0.6 ? 'obey' : 'endure';

  // Leaving is available only to those who can, which is the point.
  if (t > 52 && dis.mobility > 0.55 && pr.worst !== 'voice') return 'emigrate';

  // Sustained collective pressure, and people who act with others.
  if (t > 62 && dis.solidarity > 0.55) return prevKey === 'organise' ? 'strike' : 'organise';
  if (t > 44 && dis.solidarity > 0.6) return 'organise';

  // Where the state has failed and neighbours have not.
  if (pr.service > 45 && dis.solidarity > 0.5) return 'mutual_aid';

  if (t > 58 && dis.trust < 0.35) return 'breakrules';
  if (t > 40 && dis.trust < 0.45) return 'withdraw';

  // Owners and the comfortable respond to uncertainty by sitting on money.
  if (p.income > 70 && t > 22) return 'save';

  if (pr.voice > 35) return 'activism';
  return t > 30 ? 'debate' : 'endure';
}

/* ---------------------------------------------------------------------
   5. WORDS
   ---------------------------------------------------------------------
   Templated, and deliberately so. Every line here is a slot a model will
   fill later; the structure around it will not change. No post quotes a
   figure from the state: residents do not know their service scores, and
   nobody recites their payment to the dollar in a forum post.
   --------------------------------------------------------------------- */
function say(p, key, pr, d, s) {
  const svc = p.depends.map(k => E.SECTORS[k].name.toLowerCase());
  const worstDep = p.depends.slice().sort((a, b) => d.services[a].quality - d.services[b].quality)[0];
  /* The sector names already read as services — "care services",
     "healthcare" — so appending the word produces "the care services
     service". Templates below use the bare name. */
  const worstName = E.SECTORS[worstDep].name.toLowerCase();
  const works = !!p.working;
  const q = d.services[worstDep].quality;
  const pay = Math.round(d.payment_now);
  const buys = d.purchasing_power;
  const week = (s.levers && s.levers.working_week_days) || 5;

  const T = {
    /* Split the same way as the rest: half of these presuppose a job,
       and a retired cleaner announcing her four-day roster is the same
       credibility failure as her announcing a double shift. */
    flourish: works ? [
      `Fourth week of the ${week}-day roster and the block has a repair workshop running on Thursdays. Nobody is paid. Nobody wants to be.`,
      `Taught my first class at the community workshop today. Years in ${svc[0]} and it turns out somebody wanted to know how it works.`,
      `I do the week at work and one day with the youth group now. The second one is unpaid and I would not swap it.`,
      `The Thursday cooking rota has turned into something else entirely. Forty of us eat together now. Nobody organised it, exactly.`,
      `Spent the free day recording the old folks in the block talking about what this place was in 2020. Somebody should have done it years ago.`
    ] : [
      `We started a reading group at the void deck for the kids whose parents work nights. Twelve of them now. This is what the time is for.`,
      `Grew more than we can eat again. Boxes at the lift lobby, take what you need, that is the whole system.`,
      `Choir practice, badminton, and an argument about the lift upgrade that lasted two hours. Best week I have had.`,
      `Been showing the young ones how we used to do things before the machines. They are politer about it than I expected.`,
      `The block has a repair workshop on Thursdays now. I cannot lift much but I can sort screws and I can make coffee.`
    ],
    mutual_aid: [
      `Rota is up for this month — six of us covering the ${worstName} runs. If your parent needs a lift, put the name down.`,
      `We are doing this because ${worstName} stopped picking up the phone, and somebody has to. Do not mistake it for us managing.`,
      `Third month of the neighbours' rota. It works until one of us gets sick, and then it does not.`,
      `Mrs Lim next door has been minding four children since the centre cut its hours. She is seventy-one. This is not a solution.`,
      `We have a group chat for lifts, one for medicines and one for the forms. None of this existed five years ago.`
    ],
    endure: [`Took the long way home past the canal. Kids fed, bills paid, knees complaining. That will do.`,
             `Rent went up again. We manage. My sister says I say that every year.`],
    obey: [`It is a long plan and I would rather they finished it than changed it again.`,
           `People complain, but I have seen worse years than this one.`],
    debate: [
      `The payment went up and the same trolley of groceries still costs more. Both of those are true and only one gets said out loud.`,
      `Genuine question for the ministry: how bad does ${worstName} have to get before someone actually does something?`
    ],
    activism: [
      `Writing to my MP about ${worstName} for the fourth time. Posting it here so there is a record of the date.`,
      `We are not asking for more money. We are asking for the ${worstName} service to work. Those are different demands.`
    ],
    save: [
      `Not investing anything new this year. Nothing personal — I do not know what the levy will be in two years and neither do they.`,
      `Sitting on cash. Everyone I know is doing the same, which is probably the problem, and I am doing it anyway.`
    ],
    /* WORK-SHAPED SENTENCES ONLY GO TO PEOPLE WITH WORK.
       An earlier version had a retired cleaner announcing her third
       double shift, which is the kind of detail that costs a simulation
       its credibility in front of a room that knows better. */
    organise: works ? [
      `Third double shift this week. We are not short of work, we are short of people. Meeting Thursday — come if you have had enough.`,
      `Forty of us now. If you work in ${svc[0]} and you have been carrying this quietly, you are not the only one.`,
      `We have asked twice through the proper channels. Third time we are asking together.`
    ] : [
      `Meeting at the void deck on Thursday about ${worstName}. Bring anyone who has been told to wait.`,
      `They think because we are not at a workplace we cannot organise. There are more of us with time than without.`,
      `Forty signatures from this block alone. We are not going away until ${worstName} works again.`
    ],
    strike: works ? [
      `We are stopping. Not for more pay — for enough staff that ${worstName} can do its job. It should never have got this far.`,
      `Nobody wanted this. We told them in ${(s.meta.year || 2050) - 4}, we told them in ${(s.meta.year || 2050) - 2}, and here we are.`
    ] : [
      `Nobody is going to the appointments this month. If the system cannot see us, it can count us.`,
      `We are withholding the one thing we still have, which is our cooperation, until ${worstName} is fixed.`
    ],
    emigrate: [
      `Got the offer overseas. Four years of applications here. I did everything they told me to do.`,
      `Flight is in March. I will miss it and I am not staying to watch ${worstName} get worse.`
    ],
    withdraw: works ? [
      `Turning up. Doing exactly what is on the job sheet and not one thing more. That is what the payment buys.`,
      `Stopped volunteering for anything at work. Ask me why.`
    ] : [
      `Stopped going to the community meetings. Nothing I said at the last four made any difference.`,
      `I have stopped filling in the forms. Somebody else can chase it.`
    ],
    breakrules: [
      `Everyone I know is being paid cash now. You can call that a problem or you can ask what made it worth the risk.`,
      `Not declaring it. The payment does not cover the month and I have stopped feeling bad about the arithmetic.`
    ]
  };
  const arr = T[key] || T.endure;
  /* Deterministic, but keyed on WHO is speaking first and the round
     second. An earlier version led with pressure, which meant every
     cohort under the same conditions said the identical sentence — three
     people announcing the same repair workshop in the same week, which
     reads as a bug rather than a society. */
  const who = p.id.charCodeAt(1) * 31 + p.id.charCodeAt(2) * 7;
  const i = (who + Math.floor((s.meta.round || 1) / 3)) % arr.length;
  return arr[i];
}

/* ---------------------------------------------------------------------
   6. THE FEED FOR A ROUND
   --------------------------------------------------------------------- */
function feedFor(traj, round, memory) {
  const i = clamp(round - 1, 0, traj.length - 1);
  if (i < 1) return { round: round, year: traj[0].meta.year, posts: [], trending: [], mood: null };

  const prev = traj[i - 1], s = traj[i];
  const d = C.macroDelta(prev, s);
  const prevKeys = memory || {};
  const posts = [];

  C.ARCHETYPES.forEach(p => {
    const dis = disposition(p);
    const sl = slack(p, s, d);
    const pr = pressure(p, s, d, dis);
    const key = choose(p, pr, sl, dis, prevKeys[p.id]);
    const b = BEHAVIOURS[key];

    /* Not everyone posts every round. Silence is data: a quiet feed in a
       collapsing country means people have given up rather than that
       nothing is wrong, and the mood strip shows that even when the
       posts do not. */
    const loud = pr.total > 22 || key === 'flourish' || key === 'strike' ||
                 key === 'emigrate' || (p.weight > 0.1 && pr.total > 14);
    if (!loud) { prevKeys[p.id] = key; return; }

    posts.push({
      id: p.id, name: p.name, role: p.role, weight: p.weight,
      behaviour: key, family: b.family, label: b.label, tone: b.tone,
      slack: Math.round(sl * 100),
      pressure: Math.round(pr.total),
      concern: pr.worst,
      text: say(p, key, pr, d, s),
      /* Below a real threshold there is no dominant worry, and printing
         the largest of four near-zero numbers invents a grievance that
         nobody has. A flourishing cohort reports what it is doing
         instead. */
      note: pr.total < 12 ? (b.family === 'prosocial' ? 'has time to spare' : 'nothing pressing')
                          : 'worried about ' + pr.worst,
      // Flags the distinction the whole design turns on.
      prosocial_kind: b.family === 'prosocial' ? (key === 'flourish' ? 'surplus' : 'deficit') : null
    });
    prevKeys[p.id] = key;
  });

  // Loudest first, but a flourishing post is never buried.
  posts.sort((a, b) => (b.behaviour === 'flourish' ? 1 : 0) - (a.behaviour === 'flourish' ? 1 : 0) ||
                       b.pressure - a.pressure);

  const counts = {};
  posts.forEach(x => { counts[x.behaviour] = (counts[x.behaviour] || 0) + x.weight; });
  const trending = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a]).slice(0, 3)
    .map(k => ({ key: k, label: BEHAVIOURS[k].label, share: Math.round(counts[k] * 100) }));

  const room = C.aggregate(C.reactDeterministic(prev, s));

  return {
    round: s.meta.round, year: s.meta.year,
    posts: posts, trending: trending, memory: prevKeys,
    mood: { unrest: room.civic_unrest, sentiment: room.mean_sentiment,
            furious: room.share_furious,
            flourishing: Math.round(posts.filter(x => x.behaviour === 'flourish')
              .reduce((a, x) => a + x.weight, 0) * 100),
            coping: Math.round(posts.filter(x => x.behaviour === 'mutual_aid')
              .reduce((a, x) => a + x.weight, 0) * 100) }
  };
}

/** Every round in order, carrying cohort memory forward. */
function feedAll(traj) {
  const out = [];
  let mem = {};
  for (let r = 2; r <= traj.length; r++) {
    const f = feedFor(traj, r, mem);
    mem = f.memory;
    out.push(f);
  }
  return out;
}

return { feedFor, feedAll, BEHAVIOURS, disposition, slack, pressure, choose, say };
});
