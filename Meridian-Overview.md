# Meridian: A Simulator for Governing a Country After the Work Is Done

*An introduction for a technical reader who has not seen the project before.*

Trusted Hub · Temasek Polytechnic · ITE

---

## 1. What Meridian is, in one paragraph

Meridian is a simulation of Singapore in 2050, after agentic AI has taken over most routine cognitive and physical work. Teams of four to five students (mixed Temasek Polytechnic and ITE) build an automated government for it. The government reads the state of the country, sets policy, and then runs unattended while everyone watches the results. The simulator is a teaching and testing instrument. It is built so that students *discover* why a boom economy can fail its own citizens, instead of being told.

The thesis fits in one sentence: **the society with the highest UBI does not win.**

## 2. The scenario

Agentic AI can do most routine work. Productivity climbs and employment falls. These are the same event.

Your team governs a city-state of 5.9 million people. The population is ageing quickly (the over-65 share rises from 28% to 35%), almost all food is imported, and there are no natural resources except the ones the country builds.

You are not scored on how much wealth your AI economy produces. You are scored on how much of it reaches citizens, and whether it keeps reaching them.

The world has:

- **13 sectors**, shaped like Singapore's real economy: Healthcare, Care Services, Education and Research, Transport and Logistics, Energy and Utilities, Compute and Telecom, Housing and Construction, Food and Agri, Manufacturing, Finance, Retail and Commerce, Public Administration, Public Safety. There is no mining, because Singapore has none; raw-material dependence shows up as import exposure instead.
- **Energy and Compute as separate sectors.** A power grid takes a decade to build. A data network automates faster than anything else. Merged, the AI-versus-energy question is invisible.
- **Public Administration as a sector**, so a government can watch its own capacity to govern degrade.
- **Households** that age and respond to what the country does. Four are written up in detail, such as Mdm Tan Ah Choo, a 68-year-old retired cleaner. The population in the agent simulation is a weighted set of 12 cohorts, from a retired cleaner in the 12th income percentile to an owner of automated capital.
- **Demography that happens regardless.** The population falls from 5.94 million to 5.52 million over the original twelve rounds. Care demand rises while the working-age base shrinks.

## 3. The core idea: an economic loop that eats itself

Everything in the simulator is downstream of one loop:

1. Automation removes wages from the cost of output.
2. Profit rises and is taxed. Wage-tax and GST revenue shrink.
3. Tax revenue funds UBI and public services.
4. UBI becomes household income, standing in for the lost wages.
5. Household income becomes consumption.
6. Consumption is the demand firms sell into, which is the profit base the state was taxing.

Go round the ring enough times and the boom undermines the base that funds it. UBI rises for several rounds and then falls off a cliff.

**The cliff is not a rule.** Nothing in the engine says "punish automation". The engine does bookkeeping, and the collapse comes out of one line:

```js
const output = Math.min(capacityAbs, demand);   // THE CLIFF
```

Output is *sold*, not merely made. Every automation decision eventually returns to this line as lower demand.

Four non-obvious consequences:

- **The tax base has four legs, and automation hits two of them.** Revenue comes from corporate profit, a compute levy, tax on the wage bill, and GST on consumption. Automation raises the first and collapses the third and fourth. Corporate receipts can climb while total revenue falls.
- **Obligations come off the top.** Reskilling, the care job guarantee and the losses of loss-making essential services are paid before the allocation split. A society can hold its UBI lever still and still watch UBI fall, because the pot shrank.
- **Tax has a second edge.** Profit that is not taken is reinvested, and reinvestment stops the capital stock depreciating. Tax hard and you collect more now and less later.
- **Infrastructure is not decoration.** It maintains capital as well as service quality. Starve it to fund payouts and the economy that funds the payouts physically shrinks.

## 4. The architecture: three populations and one frozen engine

| Part | What it is |
|---|---|
| **The engine (kernel)** | `step(state, levers, shocks, exogenous) → next state`. Deterministic, published so students can read it, and reimplemented in Python alongside the JavaScript version. A parity test asserts that the two agree field by field, including every agent channel and policy verb. |
| **The citizens** | Twelve cohorts of residents. They do not just have feelings; they *decide* what to do, and what they decide changes the country. |
| **The industries** | Thirteen sector agents, each optimising what its industry is *for*. The government's automation lever is a **ceiling**, not a target: a state can forbid, tax and subsidise, but cannot compel a firm to invest. |
| **The harness (what teams build)** | A government that reads the world and sets the levers. |

