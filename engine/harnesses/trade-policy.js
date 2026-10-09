/* =====================================================================
   TRADE POLICIES FOR THE REFERENCE HARNESSES
   ---------------------------------------------------------------------
   Three ways to behave in a market, bolted onto the three reference
   governments. Deliberately simple: they exist so the market has traffic
   to demonstrate, and so students have something to out-negotiate.

   A real team's harness would reason about this in language — reading
   the other societies' surpluses and needs, weighing a forward against
   the chance of a shock, deciding whether a reputation is worth keeping
   when your own hospitals are failing. That is the interesting version.
   This is the floor.
   ===================================================================== */

const E = require('../meridian-engine.js');
const M = require('../market.js');

/* Roughly what a thing is worth, before anyone haggles. */
function fairPrice(resource, qty) {
  if (resource === 'labour') return Math.round(qty * 0.00006 * 100) / 100;  // ~$60k/worker/yr
  if (resource === 'credits') return Math.round(qty * 1.02 * 100) / 100;    // lending costs something
  return Math.round(qty * 1.15 * 100) / 100;                                // goods carry a margin
}

/* What is currently hurting, and which resource would help. */
function needsOf(state) {
  const needs = [];
  const s = state.sectors;
  if (s.food_agri.capacity < 1.0) needs.push({ resource: 'food', urgency: 1 - s.food_agri.capacity });
  if (s.compute_telecom.capacity < 1.0) needs.push({ resource: 'compute', urgency: 1 - s.compute_telecom.capacity });
  if (s.energy_utilities.capacity < 1.0) needs.push({ resource: 'energy', urgency: 1 - s.energy_utilities.capacity });
  if (s.care_services.quality < 60) needs.push({ resource: 'labour', urgency: (60 - s.care_services.quality) / 60 });
  if (state.fiscal.reserves_bn < 40) needs.push({ resource: 'credits', urgency: (40 - state.fiscal.reserves_bn) / 40 });
  return needs.sort((a, b) => b.urgency - a.urgency);
}

/**
 * tradePolicy(ctx, style) -> { offers, responses, message }
 *   style: 'extractive' | 'protective' | 'reciprocal'
 */
