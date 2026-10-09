/* =====================================================================
   AN AGENT'S INNER STATE
   ---------------------------------------------------------------------
   After AgentSociety: every citizen carries needs, emotions, attitudes
   and a memory, and they persist between decisions. Without them each
   round's agent is born yesterday, and nothing that takes years — a slow
   loss of faith, a grudge, a community that rebuilt itself — can happen.

   WHAT IS COMPUTED AND WHAT IS REPORTED
   -------------------------------------
   NEEDS are circumstance: whether rent is covered, whether the clinic
   works, whether anyone you know still has a job. Those are read off the
   agent's lived situation deterministically, because they are facts
   about a life, not feelings about it.

   EMOTIONS AND ATTITUDES are the agent's own. The model reports how the
   person feels and how far they trust the government, and that report
   is what persists, blended with what they felt before so a single
   round cannot swing a person from devotion to fury. Nothing here tells
   an agent what to feel.
   ===================================================================== */

'use strict';

const NEEDS = ['survival', 'security', 'belonging', 'esteem', 'growth'];
const EMOTIONS = ['joy', 'sadness', 'fear', 'anger', 'disgust', 'surprise'];
const MEMORY_LIMIT = 18;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const round1 = v => Math.round(v * 10) / 10;

function initMind(persona) {
  const n = persona.traits.neuroticism;
  return {
    needs: { survival: 7, security: 6, belonging: 6, esteem: 6, growth: 5 },
    emotions: { joy: 5, sadness: 2, fear: 1 + n * 0.5, anger: 1.5, disgust: 1, surprise: 2 },
    attitudes: { trust_government: 5.5, belonging: 6, satisfaction: 6 },
    memory: [],
    grievance: 0,
    last_action: null
  };
}

/**
 * Circumstance -> needs. `life` is the agent's lived situation, already
 * translated into numbers a person would notice (0-100 scales).
 */
function updateNeeds(mind, persona, life) {
  const money = clamp((life.money_index - 30) / 10, 0, 10);        // 30 -> 0, 130 -> 10
  const services = clamp((life.services_quality - 15) / 7, 0, 10);  // the services THEY use
  const work = persona.status === 'employed' ? (life.job_secure ? 8 : 5)
    : persona.status === 'unemployed' ? 2 : persona.status === 'retired' ? 6 : 5;
  const ties = clamp(life.ties_active * 1.5 + (life.in_organisation ? 2 : 0), 0, 10);
  const target = {
    survival: 0.6 * money + 0.4 * services,
    security: 0.4 * money + 0.3 * work + 0.3 * (life.shock_nearby ? 2 : 8),
    belonging: 0.7 * ties + 0.3 * clamp(life.community / 10, 0, 10),
    esteem: 0.6 * work + 0.4 * money,
    growth: 0.5 * work + 0.5 * clamp((life.services_quality - 20) / 6, 0, 10)
  };
  NEEDS.forEach(k => { mind.needs[k] = round1(mind.needs[k] + (target[k] - mind.needs[k]) * 0.5); });
  /* Grievance is the gap between what a life needs and what it has,
     weighted toward the most basic needs, and it accumulates slowly. */
  const gap = (10 - mind.needs.survival) * 0.35 + (10 - mind.needs.security) * 0.25 +
              (10 - mind.needs.esteem) * 0.2 + (10 - mind.needs.belonging) * 0.2;
  mind.grievance = round1(clamp(mind.grievance * 0.6 + gap * 0.4, 0, 10));
  return mind;
}

/** The agent's own report of how it feels, blended with what it felt. */
function applyReport(mind, decision) {
  const f = decision.feelings || {};
  EMOTIONS.forEach(k => {
    if (typeof f[k] === 'number' && isFinite(f[k])) {
      mind.emotions[k] = round1(0.4 * mind.emotions[k] + 0.6 * clamp(f[k], 0, 10));
    } else {
      mind.emotions[k] = round1(mind.emotions[k] * 0.85);   // unreported feelings fade
    }
  });
  [['trust_government', 'trust_government'], ['belonging', 'belonging'], ['satisfaction', 'satisfaction']]
    .forEach(([from, to]) => {
      const v = decision[from];
      if (typeof v === 'number' && isFinite(v)) {
        mind.attitudes[to] = round1(0.45 * mind.attitudes[to] + 0.55 * clamp(v, 0, 10));
      }
    });
  return mind;
}

function remember(mind, entry) {
  mind.memory.push(entry);
  if (mind.memory.length > MEMORY_LIMIT) {
    /* The oldest memories compress rather than vanish: a person forgets
       the details of a bad year and remembers that it was bad. */
    const old = mind.memory.splice(0, mind.memory.length - MEMORY_LIMIT + 1);
    const years = old.map(m => m.year).filter(Boolean);
    const summary = 'Earlier (' + (years.length ? years[0] + '-' + years[years.length - 1] : 'before') +
      '): ' + old.map(m => m.text).join(' ').slice(0, 280);
    mind.memory.unshift({ year: null, kind: 'summary', text: summary });
  }
  return mind;
}

/** Memory in the words an agent reads, most recent last. */
function recall(mind, n) {
  return mind.memory.slice(-(n || 8)).map(m => (m.year ? m.year + ': ' : '') + m.text);
}

module.exports = { initMind, updateNeeds, applyReport, remember, recall, NEEDS, EMOTIONS };
