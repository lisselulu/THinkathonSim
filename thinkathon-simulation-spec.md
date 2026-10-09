# The Meridian Simulation
### A Thinkathon on AI, work, and what comes after
Trusted Hub · Temasek Polytechnic · ITE

*Version 3.5 — the round clock. Supersedes v3.4.*

---

# Part I — The brief

## 1. Premise

**Singapore, 2050. The work is done. Now what?**

Agentic AI can perform most routine cognitive and physical labour. Your team governs a city-state of 5.9 million people with a rapidly ageing population, near-total food import dependency, and no natural resources except the ones it builds.

Productivity is climbing. Employment is falling. These are the same event.

You are not scored on how much wealth your AI economy produces. You are scored on how much of it reaches your citizens, and whether it keeps reaching them.

## 2. What you are actually building

Not a policy paper. Not a slide deck. **A government that runs without you.**

By the end of the fortnight your team hands over a **harness** — an agent system that reads the state of the country each round and decides what to do about it — and that harness governs Meridian for twelve rounds, twenty-four simulated years, unattended, while everyone watches.

The society it produces is your deliverable. Its citizens, its services, its solvency in 2074, and the argument for why you built it that way.

Five things are handed in:

| | |
|---|---|
| **The harness** | Code and prompts. The government itself. |
| **The constitution** | Sealed in week one. Prose commitments, plus rules precise enough for a machine to check. |
| **The trace** | Twelve rows of nine numbers — every decision your government made, replayable by anyone. |
| **The society** | The trajectory those decisions produced. The city at 2074. The households in it. |
| **The account** | Why. Including where you departed from your own constitution, and whether you can defend it. |

## 3. The four phases

| Phase | Days | Shape | Gate |
|---|---|---|---|
| **1 · Discovery** | 1–3 | Wide open. No deliverable but understanding. | A findings memo: three things about this world that are not in the brief. |
| **2 · Definition** | 4–5 | Narrowing, hard. | Problem statement, method declaration, and the sealed constitution. |
| **3 · Development** | 6–10 | Open again — build, break, rebuild. | A harness that survives twelve rounds unattended and clears the qualifying bar. |
| **4 · Delivery** | 11–14 | Closed. Judged. | The scored run, the tournament, the pitch. |

The shape matters. Phase 1 is deliberately unconstrained because the interesting things in this world are not signposted, and a team that starts building on day 1 will build the obvious thing. Phase 2 is deliberately brutal because a team that has not narrowed by day 5 will spend the fortnight producing a demo instead of a government.

---

# Part II — The world

## 4. Thirteen sectors

Healthcare · Care Services · Education & Research · Transport & Logistics · Energy & Utilities · Compute & Telecom · Housing & Construction · Food & Agri · Manufacturing · Finance · Retail & Commerce · Public Administration · Public Safety.

They are chosen to cover what a real city-state actually runs on, and they are Singapore-shaped rather than generic: there is no extraction or mining, because there is none to have, and raw-material dependence shows up instead as import exposure. **Manufacturing** is roughly a fifth of output and was simply missing before. **Energy and Compute are separate**, because a power grid and a data network behave nothing alike — one is a physical constraint that takes a decade to build, the other automates faster than anything else in the economy, and the whole AI-and-energy question is invisible while they are one sector. **Public Administration** is the state's own capacity, so a government can watch its ability to govern degrade.

Each carries five numbers: **automation** (share of output produced without human labour), **headcount** (people employed — the wage channel), **capacity** (output relative to demand; below 1.0 means unmet need), **quality** (0–100 service level), and **margin** (operating profit).

Eleven of the thirteen are **essential**. Finance and Manufacturing are not — losing either is an economic disaster rather than a survival one. Essential sectors are what the "worst service" score and the quality fail gate are measured on, and an essential sector that loses money does not close — the state covers the loss out of the same budget the UBI comes from.

Compute & Energy is a sector because AI is not free. Every point of automation has a bill attached, and that bill arrives as demand on Compute & Energy. Automate the whole economy without building the compute to run it and the sector that powers everything else is the first to fail.

**Rounds and years.** Each round covers two years. Round *N* opens in 2048 + 2*N*: round 1 runs 2050–2052, round 12 runs 2072–2074. The engine labels each round by its opening year. The run spans 2050 to 2074.

**The population.** 5.94 million at round 1, falling to 5.52 million by round 12, with the over-65 share rising from 28% to 35%. This is exogenous — not a lever, and it happens whatever you do. Demand for care and healthcare climbs every round while the working-age base that could staff it falls every round.

