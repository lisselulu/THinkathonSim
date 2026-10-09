# Demo runbook

Everything needed to run Meridian in front of a room.

---

## Before you start

```bash
bash demo.sh
```

Starts the agents sidecar and the feed server if they aren't already up,
then warms both agent caches. Safe to run twice — it never starts a
second copy. Check anytime with `bash demo.sh check`.

The one thing it cannot start is **LM Studio** (Developer tab → load
`qwen2.5-7b-instruct` → start server on 1234). Without it everything
still runs; the agents fall back to arithmetic and say so on screen.

You want all three green:

```
feed server :7823        up
agents sidecar :8765     up, can decide
LM Studio :1234          up
```

**Warm the caches before the room fills.** The first ⚯ agents click on a
scenario runs ~11 rounds × 12 agents ≈ 1m45s. After that it's 2 seconds.
`demo.sh` warms `doom_loop_2068` and `resilient_2074`; any *other*
scenario or working-week will run cold in front of your audience.

---

## The five beats

### 1. The feed — society reacting (2 min)

```
http://localhost:7823/feed?scenario=doom_loop_2068&week=5
```

Starts on **arithmetic deciding** — the deterministic baseline, no model,
works with the wi-fi down.

Press **⚯ agents**. Header switches to *agents deciding*. Now twelve
Concordia agents are choosing what people do.

Scrub 2 → 12. The arc: quiet at 2052, unrest climbing, by 2072 unrest
100 with twelve posts — organising, striking, covering for the state.

Points worth making:
- Each post shows **pressure**, **slack**, what they're worried about,
  and who they speak for.
- The **surplus / deficit** tag is the project's spine: the same
  prosocial act means opposite things depending on whether people had
  anything spare.
- Citizens are **blind** to government. They talk about clinic queues,
  never tax rates — enforced by `assertBlind()`, not by prompt wording.

### 2. The loop is actually closed (30 sec)

```bash
node engine/run-society.js --rounds 12 --compare
```

Same government, same shocks, run twice — once with society's decisions
reaching the engine, once with them stripped out. It reports where the
two diverge.

The claim: a population that strikes and one that quietly seethes used to
produce an *identical* country. Now they don't.

### 3. Open-ended runs (30 sec) — **the strongest beat**

```bash
node engine/run-society.js --open --levers resilient_2074
```

`--levers` governs from 2050 with that settlement the whole way, which is
the question worth asking. (`--base resilient_2074` instead *starts* in
2074 with four rounds left.)

```
survived 34 years (2050-2084) | trend: decaying badly

decade         pp    low  worst  cohesion  legit
2052-2060     138.2   125     67        84     87
2062-2070        89    68     62        78     83
2072-2080      40.6    24     53        69     66
2082-2084      13.5    10     46        58     47  (partial)

collapse: the payment below 30 for 6 years - began 2080
```

> **The preset named "resilient" is dying, and the old twelve-round
> horizon was too short to see it.** Decade one looks excellent. The
> decay is monotonic and only visible over a lifetime.

Note the last line of the same output: **`final: score 59`**. A society
that collapsed scores 59, because the total averages away a catastrophe
that arrives late. That is the argument for per-decade scoring, on screen,
without you having to make it.

### 3b. The four-day week is not free (30 sec)

```bash
node engine/run-society.js --open --levers resilient_2074 --week 5
```

Same settlement, five-day week: **survives 48 years** instead of 34.

The shorter week buys slack — and once energy is scarce it also costs
output while demand stays. A lever that is straightforwardly good in a
twelve-round run has a cost that only appears over decades.

### 4. Scarcity pricing (1 min)

Same command as beat 3 — look at the `energy:` line:

```
energy: demand at 155% of capacity, price index 5.05
```

**This is what killed the resilient settlement.** It automates heavily
without building the energy to run it, and the bill arrives as household
prices. Beats 3 and 4 are the same story.

The dilemma, same baseline, four policies:

| policy | tightness | price | purchasing power |
|---|---|---|---|
| hold at baseline | 1.04 | 1.23 | 45 |
| automate everything **but** energy | 2.82 | 6.0 | **1** |
| automate everything incl. energy | 1.31 | 2.66 | 16 |
| automate **only** energy | 0.66 | 0.68 | **66** |

