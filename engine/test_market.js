/* Trade engine tests.  node engine/test_market.js */

const fs = require('fs');
const path = require('path');
const E = require('./meridian-engine.js');
const H = require('./harness.js');
const M = require('./market.js');
const REF = require('./harnesses/reference.js');

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'world-states.json'), 'utf8'))
  .states.baseline_2050;
const S0 = E.seed(BASE);

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')); }
}
const NAMES = ['A', 'B'];
const mkOffer = o => Object.assign({ to: 'B', resource: 'compute', quantity: 1, price: 1 }, o);

(async function () {
console.log('\nMeridian trade engine tests — market v' + M.version + '\n');

/* --- surplus and caps ------------------------------------------------- */
console.log('surplus');
const sur = M.surplusOf(S0);
ok(sur.compute > 0, 'a society with compute capacity above 1.0 has compute to sell');
ok(sur.food > 0 && sur.food < 4,
   'a society at 98% food capacity can spare a little — selling into your own margin is allowed');
ok(M.surplusOf(Object.assign({}, S0, { sectors: Object.assign({}, S0.sectors,
     { food_agri: Object.assign({}, S0.sectors.food_agri, { capacity: 0.8 }) }) })).food === 0,
   '...but a society already short of food has none to sell');
ok(sur.credits === Math.round((42 - M.CREDIT_FLOOR) * 100) / 100,
   'credits surplus is reserves above the $' + M.CREDIT_FLOOR + 'bn floor');
const caps = M.exportCaps(S0);
ok(Math.abs(caps.compute - sur.compute * 0.25) < 0.02, 'export cap is 25% of surplus');
ok(caps.labour <= S0.population.by_age.age_20_64 * M.LABOUR_CAP_OF_WORKFORCE + 1,
   'labour exports are additionally capped at 3% of the workforce');

/* --- offer validation ------------------------------------------------- */
console.log('\noffer validation');
const V = (o, rep) => M.validateOffer(mkOffer(o), 'A', 2, S0, rep == null ? 50 : rep);
ok(V({}).ok, 'a well-formed spot offer is accepted');
ok(!V({ to: 'A' }).ok, 'a society cannot trade with itself');
ok(!V({ resource: 'unobtainium' }).ok, 'unknown resource rejected');
ok(!V({ quantity: -3 }).ok, 'negative quantity rejected');
ok(!V({ price: -1 }).ok, 'negative price rejected');
ok(!V({ resource: 'credits', type: 'spot' }).ok, 'credits cannot be SOLD (they are the money)');
ok(V({ resource: 'credits', type: 'aid' }).ok, '...but credits CAN be given as aid');
ok(!V({ quantity: 9999 }).ok, 'a spot beyond the export cap is rejected at the door');
ok(V({ type: 'forward', quantity: 9999, deliver_in: 3 }).ok,
   'a forward may promise more than you hold today — that is what a forward is');
ok(!V({ type: 'forward', deliver_in: 9 }).ok, 'a forward cannot deliver more than 6 rounds out');
ok(!V({ type: 'forward', deliver_in: 2 }, 30).ok,
   'below reputation 40 the forward market is closed to you');
ok(V({ type: 'spot' }, 30).ok, '...but spot trading stays open');
ok(V({}).offer.id === V({}).offer.id, 'offer ids are deterministic');

/* --- reputation -------------------------------------------------------- */
console.log('\nreputation');
ok(M.terms(50) === 1, 'reputation 50 trades at par');
ok(M.terms(100) > M.terms(50) && M.terms(0) < M.terms(50), 'terms rise with reputation');
ok(M.driftReputation(25) === 25 + M.REP.DRIFT, 'a damaged reputation recovers steadily');

ok(M.driftReputation(50) === 50, 'reputation at par does not drift');

/* --- clearing ---------------------------------------------------------- */
console.log('\nclearing');
let mkt = M.createMarket(NAMES);
let states = { A: E.seed(BASE), B: E.seed(BASE) };
let res = M.clear(mkt, { A: { offers: [mkOffer({ quantity: 2, price: 3 })] }, B: {} }, states, NAMES, 2);
ok(mkt.offers.length === 1 && mkt.offers[0].status === 'open', 'a new offer is opened, not settled');
ok(res.deltas.A.reserves_bn === 0, 'nothing moves until it is accepted');

const id = mkt.offers[0].id;
res = M.clear(mkt, { A: {}, B: { responses: { [id]: 'accept' } } }, states, NAMES, 3);
ok(mkt.offers[0].status === 'settled', 'an accepted spot settles');
ok(res.deltas.A.reserves_bn > 0, 'the seller is paid');
ok(res.deltas.B.reserves_bn === -3, 'the buyer pays the agreed price');
ok(res.deltas.B.capacity.compute_telecom > 1, 'the buyer gains compute capacity');
ok(res.deltas.A.capacity.compute_telecom < 1, 'the seller loses it');
ok(mkt.reputation.A > 50, 'delivering raises reputation');

// rejection
mkt = M.createMarket(NAMES);
M.clear(mkt, { A: { offers: [mkOffer({})] }, B: {} }, states, NAMES, 2);
const id2 = mkt.offers[0].id;
res = M.clear(mkt, { A: {}, B: { responses: { [id2]: 'reject' } } }, states, NAMES, 3);
ok(mkt.offers[0].status === 'rejected', 'a rejected offer is closed');
ok(res.deltas.A.reserves_bn === 0 && res.deltas.B.reserves_bn === 0, 'and nothing moves');

// unanswered offers expire
mkt = M.createMarket(NAMES);
M.clear(mkt, { A: { offers: [mkOffer({})] }, B: {} }, states, NAMES, 2);
M.clear(mkt, { A: {}, B: {} }, states, NAMES, 3);
M.clear(mkt, { A: {}, B: {} }, states, NAMES, 4);
ok(mkt.offers[0].status === 'expired', 'an offer nobody answers expires');

// cannot accept what you cannot afford
mkt = M.createMarket(NAMES);
const poor = E.seed(BASE); poor.fiscal.reserves_bn = 2;
M.clear(mkt, { A: { offers: [mkOffer({ quantity: 2, price: 40 })] }, B: {} },
        { A: states.A, B: poor }, NAMES, 2);
res = M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } },
              { A: states.A, B: poor }, NAMES, 3);