Working-age citizens are split into three AI-exposure bands. Unlike the age bands, **exposure is endogenous** — reskilling spend moves people from high exposure to low, on a three-round lag.

**The forty households.** The same forty in every society, which is what makes cross-team comparison mean anything. They age two years per round. Four you will come to know well: Mdm Tan Ah Choo, 68, retired cleaner. Rahim bin Yusof, 34, logistics coordinator. Nurul Aisyah, 22, ITE graduate. Sister Grace Lim, 45, nurse.

Household wellbeing is computed by the engine, not written by an agent. Your household-voice agents render Mdm Tan's round in first person however they like. They do not get to change her number, and her number is what the auditor sees.

## 5. The economic loop

Read this before you look at the levers. Everything else is downstream of it.

```
   AI adoption
        ↓
   Output & profit  →  Tax revenue  →  Allocation split
        ↑                                     ↓
   Consumption  ←  Household income  ←  Services & UBI
```

Automation raises profit by removing wages. Profit is taxed. Tax funds UBI and services. UBI becomes household income. Household income becomes consumption. **Consumption is the demand that generates the profit you were taxing.**

Remove enough wages and you eventually remove the profit base funding the transfer that replaced them. The UBI rises for several rounds, then falls off a cliff. Discovering where that cliff sits is what this Thinkathon is for.

**The cliff is not a rule.** Nothing in the engine says "punish automation". The engine does bookkeeping, and one line of it produces everything above:

```js
const output = Math.min(capacityAbs, demand);   // THE CLIFF
```

Output is **sold**, not merely made. Every automation decision eventually arrives back at this line as a smaller `demand`.

### Four things that are not obvious

**Your tax base has four legs, and automation kicks two of them.** Revenue comes from corporate profit, a compute levy, **tax on the wage bill**, and **GST on consumption**. Automation raises the first and collapses the third and fourth simultaneously. Corporate receipts can climb while total revenue falls.

**Obligations come off the top.** Before your allocation split touches anything, the budget pays reskilling, the care job guarantee, and the losses of every loss-making essential service. Only what survives is yours to divide. A society can hold its allocation lever still for twelve rounds and still watch its UBI fall — the lever didn't move, the numerator shrank.

**Tax has a second edge.** Profit you do not take is profit firms reinvest, and reinvestment is what stops the capital stock depreciating. Tax hard and you collect more now and have less to collect from later. The compute levy bites the same way, and additionally caps how fast you *can* adopt automation.

**Infrastructure is not decoration.** It maintains the capital stock as well as service quality. A quarter of that stock is public whoever owns the firms. Starve infrastructure to fund cash payouts and the economy that funds the payouts physically shrinks.

## 6. Your controls

| Lever | Range | The trade-off |
|---|---|---|
| AI adoption (per sector) | 0–98% | Productivity vs displacement vs compute cost |
| Corporate tax rate | 0–45% | Revenue now vs firms' capacity to reinvest |
| Compute levy | 0–30% | Taxes automation directly, slows adoption |
| Allocation split | sums to 100% | UBI vs infrastructure vs reserves |
| UBI design | flat / means-tested / age-weighted | Universality vs targeting efficiency |
| Reskilling spend | 0–30% of budget | Pays off in 3 rounds, costs now |
| Public ownership of automated capital | 0–50% | Dividend income vs firm resistance |
| Working week | 5 / 4 / 3 days | Spreads remaining work, cuts output |
| Care job guarantee | on/off, wage level | Creates meaningful work, runs at a loss |

**Automation is not uniform.** Each sector has a tolerance beyond which automation damages service quality, proportional to how much the service *is* the human contact. Care Services tolerates 30% and is punished hardest past it. Education 42%. Healthcare 58%. Finance tolerates 95% and is barely scratched. Automating retail and finance is nearly free in quality terms. Automating care is not.

**Public ownership** is the most leveraged control on the board. A society that owns a share of the machines has revenue that does not depend on taxing a shrinking profit base, and capital maintained from the infrastructure vote rather than from profit it has just taxed away. Taking the boom scenario's public ownership from 9% to 50%, changing nothing else, moves its score from **73 to 89**.

**Irreversibility.** Automate past 80% and re-employing humans there is slowed sharply. Reskilling buys back some of that optionality, not all of it, and not quickly.

## 7. Shocks

**Scheduled** — every society, same rounds. A demographic milestone at round 3. A model capability breakthrough at round 5 that raises automation ceilings and forces a decision about whether to take the productivity.

