# The agent society

Every choice a person or organisation makes is made by an LLM agent. The kernel (`engine/meridian-engine.js`) does only physics and accounting: market clearing, prices and inflation, the budget, capital, the grid, ageing.

The split follows AgentSociety's **reason → route → action** pipeline:

| Stage | Who | What happens |
|---|---|---|
| **Reason** | the LLM | A persona perceives its own life and decides: how much to spend, whether to work, up to three things to do in its own words, whether to leave, and how it feels. |
| **Route** | `router.js` (deterministic) | Recognises what those words mean, checks they are possible, and adds them up by who took part. A strike withholds the labour of the people actually striking. |
| **Action** | the kernel | Markets clear, prices form, and the accounts post. Each agent gets back what it lived through. |

## Files

| File | Role |
|---|---|
| `society.js` | One run, round by round: world → government → kernel → society (sub-steps) → industry → record |
| `population.js` | Weighted personas that reproduce the country's age bands and every sector's workforce exactly |
| `mind.js` | Needs (computed from circumstance), plus emotions, attitudes and memory (reported by the agent) |
| `citizen.js` | What a resident perceives (blind to government internals), the decision schema, and the labelled fallback |
| `firm.js` | Several firms per industry by ownership type, each setting price, wages, hiring, investment and automation; market share, entry and exit |
| `router.js` | Intent registry, feasibility, participation-weighted effects, organised action |
| `social.js` | Social graph, message bus, organisations |
| `policy.js` | Constitution → policy grammar compiler, per-round policy review, rubric and case parsing |
| `director.js` | The environment: event library, severity, duration, targeting, seeded weather |
| `evidence.js` | The evidence report. It contains no verdict. |
| `ensemble.js` | Identical seeds and events per team, with distributions across runs |
| `calibration.js` | The behavioural gate a model must pass before an assessed run |
| `llm_pool.js` | Bounded concurrency, schema output, the decision log, replay, and recovery when the server drops |
| `server.js` | Agent runs and the organisers' console, mounted into `lab/serve-console.js` |
| `run-agents.js` | Command line |

## What reaches the kernel

Agents affect the economy only through optional channels on `step()`. When a channel is absent, the kernel computes exactly what it always did, and parity with the Python mirror is enforced for every channel.

| Channel | Decided by | Replaces |
|---|---|---|
| `households.propensity` | residents' spending shares | the three fixed MPC constants |
| `households.labour_supply` | residents' work choices | "employment = labour required" |
| `households.withheld[sector]` | strikers, by participation | the fixed −7% strike |
| `polls.trust`, `polls.belonging` | residents' own reports | the legitimacy and cohesion formulas |
| `demography` | births and emigration decisions | the fixed population curve |
| `firms[sector].markup`, `wage_offer`, `automation` | firms | a single industry agent with fixed step sizes |
| `levers.policies` | the government, in the grammar | a fixed lever vector |
| event objects as shocks | organisers | five preset shock tables |

## Honest limits

- **Sub-steps are social, not economic.** The society deliberates up to eight times a round, but the economy clears once per two-year round, on the time-averaged decisions.
- **Conversion constants are placeholders.** What a unit of mutual aid, a strike or a policy yields in kernel terms is written in the code, and is not calibrated against data.
- **Small models are docile and uniform.** In testing, a local 7B wrote valid decisions every time, but most residents chose the same things. Calibrate before trusting a run.
- **The long-tail surrogate is not built.** Light Society's precomputed-lookup tier was optional in the plan and is not implemented; population size is bounded by the model server.

## Tests

```bash
node tests/test_kernel_channels.js   # every channel moves what it should, and nothing when absent
node tests/test_agents.js            # the whole society, driven by a misbehaving fake model
python engine/test_parity.py         # JS and Python kernels agree, including every new channel
```
