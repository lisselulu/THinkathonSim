/* =====================================================================
   THE ACTION INTERPRETER: WHAT AN UNFORESEEN ACTION DOES
   ---------------------------------------------------------------------
   Residents decide in their own words. Until this file, those words were
   matched against a fixed list of about fifteen patterns, and anything the
   list did not foresee was written down and ignored. That made the society
   incapable of surprising anyone: it could only do what its author had
   already thought of.

   Now every action goes to an interpreter that answers one question:
   what does this action, done by one ordinary person, actually DO in the
   world? The answer is expressed in a small, fixed vocabulary of effects
   (below). The vocabulary is fixed because the kernel is: an effect has to
   be something the arithmetic can compute. The ACTIONS are not fixed.
   Anything a person can describe can be interpreted into these effects,
   including behaviour nobody anticipated.

   THREE RULES KEEP IT HONEST

   Blind.   The interpreter sees the action's words and nothing else: no
            team, no levers, no constitution, no country. The same words
            mean the same thing in every team's world.

   Once.    An action is interpreted once per TEAM, by its words, and the
            answer is cached in that team's own file. What a country
            invents stays in that country: no team's run ever reads another
            team's interpretations. Replays are exact.

   Common.  Every team starts from the same STARTER DICTIONARY of ordinary
            actions (work, strike, volunteer, protest, sell, join), built
            once before the event. So the everyday vocabulary means the
            same thing in every world, and only what a team's own people
            invent beyond it is private to them.

   Bounded. The interpreter says what an action COSTS (hours a week,
            money, savings, whether you need a job) as well as what it
            does. The router then charges that cost against each person's
            real circumstances, so nobody creates value from nothing.

   Organisers can override any interpretation; overrides always win and
   are recorded as such in the report.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../engine/meridian-engine.js');

/* THE EFFECTS VOCABULARY. What the world can compute. Each entry says what
   the effect means, whether it names a sector, and which direction the
   amount runs. The router turns these into kernel channels. */
const CHANNELS = {
  time_to_sector: { sector: true, what: 'unpaid time given to work that a sector does (caring, teaching, cooking, repairs, cleaning)' },
  informal_production: { sector: true, what: 'paid work, trade or production outside the formal economy, off the books and untaxed' },
  labour_withheld: { sector: false, what: 'refusing to do their own paid job (strike, walkout, go-slow, sick-out)' },
  labour_supply: { sector: false, what: 'doing more (+) or less (-) formal paid work' },
  spending: { sector: false, what: 'spending more (+) or saving more (-) of their income' },
  demand_shift: { sector: true, what: 'moving their custom toward (+) or away from (-) a sector' },
  harm: { sector: true, what: 'damaging or disrupting what a sector can do (sabotage, blockade, looting)' },
  unrest: { sector: false, what: 'visible collective disruption (protest, occupation, march, riot)' },
  legitimacy: { sector: false, what: 'raising (+) or lowering (-) the standing of the government' },
  cohesion: { sector: false, what: 'strengthening (+) or weakening (-) ties between people' },
  organise: { sector: false, what: 'joining or founding a group, club, union, co-op or network' },
  found_business: { sector: true, what: 'starting a registered business' }
};

const HEALTH = ['poor', 'fair', 'good'];
const BATCH = 12;

/* ---------------------------------------------------------------------
   KEYS
   An action is identified by its words, lower-cased and tidied, so
   "Help neighbours | Block 42" and "help neighbours | block 42" are one.
   --------------------------------------------------------------------- */
