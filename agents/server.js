/* =====================================================================
   AGENT RUNS AND THE ORGANISERS' CONSOLE, ON THE STUDIO'S SERVER
   ---------------------------------------------------------------------
   Mounted into lab/serve-console.js. Two audiences:

   TEAMS start an agent run from the studio with their levers and their
   constitution, and watch it arrive round by round. The sliders are a
   trial space; the runs started here are the results that count.

     POST /api/runs               { team, levers, constitution, profile, rounds, population, substeps, seed }
     GET  /api/runs               list
     GET  /api/runs/:id           status, progress, and evidence when finished
     GET  /api/runs/:id/stream    server-sent progress
     POST /api/runs/:id/stop
     GET  /runs/:id               the evidence, readable
     GET  /api/runs/:id/download/report   the evidence, as a file
     GET  /api/runs/:id/download/record   settings, evidence, trace and decision log, as one file

   ORGANISERS control the room's environment. Every write needs the admin
   token printed when the server starts (or MERIDIAN_ADMIN_TOKEN).

     GET  /admin                  the console
     GET  /api/admin/director     library, fired events, weather, runs
     POST /api/admin/events       fire { event | custom, severity, duration, round, teams }
     POST /api/admin/events/cancel { id }
     POST /api/admin/weather      { enabled, rate }
     POST /api/admin/draft        { brief }  -> a validated event draft, NOT fired

   One run executes at a time by default (MERIDIAN_MAX_RUNS to raise it on
   a DGX); the rest queue, because they share one model server.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('../engine/meridian-engine.js');
const D = require('./director.js');
const EV = require('./evidence.js');
const INT = require('./interpreter.js');
const INS = require('./institutions.js');
const DIST = require('./distribution.js');
const { createPool } = require('./llm_pool.js');
const { runAgentSociety } = require('./society.js');
const { parseConstitution } = require('../harness/cabinet.js');

const ROOT = path.join(__dirname, '..');
const RUNS_DIR = path.join(ROOT, 'runs');
const PROFILES = JSON.parse(fs.readFileSync(path.join(__dirname, 'profiles.json'), 'utf8'));
const MAX_RUNS = Math.max(1, Number(process.env.MERIDIAN_MAX_RUNS) || 1);
const ROOM_SEED = Number(process.env.MERIDIAN_SEED) || 101;
const ADMIN_TOKEN = process.env.MERIDIAN_ADMIN_TOKEN || crypto.randomBytes(4).toString('hex');

/* ---------------------------------------------------------------------
   THE ROOM'S ENVIRONMENT
   ---------------------------------------------------------------------
   One director for the whole room. Scheduled events carry an absolute
   round. Events fired LIVE carry round 0, meaning "each run's next
   round": a run pins the event to whatever round it reaches next, so a
   typhoon fired mid-session lands on every running team at once even
   though their runs are at different years.
   --------------------------------------------------------------------- */
const room = D.createDirector({ seed: ROOM_SEED, schedule: [], unit: 'tick' });

function runDirector() {
  const pinned = {};
  return {
    forRound(round, team) {
      const scheduled = room.forRound(round, team);              // also draws seeded weather
      const live = room.all().filter(e => e.start === 0 && !e.cancelled &&
        (e.teams === 'all' || (team && e.teams.indexOf(team) >= 0)));
      const active = [];
      live.forEach(e => {
        if (pinned[e.id] == null) pinned[e.id] = round;
        const span = e.end - e.start;                            // duration - 1
        if (round >= pinned[e.id] && round <= pinned[e.id] + span) active.push(Object.assign({}, e, { start: pinned[e.id], end: pinned[e.id] + span }));
      });
      return scheduled.filter(e => e.start !== 0).concat(active);
    },
    all: () => room.all()
  };
}

/* ---------------------------------------------------------------------
   RUNS
   --------------------------------------------------------------------- */
const runs = new Map();
const queue = [];
let active = 0;

