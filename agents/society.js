/* =====================================================================
   AN AGENT SOCIETY, ROUND BY ROUND
   ---------------------------------------------------------------------
   One run of Meridian in which every choice a person or organisation
   makes is made by an agent, and the kernel does only physics and
   accounting. Each round:

     1  THE WORLD     the environment director says what is happening
     2  GOVERNMENT    the team's harness sets levers; the governing agent
                      may amend policy within the grammar
     3  THE KERNEL    steps the economy with last round's decisions
     4  SOCIETY       for each sub-step: every persona perceives its own
                      life, decides (reason), the router adds it up
                      (route), organisations act together, messages
                      travel the graph, people who can leave, leave
     5  INDUSTRY      every firm decides; the market moves shares, lets
                      firms in and out
     6  RECORD        what happened, who decided it, what was said

   What people and firms decided in round N enters the kernel in round
   N+1, exactly as in the original loop, so a run replays from its trace.

   SUB-STEPS ARE SOCIAL, NOT ECONOMIC. With `substeps: 8` the society
   deliberates eight times inside a two-year round: news spreads, a union
   forms, a strike is called and spreads or fizzles. The economy still
   clears once per round, on the time-averaged decisions (a strike that
   held for two of eight quarters withholds a quarter of the labour).
   That is a deliberate scope choice: re-calibrating the kernel to a
   quarterly step is a separate piece of work.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const LOOP = require('../harness/loop.js');
const H = require('../engine/harness.js');
const POP = require('./population.js');
const M = require('./mind.js');
const S = require('./social.js');
const C = require('./citizen.js');
const F = require('./firm.js');
const R = require('./router.js');
const D = require('./director.js');
const PL = require('./policy.js');
const EV = require('./evidence.js');
const CAL = require('./calibration.js');
const GOV = require('./government.js');
const INT = require('./interpreter.js');
const INS = require('./institutions.js');
const DIST = require('./distribution.js');
const AUDIT = require('../harness/auditor.js');
const { rng, derive } = require('./rng.js');

const deepClone = o => JSON.parse(JSON.stringify(o));

async function runAgentSociety(opts) {
  opts = opts || {};
  const seed = opts.seed == null ? 1 : opts.seed;
  const team = opts.team || 'meridian';
  const rounds = opts.rounds || 12;
  const substeps = Math.max(1, Math.min(8, opts.substeps || 1));

  /* TIME. A run advances in STEPS. With `dt: 1/12` a step is a month, a
     TICK, and the run is `years` long. Without it a step is the original
     two-year round. Under ticks the kernel moves every tick, and who
     THINKS on which tick is a cadence: the government every tick, people
     and firms every few, because nobody rethinks their life each month.
     What they decided holds until they decide again. */
  const dt = opts.dt || 2;
  const tickMode = dt !== 2;
  const K = dt / 2;
  const perYear = tickMode ? Math.max(1, Math.round(1 / dt)) : null;
  const steps = tickMode ? Math.max(2, Math.round((opts.years || 24) / dt) + 1) : rounds;
  const every = Object.assign(tickMode ? { residents: 3, firms: 3, government: 1 } : { residents: 1, firms: 1, government: 1 },
                              opts.every || {});
  const whenOf = r => (tickMode ? { year: 2050 + Math.floor(r / perYear + 1e-9), month: (r % perYear) + 1 }
                                : { year: 2048 + (r + 1) * 2, month: null });
  /* How long a stretch of ticks is, in words a person would use. */
  const spanWords = n => {
    if (!tickMode) return 'two years';
    const months = Math.round(n * dt * 12);
    return months === 1 ? 'month' : months < 12 ? months + ' months' : months === 12 ? 'year'
      : months % 12 === 0 ? (months / 12) + ' years' : months + ' months';
  };
  const agoWords = n => {
    if (!tickMode) return 'two years ago';
    const w = spanWords(n);
    return (w === 'month' || w === 'year') ? 'a ' + w + ' ago' : w + ' ago';
  };
  const pool = opts.pool || null;
  const emit = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const temperature = opts.temperature == null ? 0.7 : opts.temperature;
  const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;

  /* THE CALIBRATION GATE. An assessed run refuses a model that has not
     passed the behavioural suite, unless an organiser overrides it, and
     the override is written into the evidence. */
  let calibration = pool ? CAL.status(pool.model) : null;
  if (opts.assessed && !opts.allowUncalibrated) {
    if (!pool) throw new Error('an assessed run needs agents; there is no model pool');
    if (!calibration || !calibration.passed) {
      throw new Error('model "' + pool.model + '" has not passed behavioural calibration. ' +
        'Run: node agents/run-agents.js --calibrate   (or pass --allow-uncalibrated, which is recorded)');
    }
  }

  const director = opts.director && typeof opts.director.forRound === 'function'
    ? opts.director : D.createDirector(Object.assign({ seed: seed, unit: tickMode ? 'tick' : 'round' }, opts.director || {}));

  // ---- the world at the start ----------------------------------------
  const traj = [E.seed(opts.base)];
  let levers = completeLevers(opts.levers, opts.base);

  let con = opts.constitution || null;
  let policies = [];
  const government = { compiled: null, history: [], rejected: [], untranslatable: [], reviews: [] };
  if (con) {
    const compiled = await PL.compileConstitution(pool, con, { seed: seed, keyPrefix: seed + '|' + team + '|r1', state: traj[0] });
    policies = compiled.policies;
    government.compiled = { source: compiled.source, enacted: compiled.policies.length };
    government.rejected = compiled.rejected;
    government.untranslatable = compiled.untranslatable;
    government.rubric = compiled.rubric;
    government.history.push({ round: 1, year: traj[0].meta.year, change: 'enacted from the constitution',
                              policies: deepClone(policies) });
  }
  levers.policies = PL.forKernel(policies);
  traj[0].levers = deepClone(levers);

  const population = POP.buildPopulation(traj[0], { size: opts.population || 60, seed: seed });
  const personas = population.personas;
  const minds = {};
  personas.forEach(p => { minds[p.id] = M.initMind(p); });
  const graph = S.buildGraph(personas, { seed: seed });
  const bus = S.createBus();
  const orgs = S.createOrganisations();
  const firms = F.makeFirms(traj[0], { seed: seed });
  const marketRng = rng(derive(seed, 'market'));
  const departRng = rng(derive(seed, 'departures'));

  /* THE TEAM'S GOVERNMENT. A cabinet function passed in directly wins (the
     command line, tests); otherwise the government section the team saved
     on Setup is built into one. With neither, the saved levers hold every
     round, and the evidence says that is what happened. */
  let cabinet = typeof opts.cabinet === 'function' ? opts.cabinet
    : GOV.buildGovernment({ government: opts.government, constitution: con, pool, team, seed });
  government.kind = cabinet ? (cabinet.kind || 'custom') : 'none';
  government.declared = cabinet && cabinet.describe ? cabinet.describe() : { kind: government.kind };
  government.rounds = [];

  /* Rows carry what the constitutional audit reads: the levers enacted, the
     clauses cited, and whether anyone actually governed that round. */
  const trace = [{ round: 1, levers: deepClone(levers), exogenous: null, shocks: [],
                   levers_enacted: deepClone(levers), cites: [], fallback: false, rationale: 'opening settlement' }];
  let lastGovernment = { cites: [], fallback: !cabinet, rationale: cabinet ? null : 'no government declared: levers held' };
  const log = { society: [], industry: [], feed: [], events: [], organisations: [], behaviours: [] };

  /* WHAT ACTIONS MEAN. With a model, every action a resident takes is
     interpreted into what it costs and what it does, so behaviour nobody
     anticipated still reaches the world (agents/interpreter.js). Without
     one, the fixed pattern list stands in, as before. `opts.actions` can
     force either, which is how the two are compared. */
  /* WHAT THE TEAM HAS INSTITUTIONALISED. Behaviours their society invented
     in an earlier run, which they have chosen to fund, license, subsidise
     or endorse. They become policies, they change what those actions cost,
     and people are told they exist. */
  let institutions = INS.compile(opts.institutions);
  /* THE TEAM'S OWN WAYS OF SHARING OUT: schemes that pay people for what
     they do, on top of the payment everyone gets (agents/distribution.js). */
  let schemes = DIST.validateAll(opts.distribution);
  let earnedOf = {};
  log.distribution = [];

  /* AMENDING A RUN THAT IS UNDER WAY. A government does not get one go at
     its laws. A team may pause, change its settings, and carry on from the
     same month: the levers, the government, the constitution's policies,
     its institutions and its schemes all take effect from the next tick.
     Every amendment is recorded with its date, because a recovery is a
     finding in its own right and the report has to be able to show it.

     `takeAmendment()` is asked each tick (the server hands over whatever
     the team has saved). `amendments` is a recorded list to apply again,
     which is how an amended run is replayed. */
  const takeAmendment = typeof opts.takeAmendment === 'function' ? opts.takeAmendment : () => null;
  const amendSchedule = Array.isArray(opts.amendments) ? opts.amendments.slice() : [];
  const amended = [];
  async function applyAmendment(sys, stepNo, at, prevState) {
    const changed = [];
    const before = deepClone(levers);
    if (sys.levers) {
      const keep = levers.policies;
      levers = completeLevers(sys.levers, opts.base);
      levers.policies = keep;
      if (GOV.leverChanges(before, levers).length) changed.push('economy');
    }
    if (sys.government && typeof opts.cabinet !== 'function') {
      cabinet = GOV.buildGovernment({ government: sys.government, constitution: sys.constitution || con, pool, team, seed });
      government.kind = cabinet ? (cabinet.kind || 'custom') : 'none';
      government.declared = cabinet && cabinet.describe ? cabinet.describe() : { kind: government.kind };
      changed.push('government');
    }
    if (sys.constitution) {
      con = sys.constitution;
      const compiled = await PL.compileConstitution(pool, con, { seed: seed, keyPrefix: seed + '|' + team + '|amend' + stepNo, state: prevState });
      policies = compiled.policies;
      government.rejected = government.rejected.concat(compiled.rejected || []);
      government.untranslatable = compiled.untranslatable;
      government.rubric = compiled.rubric;
      government.history.push({ round: stepNo, year: at.year, month: at.month, change: 'amended by the team', policies: deepClone(policies) });
      changed.push('constitution');
    }
    if (sys.institutions) { institutions = INS.compile(sys.institutions); changed.push('institutions'); }
    if (sys.distribution) { schemes = DIST.validateAll(sys.distribution); changed.push('distribution'); }
    const record = { step: stepNo, year: at.year, month: at.month, version: sys.version == null ? null : sys.version,
                     changed: changed, levers: GOV.leverChanges(before, levers),
                     note: String(sys.note || '').slice(0, 200) || null };
    amended.push({ step: stepNo, system: sys, record: record });
    emit({ type: 'amended', round: stepNo, year: at.year, month: at.month, changed: changed });
    return record;
  }

  /* THE PANEL. A fixed set of residents followed for the whole run, every
     decision kept in their own words. Everyone else contributes numbers.
     Chosen evenly across the population as it was built, so it spans ages,
     work and circumstances, and the same seed picks the same people.
     `fullLog` keeps every resident's transcript instead, which is what an
     exactly replayable run needs and costs about a hundred times the disk. */
  const fullLog = opts.fullLog !== false;   // the library keeps everything unless told to travel light
  const panelSize = Math.max(0, Math.min(personas.length, opts.panel == null ? 20 : opts.panel));
  const panelIds = {};
  for (let i = 0; i < panelSize; i++) panelIds[personas[Math.floor((i + 0.5) * personas.length / panelSize)].id] = true;
  log.panel = {
    members: personas.filter(p => panelIds[p.id]).map(p => ({ id: p.id, name: p.name, age: p.age, status: p.status,
      sector: p.sector || null, region: p.region, household: p.household, housing: p.housing_label,
      income_decile: p.income_decile, stands_for: Math.round(p.weight) })),
    entries: []
  };

  const actionMode = opts.actions || (pool ? 'open' : 'registry');
  const interp = actionMode === 'open' ? INT.createInterpreter({
    pool, seed, route: R.routeIntent, team,
    cachePath: opts.interpretCache, starterPath: opts.starterDictionary,
    overridesPath: opts.interpretOverrides, known: opts.interpretations
  }) : null;
  const interpretOf = interp ? (a => interp.lookup(a)) : null;
  const counts = { citizen: { model: 0, replay: 0, fallback: 0 }, firm: { model: 0, replay: 0, fallback: 0 }, posts_dropped_as_copies: 0 };
  const faults = [];
  let societyExo = null, firmExo = null, lastSociety = null, lastPolls = null;
  let orgCalls = [];
  let founders = {};
  const voices = [];
  const recentPosts = [];                // for dropping copies of what was already said
  const ctxInboxOf = {};
  let stopped = null;

  emit({ type: 'start', team, seed, rounds, population: personas.length, substeps,
         firms: firms.length, model: pool ? pool.model : null, calibration,
         view0: viewOf(traj[0], { people: peopleSnapshot(personas, {}, orgs), polls: { trust: null, belonging: null },
                                  action_shares: [], departed: 0, organisations: 0 }, []) });

  const shouldPause = typeof opts.shouldPause === 'function' ? opts.shouldPause : () => false;
  let pausedMs = 0;
  /* What people did once (left the country) is applied once, on the next
     tick, however long their other choices are held for. */
  let onceEmigration = 0;
  let lastDecided = traj[0], lastFirmSeen = traj[0], marketEvents = [];
  /* LIVE PACING. With `tickMs` a tick takes that long on the wall clock,
     so a year unfolds in real time. If the model cannot keep up the clock
     simply runs behind: it is never caught up by skipping anything. */
  const tickMs = tickMode && opts.tickMs > 0 ? opts.tickMs : 0;
  const wallStart = Date.now();
  let behindMs = 0;
  for (let r = 1; r < steps; r++) {
    if (shouldStop()) { stopped = 'stopped by request'; break; }
    /* Held between rounds: the room has been paused, or this run has. */
    if (shouldPause()) {
      const from = Date.now();
      emit({ type: 'paused', round: r + 1, year: whenOf(r).year, month: whenOf(r).month });
      while (shouldPause() && !shouldStop()) await new Promise(res => setTimeout(res, 250));
      pausedMs += Date.now() - from;
      if (shouldStop()) { stopped = 'stopped by request'; break; }
      emit({ type: 'resumed', round: r + 1, year: whenOf(r).year, month: whenOf(r).month });
    }
    /* Everything a round writes is marked, so a stop that arrives while
       the model is still being waited for can take the round back out:
       the evidence then covers only years that actually finished. */
    {
      const due = amendSchedule.filter(x => x.step === r + 1).map(x => x.system);
      const live = takeAmendment();
      if (live) due.push(live);
      for (const sys of due) await applyAmendment(sys, r + 1, whenOf(r), traj[traj.length - 1]);
    }
    const mark = { traj: traj.length, trace: trace.length, society: log.society.length, industry: log.industry.length,
                   behaviours: log.behaviours.length, feed: log.feed.length, gov: government.rounds.length,
                   reviews: government.reviews.length, history: government.history.length,
                   panel: log.panel.entries.length, dist: log.distribution.length };
    try {
    const prev = traj[traj.length - 1];
    const roundNo = r + 1, at = whenOf(r), year = at.year, month = at.month;
    const keyBase = seed + '|' + team + '|r' + roundNo;
    const governDue = r % every.government === 0;
    const residentsDue = r % every.residents === 0;
    const firmsDue = r % every.firms === 0;

    // ---- 1. the world ---------------------------------------------------
    const events = director.forRound(roundNo, team);
    events.forEach(e => { if (!log.events.some(x => x.id === e.id)) log.events.push(Object.assign(
      { year: tickMode ? 2050 + Math.floor(Math.max(0, e.start - 1) / perYear) : 2048 + e.start * 2 }, e)); });

    // ---- 2. government ----------------------------------------------------
    if (cabinet && governDue) {
      /* The government reads what its people did last round before it
         decides this one. Round two has nothing to read yet. */
      if (typeof cabinet.setRoom === 'function' && lastSociety) {
        cabinet.setRoom({
          agentSociety: true,
          trust: lastPolls ? lastPolls.trust : null, belonging: lastPolls ? lastPolls.belonging : null,
          civic_unrest: prev.indicators.civic_unrest,
          actions: lastSociety.action_shares || [],
          departed: log.society.length ? log.society[log.society.length - 1].departed : 0,
          organisations: orgs.size,
          voices: log.feed.filter(f => f.kind === 'citizen' && f.round === roundNo - 1)
            .sort((a, b) => b.reach - a.reach).slice(0, 5).map(f => ({ text: f.text, role: f.role }))
        });
      }
      const before = deepClone(levers);
      try {
        const reply = await cabinet({
          rounds: tickMode ? null : rounds, month: month,
          round: roundNo, year, state: deepClone(prev), history: traj, news: prev.news || [],
          opposition: H.opposition(prev, traj.length > 1 ? traj[traj.length - 2] : null),
          constitution: con, levers: deepClone(levers),
          worstEssential: Math.min.apply(null, E.ESSENTIAL.map(k => prev.sectors[k].quality)),
          sectors: E.SECTORS, order: E.ORDER
        });
        const v = H.validateLevers(reply && reply.levers, levers);
        v.faults.forEach(f => faults.push({ round: roundNo, fault: 'government: ' + f }));
        ((reply && reply.faults) || []).forEach(f => faults.push({ round: roundNo, fault: 'government: ' + f }));
        const keep = levers.policies;
        levers = v.levers;
        levers.policies = keep;
        lastGovernment = { cites: (reply && reply.cites) || [], fallback: !!(reply && reply.fallback),
                           rationale: (reply && reply.rationale) || null };
        government.rounds.push({
          round: roundNo, year, kind: government.kind,
          rationale: lastGovernment.rationale, cites: lastGovernment.cites,
          fallback: lastGovernment.fallback, fired: (reply && reply.fired) || [],
          changed: GOV.leverChanges(before, levers),
          faults: ((reply && reply.faults) || []).concat(v.faults)
        });
      } catch (err) {
        faults.push({ round: roundNo, fault: 'government threw: ' + (err && err.message) });
        lastGovernment = { cites: [], fallback: true, rationale: 'the government failed this round; levers held' };
        government.rounds.push({ round: roundNo, year, kind: government.kind, rationale: lastGovernment.rationale,
                                 cites: [], fallback: true, fired: [], changed: [], faults: [String(err && err.message)] });
      }
    } else if (!cabinet) {
      lastGovernment = { cites: [], fallback: true, rationale: 'no government declared: levers held' };
    }
    const reviewEvery = opts.policyReviewEvery == null ? 2 : opts.policyReviewEvery;
    /* The review interval is in two-year rounds; under ticks it is the same stretch of time. */
    const reviewSteps = tickMode ? Math.max(1, Math.round(reviewEvery * 2 / dt)) : reviewEvery;
    if (pool && con && reviewEvery > 0 && r % reviewSteps === 0) {
      const review = await PL.reviewPolicies(pool, con, policies, {
        state: prev, society: lastSociety, polls: lastPolls, voices: voices.slice(-8),
        events, keyPrefix: keyBase, seed: derive(seed, 'review', roundNo)
      });
      government.reviews.push({ round: roundNo, year, changed: review.changed, reasoning: review.reasoning || null,
                                source: review.source, error: review.error || null });
      if (review.rejected && review.rejected.length) government.rejected = government.rejected.concat(review.rejected);
      if (review.changed) {
        policies = review.policies;
        government.history.push({ round: roundNo, year, change: 'amended', reasoning: review.reasoning,
                                  repealed: review.repealed, protected: review.protected, policies: deepClone(policies) });
      }
    }
    levers.policies = PL.forKernel(policies).concat(institutions.policies);
    const announcements = policies.filter(p => p.type === 'announce').map(p => p.text)
      .concat(institutions.policies.filter(p => p.type === 'announce').map(p => p.text));

    // ---- 3. the kernel --------------------------------------------------------
    const directorDemo = events.reduce((acc, e) => {
      if (e.exogenous && e.exogenous.demography) {
        acc.immigration += e.exogenous.demography.immigration || 0;
        acc.emigration += e.exogenous.demography.emigration || 0;
      }
      return acc;
    }, { immigration: 0, emigration: 0 });
    const exogenous = LOOP.mergeExogenous(societyExo || {}, firmExo || {});
    if (societyExo || directorDemo.immigration || directorDemo.emigration) {
      const sd = (societyExo && societyExo.demography) || {};
      exogenous.demography = {
        births_mult: sd.births_mult == null ? 1 : sd.births_mult,
        emigration: (tickMode ? onceEmigration : (sd.emigration || 0)) + directorDemo.emigration * K,
        immigration: directorDemo.immigration * K
      };
      onceEmigration = 0;
    }
    const deck = (opts.shocks && opts.shocks[roundNo]) || [];
    const shocks = deck.filter(x => E.SHOCKS[x]).concat(D.asShocks(events));
    (prev._endogenousNext || []).forEach(x => { if (shocks.indexOf(x) < 0) shocks.push(x); });
    const next = stepWorld(traj, levers, shocks, exogenous, dt);
    traj.push(next);
    trace.push({ round: roundNo, ...(tickMode ? { dt: dt, year: year, month: month } : {}),
                 levers: deepClone(levers), exogenous: deepClone(exogenous), shocks: deepClone(shocks),
                 levers_enacted: deepClone(levers), cites: lastGovernment.cites, fallback: lastGovernment.fallback,
                 rationale: lastGovernment.rationale });

    // ---- 4. society -------------------------------------------------------------
    const subExos = [];
    const subReports = [];
    const roundBehaviours = [];
    let departedThisRound = 0;
    let lastDecisions = {};
    for (let s = 0; residentsDue && s < substeps; s++) {
      const live = personas.filter(p => !p.departed);
      const communityLevel = lastPolls ? lastPolls.belonging : 60;
      const perceived = {};
      const decisions = {};
      await Promise.all(live.map(async p => {
        const mind = minds[p.id];
        ctxInboxOf[p.id] = bus.inbox(p.id);
        const ctx = {
          prev: tickMode ? lastDecided : prev, next, events, announcements, inbox: ctxInboxOf[p.id],
          since: agoWords(every.residents), horizon: spanWords(every.residents),
          memberships: orgs.membershipOf(p.id).map(n => (orgs.get(n) || {}).label || n),
          orgCalls: orgCalls.filter(c => orgs.membershipOf(p.id).indexOf(c.org) >= 0)
            .map(c => c.label + ': ' + c.action.replace('_', ' ')),
          nearbyOrgs: orgs.nearby(graph, p.id),
          institutions: INS.forPeople(institutions.visible),
          keepTranscript: fullLog || !!panelIds[p.id],
          schemes: DIST.forPeople(schemes), earned: earnedOf[p.id] || null,
          communityLevel, keyPrefix: keyBase + '|s' + s, seed: derive(seed, p.id, roundNo, s), temperature
        };
        let seen;
        try { seen = C.perceive(p, mind, ctx); }
        catch (err) { faults.push({ round: roundNo, fault: 'blindness (' + p.id + '): ' + err.message }); return; }
        M.updateNeeds(mind, p, seen.life);
        perceived[p.id] = seen;
        const out = pool ? await C.decide(pool, p, mind, seen, ctx)
          : { decision: C.fallback(p, mind), source: 'fallback', error: 'no model pool' };
        decisions[p.id] = out;
        counts.citizen[out.source === 'replay' ? 'replay' : out.source === 'model' ? 'model' : 'fallback']++;
        if (panelIds[p.id]) {
          const d = out.decision;
          log.panel.entries.push({ id: p.id, year, round: roundNo, substep: s, source: out.source,
            thinking: d.thinking, did: d.actions.map(a => ({ do: a.do, target: a.target, why: a.why })),
            spend_share: d.spend_share, work: d.work, migrate: d.migrate, family: d.family,
            trust: d.trust_government, belonging: d.belonging, satisfaction: d.satisfaction,
            feelings: d.feelings, post: d.post || '' });
        }
      }));

      let agg;
      if (interp) {
        /* Everything anyone said they would do, interpreted before anything
           is counted. One batched call per dozen new actions; repeats are
           free. */
        const said = [];
        live.forEach(p => { const d = decisions[p.id]; if (d) d.decision.actions.forEach(a => said.push(a)); });
        await interp.resolve(said);
        orgCalls = R.organisedActionOpen(orgs, personas, decisions, interpretOf);
        agg = R.aggregateOpen(personas, decisions, { year, interpret: interpretOf, state: next,
                                                    week: levers.working_week_days,
                                                    ease: institutions.ease, formal: institutions.formal, schemes: schemes });
        roundBehaviours.push(agg.behaviours);
        earnedOf = agg.earnings || {};
        if (schemes.length) log.distribution.push({ round: roundNo, year, month, schemes: agg.schemes,
          paid_bn_year: (agg.exogenous.distribution || {}).paid_bn || 0,
          from_the_payment_bn: (agg.exogenous.distribution || {}).from_ubi_bn || 0 });
      } else {
        orgCalls = R.organisedAction(orgs, personas, decisions);
        agg = R.aggregate(personas, decisions, { year });
      }
      agg.joins.forEach(j => orgs.join(j.persona, j.name, kindOfOrg(j.name), year));
      founders = agg.founders;

      // People who decided to leave and can, go. Seeded, so it replays.
      let departedWeight = 0;
      live.forEach(p => {
        const d = decisions[p.id] && decisions[p.id].decision;
        if (!d || d.migrate !== 'leave') return;
        if (p.mobility >= 0.3 && p.savings_months >= 2 && departRng() < p.mobility) {
          p.departed = true;
          departedWeight += p.weight;
          orgs.membershipOf(p.id).forEach(n => orgs.leave(p, n));
          log.feed.push({ year, round: roundNo, substep: s, kind: 'departure', author: p.name,
                          role: roleOf(p), text: (d.post || d.thinking || 'Left Meridian.').slice(0, 280), reach: 0 });
        }
      });
      orgs.prune();
      agg.exogenous.demography.emigration = Math.round(departedWeight);
      departedThisRound += departedWeight;
      subExos.push(agg.exogenous);
      subReports.push(agg.society);
      lastDecisions = decisions;

      // Posts travel the graph; remembering what one did and what happened.
      live.forEach(p => {
        const out = decisions[p.id];
        if (!out) return;
        const d = out.decision;
        M.applyReport(minds[p.id], d);
        const did = d.actions.length ? d.actions.map(a => a.do + (a.target ? ' (' + a.target + ')' : '')).join('; ') : 'got on with life';
        M.remember(minds[p.id], { year, kind: 'event', text: 'I ' + did + '. ' + (d.thinking || '').slice(0, 160) });
        /* A copy of something already said, by anyone this round or by this
           person before, is not a new voice. It is dropped rather than
           letting one slogan echo round the graph. */
        if (d.post && (recentPosts.some(x => C.samePost(x, d.post)) ||
                       (ctxInboxOf[p.id] || []).some(m => C.samePost(m.text, d.post)))) {
          d.post = '';
          counts.posts_dropped_as_copies++;
        }
        if (d.post) {
          recentPosts.push(d.post);
          if (recentPosts.length > 400) recentPosts.shift();
          const memberships = orgs.membershipOf(p.id);
          bus.post(p.id, d.post, { name: p.name, orgs: memberships });
          const reach = (graph[p.id] || []).length + memberships.reduce((acc, n) => acc + ((orgs.get(n) || {}).members || []).length, 0);
          log.feed.push({ year, round: roundNo, substep: s, kind: 'citizen', author: p.name, role: roleOf(p),
                          text: d.post, reach, source: out.source, org: memberships.length ? (orgs.get(memberships[0]) || {}).label : null,
                          actions: d.actions.map(a => a.do) });
          voices.push(d.post);
          if (voices.length > 60) voices.shift();
        }
      });
      bus.deliver(graph, { get: n => orgs.get(n) });
      emit({ type: 'substep', round: roundNo, year, substep: s, agents: live.length,
             actions: agg.society.action_shares.slice(0, 5), departed: Math.round(departedWeight) });
    }
    if (residentsDue) {
    societyExo = R.averageExogenous(subExos);
    onceEmigration += (societyExo.demography && societyExo.demography.emigration) || 0;
    lastDecided = next;
    lastPolls = societyExo.polls;
    lastSociety = mergeReports(subReports);
    if (roundBehaviours.length) log.behaviours.push({ round: roundNo, year, month, list: mergeBehaviours(roundBehaviours) });
    log.society.push(Object.assign({ round: roundNo, year, month, polls: societyExo.polls,
                                     propensity: societyExo.households.propensity,
                                     labour_supply: societyExo.households.labour_supply,
                                     births_mult: societyExo.demography.births_mult,
                                     departed: Math.round(departedThisRound),
                                     organisations: orgs.size, calls: orgCalls,
                                     people: peopleSnapshot(personas, lastDecisions, orgs, interpretOf) }, lastSociety));
    }

    // ---- 5. industry ---------------------------------------------------------------
    if (firmsDue) {
    const ceilingOf = k => Math.min(0.98,
      (levers.automation_ceiling && levers.automation_ceiling[k] != null ? levers.automation_ceiling[k] : levers.automation_target[k]));
    const firmCtx = { prev: tickMode ? lastFirmSeen : prev, next, firms, k: tickMode ? K * every.firms : 1,
                      horizon: spanWords(every.firms),
                      policies: PL.forKernel(policies).concat(institutions.policies),
                      institutions: INS.forFirms(institutions.visible), ceilingOf, events, announcements,
                      voices: voices.slice(-4), founders, year, keyPrefix: keyBase + '|firm',
                      temperature: Math.min(temperature, 0.6) };
    const firmDecisions = {};
    const activeFirms = firms.filter(f => f.active);
    await Promise.all(activeFirms.map(async f => {
      const out = pool ? await F.decide(pool, f, Object.assign({ seed: derive(seed, f.id, roundNo) }, firmCtx))
        : { decision: F.fallback(f, firmCtx), source: 'fallback' };
      firmDecisions[f.id] = out.decision;
      counts.firm[out.source === 'replay' ? 'replay' : out.source === 'model' ? 'model' : 'fallback']++;
      /* Firm statements get the same treatment as residents' posts: no
         hashtags or links, and a statement another firm already made is
         not published twice. */
      const firmPost = out.decision.post ? C.cleanPost(out.decision.post) : '';
      if (firmPost && recentPosts.some(x => C.samePost(x, firmPost))) counts.posts_dropped_as_copies++;
      else if (firmPost) {
        recentPosts.push(firmPost);
        log.feed.push({ year, round: roundNo, substep: substeps - 1, kind: 'firm', author: f.name,
                        role: f.type.replace('_', '-') + ' · ' + E.SECTORS[f.sector].name, text: firmPost,
                        reach: Math.round(f.share * 100), source: out.source });
      }
    }));
    const market = F.applyMarket(firms, firmDecisions, firmCtx, marketRng);
    firmExo = market.exogenous;
    marketEvents = market.events;
    lastFirmSeen = next;
    log.industry.push({ round: roundNo, year, month, events: market.events,
                        sectors: E.ORDER.reduce((o, k) => {
                          o[k] = { aggregate: firmExo.firms[k], firms: firms.filter(f => f.active && f.sector === k)
                            .map(f => ({ name: f.name, type: f.type, share: round3(f.share), markup: f.markup,
                                         wage_offer: f.wage_offer, automation: round3(f.automation) })) };
                          return o;
                        }, {}) });
    } else marketEvents = [];
    announcements.forEach(a => {
      if (!log.feed.some(x => x.kind === 'government' && x.text === a)) {
        log.feed.push({ year, round: roundNo, substep: 0, kind: 'government', author: 'Government of Meridian',
                        role: 'public statement', text: a, reach: personas.length });
      }
    });

    emit({ type: 'round', round: roundNo, year, month, tick: tickMode ? r : null,
           indicators: next.indicators, population: next.population.total,
           worst_essential: Math.min.apply(null, E.ESSENTIAL.map(k => next.sectors[k].quality)),
           polls: lastPolls, events: events.map(e => e.label),
           society: { actions: lastSociety ? lastSociety.action_shares.slice(0, 6) : [], departed: Math.round(departedThisRound),
                      organisations: orgs.size },
           industry: marketEvents, decided: deepClone(counts), agent_share: pool ? pool.agentShare() : 0,
           /* What the map draws for this year: the country and its people. */
           view: Object.assign(viewOf(next, log.society[log.society.length - 1], events, residentsDue),
                               { government: government.rounds.length ? government.rounds[government.rounds.length - 1] : null,
                                 posts: postsOfRound(log.feed, roundNo) }) });
    /* Hold to the clock. A pause does not count against it. */
    if (tickMs) {
      const wait = wallStart + pausedMs + r * tickMs - Date.now();
      if (wait > 0) {
        const until = Date.now() + wait;
        while (Date.now() < until && !shouldStop()) await new Promise(res => setTimeout(res, Math.min(250, until - Date.now())));
        behindMs = 0;
      } else behindMs = -wait;
    }
    } catch (err) {
      if (!(err && err.stopped)) throw err;
      traj.length = mark.traj; trace.length = mark.trace;
      log.society.length = mark.society; log.industry.length = mark.industry;
      log.behaviours.length = mark.behaviours; log.feed.length = mark.feed;
      government.rounds.length = mark.gov; government.reviews.length = mark.reviews; government.history.length = mark.history;
      log.panel.entries.length = mark.panel;
      log.distribution.length = mark.dist;
      stopped = 'stopped while waiting for the model; the unfinished year was left out';
      break;
    }
  }

  log.organisations = orgs.all().map(o => ({ name: o.label, kind: o.kind, founded: o.founded,
                                             members: o.members.length, represents: Math.round(o.weight),
                                             sectors: Object.keys(o.sectors) }));

  const run = {
    team, seed, rounds: traj.length, substeps, stopped,
    /* How time was cut. Under ticks the report reads the country once a
       year, so a run of any length has a readable table. */
    time: tickMode ? { tick_months: Math.round(dt * 12), ticks: traj.length - 1, years: Math.round((traj.length - 1) * dt * 10) / 10,
                       residents_decide_every: spanWords(every.residents), firms_decide_every: spanWords(every.firms),
                       government_decides_every: spanWords(every.government),
                       paced_ms_per_tick: tickMs || null, clock_behind_s: Math.round(behindMs / 1000) }
                   : { tick_months: 24, ticks: traj.length - 1, years: (traj.length - 1) * 2 },
    yearly: tickMode ? traj.filter((s, i) => i === 0 || i === traj.length - 1 || s.meta.tick % perYear === 0) : null,
    model: pool ? pool.model : null, mode: pool ? pool.mode : 'no-model',
    /* What the run cost, so a change meant to make runs lighter can be
       checked rather than believed. */
    tokens: pool && pool.stats.prompt_tokens ? {
      prompt: pool.stats.prompt_tokens, completion: pool.stats.completion_tokens,
      prompt_cached: pool.stats.prompt_cached_tokens,
      per_call: Math.round((pool.stats.prompt_tokens + pool.stats.completion_tokens) /
                           Math.max(1, pool.stats.model + pool.stats.failed))
    } : null,
    calibration, assessed: !!opts.assessed, uncalibrated_override: !!(opts.assessed && opts.allowUncalibrated),
    trajectory: traj, trace, log, counts, faults, government,
    /* How actions became effects this run: which mode, what the interpreter
       did, and every interpretation used, so a replay can use exactly these. */
    institutions: institutions.items.length ? institutions.items : null,
    /* What the team changed while the run was going, and the inputs needed
       to make the same changes again on a replay. */
    amendments: amended.map(x => x.record),
    amendment_inputs: amended.map(x => ({ step: x.step, system: x.system })),
    schemes: schemes,
    /* What was kept. A run can only be replayed exactly from its decision
       log if every decision is in it. */
    storage: { kept: fullLog ? 'every decision' : 'a panel of ' + panelSize + ' residents, and every firm and government decision',
               /* Only a run whose every decision was written down can be replayed from its log. */
               replayable: !pool || pool.mode === 'replay' || (pool.mode === 'record' && !(pool.stats.unlogged > 0)),
               decisions_logged: pool ? pool.stats.logged : 0, decisions_not_kept: pool ? pool.stats.unlogged : 0 },
    /* What refusing to fall back cost: nothing is hidden in a rule. */
    waits: pool ? { never_falls_back: !!pool.insist, replies_asked_again: pool.stats.retries || 0,
                    waited_s: Math.round((pool.stats.waited_ms || 0) / 1000),
                    paused_s: Math.round(((pool.stats.paused_ms || 0) + pausedMs) / 1000),
                    outages: pool.stats.outages || 0 } : null,
    actions: interp ? { mode: 'open', stats: Object.assign({}, interp.stats), interpretations: interp.used(),
                        saved: opts.saveInterpretations === false ? 0 : interp.save() }
                    : { mode: 'registry' },
    population: { size: personas.length, departed: personas.filter(p => p.departed).length },
    firms: firms.map(f => ({ name: f.name, sector: f.sector, type: f.type, active: f.active, share: round3(f.share) })),
    pool: pool ? Object.assign({}, pool.stats) : null
  };
  /* Did the government keep its word? The same deterministic audit the
     original loop used: departures from the opening settlement, whether
     they were minuted, rounds nobody governed, clauses never cited, and the
     constitution's checkable rules run over what actually happened. */
  run.audit = con ? AUDIT.auditDeterministic({ trace: trace, trajectory: traj, constitution: con }) : null;
  run.evidence = EV.build(run, con);
  emit({ type: 'done', evidence: run.evidence.headline });
  return run;
}

