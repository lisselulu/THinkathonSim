# Evidence

Every claim this simulation makes about how people behave, where it came
from, and which number it sets.

The project's rule is that no number is arbitrary. This file is where
that rule is either kept or visibly broken — a coefficient that appears
here as a **placeholder** is one nobody should defend in a judging room,
and saying so here is cheaper than being caught by it.

---

## How to read an entry

Each entry has four parts:

- **Claim** — what the model asserts about the world
- **Source** — where the claim comes from
- **In the code** — the file, and the number it sets
- **Status** — one of the five below

| Status | Means |
|---|---|
| **Evidenced** | A published, replicated finding. The *direction* is solid; the exact magnitude in the code is our calibration of it. |
| **Anchored** | Derived from a real published figure for Singapore or the scenario baseline. |
| **Calibrated** | Chosen so the model reproduces a target it was fitted to. Internally justified, externally unverified. Not a finding about the world. |
| **Reasoned** | No direct source. A defensible mechanism argued from first principles, stated as such. |
| **Placeholder** | Invented to make the thing run. No result may rest on it. |

> ### ⚠ Bibliographic details need checking before publication
>
> The works cited below are real and the findings are reported as
> accurately as we can state them, but **author/year/journal details here
> were written from memory and have not been checked against the sources**.
> Before any of this goes in a slide deck, a paper, or a judging
> submission, someone must verify each citation and correct it here.
> Nothing in the argument depends on a page number, but a wrong year in
> front of an examiner costs you the point anyway.
>
> Entries carrying a specific effect size are marked **[verify size]**.

---

## 1. Personality

### 1.1 Why the Big Five, and not MBTI

**Claim.** The Big Five is a usable instrument for predicting behaviour;
the MBTI is not.

**Source.**
- Roberts, B. W. & DelVecchio, W. F. (2000), *The rank-order consistency
  of personality traits from childhood to old age: a quantitative review
  of longitudinal studies*, Psychological Bulletin — the standard
  meta-analysis on trait stability.
- Pittenger, D. J. (1993), *The utility of the Myers-Briggs Type
  Indicator*, Review of Educational Research; and Pittenger (2005),
  *Cautionary comments regarding the Myers-Briggs Type Indicator*,
  Consulting Psychology Journal.

**The substance.** A large share of people change at least one MBTI
letter on retest within weeks — the figure usually quoted is between a
quarter and a half. Big Five rank-order stability over comparable
intervals is substantially higher. More decisively for us: there is no
published effect size linking an MBTI type to volunteering, because the
researchers who study volunteering do not use the instrument. A model
built on MBTI would have had to invent every coefficient.

**In the code.** `engine/traits.js` — the entire file; the header states
this argument.

**Status.** **Evidenced** (direction and comparison). The specific
stability ranges quoted in the file header (0.55–0.75 vs 0.75–0.90) are
**[verify size]**.

---

### 1.2 Personality predicts civic engagement — weakly

**Claim.** Agreeableness, extraversion and openness are associated with
*more* civic participation; conscientiousness and neuroticism with
*less*. All effects are small.

**Source.**
- Mondak, J. J. & Halperin, K. D. (2008), *A framework for the study of
  personality and political behaviour*, British Journal of Political
  Science.
- Gerber, A. S., Huber, G. A., Doherty, D. & Dowling, C. M. (2011), *The
  Big Five personality traits in the political arena*, Annual Review of
  Political Science.
- Bekkers, R. (2010) and Okun, M. A. & Schultz, A. (2003) on personality
  and volunteering specifically.

**The substance.** The literature's own phrasing is "small but robust" —
real, replicated, and comparable in magnitude to age, education or
income rather than dominating them.

**The conscientiousness sign surprises people** and is stated plainly in
the code rather than quietly reversed: conscientious people report *less*
of this kind of engagement. Duty to one's own obligations is not the same
thing as duty to strangers.

**In the code.** `engine/traits.js` — `civic()`:

```js
(t.a - 0.5) * 0.40 + (t.e - 0.5) * 0.30 + (t.o - 0.5) * 0.20
                   - (t.c - 0.5) * 0.15 - (t.n - 0.5) * 0.25
```

**Status.** **Evidenced** (directions). The relative weights are
**Calibrated** — chosen to respect the ordering in the literature, not
fitted to any published coefficient.

---

### 1.3 The cap on how much personality may matter

**Claim.** Personality shifts behavioural thresholds at the margin and
never overrides circumstance.

**Source.** Follows from 1.2 — if the effects are comparable to income
and age, they cannot be allowed to dominate a model in which income and
service quality move by far more.

**Also a design commitment, stated as such:** if personality could rescue
a cohort from bad policy, teams would be scored on the luck of the draw
rather than on how they governed.

**In the code.** `engine/decide.js` and `lab/feed.js` — the threshold
shift is `tr.threat * 16`, spanning **±8 points on a 100-point pressure
scale**, against circumstance which routinely moves the same scale by 50.

**Status.** **Reasoned**, consistent with **Evidenced** magnitudes.

---

### 1.4 The trait values themselves

**Claim.** None. The twelve cohorts' Big Five scores are hand-set to be
plausible and varied.