ok(mkt.offers[0].status === 'rejected', 'a buyer who cannot pay cannot accept');
ok(res.faults.B.length > 0, '...and is told why');

/* --- aid ---------------------------------------------------------------- */
console.log('\naid');
mkt = M.createMarket(NAMES);
res = M.clear(mkt, { A: { offers: [mkOffer({ resource: 'compute', quantity: 1, type: 'aid' })] }, B: {} },
              states, NAMES, 2);
ok(mkt.contracts[0].status === 'settled', 'aid settles at once and needs no acceptance');
ok(res.deltas.A.legitimacy_bonus > 0, 'the giver gains legitimacy');
ok(res.deltas.B.cohesion_bonus > 0, 'the receiver gains cohesion');
ok(mkt.reputation.A > 50, 'giving aid raises reputation');
ok(res.deltas.B.capacity.compute_telecom > 1, 'and the goods actually arrive');

/* --- forwards, promises and defaults ------------------------------------ */
console.log('\nforwards');
mkt = M.createMarket(NAMES);
M.clear(mkt, { A: { offers: [mkOffer({ type: 'forward', quantity: 3, price: 4, deliver_in: 2 })] }, B: {} },
        states, NAMES, 2);
res = M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } }, states, NAMES, 3);
ok(mkt.contracts[0].status === 'accepted', 'an accepted forward waits for its delivery round');
ok(res.deltas.B.reserves_bn === -4, 'the buyer\'s payment is escrowed at signing');
ok(mkt.contracts[0].deliver_round === 5, 'delivery is scheduled for the agreed round');

res = M.clear(mkt, { A: {}, B: {} }, states, NAMES, 4);
ok(mkt.contracts[0].status === 'accepted', 'nothing happens before the delivery round');

res = M.clear(mkt, { A: {}, B: {} }, states, NAMES, 5);
ok(mkt.contracts[0].status === 'settled', 'a forward the seller can honour delivers');

