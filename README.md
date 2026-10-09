# The Meridian Simulation

**Singapore, 2050. Agentic AI can do most work. Your team governs 5.9 million people and finds out what that costs.**

Trusted Hub · Temasek Polytechnic · ITE · *a fortnight, four to five students a team*

The thesis is one sentence: **the society with the highest UBI does not win.** Everything here exists to make students discover why rather than be told.

---

## The idea

Automation removes wages → wages are household income → income is consumption → consumption is the demand you sell into → sales are the profit you tax → tax funds the UBI that replaced the wages.

Go round that ring and the boom eats itself. Nothing in the engine punishes automation; the collapse is bookkeeping. It rests on one line:

```js
const output = Math.min(capacityAbs, demand);   // THE CLIFF
```

Output is **sold**, not merely made.

## Three populations, one frozen engine

**The engine** — `step(state, levers, shocks, exogenous) → next state`. Deterministic, published for students to read, and reimplemented in Python beside it. A parity test asserts the two agree across **48,456 fields**, including the engine's internal carry-forward state.

**The citizens** — twelve stratified cohorts, from a retired cleaner in the twelfth income percentile to an owner of automated capital. They do not merely *feel*; they **decide**, from a twelve-behaviour action space, and what they decide changes the country.

**The industries** — thirteen sector agents, each optimising what its industry is *for*. The government's automation lever is a **ceiling**, not a target: a state can forbid, tax and subsidise, but it cannot compel a firm to invest.

**The harness** — what teams build. A government that reads the world and sets the levers. Everything inside may be language: prompts, agent roles, a cabinet that argues. *Semantic inside, deterministic at the boundary.*

---

## Agents decide; the kernel computes

**This is the newest and largest change.** Every choice a person or organisation makes is now made by an LLM agent. The engine is reduced to a kernel of physics and accounting.

| Stays deterministic | Decided by agents |
|---|---|
| market clearing, prices and inflation, the budget, capital wearing out, grid capacity, ageing | how much households spend and save, whether people work, strikes, protests, mutual aid, organisations, emigration, births, firm prices, wages, hiring and investment, government policy, trust and belonging |

A round follows the **reason → route → action** pipeline from AgentSociety:

1. **Reason.** A weighted population of residents (40 to 1,000+) each perceive their own life and decide, in their own words.
2. **Route.** A deterministic router works out what those words mean, checks they are possible, and adds them up by who actually took part.
3. **Action.** The kernel clears markets and posts the accounts.

Several firms per industry (incumbent, co-operative, state-owned, start-up, multinational) set their own prices and wages and compete for market share.

**Teams write the constitution; the simulation compiles it.** Prose commitments become policies in a six-verb grammar (tax, transfer, regulate, provide, institution, announce). Anything that cannot be compiled is reported back with the reason. Policies a team writes itself always win, and the governing agent may amend policy as the country changes.

**There is no verdict.** Teams weight the guiding rubric (social welfare, continuity of survival, quality of life, economic profitability) and argue their case. The simulation produces evidence: the trajectory, the fixed industry KPIs, what people reported and did, the market, the government's record, events, and voices. The old score survives only as one reference figure.

**Organisers control the world** from `/admin`: fire events live (typhoon, energy crisis, civil conflict, trade embargo, and more), invent their own, have the model draft one for approval, target one team or all, and turn on seeded unannounced weather.

**Fair once runs vary.** Every team gets identical seeds and events, final results are reported across five seeds, and every run keeps a decision log that replays it exactly with no model.

**Trust.** Before an assessed run, a model must pass a five-check behavioural calibration. The studio's sliders are now a clearly labelled trial space; the results that count come from agent runs.

Details: [`agents/README.md`](agents/README.md) · serving on the DGX: [`deploy/dgx/README.md`](deploy/dgx/README.md)

---

## What changed, and why

Everything below was built in six stages. `docs/EVIDENCE.md` carries the sources, the numbers and — importantly — which coefficients are placeholders.

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

---

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

---

## Running it

### The agent society

```bash
node lab/serve-console.js
```
Three pages, one per job:

