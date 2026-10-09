/* =====================================================================
   Build Meridian Studio into one self-contained page.
   ---------------------------------------------------------------------
   The lab and the console on one screen: engine, market, city renderer,
   the round-1 baseline and the lever presets all inlined.

     node lab/build-studio.js      -> dist/meridian-studio.html

   `serve-console.js` calls buildStudio() directly, so the local server
   always serves a fresh build.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function buildStudio(opts) {
  opts = opts || {};
  const read = f => fs.readFileSync(f, 'utf8');
  const engine = read(path.join(root, 'engine', 'meridian-engine.js'));
  const missions = read(path.join(root, 'engine', 'sector_missions.js'));
  const market = read(path.join(root, 'engine', 'market.js'));
  const city = read(path.join(__dirname, 'city.js'));
  const world = JSON.parse(read(path.join(root, 'world-states.json')));
  let tpl = read(path.join(__dirname, 'studio.html'));

  const E = require(path.join(root, 'engine', 'meridian-engine.js'));

  /* Lever presets, derived from the demo states: the automation each one
     reached is the target it was driving at. */
  const MAP = { baseline: 'baseline_2050', boom: 'boom_2060',
                resilient: 'resilient_2074', doom: 'doom_loop_2068' };
  const presets = {};
  Object.keys(MAP).forEach(k => {
    const src = world.states[MAP[k]];
    const L = JSON.parse(JSON.stringify(src.levers));
    L.automation_target = {};
    E.ORDER.forEach(s => { L.automation_target[s] = src.sectors[s].automation; });
    if (L.care_guarantee_wage == null) L.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
    presets[k] = L;
  });

  /* Missions first: the engine reads window.MeridianMissions at load
     time, so it has to already exist. Wrapped in an IIFE so this
     module's top-level consts stay out of the page's global scope. */
  tpl = tpl.replace('/*<!--INJECT:ENGINE-->*/', () =>
    '\n(function(){\n' + missions + '\n})();\n' + engine + '\n');
  tpl = tpl.replace('/*<!--INJECT:MARKET-->*/', () => '\n' + market + '\n');
  tpl = tpl.replace('/*<!--INJECT:CITY-->*/', () => '\n' + city + '\n');
  tpl = tpl.replace('/*<!--INJECT:BASELINE-->*/', () => JSON.stringify(world.states.baseline_2050));
  tpl = tpl.replace('/*<!--INJECT:PRESETS-->*/',
    () => 'var PRESET_LEVERS = ' + JSON.stringify(presets, null, 1) + ';');

  if (opts.localBoard) {
    tpl = '<script>window.MERIDIAN_LOCAL_BOARD = ' +
      JSON.stringify(opts.localBoard) + ';</script>\n' + tpl;
  }
  return tpl;
}

module.exports = { buildStudio };

if (require.main === module) {
  const out = path.join(root, 'dist', 'meridian-studio.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = buildStudio();
  fs.writeFileSync(out, html, 'utf8');
  console.log('built ' + out);
  console.log('  ' + (html.length / 1024).toFixed(0) + ' KB — engine, market, city and baseline inlined');
}
