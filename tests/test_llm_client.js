/* =====================================================================
   THE PARSER
   ---------------------------------------------------------------------
       node tests/test_llm_client.js

   Every shape below is a real thing a small open model has done when
   asked for JSON. None of them needs a network; this is pure string
   handling, and it runs in milliseconds.

   The rule this file defends: a reply that CONTAINS the answer must be
   read, and a reply that does not must return null rather than a guess.
   A parser that is too strict spends a Thinkathon reporting faults about
   itself; a parser that improvises hands a country levers nobody chose.
   ===================================================================== */

'use strict';

const path = require('path');
const { extractJson, extractProse, repairJson } =
  require(path.join(__dirname, '..', 'harness/llm_client.js'));

let pass = 0, fail = 0;
function ok(cond, msg, detail) {
  if (cond) { pass++; console.log('  ok    ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')); }
}
function eq(got, want, msg) {
  ok(JSON.stringify(got) === JSON.stringify(want), msg,
     'got ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));
}

console.log('\nMeridian LLM parser\n');

/* --- the shapes that must parse -------------------------------------- */
console.log('replies that carry an object');

eq(extractJson('```json\n{"a":1}\n```'), { a: 1 }, 'a clean tagged fence');
eq(extractJson('```\n{"a":1}\n```'), { a: 1 }, 'a fence with no language tag');
eq(extractJson('Some reasoning first.\n\n```json\n{"a":1}\n```\nAnd a closing remark.'),
   { a: 1 }, 'a fence wrapped in prose');
eq(extractJson('```json\n{"a":1}\n```\nOn reflection:\n```json\n{"a":2}\n```'),
   { a: 2 }, 'two fences — the last one wins, because models correct themselves');
eq(extractJson('Here you go:\n```json\n{"a":1}'), { a: 1 },
   'a fence the model never closed');
eq(extractJson('I think the answer is { "a": 1 } given the numbers.'), { a: 1 },
   'a bare object loose in prose');
eq(extractJson('```json\n{"a":1,"b":[2,3,],}\n```'), { a: 1, b: [2, 3] },
   'trailing commas');
eq(extractJson("```json\n{'a': 1, 'b': 'two'}\n```"), { a: 1, b: 'two' },
   'single-quoted keys and values');
eq(extractJson("```json\n{\"cites\": ['C1', 'C4'], \"a\": 1}\n```"),
   { cites: ['C1', 'C4'], a: 1 }, 'single-quoted strings inside an array');
eq(extractJson('```json\n{"note":"he said {not really} and left","a":1}\n```'),
   { note: 'he said {not really} and left', a: 1 },
   'braces inside a string do not confuse the scanner');
eq(extractJson('{"outer":{"inner":{"deep":1}}}'), { outer: { inner: { deep: 1 } } },
   'nested objects');
eq(extractJson('```json\n{"a":"don\'t worry"}\n```'), { a: "don't worry" },
   'an apostrophe inside a properly quoted string survives repair');

/* --- the shapes that must NOT parse ---------------------------------- */
console.log('\nreplies that carry nothing');
eq(extractJson('The cabinet could not agree and has adjourned.'), null,
   'pure prose returns null, not a guess');
eq(extractJson(''), null, 'empty string');
eq(extractJson(null), null, 'null');
eq(extractJson(undefined), null, 'undefined');
eq(extractJson('```json\n{"a": \n```'), null, 'a fence containing broken JSON');
eq(extractJson('[1,2,3]'), null, 'a bare array is not a lever object');

/* --- prose extraction ------------------------------------------------- */
console.log('\nthe reasoning either side of it');
eq(extractProse('We are raising tax.\n\n```json\n{"a":1}\n```'), 'We are raising tax.',
   'prose is what came before the fence');
eq(extractProse('```json\n{"a":1}\n```'), '', 'no prose is an empty string, not null');
eq(extractProse('One   two\n\nthree'), 'One two three', 'whitespace collapses');

/* --- repair in isolation ---------------------------------------------- */
console.log('\nrepair');
ok(repairJson('{"a":1,}').indexOf(',}') < 0, 'trailing comma removed');
ok(repairJson("{'a':1}") === '{"a":1}', 'single-quoted key requoted');
ok(repairJson('{"a":["x","y"]}') === '{"a":["x","y"]}', 'correct JSON is left alone');

console.log('\n' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n');
process.exit(fail ? 1 : 0);
