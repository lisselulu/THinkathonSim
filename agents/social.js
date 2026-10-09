/* =====================================================================
   A SOCIETY BETWEEN THE AGENTS
   ---------------------------------------------------------------------
   Light Society's clearest finding was that the shape of the network
   drove outcomes as much as agent behaviour did. Movements, rumours,
   panics and solidarity all travel between people; without something to
   travel along, a population is a set of strangers deciding in parallel.

   Three structures:

   THE GRAPH. Each persona knows people through a household or
   neighbourhood (same region, similar housing), a workplace (same
   sector), and loosely online (similar age, any region). Built once from
   the seed, so every team's society has the same acquaintances.

   THE BUS. What someone posts this sub-step reaches the people who know
   them next sub-step, strongest ties first. Organisations broadcast to
   their members. Nothing is global unless it is news.

   ORGANISATIONS. Formed and joined by agents, by name. A union, a
   co-operative, a residents' group, a protest movement. Members pool
   their weight, and when a clear majority of an organisation's members
   choose the same collective action, the organisation acts, carrying
   members who were wavering. That is the whole mechanism of coordination,
   and it is why a union strike is not the sum of individual walkouts.
   ===================================================================== */

'use strict';

const { rng, derive } = require('./rng.js');

const TIE = { household: 1.0, workplace: 0.7, online: 0.35 };

function buildGraph(personas, opts) {
  opts = opts || {};
  const r = rng(derive(opts.seed == null ? 1 : opts.seed, 'graph'));
  const edges = {};
  personas.forEach(p => { edges[p.id] = []; });
  const link = (a, b, kind) => {
    if (a.id === b.id) return;
    if (edges[a.id].some(e => e.to === b.id)) return;
    edges[a.id].push({ to: b.id, kind, strength: TIE[kind] });
    edges[b.id].push({ to: a.id, kind, strength: TIE[kind] });
  };
  const byRegion = group(personas, p => p.region + ':' + (p.housing.indexOf('hdb') === 0 ? 'hdb' : 'private'));
  const bySector = group(personas.filter(p => p.sector), p => p.sector);
  const byAge = group(personas, p => Math.floor(p.age / 15));

  personas.forEach(p => {
    const near = byRegion[p.region + ':' + (p.housing.indexOf('hdb') === 0 ? 'hdb' : 'private')] || [];
    r.shuffle(near).slice(0, 3).forEach(q => link(p, q, 'household'));
    if (p.sector) r.shuffle(bySector[p.sector] || []).slice(0, 3).forEach(q => link(p, q, 'workplace'));
    const peers = byAge[Math.floor(p.age / 15)] || [];
    r.shuffle(peers).slice(0, 2 + p.traits.extraversion % 3).forEach(q => link(p, q, 'online'));
  });
  return edges;
}

function group(list, keyOf) {
  const out = {};
  list.forEach(x => { const k = keyOf(x); (out[k] = out[k] || []).push(x); });
  return out;
}

/* ---------------------------------------------------------------------
   THE MESSAGE BUS
   --------------------------------------------------------------------- */
function createBus() {
  let pending = [];
  const delivered = {};
  return {
    post(from, text, meta) {
      const t = String(text || '').trim();
      if (!t) return;
      pending.push(Object.assign({ from, text: t.slice(0, 280) }, meta || {}));
    },
    /** Move this sub-step's posts to inboxes along the graph. */
    deliver(graph, orgs, perInbox) {
      Object.keys(delivered).forEach(k => { delivered[k] = []; });
      const limit = perInbox || 5;
      pending.forEach(msg => {
        (graph[msg.from] || []).forEach(e => {
          (delivered[e.to] = delivered[e.to] || []).push({ from: msg.from, text: msg.text, kind: e.kind,
                                                            strength: e.strength, name: msg.name });
        });
        (msg.orgs || []).forEach(orgName => {
          const org = orgs.get(orgName);
          if (!org) return;
          org.members.forEach(m => {
            if (m === msg.from) return;
            (delivered[m] = delivered[m] || []).push({ from: msg.from, text: msg.text, kind: 'organisation',
                                                        strength: 0.8, name: msg.name, org: org.name });
          });
        });
      });
      Object.keys(delivered).forEach(k => {
        delivered[k].sort((a, b) => b.strength - a.strength);
        delivered[k] = delivered[k].slice(0, limit);
      });
      const count = pending.length;
      pending = [];
      return count;
    },
    inbox(id) { return delivered[id] || []; },
    /** How many people each author reached, for the evidence report. */
    reach(graph, id) { return (graph[id] || []).length; }
  };
}

