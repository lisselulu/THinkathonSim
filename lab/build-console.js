/* =====================================================================
   Build the Team Console into one self-contained page.
   ---------------------------------------------------------------------
   The console needs the engine inside it. Without one it is a noticeboard:
   teams agree a deal and nothing on screen moves, because there are no
   numbers on screen to move. With one, every team watches its own society
   run while it negotiates, and can see what a deal does before taking it.

     node lab/build-console.js          -> dist/meridian-console.html

   `serve-console.js` calls buildConsole() directly, so the local server
   always serves a fresh build and there is no stale artefact to forget.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function buildConsole(opts) {
  opts = opts || {};
  const engine = fs.readFileSync(path.join(root, 'engine', 'meridian-engine.js'), 'utf8');
  const missions = fs.readFileSync(path.join(root, 'engine', 'sector_missions.js'), 'utf8');
  const market = fs.readFileSync(path.join(root, 'engine', 'market.js'), 'utf8');
  const world = JSON.parse(fs.readFileSync(path.join(root, 'world-states.json'), 'utf8'));
  let tpl = fs.readFileSync(path.join(__dirname, 'console.html'), 'utf8');

  const baseline = world.states.baseline_2050;

  /* Missions first: the engine reads window.MeridianMissions at load
     time, so it has to already exist. Wrapped in an IIFE so this
     module's top-level consts stay out of the page's global scope. */
  tpl = tpl.replace('/*<!--INJECT:ENGINE-->*/', () =>
    '\n(function(){\n' + missions + '\n})();\n' + engine + '\n');
  tpl = tpl.replace('/*<!--INJECT:MARKET-->*/', () => '\n' + market + '\n');
  tpl = tpl.replace('/*<!--INJECT:BASELINE-->*/', () => JSON.stringify(baseline));

  if (opts.localBoard) {
    tpl = '<script>window.MERIDIAN_LOCAL_BOARD = ' +
      JSON.stringify(opts.localBoard) + ';</script>\n' + tpl;
  }
  return tpl;
}

module.exports = { buildConsole };

if (require.main === module) {
  const out = path.join(root, 'dist', 'meridian-console.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const html = buildConsole();
  fs.writeFileSync(out, html, 'utf8');
  console.log('built ' + out);
  console.log('  ' + (html.length / 1024).toFixed(0) + ' KB, engine and market inlined');
}