| Page | What it is for |
|---|---|
| `/setup` | Every setting in one place, in six sections: economy, AI adoption, government, constitution, your case, trade. Each section has **Save** and **Discard**; "Your saved system" beside them shows exactly what is committed, text included. Nothing counts until it is saved. |
| `/sim` | The simulation on its own: the city as an architectural model, a timeline, and what happened each year. **Trial** shows the physics of your saved settings; **Agent run** runs the society and shows its people, coloured by what they did. |
| `/feed` | What people are saying, year by year. **Agent run** shows the posts residents and firms wrote as they decided, with government statements and people leaving; filter by who is speaking. **Trial** previews your saved settings with templated posts. |
| `/market` | Offers, messages and the hand-in bundle, built from your saved system. |
| `/reports` | Every run, for your team or all teams, with **Open report**, **PDF**, **Report data** and **Full record**. |

### Who governs a run

The **government** section on Setup decides the levers every year after the first, in both the trial and agent runs.

- **Rules** (`when <condition>, then shift / nudge / set`) run the same way everywhere: in the browser trial, and in agent runs on the server. Conditions read the country as it stood at the end of last year. Setup checks each rule as you type and says whether it can run.
- **A model briefing** (who is governing, doctrine, what wins in a conflict, how you trade) is read by **one model decision-maker** each round. Before deciding, it reads what the agent society did last round: reported trust and belonging, what people did, who left, and the most-heard voices. Its calls go through the run's model pool, so they respect the one-prompt-at-a-time limit and are written to the decision log, so the run replays exactly. A briefing needs the model, so in the trial your saved levers simply hold.

The evidence page shows who governed each year, why, which rules fired or clauses were cited, and what changed. Years where nobody governed are flagged. It also runs a **constitutional audit**: whether the constitution's checkable rules held, drift from the opening settlement, big departures nobody explained, and clauses never cited. This is evidence, not a verdict.

Every finished run is saved in `runs/<id>/`: `evidence.json` (the report), `trace.json`, `decisions.jsonl`, `view.json` and `run.json`. The evidence page has download buttons: **Download report (PDF)** (print layout, choose "Save as PDF"), **Report data (.json)** (the evidence), and **Full record (.json)** (settings, evidence, trace and every model decision, for replay). The same files come from `/api/runs/<id>/download/report` and `/download/record`.

Organisers: `/admin` (events, weather, the round clock), with the token printed at startup or `MERIDIAN_ADMIN_TOKEN`. The old single-screen studio is still at `/classic`, and the old projector feed at `/classic/feed`.

```bash
node agents/run-agents.js --constitution constitutions/tampines-compact.md
node agents/run-agents.js --profile dgx --seeds 5 --team alpha --constitution my.md --weather
node agents/run-agents.js --calibrate
node agents/run-agents.js --replay runs/alpha-101/decisions.jsonl --seed 101 --team alpha
```

A model server is required (LM Studio locally; vLLM or SGLang on the DGX). Without one, a run refuses to start rather than pretend. `--no-model` runs the physics only, labelled degraded.

### The original loop and feed

```bash
bash demo.sh
```
Starts the agents sidecar and the feed server, warms the caches, and tells you honestly what is and isn't working. `bash demo.sh check` for status, `bash demo.sh kill` to free the ports.

```bash
node lab/serve-console.js
```
Meridian Studio on the room's wifi. No accounts, no internet.

### The simulation, from the command line

```bash
node engine/run-society.js --rounds 12 --compare      # is the loop actually closed?
node engine/run-society.js --open --levers resilient_2074
node engine/run-society.js --firms --concordia        # industries decide for themselves
node engine/run-society.js --credit-sweep --levers resilient_2074
```

`--compare` runs the same government twice, once with society's decisions reaching the engine and once with them stripped out, and reports where the two diverge.

### Generative agents

```bash
pip install -r society/requirements.txt
python society/server.py
```

Concordia agents for both populations, behind one HTTP sidecar. Without it everything still runs on the arithmetic baseline and **says so** — `decidedBy` reports what actually decided each round, not what was asked to, so a run that fell back cannot claim to be agent-decided.

Citizens are **blind** to government: they see the queue at the clinic, never the tax rate. Firms have their own, different blindfold — they read the tax they pay and the prices they face, but not the treasury, the score, or the citizen feed. Both are enforced by `assertBlind`, and tested over full runs.

### Tests

```bash
node tests/test_kernel_channels.js  # 33  the agent channels, and neutrality without them
node tests/test_agents.js         # 65  the whole agent society, end to end, fake model
node engine/test_society.js      # 716
node engine/test_harness.js      # 62
node engine/test_market.js       # 85
node tests/test_llm_client.js    # 24
node tests/test_simulation_loop.js  # 49
python engine/test_parity.py     # 64,750 fields, including every agent channel and policy verb
```

