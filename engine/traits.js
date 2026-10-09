/* =====================================================================
   PERSONALITY — the Big Five, and what it is allowed to do
   ---------------------------------------------------------------------
   Five traits, each 0-1, attached to every cohort in the corpus:

     O  openness           curiosity, tolerance of change
     C  conscientiousness  planning, rule-following, duty
     E  extraversion       sociability, assertion
     A  agreeableness      compassion, cooperation
     N  neuroticism        anxiety, threat sensitivity

   WHY NOT MBTI
   ------------
   MBTI is the popular one and it fails the project's own rule that no
   number is arbitrary. Between a quarter and a third of people change at
   least one letter on retest; six-month stability sits around 0.55-0.75
   against the Big Five's 0.75-0.90; and it is, in the literature's own
   phrasing, virtually unused in psychological research. There is no
   published effect size linking "INFP" to volunteering, because nobody
   who studies volunteering uses the instrument.

   The Big Five has what we actually need: population distributions, and
   measured links to the specific behaviours this simulation models.

   HOW MUCH PERSONALITY IS ALLOWED TO MATTER
   -----------------------------------------
   Very little, and this is the most important line in the file.

   The evidence on personality and civic engagement reports effects that
   are "small but robust" - real, replicated, and modest, comparable in
   magnitude to age, education or income rather than dominating them.

   So traits SHIFT THRESHOLDS AT THE MARGIN. They never override
   circumstance. A cheerful, agreeable, open person whose hospital has
   collapsed and whose payment buys nothing is still in trouble, and the
   simulation must say so. If personality could rescue a cohort from bad
   policy, the whole teaching point would invert: teams would be scored
   on the luck of the draw rather than on how they governed.

   Every coefficient below is capped so that the total swing from
   personality is a fraction of the swing from circumstance. That is
   deliberate, it is evidenced, and it should stay that way.

   Sources for everything below: docs/EVIDENCE.md sections 1.1-1.4.

   DIRECTIONS, FROM THE LITERATURE
   -------------------------------
   Agreeableness, extraversion and openness are associated with MORE
   civic engagement - volunteering and charitable giving especially.
   Conscientiousness and neuroticism are associated with LESS.

   The conscientiousness sign surprises people, so it is worth stating
   plainly rather than quietly reversing it because it feels wrong: the
   finding is that conscientious people report less of this kind of
   engagement, not more. Duty to one's own obligations is not the same
   thing as duty to strangers.
   ===================================================================== */

'use strict';

const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

/* ---------------------------------------------------------------------
   ASSIGNMENT
   ---------------------------------------------------------------------
   PLACEHOLDER, and labelled as such. These are hand-set per cohort to be
   plausible and varied rather than sampled from a fitted distribution.

   Phase 1 replaces this with draws from published population norms, so
   that the corpus reproduces a real spread rather than one author's
   intuitions about who is anxious. Until then, no result that depends on
   the precise value of a trait should be reported as a finding.
   --------------------------------------------------------------------- */
const TRAITS = {
  A01: { o: 0.45, c: 0.70, e: 0.55, a: 0.60, n: 0.45 },  // Rahim, logistics
  A02: { o: 0.30, c: 0.75, e: 0.40, a: 0.70, n: 0.55 },  // Mdm Tan, retired
  A03: { o: 0.55, c: 0.80, e: 0.60, a: 0.85, n: 0.40 },  // Sister Grace, nurse
  A04: { o: 0.75, c: 0.45, e: 0.65, a: 0.60, n: 0.60 },  // Nurul, ITE grad
  A05: { o: 0.60, c: 0.75, e: 0.70, a: 0.35, n: 0.25 },  // Daniel Ong, capital
  A06: { o: 0.85, c: 0.40, e: 0.60, a: 0.65, n: 0.50 },  // Farah, gig artisan
  A07: { o: 0.65, c: 0.70, e: 0.35, a: 0.50, n: 0.35 },  // Wei Sheng, data centre
  A08: { o: 0.40, c: 0.65, e: 0.45, a: 0.75, n: 0.65 },  // Priya, single parent
  A09: { o: 0.35, c: 0.60, e: 0.75, a: 0.70, n: 0.40 },  // Lim Boon Hock, hawker
  A10: { o: 0.35, c: 0.55, e: 0.30, a: 0.60, n: 0.70 },  // Mr Krishnan, chronic illness
  A11: { o: 0.70, c: 0.75, e: 0.60, a: 0.80, n: 0.45 },  // Cheryl Goh, teacher
  A12: { o: 0.55, c: 0.70, e: 0.50, a: 0.45, n: 0.60 }   // Marcus Teo, displaced
};

const DEFAULT = { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 };

function traitsFor(id) {
  return TRAITS[id] || DEFAULT;
}

/* ---------------------------------------------------------------------
   WHAT TRAITS DO
   ---------------------------------------------------------------------
   Each returns a small signed adjustment, and the caps are the point.
   `civic` moves a threshold by at most about eight points on a
   hundred-point pressure scale; circumstance routinely moves it by fifty.
   --------------------------------------------------------------------- */

/** Propensity to act WITH others: organising, mutual aid, volunteering. */
function civic(t) {
  // A, E, O positive; C and N negative. Centred so 0.5 across the board
  // gives exactly zero adjustment.
  const raw = (t.a - 0.5) * 0.40 + (t.e - 0.5) * 0.30 + (t.o - 0.5) * 0.20
            - (t.c - 0.5) * 0.15 - (t.n - 0.5) * 0.25;
  return clamp(raw, -0.5, 0.5);
}

/** Willingness to uproot. Openness travels; neuroticism stays home. */
function venturesome(t) {
  const raw = (t.o - 0.5) * 0.45 - (t.n - 0.5) * 0.30 + (t.e - 0.5) * 0.15;
  return clamp(raw, -0.5, 0.5);
}

/** How early a given pressure registers as intolerable. */
function threatSensitivity(t) {
  const raw = (t.n - 0.5) * 0.50 - (t.a - 0.5) * 0.10;
  return clamp(raw, -0.5, 0.5);
}

/** Deference to the arrangement as it stands. */
function conformity(t) {
  const raw = (t.c - 0.5) * 0.40 - (t.o - 0.5) * 0.30;
  return clamp(raw, -0.5, 0.5);
}

/**
 * A short phrase for a prompt or a UI, so a page never has to print five
 * decimals at a reader. Descriptive only; nothing reads this back.
 */
function describe(t) {
  const bits = [];
  /* No pronouns. An earlier version said "set in her ways" for every
     cohort, which described a 74-year-old man named Mr Krishnan as her. */
  if (t.o >= 0.7) bits.push('curious'); else if (t.o <= 0.35) bits.push('set in their ways');
  if (t.c >= 0.7) bits.push('dutiful'); else if (t.c <= 0.35) bits.push('improvises');
  if (t.e >= 0.7) bits.push('sociable'); else if (t.e <= 0.35) bits.push('private');
  if (t.a >= 0.75) bits.push('looks after people'); else if (t.a <= 0.35) bits.push('guarded');
  if (t.n >= 0.65) bits.push('anxious'); else if (t.n <= 0.3) bits.push('unflappable');
  return bits.slice(0, 3).join(', ') || 'even-tempered';
}

/** Every adjustment for one cohort, in one object. */
function profile(id) {
  const t = traitsFor(id);
  return {
    big_five: t,
    civic: civic(t),
    venturesome: venturesome(t),
    threat: threatSensitivity(t),
    conformity: conformity(t),
    words: describe(t)
  };
}

module.exports = { TRAITS, traitsFor, profile, civic, venturesome,
                   threatSensitivity, conformity, describe };
