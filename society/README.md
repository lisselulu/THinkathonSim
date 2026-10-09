# The society side

Twelve generative agents who live in Meridian, decide what to do about
it, and change the country by doing it.

## Run it

```
pip install -r society/requirements.txt        # once
python society/server.py                       # the sidecar, port 8765
node engine/run-society.js --concordia         # the run
```

Without the first two, the third still works and says
`DECIDED BY: deterministic`. That is the point: nothing here can stop a
demo, it can only make one better.

```
node engine/run-society.js                     # arithmetic baseline
node engine/run-society.js --compare           # with and without society acting
node engine/run-society.js --concordia --rounds 12 --shock 5:pandemic
```

## What was actually wrong before

**Agents could not choose.** The twelve behaviours existed, and a
deterministic if-ladder in `lab/feed.js` picked one. The model was told
what a cohort had *already decided* and wrote its words. The action
space was a vocabulary, not a decision.

**The run was decided before anyone reacted.** The feed read a
trajectory computed to its final round. By the time citizens
"responded", 2074 already existed.

**Doing did not matter, only feeling did.** Society reached the engine
through exactly one channel — `civic_unrest`, from weighted mean
sentiment. A population that struck and one that quietly seethed
produced an identical country.

## What it is now

```
cabinet -> levers -> engine -> state
                                |
                         lived experience     (blind: engine/lived.js)
                                |
                          agents decide       (Concordia, or arithmetic)
                                |
                          consequences        (engine/action_space.js)
                                |
                 exogenous input to the NEXT round
```

Round N+1 is a function of what people chose in round N. Mutual aid
adds capacity to care, health and food. A strike removes it from the
sectors the strikers work in. The mobile emigrate and take their
headcount with them, and — because those who could go went first —
each wave leaves fewer who can follow.

The engine stays a pure function of `(state, levers, shocks, exogenous)`,
the exogenous object is written into the trace, and `replaySociety`
still reproduces any run bit for bit with no model and no network.

## The feed page

```
python society/server.py            # the sidecar
node lab/serve-console.js           # the feed, on :7823
```

Open `/feed`, press **⚯ agents**. The page swaps from the arithmetic
baseline to a real closed-loop run decided by the twelve Concordia
agents — posts, trending and mood, not just the words. The header always
says which one you are reading, and if the sidecar is not there the
toggle goes back off and tells you why rather than serving arithmetic
under an agents label.

**⚯ agents** and **✎ voice** are different things and deliberately
separate. Agents change WHAT people did; voice only changes how it is
worded.

The page POSTs the studio's live levers, so the agents react to the
team's own country rather than a demo scenario. One request loads all
twelve rounds, so scrubbing between years is free; the run is cached per
(scenario, week, levers, shocks, decider, seed).

The standalone `dist/meridian-feed.html` has no server, so it stays on
the arithmetic baseline. That is the point of the baseline.

### What the agents actually do

On the doom scenario, same government, same shocks — the arithmetic
baseline against qwen2.5-7b agents at 2072, unrest 100 in both:

| | 2072 |
|---|---|
| arithmetic | organising 63%, striking 19% |
| concordia (7b) | trusting the plan 42%, holding back 22% |

**The small local model is markedly more docile than the calibrated
baseline.** At maximum unrest it still has nearly half the country
trusting the plan. Treat that as a finding about the model, not a
property of the society — and it is exactly why the deterministic
control exists to be run alongside.

## Long runs, scarcity, and contribution credit

```
node engine/run-society.js --open                    run until it stops
node engine/run-society.js --open --credit 0.28      with contribution credit
node engine/run-society.js --open --base resilient_2074
```

**Open-ended runs.** The twelve-round cap is gone. `--open` runs until the
society collapses, stops changing, or hits a backstop, and reports by
decade plus survival time. The score is still computed but is comparable
only between runs of equal length — its minima can only worsen with
length, so a longer run was silently punished. `engine/longrun.js`.

> Running this immediately showed that the **`resilient_2074` preset is
> not resilient**: it survives 86 years while decaying monotonically from
> 143 purchasing power to 25. At twelve rounds it reads 143 → 124 and
> looks fine.

**Scarcity pricing.** Automation drives compute and energy demand; that
demand now forms a price, and the price reaches households and the cost
of running automated capacity through channels that already existed.

| policy | tightness | price | purchasing power |
|---|---|---|---|
| hold at baseline | 1.04 | 1.23 | 45 |
| automate everything **but** energy | 2.82 | 6.0 | **1** |
| automate **only** energy | 0.66 | 0.68 | **66** |

**Contribution credit.** `--credit <rate>`, off by default. Prosocial acts
earn credit; credit buys non-essentials. The response **peaks at 28% and
turns harmful above 71%**, because paying for gifts converts them into
transactions (Titmuss; Deci/Koestner/Ryan; Gneezy & Rustichini). A team
that maximises the lever does worse than one that finds the peak.

`obey` and `endure` earn nothing — this rewards contribution, not
conformity. Gating essentials is available, off by default, and visibly
harms the cohorts who cannot earn.

Every coefficient in all three is documented in
[docs/EVIDENCE.md](../docs/EVIDENCE.md), including which are placeholders.

## The blindness constraint

A citizen never sees a lever, an indicator, or a score. Observations are
built field by field from nothing in `engine/lived.js`, checked by
`assertBlind()` before they leave the JS process, and checked again in
`meridian_agents.py` before they reach an agent. `engine/test_society.js`
asserts it over a full run, every cohort, every round.

Belt and braces, because it is the constraint the whole instrument rests
on: if citizens could read the dashboard they would narrate it back, and
a team would learn nothing from them they could not read faster from a
chart.

## Files

| file | what it is |
|---|---|
| `engine/action_space.js` | the twelve behaviours, and what each costs the country |
| `engine/decide.js` | the decider interface: `deterministic` and `remote` |
| `engine/society_round.js` | one round: observe, decide, check, price |
| `engine/run-society.js` | the runnable demo, with `--compare` |
| `engine/test_society.js` | 266 assertions |
| `society/meridian_agents.py` | the Concordia agents |
| `society/server.py` | the HTTP sidecar |

## Four traps, already sprung

1. **Do not name a directory `concordia/`.** It shadows the installed
   package and every import resolves to the empty folder.
2. **`LastNObservations` only reads memory.** Without
   `ObservationToMemory`, agents decide with a persona and no idea what
   has happened to them. The symptom is uniform, plausible answers —
   every cohort chose `endure` in every condition, including famine.
3. **`AssociativeMemoryBank` needs an embedder.** `ListMemory` takes a
   plain list, which is the right retrieval here anyway: recency, not
   similarity.
4. **Small models will not reliably echo an option back.** The sidecar
   asks for an index and refuses anything else rather than guessing —
   a wrong guess puts a behaviour into the economy that no agent chose.
5. **Run the cohorts concurrently.** They do not interact within a
   round, so there is no ordering to preserve. Sequentially, a 12-round
   run took 13m15s; with a six-wide pool, 1m42s. Set
   `MERIDIAN_AGENT_CONCURRENCY` to change it.
6. **A round is twelve calls, not one.** The client timeout was 90s,
   which aborted two rounds mid-run — and since the fallback is silent
   by design, the run still finished and still scored. It is 240s now,
   and `decidedBy` reports what actually decided each round rather than
   what was asked to, so a fallen-back run cannot claim to be
   agent-decided.
