/* =====================================================================
   THE PERSONA POPULATION
   ---------------------------------------------------------------------
   5.9 million people cannot each be an LLM agent, and twelve cohorts is
   too coarse for anything to emerge. The answer is a WEIGHTED sample:
   a few hundred to a few thousand adults, each standing for however many
   residents share their situation, stratified so the weights reproduce
   the country the engine carries — its age bands exactly, and its
   workforce sector by sector.

   Children are not agents. They are counted inside the households of
   the adults who decide on their behalf, which is also how it works.

   Every attribute is a circumstance, never an opinion. No persona is
   written as a militant or a loyalist: what they do comes from what they
   live through, filtered through temperament.

   WHERE THE NUMBERS COME FROM
   ---------------------------------------------------------------------
   Two layers, and they are kept apart.

   THE SCENARIO sets how many people there are: the size of each age band
   and the headcount of each industry come from the engine's state, which
   is a brief about 2050 and not a measurement. Those are reproduced
   exactly, as before.

   SINGAPORE'S PUBLISHED STATISTICS set who those people are. Every share
   below is read from population-data.json, which data/singstat/build.py
   compiles from tables of the Department of Statistics (Population
   Trends 2026, General Household Survey 2025) and the Ministry of
   Manpower (Labour Force in Singapore 2025). The file names every table.
   So the people are today's Singaporeans placed in the scenario's
   economy: nobody has published who lives in a 2050 that has not
   happened.

     age                 ages of workers in each industry; ages of people
                         not working, by why; ages of residents over 65
     ethnicity           by age
     type of home        by age
     income position     by type of home, and for workers by industry too
     region              by type of home
     who they live with  by age, and how many children
     health              by age (difficulty with basic activities)
     working at 65+      by age
     not working, 20-64  studying, caring, retired early, not working,
                         looking for work

   STILL MODELLED, because no official table measures them: how many
   months savings would last, how able someone is to leave the country,
   and temperament. Names are short lists, not statistics.

   TWO ASSUMPTIONS made in joining tables that are published separately.
   Income position is drawn from the table for the person's home and, for
   a worker, tilted by the table for their industry, as if the two were
   independent once income is known. And each published table of
   households is read as describing the people in them.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const { rng, derive } = require('./rng.js');
const D = require('./population-data.json');

const NAMES = {
  chinese: { given: ['Wei Ling', 'Jun Hao', 'Mei Xin', 'Kok Leong', 'Hui Min', 'Zhi Wei', 'Siew Lan',
                     'Boon Keng', 'Li Ting', 'Chee Meng', 'Xin Yi', 'Ah Kow', 'Pei Shan', 'Yong Sheng'],
             family: ['Tan', 'Lim', 'Lee', 'Ng', 'Ong', 'Wong', 'Goh', 'Chua', 'Chan', 'Koh', 'Teo', 'Ang'] },
  malay:   { given: ['Nur Aisyah', 'Muhammad Faris', 'Siti Nurhaliza', 'Ahmad Rizal', 'Farah Hanim',
                     'Hafiz', 'Zulaikha', 'Iskandar', 'Rosnah', 'Khairul'],
             family: ['bin Ismail', 'binte Rahman', 'bin Osman', 'binte Yusof', 'bin Salleh', 'binte Hamid'] },
  indian:  { given: ['Priya', 'Arjun', 'Kavitha', 'Suresh', 'Deepa', 'Ravi', 'Meena', 'Vikram', 'Lakshmi', 'Ganesh'],
             family: ['Nair', 'Pillai', 'Rajan', 'Menon', 'Singh', 'Kumar', 'Subramaniam', 'Krishnan'] },
  other:   { given: ['Maria', 'Daniel', 'Grace', 'Joshua', 'Aiko', 'Nadia', 'Marcus', 'Isabel'],
             family: ['Santos', 'Fernandez', 'de Souza', 'Tanaka', 'Rahimi', 'Aquino', 'Pereira'] }
};

const HOUSING_LABEL = { hdb_1_2: 'a 1- or 2-room HDB flat', hdb_3: 'a 3-room HDB flat', hdb_4: 'a 4-room HDB flat',
                        hdb_5: 'a 5-room or executive HDB flat', condo: 'a condominium', landed: 'a landed house' };

/* People who are not in paid work between 20 and 64, by why. */
const NOT_EMPLOYED = Object.keys(D.not_employed);

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
const sum = t => Object.keys(t).reduce((a, k) => a + t[k], 0);

/* The published tables cut age into bands, and not always the same ones. */
function band5(age) { return age >= 90 ? '90+' : (Math.floor(age / 5) * 5) + '-' + (Math.floor(age / 5) * 5 + 4); }
function bandHousehold(age) { return age < 25 ? '<25' : age < 35 ? '25-34' : age < 50 ? '35-49' : age < 65 ? '50-64' : '65+'; }
function bandHealth(age) { return age < 25 ? '<25' : age < 45 ? '25-44' : age < 65 ? '45-64' : '65+'; }
function bandChildren(age) { return age < 30 ? '15-29' : age < 40 ? '30-39' : age < 50 ? '40-49' : '50+'; }
/** A year of age inside a band such as '30-39' or '90+', every year equally likely. */
function ageIn(r, band) {
  if (band === '90+') return r.int(90, 96);
  const p = band.split('-');
  return r.int(Number(p[0]), Number(p[1]));
}

