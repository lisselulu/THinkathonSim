# How the simulation got here

A record of the earlier stages, kept because the reasoning still matters. **This is history, not a description of the current simulation.** It was written when the engine ran in two-year rounds, citizens were twelve fixed cohorts, and a single score ranked teams. Today the simulation runs monthly, residents are a weighted sample drawn from official statistics, and the report gives evidence with no verdict. See the [README](../README.md) and [FEATURES.md](FEATURES.md) for how it works now.

The older engine-only tools described here still run and their tests still pass.

## Three populations, one frozen engine

**The engine** — `step(state, levers, shocks, exogenous) → next state`. Deterministic, published for students to read, and reimplemented in Python beside it. A parity test asserts the two agree across **48,456 fields**, including the engine's internal carry-forward state.

**The citizens** — twelve stratified cohorts, from a retired cleaner in the twelfth income percentile to an owner of automated capital. They do not merely *feel*; they **decide**, from a twelve-behaviour action space, and what they decide changes the country.

**The industries** — thirteen sector agents, each optimising what its industry is *for*. The government's automation lever is a **ceiling**, not a target: a state can forbid, tax and subsidise, but it cannot compel a firm to invest.

**The harness** — what teams build. A government that reads the world and sets the levers. Everything inside may be language: prompts, agent roles, a cabinet that argues. *Semantic inside, deterministic at the boundary.*


## What changed, and why

Everything below was built in six stages. [EVIDENCE.md](EVIDENCE.md) carries the sources, the numbers and — importantly — which coefficients are placeholders.

### The written constitution is now worth its marks

It wasn't. `score()` read only `constitution.levers`, a numeric block that markdown constitutions never carry, so **every prose-authored team collected all fifteen fidelity marks unconditionally.** Meanwhile the auditor had been computing the real figure all along and was wired to nothing.

Fixed in both scoring paths. And **markdown constitutions can now carry machine-checkable rules**, in a fenced block beneath the clause they test:

```markdown
1. C1. No essential service falls below 50 for two consecutive rounds.

   ```rule
   when: round > 2
   assert: worstEssential >= 50
   ```
```

Identical economy, identical levers, only the written promise differing: **61 with 15/15, versus 57 with 10.8/15.**

### Society decides, and the loop is closed

Citizens used to reach the engine through exactly one channel — `civic_unrest`, derived from weighted mean *sentiment*. A population that struck and one that quietly seethed produced an identical country.

Now they choose from twelve behaviours (Hirschman's exit / voice / loyalty, plus the two he doesn't cover — `flourish` and `mutual_aid`, which are what this project is about). A strike removes capacity from the sectors strikers work in. Mutual aid *adds* capacity to care, health and food. The mobile emigrate and take their headcount with them — and because those who could go went first, each wave leaves fewer who can follow.

Round N+1 is now a function of what people chose in round N.

### Thirteen industries, Singapore-shaped

Ten became thirteen. **Manufacturing** was missing entirely — roughly a fifth of output and the largest single employer. **Energy and Compute are now separate**, because a power grid and a data network behave nothing alike and the AI-versus-energy question is invisible while they're one row. **Public Administration** was added so the state's own capacity can degrade.

No extraction or mining: Singapore has none. Raw-material dependence is modelled as import exposure, which is the more interesting vulnerability.

Total output stays 782bn and headcount 2,125,000 — both authored anchors, both load-bearing.

### Each industry is judged against its own mission

One formula scored all sectors on the same four dimensions in the same proportions. Now each has a mission and a scorecard:

| sector | leads on | |
|---|---|---|
| Care Services | humanity 0.40 | the human *is* the service |
| Energy & Utilities | reliability 0.34 | a profitable intermittent grid has failed |
| Finance | reliability 0.34, access 0.30 | scored on whether capital *reaches* the economy, **not on margin** |

The scorecards are **authored in the repo**, not chosen by the agents. An industry that sets its own targets can declare success on throughput while the country starves.

### Growth compounds instead of being a multiplier

`prodGain` was affine, immediate and one-off. Three mechanisms replaced it:

