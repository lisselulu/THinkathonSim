/* =====================================================================
   FIRMS: SEVERAL PER INDUSTRY, OWNED BY DIFFERENT PEOPLE
   ---------------------------------------------------------------------
   One agent speaking for a whole industry cannot be undercut, bought or
   bankrupted. So each industry now holds a handful of firms, drawn from
   ownership types that genuinely want different things:

     incumbent      large and established; answers to shareholders
     cooperative    owned by its workers or members; livelihoods first
     state_owned    government-linked; a public mandate; may run at a loss
     startup        young and hungry; takes risks for growth
     multinational  foreign-owned; can move capacity to wherever is cheapest

   Each decides its PRICE, its WAGE OFFER, how far to automate under the
   government's ceiling, whether to hire or cut, whether to build or defer,
   and whether to leave the market. Market share moves toward the firms
   customers prefer. A firm that keeps losing leaves; a profitable market,
   or citizens starting businesses, lets a start-up in.

   The industry's KPIs are FIXED and shared by every firm in it
   (`sector_missions.js`). A firm is told what its industry is for; how it
   pursues that is its own business.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const L = require('../engine/lived.js');
const IND = require('../engine/industry_round.js');
const MIS = require('../engine/sector_missions.js');
const { rng, derive } = require('./rng.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

const TYPES = {
  incumbent: 'a large, established company answering to shareholders',
  cooperative: 'a co-operative owned by its workers and members; their livelihoods come first',
  state_owned: 'a government-linked enterprise with a public mandate; it may run at a modest loss to serve it',
  startup: 'a young company hungry for growth and willing to take risks',
  multinational: 'a foreign-owned company that can move work to wherever it is cheapest'
};

const MIX = {
  healthcare: { state_owned: 55, incumbent: 30, cooperative: 15 },
  care_services: { cooperative: 35, incumbent: 35, state_owned: 30 },
  education_research: { state_owned: 70, incumbent: 20, startup: 10 },
  transport_logistics: { state_owned: 35, incumbent: 35, multinational: 30 },
  energy_utilities: { state_owned: 60, incumbent: 40 },
  compute_telecom: { incumbent: 50, multinational: 35, startup: 15 },
  housing_construction: { state_owned: 50, incumbent: 35, cooperative: 15 },
  food_agri: { incumbent: 40, multinational: 35, cooperative: 25 },
  manufacturing: { multinational: 55, incumbent: 30, startup: 15 },
  finance: { incumbent: 50, multinational: 40, cooperative: 10 },
  retail_commerce: { incumbent: 40, multinational: 30, cooperative: 15, startup: 15 },
  public_admin: { state_owned: 100 },
  public_safety: { state_owned: 100 }
};

const NAME_PARTS = {
  lead: ['Harbour', 'Lion', 'Straits', 'Merlion', 'Kallang', 'Temasek', 'Orchid', 'Bukit', 'Marina', 'Jurong',
         'Serangoon', 'Changi', 'Pioneer', 'Keppel', 'Tanjong', 'Sentosa'],
  type: { incumbent: ['Holdings', 'Group', 'Corporation'], cooperative: ['Co-operative', 'Mutual', 'Workers\' Co-op'],
          state_owned: ['Authority', 'Enterprise', 'Board'], startup: ['Labs', 'Works', 'Collective'],
          multinational: ['Asia Pacific', 'International', 'Global'] }
};

function makeFirms(state, opts) {
  opts = opts || {};
  const r = rng(derive(opts.seed == null ? 1 : opts.seed, 'firms'));
  const firms = [];
  E.ORDER.forEach(k => {
    const mix = MIX[k];
    const total = Object.keys(mix).reduce((a, t) => a + mix[t], 0);
    Object.keys(mix).forEach(type => {
      firms.push(newFirm(r, k, type, mix[type] / total, state, firms));
    });
  });
  return firms;
}

/* A firm's id is its sector, its type and its place among every firm that
   has ever existed in this run. It must not come from a counter shared
   across runs: a replayed run would give the same firm a different id,
   miss its recorded decision, and diverge from the first round. */
