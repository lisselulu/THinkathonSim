/* =====================================================================
   THE FEED, IN A MODEL'S WORDS
   ---------------------------------------------------------------------
   Takes the deterministic feed — who is posting, which behaviour they
   have chosen, at what intensity — and asks a model for one thing only:
   what these people would actually say.

        arithmetic decides WHO and WHAT   (lab/feed.js)
        the model decides HOW IT SOUNDS   (this file)

   Nothing here can change a behaviour, an intensity, or a number. If the
   model returns nothing usable, the templated line stands and the round
   is unaffected. A feed that fails is a feed with plainer prose, never a
   feed that stops or a country that changes.

   THE CITIZENS ARE BLIND
   ----------------------
   The prompt is built from `engine/lived.js`, which constructs a view
   containing only what a resident could plausibly know — the queue at
   the clinic, what the payment covers, whether anyone is hiring. No
   levers, no scores, no indicators. Every prompt is run through
   `assertBlind()` before it is sent, so the constraint fails loudly
   rather than eroding the first time somebody adds a field.

   One batched call per round for the whole corpus, because a model that
   sees the population together writes people who live in the same
   country as each other.
   ===================================================================== */

'use strict';

const path = require('path');
const E = require(path.join(__dirname, '..', 'engine', 'meridian-engine.js'));
const C = require(path.join(__dirname, '..', 'engine', 'citizen_friction.js'));
const T = require(path.join(__dirname, '..', 'engine', 'traits.js'));
const L = require(path.join(__dirname, '..', 'engine', 'lived.js'));

const BY_ID = {};
C.ARCHETYPES.forEach(a => { BY_ID[a.id] = a; });

/* What each behaviour means, in a citizen's terms rather than ours. The
   model is told what the person has DECIDED, and writes the post that
   decision would produce. It is never asked to choose. */
const INTENT = {
  flourish:   'using spare time on something for other people, and pleased about it',
  mutual_aid: 'covering, with neighbours, for something the state has stopped doing properly',
  endure:     'getting on with it, with nothing much to report',
  obey:       'trusting that the plan is working, and inclined to be patient',
  debate:     'arguing publicly about whether things are actually working',
  activism:   'campaigning for one specific thing to be fixed',
  save:       'holding money back because the future looks uncertain',
  organise:   'trying to get other people together to act about it',
  strike:     'stopping cooperating, together with others',
  emigrate:   'leaving the country for good',
  withdraw:   'doing the bare minimum and no longer volunteering anything',
  breakrules: 'working around the rules to get by'
};

function personBlock(post, prev, next) {
  const p = BY_ID[post.id];
  const view = L.livedExperience(p, prev, next);
  const tr = T.profile(p.id);

  const svc = view.services.map(s =>
    '      ' + s.name + ': ' + s.feel).join('\n');

  return `  ${p.id}  ${p.name} — ${p.role}
    temperament: ${tr.words}
    the payment is $${view.payment_sgd} (${view.payment_changed_by >= 0 ? '+' : ''}${view.payment_changed_by} on last time) and it ${view.money_feels}
    work: ${view.work_feels}
    the services they rely on:
${svc}
    what they have decided to do: ${INTENT[post.behaviour] || INTENT.endure}`;
}

