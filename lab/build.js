/* Builds dist/meridian-lab.html: the engine and the round-1 baseline are
   inlined so the page is a single self-contained file that works from
   file://, from a static host, or as a published Artifact. The engine
   source stays the single source of truth. */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'engine', 'meridian-engine.js'), 'utf8');
const missions = fs.readFileSync(path.join(root, 'engine', 'sector_missions.js'), 'utf8');
const city = fs.readFileSync(path.join(__dirname, 'city.js'), 'utf8');
const world = JSON.parse(fs.readFileSync(path.join(root, 'world-states.json'), 'utf8'));
let tpl = fs.readFileSync(path.join(__dirname, 'lab.template.html'), 'utf8');

const E = require(path.join(root, 'engine', 'meridian-engine.js'));

/* Lever presets, derived from the demo states. The demo states record the
   automation each society REACHED, which is the target it drove at. */
const MAP = {
  baseline: 'baseline_2050',
  boom: 'boom_2060',
  resilient: 'resilient_2074',
  doom: 'doom_loop_2068'
};
const presets = {};
Object.keys(MAP).forEach(k => {
  const src = world.states[MAP[k]];
  const L = JSON.parse(JSON.stringify(src.levers));
  L.automation_target = {};
  E.ORDER.forEach(s => { L.automation_target[s] = src.sectors[s].automation; });
  if (L.care_guarantee_wage == null) L.care_guarantee_wage = E.PARAMS.GUARANTEE_WAGE_DEFAULT;
  presets[k] = L;
});

const baseline = JSON.parse(JSON.stringify(world.states.baseline_2050));

/* Missions first: the engine reads window.MeridianMissions at load
   time, so it has to already exist. Wrapped in an IIFE so this
   module's top-level consts stay out of the page's global scope. */
tpl = tpl.replace('/*<!--INJECT:ENGINE-->*/', () =>
  '\n(function(){\n' + missions + '\n})();\n' + engine + '\n');
tpl = tpl.replace('/*<!--INJECT:CITY-->*/', () => '\n' + city + '\n');
tpl = tpl.replace('/*<!--INJECT:BASELINE-->*/', () => JSON.stringify(baseline));
tpl = tpl.replace('/*<!--INJECT:PRESETS-->*/',
  () => 'var PRESET_LEVERS = ' + JSON.stringify(presets, null, 2) + ';');

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'meridian-lab.html');
fs.writeFileSync(out, tpl, 'utf8');

console.log('built ' + out);
console.log('  ' + (tpl.length / 1024).toFixed(0) + ' KB, self-contained');
console.log('  presets: ' + Object.keys(presets).join(', '));