**In the code.** `engine/traits.js` — the `TRAITS` table.

**Status.** **Placeholder**, and labelled as such in the file. Replacing
these with draws from published population norms is outstanding work. **No
result that depends on the precise value of a trait should be reported as
a finding until that is done.**

---

## 2. What people do about it

### 2.1 The action space is Exit, Voice and Loyalty

**Claim.** The twelve behaviours are not an arbitrary list. They are a
recognised taxonomy of responses to institutional decline.

**Source.** Hirschman, A. O. (1970), *Exit, Voice, and Loyalty: Responses
to Decline in Firms, Organizations, and States*.

**The substance.** Hirschman's three responses map onto the action space
almost exactly, which is worth saying out loud because it is the
strongest external justification the taxonomy has:

| Hirschman | Our behaviours |
|---|---|
| **Exit** | `emigrate`, `withdraw`, `save`, `breakrules` |
| **Voice** | `debate`, `activism`, `organise`, `strike` |
| **Loyalty** | `obey`, `endure` |
| *(unaccounted for by Hirschman)* | `flourish`, `mutual_aid` |

The two the framework does not cover are the two this project exists to
study — what people do with a surplus rather than a grievance — and the
gap is itself a defensible reason for the project.

Hirschman's central mechanism also matters to us: **exit and voice are
substitutes.** People who can leave are less likely to stay and argue,
which is why emigration is gated on `mobility` and why losing the mobile
first degrades a country's capacity to reform itself.

**In the code.** `engine/action_space.js`.

**Status.** **Evidenced** as a taxonomy. The assignment of our twelve to
his three is our reading, not his.

---

### 2.2 Emigration is selective, and depletes

**Claim.** A country in decline does not lose a random slice of its
people. It loses the ones who could go — and each wave leaves fewer who
can follow.

**Source.**
- Borjas, G. J. (1987), *Self-selection and the earnings of immigrants*,
  American Economic Review — the standard reference for skill-selective
  migration.
- Grogger, J. & Hanson, G. H. (2011), *Income maximization and the
  selection and sorting of international migrants*, Journal of
  Development Economics.

**In the code.** `engine/society_round.js` — `emigrate` requires
`mobility ≥ 0.5`; `memory.departed[id]` accumulates at
`was + (1 - was) * 0.33` per round, capped at 0.85; remaining mobility is
scaled by `(1 - gone * 1.6)`.

**Status.** **Evidenced** (selectivity). The 0.33-per-round depletion rate
and the 1.6 mobility decay are **Reasoned** — chosen so a cohort cannot
emigrate indefinitely, which the first draft allowed. No source.

---

### 2.3 Unrest reduces output

**Claim.** Civic unrest above a threshold costs the economy output, and
the loss compounds.

**Source.** Alesina, A., Özler, S., Roubini, N. & Swagel, P. (1996),
*Political instability and economic growth*, Journal of Economic Growth —
establishes the association at country level.

**The substance is weaker than the mechanism implies.** The literature
supports "instability is bad for growth". It does not supply our
threshold, our quadratic, or our coefficient. The convex shape is argued
rather than measured: one absence is covered, a third of the shift absent
closes the line.

**In the code.** `engine/meridian-engine.js` — `UNREST_THRESHOLD: 50`,
then `unrestDrag = 1 - UNREST_DRAG * over²`.

**Status.** **Reasoned**, loosely supported. This is one of the softer
joints in the model and should be described that way.

---

### 2.4 What actions cost the country

**Claim.** Strikes remove capacity from the sectors strikers work in;
mutual aid adds capacity to services neighbours can actually provide;
organising costs legitimacy.

**Source.** For the mutual-aid direction specifically:
Ostrom, E. (1990), *Governing the Commons: The Evolution of Institutions
for Collective Action* — communities really do sustain provision of
shared goods without the state, under identifiable conditions.

Note Ostrom's conditions are *not* modelled. We assert that mutual aid
works; she showed it works when specific institutional features are
present. That is a real simplification and it flatters mutual aid.

**In the code.** `engine/action_space.js` — the `consequence` block on
each action. A strike is `-0.18` capacity per unit population weight in
`LABOUR_SECTORS`; mutual aid is `+0.10` in `COVERABLE_SECTORS`.

**Status.** **Reasoned** for direction; every coefficient is
**Placeholder**. They were chosen for order of magnitude — full national
participation costs roughly a fifth of capacity — and nothing was fitted.

---

## 3. Slack, and the four-day week

**Claim.** A shorter working week frees time, and the freed time goes to
community, care and civic activity rather than only to leisure.

**Source.** 4 Day Week Global / Autonomy, UK pilot (2022–23), reported by
Schor, J. et al. The largest coordinated trial to date; participating
organisations overwhelmingly continued the policy afterwards.

**The substance.** Trials report the freed day going to exactly the
activities the `flourish` behaviour models. This is the strongest single
empirical support in the project for its central claim — that the
working week is a lever a government holds which changes what a society
*does*, not just how tired it is.

**Caveat that belongs in the room:** these are *organisational* trials of
self-selected employers, not a national policy experiment in a
post-employment economy. The direction transfers; the magnitude may not.