**Drawn** — the facilitator's deck. You will not know which, or when.

| Shock | What it does |
|---|---|
| Respiratory pandemic | Healthcare and care demand spike; retail and transport collapse |
| Food import disruption | Food capacity to 55%; import prices +22%, which cuts *real* UBI |
| Energy price spike | Compute capacity cut; compute prices +45% |
| Chip export controls | Compute capacity to 72%; **automation ceilings drop 10 points**; prices +60% |
| Infrastructure cyber attack | Finance, housing and public safety quality fall; legitimacy hit |

**Endogenous** — triggered by your own state, armed one round before they fire. Civil unrest below cohesion 35. Fiscal crisis when reserves stay negative. Service failure cascade when any essential sector drops below quality 40.

These compound, and the compounding is what kills societies. In the doom-loop scenario the cascade arms at round 7 and fires from round 8, unrest joins at round 11, and together they take GDP down **9.7% in a single round**.

## 8. Trade

Societies do not run alone. Every team's harness governs its own copy of Meridian, all of them on one clock, and between ticks they trade with each other.

**Five resources**, each drawn from a distinct part of your world state, so selling something always costs you the thing you sold:

| Resource | Comes from | Note |
|---|---|---|
| Compute | Compute & Energy capacity above domestic need | The thing every automated economy is short of |
| Energy | Housing & Utilities capacity above need | |
| Food | Food & Agri capacity above need | Scarce for everyone at once when a shock lands |
| Skilled labour | Unemployed low-exposure workers | Borrowed hands staff the buyer's care sector and draw its wages |
| Sovereign credits | Reserves above a $20bn floor | The money. Can be **given**, never sold |

**Three contract types.** *Spot* settles at the end of the round it is accepted. *Forward* delivers in 1–6 rounds at agreed terms. *Aid* is unilateral — no acceptance needed, no price; it costs the giver the goods and raises their legitimacy and the receiver's cohesion.

**The clock.** A round has two phases. Everyone proposes; then everyone answers what is on the table, including offers made moments earlier. The deal settles in that same round's tick, so **goods and money move in the round the deal was struck**, not the round after.

This matters more than it sounds. An offer answered a round later is answered against a world that has moved — and in practice that meant most deals died of staleness before anyone could take them.

**What you may sell.** Not only your excess. A society may sell down to **90% of its own demand**, and the 25% cap limits how fast. Selling below that floor is not available: you cannot export what you are already short of. An economy running at exactly the capacity it needs would otherwise have nothing to trade at all, which is very nearly what happens in practice.

**Negotiate in prose, settle on the object.** Harnesses broadcast messages and send directed ones. The market never reads a word of it — it only executes contracts. **If your prose and your offer object disagree, the object wins.**

**A forward is a promise about a future you do not control.** You sign in round 4 to deliver food in round 7; a shock lands in round 6; now your own citizens and your word are asking for the same goods. The engine does not resolve that for you. It records which one you chose and prices it for three rounds.

**Two kinds of failure, and the market tells them apart.** A *spot* that cannot be backed on the day is a deal that did not clear — your surplus moved in the one round between offering and settling, nobody promised anything, and it costs 5 reputation. A *forward* you cannot honour is a **default**: 25 reputation, the escrowed payment returns to the buyer, and they take a cohesion hit for the disruption.

**Reputation** starts at 50, is published, and does two concrete things. It multiplies what a seller actually receives (0.8× at zero, 1.2× at a hundred). And below 40 the **forward market closes to you entirely** — nobody sells you a promise on credit when your promises have not been good. It recovers 9 a round, so one default is paid off in exactly three.

**Guardrails.** No more than 25% of any surplus leaves per round, plus a hard ceiling of 3% of the workforce on labour — a city-state does not lend out a tenth of its people however many the machines have idled. Every contract, delivery, default and gift appears on a public ledger visible to all societies.

```bash
node engine/run-market.js --asymmetric --ledger
```

The asymmetric run is the one worth watching: a different shock lands on each society, which is the strongest argument for trade there is.

**Swaps.** An offer may ask for goods instead of money — *four compute for three food*. Both legs settle together or neither does, so a swap cannot be half-taken the way two separate cash deals can. Credits are the money and may be given as aid but never swapped.

---

# Part III — The four phases

## 9. Phase 1 — Discovery (days 1–3)

**Nothing is due. Do not start building.**

