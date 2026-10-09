/* =====================================================================
   Feed the ORIGINAL world-state monitor from the engine.
   ---------------------------------------------------------------------
   The monitor ships as a bundled page: a loader plus two payload script
   tags. It tries `fetch('uploads/world-states.json')` first and falls
   back after 1.2s to a copy of that same JSON inlined in its template.

   The fetch path only works when the page is served over http. The
   inline path always works, including from file://, so this script
   rewrites the inline copy rather than relying on the fetch.

   The original files are never modified. Output goes to dist/.

     node lab/inject-monitor.js                     # baseline levers
     node lab/inject-monitor.js resilient           # a named preset
     node lab/inject-monitor.js doom --shock 5=pandemic,food_import_disruption
   ===================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const E = require(path.join(root, 'engine', 'meridian-engine.js'));
const world = JSON.parse(fs.readFileSync(path.join(root, 'world-states.json'), 'utf8'));

const SRC_DIR = path.join(root, 'Post-capitalist economy simulation (1)');
const MONITOR = path.join(SRC_DIR, 'meridian-world-state.html');
const CONTROL = path.join(SRC_DIR, 'meridian-control-room.html');
const OUT_DIR = path.join(root, 'dist');

/* ---- lever presets, same derivation the lab uses -------------------- */
const MAP = {
  baseline: 'baseline_2050', boom: 'boom_2060',
  resilient: 'resilient_2074', doom: 'doom_loop_2068', shock: 'shock_2058'
};
function preset(name) {
  const src = world.states[MAP[name]];
  if (!src) throw new Error('unknown preset "' + name + '". try: ' + Object.keys(MAP).join(', '));
  const L = JSON.parse(JSON.stringify(src.levers));
  L.automation_target = {};
  E.ORDER.forEach(k => { L.automation_target[k] = src.sectors[k].automation; });
  return L;
}

/* ---- args ----------------------------------------------------------- */
const args = process.argv.slice(2);
const which = args.find(a => !a.startsWith('--')) || 'baseline';
const shockSched = {};
const si = args.indexOf('--shock');
if (si >= 0 && args[si + 1]) {
  args[si + 1].split(';').forEach(pair => {
    const [r, list] = pair.split('=');
    shockSched[+r] = (list || '').split(',').filter(Boolean);
  });
}

/* ---- run the engine -------------------------------------------------- */
const levers = preset(which);
const traj = E.runTrajectory(world.states.baseline_2050, levers, shockSched, 12);

const payload = {
  schema_version: '1.0',
  generated_by: 'meridian-engine ' + E.version,
  generated_at: new Date().toISOString(),
  preset: which,
  levers_used: levers,
  shock_schedule: shockSched,
  field_notes: world.field_notes,   // keep the schema documentation
  states: {}
};
traj.forEach((s, i) => {
  const c = JSON.parse(JSON.stringify(s));
  Object.keys(c).forEach(k => { if (k.charAt(0) === '_') delete c[k]; });
  // The monitor renders `state_label · year` as a tab. Twelve of them have
  // to fit across the header, so keep the label short.
  c.meta.state_label = 'R' + (i + 1);
  c.score = E.score(traj.slice(0, i + 1));
  payload.states['round_' + String(i + 1).padStart(2, '0')] = c;
});
const json = JSON.stringify(payload, null, 2);

/* ---- rewrite the inline payload inside the bundle -------------------- */
function reinject(srcFile, outFile) {
  const lines = fs.readFileSync(srcFile, 'utf8').split('\n');
  let ti = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('<script') && lines[i].includes('type="__bundler/template"')) {
      ti = i + 1;
      break;
    }
  }
  if (ti < 0) throw new Error('no bundler template found in ' + path.basename(srcFile));

  const html = JSON.parse(lines[ti]);
  const open = '<script type="application/json" id="world-states-inline">';
  const a = html.indexOf(open);
  if (a < 0) throw new Error('no inline world-states block in ' + path.basename(srcFile));
  const b = html.indexOf('</script>', a);
  const patched = html.slice(0, a + open.length) + json + html.slice(b);

  // The template line is a JSON string literal; re-encode it the same way.
  lines[ti] = JSON.stringify(patched);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
  return outFile;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Also write the plain file, for setups that do serve the page over http.
const upl = path.join(OUT_DIR, 'uploads');
fs.mkdirSync(upl, { recursive: true });
fs.writeFileSync(path.join(upl, 'world-states.json'), json, 'utf8');

const written = [];
[[MONITOR, 'meridian-world-state.html'], [CONTROL, 'meridian-control-room.html']].forEach(([src, name]) => {
  if (fs.existsSync(src)) written.push(reinject(src, path.join(OUT_DIR, name)));
});

const sc = E.score(traj);
console.log('preset:   ' + which + (Object.keys(shockSched).length
  ? '  shocks ' + JSON.stringify(shockSched) : ''));
console.log('score:    ' + sc.total + '/100  gates: ' + (sc.gates_failed.join(', ') || 'none'));
console.log('rounds:   ' + traj.map(s => s.indicators.ubi_monthly_sgd).join(' '));
console.log('written:');
written.forEach(f => console.log('  ' + f));
console.log('  ' + path.join(upl, 'world-states.json'));
