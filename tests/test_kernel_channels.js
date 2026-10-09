/* =====================================================================
   THE KERNEL'S AGENT CHANNELS
   ---------------------------------------------------------------------
       node tests/test_kernel_channels.js

   Each channel is a place where a decision made by an agent replaces a
   formula that used to stand in for it. Parity proves the JS and Python
   kernels agree on what a channel does. It cannot prove the channel does
   ANYTHING: two engines can agree perfectly on a no-op.

   So every assertion here compares the same round stepped twice, once
   without the channel and once with it, and checks that the quantity the
   channel is meant to move moved, in the direction a person would expect.
   And one assertion guards the promise that makes the redesign safe to
   land: with no channel in use, the state is identical, key for key.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'engine/meridian-engine.js'));
const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'world-states.json'), 'utf8')).states.baseline_2050;

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail != null ? '\n          ' + detail : '')); }
}

const seed = E.seed(BASE);
const levers = JSON.parse(JSON.stringify(BASE.levers || E.DEFAULT_LEVERS));
const r2 = (lv, exo, shocks) => E.step(seed, lv || levers, shocks || [], exo || null);
const plain = r2();

console.log('\nneutrality');
(function () {
  const again = r2(levers, {});
  ok(JSON.stringify(again) === JSON.stringify(plain),
     'an empty exogenous object changes nothing');
  const withEmptyPolicies = r2(Object.assign({}, levers, { policies: [] }));
  ok(JSON.stringify(Object.assign({}, withEmptyPolicies, { levers: null })) ===
     JSON.stringify(Object.assign({}, plain, { levers: null })),
     'an empty policy list changes nothing but the lever record');
  ok(!('_markupIndex' in plain) && !('_popAdjust' in plain) && !('_policySpend_bn' in plain),
     'no agent carry-forward keys appear unless a channel is used');
})();

console.log('\nhouseholds decide what to spend');
(function () {
  const thrifty = r2(levers, { households: { propensity: 0.40 } });
  const lavish = r2(levers, { households: { propensity: 0.95 } });
  ok(thrifty.indicators.consumption_index < plain.indicators.consumption_index,
     'a frightened household that saves more spends less',
     thrifty.indicators.consumption_index + ' vs ' + plain.indicators.consumption_index);
  ok(lavish.indicators.consumption_index > thrifty.indicators.consumption_index,
     'and a confident one spends more');
  ok(r2(levers, { households: { propensity: 'lots' } }).indicators.consumption_index ===
     plain.indicators.consumption_index,
     'a propensity that is not a number falls back to the calibrated constants');
})();

console.log('\nhouseholds decide whether to work');
(function () {
  const reluctant = r2(levers, { households: { labour_supply: 0.5 } });
  ok(reluctant.population.employed_total < plain.population.employed_total,
     'when half the usual willingness to work is offered, fewer people are employed',
     reluctant.population.employed_total + ' vs ' + plain.population.employed_total);
  ok(reluctant.fiscal.gdp_bn < plain.fiscal.gdp_bn, 'and the economy produces less');
  const eager = r2(levers, { households: { labour_supply: 1.2 } });
  ok(eager.population.employed_total === plain.population.employed_total,
     'offering more labour than firms need does not conjure jobs');
})();

console.log('\na strike removes the work of the people striking');
(function () {
  const careStrike = r2(levers, { households: { withheld: { care_services: 0.4 } } });
  const financeStrike = r2(levers, { households: { withheld: { finance: 0.4 } } });
  ok(careStrike.sectors.care_services.capacity < plain.sectors.care_services.capacity,
     'a care strike cuts care capacity');
  ok(careStrike.sectors.finance.capacity === plain.sectors.finance.capacity,
     'and leaves finance alone');
  const careLoss = 1 - careStrike.sectors.care_services.capacity / plain.sectors.care_services.capacity;
  const finLoss = 1 - financeStrike.sectors.finance.capacity / plain.sectors.finance.capacity;
  ok(careLoss > finLoss,
     'the same share walking out costs a human-intensive sector more than an automated one',
     'care ' + careLoss.toFixed(3) + ' vs finance ' + finLoss.toFixed(3));
})();

console.log('\nfirms decide what to charge and pay');
(function () {
  const gouge = r2(levers, { firms: { retail_commerce: { markup: 1.4 } } });
  ok(gouge.sectors.retail_commerce.margin > plain.sectors.retail_commerce.margin,
     'a markup earns more per unit');
  ok(gouge._markupIndex > 1, 'and raises the economy-wide markup it passes on');
  /* What households pay is read off the payment and what it buys, since
     the price level itself is not published. The markup is applied
     everywhere so the effect is far larger than the integer rounding of
     the index. NOT asserted: that purchasing power falls. A markup also
     raises the profit the state taxes, so the payment can rise with the
     prices, and which wins is a finding, not a law. */
  const everywhere = {};
  E.ORDER.forEach(k => { everywhere[k] = { markup: 1.4 }; });
  const pricey = r2(levers, { firms: everywhere });
  const priceOf = s => s.indicators.ubi_monthly_sgd / s.indicators.real_ubi_index;
  const next = E.step(pricey, levers, [], { firms: everywhere });
  const nextPlain = E.step(plain, levers, [], null);
  ok(priceOf(next) > priceOf(nextPlain) * 1.1,
     'which reaches household prices the round after',
     priceOf(next).toFixed(3) + ' vs ' + priceOf(nextPlain).toFixed(3));
  const generous = r2(levers, { firms: { food_agri: { wage_offer: 1.3 } } });
  ok(generous._wageBill_bn > plain._wageBill_bn, 'a higher wage offer raises the wage bill');
})();