None of it needs a model, a key or a network. The semantic components are driven by a fake that returns what small models actually return — prose with no JSON in it, an unclosed fence, an invented clause id, and once, a hard throw.

The parity test is the strongest artefact here: the engine is implemented twice and every field agrees, so the physics were not tuned to make a demo look good.

---

## Reading the code

| | |
|---|---|
| `docs/EVIDENCE.md` | **Start here.** Every claim the simulation makes about behaviour, its source, the number it sets, and whether that number is evidenced, calibrated or invented. |
| `engine/meridian-engine.js` | The engine. Read `THE CLIFF`. |
| `engine/sector_missions.js` | What each of the thirteen industries is *for*. |
| `engine/action_space.js` | The twelve things a citizen may do, and what each costs the country. |
| `engine/firm_action_space.js` | The eight things an industry may do. |
| `society/README.md` | The agent sidecar, and four Concordia traps already sprung. |
| `DEMO.md` | A runbook for showing it to a room. |

---

## Who the residents are

How many people there are is the scenario's: the engine sets the size of each age band and the headcount
of each industry, and the personas' weights reproduce both exactly.

Who those people are is drawn from published statistics. Age, ethnicity, type of home, region, household,
children, health, income position, and why someone is not working all come from eleven official tables:
Department of Statistics (Population Trends 2026, General Household Survey 2025) and Ministry of Manpower
(Labour Force in Singapore 2025). So the residents are present-day Singaporeans placed in the 2050 economy.

- `data/singstat/SOURCES.md` lists every table, what it is used for, and every assumption made in joining them.
- `data/singstat/raw/` holds the tables as downloaded.
- `python data/singstat/build.py --fetch` downloads them again and rewrites `agents/population-data.json`,
  which `agents/population.js` reads. Nothing in that file is typed by hand.
- Every run's evidence carries the list under `population_sources`.

Still modelled, not measured: months of savings, ability to leave the country, and temperament. Sex is not
modelled. See SOURCES.md for the rest.

## Open-ended action

Residents decide what to do in their own words, with no menu. Every action then goes to an
**interpreter** (`agents/interpreter.js`) that answers one question: what does this action,
done by one ordinary person, actually do in the world? The answer uses a fixed vocabulary of
effects the kernel can compute: time given to a sector, work off the books, labour withheld,
more or less paid work, spending, custom moved between sectors, harm, unrest, trust in
government, ties between people, organising, and starting a business. The actions themselves
are not fixed, so behaviour nobody anticipated still reaches the country.

- **Blind.** The interpreter sees only the action's words: no team, levers, constitution or
  score. The same words mean the same thing in every team's world.
- **Once per team.** What a country invents stays in that country. Each team has its own file
  (`agents/interpretations/<team>.json`); no team's run ever reads another team's. New actions
  are batched a dozen to a call and repeats cost nothing. Replays are exact, including with
  `node agents/run-agents.js --interpretations runs/<id>/interpretations.json`.
- **A common start.** Every team begins from the same starter dictionary of ordinary actions
  (`agents/interpretations/_starter.json`, built by `node agents/build-dictionary.js`): work,
  strike, volunteer, protest, sell, join, and their usual phrasings. It matches on the action
  alone and reads the industry from the target, so "volunteer at the hospital" and "volunteer
  at the school" are the same act aimed at different industries. Everyday vocabulary therefore
  means the same in every world; only what a team's own people invent beyond it is private.
- **Bounded.** Each interpretation says what an action costs (hours a week, money, savings,
  whether it needs a job). The router charges that against each person's real free time and
  income, so up to three actions share one budget and nobody creates value from nothing.
- **Reviewable.** Organisers can read and correct any interpretation on `/admin`, under
  "What actions mean". Corrections always win and are marked in the report.

The report's **Behaviours** section lists everything people did, with the ones the old
pattern list would not have predicted marked **novel**: when each first appeared, how far it
spread each year, who did it, and what it did. Two kernel channels were added for this,
`demand` (custom moved between sectors) and `informal_share` (work and spending that escape
tax); both are inert when absent and checked by the JS and Python parity test.