/* Runs outlive the server. Each finished run leaves a run.json beside its
   evidence, and the list is rebuilt from those on start, so a restart
   never takes a team's earlier runs off their Simulation page. A run that
   was mid-flight when the server stopped is listed as interrupted. */
(function restore() {
  if (!fs.existsSync(RUNS_DIR)) return;
  fs.readdirSync(RUNS_DIR).forEach(id => {
    const f = path.join(RUNS_DIR, id, 'run.json');
    if (!fs.existsSync(f)) return;
    try {
      const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (meta.status === 'running' || meta.status === 'queued') meta.status = 'interrupted';
      runs.set(id, Object.assign(meta, { progress: [], watchers: new Set(), restored: true }));
    } catch (e) { /* a torn file is skipped, not fatal */ }
  });
})();

function writeMeta(r) {
  try {
    const dir = path.join(RUNS_DIR, r.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
      id: r.id, team: r.team, status: r.status, error: r.error || null, created: r.created,
      started: r.started || null, finished: r.finished || null, settings: r.settings, round: r.round, year: r.year,
      headline: r.evidence ? r.evidence.headline : (r.headline || null)
    }, null, 2));
  } catch (e) { /* the run itself matters more than its index card */ }
}

function publicRun(r, withEvidence) {
  return {
    id: r.id, team: r.team, status: r.status, error: r.error || null,
    created: r.created, started: r.started || null, finished: r.finished || null,
    settings: r.settings, round: r.round, year: r.year, month: r.month || null, progress: r.progress.slice(-40),
    headline: r.evidence ? r.evidence.headline : (r.headline || null),
    /* Held up, and by what: paused by someone, or waiting on the model. */
    paused: !!(r.paused || (hold.paused && (r.status === 'running' || r.status === 'queued'))),
    /* Changes the team has made to this run while it was going. */
    amendments: r.amendments || 0, amendment_waiting: !!r.pendingAmendment,
    /* Stop has been pressed and the run is finishing the one call in flight. */
    stopping: !!(r.stop && (r.status === 'running' || r.status === 'queued')),
    waiting: r.status === 'running' && r.pool && r.pool.state().waiting ? r.pool.state().waiting : null,
    /* Whether a report can be opened and downloaded: the evidence is on disk. */
    report: !!r.evidence || fs.existsSync(path.join(RUNS_DIR, r.id, 'evidence.json')),
    government: r.settings && r.settings.government || null,
    evidence: withEvidence ? r.evidence : undefined
  };
}

function emit(r, event) {
  if (event.type === 'start' && event.view0) r.view = [event.view0];
  if (event.type === 'round' && event.view) { r.view = r.view || []; r.view.push(event.view); }
  r.progress.push(Object.assign({ at: Date.now() }, stripHeavy(event)));
  if (event.round) { r.round = event.round; if (event.year != null) r.year = event.year; if (event.month !== undefined) r.month = event.month || null; }
  if (event.type === 'amended') r.amendments = (r.amendments || 0) + 1;
  const line = 'data: ' + JSON.stringify(stripHeavy(event)) + '\n\n';
  r.watchers.forEach(res => { try { res.write(line); } catch (e) { r.watchers.delete(res); } });
}
function stripHeavy(e) {
  if (e.type === 'start') { const c = Object.assign({}, e); delete c.view0; return c; }
  if (e.type !== 'round') return e;
  const i = e.indicators || {};
  return { type: e.type, round: e.round, year: e.year, month: e.month || null, population: e.population, worst_essential: e.worst_essential,
           indicators: { employment_rate: i.employment_rate, effective_ubi_index: i.effective_ubi_index,
                         legitimacy: i.legitimacy, cohesion: i.cohesion, civic_unrest: i.civic_unrest,
                         ubi_monthly_sgd: i.ubi_monthly_sgd },
           polls: e.polls, events: e.events, society: e.society, industry: e.industry, agent_share: e.agent_share };
}

function pump() {
  while (active < MAX_RUNS && queue.length) {
    const r = queue.shift();
    active++;
    execute(r).finally(() => { active--; pump(); });
  }
}