// ...and one it cannot
mkt = M.createMarket(NAMES);
M.clear(mkt, { A: { offers: [mkOffer({ type: 'forward', quantity: 400, price: 9, deliver_in: 1 })] }, B: {} },
        states, NAMES, 2);
M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } }, states, NAMES, 3);
res = M.clear(mkt, { A: {}, B: {} }, states, NAMES, 4);
ok(mkt.contracts[0].status === 'defaulted', 'a forward the seller cannot honour DEFAULTS');
ok(mkt.reputation.A === 50 + M.REP.DEFAULT, 'defaulting costs 25 reputation');
ok(res.deltas.B.reserves_bn === 9, 'the escrowed payment is returned to the buyer');
ok(res.deltas.B.cohesion_bonus < 0, 'and the buyer takes a cohesion hit for the disruption');

// a spot that cannot be filled is void, not a default
mkt = M.createMarket(NAMES);
const rich = E.seed(BASE);
M.clear(mkt, { A: { offers: [mkOffer({ resource: 'compute', quantity: caps.compute })] }, B: {} },
        { A: rich, B: states.B }, NAMES, 2);
const thin = E.seed(BASE); thin.sectors.compute_telecom.capacity = 0.9;   // surplus gone
res = M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } },
              { A: thin, B: states.B }, NAMES, 3);
ok(mkt.offers[0].status === 'unfilled', 'a spot that cannot be backed is VOID, not a default');
ok(mkt.reputation.A === 50 + M.REP.UNFILLED, '...and costs 5 reputation, not 25');
ok(M.driftReputation(M.driftReputation(M.driftReputation(50 + M.REP.DEFAULT))) === 50,
   'a default takes three rounds of good behaviour to work off');

/* --- barter -------------------------------------------------------------- */
console.log('\nbarter');
ok(V({ return_resource:'food', return_quantity:2 }).ok, 'a swap offer is accepted');
ok(V({ return_resource:'food', return_quantity:2 }).offer.price === 0,
   'a swap carries no price — the goods ARE the price');
ok(!V({ return_resource:'compute', return_quantity:2 }).ok,
   'swapping a resource for itself is not a trade');
ok(!V({ return_resource:'credits', return_quantity:2 }).ok,
   'credits cannot be a swap leg — use price for money');
ok(!V({ return_resource:'food' }).ok, 'a swap leg needs a quantity');
ok(!V({ type:'aid', return_resource:'food', return_quantity:2 }).ok,
   'aid is a gift and cannot ask for anything back');

// both legs move, and both sides gain reputation
mkt = M.createMarket(NAMES);
var swapPair = { A: E.seed(BASE), B: E.seed(BASE) };
swapPair.B.sectors.food_agri.capacity = 1.4;                 // B actually has food
M.clear(mkt, { A: { offers: [mkOffer({ resource:'compute', quantity:4,
                     return_resource:'food', return_quantity:3 })] }, B: {} }, swapPair, NAMES, 2);
res = M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } }, swapPair, NAMES, 3);
ok(mkt.offers[0].status === 'settled', 'a swap both sides can fill settles');
ok(res.deltas.A.capacity.compute_telecom < 1 && res.deltas.B.capacity.compute_telecom > 1,
   'the first leg moves');
ok(res.deltas.B.capacity.food_agri < 1 && res.deltas.A.capacity.food_agri > 1,
   'and so does the second');
ok(res.deltas.A.reserves_bn === 0 && res.deltas.B.reserves_bn === 0,
   'no money changes hands in a swap');
ok(mkt.reputation.A > 50 && mkt.reputation.B > 50, 'both sides kept a promise, so both gain');

// atomic: if one side cannot fill, NOTHING moves
mkt = M.createMarket(NAMES);
var poorB = { A: E.seed(BASE), B: E.seed(BASE) };        // B has no food surplus
M.clear(mkt, { A: { offers: [mkOffer({ resource:'compute', quantity:4,
                     return_resource:'food', return_quantity:3 })] }, B: {} }, poorB, NAMES, 2);