function keyOf(a) {
  const text = (String(a.do || a.action || '') + ' | ' + String(a.target || ''))
    .toLowerCase().replace(/_/g, ' ').replace(/[^a-z0-9|&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.replace(/\s*\|\s*$/, '').slice(0, 160);
}

/* ---------------------------------------------------------------------
   SECTORS, READ LOOSELY
   The model writes "care", "Healthcare", "food & agri", "hawker stalls".
   --------------------------------------------------------------------- */
const SECTOR_WORDS = [
  ['care_services', /\b(care services|care home|elder|aged care|childcare|child care|carer|caring|care)\b/],
  ['healthcare', /\b(health|hospital|clinic|polyclinic|medical|nurs|doctor|medicine)/],
  ['education_research', /\b(educat|school|teach|tutor|research|universit|library|learning)/],
  ['transport_logistics', /\b(transport|logistic|bus|mrt|train|delivery|port|shipping|taxi|ride)/],
  ['energy_utilities', /\b(energy|power|electric|utilit|water|solar|grid)/],
  ['compute_telecom', /\b(compute|telecom|data cent|internet|software|tech|computer|digital|online)/],
  ['housing_construction', /\b(housing|construction|build|renovat|repair|home|flat|shelter)/],
  ['food_agri', /\b(food|agri|farm|garden|grow|cook|meal|kitchen|hawker|grocer|herb)/],
  ['manufacturing', /\b(manufactur|factory|make|craft|workshop|fabricat|produc)/],
  ['finance', /\b(financ|bank|loan|credit|insur|invest|savings group)/],
  ['retail_commerce', /\b(retail|shop|store|market|sell|stall|commerce|trade|buy)/],
  ['public_admin', /\b(public admin|government service|civil service|admin|council|town)/],
  ['public_safety', /\b(safety|police|security|patrol|watch|fire|emergenc)/]
];
function sectorOf(v, fallbackText) {
  if (v && E.ORDER.indexOf(String(v)) >= 0) return String(v);
  const t = String(v || '').toLowerCase().replace(/_/g, ' ');
  const byName = E.ORDER.find(k => E.SECTORS[k].name.toLowerCase() === t);
  if (byName) return byName;
  for (const [k, re] of SECTOR_WORDS) if (re.test(t)) return k;
  if (fallbackText) for (const [k, re] of SECTOR_WORDS) if (re.test(fallbackText)) return k;
  return null;
}

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const num = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };

/* ---------------------------------------------------------------------
   CLEANING ONE INTERPRETATION
   Whatever the model returns, what leaves here is well formed: known
   channels only, sectors that exist, amounts in range. Anything else is
   dropped rather than guessed at.
   --------------------------------------------------------------------- */
function clean(raw, key, source) {
  raw = raw || {};
  const req = raw.requires || {};
  const effects = [];
  (Array.isArray(raw.effects) ? raw.effects : []).slice(0, 4).forEach(e => {
    if (!e || !CHANNELS[e.channel]) return;
    const out = { channel: e.channel, amount: Math.round(clamp(num(e.amount, 0.5), -1, 1) * 100) / 100 };
    if (CHANNELS[e.channel].sector) {
      /* A sector the model named but that does not exist is dropped, not
         guessed at. Only a sector left out entirely is read from the words. */
      const named = e.sector != null && String(e.sector).trim() !== '';
      const s = named ? sectorOf(e.sector) : sectorOf(null, key);
      if (!s) return;
      out.sector = s;
    }
    if (e.channel === 'organise') out.group = String(e.group || '').slice(0, 60) || null;
    if (e.from_target) out.from_target = true;
    if (out.amount !== 0) effects.push(out);
  });
  const minHealth = HEALTH.indexOf(String(req.min_health || 'poor').toLowerCase());
  return {
    key: key,
    label: String(raw.label || key.split('|')[0]).toLowerCase().replace(/[^a-z0-9 '&-]+/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 48) || 'unnamed',
    requires: {
      job: !!req.job,
      working_age: !!req.working_age,
      min_savings_months: clamp(num(req.min_savings_months, 0), 0, 24),
      min_health: HEALTH[minHealth < 0 ? 0 : minHealth]
    },
    hours_per_week: Math.round(clamp(num(raw.hours_per_week, 3), 0, 60) * 10) / 10,
    money_share: Math.round(clamp(num(raw.money_share, 0), 0, 1) * 100) / 100,
    effects: effects,
    lasting: !!raw.lasting,
    source: source
  };
}

/* ---------------------------------------------------------------------
   THE PROMPT
   Identical for every batch: a cached prefix, like the residents' own.
   --------------------------------------------------------------------- */
const SYSTEM = [
  'You translate what ordinary people say they will do into what those actions actually do in the world.',
  'You do not know who governs, what the policies are, or how the country is doing, and you must not judge',
  'whether an action is good or bad. Be literal and proportionate: describe what ONE ordinary person doing',
  'this, at full effort, would actually change.',
  '',
  'The effects you may use (channel: meaning):',
  Object.keys(CHANNELS).map(k => '- ' + k + ': ' + CHANNELS[k].what + (CHANNELS[k].sector ? ' [needs "sector"]' : '')).join('\n'),
  '',
  'Sectors: ' + E.ORDER.join(', ') + '.',
  '',
  'For each action return:',
  '- id: the id given',
  '- label: a short name for the behaviour, 2 to 5 lowercase words, general enough that someone else doing',
  '  the same kind of thing would get the same label (e.g. "selling crafts online", not "selling my crafts")',
  '- requires: {job: true if it needs a paid job, working_age: true if it needs someone under 65,',
  '  min_savings_months: savings it needs up front (0 if none), min_health: poor, fair or good}',
  '- hours_per_week: time it takes at full effort (0 to 60)',
  '- money_share: share of a monthly income it costs (0 to 1)',
  '- effects: 0 to 4 of {channel, sector if needed, amount from -1 to 1}. Amount is strength and direction.',
  '  Only effects the action really has. An action that changes nothing has no effects.',
  '  For organise, add "group" with the group\'s name if one is given.',
  '- lasting: true if it creates something that outlives the action (a co-op, a clinic, a school, a market)',
  '',
  'Reply with one JSON object: {"items": [ ... ]}, one item per action, in the order given.'
].join('\n');

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          requires: {
            type: 'object',
            properties: {
              job: { type: 'boolean' }, working_age: { type: 'boolean' },
              min_savings_months: { type: 'number' }, min_health: { type: 'string' }
            }
          },
          hours_per_week: { type: 'number' },
          money_share: { type: 'number' },
          effects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                channel: { type: 'string', enum: Object.keys(CHANNELS) },
                sector: { type: 'string' }, amount: { type: 'number' }, group: { type: 'string' }
              },
              required: ['channel', 'amount']
            }
          },
          lasting: { type: 'boolean' }
        },
        required: ['id', 'label', 'effects']
      }
    }
  },
  required: ['items']
};