function newFirm(r, sector, type, share, state, existing) {
  const firmSeq = (existing || []).length + 1;
  const lead = r.pick(NAME_PARTS.lead);
  const tail = r.pick(NAME_PARTS.type[type]);
  const noun = E.SECTORS[sector].name.split(/[ &]/)[0];
  return {
    id: sector + ':' + type + ':' + firmSeq,
    name: lead + ' ' + noun + ' ' + tail,
    sector: sector, type: type, share: share,
    markup: 1, wage_offer: 1,
    automation: state.sectors[sector].automation,
    losing_rounds: 0, active: true, memory: []
  };
}

/* ---------------------------------------------------------------------
   DECISION SCHEMA
   --------------------------------------------------------------------- */
const JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['thinking', 'markup', 'wage_offer', 'automation', 'hiring', 'investment', 'exit', 'post'],
  properties: {
    thinking: { type: 'string' },
    markup: { type: 'number', minimum: 0.6, maximum: 1.8 },
    wage_offer: { type: 'number', minimum: 0.6, maximum: 1.6 },
    automation: { type: 'number', minimum: 0, maximum: 0.98 },
    hiring: { type: 'string', enum: ['expand', 'hold', 'cut'] },
    investment: { type: 'string', enum: ['build', 'maintain', 'defer'] },
    exit: { type: 'boolean' },
    post: { type: 'string' }
  }
};

function validate(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const num = v => { const x = typeof v === 'string' ? parseFloat(v) : v; return typeof x === 'number' && isFinite(x) ? x : null; };
  const markup = num(raw.markup), wage = num(raw.wage_offer), auto = num(raw.automation);
  if (markup == null || wage == null) return { ok: false, reason: 'markup and wage_offer must be numbers' };
  const pick = (v, opts, dflt) => { const s = String(v || '').toLowerCase(); return opts.find(o => s.indexOf(o) >= 0) || dflt; };
  return { ok: true, value: {
    thinking: String(raw.thinking || '').slice(0, 220),
    markup: clamp(markup, 0.6, 1.8),
    wage_offer: clamp(wage, 0.6, 1.6),
    automation: auto == null ? null : clamp(auto > 1 && auto <= 100 ? auto / 100 : auto, 0, 0.98),
    hiring: pick(raw.hiring, ['expand', 'hold', 'cut'], 'hold'),
    investment: pick(raw.investment, ['build', 'maintain', 'defer'], 'maintain'),
    exit: raw.exit === true || String(raw.exit).toLowerCase() === 'true',
    post: String(raw.post || '').slice(0, 280)
  } };
}

/* ---------------------------------------------------------------------
   PERCEPTION — its own accounts, its market, the rules it operates under
   --------------------------------------------------------------------- */
