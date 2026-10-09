/* =====================================================================
   LLM CLIENT — one door to whatever model the room is running
   ---------------------------------------------------------------------
   Talks to any OpenAI-compatible /chat/completions endpoint: vLLM,
   Ollama, llama.cpp's server, LM Studio, or the real thing. Configured
   entirely by environment so the same code runs against a laptop and a
   cluster without an edit:

     LLM_BASE_URL   default http://localhost:11434/v1   (Ollama)
     LLM_API_KEY    default "not-needed" — local servers rarely check
     LLM_MODEL      default qwen2.5:7b-instruct
     LLM_TIMEOUT_MS default 60000
     LLM_RETRIES    default 2
     LLM_TEMP       default 0.4

   Node's own fetch and nothing else. No SDK, no dependency tree.

   WHY THE PARSING IS SO DEFENSIVE
   -------------------------------
   Small open models are good at reasoning and bad at obeying output
   formats. They wrap JSON in prose, in ```json fences, in ``` fences with
   no tag, in two fences where the second is an afterthought, and
   occasionally in a fence they forget to close. A harness that only
   accepts perfect output will spend a Thinkathon reporting faults about
   its own strictness. Every one of those shapes is handled here, and a
   reply that genuinely carries no object returns null so the caller can
   hold the previous levers rather than improvise on a country's behalf.
   ===================================================================== */

'use strict';

/* An optional file next to this one, so a room does not retype four
   environment variables at every terminal. Missing or malformed, it is
   ignored in silence — a broken config must never be the reason a
   Thinkathon cannot start. Precedence, weakest first:

     built-in defaults  <  harness/llm.config.json  <  environment  <  code

   The environment still wins, so one person can point a single run at a
   different model without editing anyone else's file.                    */
function fileConfig() {
  try {
    const p = require('path').join(__dirname, 'llm.config.json');
    const raw = require('fs').readFileSync(p, 'utf8');
    const c = JSON.parse(raw);
    return (c && typeof c === 'object' && !Array.isArray(c)) ? c : {};
  } catch (e) { return {}; }
}

const FILE = fileConfig();
const pick = (envName, fileKey, fallback) =>
  process.env[envName] != null ? process.env[envName]
    : (FILE[fileKey] != null ? FILE[fileKey] : fallback);