/* A world state's saved levers may omit the automation map (the state
   records the automation each sector REACHED). Fill every gap from the
   defaults and the state, so no sector is ever without a ceiling. */
function completeLevers(given, base) {
  const lev = Object.assign({}, deepClone(E.DEFAULT_LEVERS), deepClone(given || {}));
  lev.allocation = Object.assign({}, E.DEFAULT_LEVERS.allocation, (given || {}).allocation || {});
  lev.automation_target = Object.assign({}, E.DEFAULT_LEVERS.automation_target);
  E.ORDER.forEach(k => {
    const fromGiven = given && given.automation_target && given.automation_target[k];
    lev.automation_target[k] = fromGiven != null ? fromGiven
      : (base && base.sectors && base.sectors[k] ? base.sectors[k].automation : lev.automation_target[k]);
  });
  if (lev.care_guarantee_wage == null) lev.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
  delete lev.policies;
  return lev;
}

/* ---------------------------------------------------------------------
   WHAT THE MAP NEEDS
   ---------------------------------------------------------------------
   Compact on purpose: a thousand personas over twelve rounds travels to
   the browser. Each person is where they live, what they do for a living,
   and the one thing they mainly did this round, as the router understood it.
   --------------------------------------------------------------------- */
function peopleSnapshot(personas, decisions, orgs, interpretOf) {
  return personas.map(p => {
    const out = decisions[p.id];
    let act = p.departed ? 'left' : 'none';
    let label = null;
    if (out && !p.departed && interpretOf) {
      /* Open action: the dot shows what their most consequential action
         does, and carries the behaviour's own name for the Feed and map. */
      const priority = ['riot', 'strike', 'protest', 'organise', 'mutual_aid', 'petition', 'boycott',
                        'start_business', 'job_search', 'informal_work', 'network', 'save', 'support'];
      const mine = out.decision.actions.map(a => interpretOf(a)).filter(it => it && !R.blockedBy(p, it));
      const roles = mine.map(it => R.roleOf(it));
      act = priority.find(k => roles.indexOf(k) >= 0) || (out.decision.migrate === 'consider' ? 'considering_leaving' : 'none');
      const lead = mine[roles.indexOf(act)];
      label = lead ? lead.label : null;
    } else if (out && !p.departed) {
      const kinds = out.decision.actions.map(a => R.routeIntent(p, a))
        .filter(x => !x.infeasible && x.kind !== 'unrouted' && x.kind !== 'endure').map(x => x.kind);
      const priority = ['riot', 'strike', 'protest', 'organise', 'mutual_aid', 'petition', 'boycott',
                        'start_business', 'job_search', 'retrain', 'informal_work', 'network', 'save', 'support'];
      act = priority.find(k => kinds.indexOf(k) >= 0) || (out.decision.migrate === 'consider' ? 'considering_leaving' : 'none');
    }
    return {
      id: p.id, r: p.region, a: p.age, s: p.status, k: p.sector, w: Math.round(p.weight),
      act: act, b: label, d: p.departed ? 1 : 0, o: orgs.membershipOf(p.id).length ? 1 : 0,
      t: out && out.decision.trust_government != null ? out.decision.trust_government : null
    };
  });
}

