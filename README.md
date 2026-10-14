# The Meridian Simulation

**Singapore, 2050. Agentic AI can do most work. Your team governs 5.9 million people and finds out what that costs.**

Trusted Hub · Temasek Polytechnic · ITE · *a THINKathon for teams of four to five students*

A team writes a constitution and a government. The simulation then runs their country month by month. Residents, firms and the government are AI agents that make their own choices; fixed formulas turn those choices into output, prices, jobs, tax and service quality. At the end there is no score and no verdict: the simulation produces evidence, and the team argues its case.

The thesis is one sentence: **the society with the highest UBI does not win.** Everything here exists so students discover why.

---

## The idea

Automation removes wages → wages are household income → income is spending → spending is the demand firms sell into → sales are the profit the state taxes → tax funds the payment that replaced the wages.

Go round that ring and a productivity boom can eat itself. Nothing in the engine punishes automation. The collapse is bookkeeping, and it rests on one line:

```js
const output = Math.min(capacityAbs, demand);   // THE CLIFF
```

Output is **sold**, not merely made.

## How it works

**Agents decide. The kernel computes.**

| Decided by an AI agent | Computed by fixed formulas |
|---|---|
| how much households spend; anything people choose to do, in their own words (work, strike, trade, help, organise, leave); whether to have a child; trust and belonging | prices and inflation; output, capacity, jobs and wages; births, deaths and ageing |
| firm prices, wages, automation, hiring, investment and exit | capital and reinvestment; tax, the budget and the monthly payment |
| the government's levers each month, if the team briefs a model | service quality, cohesion, legitimacy, inequality |

- **Time runs in monthly ticks.** The kernel moves every month. The government decides monthly; residents and firms decide every three months by default. A run lasts as long as the team chooses (4 to 240 years) and can be paused, changed and resumed.
- **Residents** are a weighted sample (40 on a laptop, 1,000 on a large server) whose age, ethnicity, housing, region, household, health and income are drawn from official SingStat and Ministry of Manpower tables. Each sees only their own life, carries memory and feelings between decisions, and acts in free text with no menu.
- **An interpreter** turns each free-text action into a fixed vocabulary of effects the kernel can compute, so behaviour nobody anticipated still changes the country. It sees only the words of the action, and what one team's society invents stays private to that team.
- **Firms**, several per industry across thirteen industries, compete on price and investment. The government's automation lever is a ceiling, not a target: a state can forbid, tax and subsidise, but cannot make a firm invest.
- **Agents are blindfolded in code.** Residents see the queue at the clinic, never the tax rate. Firms see the taxes they pay and the prices they face, not the treasury.
- **The kernel is deterministic** and implemented twice, in JavaScript and Python. A parity test checks the two agree on every field.
- **Never a rule in place of a decision.** If the model is slow or down, the run waits. It does not substitute a formula for an agent.

## Quick start

Needs **Node 18 or later** and nothing else. There are no packages to install.

```bash
npm start        # the studio, at http://localhost:7823
npm test         # the five main test suites
```

Agent runs need an OpenAI-compatible model server (LM Studio, Ollama, vLLM or SGLang). Set its address and model in [`harness/llm.config.json`](harness/llm.config.json), or with `LLM_BASE_URL` and `LLM_MODEL`. Without one, the Trial view still shows the physics of your settings.

For organiser controls, set a token before starting:

```bash
MERIDIAN_ADMIN_TOKEN=organiser npm start
```

On Windows PowerShell: `$env:MERIDIAN_ADMIN_TOKEN = "organiser"; npm start`

## The studio

| Page | What it is for |
|---|---|
| `/setup` | Everything a team decides, in eight sections, each saved on its own: economy, AI adoption, government, constitution, your case, trade, institutions, distribution. |
| `/sim` | Run the country. **Trial** previews the physics of saved settings. **Agent run** runs the society: choose a size, the number of years and the pace, then pause, apply changes or stop while it runs. |
| `/feed` | What residents and firms posted as they decided, with government statements and departures. |
| `/market` | Offers, messages and the hand-in bundle. |
| `/reports` | Every finished run, with the full report, PDF and data downloads. |
| `/admin` | Organisers only: fire events, set weather, hold the whole room, review what actions were taken to mean. |

### What a team sets

- **Economy and AI adoption.** Corporate tax, the tax on automation, public ownership, reskilling, the working week, the care job guarantee, how the payment is shared, the budget split, and an automation ceiling for each industry.
- **Government.** Either rules (`when <condition>, then shift / nudge / set`), built from menus that list every term a rule can use, or a briefing that a model reads and governs from each month.
- **Constitution.** Written commitments, which the simulation compiles into policies, plus checkable rules that are tested throughout the run.
- **Institutions.** Behaviours the team's own society invented in an earlier run can be funded, licensed, made easier or endorsed.
- **Distribution.** The payment to everyone is one scheme. Teams can add others that pay people credits for what they do.