The rule that holds it together: **semantic inside, deterministic at the boundary.** Anything inside a government may be language: prompts, agent roles, a cabinet that argues. What leaves is a validated lever vector fed into the same frozen engine every team runs.

### The nine levers

| Lever | Range | Trade-off |
|---|---|---|
| AI adoption (per sector) | 0–98% | Productivity vs displacement vs compute cost |
| Corporate tax rate | 0–45% | Revenue now vs reinvestment later |
| Compute levy | 0–30% | Taxes automation directly, slows adoption |
| Allocation split | sums to 100% | UBI vs infrastructure vs reserves |
| UBI design | flat / means-tested / age-weighted | Universality vs targeting efficiency |
| Reskilling spend | 0–30% of budget | Pays off after about 3 rounds, costs now |
| Public ownership of automated capital | 0–50% | Dividend income vs firm resistance |
| Working week | 5 / 4 / 3 days | Spreads remaining work, cuts output |
| Care job guarantee | on/off, wage level | Meaningful work, runs at a loss |

Automation is not uniform. Each sector has a tolerance beyond which quality suffers: Care Services about 30%, Education 42%, Healthcare 58%, Finance 95%. Public ownership is the most leveraged lever on the board.

## 5. What is new: agents decide, the kernel computes

This is the largest recent change. Every choice a person or organisation makes is now made by an LLM agent. The engine is reduced to a kernel of physics and accounting.

| Stays deterministic (kernel) | Decided by agents |
|---|---|
| Market clearing, prices and inflation, the budget, capital wearing out, grid capacity, ageing | How much households spend and save, whether people work, strikes, protests, mutual aid, organisations, emigration, births, firm prices, wages, hiring and investment, government policy, trust and belonging |

Each round follows a **reason → route → action** pipeline, adapted from AgentSociety:

1. **Reason.** A weighted population of residents (from 40 to over 1,000) each perceive their own life and decide, in their own words.
2. **Route.** A deterministic router works out what those words mean, checks they are possible, and totals them by who actually took part. A strike withholds the labour of the people actually striking.
3. **Action.** The kernel clears markets and posts the accounts.

Round N+1 is now a function of what people chose in round N. Previously a population that struck and one that quietly seethed produced an identical country, because the only channel from society to the engine was a single "civic unrest" number. A comparison mode (`--compare`) runs the same government twice, with and without society's decisions reaching the engine, and reports where they diverge.

### Citizens and firms

- **Twelve behaviours**, based on Hirschman's exit, voice and loyalty, plus two he does not cover, `flourish` and `mutual_aid`. A strike removes capacity from the sectors strikers work in. Mutual aid *adds* capacity to care, health and food. Mobile residents emigrate and take their headcount with them, and each wave leaves fewer who can follow.
- **Open-ended actions.** Residents can describe what they do in their own words, with no menu. An **interpreter** decides what one ordinary person doing that action actually does, using a fixed vocabulary of effects the kernel can compute. The interpreter is *blind* (it sees only the words, never the team, levers or score), caches each answer so repeats cost nothing, and charges each action's cost against a person's real free time and income. Organisers can review and correct any interpretation. The report marks behaviours nobody anticipated as **novel**.
- **Firms.** Several firms per industry (incumbent, co-operative, state-owned, start-up, multinational) set their own prices and wages and compete for market share. Each industry is judged against its own mission. For example, Care Services leads on humanity, Energy on reliability, and Finance on whether capital reaches the economy, not on margin. These scorecards are authored in the repository, not chosen by the agents.
- **Blindfolds.** Citizens see the queue at the clinic, never the tax rate. Firms see the tax they pay and the prices they face, but not the treasury, the score or the citizen feed. This is enforced in code (`assertBlind`) and tested over full runs, not left to prompt wording.

### Institutions: adopting what the society invents

A behaviour the report flags as novel (a repair café, a tool library, food sold from home kitchens) can be made part of the country. For each one the team chooses what the state does:

| Adoption | Effect |
|---|---|
| **Fund it** | The state pays, so capacity arrives whether or not anyone volunteers. |
| **Licence it** | The work continues but stops escaping tax. |
| **Make it easier** | Premises, equipment or time, so each person is charged less and the same hours deliver more. |
| **Endorse it** | A public announcement that residents read. |

Adopted institutions are visible to residents and firms, so they change what people decide as well as what the arithmetic produces. A team cannot change what a behaviour *means*, because the interpreter is global. That keeps two teams' runs comparable.

### Growth and scarcity are modelled, not assumed

