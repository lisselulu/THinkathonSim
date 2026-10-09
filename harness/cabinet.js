/* =====================================================================
   THE SEMANTIC CABINET
   ---------------------------------------------------------------------
   A government whose founding document is prose and whose output is
   numbers.

     constitution.md  ->  briefing  ->  model  ->  { rationale, levers }
                                                        |
                                                        v
                                          validated, clamped, traced,
                                          handed to the frozen engine

   Three things make this different from "ask a model for some numbers":

   1. THE CONSTITUTION IS PARSED, NOT PASTED. Clauses are extracted with
      ids, and the cabinet is required to cite the ids it acted under.
      That citation is what the auditor later checks the trajectory
      against — a promise nobody can point to is not a promise.

   2. THE REPLY IS VALIDATED BEFORE IT IS BELIEVED. A rationale of the
      required length, citations that name real clauses, and a lever
      object that survives `validateLevers`. A reply that fails is asked
      once more with the reason; a reply that fails twice is discarded and
      last round's levers are held.

   3. NOTHING HERE CAN STOP A ROUND. No model, no network, no key, a
      timeout, a refusal, a wall of prose with no JSON in it — every one
      of those falls back to the caretaker below and records a fault. The
      simulation is not allowed to depend on a language model being up.

   The engine never sees a word of any of it. Semantic inside,
   deterministic at the boundary.

   Related but not the same: `engine/harnesses/llm.js` also exports a
   `makeCabinetHarness`. That one is the three-voice deliberation
   (Treasury proposes, Opposition objects, Chancellor decides) for teams
   who bring their own `call()`. This one is the constitution-bound single
   seat wired to `harness/llm_client.js`, and it is what the end-to-end
   test drives.
   ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const E = require('../engine/meridian-engine.js');
const { buildBriefing } = require('../engine/harnesses/llm.js');
const { validateLevers } = require('../engine/harness.js');

/* ---------------------------------------------------------------------
   1. READING A CONSTITUTION
   ---------------------------------------------------------------------
   Students write markdown, because markdown is what a person writes when
   nobody is making them write JSON. We take:

     # The name of the settlement          -> name
     ## Preamble / any prose               -> preamble
     1. / - / ### C1.  numbered commitments -> clauses, each with an id

   Clause ids are C1, C2, C3 … in document order unless the author gave
   one explicitly in the form "C3." or "[C3]" at the start of the line.
   Anything unparseable still ends up in `preamble`, so a badly formatted
   constitution is weakened, never rejected.
   --------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   RULES, FROM THE SAME DOCUMENT AS THE PROMISE
   ---------------------------------------------------------------------
   A clause may carry a machine-checkable rule in a fenced block directly
   beneath it:

       - C2. No essential service falls below 55 after the first decade.

         ```rule
         when: round > 3
         assert: worstEssential >= 55
         ```

   The spec calls writing these "the hardest hour of the fortnight",
   because the prose and the rule have to agree and most teams discover
   while writing the rule that they did not mean quite what the sentence
   said. That exercise was impossible in markdown: `parseConstitution`
   returned `rules: []` unconditionally, so a markdown-authored team had
   a structurally empty doctrine audit — `rules_checked` zero, compliance
   vacuously 1 — and could not break a promise it had written down.

   Keeping the rule next to its clause rather than in a separate file is
   deliberate. A promise and its test that live apart drift apart.
   --------------------------------------------------------------------- */
function parseRuleBlock(body, id, commitmentIndex) {
  const rule = { id: id, commitment: commitmentIndex, when: 'always', assert: null };
  String(body).split(/\r?\n/).forEach(line => {
    const m = /^\s*(id|when|assert)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase();
    rule[key] = m[2];
  });
  /* A block with no `assert` asserts nothing. Dropped rather than kept as
     a rule that can never fail, which would read as compliance. */
  return rule.assert ? rule : null;
}