/* THE ROOM CAN BE HELD. When the organiser pauses the room, every run stops
   between decisions and waits; nothing is skipped and nothing is replaced
   by a rule. The same switch is what a run waits on when the model server
   has gone away. */
const hold = { paused: false, since: null, reason: null };

async function execute(r) {
  r.status = 'running';
  r.started = Date.now();
  const dir = path.join(RUNS_DIR, r.id);
  fs.mkdirSync(dir, { recursive: true });
  let pool = null;
  try {
    writeMeta(r);
    /* A physics-only run, asked for explicitly: no model is contacted at
       all, and the evidence labels it degraded. For organisers testing the
       room, and for looking at the map without spending a GPU. */
    /* A real run INSISTS: a reply that does not validate is asked for
       again, and a model server that has gone away is waited for. No
       decision is ever handed to a rule; the run just takes longer, and
       the report says by how much. */
    pool = r.settings.noModel ? null : createPool({ mode: 'record', logPath: path.join(dir, 'decisions.jsonl'),
                        concurrency: r.settings.concurrency, insist: true,
                        shouldStop: () => r.stop, shouldPause: () => r.paused || hold.paused,
                        onWait: w => { r.waiting = w; emit(r, { type: 'waiting', reason: w.reason, attempts: w.attempts }); } });
    r.pool = pool;
    const h = pool ? await pool.health() : { up: false, error: 'physics-only run requested' };
    if (r.settings.noModel) {
      emit(r, { type: 'notice', text: 'Physics only, as requested: nobody decides, and the run is labelled degraded.' });
    } else if (!h.up) {
      if (!r.settings.allowDegraded) throw new Error('the model server is not answering (' + h.error + '). ' +
        'Start it and run again; a run without agents is not a society.');
      pool.close();
      pool = null;
      emit(r, { type: 'notice', text: 'No model: this run is physics only and will be labelled degraded.' });
    }
    const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'));
    const run = await runAgentSociety({
      base: world.states.baseline_2050, levers: r.levers, team: r.team,
      constitution: r.constitution, government: r.government, institutions: r.institutions,
      distribution: r.distribution,
      /* Whatever the team has saved for this run since the last tick. */
      takeAmendment: () => { const a = r.pendingAmendment; r.pendingAmendment = null; return a; },
      dt: 1 / 12, years: r.settings.years, every: r.settings.every, tickMs: r.settings.tickMs,
      fullLog: r.settings.fullLog, panel: r.settings.panel,
      rounds: r.settings.rounds, population: r.settings.population,
      /* Under ticks the cadence does what sub-steps used to: one pass each time people decide. */
      substeps: 1, seed: r.settings.seed, pool, director: runDirector(),
      policyReviewEvery: r.settings.policyReviewEvery, temperature: r.settings.temperature,
      onProgress: e => { if (e.type === 'round') r.waiting = null; emit(r, e); },
      shouldStop: () => r.stop, shouldPause: () => r.paused || hold.paused
    });
    r.evidence = run.evidence;
    fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(run.evidence, null, 2));
    fs.writeFileSync(path.join(dir, 'trace.json'), JSON.stringify(run.trace));
    /* Every interpretation this run used, so it can be replayed with exactly
       these meanings even after the shared cache or an override changes. */
    /* What was changed mid-run, kept so the run can be replayed with the same changes. */
    if (run.amendment_inputs && run.amendment_inputs.length) {
      fs.writeFileSync(path.join(dir, 'amendments.json'), JSON.stringify(run.amendment_inputs, null, 1));
    }
    if (run.actions && run.actions.interpretations) {
      fs.writeFileSync(path.join(dir, 'interpretations.json'), JSON.stringify(run.actions.interpretations, null, 1));
    }
    fs.writeFileSync(path.join(dir, 'view.json'), JSON.stringify(r.view || []));
    r.status = run.stopped ? 'stopped' : 'finished';
    /* A full log is the heavy part of a run; it compresses about sevenfold. */
    if (pool) pool.close();
    const raw = path.join(dir, 'decisions.jsonl');
    if (r.settings.fullLog && fs.existsSync(raw)) {
      try {
        fs.writeFileSync(raw + '.gz', require('zlib').gzipSync(fs.readFileSync(raw)));
        fs.unlinkSync(raw);
      } catch (e) { /* the uncompressed log is still there */ }
    }
  } catch (err) {
    r.status = 'failed';
    r.error = String(err && err.message || err);
    emit(r, { type: 'error', text: r.error });
  } finally {
    if (pool) pool.close();
    r.finished = Date.now();
    writeMeta(r);
    emit(r, { type: 'end', status: r.status });
    r.watchers.forEach(res => { try { res.end(); } catch (e) {} });
    r.watchers.clear();
  }
}