function buildPrompt(feed, prev, next) {
  const view = L.livedExperience(C.ARCHETYPES[0], prev, next);
  const news = view.talk_of_the_town.length
    ? view.talk_of_the_town.map(t => '  · ' + t).join('\n')
    : '  · nothing much';
  const shock = view.something_happened.length
    ? '\nSomething happened this year: ' + view.something_happened.join(', ') + '.\n'
    : '';

  const people = feed.posts.map(p => personBlock(p, prev, next)).join('\n\n');

  return `It is ${next.meta.year} in Singapore. Machines do most of the work now, and
everyone receives a monthly payment from the state instead of a wage.

Below are residents who are each about to post on a public forum — the
place people go to complain, organise, show off, and argue with each
other. Write the post each of them makes.
${shock}
What people are talking about:
${news}

THE PEOPLE
${people}

HOW TO WRITE THEM
  · One post each. One to three sentences. First person.
  · Do NOT sign the post or begin with the person's name or age. The forum
    already shows who is speaking; a post that starts "Mdm Tan, 68:" reads
    like a transcript, not like somebody typing.
  · They are ordinary people posting online, not spokespeople. Specific
    and concrete: a queue, a price, a name, a Thursday. Never abstract.
  · They know their own life. They do NOT know government figures, budgets,
    tax rates or policy names, and would not use that language. Somebody
    complains that the clinic books six weeks out, not that health spending
    fell.
  · Singaporean, and lightly so — the texture of the place, not a costume.
    No heavy dialect, no exclamation marks, no hashtags.
  · Do NOT recite the exact dollar figure. People say "the payment" or "what
    they give us"; nobody quotes their own benefit to two significant
    figures in a forum post. At most one person may mention a number, and
    only if the number is the actual point of what they are saying.
  · Never quote how a service scores or is rated. Nobody knows that number.
    They know the clinic queue, not a quality score.
  · Every post says something. Not "nothing to report", not a slogan: what
    they did, who they saw, a small joy or a specific grievance.
  · Match the temperament and the decision given. A person who has decided
    to leave sounds different from one who has decided to organise.
  · Different people write differently. Do not give them all one voice.

Reply with nothing but a \`\`\`json fenced object. One key per person, using
EXACTLY the ids listed above and no others:

{
${feed.posts.map(p => '  "' + p.id + '": "what ' + BY_ID[p.id].name + ' writes"').join(',\n')}
}`;
}

/**
 * Small models sign their posts — "Mdm Tan Ah Choo - 68: ..." — because
 * the name heads their block in the prompt, and the forum already shows
 * who is speaking.
 *
 * Matched against THIS PERSON'S NAME rather than a general
 * capitalised-words-then-colon pattern. The general version looked
 * tidier and quietly ate real sentences: "The clinic books six weeks out
 * now: I gave up" became "I gave up".
 */
function stripSignature(text, name) {
  let t = String(text || '').trim();
  const first = String(name || '').split(/\s+/)[0];
  if (!first) return t;
  const esc = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The name (optionally the rest of it, optionally an age) then a colon.
  const re = new RegExp('^' + esc + "[A-Za-z.'\\- ]{0,30}\\s*(?:[-–—,]\\s*\\d{1,3})?\\s*:\\s*", 'i');
  return t.replace(re, '').trim();
}

/** All ids present, and nothing absurdly long. */
function schema(ids) {
  return function (data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'expected an object keyed by person id' };
    }
    const got = ids.filter(id => typeof data[id] === 'string' && data[id].trim());
    if (!got.length) {
      return { ok: false, reason: 'no posts found. Keys must be the ids given, like "A01"' };
    }
    if (got.length < Math.ceil(ids.length / 2)) {
      return { ok: false, reason: 'only ' + got.length + ' of ' + ids.length +
        ' people were written. Include every id.' };
    }
    const out = {};
    got.forEach(id => { out[id] = String(data[id]).trim().slice(0, 320); });
    return { ok: true, value: out };
  };
}

/**
 * voiceFeed(feed, prev, next, opts) -> feed
 *   opts.client   an llm_client; omit and the templated feed is returned
 *   opts.onFault  called with a reason when the model could not be used
 *
 * Returns a NEW feed object. The original is never modified, so a caller
 * can always fall back to it.
 */
async function voiceFeed(feed, prev, next, opts) {
  opts = opts || {};
  if (!opts.client || !feed.posts.length) return feed;

  const ids = feed.posts.map(p => p.id);
  const prompt = buildPrompt(feed, prev, next);

  /* THE GUARD. Throws rather than warns: a leak here would quietly turn
     the citizens into a second dashboard, and nobody would notice from
     the output. */
  try {
    L.assertBlind(prompt);
  } catch (err) {
    if (opts.onFault) opts.onFault(err.message);
    return feed;
  }

  try {
    const r = await opts.client.json(prompt, {
      schema: schema(ids), temperature: 0.85, maxTokens: 1400
    });
    if (!r.data) {
      if (opts.onFault) opts.onFault('feed: ' + (r.invalid || 'no usable reply'));
      return feed;
    }
    const posts = feed.posts.map(p => (r.data[p.id]
      ? Object.assign({}, p, { text: stripSignature(r.data[p.id], p.name), voiced: true })
      : p));
    return Object.assign({}, feed, { posts: posts, source: 'model' });
  } catch (err) {
    if (opts.onFault) opts.onFault('feed: ' + (err && err.message));
    return feed;
  }
}

module.exports = { voiceFeed, buildPrompt, personBlock, INTENT };
