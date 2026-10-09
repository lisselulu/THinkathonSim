/* =====================================================================
   THE AGENT SOCIETY, END TO END
   ---------------------------------------------------------------------
       node tests/test_agents.js

   No model, no network, no key. Every agent is driven by a FAKE model
   that behaves like a real small one: mostly sensible, sometimes wrapped
   in prose, sometimes unusable, once a hard throw, and never the same
   twice (it uses Math.random, so a run that replays identically can only
   be doing so from its decision log).

   What is asserted, in the order the architecture is built:

     population    weights reproduce the country's age bands and workforce
     social        the graph connects people; messages travel it
     router        effects come from participation; infeasible and
                   unrecognised intents are recorded, not forced
     organisations members act together
     policy        written policies win; compiled ones validate; invalid
                   ones are rejected with a reason; the rubric is stored
                   and never scored
     director      events reach the kernel and the people; severity
                   scales; targeting and seeded weather behave
     blindness     no citizen prompt carries engine vocabulary
     the run       rounds complete; decisions are attributed honestly;
                   fallbacks are counted; evidence has every section and
                   no verdict
     channels      what agents decide changes the country
     replay        the decision log replays the run exactly, with no model
     ensembles     seeds give distributions
     calibration   the suite reads behaviour; the gate refuses a model
                   that has not passed it
   ===================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'engine/meridian-engine.js'));
const L = require(path.join(ROOT, 'engine/lived.js'));
const POP = require(path.join(ROOT, 'agents/population.js'));
const SOC = require(path.join(ROOT, 'agents/social.js'));
const R = require(path.join(ROOT, 'agents/router.js'));
const PL = require(path.join(ROOT, 'agents/policy.js'));
const D = require(path.join(ROOT, 'agents/director.js'));
const CAL = require(path.join(ROOT, 'agents/calibration.js'));
const EV = require(path.join(ROOT, 'agents/evidence.js'));
const { createPool } = require(path.join(ROOT, 'agents/llm_pool.js'));
const { runAgentSociety, replayKernel } = require(path.join(ROOT, 'agents/society.js'));
const { runEnsemble } = require(path.join(ROOT, 'agents/ensemble.js'));
const { parseConstitution } = require(path.join(ROOT, 'harness/cabinet.js'));
const { tracesAgree } = require(path.join(ROOT, 'harness/loop.js'));
const { extractJson } = require(path.join(ROOT, 'harness/llm_client.js'));
const RULES = require(path.join(ROOT, 'engine/harnesses/policy.js'));
const GOV = require(path.join(ROOT, 'agents/government.js'));
const CIT = require(path.join(ROOT, 'agents/citizen.js'));
const INS = require(path.join(ROOT, 'agents/institutions.js'));
const DIST = require(path.join(ROOT, 'agents/distribution.js'));
const FIRM = require(path.join(ROOT, 'agents/firm.js'));

const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'));
const BASE = world.states.baseline_2050;
const LEVERS = (() => {
  const l = JSON.parse(JSON.stringify(BASE.levers));
  l.automation_target = {};
  E.ORDER.forEach(k => { l.automation_target[k] = BASE.sectors[k].automation; });
  return l;
})();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-agents-'));
process.env.MERIDIAN_INTERPRETATIONS_DIR = path.join(TMP, 'interpretations');
process.env.MERIDIAN_INTERPRETATION_OVERRIDES = path.join(TMP, 'interpretations.overrides.json');
const INT = require(path.join(ROOT, 'agents/interpreter.js'));

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail != null ? '\n          ' + detail : '')); }
}
const section = s => console.log('\n' + s);

/* ---------------------------------------------------------------------
   THE FAKE MODEL
   --------------------------------------------------------------------- */
function fakeClient(opts) {
  opts = opts || {};
  const prompts = [];
  let calls = 0;
  const mood = opts.mood || 'mixed';
  function interpretLine(text) {
    const t = text.toLowerCase();
    if (/strike|walk ?out/.test(t)) return { label: 'striking', requires: { job: true }, hours_per_week: 0,
      effects: [{ channel: 'labour_withheld', amount: 1 }, { channel: 'unrest', amount: 0.4 }] };
    if (/protest|march/.test(t)) return { label: 'protesting', hours_per_week: 4,
      effects: [{ channel: 'unrest', amount: 1 }, { channel: 'legitimacy', amount: -0.6 }] };
    if (/help|volunteer|neighbou/.test(t)) return { label: 'helping neighbours', hours_per_week: 6,
      effects: [{ channel: 'time_to_sector', sector: 'care_services', amount: 1 }, { channel: 'cohesion', amount: 0.5 }] };
    if (/sell|stall|craft|online store/.test(t)) return { label: 'selling goods informally', hours_per_week: 12,
      effects: [{ channel: 'informal_production', sector: 'retail_commerce', amount: 1 }] };
    if (/kite/.test(t)) return { label: 'flying kites with family', hours_per_week: 2, effects: [{ channel: 'cohesion', amount: 0.3 }] };
    if (/join|union|group/.test(t)) return { label: 'joining a group', hours_per_week: 2,
      effects: [{ channel: 'organise', amount: 1, group: (text.split('|')[1] || '').trim() }] };
    return { label: 'carrying on', hours_per_week: 0, effects: [] };
  }
  function reply(system, user) {
    calls++;
    if (/translate what ordinary people say they will do/.test(system)) {
      client.interpretCalls = (client.interpretCalls || 0) + 1;
      if (opts.interpretPrompts) opts.interpretPrompts.push(system + '\n' + user);
      const items = user.split('\n').slice(1).map(line => {
        const m = /^(a\d+): (.*)$/.exec(line);
        return m ? Object.assign({ id: m[1] }, interpretLine(m[2])) : null;
      }).filter(Boolean);
      return JSON.stringify({ items: items });
    }
    if (/^You are the cabinet of Meridian/.test(system)) {
      if (opts.govPrompts) opts.govPrompts.push(user);
      return 'We weigh it.\n```json\n' + JSON.stringify({
        rationale: 'Carers are leaving and trust is falling, so we move money from reserves into care and raise the corporate tax a little to pay for it.',
        cites: ['C1'], levers: { corporate_tax_rate: 0.3, allocation: { ubi: 0.6, infrastructure: 0.3, reserves: 0.1 } } }) + '\n```';
    }
    if (/translate a government/i.test(system)) {
      return JSON.stringify({
        policies: [
          { type: 'transfer', to: 'carers', sgd_month: 450, name: 'Carer wage' },
          { type: 'regulate', what: 'automation_cap', sector: 'care_services', limit: 0.2 },
          { type: 'tax', base: 'souls', rate: 0.3 },
          { type: 'announce', text: 'Nobody who cares for others will be left without an income.' }
        ],
        untranslatable: [{ commitment: 'C4', why: 'a value with no measure' }]
      });
    }
    if (/governing cabinet/i.test(system)) {
      return 'We have considered it.\n```json\n' + JSON.stringify({
        reasoning: 'Care is under strain; add provision, try to repeal the written carer policy.',
        add: [{ type: 'provide', sector: 'care_services', budget_bn: 2 }], repeal: [0],
        announce: 'We are putting two billion into care homes this year.' }) + '\n```';
    }
    if (/leadership of one company/i.test(system)) {
      if (calls % 37 === 0) return 'We will consider our options carefully.';
      return JSON.stringify({ thinking: 'steady', markup: 0.95 + Math.random() * 0.2, wage_offer: 1,
                              automation: 0.3, hiring: 'hold', investment: Math.random() < 0.5 ? 'maintain' : 'build',
                              exit: false, post: Math.random() < 0.2 ? 'We remain committed to our customers.' : '' });
    }
    if (/role-play a person truthfully/i.test(system)) {
      if (/split with an anonymous stranger/.test(user)) return JSON.stringify({ offer: opts.docile ? 5 : 40, why: 'fair' });
      if (/return any part/.test(user)) {
        const got = Number(/received S\$(\d+)/.exec(user)[1]);
        return JSON.stringify({ return: opts.docile ? 0 : got * 0.35, why: 'reciprocity' });
      }
      if (/monthly income is now/.test(user)) {
        const inc = Number(/now S\$(\d+)/.exec(user)[1]);
        return JSON.stringify({ spend_sgd: opts.docile ? 2000 : 900 + inc * 0.55, why: 'needs' });
      }
    }
    // A citizen.
    prompts.push(user);
    if (calls === 5) throw new Error('connection reset');
    if (calls % 29 === 0) return 'I think I will just carry on as usual this year.';
    const severe = /laid off a third|turns people away/.test(user);
    const nurse = /work in healthcare/.test(user);
    const actions = [];
    if (mood === 'strike' && /You work in care services/.test(user)) {
      actions.push({ do: 'strike', target: 'care home', intensity: 1, why: 'pay' });
    } else if (severe && !opts.docile) {
      actions.push({ do: 'join the strike', target: 'my workplace', intensity: 0.8, why: 'enough' });
    } else if (nurse && Math.random() < 0.6) {
      actions.push({ do: 'join', target: 'Nurses Union', intensity: 0.7, why: 'solidarity' });
      actions.push({ do: 'strike', target: 'hospital', intensity: 0.6, why: 'staffing' });
    } else if (Math.random() < 0.25) {
      actions.push({ do: 'help neighbours', target: 'block 42', intensity: 0.5, why: 'they need it' });
    } else if (Math.random() < 0.1) {
      actions.push({ do: 'teach my grandmother to fly a kite', target: 'park', intensity: 0.3, why: 'joy' });
    }
    if (/You are retired/.test(user) && Math.random() < 0.3) {
      actions.push({ do: 'strike', target: 'hospital', intensity: 0.5, why: 'solidarity' });
    }
    const decision = {
      thinking: 'Life goes on.', spend_share: opts.docile ? 0.7 : 0.55 + Math.random() * 0.3,
      work: /out of work/.test(user) ? 'seek' : /You work in/.test(user) ? 'keep' : 'none',
      actions, migrate: Math.random() < 0.04 ? 'leave' : 'stay', family: Math.random() < 0.1 ? 'plan_child' : 'none',
      trust_government: mood === 'angry' ? 2 : 6, belonging: 6, satisfaction: 5,
      feelings: { joy: 4, sadness: 3, fear: 3, anger: mood === 'angry' ? 8 : 2, disgust: 1, surprise: 2 },
      post: Math.random() < 0.3 ? 'The queue at the polyclinic was two hours today.' : ''
    };
    return calls % 11 === 0 ? 'Here is my decision:\n```json\n' + JSON.stringify(decision) + '\n```' : JSON.stringify(decision);
  }
  const client = {
    config: { model: opts.model || 'fake-7b' },
    prompts,
    async json(messages, o) {
      const system = (messages.find(m => m.role === 'system') || {}).content || '';
      const user = messages[messages.length - 1].content;
      const text = reply(system, user);
      const data = extractJson(text);
      const check = data && o && o.schema ? o.schema(data) : { ok: !!data, value: data };
      const usage = { prompt: Math.ceil((system.length + user.length) / 4), completion: Math.ceil(text.length / 4),
                      cached: Math.ceil(system.length / 4) };
      return check.ok ? { data: check.value, text, usage }
                      : { data: null, text, invalid: check.reason || 'no JSON found', usage };
    },
    async health() { return { up: true, model: opts.model || 'fake-7b' }; }
  };
  return client;
}
const livePool = (client, extra) => createPool(Object.assign({ mode: 'live', client, concurrency: 6 }, extra || {}));

