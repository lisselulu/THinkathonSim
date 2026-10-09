/* =====================================================================
   ONE PROMPT AT A TIME
   ---------------------------------------------------------------------
       node tests/test_one_at_a_time.js

   A single GPU running LM Studio falls over under parallel agent load.
   `maxConcurrent: 1` in harness/llm.config.json must mean exactly one
   request reaches the model at a time, across EVERYTHING in the process:
   two agent runs, each with its own pool asking for concurrency, plus a
   separate client on the side, all firing at once.

   A mock model server counts how many requests are in flight together.
   ===================================================================== */

'use strict';

const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let inFlight = 0, peak = 0, served = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    inFlight++; peak = Math.max(peak, inFlight);
    setTimeout(() => {
      inFlight--; served++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }));
    }, 25);
  });
});

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail != null ? '\n          ' + detail : '')); }
}

server.listen(0, async () => {
  process.env.LLM_BASE_URL = 'http://127.0.0.1:' + server.address().port + '/v1';
  process.env.LLM_MAX_CONCURRENT = '1';
  const { createClient, gateState } = require(path.join(ROOT, 'harness/llm_client.js'));
  const { createPool } = require(path.join(ROOT, 'agents/llm_pool.js'));

  const poolA = createPool({ mode: 'live', concurrency: 8 });
  const poolB = createPool({ mode: 'live', concurrency: 8 });
  const side = createClient();
  const started = Date.now();
  await Promise.all([].concat(
    Array.from({ length: 12 }, (_, i) => poolA.decide({ key: 'a' + i, user: 'a' + i })),
    Array.from({ length: 12 }, (_, i) => poolB.decide({ key: 'b' + i, user: 'b' + i })),
    Array.from({ length: 6 }, (_, i) => side.chat('side ' + i))
  ));
  const ms = Date.now() - started;

  ok(served === 30, 'every request was answered', served + ' of 30');
  ok(peak === 1, 'never more than one request reached the model at a time, across two pools and a third client',
     'peak in flight: ' + peak);
  ok(ms >= 30 * 25, 'which is why it took as long as thirty requests in a row', ms + 'ms');
  ok(gateState().active === 0 && gateState().waiting === 0, 'and the gate is empty afterwards', JSON.stringify(gateState()));

  console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  server.close();
  process.exit(fail ? 1 : 0);
});
