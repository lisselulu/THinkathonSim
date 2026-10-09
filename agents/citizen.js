/* =====================================================================
   A CITIZEN: REASON
   ---------------------------------------------------------------------
   One persona, one decision. This file owns the first stage of reason /
   route / action: what the person perceives, and what they decide.

   PERCEIVE. Built field by field from the persona's own life, like
   `lived.js`: their payment and what it buys, the prices THEY notice,
   the services THEY use, their job, what happened near them, what people
   they know said, what their organisations are doing, what the
   government publicly announced, and what they remember. Never a lever,
   never an indicator. The engine-derived parts pass `assertBlind`; the
   words of other people and of the government are quoted as such,
   because they are things a resident genuinely hears.

   DECIDE. An open decision, not a menu. The agent says how much of its
   income it will spend, what it will do about work, up to three things
   it will DO (in its own words), whether it is thinking of leaving, and
   how it feels. The router, not this file, works out what those words
   mean for the country.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');
const L = require('../engine/lived.js');
const M = require('./mind.js');
const DIST = require('./distribution.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

const WORK = ['keep', 'seek', 'reduce', 'quit', 'retrain', 'care_at_home', 'retire', 'none'];

/* ---------------------------------------------------------------------
   THE POST
   ---------------------------------------------------------------------
   "What you might say online" produced a feed of slogans: the same
   "#MeridianStrong still trying to make ends meet" from dozens of people,
   figures copied out of the prompt, and posts that said nothing. Real
   posts are about a day: what someone did, who they saw, a small joy, a
   specific grievance.

   So each person is given a MOMENT to post from, chosen deterministically
   from who they are and the year (a replayed run picks the same one), and
   the instruction asks for their day in their words. Then CLEAN_POST drops
   what still slips through: hashtags and links are stripped, and posts
   that quote the prompt's figures or say nothing are discarded. A missing
   post is better than a false one.
   --------------------------------------------------------------------- */
const MOMENTS = {
  any: ['on the bus home', 'in the queue at the hawker centre', 'late at night when you cannot sleep',
        'at the wet market on a Sunday morning', 'sitting at the void deck', 'while the laundry spins',
        'after dinner with the TV on', 'waiting at the polyclinic', 'walking to the supermarket'],
  employed: ['on your lunch break', 'on the MRT to work', 'straight after a long shift'],
  unemployed: ['after sending off another application', 'on a weekday afternoon at home'],
  student: ['between lectures', 'in the library when you should be studying'],
  retired: ['after morning exercise in the park', 'at the coffee shop with old friends'],
  carer: ['while the person you look after naps', 'in the car park after an appointment'],
  not_working: ['on a weekday afternoon at home', 'on a slow morning with nowhere to be'],
  children: ['once the kids are finally asleep', 'at the school gate']
};

function momentFor(p, year) {
  const pool = MOMENTS.any.concat(MOMENTS[p.status] || [], p.children ? MOMENTS.children : []);
  let h = 2166136261;
  const key = p.id + '|' + year;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return pool[(h >>> 0) % pool.length];
}

const POST_INSTRUCTION =
  '- post: what you would actually post online today about how you feel and what you have been up to. ' +
  'Something specific from your own life this week: something you did, someone you saw, a small joy, a ' +
  'grievance, something that annoyed you or made you laugh. Write it the way you would type it on your ' +
  'phone, in one to three casual sentences. No hashtags, links or slogans. Do not quote figures from above ' +
  '(the payment, prices, rent, percentages, ratings); say it the way a person would, like "rent went up ' +
  'again". Do not repeat what other people have said. Use an empty string only if this person would not ' +
  'post at all.';

