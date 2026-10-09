/* =====================================================================
   INSTITUTIONS: MAKING A BEHAVIOUR PART OF THE WORLD
   ---------------------------------------------------------------------
   The society invents things nobody wrote down: repair cafes, tool
   libraries, people selling food from their kitchens. The report names
   them. This file is how a team ADOPTS one, so that it stops depending on
   whoever happened to volunteer and becomes a standing part of the
   country.

   A team may do four things with a behaviour, and only these four:

     fund       the state pays for it, so the capacity arrives whether or
                not anyone volunteers
     formalise  it is licensed and taxed: the work still happens and still
                serves people, but it stops escaping the treasury
     ease       the state provides the premises, the equipment or the time,
                so the action costs each person less and more can do it
     endorse    the government says publicly that it exists and is wanted

   WHAT A TEAM CANNOT DO is change what a behaviour MEANS. The interpreter
   is blind and global: "sell kueh to the neighbours" is informal trade in
   every team's world, and a team that adopts it can fund it, tax it,
   subsidise it or praise it, but cannot declare it to be nursing. That
   line is what keeps two teams' runs comparable.

   Adopted institutions are also VISIBLE: residents and firms are told the
   institution exists, in the team's own words. That is the point. A tool
   library nobody has heard of changes a capacity number; a tool library
   people know about changes what they decide to do next.
   ===================================================================== */

'use strict';

const E = require('../engine/meridian-engine.js');

const ADOPTIONS = {
  fund:      { label: 'funded by the state', needsBudget: true },
  formalise: { label: 'licensed and taxed', needsBudget: false },
  ease:      { label: 'made easier to do', needsBudget: true },
  endorse:   { label: 'publicly endorsed', needsBudget: false }
};

/* How much cheaper an eased behaviour is, per S$bn a year, and the floor:
   a placeholder, like the rest of the conversion constants. */
const EASE_PER_BN = 0.35;
const EASE_FLOOR = 0.25;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/** One institution, cleaned. Returns null if it cannot stand up. */
function validate(raw) {
  raw = raw || {};
  const adoption = ADOPTIONS[raw.adoption] ? raw.adoption : 'fund';
  const name = String(raw.name || '').trim().slice(0, 60);
  const sector = E.ORDER.indexOf(raw.sector) >= 0 ? raw.sector : null;
  if (!name || !sector) return null;
  return {
    id: String(raw.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40),
    name: name,
    behaviour: String(raw.behaviour || '').toLowerCase().slice(0, 48) || null,
    sector: sector,
    adoption: adoption,
    budget_bn: Math.round(clamp(Number(raw.budget_bn) || 0, 0, 60) * 100) / 100,
    mandate: String(raw.mandate || '').trim().slice(0, 300)
  };
}

function validateAll(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map(validate).filter(Boolean);
}

/**
 * compile(institutions) -> what the rest of the run needs
 *   policies   kernel policies to add to the team's own
 *   ease       behaviour label -> how much of its cost remains
 *   formal     behaviour labels whose work is now on the books
 *   visible    what residents and firms are told exists
 */
function compile(list) {
  const items = validateAll(list);
  const policies = [], ease = {}, formal = {}, visible = [];
  items.forEach(it => {
    if (it.adoption === 'fund' && it.budget_bn > 0) {
      policies.push({ type: 'institution', name: it.name, sector: it.sector,
                      budget_bn: it.budget_bn, mandate: it.mandate });
    }
    if (it.adoption === 'ease') {
      if (it.budget_bn > 0) {
        policies.push({ type: 'provide', sector: it.sector, budget_bn: Math.min(it.budget_bn, 60), name: it.name });
      }
      if (it.behaviour) ease[it.behaviour] = clamp(1 - EASE_PER_BN * it.budget_bn, EASE_FLOOR, 1);
    }
    if (it.adoption === 'formalise' && it.behaviour) formal[it.behaviour] = true;
    if (it.adoption === 'endorse') {
      policies.push({ type: 'announce', text: it.name + ': ' + (it.mandate || 'the government supports this and wants more of it') });
    }
    visible.push({ name: it.name, sector: it.sector, adoption: it.adoption, behaviour: it.behaviour,
                   budget_bn: it.budget_bn, mandate: it.mandate });
  });
  return { items, policies, ease, formal, visible };
}

/** What a resident would say exists in their country. Plain words, no figures. */
function forPeople(visible) {
  if (!visible || !visible.length) return [];
  return visible.map(v => {
    const what = v.mandate ? v.mandate : 'for ' + E.SECTORS[v.sector].name.toLowerCase();
    const how = v.adoption === 'fund' ? 'paid for by the government'
      : v.adoption === 'formalise' ? 'now licensed, so it is legal and taxed'
      : v.adoption === 'ease' ? 'supported by the government, so it costs you less to take part'
      : 'publicly backed by the government';
    return v.name + ' (' + how + '): ' + what;
  });
}

/** What a firm would know about them: a competitor, a customer, or a rule. */
function forFirms(visible) {
  if (!visible || !visible.length) return [];
  return visible.filter(v => v.adoption !== 'endorse')
    .map(v => v.name + ' in ' + E.SECTORS[v.sector].name + ' (' + ADOPTIONS[v.adoption].label +
              (v.budget_bn ? ', S$' + v.budget_bn + 'bn a year' : '') + ')');
}

/**
 * What a team should be offered for a behaviour the run produced: the
 * sector it acts in, the adoption that fits what it does, and a budget in
 * proportion to how many people were already doing it.
 */
function draftFrom(behaviour) {
  const channels = behaviour.what_it_did || [];
  const sectorOf = c => (c.indexOf(':') > 0 ? c.split(':')[1] : null);
  const sector = channels.map(sectorOf).find(Boolean) || 'public_admin';
  const has = c => channels.some(x => x.split(':')[0] === c);
  const adoption = has('informal_production') ? 'formalise'
    : has('time_to_sector') ? 'fund'
    : has('organise') ? 'ease'
    : 'endorse';
  const share = behaviour.peak_share || 0;
  return {
    sector: sector,
    adoption: adoption,
    budget_bn: adoption === 'formalise' || adoption === 'endorse' ? 0 : Math.max(0.2, Math.round(share * 0.05 * 10) / 10),
    name: behaviour.label.replace(/^(\w)/, c => c.toUpperCase()),
    behaviour: behaviour.label,
    mandate: ''
  };
}

module.exports = { ADOPTIONS, validate, validateAll, compile, forPeople, forFirms, draftFrom, EASE_PER_BN };