function tradePolicy(ctx, style) {
  const mkt = ctx.market;
  if (!mkt) return {};                       // single-society run: no market at all

  const offers = [], responses = {};
  const caps = mkt.export_caps;
  const myNeeds = needsOf(ctx.state);
  const myNeedKeys = myNeeds.map(n => n.resource);
  const notes = [];

  /* --- 1. answer what is on the table -------------------------------- */
  (mkt.offers_to_me || []).forEach(o => {
    if (o.type === 'aid') return;   // a gift is already given; there is nothing to accept

    const wanted = myNeedKeys.indexOf(o.resource) >= 0;
    const affordable = o.price <= ctx.state.fiscal.reserves_bn - 15;
    const fair = o.price <= fairPrice(o.resource, o.quantity) * 1.5;
    const counterpartyTrusted = (mkt.societies.find(x => x.name === o.from) || {}).reputation >= 35;

    if (style === 'extractive') {
      // Buys only what is cheap, and only if it is already in trouble.
      responses[o.id] = (wanted && affordable && o.price <= fairPrice(o.resource, o.quantity))
        ? 'accept' : 'reject';
    } else if (style === 'protective') {
      // Will overpay for anything that defends a failing service.
      responses[o.id] = (wanted && affordable && counterpartyTrusted) ? 'accept' : 'reject';
    } else {
      responses[o.id] = (wanted && affordable && fair && counterpartyTrusted) ? 'accept' : 'reject';
    }
    if (responses[o.id] === 'accept') notes.push('took ' + o.quantity + ' ' + o.resource + ' from ' + o.from);
  });

  /* --- 2. sell the surplus -------------------------------------------- */
  const sellable = M.RESOURCE_KEYS
    .filter(k => !M.RESOURCES[k].aid_only)      // credits are money, not stock
    .filter(k => caps[k] > (k === 'labour' ? 5000 : 0.6))
    .filter(k => myNeedKeys.indexOf(k) < 0)     // never sell what you need
    .sort((a, b) => caps[b] - caps[a]);

  const buyers = (mkt.societies || []).slice();

  sellable.slice(0, 2).forEach(res => {
    // Sell to whoever needs it most — which, since the ledger is public,
    // is also whoever will pay most.
    // We never see another society's internals — only what the market
    // publishes. So infer who needs this most from what is public: a low
    // worst-service, a thin reserve, and whether they said so out loud.
    const scored = buyers.map(b => {
      const asked = (mkt.messages || []).some(m => m.from === b.name &&
        new RegExp(res, 'i').test(m.text || ''));
      const pressure = (80 - b.headline.worst_essential) / 80 +
                       (b.headline.reserves_bn < 50 ? 0.4 : 0) +
                       (asked ? 0.6 : 0);
      return { b: b, pressure: pressure };
    }).sort((x, y) => y.pressure - x.pressure);

    const target = scored[0] && scored[0].b;
    if (!target) return;
    // Do not shout the same offer across the table twice.
    const alreadyOpen = (mkt.my_open_offers || []).some(
      o => o.resource === res && o.to === target.name);
    if (alreadyOpen) return;

    const qty = res === 'labour' ? Math.floor(caps[res]) : Math.round(caps[res] * 100) / 100;
    const base = fairPrice(res, qty);
    const price = style === 'extractive' ? Math.round(base * 1.45 * 100) / 100
                : style === 'protective' ? Math.round(base * 0.9 * 100) / 100
                : base;

    // The reciprocal style will write a forward; the extractive one wants
    // the money now; the protective one prefers not to promise at all.
    const useForward = style === 'reciprocal' && mkt.forward_market_open && ctx.round <= 8;
    offers.push({
      to: target.name, resource: res, quantity: qty, price: price,
      type: useForward ? 'forward' : 'spot',
      deliver_in: useForward ? 2 : 0,
      note: 'surplus ' + res
    });
    notes.push('offered ' + qty + ' ' + res + ' to ' + target.name);
  });

  /* --- 3. aid ---------------------------------------------------------- */
  if (style === 'protective' || style === 'reciprocal') {
    const desperate = (mkt.societies || []).find(b => b.headline.worst_essential < 40);
    if (desperate) {
      if (caps.food > 0.5 && myNeedKeys.indexOf('food') < 0) {
        offers.push({ to: desperate.name, resource: 'food', quantity: Math.round(caps.food * 40) / 100,
                      type: 'aid', note: 'humanitarian' });
        notes.push('sent food aid to ' + desperate.name);
      }
      // A bailout: credits can be given, never sold.
      if (desperate.headline.reserves_bn < 25 && caps.credits > 4) {
        offers.push({ to: desperate.name, resource: 'credits',
                      quantity: Math.round(Math.min(caps.credits * 0.3, 12) * 100) / 100,
                      type: 'aid', note: 'emergency support' });
        notes.push('sent credits to ' + desperate.name);
      }
    }
  }

  /* --- 4. say something ------------------------------------------------ */
  const wants = myNeeds.slice(0, 2).map(n => n.resource).join(' and ');
  const has = sellable.slice(0, 2).join(' and ');
  let message;
  if (style === 'extractive') {
    message = has ? ('Meridian-' + mkt.me + ' has ' + has + ' available. Prices are firm.') : null;
  } else if (style === 'protective') {
    message = wants ? ('We are short of ' + wants + ' and will pay above the going rate. ' +
      'We do not default.') : 'Holding. We will meet every contract we have signed.';
  } else {
    message = (has ? 'Offering ' + has + '. ' : '') + (wants ? 'Seeking ' + wants + '. ' : '') +
      'We prefer forwards with counterparties who deliver.';
  }

  return { offers: offers, responses: responses, message: message, tradeNotes: notes };
}

module.exports = { tradePolicy, needsOf, fairPrice };
