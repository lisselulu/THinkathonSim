/* =====================================================================
   Build the feed into one self-contained page.
   ---------------------------------------------------------------------
     node lab/build-feed.js            -> dist/meridian-feed.html
     node lab/build-feed.js --doom     -> built on the doom trajectory

   Deliberately a SEPARATE page from the studio. The feed is a peripheral
   data source, not a control surface — it belongs on the second screen,
   or the projector at the front of the room, while teams work on their
   dashboards. Keeping it out of the studio keeps both of them legible.

   `serve-console.js` calls buildFeed() directly, so the local server
   always serves a fresh build at /feed.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/* The citizen and feed modules are UMD-wrapped for Node; in the browser
   they expect their dependencies on `window`. These shims publish each
   module under the global the next one looks for. */
function browserify(src, globalName, deps) {
  return '(function(){\n' +
    'var module={exports:{}}, exports=module.exports;\n' +
    'var require=function(p){' +
      Object.keys(deps).map(k => 'if(p.indexOf("' + k + '")>=0) return ' + deps[k] + ';').join('\n') +
      '\nthrow new Error("unexpected require: "+p);};\n' +
    src + '\n' +
    'window.' + globalName + ' = module.exports;\n' +
    '})();';
}

function buildFeed(opts) {
  opts = opts || {};
  const read = f => fs.readFileSync(f, 'utf8');
  const engine = read(path.join(root, 'engine', 'meridian-engine.js'));
  const missions = read(path.join(root, 'engine', 'sector_missions.js'));
  const citizens = read(path.join(root, 'engine', 'citizen_friction.js'));
  const traits = read(path.join(root, 'engine', 'traits.js'));
  const feed = read(path.join(__dirname, 'feed.js'));
  const world = JSON.parse(read(path.join(root, 'world-states.json')));
  let tpl = read(path.join(__dirname, 'feed.html'));

  const E = require(path.join(root, 'engine', 'meridian-engine.js'));

  /* Which government the feed is watching. Defaults to a resilient one on
     a four-day week, because the interesting question this page exists to
     answer is what a society does with time it did not have before. */
  const source = opts.scenario || 'resilient_2074';
  const src = world.states[source] || world.states.resilient_2074;
  const levers = JSON.parse(JSON.stringify(src.levers));
  levers.automation_target = {};
  E.ORDER.forEach(k => { levers.automation_target[k] = src.sectors[k].automation; });
  if (opts.workingWeek) levers.working_week_days = opts.workingWeek;
  if (levers.care_guarantee_wage == null) levers.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;

  /* Missions first: the engine reads window.MeridianMissions at load
     time, so it has to already exist. Wrapped in an IIFE so this
     module's top-level consts stay out of the page's global scope. */
  tpl = tpl.replace('/*<!--INJECT:ENGINE-->*/', () =>
    '\n(function(){\n' + missions + '\n})();\n' + engine + '\n');
  tpl = tpl.replace('/*<!--INJECT:CITIZENS-->*/',
    () => '\n' + browserify(citizens, 'MeridianCitizens',
      { 'meridian-engine': 'window.MeridianEngine' }) +
      /* Personality rides along with the citizens: the feed's chooser
         needs it and it has no dependencies of its own. */
      '\n' + browserify(traits, 'MeridianTraits', {}) + '\n');
  tpl = tpl.replace('/*<!--INJECT:FEED-->*/',
    () => '\n' + browserify(feed, 'MeridianFeed',
      { 'meridian-engine': 'window.MeridianEngine',
        'citizen_friction': 'window.MeridianCitizens',
        'traits': 'window.MeridianTraits' }) + '\n');
  /* The `null` is part of the token, not a separate default. Replacing
     only the comment leaves `var BASE={...}null;` behind, which is a
     syntax error that renders an empty page and no obvious reason why. */
  tpl = tpl.replace('/*<!--INJECT:BASE-->*/null',
    () => JSON.stringify(world.states.baseline_2050));
  tpl = tpl.replace('/*<!--INJECT:LEVERS-->*/null', () => JSON.stringify(levers));

  return tpl;
}

module.exports = { buildFeed };

if (require.main === module) {
  const args = process.argv.slice(2);
  const scenario = args.includes('--doom') ? 'doom_loop_2068'
    : args.includes('--baseline') ? 'baseline_2050'
    : args.includes('--boom') ? 'boom_2060' : 'resilient_2074';
  const wk = args.includes('--5day') ? 5 : 4;
  const html = buildFeed({ scenario, workingWeek: wk });
  const out = path.join(root, 'dist', 'meridian-feed.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log('built ' + out);
  console.log('  ' + (html.length / 1024).toFixed(0) + ' KB — ' + scenario +
    ', ' + wk + '-day week');
}