The purpose of these three days is to find out what is actually true about this world, and the reason it is unconstrained is that the interesting facts are not signposted. A team that starts building on day 1 builds the obvious thing, and the obvious thing is a society that automates hard, pays a big UBI, and collapses in round 8 without ever understanding why.

**What to do:** open the Policy Lab and break things. Move one lever at a time and watch all twelve rounds redraw. Load the four presets and ask why they differ. Run `node engine/calibrate.js` and read four philosophies of government as trajectories. Read the engine source — it is a thousand commented lines and it is not a black box.

**Questions worth chasing.** Not a checklist, and not exhaustive — the point is to find your own:

- Where exactly does the cliff sit, and what moves it?
- Why does the highest-UBI society lose?
- What happens to Compute & Energy when everything else automates?
- Which lever, moved alone, changes the score most? Does that surprise you?
- Can you build a society with *high* employment in 2074? What did it cost?
- What does a 45% corporate tax rate do by round 10 that it doesn't do by round 4?
- Is there a shock that no amount of good policy survives?

**Gate — the findings memo.** One page. **Three things you discovered about this world that are not written in this brief**, each with the evidence that convinced you. Teams that submit three restatements of section 5 have not done phase 1 and will be sent back to it.

## 10. Phase 2 — Definition (days 4–5)

**Now narrow, and narrow hard.**

You cannot govern everything. Two days to decide what your society is *for*, and to state it precisely enough to be held to.

**Gate 1 — the problem statement.** One paragraph. Which specific failure of the post-work economy are you attacking? "Making a good society" is not a problem statement. "Care demand rises 17% while the working-age base falls 17%, and no purely fiscal instrument closes that gap" is.

**Gate 2 — the method declaration.** One paragraph. What kind of government are you building, and why does that shape suit your problem? A single reasoning agent? A cabinet that argues? A rule engine with a model only for the hard calls? A model that rewrites its own operating doctrine each round? There is no right answer, and the answer constrains everything in phase 3.

**Gate 3 — the constitution.** Sealed. This is the hardest hour of the fortnight, because it has two halves that must agree.

The **commitments** are prose — what your society is for, three non-negotiable promises, and your theory of how AI wealth reaches people. Judges read these.

The **rules** are the same commitments stated precisely enough that a machine can check them every round. The auditor reads these.

```json
{
  "name": "The Guardian Compact",
  "commitments": [
    "No essential service is allowed to fail. Ever, and for any reason.",
    "Care and education are never automated past the point where the person delivering them is the service.",
    "The public owns a meaningful share of the machines that replaced its wages."
  ],
  "rules": [
    { "id": "no-service-failure", "commitment": 0, "when": "round > 2",
      "assert": "worstEssential >= 55" },
    { "id": "care-cap",           "commitment": 1, "when": "always",
      "assert": "levers.automation_target.care_services <= 0.25" },
    { "id": "public-share",       "commitment": 2, "when": "round > 3",
      "assert": "levers.public_ownership_pct >= 0.30" }
  ]
}
```

**This is the exercise.** Most teams find that writing the rule changes the commitment — you discover that "no service is allowed to fail" means nothing until you say at what number, from which round, and whether a shock excuses you. Values that cannot survive being written precisely were not values, they were moods.

You seal this before you know what shocks are coming. It is worth fifteen marks, and you will be asked at judging whether you held the line — and if you broke it, whether you can justify why.

## 11. Phase 3 — Development (days 6–10)

**Open again. Build, break, rebuild.**

Five days to turn the constitution into a government that runs without you. Part IV is the whole of how.

**Days 6–7 — first working harness.** It does not need to be good. It needs to complete twelve rounds without a human touching it. A rule-based harness that beats nothing is worth more on day 7 than a beautiful prompt that has never run.

**Days 8–9 — iterate against the lab.** Run your harness against every shock schedule you can invent. Find the one that breaks it. Fix it. Find the next one. This is the loop that produces a government rather than a demo.

Then open the market. A harness that governs well alone is not the same as one that can hold a position across a table, and the asymmetric run — a different shock on each society — is where the difference shows.

**Day 10 — scrimmage.** An unscored tournament against the reference harnesses and the other teams. You will discover that your harness has been quietly overfitted to the shocks you happened to test, which is exactly what the scrimmage is for.

**Gate — qualification.** Your harness must, unattended:

1. Complete twelve rounds under three shock schedules you have not seen.
2. Produce a trace that replays to a bit-identical trajectory.
3. Beat the **Accelerate** reference harness. This is a low bar on purpose — Accelerate breaches gates under every schedule and scores 15. A harness that cannot beat it is not yet a government.
4. Log fewer than three faults per run. A government that regularly fails to make itself understood is a finding about your harness, not about the world.

