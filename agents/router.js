/* =====================================================================
   ROUTE
   ---------------------------------------------------------------------
   The middle stage of reason / route / action. Deterministic, and it
   decides nothing about anyone: it takes what agents said they would do,
   checks it is possible for them, and adds it up.

   INTENTS ARE OPEN. An agent writes "stop working at the hospital until
   the rota is fixed". The registry below recognises what that is — a
   strike, at the persona's own workplace — by matching words, not by
   forcing the agent to pick from a menu. Anything the registry does not
   recognise is kept as UNROUTED and published in the evidence, so
   organisers can see what the society was trying to do that the world
   has no mechanism for yet.

   EFFECTS COME FROM PARTICIPATION. A strike withholds the labour of the
   people actually striking, from the sector they actually work in, as a
   share of that sector's workforce. A protest costs legitimacy in
   proportion to how much of the country turned out. Mutual aid adds care
   capacity in proportion to the hours people gave. Nothing here has a
   fixed price tag of its own.

   FEASIBILITY IS ENFORCED. You cannot strike at a job you do not have,
   emigrate without the means, or plan a child at eighty. An infeasible
   intent is recorded with the reason and has no effect.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const POP = require('./population.js');
const DIST = require('./distribution.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* The registry. Ordered: the first matching entry wins, so the more
   specific phrases sit above the general ones. Each `route` returns an
   effect descriptor, or `{ infeasible: reason }`. */
