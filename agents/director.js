/* =====================================================================
   THE ENVIRONMENT DIRECTOR
   ---------------------------------------------------------------------
   Organisers control the world's context: weather, energy crises, civil
   conflict. Following Light Society, the environment evolves on its own
   process, separate from the agents, and following AgentSociety an event
   is an intervention on the ENVIRONMENT and on what people PERCEIVE —
   never an edit to anyone's decision.

   So every event has two layers:

     physical    effects the kernel applies, in the shock deck's own
                 vocabulary (demand, capacity, quality, prices, cohesion…)
                 scaled by severity, for a duration in rounds
     perceptual  what residents and firms see, hear and are told, which
                 they then respond to however they respond

   Events come from three places: the library below, fired live by an
   organiser; a schedule file written before the run; and seeded
   "weather" — unannounced events drawn from the seed, identical for
   every team given the same seed.

   An LLM may draft a new event, but a drafted event is never fired
   without an organiser approving it (see server.js).
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const { rng, derive } = require('./rng.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

const MULTIPLICATIVE_MAPS = ['demand', 'capacity_mult'];
const MULTIPLICATIVE_SCALARS = ['output_mult'];
const ADDITIVE_MAPS = ['quality'];
const ADDITIVE_SCALARS = ['cohesion', 'legitimacy', 'import_price', 'compute_price', 'borrowing_penalty', 'automation_ceiling'];
const EFFECT_FIELDS = MULTIPLICATIVE_MAPS.concat(MULTIPLICATIVE_SCALARS, ADDITIVE_MAPS, ADDITIVE_SCALARS);

/** A deck shock's physical layer, without its label. */
function deckEffects(name) {
  const out = {};
  Object.keys(E.SHOCKS[name]).forEach(f => { if (f !== 'label') out[f] = E.SHOCKS[name][f]; });
  return out;
}

const LIBRARY = {
  typhoon: {
    label: 'Typhoon', category: 'extreme weather', duration: 1, months: 2,
    effects: { capacity_mult: { transport_logistics: 0.7, energy_utilities: 0.88, food_agri: 0.85 },
               quality: { housing_construction: -8, transport_logistics: -10 }, output_mult: 0.97, cohesion: -2 },
    perceived: 'A typhoon has torn through the city: flooded roads, cancelled trains, power cuts in the east, and shops short of fresh food.'
  },
  heatwave: {
    label: 'Extreme heat', category: 'extreme weather', duration: 2, months: 3,
    effects: { demand: { energy_utilities: 1.2, healthcare: 1.12 }, quality: { healthcare: -6, care_services: -6 },
               compute_price: 0.15, output_mult: 0.98 },
    perceived: 'Weeks of dangerous heat: air-conditioners running day and night, the elderly kept indoors, clinics full of heatstroke.'
  },
  energy_crisis: {
    label: 'Energy crisis', category: 'energy', duration: 2, months: 18,
    /* Calibrated a little above the deck's energy_price_spike. Scarcity
       pricing in the kernel is steep: at severity 1.5 this already takes
       purchasing power from the eighties to the teens in two rounds. */
    effects: { capacity_mult: { energy_utilities: 0.78 }, compute_price: 0.5, import_price: 0.1,
               quality: { energy_utilities: -13, transport_logistics: -6 }, cohesion: -3 },
    perceived: 'Imported gas has been cut off. Electricity is rationed at peak hours, bills have doubled, and data centres are throttling.'
  },
  civil_conflict: {
    label: 'Civil conflict', category: 'social', duration: 2, months: 12,
    effects: { quality: { public_safety: -18, retail_commerce: -10, public_admin: -8 }, output_mult: 0.92,
               cohesion: -10, legitimacy: -8 },
    perceived: 'Clashes between groups have spread across several towns. Shops are shuttered at night and people avoid the town centres.'
  },
  pandemic: {
    label: 'Pandemic', category: 'health', duration: 2, months: 18,
    effects: deckEffects('pandemic'),
    perceived: 'A new respiratory virus is spreading. Hospitals are stretched, some workplaces have closed, and people are wary of crowds.'
  },
  trade_embargo: {
    label: 'Trade embargo', category: 'trade', duration: 2, months: 12,
    effects: { capacity_mult: { manufacturing: 0.75, food_agri: 0.7 }, demand: { transport_logistics: 0.8 },
               import_price: 0.25, quality: { food_agri: -14 }, cohesion: -4 },
    perceived: 'Two major trading partners have imposed an embargo. The port is quiet, factories are idling, and food prices are climbing.'
  },
  cyber_attack: {
    label: 'Cyber attack', category: 'infrastructure', duration: 1, months: 2,
    effects: deckEffects('cyber_attack'),
    perceived: 'A cyber attack has taken payments, hospital records and parts of the grid offline for days.'
  },
  financial_crisis: {
    label: 'Financial crisis', category: 'economy', duration: 2, months: 18,
    effects: { capacity_mult: { finance: 0.75, housing_construction: 0.85 }, demand: { retail_commerce: 0.88 },
               quality: { finance: -15 }, borrowing_penalty: 0.08, cohesion: -3, legitimacy: -3 },
    perceived: 'A global bank collapse has frozen credit. Mortgages are being recalled, and businesses cannot borrow to pay wages.'
  },
  tech_breakthrough: {
    label: 'Technology breakthrough', category: 'technology', duration: 2, months: 24,
    effects: { compute_price: -0.35, automation_ceiling: 0.05, output_mult: 1.03 },
    perceived: 'A breakthrough has made AI systems far cheaper to run. Firms everywhere are talking about what they can now automate.'
  },
  misinformation_wave: {
    label: 'Misinformation wave', category: 'information', duration: 1, months: 4,
    effects: { legitimacy: -6, cohesion: -5 },
    perceived: 'Fabricated videos of officials and false stories about who is to blame are spreading faster than they can be corrected.'
  },
  migration_wave: {
    label: 'Arrival of refugees', category: 'migration', duration: 1, months: 6,
    effects: { demand: { housing_construction: 1.08, healthcare: 1.05 }, cohesion: -1 },
    exogenous: { demography: { immigration: 60000 } },
    perceived: 'Tens of thousands of people displaced by a regional disaster have arrived and are being housed across the city.'
  }
};

