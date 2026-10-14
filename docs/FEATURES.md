# How the simulation works, feature by feature

The detail behind the README. Each section describes the simulation as it runs today.
For sources and how well each number is evidenced, see [EVIDENCE.md](EVIDENCE.md).

## Who governs a run

The **government** section on Setup decides the levers every month after the first, in both the trial and agent runs.

- **Rules** (`when <condition>, then shift / nudge / set`) run the same way everywhere: in the browser trial, and in agent runs on the server. Conditions read the country as it stood at the end of the month before. Setup offers every term and action a rule can use from menus, lists them all under "Every term a rule can use", and checks each rule as you type.
- **A model briefing** (who is governing, doctrine, what wins in a conflict, how you trade) is read by **one model decision-maker** each month. Before deciding, it reads what the agent society did last: reported trust and belonging, what people did, who left, and the most-heard voices. Its calls go through the run's model pool, so they respect the one-prompt-at-a-time limit and are written to the decision log, so the run replays exactly. A briefing needs the model, so in the trial your saved levers simply hold.

The evidence page shows who governed each year, why, which rules fired or clauses were cited, and what changed. Years where nobody governed are flagged. It also runs a **constitutional audit**: whether the constitution's checkable rules held, drift from the opening settlement, big departures nobody explained, and clauses never cited. This is evidence, not a verdict.

Every finished run is saved in `runs/<id>/`: `evidence.json` (the report), `trace.json`, `decisions.jsonl`, `view.json` and `run.json`. The evidence page has download buttons: **Download report (PDF)** (print layout, choose "Save as PDF"), **Report data (.json)** (the evidence), and **Full record (.json)** (settings, evidence, trace and every model decision, for replay). The same files come from `/api/runs/<id>/download/report` and `/download/record`.

Organisers: `/admin` (events, weather, holding the room, what actions mean), with the token printed at startup or `MERIDIAN_ADMIN_TOKEN`. The old single-screen studio is still at `/classic`, and the old projector feed at `/classic/feed`.

```bash
node agents/run-agents.js --constitution constitutions/tampines-compact.md
node agents/run-agents.js --profile dgx --seeds 5 --team alpha --constitution my.md --weather
node agents/run-agents.js --calibrate
node agents/run-agents.js --replay runs/alpha-101/decisions.jsonl --seed 101 --team alpha
```

A model server is required (LM Studio locally; vLLM or SGLang on the DGX). Without one, a run refuses to start rather than pretend. `--no-model` runs the physics only, labelled degraded.

## Who the residents are

How many people there are is the scenario's: the engine sets the size of each age band and the headcount
of each industry, and the personas' weights reproduce both exactly.

Who those people are is drawn from published statistics. Age, ethnicity, type of home, region, household,
children, health, income position, and why someone is not working all come from eleven official tables:
Department of Statistics (Population Trends 2026, General Household Survey 2025) and Ministry of Manpower
(Labour Force in Singapore 2025). So the residents are present-day Singaporeans placed in the 2050 economy.

- [`data/singstat/SOURCES.md`](../data/singstat/SOURCES.md) lists every table, what it is used for, and every assumption made in joining them.
- `../data/singstat/raw/` holds the tables as downloaded.
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
JS and Python agree across 310,166 fields, including 72 monthly ticks.

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

Each run reports its own bill in the report: prompt tokens,
completion tokens, the prompt tokens the server did not have to re-read, and the
mean per call. Compare that figure across runs rather than trusting an estimate.

None of this changes how many agents decide. Population, firms and sub-steps are
unchanged, and every agent is still asked every time it is due to decide.