/** Tidy a post, or return '' when it should not be published. */
function cleanPost(text) {
  let t = String(text || '')
    .replace(/https?:\/\/\S+|www\.\S+|\bbit\.ly\/\S+/gi, '')
    .replace(/(^|\s)#[\w\u00C0-\uFFFF]+/g, '$1')
    .replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  if (t.length < 12) return '';
  // Posts that say nothing.
  if (/nothing (much )?(to report|new|to say|happening)|no (real )?(news|update)s?\b|same as (usual|always|last year)|just (another|a normal) (day|year)\.?$/i.test(t)) return '';
  // Slogans: a feed of "we are in this together" is a campaign, not people.
  if (/\b(we('re| are) (all )?in this together|stay(ing)? strong|stronger together|together we (can|will))\b/i.test(t)) return '';
  // A service quoted as a number, which is the engine talking, not a resident.
  if (/\b(healthcare|hospitals?|clinics?|care|education|schools?|transport|energy|housing|services?)\b[^.]{0,30}\b(at|is|to|hit|reached)\s\d{2,3}\b(?!\s?(am|pm|mins?|minutes|hours?|days?|weeks?|years?|km|people|students|kids|children|patients|of us))/i.test(t)) return '';
  // Figures lifted from the prompt: money, percentages, scores and ratings.
  if (/(S?\$|SGD)\s?\d|\d\s?(%|per ?cent)|\d\s?(\/|out of)\s?(10|100)\b|\b(score|rating|index|quality|level)\b[^.]{0,25}\d/i.test(t)) return '';
  return t.slice(0, 280);
}

/* Two posts are the same post if they share most of their words. Used by
   the society to drop copies of what someone already said. */
function postWords(t) {
  return new Set(String(t).toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(w => w.length > 2));
}
function samePost(a, b) {
  const A = postWords(a), B = postWords(b);
  if (!A.size || !B.size) return false;
  // Very short posts share words by accident; only an exact match counts.
  if (Math.min(A.size, B.size) < 4) return Array.from(A).sort().join(' ') === Array.from(B).sort().join(' ');
  let both = 0;
  A.forEach(w => { if (B.has(w)) both++; });
  return both / Math.min(A.size, B.size) >= 0.7;
}
const MIGRATE = ['stay', 'consider', 'leave'];

/* The decoder-level schema. Kept small: every property is a token cost
   paid a thousand times a round. */
const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thinking', 'spend_share', 'work', 'actions', 'migrate', 'family',
             'trust_government', 'belonging', 'satisfaction', 'feelings', 'post'],
  properties: {
    thinking: { type: 'string' },
    spend_share: { type: 'number', minimum: 0, maximum: 1 },
    work: { type: 'string', enum: WORK },
    actions: {
      type: 'array', maxItems: 3,
      items: { type: 'object', additionalProperties: false, required: ['do', 'target', 'intensity', 'why'],
               properties: { do: { type: 'string' }, target: { type: 'string' },
                             intensity: { type: 'number', minimum: 0, maximum: 1 }, why: { type: 'string' } } }
    },
    migrate: { type: 'string', enum: MIGRATE },
    family: { type: 'string', enum: ['none', 'plan_child'] },
    trust_government: { type: 'number', minimum: 0, maximum: 10 },
    belonging: { type: 'number', minimum: 0, maximum: 10 },
    satisfaction: { type: 'number', minimum: 0, maximum: 10 },
    feelings: {
      type: 'object', additionalProperties: false, required: M.EMOTIONS,
      properties: M.EMOTIONS.reduce((o, k) => { o[k] = { type: 'number', minimum: 0, maximum: 10 }; return o; }, {})
    },
    post: { type: 'string' }
  }
};

/* Lenient validation. A reply with the two decisions that move the
   economy — spending and work — is usable even if the feelings are
   missing; a reply without them is not. Numbers arriving as strings and
   near-miss enum values are coerced, because small models do both. */
function validate(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const num = (v, lo, hi) => {
    const x = typeof v === 'string' ? parseFloat(v) : v;
    return typeof x === 'number' && isFinite(x) ? clamp(x, lo, hi) : null;
  };
  /* "70" and "70%" mean 0.70. Anything else out of range is clamped. */
  let spendRaw = typeof raw.spend_share === 'string' ? parseFloat(raw.spend_share) : raw.spend_share;
  if (typeof spendRaw === 'number' && isFinite(spendRaw) && spendRaw > 1 && spendRaw <= 100) spendRaw = spendRaw / 100;
  const spend = num(spendRaw, 0, 1);
  if (spend == null) return { ok: false, reason: 'spend_share must be a number between 0 and 1' };
  const workRaw = String(raw.work || '').toLowerCase().replace(/[^a-z_ ]/g, '').trim();
  const work = WORK.find(w => workRaw === w) ||
    WORK.find(w => workRaw.indexOf(w.replace('_', ' ')) >= 0 || workRaw.indexOf(w) >= 0);
  if (!work) return { ok: false, reason: 'work must be one of ' + WORK.join(', ') };
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).slice(0, 3)
    .filter(a => a && (a.do || a.action))
    .map(a => ({ do: String(a.do || a.action).slice(0, 80), target: String(a.target || '').slice(0, 80),
                 intensity: num(a.intensity, 0, 1) == null ? 0.5 : num(a.intensity, 0, 1),
                 why: String(a.why || '').slice(0, 160) }));
  const migrateRaw = String(raw.migrate || 'stay').toLowerCase();
  const feelings = {};
  M.EMOTIONS.forEach(k => { const v = num((raw.feelings || {})[k], 0, 10); if (v != null) feelings[k] = v; });
  return { ok: true, value: {
    thinking: String(raw.thinking || '').slice(0, 220),
    spend_share: spend,
    work: work,
    actions: actions,
    migrate: MIGRATE.find(m => migrateRaw.indexOf(m) >= 0) || 'stay',
    family: String(raw.family || '').indexOf('child') >= 0 ? 'plan_child' : 'none',
    trust_government: num(raw.trust_government, 0, 10),
    belonging: num(raw.belonging, 0, 10),
    satisfaction: num(raw.satisfaction, 0, 10),
    feelings: feelings,
    post: cleanPost(raw.post)
  } };
}

/* ---------------------------------------------------------------------
   PERCEPTION
   --------------------------------------------------------------------- */

/** The services this person actually leans on. */
function dependsOn(p) {
  const d = ['food_agri', 'retail_commerce', 'transport_logistics', 'housing_construction', 'public_safety'];
  if (p.age >= 60 || p.health !== 'good') d.unshift('healthcare');
  if (p.age >= 75 || p.household === 'multigenerational' || p.household === 'couple_with_parents') d.push('care_services');
  if (p.children) d.push('education_research');
  if (p.status === 'unemployed' || p.status === 'retired' || p.status === 'not_working') d.push('public_admin');
  return d;
}

function incomeWords(decile) {
  if (decile <= 2) return 'you earn less than most people in Meridian';
  if (decile <= 4) return 'you earn a bit less than the middle';
  if (decile <= 6) return 'you earn about what most people do';
  if (decile <= 8) return 'you earn more than most people';
  return 'you are comfortably off';
}

/**
 * The life a persona can see. `ctx` carries the round's shared facts:
 * prev/next state, events, announcements.
 */
function perceive(p, mind, ctx) {
  const next = ctx.next, prev = ctx.prev;
  const i = next.indicators;
  const pay = Math.round(i.ubi_monthly_sgd);
  const payPrev = Math.round(prev.indicators.ubi_monthly_sgd);
  /* What a pound buys: lower earners feel the service-adjusted figure,
     because they cannot buy their way round a failing clinic. */
  const buys = p.income_decile <= 5 ? i.effective_ubi_index
    : Math.round((i.effective_ubi_index + i.real_ubi_index) / 2);
  const priceNow = i.ubi_monthly_sgd / Math.max(1, i.real_ubi_index);
  const priceBefore = prev.indicators.ubi_monthly_sgd / Math.max(1, prev.indicators.real_ubi_index);
  const priceRise = Math.round((priceNow / Math.max(1e-9, priceBefore) - 1) * 100);

  const mine = dependsOn(p).map(k => ({ k, name: E.SECTORS[k].name, q: next.sectors[k].quality,
                                         dq: next.sectors[k].quality - prev.sectors[k].quality }));
  const servicesQuality = mine.reduce((a, s) => a + s.q, 0) / Math.max(1, mine.length);

  let job = null, jobSecure = true;
  if (p.status === 'employed' && p.sector) {
    const h0 = prev.sectors[p.sector].headcount, h1 = next.sectors[p.sector].headcount;
    const change = h0 > 0 ? Math.round((h1 / h0 - 1) * 100) : 0;
    jobSecure = !(p.exposure === 'high' && change < -3) && change > -8;
    job = 'You work in ' + E.SECTORS[p.sector].name.toLowerCase() + '. ' +
      (change <= -8 ? 'A lot of people at work have been let go (' + (-change) + '% fewer staff than ' + (ctx.since || 'two years ago') + ').'
        : change < -2 ? 'Some colleagues have been let go.'
        : change > 3 ? 'Your workplace has been hiring.' : 'Staffing at work is about the same.') +
      (p.exposure === 'high' ? ' Machines can already do a lot of what you do.' : '');
  }

  const empPct = Math.round(i.employment_rate * 100);
  const facts = {
    year: next.meta.year,
    you: p.name + ', ' + p.age + ', living in ' + p.housing_label + ' in the ' + p.region.replace('_', ' ') +
      ' (' + p.household.replace(/_/g, ' ') + (p.children ? ', ' + p.children + ' child' + (p.children > 1 ? 'ren' : '') : '') + ').' +
      ' Health: ' + p.health + '. ' + incomeWords(p.income_decile) +
      '; savings would last about ' + p.savings_months + ' months.',
    status: p.status === 'employed' ? job
      : p.status === 'unemployed' ? 'You are out of work and looking. ' + L.workFeel(empPct, false) + '.'
      : p.status === 'carer' ? 'You care for family at home rather than working for pay.'
      : p.status === 'student' ? 'You are studying.'
      : p.status === 'not_working' ? 'You are not in paid work and not looking for any at the moment.'
      : 'You are retired.',
    money: 'The monthly payment is S$' + pay + (pay !== payPrev ? ' (' + (pay > payPrev ? 'up' : 'down') + ' from S$' + payPrev + ')' : '') +
      '. Your money ' + L.moneyFeel(buys) + '. Prices are ' +
      (priceRise > 1 ? priceRise + '% higher than ' + (ctx.since || 'two years ago') : priceRise < -1 ? 'a little lower than they were' : 'about where they were') + '.',
    services: mine.map(s => s.name + ': ' + L.serviceFeel(s.q) + (s.dq <= -5 ? ' (getting worse)' : s.dq >= 5 ? ' (getting better)' : '')),
    work_around_you: L.workFeel(empPct, p.status === 'employed'),
    news: (next.news || []).slice(0, 3)
  };
  // The guard, over everything the engine said. Quoted voices come after.
  L.assertBlind(JSON.stringify(facts), 'citizen');

  const life = {
    money_index: buys, services_quality: servicesQuality, job_secure: jobSecure,
    ties_active: (ctx.inbox || []).length, in_organisation: (ctx.memberships || []).length > 0,
    community: (ctx.communityLevel || 50), shock_nearby: (ctx.events || []).length > 0
  };
  return { facts, life };
}

function buildPrompt(p, mind, perceived, ctx) {
  const f = perceived.facts;
  const lines = [];
  lines.push('It is ' + f.year + '. ' + f.you);
  lines.push(f.status);
  lines.push(f.money);
  lines.push('The services you rely on:\n- ' + f.services.join('\n- '));
  if ((ctx.events || []).length) lines.push('What is happening: ' + ctx.events.map(e => e.perceived || e.label).join(' '));
  if (f.news.length) lines.push('People are talking about: ' + f.news.join(' '));
  if ((ctx.announcements || []).length) {
    lines.push('The government has publicly said:\n- ' + ctx.announcements.map(a => '"' + a + '"').join('\n- '));
  }
  if ((ctx.inbox || []).length) {
    lines.push('People you know have been saying:\n- ' + ctx.inbox.map(m =>
      (m.org ? '(' + m.org + ') ' : m.kind === 'workplace' ? '(a colleague) ' : m.kind === 'household' ? '(a neighbour) ' : '(online) ') +
      '"' + m.text + '"').join('\n- '));
  }
  if ((ctx.schemes || []).length) {
    /* The team's own ways of sharing out, on the terms the team published. */
    lines.push('Beyond the monthly payment, you can also earn:\n- ' + ctx.schemes.join('\n- '));
    const got = DIST.earnedWords(ctx.earned);
    if (got) lines.push(got);
  }
  if ((ctx.institutions || []).length) {
    /* Things the government has set up or backed. Public knowledge, like an
       announcement, so it sits outside the blindness guard. */
    lines.push('In your country there is:\n- ' + ctx.institutions.join('\n- '));
  }
  if ((ctx.memberships || []).length) lines.push('You belong to: ' + ctx.memberships.join(', ') + '.');
  if ((ctx.nearbyOrgs || []).length) lines.push('Groups people you know belong to: ' + ctx.nearbyOrgs.join('; ') + '.');
  if ((ctx.orgCalls || []).length) lines.push('Your groups are calling for: ' + ctx.orgCalls.join('; ') + '.');
  const mem = M.recall(mind, 6);
  if (mem.length) lines.push('What you remember:\n- ' + mem.join('\n- '));
  const e = mind.emotions;
  lines.push('Last time you felt: joy ' + e.joy + ', sadness ' + e.sadness + ', fear ' + e.fear + ', anger ' + e.anger +
    ' (out of 10). Your trust in the government was ' + mind.attitudes.trust_government + '/10.');
  /* The only part of the instructions that differs between people: where
     they are when they pick up their phone. Everything else lives in the
     system message, which is identical for every resident and every round,
     so a model server reuses its cached prefix instead of reading the same
     four hundred words forty times a round. */
  lines.push('Decide now, for the next ' + (ctx.horizon || 'two years') + '. You pick up your phone ' +
             momentFor(p, f.year + (ctx.next && ctx.next.meta.month ? '-' + ctx.next.meta.month : '')) +
             '. Answer with the single JSON object described.');
  return lines.join('\n\n');
}

/* WHAT EVERY RESIDENT IS ASKED, WORD FOR WORD THE SAME
   ---------------------------------------------------------------------
   Identical for every resident in every round, so it is sent as the
   system message. Two things follow. A server that caches prompt prefixes
   (LM Studio, vLLM, SGLang) processes it once and reuses it, which is
   about half the input tokens of every call. And the instructions cannot
   drift between people, which they could when they were pasted onto the
   end of each prompt.

   Nothing here is about a particular person: their life is the user
   message, and the guard that keeps engine vocabulary out of it is
   unchanged. */
const INSTRUCTIONS = [
  'You are given one resident\'s circumstances. Decide what they will do over the period named at the end,',
  'as that person would. Be true to their circumstances and temperament. What they do is entirely',
  'up to them: it can be ordinary or unusual, something many people do or something nobody has tried.',
  '',
  'Answer with one JSON object:',
  '- thinking: one short sentence, in their voice',
  '- spend_share: share of your income you will spend rather than save (0 to 1)',
  '- work: one of ' + WORK.join(', '),
  '- actions: up to 3 things you will actually do, in your own words, each {do, target, intensity 0-1, why}.',
  '  Be concrete about what, with whom and where. If you join or start a group, name it in target.',
  '  An empty list is fine if this person would carry on as they are.',
  '- migrate: stay, consider, or leave the country',
  '- family: none or plan_child',
  '- trust_government, belonging, satisfaction: 0-10',
  '- feelings: {joy, sadness, fear, anger, disgust, surprise}, each 0-10',
  POST_INSTRUCTION
].join('\n');

const SYSTEM = 'You simulate one resident of Meridian, a city-state much like Singapore, in the 2050s. ' +
  'You only know what this person could know from their own life. Stay in character. ' +
  'Reply with a single JSON object and nothing else.\n\n' + INSTRUCTIONS;

/* ---------------------------------------------------------------------
   THE FALLBACK
   ---------------------------------------------------------------------
   Used only when the model fails for this agent, and always labelled.
   Deliberately plain: a person who gets on with life, spends according
   to income and fear, and acts only when grievance is severe. It is the
   control, not a theory of behaviour, and a run leaning on it says so.
   --------------------------------------------------------------------- */
function fallback(p, mind) {
  const fear = mind.emotions.fear / 10, g = mind.grievance / 10;
  const spend = clamp(0.92 - p.income_decile * 0.045 - fear * 0.15, 0.25, 0.95);
  const actions = [];
  if (g > 0.7 && p.traits.agreeableness <= 2) actions.push({ do: 'protest', target: 'government', intensity: 0.5, why: 'things are bad' });
  else if (g > 0.55 && p.traits.agreeableness >= 4) actions.push({ do: 'help neighbours', target: 'community', intensity: 0.4, why: 'people need help' });
  return {
    thinking: '(no model reply; baseline behaviour)', spend_share: Math.round(spend * 100) / 100,
    work: p.status === 'employed' ? 'keep' : p.status === 'unemployed' ? 'seek' : 'none',
    actions: actions,
    migrate: g > 0.8 && p.mobility > 0.6 ? 'consider' : 'stay', family: 'none',
    trust_government: mind.attitudes.trust_government, belonging: mind.attitudes.belonging,
    satisfaction: mind.attitudes.satisfaction, feelings: {}, post: ''
  };
}

async function decide(pool, p, mind, perceived, ctx) {
  const res = await pool.decide({
    key: ctx.keyPrefix + '|' + p.id,
    system: SYSTEM,
    user: buildPrompt(p, mind, perceived, ctx),
    schema: validate, jsonSchema: JSON_SCHEMA, schemaName: 'citizen_decision',
    /* Sized to what a complete decision actually needs. A model that runs
        past this was writing an essay, not deciding. */
    maxTokens: 420, seed: ctx.seed, temperature: ctx.temperature,
    log: ctx.keepTranscript !== false
  });
  if (res.data) return { decision: res.data, source: res.source };
  return { decision: fallback(p, mind), source: 'fallback', error: res.error };
}

module.exports = { perceive, buildPrompt, decide, fallback, validate, dependsOn, JSON_SCHEMA, WORK, SYSTEM,
                   INSTRUCTIONS, cleanPost, samePost, momentFor, POST_INSTRUCTION };