function perceive(firm, ctx) {
  const k = firm.sector, prev = ctx.prev, next = ctx.next;
  const sec = next.sectors[k], was = prev.sectors[k];
  const baseline = E.R1_MARGINS[k];
  const mission = MIS.MISSIONS[k];
  const ceiling = ctx.ceilingOf(k);
  const myMargin = sec.margin + (firm.markup - 1) - (firm.wage_offer - 1) * 0.25;
  const rivals = ctx.firms.filter(f => f.active && f.sector === k && f.id !== firm.id)
    .map(f => f.name + ' (' + f.type.replace('_', '-') + ', ' + Math.round(f.share * 100) + '% of the market, prices at ' +
      Math.round(f.markup * 100) + ' where 100 is normal)');
  const rules = (ctx.policies || []).filter(pl =>
    (pl.sector === k || pl.sector === 'all' || pl.what === 'wage_floor' || pl.type === 'tax'))
    .map(describeRule);

  const facts = {
    year: next.meta.year,
    you_are: firm.name + ', ' + TYPES[firm.type] + ', in ' + E.SECTORS[k].name + '.',
    mission: mission ? mission.mission : null,
    judged_on: mission ? Object.keys(mission.kpi).sort((a, b) => mission.kpi[b] - mission.kpi[a])
      .map(d => d + ' ' + Math.round(mission.kpi[d] * 100) + '%').join(', ') : '',
    market_share: Math.round(firm.share * 100) + '%',
    your_margin: IND.marginFeel(myMargin, baseline),
    demand: IND.demandFeel(sec.capacity),
    staffing: sec.headcount < was.headcount * 0.97 ? 'the industry is shedding staff'
      : sec.headcount > was.headcount * 1.03 ? 'the industry is hiring' : 'industry staffing is steady',
    service_level: sec.quality >= 65 ? 'customers are well served' : sec.quality >= 45 ? 'service is strained'
      : 'the industry is failing its customers',
    automation_now: Math.round(firm.automation * 100) + '%',
    automation_allowed: Math.round(ceiling * 100) + '%',
    energy_costs: (next._computePrice || 1) > 1.6 ? 'far higher than they were and climbing'
      : (next._computePrice || 1) > 1.15 ? 'noticeably higher than they were' : 'about what they always were',
    taxes: 'profit tax ' + Math.round((next.levers || E.DEFAULT_LEVERS).corporate_tax_rate * 100) + '%',
    rivals: rivals,
    rules: rules
  };
  L.assertBlind(JSON.stringify(facts), 'firm');
  return facts;
}

function describeRule(pl) {
  if (pl.type === 'tax') return 'a ' + Math.round(pl.rate * 100) + '% tax on ' + pl.base.replace('_', ' ');
  if (pl.what === 'price_cap') return 'prices may not exceed ' + Math.round(pl.limit * 100) + ' (100 is normal)';
  if (pl.what === 'wage_floor') return 'wages may not fall below ' + Math.round(pl.limit * 100) + '% of the usual rate';
  if (pl.what === 'automation_cap') return 'automation is capped at ' + Math.round(pl.limit * 100) + '%';
  return pl.type;
}

function buildPrompt(firm, facts, ctx) {
  const lines = [
    'It is ' + facts.year + '. You run ' + facts.you_are,
    'What your industry is for: ' + facts.mission + ' Industries are judged on: ' + facts.judged_on + '.',
    'Your market share: ' + facts.market_share + '. Your margin: ' + facts.your_margin + '. Demand: ' + facts.demand +
      '. ' + facts.staffing + ', and ' + facts.service_level + '.',
    'Automation: you are at ' + facts.automation_now + '; the government allows up to ' + facts.automation_allowed +
      '. Energy and compute costs are ' + facts.energy_costs + '. You pay ' + facts.taxes + '.'
  ];
  if (facts.rivals.length) lines.push('Competitors:\n- ' + facts.rivals.join('\n- '));
  if (facts.rules.length) lines.push('Rules that apply to you:\n- ' + facts.rules.join('\n- '));
  if ((ctx.institutions || []).length) lines.push('The government funds or licenses:\n- ' + ctx.institutions.join('\n- '));
  if ((ctx.events || []).length) lines.push('What is happening: ' + ctx.events.map(e => e.perceived || e.label).join(' '));
  if ((ctx.announcements || []).length) lines.push('The government has said: ' + ctx.announcements.map(a => '"' + a + '"').join(' '));
  if ((ctx.voices || []).length) lines.push('Customers and workers are saying: ' + ctx.voices.map(v => '"' + v + '"').join(' '));
  if (firm.memory.length) lines.push('Your recent decisions:\n- ' + firm.memory.slice(-4).join('\n- '));
  /* The instructions live in the system message, identical for every firm,
     so the server reuses its cached prefix. Only the ceiling is repeated
     here, because it is this firm's number. */
  lines.push('Decide your strategy for the next ' + (ctx.horizon || 'two years') + ', as this kind of organisation would. ' +
             'Your automation may not exceed ' + facts.automation_allowed + '. ' +
             'Answer with the single JSON object described.');
  return lines.join('\n\n');
}