/* ---------------------------------------------------------------------
   ORGANISATIONS
   --------------------------------------------------------------------- */
function normaliseOrgName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an) /, '').slice(0, 60);
}

/* The words that make a group what it is. "community support group" and
   "a local community group to support each other" are one group; a live
   run founded them separately and every organisation ended with a single
   member. */
const ORG_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'each', 'other', 'our', 'my', 'local', 'group',
  'groups', 'meridian', 'association', 'network', 'club', 'committee', 'society', 'in', 'at', 'with', 'new', 'support']);
function orgTokens(name) {
  return normaliseOrgName(name).split(' ').filter(t => t.length > 2 && !ORG_STOP.has(t))
    .map(t => t.replace(/(ers|ies|s)$/, ''));
}
function similar(a, b) {
  const A = new Set(orgTokens(a)), B = new Set(orgTokens(b));
  if (!A.size || !B.size) return normaliseOrgName(a) === normaliseOrgName(b) ? 1 : 0;
  let both = 0;
  A.forEach(t => { if (B.has(t)) both++; });
  return both / Math.min(A.size, B.size);
}

function createOrganisations() {
  const orgs = new Map();
  return {
    get: name => orgs.get(normaliseOrgName(name)),
    all: () => Array.from(orgs.values()),
    join(persona, rawName, kind, year) {
      let key = normaliseOrgName(rawName);
      if (!key) return null;
      /* Join the existing group this name most plausibly means. */
      if (!orgs.has(key)) {
        let best = null, bestScore = 0;
        orgs.forEach((o, k) => { const sc = similar(rawName, o.label); if (sc > bestScore) { best = k; bestScore = sc; } });
        if (best && bestScore >= 0.6) key = best;
      }
      let org = orgs.get(key);
      if (!org) {
        org = { name: key, label: String(rawName).trim().slice(0, 60), kind: kind || 'group',
                founded: year, founder: persona.id, members: [], sectors: {}, weight: 0 };
        orgs.set(key, org);
      }
      if (org.members.indexOf(persona.id) < 0) {
        org.members.push(persona.id);
        org.weight += persona.weight;
        if (persona.sector) org.sectors[persona.sector] = (org.sectors[persona.sector] || 0) + persona.weight;
      }
      return org;
    },
    leave(persona, rawName) {
      const org = orgs.get(normaliseOrgName(rawName));
      if (!org) return;
      const i = org.members.indexOf(persona.id);
      if (i >= 0) {
        org.members.splice(i, 1);
        org.weight -= persona.weight;
        if (persona.sector) org.sectors[persona.sector] -= persona.weight;
      }
    },
    membershipOf(id) { return Array.from(orgs.values()).filter(o => o.members.indexOf(id) >= 0).map(o => o.name); },
    /** Groups the people someone knows belong to, largest first. */
    nearby(graph, id) {
      const known = new Set((graph[id] || []).map(e => e.to));
      return Array.from(orgs.values())
        .filter(o => o.members.indexOf(id) < 0 && o.members.some(m => known.has(m)))
        .sort((a, b) => b.members.length - a.members.length).slice(0, 3)
        .map(o => o.label + ' (' + o.members.length + ' member' + (o.members.length > 1 ? 's' : '') + ')');
    },
    /** Drop organisations nobody belongs to any more. */
    prune() { Array.from(orgs.keys()).forEach(k => { if (!orgs.get(k).members.length) orgs.delete(k); }); },
    get size() { return orgs.size; }
  };
}

module.exports = { buildGraph, createBus, createOrganisations, normaliseOrgName, similar, TIE };
