/* =====================================================================
   MERIDIAN — shared by every page
   ---------------------------------------------------------------------
   THE SAVED SYSTEM
   A team's system is everything they have decided: the economy, the
   automation ceilings, how their government decides, the constitution,
   their case, and how they trade. Two copies exist:

     draft   what is on the Setup page right now, kept as you type
     saved   what you last pressed Save on

   The saved copy is the one that counts. The Simulation page, agent runs
   and the hand-in all read it, never the draft, so what a team sees
   happening is always what they have actually committed to. Saved copies
   live on the room's server too, so a team's system follows them to any
   laptop.
   ===================================================================== */

(function (root) {
'use strict';

var E = root.MeridianEngine;
var API = '/api';

var esc = function (x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var n0 = function (v) { return Math.round(v).toLocaleString('en-SG'); };
var pct = function (v) { return Math.round(v * 100) + '%'; };
var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

function lsGet(k, d) { try { var v = localStorage.getItem('mrd_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('mrd_' + k, JSON.stringify(v)); } catch (e) {} }
function ssGet(k, d) { try { var v = sessionStorage.getItem('mrd_' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function ssSet(k, v) { try { sessionStorage.setItem('mrd_' + k, JSON.stringify(v)); } catch (e) {} }

function slug(n) { return String(n || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team'; }

/* ---------------------------------------------------------------------
   THE SYSTEM
   --------------------------------------------------------------------- */
var ANGLES = [['social_welfare', 'Social welfare'], ['continuity_of_survival', 'Continuity of survival'],
              ['quality_of_life', 'Quality of life'], ['economic_profitability', 'Economic profitability']];

function defaultSystem() {
  var presets = root.MERIDIAN_PRESETS || {};
  var old = {
    levers: lsGet('levers', null), constitution: lsGet('constitution', null), harness: lsGet('harness', null)
  };
  var levers = clone(old.levers && old.levers.automation_target ? old.levers : (presets.baseline || E.DEFAULT_LEVERS));
  delete levers.policies;
  var h = old.harness || {};
  var c = old.constitution || {};
  return {
    levers: levers,
    government: {
      kind: h.kind === 'llm' ? 'llm' : 'rules',
      rules: h.rules || [],
      briefing: Object.assign({ persona: '', doctrine: '', priorities: '', trading: '' }, h.llm || {})
    },
    constitution: {
      name: c.name || '',
      commitments: (c.commitments && c.commitments.length ? c.commitments : ['', '', '']).slice(),
      rules: c.rules || [],
      policies: c.policies || ''
    },
    case: {
      rubric: Object.assign({ social_welfare: '', continuity_of_survival: '', quality_of_life: '', economic_profitability: '' }, c.rubric || {}),
      text: c.case || ''
    },
    trade: Object.assign({ style: 'reciprocal', never_sell: [] }, h.trade || {}),
    /* Behaviours this team's society invented and the team has adopted. */
    institutions: [],
    /* The team's own ways of sharing out, beyond the payment everyone gets. */
    distribution: [],
    version: 0, savedAt: null
  };
}

/* What each Setup section owns. A section's Save commits exactly these. */
var SECTIONS = [
  { id: 'economy', title: 'Economy', paths: ['levers.allocation', 'levers.corporate_tax_rate', 'levers.compute_levy',
      'levers.reskilling_spend_pct', 'levers.public_ownership_pct', 'levers.ubi_design', 'levers.working_week_days',
      'levers.care_job_guarantee', 'levers.care_guarantee_wage'] },
  { id: 'automation', title: 'AI adoption', paths: ['levers.automation_target'] },
  { id: 'government', title: 'Government', paths: ['government'] },
  { id: 'constitution', title: 'Constitution', paths: ['constitution'] },
  { id: 'case', title: 'Your case', paths: ['case'] },
  { id: 'trade', title: 'Trade', paths: ['trade'] },
  { id: 'institutions', title: 'Institutions', paths: ['institutions'] },
  { id: 'distribution', title: 'Distribution', paths: ['distribution'] }
];

function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
function setPath(o, p, v) {
  var ks = p.split('.'), last = ks.pop();
  var t = ks.reduce(function (a, k) { if (a[k] == null) a[k] = {}; return a[k]; }, o);
  if (v === undefined) delete t[last]; else t[last] = clone(v);
}
function sectionDirty(draft, saved, section) {
  return section.paths.some(function (p) { return JSON.stringify(getPath(draft, p)) !== JSON.stringify(getPath(saved, p)); });
}

var Store = {
  team: null, draft: null, saved: null, listeners: [],
  init: function () {
    this.team = ssGet('team', null) || lsGet('team', null);
    var local = this.team ? lsGet('saved_' + slug(this.team), null) : null;
    this.saved = local || defaultSystem();
    this.draft = (this.team && lsGet('draft_' + slug(this.team), null)) || clone(this.saved);
    return this.pull();
  },
  /* The server's copy wins when it is newer: another laptop saved since. */
  pull: function () {
    var self = this;
    if (!Array.isArray(this.saved.institutions)) this.saved.institutions = [];
    if (!Array.isArray(this.draft.institutions)) this.draft.institutions = [];
    if (!Array.isArray(this.saved.distribution)) this.saved.distribution = [];
    if (!Array.isArray(this.draft.distribution)) this.draft.distribution = [];
    if (!this.team) return Promise.resolve(this);
    return fetch(API + '/system?team=' + encodeURIComponent(this.team), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.system && (j.system.version || 0) > (self.saved.version || 0)) {
          var hadDraft = JSON.stringify(self.draft) !== JSON.stringify(self.saved);
          self.saved = j.system;
          lsSet('saved_' + slug(self.team), self.saved);
          if (!hadDraft) self.draft = clone(self.saved);
        }
        return self;
      }).catch(function () { return self; });
  },
  setTeam: function (name) {
    name = String(name || '').trim().slice(0, 28);
    if (!name) return Promise.resolve(this);
    this.team = name; ssSet('team', name); lsSet('team', name);
    this.saved = lsGet('saved_' + slug(name), null) || this.saved || defaultSystem();
    this.draft = lsGet('draft_' + slug(name), null) || clone(this.saved);
    fetch(API + '/teams', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: slug(name), data: { name: name, updated: Date.now() } }) }).catch(function () {});
    return this.pull();
  },
  edit: function (path, value) {
    setPath(this.draft, path, value);
    if (this.team) lsSet('draft_' + slug(this.team), this.draft);
    this.emit();
  },
  dirty: function (sectionId) {
    var self = this;
    return SECTIONS.filter(function (s) { return !sectionId || s.id === sectionId; })
      .some(function (s) { return sectionDirty(self.draft, self.saved, s); });
  },
  dirtySections: function () { var self = this; return SECTIONS.filter(function (s) { return sectionDirty(self.draft, self.saved, s); }); },
  /* Save one section (or all): copy the draft's section into the saved
     system, stamp it, and send it to the room's server. */
  save: function (sectionId) {
    var self = this;
    var next = clone(this.saved);
    SECTIONS.filter(function (s) { return !sectionId || s.id === sectionId; }).forEach(function (s) {
      s.paths.forEach(function (p) { setPath(next, p, getPath(self.draft, p)); });
    });
    next.version = (this.saved.version || 0) + 1;
    next.savedAt = Date.now();
    next.savedSections = (this.saved.savedSections || {});
    SECTIONS.filter(function (s) { return !sectionId || s.id === sectionId; }).forEach(function (s) { next.savedSections[s.id] = next.savedAt; });
    this.saved = next;
    if (this.team) { lsSet('saved_' + slug(this.team), next); lsSet('draft_' + slug(this.team), this.draft); }
    this.emit();
    if (!this.team) return Promise.resolve({ ok: true, local: true });
    return fetch(API + '/system', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ team: this.team, system: next }) })
      .then(function (r) { return { ok: r.ok }; })
      .catch(function () { return { ok: false }; });
  },
  discard: function (sectionId) {
    var self = this;
    SECTIONS.filter(function (s) { return !sectionId || s.id === sectionId; }).forEach(function (s) {
      s.paths.forEach(function (p) { setPath(self.draft, p, getPath(self.saved, p)); });
    });
    if (this.team) lsSet('draft_' + slug(this.team), this.draft);
    this.emit();
  },
  /* Pick up a save made somewhere else: another tab in this browser (from
     localStorage) or another laptop (from the server). A page opened before
     the save would otherwise keep running the version it loaded with. */
  refresh: function () {
    var self = this;
    if (!this.team) return Promise.resolve(this);
    var before = this.saved.version || 0;
    var local = lsGet('saved_' + slug(this.team), null);
    if (local && (local.version || 0) > before) {
      var hadDraft = JSON.stringify(this.draft) !== JSON.stringify(this.saved);
      this.saved = local;
      this.draft = lsGet('draft_' + slug(this.team), null) || (hadDraft ? this.draft : clone(local));
    }
    return this.pull().then(function () {
      if ((self.saved.version || 0) !== before) self.emit();
      return self;
    });
  },
  on: function (fn) { this.listeners.push(fn); },
  emit: function () { var self = this; this.listeners.forEach(function (fn) { fn(self); }); }
};

/* Another tab saved: refresh at once. Coming back to this tab: check again,
   which also catches a save from another laptop. */
try {
  root.addEventListener('storage', function (e) {
    if (Store.team && e.key === 'mrd_saved_' + slug(Store.team)) Store.refresh();
  });
  root.addEventListener('focus', function () { Store.refresh(); });
} catch (e) { /* not in a browser */ }

/* ---------------------------------------------------------------------
   POLICIES A TEAM WROTE, for the trial preview
   --------------------------------------------------------------------- */
function policiesFrom(text) {
  var found = [];
  var re = /```\s*policy\s*\n([\s\S]*?)```/gi, m;
  while ((m = re.exec(String(text || ''))) !== null) {
    var body = m[1].trim();
    try { var v = JSON.parse(body); (Array.isArray(v) ? v : [v]).forEach(function (x) { found.push(x); }); continue; } catch (e) {}
    var o = {};
    body.split(/\r?\n/).forEach(function (line) {
      var kv = /^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i.exec(line);
      if (!kv) return;
      var n = Number(kv[2]);
      o[kv[1].toLowerCase()] = isFinite(n) && kv[2].trim() !== '' ? n : kv[2].replace(/^["']|["']$/g, '');
    });
    if (Object.keys(o).length) found.push(o);
  }
  return found.map(function (p) { var v = E.validatePolicy(p); return v.ok ? v.value : { invalid: true, raw: p, reason: v.reason }; });
}

/* The physics only: twelve rounds of the saved system, nobody deciding. */
function trialRun(system, opts) {
  opts = opts || {};
  var exoAt = opts.exoAt || {};   // { round: exogenous }, e.g. agreed trades landing in the room's round
  var levers = clone(system.levers);
  levers.policies = policiesFrom(system.constitution && system.constitution.policies).filter(function (p) { return !p.invalid; });
  var base = root.MERIDIAN_BASELINE, traj = [E.seed(base)];
  var shocks = opts.shocks || {};
  /* Rules are deterministic, so the trial runs them exactly as an agent run
     does. A model briefing cannot run here: it needs the model, and it only
     governs in agent runs. */
  var g = system.government || {};
  var rulesGov = g.kind === 'rules' && (g.rules || []).length && root.MeridianRules
    ? root.MeridianRules.makePolicyHarness({ rules: root.MeridianRules.fromSetup(g.rules) }) : null;
  var governed = [{ round: 1, year: 2050, rationale: 'opening settlement', fired: [], changed: [] }];

  /* TICKS. The trial runs by the month, like an agent run: the kernel moves
     every tick and the rules are checked every tick. A stress test strikes
     in the year chosen and lasts as many months as it is given. */
  if (opts.dt && opts.dt !== 2) {
    var dt = opts.dt, perYear = Math.max(1, Math.round(1 / dt));
    var n = Math.max(1, Math.min(2880, Math.round((opts.years || 24) / dt)));
    var hit = opts.shockAt || null;
    governed[0].month = 1;
    for (var i = 1; i <= n; i++) {
      var p0 = traj[traj.length - 1];
      var yr = 2050 + Math.floor(i / perYear + 1e-9), mo = (i % perYear) + 1;
      if (rulesGov) {
        var keep0 = levers.policies, before0 = clone(levers);
        var rep0 = rulesGov({ round: i + 1, state: p0, levers: clone(levers) });
        levers = root.MeridianHarness.validateLevers(rep0.levers, levers).levers;
        levers.policies = keep0;
        governed.push({ round: i + 1, year: yr, month: mo, rationale: rep0.rationale, fired: rep0.fired || [],
                        changed: changesOf(before0, levers) });
      }
      var active = [];
      if (hit && hit.event) {
        var from = (hit.year - 2050) * perYear;
        if (i > from && i <= from + (hit.months || 12)) active.push(hit.event);
      }
      (p0._endogenousNext || []).forEach(function (x) { if (active.indexOf(x) < 0) active.push(x); });
      var nx0 = E.step(p0, levers, active.filter(E.isShock), null, { dt: dt });
      var yearEnd = nx0.meta.tick % perYear === 0;
      nx0.personas = yearEnd ? E.updatePersonas(p0.personas, nx0, p0, 1) : p0.personas;
      nx0.news = yearEnd ? E.bulletin(nx0, traj[Math.max(0, traj.length - perYear)]) : (p0.news || []);
      traj.push(nx0);
    }
    traj.government = rulesGov ? governed : null;
    traj.governmentKind = g.kind || 'rules';
    traj.ticks = true;
    return traj;
  }

  var years = Math.max(2, Math.min(120, opts.rounds || 12));
  for (var r = 1; r < years; r++) {
    var prev = traj[traj.length - 1];
    if (rulesGov) {
      var keep = levers.policies, before = clone(levers);
      var reply = rulesGov({ round: r + 1, state: prev, levers: clone(levers) });
      levers = root.MeridianHarness.validateLevers(reply.levers, levers).levers;
      levers.policies = keep;
      governed.push({ round: r + 1, year: 2048 + (r + 1) * 2, rationale: reply.rationale, fired: reply.fired || [],
                      changed: changesOf(before, levers) });
    }
    var drawn = (shocks[r + 1] || []).slice();
    (prev._endogenousNext || []).forEach(function (x) { if (drawn.indexOf(x) < 0) drawn.push(x); });
    var nx = E.step(prev, levers, drawn.filter(E.isShock), exoAt[r + 1] || null);
    nx.personas = E.updatePersonas(prev.personas, nx, prev);
    nx.news = E.bulletin(nx, prev);
    traj.push(nx);
  }
  traj.government = rulesGov ? governed : null;
  traj.governmentKind = g.kind || 'rules';
  return traj;
}

/* What moved, in words a team reads. Mirrors agents/government.js. */
function changesOf(before, after) {
  var out = [], p = function (v) { return Math.round(v * 100) + '%'; };
  ['corporate_tax_rate', 'compute_levy', 'reskilling_spend_pct', 'public_ownership_pct'].forEach(function (k) {
    if (Math.abs((after[k] || 0) - (before[k] || 0)) > 0.004) out.push(k.replace(/_/g, ' ') + ' ' + p(before[k]) + ' → ' + p(after[k]));
  });
  ['ubi_design', 'working_week_days', 'care_job_guarantee'].forEach(function (k) {
    if (before[k] !== after[k]) out.push(k.replace(/_/g, ' ') + ' ' + before[k] + ' → ' + after[k]);
  });
  ['ubi', 'infrastructure', 'reserves'].forEach(function (k) {
    if (Math.abs(after.allocation[k] - before.allocation[k]) > 0.004) out.push(k + ' share ' + p(before.allocation[k]) + ' → ' + p(after.allocation[k]));
  });
  Object.keys(after.automation_target).forEach(function (k) {
    if (Math.abs(after.automation_target[k] - before.automation_target[k]) > 0.004) out.push(k.replace(/_/g, ' ') + ' ceiling ' + p(before.automation_target[k]) + ' → ' + p(after.automation_target[k]));
  });
  return out;
}

/* ---------------------------------------------------------------------
   THE NAVIGATION BAR
   --------------------------------------------------------------------- */
var PAGES = [['setup', 'Setup', '/setup'], ['sim', 'Simulation', '/sim'], ['feed', 'Feed', '/feed'],
             ['market', 'Market', '/market'], ['reports', 'Reports', '/reports']];

function nav(active) {
  var host = document.getElementById('nav');
  if (!host) return;
  function paint() {
    var dirty = Store.dirtySections();
    var saved = Store.saved;
    var status = !Store.team ? '<span class="nav-status warn">Choose your team on Setup</span>'
      : dirty.length ? '<a class="nav-status warn" href="/setup">Unsaved: ' + esc(dirty.map(function (s) { return s.title; }).join(', ')) + '</a>'
      : saved.savedAt ? '<span class="nav-status ok">Saved ' + timeOf(saved.savedAt) + ' · version ' + saved.version + '</span>'
      : '<span class="nav-status">Nothing saved yet</span>';
    host.innerHTML =
      '<a class="nav-brand" href="/setup">Meridian</a>' +
      '<nav class="nav-links" aria-label="Pages">' + PAGES.map(function (p) {
        return '<a href="' + p[2] + '"' + (p[0] === active ? ' aria-current="page"' : '') + '>' + p[1] + '</a>';
      }).join('') + '</nav>' +
      '<div class="nav-right">' + status +
      (Store.team ? '<span class="nav-team" title="Your team">' + esc(Store.team) + '</span>' : '') + '</div>';
  }
  nav.paint = paint;
  if (!nav.listening) { Store.on(function () { nav.paint(); }); nav.listening = true; }
  paint();
}
function timeOf(ts) {
  var d = new Date(ts);
  var p = function (x) { return x < 10 ? '0' + x : '' + x; };
  var today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) + ' ') + p(d.getHours()) + ':' + p(d.getMinutes());
}

root.Meridian = {
  E: E, Store: Store, SECTIONS: SECTIONS, ANGLES: ANGLES, nav: nav, trialRun: trialRun, policiesFrom: policiesFrom,
  esc: esc, n0: n0, pct: pct, clone: clone, slug: slug, lsGet: lsGet, lsSet: lsSet, timeOf: timeOf, getPath: getPath
};
})(window);