/* Identical for every firm, every round: sent once as the system message
   so a caching server does not re-read it about thirty-nine times a round. */
const INSTRUCTIONS = [
  'You are given one company\'s position. Decide its strategy for the period named at the end.',
  '',
  'Answer with one JSON object:',
  '- thinking: one short sentence',
  '- markup: your prices relative to normal (1.0 normal, 0.9 undercut, 1.2 raise), 0.6-1.8',
  '- wage_offer: pay relative to the industry norm, 0.6-1.6',
  '- automation: the automation level you will aim for, never above the ceiling you are given',
  '- hiring: expand, hold or cut',
  '- investment: build, maintain or defer',
  '- exit: true only if you are leaving this market',
  '- post: a public statement, or an empty string'
].join('\n');

const SYSTEM = 'You simulate the leadership of one company in Meridian, a city-state much like Singapore, in the 2050s. ' +
  'You know your own accounts, your market and the rules you operate under. Reply with a single JSON object only.\n\n' +
  INSTRUCTIONS;

/* The fallback: the existing deterministic industry ladder, translated to
   this schema. Labelled whenever it is used. */
function fallback(firm, ctx) {
  const k = firm.sector;
  const key = IND.deterministicChoose(k, ctx.next.sectors[k], {
    baselineMargin: E.R1_MARGINS[k], ceiling: ctx.ceilingOf(k),
    marginTrend: ctx.next.sectors[k].margin - ctx.prev.sectors[k].margin,
    energyPrice: ctx.next._computePrice || 1
  });
  return {
    thinking: '(no model reply; baseline behaviour: ' + key + ')',
    markup: firm.markup, wage_offer: firm.wage_offer,
    automation: key === 'invest_automation' ? Math.min(ctx.ceilingOf(k), firm.automation + 0.12) : firm.automation,
    hiring: key === 'hire' ? 'expand' : (key === 'lay_off' || key === 'cut_costs') ? 'cut' : 'hold',
    investment: key === 'expand_capacity' ? 'build' : key === 'cut_costs' ? 'defer' : 'maintain',
    exit: false, post: ''
  };
}

async function decide(pool, firm, ctx) {
  const facts = perceive(firm, ctx);
  const res = await pool.decide({
    key: ctx.keyPrefix + '|' + firm.id, system: SYSTEM, user: buildPrompt(firm, facts, ctx),
    schema: validate, jsonSchema: JSON_SCHEMA, schemaName: 'firm_decision',
    maxTokens: 320, seed: ctx.seed, temperature: ctx.temperature
  });
  if (res.data) return { decision: res.data, source: res.source };
  return { decision: fallback(firm, ctx), source: 'fallback', error: res.error };
}

/* ---------------------------------------------------------------------
   THE MARKET — shares, exits, entries, and what reaches the kernel
   --------------------------------------------------------------------- */
const HIRING_EFFECT = { expand: 0.03, hold: 0, cut: -0.04 };
const INVEST_EFFECT = { build: 0.04, maintain: 0, defer: -0.03 };
const SHARE_PRICE_SENSITIVITY = 1.6;