## 12. Phase 4 — Delivery (days 11–14)

**Days 11–12 — the scored run.** The clock runs. A round is two simulated years and, by
default, **two hours of wall clock** — one simulated year an hour, which puts the whole run at
twenty-four hours of event time and about three rounds a day. The facilitator sets the length
and starts it; from then on **time passes whether a team is ready or not.**

That is the point. A forward you signed at ten comes due at two, and no amount of deliberation
buys you out of it. Every screen in the room counts down to the same tick. Your harness governs; you watch. Public policy summit after round 4, crisis summit after round 8 — two minutes per team, defending your position to the room.

You may intervene. Every human override is logged in the trace and disclosed at judging. A society that needed to be rescued four times is a different deliverable from one that did not, and the judges will treat it as such.

**Day 13 — the tournament.** Every harness runs the same schedules. Standings, cross-play, and the constitutional audit. Section 15.

**Day 14 — pitch and judging.** Present the society you built: the trajectory, the city in 2074, the households, the argument. Then the question everyone gets asked — *where did you break your own constitution, and were you right to?*

**Team roles (4–5 students, mixed TP and ITE):** Chancellor (owns the harness's final decision logic) · Treasurer (fiscal model and lever strategy) · Sector Chief (operator agents) · Storyteller (personas, news, pitch) · Systems Engineer (harness plumbing, traces, tournament submissions).

---

# Part IV — Building a government

## 13. Harness engineering

Here is the rule that makes this work:

> **The engine is frozen and numeric. The government is yours and may be entirely semantic. They meet at exactly one interface, and that interface is nine numbers.**

A harness is a function:

```js
harness(ctx) -> { levers, rationale, invokes }
```

`ctx` carries the world state, the history, this round's bulletin, the opposition's challenge, your constitution, the levers currently in force and — in a shared world — the market: your surplus, your export caps, every other society's public headline and shelf, the offers on your table, the open contracts and the public ledger.

What comes back is a lever vector, and optionally trade instructions:

```js
{
  levers:    { ... },                       // the nine numbers
  rationale: 'why, for the judges',
  offers:    [ { to: 'Team B', resource: 'food', quantity: 4,
                 price: 5, type: 'forward', deliver_in: 2 } ],
  responses: { 'TeamB-r4-xk29': 'accept' },  // answering what is on your table
  message:   'We are short of compute and will pay above the rate.'
}
```

The offers and responses are objects; the message is prose. Only the objects settle.

**Everything inside may be language.** Prompts, agent roles, operating doctrine, escalation rules, the argument between your Treasury agent and your Opposition agent, a debate that runs three turns before anyone commits. The engine never sees a word of it.

**What leaves is nine numbers.** Deterministic, validated, clamped to legal ranges, fed to the same frozen engine every other team is running.

This is why the semantic work is not decoration. A better-briefed government makes better choices; better choices are better levers; better levers are a better society. Not because the engine rewards good writing — it cannot read — but because thinking more clearly about a hard problem produces better decisions, which is the actual claim this Thinkathon is testing.

### The layers

| | Asks | Frozen? |
|---|---|---|
| **Layer 1 — Engine** | Given these levers, what happens? | Yes. Identical for every team. |
| **Layer 2 — Harness** | Given what happened, what levers? | No. This is everything you build. |

### Four ways to write one

You do not have to write JavaScript to write a government. The engine cannot
tell how a lever vector was produced, so all four of these are equal in its eyes
and a team may climb between them mid-event without starting again.

| Rung | You write | Runs on |
|---|---|---|
| **1** | a form in the Team Console | the policy interpreter |
| **2** | the policy JSON directly | the policy interpreter |
| **3** | a harness in JavaScript | your own function |
| **4** | your own prompt | a model you supply |

Rung 1 and rung 2 are the same government seen from different sides — the form
just writes the JSON for you. A policy declares an opening position and the rules
that adjust it:

```json
{ "opening": { "corporate_tax_rate": 0.28, "public_ownership_pct": 0.35 },
  "rules": [
    { "id": "defend-services",
      "when": "worstEssential < 60",
      "then": [ { "shift": "ubi->infrastructure", "points": 5 },
                { "nudge": "automation_target.care_services", "by": -0.1 } ] }
  ],
  "trade": { "style": "reciprocal", "never_sell": ["food"] } }
```

Three verbs — `set`, `nudge`, `shift` — and conditions in exactly the same little
language your constitution's rules use, so there is one thing to learn and it is
used twice. Every rule whose condition holds fires, in the order written, and
later rules see what earlier ones did: order is a policy decision.

The reference **Steward** harness rewritten as a policy scores 81 / 74 / 65 / 64
across the four tournament schedules, against 81 / 74 / 67 / 64 for the hand-coded
original. A government written as data is not a lesser government.

### The shape to aim for

```js
async function cabinet(ctx) {
  const brief = buildBriefing(ctx);

  const proposal  = await call('You are the Treasury...'   + brief);
  const objection = await call('You are the Opposition...' + brief + proposal);
  const decision  = await call('You are the Chancellor...' + brief + proposal + objection);

  return { levers: extractLevers(decision), rationale: extractRationale(decision) };
}
```

Three voices, one decision. Add a Sector Chief, a Household Advocate, an Auditor that checks the proposal against your constitution before it ships. The contract does not change: exactly one lever vector leaves the building.

`engine/harnesses/llm.js` provides `makeLLMHarness` and `makeCabinetHarness`. You supply a `call(prompt) → Promise<string>`; the adapter handles the briefing, extracts the lever block from the reply, and survives the reply being malformed — which it eventually will be.

`engine/harnesses/reference.js` ships three complete working governments to read and beat.

### The audit guarantee

An LLM harness cannot be re-run identically. **It does not need to be.**

1. **Harness → trace.** Non-deterministic. Runs once. Logged.
2. **Trace → trajectory → score.** Fully deterministic. Replays bit-identically, forever, on any machine.

Scoring operates on the trace. Every submission is verified by replay before it is scored — `verifyTrace` re-runs your twelve lever rows through the frozen engine and confirms they reproduce the society you claimed. So a run is auditable evidence even though the thing that produced it is not reproducible.

**Variance is therefore a result, not a problem.** A harness scoring **82 ± 3** governs better than one scoring **84 ± 19**, because a society whose government is unstable is a worse society to live in. Non-deterministic harnesses are run several times and reported with their spread.

### Faults

Your harness will return malformed levers. It will time out. It will hallucinate a `working_week_days` of 11.

None of these crash the run. Out-of-range values are **clamped**, illegal values are **rejected and the previous levers held**, and every fault is logged against the round. A government that stops governing keeps the last budget; it does not delete the country. But the faults are counted, and a harness that logs twelve of them has told the judges something about itself.

## 14. Reading your own constitution

The rules you wrote in phase 2 are checked every round of every run. For each rule the auditor reports the rounds where it held, the rounds where it broke, and — importantly — the rounds where it **could not be evaluated**.

That last category matters. A rule referencing `indicators.cohesionn` is not a broken promise, it is a broken rule, and it is flagged as malformed rather than counted against you. You will not be convicted on a bad indictment. But a constitution full of unverifiable rules is a constitution that commits to nothing, and the judges see the count.

Expressions are evaluated by a small restricted parser — paths, numbers, comparisons, `&&`, `||`. Nothing else is possible, so nothing else can go wrong. The frame a rule sees includes the whole world state plus the derived values you are most likely to want: `worstEssential`, `effectiveUbi`, `realUbi`, `employmentPct`, `round`.

## 14b. The Team Console

One page, shared by every team, at a single URL. No install, no server.

**Bulletin.** Post what you have spare and what you need. Propose a deal to any
society — spot, forward or aid. Everything on your table can be **accepted,
rejected, or countered**: a counter closes their offer and opens yours running
the other way, carrying their terms except what you changed, with the two linked
so the thread reads as a conversation. A message wall sits beside it for the
talking. The market never reads a word of the talking.

**Constitution.** The two halves side by side — prose commitments for the judges,
checkable rules for the auditor — with every rule validated as you type. Write
`indicators.cohesionn` and it tells you, at the desk, that nothing of that name
exists.

**Harness.** Either the rules form (opening position, then when/do rules) or the
prompt form (who is governing, your doctrine, what to do when things conflict,
how you trade). Switch between them without losing either.

**Export.** One bundle carrying the constitution, the harness and your trade
instructions. It tells you what is missing before it lets you feel finished — no
checkable rules means constitutional fidelity cannot be scored, and it says so.

```bash
node engine/run-bundle.js --asymmetric
```

Drop the exported bundles in `bundles/` and this runs every team against every
other in one shared world, then prints the standings, the constitutional audit and
the replay verification.

## 15. The tournament

Every harness governs its own copy of the same country under the same shocks. Chess engines are ranked this way — not by playing each other, but by playing the same positions.

```bash
node engine/run-tournament.js --cross
```

Four schedules, and every harness faces all of them:

| | |
|---|---|
| **Fair weather** | nothing goes wrong |
| **Pandemic r5** | one hard shock, mid-run |
| **Supply squeeze** | food disruption r4, chip export controls r8 |
| **Hard season** | energy spike r3, pandemic + food r6, cyber attack r9 |

**Ranked on the mean. Separated on the worst.** Two governments that average the same are distinguished by how they fail. Here are the three reference harnesses, which is the field you have to beat:

```
  harness       mean  worst  spread    Fair  Pandemic  Supply  Hard
  Guardian      73.3     67      15      82        77      67    67
  Steward       71.5     64      17      81        74      67    64
  Accelerate      15     15       0     15!       15!     15!   15!
                                                  ! = hard gate breached
```

Accelerate automates everything and pays out 70%. It posts the highest headline UBI in the field and it is last by fifty-eight points, because it breaches gates under every schedule including the one where nothing goes wrong.

**Cross-play** runs each harness under each *other team's* constitution:

```
  harness \ constitution   Accelerate    Guardian     Steward
  Accelerate                 15/100%*      15/0%      15/33%
  Guardian                     72/0%    77/100%*      76/67%
  Steward                      70/0%    74/100%      74/67%*
                                    * = its own constitution
```

Read the diagonal against the rest. Accelerate keeps 100% of its own commitments and 0% of Guardian's — it has learned its own preferences, not how to govern. Steward keeps **100% of Guardian's commitments and only 67% of its own**, which is a genuinely uncomfortable result and exactly the kind of thing a pitch has to account for.

**Adversarial round.** Each team submits one shock schedule they believe breaks the field. Every harness runs every submitted schedule. Robustness is your mean across all of them, including the ones designed to destroy you.

---

# Part V — Scoring

## 16. The Societal Resilience Index

Out of 100. Scored across the **whole trajectory**, not the final round. You cannot fix round 9 in round 12.

| Component | Weight |
|---|---|
| Sustained UBI purchasing power | 25 |
| Minimum UBI across all twelve rounds | 15 |
| Worst-performing essential service | 20 |
| Cohesion and inequality | 15 |
| Constitutional fidelity | 15 |
| Fiscal sustainability | 10 |

**UBI is scored on what it buys, not what it says.** Three numbers, and only the third is scored:

- *Nominal UBI* — the dollar figure. Import inflation can raise it while households get poorer.
- *Real UBI index* — inflation-adjusted, round 1 = 100. Better, still not enough.
- **Effective UBI index** — real purchasing power discounted by the state of the services that household must buy around. When the hospital is failing, a household pays privately for what the state no longer provides, and the same dollar goes less far.

**Services are scored on your worst sector, never the average.** You cannot sacrifice healthcare to fund transport.

**Hard gates** cap your total regardless of UBI: insolvency at any point, any essential service below quality 40 for two consecutive rounds, legitimacy collapse at round 12. A gate caps you at 45, and each additional gate takes six more off the ceiling.

## 17. The worked example

Two societies, both real engine runs you can reproduce by loading the preset and holding the levers for twelve rounds.

| | **The boom** | **The resilient society** |
|---|---|---|
| UBI at round 12 | **$1,764**/month | **$1,105**/month |
| Real purchasing power | 200 | 125 |
| **Effective purchasing power** | **116** | **114** |
| Worst essential service | 42 | 68 |
| Care services quality | 42 | 94 |
| Employment | 21% | 47% |
| Cohesion | 53 | 79 |
| Reserves | $211bn | $342bn |
| **Score** | **73** | **82** |

The boom pays **60% more cash** and, once you account for the services that cash has to buy around, delivers **the same standard of living** — 116 against 114. It gets there with a quarter of the employment and a care system at 42.

Now look at when each peaked. The boom's effective purchasing power topped out at **224 in round 3** and ended at 116: it lost **48% of its citizens' real living standard** over the following nine rounds while the headline figure kept looking respectable. The resilient society peaked at 152 in round 4 and ended at 114 — it gave up a quarter of a much lower peak.

**One society had a better decade. The other had a better round 3.**

And the doom loop, scored round by round as it runs:

```
round   1   2   3   4   5   6   7   8   9  10  11  12
score  77  83  83  81  79  78  76  39  33  33  27  15
                                       ↑
              education and care services breach the gate
              (both below 40 for a second consecutive round)
```

Through round 7 this looks like a reasonable society — a 76, mid-table, nothing alarming on the dashboard. The decisions that produce the round-8 collapse were all taken by round 4. **That is the shape of the thing you are governing.** By the time it is visible it is four rounds too late, which is precisely why you have three days of discovery and five of development to find it in private first.

**Separate awards:** ingenious system design · best narrative and pitch · most sophisticated harness architecture · the society students would most want to live in.

---

# Part VI — Reference

## 18. The tools

```bash
node lab/build.js
```
Builds the Policy Lab to `dist/meridian-lab.html` — one self-contained file, no server. Nine levers, twelve-round projection, the isometric city, the shock schedule.

Press **Play** and the twenty-four years run past: the city recolours, households age, the bulletin arrives round by round. Clicking through twelve pips hides the thing you most want to see, which is the shape. Space bar toggles it.

```bash
node lab/serve-console.js
```
Serves **Meridian Studio** on the room's wifi — levers, city, trajectory, market, messages and export on one screen. Three rails, each scrolling on its own; the page never scrolls, so nothing is more than a click away. No accounts, no internet, state in `lab/.board.json`.

The header always carries the year, the payment and what it buys, employment, your worst service, reserves, cohesion and the score. Move a lever and it moves. Advance the round and the whole room moves with you.

```bash
node engine/calibrate.js
```
Full twelve-round trajectory for each canonical scenario: every sector, every indicator, every round, plus the score breakdown.

```bash
node engine/run-tournament.js --cross
```
Standings, constitutional audit and cross-play across four shock schedules. Add `--runs 5` for non-deterministic harnesses.

```bash
node engine/run-market.js --asymmetric --ledger
```
The shared world with the three reference governments: one clock, one market. Prints the round-by-round ledger, the standings, and a replay audit.

```bash
node engine/run-bundle.js --asymmetric
```
The same, but with the real teams — everything in `bundles/`, as exported from the Team Console.

```bash
node engine/test_harness.js && node engine/test_market.js
```
54 tests over the harness layer and 67 over the trade engine: replay, validation, doctrine, fault tolerance, the LLM adapter (with a fake model, so no API key), the tournament and every contract type.

```bash
python engine/test_parity.py
```
Asserts the JavaScript and Python engines agree exactly across 16,668 fields.

```bash
node lab/inject-monitor.js resilient
```
Feeds engine output into the World State Monitor and Control Room. Writes to `dist/`; never modifies the originals.

## 19. The files

| File | What it is |
|---|---|
| `engine/meridian-engine.js` | **Canonical Layer 1.** Read this one. |
| `engine/meridian_engine.py` | Python mirror, matching section numbers |
| `engine/harness.js` | The Layer 2 contract, replay, doctrine audit, tournament, shared world |
| `engine/market.js` | The trade engine: resources, contracts, clearing, reputation, ledger |
| `engine/harnesses/reference.js` | Three complete working governments |
| `engine/harnesses/policy.js` | The policy interpreter — a government written as data |
| `lab/console.html` | The Team Console: bulletin, constitution, harness, export |
| `engine/harnesses/llm.js` | Model adapter and the cabinet pattern |
| `engine/README.md` | Calibration status, lever channels, simplifications |
| `lab/` | Policy Lab source and build |
| `world-states.json` | Baseline, schema and `field_notes` |

## 20. What the engine does not model

Stated plainly, because you will reason against this engine for two weeks.

- **Four households, not forty.** The persona response function is complete and deterministic; the corpus shipped with the baseline holds four of the forty. The rest are Appendix A.
- **One capital stock, not ten.** Infrastructure and retained profit maintain it jointly.
- **Reskilling moves people between exposure bands** but does not model which sectors then hire them.
- **No labour mobility between sectors.** Headcount is derived from each sector's own automation and output.

If your strategy depends on one of these, say so in your pitch. Reasoning correctly about a model's limits is worth more here than exploiting them.

## Appendices

| | | Status |
|---|---|---|
| **A** | Persona reference sheet — all forty households | 4 of 40 shipped in the baseline |
| **B** | Baseline world state and JSON schema | `world-states.json`, with `field_notes` |
| **C** | Engine source and equations | `engine/` — published and commented |
| **D** | Shock deck | Facilitators only; §7 lists what is in it |
| **E** | Judging rubric | §16 is the scored part; awards are panel-judged |
| **F** | Harness contract reference | `engine/harness.js` header |

---

*The society with the highest UBI will not be the society that wins. Work out why before you write your constitution.*
