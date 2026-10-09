/* =====================================================================
   DISTRIBUTION: A TEAM'S OWN WAYS OF SHARING OUT
   ---------------------------------------------------------------------
   The simulation comes with one way of distributing what the machines
   make: a payment to everyone. That is a choice, not a law of nature, and
   a team may add its own.

   A SCHEME pays people for what they DO. The example that started this:
   people who give their time to community work earn a credit, and the
   credit exchanges for money. A scheme says

     what earns it     giving time to an industry (which ones), building
                       ties between people, organising a group
     how much          credits per hour, and what a credit is worth
     up to what        a monthly cap, so nobody lives at the soup kitchen
     who pays          the payment's own pot (it redistributes: everyone's
                       payment falls a little and goes to those who earned
                       it) or the budget (new money, an obligation)

   WHAT A SCHEME CANNOT DO is decide what an action means. Whether "run a
   repair cafe" counts as giving time to housing is the interpreter's
   reading, the same for every team. A team chooses what to reward, not
   what things are.

   Schemes only act where people act: in agent runs. Nothing here is a
   formula for how many people will take part. People are told the scheme
   exists, in the team's own terms, and decide for themselves.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');

const HOURS_PER_MONTH = 52 / 12;      // a weekly hour, over a month
const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const num = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };

/** One scheme, cleaned. Null if it cannot stand up. */
function validate(raw) {
  raw = raw || {};
  const name = String(raw.name || '').trim().slice(0, 50);
  if (!name) return null;
  const e = raw.earns || {};
  /* The Setup form offers "any" or one industry; a list is accepted too. */
  const picked = e.sector_choice && e.sector_choice !== 'all' ? [e.sector_choice] : e.sectors;
  const sectors = picked === 'all' || picked == null ? 'all'
    : (Array.isArray(picked) ? picked.filter(k => E.ORDER.indexOf(k) >= 0) : 'all');
  const earns = { time: e.time !== false, sectors: Array.isArray(sectors) && !sectors.length ? 'all' : sectors,
                  ties: !!e.ties, organising: !!e.organising };
  if (!earns.time && !earns.ties && !earns.organising) return null;
  return {
    id: String(raw.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40),
    name: name,
    earns: earns,
    credits_per_hour: Math.round(clamp(num(raw.credits_per_hour, 1), 0.1, 20) * 100) / 100,
    sgd_per_credit: Math.round(clamp(num(raw.sgd_per_credit, 10), 0.5, 200) * 100) / 100,
    cap_credits_month: Math.round(clamp(num(raw.cap_credits_month, 60), 1, 400)),
    funding: raw.funding === 'budget' ? 'budget' : 'payment',
    note: String(raw.note || '').trim().slice(0, 200)
  };
}

function validateAll(list) {
  return (Array.isArray(list) ? list : []).slice(0, 6).map(validate).filter(Boolean);
}

/** Does this action, as interpreted, earn under this scheme? */
function qualifies(interpretation, scheme) {
  return (interpretation.effects || []).some(e => {
    if (!(e.amount > 0)) return false;
    if (e.channel === 'time_to_sector') {
      return scheme.earns.time && (scheme.earns.sectors === 'all' || scheme.earns.sectors.indexOf(e.sector) >= 0);
    }
    if (e.channel === 'cohesion') return scheme.earns.ties;
    if (e.channel === 'organise') return scheme.earns.organising;
    return false;
  });
}

/** What one person earns a month under a scheme, from their qualifying hours a week. */
function payout(scheme, hoursPerWeek) {
  const credits = Math.min(scheme.cap_credits_month, hoursPerWeek * HOURS_PER_MONTH * scheme.credits_per_hour);
  return { credits: Math.round(credits * 10) / 10, sgd_month: Math.round(credits * scheme.sgd_per_credit) };
}

/** A scheme, as a resident would have it explained to them. */
function describe(s) {
  const what = [];
  if (s.earns.time) {
    what.push(s.earns.sectors === 'all' ? 'giving your time to community work of any kind'
      : 'giving your time to ' + s.earns.sectors.map(k => E.SECTORS[k].name.toLowerCase()).join(' or '));
  }
  if (s.earns.ties) what.push('bringing people together');
  if (s.earns.organising) what.push('organising a group');
  const each = Math.round(s.credits_per_hour * s.sgd_per_credit * 10) / 10;
  return s.name + ': you earn it by ' + what.join(', or ') + '. Each hour is worth about S$' + each +
    ', up to about S$' + Math.round(s.cap_credits_month * s.sgd_per_credit) + ' a month.' +
    (s.funding === 'payment' ? ' It is paid out of the same pot as the monthly payment.' : '') +
    (s.note ? ' ' + s.note : '');
}
function forPeople(schemes) { return (schemes || []).map(describe); }

/** What someone earned last time, in a sentence. */
function earnedWords(earned) {
  const got = (earned || []).filter(x => x.sgd_month > 0);
  if (!got.length) return null;
  return 'Last time you earned about ' + got.map(x => 'S$' + x.sgd_month + ' a month in ' + x.name).join(' and ') + '.';
}

module.exports = { validate, validateAll, qualifies, payout, describe, forPeople, earnedWords, HOURS_PER_MONTH };
