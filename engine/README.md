# The Meridian engine — Layer 1

`world state + lever settings -> next world state`. Deterministic. Frozen before the event.

## Files

| File | What it is |
|---|---|
| `meridian-engine.js` | **Canonical.** What the live platform runs. Read this one. |
| `meridian_engine.py` | Line-for-line Python mirror, for offline experimentation. Section numbers match the JS. |
| `test_parity.py` | Runs both over 10 lever sets and asserts they agree to 1e-9. |
| `calibrate.js` | Runs the four canonical lever sets forward and prints full trajectories. |
| `harness.js` | **Layer 2 contract.** Runner, replay/audit, doctrine checker, tournament. |
| `harnesses/reference.js` | Three complete working governments — Accelerate, Guardian, Steward. |
| `harnesses/llm.js` | Provider-agnostic model adapter; `makeLLMHarness`, `makeCabinetHarness`. |
| `market.js` | **The trade engine.** Resources, contracts, clearing, reputation, ledger. |
| `harnesses/trade-policy.js` | Three ways to behave in a market, for the reference governments. |
| `harnesses/policy.js` | **The policy interpreter.** Runs a government declared as JSON. |
| `run-bundle.js` | Runs the bundles teams export from the Team Console. |
| `../lab/studio.html` | **Meridian Studio** — the lab and the market on one screen. Start here. |
| `../lab/build-studio.js` | Inlines engine + market + city + baseline into `dist/meridian-studio.html`. |
| `../lab/console.html` | The older Team Console — market and builders, no lab. |
| `../lab/build-console.js` | Inlines engine + market + baseline into `dist/meridian-console.html`. |
| `../lab/serve-console.js` | Serves the console on the room's wifi, and holds the round clock. |
| `test_harness.js` | 54 tests over the harness layer. No API key needed. |
| `test_market.js` | 67 tests over the trade engine. |
| `run-tournament.js` | Standings, constitutional audit, cross-play. |
| `run-market.js` | The shared world: three societies, one clock, one market. |
| `../lab/lab.template.html` | The live policy lab UI. |
| `../lab/city.js` | Isometric city renderer, ported from the original monitor. |
| `../lab/build.js` | Bundles engine + city + baseline into `dist/meridian-lab.html`. |
| `../lab/inject-monitor.js` | Feeds engine output into the **original** bundled monitor. |

## Run it

```bash
node engine/calibrate.js
```

```bash
python engine/test_parity.py
```

```bash
node lab/build.js
```

`build.js` writes the self-contained `dist/meridian-lab.html`, inlining the engine, the city
renderer and the round-1 baseline. The engine file stays the single source of truth; rebuild
after editing it.

## Driving the original monitor

The original `meridian-world-state.html` and `meridian-control-room.html` are bundled pages
built by a different toolchain, so they cannot be regenerated here — but they can be *fed*.
Each tries `fetch('uploads/world-states.json')` first and falls back after 1.2s to a copy of
that JSON inlined in its own template. The fetch path only works over http; the inline path
always works, including from `file://`, so the injector rewrites the inline copy:

```bash
node lab/inject-monitor.js resilient
```

```bash
node lab/inject-monitor.js doom --shock "5=pandemic,food_import_disruption"
```

It writes patched copies to `dist/` and never touches the originals. Presets: `baseline`,
`boom`, `resilient`, `doom`, `shock`. It also drops `dist/uploads/world-states.json` for
setups that do serve the pages over http.

The twelve rounds land as twelve tabs labelled `R1 · 2050` … `R12 · 2072`, each carrying the
score of the run *so far* rather than a final-round-only figure.

## Layer 2 — harnesses

The engine answers *given these levers, what happens?* A harness answers *given what
happened, what levers?* It is a function:

```js
harness(ctx) -> { levers, rationale, invokes }
```

Everything inside may be semantic — prompts, agent roles, a cabinet that argues. What
leaves is a lever vector the frozen engine consumes. Semantic inside, deterministic at
the boundary.

```bash
node engine/run-tournament.js --cross
```

```bash
node engine/test_harness.js
```

**The audit guarantee.** An LLM harness cannot be re-run identically; it does not need to
be. A run emits a *trace* — twelve rows of nine numbers — and `verifyTrace` replays it
through the frozen engine to a bit-identical trajectory. Scoring operates on the trace, so
a run is auditable evidence even though the thing that produced it is not reproducible.
Variance across repeated runs is reported, not hidden: a harness scoring 82 ± 3 governs
better than one scoring 84 ± 19.

**Fault handling.** Out-of-range levers are clamped; illegal values are rejected and the
previous levers held; a harness that throws does not stop the run. Every fault is logged
against its round. A government that stops governing keeps the last budget.