**In the code.** `lab/feed.js` and `engine/society_round.js` — `slackOf()`:
`time = clamp((5 - week) / 2, 0, 1) * 0.8 + 0.1` for those in work.

**Status.** **Evidenced** (direction), **Calibrated** (magnitude).

---

### 3.1 Slack requires all three of time, money and security

**Claim.** Spare time without spare money is not slack.

**Source.** No single citation. Consistent with the broad finding that
scarcity consumes cognitive bandwidth — Mullainathan, S. & Shafir, E.
(2013), *Scarcity: Why Having Too Little Means So Much*.

**In the code.** `Math.min(time, money, security) * 1.15` — a minimum, not
a mean, so any one of the three at zero produces no slack at all.

**Status.** **Reasoned**, consistent with **Evidenced** work on scarcity.

---

## 4. Pressure is not an average

**Claim.** A person with one catastrophe and three non-problems is in a
catastrophe, not in mild difficulty.

**Source.** No formal citation; this is a modelling correction, and it is
recorded here because it changed results materially.

**What happened.** Pressure was a weighted mean across four channels
(material 0.32, service 0.34, work 0.22, voice 0.12). In the 2058
pandemic round, Mdm Tan Ah Choo — a retired cleaner — scored material 53
and service 33 with work and voice at zero, which the mean rendered as
**28**, below every escalation threshold. The independent sentiment model
put her at **−63**, furious. Two channels she has no exposure to were
being averaged into her distress and diluting it.

**In the code.** `engine/society_round.js` and `lab/feed.js`:
`total = worst + mean(other three) * 0.35`.

**Status.** **Reasoned**. The 0.35 weight is **Calibrated** — chosen so
the pressure reading reconciles with the sentiment model the engine was
already tuned against.

---

## 5. Contribution credit — **built** (`engine/contribution.js`)

Off by default (`rate: 0`). A team must choose to build it and choose how
far to take it.

### 5.1 The hole it fills

Prosocial behaviour is currently modelled as costless altruism: an agent
chooses `flourish` or `mutual_aid`, the country gains, and the person
gains nothing. That is a one-way loop and the least defensible thing in
the current model.

### 5.2 Motivation crowding-out — the reason it must not be a simple bonus

**Claim.** Paying people for prosocial acts can *reduce* those acts, by
converting a gift into a transaction.

**Source.**
- Titmuss, R. M. (1970), *The Gift Relationship: From Human Blood to
  Social Policy* — the founding argument, on voluntary vs paid blood
  donation.
- Deci, E. L. (1971), and Deci, E. L., Koestner, R. & Ryan, R. M. (1999),
  *A meta-analytic review of experiments examining the effects of
  extrinsic rewards on intrinsic motivation*, Psychological Bulletin — the
  undermining effect.
- Frey, B. S. & Jegen, R. (2001), *Motivation Crowding Theory*, Journal of
  Economic Surveys — the survey that names the mechanism.
- Gneezy, U. & Rustichini, A. (2000), *A Fine is a Price*, Journal of
  Legal Studies — the Haifa daycare study, where fining late parents
  *increased* lateness.
- Gneezy, U. & Rustichini, A. (2000), *Pay enough or don't pay at all*,
  Quarterly Journal of Economics — small rewards can perform worse than
  none.

**The design consequence.** If contribution credit only ever *increases*
contribution, the simulation teaches "just incentivise it", which is both
unrealistic and a bad lesson. The reward should be **effective at low
levels and counterproductive at high levels**, so teams have to find the
calibration — the same shape as the cap already placed on personality.

**In the code.** `engine/contribution.js` — `crowding(rate)`:

```
recruited = RECRUIT * (1 - e^(-SATURATION * rate))    saturating gain
displaced = DISPLACE * rate                            linear loss
net       = recruited - displaced
```

With `RECRUIT 0.45`, `SATURATION 4.0`, `DISPLACE 0.60` this peaks at a
rate of **0.275** and turns actively harmful above **0.71**. Those two
figures are computed by `optimum()` and `breakEven()` rather than
hard-coded, so changing a coefficient cannot leave this page quietly
wrong.

**A shape correction worth recording.** The first implementation used
`extrinsic*rate + e^(-crowd*rate) - 1`. That form **cannot have an
interior peak for any coefficients** — its derivative is monotone, so it
either rises forever (no crowding out at all) or falls from zero (no
recruiting range). It read as plausible and produced a curve that was
negative everywhere. A saturating gain against a linear loss is the shape
the literature actually describes.

**Status.** **Evidenced** (the effect is real and replicated; the shape
follows from it). All three coefficients are **Placeholder** — not fitted
to any published elasticity.

### 5.3 Behavioural sink — *rejected as a justification*

**Do not cite Calhoun for this.**

- Calhoun, J. B. (1962), *Population density and social pathology*,
  Scientific American — the "behavioural sink" mouse experiments.
- Ramsden, E. & Adams, J. (2009), *Escaping the laboratory: the rodent
  experiments of John B. Calhoun and their cultural influence*, Journal of
  Social History — the critical reassessment.

**Why it is rejected.** The work is 1960s rodent research, heavily
criticised on both methodological and interpretive grounds, and does not
transfer to human societies. The intuition it is usually invoked for —
that a society needs sources of motivation and structure beyond material
provision — is better supported elsewhere and does not need it.