- **Bass diffusion**: AI adoption follows an S-curve.
- **Productivity J-curve**: automation costs output before it pays.
- **Learning curve**: compute gets cheaper with cumulative use, which is why AI compounds.
- **Per-sector capital**: a profitable sector outgrows a failing one.
- **Scarcity forms a price.** Automation drives compute and energy demand, and that demand becomes a price that reaches households and the cost of running automated capital.

| Policy | Grid tightness | Price | Purchasing power |
|---|---|---|---|
| Hold at baseline | 1.04 | 1.23 | 45 |
| Automate everything *but* energy | 2.82 | 6.0 | 1 |
| Automate *only* energy | 0.66 | 0.68 | 66 |

There are three ways out, with different time constants: build (slow), import (fast, but creates dependency), throttle.

### Runs are open-ended

The twelve-round cap is gone. A run continues until the society collapses, stalls or hits a backstop, and reports **by decade** with a survival time. Teams can choose a run length from 4 to 240 years, and **Stop and keep** ends a run early while still writing the evidence. Per-decade reporting matters because an overall score averages away a catastrophe that arrives late.

### Contribution credit, with crowding-out

Prosocial acts can earn credit that buys non-essentials. The response **peaks at 28% generosity and turns harmful above 71%**, because paying for gifts turns them into transactions (Titmuss; Deci, Koestner and Ryan; Gneezy and Rustichini). A team that maximises the lever does worse than one that finds the peak.

## 6. How a team builds a government

A harness is a function: `harness(ctx) → { levers, rationale, … }`. There are several ways to write one, and the engine cannot tell them apart:

- **A form in the setup page**, which writes the rules for you.
- **Policy rules as data**: `when <condition>, then shift / nudge / set`. Rules run the same way in the browser trial and in server-side agent runs.
- **A harness in JavaScript.**
- **A model briefing** (who is governing, doctrine, what wins in a conflict, how to trade). One model decision-maker reads it each round, after first reading what the agent society did last round: reported trust and belonging, what people did, who left, and the most-heard voices. Its calls go through the run's model pool and are written to the decision log, so the run replays exactly.

### The constitution

Each team writes a constitution in two halves that must agree:

- **Prose commitments**, read by judges.
- **Checkable rules**, read by a machine, for example `worstEssential >= 50`. Markdown constitutions can carry these in a fenced `rule` block beneath the clause they test.

The simulation compiles the prose into policies in a six-verb grammar (tax, transfer, regulate, provide, institution, announce). Anything that cannot be compiled is reported back with the reason. A rule that names a field that does not exist is flagged as malformed, not counted as a breach.

A bug fixed during this work shows why it matters: the scorer used to read only a numeric constitution block that markdown constitutions never carry, so every prose-authored team collected all 15 fidelity marks unconditionally. With the fix, identical economy and identical levers, differing only in the written promise, scored **61 with 15/15 versus 57 with 10.8/15**.

### Pages

| Page | Purpose |
|---|---|
| `/setup` | All settings in six sections (economy, AI adoption, government, constitution, your case, trade), each with Save and Discard. |
| `/sim` | The simulation itself: the city as an architectural model, a timeline, what happened each year. *Trial* shows the physics of saved settings. *Agent run* runs the society. |
| `/feed` | What people say, year by year, including government statements and people leaving. |
| `/market` | Offers, messages and the hand-in bundle. |
| `/reports` | Every run, with Open report, PDF, Report data and Full record. |
| `/admin` | Organisers only: fire events live, edit what actions mean, the round clock. |

## 7. Trust, fairness and audit

An LLM government cannot be re-run identically. That is acceptable, because the pieces that need to be exact are exact.

- **Replay.** Every run saves a trace, a decision log and the interpretations used. The decision log replays the run exactly with no model, and the engine replays a trace to a bit-identical trajectory.
- **Fairness when runs vary.** Every team gets identical seeds and events, and final results are reported across five seeds. Variance is a result: a government scoring 82 ± 3 beats one scoring 84 ± 19.
- **Fault tolerance.** Out-of-range levers are clamped. Illegal values are rejected and the previous levers held. Every fault is logged and counted.
- **Model calibration.** Before an assessed run, the model must pass a five-check behavioural calibration. The studio's sliders are a clearly labelled trial space, and the results that count come from agent runs.
- **Honest labelling.** If the model is not available, a run refuses to start rather than pretend. The `decidedBy` field reports what actually decided each round, so a run that fell back to arithmetic cannot claim to be agent-decided.
- **Parity.** The engine is implemented twice (JavaScript and Python) and every field agrees, so the physics were not tuned to make a demo look good.
- **Organiser control.** Organisers can fire events live (typhoon, energy crisis, civil conflict, trade embargo and more), invent their own, have the model draft one for approval, target one team or all, and switch on seeded unannounced weather.