console.log('\nlegitimacy and cohesion are what people report');
(function () {
  const angry = r2(levers, { polls: { trust: 5, belonging: 10 } });
  const content = r2(levers, { polls: { trust: 95, belonging: 95 } });
  ok(angry.indicators.legitimacy < content.indicators.legitimacy, 'low reported trust lowers legitimacy');
  ok(angry.indicators.cohesion < content.indicators.cohesion, 'low reported belonging lowers cohesion');
})();

console.log('\npopulation answers to decisions and to the health service');
(function () {
  const fewer = r2(levers, { demography: { births_mult: 0.5 } });
  ok(fewer.population.by_age.age_0_19 < plain.population.by_age.age_0_19, 'fewer births, fewer children');
  const exodus = r2(levers, { demography: { emigration: 50000 } });
  ok(exodus.population.by_age.age_20_64 === plain.population.by_age.age_20_64 - 50000,
     'fifty thousand who leave are fifty thousand fewer working-age residents');
  const sick = JSON.parse(JSON.stringify(seed));
  sick.sectors.healthcare.quality = 15;
  const sickRound = E.step(sick, levers, [], { demography: {} });
  const wellRound = E.step(seed, levers, [], { demography: {} });
  ok(sickRound.population.by_age.age_65_plus < wellRound.population.by_age.age_65_plus,
     'a failing health service means more old people die',
     sickRound.population.by_age.age_65_plus + ' vs ' + wellRound.population.by_age.age_65_plus);
  const carried = E.step(exodus, levers, [], null);
  ok(carried._popAdjust && carried._popAdjust.age_20_64 === -50000,
     'and people who left stay gone in later rounds');
})();

console.log('\npolicies a team invented');
(function () {
  const withPol = list => r2(Object.assign({}, levers, { policies: list }));
  const pension = withPol([{ type: 'transfer', to: 'elderly', sgd_month: 400 }]);
  ok(pension._transfers_bn > 0 && pension._obligations_bn > plain._obligations_bn,
     'a pension top-up costs the budget');
  ok(pension.indicators.consumption_index > plain.indicators.consumption_index,
     'and is spent');
  const wealth = withPol([{ type: 'tax', base: 'capital_income', rate: 0.2 }]);
  ok(wealth._policyRevenue_bn > 0, 'a new tax raises revenue');
  const cap = withPol([{ type: 'regulate', what: 'automation_cap', sector: 'finance', limit: 0.1 }]);
  ok(cap.sectors.finance.automation < plain.sectors.finance.automation,
     'an automation cap holds automation down');
  const clinic = withPol([{ type: 'provide', sector: 'healthcare', budget_bn: 10 }]);
  ok(clinic.sectors.healthcare.capacity > plain.sectors.healthcare.capacity,
     'direct provision builds capacity');
  const nonsense = withPol([{ type: 'tax', base: 'souls', rate: 2 }]);
  ok(!('_policySpend_bn' in nonsense), 'an invalid policy is dropped, not half-applied');
  ok(E.validatePolicy({ type: 'regulate', what: 'automation_cap', sector: 'mars', limit: 0.5 }).reason
       .indexOf('unknown sector') === 0,
     'and validation says why');
})();