**Cite instead.** Deci, E. L. & Ryan, R. M. (1985; 2000),
self-determination theory: autonomy, competence and relatedness as the
conditions for sustained motivation. This says what the behavioural sink
is usually recruited to say, and it says it about people.

**Status.** **Rejected.** Recorded here so nobody re-adopts it later.

### 5.4 Essential services must not be gated on contribution

**Claim.** Gating essentials on earned credit is a poverty trap that
excludes precisely those least able to contribute.

**Source.** Follows from the corpus itself rather than from literature:
Mr Krishnan (chronic illness, 74), Mdm Tan Ah Choo (retired, 68) and
Priya Raman (single parent, part-time) are structurally least able to
earn and most dependent on the services in question.

**Design recommendation.** Essentials unconditional; credit buys
non-essentials. Leave "gate the essentials too" available as a *policy
option* whose damage is visible in the score and in the feed, so teams
discover it is a trap rather than being told.

**Naming.** "Social credit" invokes the Chinese system. A mechanism that
rewards `obey` is a different political object from one that rewards
`mutual_aid`, and the project should be deliberate about which it models.

**In the code.** `gates_essentials` is a policy flag, default `false`.
When on, the essential services the excluded depend on lose capacity in
proportion to how many are locked out *and* how generous the scheme is —
the harm is concrete rather than a penalty term. `excluded()` names the
locked-out cohorts every round, because a scheme can raise participation
overall while excluding the people who needed it most, and an aggregate
number will not say so.

**Status.** **Reasoned**, and a design commitment.

---

## 6. Scarcity and prices — **built**

**Claim.** Constrained resources should form prices, and prices should
change behaviour.

**Already in the code:** automation drives compute and energy demand
(`drivers.compute`, and a `compute_int` per sector), the `compute_energy`
sector has finite capacity, and energy is tradable between societies with
a floor on selling into your own need.

**What was missing:** any endogenous price. Scarcity showed up only as
rationing — a quality shortfall — while the price drifted at a flat 1% a
round regardless. A society could triple its automation and the energy
price would not notice.

**Now** (`engine/meridian-engine.js`, section 7.1):

```
tightness = demand / capacity          (compute_energy, last round)
pressure  = tightness - SLACK_BAND     (0.92; below it, nothing)
price    *= 1 + ELASTICITY * pressure^CONVEXITY
```

`CONVEXITY 1.6` because the last tenth of spare capacity costs far more
than the first. Lagged one round deliberately: letting price depend on a
quantity that depends on price has no obvious fixed point, and prices
respond to *observed* scarcity anyway.

The price already reached households (via the price index, so
`effective_ubi_index`) and already raised the cost of running automated
capacity (via `computeCost`). Both channels existed. This is what makes
them respond to the team's own automation policy instead of only to
shocks.

**What it produces** — same baseline, ten rounds, four policies:

| policy | tightness | price | purchasing power |
|---|---|---|---|
| hold at baseline | 1.04 | 1.23 | 45 |
| automate everything **but** energy | 2.82 | 6.0 (ceiling) | **1** |
| automate everything incl. energy | 1.31 | 2.66 | 16 |
| automate **only** energy | 0.66 | 0.68 | **66** |