Ramp AI without building the energy to run it → demand at 2.8× capacity →
price pinned at its ceiling → purchasing power collapses to 1. Three ways
out with different time constants: build (slow), import (fast, creates
dependency), throttle.

### 5. Contribution credit (1 min)

```bash
node engine/run-society.js --credit-sweep --levers resilient_2074
```

```
contribution credit: peak at 28%, harm above 71%

rate   prosocial   cohesion   reserves   what the curve says
0           24%         72        314   neutral
0.1         26%         72        310   recruiting
0.28        26%         69        303   recruiting
0.5         26%         66        294   recruiting
0.75        24%         62        286   crowding out
1           24%         58        277   crowding out
```

Participation rises then falls. Cohesion and reserves fall the whole way,
because exclusion and the bill both scale with generosity.

Peaks at **28%**, turns actively harmful above **71%** —
because paying for gifts converts them into transactions (Titmuss;
Deci/Koestner/Ryan; Gneezy & Rustichini's Haifa daycare study).

**A team that maximises the lever does worse than one that thinks about
it.** That's the whole exercise.

`obey` and `endure` earn nothing — this rewards contribution, not
conformity. Gating essentials is available, off by default, and visibly
harms the cohorts who can't earn (Mr Krishnan, Mdm Tan, Priya).

For the darker version, add `--credit 0.28` to the beat-3 command. In a
collapsing society it prints:

```
credit: 0% earning, 91% locked out (Rahim bin Yusof, Mdm Tan Ah Choo, ...)
```

**A contribution scheme excludes almost everyone precisely when it is
most needed**, because nobody has anything spare to contribute.

---

## If asked "is any of this made up?"

```bash
open docs/EVIDENCE.md
```

Every claim → source → the number it sets → a status:
**Evidenced / Anchored / Calibrated / Reasoned / Placeholder.**

Strongest cards:
- The action space is **Hirschman's exit / voice / loyalty** (1970), plus
  the two responses he doesn't cover — which are the two this project
  exists to study.
- **Big Five, not MBTI**, with the reason stated: no published effect size
  links an MBTI type to volunteering.
- Personality is **capped at ±8 points** on a 100-point scale, because the
  literature says "small but robust".

**Say the placeholders out loud before someone finds them.** The trait
table, the action-consequence coefficients, the five scarcity constants
and the three crowding constants are all order-of-magnitude judgements.
Owning that is stronger than being caught by it.

**Do not cite behavioural sink / Calhoun.** It's 1960s rodent work,
heavily criticised, doesn't transfer to humans. Self-determination theory
says the same thing about actual people. Section 5.3 records why.

**Citations are unverified.** Authors, years and journals were written
from memory. If someone asks for a page number, say it needs checking —
don't improvise one.

---

## If something breaks

**Agents button reverts and shows a message.** The sidecar is down or LM
Studio isn't loaded. It's telling the truth rather than serving arithmetic
under an agents label. `bash demo.sh check`, then carry on — the
arithmetic baseline is a legitimate demo.

**A scenario hangs on first ⚯ agents click.** It wasn't warmed. Wait
~1m45s or switch back to a warmed one (`doom_loop_2068&week=5`,
`resilient_2074&week=4`).

**Stale server serving old code.** `pkill` does not work on this machine —
it leaves the process holding the port. Use:

```bash
bash demo.sh kill && bash demo.sh
```

**Nothing works at all.** The CLI needs no servers and no model:

```bash
node engine/run-society.js --open --levers resilient_2074
```

---

## Proof it works

```bash
node engine/test_society.js     # 562 passed, <1s
python engine/test_parity.py    # JS and Python agree exactly
```

The parity test is worth showing: the engine is reimplemented twice and
33,666 fields agree, so the physics aren't something we tuned to make a
demo look good.

---

## URLs

| | |
|---|---|
| the feed (doom) | `http://localhost:7823/feed?scenario=doom_loop_2068&week=5` |
| the feed (resilient) | `http://localhost:7823/feed?scenario=resilient_2074&week=4` |
| the studio | `http://localhost:7823/` |
| agents health | `http://localhost:8765/health` |
