/* =====================================================================
   THE BOARD, SERVED LOCALLY
   ---------------------------------------------------------------------
   Same Team Console, same market bulletin, but the shared state lives in
   this process instead of in a hosted database. No accounts, no
   organisation, no internet — one laptop runs it and everyone in the room
   points a browser at it.

     node lab/serve-console.js
     node lab/serve-console.js --port 8080
     node lab/serve-console.js --reset      (empty the board first)

   It prints the address to hand round. Teams open it, pick a society, and
   trade. State is written to lab/.board.json after every change, so
   closing the laptop lid does not lose the morning.

   No dependencies. Node's own http module and nothing else.
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildStudio } = require('./build-studio.js');
const { buildFeed } = require('./build-feed.js');
const E_ = require('../engine/meridian-engine.js');
const FEED = require('./feed.js');
const FEEDLLM = require('./feed-llm.js');
const SOCIETY = require('./society-feed.js');
const DECIDE = require('../engine/decide.js');
/* Agent runs and the organisers' console. See agents/server.js. */
const AGENTS = require('../agents/server.js');
/* The three pages: Setup, Simulation, Market. See lab/app/pages.js. */
const PAGES = require('./app/pages.js');

/* Where the Concordia sidecar is, if anyone started one. Overridden
   with --agents <url>; the page never chooses the address, only
   whether to use agents at all. */
const AGENTS_URL = process.env.MERIDIAN_AGENTS_URL || null;

/* The model client is optional and lazy: the server must start, and the
   feed must render, on a machine with nothing listening on any port but
   this one. */
let _llm = null, _llmTried = false;
function llmClient() {
  if (_llmTried) return _llm;
  _llmTried = true;
  try { _llm = require('../harness/llm_client.js').createClient(); }
  catch (e) { _llm = null; }
  return _llm;
}

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(argOf('--port', 7823));
const STORE = path.join(__dirname, '.board.json');
const PAGE = path.join(__dirname, 'console.html');

/* --- the board ------------------------------------------------------- */
/* THE ROUND CLOCK.
   Twelve rounds, twenty-four simulated years, and a wall clock mapping one
   onto the other. The default is two hours a round — one simulated year an
   hour, which puts the whole run at twenty-four hours of event time and
   about three rounds a day across the run days.

   The point of a clock rather than a button is that time passes whether a
   team is ready or not. A forward signed at ten comes due at two. That is
   the actual pressure of governing, and no amount of deliberation buys you
   out of it. */
const DEFAULT_ROUND_MS = 2 * 60 * 60 * 1000;   // two hours

let board = {
  teams: {}, posts: {}, messages: {}, round: 1, rev: 0,
  clock: { lengthMs: DEFAULT_ROUND_MS, startedAt: null, running: false, autoAdvance: true }
};
if (!args.includes('--reset') && fs.existsSync(STORE)) {
  try {
    board = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    if (!board.clock) board.clock = { lengthMs: DEFAULT_ROUND_MS, startedAt: null,
                                      running: false, autoAdvance: true };
    // A clock that was running when the lid closed should not silently
    // burn through six rounds while nobody was watching.
    if (board.clock.running) { board.clock.startedAt = Date.now(); }
  } catch (e) { console.log('  (could not read ' + STORE + ', starting fresh)'); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STORE, JSON.stringify(board, null, 2), () => {});
  }, 250);
}

