# Serving the agents on the DGX

LM Studio is a desktop app. In testing it stopped answering three times under agent load, once at only three concurrent requests. A classroom run is a few thousand model calls per team, and a DGX-profile run is around a hundred thousand, so this needs a batching inference server.

Anything that speaks the OpenAI `/v1/chat/completions` API works. The simulation needs three things from it:

- **JSON-schema structured output** (`response_format: json_schema`). Every agent decision is constrained by a schema, and this is what stops a small model answering in prose.
- **A `seed` parameter**, for reproducibility where the server honours it.
- **Prefix caching**. Every persona prompt shares a long common preamble, and caching it is most of the throughput.

vLLM and SGLang both provide all three.

> **Not tested here.** Nothing in this folder has been run against a DGX. The commands follow vLLM's documented interface, but flag names change between vLLM releases (the structured-output flags especially), so check them against the version you install. Everything on the simulation side has been tested, against a fake model and against LM Studio.

## 1. Which DGX?

"DGX" covers very different machines. Pick the model to fit the memory you actually have.

| Machine | Memory | A sensible model |
|---|---|---|
| DGX Spark (GB10) | 128 GB unified | Qwen2.5-32B-Instruct, or a 70B at 4-bit |
| DGX with 8× H100/H200 | 640 GB+ | Qwen2.5-72B-Instruct, tensor-parallel 8 |

A bigger model matters more here than a faster one. The 7B tested so far writes valid decisions, but its answers are very alike and it tends to be docile. The calibration suite exists to catch exactly that.

## 2. Start the server

```bash
docker run --gpus all --ipc=host -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-72B-Instruct \
  --tensor-parallel-size 8 \
  --enable-prefix-caching \
  --max-num-seqs 256
```

On a DGX Spark, drop `--tensor-parallel-size` and use a model that fits.

## 3. Point the simulation at it

Edit `harness/llm.config.json` on the machine running the studio server:

```json
{ "baseUrl": "http://<dgx-host>:8000/v1", "model": "Qwen/Qwen2.5-72B-Instruct", "timeoutMs": 180000 }
```

Or set it for one shell: `LLM_BASE_URL=http://<dgx-host>:8000/v1 LLM_MODEL=Qwen/Qwen2.5-72B-Instruct`.

Check it answers:

```bash
node harness/llm_client.js
```

## 4. Calibrate the model before an assessed run

```bash
node agents/run-agents.js --calibrate
```

This runs five behavioural checks (fairness, reciprocity, response to income, response to grievance, and differences between personas) and stores the result against the model's name in `agents/calibration.json`. Assessed runs (`--assessed`) refuse a model that has not passed. An organiser override is possible and is written into the run's evidence.

## 5. Size the runs

`agents/profiles.json` holds three sizes, and each value can be overridden per run:

| Profile | Residents | Sub-steps | Concurrency | Decisions per 12-round run |
|---|---|---|---|---|
| `local` | 40 | 1 | 3 | ≈ 1,000 |
| `classroom` | 200 | 2 | 16 | ≈ 5,000 |
| `dgx` | 1,000 | 8 | 96 | ≈ 96,000 |

These are call counts, not timings. Measure the wall-clock time on your hardware with one short run before the event, then set `MERIDIAN_MAX_RUNS` (how many team runs execute at once on the studio server) to what the server sustains.
