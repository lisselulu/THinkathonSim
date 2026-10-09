# The Meridian Simulation
### A Thinkathon on AI, work, and what comes after
Trusted Hub · Temasek Polytechnic · ITE

---

## 1. Premise

**Singapore, 2050. The work is done. Now what?**

Agentic AI can perform most routine cognitive and physical labour. Your team governs a city-state of 5.9 million people with a rapidly ageing population, near-total food import dependency, and no natural resources except the ones it builds.

Productivity is climbing. Employment is falling. These are the same event.

Over twelve rounds — twenty-four simulated years — you will set policy for this society using a fixed set of levers. You will face shocks you are not told about in advance. You will trade with rival societies run by other teams.

You are not scored on how much wealth your AI economy produces. You are scored on how much of it reaches your citizens, and whether it keeps reaching them.

---

## 2. What is fixed, what is yours

One rule governs everything below:

> **Anything that affects your score is deterministic. Anything an LLM produces is narration.**

The same Python engine runs every society. The same 5,000-agent synthetic population, calibrated to real Singapore demographics, underpins every society. The same forty households live in every society and respond identically to identical conditions. The same shock deck is drawn from.

You cannot make Mdm Tan better off by writing a more sympathetic paragraph about her. You can only make her better off by governing better.

**What is yours:** the nine policy levers, the agent architecture you build in TAV, your treasury strategy, your sector operating logic, your editorial line, your negotiating position, and your founding constitution.

---

## 3. The world

**Ten sectors.** Healthcare · Transport · Housing & Utilities · Food & Agri · Finance · Education · Retail & Commerce · Care Services · Public Safety · Compute & Energy.

Each carries five numbers: **automation** (share of output produced without human labour), **headcount** (people employed — the wage channel), **capacity** (output relative to demand; below 1.0 means unmet need), **quality** (0–100 service level), and **margin** (operating profit).

Compute & Energy is a sector because AI is not free. Automation runs on data centres that consume power and imported chips. Every point of automation has a bill attached.

**The population.** 5.94 million at round 1, falling to 5.52 million by round 12. Three age bands, with the over-65 share rising from 28% to 35% across the run. Working-age citizens are split into three AI-exposure bands: high (clerical, logistics, retail, basic admin), medium, and low (care, trades, complex judgement).

**The forty households.** A fixed persona set drawn from the synthetic population. They age, they work or don't, they consume, they get sick, they die. They are the same forty in every society, which is what makes cross-team comparison meaningful. Four you will come to know well: Mdm Tan Ah Choo, 68, retired cleaner. Rahim bin Yusof, 34, logistics coordinator. Nurul Aisyah, 22, ITE graduate. Sister Grace Lim, 45, nurse.

---

## 4. The economic loop

Read this section before you look at the levers.

```
   AI adoption
        ↓
   Output & profit  →  Tax revenue  →  Allocation split
        ↑                                     ↓
   Consumption  ←  Household income  ←  Services & UBI
```

The arrow returning from consumption to output is the entire game.

Automation raises profit by removing wages. Profit is taxed. Tax funds UBI and services. UBI becomes household income. Household income becomes consumption. **Consumption is the demand that generates the profit you were taxing.**

Remove enough wages and you eventually remove the profit base that funds the transfer replacing them. The UBI rises for several rounds, then falls off a cliff. This is not a bug in the engine. It is the central problem of post-capitalist economics, and discovering where the cliff sits is what this Thinkathon is for.

**The allocation split — cash versus services.** Revenue goes three ways. UBI payouts are cash in hand. Infrastructure spend is service capacity. Reserves are the buffer that lets you survive a shock. Cash and services compete for the same pot and reach households by different routes.

A household on $3,000 a month where the hospital sits at quality 42 and the care waiting list runs 31 months is poorer than a household on $2,000 where the hospital sits at 84. Cash is worth only what it can buy.

---

## 5. Your controls

Nine levers. Set them each round.

| Lever | Range | The trade-off |
|---|---|---|
| AI adoption (per sector) | 0–100% | Productivity vs displacement vs compute cost |
| Corporate tax rate | 0–45% | Revenue vs firms' capacity to reinvest |
| Compute levy | 0–30% | Taxes automation directly, slows adoption |
| Allocation split | sums to 100% | UBI vs infrastructure vs reserves |
| UBI design | flat / means-tested / age-weighted | Universality vs targeting efficiency |
| Reskilling spend | % of budget | Pays off in 3–4 rounds, costs now |
| Public ownership of automated capital | 0–50% | Dividend income vs firm resistance |
| Working week | 5 / 4 / 3 days | Spreads remaining work, cuts output |
| Care job guarantee | on/off, wage level | Creates meaningful work, runs at a loss |

**Public ownership** deserves attention. A society that owns a share of the machines has a revenue stream that does not depend on taxing a profit base that may be shrinking. It is the sovereign wealth answer to the loop in section 4.

**Irreversibility.** Automate a sector past 80% and re-employing humans there costs three rounds of retraining spend. Some doors close behind you.

---

## 6. Shocks

**Scheduled** — every society, same rounds. A demographic milestone at round 3 as the over-65 share crosses 28% and healthcare demand steps up. A model capability breakthrough at round 5 that raises automation ceilings and forces a decision about whether to take the productivity.

