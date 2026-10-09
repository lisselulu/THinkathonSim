/* =====================================================================
   THE DECIDER — who chooses what a cohort does
   ---------------------------------------------------------------------
   One interface, two implementations:

       decide(observations) -> { A01: 'organise', A02: 'endure', ... }

   `deterministic`  arithmetic. No model, no network, no key.
   `remote`         Concordia, over HTTP. Real agents, real memory.

   The interface exists so that the question "who is deciding" has
   exactly one answer per run and it is written down in the trace. A
   platform where a model MIGHT have chosen, depending on whether a
   server happened to be up, is not a platform anybody can score.

   WHY THE DETERMINISTIC ONE IS NOT A STUB
   ---------------------------------------
   It is the control. Run a scenario with `deterministic`, run it again
   with `remote`, and the difference between them is the entire
   contribution of generative agents to the result. Without a baseline
   that plays the same game you cannot claim the agents added anything,
   and a hackathon room will ask.

   It is also what runs when the sidecar is down, which on a laptop, on a
   demo day, it will be.

   Sources for the trait coefficients: docs/EVIDENCE.md section 1.

   BIG FIVE, FINALLY CONNECTED
   ---------------------------
   `traits.js` has existed for a while and nothing read it except the
   prose writer, so personality changed how people SOUNDED and never
   what they did. The per-cohort variation in the old chooser came from
   `p.id.charCodeAt(...)` — a hash of the string "A07".

   Below, the thresholds move on the trait adjustments instead, still
   capped so circumstance dominates. A hash and a personality produce
   equally varied output; only one of them can be reasoned about.
   ===================================================================== */

'use strict';

const A = require('./action_space.js');
const T = require('./traits.js');
const L = require('./lived.js');

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   THE DETERMINISTIC CHOOSER
   ---------------------------------------------------------------------
   Ported from `lab/feed.js`, with the id-hash replaced by traits. The
   ladder is unchanged: it is a decent model of escalation and it is the
   baseline the agents are measured against, so it should not drift
   while nobody is looking.
   --------------------------------------------------------------------- */
function deterministicChoose(p, pr, sl, dis, prevKey) {
  const tr = T.profile(p.id);

  /* THRESHOLD SHIFT, FROM PERSONALITY.
     Anxious people register a given pressure as intolerable sooner;
     unflappable ones later. `threat` is capped at ±0.5 by traits.js, so
     this term spans ±8 points on a 100-point scale — the magnitude the
     literature supports, and about a sixth of what circumstance moves. */
  const t = clamp(pr.total + tr.threat * 16, 0, 100);

  // The same three dispositions, nudged by the traits that bear on them.
  const solidarity = clamp(dis.solidarity + tr.civic * 0.3, 0, 1);
  const mobility   = clamp(dis.mobility + tr.venturesome * 0.25, 0, 1);
  const trust      = clamp(dis.trust + tr.conformity * 0.2, 0, 1);

  if (sl > 0.45 && t < 30) return 'flourish';
  if (t < 18) return trust > 0.6 ? 'obey' : 'endure';
  if (t > 52 && mobility > 0.55 && pr.worst !== 'voice') return 'emigrate';
  if (t > 62 && solidarity > 0.55) return prevKey === 'organise' ? 'strike' : 'organise';
  if (t > 44 && solidarity > 0.6) return 'organise';
  if (pr.service > 45 && solidarity > 0.5) return 'mutual_aid';
  if (t > 58 && trust < 0.35) return 'breakrules';
  if (t > 40 && trust < 0.45) return 'withdraw';
  if (p.income > 70 && t > 22) return 'save';
  if (pr.voice > 35) return 'activism';
  return t > 30 ? 'debate' : 'endure';
}

/* ---------------------------------------------------------------------
   THE OBSERVATION
   ---------------------------------------------------------------------
   What crosses the wire to an agent. Built from `lived.js`, which
   constructs a citizen's view field by field from nothing.

   NOTHING GOVERNMENT-SIDE IS IN HERE, and that is enforced twice: once
   by lived.js only ever emitting permitted fields, and again by
   `assertBlind` over the serialised payload before it is sent. Belt and
   braces, because this is the constraint the whole instrument rests on
   and it fails silently if it fails at all.

   Note what is ABSENT and would be easy to include by accident: the
   levers, the score, the unrest number, the gini, what the cabinet
   said, what other cohorts chose. An agent knows its own life and what
   is being talked about. That is all anybody knows.
   --------------------------------------------------------------------- */
function observationFor(p, prev, next, ctx) {
  const view = L.livedExperience(p, prev, next);

  return {
    id: p.id,
    name: p.name,
    role: p.role,
    working: !!p.working,
    /* Circumstance the agent is entitled to feel but not to read as a
       number. Sent as coarse words for the prompt AND as the raw value
       for admissibility, which runs on our side, not theirs. */
    temperament: T.profile(p.id).words,

    year: view.year,
    money_feels: view.money_feels,
    payment_changed_by: view.payment_changed_by,
    work_feels: view.work_feels,
    services: view.services.map(s => ({ name: s.name, feel: s.feel,
                                        direction: s.direction > 0 ? 'improving'
                                          : s.direction < 0 ? 'getting worse' : 'unchanged' })),
    services_getting: view.services_getting,
    talk_of_the_town: view.talk_of_the_town,
    something_happened: view.something_happened,

    /* MEMORY. What this cohort did last round and how long it has been
       like this. An agent with no memory re-decides its life from
       scratch every two years, which is why the old chooser needed a
       `prevKey` special case to get from organising to striking. */
    last_time_i: (ctx && ctx.prevKey) || null,
    years_like_this: (ctx && ctx.yearsLikeThis) || 0
  };
}