/* Under ticks most steps are not ones where people decided, so the dots on
   the map are sent only when they changed; the page keeps the last ones. */
function viewOf(state, societyRow, events, peopleChanged) {
  const sectors = {};
  E.ORDER.forEach(k => {
    const s = state.sectors[k];
    sectors[k] = { quality: s.quality, capacity: s.capacity, automation: s.automation, headcount: s.headcount, margin: s.margin };
  });
  return {
    year: state.meta.year, round: state.meta.round, month: state.meta.month || null, tick: state.meta.tick || null,
    indicators: state.indicators, population: state.population,
    reserves_bn: state.fiscal.reserves_bn, gdp_bn: state.fiscal.gdp_bn,
    sectors: sectors, shocks: state.shocks, news: (state.news || []).slice(0, 4),
    events: (events || []).map(e => ({ label: e.label, severity: e.severity, perceived: e.perceived })),
    /* null means "unchanged": nobody has decided since the last dots were sent. */
    people: !societyRow ? null : (peopleChanged === false ? null : societyRow.people),
    society: societyRow ? { trust: societyRow.polls.trust, belonging: societyRow.polls.belonging,
                            actions: societyRow.action_shares, departed: societyRow.departed,
                            organisations: societyRow.organisations } : null
  };
}

/* Several sub-steps' behaviours, as one round's: the mean share, the
   union of everything else. */