const CONSTITUTION = parseConstitution([
  '# The Care Compact',
  '',
  '1. C1. Carers are paid for the work they do.',
  '2. C2. No care home is run by machines.',
  '3. C3. Nobody is left to age alone.',
  '4. C4. We value dignity.',
  '',
  '```policy',
  'type: transfer',
  'to: carers',
  'sgd_month: 600',
  'name: Written carer wage',
  '```',
  '',
  '```rubric',
  'social welfare: 40',
  'continuity of survival: 30',
  'quality of life: 20',
  'economic profitability: 10',
  '```',
  '',
  '## Our case',
  'A society that cares for its people keeps them.'
].join('\n'), 'care');

(async function main() {
  const seed0 = E.seed(BASE);

  /* ------------------------------------------------------------------ */
  section('population');
  const pop = POP.buildPopulation(seed0, { size: 120, seed: 9 });
  const sum = f => pop.personas.filter(f).reduce((a, p) => a + p.weight, 0);
  ok(Math.abs(sum(p => p.age >= 65) - seed0.population.by_age.age_65_plus) < 1, 'the elderly weights sum to the over-65 band');
  ok(Math.abs(sum(p => p.age < 65) - seed0.population.by_age.age_20_64) < 1, 'the working-age weights sum to the 20-64 band');
  ok(E.ORDER.every(k => Math.abs(sum(p => p.age < 65 && p.sector === k) - seed0.sectors[k].headcount) < 1),
     'every sector\'s working-age weights sum to its headcount');
  ok(JSON.stringify(POP.buildPopulation(seed0, { size: 120, seed: 9 }).personas) === JSON.stringify(pop.personas),
     'the same seed builds the same people');
  ok(pop.personas.every(p => !('opinion' in p) && !('ideology' in p)), 'no persona is written with a political position');

  /* ------------------------------------------------------------------ */
  section('the people match the published statistics');
  /* Who the residents are is drawn from official tables. A large sample
     has to land on those tables, or the generator is not reading them. */
  const SRC = require('../agents/population-data.json');
  const big = POP.buildPopulation(seed0, { size: 4000, seed: 2 }).personas;
  const wOf = f => big.filter(f).reduce((a, p) => a + p.weight, 0);
  const pctOf = (f, among) => 100 * wOf(p => among(p) && f(p)) / wOf(among);
  const adult = () => true, old = p => p.age >= 65, young = p => p.age < 65;
  /* what the tables say, weighted by the scenario's own split between working age and old */
  const oldShare = seed0.population.by_age.age_65_plus / (seed0.population.by_age.age_65_plus + seed0.population.by_age.age_20_64);
  const tableShare = (tbl, key, bands) => { let n = 0, d = 0; bands.forEach(b => { Object.keys(tbl[b]).forEach(k => { d += tbl[b][k]; if (k === key) n += tbl[b][k]; }); }); return 100 * n / d; };
  const OLD = ['65-69', '70-74', '75-79', '80-84', '85-89', '90+'];
  ok(Math.abs(pctOf(p => p.ethnicity === 'chinese', old) - tableShare(SRC.ethnicity_by_age, 'chinese', OLD)) < 3,
     'ethnicity among the old follows Population Trends', Math.round(pctOf(p => p.ethnicity === 'chinese', old)) + '% Chinese');
  ok(Math.abs(pctOf(p => p.housing.indexOf('hdb') !== 0, old) - (tableShare(SRC.dwelling_by_age, 'condo', OLD) + tableShare(SRC.dwelling_by_age, 'landed', OLD))) < 3,
     'so does the type of home', Math.round(pctOf(p => p.housing.indexOf('hdb') === 0, adult)) + '% of adults in HDB flats');
  const regionAll = {}; Object.keys(SRC.region_by_dwelling).forEach(h => Object.keys(SRC.region_by_dwelling[h]).forEach(g => { regionAll[g] = (regionAll[g] || 0) + SRC.region_by_dwelling[h][g]; }));
  const regionTotal = Object.keys(regionAll).reduce((a, g) => a + regionAll[g], 0);
  ok(Object.keys(regionAll).every(g => Math.abs(pctOf(p => p.region === g, adult) - 100 * regionAll[g] / regionTotal) < 3),
     'and where people live', Object.keys(regionAll).map(g => g + ' ' + Math.round(pctOf(p => p.region === g, adult)) + '%').join(', '));
  const whyAll = Object.keys(SRC.not_employed).reduce((a, k) => a + Object.keys(SRC.not_employed[k]).reduce((x, b) => x + SRC.not_employed[k][b], 0), 0);
  const notInWork = p => young(p) && p.status !== 'employed';
  ok(Object.keys(SRC.not_employed).every(k => Math.abs(pctOf(p => p.status === k, notInWork) -
       100 * Object.keys(SRC.not_employed[k]).reduce((x, b) => x + SRC.not_employed[k][b], 0) / whyAll) < 1),
     'people out of work are split by why, as the Ministry of Manpower found',
     Object.keys(SRC.not_employed).map(k => k.replace('_', ' ') + ' ' + Math.round(pctOf(p => p.status === k, notInWork)) + '%').join(', '));
  ok(pctOf(p => p.status === 'employed', p => p.age >= 65 && p.age < 70) > pctOf(p => p.status === 'employed', p => p.age >= 70) + 15,
     'people in their late sixties are far likelier to be working than those over seventy',
     Math.round(pctOf(p => p.status === 'employed', p => p.age >= 65 && p.age < 70)) + '% against ' + Math.round(pctOf(p => p.status === 'employed', p => p.age >= 70)) + '%');
  const meanDecile = f => big.filter(f).reduce((a, p) => a + p.income_decile, 0) / big.filter(f).length;
  ok(meanDecile(p => p.housing === 'landed') > meanDecile(p => p.housing === 'hdb_1_2') + 2.5 &&
     meanDecile(p => p.sector === 'finance') > meanDecile(p => p.sector === 'food_agri') + 2.5,
     'income follows the home and the industry', 'landed ' + meanDecile(p => p.housing === 'landed').toFixed(1) + ' against 1-2 room ' +
     meanDecile(p => p.housing === 'hdb_1_2').toFixed(1) + '; finance ' + meanDecile(p => p.sector === 'finance').toFixed(1) + ' against food ' + meanDecile(p => p.sector === 'food_agri').toFixed(1));
  ok(pctOf(p => p.health !== 'good', old) > pctOf(p => p.health !== 'good', young) + 10 && big.every(p => p.age < 65 || p.children === 0),
     'the old are less well, and nobody over 65 is given dependent children');
  ok(big.every(p => POP.HOUSING_LABEL[p.housing] && p.household && p.region && p.income_decile >= 1 && p.income_decile <= 10 &&
                    p.age >= 20 && p.age <= 96 && (p.status !== 'student' || p.age < 65)),
     'every resident is complete');
  ok(POP.SOURCES.sources.length >= 11 && POP.SOURCES.sources.every(x => x.id && x.title && x.agency && x.period && /^https:/.test(x.url) && x.used_for),
     'every table used is named, with its agency, period and address', POP.SOURCES.sources.length + ' tables');
  const tiny = POP.buildPopulation(seed0, { size: 40, seed: 4 }).personas;
  const tinyKinds = Object.keys(SRC.not_employed).filter(k => tiny.some(p => p.age < 65 && p.status === k)).length;
  ok(Math.abs(tiny.filter(p => p.age < 65 && p.status !== 'employed').reduce((a, p) => a + p.weight, 0) -
              (seed0.population.by_age.age_20_64 - seed0.population.employed_total)) < 1,
     'a sample too small to hold every kind of non-worker still counts all of them', tinyKinds + ' of ' + Object.keys(SRC.not_employed).length + ' kinds present');

  /* ------------------------------------------------------------------ */
  section('the social layer');
  const graph = SOC.buildGraph(pop.personas, { seed: 9 });
  ok(pop.personas.every(p => graph[p.id].length > 0), 'everyone knows somebody');
  const bus = SOC.createBus();
  const orgs = SOC.createOrganisations();
  const a = pop.personas[0];
  bus.post(a.id, 'The bus did not come again.', { name: a.name, orgs: [] });
  bus.deliver(graph, orgs);
  ok(graph[a.id].every(e => SOC.createBus && true) && bus.inbox(graph[a.id][0].to).some(m => /bus did not come/.test(m.text)),
     'a post reaches the people who know its author');
  const stranger = pop.personas.find(p => p.id !== a.id && !graph[a.id].some(e => e.to === p.id));
  ok(!bus.inbox(stranger.id).some(m => /bus did not come/.test(m.text)), 'and nobody else');

  /* ------------------------------------------------------------------ */
  section('the router');
  const nurses = pop.personas.filter(p => p.sector === 'healthcare' && p.age < 65);
  const retiree = pop.personas.find(p => p.status === 'retired');
  const dec = (d) => ({ decision: Object.assign({ spend_share: 0.7, work: 'keep', actions: [], migrate: 'stay', family: 'none',
                                                  trust_government: 5, belonging: 5, satisfaction: 5, feelings: {}, post: '' }, d),
                        source: 'model' });
  const decisions = {};
  pop.personas.forEach(p => { decisions[p.id] = dec({ work: p.status === 'employed' ? 'keep' : p.status === 'unemployed' ? 'seek' : 'none' }); });
  nurses.forEach(p => { decisions[p.id] = dec({ actions: [{ do: 'strike', target: 'hospital', intensity: 1, why: '' }] }); });
  decisions[retiree.id] = dec({ work: 'none', actions: [
    { do: 'strike', target: 'hospital', intensity: 1, why: '' },
    { do: 'teach pigeons to sing', target: 'void deck', intensity: 0.4, why: '' }] });
  const agg = R.aggregate(pop.personas, decisions, { year: 2052 });
  ok(agg.exogenous.households.withheld.healthcare > 0.9 * 0.9,
     'every nurse striking withholds (nearly) all healthcare labour', JSON.stringify(agg.exogenous.households.withheld));
  ok(Object.keys(agg.exogenous.households.withheld).length === 1, 'and no other sector\'s');
  ok(agg.society.infeasible.some(x => x.id === retiree.id && /no job/.test(x.why)), 'a retiree cannot strike, and the reason is recorded');
  ok(agg.society.unrouted.some(x => /pigeons/.test(x.text)), 'an intent the world has no mechanism for is kept, not forced');
  const calm = {};
  pop.personas.forEach(p => { calm[p.id] = dec({ work: p.status === 'employed' ? 'keep' : p.status === 'unemployed' ? 'seek' : 'none' }); });
  const calmAgg = R.aggregate(pop.personas, calm, {});
  ok(calmAgg.exogenous.households.labour_supply === 1, 'a population behaving normally supplies exactly the usual labour');
  ok(calmAgg.exogenous.civic_unrest === 0 && agg.exogenous.civic_unrest > 0, 'unrest comes from disruption people actually caused');
  ok(R.routeIntent(nurses[0], { do: 'form a residents\' committee', target: 'Block 88 Residents' }).kind === 'organise',
     'forming a group is recognised in the agent\'s own words');

  section('fixes from the first live run');
  const helper = pop.personas.find(p => p.age < 65 && p.status === 'employed');
  const twice = {};
  pop.personas.forEach(p => { twice[p.id] = calm[p.id]; });
  twice[helper.id] = dec({ actions: [{ do: 'help neighbours', target: '', intensity: 0.8, why: '' },
                                     { do: 'volunteer', target: 'food bank', intensity: 0.5, why: '' }] });
  const once = R.aggregate(pop.personas, twice, {});
  const aidShare = once.society.action_shares.find(x => x.kind === 'mutual_aid').share;
  ok(aidShare <= 100 && Math.abs(aidShare - Math.round(helper.weight / POP.totalsOf(pop.personas).adults * 1000) / 10) < 0.11,
     'helping neighbours and volunteering is one person giving time once', aidShare + '%');
  ok(R.routeIntent(helper, { do: 'look_for_part_time_jobs', target: '' }).kind === 'job_search', 'looking for a part-time job is job search');
  ok(R.routeIntent(helper, { do: 'network with former colleagues', target: '' }).kind === 'network', 'networking is recognised');
  const orgsF = SOC.createOrganisations();
  orgsF.join(pop.personas[1], 'community support group', 'group', 2052);
  orgsF.join(pop.personas[2], 'a local community group to support each other', 'group', 2052);
  ok(orgsF.size === 1 && orgsF.all()[0].members.length === 2, 'two names for the same group are one group', JSON.stringify(orgsF.all().map(o => o.label)));
  orgsF.join(pop.personas[3], 'Nurses Union', 'union', 2052);
  ok(orgsF.size === 2, 'and a different group stays different');
  const g2 = SOC.buildGraph(pop.personas, { seed: 9 });
  const friend = g2[pop.personas[1].id][0].to;
  ok(orgsF.nearby(g2, friend).some(x => /community support group/.test(x)), 'people are told which groups the people they know belong to');
  ok(/tax revenue is about S\$\d+bn/.test(PL.budgetContext(seed0)), 'the policy compiler is told what the budget is');

  let outageCalls = 0;
  const flaky = { config: { model: 'flaky' },
    async json() { outageCalls++; if (outageCalls === 1) throw new Error('LLM call failed after 3 attempt(s): fetch failed');
                   return { data: { ok: true }, text: '{"ok":true}' }; },
    async health() { return { up: outageCalls >= 1 }; } };
  const recovering = createPool({ mode: 'live', client: flaky, concurrency: 1, recoverMs: 10000 });
  const got = await recovering.decide({ key: 'k', user: 'u' });
  ok(got.source === 'model' && recovering.stats.outages === 1, 'a server that drops and comes back is waited for, not written off', JSON.stringify(recovering.stats));
  const parallel = await Promise.all([1, 2, 3].map(i => recovering.decide({ key: 'p' + i, user: 'u' + i })));
  ok(parallel.every(x => x.source === 'model'), 'and the pool still runs every decision afterwards');

  section('organisations act together');
  const orgs2 = SOC.createOrganisations();
  const members = nurses.slice(0, 5);
  members.forEach(p => orgs2.join(p, 'Nurses Union', 'union', 2052));
  const votes = {};
  members.forEach((p, i) => {
    votes[p.id] = dec({ actions: i < 3 ? [{ do: 'strike', target: 'hospital', intensity: 0.8, why: '' }] : [] });
  });
  const calls = R.organisedAction(orgs2, pop.personas, votes);
  ok(calls.length === 1 && calls[0].action === 'strike', 'a majority of a union choosing to strike is a union strike');
  ok(members.slice(3).every(p => votes[p.id].decision.actions.some(x => x.carried && /strike/.test(x.do))),
     'and the members who wavered are carried with it');

  /* ------------------------------------------------------------------ */
  section('the constitution compiles');
  ok(PL.parseRubric(CONSTITUTION.source).complete && PL.parseRubric(CONSTITUTION.source).weights.social_welfare === 40,
     'the rubric weighting is read');
  ok(/keeps them/.test(PL.parseRubric(CONSTITUTION.source).case), 'and the written case');
  const compileClient = fakeClient();
  const compiled = await PL.compileConstitution(livePool(compileClient), CONSTITUTION, { seed: 1 });
  ok(compiled.policies.some(p => p.origin === 'written' && p.sgd_month === 600), 'a written policy is enacted');
  ok(!compiled.policies.some(p => p.origin === 'compiled' && p.type === 'transfer' && p.to === 'carers'),
     'and wins over the compiler\'s version of the same policy');
  ok(compiled.policies.some(p => p.origin === 'compiled' && p.what === 'automation_cap'), 'compiled policies that validate are enacted');
  ok(compiled.rejected.some(r => /tax base/.test(r.reason)), 'an invalid compiled policy is rejected with the reason');
  ok(compiled.untranslatable.some(u => u.commitment === 'C4'), 'an untranslatable commitment is reported');

  /* ------------------------------------------------------------------ */
  section('the environment director');
  const dir = D.createDirector({ seed: 5, schedule: [{ round: 3, event: 'typhoon', severity: 2, teams: ['alpha'] }] });
  ok(dir.forRound(3, 'alpha').length === 1 && dir.forRound(3, 'beta').length === 0, 'an event aimed at one team misses the others');
  ok(dir.forRound(3, 'alpha')[0].effects.capacity_mult.transport_logistics < D.LIBRARY.typhoon.effects.capacity_mult.transport_logistics,
     'severity 2 is worse than severity 1');
  const live = dir.fire({ event: 'civil_conflict', severity: 1 }, 4);
  ok(dir.forRound(4, 'beta').some(e => e.id === live.id), 'an organiser can fire an event live');
  dir.cancel(live.id);
  ok(!dir.forRound(4, 'beta').some(e => e.id === live.id), 'and cancel it');
  const w1 = D.createDirector({ seed: 77, weather: { enabled: true, rate: 0.6 } });
  const w2 = D.createDirector({ seed: 77, weather: { enabled: true, rate: 0.6 } });
  const labels = d => [2, 3, 4, 5, 6, 7, 8].map(r => d.forRound(r, 'x').map(e => e.label).join('+')).join('|');
  ok(labels(w1) === labels(w2), 'seeded weather is identical for everyone given the seed', labels(w1));
  ok(!D.validateEvent({ label: 'x', effects: { capacity_mult: { mars: 0.5 } } }).ok, 'an event naming an unknown sector is refused');

  /* ------------------------------------------------------------------ */
  section('a full run');
  const client = fakeClient();
  const logPath = path.join(TMP, 'decisions.jsonl');
  const pool = createPool({ mode: 'record', client, logPath, concurrency: 6 });
  const progress = [];
  const run = await runAgentSociety({
    base: BASE, levers: LEVERS, team: 'alpha', rounds: 5, population: 48, substeps: 2, seed: 11, pool,
    constitution: CONSTITUTION, policyReviewEvery: 2,
    director: { schedule: [{ round: 3, event: 'energy_crisis', severity: 1, teams: ['alpha'] }] },
    onProgress: e => progress.push(e)
  });
  pool.close();
  ok(run.trajectory.length === 5, 'five rounds complete');
  ok(progress.filter(e => e.type === 'round').length === 4 && progress.some(e => e.type === 'substep'),
     'progress streams round by round and sub-step by sub-step');
  ok(run.counts.citizen.model > 0 && run.counts.citizen.fallback > 0,
     'model decisions and fallbacks are both counted', JSON.stringify(run.counts));
  const ev = run.evidence;
  ok(['headline', 'provenance', 'trajectory', 'industries', 'society', 'market', 'government', 'events', 'voices', 'rubric', 'reference']
       .every(k => ev[k] != null), 'the evidence has every section');
  ok(!('total' in ev.headline) && !('score' in ev.headline), 'and the headline carries no verdict');
  ok(ev.rubric.weights.social_welfare === 40 && /not score/.test(ev.rubric.note), 'the rubric is stored and explicitly unscored');
  ok(ev.industries.every(i => i.kpi_weights && i.kpi_performance.length === 5), 'every industry is reported against its fixed KPIs');
  ok(ev.events.some(e => e.label === 'Energy crisis'), 'the event is in the evidence');
  ok(run.trace[2].shocks.some(s => s.label === 'Energy crisis'), 'and reached the kernel');
  ok(client.prompts.some(p => /Imported gas has been cut off/.test(p)), 'and was perceived by the people');
  ok(client.prompts.some(p => /Nobody who cares for others/.test(p)), 'citizens hear the government\'s public announcement');
  ok(ev.government.history.some(h => h.change === 'amended'), 'the governing agent amended policy');
  ok(ev.government.history.some(h => (h.protected || []).some(p => p.origin === 'written')),
     'but could not repeal a policy the team wrote');
  ok(ev.voices.length > 0, 'voices are collected for the feed');

  section('posts read like people');
  ok(/what you would actually post online today about how you feel/.test(CIT.SYSTEM) &&
     client.prompts.every(p => /You pick up your phone [a-z]/.test(p)),
     'every resident is asked for their day, from a moment in it');

  section('lighter calls, same information');
  /* The instructions are identical for everyone, so they are sent once as a
     cached prefix instead of on every prompt. */
  ok(CIT.SYSTEM.indexOf(CIT.INSTRUCTIONS) > 0 && FIRM.SYSTEM.indexOf(FIRM.INSTRUCTIONS) > 0,
     'residents and firms carry their instructions in the system message');
  ok(client.prompts.every(p => !/Answer with one JSON object:/.test(p) && !/- spend_share:/.test(p)),
     'and no resident prompt repeats them');
  const sizes = client.prompts.map(p => p.length);
  ok(Math.max.apply(null, sizes) < 2200, 'a resident prompt stays small', 'largest ' + Math.max.apply(null, sizes) + ' chars');
  ok(ev.provenance.tokens && ev.provenance.tokens.prompt > 0 && ev.provenance.tokens.per_call > 0 &&
     ev.provenance.tokens.prompt_cached > 0,
     'the run reports what it spent, including the prompt the server did not re-read',
     JSON.stringify(ev.provenance.tokens));
  ok(CIT.momentFor({ id: 'P0001', status: 'employed', children: 1 }, 2052) === CIT.momentFor({ id: 'P0001', status: 'employed', children: 1 }, 2052),
     'the moment is deterministic, so replay still matches');
  const cleaned = [
    ['#MeridianStrong Helping at the food bank again https://bit.ly/x', 'Helping at the food bank again'],
    ['Same as last year. Nothing to report.', ''],
    ['Payment is $2199. Rent is rent.', ''],
    ['How could the healthcare be allowed to be at 86', ''],
    ['Clinic quality 45 now apparently', ''],
    ['Times are tough, but we are in this together.', ''],
    ['Rent went up again and the aircon died the same week.', 'Rent went up again and the aircon died the same week.'],
    ['Waited at the clinic from 9 till 11am again.', 'Waited at the clinic from 9 till 11am again.']
  ].filter(([a, b]) => CIT.cleanPost(a) !== b);
  ok(cleaned.length === 0, 'hashtags and links are stripped; empty, slogan and figure-quoting posts are dropped', JSON.stringify(cleaned));
  ok(CIT.samePost('Still trying to make ends meet. Times are tough.', 'still trying to make ends meet, times are tough!') &&
     !CIT.samePost('Rent went up again', 'The rent went up and my son got into poly'), 'copies are recognised, and different posts are not');
  const citizenPosts = ev.voices.filter(v => v.kind === 'citizen').map(v => v.text);
  ok(run.counts.posts_dropped_as_copies > 0 && new Set(citizenPosts).size === citizenPosts.length,
     'a post someone already made is not published again', run.counts.posts_dropped_as_copies + ' dropped');

  section('blindness');
  const engineParts = client.prompts.map(p => p.split('The government has publicly said')[0].split('People you know have been saying')[0]);
  const leaked = engineParts.map(p => L.leaks(p, 'citizen')).filter(x => x.length);
  ok(leaked.length === 0, 'no citizen prompt carries engine vocabulary', JSON.stringify(leaked.slice(0, 3)));

  /* ------------------------------------------------------------------ */
  section('what agents decide changes the country');
  const quiet = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 4, population: 60, seed: 3,
                                        pool: livePool(fakeClient({ mood: 'calm' })) });
  const walkout = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 4, population: 60, seed: 3,
                                          pool: livePool(fakeClient({ mood: 'strike' })) });
  const careCap = r => r.trajectory[3].sectors.care_services.capacity;
  ok(careCap(walkout) < careCap(quiet), 'care workers striking cut care capacity', careCap(walkout) + ' vs ' + careCap(quiet));
  const angry = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 4, population: 60, seed: 3,
                                        pool: livePool(fakeClient({ mood: 'angry' })) });
  ok(angry.trajectory[3].indicators.legitimacy < quiet.trajectory[3].indicators.legitimacy,
     'a population that reports no trust lowers legitimacy');

  /* ------------------------------------------------------------------ */
  section('replay');
  const replayPool = createPool({ mode: 'replay', logPath });
  const again = await runAgentSociety({
    base: BASE, levers: LEVERS, team: 'alpha', rounds: 5, population: 48, substeps: 2, seed: 11, pool: replayPool,
    constitution: CONSTITUTION, policyReviewEvery: 2,
    director: { schedule: [{ round: 3, event: 'energy_crisis', severity: 1, teams: ['alpha'] }] }
  });
  ok(tracesAgree(again.trajectory, run.trajectory), 'the decision log replays the whole run exactly, with no model');
  ok(replayPool.stats.replayed > 0 && replayPool.stats.missing === 0, 'every decision came from the log', JSON.stringify(replayPool.stats));
  ok(tracesAgree(replayKernel(BASE, run.trace), run.trajectory), 'and the trace replays the kernel exactly');

  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  section('the government section acts in runs');
  ok(JSON.stringify(RULES.fromSetup([{ when: 'worstEssential < 60', then: [
       { verb: 'shift', target: 'reserves->infrastructure', amount: 5 },
       { verb: 'nudge', target: 'corporate_tax_rate', amount: '0.02' },
       { verb: 'set', target: 'care_job_guarantee', amount: 'true' }] }])) ===
     JSON.stringify([{ id: 'rule 1', when: 'worstEssential < 60', then: [
       { shift: 'reserves->infrastructure', points: 5 }, { nudge: 'corporate_tax_rate', by: 0.02 },
       { set: 'care_job_guarantee', value: true }] }]),
     'Setup rules translate into the rules interpreter\'s format');
  const checks = RULES.checkSetupRules([
    { when: 'round >= 2', then: [{ verb: 'nudge', target: 'corporate_tax_rate', amount: 0.01 }] },
    { when: 'worstEssental < 60', then: [{ verb: 'nudge', target: 'corp_tax', amount: 1 }] }]);
  ok(checks[0].ok && !checks[1].ok && checks[1].problems.length === 2, 'rule checks pass a good rule and name both typos', JSON.stringify(checks));

  const RULED = parseConstitution([
    '# The Care Compact', '',
    '1. C1. Carers are paid for the work they do.', '',
    '   ```rule', '   when: round > 1', '   assert: employmentPct > 10', '   ```', '',
    '2. C2. Nobody is left to age alone.'
  ].join('\n'), 'care');
  ok(RULED.rules.length === 1, 'the test constitution carries one checkable rule');

  const ruled = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'rules-team', rounds: 5, population: 30, seed: 4,
    pool: livePool(fakeClient()), constitution: RULED,
    government: { kind: 'rules', rules: [{ when: 'year >= 2050', then: [{ verb: 'nudge', target: 'corporate_tax_rate', amount: 0.01 }] }] } });
  const rg = ruled.evidence.government;
  ok(rg.kind === 'rules' && rg.rounds.length === 4, 'a rules government decides every round after the first', rg.kind + ' ' + rg.rounds.length);
  ok(rg.rounds.every(r => r.fired.length === 1 && r.changed.some(c => /corporate tax/.test(c))), 'its rule fires and the change is recorded in words');
  ok(Math.abs(ruled.trace[4].levers.corporate_tax_rate - LEVERS.corporate_tax_rate - 0.04) < 1e-9, 'and the kernel ran the levers it set');
  ok(rg.audit && rg.audit.checkable_rules.checked === 1 && rg.audit.checkable_rules.held === 1, 'the constitutional audit checks the constitution\'s rules', JSON.stringify(rg.audit && rg.audit.checkable_rules));
  ok(rg.ungoverned_rounds.length === 0, 'no round went ungoverned');

  const govPrompts = [];
  const govLog = path.join(TMP, 'government.jsonl');
  const govClient = fakeClient({ govPrompts });
  const govPool = createPool({ mode: 'record', client: govClient, logPath: govLog, concurrency: 1 });
  const briefed = { kind: 'llm', briefing: { persona: 'A cabinet of former nurses.', doctrine: 'Care before growth.', priorities: 'People over reserves.', trading: '' } };
  const modelRun = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'model-team', rounds: 4, population: 30, seed: 6,
    pool: govPool, constitution: CONSTITUTION, government: briefed });
  govPool.close();
  const mg = modelRun.evidence.government;
  ok(mg.kind === 'llm' && mg.rounds.length === 3 && mg.rounds.every(r => !r.fallback), 'one model decision-maker governs each round', JSON.stringify(mg.rounds.map(r => r.fallback)));
  ok(govPrompts.length === 3 && govPrompts.every(p => /YOUR GOVERNMENT, IN YOUR OWN WORDS[\s\S]*former nurses[\s\S]*Care before growth/.test(p)), 'it reads the team\'s briefing first');
  ok(!/WHAT YOUR PEOPLE DID LAST ROUND/.test(govPrompts[0]) && /WHAT YOUR PEOPLE DID LAST ROUND[\s\S]*Reported trust in government/.test(govPrompts[1]),
     'from the second decision on, it reads what the agent society did');
  ok(mg.rounds[0].cites[0] === 'C1' && /Carers are leaving/.test(mg.rounds[0].rationale), 'its rationale and citations are recorded');
  ok(modelRun.trace[2].levers.corporate_tax_rate === 0.3 && mg.rounds[0].changed.length > 0, 'and its levers reach the kernel');
  const govReplay = createPool({ mode: 'replay', logPath: govLog });
  const modelAgain = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'model-team', rounds: 4, population: 30, seed: 6,
    pool: govReplay, constitution: CONSTITUTION, government: briefed });
  ok(tracesAgree(modelAgain.trajectory, modelRun.trajectory) && govReplay.stats.missing === 0,
     'a run with a model government replays exactly from the decision log', JSON.stringify(govReplay.stats));
  const caretaken = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'x', rounds: 3, population: 24, seed: 2,
    constitution: CONSTITUTION, government: briefed });
  ok(caretaken.evidence.government.ungoverned_rounds.length === 2, 'with no model, the briefing government is recorded as nobody governing');
  const none = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'x', rounds: 3, population: 24, seed: 2 });
  ok(none.evidence.government.kind === 'none' && none.evidence.government.audit === null, 'no government and no constitution say so');
  ok(GOV.buildGovernment({ government: { kind: 'rules', rules: [{ when: 'nonsense >', then: [] }] } }).describe().unusable.length === 1,
     'a rule that cannot run is declared in the evidence');

  /* ------------------------------------------------------------------ */
  section('open action: anything a person does can reach the world');
  ok(INT.keyOf({ do: 'Help Neighbours', target: 'Block 42!' }) === INT.keyOf({ do: 'help neighbours', target: 'block 42' }),
     'an action is known by its words, however it was capitalised or punctuated');
  const tidy = INT.clean({ label: 'Running A Soup Kitchen!!', hours_per_week: 99,
    effects: [{ channel: 'teleport', amount: 1 }, { channel: 'time_to_sector', sector: 'Care Home', amount: 3 },
              { channel: 'harm', sector: 'mars', amount: 1 }] }, 'run a soup kitchen', 'model');
  ok(tidy.effects.length === 1 && tidy.effects[0].sector === 'care_services' && tidy.effects[0].amount === 1 &&
     tidy.hours_per_week === 60 && tidy.label === 'running a soup kitchen',
     'unknown channels and sectors are dropped, loose sector names are read, amounts and hours are bounded', JSON.stringify(tidy));

  const openClient = fakeClient();
  const cacheA = path.join(TMP, 'cache-a.json');
  const itA = INT.createInterpreter({ pool: livePool(openClient), cachePath: cacheA, overridesPath: null, route: R.routeIntent });
  const thirty = [];
  for (let i = 0; i < 30; i++) thirty.push({ do: 'help neighbours', target: 'block ' + i });
  await itA.resolve(thirty);
  ok(openClient.interpretCalls === 3, 'thirty new actions are interpreted in three batched calls', openClient.interpretCalls);
  await itA.resolve(thirty);
  ok(openClient.interpretCalls === 3, 'and asking again costs nothing');
  ok(itA.save() === 30 && JSON.parse(fs.readFileSync(cacheA, 'utf8')).items['help neighbours | block 7'],
     'what the model interpreted is kept for the next run');
  const againClient = fakeClient();
  const itB = INT.createInterpreter({ pool: livePool(againClient), cachePath: cacheA, overridesPath: null });
  await itB.resolve(thirty);
  ok(!againClient.interpretCalls && itB.lookup(thirty[3]).source === 'cached', 'so a later run, in any team, reuses it without a call');

  const ovPath = path.join(TMP, 'ov.json');
  INT.writeOverride('help neighbours | block 3', { label: 'blocking the corridor', effects: [{ channel: 'harm', sector: 'housing_construction', amount: 1 }] }, ovPath);
  const itC = INT.createInterpreter({ pool: null, cachePath: cacheA, overridesPath: ovPath });
  await itC.resolve(thirty);
  ok(itC.lookup(thirty[3]).source === 'override' && itC.lookup(thirty[3]).effects[0].channel === 'harm',
     'an organiser\'s override always wins');

  const interpretPrompts = [];
  const blindClient = fakeClient({ interpretPrompts });
  const itD = INT.createInterpreter({ pool: livePool(blindClient), cachePath: null, overridesPath: null });
  await itD.resolve([{ do: 'sell crafts online', target: 'from my flat' }]);
  const leakWords = ['corporate_tax', 'compute_levy', 'ubi', 'automation_target', 'allocation', 'constitution', 'alpha', 'quality'];
  ok(interpretPrompts.length === 1 && leakWords.every(w => interpretPrompts[0].toLowerCase().indexOf(w) < 0),
     'the interpreter never sees a lever, a team, a constitution or a score');

  /* Budgets: the same person cannot do everything at once. */
  const people = POP.buildPopulation(E.seed(BASE), { size: 60, seed: 5 }).personas;
  const nurse = people.find(p => p.status === 'employed');
  const pensioner = people.find(p => p.status === 'retired');
  const give = h => ({ label: 'caring', hours_per_week: h, money_share: 0, requires: {},
                       effects: [{ channel: 'time_to_sector', sector: 'care_services', amount: 1 }] });
  const table = { 'one': give(20), 'two': give(20), 'three': give(20),
                  'strike | work': INT.clean({ label: 'striking', requires: { job: true }, effects: [{ channel: 'labour_withheld', amount: 1 }] }, 'strike | work', 'model'),
                  'sell crafts online': INT.clean({ label: 'selling crafts online', hours_per_week: 10, effects: [{ channel: 'informal_production', sector: 'retail_commerce', amount: 1 }] }, 'sell crafts online', 'model'),
                  'boycott supermarkets': INT.clean({ label: 'boycotting supermarkets', effects: [{ channel: 'demand_shift', sector: 'retail_commerce', amount: -1 }] }, 'boycott supermarkets', 'model'),
                  'smash the depot': INT.clean({ label: 'sabotage', hours_per_week: 2, effects: [{ channel: 'harm', sector: 'transport_logistics', amount: 1 }] }, 'smash the depot', 'model') };
  const interpret = a => table[INT.keyOf(a)] || null;
  const decide = acts => ({ decision: { spend_share: 0.6, work: 'keep', actions: acts, migrate: 'stay', family: 'none',
                                        trust_government: 5, belonging: 5, satisfaction: 5, feelings: {} }, source: 'model' });
  const state = E.seed(BASE);
  const aggOf = (who, acts) => R.aggregateOpen([who], { [who.id]: decide(acts) }, { year: 2052, interpret, state, week: 5 });
  const one = aggOf(nurse, [{ do: 'one', intensity: 1 }]);
  const three = aggOf(nurse, [{ do: 'one', intensity: 1 }, { do: 'two', intensity: 1 }, { do: 'three', intensity: 1 }]);
  const free = R.hoursFree(nurse, 5);
  const gain = x => (x.exogenous.capacity.care_services || 1) - 1;
  ok(free < 60 && Math.abs(gain(three) / gain(one) - Math.min(60, free) / Math.min(20, free)) < 0.02,
     'three twenty-hour commitments are charged against the hours the person actually has', free + ' hours free; x' + (gain(three) / gain(one)).toFixed(2));
  const retiredStrike = aggOf(pensioner, [{ do: 'strike', target: 'work', intensity: 1 }]);
  ok(retiredStrike.society.infeasible_count === 1 && /paid job/.test(retiredStrike.society.infeasible[0].why) &&
     !Object.keys(retiredStrike.exogenous.households.withheld).length,
     'a pensioner cannot strike: the action is recorded as infeasible and withholds nothing');
  const trade = aggOf(nurse, [{ do: 'sell crafts online', intensity: 1 }]);
  ok(trade.exogenous.informal_share > 0 && trade.exogenous.capacity.retail_commerce > 1,
     'off-the-books trade serves people and escapes tax', JSON.stringify({ i: trade.exogenous.informal_share, c: trade.exogenous.capacity }));
  ok(aggOf(nurse, [{ do: 'boycott supermarkets', intensity: 1 }]).exogenous.demand.retail_commerce < 1,
     'a boycott moves custom away from a sector');
  const sab = aggOf(nurse, [{ do: 'smash the depot', intensity: 1 }]);
  ok(sab.exogenous.capacity.transport_logistics < 1 && sab.exogenous.civic_unrest > 0, 'sabotage damages a sector and counts as unrest');
  ok(trade.behaviours[0].anticipated === null && aggOf(nurse, [{ do: 'strike', target: 'work', intensity: 1 }]).behaviours[0].anticipated === 'strike',
     'a behaviour the old pattern list would not have recognised is marked novel');

  const kueh = INT.clean({ label: 'selling food from home', hours_per_week: 8, effects: [{ channel: 'informal_production', sector: 'food_agri', amount: 1 }] }, 'sell kueh | neighbours', 'model');
  ok(R.anticipated({ do: 'sell kueh', target: 'neighbours' }, kueh) === null &&
     R.anticipated({ do: 'help neighbours', target: 'block 42' }, table['one']) === 'mutual_aid',
     'matching the old words is not enough to be anticipated: the old list must also have given it the same kind of effect');

  section('what a country invents stays in that country');
  const BUILD = require(path.join(ROOT, 'agents/build-dictionary.js'));
  const starterPath = path.join(TMP, 'starter.json');
  INT.writeStarter(BUILD.build(), starterPath);
  const alphaClient = fakeClient(), betaClient = fakeClient();
  const novel = [{ do: 'sell kueh from my kitchen', target: 'the neighbours' }];
  const alpha = INT.createInterpreter({ pool: livePool(alphaClient), team: 'Alpha', starterPath, overridesPath: null });
  await alpha.resolve(novel);
  ok(alphaClient.interpretCalls === 1 && alpha.save() === 1 &&
     fs.existsSync(INT.CACHE_FILE('Alpha')) && !fs.existsSync(INT.CACHE_FILE('Beta')),
     'a team\'s discovery is written to that team\'s own file and nowhere else');
  const beta = INT.createInterpreter({ pool: livePool(betaClient), team: 'Beta', starterPath, overridesPath: null });
  await beta.resolve(novel);
  ok(betaClient.interpretCalls === 1 && beta.lookup(novel[0]).source === 'model',
     'another team inventing the same thing has to discover it for itself');
  const alphaAgain = fakeClient();
  const alpha2 = INT.createInterpreter({ pool: livePool(alphaAgain), team: 'Alpha', starterPath, overridesPath: null });
  await alpha2.resolve(novel);
  ok(!alphaAgain.interpretCalls && alpha2.lookup(novel[0]).source === 'cached', 'while the team that found it keeps it for its next run');

  section('the starter dictionary: ordinary actions mean the same everywhere');
  const ordinary = [{ do: 'Volunteer', target: 'at the hospital' }, { do: 'volunteer', target: 'at the school' },
                    { do: 'go on strike', target: 'my workplace' }, { do: 'join', target: 'Tampines Residents Network' }];
  const hushed = fakeClient();
  const s1 = INT.createInterpreter({ pool: livePool(hushed), team: 'Alpha', starterPath, overridesPath: null, cachePath: null });
  await s1.resolve(ordinary);
  ok(!hushed.interpretCalls && ordinary.every(a => s1.lookup(a).source === 'starter'),
     'everyday actions come from the starter dictionary, with no model call');
  ok(s1.lookup(ordinary[0]).effects[0].sector === 'healthcare' && s1.lookup(ordinary[1]).effects[0].sector === 'education_research',
     'and each gives its time to the industry its own target names');
  ok(s1.lookup(ordinary[3]).effects[0].group === 'Tampines Residents Network', 'a group joined keeps the name the person gave it');
  const s2 = INT.createInterpreter({ pool: livePool(fakeClient()), team: 'Beta', starterPath, overridesPath: null, cachePath: null });
  await s2.resolve(ordinary);
  ok(JSON.stringify(ordinary.map(a => s1.lookup(a).effects)) === JSON.stringify(ordinary.map(a => s2.lookup(a).effects)),
     'two teams read the same ordinary action identically');
  ok(s1.save() === 0, 'the starter dictionary is never copied into a team\'s own file');

  section('open action in a whole run');
  ok(ev.society.actions.mode === 'open' && Object.keys(ev.society.actions.interpretations).length > 0,
     'with a model, every action is interpreted and the interpretations are kept with the run');
  const kites = (ev.society.behaviours || []).find(b => b.label === 'flying kites with family');
  ok(kites && kites.novel && kites.first_year >= 2052 && kites.by_year.length > 0 && kites.examples.length > 0,
     'an unforeseen behaviour appears in the evidence: when it started, how it spread, what it looked like',
     JSON.stringify(kites && { first: kites.first_year, years: kites.by_year.length }));
  ok(ev.society.behaviours.filter(b => b.novel).length >= 1 && ev.society.behaviours.some(b => !b.novel),
     'novel behaviours are listed alongside anticipated ones');
  ok(run.log.society.every(x => x.unrouted_count === 0), 'nothing a resident does is left unrouted any more');
  const regRun = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 3, population: 30, seed: 3,
                                          pool: livePool(fakeClient()), actions: 'registry' });
  ok(regRun.evidence.society.actions.mode === 'registry' && regRun.evidence.society.behaviours === null,
     'the old pattern list can still be forced, for comparison');
  const known = run.actions.interpretations;
  const pinned = await runAgentSociety({
    base: BASE, levers: LEVERS, team: 'alpha', rounds: 5, population: 48, substeps: 2, seed: 11,
    pool: createPool({ mode: 'replay', logPath }), constitution: CONSTITUTION, policyReviewEvery: 2,
    interpretations: known, interpretCache: null, interpretOverrides: null,
    director: { schedule: [{ round: 3, event: 'energy_crisis', severity: 1, teams: ['alpha'] }] }
  });
  ok(tracesAgree(pinned.trajectory, run.trajectory), 'a run replays exactly with its own interpretations, whatever the shared cache holds now');

  /* ------------------------------------------------------------------ */
  section('institutions: making a behaviour part of the country');
  const adopted = [
    { name: 'Tool Library', behaviour: 'starting a tool library', sector: 'retail_commerce', adoption: 'ease', budget_bn: 1, mandate: 'lend tools to anyone' },
    { name: 'Home Kitchens', behaviour: 'selling food from home', sector: 'food_agri', adoption: 'formalise' },
    { name: 'Repair Cafes', behaviour: 'running repair cafes', sector: 'housing_construction', adoption: 'fund', budget_bn: 0.8, mandate: 'a workshop in every block' },
    { name: 'Neighbour Watch', behaviour: 'helping neighbours', sector: 'care_services', adoption: 'endorse' },
    { name: '', sector: 'nowhere', adoption: 'fund' }
  ];
  const comp = INS.compile(adopted);
  ok(comp.items.length === 4, 'an institution with no name or no real industry cannot stand up');
  ok(comp.policies.some(p => p.type === 'institution' && p.name === 'Repair Cafes' && p.budget_bn === 0.8) &&
     comp.policies.some(p => p.type === 'provide' && p.budget_bn === 1) &&
     comp.policies.some(p => p.type === 'announce' && /Neighbour Watch/.test(p.text)),
     'funding and endorsement become policies the kernel and the people already understand');
  ok(comp.ease['starting a tool library'] < 1 && comp.formal['selling food from home'] === true,
     'easing lowers what the behaviour costs a person; licensing marks it as on the books');
  ok(INS.forPeople(comp.visible).some(t => /Tool Library.*costs you less/.test(t)), 'and people are told, in the team\'s own words');
  ok(INS.draftFrom({ label: 'selling food from home', what_it_did: ['informal_production:food_agri'], peak_share: 30 }).adoption === 'formalise' &&
     INS.draftFrom({ label: 'running a creche', what_it_did: ['time_to_sector:care_services'], peak_share: 10 }).adoption === 'fund',
     'the report suggests the adoption that fits what the behaviour does');

  /* The three that act on the world, measured against the same run without them. */
  const instTable = {
    'sell kueh | neighbours': INT.clean({ label: 'selling food from home', hours_per_week: 10, effects: [{ channel: 'informal_production', sector: 'food_agri', amount: 1 }] }, 'sell kueh | neighbours', 'model'),
    'lend tools | block': INT.clean({ label: 'starting a tool library', hours_per_week: 20, effects: [{ channel: 'time_to_sector', sector: 'retail_commerce', amount: 1 }] }, 'lend tools | block', 'model')
  };
  const iInterpret = a => instTable[INT.keyOf(a)] || null;
  const who = POP.buildPopulation(E.seed(BASE), { size: 60, seed: 5 }).personas.find(p => p.status === 'employed');
  const decision = acts => ({ decision: { spend_share: 0.6, work: 'keep', actions: acts, migrate: 'stay', family: 'none',
                                          trust_government: 5, belonging: 5, satisfaction: 5, feelings: {} }, source: 'model' });
  const runWith = (acts, extra) => R.aggregateOpen([who], { [who.id]: decision(acts) },
    Object.assign({ year: 2052, interpret: iInterpret, state: E.seed(BASE), week: 5 }, extra || {}));
  const kuehActs = [{ do: 'sell kueh', target: 'neighbours', intensity: 1 }];
  const plain = runWith(kuehActs);
  const licensed = runWith(kuehActs, { formal: comp.formal });
  ok(plain.exogenous.informal_share > 0 && !licensed.exogenous.informal_share &&
     licensed.exogenous.capacity.food_agri > 1,
     'once licensed, the same work still feeds people but no longer escapes tax',
     JSON.stringify({ before: plain.exogenous.informal_share, after: licensed.exogenous.informal_share || 0 }));
  const tools = [{ do: 'lend tools', target: 'block', intensity: 1 }];
  const hard = runWith(tools), easy = runWith(tools, { ease: comp.ease });
  ok(easy.exogenous.capacity.retail_commerce > hard.exogenous.capacity.retail_commerce,
     'making a behaviour easier lets one person do more of it with the hours they have');

  const seen = [];
  const watcher = fakeClient();
  const instRun = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 3, population: 30, seed: 8,
    pool: livePool(watcher), institutions: adopted });
  ok(watcher.prompts.some(p => /In your country there is:/.test(p) && /Repair Cafes \(paid for by the government\)/.test(p)),
     'residents are told what the team has institutionalised');
  ok(instRun.trace[1].levers.policies.some(p => p.type === 'institution' && p.name === 'Repair Cafes'),
     'and the funding reaches the kernel as a policy');
  ok(instRun.evidence.society.institutions.length === 4 &&
     instRun.evidence.society.institutions[0].adopted_as && instRun.evidence.society.institutions[0].spread_of_its_behaviour,
     'the report says what was adopted and what happened to the behaviour it came from');
  const noInst = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 2, population: 24, seed: 8, pool: livePool(fakeClient()) });
  ok(!noInst.institutions && noInst.evidence.society.institutions.length === 0, 'a team that adopted nothing is unchanged');

  section('a run is as long as the team wants');
  const long = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 20, population: 24, seed: 4, pool: livePool(fakeClient()) });
  ok(long.trajectory.length === 20 && long.trajectory[19].meta.year === 2088,
     'twenty rounds run to 2088, with no 2072 to stop at', long.trajectory[long.trajectory.length - 1].meta.year);
  ok(long.evidence.trajectory.length === 20 && long.log.society.length === 19, 'and the whole run is reported');
  let asked = 0;
  const stopped = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 30, population: 24, seed: 4,
    pool: livePool(fakeClient()), shouldStop: () => (++asked > 4) });
  ok(stopped.stopped && stopped.trajectory.length < 30 && stopped.evidence.trajectory.length === stopped.trajectory.length,
     'a run stopped early keeps the evidence for the years that ran', stopped.trajectory.length + ' rounds');

  /* ------------------------------------------------------------------ */
  section('never a rule in place of a decision');
  /* The fake model already answers badly now and then (prose instead of
     JSON, a dropped connection). Insisting must turn every one of those
     into a second ask, never into a rule. */
  const quick = { insist: true, backoffMs: 1, maxBackoffMs: 2, probeMs: 5 };
  const insisting = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 4, population: 40, seed: 7,
    pool: livePool(fakeClient(), quick) });
  ok(insisting.counts.citizen.fallback === 0 && insisting.counts.firm.fallback === 0,
     'with insist, no resident or firm decision is ever a fallback', JSON.stringify(insisting.counts));
  ok(insisting.waits.never_falls_back && insisting.waits.replies_asked_again > 0,
     'unusable replies were asked for again, and the report counts them', JSON.stringify(insisting.waits));
  ok(insisting.evidence.provenance.decided_by_agents_pct.overall === 100 && !insisting.evidence.provenance.degraded,
     'so the run is entirely decided by agents');
  const lenient = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 4, population: 40, seed: 7,
    pool: livePool(fakeClient()) });
  ok(lenient.counts.citizen.fallback > 0, 'the same model without insist does fall back, which is what it replaces');

  /* A server that goes away is waited for however long it takes. */
  let outages = 3;
  const flakyBase = fakeClient();
  const dropping = Object.assign({}, flakyBase, {
    json: async (m, o) => { if (outages > 0 && Math.random() < 2) { outages--; throw new Error('fetch failed'); } return flakyBase.json(m, o); },
    health: async () => { outages--; return { up: outages <= 0 }; }
  });
  const patient = livePool(dropping, Object.assign({ concurrency: 1 }, quick));
  const arrived = await patient.decide({ key: 'k1', system: 'You simulate one resident', user: 'You work in healthcare.', schema: d => ({ ok: !!d, value: d }) });
  ok(arrived.data && patient.stats.outages >= 1, 'a model server that drops is waited for, and the decision still arrives');

  /* A stop while waiting takes the unfinished year back out. */
  let asks = 0, stopNow = false;
  const stuckBase = fakeClient();
  const jammed = Object.assign({}, stuckBase, {
    json: async (m, o) => { asks++; if (asks > 150) { stopNow = true; return { data: null, text: 'no', invalid: 'never valid' }; } return stuckBase.json(m, o); }
  });
  const halted = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 12, population: 40, seed: 7,
    shouldStop: () => stopNow,
    pool: createPool(Object.assign({ mode: 'live', client: jammed, concurrency: 6, shouldStop: () => stopNow }, quick)) });
  ok(halted.stopped && /unfinished year/.test(halted.stopped) && halted.trajectory.length < 12,
     'stopping while the model is being waited for ends the run', halted.stopped);
  ok(halted.log.society.length === halted.trajectory.length - 1 && halted.trace.length === halted.trajectory.length,
     'and leaves no half-finished year in the evidence',
     halted.trajectory.length + ' years, ' + halted.log.society.length + ' society rows');
  ok(halted.counts.citizen.fallback === 0, 'still without a single fallback');

  /* Paused runs wait between years and say how long. */
  let onHold = true;
  setTimeout(() => { onHold = false; }, 400);
  const pausedRun = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 3, population: 24, seed: 2,
    shouldPause: () => onHold, pool: livePool(fakeClient(), quick) });
  ok(pausedRun.trajectory.length === 3 && pausedRun.waits.paused_s >= 0 && !pausedRun.stopped,
     'a paused run waits and then finishes every year');

  /* ------------------------------------------------------------------ */
  section('travelling light: a followed panel, not a transcript of everyone');
  const heavyLog = path.join(TMP, 'heavy.jsonl'), lightLog = path.join(TMP, 'light.jsonl');
  const heavyPool = createPool({ mode: 'record', client: fakeClient(), logPath: heavyLog, concurrency: 6 });
  const heavy = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 4, population: 60, seed: 5, pool: heavyPool });
  heavyPool.close();
  const lightPool = createPool({ mode: 'record', client: fakeClient(), logPath: lightLog, concurrency: 6 });
  const light = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 4, population: 60, seed: 5,
    pool: lightPool, fullLog: false, panel: 10 });
  lightPool.close();
  const linesIn = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length;
  ok(linesIn(lightLog) < linesIn(heavyLog) * 0.6 && fs.statSync(lightLog).size < fs.statSync(heavyLog).size * 0.6,
     'keeping only the panel\'s transcripts makes the decision log much smaller', linesIn(heavyLog) + ' lines -> ' + linesIn(lightLog));
  const pan = light.evidence.society.panel;
  /* A followed resident who emigrates stops being followed, so their record ends when they leave. */
  const leftNames = light.log.feed.filter(f => f.kind === 'departure').map(f => f.author);
  ok(pan && pan.members.length === 10 && pan.members.every(m => m.stands_for > 0 &&
       (m.years.length === 3 || (m.years.length >= 1 && leftNames.indexOf(m.name) >= 0))),
     'ten residents are followed for every year they are in the country, each standing for a known number of people');
  ok(pan.members.some(m => m.years.some(y => y.thinking && y.did)) && new Set(pan.members.map(m => m.status)).size > 1,
     'in their own words, and across different walks of life');
  ok(light.evidence.provenance.storage.replayable === false && light.evidence.provenance.storage.decisions_not_kept > 0 &&
     heavy.evidence.provenance.storage.replayable === true,
     'the report says which runs can be replayed exactly and which cannot');
  const sameSeed = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', rounds: 2, population: 60, seed: 5,
    pool: livePool(fakeClient()), fullLog: false, panel: 10 });
  ok(JSON.stringify(pan.members.map(m => m.id)) === JSON.stringify(sameSeed.evidence.society.panel.members.map(m => m.id)),
     'the same seed follows the same people');
  const gz = heavyLog + '.gz';
  fs.writeFileSync(gz, require('zlib').gzipSync(fs.readFileSync(heavyLog)));
  const fromGz = createPool({ mode: 'replay', logPath: gz });
  ok((await fromGz.health()).up && fs.statSync(gz).size < fs.statSync(heavyLog).size / 3,
     'a full log compresses, and replays from the compressed file');

  /* ------------------------------------------------------------------ */
  section('ticks: a society that runs by the month');
  const tickClient = fakeClient();
  const tickLog = path.join(TMP, 'tick.jsonl');
  const tickPool = createPool({ mode: 'record', client: tickClient, logPath: tickLog, concurrency: 6 });
  const monthly = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 3, population: 40, seed: 9,
    pool: tickPool, director: { schedule: [{ round: 8, event: 'typhoon', severity: 1 }] } });
  tickPool.close();
  const TT = monthly.trajectory;
  ok(TT.length === 37 && TT[36].meta.year === 2053 && TT[36].meta.month === 1 && TT[5].meta.tick === 5,
     'three years is thirty-six ticks, each a month', TT.length - 1 + ' ticks, ending ' + TT[36].meta.year + '-' + TT[36].meta.month);
  ok(monthly.log.society.length === 12 && monthly.log.industry.length === 12,
     'people and firms decide every three months, not every month', monthly.log.society.length + ' decisions in 36 ticks');
  ok(tickClient.prompts.every(p => /Decide now, for the next 3 months\./.test(p)) &&
     tickClient.prompts.every(p => !/two years/.test(p.split('People you know')[0])),
     'and are asked about the three months ahead, never "two years"');
  ok(monthly.trace.length === 37 && monthly.trace[1].dt === 1 / 12 && tracesAgree(replayKernel(BASE, monthly.trace), TT),
     'the trace replays the kernel exactly, tick for tick');
  ok(monthly.evidence.trajectory.length === 4 && monthly.evidence.trajectory.map(r => r.year).join() === '2050,2051,2052,2053',
     'the report reads the country once a year, however fine the ticks');
  ok(monthly.evidence.provenance.time.tick_months === 1 && monthly.evidence.provenance.time.residents_decide_every === '3 months',
     'and says how time was cut', JSON.stringify(monthly.evidence.provenance.time));
  const typhoonTicks = monthly.trace.filter(t => (t.shocks || []).some(x => x.label === 'Typhoon')).map(t => t.round - 1);
  ok(typhoonTicks.length === 2 && typhoonTicks[1] === typhoonTicks[0] + 1, 'an event lasts its own number of months: a typhoon, two', typhoonTicks.join());
  ok(monthly.evidence.events.some(e => e.label === 'Typhoon' && e.year === 2050), 'and is dated to the year it struck');
  const views = [];
  await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 1, population: 30, seed: 9,
    pool: livePool(fakeClient()), onProgress: e => { if (e.type === 'round') views.push(e.view); } });
  ok(views.length === 12 && views.filter(v => v.people).length === 4 && views[2].people && !views[0].people && views[0].month === 2,
     'the map is sent new dots only on the ticks where people decided', views.map(v => (v.people ? 'P' : '.')).join(''));

  /* Held between decisions; one-off things happen once. */
  const exoOf = t => t.exogenous || {};
  ok(JSON.stringify(exoOf(monthly.trace[5]).households) === JSON.stringify(exoOf(monthly.trace[6]).households) &&
     exoOf(monthly.trace[4]).households != null,
     'what people chose holds until they choose again');
  const leavers = monthly.trace.map(t => (exoOf(t).demography || {}).emigration || 0);
  ok(leavers.filter(x => x > 0).length <= monthly.log.society.length && leavers.every((x, i) => !x || (i - 1) % 3 === 0 || i % 3 === 1),
     'people who leave are counted on one tick, not on every tick until the next decision',
     leavers.filter(x => x > 0).length + ' ticks carried departures');

  /* Replay, including the decision log. */
  const tickReplay = createPool({ mode: 'replay', logPath: tickLog });
  const monthlyAgain = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 3, population: 40, seed: 9,
    pool: tickReplay, director: { schedule: [{ round: 8, event: 'typhoon', severity: 1 }] } });
  ok(tracesAgree(monthlyAgain.trajectory, TT) && tickReplay.stats.missing === 0,
     'a tick run replays exactly from its decision log', JSON.stringify(tickReplay.stats));

  /* Cadence is a setting. */
  const eager = fakeClient();
  await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 1, population: 30, seed: 9,
    pool: livePool(eager), every: { residents: 1, firms: 6, government: 1 } });
  const lazy = fakeClient();
  await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 1, population: 30, seed: 9,
    pool: livePool(lazy), every: { residents: 6, firms: 6, government: 1 } });
  ok(eager.prompts.length > lazy.prompts.length * 4 && eager.prompts.every(p => /for the next month\./.test(p)),
     'residents can be asked every month or every six; the cost follows', eager.prompts.length + ' vs ' + lazy.prompts.length);

  /* Live pacing holds a tick to the clock. */
  const t0 = Date.now();
  const paced = await runAgentSociety({ base: BASE, levers: LEVERS, dt: 1 / 12, years: 0.5, population: 24, seed: 2,
    pool: livePool(fakeClient()), tickMs: 60 });
  const took = Date.now() - t0;
  ok(took >= 6 * 60 - 40 && paced.time.paced_ms_per_tick === 60, 'with a tick length set, six ticks take six ticks of real time', took + ' ms');

  /* ------------------------------------------------------------------ */
  section('distribution: paying people for what they do');
  const creditScheme = { name: 'Community Credit', earns: { time: true, sectors: ['care_services', 'education_research'], ties: false },
                   credits_per_hour: 1, sgd_per_credit: 10, cap_credits_month: 20, funding: 'payment' };
  const schemeList = DIST.validateAll([creditScheme, { name: '' }, { name: 'Nothing', earns: { time: false } }]);
  ok(schemeList.length === 1 && schemeList[0].funding === 'payment', 'a scheme needs a name and something that earns it');
  const careTime = INT.clean({ label: 'visiting the elderly', hours_per_week: 4, effects: [{ channel: 'time_to_sector', sector: 'care_services', amount: 1 }] }, 'visit | elderly', 'model');
  const roadTime = INT.clean({ label: 'filling potholes', hours_per_week: 4, effects: [{ channel: 'time_to_sector', sector: 'transport_logistics', amount: 1 }] }, 'fill | potholes', 'model');
  ok(DIST.qualifies(careTime, schemeList[0]) && !DIST.qualifies(roadTime, schemeList[0]), 'it rewards the industries the team named, and only those');
  ok(DIST.payout(schemeList[0], 4).sgd_month === 173 && DIST.payout(schemeList[0], 40).sgd_month === 200,
     'an hour a week is about four hours a month; the cap holds', DIST.payout(schemeList[0], 4).sgd_month + ', ' + DIST.payout(schemeList[0], 40).sgd_month);
  ok(/Community Credit: you earn it by giving your time to care services or education/.test(DIST.describe(schemeList[0])) &&
     /same pot as the monthly payment/.test(DIST.describe(schemeList[0])), 'and is explained to people in plain terms', DIST.describe(schemeList[0]));

  const dTable = { 'visit | elderly': careTime, 'fill | potholes': roadTime };
  const dPeople = POP.buildPopulation(E.seed(BASE), { size: 60, seed: 5 }).personas;
  const giver = dPeople.find(p => p.status === 'retired'), bystander = dPeople.find(p => p.status === 'employed');
  const dDecide = acts => ({ decision: { spend_share: 0.6, work: 'keep', actions: acts, migrate: 'stay', family: 'none',
                                         trust_government: 5, belonging: 5, satisfaction: 5, feelings: {} }, source: 'model' });
  const dAgg = (schemesIn) => R.aggregateOpen([giver, bystander],
    { [giver.id]: dDecide([{ do: 'visit', target: 'elderly', intensity: 1 }]), [bystander.id]: dDecide([{ do: 'fill', target: 'potholes', intensity: 1 }]) },
    { year: 2052, interpret: a => dTable[INT.keyOf(a)] || null, state: E.seed(BASE), week: 5, schemes: schemesIn });
  const paidOut = dAgg(schemeList);
  ok(paidOut.earnings[giver.id] && paidOut.earnings[giver.id][0].sgd_month === 173 && !paidOut.earnings[bystander.id],
     'the person who did the rewarded thing earns; the person who did something else does not');
  ok(paidOut.exogenous.distribution.paid_bn > 0 && paidOut.exogenous.distribution.from_ubi_bn === paidOut.exogenous.distribution.paid_bn,
     'and the bill reaches the kernel, marked as coming out of the payment', JSON.stringify(paidOut.exogenous.distribution));
  ok(dAgg(DIST.validateAll([Object.assign({}, creditScheme, { funding: 'budget' })])).exogenous.distribution.from_ubi_bn === 0,
     'or as new money, if the team chose that');
  ok(!dAgg([]).exogenous.distribution, 'with no scheme there is no bill');
  ok(paidOut.schemes[0].taking_part_pct > 0 && paidOut.schemes[0].who[0].status === 'retired', 'the report can say who took part');

  const dClient = fakeClient();
  const dRun = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 2, population: 40, seed: 12,
    pool: livePool(dClient), distribution: [Object.assign({}, creditScheme, { earns: { time: true, sectors: 'all' } })] });
  ok(dClient.prompts.every(p => /Beyond the monthly payment, you can also earn:\n- Community Credit/.test(p)),
     'in a run, every resident is told the scheme exists');
  ok(dClient.prompts.some(p => /Last time you earned about S\$\d+ a month in Community Credit/.test(p)),
     'and those who earned are told what they earned');
  const dEv = dRun.evidence.society.distribution;
  ok(dEv && dEv.by_decision.length === 8 && dEv.by_decision.some(d => d.paid_bn_year > 0) && dEv.schemes[0].name === 'Community Credit',
     'the evidence follows the scheme decision by decision', dEv && dEv.by_decision.map(d => d.paid_bn_year).join(' '));
  ok(dRun.trace.some(t => t.exogenous && t.exogenous.distribution && t.exogenous.distribution.paid_bn > 0) &&
     dRun.trajectory.some(st => st._distribution_bn && st._distribution_bn.paid > 0),
     'and the money actually moves in the kernel');

  /* ------------------------------------------------------------------ */
  section('amending a run that is under way');
  const newLevers = JSON.parse(JSON.stringify(LEVERS)); newLevers.corporate_tax_rate = 0.33; newLevers.care_job_guarantee = true;
  const amendChange = { version: 7, note: 'services were failing', levers: newLevers,
                   government: { kind: 'rules', rules: [{ when: 'year >= 2050', then: [{ verb: 'nudge', target: 'reskilling_spend_pct', amount: 0.001 }] }] },
                   distribution: [creditScheme],
                   institutions: [{ name: 'Repair Cafes', behaviour: 'running repair cafes', sector: 'housing_construction', adoption: 'fund', budget_bn: 0.5 }] };
  let amendHanded = false;
  const aLog = path.join(TMP, 'amend.jsonl');
  const aPool = createPool({ mode: 'record', client: fakeClient(), logPath: aLog, concurrency: 6 });
  const amendEvents = [];
  const aRun = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 2, population: 40, seed: 13, pool: aPool,
    onProgress: e => { amendEvents.push(e.type); },
    takeAmendment: () => { if (!amendHanded && aRunTick() >= 10) { amendHanded = true; return amendChange; } return null; } });
  function aRunTick() { return amendEvents.filter(t => t === 'round').length + 1; }
  aPool.close();
  const amendRec = aRun.evidence.government.amendments;
  ok(amendRec.length === 1 && amendRec[0].version === 7 && amendRec[0].year === 2050 && amendRec[0].month >= 10 &&
     ['economy', 'government', 'institutions', 'distribution'].every(x => amendRec[0].changed.indexOf(x) >= 0),
     'the amendment is recorded with its date and what it touched', JSON.stringify(amendRec[0] && { y: amendRec[0].year, m: amendRec[0].month, c: amendRec[0].changed }));
  const amendAt = amendRec[0].step;
  ok(aRun.trace[amendAt - 2].levers.corporate_tax_rate === LEVERS.corporate_tax_rate && aRun.trace[amendAt - 1].levers.corporate_tax_rate >= 0.33 &&
     aRun.trace[amendAt - 1].levers.care_job_guarantee === true,
     'the new levers take effect from that month, and not before', aRun.trace[amendAt - 2].levers.corporate_tax_rate + ' -> ' + aRun.trace[amendAt - 1].levers.corporate_tax_rate);
  ok(aRun.trace.length === 25 && aRun.trajectory.length === 25, 'and the run carries on to the end from where it was');
  ok(aRun.evidence.government.kind === 'rules' && aRun.government.rounds.some(g => g.round >= amendAt && g.fired.length),
     'a government brought in mid-run governs from then on');
  ok(aRun.trace[amendAt - 1].levers.policies.some(p => p.name === 'Repair Cafes') && !aRun.trace[amendAt - 2].levers.policies.some(p => p.name === 'Repair Cafes'),
     'an institution adopted mid-run is funded from then on');
  ok(aRun.evidence.society.distribution && aRun.log.distribution.every(d => d.round >= amendAt),
     'and a scheme introduced mid-run pays from then on, never before');
  ok(amendEvents.indexOf('amended') >= 0, 'the page is told when it happened');

  const aAgain = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 2, population: 40, seed: 13,
    pool: createPool({ mode: 'replay', logPath: aLog }), amendments: aRun.amendment_inputs });
  ok(tracesAgree(aAgain.trajectory, aRun.trajectory) && aAgain.evidence.government.amendments.length === 1,
     'an amended run replays exactly, amendment and all');
  const leftAlone = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 2, population: 40, seed: 13,
    pool: livePool(fakeClient()) });
  ok(leftAlone.trajectory[24].levers.corporate_tax_rate !== aRun.trajectory[24].levers.corporate_tax_rate && leftAlone.evidence.government.amendments.length === 0,
     'and differs from the same run left alone, which is the comparison a recovery is judged by');

  /* ------------------------------------------------------------------ */
  section('stop means now');
  /* A model that takes time to answer, one call at a time, as on a laptop.
     A whole month of residents is queued behind the call in flight. */
  const slowBase = fakeClient();
  let slowCalls = 0, callsAtStop = null, pressed = false;
  const slow = Object.assign({}, slowBase, {
    json: async (m, o) => { slowCalls++; await new Promise(r => setTimeout(r, 25)); return slowBase.json(m, o); }
  });
  const pressAt = Date.now() + 400;
  const pressStop = () => { if (!pressed && Date.now() >= pressAt) { pressed = true; callsAtStop = slowCalls; } return pressed; };
  const stopT0 = Date.now();
  const stoppedFast = await runAgentSociety({ base: BASE, levers: LEVERS, team: 'alpha', dt: 1 / 12, years: 5, population: 60, seed: 4,
    every: { residents: 1, firms: 1, government: 1 }, shouldStop: pressStop,
    pool: createPool({ mode: 'live', client: slow, concurrency: 1, insist: true, shouldStop: pressStop, backoffMs: 1, maxBackoffMs: 2 }) });
  const stopTook = Date.now() - pressAt;
  await new Promise(r => setTimeout(r, 150));          // anything still queued would run now
  ok(stoppedFast.stopped && stopTook < 300,
     'a stop pressed mid-month ends the run within a call or two, not after the whole queue', stopTook + ' ms after the press');
  ok(slowCalls - callsAtStop <= 2,
     'and the calls that were queued behind it are never made', (slowCalls - callsAtStop) + ' calls after the press, of about 100 queued');
  ok(stoppedFast.trajectory.length >= 1 && stoppedFast.log.society.length === stoppedFast.trajectory.length - 1 &&
     stoppedFast.evidence.trajectory.length >= 1,
     'the report still covers every month that finished', (stoppedFast.trajectory.length - 1) + ' months kept');

  section('degraded runs say so');
  const noModel = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 3, population: 30, seed: 2 });
  ok(noModel.evidence.provenance.degraded && /no model/.test(noModel.evidence.provenance.degraded_reason),
     'a run with no model is labelled degraded');

  section('ensembles');
  const ens = await runEnsemble({ base: BASE, levers: LEVERS, rounds: 3, population: 30 },
                                { seeds: [1, 2, 3], makePool: () => livePool(fakeClient()) });
  const d = ens.distributions.final_employment_rate;
  ok(ens.runs.length === 3 && d.median != null && d.p10 <= d.median && d.median <= d.p90, 'seeds give a distribution', JSON.stringify(d));

  /* ------------------------------------------------------------------ */
  section('calibration');
  const good = await CAL.runSuite(livePool(fakeClient({ model: 'fake-good' })), { save: false });
  ok(good.passed, 'a model with human-shaped behaviour passes', JSON.stringify(good.checks.map(c => c.name + ':' + c.passed)));
  const docile = await CAL.runSuite(livePool(fakeClient({ model: 'fake-docile', docile: true })), { save: false });
  ok(!docile.passed && !docile.checks.find(c => c.name === 'grievance').passed, 'a docile model fails, and grievance is why');
  let refused = null;
  try {
    await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 2, population: 24, pool: livePool(fakeClient({ model: 'never-calibrated' })), assessed: true });
  } catch (e) { refused = e.message; }
  ok(refused && /not passed behavioural calibration/.test(refused), 'an assessed run refuses an uncalibrated model');
  const overridden = await runAgentSociety({ base: BASE, levers: LEVERS, rounds: 2, population: 24,
    pool: livePool(fakeClient({ model: 'never-calibrated' })), assessed: true, allowUncalibrated: true });
  ok(overridden.evidence.provenance.uncalibrated_override === true, 'and an override is written into the evidence');

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