/* Everything the agent may NOT see, kept out — and checked. */
function assertObservationBlind(obs) {
  L.assertBlind(JSON.stringify(obs));
  return true;
}

/* ---------------------------------------------------------------------
   IMPLEMENTATION 1 — DETERMINISTIC
   --------------------------------------------------------------------- */
function deterministic() {
  async function decide(batch) {
    const out = {};
    batch.forEach(b => {
      out[b.id] = deterministicChoose(b.person, b.pressure, b.slack,
                                      b.disposition, b.prevKey);
    });
    return { choices: out, source: 'deterministic' };
  }
  decide.source = 'deterministic';
  return decide;
}

/* ---------------------------------------------------------------------
   IMPLEMENTATION 2 — CONCORDIA, OVER HTTP
   ---------------------------------------------------------------------
   The engine is JavaScript and Concordia is Python, and neither of those
   is going to change. The options were to port the engine (throwing away
   a verified JS/Python parity test and the frozen artefact everything
   else is scored against) or to let the two processes talk.

   They talk. The engine stays authoritative: it sends observations and
   receives action keys, and it validates every one of them against the
   action space before acting on it. The sidecar cannot change a number,
   only choose from a menu.

   FAILURE IS NOT AN OUTAGE. If the sidecar is slow, down, or returns
   something unusable, the round falls back to the deterministic chooser
   for the cohorts it could not answer for and RECORDS that it did. A run
   half-decided by a model that nobody can identify afterwards is worse
   than no model at all.
   --------------------------------------------------------------------- */
function remote(opts) {
  opts = opts || {};
  /* WHICH POPULATION THIS DECIDER SERVES.
     The transport, the timeout, the validation and the honest fallback
     are identical for citizens and for industries; only the action table,
     the blindness scope and the arithmetic control differ. Passing them
     in keeps one implementation rather than two that drift.

     Defaults are the citizen corpus, so every existing caller is
     unchanged. */
  const table = opts.actions || A.ACTIONS;
  const menuOf = opts.menu || A.menu;
  const scope = opts.scope || 'citizen';
  const fallbackFor = opts.fallbackFor ||
    (b => deterministicChoose(b.person, b.pressure, b.slack, b.disposition, b.prevKey));
  const url = String(opts.url || 'http://127.0.0.1:8765').replace(/\/$/, '');
  /* A ROUND IS TWELVE AGENTS, NOT ONE CALL.
     This was 90s, which is a sensible timeout for a single model call
     and far too short for a round. On the first full run two rounds
     aborted mid-flight and fell back to arithmetic, and because the
     fallback is silent by design the run still finished and still
     scored -- it just was not the run it claimed to be. The fault line
     in the output was the only evidence.

     Four minutes covers twelve agents even on a slow local model with
     no concurrency; the sidecar's own thread pool usually brings a
     round in well under one. */
  const timeoutMs = opts.timeoutMs || 240000;
  const fallback = opts.fallback || deterministic();

  async function decide(batch, meta) {
    const observations = batch.map(b => b.observation);

    // The guard, on the exact payload about to leave the process.
    try {
      observations.forEach(o => L.assertBlind(JSON.stringify(o), scope));
    } catch (err) {
      if (opts.onFault) opts.onFault('blindness: ' + err.message);
      return Object.assign(await fallback(batch), { source: 'deterministic (blindness guard)' });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url + '/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          round: (meta && meta.round) || 0,
          year: (meta && meta.year) || null,
          population: scope,
          menu: menuOf(),
          observations: observations
        }),
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));

      const data = await res.json();
      const got = (data && data.choices) || {};

      /* Validate every key against the action space. A sidecar that
         invents a behaviour gets that cohort decided by arithmetic
         instead, and the fault is written down. */
      const out = {};
      const faults = [];
      batch.forEach(b => {
        const k = got[b.id];
        if (typeof k === 'string' && table[k]) {
          out[b.id] = k;
        } else {
          out[b.id] = fallbackFor(b);
          faults.push(b.id + ': ' + (k ? 'unknown action "' + k + '"' : 'no answer'));
        }
      });
      if (faults.length && opts.onFault) opts.onFault('concordia: ' + faults.join('; '));

      return {
        choices: out,
        source: faults.length === batch.length ? 'deterministic (no usable reply)' : 'concordia',
        reasoning: (data && data.reasoning) || null,
        partial: faults.length ? faults : null
      };
    } catch (err) {
      clearTimeout(timer);
      if (opts.onFault) opts.onFault('concordia: ' + (err && err.message));
      return Object.assign(await fallback(batch), { source: 'deterministic (sidecar unreachable)' });
    }
  }

  decide.source = 'concordia';
  /** Is the sidecar actually there? Called before a run, not during. */
  decide.health = async function () {
    try {
      const res = await fetch(url + '/health', { method: 'GET' });
      if (!res.ok) return { ok: false, detail: 'HTTP ' + res.status };
      return Object.assign({ ok: true }, await res.json());
    } catch (err) {
      return { ok: false, detail: (err && err.message) || 'unreachable' };
    }
  };
  /** Agents keep memory across rounds; a new run must not inherit it. */
  decide.reset = async function (seed) {
    try {
      await fetch(url + '/reset', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed: seed == null ? null : seed })
      });
      return true;
    } catch (err) { return false; }
  };
  return decide;
}

module.exports = { deterministic, remote, deterministicChoose,
                   observationFor, assertObservationBlind };