function mergeBehaviours(lists) {
  const n = lists.length, by = {};
  lists.forEach(list => list.forEach(b => {
    const m = by[b.label] || (by[b.label] = Object.assign({}, b, { share: 0, weight: 0, people: 0, examples: [],
                                                                   channels: [], sources: {}, by_status: {} }));
    m.share += b.share / n; m.weight += b.weight / n; m.people = Math.max(m.people, b.people);
    b.examples.forEach(x => { if (m.examples.length < 3 && m.examples.indexOf(x) < 0) m.examples.push(x); });
    b.channels.forEach(x => { if (m.channels.indexOf(x) < 0) m.channels.push(x); });
    Object.keys(b.sources).forEach(k => { m.sources[k] = (m.sources[k] || 0) + b.sources[k]; });
    Object.keys(b.by_status).forEach(k => { m.by_status[k] = (m.by_status[k] || 0) + b.by_status[k] / n; });
    if (b.anticipated && !m.anticipated) m.anticipated = b.anticipated;
    if (b.lasting) m.lasting = true;
  }));
  return Object.keys(by).map(k => Object.assign(by[k], { share: Math.round(by[k].share * 10) / 10 }))
    .sort((a, b) => b.share - a.share);
}

function mergeReports(list) {
  const last = list[list.length - 1];
  return Object.assign({}, last, {
    protest_share: round1(list.reduce((a, x) => a + x.protest_share, 0) / list.length),
    mutual_aid_share: round1(list.reduce((a, x) => a + x.mutual_aid_share, 0) / list.length),
    unrouted_count: list.reduce((a, x) => a + x.unrouted_count, 0),
    infeasible_count: list.reduce((a, x) => a + x.infeasible_count, 0),
    fallbacks: list.reduce((a, x) => a + x.fallbacks, 0)
  });
}