### What comes out

A report of evidence: the country year by year, each industry against its fixed scorecard, what people reported and did, behaviours nobody predicted, a panel of residents followed in their own words, the government's record and a constitutional audit, any changes made mid-run, and the official tables the residents were drawn from. Runs are saved in `runs/<id>/`.

## From the command line

```bash
node agents/run-agents.js --years 24 --constitution constitutions/tampines-compact.md
node agents/run-agents.js --profile dgx --seeds 5 --team alpha --constitution my.md --weather
node agents/run-agents.js --calibrate            # check a model behaves plausibly before an assessed run
node agents/run-agents.js --replay runs/<id>/decisions.jsonl --seed 101 --team alpha
node agents/run-agents.js --no-model             # physics only, labelled degraded
```

Run sizes (`local`, `classroom`, `dgx`) are set in [`agents/profiles.json`](agents/profiles.json). Serving a model for a room of teams: [`deploy/dgx/README.md`](deploy/dgx/README.md).

## Tests

None of these need a model, a key or a network. The agents are driven by a fake model that returns what small models really return, including broken replies.

```bash
npm test                              # the five suites below
node tests/test_agents.js             # 198  the whole agent society, end to end
node tests/test_kernel_channels.js    #  60  every channel from agents into the kernel
node tests/test_simulation_loop.js    #  49
node tests/test_llm_client.js         #  24
node tests/test_one_at_a_time.js      #   4

npm run test:parity                   # JS and Python kernels agree on 310,166 fields (needs Python 3)

node engine/test_society.js           # 716  the original two-year engine
node engine/test_harness.js           #  62
node engine/test_market.js            #  85
```

Two tests in `test_agents.js` depend on chance in the fake model and can fail about one run in twenty. Run it again before investigating.

## Where things are

| | |
|---|---|
| `engine/meridian-engine.js` | The kernel: every formula and constant. `engine/meridian_engine.py` is the Python mirror. |
| `engine/sector_missions.js` | What each of the thirteen industries is for, and its scorecard. |
| `agents/` | The society: residents (`citizen.js`, `mind.js`, `population.js`), firms (`firm.js`), government (`government.js`), the interpreter and router that turn words into numbers, the social graph, the run loop (`society.js`) and the server. |
| `lab/` | The studio pages. |
| `data/singstat/` | The official tables the residents are drawn from, and the script that compiles them. |
| `harness/` | The model client and its settings. |
| `tests/` | The test suites. |
| `constitutions/` | An example constitution. |

## Read more

| | |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | Each feature in detail: who governs, open-ended action, institutions, changing a run mid-way, distribution schemes, monthly ticks, what a run keeps and costs. |
| [`docs/EVIDENCE.md`](docs/EVIDENCE.md) | Every claim the simulation makes about behaviour, its source, and whether the number is evidenced, calibrated or a placeholder. |
| [`data/singstat/SOURCES.md`](data/singstat/SOURCES.md) | The eleven official tables behind the residents, and every assumption made in joining them. |
| [`agents/README.md`](agents/README.md) | The agent society in more depth. |
| [`docs/HISTORY.md`](docs/HISTORY.md) | How the simulation was built, stage by stage, and the earlier two-year-round version. |
| [`thinkathon-simulation-spec.md`](thinkathon-simulation-spec.md) | The original brief. |

## Known gaps

- **Many coefficients are placeholders.** What a strike, an hour of volunteering or a policy yields in kernel units, the automation and scarcity constants, and every firm threshold are judgement, not measurement. They are labelled in `docs/EVIDENCE.md`.
- **Constants were written for two-year rounds** and are converted to months automatically. Monthly results land within 3% of the two-year results, but nothing has been re-estimated for monthly behaviour. Government rules fire every month, so a small nudge that keeps firing moves a lever twelve times a year.
- **Small local models are docile and uniform.** A 7B model writes valid decisions but residents mostly choose the same things. Run the calibration and use a larger model before drawing conclusions.
- **Trade between teams' countries is not built.** The Market page handles offers and messages by hand. An always-open market that countries trade on automatically is designed but not implemented.
- **Some views still use two-year rounds:** the Market page's preview and the Feed's Trial tab.
- **Residents are present-day Singaporeans in a 2050 economy.** Savings, ability to emigrate and personality are modelled, not measured. Sex and non-resident workers are not modelled.
- **Thirteen scenario industries are matched to nine published ones,** so healthcare and care share one age and income profile, as do education, public administration and public safety.
- **`equity` is a proxy.** Rationing is charged more heavily when more people are exposed to losing their income, rather than read from the worst-served group directly.
- **Reskilling does little** economically compared with what it costs.
- **Most academic citations in `docs/EVIDENCE.md` are unverified.** The works are real, but authors, years and journals were written from memory.

---

*The society with the highest UBI will not be the society that wins. Work out why before you write your constitution.*
