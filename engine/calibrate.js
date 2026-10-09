/* Calibration harness. Runs the four canonical lever sets forward from
   the round-1 baseline and reports whether the engine reproduces the
   qualitative story each demo state was hand-authored to tell. */

const E = require('./meridian-engine.js');
const fs = require('fs');
const path = require('path');

const world = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'));
const BASE = world.states.baseline_2050;

const LEVER_SETS = {
  baseline: world.states.baseline_2050.levers,
  boom: world.states.boom_2060.levers,
  shock: world.states.shock_2058.levers,
  doom: world.states.doom_loop_2068.levers,
  resilient: world.states.resilient_2074.levers
};

// The demo states carry no automation_target, so derive one from the
// automation each state actually reached: that IS the target they drove at.
function leversFrom(name) {
  const src = world.states[
    { baseline: 'baseline_2050', boom: 'boom_2060', shock: 'shock_2058',
      doom: 'doom_loop_2068', resilient: 'resilient_2074' }[name]];
  const L = JSON.parse(JSON.stringify(src.levers));
  L.automation_target = {};
  E.ORDER.forEach(k => { L.automation_target[k] = src.sectors[k].automation; });
  return L;
}

const fmt = (v, w, d) => String(typeof v === 'number' ? v.toFixed(d === undefined ? 0 : d) : v).padStart(w);

function report(name, levers, shockSched) {
  const traj = E.runTrajectory(BASE, levers, shockSched || {}, 12);
  const sc = E.score(traj);
  console.log('\n=============================================================================');
  console.log('  ' + name.toUpperCase());
  console.log('=============================================================================');
  console.log('  r  yr    GDP  profit  taxrev  resv   UBI$  realUBI  emp%  cons  gini  coh  legit  worst');
  traj.forEach(s => {
    const worst = Math.min.apply(null, E.ESSENTIAL.map(k => s.sectors[k].quality));
    console.log(
      fmt(s.meta.round, 3) + fmt(s.meta.year, 6) +
      fmt(s.fiscal.gdp_bn, 7) + fmt(s.fiscal.corporate_profit_bn, 8) +
      fmt(s.fiscal.tax_revenue_bn, 8) + fmt(s.fiscal.reserves_bn, 6) +
      fmt(s.indicators.ubi_monthly_sgd, 7) + fmt(s.indicators.real_ubi_index, 9) +
      fmt(s.indicators.employment_rate * 100, 6) + fmt(s.indicators.consumption_index, 6) +
      fmt(s.indicators.gini, 6, 2) + fmt(s.indicators.cohesion, 5) +
      fmt(s.indicators.legitimacy, 7) + fmt(worst, 7));
  });
  const last = traj[traj.length - 1];
  console.log('  final sector quality:');
  E.ORDER.forEach(k => {
    console.log('    ' + (E.SECTORS[k].name + ' ').padEnd(22, '.') +
      ' q' + fmt(last.sectors[k].quality, 4) +
      '  auto ' + fmt(last.sectors[k].automation * 100, 3) + '%' +
      '  cap ' + fmt(last.sectors[k].capacity * 100, 4) + '%' +
      '  head ' + fmt(last.sectors[k].headcount, 7) +
      '  margin ' + fmt(last.sectors[k].margin * 100, 4) + '%');
  });
  console.log('  SCORE ' + sc.total + '/100   gates: ' + (sc.gates_failed.join(', ') || 'none'));
  console.log('  components: ' + JSON.stringify(sc.components));
  console.log('  diagnostics: ' + JSON.stringify(sc.diagnostics));
  return { traj, sc };
}

console.log('Engine v' + E.version);
console.log('Round-1 calibration:');
console.log('  wage bill        $' + E.CAL.WAGE_BILL.toFixed(1) + 'bn');
console.log('  gross profit     $' + E.CAL.GROSS_PROFIT.toFixed(1) + 'bn');
console.log('  capital return   $' + E.CAL.CAPITAL_RETURN.toFixed(1) + 'bn');
console.log('  corporate profit $' + E.CAL.CORPORATE_PROFIT.toFixed(1) + 'bn   (file says 164)');
console.log('  consumption base $' + E.CAL.SPEND.toFixed(1) + 'bn');
console.log('  cost shares: ' + E.ORDER.map(k => k.slice(0, 4) + ' ' + E.COST_SHARE[k].toFixed(2)).join('  '));

const results = {};
results.baseline = report('baseline held for 12 rounds', leversFrom('baseline'));
results.boom = report('the boom: automate everything, 70% to payouts', leversFrom('boom'));
results.resilient = report('the resilient society', leversFrom('resilient'));
results.doom = report('the doom loop', leversFrom('doom'));
results.shock = report('shock path (pandemic r5 + food disruption r5)', leversFrom('shock'),
  { 5: ['pandemic', 'food_import_disruption'] });

console.log('\n=============================================================================');
console.log('  ORDERING CHECK — target: resilient > boom > baseline > shock > doom');
console.log('=============================================================================');
const order = Object.keys(results)
  .map(k => ({ k, t: results[k].sc.total }))
  .sort((x, y) => y.t - x.t);
order.forEach(o => console.log('  ' + o.k.padEnd(12) + o.t + '/100'));
