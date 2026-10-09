/* =====================================================================
   THE STUDIO'S PAGES
   ---------------------------------------------------------------------
   Three pages instead of one crowded screen:

     /setup     every setting, saved section by section
     /sim       the simulation, on its own, around the map
     /feed      what people are saying, year by year
     /reports   every run, with its evidence and downloads
     /market    trading with other societies, messages, the hand-in

   The old single-screen studio stays at /classic.

   Pages load the engine as one script, /js/meridian.js, built from the
   same files the server runs, so the browser and the server can never be
   running different physics.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const APP = __dirname;
const PAGES = { '/': 'setup.html', '/setup': 'setup.html', '/sim': 'sim.html', '/feed': 'feed.html',
                '/market': 'market.html', '/reports': 'reports.html' };
const TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function engineBundle() {
  const read = f => fs.readFileSync(path.join(ROOT, 'engine', f), 'utf8');
  const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8'));
  const E = require(path.join(ROOT, 'engine', 'meridian-engine.js'));
  const presets = {};
  const MAP = { baseline: 'baseline_2050', boom: 'boom_2060', resilient: 'resilient_2074', doom: 'doom_loop_2068' };
  Object.keys(MAP).forEach(k => {
    const src = world.states[MAP[k]];
    const L = JSON.parse(JSON.stringify(src.levers));
    L.automation_target = {};
    E.ORDER.forEach(s => { L.automation_target[s] = src.sectors[s].automation; });
    if (L.care_guarantee_wage == null) L.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
    presets[k] = L;
  });
  return '(function(){\n' + read('sector_missions.js') + '\n})();\n' +
    read('meridian-engine.js') + '\n' + read('market.js') + '\n' + read('harness.js') + '\n' +
    /* The rules interpreter, so the trial runs a team's rules exactly as
       the server does. Wrapped so its top-level names stay private. */
    '(function(){\n' + read('harnesses/policy.js') + '\n})();\n' +
    'window.MERIDIAN_BASELINE = ' + JSON.stringify(world.states.baseline_2050) + ';\n' +
    'window.MERIDIAN_PRESETS = ' + JSON.stringify(presets) + ';\n';
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/** Returns true when the request was a page or an asset. */
function handle(req, res, url) {
  const p = url.pathname;
  if (req.method !== 'GET') return false;
  if (PAGES[p]) {
    send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(APP, PAGES[p]), 'utf8'));
    return true;
  }
  if (p === '/js/meridian.js') {
    try { send(res, 200, TYPES['.js'], engineBundle()); }
    catch (e) { send(res, 500, 'text/plain', 'could not build the engine bundle: ' + e.message); }
    return true;
  }
  const asset = /^\/app\/([\w-]+\.(js|css))$/.exec(p);
  if (asset) {
    const f = path.join(APP, asset[1]);
    if (!fs.existsSync(f)) { send(res, 404, 'text/plain', 'not found'); return true; }
    send(res, 200, TYPES['.' + asset[2]], fs.readFileSync(f, 'utf8'));
    return true;
  }
  return false;
}

module.exports = { handle, engineBundle };
