"""Parity test: the JS engine and the Python mirror must agree exactly.

Runs both over the same lever sets and shock schedules and compares every
number in every round. Integers must match exactly; floats to 1e-9.

    python test_parity.py

If this fails, the two implementations have drifted and the JS one is
canonical - it is what the live platform runs.
"""

import json
import os
import subprocess
import sys

import meridian_engine as PY

HERE = os.path.dirname(os.path.abspath(__file__))
WORLD = json.load(open(os.path.join(HERE, "..", "world-states.json"), encoding="utf-8"))
BASE = WORLD["states"]["baseline_2050"]

# The demo states record the automation each society REACHED, which is the
# target it drove at.
CASES = {}
for name, key in [("baseline", "baseline_2050"), ("boom", "boom_2060"),
                  ("resilient", "resilient_2074"), ("doom", "doom_loop_2068"),
                  ("shock", "shock_2058")]:
    src = WORLD["states"][key]
    L = json.loads(json.dumps(src["levers"]))
    L["automation_target"] = {k: src["sectors"][k]["automation"] for k in PY.ORDER}
    CASES[name] = L

# A few deliberately awkward configurations, to exercise the edges.
CASES["extreme_tax"] = {**CASES["baseline"], "corporate_tax_rate": 0.45, "compute_levy": 0.30}
CASES["all_ubi"] = {**CASES["baseline"], "allocation": {"ubi": 1.0, "infrastructure": 0.0, "reserves": 0.0}}
CASES["three_day_guarantee"] = {**CASES["resilient"], "working_week_days": 3, "care_job_guarantee": True}
CASES["means_tested"] = {**CASES["boom"], "ubi_design": "means_tested"}
CASES["full_public"] = {**CASES["boom"], "public_ownership_pct": 0.50}

# THE AGENTIC CHANNELS. Every policy verb, including one invalid policy the
# kernel must drop identically on both sides, and a society whose agents
# decide spending, work, strikes, polls, births and migration.
CASES["agents"] = {**CASES["baseline"], "policies": [
    {"type": "tax", "base": "wages", "rate": 0.03},
    {"type": "tax", "base": "capital_income", "rate": 0.10},
    {"type": "tax", "base": "profit", "rate": 0.05},
    {"type": "tax", "base": "compute", "rate": 0.08},
    {"type": "tax", "base": "energy", "rate": 0.02},
    {"type": "tax", "base": "land", "rate": 0.04},
    {"type": "tax", "base": "consumption", "rate": 0.01},
    {"type": "transfer", "to": "elderly", "sgd_month": 250},
    {"type": "transfer", "to": "carers", "sgd_month": 600},
    {"type": "transfer", "to": "unemployed", "sgd_month": 400},
    {"type": "regulate", "what": "automation_cap", "sector": "care_services", "limit": 0.15},
    {"type": "regulate", "what": "automation_cap", "sector": "all", "limit": 0.80},
    {"type": "regulate", "what": "price_cap", "sector": "housing_construction", "limit": 1.05},
    {"type": "regulate", "what": "wage_floor", "limit": 1.08},
    {"type": "provide", "sector": "healthcare", "budget_bn": 6.0},
    {"type": "institution", "name": "Care Commons", "mandate": "care close to home",
     "sector": "care_services", "budget_bn": 3.5},
    {"type": "announce", "text": "Nobody will be left to age alone."},
    {"type": "tax", "base": "souls", "rate": 0.9},
]}
CASES["open_action"] = dict(CASES["baseline"])
CASES["distribution"] = dict(CASES["baseline"])
CASES["agents_doom"] = {**CASES["doom"], "policies": [
    {"type": "transfer", "to": "all", "sgd_month": 150},
    {"type": "transfer", "to": "low_income", "sgd_month": 300},
    {"type": "regulate", "what": "price_cap", "sector": "all", "limit": 0.95},
]}
CASES["events"] = dict(CASES["resilient"])

SHOCKS = {
    "baseline": {},
    "shock": {5: ["pandemic", "food_import_disruption"]},
    "extreme_tax": {3: ["chip_export_controls"], 7: ["energy_price_spike"]},
    "all_ubi": {4: ["cyber_attack"]},
    # Director events: invented weather, expressed in the deck's vocabulary,
    # mixed with a deck shock in the same round.
    "events": {
        3: [{"id": "typhoon", "label": "Typhoon Lumi", "effects": {
                "capacity_mult": {"transport_logistics": 0.7, "energy_utilities": 0.85},
                "quality": {"housing_construction": -9}, "cohesion": -3}}],
        6: ["energy_price_spike",
            {"id": "grid", "label": "Grid failure", "effects": {
                "output_mult": 0.94, "compute_price": 0.4, "legitimacy": -4}}],
        8: [{"id": "broken", "label": "An event with no effects"}],
    },
}