function validateBatch(ids) {
  return function (data) {
    if (!data || !Array.isArray(data.items)) return { ok: false, reason: '"items" must be an array' };
    const byId = {};
    data.items.forEach((it, i) => { if (it) byId[String(it.id == null ? ids[i] : it.id)] = it; });
    const found = ids.filter(id => byId[id]);
    if (!found.length) return { ok: false, reason: 'no items matched the ids given; use exactly: ' + ids.join(', ') };
    return { ok: true, value: byId };
  };
}

/* ---------------------------------------------------------------------
   THE REGISTRY, AS A FALLBACK
   What the old pattern list would have done, translated into effects. It
   is used only when there is no model or the model gives nothing usable
   for an action, and it is labelled "registry" wherever it appears.
   --------------------------------------------------------------------- */
function fromRegistry(key, route) {
  const r = route({ status: 'employed', sector: 'retail_commerce', age: 40, savings_months: 6, health: 'good' },
                  { do: key.split('|')[0], target: (key.split('|')[1] || '').trim() });
  const kind = r.kind;
  const X = {
    strike: { requires: { job: true }, hours: 0, effects: [{ channel: 'labour_withheld', amount: 1 }, { channel: 'unrest', amount: 0.4 }] },
    protest: { hours: 4, effects: [{ channel: 'unrest', amount: 1 }, { channel: 'legitimacy', amount: -0.6 }] },
    riot: { hours: 4, effects: [{ channel: 'unrest', amount: 1 }, { channel: 'harm', sector: 'retail_commerce', amount: 1 },
                                 { channel: 'harm', sector: 'public_safety', amount: 0.7 }, { channel: 'cohesion', amount: -1 }] },
    petition: { hours: 1, effects: [{ channel: 'unrest', amount: 0.1 }, { channel: 'legitimacy', amount: -0.2 }] },
    mutual_aid: { hours: 6, effects: [{ channel: 'time_to_sector', sector: 'care_services', amount: 1 }, { channel: 'cohesion', amount: 0.6 }] },
    organise: { hours: 2, effects: [{ channel: 'organise', amount: 1, group: (key.split('|')[1] || '').trim() || null }] },
    boycott: { hours: 0, effects: [{ channel: 'spending', amount: -0.8 }] },
    save: { hours: 0, effects: [{ channel: 'spending', amount: -0.5 }] },
    informal_work: { hours: 10, effects: [{ channel: 'informal_production', sector: 'retail_commerce', amount: 1 }, { channel: 'labour_supply', amount: -0.5 }] },
    job_search: { hours: 5, effects: [{ channel: 'labour_supply', amount: 0.5 }] },
    start_business: { requires: { min_savings_months: 2 }, hours: 20, effects: [{ channel: 'found_business', sector: 'retail_commerce', amount: 1 }] },
    retrain: { hours: 8, effects: [{ channel: 'labour_supply', amount: -0.3 }] },
    network: { hours: 2, effects: [{ channel: 'cohesion', amount: 0.3 }] },
    support: { hours: 1, effects: [{ channel: 'legitimacy', amount: 0.3 }] },
    endure: { hours: 0, effects: [] }
  }[kind];
  if (!X) return null;
  return clean({ label: kind.replace(/_/g, ' '), requires: X.requires || {}, hours_per_week: X.hours, effects: X.effects }, key, 'registry');
}