const DEFAULTS = {
  baseUrl: pick('LLM_BASE_URL', 'baseUrl', 'http://localhost:11434/v1'),
  apiKey: pick('LLM_API_KEY', 'apiKey', 'not-needed'),
  model: pick('LLM_MODEL', 'model', 'qwen2.5:7b-instruct'),
  timeoutMs: Number(pick('LLM_TIMEOUT_MS', 'timeoutMs', 60000)),
  /* The most requests this PROCESS sends to the model at once, across every
     client and every run. 1 means strictly one prompt at a time, which is
     what a single consumer GPU running LM Studio can take. Blank or 0 means
     no limit, for a batching server on the DGX. */
  maxConcurrent: Number(pick('LLM_MAX_CONCURRENT', 'maxConcurrent', 0)) || 0,
  retries: Number(pick('LLM_RETRIES', 'retries', 2)),
  temperature: Number(pick('LLM_TEMP', 'temperature', 0.4))
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ONE GATE FOR THE WHOLE PROCESS.
   Agents run through pools, the organisers' console drafts events, the
   cabinet governs, calibration probes the model: each has its own client,
   and on one GPU they all compete for the same card. The limit therefore
   lives here, shared by every client, rather than in any one of them.
   A queued request starts its timeout only once it holds the gate, so
   waiting in line never counts as the model being slow. */
const gate = { active: 0, queue: [], limit: DEFAULTS.maxConcurrent };
function gateAcquire(limit) {
  const max = limit > 0 ? limit : Infinity;
  if (gate.active < max) { gate.active++; return Promise.resolve(); }
  return new Promise(res => gate.queue.push(res));
}
function gateRelease() {
  const next = gate.queue.shift();
  if (next) next(); else gate.active--;
}

/* ---------------------------------------------------------------------
   EXTRACTION — get an object out of whatever came back
   --------------------------------------------------------------------- */

/** Every ```fenced``` block, tagged json or not, last one first. */
function fencedBlocks(text) {
  const out = [];
  const re = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  // A fence the model opened and never closed still usually holds the goods.
  const dangling = /```(?:json|JSON)?\s*([\s\S]*)$/.exec(text);
  if (dangling && out.indexOf(dangling[1]) < 0) out.push(dangling[1]);
  return out;
}

/** The last balanced {...} in a string, scanning from the end. */
function lastBalancedObject(text) {
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '}') { if (depth === 0) end = i; depth++; }
    else if (c === '{') {
      depth--;
      if (depth === 0 && end > i) {
        const slice = text.slice(i, end + 1);
        try { return JSON.parse(slice); } catch (e) { end = -1; }
      }
    }
  }
  return null;
}

/**
 * Trailing commas and single quotes are the two most common near-misses.
 *
 * The last rule is for single-quoted strings inside an ARRAY — `"cites":
 * ['C1', 'C4']` — which the value rule above misses because they follow a
 * bracket or a comma rather than a colon. Models that quote wrongly quote
 * wrongly everywhere, so handling only two of the three positions leaves
 * exactly the replies that were nearly right on the floor.
 *
 * All three skip runs containing a double quote, so an apostrophe inside
 * a properly quoted string ("don't") is left alone.
 */
function repairJson(s) {
  return s
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)'([^'"]+)'\s*:/g, '$1"$2":')
    .replace(/:\s*'([^'"]*)'/g, ': "$1"')
    // Lookahead on the closing delimiter rather than consuming it: ['C1',
    // 'C4'] has only one comma between the two, and a rule that eats it
    // leaves the second string unquoted.
    .replace(/([[,]\s*)'([^'"]*)'(?=\s*[,\]])/g, '$1"$2"');
}

/* Every caller wants an object — a lever package, a set of reactions, an
   audit. A bare array parses as valid JSON and is never the answer, so it
   is treated as no answer at all rather than handed on to a schema that
   will only reject it one step later with a worse message. */
function asObject(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
}

/**
 * extractJson(text) -> object | null
 * Fenced blocks first (last wins — models often correct themselves),
 * then a balanced object anywhere, then the same again after repair.
 */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  const fences = fencedBlocks(text);
  for (let i = fences.length - 1; i >= 0; i--) {
    try { const v = asObject(JSON.parse(fences[i])); if (v) return v; } catch (e) { /* next */ }
  }
  const bare = lastBalancedObject(text);
  if (bare) return bare;

  for (let i = fences.length - 1; i >= 0; i--) {
    try { const v = asObject(JSON.parse(repairJson(fences[i]))); if (v) return v; } catch (e) { /* next */ }
  }
  try { return asObject(JSON.parse(repairJson(text))); } catch (e) { /* give up */ }
  return null;
}

/** The prose a model wrote before it started emitting JSON. */
function extractProse(text) {
  if (!text) return '';
  return String(text).split('```')[0].replace(/\s+/g, ' ').trim();
}

/* ---------------------------------------------------------------------
   THE CLIENT
   --------------------------------------------------------------------- */
function createClient(opts) {
  const cfg = Object.assign({}, DEFAULTS, opts || {});

  /* JSON MODE IS NOT PORTABLE.
     `response_format: {type:'json_object'}` is the OpenAI spelling. Ollama
     and vLLM accept it. LM Studio rejects it outright with a 400 saying it
     wants 'json_schema' or 'text', and because a 400 is otherwise fatal,
     that one incompatibility silently turned every round of a twelve-round
     run into a caretaker round — a government that never governed, on a
     run that still completed and scored.

     So the hint is exactly that: a hint. The first time a server refuses
     it we drop it for the rest of the session and carry on. Nothing
     depends on it — every prompt already asks for a fenced block and the
     parser handles the shapes that come back without it. */
  let jsonModeOk = true;
  let schemaModeOk = true;

  /**
   * chat(messages, opts) -> { text, raw, attempts, ms }
   * `messages` may be a plain string (treated as a single user turn).
   * Rejects only when every attempt failed; the caller decides what a
   * failed round means.
   */
  async function chat(messages, o) {
    await gateAcquire(cfg.maxConcurrent);
    try { return await chatNow(messages, o); }
    finally { gateRelease(); }
  }

  async function chatNow(messages, o) {
    o = o || {};
    const turns = typeof messages === 'string'
      ? [{ role: 'user', content: messages }]
      : messages;

    const body = {
      model: o.model || cfg.model,
      messages: turns,
      temperature: o.temperature != null ? o.temperature : cfg.temperature,
      stream: false
    };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    /* A seed, for servers that honour one (vLLM, SGLang, OpenAI). Servers
       that ignore it are not harmed; reproducibility then rests on the
       decision log, which records every reply regardless. */
    if (o.seed != null) body.seed = o.seed;
    /* STRUCTURED OUTPUT. A JSON schema enforced at the decoder is the one
       way to stop small models answering in prose. LM Studio, vLLM and
       SGLang accept `json_schema`; a server that refuses it drops back to
       the plain JSON hint, then to nothing, and the defensive parser below
       still handles whatever comes back. */
    if (o.jsonSchema && schemaModeOk) {
      body.response_format = { type: 'json_schema',
        json_schema: { name: o.schemaName || 'decision', strict: true, schema: o.jsonSchema } };
    } else if (o.json && jsonModeOk) {
      // Ask for JSON only while this server has not objected to being asked.
      body.response_format = { type: 'json_object' };
    }

    const started = Date.now();
    let lastErr = null;

    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + cfg.apiKey
          },
          body: JSON.stringify(body),
          signal: ac.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error('HTTP ' + res.status + ' ' + detail.slice(0, 200));
        }
        const data = await res.json();
        const text = data && data.choices && data.choices[0] &&
          data.choices[0].message && data.choices[0].message.content;
        if (typeof text !== 'string') throw new Error('no message content in response');

        return { text: text, raw: data, attempts: attempt + 1, ms: Date.now() - started };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        const msg = String((err && err.message) || '');

        /* A server refusing the JSON hint is not a failed request, it is a
           different dialect. Drop the hint and try again immediately —
           this attempt does not count against the retry budget, because
           nothing was actually wrong with what we asked for. */
        if (body.response_format && /response_format|json_schema|schema/i.test(msg) && /HTTP 4\d\d/.test(msg)) {
          if (body.response_format.type === 'json_schema') {
            schemaModeOk = false;
            if (o.json !== false && jsonModeOk) body.response_format = { type: 'json_object' };
            else delete body.response_format;
          } else {
            jsonModeOk = false;
            delete body.response_format;
          }
          attempt--;
          continue;
        }

        // A timeout or a 503 is worth another go; a 400 never will be.
        const fatal = /HTTP 4\d\d/.test(msg) && !/HTTP 408|HTTP 429/.test(msg);
        if (fatal || attempt === cfg.retries) break;
        await sleep(400 * Math.pow(2, attempt));   // 400ms, 800ms, 1600ms
      }
    }
    const e = new Error('LLM call failed after ' + (cfg.retries + 1) + ' attempt(s): ' +
      (lastErr && lastErr.message || 'unknown'));
    e.cause = lastErr;
    e.ms = Date.now() - started;
    throw e;
  }

  /**
   * json(messages, opts) -> { data, prose, text, attempts }
   * Asks, extracts, and — if `schema` is given — validates. On a reply it
   * cannot parse it asks once more, saying plainly what was wrong, which
   * fixes it far more often than it has any right to.
   */
  async function json(messages, o) {
    o = o || {};
    let last = null;
    const turns = typeof messages === 'string' ? [{ role: 'user', content: messages }] : messages.slice();

    for (let pass = 0; pass < 2; pass++) {
      const r = await chat(turns, Object.assign({ json: true }, o));
      last = r;
      const data = extractJson(r.text);
      if (data) {
        const check = o.schema ? o.schema(data) : { ok: true, value: data };
        if (check.ok) {
          return { data: check.value, prose: extractProse(r.text), text: r.text, attempts: r.attempts,
                   usage: usageOf(r) };
        }
        if (pass === 0) {
          turns.push({ role: 'assistant', content: r.text });
          turns.push({ role: 'user', content:
            'That did not validate: ' + check.reason + '\nReply again with the corrected ' +
            'JSON only, inside one ```json fence.' });
          continue;
        }
        return { data: null, prose: extractProse(r.text), text: r.text,
                 attempts: r.attempts, invalid: check.reason, usage: usageOf(r) };
      }
      if (pass === 0) {
        turns.push({ role: 'assistant', content: r.text });
        turns.push({ role: 'user', content:
          'I could not find a JSON object in that. Reply again with nothing but a ' +
          '```json fenced object.' });
      }
    }
    return { data: null, prose: extractProse(last && last.text), text: last && last.text,
             attempts: last && last.attempts, invalid: 'no JSON found', usage: usageOf(last) };
  }

  /* What the server charged for this call. `cached` is the share of the
     prompt it did not have to read again, which is the whole point of
     keeping the instructions identical: servers that cache a prompt prefix
     report it here, and a run can show how much it saved. */
  function usageOf(r) {
    const u = r && r.raw && r.raw.usage;
    if (!u) return null;
    const det = u.prompt_tokens_details || {};
    return { prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0,
             cached: det.cached_tokens || u.cached_tokens || 0 };
  }

  /** Is anything actually listening? Used by the tests and the CLI. */
  async function health() {
    try {
      const r = await chat([{ role: 'user', content: 'Reply with the single word: ok' }],
        { maxTokens: 8, temperature: 0 });
      return { up: true, model: cfg.model, sample: r.text.trim().slice(0, 40), ms: r.ms };
    } catch (e) {
      return { up: false, model: cfg.model, error: e.message };
    }
  }

  return { chat, json, health, config: cfg };
}

/** How many requests are in flight and waiting, for diagnostics and tests. */
function gateState() { return { active: gate.active, waiting: gate.queue.length }; }

module.exports = { createClient, extractJson, extractProse, repairJson, DEFAULTS, gateState };

/* Run it directly to check the room's model server is answering. */
if (require.main === module) {
  const c = createClient();
  console.log('probing ' + c.config.baseUrl + '  model ' + c.config.model + ' …');
  c.health().then(h => {
    console.log(h.up ? '  up — replied "' + h.sample + '" in ' + h.ms + 'ms'
                     : '  DOWN — ' + h.error);
    console.log(h.up ? '' : '\n  Set LLM_BASE_URL / LLM_MODEL, or start your server.');
    process.exit(h.up ? 0 : 1);
  });
}