- **Bass diffusion** — adoption is an S-curve. Calibrated so the *peak* rate matches the old constant step: it changes the shape, not the ceiling.
- **The productivity J-curve** — automation costs output before it pays, then pays more than the naive gain once absorbed. *(Brynjolfsson, Rock & Syverson 2021.)*
- **The learning curve** — unit compute cost falls with cumulative consumption. This is what makes AI compound rather than merely be large. *(Wright's law.)*

Plus **per-sector capital**: a sector's own margin funds its own stock, so a profitable sector outgrows a failing one. Previously a 40%-margin sector and a −10% one got the identical multiplier.

### Scarcity forms a price

Automation drives compute and energy demand; that demand now forms a price, and the price reaches both households and the cost of running automated capacity.

| policy | grid tightness | price | purchasing power |
|---|---|---|---|
| hold at baseline | 1.04 | 1.23 | 45 |
| automate everything **but** energy | 2.82 | 6.0 | **1** |
| automate **only** energy | 0.66 | 0.68 | **66** |

Three ways out, with different time constants: build (slow), import (fast, creates dependency), throttle.

### Runs are open-ended

The twelve-round cap is gone. `--open` runs until the society collapses, stalls, or hits a backstop, and reports **by decade** plus survival time.

The score's minima can only worsen with length, so a longer run was silently punished — a team governing identically well for sixty years scored *below* one that stopped at twenty-four. Per-decade reporting is length-fair.

> Running this immediately showed that the **`resilient_2074` preset is not resilient**: it survives decades while decaying monotonically. At twelve rounds it looks fine.

### Contribution credit, with crowding-out

Prosocial acts can earn credit that buys non-essentials. The response **peaks at 28% generosity and turns harmful above 71%**, because paying for gifts converts them into transactions *(Titmuss; Deci/Koestner/Ryan; Gneezy & Rustichini)*.

A team that maximises the lever does worse than one that finds the peak. `obey` and `endure` earn nothing — this rewards contribution, not conformity.


## The headline result

Same government, permitting 90% automation everywhere and taxing it hard:

| | mean automation | employment | score |
|---|---|---|---|
| firms obey the lever | 0.88 | 6% | **0** |
| **firms may decline** | **0.68** | **33%** | **63** |

**Taxing automation works — but only if firms can decline to automate.** When the lever was a target, the tax slowed the inevitable and the economy collapsed anyway.

## The reference field

```
reference    fair  pandemic  supply  | keeps its own constitution
accelerate      3         3       3  |  yes
guardian       72        65      57  |  yes
steward        74        61      56  |  yes
```

**Accelerate posts the highest headline UBI in the field and finishes seventy points last**, breaching gates even when nothing goes wrong. Steward wins partly because it watches the grid and acts when it tightens — final-round tightness: accelerate 1.81, guardian 1.24, steward 0.97.


## The original loop and feed

```bash
bash demo.sh
```
Starts the agents sidecar and the feed server, warms the caches, and tells you honestly what is and isn't working. `bash demo.sh check` for status, `bash demo.sh kill` to free the ports.

```bash
node lab/serve-console.js
```
Meridian Studio on the room's wifi. No accounts, no internet.

## The simulation, from the command line

```bash
node engine/run-society.js --rounds 12 --compare      # is the loop actually closed?
node engine/run-society.js --open --levers resilient_2074
node engine/run-society.js --firms --concordia        # industries decide for themselves
node engine/run-society.js --credit-sweep --levers resilient_2074
```

`--compare` runs the same government twice, once with society's decisions reaching the engine and once with them stripped out, and reports where the two diverge.

## Generative agents

```bash
pip install -r society/requirements.txt
python society/server.py
```

Concordia agents for both populations, behind one HTTP sidecar. Without it everything still runs on the arithmetic baseline and **says so** — `decidedBy` reports what actually decided each round, not what was asked to, so a run that fell back cannot claim to be agent-decided.

Citizens are **blind** to government: they see the queue at the clinic, never the tax rate. Firms have their own, different blindfold — they read the tax they pay and the prices they face, but not the treasury, the score, or the citizen feed. Both are enforced by `assertBlind`, and tested over full runs.
