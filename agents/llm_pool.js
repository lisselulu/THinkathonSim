/* =====================================================================
   THE MODEL POOL
   ---------------------------------------------------------------------
   Every agent decision in a run goes through here. It does four jobs the
   plain client does not:

   1. BOUNDED CONCURRENCY. LM Studio fell over twice under a warm-up that
      fired every request at once. A batching server on the DGX takes far
      more, but no server takes unbounded load. `concurrency` is the one
      knob, and requests beyond it queue.

   2. STRUCTURED OUTPUT. Each call carries a JSON schema. Servers that
      enforce it at the decoder return a valid object every time; servers
      that don't still get the defensive parser.

   3. THE DECISION LOG. Every request and every reply is written down,
      keyed by what was asked, whether or not the call succeeded. A run is
      then reproducible without the model: replay mode answers every call
      from the log, so the identical decisions produce the identical
      country, bit for bit.

   4. HONEST ACCOUNTING. The pool counts model answers, failures and
      replays, so a run can say exactly how much of it the agents decided.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient, extractJson } = require('../harness/llm_client.js');
const { hashSeed } = require('./rng.js');

function createPool(opts) {
  opts = opts || {};
  const mode = opts.mode || 'live';                 // live | record | replay
  const concurrency = Math.max(1, opts.concurrency || 4);
  const client = opts.client || (mode === 'replay' ? null : createClient(opts.clientOptions || {}));
  const logPath = opts.logPath || null;
  /* INSIST. A run that is being taken seriously never swaps a model's
     decision for a rule's: a fallback is a different society, not a slower
     one. With `insist`, a reply that does not validate is asked again, a
     server that has gone away is waited for however long it takes, and the
     run simply takes longer. Only a stop from the person running it ends
     the wait. Everything it cost in time is counted. */
  const insist = !!opts.insist && mode !== 'replay';
  const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
  const shouldPause = typeof opts.shouldPause === 'function' ? opts.shouldPause : () => false;
  const onWait = typeof opts.onWait === 'function' ? opts.onWait : () => {};
  let waitingOn = null;
  function stopError() { const e = new Error('stopped while waiting for the model'); e.stopped = true; return e; }
  async function sleepUnlessStopped(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (shouldStop()) throw stopError();
      await new Promise(r => setTimeout(r, Math.min(250, Math.max(1, until - Date.now()))));
    }
  }
  async function whilePaused() {
    if (!shouldPause()) return;
    const from = Date.now();
    waitingOn = { reason: 'paused', since: from, attempts: 0 };
    onWait(waitingOn);
    while (shouldPause()) await sleepUnlessStopped(250);
    stats.paused_ms += Date.now() - from;
    waitingOn = null;
  }

  const stats = { calls: 0, model: 0, failed: 0, replayed: 0, missing: 0, ms: 0,
                  /* What insisting cost: replies asked for again, and time
                     spent waiting on the model or on a pause. */
                  retries: 0, waited_ms: 0, paused_ms: 0, logged: 0, unlogged: 0,
                  /* What the calls actually cost, as the server reported it.
                     prompt_cached is the part of the prompt the server reused
                     rather than read again. */
                  prompt_tokens: 0, completion_tokens: 0, prompt_cached_tokens: 0 };

  /* Replay reads the whole log up front. A key that is absent is a
     MISSING decision, reported, never invented. */
  const recorded = new Map();
  if (mode === 'replay') {
    if (!logPath || !fs.existsSync(logPath)) throw new Error('replay needs an existing decision log: ' + logPath);
    const text = /\.gz$/.test(logPath) ? require('zlib').gunzipSync(fs.readFileSync(logPath)).toString('utf8')
                                       : fs.readFileSync(logPath, 'utf8');
    text.split('\n').forEach(line => {
      if (!line.trim()) return;
      try { const row = JSON.parse(line); recorded.set(row.key, row); } catch (e) { /* skip a torn line */ }
    });
  }
  let logStream = null;
  if (mode === 'record' && logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    logStream = fs.openSync(logPath, 'w');
  }

  let active = 0;
  const queue = [];
  /* RECOVERY. LM Studio stopped answering mid-run three times. Without
     this, every decision queued behind the outage failed within seconds
     and became a labelled fallback, and one blip turned a round into the
     baseline. Now a connection failure pauses the pool while it probes
     the server, for up to `recoverMs`, and only then gives up. */
  const recoverMs = insist ? Infinity : (opts.recoverMs == null ? 120000 : opts.recoverMs);
  let outage = null;
  function isConnectionError(msg) { return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|network/i.test(msg || ''); }
  async function waitForServer() {
    if (!outage) {
      stats.outages = (stats.outages || 0) + 1;
      outage = (async () => {
        const until = Date.now() + recoverMs;
        while (Date.now() < until) {
          if (shouldStop()) return false;
          await new Promise(r => setTimeout(r, opts.probeMs || 3000));
          try { const h = await client.health(); if (h && h.up) return true; } catch (e) { /* still down */ }
        }
        return false;
      })().finally(() => { setTimeout(() => { outage = null; }, 0); });
    }
    return outage;
  }
  function acquire() {
    if (active < concurrency) { active++; return Promise.resolve(); }
    return new Promise(res => queue.push(res));
  }
  function release() {
    const nextUp = queue.shift();
    if (nextUp) nextUp(); else active--;
  }

  /**
   * decide({ key, system, user, schema, jsonSchema, maxTokens, seed })
   *   -> { data, text, source: 'model'|'replay'|'failed', error }
   *
   * `key` must identify the decision independently of timing: who is
   * deciding, when, and about what. The prompt's hash is folded in, so a
   * changed prompt is a different decision and never replays a stale one.
   */
  /* One decision, asked for until it arrives. */
  async function decide(req) {
    if (!insist) return attempt(req);
    let n = 0;
    const from = Date.now();
    for (;;) {
      if (shouldStop()) throw stopError();
      await whilePaused();
      /* A different seed each time: asking the identical question the
         identical way would get the identical unusable answer. */
      const out = await attempt(n ? Object.assign({}, req, { seed: (req.seed || 0) + n * 7919 }) : req, n > 0);
      if (out.data) {
        if (n) { stats.waited_ms += Date.now() - from; waitingOn = null; }
        return out;
      }
      if (shouldStop()) throw stopError();
      n++;
      stats.failed--; stats.retries++;
      waitingOn = { reason: out.error || 'unusable reply', since: from, attempts: n, key: req.key };
      onWait(waitingOn);
      await sleepUnlessStopped(Math.min(opts.maxBackoffMs || 30000, (opts.backoffMs || 500) * Math.pow(2, Math.min(n, 6))));
    }
  }

  async function attempt(req, isRetry) {
    if (!isRetry) stats.calls++;
    const promptHash = hashSeed((req.system || '') + '\u0000' + req.user).toString(16);
    const key = req.key + '#' + promptHash;

    if (mode === 'replay') {
      const row = recorded.get(key);
      if (!row) { stats.missing++; return { data: null, text: null, source: 'failed', error: 'not in decision log', key }; }
      stats.replayed++;
      const data = row.text ? extractJson(row.text) : null;
      const check = data && req.schema ? req.schema(data) : { ok: !!data, value: data };
      return { data: check.ok ? check.value : null, text: row.text,
               source: row.source === 'model' && check.ok ? 'replay' : 'failed',
               error: row.error || (check.ok ? null : check.reason), key };
    }

    if (outage) await outage;
    await acquire();
    /* STOP MEANS NOW. A month's decisions are all asked for at once and
       wait here for their turn. Checking only before the wait meant a stop
       still let every queued call run, minutes of them. Checked again the
       moment a call gets its turn, a stop costs the one call in flight. */
    if (shouldStop()) { release(); throw stopError(); }
    const started = Date.now();
    let out = null;
    let lostServer = null;
    try {
      const messages = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      messages.push({ role: 'user', content: req.user });
      const r = await client.json(messages, {
        schema: req.schema, jsonSchema: req.jsonSchema, schemaName: req.schemaName,
        maxTokens: req.maxTokens || 700, seed: req.seed, temperature: req.temperature
      });
      if (r.usage) {
        stats.prompt_tokens += r.usage.prompt || 0;
        stats.completion_tokens += r.usage.completion || 0;
        stats.prompt_cached_tokens += r.usage.cached || 0;
      }
      if (r.data) { stats.model++; out = { data: r.data, text: r.text, source: 'model', key }; }
      else { stats.failed++; out = { data: null, text: r.text, source: 'failed', error: r.invalid || 'unusable reply', key }; }
    } catch (err) {
      const msg = (err && err.message) || 'model call threw';
      /* A lost connection is handled AFTER the slot is released, exactly
         once: waiting for the server while holding a slot would starve
         every other decision queued behind it. */
      if (recoverMs > 0 && isConnectionError(msg) && !req._retried) lostServer = msg;
      else { stats.failed++; out = { data: null, text: null, source: 'failed', error: msg, key }; }
    } finally {
      stats.ms += Date.now() - started;
      release();
    }
    if (lostServer) {
      const back = await waitForServer();
      if (back) return attempt(Object.assign({}, req, { _retried: true }), true);
      stats.failed++;
      out = { data: null, text: null, source: 'failed', key,
              error: lostServer + ' (the server did not come back within ' + Math.round(recoverMs / 1000) + 's)' };
    }
    /* Kept unless the caller says this one need not be: with a thousand
       residents the full transcript of every decision is most of what a run
       weighs, and only a followed panel's is ever read. */
    if (logStream != null && req.log !== false) {
      fs.writeSync(logStream, JSON.stringify({ key: key, source: out.source, text: out.text,
                                               error: out.error || null }) + '\n');
      stats.logged++;
    } else if (logStream != null) stats.unlogged++;
    return out;
  }

  async function health() {
    if (mode === 'replay') return { up: true, model: 'replay:' + path.basename(logPath), replay: true };
    return client.health();
  }

  function close() { if (logStream != null) { fs.closeSync(logStream); logStream = null; } }

  /** Share of decisions that came from a model or a faithful replay. */
  function agentShare() {
    const decided = stats.model + stats.replayed;
    const all = decided + stats.failed + stats.missing;
    return all ? decided / all : 0;
  }

  /** Is the run being held up right now, and by what? */
  function state() { return { insist: insist, waiting: waitingOn ? Object.assign({}, waitingOn) : null }; }

  return { decide, health, close, stats, agentShare, mode, concurrency, state, insist,
           model: client ? client.config.model : 'replay' };
}

module.exports = { createPool };