/** Scale an event's physical layer by severity (1 = as written). */
function scaleEffects(effects, severity) {
  const s = clamp(Number(severity) || 1, 0.1, 3);
  const out = {};
  EFFECT_FIELDS.forEach(f => {
    const v = effects[f];
    if (v == null) return;
    if (MULTIPLICATIVE_MAPS.indexOf(f) >= 0) {
      out[f] = {};
      Object.keys(v).forEach(k => { out[f][k] = round3(Math.max(0.05, 1 + (v[k] - 1) * s)); });
    } else if (MULTIPLICATIVE_SCALARS.indexOf(f) >= 0) {
      out[f] = round3(Math.max(0.05, 1 + (v - 1) * s));
    } else if (ADDITIVE_MAPS.indexOf(f) >= 0) {
      out[f] = {};
      Object.keys(v).forEach(k => { out[f][k] = round3(v[k] * s); });
    } else {
      out[f] = round3(v * s);
    }
  });
  return out;
}

/** Check an event an organiser (or a drafting model) wrote. */
function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const label = String(raw.label || '').trim();
  if (!label) return { ok: false, reason: 'an event needs a label' };
  const effects = raw.effects || {};
  const clean = {};
  for (const f of Object.keys(effects)) {
    if (EFFECT_FIELDS.indexOf(f) < 0) return { ok: false, reason: 'unknown effect "' + f + '"' };
    const v = effects[f];
    if (MULTIPLICATIVE_MAPS.indexOf(f) >= 0 || ADDITIVE_MAPS.indexOf(f) >= 0) {
      if (!v || typeof v !== 'object') return { ok: false, reason: f + ' must map sectors to numbers' };
      clean[f] = {};
      for (const k of Object.keys(v)) {
        if (E.ORDER.indexOf(k) < 0) return { ok: false, reason: 'unknown sector "' + k + '" in ' + f };
        const x = Number(v[k]);
        if (!isFinite(x)) return { ok: false, reason: f + '.' + k + ' must be a number' };
        if (MULTIPLICATIVE_MAPS.indexOf(f) >= 0 && (x < 0.05 || x > 3)) return { ok: false, reason: f + '.' + k + ' must be between 0.05 and 3' };
        if (ADDITIVE_MAPS.indexOf(f) >= 0 && Math.abs(x) > 60) return { ok: false, reason: f + '.' + k + ' must be between -60 and 60' };
        clean[f][k] = x;
      }
    } else {
      const x = Number(v);
      if (!isFinite(x)) return { ok: false, reason: f + ' must be a number' };
      clean[f] = x;
    }
  }
  const duration = clamp(Math.round(Number(raw.duration) || 1), 1, 12);
  return { ok: true, value: {
    label: label.slice(0, 60), category: String(raw.category || 'custom').slice(0, 30),
    effects: clean, duration: duration,
    perceived: String(raw.perceived || label).slice(0, 500),
    exogenous: raw.exogenous && raw.exogenous.demography ? { demography: {
      immigration: clamp(Number(raw.exogenous.demography.immigration) || 0, 0, 400000),
      emigration: clamp(Number(raw.exogenous.demography.emigration) || 0, 0, 400000) } } : null
  } };
}