Ramping AI without building the energy to run it drives demand to 2.8x
capacity, pins the price at its ceiling, and collapses purchasing power.
Building the capacity first is the answer. Importing (via the trade
layer's `exogenous.capacity`) is the other, and is tested.

**Note the ceiling binds** in the starved case. A price index of 6x is
already catastrophic and the distinction beyond it does not matter much,
but the clamp is doing work and should not be mistaken for a result.

**Source for the mechanism.** Standard price theory; no specialist
citation required. What *would* need sourcing is any specific elasticity
we adopt — the responsiveness of energy demand to price is an empirical
quantity and should be cited when chosen, not invented.

**Status.** **Reasoned** for the mechanism; every coefficient
(`SLACK_BAND`, `ELASTICITY`, `CONVEXITY`, `RELIEF`, `PRICE_CEILING`) is
**Placeholder**. No published elasticity of energy demand has been cited,
and one should be before any of this is presented as a quantitative
result.

---

## 6b. Long runs, and why the score punishes them

**Claim.** A government that governs identically well for sixty years
should not score lower than one that stopped at twenty-four.

**The problem, which was invisible.** `score()` measures
`sustained_real_ubi` as a **mean**, but `minimum_ubi` as a **minimum**
after round 1 and `worst_service` as the **worst ever**. Means are
length-independent; minima are not — a minimum over a longer sequence can
only be equal or lower. So a longer run is strictly penalised for having
given the minimum more chances to be bad. Both runs complete, both
produce a number, and the number quietly rewards stopping early.

**In the code.** `engine/longrun.js`:

- `decades()` — the same metrics per ten-year window (5 rounds). A
  strategy that holds shows a flat line; one coasting on inherited
  reserves shows decay. Partial windows are flagged rather than averaged
  in, so a run ending on a good year cannot report a good decade.
- `trend()` — first complete decade against last, with a verdict.
- `collapse()` — sustained breach of a floor, dated to when it **began**
  rather than when it was detected, with a reason. Reporting the
  detection year would flatter the government by six years.
- `report()` carries `score_note` saying the score is comparable only
  between runs of equal length, in the payload rather than a comment.

**What it immediately revealed.** The `resilient_2074` preset survives 86
years but decays **monotonically** — purchasing power 143 → 25 across
eight decades before collapsing in 2136. At twelve rounds it reads 143 →
124 and looks healthy. **The preset named "resilient" is slowly dying,
and the old horizon was too short to see it.**

**Status.** The floor values (`worst_essential 25`, `purchasing_power 30`,
`SUSTAIN 3` rounds) are **Reasoned** — chosen so that a rough patch is not
a collapse. The demographic extrapolation past round 12 is
**Placeholder**: the published projection ends there, and beyond it the
final trend continues damped with a 15-round half-life. Anything after
2072 is "the trend, continued", not a forecast.

---

## 6c. Constitutional fidelity is now earned

**Claim.** The fifteen marks a team's writing can earn should depend on
whether they kept what they wrote.

**What was wrong.** `score()` read `constitution.levers` — a numeric block
that only the JSON-authored reference constitutions carry. A markdown
constitution, which is the format `harness/cabinet.js` parses and the
format the spec asks teams to write, has no such key. So `terms` stayed
zero, `fidelity` stayed 1, and **every prose-authored government collected
all fifteen marks whatever it did.** The one place writing was worth
anything awarded it unconditionally.

Two further silences compounded it. `harness/auditor.js` computed the
real figure all along and was wired to nothing. And both trace writers
recorded `levers`, while the auditor filters on `levers_enacted`, so an
audit of any run matched **zero rows** and reported drift 0 — correct
code, unreachable.

**Now.** `score(traj, constitution, { constitutional_drift })`.
`fidelity = 1 - drift`, where drift is the auditor's weighted figure:

| term | weight | what it catches |
|---|---|---|
| unminuted departures | 0.34 | moved materially without naming a clause |
| rules broken | 0.28 | `auditDoctrine` over the written rules |
| rounds ungoverned | 0.18 | caretaker rounds; a harness that threw |
| clauses never cited | 0.12 | a constitution that was decoration |
| volatility | 0.08 | reversing itself every two years |

Wired into **both** scoring paths — `harness/loop.js` (the cabinet) and
`engine/harness.js` `runHarness` (how teams actually submit). The
lever-block comparison remains as the fallback for callers with no trace,
so nothing that scored before scores differently.

**Markdown constitutions can now carry rules.** A fenced ```rule block
beneath a clause becomes a machine-checkable assertion tied to that
clause. Previously `parseConstitution` returned `rules: []`
unconditionally, so a markdown team's doctrine audit was structurally
empty — `rules_checked` zero, compliance vacuously 1 — and they could not
break a promise they had written down.

**`invokes` now does something.** It was written into every harness trace
row since the beginning and read by nothing. It resolves to the clause a
round acted under, which is the harness-side spelling of the cabinet's
`cites`, so both authoring routes are audited on the same terms.

**Measured.** Identical economy, identical levers, only the written
promise differing: a kept promise scores 61 with 15/15 fidelity; a broken
one scores 57 with 10.8/15.

**Status.** **Reasoned.** The five weights come from
`harness/auditor.js` and are unchanged — they were a considered design
already, just disconnected. They are not fitted to anything and should be
described as a marking scheme, not a measurement.

---

## 6d. The industry list

**Claim.** Thirteen sectors cover what a city-state runs on, and they are
Singapore-shaped rather than generic.

**What changed and why.**

- **Manufacturing added.** Roughly a fifth of Singapore's GDP and entirely
  absent before. It is also the largest single employer in the table, so
  its absence understated how much employment automation can destroy.
- **Energy split from Compute.** They were one sector. A power grid and a
  data network have different build times, different elasticities and
  different failure modes, and the question this project exists to ask —
  what happens when AI adoption outruns the energy to run it — is
  unaskable while they are the same row.
- **Public Administration added.** The state's own capacity, so it can
  degrade like anything else.
- **No extraction or mining.** Singapore has none. Raw-material dependence
  is modelled as import exposure, which is the more interesting
  vulnerability anyway.
- **Transport is now Transport & Logistics**, and **Education is now
  Education & Research** — the latter is where skilled labour and
  technological progress are supposed to come from, and there was no
  research anywhere in the model.

**Anchors held.** Total output stays **782bn** and total headcount stays
**2,125,000**, both authored in `world-states.json` and both load-bearing:
the first is `CAL.GDP`, the second is the round-1 employment rate. Corporate
profit lands on **164.0**, matching the authored figure, so `CAL.INFRA` and
the `UBI_MONTHLY: 680` normalisation need no change.

**Two calibration slips worth recording**, because both were silent and
both were caught only by running the reference governments:

1. Splitting a sector **splits its capacity**. The `compute` demand driver
   used to meet one sector of 127bn; the two successors came to 112bn, so
   both ran permanently tight and dragged the worst-essential score below
   every reference constitution's floor. Restored to 127bn combined.
2. Splitting a sector **must carry its elasticity across**. The grid was
   given `productivity` 1.20 where the parent had 1.80, so automating it
   no longer bought capacity: demand rose with the whole economy's
   automation while supply could not follow, and the grid ran at 155% of
   capacity. Restored to 1.70.

Neither would have been visible from the table alone. Both showed up as
reference governments breaking their own written constitutions.

**Status.** **Anchored** for the totals and the Singapore shape.
**Reasoned** for the split of output between sectors — the shares are
plausible and are not fitted to published national accounts. The margins
are **Calibrated** so round 1 reproduces the authored baseline.

---

## 6e. Per-sector capital, and firms choosing beneath a ceiling

*Foundations only. Computed and verified, deliberately not yet applied.*

### The missing feedback loop

**Claim.** A sector's own earnings should fund its own capital stock.

**What was wrong.** `capitalIndex` was a single economy-wide scalar, so a
sector running a 40% margin and one running −10% received the **identical**
capital multiplier next round. Nothing anywhere in the supply side rewarded
a sector for being profitable, which is why growth could not compound.

**Now.** `_sectorCapital[k]` accumulates from that sector's own margin,
measured **against the round-1 margin it was calibrated to**, not against
zero. Care services run at −0.09 by design and are not a failing business;
judging every sector against the same absolute bar would decay care and
education to the floor in every run whatever a government did — a statement
about the scoring, not about the country.

**Applied at weight zero.** `SECTOR_CAPITAL_WEIGHT: 0` makes the capacity
term exactly 1, so every existing result is byte-identical — asserted
directly against the pre-stage engine over a shocked twelve-round run. The
figure is computed, observable and tested now so that when the weight is
raised, the change can be attributed to growth rather than to the plumbing.

### Firms choose beneath a ceiling

`exo.firms[sector].automation` lets a firm pick its own level, clamped to
the government's lever — which stops being a *target* and becomes a
*ceiling*. A state can forbid, tax and subsidise; it cannot compel a firm
to invest. `automation_ceiling` is accepted as an alias so a team can write
the lever under the name that now describes it, without invalidating a
saved settlement. Absent, everything behaves exactly as before.

### Two guards that were not guarding

- **The blindness list had no scope.** A firm handed a citizen's blindfold
  cannot read its own cost base; the alternative was removing the guard,
  which is how a guard stops existing. Scoped: a firm may see the tax rate
  it pays, prices, demand and its own margin, and may not see the treasury,
  the score, or the citizen feed.
- **Parity skipped engine-internal state.** Every `_`-prefixed
  carry-forward key was excluded, so `_computePrice`, `_computeTightness`,
  `_capitalIndex` and `_sectorCapital` were **never compared** between the
  two engines. They are state the next round reads; a divergence there
  would surface later, somewhere else, looking like a different bug — and
  for `_sectorCapital`, which is computed but not applied, it would have
  been invisible until the weight was raised. Numeric carry-forward is now
  compared: **45,037 fields, up from 38,697.**

**Status.** **Reasoned.** `SECTOR_CAPITAL_DEPRECIATION` matches the
economy-wide rate; the ±2.0 margin sensitivity and the 0.6/0.4 blend
against economy-wide reinvestment are **Placeholder** and are the first
things to calibrate when growth lands.

---

## 6f. Each industry judged against its own mission

*Built and verified; blended in at weight zero pending a calibration pass.*

**Claim.** A hospital and a bank are not good at the same things and
should not be scored as though they were.

**What was wrong.** One formula scored all thirteen sectors — the same
four dimensions in the same proportions, varying only by two per-sector
coefficients (`human_touch`, `comfort`) and two hardcoded sector lists.

**Now.** `engine/sector_missions.js` gives each industry a one-sentence
mission and a scorecard of weighted dimensions summing to 1. Sectors lead
on different things:

| sector | leads on | because |
|---|---|---|
| care services | **humanity** 0.40 | the human *is* the service |
| energy & utilities | **reliability** 0.34 | a profitable intermittent grid has failed |
| housing & construction | **affordability** 0.32 | |
| finance | **reliability** 0.34, access 0.30 | scored on whether capital *reaches* the economy, **not on margin** — a banking sector can be hugely profitable while starving everything it is meant to fund |

**The old formula is the special case** where every sector weights the
same four dimensions identically. That is what makes this safe to phase
in: `MISSION_WEIGHT` blends between them, is 0 today, and weight 0 is
asserted byte-identical to the previous engine.

At weight 1 it is a **re-weighting, not a rescaling**: care services +8,
public safety +5, energy −5 (penalised on affordability as prices rise),
largest swing under 20 points. Both properties are tested.

### The trap that was avoided

Letting each industry's agent define its own KPIs looks like more
autonomy and is less rigour: an agent that sets its own targets can
declare success on transactions processed while the country starves, and
no number would contradict it. The scorecard is authored in the repo and
measured deterministically; **the agent's agency is in how it hits the
targets, never in what they are.**

### One honest weakness

**`equity` is a proxy, and a weak one.** The engine has no per-cohort
access figure, so it charges rationing more heavily when a larger share
of the population is exposed to losing its income — on the reasoning that
rationing falls hardest on those with fewest alternatives. A real measure
would read the worst-served cohort directly, which means the citizen
corpus reaching the engine. That is a larger change and was not made here.

### One scorecard, two engines

The table is authored in JS and exported to `engine/sector_missions.json`,
which the Python mirror **reads** rather than restating. Two copies of a
scorecard is one scorecard and one silent disagreement. A test asserts the
export has not drifted from the source, and parity was verified with
missions fully active (`MISSION_WEIGHT = 1`) as well as off — the weight-0
path does not exercise the new code at all.

**Status.** **Reasoned.** The weights express editorial judgement about
what each industry is for and are not fitted to anything; the dimension
scales are **Calibrated** so that a sector weighting a dimension the way
the old global formula implicitly did reproduces approximately its old
number. Both should be argued with.

---

## 6g. Growth stops being a static multiplier

*Live. Stage 5 is where every weight deferred from stages 3 and 4 was
raised, so this changes every run.*

**What was wrong.** `prodGain = 1 + productivity x (automation - r1)` —
strictly affine, immediate, and one-off. Fully automating finance bought
+41% capacity, once. And `AUTOMATION_STEP_UP = 0.14` applied whether a
sector sat at 0.12 or 0.90: a constant-rate line, not a curve.

### 1. Bass diffusion — adoption is an S-curve

```
rate = (p + q·F)(1 − F)        F = penetration
p = 0.030 (innovation)   q = 0.380 (imitation)
```

Slow while few have adopted, fastest mid-way, saturating. **Calibrated so
the peak rate equals the old constant step** — diffusion changes the
shape, not the ceiling. A 0.50 → 0.92 climb took 3 rounds and now takes 7,
decelerating as it saturates.

*Source: Bass (1969); Rogers, Diffusion of Innovations.*

### 2. The productivity J-curve

`_autoExperience` lags `automation`. The gap is capacity bought and not
yet learned to use, and it costs output; absorbed automation then pays
**more** than the naive gain, because the reorganisation it forced is
itself productive.

Measured, with diffusion off so a jump is possible: GDP is **lower** at
rounds 2–3 (796 vs 814) and **higher** from round 6 on (708 vs 669 at
round 12). Dips, then exceeds.

The `J_MATURE` term is not a nicety. Without it the mechanism only ever
costs output, and a team would correctly conclude automating is never
worth it — which is not the finding.

*Source: Brynjolfsson, Rock & Syverson (2021), The Productivity J-Curve;
David (1990), The Dynamo and the Computer.*

### 3. The learning curve

Unit compute cost falls with **cumulative** consumption, `cost ∝ Q^(−0.15)`
— roughly 10% per doubling, floored so experience never makes compute
free. This is the mechanism that makes AI compound rather than merely be
large: a society far along the curve gets more automation per dollar than
one starting out.

*Source: Wright's law / experience curves.*

### What the calibration pass found

Sweeping the five weights together rather than one at a time, because
they interact:

| | accelerate | guardian | steward |
|---|---|---|---|
| all off | 9 | 68 | 74 |
| + diffusion | 9 | 67 | 74 |
| + J-curve | 0 | 58 | 65 |
| + learning | 9 | 64 | 68 |
| **all five, calibrated** | **3** | **72** | **74** |

Two things worth recording:

- **Diffusion alone is nearly neutral**, which is the point: it changes
  how fast a society gets somewhere, not where it can get to.
- **Learning offsets the J-curve** almost exactly. They are complementary
  by construction — one is the cost of adopting, the other the return on
  having adopted — and tuning either alone would have fitted it to the
  absence of the other.

**An interaction worth knowing.** Diffusion already prevents the rush the
J-curve punishes, so on a realistic run the two partly cancel: rushing and
pacing to the same destination now score the same, because you *cannot*
rush. The J-curve's effect is on the time path rather than on the
endpoint, and the test isolates it with diffusion off for exactly that
reason. Testing the J through the diffusion cap would measure the cap.

**Status.** The three mechanisms are **Evidenced** in form. Every
coefficient — `J_DIP 0.35`, `J_MATURE 1.40`, `J_ABSORB_RATE 0.45`,
`LEARNING_EXPONENT 0.15`, `BASS_P/Q/SCALE` — is **Calibrated**, fitted so
the reference governments keep their own constitutions and the teaching
order survives. They are not fitted to published data. Bass `p` and `q`
are near the values usually quoted for consumer durables, which is the
closest available analogue and not the same thing.

---

## 6h. Industries become agents

**Claim.** A government can forbid, tax and subsidise. It cannot compel a
firm to invest.

**What was wrong.** `automation_target` was obeyed. A team set 95% and got
95%, so the compute levy and the corporate tax rate could only change how
FAST an industry got there, never whether it went.

**Now.** Thirteen industry agents, one per sector, in the same shape as
the twelve citizens: same decider contract, same observe / decide /
check / price sequence, same honest-fallback discipline. Eight actions —
invest, hold, divest, hire, lay off, build, cut costs, lobby.

**A firm optimises its MISSION, not its margin.** It is told what its
industry is for (section 6f), what it is judged on and in what
proportions, and margin is one input to that. A hospital that is
profitable and turning people away has failed at the thing it exists to
do.

**Lobbying does not move the ceiling.** A firm may spend legitimacy
asking; whether the limit changes is the government's decision. Modelling
it as automatically effective would hand industry a lever over policy
that nothing in the simulation justifies.

### What it produces

Same government, permitting 90% automation everywhere and taxing it hard
(levy 0.28, corporate tax 0.42):

| | mean automation | employment | score |
|---|---|---|---|
| firms obey the lever | 0.88 | 6% | 0 |
| **firms may decline** | **0.68** | **33%** | **63** |

**Taxing automation works — but only if firms can decline to automate.**
In the old model the lever was a target, so the tax slowed the inevitable
and the economy collapsed anyway. That is the finding this stage exists
to make available, and it is not visible without firm agency.

Under a permissive levy the two converge: profitable firms chase the
ceiling whether or not they were asked. Which is correct, and is why the
control comparison is worth running both ways.

### Three bugs worth recording

1. **`hold` said nothing, so the ceiling could never bind.** Only the
   investing actions emitted a firm decision, and the engine reads silence
   as "no firm here" and climbs to the ceiling anyway. A firm that had
   decided to stop watched its own automation keep rising — declining to
   invest was indistinguishable from not being asked. Every decision now
   states a level, including the ones that change nothing.
2. **The firm ladder never weighed the COST of automating**, only whether
   there was room and a comfortable margin. So a punitive levy changed the
   rate and never the decision. Firms now stop when input prices are
   rising and their own margin is falling.
3. **The margin predicate was absolute.** Care services are calibrated to
   −0.09 and education to −0.04; an absolute test made the two most
   human-intensive industries incapable of anything but cutting, whatever
   they were doing. Judged against their own baseline now — the same
   correction the per-sector capital needed in 6e.

### And one the guard caught

The firm persona ended "you do not know how the government is being
**scored**", and `score` is on the firm forbidden list. The blindness
guard refused to build the agent. Self-inflicted, caught immediately, and
a fair demonstration that the scoped guard works.

**Status.** **Reasoned.** The action set and the ladder are editorial
judgement about how a firm behaves; every threshold in
`deterministicChoose` is **Placeholder**. The ladder is also the CONTROL
the Concordia agents are measured against, so it should be argued with
rather than trusted.

---

## 7. What is anchored to the real Singapore

| Figure | Value | In the code |
|---|---|---|
| Population | 5,940,000 | `world-states.json`, `baseline_2050` |
| Round-1 UBI | SGD 680/month | `engine/meridian-engine.js` |
| Sector base output, headcount, wages | per sector, 13 sectors | `SECTORS` table |
| Sector shares | manufacturing ~17% of output, finance ~15% | `SECTORS` table |

**Status.** **Anchored** to the published scenario baseline. Note this is
a *scenario* about 2050, not a measurement of 2026 Singapore; the
baseline is the brief's, and the levers on it are the team's.

---

### 7.1 Who the residents are

**Claim.** The residents of the agent society have the age, ethnicity, housing, region, household,
health, income position and reasons for not working of Singapore residents today.

**Source.** Eleven published tables: Singapore Department of Statistics (Population Trends 2026;
General Household Survey 2025) and Ministry of Manpower (Labour Force in Singapore 2025). Each is listed
with its ID, period and address in `data/singstat/SOURCES.md`, and the downloaded tables are kept in
`data/singstat/raw`.

**In the code.** `data/singstat/build.py` compiles the tables into `agents/population-data.json`;
`agents/population.js` draws every persona from it. `tests/test_agents.js` holds a large sample to the
tables.

**Status.** **Anchored**, with the joining assumptions stated in SOURCES.md. The number of people in each
age band and industry remains the scenario's. Savings, ability to emigrate and temperament are
**Placeholder**: no official table measures them, and no representative Big Five survey of Singapore
residents was found.

---

## 8. Outstanding work

1. **Verify every citation above.** Nothing here has been checked against
   a source.
2. **Replace the trait table** (`engine/traits.js`) with draws from
   published Big Five population norms.
3. **Source the action consequence coefficients** in
   `engine/action_space.js`, or state in the write-up that they are
   order-of-magnitude judgements.
4. **Cite an elasticity** for energy demand. The scarcity mechanism has
   shipped without one, and its five coefficients are all Placeholder.
5. ~~Decide whether contribution credit rewards contribution or
   conformity.~~ **Decided: contribution.** `obey` and `endure` earn
   nothing; `flourish` and `mutual_aid` earn fully. A scheme paying for
   obedience would be a different political object.
6. **Fit the crowding-out coefficients** (`RECRUIT`, `SATURATION`,
   `DISPLACE`) to a published elasticity, or state in the write-up that
   the peak at 28% is a shape, not a measurement.
7. **Replace the demographic extrapolation** past round 12 with a real
   long-horizon projection if one exists for the scenario.

---

## Adding to this file

When you add a lever, a coefficient, or a threshold, add its entry here in
the same round — not afterwards. An entry that says
**Placeholder — invented, needs replacing** is a perfectly good entry. An
undocumented number is not, because the first person to ask "why 0.35?"
in a judging room will be someone who already knows the answer should
exist.