# ---------------------------------------------------------------------
# THE FOURTH ARGUMENT
# ---------------------------------------------------------------------
# `step(state, levers, shocks, exogenous)` carries everything that reaches
# a society from outside itself: goods and credits settled by the trade
# layer, and what the citizen agents made of last round.
#
# This suite once called `step` with three arguments only. The Python
# mirror consequently went several versions without the parameter existing
# at all, and 16,668 fields of green said nothing about it, because not one
# of them was downstream of a code path the test could reach. A parity test
# that only exercises the arguments both sides already agree on cannot fail.
#
# So: every case below runs a SECOND time with a deliberately awkward
# exogenous stream — imports and exports, borrowed and lent labour, credits
# in and out, and civic unrest driven past the threshold where people stop
# cooperating — and every field of that is compared too.

def exo_stream(name):
    """A per-case exogenous schedule. Deterministic, and unkind."""
    if name == "baseline":         # a steady trading partner
        return {r: {"reserves_bn": 4.0 if r % 2 else -2.5,
                    "capacity": {"food_agri": 1.06, "energy_utilities": 0.95},
                    "civic_unrest": 0} for r in range(2, 13)}

    if name == "shock":            # a society that gets angry under pressure
        return {r: {"civic_unrest": min(92, 20 + r * 7),
                    "headcount": {"healthcare": 3000 if r > 5 else 0}}
                for r in range(2, 13)}

    if name == "extreme_tax":      # heavy import dependence, then a cut-off
        return {r: ({"capacity": {"compute_telecom": 1.25, "manufacturing": 1.15},
                     "reserves_bn": -8.0, "civic_unrest": 35}
                    if r < 8 else
                    {"capacity": {"compute_telecom": 0.70, "manufacturing": 0.80},
                     "reserves_bn": 0, "civic_unrest": 68})
                for r in range(2, 13)}

    if name == "full_public":      # firms choosing beneath the ceiling
        # Exercises `exo.firms`, which nothing else does. A path the test
        # never sends is a path the two engines can silently disagree on
        # for as long as nobody looks.
        return {r: {"firms": {"manufacturing": {"automation": 0.25 + r * 0.03},
                              "finance": {"automation": 0.40},
                              "care_services": {"automation": 0.05}},
                    "civic_unrest": 20}
                for r in range(2, 13)}

    if name == "agents":           # households, firms and polls all deciding
        return {r: {"households": {"propensity": 0.55 + r * 0.02,
                                   "labour_supply": 0.95 - r * 0.03,
                                   "withheld": {"care_services": 0.15 if r in (5, 6) else 0,
                                                "transport_logistics": 0.30 if r == 7 else 0}},
                    "polls": {"trust": 40 + r, "belonging": 70 - r * 2},
                    "demography": {"births_mult": 0.8 + r * 0.03, "emigration": 9000 * r,
                                   "immigration": 12000},
                    "firms": {"retail_commerce": {"markup": 1.10 + r * 0.01, "wage_offer": 0.95},
                              "finance": {"markup": 1.30, "automation": 0.6},
                              "food_agri": {"markup": 0.90, "wage_offer": 1.12}},
                    "civic_unrest": 15 + r * 3}
                for r in range(2, 13)}

    if name == "open_action":      # custom moved between sectors, and an informal economy growing
        return {r: {"demand": {"retail_commerce": 0.85 - r * 0.005, "food_agri": 1.12,
                               "care_services": 1.4 if r > 8 else 1.05},
                    "informal_share": min(0.45, 0.02 * r),
                    "capacity": {"care_services": 1.08, "manufacturing": 0.93}}
                for r in range(2, 13)}

    if name == "distribution":     # a team paying people for what they do, both ways of funding it
        return {r: {"distribution": {"paid_bn": 6 + r * 1.5, "from_ubi_bn": 4 if r % 2 else 0},
                    "capacity": {"care_services": 1.1},
                    "households": {"propensity": 0.6, "labour_supply": 0.97}}
                for r in range(2, 13)}

    if name == "agents_doom":      # a country losing its people and its clinics
        return {r: {"households": {"propensity": 0.35, "labour_supply": 0.55},
                    "polls": {"trust": 12, "belonging": 25},
                    "demography": {"births_mult": 0.5, "emigration": 40000},
                    "civic_unrest": 70}
                for r in range(2, 13)}

    if name == "three_day_guarantee":   # a ceiling written under its new name
        return {r: {"civic_unrest": 30} for r in range(2, 13)}

    if name == "all_ubi":          # aid received, and gratitude for it
        return {r: {"reserves_bn": 12.0, "cohesion_bonus": 3,
                    "legitimacy_bonus": 2, "civic_unrest": 12}
                for r in range(2, 13)}

    if name == "doom":             # unrest right through the threshold
        return {r: {"civic_unrest": max(0, (r - 3) * 11)} for r in range(2, 13)}

    if name == "means_tested":     # lending its own people out
        return {r: {"headcount": {"care_services": -12000},
                    "reserves_bn": 6.0, "civic_unrest": 55}
                for r in range(2, 13)}

    # everything else: a light, constant breeze, plus unrest exactly ON the
    # threshold, where the drag must still be precisely zero on both sides.
    return {r: {"capacity": {"transport_logistics": 1.02}, "reserves_bn": 1.5,
                "civic_unrest": 50} for r in range(2, 13)}