/**
 * buildPopulation(state, { size, seed })
 *   -> { personas: [...], totals: { adults, working_age, elderly, by_sector } }
 *
 * The weights of the working-age personas employed in sector k sum to that
 * sector's headcount; the weights of each age band sum to its population.
 */
function buildPopulation(state, opts) {
  opts = opts || {};
  const size = Math.max(24, opts.size || 200);
  const r = rng(derive(opts.seed == null ? 1 : opts.seed, 'population'));
  const pop = state.population;
  const adults = pop.by_age.age_20_64 + pop.by_age.age_65_plus;

  const nElder = Math.max(4, Math.round(size * pop.by_age.age_65_plus / adults));
  const nWork = size - nElder;

  /* Working-age statuses, sampled in exact proportion: employed by sector
     by headcount, and the rest split by why they are not working, in the
     proportions the Ministry of Manpower found. Allocated by largest
     remainder so the counts sum to nWork and every sector with a
     meaningful workforce is present. */
  const employed = pop.employed_total;
  const notEmployed = Math.max(0, pop.by_age.age_20_64 - employed);
  const strata = {};
  E.ORDER.forEach(k => { strata['work:' + k] = state.sectors[k].headcount; });
  const whyTotal = NOT_EMPLOYED.reduce((a, s) => a + sum(D.not_employed[s]), 0);
  NOT_EMPLOYED.forEach(s => { strata[s] = notEmployed * sum(D.not_employed[s]) / whyTotal; });
  const counts = largestRemainder(strata, nWork);
  /* A small sample cannot hold every kind of non-worker. The people a
     missing kind stood for are carried by the kinds that are present, so
     the working-age band still sums to what the engine says it is. */
  const held = NOT_EMPLOYED.filter(s => counts[s] > 0).reduce((a, s) => a + strata[s], 0);
  if (held > 0) NOT_EMPLOYED.forEach(s => { strata[s] = counts[s] > 0 ? strata[s] * notEmployed / held : 0; });
  /* Weight per persona in each stratum, so the stratum's population is
     reproduced exactly however few personas represent it. */
  const stratumWeight = {};
  Object.keys(strata).forEach(s => { stratumWeight[s] = counts[s] ? strata[s] / counts[s] : 0; });

  const personas = [];
  let seq = 0;
  const nextId = () => 'P' + String(++seq).padStart(4, '0');

  Object.keys(counts).forEach(s => {
    for (let i = 0; i < counts[s]; i++) {
      const sector = s.indexOf('work:') === 0 ? s.slice(5) : null;
      const status = sector ? 'employed' : s;
      /* How old: workers by the ages of their industry's workforce,
         everyone else by the ages of people not working for that reason. */
      const age = ageIn(r, r.weighted(sector ? D.age_by_sector[sector] : D.not_employed[s]));
      personas.push(makePersona(nextId(), r, { age, status, sector, weight: stratumWeight[s] }));
    }
  });

  /* Older workers go to industries in the proportions older workers are
     found in them today. Where the scenario splits one published industry
     into several, they are shared by headcount. */
  const elderSectors = {};
  E.ORDER.forEach(k => {
    const same = E.ORDER.filter(j => String(D.meta.industry_of[j]) === String(D.meta.industry_of[k]));
    const together = same.reduce((a, j) => a + state.sectors[j].headcount, 0);
    elderSectors[k] = together > 0 ? D.elder_by_sector[k] * state.sectors[k].headcount / together : 0;
  });
  const elderWeight = pop.by_age.age_65_plus / nElder;
  for (let i = 0; i < nElder; i++) {
    const band = r.weighted(D.elder_ages);
    const age = ageIn(r, band);
    const stillWorking = r() < D.elder_employment[band === '65-69' ? '65-69' : '70+'];
    const sector = stillWorking ? r.weighted(elderSectors) : null;
    personas.push(makePersona(nextId(), r, {
      age, status: stillWorking ? 'employed' : 'retired', sector, weight: elderWeight, elder: true
    }));
  }

  assignExposure(personas, pop.by_exposure, r);
  return { personas: personas, totals: totalsOf(personas) };
}

function largestRemainder(table, n) {
  const keys = Object.keys(table);
  const total = keys.reduce((a, k) => a + table[k], 0) || 1;
  const raw = keys.map(k => ({ k, exact: table[k] / total * n }));
  const out = {};
  let used = 0;
  raw.forEach(x => { out[x.k] = Math.floor(x.exact); used += out[x.k]; });
  raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; used < n; i = (i + 1) % raw.length) { out[raw[i].k]++; used++; }
  return out;
}

