/* =====================================================================
   LAYER 2b — THE TRADE ENGINE
   ---------------------------------------------------------------------
   Several societies, one world, one clock.

   Harnesses negotiate in plain language and then submit a structured
   offer. The prose is how they reach agreement; the object is what
   settles. **If the prose and the object disagree, the object wins** —
   the market never reads a message, it only executes contracts.

   WHAT MAKES THIS HARD, AND WORTH DOING
   -------------------------------------
   A forward contract is a promise about a future you do not control. You
   sign in round 4 to deliver food in round 7, a shock lands in round 6,
   and now you must choose between your own citizens and your word. The
   engine does not resolve that for you. It just records which one you
   chose, and prices it for the rest of the run.

   THE CLOCK
   ---------
     round N      harness sees offers made in N-1, accepts or rejects
                  them, and makes new offers of its own
     end of N     the market clears: accepted spots settle, forwards
                  falling due are delivered or defaulted, aid transfers
     round N+1    settled goods reach the world state as exogenous
                  capacity, labour and credits

   The one-round lag is deliberate. It gives the negotiation channel
   something to do, and it means a deal takes trust rather than reflexes.
   ===================================================================== */

(function (root) {
'use strict';

const E = (typeof require !== 'undefined') ? require('./meridian-engine.js') : root.MeridianEngine;

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const deepClone = o => JSON.parse(JSON.stringify(o));
const round2 = v => Math.round(v * 100) / 100;

/* ---------------------------------------------------------------------
   1. WHAT CAN BE TRADED
   ---------------------------------------------------------------------
   Five resources, each drawn from a distinct part of the world state, so
   selling something always costs you the thing you sold.
   --------------------------------------------------------------------- */
const RESOURCES = {
  compute: {
    label: 'Compute', unit: '$bn', sector: 'compute_telecom',
    note: 'Data centre and grid capacity above domestic need.'
  },
  energy: {
    label: 'Energy', unit: '$bn', sector: 'energy_utilities',
    note: 'Grid and utility capacity above domestic need.'
  },
  food: {
    label: 'Food', unit: '$bn', sector: 'food_agri',
    note: 'Calories above domestic need. Scarce for everyone at once when a shock lands.'
  },
  labour: {
    label: 'Skilled labour', unit: 'workers', sector: null,
    note: 'Unemployed low-exposure workers — care, trades, complex judgement.'
  },
  credits: {
    label: 'Sovereign credits', unit: '$bn', sector: null, aid_only: true,
    note: 'Reserves above the $20bn a society may not lend away. Credits are ' +
          'the money, so they cannot be SOLD — selling money for money is not ' +
          'a trade. They may be given as aid, which is what a bailout is.'
  }
};
const RESOURCE_KEYS = Object.keys(RESOURCES);

const EXPORT_CAP = 0.25;        // no more than a quarter of what you could sell, per round
/* How far a society may sell INTO its own need, not merely out of its
   excess. At 1.0 nobody could ever sell anything — a real economy runs at
   roughly the capacity it needs, so "only the surplus above demand is
   tradable" means no trade at all. At 0.90 you may sell down to ninety per
   cent of your own demand, and going below that is a choice with a cost
   the engine will charge you for in service quality. */
const TRADE_FLOOR = 0.90;
const CREDIT_FLOOR = 20;        // $bn a society may not lend away
const LABOUR_SECTOR = 'care_services';   // where borrowed hands go by default
/* A city-state does not lend out a tenth of its workforce, however many
   people the machines have idled. The 25% surplus rule is not enough on
   its own here, because mass unemployment makes the surplus enormous. */
const LABOUR_CAP_OF_WORKFORCE = 0.03;

/* What a society could sell this round, before the export cap. */
function surplusOf(state) {
  const out = {};
  RESOURCE_KEYS.forEach(k => {
    const r = RESOURCES[k];
    if (r.sector) {
      const sec = state.sectors[r.sector];
      out[k] = round2(Math.max(0, (sec.capacity - TRADE_FLOOR) * E.SECTORS[r.sector].base_output_bn));
    }
  });
  const pop = state.population;
  const unemployed = Math.max(0, pop.by_age.age_20_64 - pop.employed_total);
  const lowShare = pop.by_exposure.low / Math.max(1, pop.by_age.age_20_64);
  out.labour = Math.round(unemployed * lowShare);
  out.credits = round2(Math.max(0, state.fiscal.reserves_bn - CREDIT_FLOOR));
  return out;
}

function exportCaps(state) {
  const s = surplusOf(state), caps = {};
  RESOURCE_KEYS.forEach(k => { caps[k] = round2(s[k] * EXPORT_CAP); });
  caps.labour = Math.min(
    Math.floor(s.labour * EXPORT_CAP),
    Math.floor(state.population.by_age.age_20_64 * LABOUR_CAP_OF_WORKFORCE));
  return caps;
}

/* ---------------------------------------------------------------------
   2. REPUTATION
   ---------------------------------------------------------------------
   0-100, published, and it does two concrete things: it moves the terms
   a counterparty actually receives, and below 40 it closes the forward
   market to you entirely. Nobody sells you a promise on credit when your
   promises have not been good.
   --------------------------------------------------------------------- */
const REP = {
  START: 50,
  DELIVER: +4,
  DEFAULT: -25,          // breaking a forward: a promise about the future
  UNFILLED: -5,          // a spot that could not be backed on the day
  AID_GIVEN: +6,
  DRIFT: 9,               // per round, back toward 50: a default (-25) takes
                          // exactly three rounds of good behaviour to work off
  FORWARD_FLOOR: 40       // below this you may only trade spot
};

/** Published multiplier on what a seller actually receives. */
function terms(reputation) {
  return round2(0.8 + 0.4 * clamp(reputation, 0, 100) / 100);
}

function driftReputation(rep) {
  if (rep < REP.START) return Math.min(REP.START, rep + REP.DRIFT);
  if (rep > REP.START) return Math.max(REP.START, rep - REP.DRIFT * 0.25);
  return rep;
}

/* ---------------------------------------------------------------------
   3. OFFERS
   ---------------------------------------------------------------------
   A harness returns offers as plain objects. Anything malformed is
   rejected at the door with a reason the harness can read next round —
   a market that silently swallows bad orders teaches nobody anything.
   --------------------------------------------------------------------- */
function validateOffer(raw, from, roundNo, state, reputation) {
  const err = m => ({ ok: false, reason: m });
  if (!raw || typeof raw !== 'object') return err('offer is not an object');

  const type = raw.type || 'spot';
  if (['spot', 'forward', 'aid'].indexOf(type) < 0) return err('unknown type "' + type + '"');
  if (!raw.to || typeof raw.to !== 'string') return err('offer needs a counterparty in `to`');
  if (raw.to === from) return err('a society cannot trade with itself');
  if (RESOURCE_KEYS.indexOf(raw.resource) < 0)
    return err('unknown resource "' + raw.resource + '" (try: ' + RESOURCE_KEYS.join(', ') + ')');
  if (RESOURCES[raw.resource].aid_only && type !== 'aid')
    return err(raw.resource + ' is the medium of exchange, not a good. It can be given as ' +
               'aid but not sold.');

  const qty = Number(raw.quantity);
  if (!isFinite(qty) || qty <= 0) return err('quantity must be a positive number');

  /* BARTER. An offer may ask for goods instead of money. Both legs then
     settle together or neither does — which is the whole point, because
     two separate cash deals can be half-accepted and somebody eats it. */
  const wantsBack = raw.return_resource != null && raw.return_resource !== '';
  let returnResource = null, returnQuantity = 0;
  if (wantsBack) {
    if (type === 'aid') return err('aid is a gift — it cannot ask for anything back');
    if (RESOURCE_KEYS.indexOf(raw.return_resource) < 0)
      return err('unknown resource "' + raw.return_resource + '" on the return leg');
    if (RESOURCES[raw.return_resource].aid_only)
      return err('credits are the money — ask for them with `price`, not as a swap');
    if (raw.return_resource === raw.resource)
      return err('swapping ' + raw.resource + ' for ' + raw.resource + ' is not a trade');
    returnQuantity = Number(raw.return_quantity);
    if (!isFinite(returnQuantity) || returnQuantity <= 0)
      return err('the return leg needs a quantity');
    returnResource = raw.return_resource;
  }

  const price = (type === 'aid' || wantsBack) ? 0 : Number(raw.price);
  if (type !== 'aid' && !wantsBack && (!isFinite(price) || price < 0))
    return err('price must be zero or more');

  const deliverIn = type === 'forward' ? Math.round(Number(raw.deliver_in) || 1) : 0;
  if (type === 'forward' && (deliverIn < 1 || deliverIn > 6))
    return err('a forward must deliver in 1 to 6 rounds');
  if (type === 'forward' && reputation < REP.FORWARD_FLOOR)
    return err('reputation ' + reputation + ' is below ' + REP.FORWARD_FLOOR +
               '; only spot trades are open to you');

  // A spot sale must be backed right now. A forward is a promise, and
  // whether it was a wise one is settled on the delivery round.
  if (type !== 'forward') {
    const cap = exportCaps(state)[raw.resource];
    if (qty > cap + 1e-9) {
      return err('you may export at most ' + cap + ' ' + RESOURCES[raw.resource].unit +
                 ' of ' + raw.resource + ' this round — a quarter of what you can spare ' +
                 'without cutting your own supply below ' + Math.round(TRADE_FLOOR * 100) + '%');
    }
  }

  return {
    ok: true,
    offer: {
      id: from.replace(/\s+/g, '') + '-r' + roundNo + '-' + Math.abs(hashOffer(from, raw, roundNo)).toString(36),
      from: from, to: raw.to, resource: raw.resource,
      quantity: round2(qty), price: round2(price), type: type,
      return_resource: returnResource,
      return_quantity: returnResource ? round2(returnQuantity) : 0,
      deliver_in: deliverIn, signed_round: null, deliver_round: null,
      offered_round: roundNo, status: 'open',
      note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : ''
    }
  };
}

/* Deterministic id: same offer in the same round always gets the same
   handle, so a trace is stable and a ledger is diffable. */
function hashOffer(from, raw, roundNo) {
  const s = from + '|' + raw.to + '|' + raw.resource + '|' + raw.quantity + '|' +
            raw.price + '|' + (raw.type || 'spot') + '|' + roundNo;
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}

/* ---------------------------------------------------------------------
   4. THE MARKET
   --------------------------------------------------------------------- */
function createMarket(names) {
  const m = { round: 0, offers: [], contracts: [], ledger: [], messages: [], reputation: {} };
  names.forEach(n => { m.reputation[n] = REP.START; });
  return m;
}

/** What one society sees. Everything here is public except its own surplus. */
function marketView(market, me, states, names) {
  const state = states[me];
  return {
    me: me,
    reputation: market.reputation[me],
    terms_multiplier: terms(market.reputation[me]),
    forward_market_open: market.reputation[me] >= REP.FORWARD_FLOOR,
    surplus: surplusOf(state),
    export_caps: exportCaps(state),
    resources: RESOURCES,
    societies: names.filter(n => n !== me).map(n => ({
      name: n,
      reputation: market.reputation[n],
      terms_multiplier: terms(market.reputation[n]),
      headline: {
        ubi_monthly_sgd: states[n].indicators.ubi_monthly_sgd,
        worst_essential: Math.min.apply(null, E.ESSENTIAL.map(k => states[n].sectors[k].quality)),
        employment_rate: states[n].indicators.employment_rate,
        reserves_bn: states[n].fiscal.reserves_bn,
        cohesion: states[n].indicators.cohesion
      },
      surplus: surplusOf(states[n])     // the ledger is public; so is the shelf
    })),
    offers_to_me: market.offers.filter(o => o.to === me && o.status === 'open'),
    my_open_offers: market.offers.filter(o => o.from === me && o.status === 'open'),
    my_contracts: market.contracts.filter(c => (c.from === me || c.to === me) && c.status === 'accepted'),
    ledger: market.ledger.slice(-24),
    messages: market.messages.filter(x => !x.to || x.to === me).slice(-12)
  };
}

/* ---------------------------------------------------------------------
   5. CLEARING
   ---------------------------------------------------------------------
   Runs once at the end of every round, after every harness has spoken.
   Produces the exogenous deltas each society carries into the next tick.
   --------------------------------------------------------------------- */
function blankDelta() {
  return { reserves_bn: 0, capacity: {}, headcount: {}, cohesion_bonus: 0, legitimacy_bonus: 0 };
}

function applyResource(delta, resource, qty, sign) {
  const r = RESOURCES[resource];
  if (r.sector) {
    const base = E.SECTORS[r.sector].base_output_bn;
    const mult = 1 + sign * (qty / base);
    delta.capacity[r.sector] = (delta.capacity[r.sector] || 1) * Math.max(0.4, mult);
  } else if (resource === 'labour') {
    // Borrowed hands staff the receiving society and draw its wages. The
    // lender was not employing them, so its own headcount does not fall.
    if (sign > 0) delta.headcount[LABOUR_SECTOR] = (delta.headcount[LABOUR_SECTOR] || 0) + qty;
  } else if (resource === 'credits') {
    delta.reserves_bn += sign * qty;
  }
}

/** Can `seller` actually deliver `qty` of `resource` right now?
    A spot is now struck and settled against the same state, so no drift
    allowance is needed. A forward still faces the world as it turns out
    to be on the delivery round — which is the whole risk of a forward. */
const SETTLE_TOLERANCE = 1.0;
function canDeliver(state, resource, qty) {
  return qty <= exportCaps(state)[resource] * SETTLE_TOLERANCE + 1e-9;
}

function settle(market, contract, states, deltas, roundNo, log) {
  const seller = contract.from, buyer = contract.to;

  if (contract.type === 'aid') {
    applyResource(deltas[seller], contract.resource, contract.quantity, -1);
    applyResource(deltas[buyer], contract.resource, contract.quantity, +1);
    deltas[seller].legitimacy_bonus += 3;
    deltas[buyer].cohesion_bonus += 3;
    market.reputation[seller] = clamp(market.reputation[seller] + REP.AID_GIVEN, 0, 100);
    contract.status = 'settled';
    contract.settled_round = roundNo;
    log.push({ round: roundNo, event: 'aid', id: contract.id, from: seller, to: buyer,
      resource: contract.resource, quantity: contract.quantity,
      text: seller + ' sent ' + contract.quantity + ' ' + contract.resource + ' to ' + buyer + ' as aid.' });
    return;
  }

  /* A swap has two promises, and either can break. Whoever cannot deliver
     is the one who pays for it; the other side is simply left without the
     deal they were counting on. */
  if (contract.return_resource) {
    const sellerOk = canDeliver(states[seller], contract.resource, contract.quantity);
    const buyerOk = canDeliver(states[buyer], contract.return_resource, contract.return_quantity);
    if (!sellerOk || !buyerOk) {
      const culprit = !sellerOk ? seller : buyer;
      const isPromise = contract.type === 'forward';
      contract.status = isPromise ? 'defaulted' : 'unfilled';
      contract.settled_round = roundNo;
      contract.failed_side = culprit;
      market.reputation[culprit] = clamp(
        market.reputation[culprit] + (isPromise ? REP.DEFAULT : REP.UNFILLED), 0, 100);
      if (isPromise) deltas[culprit === seller ? buyer : seller].cohesion_bonus -= 2;
      log.push({ round: roundNo, event: isPromise ? 'default' : 'unfilled',
        id: contract.id, from: seller, to: buyer,
        resource: contract.resource, quantity: contract.quantity,
        text: culprit + (isPromise ? ' DEFAULTED on the swap' : ' could not fill the swap') +
              ' — ' + contract.quantity + ' ' + contract.resource + ' for ' +
              contract.return_quantity + ' ' + contract.return_resource +
              (isPromise ? '. Reputation ' + market.reputation[culprit] + '.' : '. Deal void.') });
      return;
    }
    applyResource(deltas[seller], contract.resource, contract.quantity, -1);
    applyResource(deltas[buyer], contract.resource, contract.quantity, +1);
    applyResource(deltas[buyer], contract.return_resource, contract.return_quantity, -1);
    applyResource(deltas[seller], contract.return_resource, contract.return_quantity, +1);
    // Both sides kept a promise, so both sides gain by it.
    market.reputation[seller] = clamp(market.reputation[seller] + REP.DELIVER, 0, 100);
    market.reputation[buyer] = clamp(market.reputation[buyer] + REP.DELIVER, 0, 100);
    contract.status = 'settled';
    contract.settled_round = roundNo;
    log.push({ round: roundNo, event: 'delivered', id: contract.id, from: seller, to: buyer,
      resource: contract.resource, quantity: contract.quantity,
      text: seller + ' and ' + buyer + ' swapped ' + contract.quantity + ' ' + contract.resource +
            ' for ' + contract.return_quantity + ' ' + contract.return_resource + '.' });
    return;
  }

  if (!canDeliver(states[seller], contract.resource, contract.quantity)) {
    /* Two very different failures wear the same clothes here, and the
       market distinguishes them.

       A SPOT trade that cannot be backed on the day is a deal that did not
       clear. The seller's surplus moved between offering and settling —
       one round — and nobody promised anything about the future. Small
       penalty, no drama.

       A FORWARD is a promise about a future you did not control. You said
       you would deliver in round seven, a shock landed in round six, and
       now your own citizens and your word are asking for the same goods.
       The engine does not resolve that for you. It records which one you
       chose, and prices it for the next three rounds. */
    const isPromise = contract.type === 'forward';
    contract.status = isPromise ? 'defaulted' : 'unfilled';
    contract.settled_round = roundNo;
    if (contract.escrowed) deltas[buyer].reserves_bn += contract.price;
    market.reputation[seller] = clamp(
      market.reputation[seller] + (isPromise ? REP.DEFAULT : REP.UNFILLED), 0, 100);
    if (isPromise) deltas[buyer].cohesion_bonus -= 2;
    log.push({ round: roundNo, event: isPromise ? 'default' : 'unfilled',
      id: contract.id, from: seller, to: buyer,
      resource: contract.resource, quantity: contract.quantity,
      text: isPromise
        ? seller + ' DEFAULTED on ' + contract.quantity + ' ' + contract.resource +
          ' owed to ' + buyer + '. Payment returned; reputation ' + market.reputation[seller] + '.'
        : seller + ' could not fill ' + contract.quantity + ' ' + contract.resource +
          ' for ' + buyer + ' — surplus moved before settlement. Deal void.' });
    return;
  }

  const received = round2(contract.price * terms(market.reputation[seller]));
  applyResource(deltas[seller], contract.resource, contract.quantity, -1);
  applyResource(deltas[buyer], contract.resource, contract.quantity, +1);
  deltas[seller].reserves_bn += received;
  if (!contract.escrowed) deltas[buyer].reserves_bn -= contract.price;
  market.reputation[seller] = clamp(market.reputation[seller] + REP.DELIVER, 0, 100);
  contract.status = 'settled';
  contract.settled_round = roundNo;
  contract.received = received;
  log.push({ round: roundNo, event: 'delivered', id: contract.id, from: seller, to: buyer,
    resource: contract.resource, quantity: contract.quantity, price: contract.price, received: received,
    text: seller + ' delivered ' + contract.quantity + ' ' + contract.resource + ' to ' + buyer +
          ' for $' + contract.price + 'bn' +
          (received !== contract.price ? ' (received $' + received + 'bn at reputation terms)' : '') + '.' });
}

/**
 * clear(market, submissions, states, names, roundNo)
 *   submissions: { societyName: { offers, responses, message, messages } }
 * Returns per-society exogenous deltas for the next tick.
 */
function clear(market, submissions, states, names, roundNo) {
  const deltas = {};
  names.forEach(n => { deltas[n] = blankDelta(); });

  /* Reputation heals at the START of a round, before this round's events.
     Applied afterwards it would cancel the very penalty it is meant to
     let a society work off, and a small penalty would cost nothing at all. */
  names.forEach(n => { market.reputation[n] = Math.round(driftReputation(market.reputation[n])); });
  const log = [];
  const faults = {};
  names.forEach(n => { faults[n] = []; });

  /* --- 5a. new offers, registered FIRST ------------------------------------------------- */
  names.forEach(me => {
    const offers = (submissions[me] && submissions[me].offers) || [];
    if (!Array.isArray(offers)) { faults[me].push('offers must be an array'); return; }
    offers.slice(0, 6).forEach(raw => {
      const v = validateOffer(raw, me, roundNo, states[me], market.reputation[me]);
      if (!v.ok) { faults[me].push('offer rejected — ' + v.reason); return; }
      if (names.indexOf(v.offer.to) < 0) { faults[me].push('no society named "' + v.offer.to + '"'); return; }
      // Aid is unilateral: it needs no acceptance and settles at once.
      if (v.offer.type === 'aid') {
        v.offer.status = 'accepted';
        v.offer.signed_round = roundNo;
        v.offer.deliver_round = roundNo;
        market.contracts.push(v.offer);
        settle(market, v.offer, states, deltas, roundNo, log);
      } else {
        market.offers.push(v.offer);
        log.push({ round: roundNo, event: 'offered', id: v.offer.id, from: me, to: v.offer.to,
          text: me + ' offered ' + v.offer.to + ' ' + v.offer.quantity + ' ' + v.offer.resource +
                (v.offer.return_resource
                   ? ' in exchange for ' + v.offer.return_quantity + ' ' + v.offer.return_resource
                   : ' for $' + v.offer.price + 'bn') +
                (v.offer.type === 'forward' ? ', delivering in ' + v.offer.deliver_in + ' rounds' : '') + '.' });
      }
    });
  });

  /* --- 5b. answers — including to offers made a moment ago ------------
     Registering the new offers first is what makes a deal strikeable in
     the round it is proposed. It also stops offers going stale: the
     surplus that backed the offer is the same surplus that settles it. */
  names.forEach(me => {
    const res = (submissions[me] && submissions[me].responses) || {};
    Object.keys(res).forEach(id => {
      const offer = market.offers.find(o => o.id === id && o.to === me && o.status === 'open');
      if (!offer) { faults[me].push('no open offer "' + id + '" addressed to you'); return; }

      const raw = res[id];
      const isCounter = raw && typeof raw === 'object';
      const verdict = isCounter ? 'counter' : String(raw).toLowerCase();

      /* A COUNTER is a third answer, and the one real negotiations are made
         of. It closes the original and opens a new offer running the other
         way, carrying the original's terms with whatever the counterparty
         changed. The two are linked, so the thread reads as a conversation
         rather than as unrelated offers passing in the night. */
      if (verdict === 'counter') {
        offer.status = 'countered';
        const terms = Object.assign({
          to: offer.from, resource: offer.resource, quantity: offer.quantity,
          price: offer.price, type: offer.type, deliver_in: offer.deliver_in,
          note: 'counter to ' + offer.id
        }, raw);
        terms.to = offer.from;               // a counter always goes back to the offeror
        const v = validateOffer(terms, me, roundNo, states[me], market.reputation[me]);
        if (!v.ok) {
          faults[me].push('counter to ' + id + ' rejected — ' + v.reason);
          offer.status = 'rejected';
          return;
        }
        v.offer.counters = offer.id;
        offer.countered_by = v.offer.id;
        market.offers.push(v.offer);
        log.push({ round: roundNo, event: 'countered', id: v.offer.id, from: me, to: offer.from,
          text: me + ' countered ' + offer.from + ': ' + v.offer.quantity + ' ' +
                v.offer.resource + ' at $' + v.offer.price + 'bn' +
                (v.offer.type === 'forward' ? ', delivering in ' + v.offer.deliver_in + ' rounds' : '') +
                ' (was ' + offer.quantity + ' at $' + offer.price + 'bn).' });
        return;
      }

      if (verdict !== 'accept') {
        offer.status = 'rejected';
        log.push({ round: roundNo, event: 'rejected', id: id, from: offer.from, to: me,
          text: me + ' declined ' + offer.from + "'s " + offer.quantity + ' ' + offer.resource + '.' });
        return;
      }
      // A buyer must be able to pay. In a barter the payment is goods, and
      // whether they have them is settled on the delivery day like any
      // other promise. Aid costs the receiver nothing.
      if (offer.type !== 'aid' && !offer.return_resource &&
          states[me].fiscal.reserves_bn < offer.price) {
        offer.status = 'rejected';
        faults[me].push('cannot afford ' + id + ': $' + offer.price + 'bn against reserves of $' +
          round2(states[me].fiscal.reserves_bn) + 'bn');
        return;
      }
      if (offer.return_resource && !canDeliver(states[me], offer.return_resource, offer.return_quantity)) {
        offer.status = 'rejected';
        faults[me].push('cannot accept ' + id + ': you do not have ' + offer.return_quantity +
          ' ' + offer.return_resource + ' to swap this round (cap ' +
          exportCaps(states[me])[offer.return_resource] + ')');
        return;
      }
      offer.status = 'accepted';
      offer.signed_round = roundNo;
      offer.deliver_round = roundNo + offer.deliver_in;
      if (offer.type === 'forward' && !offer.return_resource) {
        // The buyer's money is escrowed at signing. The seller's goods
        // are not: that is exactly what a forward is, and exactly why it
        // can fail.
        deltas[me].reserves_bn -= offer.price;
        offer.escrowed = true;
        log.push({ round: roundNo, event: 'signed', id: id, from: offer.from, to: me,
          text: me + ' signed ' + offer.from + "'s forward for " + offer.quantity + ' ' +
                offer.resource + ', delivering round ' + offer.deliver_round +
                ' ($' + offer.price + 'bn escrowed).' });
      } else if (offer.type === 'forward') {
        // A barter forward escrows nothing — both sides are promising.
        log.push({ round: roundNo, event: 'signed', id: id, from: offer.from, to: me,
          text: me + ' signed a swap with ' + offer.from + ': ' + offer.quantity + ' ' +
                offer.resource + ' for ' + offer.return_quantity + ' ' + offer.return_resource +
                ', both delivering round ' + offer.deliver_round + '.' });
      }
      market.contracts.push(offer);
    });
  });

  /* --- 5b. deliveries falling due ------------------------------------- */
  market.contracts.forEach(c => {
    if (c.status !== 'accepted') return;
    if (c.type === 'aid' || c.deliver_round <= roundNo) settle(market, c, states, deltas, roundNo, log);
  });

  /* --- 5d. offers nobody answered ------------------------------------- */
  market.offers.forEach(o => {
    if (o.status === 'open' && roundNo - o.offered_round >= 2) {
      o.status = 'expired';
      log.push({ round: roundNo, event: 'expired', id: o.id, from: o.from, to: o.to,
        text: o.to + ' never answered ' + o.from + "'s offer of " + o.quantity + ' ' + o.resource + '.' });
    }
  });

  /* --- 5e. messages, and reputation drifting home --------------------- */
  names.forEach(me => {
    const sub = submissions[me] || {};
    if (typeof sub.message === 'string' && sub.message.trim()) {
      market.messages.push({ round: roundNo, from: me, to: null, text: sub.message.slice(0, 500) });
    }
    if (sub.messages && typeof sub.messages === 'object') {
      Object.keys(sub.messages).slice(0, 5).forEach(to => {
        if (names.indexOf(to) >= 0 && to !== me) {
          market.messages.push({ round: roundNo, from: me, to: to, text: String(sub.messages[to]).slice(0, 500) });
        }
      });
    }
  });

  market.ledger.push.apply(market.ledger, log);
  market.round = roundNo;
  return { deltas: deltas, log: log, faults: faults };
}

/* --------------------------------------------------------------------- */
const API = {
  RESOURCES, RESOURCE_KEYS, REP, EXPORT_CAP, CREDIT_FLOOR, LABOUR_SECTOR, TRADE_FLOOR,
  LABOUR_CAP_OF_WORKFORCE, SETTLE_TOLERANCE,
  surplusOf, exportCaps, terms, driftReputation,
  createMarket, marketView, validateOffer, clear, canDeliver,
  version: '1.0.0'
};
root.MeridianMarket = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