/* ---------------------------------------------------------------------
   THE INTERPRETER
   --------------------------------------------------------------------- */
/* Where the shared cache and the overrides live. The environment can move
   them, which is how tests keep their interpretations out of the repo. */
const DIR = () => process.env.MERIDIAN_INTERPRETATIONS_DIR || path.join(__dirname, 'interpretations');
const slugOf = t => String(t || 'team').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
/* One file per team, and one starter dictionary everyone begins from. */
const CACHE_FILE = team => path.join(DIR(), slugOf(team) + '.json');
const STARTER_FILE = () => process.env.MERIDIAN_STARTER_DICTIONARY || path.join(DIR(), '_starter.json');
const OVERRIDES_FILE = () => process.env.MERIDIAN_INTERPRETATION_OVERRIDES || path.join(__dirname, 'interpretations.overrides.json');

function readJson(file) {
  try { return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch (e) { return null; }
}

/**
 * createInterpreter({ pool, team, cachePath, starterPath, overridesPath, seed, route, known })
 *   pool          the run's model pool (one-at-a-time, logged, replayable)
 *   team          whose country this is; their interpretations are theirs alone
 *   cachePath     that team's own file of past interpretations; null for none
 *   starterPath   the starter dictionary every team shares; null for none
 *   overridesPath organiser overrides; always win
 *   known         interpretations to use first, e.g. from a run being replayed
 *   route         the router's pattern matcher, for the registry fallback
 */
function createInterpreter(opts) {
  opts = opts || {};
  const pool = opts.pool || null;
  const cachePath = opts.cachePath === undefined ? CACHE_FILE(opts.team) : opts.cachePath;
  const starterPath = opts.starterPath === undefined ? STARTER_FILE() : opts.starterPath;
  const overridesPath = opts.overridesPath === undefined ? OVERRIDES_FILE() : opts.overridesPath;
  const shared = (readJson(cachePath) || {}).items || {};          // this team's own, and nobody else's
  const starter = (readJson(starterPath) || {}).items || {};       // the vocabulary everyone starts with
  const overrides = readJson(overridesPath) || {};
  const mem = new Map();
  const used = new Map();
  const stats = { model: 0, cached: 0, starter: 0, override: 0, known: 0, registry: 0, none: 0, calls: 0, failed_calls: 0 };

  Object.keys(opts.known || {}).forEach(k => mem.set(k, Object.assign({}, opts.known[k])));

  function lookup(a) {
    const key = typeof a === 'string' ? a : keyOf(a);
    if (overrides[key]) {
      const o = clean(overrides[key], key, 'override');
      used.set(key, o);
      return o;
    }
    const m = mem.get(key);
    if (m) { used.set(key, m); return m; }
    return null;
  }

  /* An ordinary action, whatever it was aimed at. "volunteer | at the
     hospital" and "volunteer | at the school" are the same act from the
     starter dictionary, and each gives its time to the industry its own
     target names. */
  function fromStarter(a, key) {
    if (typeof a === 'string') {
      const parts = a.split('|');
      a = { do: parts[0], target: parts.slice(1).join('|') };
    }
    const hit = starter[keyOf({ do: a.do || a.action })];
    if (!hit || !hit.any_target) return null;
    const target = String(a.target || '').toLowerCase();
    const out = Object.assign({}, hit, { key: key, source: 'starter', any_target: undefined });
    out.effects = hit.effects.map(e => {
      const copy = Object.assign({}, e);
      if (copy.from_target) { copy.sector = sectorOf(null, target) || copy.sector; delete copy.from_target; }
      if (copy.channel === 'organise') copy.group = String(a.target || '').slice(0, 60) || null;
      return copy;
    });
    return out;
  }

  /** Make sure every action has an interpretation. Batched, cached, logged. */
  async function resolve(actions) {
    const want = [];
    const seen = new Set();
    actions.forEach(a => {
      const key = typeof a === 'string' ? a : keyOf(a);
      if (!key || seen.has(key)) return;
      seen.add(key);
      if (overrides[key]) { if (!used.has(key)) stats.override++; lookup(key); return; }
      if (mem.has(key)) return;
      if (shared[key]) { mem.set(key, Object.assign({}, shared[key], { source: 'cached' })); stats.cached++; return; }
      const base = starter[key] || fromStarter(a, key);
      if (base) { mem.set(key, base); stats.starter++; return; }
      if (opts.known && opts.known[key]) { stats.known++; return; }
      want.push(key);
    });
    want.sort();   // deterministic batches, whatever order people decided in

    for (let i = 0; i < want.length; i += BATCH) {
      const batch = want.slice(i, i + BATCH);
      const ids = batch.map((_, j) => 'a' + (j + 1));
      let got = null;
      if (pool) {
        stats.calls++;
        const res = await pool.decide({
          key: 'interpret|' + batch[0],
          system: SYSTEM,
          user: 'Actions:\n' + batch.map((k, j) => ids[j] + ': ' + k).join('\n'),
          schema: validateBatch(ids), jsonSchema: JSON_SCHEMA, schemaName: 'action_effects',
          maxTokens: 150 * batch.length + 100, temperature: 0, seed: opts.seed
        });
        if (res.data) got = res.data; else stats.failed_calls++;
      }
      /* A model that answered for eleven of twelve is asked for the twelfth
         on its own, a few times, before anything else is considered. */
      const missing = pool && pool.insist ? batch.filter((_, j) => !(got && got[ids[j]])) : [];
      const late = {};
      for (const key of missing) {
        for (let tries = 0; tries < 3 && !late[key]; tries++) {
          stats.calls++;
          const res = await pool.decide({
            key: 'interpret|one|' + key + '|' + tries, system: SYSTEM, user: 'Actions:\na1: ' + key,
            schema: validateBatch(['a1']), jsonSchema: JSON_SCHEMA, schemaName: 'action_effects',
            maxTokens: 260, temperature: 0, seed: (opts.seed || 0) + tries
          });
          if (res.data && res.data.a1) late[key] = res.data.a1;
        }
      }
      batch.forEach((key, j) => {
        const raw = (got && got[ids[j]]) || late[key];
        let interp = raw ? clean(raw, key, 'model') : null;
        if (interp) stats.model++;
        /* The pattern list only stands in when nobody is insisting. */
        if (!interp && opts.route && !(pool && pool.insist)) { interp = fromRegistry(key, opts.route); if (interp) stats.registry++; }
        if (!interp) { interp = clean({ label: 'unrecognised action', effects: [] }, key, 'none'); stats.none++; }
        mem.set(key, interp);
      });
    }
    return lookup;
  }

  /** Every interpretation this run actually used. */
  function usedAll() {
    const out = {};
    Array.from(used.keys()).sort().forEach(k => { out[k] = used.get(k); });
    return out;
  }

  /** Add what the model interpreted to the shared file, for the next run. */
  function save() {
    if (!cachePath) return 0;
    try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); } catch (e) { /* written below or not at all */ }
    const file = readJson(cachePath) || { version: 1, team: opts.team || null, items: {} };
    let added = 0;
    mem.forEach((v, k) => {
      if (v.source === 'model' && !file.items[k]) { file.items[k] = Object.assign({}, v, { source: undefined }); added++; }
    });
    if (added) {
      try { fs.writeFileSync(cachePath, JSON.stringify(file, null, 1)); } catch (e) { return 0; }
    }
    return added;
  }

  return { resolve, lookup, used: usedAll, save, stats, SYSTEM };
}