console.log('\nevents organisers invent');
(function () {
  const typhoon = { id: 'typhoon', label: 'Typhoon Lumi',
                    effects: { capacity_mult: { transport_logistics: 0.6 }, cohesion: -8 } };
  const hit = r2(levers, null, [typhoon]);
  ok(hit.sectors.transport_logistics.capacity < plain.sectors.transport_logistics.capacity,
     'an invented typhoon damages transport');
  ok(hit.shocks.indexOf('Typhoon Lumi') >= 0, 'and is recorded by name');
  ok(JSON.stringify(r2(levers, null, [{ id: 'empty' }]).sectors) === JSON.stringify(plain.sectors),
     'an event with no effects does nothing');
  ok(E.isShock('pandemic') && E.isShock(typhoon) && !E.isShock('not_a_shock'),
     'runTrajectory accepts deck names and events alike');
})();

/* ------------------------------------------------------------------ */
console.log('\nopen action: custom moved and work off the books');
(function () {
  const lv = JSON.parse(JSON.stringify(levers));
  const base = r2(lv);
  const away = r2(lv, { demand: { retail_commerce: 0.8 } });
  ok(away.sectors.retail_commerce.capacity > base.sectors.retail_commerce.capacity,
     'custom moved away from a sector leaves it with spare capacity (less demand for the same supply)',
     base.sectors.retail_commerce.capacity + ' -> ' + away.sectors.retail_commerce.capacity);
  ok(away.fiscal.gdp_bn < base.fiscal.gdp_bn, 'and the economy sells less');
  const toward = r2(lv, { demand: { food_agri: 1.2 } });
  ok(toward.sectors.food_agri.capacity < base.sectors.food_agri.capacity, 'custom moved toward a sector tightens it');
  const wild = r2(lv, { demand: { food_agri: 9 } });
  ok(JSON.stringify(wild.sectors.food_agri) === JSON.stringify(r2(lv, { demand: { food_agri: 1.5 } }).sectors.food_agri),
     'a demand shift is bounded at 1.5');
  const off = r2(lv, { informal_share: 0.2 });
  ok(off.fiscal.tax_revenue_bn < base.fiscal.tax_revenue_bn, 'work and spending off the books lower tax revenue',
     base.fiscal.tax_revenue_bn + ' -> ' + off.fiscal.tax_revenue_bn);
  ok(Math.abs(off.fiscal.gdp_bn - base.fiscal.gdp_bn) < 1e-9, 'but do not change what the economy produced');
  const none = r2(lv, { demand: {}, informal_share: 0 });
  ok(JSON.stringify(none) === JSON.stringify(base), 'absent or zero, both channels change nothing at all');
})();