function kindOfOrg(name) {
  const n = String(name).toLowerCase();
  if (/union/.test(n)) return 'union';
  if (/co-?op/.test(n)) return 'co-operative';
  if (/movement|protest|campaign|coalition/.test(n)) return 'movement';
  if (/residents|neighbour|community|kitchen|mutual/.test(n)) return 'community group';
  return 'group';
}

/* What the Feed page shows for one year: everything said that round, the
   most widely heard first. Government statements and departures are always
   kept; ordinary posts are capped so a classroom-size run stays light. */
function postsOfRound(feed, roundNo) {
  const all = feed.filter(f => f.round === roundNo);
  const always = all.filter(f => f.kind === 'government' || f.kind === 'departure');
  const rest = all.filter(f => f.kind !== 'government' && f.kind !== 'departure')
    .sort((a, b) => (b.reach || 0) - (a.reach || 0)).slice(0, 300);
  return always.concat(rest).map(f => ({
    kind: f.kind, author: f.author, role: f.role, text: f.text, reach: f.reach || 0,
    org: f.org || null, actions: f.actions || [], source: f.source || null, substep: f.substep || 0
  }));
}

function roleOf(p) {
  const work = p.status === 'employed' ? E.SECTORS[p.sector].name.toLowerCase()
    : p.status === 'unemployed' ? 'looking for work' : p.status.replace('_', ' ');
  return p.age + ' · ' + work + ' · ' + p.region.replace('_', ' ');
}