/**
 * createDirector({ seed, schedule, weather }) — the environment process
 * for one run (or for a whole room: `forRound` filters by team).
 *
 *   schedule  [{ round, event: libraryId | eventObject, severity, duration, teams }]
 *   weather   { enabled, rate }   seeded unannounced events per round
 */
function createDirector(opts) {
  opts = opts || {};
  const seed = opts.seed == null ? 1 : opts.seed;
  let seq = 0;
  const fired = [];            // every event instance, with its window
  const weather = Object.assign({ enabled: false, rate: 0.15, severity: [0.6, 1.4] }, opts.weather || {});
  /* The unit a "round" is here: the original two years, or a monthly tick.
     In ticks an event lasts its own number of MONTHS (a typhoon two, a
     pandemic eighteen), and unannounced weather is drawn each month at the
     monthly chance that gives the same yearly odds. */
  const inTicks = opts.unit === 'tick';

  function instantiate(spec, round, source) {
    const base = typeof spec.event === 'string' ? LIBRARY[spec.event] : spec.event;
    if (!base) throw new Error('unknown event "' + spec.event + '"');
    const v = validateEvent(Object.assign({}, base, { duration: spec.duration || base.duration }));
    if (!v.ok) throw new Error('invalid event: ' + v.reason);
    const severity = clamp(Number(spec.severity) || 1, 0.1, 3);
    const inst = {
      id: 'ev' + (++seq),
      library: typeof spec.event === 'string' ? spec.event : null,
      label: v.value.label, category: v.value.category,
      severity: severity, start: round,
      end: round + (inTicks ? Math.max(1, Math.round(Number(spec.months) || base.months || v.value.duration * 6)) : v.value.duration) - 1,
      teams: spec.teams && spec.teams.length ? spec.teams.slice() : 'all',
      effects: scaleEffects(v.value.effects, severity),
      exogenous: v.value.exogenous,
      perceived: v.value.perceived + (severity >= 1.6 ? ' It is worse than anyone can remember.'
        : severity <= 0.5 ? ' So far the damage is limited.' : ''),
      source: source, cancelled: false
    };
    fired.push(inst);
    return inst;
  }

  (opts.schedule || []).forEach(s => instantiate(s, s.round, 'schedule'));

  return {
    /** Fire now (live), for the round given. */
    fire(spec, round) { return instantiate(spec, round, spec.source || 'organiser'); },
    cancel(id) { const e = fired.find(x => x.id === id); if (e) e.cancelled = true; return !!e; },
    setWeather(w) { Object.assign(weather, w || {}); return weather; },
    /** The events active in a round, for a team. Draws seeded weather once per round. */
    forRound(round, team) {
      if (weather.enabled && !fired.some(e => e.source === 'weather' && e.start === round)) {
        const r = rng(derive(seed, 'weather', round));
        if (r() < (inTicks ? 1 - Math.pow(1 - weather.rate, 1 / 24) : weather.rate)) {
          const keys = Object.keys(LIBRARY).filter(k => k !== 'tech_breakthrough' || r() < 0.3);
          const pick = keys[Math.floor(r() * keys.length)];
          const sev = weather.severity[0] + r() * (weather.severity[1] - weather.severity[0]);
          instantiate({ event: pick, severity: Math.round(sev * 100) / 100 }, round, 'weather');
        }
      }
      return fired.filter(e => !e.cancelled && round >= e.start && round <= e.end &&
        (e.teams === 'all' || (team && e.teams.indexOf(team) >= 0)));
    },
    all() { return fired.slice(); },
    weather() { return Object.assign({}, weather); }
  };
}

/** Kernel-ready shock objects for a round's events. */
function asShocks(events) {
  return events.map(e => ({ id: e.id, label: e.label, effects: e.effects }));
}

const round3 = v => Math.round(v * 1000) / 1000;

module.exports = { createDirector, LIBRARY, scaleEffects, validateEvent, asShocks, EFFECT_FIELDS };