/* ------------------------------------------------------------------ */
console.log('\nticks: time cut finer, the same country');
(function () {
  const lv = JSON.parse(JSON.stringify(levers));
  const M = { dt: 1 / 12 };
  const run = (n, exoAt, shocksAt) => {
    const out = [seed];
    for (let i = 1; i <= n; i++) out.push(E.step(out[out.length - 1], lv, (shocksAt && shocksAt(i)) || [], (exoAt && exoAt(i)) || null, M));
    return out;
  };
  ok(JSON.stringify(E.step(seed, lv, [], null, { dt: 2 })) === JSON.stringify(E.step(seed, lv, [], null)),
     'a two-year step is exactly the original round');

  const two = [seed, E.step(seed, lv, [], null)];
  two.push(E.step(two[1], lv, [], null));
  const m = run(48);
  const near = (x, y, tol) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));
  ok(near(m[24].fiscal.gdp_bn, two[1].fiscal.gdp_bn, 0.03) && near(m[48].fiscal.gdp_bn, two[2].fiscal.gdp_bn, 0.03),
     'twenty-four monthly ticks land where one two-year round does (output within 3%)',
     m[24].fiscal.gdp_bn + ' vs ' + two[1].fiscal.gdp_bn + '; ' + m[48].fiscal.gdp_bn + ' vs ' + two[2].fiscal.gdp_bn);
  ok(near(m[48].fiscal.reserves_bn, two[2].fiscal.reserves_bn, 0.05) && near(m[48].indicators.cohesion, two[2].indicators.cohesion, 0.05),
     'reserves and cohesion likewise', m[48].fiscal.reserves_bn + ' vs ' + two[2].fiscal.reserves_bn);
  ok(near(m[24]._priceIndex, two[1]._priceIndex, 0.002), 'two years of monthly inflation is two years of inflation',
     m[24]._priceIndex + ' vs ' + two[1]._priceIndex);

  ok(m[12].meta.year === 2051 && m[12].meta.month === 1 && m[1].meta.month === 2 && m[48].meta.year === 2054 && m[7].meta.tick === 7,
     'twelve ticks are a year, counted exactly', m[12].meta.year + '/' + m[12].meta.month);

  /* Rounded figures must not stall when each month moves less than a point. */
  const hc = m.map(x => x.sectors.healthcare.quality);
  ok(hc[1] !== hc[18] && Math.abs(hc[1] - hc[2]) <= 1,
     'quality moves a little each month and a lot over a year, instead of rounding away', hc.slice(0, 13).join(' '));
  ok(Math.abs(m[2].fiscal.reserves_bn - m[1].fiscal.reserves_bn) < Math.abs(two[1].fiscal.reserves_bn - seed.fiscal.reserves_bn) / 12,
     'a month adds a month\'s share of the budget to reserves, not a round\'s');

  /* Slow things refresh on their own cadence, and cover the time since. */
  const cap = m.map(x => x._capitalIndex);
  ok(cap[1] === cap[2] && cap[2] !== cap[3] && cap[3] === cap[4] && cap[5] !== cap[6],
     'capital is looked at every third tick', cap.slice(0, 7).map(v => v.toFixed(5)).join(' '));
  ok(m[11].population.total === seed.population.total && m[12].population.total !== seed.population.total,
     'population is refreshed once a year');
  ok(near(m[24].population.total, two[1].population.total, 0.001), 'and two years of it match the round');

  /* One-off things happen once. */
  const left = run(24, i => (i === 5 ? { demography: { births_mult: 1, emigration: 50000 } } : null));
  ok(Math.abs((m[24].population.by_age.age_20_64 - left[24].population.by_age.age_20_64) - 50000) < 500,
     'fifty thousand people who leave in one month are gone once, not once a month',
     (m[24].population.by_age.age_20_64 - left[24].population.by_age.age_20_64) + ' fewer');
  ok(left[5].population.total === m[5].population.total && left[12].population.total < m[12].population.total,
     'and they are counted at the yearly refresh, not lost before it');

  /* A shock lasts as long as it is active, and no longer. */
  const brief = run(24, null, i => (i >= 6 && i <= 8 ? ['energy_price_spike'] : []));
  const whole = run(24, null, i => ['energy_price_spike']);
  ok(brief[24]._priceIndex > m[24]._priceIndex && brief[24]._priceIndex < whole[24]._priceIndex,
     'a three-month shock does less than one that lasts two years',
     [m[24]._priceIndex, brief[24]._priceIndex, whole[24]._priceIndex].map(v => v.toFixed(4)).join(' < '));

  /* A deficit has to last two years, not two ticks, to become a crisis. */
  const broke = JSON.parse(JSON.stringify(seed)); broke.fiscal.reserves_bn = -5;
  const b1 = E.step(broke, lv, [], null, M), b2 = E.step(b1, lv, [], null, M);
  ok(b2._endogenousNext.indexOf('fiscal_crisis') < 0, 'two months in deficit is not a fiscal crisis');
})();

/* ------------------------------------------------------------------ */
console.log('\na team\'s own ways of sharing out');
(function () {
  const lv = JSON.parse(JSON.stringify(levers));
  const base = r2(lv);
  const fromPot = r2(lv, { distribution: { paid_bn: 6, from_ubi_bn: 6 } });
  const newMoney = r2(lv, { distribution: { paid_bn: 6, from_ubi_bn: 0 } });
  ok(fromPot.indicators.ubi_monthly_sgd < base.indicators.ubi_monthly_sgd,
     'a scheme paid from the payment\'s pot lowers the payment everyone gets',
     base.indicators.ubi_monthly_sgd + ' -> ' + fromPot.indicators.ubi_monthly_sgd);
  ok(Math.abs(fromPot.fiscal.reserves_bn - base.fiscal.reserves_bn) < 0.01,
     'and costs the treasury nothing more: it redistributes');
  ok(newMoney.indicators.ubi_monthly_sgd < base.indicators.ubi_monthly_sgd && newMoney.fiscal.reserves_bn < base.fiscal.reserves_bn,
     'a scheme paid with new money is an obligation: it comes off the top, before the split',
     base.fiscal.reserves_bn + ' -> ' + newMoney.fiscal.reserves_bn);
  ok(fromPot._distribution_bn.paid === 6 && fromPot._distribution_bn.from_the_payment === 6 && newMoney._distribution_bn.new_money === 6,
     'and the state records what was paid and from where');
  const greedy = r2(lv, { distribution: { paid_bn: 500, from_ubi_bn: 500 } });
  ok(greedy.indicators.ubi_monthly_sgd === 0 && greedy._distribution_bn.from_the_payment < 500,
     'a scheme cannot take more from the pot than is in it', JSON.stringify(greedy._distribution_bn));
  ok(JSON.stringify(r2(lv, {})) === JSON.stringify(base), 'with no scheme, nothing at all changes');
})();

console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