Without a model the old pattern list still stands in, and `actions: 'registry'` forces it
for comparison. The conversion constants in `OPEN` in `agents/router.js` are placeholders,
like the rest.

## Institutionalising what the society invents

A behaviour the report marks novel can be made part of the country. On Setup,
**Institutions** offers the behaviours from your team's last run, and for each one you
choose what the state does about it:

| Adoption | What it does |
|---|---|
| **Fund it** | The state pays: a funded institution in that industry, so the capacity arrives whether or not anyone volunteers. |
| **Licence it** | The work still happens and still serves people, but it stops escaping tax: the informal share falls. |
| **Make it easier** | Premises, equipment or time, so each person is charged less than the action takes and the same hours deliver more. |
| **Endorse it** | A public announcement, which residents read. |

Adopted institutions are **visible**: residents and firms are told they exist, in your own
words, so they change what people decide as well as what the arithmetic produces. What a
team cannot do is change what a behaviour MEANS; the interpreter stays blind and global, so
two teams' runs remain comparable. The report shows what was adopted, what it cost, and what
happened to the behaviour it came from.

## Changing course while a run is going

A government does not get one go at its laws. On the Simulation page a team can **Pause** a run,
change anything on Setup and save, then **Apply changes and resume**. The run carries on from
the month it was in, under the new settings: levers, the government (rules or briefing), the
constitution's policies, institutions and distribution schemes all take effect from the next
tick. Changes can also be applied without pausing.

Nothing that already happened is altered, and every change is recorded with its date. The
report's **Changed while it was running** section lists what was changed and when, so a
recovery can be read for what it is: the country before, the decision, the country after.
Only what actually differs counts as a change. An amended run replays exactly, amendments
included (`runs/<id>/amendments.json`, and `--amendments` on the command line).

## Other ways of sharing out

The payment to everyone is the scheme the simulation starts with, not the only one possible.
On Setup, **Distribution** lets a team add its own: a scheme that pays people for what they
**do**, in a credit that exchanges for money.

| A scheme says | |
|---|---|
| What earns it | giving time to any industry or to one, bringing people together, organising a group |
| What it is worth | credits per hour, what a credit exchanges for, and a monthly cap per person |
| Who pays | **the payment's own pot** (everyone's payment falls a little and goes to those who earned it: it redistributes at no extra cost) or **new money** (an obligation off the top of the budget) |

Residents are told the scheme exists, on the team's own terms, and decide for themselves
whether to take part; those who earned are told what they earned. Who qualifies is worked out
from what people actually did, as the interpreter read it, so a team chooses what to reward
but not what an action counts as. The bill reaches the kernel as `distribution` (checked in the
JS and Python parity test), and the report's **How this country shares out** section shows
who took part, how it spread, and what it cost. Schemes only act in agent runs.

## Time: monthly ticks

The studio runs by the month. A **tick** is one month; a year is twelve; a run is as many
years as the team asks for. The kernel advances every tick, so money, prices, output and
employment move month by month.

**Who thinks when.** The government decides every tick. Residents and firms decide every
three (configurable per run size in `agents/profiles.json`), and what they chose holds until
they choose again. Things that happen once (someone leaving the country) are applied once.

**What refreshes when.** Fast things are recomputed every tick. Slow things are refreshed
less often and cover all the time since: capital and automation adoption every 3 ticks,
population and exposure to automation every 12 (`CADENCE` in the engine).

**How the constants were converted.** Every constant was written for a two-year round. Under
ticks each is converted by what kind of thing it is: a level (output, a tax rate) is
unchanged; a flow (births, reserves) is scaled by the length of the tick; an inertia (quality,
cohesion, capital wearing out) keeps its half-life; a growth rate (inflation) compounds to the
same yearly figure. Published figures are rounded, so the unrounded values travel alongside
and a month of change is never rounded away.

**Checked.** A two-year step is byte-identical to the original round (the untouched Python
engine still agreed with it exactly). Twenty-four monthly ticks land within 3% of one round.
JS and Python agree under ticks across 289,804 fields.

**Pace.** "Live" holds each tick to the clock: 2.5 minutes a tick, so a year takes half an
hour. If the model cannot keep up the clock runs behind; nothing is skipped to catch up, and
the report says how far behind it finished. "As fast as it can" is for testing.

**Events** last their own number of months (a typhoon two, a pandemic eighteen).
**Rules** are checked every month, so a nudge that keeps firing moves a lever twelve times a
year. The report reads the country once a year, whatever the tick.