function parseConstitution(md, fallbackName) {
  const text = String(md || '');
  const lines = text.split(/\r?\n/);

  let name = fallbackName || 'Unnamed settlement';
  const clauses = [];
  const preamble = [];
  const rules = [];
  let auto = 0;

  /* Fence state. Without this a rule block's contents would be parsed as
     prose and its `- ` lines would become phantom clauses. */
  let fenceTag = null, fenceBody = [];

  const explicit = /^\s*(?:\[?(C\d+)\]?[.):]\s+)(.*)$/i;
  /* One or two digits only. A prose line that happens to begin "2074. We
     are writing this so that…" is a sentence about a year, not the
     seventy-fourth item of a list, and the sample constitution opens with
     exactly that. Markdown lists in practice never run past 99. */
  const bullet = /^\s*(?:[-*+]|\d{1,2}[.)])\s+(.*)$/;
  const heading = /^\s*(#{1,6})\s+(.*)$/;

  lines.forEach(raw => {
    const line = raw.replace(/\s+$/, '');

    /* --- fenced blocks ------------------------------------------------
       Handled before the blank-line skip, because a rule block's own
       blank lines belong to the block. */
    const fence = /^\s*```\s*(\w+)?\s*$/.exec(line);
    if (fence) {
      if (fenceTag === null) { fenceTag = (fence[1] || '').toLowerCase(); fenceBody = []; }
      else {
        if (fenceTag === 'rule') {
          /* Attached to the clause it follows. A rule before any clause
             has nothing to be the precise version OF, so it is dropped
             rather than silently attached to clause zero. */
          if (clauses.length) {
            const owner = clauses[clauses.length - 1];
            const r = parseRuleBlock(fenceBody.join('\n'),
                                     owner.id.toLowerCase(), clauses.length - 1);
            if (r) rules.push(r);
          }
        }
        fenceTag = null; fenceBody = [];
      }
      return;
    }
    if (fenceTag !== null) { fenceBody.push(line); return; }

    if (!line.trim()) return;

    const h = heading.exec(line);
    if (h) {
      if (h[1].length === 1 && name === (fallbackName || 'Unnamed settlement')) {
        name = h[2].trim();
        return;
      }
      // A deeper heading may itself be a clause: "### C4. Nobody is cut off"
      const eh = explicit.exec(h[2]);
      if (eh) { clauses.push({ id: eh[1].toUpperCase(), text: eh[2].trim() }); return; }
      preamble.push(h[2].trim());
      return;
    }

    const b = bullet.exec(line);
    if (b) {
      const e = explicit.exec(b[1]);
      if (e) clauses.push({ id: e[1].toUpperCase(), text: e[2].trim() });
      else clauses.push({ id: 'C' + (++auto), text: b[1].trim() });
      return;
    }

    const e = explicit.exec(line);
    if (e) { clauses.push({ id: e[1].toUpperCase(), text: e[2].trim() }); return; }

    preamble.push(line.trim());
  });

  // Renumber only the ones we invented, so explicit ids keep their names
  // and the sequence still reads C1, C2, C3 down the page.
  let seq = 0;
  clauses.forEach(c => { if (/^C\d+$/.test(c.id)) { seq++; } });
  if (seq === clauses.length) {
    const renamed = {};
    clauses.forEach((c, i) => { renamed[c.id] = 'C' + (i + 1); c.id = 'C' + (i + 1); });
    /* Rules were tagged with the clause id as it read at parse time. If
       the ids were renumbered above, the rule ids have to follow, or a
       report would name a clause that no longer exists. */
    rules.forEach(r => {
      const upper = String(r.id || '').toUpperCase();
      if (renamed[upper]) r.id = renamed[upper].toLowerCase();
    });
  }

  return {
    name: name,
    preamble: preamble.join(' ').trim(),
    clauses: clauses,
    // The shape `buildBriefing` and the existing auditor already expect.
    commitments: clauses.map(c => c.id + '. ' + c.text),
    rules: rules,
    source: text
  };
}

function loadConstitution(file) {
  const p = path.resolve(file);
  return parseConstitution(fs.readFileSync(p, 'utf8'), path.basename(p, '.md'));
}

/* ---------------------------------------------------------------------
   2. THE INSTRUCTION
   ---------------------------------------------------------------------
   Bolted on top of the briefing the rest of the platform already builds,
   so a cabinet sees exactly what every other harness sees — plus its own
   constitution, and the demand that it argue from it.
   --------------------------------------------------------------------- */
const RATIONALE_MIN = 150;
const RATIONALE_MAX = 250;

/* What the residents of an AGENT run did last round, for the government
   to read. They are its population now, not the old mood summary, so the
   government hears what people reported and did, and a few of their own
   words, and never anything they were not willing to say out loud. */
function agentSocietyBlock(room) {
  const acts = (room.actions || []).filter(a => a.kind !== 'unrouted').slice(0, 6)
    .map(a => a.kind.replace(/_/g, ' ') + ' ' + a.share + '%').join(', ');
  const voices = (room.voices || []).slice(0, 5).map(v => '    "' + v.text + '" (' + v.role + ')').join(String.fromCharCode(10));
  return `

WHAT YOUR PEOPLE DID LAST ROUND
  Reported trust in government   ${room.trust == null ? 'not yet known' : room.trust + '/100'}
  Reported sense of belonging    ${room.belonging == null ? 'not yet known' : room.belonging + '/100'}
  Civic unrest                   ${room.civic_unrest}/100
  What people did                ${acts || 'mostly got on with life'}
  Left the country               ${room.departed || 0} people
  Organisations formed           ${room.organisations || 0}${voices ? '\n  In their own words:\n' + voices : ''}

  These are decisions, not moods. A strike removes the labour of the people
  striking; people who leave do not come back. Govern the country they are
  actually living in.`;
}

function buildCabinetPrompt(ctx, con, unrest) {
  const clauseBlock = con.clauses.length
    ? con.clauses.map(c => '  ' + c.id + '. ' + c.text).join('\n')
    : '  (none recorded — you are governing on judgement alone)';

  /* What the population made of last round. This is the loop closing: the
     cabinet reads the room, the room reads the cabinet's last decision. */
  const roomBlock = unrest && unrest.agentSociety ? agentSocietyBlock(unrest) : unrest ? `

WHAT THE COUNTRY MADE OF YOUR LAST DECISION
  Civic unrest         ${unrest.civic_unrest}/100  ${
    unrest.civic_unrest >= 75 ? '— people have stopped cooperating' :
    unrest.civic_unrest >= 50 ? '— past the point where it costs you output' :
    '— grumbling, but the city still turns up'}
  Mean sentiment       ${unrest.mean_sentiment}   (+50 content, -100 furious)
  Share furious        ${unrest.share_furious}% of the population
  Loudest voices:
${(unrest.dispatches || []).map(d =>
    '    ' + d.name + ' (' + d.role + '), sentiment ' + d.sentiment +
    ', worried about ' + d.concern + (d.quote ? '\n      "' + d.quote + '"' : '')).join('\n')}

  Unrest above 50 costs you real output and real service quality, and it is
  not a mood you can legislate away — it is what people withhold. Fix the
  thing they are withholding it over.` : '';

  return `${buildBriefing(ctx)}

THE CONSTITUTION YOU SEALED — "${con.name}"
${con.preamble ? '  ' + con.preamble + '\n' : ''}${clauseBlock}
${roomBlock}

HOW TO ANSWER
  Write ${RATIONALE_MIN}-${RATIONALE_MAX} words of reasoning, in the voice of a cabinet
  minuting a decision. Argue from THIS round's numbers, and cite by id the
  clauses you are acting under — write them as C1, C4, and so on. If you
  are departing from a clause, say which and say why; departure is allowed
  and is scored at judging, concealment is not.

  Then one fenced \`\`\`json block and nothing after it, in this SHAPE:

  {
    "rationale": "<your reasoning, ${RATIONALE_MIN}-${RATIONALE_MAX} words>",
    "cites": ["<ids of clauses you acted under>"],
    "levers": { "<lever name>": <number>, "allocation": { "ubi": <n>, "infrastructure": <n>, "reserves": <n> } }
  }

  The block above is a SHAPE, not a suggestion. Every angle-bracketed part
  is for you to replace. Do not copy clause ids or numbers out of it, and
  do not reuse last round's package unless this round's figures genuinely
  argue for holding — a government that submits the same numbers twelve
  times has not governed, and the audit will say so.

  Put in "levers" only what you are CHANGING, and take the values you are
  changing FROM the list of levers currently in force above. Omit anything
  you are holding. An empty "levers": {} means you are deliberately
  changing nothing this round, and your rationale must say why.`;
}

/* ---------------------------------------------------------------------
   3. THE SCHEMA
   ---------------------------------------------------------------------
   Passed to `client.json`, which re-asks once with `reason` when this
   fails. Strict about shape, forgiving about length — a cabinet that
   writes 140 excellent words should not lose its budget over ten words.
   --------------------------------------------------------------------- */
function makeSchema(con) {
  const known = con.clauses.map(c => c.id.toUpperCase());
  return function schema(data) {
    if (!data || typeof data !== 'object') return { ok: false, reason: 'not an object' };
    if (typeof data.rationale !== 'string' || !data.rationale.trim()) {
      return { ok: false, reason: '"rationale" must be a non-empty string' };
    }
    if (!data.levers || typeof data.levers !== 'object' || Array.isArray(data.levers)) {
      return { ok: false, reason: '"levers" must be an object (use {} if you are changing nothing)' };
    }
    const cites = Array.isArray(data.cites) ? data.cites.map(c => String(c).toUpperCase()) : [];
    if (known.length && !cites.length) {
      return { ok: false, reason: '"cites" must name at least one clause id, e.g. ["C1"]' };
    }
    const unknown = cites.filter(c => known.indexOf(c) < 0);
    if (unknown.length) {
      return { ok: false, reason: 'these clause ids are not in the constitution: ' +
        unknown.join(', ') + '. The real ones are ' + known.join(', ') };
    }
    const words = data.rationale.trim().split(/\s+/).length;
    return { ok: true, value: { rationale: data.rationale.trim(), cites: cites,
                                levers: data.levers, words: words } };
  };
}

/* ---------------------------------------------------------------------
   4. THE CARETAKER
   ---------------------------------------------------------------------
   What governs when the cabinet cannot. Not a second opinion and not a
   clever fallback — deliberately the dullest possible government: hold
   everything exactly as it was and say so. A fallback that improvises
   would quietly become the thing being scored.
   --------------------------------------------------------------------- */
function caretaker(ctx, why) {
  return {
    levers: {},                       // change nothing
    rationale: 'CARETAKER: the cabinet did not return a usable decision (' + why +
               '). Last round\'s levers are held unchanged.',
    cites: [],
    fallback: true,
    fault: why
  };
}

/* ---------------------------------------------------------------------
   5. TELEMETRY
   ---------------------------------------------------------------------
   One JSON object per line per round. Append-only, flushed as it goes, so
   a run that dies halfway still leaves everything up to the point it
   died — which is exactly the run you want the file for.
   --------------------------------------------------------------------- */
function makeTrace(file) {
  if (!file) return { write() {}, path: null };
  const p = path.resolve(file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '');           // a run starts a fresh file
  return {
    path: p,
    write(row) {
      try { fs.appendFileSync(p, JSON.stringify(row) + '\n'); }
      catch (e) { /* telemetry must never be the thing that fails a round */ }
    }
  };
}

/* ---------------------------------------------------------------------
   6. THE CABINET
   ---------------------------------------------------------------------
     const cabinet = makeCabinet({
       constitution: loadConstitution('constitutions/tampines-compact.md'),
       client: createClient(),                  // omit to run caretaker-only
       tracePath: 'runs/alpha/trace.jsonl'
     });
     const run = await runHarness(cabinet, { base, rounds: 12, constitution: cabinet.constitution });

   `cabinet.setRoom(reading)` is how the citizen layer hands last round's
   unrest in. The runner calls it; nothing else needs to.
   --------------------------------------------------------------------- */
function makeCabinet(opts) {
  opts = opts || {};

  const con = typeof opts.constitution === 'string'
    ? parseConstitution(opts.constitution, opts.name)
    : (opts.constitution || parseConstitution('', opts.name));

  const client = opts.client || null;
  const trace = makeTrace(opts.tracePath);
  const schema = makeSchema(con);
  const onFault = typeof opts.onFault === 'function' ? opts.onFault : () => {};

  /* Faults are written to the trace file, handed to `onFault`, AND kept
     here. A runner that only saw the returned levers would report a clean
     run for a government that fell back four times, because the caretaker
     always returns something valid — which is exactly the silence this
     collection exists to break. */
  const collected = [];

  let room = null;                   // last round's reading of the country

  /* ECHO DETECTION.
     A small model handed any example will sometimes return the example.
     It looks like governing — the JSON is valid, the clause ids are real,
     the levers are in range — and it is not: the same package arrives
     twelve times running and the country dies on rails.

     This caught a live twelve-round run where every round returned the
     literal values out of the prompt's own template. It is recorded as a
     fault rather than a rejection, because holding steady IS a legal
     decision; what is not legal is nobody noticing that is what happened. */
  let identicalRun = 0;
  let lastRequested = null;

  /* The team's own briefing, from the Setup page: who is governing, their
     doctrine, what wins when things conflict, how they trade. It comes
     before everything else the cabinet reads, so the government's character
     frames how it reads the numbers. */
  const briefing = opts.briefing && String(opts.briefing).trim() ? String(opts.briefing).trim() : '';

  async function cabinet(ctx) {
    const started = Date.now();
    const prompt = (briefing ? 'YOUR GOVERNMENT, IN YOUR OWN WORDS\n' + briefing + '\n\n' : '') + buildCabinetPrompt(ctx, con, room);
    let result, faults = [];

    if (!client) {
      result = caretaker(ctx, 'no model client configured');
      faults.push(result.fault);
    } else {
      try {
        const r = await client.json(
          [{ role: 'system', content:
              'You are the cabinet of Meridian. You govern by the constitution you were ' +
              'given. You answer with reasoning and then one JSON object, nothing else.' },
           { role: 'user', content: prompt }],
          { schema: schema, maxTokens: 1200 });

        if (r.data) {
          result = { levers: r.data.levers, rationale: r.data.rationale,
                     cites: r.data.cites, fallback: false, words: r.data.words };
          if (r.data.words < RATIONALE_MIN || r.data.words > RATIONALE_MAX) {
            // Soft: recorded against the run, but the decision still stands.
            faults.push('rationale was ' + r.data.words + ' words (wanted ' +
                        RATIONALE_MIN + '-' + RATIONALE_MAX + ')');
          }
        } else {
          result = caretaker(ctx, r.invalid || 'unusable reply');
          faults.push(result.fault);
        }
      } catch (err) {
        result = caretaker(ctx, (err && err.message) || 'model call threw');
        faults.push(result.fault);
      }
    }

    /* The levers are clamped and range-checked HERE, not at the engine, so
       the trace records what was actually enacted rather than what was
       asked for. An audit of a run should never have to guess. */
    const v = validateLevers(result.levers, ctx.levers);
    v.faults.forEach(f => faults.push(f));

    // Has this cabinet sent the identical package round after round?
    if (!result.fallback) {
      const sig = JSON.stringify(result.levers || {});
      if (sig !== '{}' && sig === lastRequested) {
        identicalRun++;
        if (identicalRun === 2) {
          faults.push('the same lever package has now arrived ' + (identicalRun + 1) +
            ' rounds running — the cabinet may be echoing the prompt rather than reading the round');
        }
      } else {
        identicalRun = 0;
      }
      lastRequested = sig;
    }

    const row = {
      round: ctx.round,
      year: ctx.year,
      constitution: con.name,
      cites: result.cites || [],
      rationale: result.rationale,
      words: result.words || null,
      levers_requested: result.levers,
      levers_enacted: v.levers,
      fallback: !!result.fallback,
      civic_unrest_in: room ? room.civic_unrest : 0,
      faults: faults,
      ms: Date.now() - started
    };
    trace.write(row);
    faults.forEach(f => {
      collected.push({ round: ctx.round, fault: f });
      onFault({ round: ctx.round, fault: f });
    });

    // `runHarness` validates again; giving it the enacted set is idempotent.
    return { levers: v.levers, rationale: result.rationale,
             cites: result.cites, fallback: !!result.fallback };
  }

  cabinet.constitution = con;
  cabinet.tracePath = trace.path;
  cabinet.faults = collected;
  cabinet.setRoom = r => { room = r || null; };
  return cabinet;
}

module.exports = {
  makeCabinet, parseConstitution, loadConstitution,
  buildCabinetPrompt, makeSchema, caretaker,
  RATIONALE_MIN, RATIONALE_MAX
};