## Layer 2b — the shared world

```bash
node engine/run-market.js --asymmetric --ledger
```

Several societies on one clock, trading between ticks. Five resources, each drawn from a
distinct part of the world state; spot, forward and aid contracts; a published reputation
that gates the forward market below 40; a 25% export cap plus a 3%-of-workforce ceiling on
labour; and a public ledger.

Trade reaches the engine through the optional fourth argument to `step` — `exogenous`,
carrying `{reserves_bn, capacity, headcount, cohesion_bonus, legitimacy_bonus}`. It defaults
to nothing, so a society that trades with nobody behaves exactly as it did before trade
existed, and the parity suite is untouched.

**The audit guarantee survives trade.** The exogenous deltas the market handed a society are
recorded in its trace, so `replayMarketTrace` reproduces a traded run bit-identically.

**Two kinds of failure.** A spot that cannot be backed on the day is a deal that did not
clear (−5 reputation). A forward you cannot honour is a default (−25, escrow returned, and
the buyer takes a cohesion hit). Only promises about the future can be broken.

## The no-code path

`harnesses/policy.js` runs a government written as data rather than code:

```json
{ "opening": { "corporate_tax_rate": 0.28 },
  "rules": [ { "when": "worstEssential < 60",
               "then": [ { "shift": "ubi->infrastructure", "points": 5 } ] } ],
  "trade": { "style": "reciprocal", "never_sell": ["food"] } }
```

Three verbs (`set`, `nudge`, `shift`) and the same expression language the
constitution's rules use. `validatePolicy` catches a bad path or an empty rule at
the desk rather than in round 7, and the interpreter refuses to write to any lever
outside its bounds table, so a malformed policy cannot reach into the engine.

The Steward reference harness expressed as a policy scores 81 / 74 / 65 / 64
across the four tournament schedules, against 81 / 74 / 67 / 64 hand-coded.

**Doctrine.** A constitution carries prose `commitments` (for judges) and checkable `rules`
(for the auditor), evaluated by a small restricted parser — paths, numbers, comparisons,
`&&`, `||`, no `eval`. A rule naming a field that does not exist is reported as *malformed*
rather than counted as a breach.

## The society is alive without you

Hold every lever still for twelve rounds and the world still moves: population falls
5.94M → 5.52M, the over-65 share climbs 28% → 35%, purchasing power halves, services decay
71 → 52, prices rise 30%. Demography is exogenous, capital depreciates, prices drift,
quality slides toward whatever the capacity supports.

Two helpers make that visible rather than merely true.

`E.vitals(prev, next)` reads the births and deaths already implied by the age bands —
roughly 28,000 births and 42,000 deaths a year at the start, 112,000 people turning 65 each
round. Nothing is invented: mortality on the over-65 band is calibrated so that births fall
out as the residual and land on Singapore's real birth rate. None of it is scored.

`E.interpolate(a, b, t)` reads the path between two checkpoints. The engine settles the
world every two years, but a round's state is *where the society had got to by then*, not a
photograph of one instant — so showing 2051.4 between the 2050 and 2052 checkpoints is
legitimate. Continuous quantities move; anything a government chose rather than the world
produced holds until the round turns. This is display-side only, JS, and not mirrored in
Python: it never feeds `step`, so parity is unaffected.

## The round clock

The server holds it, so every screen in the room counts down to the same tick.

- Default **two hours a round** — one simulated year an hour, twenty-four hours for the run.
- Facilitator controls live in the centre rail under **This round**: set the length, start,
  pause, restart the round.
- **Pausing keeps what is left**, so resuming gifts nobody extra time.
- It advances at most **one round per tick**, so a laptop that slept does not fast-forward the
  whole Thinkathon.
- **Dry run — 30s rounds** plays the whole twenty-four years in six minutes, which is worth
  more than describing it to a room.

Without the clock the world only moves when somebody clicks, and teams choose when time
passes. With it, they do not.

## One screen

```bash
node lab/serve-console.js
```

Serves **Meridian Studio**: three rails, each scrolling on its own, and a page that never
scrolls. Everything is one click away.

| rail | tabs | |
|---|---|---|
| left | Levers · Harness · Constitution | how you govern |
| centre | City · Trajectory · This round | what you govern |
| right | Market · Messages · Export | who you govern with |

The header carries what is always worth knowing — the year, the round, the payment and what
it buys, employment, the worst service, reserves, cohesion, consumption, and the score —
so it moves the moment anything else does. Move a lever and the header and every chart
redraw; advance the round and the whole room moves with you.

The older single-purpose pages still build (`build.js` for the lab, `build-console.js` for
the console) but Studio is the one to hand a team.

## The console runs the engine too