/** Where someone sits in the income distribution, 1 (lowest tenth) to 10. */
function decileFor(r, housing, sector) {
  const home = D.decile_by_dwelling[housing], work = sector ? D.decile_by_sector[sector] : null;
  const t = {};
  for (let j = 0; j < 10; j++) t[j + 1] = home[j] * (work ? work[j] / 0.1 : 1);
  return Number(r.weighted(t));
}

function makePersona(id, r, o) {
  const ethnicity = r.weighted(D.ethnicity_by_age[band5(o.age)]);
  const pool = NAMES[ethnicity];
  const given = r.pick(pool.given), family = r.pick(pool.family);
  const name = ethnicity === 'chinese' ? family + ' ' + given : given + ' ' + family;

  const housing = r.weighted(D.dwelling_by_age[band5(o.age)]);
  const decile = decileFor(r, housing, o.status === 'employed' ? o.sector : null);
  const region = r.weighted(D.region_by_dwelling[housing]);

  /* Who they live with. The survey counts any child in the household,
     grown or not, so for someone over 65 "with children" means adult
     children, and nobody is counted as their dependant. */
  let household = r.weighted(D.household_by_age[bandHousehold(o.age)]);
  let children = 0;
  if (o.age >= 65) {
    household = { couple_with_children: 'with_spouse_and_adult_children', single_parent: 'with_adult_children',
                  couple: 'with_spouse' }[household] || household;
  } else if (/children|single_parent|multigenerational/.test(household)) {
    children = Number(r.weighted(D.children_by_age[bandChildren(o.age)]));
  }

  /* Health here is whether someone has difficulty with basic activities
     (seeing, hearing, walking, remembering, self-care, communicating):
     none is good, some is fair, a lot is poor. */
  const health = r.weighted(D.health_by_age[bandHealth(o.age)]);

  /* MODELLED, not measured. Could this person realistically leave? Young,
     skilled, well-paid people can; most elderly people and low earners
     cannot. And how long their savings would last. */
  const mobility = clamp((o.elder ? 0.05 : 0.15) + (decile - 1) * 0.07 + (o.age < 40 ? 0.15 : 0) +
                         (r() - 0.5) * 0.15, 0.02, 0.95);
  const savingsMonths = clamp(Math.round(r.normal(decile * 2.2, 3)), 0, 60);

  return {
    id: id, name: name, age: o.age, ethnicity: ethnicity, region: region,
    status: o.status, sector: o.sector || null, income_decile: decile,
    housing: housing, housing_label: HOUSING_LABEL[housing], household: household, children: children,
    health: health, mobility: Math.round(mobility * 100) / 100, savings_months: savingsMonths,
    /* Temperament, 1-5. MODELLED: every value equally likely, the five
       independent of each other and of everything else about the person.
       Shapes HOW someone responds, never WHAT they believe: anxious people
       fear sooner, agreeable people cooperate sooner, open people try new
       things sooner. */
    traits: {
      openness: r.int(1, 5), conscientiousness: r.int(1, 5), extraversion: r.int(1, 5),
      agreeableness: r.int(1, 5), neuroticism: r.int(1, 5)
    },
    exposure: 'low',
    weight: o.weight,
    departed: false
  };
}

/* Exposure bands go to employed people in the most automatable sectors
   first, so the high band lands where automation actually threatens. */
function assignExposure(personas, byExposure, r) {
  const working = personas.filter(p => p.status === 'employed');
  const totalW = working.reduce((a, p) => a + p.weight, 0) || 1;
  const bandTotal = (byExposure.high + byExposure.medium + byExposure.low) || 1;
  const highShare = byExposure.high / bandTotal, medShare = byExposure.medium / bandTotal;
  const risk = p => {
    const c = E.SECTORS[p.sector];
    return (1 - c.human_touch) * 0.7 + (1 - Math.min(1, p.income_decile / 10)) * 0.3 + r() * 0.2;
  };
  const ranked = working.map(p => ({ p, v: risk(p) })).sort((a, b) => b.v - a.v);
  let acc = 0;
  ranked.forEach(x => {
    const frac = acc / totalW;
    x.p.exposure = frac < highShare ? 'high' : (frac < highShare + medShare ? 'medium' : 'low');
    acc += x.p.weight;
  });
}

function totalsOf(personas) {
  const t = { adults: 0, working_age: 0, elderly: 0, employed: 0, by_sector: {} };
  personas.forEach(p => {
    if (p.departed) return;
    t.adults += p.weight;
    if (p.age >= 65) t.elderly += p.weight; else t.working_age += p.weight;
    if (p.status === 'employed') {
      t.employed += p.weight;
      t.by_sector[p.sector] = (t.by_sector[p.sector] || 0) + p.weight;
    }
  });
  return t;
}

/** Relative household income, for weighting spending decisions. */
function incomeWeight(p) { return 0.35 + p.income_decile * 0.25; }

module.exports = { buildPopulation, totalsOf, incomeWeight, largestRemainder, HOUSING_LABEL, SOURCES: D.meta };