/* Organiser overrides, for the admin page. */
function readOverrides(p) { return readJson(p || OVERRIDES_FILE()) || {}; }
function writeOverride(key, interp, p) {
  const file = p || OVERRIDES_FILE();
  const all = readOverrides(file);
  if (interp == null) delete all[key];
  else all[key] = clean(interp, key, 'override');
  fs.writeFileSync(file, JSON.stringify(all, null, 1));
  return all[key] || null;
}
/* For organisers: every interpretation on file, and whose it is. The
   starter dictionary belongs to everyone; the rest belong to one team. */
function readShared(p) { return (readJson(p || STARTER_FILE()) || {}).items || {}; }
function readAll() {
  const out = [];
  const add = (owner, items) => Object.keys(items || {}).forEach(k => out.push({ key: k, owner: owner, interpretation: items[k] }));
  add('starter', readShared());
  try {
    fs.readdirSync(DIR()).filter(f => /\.json$/.test(f) && f !== path.basename(STARTER_FILE())).forEach(f => {
      const j = readJson(path.join(DIR(), f)) || {};
      add(j.team || f.replace(/\.json$/, ''), j.items);
    });
  } catch (e) { /* no teams have run yet */ }
  return out;
}
/** Write the starter dictionary. Organisers only, before the event. */
function writeStarter(items, p) {
  const file = p || STARTER_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean1 = {};
  Object.keys(items).sort().forEach(k => { clean1[k] = Object.assign({}, items[k], { source: undefined }); });
  fs.writeFileSync(file, JSON.stringify({ version: 1, built: new Date().toISOString(), items: clean1 }, null, 1));
  return Object.keys(clean1).length;
}

module.exports = { createInterpreter, keyOf, clean, fromRegistry, sectorOf, CHANNELS, SYSTEM, JSON_SCHEMA,
                   readOverrides, writeOverride, readShared, readAll, writeStarter, slugOf,
                   CACHE_FILE, STARTER_FILE };