function applyMarket(firms, decisions, ctx, r) {
  const events = [];
  const exo = { firms: {}, capacity: {} };
  E.ORDER.forEach(k => {
    const inSector = firms.filter(f => f.active && f.sector === k);
    const ceiling = ctx.ceilingOf(k);
    inSector.forEach(f => {
      const d = decisions[f.id];
      if (!d) return;
      f.markup = d.markup;
      f.wage_offer = d.wage_offer;
      if (d.automation != null) f.automation = Math.min(ceiling, d.automation);
      f.lastHiring = d.hiring; f.lastInvest = d.investment;
      f.memory.push(ctx.year + ': prices ' + Math.round(d.markup * 100) + ', wages ' + Math.round(d.wage_offer * 100) +
        ', automation ' + Math.round(f.automation * 100) + '%, ' + d.hiring + ' staff, ' + d.investment + ' capacity');
      if (f.memory.length > 8) f.memory.shift();
    });

    // Customers move toward cheaper firms and firms that build.
    /* `ctx.k` is how long this decision covers, in two-year rounds. Customers
       drift toward a cheaper firm at the same pace per year however often
       the firms are asked. */
    const span = ctx.k == null ? 1 : ctx.k;
    const draw = f => Math.pow(f.markup, -SHARE_PRICE_SENSITIVITY) *
      (1 + (INVEST_EFFECT[f.lastInvest] || 0) * 2 + (HIRING_EFFECT[f.lastHiring] || 0));
    const pull = inSector.map(f => f.share * (span === 1 ? draw(f) : Math.pow(Math.max(0.01, draw(f)), span)));
    const total = pull.reduce((a, x) => a + x, 0) || 1;
    inSector.forEach((f, i) => { f.share = Math.max(0.01, pull[i] / total); });

    // Exits: a firm that chose to leave, or has lost money for three rounds.
    const secMargin = ctx.next.sectors[k].margin, base = E.R1_MARGINS[k];
    inSector.forEach(f => {
      const d = decisions[f.id] || {};
      const margin = secMargin + (f.markup - 1) - (f.wage_offer - 1) * 0.25;
      f.losing_rounds = margin < base - 0.2 ? f.losing_rounds + span : 0;   // six years of losses, however they are counted
      const canLeave = f.type !== 'state_owned' && inSector.filter(x => x.active).length > 1;
      if (canLeave && (d.exit || f.losing_rounds >= 3)) {
        f.active = false;
        events.push({ kind: 'exit', firm: f.name, sector: k, why: d.exit ? 'chose to leave' : 'lost money three rounds running' });
      }
    });
    // Entry: a profitable market, or citizens starting businesses in it.
    const founders = (ctx.founders && ctx.founders[k]) || 0;
    /* A profitable market draws an entrant about once a round; asked more
       often, the chance each time is that much smaller. */
    if ((secMargin > base + 0.06 || founders > 0.004) && (span === 1 || r() < span)) {
      const entrant = newFirm(r, k, 'startup', 0.05, ctx.next, firms);
      entrant.automation = Math.min(ceiling, ctx.next.sectors[k].automation);
      firms.push(entrant);
      events.push({ kind: 'entry', firm: entrant.name, sector: k,
                    why: founders > 0.004 ? 'residents started businesses' : 'the market is profitable' });
    }
    const live = firms.filter(f => f.active && f.sector === k);
    const sum = live.reduce((a, f) => a + f.share, 0) || 1;
    live.forEach(f => { f.share = f.share / sum; });

    exo.firms[k] = {
      markup: round3(live.reduce((a, f) => a + f.share * f.markup, 0)),
      wage_offer: round3(live.reduce((a, f) => a + f.share * f.wage_offer, 0)),
      automation: round3(Math.min(ceiling, live.reduce((a, f) => a + f.share * f.automation, 0)))
    };
    const capMult = live.reduce((a, f) => a + f.share *
      (1 + (HIRING_EFFECT[f.lastHiring] || 0) + (INVEST_EFFECT[f.lastInvest] || 0)), 0);
    if (Math.abs(capMult - 1) > 1e-9) exo.capacity[k] = round3(capMult);
  });
  return { exogenous: exo, events: events };
}

const round3 = v => Math.round(v * 1000) / 1000;

module.exports = { makeFirms, perceive, buildPrompt, decide, fallback, validate, applyMarket,
                   JSON_SCHEMA, TYPES, MIX, SYSTEM, INSTRUCTIONS };
