/* =====================================================================
   SEEDED RANDOMNESS
   ---------------------------------------------------------------------
   Every random thing in an agent run — who the personas are, who knows
   whom, when unannounced weather strikes — comes from here, keyed by a
   seed. Two teams given the same seed get the same population, the same
   social graph and the same weather. What differs is what their
   governments did and what their people decided about it.
   ===================================================================== */

'use strict';

/** mulberry32: small, fast, and identical on every machine. */
function rng(seed) {
  let a = hashSeed(seed) >>> 0;
  function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = list => list[Math.floor(next() * list.length)];
  /** Pick a key from {key: weight}. */
  next.weighted = table => {
    const keys = Object.keys(table);
    const total = keys.reduce((a, k) => a + table[k], 0);
    let r = next() * total;
    for (let i = 0; i < keys.length; i++) {
      r -= table[keys[i]];
      if (r <= 0) return keys[i];
    }
    return keys[keys.length - 1];
  };
  next.normal = (mean, sd) => {
    const u = Math.max(1e-12, next()), v = next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  next.shuffle = list => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };
  return next;
}

/** A stable 32-bit hash of anything printable (FNV-1a). */
function hashSeed(x) {
  if (typeof x === 'number' && isFinite(x)) return (x >>> 0) ^ 0x9E3779B9;
  const s = String(x);
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive a child seed, so sub-streams never share draws. */
function derive(seed) {
  return hashSeed(Array.prototype.slice.call(arguments).join('|'));
}

module.exports = { rng, hashSeed, derive };