/** Build markdown from the studio's structured constitution, or accept markdown. */
function constitutionFrom(body) {
  if (typeof body.constitution_md === 'string' && body.constitution_md.trim()) {
    return parseConstitution(body.constitution_md, (body.team || 'team') + ' constitution');
  }
  const c = body.constitution;
  if (!c) return null;
  const lines = ['# ' + (c.name || (body.team || 'Team') + ' constitution'), ''];
  (c.commitments || []).filter(x => x && x.trim()).forEach((x, i) => lines.push((i + 1) + '. C' + (i + 1) + '. ' + x.trim()));
  (c.rules || []).forEach(rule => {
    if (!rule.assert) return;
    lines.push('', '```rule', 'when: ' + (rule.when || 'always'), 'assert: ' + rule.assert, '```');
  });
  if (c.policies && c.policies.trim()) lines.push('', c.policies.trim());
  if (c.rubric) {
    lines.push('', '```rubric');
    ['social_welfare', 'continuity_of_survival', 'quality_of_life', 'economic_profitability']
      .forEach(k => { if (c.rubric[k] != null && c.rubric[k] !== '') lines.push(k + ': ' + c.rubric[k]); });
    lines.push('```');
  }
  if (c.case && c.case.trim()) lines.push('', '## Our case', c.case.trim());
  return parseConstitution(lines.join('\n'), c.name);
}

/* ---------------------------------------------------------------------
   ROUTES
   --------------------------------------------------------------------- */