/* --- everyone currently watching ------------------------------------- */
const watchers = new Set();
function broadcast() {
  board.rev++;
  const payload = 'data: ' + JSON.stringify({ rev: board.rev }) + '\n\n';
  watchers.forEach(res => { try { res.write(payload); } catch (e) { watchers.delete(res); } });
  save();
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* How long this round has left, in ms. null when the clock is not running. */
function remainingMs() {
  const c = board.clock;
  if (!c || !c.running || !c.startedAt) return null;
  return Math.max(0, c.lengthMs - (Date.now() - c.startedAt));
}

/* Checked once a second. Advances at most ONE round per tick, so a laptop
   that slept does not fast-forward the whole Thinkathon. */
setInterval(() => {
  const c = board.clock;
  if (!c || !c.running || !c.autoAdvance || !c.startedAt) return;
  if (Date.now() - c.startedAt < c.lengthMs) return;

  if (board.round >= 12) {
    c.running = false;
    console.log('  clock: 2074 reached, the run is over');
  } else {
    board.round += 1;
    c.startedAt = Date.now();
    console.log('  clock: round ' + board.round + ' (' + (2048 + board.round * 2) + ')');
  }
  broadcast();
}, 1000);

/* --- the page, with the local backend switched on --------------------- */
function servePage(res) {
  /* Built fresh on every request: the engine, the market and the baseline
     are inlined into the page, so a team's console runs its own society
     rather than being a noticeboard. Rebuilding per request means editing
     console.html and hitting reload is the whole development loop. */
  let html;
  try { html = buildStudio({ localBoard: '/api' }); }
  catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('could not build the console: ' + e.message);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#EDE8DC}' +
    'img{max-width:100%}[hidden]{display:none!important}</style>' +
    '</head><body>' + html + '</body></html>');
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* --- routes ----------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  /* The old single-screen studio, kept for anyone mid-exercise. */
  if (p === '/classic' || p === '/index.html') return servePage(res);
  if (PAGES.handle(req, res, url)) return;

  /* A team's SAVED system: what the Simulation page and agent runs use.
     Kept with the team on the board, so it survives a restart and
     follows the team to another laptop. Only ever replaced whole, and
     only by a newer version, so two laptops cannot quietly interleave. */
  if (p === '/api/system' && req.method === 'GET') {
    const id = String(url.searchParams.get('team') || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const t = board.teams[id];
    return json(res, 200, { team: id, system: t && t.system ? t.system : null });
  }
  if (p === '/api/system' && req.method === 'POST') {
    const b = await readBody(req).catch(() => null);
    if (!b || !b.team || !b.system) return json(res, 400, { error: 'need a team and a system' });
    const id = String(b.team).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const have = board.teams[id] && board.teams[id].system;
    if (have && (have.version || 0) > (b.system.version || 0)) {
      return json(res, 409, { error: 'a newer version was saved from another screen', system: have });
    }
    board.teams[id] = Object.assign({ _id: id, name: String(b.team).slice(0, 28) }, board.teams[id], { system: b.system, updated: Date.now() });
    broadcast();
    return json(res, 200, { ok: true, version: b.system.version });
  }

  /* THE FEED, on its own page.
     A peripheral data source, not a control surface — it belongs on the
     projector at the front of the room while teams work on their
     dashboards. Query string picks the government it is watching:
       /feed                      a resilient country on a four-day week
       /feed?scenario=doom_loop_2068&week=5
     Built fresh per request like the studio, so editing feed.html and
     hitting reload is the whole loop. */
  /* Posts for one round, as JSON. `voice=1` asks the model for the
     wording; without it, or if the model is unreachable, the templated
     text is returned and the page is none the wiser. */
  /* Posts for one round of a REAL RUN.
       ?decider=concordia   the sidecar's agents decide
       ?decider=arithmetic  the deterministic baseline (default)
       ?voice=1             ask a model for the wording

     The run is the closed loop from harness/loop.js, so what a citizen
     chose in round 4 is already in the country by round 5. It used to
     be `runTrajectory` followed by `feedFor`, which computed twelve
     rounds before anybody reacted to the first one and left no seam an
     agent could plug into.

     Runs are cached per (scenario, week, rounds, decider, seed).
     Scrubbing between rounds must show two views of ONE country, and
     with agents carrying memory against a non-deterministic local
     model, recomputing per request would hand back a different country
     each time. */
  if (p === '/api/feed') {
    try {
      /* A POST carries the studio's live levers, so agents react to
         the TEAM'S country rather than a demo scenario. GET keeps
         working for the scenario case and for anything scripted. */
      const body = req.method === 'POST' ? await readBody(req) : {};
      const scenario = url.searchParams.get('scenario') || 'resilient_2074';
      const week = Number(url.searchParams.get('week')) || 4;
      const round = Math.max(2, Math.min(12,
        Number(url.searchParams.get('round') || body.round) || 2));
      const wantVoice = url.searchParams.get('voice') === '1';
      const wantAgents = url.searchParams.get('decider') === 'concordia' ||
                         body.decider === 'concordia';
      const faults = [];

      let decide = DECIDE.deterministic();
      if (wantAgents) {
        const remote = DECIDE.remote({
          url: AGENTS_URL || 'http://127.0.0.1:8765',
          onFault: f => faults.push(f)
        });
        const h = await remote.health();
        /* Asked for agents and cannot have them: say so in the reply
           rather than quietly serving arithmetic under an "agents"
           label. A page that cannot tell the two apart is worse than a
           page with only one of them. */
        if (h.ok && h.can_decide) decide = remote;
        else faults.push('agents unavailable: ' + (h.detail || h.model_error ||
          (h.concordia_installed === false ? 'concordia not installed' : 'not ready')));
      }

      const run = await SOCIETY.cachedRun({
        scenario: scenario, week: week, rounds: 12,
        decider: (decide.source === 'concordia' ? 'concordia' : 'deterministic'),
        decide: decide,
        levers: body.levers || null,
        shocks: body.shocks || null
      });

      /* EVERY ROUND IN ONE REPLY.
         The run is already computed and cached in full, and scrubbing
         between years is the whole interaction on this page. Fetching
         one round at a time made every click wait on a round trip for
         data the server was already holding. */
      if (url.searchParams.get('all') === '1' || body.all === true) {
        return json(res, 200, {
          rounds: run.rounds, decidedBy: run.decidedBy,
          askedForAgents: wantAgents,
          watching: body.levers ? 'your society' : 'demo scenario',
          faults: faults.concat((run.faults || []).slice(0, 4).map(x =>
            typeof x === 'string' ? x : (x.fault || JSON.stringify(x))))
        });
      }

      let f = run.rounds[round];
      if (!f) return json(res, 404, { error: 'no such round: ' + round });

      /* Voicing is per request and never cached with the run: the words
         are dressing, and a team toggling voice must not silently get a
         different country's decisions along with the better prose. */
      if (wantVoice) {
        const c = llmClient();
        if (!c) faults.push('no model configured');
        else {
          const prev = run.trajectory[round - 2], next = run.trajectory[round - 1];
          f = await FEEDLLM.voiceFeed(f, prev, next,
            { client: c, onFault: x => faults.push(x) });
        }
      }

      return json(res, 200, {
        round: f.round, year: f.year, posts: f.posts,
        trending: f.trending, mood: f.mood,
        source: f.source || 'template',
        decidedBy: run.decidedBy,
        watching: body.levers ? 'your society' : 'demo scenario',
        askedForAgents: wantAgents,
        faults: faults.concat((run.faults || []).slice(0, 4).map(x =>
          typeof x === 'string' ? x : (x.fault || JSON.stringify(x))))
      });
    } catch (e) {
      return json(res, 500, { error: String(e && e.message) });
    }
  }

  /* Throw away cached runs, so a team can ask the agents again without
     restarting the server. */
  if (p === '/api/feed/reset') {
    const what = SOCIETY.invalidate(null);
    return json(res, 200, { cleared: what, cache: SOCIETY.cacheState() });
  }

  if (p === '/classic/feed') {
    try {
      const html = buildFeed({
        scenario: url.searchParams.get('scenario') || 'resilient_2074',
        workingWeek: Number(url.searchParams.get('week')) || 4
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('could not build the feed: ' + e.message);
    }
  }

  if (p === '/api/state') {
    return json(res, 200, {
      rev: board.rev,
      round: board.round || 1,
      clock: Object.assign({}, board.clock, { remainingMs: remainingMs(), serverNow: Date.now() }),
      teams: Object.values(board.teams),
      posts: Object.entries(board.posts).map(([id, v]) => Object.assign({ _id: id }, v)),
      messages: Object.entries(board.messages).map(([id, v]) => Object.assign({ _id: id }, v))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    });
  }

  /* Server-sent events: one long-lived response per open console, poked
     whenever anything changes. Cheaper and simpler than polling, and it
     means a posted offer lands on the other screen immediately. */
  if (p === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    watchers.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(ping); watchers.delete(res); });
    return;
  }

  if (req.method === 'POST' && p === '/api/teams') {
    const b = await readBody(req).catch(() => null);
    if (!b || !b.id) return json(res, 400, { error: 'need an id' });
    board.teams[b.id] = Object.assign({}, board.teams[b.id], b.data || {}, { _id: b.id });
    broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/posts') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, 400, { error: 'bad body' });
    const id = uid();
    board.posts[id] = b.data || {};
    broadcast();
    return json(res, 200, { ok: true, id: id });
  }

  if (req.method === 'PATCH' && p.startsWith('/api/posts/')) {
    const id = decodeURIComponent(p.slice('/api/posts/'.length));
    if (!board.posts[id]) return json(res, 404, { error: 'no such offer' });
    const b = await readBody(req).catch(() => null);
    board.posts[id] = Object.assign({}, board.posts[id], (b && b.data) || {});
    broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/messages') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, 400, { error: 'bad body' });
    board.messages[uid()] = b.data || {};
    broadcast();
    return json(res, 200, { ok: true });
  }

  /* Advancing the round moves every society on the board forward together.
     One clock for the room, held by the server rather than by whichever
     browser happens to be looking. */
  if (req.method === 'POST' && p === '/api/round') {
    const b = await readBody(req).catch(() => null);
    const r = Math.max(1, Math.min(12, Math.round(Number(b && b.round) || 1)));
    board.round = r;
    // A hand-advanced round starts its clock afresh; a countdown that
    // carried on from the last round would be lying.
    if (board.clock && board.clock.running) board.clock.startedAt = Date.now();
    broadcast();
    console.log('  round -> ' + r);
    return json(res, 200, { ok: true, round: r });
  }

  /* The facilitator's clock. Everything here is deliberate — a running
     clock is the difference between a simulation and a spreadsheet. */
  if (req.method === 'POST' && p === '/api/clock') {
    const b = await readBody(req).catch(() => null);
    const c = board.clock;
    const act = b && b.action;
    if (act === 'start') {
      c.running = true;
      c.startedAt = Date.now();
    } else if (act === 'pause') {
      // Keep what is left of the round, so resuming does not gift anyone time.
      const left = remainingMs();
      c.running = false;
      c.pausedWith = left == null ? c.lengthMs : left;
    } else if (act === 'resume') {
      c.running = true;
      c.startedAt = Date.now() - (c.lengthMs - (c.pausedWith == null ? c.lengthMs : c.pausedWith));
    } else if (act === 'restart') {
      c.startedAt = Date.now();
      c.running = true;
    } else if (act === 'length') {
      /* Minutes for a real run; seconds for a dry run. Showing a room the
         whole twenty-four years in six minutes is worth more than
         describing it, so short rounds are a supported setting rather
         than a debugging hack. */
      const ms = b.seconds != null
        ? Math.max(5, Math.min(3600, Math.round(Number(b.seconds)))) * 1000
        : Math.max(1, Math.min(600, Math.round(Number(b.minutes) || 120))) * 60 * 1000;
      c.lengthMs = ms;
      if (c.running) c.startedAt = Date.now();
    } else if (act === 'auto') {
      c.autoAdvance = !!b.on;
    }
    broadcast();
    return json(res, 200, { ok: true, clock: Object.assign({}, c, { remainingMs: remainingMs() }) });
  }

  if (req.method === 'POST' && p === '/api/reset') {
    board = { teams: {}, posts: {}, messages: {}, round: 1, rev: board.rev,
              clock: { lengthMs: DEFAULT_ROUND_MS, startedAt: null,
                       running: false, autoAdvance: true } };
    broadcast();
    return json(res, 200, { ok: true });
  }

  if (await AGENTS.handle(req, res, url, { json, readBody })) return;

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

/* --- go ---------------------------------------------------------------- */
function addresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(a => {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    });
  });
  return out;
}