The older two-year mode still exists (the command line without `--years`, and the Market
page's preview) and is what the original 716-test suite guards.

```bash
node agents/run-agents.js --years 24 --constitution my.md          # by the month
node agents/run-agents.js --years 24 --every-residents 1 --live    # monthly decisions, live pace
```

## How long a run is

As long as the team wants. Choose the years on the Simulation page (4 to 240; the trial
preview has its own length), and **Stop and keep** ends a run early and still writes the
evidence for the months that ran. Nothing stops at 2072: the demography anchors damp out
past the table.

## Never a rule in place of a decision

A real run **insists**. A reply that does not validate is asked for again with a fresh seed; a
model server that has gone away is waited for however long it takes. No resident, firm,
government or interpreter decision is ever handed to a rule, because a fallback is a different
society, not a slower one. The run just takes longer, and the report says by how much: replies
asked again, seconds waited, outages, seconds paused.

- **Pause and resume** a run from the Simulation page, or **hold the whole room** from
  `/admin`. Runs stop between decisions and carry on from the same point.
- **Stop and keep** during a wait ends the run and takes the unfinished year back out, so the
  evidence only ever covers years that finished.
- The pattern-based fallback still exists for runs with no model at all, and the command line
  accepts `--allow-fallback` for experiments. Neither is used by the studio.

## What a run keeps

By default a run follows a **panel** of 20 residents and keeps every decision they make in
their own words, plus every firm, government and interpreter decision. The other residents
contribute numbers. That is about a hundredth of the disk of a full transcript, and the
report's "The people we followed" section is built from it.

Tick **keep every decision** on the Simulation page for an exactly replayable run; the full log
is gzipped when the run ends and replays from the compressed file. The report states which
kind each run is.

## What a run costs

Every resident and firm is asked the same thing in the same words, so those
instructions are sent once as the **system message** and the per-agent prompt
carries only that agent's own circumstances. A model server that caches prompt
prefixes (LM Studio, vLLM, SGLang) then reads them once instead of once per call.
A resident prompt went from about 740 tokens to about 314 variable tokens on top
of a 517-token cached prefix. Token budgets match what a complete decision
actually needs: 420 for a resident, 320 for a firm.

Each run reports its own bill in : prompt tokens,
completion tokens, the prompt tokens the server did not have to re-read, and the
mean per call. Compare that figure across runs rather than trusting an estimate.

None of this changes how many agents decide. Population, firms and sub-steps are
unchanged, and every agent is still asked every round.

## Known gaps

- **Small local models are docile and uniform.** In a live run the 7B wrote valid decisions every time, but residents mostly chose the same things (help neighbours, volunteer). Run the calibration suite and use a larger model on the DGX before drawing conclusions.
- **LM Studio does not survive agent load.** It stopped answering three times in testing. The pool now waits for it to come back, but a batching server is the real answer.
- **Sub-steps are social, not economic.** The economy still clears once per two-year round.
- **The agent conversion constants are placeholders** (what a strike, mutual aid or a policy yields in kernel units).

- **`equity` is a proxy.** The engine has no per-cohort access figure, so rationing is charged more heavily when more of the population is income-exposed. A real measure reads the worst-served cohort directly.
- **One agent per sector, not per firm.** Competition *within* an industry — entry, exit, market share — is a much larger model and is out of scope.
- **Small models are docile.** On a 7B, citizens at maximum unrest still largely "trust the plan", and Care Services chose to automate despite a humanity-first mission. Treat that as a property of the model, not of the society, and try a larger one before concluding anything.
- **Citations are unverified.** The works in `EVIDENCE.md` are real and the findings reported as accurately as we can state them, but authors, years and journals were written from memory and have not been checked.
- **Many coefficients are placeholders** and are labelled as such: the trait table, the action consequences, the scarcity constants, the crowding-out curve, every firm threshold.
- **Reskilling barely does anything** economically. The brief promises a payoff it doesn't yet deliver.
- **The studio still recomputes from 2050** whenever a lever moves, rather than continuing from where you were. Nobody steers mid-run.

---

Full brief: [`thinkathon-simulation-spec.md`](thinkathon-simulation-spec.md) · Engine notes: [`engine/README.md`](engine/README.md)

*The society with the highest UBI will not be the society that wins. Work out why before you write your constitution.*