## 8. Goals

1. **Find the cliff.** Show where automation-led growth undermines the demand that funds its own payouts, and what moves that point.
2. **Measure what reaches people.** Judge purchasing power, the worst essential service and cohesion, not output.
3. **Make values checkable.** Turn a constitution into rules a machine can audit, and show where commitments are broken. Most teams find that writing the rule changes the commitment.
4. **Test whether clear reasoning governs better.** The engine cannot read, so a better-briefed government wins only by making better decisions. That is the claim the Thinkathon tests.
5. **Show failure arriving late.** The decisions behind a collapse are taken rounds before it is visible. Open-ended runs and per-decade reporting are meant to expose this.
6. **Produce evidence, not a verdict.** Teams weight a guiding rubric (social welfare, continuity of survival, quality of life, economic profitability) and argue their case. The simulation reports the trajectory, fixed industry KPIs, what people reported and did, the market, the government's record, events and voices. The older Societal Resilience Index survives only as one reference figure.

## 9. What has been learned so far

**Taxing automation works, but only if firms can decline to automate.** Same government, 90% automation permitted everywhere and taxed hard:

| | Mean automation | Employment | Score |
|---|---|---|---|
| Firms obey the lever | 0.88 | 6% | 0 |
| Firms may decline | 0.68 | 33% | 63 |

When the lever was a target, the tax slowed the inevitable and the economy collapsed anyway.

**The "resilient" preset is not resilient.** Run open-ended, it survives 34 years while decaying steadily, collapsing from about 2080. At twelve rounds it looks fine. A five-day week extends survival to 48 years, but the shorter week costs output once energy is scarce.

**The richest society loses.** In the original twelve-round engine, a "boom" society paid 60% more cash than a "resilient" one but, once the services that cash must buy around are counted, gave citizens the same standard of living (effective purchasing power 116 against 114). It had a quarter of the employment and a care system at quality 42. It scored 73 against 82.

**Failure arrives long after its cause.** The doom-loop scenario scored 76 at round 7, which looks mid-table, then fell to 15 by round 12. Its causes were set by round 4.

**Highest headline UBI, last place.** The Accelerate reference government automates everything, posts the highest headline UBI in the field, and finishes about seventy points behind, because it breaches hard gates even when nothing goes wrong.

| Reference | Fair weather | Pandemic | Supply squeeze |
|---|---|---|---|
| Accelerate | 3 | 3 | 3 |
| Guardian | 72 | 65 | 57 |
| Steward | 74 | 61 | 56 |

Steward does well partly because it watches the grid and acts as it tightens.

**Contribution schemes fail when they are most needed.** In a collapsing society a credit scheme can lock out most people, because nobody has anything spare to contribute.

## 10. Trade between societies

Every team's society can run on one clock in a shared world and trade five resources: compute, energy, food, skilled labour and sovereign credits. There are three contract types (spot, forward and aid), a published reputation score that gates the forward market below 40, caps on how much of a surplus can leave, and a public ledger. A forward is a promise about a future you do not control: a shock can arrive between signing and delivery, and the engine records which commitment you chose. Negotiation can be in prose, but only the contract object settles.

## 11. Honest limits

The project states its weaknesses openly, and these are the main ones:

- **Small local models are docile and uniform.** In testing, a 7B model wrote valid decisions every time, but most residents chose the same things. Calibrate and use a larger model before drawing conclusions.
- **Many coefficients are placeholders**, labelled as such: the trait table, action consequences, scarcity constants, the crowding-out curve and firm thresholds.
- **Citations are unverified.** The works in `docs/EVIDENCE.md` are real, but authors, years and journals were written from memory.
- **Sub-steps are social, not economic.** The economy still clears once per two-year round.
- **Reskilling barely changes outcomes yet**, although the brief promises a payoff.
- **`equity` is a proxy**, because the engine has no per-cohort access figure.
- **The studio recomputes from 2050** when a lever moves instead of continuing mid-run.
- **LM Studio struggles under agent load.** A batching server is the real answer.

The `docs/EVIDENCE.md` file records, for every behavioural claim, its source, the number it sets, and whether that number is evidenced, anchored, calibrated, reasoned or a placeholder.

## 12. The takeaway

The society with the highest UBI will not be the society that wins. The simulator exists so that teams work out why, with evidence, before they write their constitution.

---

*Sources: `README.md`, `thinkathon-simulation-spec.md` (v3.5), `DEMO.md`, `engine/README.md`, `agents/README.md` and `agents/institutions.js` in this project.*