server.listen(PORT, () => {
  const bar = '='.repeat(66);
  console.log('\n' + bar);
  console.log('  MERIDIAN STUDIO — served locally');
  console.log(bar);
  console.log('\n  On this machine:   http://localhost:' + PORT);
  const ips = addresses();
  if (ips.length) {
    console.log('\n  Hand this to the room (same wifi):');
    ips.forEach(ip => console.log('     http://' + ip + ':' + PORT));
  } else {
    console.log('\n  No network address found — others will not be able to reach this.');
  }
  const cm = Math.round((board.clock.lengthMs || 0) / 60000);
  console.log('\n  Clock:   ' + cm + ' minutes a round (' +
    (cm * 12 / 60).toFixed(1) + ' hours for the whole run), ' +
    (board.clock.running ? 'running' : 'not started'));
  console.log('  Board:   round ' + (board.round || 1) + ' · ' +
    Object.keys(board.teams).length + ' teams, ' +
    Object.keys(board.posts).length + ' offers, ' +
    Object.keys(board.messages).length + ' messages');
  console.log('  Saved to ' + STORE);
  console.log('\n  Organisers:   http://localhost:' + PORT + '/admin   token ' + AGENTS.ADMIN_TOKEN +
    (process.env.MERIDIAN_ADMIN_TOKEN ? ' (from MERIDIAN_ADMIN_TOKEN)' : ' (set MERIDIAN_ADMIN_TOKEN to fix it)'));
  console.log('  Agent runs:   ' + AGENTS.MAX_RUNS + ' at a time (MERIDIAN_MAX_RUNS), evidence in runs/');
  console.log('  Stop with Ctrl-C. Start again with --reset to clear the board.\n');
});