res = M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } }, poorB, NAMES, 3);
ok(mkt.offers[0].status === 'rejected', 'a swap the accepter cannot fill is refused at accept');
ok(Object.keys(res.deltas.A.capacity).length === 0 &&
   Object.keys(res.deltas.B.capacity).length === 0, 'and NOTHING moves — the swap is atomic');
ok(res.faults.B.length > 0, '...and they are told what they were short of');

// a barter forward that breaks blames whoever could not deliver
mkt = M.createMarket(NAMES);
M.clear(mkt, { A: { offers: [mkOffer({ type:'forward', deliver_in:1, resource:'compute',
                     quantity:400, return_resource:'food', return_quantity:1 })] }, B: {} },
        swapPair, NAMES, 2);
M.clear(mkt, { A: {}, B: { responses: { [mkt.offers[0].id]: 'accept' } } }, swapPair, NAMES, 3);
res = M.clear(mkt, { A: {}, B: {} }, swapPair, NAMES, 4);
ok(mkt.contracts[0].status === 'defaulted', 'a broken barter forward defaults');
ok(mkt.contracts[0].failed_side === 'A', '...and records WHICH side could not deliver');
ok(mkt.reputation.A < 50 && mkt.reputation.B >= 50, 'only the party at fault pays for it');

/* --- the market view ----------------------------------------------------- */
console.log('\nmarket view');
mkt = M.createMarket(NAMES);
const view = M.marketView(mkt, 'A', states, NAMES);
ok(view.me === 'A' && view.societies.length === 1, 'a society sees every other society');
ok(view.societies[0].headline.ubi_monthly_sgd != null, 'headline figures are public');
ok(view.societies[0].surplus != null, 'so is what is on everyone\'s shelf');
ok(view.surplus && view.export_caps, 'and its own surplus and caps');
ok(view.forward_market_open === true, 'the forward market is open at reputation 50');

/* --- the full shared world ------------------------------------------------ */
console.log('\nshared world');
const run = await H.runMarket(REF.entries, { base: BASE, shocks: { 6: ['pandemic'] }, rounds: 12 });
ok(run.results.length === 3, 'three societies ran');
ok(run.results.every(r => r.trajectory.length === 12), 'each completed twelve rounds');
ok(run.ledger.length > 0, 'the public ledger recorded events');
ok(run.results.every(r => r.faults.length === 0), 'the reference harnesses trade without faults',
   JSON.stringify(run.results.map(r => r.faults.slice(0, 2))));

// the audit guarantee must survive trade
run.results.forEach(r => {
  const replayed = H.replayMarketTrace(r.trace, { base: BASE, shocks: { 6: ['pandemic'] } });
  const strip = s => { const c = JSON.parse(JSON.stringify(s));
    Object.keys(c).forEach(k => { if (k.charAt(0) === '_') delete c[k]; });
    delete c.trade; return JSON.stringify(c); };
  let same = replayed.length === r.trajectory.length;
  for (let i = 0; same && i < replayed.length; i++) {
    if (strip(replayed[i]) !== strip(r.trajectory[i])) same = false;
  }
  ok(same, r.name + ' replays exactly with trade included');
});

// a society that trades with nobody is unaffected by the market existing
const solo = await H.runHarness(REF.harnesses.guardian,
  { base: BASE, shocks: { 6: ['pandemic'] }, constitution: REF.CONSTITUTIONS.guardian });
ok(typeof solo.score.total === 'number', 'the single-society game still runs unchanged');

// garbage offers do not break the market
const bad = ctx => ({ levers: {}, offers: [{ nonsense: true }, mkOffer({ to: 'Nowhere' })] });
const badRun = await H.runMarket(
  [{ name: 'A', harness: bad }, { name: 'B', harness: () => ({ levers: {} }) }],
  { base: BASE, shocks: {}, rounds: 4 });
ok(badRun.results.every(r => r.trajectory.length === 4), 'malformed offers do not stop the run');
ok(badRun.results.find(r => r.name === 'A').faults.length > 0, '...and are reported as faults');

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed\n');
process.exit(fail ? 1 : 0);
})();