const REGISTRY = [
  { kind: 'riot', words: /\b(riot|loot|smash|burn|violen|attack)/,
    route: (p) => ({ collective: 'riot' }) },
  { kind: 'strike', words: /\b(strike|walk ?out|down tools|stop work|go slow|work to rule|industrial action)/,
    route: (p, a) => {
      const sector = sectorIn(a.target) || p.sector;
      if (p.status !== 'employed' || !p.sector) return { infeasible: 'has no job to strike from' };
      if (sector !== p.sector) return { infeasible: 'does not work in ' + sector };
      return { collective: 'strike', sector: p.sector };
    } },
  { kind: 'organise', words: /\b(join|form|found|start|organi[sz]e|set up|create)\b.*\b(union|group|co-?op|association|movement|collective|network|society|committee|coalition|club)/,
    route: (p, a) => ({ organise: a.target || a.do }) },
  { kind: 'organise', words: /\b(union|co-?operative|residents'? (group|committee)|movement)\b/,
    route: (p, a) => ({ organise: a.target || a.do }) },
  { kind: 'protest', words: /\b(protest|march|rally|demonstrat|sit[- ]in|occupy)/,
    route: () => ({ collective: 'protest' }) },
  { kind: 'petition', words: /\b(petition|campaign|lobby|write to|complain|vote|speak up|town hall|feedback)/,
    route: () => ({ collective: 'petition' }) },
  { kind: 'boycott', words: /\b(boycott|stop buying|refuse to buy)/,
    route: (p, a) => ({ spendCut: 0.08, sector: sectorIn(a.target) }) },
  { kind: 'mutual_aid', words: /\b(help|mutual aid|volunteer|care for|look after|cook for|share food|food bank|neighbou?r|community kitchen|babysit|support (my|our|the) (community|neighbours))/,
    route: () => ({ collective: 'mutual_aid' }) },
  { kind: 'informal_work', words: /\b(informal|gig|side (job|hustle)|cash job|odd jobs|under the table)/,
    route: (p) => (p.age >= 65 && p.health === 'poor') ? { infeasible: 'too unwell to take on informal work' }
      : { labour: -0.3 } },
  { kind: 'start_business', words: /\b(start|open|launch|set up)\b.*\b(business|shop|stall|company|venture|hawker|startup|firm)/,
    route: (p, a) => (p.savings_months < 2 ? { infeasible: 'has no savings to start a business with' }
      : { found: sectorIn(a.target) || guessBusinessSector(a.target) }) },
  { kind: 'job_search', words: /\b(look(ing)? for|find(ing)?|apply(ing)?( for)?|search(ing)?( for)?|seek(ing)?|hunt(ing)?( for)?)\s+(a |an |some )?(new |part[- ]?time |full[- ]?time |another |better )?(jobs?|work|employment|positions?|shifts?)\b|\bjob hunt/,
    route: (p) => (p.status === 'employed' || p.status === 'unemployed' || p.age < 65 ? { labour: 0.15 } : { infeasible: 'retired and not seeking work' }) },
  { kind: 'network', words: /\b(network|reach out|reconnect|connect with|keep in touch|meet up)/,
    route: () => ({ collective: 'network' }) },
  { kind: 'retrain', words: /\b(retrain|reskill|course|learn|study|upskill|certif)/,
    route: () => ({ retrain: true }) },
  { kind: 'save', words: /\b(save|cut back|tighten|hoard|stock ?pile|spend less)/,
    route: () => ({ spendCut: 0.05 }) },
  { kind: 'support', words: /\b(support|trust|comply|cooperate|follow|obey|back the)\b/,
    route: () => ({ collective: 'support' }) },
  { kind: 'endure', words: /\b(nothing|wait|endure|keep my head down|carry on|get on with|stay put|ride it out)/,
    route: () => ({ none: true }) }
];

function sectorIn(text) {
  const t = String(text || '').toLowerCase();
  const hits = [
    ['healthcare', /hospital|clinic|health|nurs|doctor|polyclinic/],
    ['care_services', /care home|elder ?care|childcare|carer|caregiv|care/],
    ['education_research', /school|teach|universit|educat|research|tuition/],
    ['transport_logistics', /transport|bus|train|mrt|port|logistic|delivery|driver|taxi/],
    ['energy_utilities', /energy|power|electric|utilit|water|grid/],
    ['compute_telecom', /compute|data cent|telecom|internet|network|tech|software/],
    ['housing_construction', /housing|construction|build|hdb|rent|landlord/],
    ['food_agri', /food|farm|hawker|grocer|agri|supermarket/],
    ['manufacturing', /factory|manufactur|plant|semiconductor|wafer/],
    ['finance', /bank|financ|insur|loan/],
    ['retail_commerce', /shop|retail|mall|store|commerce/],
    ['public_admin', /ministry|civil service|government office|council|public service/],
    ['public_safety', /police|fire|security|civil defence|scdf/]
  ];
  const f = hits.find(h => h[1].test(t));
  return f ? f[0] : null;
}
function guessBusinessSector(text) { return sectorIn(text) || 'retail_commerce'; }

function routeIntent(p, a) {
  /* Underscores are how a model writes a phrase it thinks is an identifier:
     "look_for_part_time_jobs" is a sentence. */
  const text = (String(a.do || '') + ' ' + String(a.target || '')).toLowerCase().replace(/_/g, ' ');
  const entry = REGISTRY.find(e => e.words.test(text));
  if (!entry) return { kind: 'unrouted', text: (a.do + ' ' + a.target).trim() };
  const effect = entry.route(p, a);
  return Object.assign({ kind: entry.kind }, effect);
}

/* Share of working-age labour each work choice still supplies. */
const WORK_SUPPLY = { keep: 1, seek: 1, reduce: 0.6, quit: 0, retrain: 0.3, care_at_home: 0, retire: 0, none: 0 };
/* What each status normally supplies. The kernel's labour_supply of 1
   means "the usual participation", so the router reports willingness
   RELATIVE to this: a population behaving normally reads exactly 1, a
   carer who starts looking for work pushes it above 1, and a strike wave
   of quitting pulls it below. Measuring against every working-age adult
   instead made an ordinary population look like a labour shortage. */
const USUAL_SUPPLY = { employed: 1, unemployed: 1, carer: 0, student: 0, retired: 0, not_working: 0 };

/**
 * aggregate(personas, decisions, ctx) -> { exogenous, society }
 *
 * `decisions` is { personaId: { decision, source } } for ONE sub-step.
 * Returns the exogenous input this sub-step's decisions imply, and a
 * society report the evidence layer and the feed read.
 */
function aggregate(personas, decisions, ctx) {
  ctx = ctx || {};
  const live = personas.filter(p => !p.departed && decisions[p.id]);
  const totals = POP.totalsOf(personas);

  let spendNum = 0, spendDen = 0;
  let workNum = 0, workDen = 0;
  let trust = 0, belong = 0, satis = 0, wAll = 0;
  let plannedChildren = 0, parentAgeWeight = 0, leaving = 0;
  const collective = { strike: {}, protest: 0, petition: 0, mutual_aid: 0, riot: 0, support: 0, network: 0 };
  const founders = {};
  const routed = [], unrouted = [], infeasible = [];
  const joins = [];
  const counts = {};
  let fallbacks = 0;

  live.forEach(p => {
    const { decision: d, source } = decisions[p.id];
    if (source === 'fallback') fallbacks++;
    const w = p.weight;
    wAll += w;
    trust += w * (d.trust_government == null ? 5 : d.trust_government);
    belong += w * (d.belonging == null ? 5 : d.belonging);
    satis += w * (d.satisfaction == null ? 5 : d.satisfaction);

    let spendShare = d.spend_share;
    let labourAdj = 0;

    /* One person, one share of each kind of action. Someone who both
       "helps neighbours" and "volunteers at the food bank" is giving
       their time once, at the greater of the two intensities; counting
       them twice reported mutual aid at 171% of adults. */
    const seenKinds = new Set();
    const strongest = {};
    d.actions.forEach(a => {
      const r = routeIntent(p, a);
      const intensity = clamp(a.intensity == null ? 0.5 : a.intensity, 0, 1);
      if (!seenKinds.has(r.kind)) { counts[r.kind] = (counts[r.kind] || 0) + w; seenKinds.add(r.kind); }
      if (r.kind === 'unrouted') { unrouted.push({ id: p.id, text: r.text }); return; }
      if (r.infeasible) { infeasible.push({ id: p.id, kind: r.kind, why: r.infeasible }); return; }
      routed.push({ id: p.id, kind: r.kind, intensity: a.intensity });
      const slot = r.collective === 'strike' ? 'strike:' + r.sector : r.collective;
      if (slot) {
        const before = strongest[slot] || 0;
        if (intensity <= before) return;
        strongest[slot] = intensity;
        const add = w * (intensity - before);
        if (r.collective === 'strike') collective.strike[r.sector] = (collective.strike[r.sector] || 0) + add;
        else collective[r.collective] += add;
      }
      if (r.organise) joins.push({ persona: p, name: r.organise, year: ctx.year });
      if (r.spendCut) spendShare = Math.max(0, spendShare - r.spendCut * intensity);
      if (r.labour) labourAdj += r.labour * intensity;
      if (r.found) founders[r.found] = (founders[r.found] || 0) + w;
    });

    // Spending, weighted by how much income this household has.
    const iw = POP.incomeWeight(p) * w;
    spendNum += iw * spendShare; spendDen += iw;

    // Labour supply, working-age only, relative to what each status usually offers.
    if (p.age < 65 || p.status === 'employed') {
      const supply = clamp((WORK_SUPPLY[d.work] == null ? 1 : WORK_SUPPLY[d.work]) + labourAdj, 0, 1);
      workNum += w * supply; workDen += w * (USUAL_SUPPLY[p.status] == null ? 1 : USUAL_SUPPLY[p.status]);
    }
    /* Family plans, among people of an age to have children. A fallback
       decision never plans a child, so it is left out rather than allowed
       to halve the birth rate of a degraded run. */
    if (p.age >= 20 && p.age <= 44 && source !== 'fallback') {
      parentAgeWeight += w;
      if (d.family === 'plan_child') plannedChildren += w;
    }
    // Leaving is decided by the agent and limited by whether they can.
    if (d.migrate === 'leave') {
      if (p.mobility >= 0.3 && p.savings_months >= 2) leaving += w * clamp(p.mobility, 0, 1);
      else infeasible.push({ id: p.id, kind: 'emigrate', why: 'wants to leave but lacks the means' });
    }
  });

  const share = x => (totals.adults ? x / totals.adults : 0);
  const withheld = {};
  Object.keys(collective.strike).forEach(k => {
    const workforce = totals.by_sector[k] || 0;
    if (workforce > 0) withheld[k] = Math.round(clamp(collective.strike[k] / workforce, 0, 0.9) * 1000) / 1000;
  });

  /* Mutual aid adds real capacity where hands matter most. Two percent of
     adults giving substantial time adds roughly five percent to care. */
  const aid = share(collective.mutual_aid);
  const capacity = {};
  if (aid > 0) {
    capacity.care_services = 1 + clamp(aid * 2.5, 0, 0.3);
    capacity.healthcare = 1 + clamp(aid * 0.8, 0, 0.1);
    capacity.food_agri = 1 + clamp(aid * 0.6, 0, 0.08);
  }
  const riot = share(collective.riot);
  if (riot > 0) {
    capacity.retail_commerce = (capacity.retail_commerce || 1) * (1 - clamp(riot * 3, 0, 0.4));
    capacity.public_safety = (capacity.public_safety || 1) * (1 - clamp(riot * 2, 0, 0.3));
  }

  /* Civic unrest is now DERIVED from what people did, not mood: visible
     collective disruption, as a share of the population, on the 0-100
     scale the kernel's friction term already reads. */
  const struck = Object.keys(collective.strike).reduce((a, k) => a + collective.strike[k], 0);
  const unrest = Math.round(clamp((share(collective.protest) * 180 + share(struck) * 220 + riot * 600 +
                                   share(collective.petition) * 20), 0, 100));

  const parentShare = parentAgeWeight ? plannedChildren / parentAgeWeight : 0.1;   // no agent decided: the usual rate
  const exogenous = {
    households: {
      propensity: spendDen ? Math.round(spendNum / spendDen * 1000) / 1000 : null,
      labour_supply: workDen ? Math.round(clamp(workNum / workDen, 0, 1.3) * 1000) / 1000 : null,
      withheld: withheld
    },
    polls: {
      trust: wAll ? Math.round(trust / wAll * 10) : null,
      belonging: wAll ? Math.round(belong / wAll * 10) : null
    },
    demography: {
      /* Ten percent of people of childbearing age planning a child in a
         two-year window is the baseline rate; the multiplier is relative
         to that and bounded by the kernel. */
      births_mult: Math.round(clamp(0.5 + parentShare * 5, 0.3, 2) * 1000) / 1000,
      emigration: Math.round(leaving)
    },
    capacity: capacity,
    legitimacy_bonus: Math.round((-share(collective.protest) * 30 - share(collective.petition) * 6 +
                                  share(collective.support) * 4) * 10) / 10,
    cohesion_bonus: Math.round((share(collective.mutual_aid) * 20 + share(collective.network) * 4 - riot * 40) * 10) / 10,
    civic_unrest: unrest
  };

  return {
    exogenous: exogenous,
    joins: joins,
    founders: Object.keys(founders).reduce((o, k) => { o[k] = share(founders[k]); return o; }, {}),
    society: {
      agents: live.length, fallbacks: fallbacks,
      satisfaction: wAll ? Math.round(satis / wAll * 10) : null,
      action_shares: Object.keys(counts).sort((a, b) => counts[b] - counts[a])
        .map(k => ({ kind: k, share: Math.round(share(counts[k]) * 1000) / 10 })),
      strike_share_by_sector: withheld,
      protest_share: Math.round(share(collective.protest) * 1000) / 10,
      mutual_aid_share: Math.round(aid * 1000) / 10,
      emigrating: Math.round(leaving),
      unrouted: unrouted.slice(0, 40), unrouted_count: unrouted.length,
      infeasible: infeasible.slice(0, 40), infeasible_count: infeasible.length
    }
  };
}

/**
 * Organisations act together. When most of an organisation's weight chose
 * the same collective action this sub-step, members who did not are
 * carried with it at a lower intensity: solidarity, and peer pressure.
 */
function organisedAction(orgs, personas, decisions) {
  const byId = {};
  personas.forEach(p => { byId[p.id] = p; });
  const calls = [];
  orgs.all().forEach(org => {
    if (org.members.length < 2) return;
    const tally = {};
    org.members.forEach(id => {
      const d = decisions[id] && decisions[id].decision;
      if (!d) return;
      const kinds = new Set(d.actions.map(a => routeIntent(byId[id], a).kind));
      kinds.forEach(k => { tally[k] = (tally[k] || 0) + byId[id].weight; });
    });
    const top = Object.keys(tally).filter(k => ['strike', 'protest', 'mutual_aid', 'petition'].indexOf(k) >= 0)
      .sort((a, b) => tally[b] - tally[a])[0];
    if (!top || tally[top] / Math.max(1, org.weight) < 0.5) return;
    calls.push({ org: org.name, label: org.label, action: top });
    org.members.forEach(id => {
      const d = decisions[id] && decisions[id].decision;
      const p = byId[id];
      if (!d || !p) return;
      const already = d.actions.some(a => routeIntent(p, a).kind === top);
      if (already || d.actions.length >= 3) return;
      const target = top === 'strike' ? (p.sector ? E.SECTORS[p.sector].name : '') : org.label;
      d.actions.push({ do: top === 'mutual_aid' ? 'help neighbours' : top, target: target, intensity: 0.35,
                       why: 'called by ' + org.label, carried: true });
    });
  });
  return calls;
}

/** Average several sub-steps' exogenous inputs into one round's. */
function averageExogenous(list) {
  const n = list.length;
  if (!n) return {};
  if (n === 1) return list[0];
  const avg = xs => { const v = xs.filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const avgMap = key => {
    const out = {};
    list.forEach(x => Object.keys((x[key]) || {}).forEach(k => { (out[k] = out[k] || []).push(x[key][k]); }));
    Object.keys(out).forEach(k => { out[k] = out[k].reduce((a, b) => a + b, 0) / n + (1 - out[k].length / n) * (key === 'capacity' ? 1 : 0); });
    return out;
  };
  const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);
  const last = list[n - 1];
  const withheld = {};
  list.forEach(x => Object.keys(x.households.withheld || {}).forEach(k => {
    withheld[k] = (withheld[k] || 0) + x.households.withheld[k] / n;   // time-share of a strike
  }));
  return {
    households: {
      propensity: r3(avg(list.map(x => x.households.propensity))),
      labour_supply: r3(avg(list.map(x => x.households.labour_supply))),
      withheld: Object.keys(withheld).reduce((o, k) => { o[k] = r3(withheld[k]); return o; }, {})
    },
    polls: last.polls,                                  // the latest poll is the one that stands
    demography: {
      births_mult: r3(avg(list.map(x => x.demography.births_mult))),
      emigration: list.reduce((a, x) => a + x.demography.emigration, 0)   // departures accumulate
    },
    capacity: avgMap('capacity'),
    /* Open action: custom moved between sectors averages like capacity (a
       sub-step without it counts as no shift), the informal share as a mean. */
    ...(list.some(x => x.demand) ? { demand: (function () {
      const out = {};
      list.forEach(x => Object.keys(x.demand || {}).forEach(k => { (out[k] = out[k] || []).push(x.demand[k]); }));
      Object.keys(out).forEach(k => { out[k] = r3(out[k].reduce((a, v) => a + v, 0) / n + (1 - out[k].length / n)); });
      return out;
    })() } : {}),
    ...(list.some(x => x.informal_share) ? { informal_share: r3(list.reduce((a, x) => a + (x.informal_share || 0), 0) / n) } : {}),
    ...(list.some(x => x.distribution) ? { distribution: {
      paid_bn: r3(list.reduce((a, x) => a + ((x.distribution || {}).paid_bn || 0), 0) / n),
      from_ubi_bn: r3(list.reduce((a, x) => a + ((x.distribution || {}).from_ubi_bn || 0), 0) / n) } } : {}),
    legitimacy_bonus: r3(list.reduce((a, x) => a + x.legitimacy_bonus, 0) / n),
    cohesion_bonus: r3(list.reduce((a, x) => a + x.cohesion_bonus, 0) / n),
    civic_unrest: Math.round(avg(list.map(x => x.civic_unrest)))
  };
}

/* =====================================================================
   OPEN ACTION
   ---------------------------------------------------------------------
   The registry above decides what an action means by matching its words
   against a list. The open path below does not: every action has already
   been interpreted (agents/interpreter.js) into what it costs and what it
   does, and this code only CHARGES the cost against the person's real
   circumstances and ADDS UP the effects. Nothing here decides meaning.

   THE PERSON'S BUDGET
   Hours a week they can actually give, and a share of their monthly
   income they can spare. Up to three actions draw on the same budget, in
   the order the person wrote them: a nurse on a five-day week who says she
   will volunteer twenty hours and run a stall at weekends does not get
   both at full strength.

   THE CONVERSION TO THE WORLD
   Every constant below is a PLACEHOLDER in the same sense as the router's
   older coefficients, and is reported as such. They are chosen so that the
   registry's familiar actions land where they used to.
   ===================================================================== */
const OPEN = {
  FULL_TIME_HOURS: 40,
  VOLUNTEER_PRODUCTIVITY: 0.5,   // an hour given unpaid, against an hour of trained staff
  INFORMAL_PRODUCTIVITY: 0.7,    // an hour of off-the-books work
  MAX_CAPACITY_GAIN: 0.30,       // most that people alone can add to one sector
  HARM_SCALE: 3, MAX_HARM: 0.40,
  UNREST_SCALE: 180, STRIKE_UNREST_SCALE: 220, HARM_UNREST_SCALE: 300,
  LEGITIMACY_SCALE: 30, COHESION_SCALE: 20,
  DEMAND_SCALE: 1, MAX_DEMAND_SHIFT: 0.25,
  SPEND_STEP: 0.10, LABOUR_STEP: 0.30,
  MAX_INFORMAL_SHARE: 0.30
};

/** Hours a week this person can give, beyond work and home. */
function hoursFree(p, week) {
  const base = { employed: 12 + (5 - (week || 5)) * 8, unemployed: 30, student: 16, carer: 6, retired: 26, not_working: 24 }[p.status];
  let h = (base == null ? 14 : base) - (p.children || 0) * 4;
  if (p.health === 'poor') h *= 0.5;
  return Math.max(2, h);
}

const HEALTH_RANK = { poor: 0, fair: 1, good: 2 };

/** Why this person cannot do this, or null if they can. */
function blockedBy(p, it) {
  const r = it.requires || {};
  if (r.job && p.status !== 'employed') return 'needs a paid job';
  if (r.working_age && p.age >= 65) return 'needs someone of working age';
  if (r.min_savings_months && (p.savings_months || 0) < r.min_savings_months) return 'needs ' + r.min_savings_months + ' months of savings';
  if ((HEALTH_RANK[p.health] == null ? 2 : HEALTH_RANK[p.health]) < (HEALTH_RANK[r.min_health] || 0)) return 'needs ' + r.min_health + ' health';
  if (it.effects.some(e => e.channel === 'labour_withheld') && p.status !== 'employed') return 'has no job to withhold';
  return null;
}

/** A person's dot on the map, from what their action does. */
function roleOf(it) {
  const ch = it.effects.map(e => e.channel + (e.amount < 0 ? '-' : ''));
  const has = c => ch.indexOf(c) >= 0;
  if (has('harm')) return 'riot';
  if (has('labour_withheld')) return 'strike';
  if (has('unrest')) return 'protest';
  if (has('organise')) return 'organise';
  if (has('time_to_sector')) return 'mutual_aid';
  if (has('found_business')) return 'start_business';
  if (has('informal_production')) return 'informal_work';
  if (has('demand_shift-')) return 'boycott';
  if (has('legitimacy-')) return 'petition';
  if (has('labour_supply')) return 'job_search';
  if (has('spending-')) return 'save';
  if (has('cohesion')) return 'network';
  if (has('legitimacy')) return 'support';
  return 'none';
}

/* What each of the old patterns would have DONE. A behaviour counts as
   anticipated only if the old list both recognised its words and would
   have given it the same kind of effect; "sell kueh to the neighbours" is
   caught by the word neighbours, but selling is not helping. */
const EXPECTED = {
  strike: ['labour_withheld'], protest: ['unrest'], riot: ['harm', 'unrest'], petition: ['legitimacy', 'unrest'],
  mutual_aid: ['time_to_sector'], organise: ['organise'], boycott: ['spending', 'demand_shift'], save: ['spending'],
  informal_work: ['informal_production', 'labour_supply'], job_search: ['labour_supply'], start_business: ['found_business'],
  retrain: ['labour_supply'], network: ['cohesion'], support: ['legitimacy'], endure: []
};

/** The old pattern this behaviour matches in words AND effect, or null if it is novel. */
function anticipated(a, it) {
  const text = (String(a.do || '') + ' ' + String(a.target || '')).toLowerCase().replace(/_/g, ' ');
  const entry = REGISTRY.find(e => e.words.test(text));
  if (!entry) return null;
  if (!it) return entry.kind;
  const want = EXPECTED[entry.kind] || [];
  if (!it.effects.length) return want.length ? null : entry.kind;
  return it.effects.some(e => want.indexOf(e.channel) >= 0) ? entry.kind : null;
}

/**
 * aggregateOpen(personas, decisions, ctx) -> the same shape as aggregate()
 *   ctx.interpret(action) -> interpretation   (from the interpreter)
 *   ctx.state                                 the country this round
 *   ctx.week                                  working week, for free time
 */
function aggregateOpen(personas, decisions, ctx) {
  const live = personas.filter(p => !p.departed && decisions[p.id]);
  const totals = POP.totalsOf(personas);
  const state = ctx.state;

  let spendNum = 0, spendDen = 0, workNum = 0, workDen = 0;
  let trust = 0, belong = 0, satis = 0, wAll = 0;
  let plannedChildren = 0, parentAgeWeight = 0, leaving = 0, fallbacks = 0;
  const acc = { unrest: 0, legitimacy: 0, cohesion: 0, harmTotal: 0, withheldTotal: 0, aid: 0 };
  const hoursTo = {}, informalHours = {}, withheld = {}, demand = {}, harm = {};
  const founders = {}, joins = [], infeasible = [];
  const counts = {}, behaviours = {};
  let iwTotal = 0;
  /* What the team's own schemes pay, worked out from what people did. */
  const schemes = ctx.schemes || [];
  const tally = {};
  schemes.forEach(sc => { tally[sc.id] = { id: sc.id, name: sc.name, funding: sc.funding, weight: 0, credits: 0, sgd_year: 0, by_status: {} }; });
  const earnings = {};

  live.forEach(p => {
    const { decision: d, source } = decisions[p.id];
    if (source === 'fallback') fallbacks++;
    const w = p.weight;
    wAll += w;
    trust += w * (d.trust_government == null ? 5 : d.trust_government);
    belong += w * (d.belonging == null ? 5 : d.belonging);
    satis += w * (d.satisfaction == null ? 5 : d.satisfaction);
    const iw = POP.incomeWeight(p);
    iwTotal += iw * w;

    let spendShare = d.spend_share, labourAdj = 0;
    let hoursLeft = hoursFree(p, ctx.week), moneyLeft = 1;
    const seenLabels = new Set();
    const earnedHours = {};

    d.actions.forEach(a => {
      const it = ctx.interpret(a);
      if (!it) return;
      const why = blockedBy(p, it);
      if (why) { infeasible.push({ id: p.id, kind: it.label, why: why }); return; }

      /* What they can actually put in: the smaller of what the action asks
         and what they have left, as a share of what it asks. */
      /* An institution the team funded to make this easier carries part of
         the load: the premises, the equipment, the time off. The person is
         charged less than the action takes, and the rest still happens, so
         the same hours of their life deliver more. */
      const relief = (ctx.ease && ctx.ease[it.label]) || 1;
      const H = it.hours_per_week, Mo = it.money_share;
      const costH = H * relief, costMo = Mo * relief;
      const effort = Math.min(1, costH > 0 ? hoursLeft / costH : 1, costMo > 0 ? moneyLeft / costMo : 1);
      hoursLeft = Math.max(0, hoursLeft - costH * effort);
      moneyLeft = Math.max(0, moneyLeft - costMo * effort);
      const commit = clamp(a.intensity == null ? 0.5 : a.intensity, 0, 1) * effort;
      if (commit <= 0) return;
      /* Hours actually given to something a scheme rewards. */
      schemes.forEach(sc => { if (DIST.qualifies(it, sc)) earnedHours[sc.id] = (earnedHours[sc.id] || 0) + H * commit; });

      /* One person, one share of each behaviour, however they phrased it. */
      if (!seenLabels.has(it.label)) {
        seenLabels.add(it.label);
        counts[it.label] = (counts[it.label] || 0) + w;
        const b = behaviours[it.label] || (behaviours[it.label] = {
          label: it.label, weight: 0, people: 0, by_status: {}, channels: {},
          anticipated: null, examples: [], sources: {}, lasting: false
        });
        b.weight += w; b.people++;
        b.by_status[p.status] = (b.by_status[p.status] || 0) + w;
        it.effects.forEach(e => { b.channels[e.channel + (e.sector ? ':' + e.sector : '')] = true; });
        const known = anticipated(a, it);
        if (known && !b.anticipated) b.anticipated = known;
        const ex = (String(a.do || '') + (a.target ? ' | ' + a.target : '')).trim();
        if (b.examples.length < 3 && b.examples.indexOf(ex) < 0) b.examples.push(ex);
        b.sources[it.source] = (b.sources[it.source] || 0) + 1;
        if (it.lasting) b.lasting = true;
      }

      it.effects.forEach(e => {
        const x = w * commit * e.amount;
        switch (e.channel) {
          case 'time_to_sector':
            hoursTo[e.sector] = (hoursTo[e.sector] || 0) + x * H;
            if (x > 0) acc.aid += w * commit;
            break;
          case 'informal_production':
            /* Licensed by the team: the work still happens and still serves
               people, it just stops escaping the treasury. */
            if (ctx.formal && ctx.formal[it.label]) hoursTo[e.sector] = (hoursTo[e.sector] || 0) + x * H;
            else informalHours[e.sector] = (informalHours[e.sector] || 0) + x * H;
            break;
          case 'labour_withheld':
            if (x > 0) { withheld[p.sector] = (withheld[p.sector] || 0) + x; acc.withheldTotal += x; }
            break;
          case 'labour_supply': labourAdj += OPEN.LABOUR_STEP * e.amount * commit; break;
          case 'spending': spendShare = clamp(spendShare + OPEN.SPEND_STEP * e.amount * commit, 0, 1); break;
          case 'demand_shift': demand[e.sector] = (demand[e.sector] || 0) + x * iw; break;
          case 'harm': if (x > 0) { harm[e.sector] = (harm[e.sector] || 0) + x; acc.harmTotal += x; } break;
          case 'unrest': if (x > 0) acc.unrest += x; break;
          case 'legitimacy': acc.legitimacy += x; break;
          case 'cohesion': acc.cohesion += x; break;
          case 'organise': joins.push({ persona: p, name: e.group || a.target || it.label, year: ctx.year }); break;
          case 'found_business': if (x > 0) founders[e.sector] = (founders[e.sector] || 0) + w * commit; break;
        }
      });
    });

    /* What this person earned under each scheme, capped as the scheme says. */
    schemes.forEach(sc => {
      if (!earnedHours[sc.id]) return;
      const pay = DIST.payout(sc, earnedHours[sc.id]);
      if (pay.sgd_month <= 0) return;
      (earnings[p.id] = earnings[p.id] || []).push({ id: sc.id, name: sc.name, credits: pay.credits, sgd_month: pay.sgd_month });
      const t = tally[sc.id];
      t.weight += w; t.credits += w * pay.credits; t.sgd_year += w * pay.sgd_month * 12;
      t.by_status[p.status] = (t.by_status[p.status] || 0) + w;
    });

    spendNum += iw * w * spendShare; spendDen += iw * w;
    if (p.age < 65 || p.status === 'employed') {
      const supply = clamp((WORK_SUPPLY[d.work] == null ? 1 : WORK_SUPPLY[d.work]) + labourAdj, 0, 1);
      workNum += w * supply; workDen += w * (USUAL_SUPPLY[p.status] == null ? 1 : USUAL_SUPPLY[p.status]);
    }
    if (p.age >= 20 && p.age <= 44 && source !== 'fallback') {
      parentAgeWeight += w;
      if (d.family === 'plan_child') plannedChildren += w;
    }
    if (d.migrate === 'leave') {
      if (p.mobility >= 0.3 && p.savings_months >= 2) leaving += w * clamp(p.mobility, 0, 1);
      else infeasible.push({ id: p.id, kind: 'emigrate', why: 'wants to leave but lacks the means' });
    }
  });

  const share = x => (totals.adults ? x / totals.adults : 0);

  /* Hours become capacity against the people the sector already employs. */
  const staffOf = k => Math.max(1, (state && state.sectors[k] ? state.sectors[k].headcount : 0) || 1);
  const capacity = {};
  const bump = (k, f) => { capacity[k] = (capacity[k] == null ? 1 : capacity[k]) * f; };
  Object.keys(hoursTo).forEach(k => {
    const fte = hoursTo[k] / OPEN.FULL_TIME_HOURS;
    bump(k, 1 + clamp(fte / staffOf(k) * OPEN.VOLUNTEER_PRODUCTIVITY, -OPEN.MAX_CAPACITY_GAIN, OPEN.MAX_CAPACITY_GAIN));
  });
  let informalFte = 0;
  Object.keys(informalHours).forEach(k => {
    const fte = informalHours[k] / OPEN.FULL_TIME_HOURS;
    if (fte > 0) informalFte += fte;
    bump(k, 1 + clamp(fte / staffOf(k) * OPEN.INFORMAL_PRODUCTIVITY, -OPEN.MAX_CAPACITY_GAIN, OPEN.MAX_CAPACITY_GAIN));
  });
  Object.keys(harm).forEach(k => bump(k, 1 - clamp(share(harm[k]) * OPEN.HARM_SCALE, 0, OPEN.MAX_HARM)));
  Object.keys(capacity).forEach(k => { capacity[k] = Math.round(capacity[k] * 1000) / 1000; if (capacity[k] === 1) delete capacity[k]; });

  const withheldShare = {};
  Object.keys(withheld).forEach(k => {
    const workforce = totals.by_sector[k] || 0;
    if (workforce > 0) withheldShare[k] = Math.round(clamp(withheld[k] / workforce, 0, 0.9) * 1000) / 1000;
  });

  const demandMult = {};
  const iwMean = wAll ? iwTotal / wAll : 1;
  Object.keys(demand).forEach(k => {
    const m = 1 + clamp(share(demand[k]) / iwMean * OPEN.DEMAND_SCALE, -OPEN.MAX_DEMAND_SHIFT, OPEN.MAX_DEMAND_SHIFT);
    if (Math.abs(m - 1) > 1e-6) demandMult[k] = Math.round(m * 1000) / 1000;
  });

  const employed = state && state.population ? state.population.employed_total : totals.employed;
  const informalShare = Math.round(clamp(informalFte / Math.max(1, employed), 0, OPEN.MAX_INFORMAL_SHARE) * 1000) / 1000;

  const unrest = Math.round(clamp(share(acc.unrest) * OPEN.UNREST_SCALE + share(acc.withheldTotal) * OPEN.STRIKE_UNREST_SCALE +
                                  share(acc.harmTotal) * OPEN.HARM_UNREST_SCALE, 0, 100));
  const parentShare = parentAgeWeight ? plannedChildren / parentAgeWeight : 0.1;

  const exogenous = {
    households: {
      propensity: spendDen ? Math.round(spendNum / spendDen * 1000) / 1000 : null,
      labour_supply: workDen ? Math.round(clamp(workNum / workDen, 0, 1.3) * 1000) / 1000 : null,
      withheld: withheldShare
    },
    polls: { trust: wAll ? Math.round(trust / wAll * 10) : null, belonging: wAll ? Math.round(belong / wAll * 10) : null },
    demography: { births_mult: Math.round(clamp(0.5 + parentShare * 5, 0.3, 2) * 1000) / 1000, emigration: Math.round(leaving) },
    capacity: capacity,
    legitimacy_bonus: Math.round(share(acc.legitimacy) * OPEN.LEGITIMACY_SCALE * 10) / 10,
    cohesion_bonus: Math.round(share(acc.cohesion) * OPEN.COHESION_SCALE * 10) / 10,
    civic_unrest: unrest
  };
  /* The schemes' bill, as an annual amount, and the part meant to come out
     of the payment's own pot. The kernel does the rest. */
  const schemeRows = schemes.map(sc => {
    const t = tally[sc.id];
    const total = Object.keys(t.by_status).reduce((acc, k) => acc + t.by_status[k], 0) || 1;
    return {
      id: sc.id, name: sc.name, funding: sc.funding,
      taking_part_pct: Math.round(share(t.weight) * 1000) / 10,
      people: Math.round(t.weight),
      credits_month: Math.round(t.credits),
      paid_bn_year: Math.round(t.sgd_year / 1e9 * 1000) / 1000,
      mean_sgd_month: t.weight ? Math.round(t.sgd_year / 12 / t.weight) : 0,
      who: Object.keys(t.by_status).sort((x, y) => t.by_status[y] - t.by_status[x]).slice(0, 3)
        .map(k => ({ status: k, pct: Math.round(t.by_status[k] / total * 100) }))
    };
  });
  if (schemes.length) {
    const paid = schemeRows.reduce((acc, r) => acc + r.paid_bn_year, 0);
    const fromPot = schemeRows.filter(r => r.funding === 'payment').reduce((acc, r) => acc + r.paid_bn_year, 0);
    exogenous.distribution = { paid_bn: Math.round(paid * 1000) / 1000, from_ubi_bn: Math.round(fromPot * 1000) / 1000 };
  }
  if (Object.keys(demandMult).length) exogenous.demand = demandMult;
  if (informalShare > 0) exogenous.informal_share = informalShare;

  const list = Object.keys(behaviours).map(k => {
    const b = behaviours[k];
    return Object.assign({}, b, { share: Math.round(share(b.weight) * 1000) / 10, channels: Object.keys(b.channels) });
  }).sort((x, y) => y.weight - x.weight);

  return {
    exogenous: exogenous,
    joins: joins,
    founders: Object.keys(founders).reduce((o, k) => { o[k] = share(founders[k]); return o; }, {}),
    behaviours: list,
    schemes: schemeRows,
    earnings: earnings,
    society: {
      agents: live.length, fallbacks: fallbacks,
      satisfaction: wAll ? Math.round(satis / wAll * 10) : null,
      action_shares: Object.keys(counts).sort((x, y) => counts[y] - counts[x])
        .map(k => ({ kind: k, share: Math.round(share(counts[k]) * 1000) / 10 })),
      strike_share_by_sector: withheldShare,
      protest_share: Math.round(share(acc.unrest) * 1000) / 10,
      mutual_aid_share: Math.round(share(acc.aid) * 1000) / 10,
      informal_share: informalShare,
      emigrating: Math.round(leaving),
      novel_count: list.filter(b => !b.anticipated).length,
      unrouted: [], unrouted_count: 0,
      infeasible: infeasible.slice(0, 40), infeasible_count: infeasible.length
    }
  };
}

/* Organisations act together, whatever the action is: when most of a
   group's weight chose one behaviour with a collective effect, members who
   did not are carried with it at a lower intensity. */
const COLLECTIVE = ['unrest', 'labour_withheld', 'time_to_sector', 'harm', 'informal_production'];
function organisedActionOpen(orgs, personas, decisions, interpret) {
  const byId = {};
  personas.forEach(p => { byId[p.id] = p; });
  const calls = [];
  orgs.all().forEach(org => {
    if (org.members.length < 2) return;
    const tally = {}, sample = {};
    org.members.forEach(id => {
      const d = decisions[id] && decisions[id].decision;
      if (!d) return;
      const labels = new Set();
      d.actions.forEach(a => {
        const it = interpret(a);
        if (!it || !it.effects.some(e => COLLECTIVE.indexOf(e.channel) >= 0)) return;
        labels.add(it.label);
        if (!sample[it.label]) sample[it.label] = a;
      });
      labels.forEach(l => { tally[l] = (tally[l] || 0) + byId[id].weight; });
    });
    const top = Object.keys(tally).sort((x, y) => tally[y] - tally[x] || (x < y ? -1 : 1))[0];
    if (!top || tally[top] / Math.max(1, org.weight) < 0.5) return;
    calls.push({ org: org.name, label: org.label, action: top });
    org.members.forEach(id => {
      const d = decisions[id] && decisions[id].decision;
      if (!d || !byId[id]) return;
      const already = d.actions.some(a => { const it = interpret(a); return it && it.label === top; });
      if (already || d.actions.length >= 3) return;
      d.actions.push({ do: sample[top].do, target: sample[top].target, intensity: 0.35,
                       why: 'called by ' + org.label, carried: true });
    });
  });
  return calls;
}

module.exports = { aggregate, organisedAction, averageExogenous, routeIntent, sectorIn, REGISTRY, WORK_SUPPLY,
                   aggregateOpen, organisedActionOpen, hoursFree, blockedBy, roleOf, anticipated, OPEN };