The console used to be a noticeboard: a team agreed a deal and nothing moved, because there
were no numbers on screen to move. `build-console.js` now inlines the engine, the market and
the baseline into the page, so **every team watches its own society while it negotiates**.

Three things follow from that:

- **A live society panel** — payment, what it buys, employment, worst service, reserves,
  cohesion, the ten sectors, and the births and deaths going on regardless.
- **A deal preview on every offer.** Before accepting: *reserves $42bn → $36bn, food & agri
  98% → 107%.* The preview runs the same settlement the market performs, so what it promises
  is what happens.
- **A round clock the room shares.** The server holds it, not the browser; advancing it moves
  every society forward together.

One subtlety worth keeping. At round 1 a trade moves goods and money on the state directly
rather than through `step`, because no round has been played yet and there is nothing to fold
it into. Stepping there would show a year passing and credit it to the handshake — the first
version did exactly that and reported a buyer's reserves going *up*. From round 2 on, the
trade goes into the step that produces the current round, and the before/after comparison
takes the same number of steps on both sides.

## The economics in one paragraph

Nothing in the engine has an opinion about whether automation is good. It does bookkeeping,
and the bookkeeping forms a ring: automation removes headcount, headcount is a wage bill,
wages are household income, household income becomes consumption, consumption is the demand
sectors sell into, sales are the profit you tax, and tax funds the UBI that replaced the
wages. Margins, profit, GDP, quality and cohesion are all derived from that ring. **The
demand cliff is not written down anywhere as a rule** — it is what happens when you go round
the ring twelve times. The one line that produces it is marked `THE CLIFF` in §7.5:
`output = min(capacityAbs, demand)`. Output is sold, not merely made.

## What each lever actually touches

| Lever | Channel |
|---|---|
| AI adoption (per sector) | headcount → wage bill; productivity → capacity; compute demand → the bill |
| Corporate tax rate | revenue now, **and** retained profit → capital stock → capacity later |
| Compute levy | revenue; slows adoption speed; drags reinvestment |
| Allocation split | UBI pot vs infrastructure (which maintains capital **and** quality) vs reserves |
| UBI design | how many shares the pot divides into, and admin efficiency |
| Reskilling spend | shifts people high→low AI exposure, on a 3-round lag |
| Public ownership | dividend independent of the profit tax base; maintains capital out of the infra vote |
| Working week | spreads headcount (`^0.55`), cuts output (`^0.30`) |
| Care job guarantee | hires the unemployed into care; raises care capacity and quality; runs at a loss |

## Calibration status

The engine self-calibrates so **round 1 reproduces the published baseline exactly** — each
sector's non-wage cost share is solved from its round-1 margin, so the margins in
`world-states.json` are inputs to the calibration rather than magic numbers.

Beyond round 1 the target is **ordinal, not numeric**. The five demo states in
`world-states.json` were hand-authored to tell a story; they are not one trajectory and were
never engine output, so exact agreement with them is neither achievable nor desirable. What
the engine must reproduce is their *ordering and their shape*:

| Lever set held for 12 rounds | Engine | Demo file | Shape |
|---|---|---|---|
| Resilient | 82 | 89 | care 89, no gates, reserves climb |
| Boom | 73 | 64 | real UBI peaks r4 at 283, decays to 200; services rot |
| Baseline | 62 | 58 | slow decay as the population ages |
| Doom loop | 15 | 19 | 6 gates; unrest r9; GDP breaks r11; legitimacy 26 |

Two notes. The demo's *shock* state is a round-5 snapshot, not a 12-round run, so it is not
comparable. And `constitutional_fidelity` returns a full 15/15 when no constitution is passed
— every score above is inflated by that constant, which is why they sit high.

## Known simplifications

- **No inter-society trade.** Spec §7 (contracts, escrow, reputation, the 25% cap) is not
  modelled. Reputation is carried through untouched.
- **One capital stock**, not per-sector. Infrastructure and retained profit maintain it
  jointly.
- **Reskilling** moves people between exposure bands but does not yet change which sectors
  will hire them. Its only economic effect is to make automation more reversible; the
  exposure bands themselves are not scored.
- **Trade is bilateral and posted**, not a continuous order book: a society offers to a named
  counterparty and that counterparty accepts or does not. There is no price discovery.
- **Personas** respond deterministically (§7b) from purchasing power, the services their age
  band leans on, and the labour market — but the corpus is the four sample households in
  `world-states.json`, not the full forty.
- **Round 12 is labelled 2072**, following the original control room's `2048 + round * 2`.
  The spec and the demo file say 2074. Both are defensible — 2072 is when round 12 *starts*,
  2074 is when it ends — but they should be made to agree. One line, §7.14.