EXOGENOUS = {name: exo_stream(name) for name in CASES}

JS_RUNNER = r"""
const E = require(process.argv[6]);
const fs = require('fs');
const world = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const shocks = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const exo = JSON.parse(fs.readFileSync(process.argv[7], 'utf8'));
const out = {};
const TICKS = 72;
Object.keys(cases).forEach(name => {
  const sched = {};
  Object.keys(shocks[name] || {}).forEach(r => { sched[+r] = shocks[name][r]; });

  // Pass 1: the society alone in the world.
  const traj = E.runTrajectory(world.states.baseline_2050, cases[name], sched, 12);

  // Pass 2: the same society with the world reaching into it.
  const stream = exo[name] || {};
  const exoFor = r => stream[r] || null;
  const traj2 = E.runTrajectory(world.states.baseline_2050, cases[name], sched, 12, exoFor);

  // Pass 3: MONTHLY TICKS, with the same shocks and the same world reaching
  // in. Six ticks stand in for each round of the schedule, so every shock
  // and every channel is exercised across refreshes of every cadence.
  const ticks = [E.seed(world.states.baseline_2050)];
  for (let i = 1; i <= TICKS; i++) {
    const prev = ticks[ticks.length - 1];
    const r = Math.min(12, 2 + Math.floor((i - 1) / 6));
    const drawn = (sched[r] || []).slice();
    (prev._endogenousNext || []).forEach(x => { if (drawn.indexOf(x) < 0) drawn.push(x); });
    ticks.push(E.step(prev, cases[name], drawn, stream[r] || null, { dt: 1 / 12 }));
  }

  out[name] = { traj: traj, score: E.score(traj),
                traj_exo: traj2, score_exo: E.score(traj2), ticks: ticks };
});
fs.writeFileSync(process.argv[5], JSON.stringify(out));
"""


def _numeric_carry(v):
    """Is this carry-forward value a number, or a flat map of numbers?

    Engine-internal keys prefixed with `_` used to be skipped wholesale.
    That was right for the ones holding shock names or flags, and wrong
    for the numeric ones: `_computePrice`, `_computeTightness`,
    `_capitalIndex` and `_sectorCapital` are STATE, they feed the next
    round, and the two engines could drift on them while every published
    field still agreed. The drift would surface later, somewhere else,
    looking like a different bug.

    Worse for `_sectorCapital` specifically: it is computed but not yet
    applied, so a divergence there would be invisible until the weight is
    raised and then arrive as a mystery.
    """
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, dict):
        return bool(v) and all(
            isinstance(x, (int, float)) and not isinstance(x, bool) for x in v.values())
    return False


def flatten(obj, prefix=""):
    """Flatten to {path: value}.

    Engine-internal carry-forward is included when it is numeric, because
    it is state the next round reads; non-numeric internals (shock lists,
    flags) are still skipped.
    """
    flat = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_") and not _numeric_carry(v):
                continue
            flat.update(flatten(v, prefix + "." + str(k) if prefix else str(k)))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            flat.update(flatten(v, prefix + "[" + str(i) + "]"))
    else:
        flat[prefix] = obj
    return flat