async function handle(req, res, url, helpers) {
  const p = url.pathname;
  const { json, readBody } = helpers;
  const isAdmin = () => (req.headers['x-admin-token'] || '') === ADMIN_TOKEN;

  if (p === '/admin') return page(res, 'admin.html');
  const runPage = /^\/runs\/([\w-]+)$/.exec(p);
  if (runPage) return page(res, 'run.html');

  if (p === '/api/runs' && req.method === 'POST') {
    const body = await readBody(req).catch(() => null);
    if (!body || !body.team) { json(res, 400, { error: 'a run needs a team name' }); return true; }
    const prof = Object.assign({}, PROFILES[body.profile] || PROFILES.local);
    const num = (v, d, lo, hi) => { const x = Number(v); return isFinite(x) && v !== '' && v != null ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
    const settings = {
      profile: PROFILES[body.profile] ? body.profile : 'local',
      /* THE STUDIO RUNS ON TICKS. A tick is a month; a run is as many years
         as the team asks for. `every` is who thinks on which tick, from
         the run's size. `pace: 'live'` holds each tick to the clock so a
         year takes `tickMs x 12` of real time (30 minutes by default);
         'fast' runs as quickly as the model answers. */
      tick: true,
      years: num(body.years, body.rounds ? Number(body.rounds) * 2 : 24, 1, 240),
      every: Object.assign({ residents: 3, firms: 3, government: 1 }, prof.every || {}),
      pace: body.pace === 'live' ? 'live' : 'fast',
      tickMs: body.pace === 'live' ? num(body.tickMs, prof.tickMs || 150000, 1000, 3600000) : 0,
      rounds: num(body.rounds, prof.rounds, 2, 120),
      population: num(body.population, prof.population, 24, 5000),
      substeps: num(body.substeps, prof.substeps, 1, 8),
      concurrency: num(body.concurrency, prof.concurrency, 1, 512),
      seed: num(body.seed, ROOM_SEED, 1, 1e9),
      policyReviewEvery: prof.policyReviewEvery, temperature: prof.temperature,
      allowDegraded: body.allowDegraded === true,
      noModel: body.noModel === true,
      /* Keep every resident's transcript (exactly replayable, about a
         hundred times the disk) or only a followed panel's (the default). */
      fullLog: body.fullLog === true,
      panel: num(body.panel, 20, 0, 200),
      /* Which saved version of the team's system this run used, so the
         Simulation page can say when they have saved changes since. */
      systemVersion: body.systemVersion == null ? null : Number(body.systemVersion)
    };
    let constitution = null;
    try { constitution = constitutionFrom(body); }
    catch (e) { json(res, 400, { error: 'could not read the constitution: ' + e.message }); return true; }
    const id = String(body.team).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + Date.now().toString(36);
    /* The government section the team saved: rules, or a briefing for one
       model decision-maker. Kept as sent, and named in the settings. */
    const government = body.government && (body.government.kind === 'rules' || body.government.kind === 'llm')
      ? body.government : null;
    settings.government = government ? government.kind : 'none';
    /* Behaviours this team has institutionalised, from an earlier run. */
    const institutions = INS.validateAll(body.institutions);
    settings.institutions = institutions.length;
    /* The team's own ways of sharing out, beyond the payment. */
    const distribution = DIST.validateAll(body.distribution);
    settings.schemes = distribution.length;
    settings.startedVersion = settings.systemVersion;
    const r = { id, team: String(body.team).slice(0, 40), status: 'queued', created: Date.now(), settings,
                levers: body.levers || null, constitution, government, institutions, distribution,
                pendingAmendment: null, amendments: 0, progress: [], watchers: new Set(), stop: false,
                round: 1, year: 2050, evidence: null };
    runs.set(id, r);
    queue.push(r);
    pump();
    json(res, 202, publicRun(r));
    return true;
  }
  if (p === '/api/runs' && req.method === 'GET') {
    json(res, 200, { runs: Array.from(runs.values()).map(r => publicRun(r)).reverse(), queued: queue.length, max: MAX_RUNS });
    return true;
  }
  /* DOWNLOADS. Read from the run's folder, so a report survives a restart.
     "report" is the evidence alone; "record" is everything needed to check
     or replay the run: its settings, the evidence, the kernel trace and every
     model decision. */
  const dl = /^\/api\/runs\/([\w-]+)\/download\/(report|record)$/.exec(p);
  if (dl && req.method === 'GET') {
    const dir = path.join(RUNS_DIR, dl[1]);
    const readJson = f => fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null;
    const evidence = readJson('evidence.json');
    if (!evidence) { json(res, 404, { error: 'that run has no report yet: it has not finished' }); return true; }
    let body;
    if (dl[2] === 'report') body = evidence;
    else {
      const meta = readJson('run.json') || {};
      let log = path.join(dir, 'decisions.jsonl');
      if (!fs.existsSync(log) && fs.existsSync(log + '.gz')) {
        /* Unpacked for the download only; the compressed copy stays on disk. */
        const unpacked = require('zlib').gunzipSync(fs.readFileSync(log + '.gz')).toString('utf8');
        log = path.join(require('os').tmpdir(), 'meridian-' + dl[1] + '-decisions.jsonl');
        fs.writeFileSync(log, unpacked);
      }
      body = {
        id: dl[1], team: meta.team || evidence.provenance.team, status: meta.status || null,
        created: meta.created || null, finished: meta.finished || null, settings: meta.settings || null,
        evidence: evidence, trace: readJson('trace.json'),
        decisions: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => {
          try { return JSON.parse(l); } catch (e) { return { unreadable: l }; } }) : []
      };
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="meridian-' + dl[1] + '-' + dl[2] + '.json"',
      'cache-control': 'no-store'
    });
    res.end(JSON.stringify(body, null, 2));
    return true;
  }

  const viewApi = /^\/api\/runs\/([\w-]+)\/view$/.exec(p);
  if (viewApi) {
    const r = runs.get(viewApi[1]);
    let view = r ? r.view : null;
    if (!view) {
      const f = path.join(RUNS_DIR, viewApi[1], 'view.json');
      if (/^[\w-]+$/.test(viewApi[1]) && fs.existsSync(f)) view = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    if (!view) { json(res, 404, { error: 'no view for that run' }); return true; }
    json(res, 200, { id: viewApi[1], team: r ? r.team : null, status: r ? r.status : 'finished', rounds: view });
    return true;
  }
  const runApi = /^\/api\/runs\/([\w-]+)(\/stream|\/stop|\/pause|\/resume|\/amend)?$/.exec(p);
  if (runApi) {
    let r = runs.get(runApi[1]);
    if (r && r.restored && !r.evidence) {
      const disk = loadFinished(runApi[1]);
      if (disk) r.evidence = disk.evidence;
    }
    r = r || loadFinished(runApi[1]);
    if (!r) { json(res, 404, { error: 'no such run' }); return true; }
    if (runApi[2] === '/amend' && req.method === 'POST') {
      /* The team's saved settings, applied to this run from its next tick.
         The same shape a run is started with. Nothing about the past
         changes; the run carries on from the month it is in. */
      if (r.status !== 'running' && r.status !== 'queued') {
        json(res, 409, { error: 'this run has ended; start a new one to use the new settings' }); return true;
      }
      const body = await readBody(req).catch(() => null);
      if (!body) { json(res, 400, { error: 'nothing to apply' }); return true; }
      let con = null;
      try { con = body.constitution ? constitutionFrom(body) : null; }
      catch (e) { json(res, 400, { error: 'could not read the constitution: ' + e.message }); return true; }
      const gov = body.government && (body.government.kind === 'rules' || body.government.kind === 'llm') ? body.government : null;
      /* Only what differs from what the run is using now is a change; a
         team that altered one lever has not rewritten its constitution. */
      const differs = (x, y) => JSON.stringify(x == null ? null : x) !== JSON.stringify(y == null ? null : y);
      const inst = Array.isArray(body.institutions) ? INS.validateAll(body.institutions) : null;
      const dst = Array.isArray(body.distribution) ? DIST.validateAll(body.distribution) : null;
      r.pendingAmendment = {
        version: body.systemVersion == null ? null : Number(body.systemVersion),
        note: String(body.note || '').slice(0, 200),
        levers: body.levers || null,
        government: gov && differs(gov, r.government) ? gov : null,
        constitution: con && differs(con, r.constitution) ? con : null,
        institutions: inst && differs(inst, r.institutions) ? inst : null,
        distribution: dst && differs(dst, r.distribution) ? dst : null
      };
      if (r.pendingAmendment.government) r.government = gov;
      if (r.pendingAmendment.constitution) r.constitution = con;
      if (r.pendingAmendment.institutions) r.institutions = inst;
      if (r.pendingAmendment.distribution) r.distribution = dst;
      if (body.systemVersion != null) r.settings.systemVersion = Number(body.systemVersion);
      if (gov) r.settings.government = gov.kind;
      /* "Apply and carry on": one request does both. */
      if (body.resume === true) { r.paused = false; emit(r, { type: 'resumed' }); }
      json(res, 200, { ok: true, applies: 'from the next month', paused: !!r.paused });
      return true;
    }
    if ((runApi[2] === '/pause' || runApi[2] === '/resume') && req.method === 'POST') {
      r.paused = runApi[2] === '/pause';
      emit(r, { type: r.paused ? 'paused' : 'resumed' });
      json(res, 200, { ok: true, paused: r.paused });
      return true;
    }
    if (runApi[2] === '/stop' && req.method === 'POST') {
      r.stop = true;
      const qi = queue.indexOf(r);
      if (qi >= 0) { queue.splice(qi, 1); r.status = 'stopped'; }
      json(res, 200, { ok: true, status: r.status });
      return true;
    }
    if (runApi[2] === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      r.progress.slice(-40).forEach(e => res.write('data: ' + JSON.stringify(e) + '\n\n'));
      if (r.status === 'running' || r.status === 'queued') {
        r.watchers = r.watchers || new Set();
        r.watchers.add(res);
        req.on('close', () => r.watchers.delete(res));
      } else res.end();
      return true;
    }
    json(res, 200, publicRun(r, true));
    return true;
  }

  // ---- organisers --------------------------------------------------------
  /* WHAT ACTIONS MEAN, for organisers to review. The shared cache is what
     the interpreter has learned across every run; overrides are what an
     organiser has corrected, and they always win. */
  if (p === '/api/admin/interpretations' && req.method === 'GET') {
    if (!isAdmin()) { json(res, 403, { error: 'organiser token required' }); return true; }
    const overrides = INT.readOverrides();
    const q = String(url.searchParams.get('q') || '').toLowerCase();
    const who = String(url.searchParams.get('owner') || '');
    /* The starter dictionary is everyone's; each team's own finds are
       listed under that team and are never read by another team's run. */
    const all = INT.readAll();
    Object.keys(overrides).forEach(k => { if (!all.some(x => x.key === k)) all.push({ key: k, owner: 'organiser', interpretation: overrides[k] }); });
    const rows = all.filter(x => (!who || x.owner === who) &&
      (!q || x.key.indexOf(q) >= 0 || String((overrides[x.key] || x.interpretation).label || '').indexOf(q) >= 0))
      .sort((a, b) => (a.owner === 'starter' ? 0 : 1) - (b.owner === 'starter' ? 0 : 1) || (a.key < b.key ? -1 : 1));
    json(res, 200, {
      total: rows.length, channels: INT.CHANNELS, sectors: E.ORDER,
      owners: Array.from(new Set(all.map(x => x.owner))).sort(),
      items: rows.slice(0, 300).map(x => ({ key: x.key, owner: x.owner,
                                            interpretation: overrides[x.key] || x.interpretation, overridden: !!overrides[x.key] }))
    });
    return true;
  }
  if (p === '/api/admin/interpretations' && req.method === 'POST') {
    if (!isAdmin()) { json(res, 403, { error: 'organiser token required' }); return true; }
    const body = await readBody(req).catch(() => null);
    if (!body || !body.key) { json(res, 400, { error: 'need the action key' }); return true; }
    try {
      const saved = INT.writeOverride(String(body.key), body.interpretation == null ? null : body.interpretation);
      json(res, 200, { ok: true, key: body.key, interpretation: saved, overridden: !!saved });
    } catch (e) { json(res, 400, { error: String(e && e.message) }); }
    return true;
  }

  /* Hold or release every run in the room at once. */
  if (p === '/api/admin/room' && req.method === 'GET') {
    json(res, 200, { paused: hold.paused, since: hold.since, reason: hold.reason,
                     running: Array.from(runs.values()).filter(x => x.status === 'running').map(x => ({
                       id: x.id, team: x.team, year: x.year,
                       waiting: x.pool && x.pool.state().waiting ? x.pool.state().waiting : null })) });
    return true;
  }
  if (p === '/api/admin/room' && req.method === 'POST') {
    if (!isAdmin()) { json(res, 403, { error: 'organiser token required' }); return true; }
    const body = await readBody(req).catch(() => ({}));
    hold.paused = !!body.paused;
    hold.since = hold.paused ? Date.now() : null;
    hold.reason = hold.paused ? String(body.reason || 'paused by the organiser').slice(0, 120) : null;
    runs.forEach(x => { if (x.status === 'running') emit(x, { type: hold.paused ? 'paused' : 'resumed', room: true }); });
    json(res, 200, { ok: true, paused: hold.paused });
    return true;
  }

  if (p === '/api/admin/director' && req.method === 'GET') {
    json(res, 200, {
      library: Object.keys(D.LIBRARY).map(k => ({ id: k, label: D.LIBRARY[k].label, category: D.LIBRARY[k].category,
                                                  duration: D.LIBRARY[k].duration, perceived: D.LIBRARY[k].perceived })),
      events: room.all(), weather: room.weather(), seed: ROOM_SEED,
      runs: Array.from(runs.values()).map(r => ({ id: r.id, team: r.team, status: r.status, round: r.round, year: r.year })),
      sectors: E.ORDER.map(k => ({ id: k, name: E.SECTORS[k].name })),
      effect_fields: D.EFFECT_FIELDS
    });
    return true;
  }
  if (p.indexOf('/api/admin/') === 0 && req.method === 'POST') {
    if (!isAdmin()) { json(res, 403, { error: 'organiser token required' }); return true; }
    const body = await readBody(req).catch(() => ({}));
    if (p === '/api/admin/events') {
      try {
        const spec = { event: body.custom || body.event, severity: body.severity, duration: body.duration,
                       months: body.months == null ? undefined : body.months,
                       teams: Array.isArray(body.teams) ? body.teams : null, source: body.custom ? 'organiser (custom)' : 'organiser' };
        if (body.custom) {
          const v = D.validateEvent(body.custom);
          if (!v.ok) { json(res, 400, { error: v.reason }); return true; }
          spec.event = v.value;
        }
        const ev = room.fire(spec, Number(body.round) > 0 ? Number(body.round) : 0);
        console.log('  director: fired ' + ev.label + ' (severity ' + ev.severity + ', ' + (ev.start ? 'round ' + ev.start : 'next round') + ')');
        json(res, 200, { ok: true, event: ev });
      } catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
    if (p === '/api/admin/events/cancel') { json(res, 200, { ok: room.cancel(body.id) }); return true; }
    if (p === '/api/admin/weather') { json(res, 200, { weather: room.setWeather({ enabled: !!body.enabled, rate: Math.max(0, Math.min(1, Number(body.rate) || 0.15)) }) }); return true; }
    if (p === '/api/admin/draft') {
      const pool = createPool({ mode: 'live', concurrency: 1 });
      const r = await pool.decide({
        key: 'draft|' + Date.now(), system: 'You design events for a society simulation. Reply with one JSON object only.',
        user: 'Draft an event for this brief: "' + String(body.brief || '').slice(0, 400) + '".\n' +
          'Return {"label","category","duration" (rounds, 1-4),"perceived" (what residents see and hear, 1-2 sentences),' +
          '"effects": {any of: demand {sector: multiplier}, capacity_mult {sector: multiplier}, quality {sector: points -40..40}, ' +
          'output_mult, cohesion, legitimacy, import_price, compute_price, borrowing_penalty, automation_ceiling}}.\n' +
          'Sectors: ' + E.ORDER.join(', ') + '. Multipliers near 1 (0.6-1.4). Be proportionate.',
        schema: D.validateEvent, maxTokens: 700, temperature: 0.5
      });
      json(res, r.data ? 200 : 502, r.data ? { draft: r.data, note: 'Not fired. Review it, then fire it from the console.' }
                                         : { error: 'the model could not draft an event: ' + r.error });
      return true;
    }
  }
  return false;
}

function loadFinished(id) {
  const f = path.join(RUNS_DIR, id, 'evidence.json');
  if (!/^[\w-]+$/.test(id) || !fs.existsSync(f)) return null;
  const evidence = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { id, team: evidence.provenance.team, status: 'finished', created: null, settings: {}, round: evidence.provenance.rounds,
           year: null, progress: [], evidence, watchers: new Set() };
}

function page(res, file) {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'lab', file), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('could not load ' + file + ': ' + e.message);
  }
  return true;
}

module.exports = { handle, ADMIN_TOKEN, MAX_RUNS, constitutionFrom, runDirector, room };