/** Replay the kernel from a run's trace, with no agents and no model. */
function replayKernel(base, trace) {
  const traj = [E.seed(base)];
  traj[0].levers = deepClone(trace[0].levers);
  for (let i = 1; i < trace.length; i++) {
    traj.push(stepWorld(traj, trace[i].levers, trace[i].shocks, trace[i].exogenous, trace[i].dt || 2));
  }
  return traj;
}

/* One step of the world. Under ticks the twelve reference households age,
   and the news is written, once a year rather than every month. */
function stepWorld(traj, levers, shocks, exogenous, dt) {
  const prev = traj[traj.length - 1];
  if (!dt || dt === 2) {
    const next = E.step(prev, levers, shocks, exogenous);
    next.personas = E.updatePersonas(prev.personas, next, prev);
    next.news = E.bulletin(next, prev);
    return next;
  }
  const next = E.step(prev, levers, shocks, exogenous, { dt: dt });
  const perYear = Math.max(1, Math.round(1 / dt));
  const yearEnd = next.meta.tick % perYear === 0;
  next.personas = yearEnd ? E.updatePersonas(prev.personas, next, prev, 1) : prev.personas;
  next.news = yearEnd ? E.bulletin(next, traj[Math.max(0, traj.length - perYear)]) : (prev.news || []);
  return next;
}

const round1 = v => Math.round(v * 10) / 10;
const round3 = v => Math.round(v * 1000) / 1000;

module.exports = { runAgentSociety, replayKernel };