**Drawn** — pandemic, food import disruption, energy price spike, chip export controls. You will not know which, or when.

**Endogenous** — triggered by your own state, not by chance. Civil unrest when cohesion falls below 35. Fiscal crisis when reserves go negative and stay there. Service failure cascade when any sector drops below quality 40. Political crisis when legitimacy falls below 25, forcing a lever reset.

All shocks are announced in-world, through your news bureau. There are no system messages.

---

## 7. Inter-society trade

Societies trade **compute, energy, food, skilled labour, and sovereign credits.**

**Three contract types.** *Spot* settles this round. *Forward* delivers in N rounds at agreed terms — and when a shock lands between signing and delivery, someone is on the wrong side of a promise they cannot keep. *Aid* is a unilateral transfer: it costs the giver output and raises their legitimacy and the receiver's cohesion.

**How it works.** Negotiate in plain language in the comms channel. Then submit a structured offer — resource, quantity, price, delivery round, counterparty. The engine validates that you hold the surplus, escrows it, and settles at the round tick. If your prose and your offer object disagree, the object wins.

**Reputation** is a deterministic 0–100 score moved by delivery and default. It multiplies the terms other societies will offer you. Default once and you pay for three rounds.

**Two guardrails.** No more than 25% of any resource leaves per round, so no society can be hollowed out by one bad deal. Every contract appears on a public ledger visible to all societies.

---

## 8. Architecture

**Layer 0 — Substrate (provided).** Synthetic population pre-generated with AgentSociety, the forty-household persona corpus, the behavioural response table, and the sealed shock deck.

**Layer 1 — Engine (provided, source published).** One Python module: world state + lever settings → next world state. Deterministic, frozen before the event. Read it. Reason about it. You may not modify it.

**Layer 2 — Agents (you build, in TAV).**

- *Sector operators* — one per building, making within-policy operating decisions
- *Treasury* — applies the split, computes UBI, flags shortfalls
- *Household voices* — render the engine's persona outcomes as first-person testimony
- *News bureau* — produces each round's bulletin and reveals shocks
- *Opposition* — argues against your policy every round; you must answer it
- *Auditor* — checks fail gates, produces the round scorecard

**Layer 3 — Interface.** The city view renders your world state as ten buildings coloured by service quality, with a four-metric dashboard: UBI, employment rate, cohesion, reserves.

**A round, end to end:** trade window → lever settings locked → engine tick → world state returned → agents narrate → news bulletin published → opposition responds → next round.

---

## 9. Scoring

**Societal Resilience Index**, out of 100.

| Component | Weight |
|---|---|
| Sustained real UBI purchasing power | 25 |
| Minimum UBI across all twelve rounds | 15 |
| Worst-performing essential service | 20 |
| Cohesion and inequality | 15 |
| Constitutional fidelity | 15 |
| Fiscal sustainability | 10 |

Two design notes. UBI is scored on **purchasing power indexed to round 1**, not the dollar figure — import inflation can raise a nominal UBI while households get poorer. And services are scored on your **worst** sector, not your average, so you cannot sacrifice healthcare to fund transport.

**Hard gates.** Any of these caps your total regardless of UBI: insolvency at any point, any essential service below quality 40 for two consecutive rounds, legitimacy collapse at round 12.

**Constitutional fidelity.** In week one you write a one-page founding constitution: what your society is for, three non-negotiable commitments, and your theory of how AI wealth reaches people. You submit it before you know what shocks are coming. At judging you are asked whether you held the line — and if you broke it, whether you can justify why.

**Worked example.** One society ends round 12 with a UBI of $3,240 and scores 64. Another ends with $2,150 and scores 89. The first automated everything, ran 70% of revenue into payouts, and let care services decay to quality 58 while reserves drained. The second took automation where output scales and withheld it in care and education, put 35% of automated capital into public ownership, and ran a four-day week with a care job guarantee. Lower cash, higher living standard, and a buffer when things went wrong.

**Separate awards:** ingenious system design · best narrative and pitch · most sophisticated agent architecture · the society students would most want to live in.

---

## 10. Schedule

**Days 1–3 — Research and constitution.** Study the substrate, read the personas, read the engine source. Write and seal your constitution.

**Days 4–8 — Build.** Agent architecture in TAV, persona voicing, dry runs against a sandbox world. You should be running practice rounds by day 6 — discover the demand cliff in private, not during scoring.

**Days 9–12 — The run.** Twelve rounds, roughly two per day, with overnight deliberation between. Public policy summit after round 4; crisis summit after round 8. Two minutes per team, defending your position.

**Days 13–14 — Adjudication.** Pitches, judging, debrief.

**Team roles (4–5 students, mixed TP and ITE):** Chancellor (final call on levers) · Treasurer (fiscal model) · Sector Chief (operator agents) · Storyteller (personas and pitch) · Systems Engineer (TAV plumbing).

---

## Appendices

- **A.** Persona reference sheet — all forty households
- **B.** Baseline world state and JSON schema
- **C.** Engine source and equations
- **D.** Shock deck (facilitators only)
- **E.** Judging rubric
- **F.** Glossary

---

*The society with the highest UBI will not be the society that wins. Work out why before round 6.*