TICKS = 72


def main():
    tmp = os.path.join(HERE, ".parity")
    os.makedirs(tmp, exist_ok=True)
    cases_f = os.path.join(tmp, "cases.json")
    shocks_f = os.path.join(tmp, "shocks.json")
    out_f = os.path.join(tmp, "js.json")
    run_f = os.path.join(tmp, "run.js")
    exo_f = os.path.join(tmp, "exogenous.json")

    json.dump(CASES, open(cases_f, "w", encoding="utf-8"))
    json.dump(SHOCKS, open(shocks_f, "w", encoding="utf-8"))
    json.dump(EXOGENOUS, open(exo_f, "w", encoding="utf-8"))
    open(run_f, "w", encoding="utf-8").write(JS_RUNNER)

    r = subprocess.run(
        ["node", run_f, os.path.join(HERE, "..", "world-states.json"), cases_f, shocks_f, out_f,
         os.path.join(HERE, "meridian-engine.js"), exo_f],
        cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0:
        print("node failed:\n" + r.stderr)
        return 1
    js = json.load(open(out_f, encoding="utf-8"))

    total_fields = 0
    failures = []

    for name, levers in CASES.items():
        sched = {int(k): v for k, v in SHOCKS.get(name, {}).items()}
        py_traj = PY.run_trajectory(BASE, levers, sched, 12)
        py_score = PY.score(py_traj)

        stream = EXOGENOUS.get(name, {})
        py_traj2 = PY.run_trajectory(BASE, levers, sched, 12,
                                     exogenous_for=lambda r, s=stream: s.get(r))
        py_score2 = PY.score(py_traj2)

        # The exogenous pass must actually MOVE something, or it is testing
        # nothing. A silent no-op here is exactly how the drift hid before.
        if flatten(py_traj) == flatten(py_traj2):
            failures.append((name, "exogenous had no effect on the trajectory",
                             "identical", "identical"))

        # Pass 3: monthly ticks. Mirrors the JS runner above.
        py_ticks = [PY.seed(BASE)]
        for i in range(1, TICKS + 1):
            prev = py_ticks[-1]
            r = min(12, 2 + (i - 1) // 6)
            drawn = list(sched.get(r, []))
            for x in (prev.get("_endogenousNext") or []):
                if x not in drawn:
                    drawn.append(x)
            py_ticks.append(PY.step(prev, levers, drawn, stream.get(r), {"dt": 1 / 12}))
        if flatten(py_ticks[-1]) == flatten(py_traj[1]):
            failures.append((name, "ticks did not advance the country", "identical", "identical"))

        for label, py_obj, js_obj in (("traj", py_traj, js[name]["traj"]),
                                      ("score", py_score, js[name]["score"]),
                                      ("traj_exo", py_traj2, js[name]["traj_exo"]),
                                      ("score_exo", py_score2, js[name]["score_exo"]),
                                      ("ticks", py_ticks, js[name]["ticks"])):
            pf, jf = flatten(py_obj), flatten(js_obj)
            keys = set(pf) | set(jf)
            for k in sorted(keys):
                total_fields += 1
                pv, jv = pf.get(k, "<missing>"), jf.get(k, "<missing>")
                if isinstance(pv, bool) or isinstance(jv, bool):
                    ok = pv == jv
                elif isinstance(pv, (int, float)) and isinstance(jv, (int, float)):
                    ok = abs(pv - jv) <= 1e-9 * max(1.0, abs(pv), abs(jv))
                else:
                    ok = pv == jv
                if not ok:
                    failures.append((name, label + "." + k, pv, jv))

    print("Meridian engine parity — JS v{} vs Python v{}".format(
        "1.0.0", PY.__version__))
    print("  {} cases x 3 passes (alone, with an exogenous world, and under {} monthly ticks), "
          "{} fields compared".format(len(CASES), TICKS, total_fields))
    if failures:
        print("  {} MISMATCHES:".format(len(failures)))
        for f in failures[:40]:
            print("    [{}] {}\n       py={!r}\n       js={!r}".format(*f))
        if len(failures) > 40:
            print("    ... and {} more".format(len(failures) - 40))
        return 1
    print("  PASS — the two implementations agree exactly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
