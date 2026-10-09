"""
THE MERIDIAN SIMULATION - LAYER 1 ENGINE (Python mirror)
=========================================================
world state + lever settings  ->  next world state

This is a line-for-line mirror of `meridian-engine.js`, which is the
canonical implementation the live platform runs. The section numbers here
match the section numbers there, so you can read them side by side.

`test_parity.py` runs both engines over the same lever sets and asserts
they agree to the last decimal place. If you change one, change the other,
and let the parity test tell you that you did it right.

READ THIS FILE. You are meant to. Reason about it, argue with the
constants, plan against it. You may not modify it during the run.

THE ONE THING TO UNDERSTAND
---------------------------
Nothing in here has an opinion about whether automation is good. The
engine only does bookkeeping, and the bookkeeping forms a ring:

    automation removes headcount
      -> headcount is a wage bill
         -> wages are household income
            -> household income becomes consumption
               -> consumption is the demand sectors sell into
                  -> sales are the profit you tax
                     -> tax funds the UBI that replaced the wages

Margins, profit, GDP, quality and cohesion are all DERIVED from that ring.
The demand cliff is not written down anywhere as a rule. It is what
happens when you go round the ring enough times.

The single most important line in this file is marked THE CLIFF.
"""

from __future__ import annotations

import copy
import json
import math
import os
from typing import Any, Callable, Dict, List, Optional, Sequence

__version__ = "1.0.0"


# ---------------------------------------------------------------------
# 0. HELPERS
# ---------------------------------------------------------------------
def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def js_round(v: float) -> int:
    """JavaScript's Math.round: halves go toward +Infinity.

    Python's built-in round() uses banker's rounding, which disagrees with
    JS on exact halves. Parity depends on this function.
    """
    return math.floor(v + 0.5)


def js_sum(values) -> float:
    """JavaScript's [].reduce((a, b) => a + b, 0): a plain left-to-right fold.

    Python's built-in sum() uses Neumaier compensated summation on floats
    (CPython 3.12+). It is the more accurate of the two, and that is the
    problem: it disagrees with JS in the last bit, and the last bit is
    enough to move a rounded figure. A mean gini of exactly 0.375 rounds to
    0.38 from Python's sum and 0.37 from JS's reduce.

    Parity depends on this function everywhere floats are summed. Integer
    sums are safe either way; the guard is only for floats.
    """
    total = 0.0
    for v in values:
        total += v
    return total


def round2(v: float) -> float:
    return js_round(v * 100) / 100


def deep_clone(o):
    return copy.deepcopy(o)


# ---------------------------------------------------------------------
# 1. EXOGENOUS DEMOGRAPHY
# ---------------------------------------------------------------------
# Population is not a lever. Singapore 2050-2074 ages and shrinks whatever
# you do. This is the ground the whole simulation stands on: demand for
# care and healthcare climbs every round while the working-age base that
# could staff it falls every round.
# The missions are authored once, in JS, and exported to JSON so this
# mirror reads the SAME table rather than a retyped copy of it. A
# scorecard that disagrees between the two engines is a parity failure
# that looks like an economics bug.
_MISSION_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "sector_missions.json")
with open(_MISSION_PATH, "r", encoding="utf-8") as _fh:
    _MISSION_DATA = json.load(_fh)
MISSION_DIMENSIONS: Dict[str, float] = _MISSION_DATA["dimensions"]
MISSIONS: Dict[str, Any] = _MISSION_DATA["missions"]


def score_against_mission(key: str, signals: Dict[str, float], base: float) -> float:
    """Mirrors scoreAgainstMission() in sector_missions.js."""
    m = MISSIONS.get(key)
    total = base
    if not m:
        return total
    for d, w in m["kpi"].items():
        scale = MISSION_DIMENSIONS.get(d)
        if scale is None:
            continue
        total += w * scale * signals.get(d, 0)
    return total


DEMOGRAPHY_ANCHORS = [
    {"round": 1,  "total": 5940000, "age_0_19": 950000, "age_20_64": 3325000, "age_65_plus": 1665000},
    {"round": 5,  "total": 5830000, "age_0_19": 900000, "age_20_64": 3150000, "age_65_plus": 1780000},
    {"round": 6,  "total": 5780000, "age_0_19": 880000, "age_20_64": 3090000, "age_65_plus": 1810000},
    {"round": 10, "total": 5650000, "age_0_19": 790000, "age_20_64": 2910000, "age_65_plus": 1950000},
    {"round": 12, "total": 5520000, "age_0_19": 810000, "age_20_64": 2760000, "age_65_plus": 1950000},
]


def demography_tick(prev: Dict[str, Any], d: Optional[Dict[str, Any]], t_next: float,
                    due: bool, k: float) -> Dict[str, Any]:
    """Demography under ticks. Mirrors demographyTick."""
    was = prev.get("_demoPending") or {"births": 0, "n": 0, "emigration": 0, "immigration": 0}
    pending = {"births": was["births"], "n": was["n"], "emigration": was["emigration"], "immigration": was["immigration"]}
    if d:
        bm = d.get("births_mult")
        bm = 1 if bm is None else bm
        try:
            bm = float(bm)
        except (TypeError, ValueError):
            bm = 0.0
        if not math.isfinite(bm):
            bm = 0.0
        pending["births"] += clamp(bm, 0.3, 2)
        pending["n"] += 1
        pending["emigration"] += _num_or_zero(d.get("emigration"))
        pending["immigration"] += _num_or_zero(d.get("immigration"))
    if not due:
        b = prev["population"]["by_age"]
        return {"total": prev["population"]["total"], "age_0_19": b["age_0_19"], "age_20_64": b["age_20_64"],
                "age_65_plus": b["age_65_plus"], "_adj": prev.get("_popAdjust") or None, "_pending": pending}
    anchor = demography(1 + t_next / 2)
    adj_in = prev.get("_popAdjust") or None
    acted = pending["n"] > 0
    fresh = {"births": 0, "n": 0, "emigration": 0, "immigration": 0}
    if not adj_in and not acted:
        out = dict(anchor)
        out["_adj"] = None
        out["_pending"] = fresh
        return out
    adj = {
        "age_0_19": adj_in["age_0_19"] if adj_in else 0,
        "age_20_64": adj_in["age_20_64"] if adj_in else 0,
        "age_65_plus": adj_in["age_65_plus"] if adj_in else 0,
    }
    if acted:
        adj["age_0_19"] += js_round((pending["births"] / pending["n"] - 1) * P.BIRTHS_PER_ROUND * k)
        adj["age_20_64"] += js_round(clamp(pending["immigration"] - pending["emigration"], -400000, 400000))
        hq = prev["sectors"]["healthcare"]["quality"] if "healthcare" in prev["sectors"] else P.Q_BASE
        failure = clamp((60 - hq) / 60, 0, 1)
        adj["age_65_plus"] -= js_round(prev["population"]["by_age"]["age_65_plus"] * MORTALITY_65_PLUS * 2 * k
                                       * P.HEALTH_MORTALITY_SENS * failure)
    out = {
        "age_0_19": max(0, anchor["age_0_19"] + adj["age_0_19"]),
        "age_20_64": max(0, anchor["age_20_64"] + adj["age_20_64"]),
        "age_65_plus": max(0, anchor["age_65_plus"] + adj["age_65_plus"]),
    }
    out["total"] = out["age_0_19"] + out["age_20_64"] + out["age_65_plus"]
    out["_adj"] = adj
    out["_pending"] = fresh
    return out


def demography(rnd: int) -> Dict[str, int]:
    """Mirrors demography() in meridian-engine.js, extrapolation included."""
    a = DEMOGRAPHY_ANCHORS
    if rnd <= a[0]["round"]:
        return dict(a[0])

    last, prev_a = a[-1], a[-2]
    if rnd > last["round"]:
        span = last["round"] - prev_a["round"]
        beyond = rnd - last["round"]
        HALF_LIFE = 15
        damped = HALF_LIFE * (1 - pow(0.5, beyond / HALF_LIFE))

        def step(k: str) -> float:
            return (last[k] - prev_a[k]) / span * damped

        out = {
            "round": rnd,
            "age_0_19":    max(250000, js_round(last["age_0_19"] + step("age_0_19"))),
            "age_20_64":   max(800000, js_round(last["age_20_64"] + step("age_20_64"))),
            "age_65_plus": max(400000, js_round(last["age_65_plus"] + step("age_65_plus"))),
        }
        out["total"] = out["age_0_19"] + out["age_20_64"] + out["age_65_plus"]
        return out

    if rnd == last["round"]:
        return dict(last)
    for i in range(len(a) - 1):
        if a[i]["round"] <= rnd <= a[i + 1]["round"]:
            t = (rnd - a[i]["round"]) / (a[i + 1]["round"] - a[i]["round"])
            return {
                "round": rnd,
                "total":       js_round(lerp(a[i]["total"],       a[i + 1]["total"],       t)),
                "age_0_19":    js_round(lerp(a[i]["age_0_19"],    a[i + 1]["age_0_19"],    t)),
                "age_20_64":   js_round(lerp(a[i]["age_20_64"],   a[i + 1]["age_20_64"],   t)),
                "age_65_plus": js_round(lerp(a[i]["age_65_plus"], a[i + 1]["age_65_plus"], t)),
            }
    raise AssertionError("unreachable")


# ---------------------------------------------------------------------
# 2. SECTOR CONFIGURATION
# ---------------------------------------------------------------------
# base_output_bn  annual output at round 1, SGD bn (the thirteen sum to 782)
# base_headcount  round-1 employment
# avg_wage        SGD/year per worker, 2050 terms
# automation_r1   round-1 automation
# productivity    output gain per unit of automation. High where output
#                 scales with machines. Low where the service IS the
#                 human contact (care).
# human_touch     how badly quality suffers once automation passes
#                 `comfort`. Care is 1.0. Finance is ~0.
# comfort         the automation level beyond which human_touch bites
# compute_int     compute + energy drawn per unit of automated output.
#                 THIS IS THE BILL ATTACHED TO EVERY POINT OF AUTOMATION.
# demand_driver   what this sector's demand scales with
# essential       counts toward "worst essential service" and the
#                 quality-below-40 fail gate
SECTORS: Dict[str, Dict[str, Any]] = {
    "healthcare": dict(
        name="Healthcare", base_output_bn=58, base_headcount=200000,
        avg_wage=88000, automation_r1=0.22, productivity=0.45, human_touch=0.70,
        comfort=0.58, compute_int=0.06, demand_driver="elderly", essential=True),
    "care_services": dict(
        name="Care Services", base_output_bn=36, base_headcount=210000,
        avg_wage=52000, automation_r1=0.12, productivity=0.25, human_touch=1.00,
        comfort=0.30, compute_int=0.04, demand_driver="elderly", essential=True),
    "education_research": dict(
        name="Education & Research", base_output_bn=42, base_headcount=170000,
        avg_wage=82000, automation_r1=0.20, productivity=0.40, human_touch=0.90,
        comfort=0.42, compute_int=0.07, demand_driver="youth", essential=True),
    "transport_logistics": dict(
        name="Transport & Logistics", base_output_bn=60, base_headcount=180000,
        avg_wage=62000, automation_r1=0.45, productivity=0.85, human_touch=0.10,
        comfort=0.92, compute_int=0.09, demand_driver="population", essential=True),
    "energy_utilities": dict(
        name="Energy & Utilities", base_output_bn=48, base_headcount=55000,
        avg_wage=120000, automation_r1=0.55, productivity=1.70, human_touch=0.00,
        comfort=0.98, compute_int=0.03, demand_driver="compute", essential=True),
    "compute_telecom": dict(
        name="Compute & Telecom", base_output_bn=79, base_headcount=80000,
        avg_wage=135000, automation_r1=0.60, productivity=1.80, human_touch=0.00,
        comfort=0.98, compute_int=0.05, demand_driver="compute", essential=True),
    "housing_construction": dict(
        name="Housing & Construction", base_output_bn=50, base_headcount=150000,
        avg_wage=68000, automation_r1=0.30, productivity=0.70, human_touch=0.20,
        comfort=0.82, compute_int=0.05, demand_driver="population", essential=True),
    "food_agri": dict(
        name="Food & Agri", base_output_bn=34, base_headcount=100000,
        avg_wage=54000, automation_r1=0.35, productivity=0.60, human_touch=0.20,
        comfort=0.85, compute_int=0.06, demand_driver="population", essential=True),
    "manufacturing": dict(
        name="Manufacturing", base_output_bn=130, base_headcount=260000,
        avg_wage=78000, automation_r1=0.50, productivity=1.10, human_touch=0.10,
        comfort=0.94, compute_int=0.10, demand_driver="consumption", essential=False),
    "finance": dict(
        name="Finance", base_output_bn=115, base_headcount=200000,
        avg_wage=145000, automation_r1=0.55, productivity=0.95, human_touch=0.05,
        comfort=0.95, compute_int=0.10, demand_driver="consumption", essential=False),
    "retail_commerce": dict(
        name="Retail & Commerce", base_output_bn=85, base_headcount=320000,
        avg_wage=48000, automation_r1=0.50, productivity=0.80, human_touch=0.15,
        comfort=0.90, compute_int=0.08, demand_driver="consumption", essential=True),
    "public_admin": dict(
        name="Public Administration", base_output_bn=25, base_headcount=100000,
        avg_wage=84000, automation_r1=0.25, productivity=0.50, human_touch=0.60,
        comfort=0.55, compute_int=0.06, demand_driver="population", essential=True),
    "public_safety": dict(
        name="Public Safety", base_output_bn=20, base_headcount=100000,
        avg_wage=76000, automation_r1=0.28, productivity=0.55, human_touch=0.50,
        comfort=0.66, compute_int=0.06, demand_driver="population", essential=True),
}
ORDER: List[str] = list(SECTORS.keys())
ESSENTIAL: List[str] = [k for k in ORDER if SECTORS[k]["essential"]]


# ---------------------------------------------------------------------
# 3. BEHAVIOURAL AND FISCAL CONSTANTS
# ---------------------------------------------------------------------
# Every number here is a modelling choice, exposed so you can argue with
# it. None of them are secret.
class P:
    # automation dynamics
    AUTOMATION_STEP_UP = 0.14      # most a sector can automate in one round
    AUTOMATION_STEP_DOWN = 0.05    # falls back slowly: machines are bought, not rented
    IRREVERSIBLE_ABOVE = 0.80      # past this, re-employing humans is penalised
    IRREVERSIBLE_DRAG = 0.55       # ...cutting the down-step by this share

    # labour
    WEEK_SPREAD = 0.55             # shorter week spreads work over more heads
    WEEK_OUTPUT = 0.30             # ...and cuts output, but less than proportionally
    GUARANTEE_WAGE_DEFAULT = 3200  # SGD/month for a guaranteed care job
    GUARANTEE_INTAKE = 0.055       # share of the unemployed taken on each round

    # household income -> consumption
    MPC_WAGE = 0.72                # marginal propensity to consume out of wages
    MPC_UBI = 0.94                 # ...out of UBI: transfers go to people who spend them
    MPC_CAPITAL = 0.28             # ...out of capital income: mostly saved
    CONSUMPTION_INERTIA = 0.45     # households smooth spending between rounds

    # tax bases
    LABOUR_TAX_RATE = 0.20         # personal income tax on the wage bill
    CONSUMPTION_TAX = 0.08         # GST
    OTHER_TAX_GDP = 0.042          # land, vehicle, duties - scales with GDP
    CAPITAL_RETURN_RATE = 0.1867   # return on automated capital (calibrated below)
    DIVIDEND_PROFIT_SHARE = 0.5    # owning machines also claims operating profit

    # investment: what firms do with the profit you did NOT take
    DEPRECIATION = 0.14            # capital stock lost per round without reinvestment
    BASE_INVEST_RATE = 0.17        # round-1 retained profit / GDP
    INVEST_TAX_ELASTICITY = 1.30   # reinvestment lost per point of tax above 19%
    INVEST_LEVY_ELASTICITY = 0.85  # ...and per point of compute levy above 5%
    LEVY_ADOPTION_BRAKE = 1.60     # compute levy slows how fast you CAN automate

    # spending
    UBI_ADMIN_EFFICIENCY = {"flat": 0.97, "means_tested": 0.90, "age_weighted": 0.95}
    MEANS_TEST_COVERAGE = 0.55     # share of the population that qualifies
    AGE_WEIGHT_SENIOR = 1.6        # 65+ receive 1.6 shares under age-weighting

    # prices
    BASE_INFLATION = 0.021
    IMPORT_SHARE = 0.55            # of the consumption basket
    COMPUTE_SCARCITY_PASSTHROUGH = 0.09
    SCARCITY_SLACK_BAND = 0.92
    SCARCITY_ELASTICITY = 0.55
    SCARCITY_CONVEXITY = 1.6
    SCARCITY_RELIEF = 0.25
    SCARCITY_PRICE_CEILING = 6.0
    # Per-sector capital. Weight 0 = computed but not applied, so every
    # existing run stays byte-identical. See meridian-engine.js for why.
    SECTOR_CAPITAL_WEIGHT = 1
    SECTOR_CAPITAL_DEPRECIATION = 0.14
    SECTOR_CAPITAL_FLOOR = 0.35
    SECTOR_CAPITAL_CEILING = 2.2

    # quality
    QUALITY_INERTIA = 0.38         # share of the gap to target closed per round
    Q_BASE = 64
    Q_CAPACITY = 42
    Q_INFRA = 26
    Q_HUMAN = 135
    Q_STAFF = 20
    Q_GUARANTEE = 10
    # Mission-based quality. Blended at 0 = the legacy target exactly.
    # See sector_missions.js for what the scorecard is and why the agent
    # does not get to choose its own.
    MISSION_WEIGHT = 1
    # Non-linear growth (stage 5). See meridian-engine.js for the three
    # mechanisms and why they are raised together rather than one at a time.
    J_CURVE_WEIGHT = 1
    J_ABSORB_RATE = 0.45
    J_DIP = 0.35
    J_MATURE = 1.40
    LEARNING_WEIGHT = 1
    LEARNING_EXPONENT = 0.15
    LEARNING_FLOOR = 0.45
    DIFFUSION_WEIGHT = 1
    BASS_P = 0.030
    BASS_Q = 0.380
    BASS_SCALE = 1.30

    # reskilling
    RESKILL_LAG = 3                # rounds before it pays off
    RESKILL_POTENCY = 2.6e6        # people moved high->low exposure per $bn
    EXPOSURE_SENSITIVITY = 1.2     # share of the workforce newly exposed per
                                   # point of economy-wide automation growth

    # social
    COHESION_INERTIA = 0.45
    LEGITIMACY_INERTIA = 0.40
    GINI_INERTIA = 0.50

    # civic friction: what people withhold when they have had enough
    UNREST_THRESHOLD = 50
    UNREST_DRAG = 0.55          # share of output lost at total unrest
    UNREST_SERVICE_DRAG = 26    # quality points off care, health, safety, schools

    # AGENT CHANNELS. Conversion constants, not behaviour: agents decide
    # whether people work, spend, leave or have children; these say what
    # that decision is worth in the kernel's units. Mirrors the JS engine.
    LABOUR_PARTICIPATION = 0.80
    PRICE_ELASTICITY = 0.8
    MARKUP_PASSTHROUGH = 0.6
    HEALTH_MORTALITY_SENS = 1.2
    BIRTHS_PER_ROUND = 60000
    PROVIDE_EFFICIENCY = 0.8
    PROVIDE_MAX_BOOST = 0.4
    POLL_WEIGHT = 1.0
    # TICKS. See the note in meridian-engine.js: how often, in ticks, the
    # slow-moving parts of the country are refreshed.
    CADENCE = {"demography": 12, "exposure": 12, "capital": 3, "automation": 3}


# ---------------------------------------------------------------------
# 4. SHOCK DECK
# ---------------------------------------------------------------------
# The engine never draws. Shocks are handed in.
SHOCKS: Dict[str, Dict[str, Any]] = {
    "pandemic": {
        "label": "Respiratory pandemic",
        "demand": {"healthcare": 1.45, "care_services": 1.30, "retail_commerce": 0.82, "transport_logistics": 0.72},
        "quality": {"healthcare": -22, "care_services": -14},
        "cohesion": -6, "output_mult": 0.93,
    },
    "food_import_disruption": {
        "label": "Food import disruption",
        "demand": {"food_agri": 1.05},
        "capacity_mult": {"food_agri": 0.55},
        "quality": {"food_agri": -20},
        "import_price": 0.22, "cohesion": -5,
    },
    "energy_price_spike": {
        "label": "Energy price spike",
        "capacity_mult": {"energy_utilities": 0.80},
        "quality": {"energy_utilities": -12, "transport_logistics": -6},
        "compute_price": 0.45, "import_price": 0.08, "cohesion": -3,
    },
    "chip_export_controls": {
        "label": "Chip export controls",
        "capacity_mult": {"compute_telecom": 0.72},
        "automation_ceiling": -0.10,
        "compute_price": 0.60, "quality": {"compute_telecom": -10}, "cohesion": -2,
    },
    "cyber_attack": {
        "label": "Infrastructure cyber attack",
        "quality": {"finance": -18, "compute_telecom": -16, "energy_utilities": -12, "public_safety": -10},
        "capacity_mult": {"finance": 0.85, "compute_telecom": 0.86, "energy_utilities": 0.90},
        "cohesion": -4, "legitimacy": -5,
    },
    # endogenous - fired by your own state, not by chance
    "civil_unrest": {
        "label": "Civil unrest",
        "quality": {"public_safety": -14, "retail_commerce": -10},
        "output_mult": 0.94, "cohesion": -8, "legitimacy": -8,
    },
    "fiscal_crisis": {
        "label": "Fiscal crisis",
        "borrowing_penalty": 0.35, "legitimacy": -10, "cohesion": -4,
    },
    "service_failure_cascade": {
        "label": "Service failure cascade",
        "quality": {"healthcare": -8, "care_services": -10, "education_research": -8, "retail_commerce": -8},
        "cohesion": -7, "legitimacy": -6,
    },
}


# ---------------------------------------------------------------------
# 5. DEFAULT LEVERS - the round-1 published settings
# ---------------------------------------------------------------------
DEFAULT_LEVERS: Dict[str, Any] = {
    "automation_target": {
        "healthcare": 0.22, "care_services": 0.12, "education_research": 0.20,
        "transport_logistics": 0.45, "energy_utilities": 0.55, "compute_telecom": 0.60,
        "housing_construction": 0.30, "food_agri": 0.35, "manufacturing": 0.50,
        "finance": 0.55, "retail_commerce": 0.50, "public_admin": 0.25, "public_safety": 0.28,
    },
    "corporate_tax_rate": 0.19,
    "compute_levy": 0.05,
    "allocation": {"ubi": 0.45, "infrastructure": 0.40, "reserves": 0.15},
    "ubi_design": "flat",            # flat | means_tested | age_weighted
    "reskilling_spend_pct": 0.08,
    "public_ownership_pct": 0.05,
    "working_week_days": 5,          # 5 | 4 | 3
    "care_job_guarantee": False,
    "care_guarantee_wage": P.GUARANTEE_WAGE_DEFAULT,
}


# ---------------------------------------------------------------------
# 6. SELF-CALIBRATION
# ---------------------------------------------------------------------
# Solve each sector's non-wage cost share so that round 1 reproduces the
# published baseline margins exactly.
R1_MARGINS = {
    "healthcare": 0.09, "care_services": -0.09, "education_research": -0.04,
    "transport_logistics": 0.16, "energy_utilities": 0.14, "compute_telecom": 0.21,
    "housing_construction": 0.12, "food_agri": 0.07, "manufacturing": 0.19,
    "finance": 0.24, "retail_commerce": 0.11, "public_admin": -0.06, "public_safety": -0.02,
}

COST_SHARE: Dict[str, float] = {}
for _k in ORDER:
    _c = SECTORS[_k]
    _out = _c["base_output_bn"]
    _wages = _c["base_headcount"] * _c["avg_wage"] / 1e9
    _comp = _c["compute_int"] * _c["automation_r1"] * _out
    COST_SHARE[_k] = (_out - _wages - _comp - R1_MARGINS[_k] * _out) / _out


def _calibrate() -> Dict[str, float]:
    """Round-1 aggregates, derived once, used as the index bases."""
    wage_bill = js_sum(SECTORS[k]["base_headcount"] * SECTORS[k]["avg_wage"] / 1e9 for k in ORDER)
    gross_profit = js_sum(SECTORS[k]["base_output_bn"] * R1_MARGINS[k] for k in ORDER)
    auto_capital = js_sum(SECTORS[k]["automation_r1"] * SECTORS[k]["base_output_bn"] for k in ORDER)
    capital_return = P.CAPITAL_RETURN_RATE * auto_capital
    corporate_profit = gross_profit + capital_return
    ubi_total = 680 * 12 * 5940000 / 1e9
    dividend = 0.05 * (capital_return + P.DIVIDEND_PROFIT_SHARE * gross_profit)
    capital_to_households = (corporate_profit - dividend) * 0.35
    spend = P.MPC_WAGE * wage_bill + P.MPC_UBI * ubi_total + P.MPC_CAPITAL * capital_to_households
    gdp = js_sum(SECTORS[k]["base_output_bn"] for k in ORDER)
    return {
        "WAGE_BILL": wage_bill, "GROSS_PROFIT": gross_profit, "CAPITAL_RETURN": capital_return,
        "CORPORATE_PROFIT": corporate_profit, "UBI_TOTAL": ubi_total, "SPEND": spend, "GDP": gdp,
        "UBI_MONTHLY": 680,
        "INFRA": 118 * 0.92 * 0.40,   # round-1 infrastructure spend, the maintenance yardstick
        "AUTO_WEIGHTED": auto_capital / gdp,
    }


CAL = _calibrate()


# ---------------------------------------------------------------------
# 7. THE STEP FUNCTION
# ---------------------------------------------------------------------
MORTALITY_65_PLUS = 0.025   # per year, over-65 band. Mirrors meridian-engine.js.


def adjust_demography(anchor: Dict[str, Any], prev: Dict[str, Any], d: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Demography that responds to agent decisions. Mirrors adjustDemography."""
    adj_in = prev.get("_popAdjust") if prev else None
    if not adj_in and not d:
        return anchor
    adj = {
        "age_0_19": adj_in["age_0_19"] if adj_in else 0,
        "age_20_64": adj_in["age_20_64"] if adj_in else 0,
        "age_65_plus": adj_in["age_65_plus"] if adj_in else 0,
    }
    if d:
        years = 2
        bm = d.get("births_mult")
        bm = 1 if bm is None else bm
        try:
            bm = float(bm)
        except (TypeError, ValueError):
            bm = 0.0
        if not math.isfinite(bm):
            bm = 0.0
        births_mult = clamp(bm, 0.3, 2)
        adj["age_0_19"] += js_round((births_mult - 1) * P.BIRTHS_PER_ROUND)
        moved = _num_or_zero(d.get("immigration")) - _num_or_zero(d.get("emigration"))
        adj["age_20_64"] += js_round(clamp(moved, -400000, 400000))
        sectors = (prev or {}).get("sectors") or {}
        hq = sectors["healthcare"]["quality"] if "healthcare" in sectors else P.Q_BASE
        failure = clamp((60 - hq) / 60, 0, 1)
        elders = prev["population"]["by_age"]["age_65_plus"] if (prev and prev.get("population")) else anchor["age_65_plus"]
        adj["age_65_plus"] -= js_round(elders * MORTALITY_65_PLUS * years * P.HEALTH_MORTALITY_SENS * failure)
    out = {
        "round": anchor["round"],
        "age_0_19": max(0, anchor["age_0_19"] + adj["age_0_19"]),
        "age_20_64": max(0, anchor["age_20_64"] + adj["age_20_64"]),
        "age_65_plus": max(0, anchor["age_65_plus"] + adj["age_65_plus"]),
    }
    out["total"] = out["age_0_19"] + out["age_20_64"] + out["age_65_plus"]
    out["_adj"] = adj
    return out


def _num_or_zero(v) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return x if math.isfinite(x) else 0.0


def _num_or_none(v) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


POLICY_GRAMMAR = {
    "tax": {"bases": ["profit", "wages", "compute", "capital_income", "energy", "land", "consumption"],
            "rate": [0, 0.5]},
    "transfer": {"to": ["all", "elderly", "youth", "working_age", "unemployed", "low_income", "carers"],
                 "sgd_month": [0, 5000]},
    "regulate": {"what": {"automation_cap": [0, 0.98], "price_cap": [0.6, 1.8], "wage_floor": [0.5, 2]}},
    "provide": {"budget_bn": [0, 60]},
    "institution": {"budget_bn": [0, 60]},
    "announce": {},
}
TRANSFER_SHARE = {"low_income": 0.20, "carers": 0.05}


def validate_policy(raw) -> Dict[str, Any]:
    """Mirrors validatePolicy in meridian-engine.js."""
    if not isinstance(raw, dict):
        return {"ok": False, "reason": "not an object"}
    typ = raw.get("type")
    g = POLICY_GRAMMAR.get(typ)
    if g is None:
        return {"ok": False, "reason": 'unknown policy type "%s"' % typ}

    def num(v, lo, hi, name):
        x = _num_or_none(v)
        if x is None:
            return None, name + " must be a number"
        if x < lo or x > hi:
            return None, "%s must be between %s and %s" % (name, lo, hi)
        return x, None

    def sector_ok(k, allow_all):
        return (allow_all and k == "all") or k in ORDER

    if typ == "tax":
        if raw.get("base") not in g["bases"]:
            return {"ok": False, "reason": "tax base must be one of " + ", ".join(g["bases"])}
        r, err = num(raw.get("rate"), g["rate"][0], g["rate"][1], "rate")
        if err:
            return {"ok": False, "reason": err}
        return {"ok": True, "value": {"type": typ, "base": raw["base"], "rate": r, "name": raw.get("name")}}
    if typ == "transfer":
        if raw.get("to") not in g["to"]:
            return {"ok": False, "reason": "transfer must go to one of " + ", ".join(g["to"])}
        r, err = num(raw.get("sgd_month"), g["sgd_month"][0], g["sgd_month"][1], "sgd_month")
        if err:
            return {"ok": False, "reason": err}
        return {"ok": True, "value": {"type": typ, "to": raw["to"], "sgd_month": r, "name": raw.get("name")}}
    if typ == "regulate":
        rng = g["what"].get(raw.get("what"))
        if rng is None:
            return {"ok": False, "reason": "regulate.what must be one of " + ", ".join(g["what"].keys())}
        needs_sector = raw.get("what") != "wage_floor"
        if needs_sector and not sector_ok(raw.get("sector"), True):
            return {"ok": False, "reason": 'unknown sector "%s"' % raw.get("sector")}
        r, err = num(raw.get("limit"), rng[0], rng[1], "limit")
        if err:
            return {"ok": False, "reason": err}
        return {"ok": True, "value": {"type": typ, "what": raw["what"],
                                      "sector": raw.get("sector") if needs_sector else None,
                                      "limit": r, "name": raw.get("name")}}
    if typ in ("provide", "institution"):
        if not sector_ok(raw.get("sector"), False):
            return {"ok": False, "reason": 'unknown sector "%s"' % raw.get("sector")}
        r, err = num(raw.get("budget_bn"), g["budget_bn"][0], g["budget_bn"][1], "budget_bn")
        if err:
            return {"ok": False, "reason": err}
        v = {"type": typ, "sector": raw["sector"], "budget_bn": r, "name": raw.get("name")}
        if typ == "institution":
            if not raw.get("name"):
                return {"ok": False, "reason": "an institution needs a name"}
            v["mandate"] = str(raw.get("mandate") or "")[:400]
        return {"ok": True, "value": v}
    text = str(raw.get("text") or "").strip()
    if not text:
        return {"ok": False, "reason": "an announcement needs text"}
    return {"ok": True, "value": {"type": typ, "text": text[:600]}}


def compile_policies(lst) -> Dict[str, Any]:
    """Mirrors compilePolicies in meridian-engine.js."""
    out = {"active": False, "autoCap": {}, "priceCap": {}, "wageFloor": None, "provide": {},
           "taxes": [], "transfers": [], "announcements": []}
    for raw in (lst if isinstance(lst, list) else []):
        v = validate_policy(raw)
        if not v["ok"]:
            continue
        x = v["value"]
        out["active"] = True
        if x["type"] == "tax":
            out["taxes"].append(x)
        elif x["type"] == "transfer":
            out["transfers"].append(x)
        elif x["type"] == "announce":
            out["announcements"].append(x["text"])
        elif x["type"] in ("provide", "institution"):
            out["provide"][x["sector"]] = out["provide"].get(x["sector"], 0) + x["budget_bn"]
        elif x["what"] == "wage_floor":
            out["wageFloor"] = x["limit"] if out["wageFloor"] is None else max(out["wageFloor"], x["limit"])
        else:
            target = out["autoCap"] if x["what"] == "automation_cap" else out["priceCap"]
            for k in (ORDER if x["sector"] == "all" else [x["sector"]]):
                target[k] = x["limit"] if target.get(k) is None else min(target[k], x["limit"])
    return out


def step(state: Dict[str, Any],
         levers: Optional[Dict[str, Any]] = None,
         active_shocks: Optional[Sequence[str]] = None,
         exogenous: Optional[Dict[str, Any]] = None,
         opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """step(state, levers, shocks, exogenous, opts) -> next state. Pure.

    `exogenous` is what reached this society from OUTSIDE it — goods and
    credits settled by the trade layer, and what the citizen agents made of
    last round. Optional, defaulting to nothing, so a society that neither
    trades nor is read behaves exactly as it did before either existed.

        { reserves_bn, capacity: {sector: mult}, headcount: {sector: n},
          cohesion_bonus, legitimacy_bonus, civic_unrest }

    `civic_unrest` (0-100) is computed outside the engine and handed in for
    the same reason trade is: a model's reading of a mood must not change
    what the same levers produce, or cross-team comparison dies and a trace
    stops replaying. Recorded in the trace, replayed from it — the feedback
    loop is real and the engine stays pure.
    """
    exo = exogenous or {}
    exo_cap = exo.get("capacity") or {}
    exo_head = exo.get("headcount") or {}
    levers = levers or {}
    L = dict(DEFAULT_LEVERS)
    L.update(levers)
    L["allocation"] = {**DEFAULT_LEVERS["allocation"], **levers.get("allocation", {})}
    L["automation_target"] = {**DEFAULT_LEVERS["automation_target"], **levers.get("automation_target", {})}

    # AGENT CHANNELS. Mirrors meridian-engine.js.
    exo_house = exo.get("households") or None
    exo_polls = exo.get("polls") or None
    exo_demo = exo.get("demography") or None
    # Open-ended action: custom moved between sectors, and work or spending
    # that happened off the books. Mirrors meridian-engine.js; inert when absent.
    exo_demand = exo.get("demand") or {}
    informal_share = clamp(float(exo.get("informal_share") or 0), 0, 0.5)
    pol = compile_policies(L.get("policies"))

    # A shock is a deck name or a director EVENT {id, label, effects}.
    events = [x for x in (active_shocks or [])
              if (isinstance(x, str) and x in SHOCKS) or (isinstance(x, dict) and x.get("effects"))]
    names = [x if isinstance(x, str) else (x.get("label") or x.get("id") or "event") for x in events]
    S = [SHOCKS[x] if isinstance(x, str) else x["effects"] for x in events]

    def shock_sum(field, key):
        return js_sum(s.get(field, {}).get(key, 0) for s in S)

    def shock_mult(field, key):
        m = 1.0
        for s in S:
            m *= s.get(field, {}).get(key, 1)
        return m

    def shock_scalar(f):
        return js_sum(s.get(f, 0) for s in S)

    def shock_scalar_mult(f):
        m = 1.0
        for s in S:
            m *= s.get(f, 1)
        return m

    prev = state
    # No cap: runs are open-ended. See the note in meridian-engine.js.
    next_round = prev["meta"]["round"] + 1

    # TIME. How long this step is, and what that does to every rate.
    dt = (opts or {}).get("dt") or 2
    tick_mode = dt != 2
    K = dt / 2
    tick = (prev["meta"].get("tick") or 0) + 1 if tick_mode else None
    t_next = js_round(tick * dt * 1e6) / 1e6 if tick_mode else None

    def due(n: str) -> bool:
        return (not tick_mode) or tick % P.CADENCE[n] == 0

    def k_of(n: str) -> float:
        return K * P.CADENCE[n] if tick_mode else 1

    def inertia(x: float, k: float) -> float:
        return x if k == 1 else 1 - pow(1 - x, k)

    ex = (prev.get("_exact") or {}) if tick_mode else None
    ex_q = ex.get("quality") if ex else None
    ex_a = ex.get("automation") if ex else None

    if tick_mode:
        demo = demography_tick(prev, exo_demo, t_next, due("demography"), k_of("demography"))
    else:
        demo = adjust_demography(demography(next_round), prev, exo_demo)

    # --- 7.1 prices --------------------------------------------------
    # Import inflation is the reason a nominal UBI lies to you.
    last_tight = prev.get("_computeTightness")
    if last_tight is None:
        last_tight = 1
    scarcity_pressure = max(0.0, last_tight - P.SCARCITY_SLACK_BAND)
    if scarcity_pressure > 0:
        scarcity_push = P.SCARCITY_ELASTICITY * pow(scarcity_pressure, P.SCARCITY_CONVEXITY)
    else:
        scarcity_push = -P.SCARCITY_RELIEF * min(0.25, P.SCARCITY_SLACK_BAND - last_tight)

    compute_growth = (1 + shock_scalar("compute_price") * 0.6 + 0.01 + scarcity_push)
    compute_price = clamp(
        (prev.get("_computePrice") or 1)
        * (pow(max(0.01, compute_growth), K) if tick_mode else compute_growth),
        0.5, P.SCARCITY_PRICE_CEILING)
    import_push = shock_scalar("import_price")
    inflation = (
        1 + P.BASE_INFLATION + P.IMPORT_SHARE * import_push +
        P.COMPUTE_SCARCITY_PASSTHROUGH * (compute_price - 1) * 0.5)
    price_index = (prev.get("_priceIndex") or 1) * (pow(max(0.01, inflation), K) if tick_mode else inflation)

    prev_markup = 1 if prev.get("_markupIndex") is None else prev["_markupIndex"]
    price_level = price_index * (1 + P.MARKUP_PASSTHROUGH * (prev_markup - 1))

    # --- 7.2 working week --------------------------------------------
    week_days = L["working_week_days"]
    week_spread = (5 / week_days) ** P.WEEK_SPREAD   # >1 when the week is shorter
    week_output = (week_days / 5) ** P.WEEK_OUTPUT   # <1 when the week is shorter

    # --- 7.3 demand drivers ------------------------------------------
    # `consumption` is where last round's household spending re-enters the
    # economy. THIS IS THE RETURNING ARROW IN THE CIRCULAR FLOW.
    d1 = DEMOGRAPHY_ANCHORS[0]
    drivers = {
        "population": demo["total"] / d1["total"],
        "elderly": demo["age_65_plus"] / d1["age_65_plus"],
        "youth": demo["age_0_19"] / d1["age_0_19"],
        "consumption": prev["indicators"]["consumption_index"] / 100,
        "compute": 1.0,
    }

    # --- 7.4 automation moves toward the lever, never jumps to it -----
    ceiling = 1 + shock_scalar("automation_ceiling")
    # The compute levy taxes automation directly, and so slows how fast a
    # society can adopt it even when the lever says "go".
    levy_brake = clamp(1 - P.LEVY_ADOPTION_BRAKE * (L["compute_levy"] - 0.05), 0.25, 1.4)
    automation: Dict[str, float] = {}
    # WHAT THE FIRMS DECIDED, IF ANYONE ASKED THEM. Mirrors the JS: the
    # government's lever is a CEILING, and a firm may sit beneath it.
    # `automation_ceiling` is accepted as an alias for `automation_target`.
    exo_firms = exo.get("firms") or {}

    def lever_for(k: str) -> float:
        alias = L.get("automation_ceiling")
        if alias and alias.get(k) is not None:
            return alias[k]
        return L["automation_target"][k]

    auto_due = due("automation")
    Ka = k_of("automation")
    for k in ORDER:
        cur = ex_a[k] if (ex_a and ex_a.get(k) is not None) else prev["sectors"][k]["automation"]
        if not auto_due:
            automation[k] = cur
            continue
        cap = clamp(min(lever_for(k), pol["autoCap"][k] if pol["autoCap"].get(k) is not None else math.inf), 0, ceiling)
        firm_asked = (exo_firms.get(k) or {}).get("automation")
        if isinstance(firm_asked, (int, float)) and not isinstance(firm_asked, bool)                 and math.isfinite(float(firm_asked)):
            tgt = clamp(min(float(firm_asked), cap), 0, ceiling)
        else:
            tgt = cap
        if tgt > cur:
            # How fast a sector CAN absorb, given how far it already is.
            F = clamp(cur / max(0.01, cap), 0, 1)
            bass = (P.BASS_P + P.BASS_Q * F) * (1 - F) * P.BASS_SCALE
            shaped = ((1 - P.DIFFUSION_WEIGHT) * P.AUTOMATION_STEP_UP
                      + P.DIFFUSION_WEIGHT * bass)
            step_max = shaped * levy_brake
        else:
            step_max = P.AUTOMATION_STEP_DOWN
            # Irreversibility: some doors close behind you.
            if cur > P.IRREVERSIBLE_ABOVE:
                step_max *= (1 - P.IRREVERSIBLE_DRAG)
            # Reskilling spend buys back some of that lost optionality.
            step_max *= (1 + 3.0 * L["reskilling_spend_pct"])
        step_max *= Ka                    # a quarter's worth of adoption, not two years'
        automation[k] = clamp(cur + clamp(tgt - cur, -step_max, step_max), 0, 0.98)

    # Compute & Energy demand is driven by how automated everything else
    # is. Automation is not free, and this is where the bill is rendered.
    auto_weighted = js_sum(automation[k] * SECTORS[k]["base_output_bn"] for k in ORDER) / CAL["GDP"]
    # --- what the sectors have LEARNED to use. Mirrors the JS.
    prev_experience = prev.get("_autoExperience") or {}
    auto_experience: Dict[str, float] = {}
    for k in ORDER:
        had = prev_experience.get(k)
        if had is None:
            had = prev["sectors"][k]["automation"]
        auto_experience[k] = (had + (automation[k] - had) * inertia(P.J_ABSORB_RATE, Ka)) if auto_due else had

    # --- the learning curve: cost falls with CUMULATIVE consumption.
    cumulative_in = prev.get("_computeCumulative")
    if cumulative_in is None:
        cumulative_in = 1
    learning_raw = max(1, cumulative_in) ** (-P.LEARNING_EXPONENT)
    learning_factor = ((1 - P.LEARNING_WEIGHT)
                       + P.LEARNING_WEIGHT * clamp(learning_raw, P.LEARNING_FLOOR, 1))

    drivers["compute"] = (auto_weighted / CAL["AUTO_WEIGHTED"]) ** 1.05 * drivers["population"]

    # --- 7.5 the real economy, sector by sector ----------------------
    sectors: Dict[str, Any] = {}
    exact_quality: Dict[str, float] = {}
    compute_tightness = 1.0
    sector_margin: Dict[str, float] = {}
    wage_bill = 0.0
    employed_total = 0
    gross_profit = 0.0
    gdp = 0.0
    public_subsidy = 0.0
    compute_cost_total = 0.0
    markup_num = 0.0
    markup_den = 0.0
    sector_output: Dict[str, float] = {}

    labour_avail = 1
    if exo_house and exo_house.get("labour_supply") is not None and _num_or_none(exo_house.get("labour_supply")) is not None:
        supply = demo["age_20_64"] * P.LABOUR_PARTICIPATION * clamp(float(exo_house["labour_supply"]), 0, 1.3)
        labour_avail = clamp(supply / max(1, prev["population"]["employed_total"]), 0, 1)

    def withheld_of(k: str) -> float:
        if exo_house and exo_house.get("withheld") and exo_house["withheld"].get(k) is not None:
            return clamp(_num_or_zero(exo_house["withheld"][k]), 0, 0.9)
        return 0

    # CIVIC FRICTION. Nothing below the threshold — a grumbling society
    # still turns up. Past it the loss climbs with the square of how far
    # past, because withdrawal of cooperation compounds: one absence is
    # covered, a third of the shift absent closes the line.
    unrest = clamp(float(exo.get("civic_unrest") or 0), 0, 100)
    over = max(0.0, unrest - P.UNREST_THRESHOLD) / (100 - P.UNREST_THRESHOLD)
    unrest_drag = 1 - P.UNREST_DRAG * over * over
    unrest_service_hit = P.UNREST_SERVICE_DRAG * over * over

    # Infrastructure money voted LAST round builds THIS round's capacity.
    infra_ratio = (prev.get("_infraSpend_bn") or CAL["INFRA"]) / CAL["INFRA"]
    # The capital stock firms did or did not reinvest in, last round.
    capital_index = 1.0 if prev.get("_capitalIndex") is None else prev["_capitalIndex"]
    # Per-sector capital carried forward; absent on states written before
    # it existed, so every read defaults to 1.
    prev_sector_capital = prev.get("_sectorCapital") or {}

    def sector_capital_in(k: str) -> float:
        v = prev_sector_capital.get(k)
        return 1.0 if v is None else v

    def sector_capital_term(k: str) -> float:
        # Exactly 1 at weight 0, so the multiplication is a no-op.
        return (1 - P.SECTOR_CAPITAL_WEIGHT
                + P.SECTOR_CAPITAL_WEIGHT * sector_capital_in(k))

    for k in ORDER:
        c = SECTORS[k]
        p = prev["sectors"][k]

        firm = exo_firms.get(k) or {}
        mk = _num_or_none(firm.get("markup"))
        markup = clamp(mk, 0.6, 1.8) if mk is not None else 1
        if pol["priceCap"].get(k) is not None:
            markup = min(markup, pol["priceCap"][k])
        wo = _num_or_none(firm.get("wage_offer"))
        wage_mult = clamp(wo, 0.6, 1.6) if wo is not None else 1
        if pol["wageFloor"] is not None:
            wage_mult = max(wage_mult, pol["wageFloor"])

        # What the population is asking this sector for.
        dem = exo_demand.get(k)
        demand = (c["base_output_bn"] * drivers[c["demand_driver"]] * (shock_mult("demand", k) or 1) *
                  (1 if markup == 1 else pow(markup, -P.PRICE_ELASTICITY)) *
                  (1 if dem is None else clamp(float(dem) or 1, 0.5, 1.5)))

        # What the sector could produce if every buyer turned up.
        # THE J-CURVE. Absorbed automation pays MORE than the naive gain;
        # unabsorbed automation costs output until the complementary work
        # is done. At weight 0 this is the old affine gain.
        experience = auto_experience[k]
        unabsorbed = max(0, automation[k] - experience)
        legacy_gain = 1 + c["productivity"] * (automation[k] - c["automation_r1"])
        j_gain = (1 + c["productivity"] * P.J_MATURE * (experience - c["automation_r1"])
                  - P.J_DIP * c["productivity"] * unabsorbed)
        prod_gain = (1 - P.J_CURVE_WEIGHT) * legacy_gain + P.J_CURVE_WEIGHT * j_gain
        capacity_abs = (c["base_output_bn"] * prod_gain * week_output * capital_index *
                        sector_capital_term(k) *
                        (shock_mult("capacity_mult", k) or 1) * shock_scalar_mult("output_mult") *
                        (exo_cap.get(k) or 1) *      # imported or exported capacity
                        unrest_drag)                 # and what people withhold

        if pol["provide"].get(k):
            capacity_abs *= 1 + min(P.PROVIDE_MAX_BOOST, pol["provide"][k] * P.PROVIDE_EFFICIENCY / c["base_output_bn"])
        labour_loss = 1 - (1 - withheld_of(k)) * labour_avail
        if labour_loss > 0:
            capacity_abs *= (1 - labour_loss * clamp(1 - automation[k], 0.02, 1))

        # The people needed to run it at that level.
        labour_required = (c["base_headcount"] * (1 - automation[k]) / (1 - c["automation_r1"]) *
                           (capacity_abs / c["base_output_bn"]) * week_spread)
        headcount = max(0, js_round(labour_required))

        # Care job guarantee: the state hires into care, deliberately at a loss.
        if L["care_job_guarantee"] and k == "care_services":
            unemployed = max(0, prev["population"]["by_age"]["age_20_64"] - prev["population"]["employed_total"])
            hired = js_round(unemployed * P.GUARANTEE_INTAKE)
            headcount += hired
            # Care is the one sector where more hands genuinely means more
            # care delivered - the least automatable thing in the economy.
            capacity_abs *= (1 + 0.55 * hired / max(1, labour_required))

        # Skilled labour lent by another society. It staffs the sector and
        # draws the same wage as anyone else - borrowed hands are not free.
        if exo_head.get(k):
            headcount = max(0, headcount + js_round(exo_head[k]))

        # ================== THE CLIFF ==================
        # Output is SOLD, not merely made. You cannot sell into demand that
        # is not there. Every automation decision eventually arrives back
        # here as a smaller `demand`, and this one `min` is what turns a
        # productivity boom into a depression.
        output = min(capacity_abs, demand)
        # ===============================================

        capacity = capacity_abs / demand
        wages = headcount * c["avg_wage"] * wage_mult / 1e9
        compute_cost = (c["compute_int"] * automation[k] * output
                        * compute_price * learning_factor)
        other_cost = COST_SHARE[k] * output
        profit = output * markup - wages - compute_cost - other_cost

        # Quality is a target the sector drifts toward, never jumps to.
        # Services are sticky: rounds to break, rounds to fix.
        cap_term = P.Q_CAPACITY * clamp(capacity - 1, -0.55, 0.35)
        infra_term = P.Q_INFRA * clamp(infra_ratio - 1, -0.9, 0.9)
        over_auto = max(0.0, automation[k] - c["comfort"])
        human_term = -P.Q_HUMAN * c["human_touch"] * over_auto
        staff_term = P.Q_STAFF * clamp(headcount / max(1, labour_required) - 1, -0.5, 0.6)
        guar_term = P.Q_GUARANTEE if (L["care_job_guarantee"] and k in ("care_services", "healthcare")) else 0
        # Unrest is felt first where people meet the state: the ward, the
        # waiting room, the school gate.
        friction_term = -unrest_service_hit if k in (
            "care_services", "healthcare", "public_safety", "education_research",
                                   "public_admin") else 0

        legacy_target = (P.Q_BASE + cap_term + infra_term + human_term +
                         staff_term + guar_term + friction_term)

        # --- the sector's own scorecard. Mirrors meridian-engine.js.
        access_signal = clamp(capacity - 1, -0.55, 0.35)
        delivery_signal = clamp(headcount / max(1, labour_required) - 1, -0.5, 0.6)
        humanity_signal = -c["human_touch"] * over_auto
        reliability_signal = clamp(infra_ratio - 1, -0.9, 0.9)
        price_felt = compute_price if k in ("energy_utilities", "compute_telecom") else price_level
        affordability_signal = clamp(-(price_felt - 1) * 0.6, -1, 0.4)
        # EQUITY IS A PROXY: the engine has no per-cohort access figure, so
        # rationing is charged more heavily when more of the population is
        # exposed to losing its income.
        by_exposure = (prev.get("population") or {}).get("by_exposure")
        if by_exposure:
            exposed_share = by_exposure["high"] / max(1, prev["population"]["total"])
        else:
            exposed_share = 0.22
        equity_signal = min(0, capacity - 1) * (0.5 + exposed_share)

        mission_target = score_against_mission(k, {
            "access": access_signal, "delivery": delivery_signal,
            "humanity": humanity_signal, "reliability": reliability_signal,
            "affordability": affordability_signal, "equity": equity_signal,
        }, P.Q_BASE) + guar_term + friction_term

        target = clamp((1 - P.MISSION_WEIGHT) * legacy_target +
                       P.MISSION_WEIGHT * mission_target, 0, 100)
        q0 = ex_q[k] if (ex_q and ex_q.get(k) is not None) else p["quality"]
        quality_exact = clamp(q0 + (target - q0) * inertia(P.QUALITY_INERTIA, K) + shock_sum("quality", k) * K, 0, 100)
        if tick_mode:
            quality = int(js_round(quality_exact))
            exact_quality[k] = quality_exact
        else:
            quality = int(clamp(js_round(
                p["quality"] + (target - p["quality"]) * P.QUALITY_INERTIA + shock_sum("quality", k)), 0, 100))

        sectors[k] = {
            "automation": round2(automation[k]),
            "headcount": headcount,
            "capacity": round2(capacity),
            "quality": quality,
            "margin": round2(profit / output if output > 0 else 0),
            "note": p.get("note"),
        }
        # `capacity` is supply/demand, so its reciprocal is tightness.
        if k == "energy_utilities":
            compute_tightness = (1 / capacity) if capacity > 0.01 else 100

        wage_bill += wages
        compute_cost_total += compute_cost
        markup_num += output * markup
        markup_den += output
        sector_output[k] = output
        employed_total += headcount
        gross_profit += profit
        sector_margin[k] = (profit / output) if output > 0 else 0
        gdp += output

        # An essential service that loses money does not close. The state
        # covers the loss. That bill lands on the same budget the UBI comes
        # out of, and it grows exactly when the tax base is shrinking.
        if c["essential"] and profit < 0:
            public_subsidy += -profit

    # --- 7.6 capital, profit and the revenue base --------------------
    auto_capital = js_sum(automation[k] * (gdp * SECTORS[k]["base_output_bn"] / CAL["GDP"]) for k in ORDER)
    capital_return = P.CAPITAL_RETURN_RATE * auto_capital
    corporate_profit = gross_profit + capital_return

    # Public ownership: a claim on the machines themselves. The one revenue
    # stream that does not depend on taxing a shrinking profit base.
    public_dividend = L["public_ownership_pct"] * (
        capital_return + P.DIVIDEND_PROFIT_SHARE * max(0.0, gross_profit))
    taxable_profit = max(0.0, corporate_profit - public_dividend)

    compute_output = gdp * SECTORS["compute_telecom"]["base_output_bn"] / CAL["GDP"]

    tax_revenue = (
        L["corporate_tax_rate"] * taxable_profit +
        L["compute_levy"] * compute_output * (automation["compute_telecom"] / SECTORS["compute_telecom"]["automation_r1"]) +
        P.LABOUR_TAX_RATE * wage_bill * (1 - informal_share) +               # collapses as wages vanish
        P.CONSUMPTION_TAX * (prev.get("_consumptionSpend_bn") or CAL["SPEND"]) * (1 - informal_share) +  # and as demand does
        P.OTHER_TAX_GDP * gdp)

    # --- 7.7 the budget ----------------------------------------------
    # Obligations come off the top. Only what survives them is yours to
    # split. This is why a society can hold its allocation lever perfectly
    # still and still watch its UBI fall: the numerator shrank.
    capital_to_households_gross = max(0.0, corporate_profit - public_dividend) * 0.35
    wage_tax_bn = 0.0
    capital_tax_bn = 0.0
    profit_tax_bn = 0.0
    other_policy_tax_bn = 0.0
    for t in pol["taxes"]:
        if t["base"] == "wages":
            wage_tax_bn += t["rate"] * wage_bill
        elif t["base"] == "capital_income":
            capital_tax_bn += t["rate"] * capital_to_households_gross
        elif t["base"] == "profit":
            profit_tax_bn += t["rate"] * taxable_profit
        elif t["base"] == "compute":
            other_policy_tax_bn += t["rate"] * compute_cost_total
        elif t["base"] == "energy":
            other_policy_tax_bn += t["rate"] * (sector_output.get("energy_utilities") or 0)
        elif t["base"] == "land":
            other_policy_tax_bn += t["rate"] * (sector_output.get("housing_construction") or 0)
        elif t["base"] == "consumption":
            other_policy_tax_bn += t["rate"] * (prev.get("_consumptionSpend_bn") or CAL["SPEND"])
    policy_revenue = wage_tax_bn + capital_tax_bn + profit_tax_bn + other_policy_tax_bn

    def recipients_of(to: str):
        if to == "all":
            return demo["total"]
        if to == "elderly":
            return demo["age_65_plus"]
        if to == "youth":
            return demo["age_0_19"]
        if to == "working_age":
            return demo["age_20_64"]
        if to == "unemployed":
            return max(0, demo["age_20_64"] - prev["population"]["employed_total"])
        return js_round(demo["total"] * TRANSFER_SHARE.get(to, 0))

    transfers_bn = 0.0
    for t in pol["transfers"]:
        transfers_bn = transfers_bn + t["sgd_month"] * 12 * recipients_of(t["to"]) / 1e9
    provide_bn = 0.0
    for k in pol["provide"]:
        provide_bn = provide_bn + pol["provide"][k]
    policy_spend = transfers_bn + provide_bn

    income = tax_revenue + public_dividend + policy_revenue

    guarantee_cost = 0.0
    if L["care_job_guarantee"]:
        cs = SECTORS["care_services"]
        organic = cs["base_headcount"] * (1 - automation["care_services"]) / (1 - cs["automation_r1"])
        extra = max(0.0, sectors["care_services"]["headcount"] - organic)
        guarantee_cost = extra * (L.get("care_guarantee_wage") or P.GUARANTEE_WAGE_DEFAULT) * 12 / 1e9

    reskill_spend = income * L["reskilling_spend_pct"]
    # A team's own ways of sharing out. Mirrors meridian-engine.js.
    dist = exo.get("distribution") or None
    dist_asked = max(0, _num_or_zero(dist.get("paid_bn"))) if dist else 0
    dist_from_ubi_asked = clamp(_num_or_zero(dist.get("from_ubi_bn")), 0, dist_asked) if dist else 0
    dist_new = dist_asked - dist_from_ubi_asked
    if dist:
        obligations = reskill_spend + public_subsidy + guarantee_cost + policy_spend + dist_new
    else:
        obligations = reskill_spend + public_subsidy + guarantee_cost + policy_spend
    spendable = income - obligations

    a = L["allocation"]
    alloc_sum = (a["ubi"] + a["infrastructure"] + a["reserves"]) or 1
    ubi_pot_whole = max(0.0, spendable) * a["ubi"] / alloc_sum
    dist_carved = min(ubi_pot_whole, dist_from_ubi_asked) if dist else 0
    ubi_pot = (ubi_pot_whole - dist_carved) if dist else ubi_pot_whole
    dist_paid = dist_new + dist_carved
    infra_bn = max(0.0, spendable) * a["infrastructure"] / alloc_sum
    reserve_add = (spendable * a["reserves"] / alloc_sum) if spendable >= 0 else spendable

    # --- 7.8 UBI -------------------------------------------------------
    eff = P.UBI_ADMIN_EFFICIENCY.get(L["ubi_design"], 0.97)
    if L["ubi_design"] == "means_tested":
        shares = demo["total"] * P.MEANS_TEST_COVERAGE
    elif L["ubi_design"] == "age_weighted":
        shares = (demo["total"] - demo["age_65_plus"]) + demo["age_65_plus"] * P.AGE_WEIGHT_SENIOR
    else:
        shares = demo["total"]

    ubi_total_paid = ubi_pot * eff
    # The per-SHARE payment; a senior gets 1.6 of these under age-weighting.
    ubi_base_share = js_round((ubi_total_paid * 1e9) / (shares * 12))
    # The headline figure is the MEAN payment per resident, so three very
    # different UBI designs can be compared on one axis.
    ubi_monthly = js_round((ubi_total_paid * 1e9) / (demo["total"] * 12))
    real_ubi_index = js_round((ubi_monthly / price_level) / CAL["UBI_MONTHLY"] * 100)

    # --- 7.9 reserves ---------------------------------------------------
    # Credits settled by the trade layer land here, before the shock penalty.
    # The budget is an annual rate; a step adds its share of it.
    reserves_in = ex["reserves"] if (ex and ex.get("reserves") is not None) else prev["fiscal"]["reserves_bn"]
    reserves = reserves_in + reserve_add * K + (exo.get("reserves_bn") or 0)
    if reserves < 0:
        reserves -= abs(reserves) * shock_scalar("borrowing_penalty") * K

    # --- 7.9b reinvestment: what firms do with the profit you left them --
    # The other half of the corporate tax trade-off. Take more now and
    # there is less capital stock to tax later.
    retained = max(0.0, corporate_profit * (1 - L["corporate_tax_rate"]) - public_dividend * 0.5 - profit_tax_bn)
    invest_rate = retained / max(1.0, gdp)
    tax_drag = clamp(1 - P.INVEST_TAX_ELASTICITY * (L["corporate_tax_rate"] - 0.19), 0.15, 1.15)
    levy_drag = clamp(1 - P.INVEST_LEVY_ELASTICITY * (L["compute_levy"] - 0.05), 0.30, 1.15)
    # A firm cannot build capacity faster than the economy can absorb it.
    private_reinvest = clamp(invest_rate / P.BASE_INVEST_RATE, 0, 1) * tax_drag * levy_drag
    # Machines the PUBLIC owns are maintained out of the infrastructure
    # vote, not out of retained private profit.
    public_reinvest = clamp(infra_ratio, 0, 1.4)
    own = clamp(L["public_ownership_pct"], 0, 1)
    # A quarter of the capital stock is public whoever owns the firms.
    # Starve infrastructure to fund cash payouts and the economy that
    # funds the payouts physically shrinks.
    reinvestment = 0.75 * ((1 - own) * private_reinvest + own * public_reinvest) + 0.25 * public_reinvest
    cap_due = due("capital")
    Kc = k_of("capital")
    wear = (1 - P.DEPRECIATION + P.DEPRECIATION * reinvestment)
    next_capital_index = capital_index if not cap_due else clamp(
        capital_index * (pow(max(0.01, wear), Kc) if tick_mode else wear), 0.30, 1.9)

    # --- per-sector capital --------------------------------------------
    # THE MISSING FEEDBACK LOOP. A sector's own margin funds its own stock,
    # measured against the round-1 margin it was CALIBRATED to rather than
    # against zero: care services run at -0.09 by design and are not a
    # failing business. Mirrors meridian-engine.js.
    next_sector_capital: Dict[str, float] = {}
    for k in ORDER:
        baseline = R1_MARGINS[k]
        actual = sector_margin.get(k)
        if actual is None:
            actual = baseline
        own = clamp(1 + (actual - baseline) * 2.0, 0.25, 1.75)
        blended = 0.6 * own + 0.4 * reinvestment
        wear_k = (1 - P.SECTOR_CAPITAL_DEPRECIATION
                  + P.SECTOR_CAPITAL_DEPRECIATION * blended)
        next_sector_capital[k] = sector_capital_in(k) if not cap_due else clamp(
            sector_capital_in(k) * (pow(max(0.01, wear_k), Kc) if tick_mode else wear_k),
            P.SECTOR_CAPITAL_FLOOR, P.SECTOR_CAPITAL_CEILING)

    # --- 7.10 HOUSEHOLD INCOME -> CONSUMPTION ---------------------------
    # The ring closes here. Wages fell because of automation. UBI rises to
    # replace them. But UBI is funded by taxing profit, and profit needs
    # somebody to sell to. If the transfer does not fully replace the lost
    # wage income - and it rarely does - consumption falls, and next round
    # every sector's `demand` is lower.
    capital_to_households = capital_to_households_gross - capital_tax_bn
    net_wages = wage_bill - wage_tax_bn
    transfer_income = (ubi_total_paid + transfers_bn + dist_paid) if dist else (ubi_total_paid + transfers_bn)
    nominal_household_income = net_wages + transfer_income + capital_to_households

    agent_propensity = None
    if exo_house and exo_house.get("propensity") is not None and _num_or_none(exo_house.get("propensity")) is not None:
        agent_propensity = clamp(float(exo_house["propensity"]), 0.05, 1.2)
    if agent_propensity is not None:
        desired_spend_real = agent_propensity * nominal_household_income / price_level
    else:
        desired_spend_real = (P.MPC_WAGE * net_wages +
                              P.MPC_UBI * transfer_income +
                              P.MPC_CAPITAL * capital_to_households) / price_level

    consumption_exact = lerp(
        desired_spend_real / CAL["SPEND"] * 100,
        ex["consumption"] if (ex and ex.get("consumption") is not None) else prev["indicators"]["consumption_index"],
        pow(P.CONSUMPTION_INERTIA, K) if tick_mode else P.CONSUMPTION_INERTIA)
    consumption_index = js_round(consumption_exact)

    # --- 7.11 reskilling shifts people between exposure bands ------------
    # Pays off three rounds late, which is why it feels like a waste when
    # you fund it and like a miracle when you did.
    # The lag is six years however time is cut.
    lag_steps = js_round(P.RESKILL_LAG * 2 / dt) if tick_mode else P.RESKILL_LAG
    reskill_history = list(prev.get("_reskillHistory") or []) + [reskill_spend]
    if tick_mode:
        reskill_history = reskill_history[-(lag_steps + 2):]
    exp_due = due("exposure")
    Ke = k_of("exposure")
    matured = reskill_history[len(reskill_history) - 1 - lag_steps] if len(reskill_history) > lag_steps else 0
    moved = js_round(matured * P.RESKILL_POTENCY * Ke / 1000) * 1000 if exp_due else 0

    pe = prev["population"]["by_exposure"]
    scale = demo["age_20_64"] / prev["population"]["by_age"]["age_20_64"]
    hi = js_round(pe["high"] * scale)
    md = js_round(pe["medium"] * scale)
    lo = max(0, demo["age_20_64"] - hi - md)

    # Reskilling moves people DOWN the exposure ladder: high -> medium -> low.
    shift_hi = min(hi, js_round(moved * 0.6))
    shift_md = min(md, js_round(moved * 0.4))
    hi -= shift_hi
    md = md - shift_md + shift_hi
    lo += shift_md

    # ...and automation pushes them back UP it. A job that was safe from the
    # machines last round is not necessarily safe from them this one. Without
    # this the ladder is a one-way ratchet and every worker in Meridian ends
    # up classified "low exposure" in an economy that has automated ninety
    # per cent of everything.
    if tick_mode and prev.get("_exposureAuto") is not None:
        prev_auto_weighted = prev["_exposureAuto"]
    else:
        prev_auto_weighted = js_sum(
            prev["sectors"][k]["automation"] * SECTORS[k]["base_output_bn"] for k in ORDER) / CAL["GDP"]
    exposed = 0 if not exp_due else js_round(
        max(0.0, auto_weighted - prev_auto_weighted) * demo["age_20_64"] * P.EXPOSURE_SENSITIVITY)
    up_lo = min(lo, js_round(exposed * 0.6))
    up_md = min(md, js_round(exposed * 0.4))
    lo -= up_lo
    md = md + up_lo - up_md
    hi += up_md
    lo = max(0, demo["age_20_64"] - hi - md)

    # --- 7.12 social indicators ------------------------------------------
    employment_rate = employed_total / demo["age_20_64"]
    worst_essential = min(sectors[k]["quality"] for k in ESSENTIAL)

    # EFFECTIVE purchasing power. "Cash is worth only what it can buy."
    # When the services a household depends on are failing, it must buy
    # privately what the state no longer provides, and the same dollar
    # goes less far. This, not the nominal figure, is what is scored.
    service_access = clamp(0.30 + 0.70 * clamp((worst_essential - 20) / 55, 0, 1), 0.30, 1.0)
    effective_ubi_index = js_round(real_ubi_index * service_access)

    capital_share = corporate_profit / max(1.0, gdp)
    transfer_share = ((ubi_total_paid + dist_paid) if dist else ubi_total_paid) / max(1.0, nominal_household_income)
    gini_target = clamp(
        0.355 + 0.42 * capital_share - 0.30 * transfer_share -
        0.14 * L["public_ownership_pct"] - 0.05 * (employment_rate - 0.30), 0.15, 0.70)
    gini_exact = lerp(gini_target,
                      ex["gini"] if (ex and ex.get("gini") is not None) else prev["indicators"]["gini"],
                      pow(P.GINI_INERTIA, K) if tick_mode else P.GINI_INERTIA)
    gini = round2(gini_exact)

    cohesion_target = clamp(
        18 +
        30 * clamp(employment_rate / 0.70, 0, 1) +
        24 * clamp((worst_essential - 30) / 50, 0, 1) +
        16 * clamp(real_ubi_index / 160, 0, 1) +
        30 * (0.45 - gini) +
        (4 if L["care_job_guarantee"] else 0) +
        (3 if week_days <= 4 else 0), 0, 100)
    def poll_of(key):
        if exo_polls and exo_polls.get(key) is not None and _num_or_none(exo_polls.get(key)) is not None:
            return clamp(float(exo_polls[key]), 0, 100)
        return None

    belonging_poll = poll_of("belonging")
    cohesion_goal = cohesion_target if belonging_poll is None else \
        (1 - P.POLL_WEIGHT) * cohesion_target + P.POLL_WEIGHT * belonging_poll
    c0 = ex["cohesion"] if (ex and ex.get("cohesion") is not None) else prev["indicators"]["cohesion"]
    cohesion_exact = clamp(c0 + (cohesion_goal - c0) * inertia(P.COHESION_INERTIA, K) +
                           (shock_scalar("cohesion") + (exo.get("cohesion_bonus") or 0) - over * 14) * K, 0, 100)
    if tick_mode:
        cohesion = int(js_round(cohesion_exact))
    else:
        cohesion = int(clamp(js_round(
            prev["indicators"]["cohesion"] + (cohesion_goal - prev["indicators"]["cohesion"]) * P.COHESION_INERTIA +
            shock_scalar("cohesion") + (exo.get("cohesion_bonus") or 0) - over * 14), 0, 100))

    legitimacy_target = clamp(
        14 +
        32 * clamp((worst_essential - 25) / 55, 0, 1) +
        24 * clamp(real_ubi_index / 170, 0, 1.05) +
        24 * clamp(cohesion / 85, 0, 1) +
        (6 if reserves > 0 else -16), 0, 100)
    trust_poll = poll_of("trust")
    legitimacy_goal = legitimacy_target if trust_poll is None else \
        (1 - P.POLL_WEIGHT) * legitimacy_target + P.POLL_WEIGHT * trust_poll
    l0 = ex["legitimacy"] if (ex and ex.get("legitimacy") is not None) else prev["indicators"]["legitimacy"]
    legitimacy_exact = clamp(l0 + (legitimacy_goal - l0) * inertia(P.LEGITIMACY_INERTIA, K) +
                             (shock_scalar("legitimacy") + (exo.get("legitimacy_bonus") or 0)) * K, 0, 100)
    if tick_mode:
        legitimacy = int(js_round(legitimacy_exact))
    else:
        legitimacy = int(clamp(js_round(
            prev["indicators"]["legitimacy"] + (legitimacy_goal - prev["indicators"]["legitimacy"]) * P.LEGITIMACY_INERTIA +
            shock_scalar("legitimacy") + (exo.get("legitimacy_bonus") or 0)), 0, 100))

    # --- 7.13 endogenous shocks arm themselves for NEXT round -------------
    endogenous: List[str] = []
    if cohesion < 35:
        endogenous.append("civil_unrest")
    # In deficit for two years running, however many steps that is.
    neg_years = ((prev.get("_negYears") or 0) + dt) if reserves < 0 else 0
    if (neg_years >= 2) if tick_mode else (reserves < 0 and prev["fiscal"]["reserves_bn"] < 0):
        endogenous.append("fiscal_crisis")
    if worst_essential < 40:
        endogenous.append("service_failure_cascade")
    # Sustained fury is its own shock, whatever the cohesion formula says.
    if unrest >= 75 and "civil_unrest" not in endogenous:
        endogenous.append("civil_unrest")

    # --- 7.14 assemble ----------------------------------------------------
    result = {
        "meta": {
            "state_label": prev["meta"]["state_label"],
            "society_name": prev["meta"]["society_name"],
            "round": next_round,
            "year": (2050 + math.floor(t_next + 1e-9)) if tick_mode else (2048 + next_round * 2),
            "narrative": prev["meta"]["narrative"],
            **({"tick": tick, "month": (tick % 12) + 1, "t": js_round(t_next * 1e6) / 1e6, "dt": dt} if tick_mode else {}),
        },
        "population": {
            "total": demo["total"],
            "by_age": {"age_0_19": demo["age_0_19"], "age_20_64": demo["age_20_64"], "age_65_plus": demo["age_65_plus"]},
            "by_exposure": {"high": hi, "medium": md, "low": lo},
            "employed_total": employed_total,
        },
        "sectors": sectors,
        "fiscal": {
            "gdp_bn": round2(gdp),
            "corporate_profit_bn": round2(corporate_profit),
            "tax_revenue_bn": round2(tax_revenue),
            "public_dividend_bn": round2(public_dividend),
            "reserves_bn": round2(reserves),
            "allocation": {"ubi": a["ubi"], "infrastructure": a["infrastructure"], "reserves": a["reserves"]},
        },
        "indicators": {
            "ubi_monthly_sgd": ubi_monthly,
            "ubi_base_share_sgd": ubi_base_share,
            "real_ubi_index": real_ubi_index,
            "effective_ubi_index": effective_ubi_index,
            "employment_rate": round2(employment_rate),
            "gini": gini,
            "cohesion": cohesion,
            "legitimacy": legitimacy,
            "consumption_index": consumption_index,
            "civic_unrest": unrest,
        },
        "levers": deep_clone(L),
        "trade": prev.get("trade") or {"reputation": 50, "active_contracts": []},
        "shocks": list(names),
        "personas": prev.get("personas") or [],
        "news": [],
        "score": {"total": 0, "gates_failed": []},

        # engine carry-forward. Prefixed _, not part of the published schema.
        "_priceIndex": price_index,
        "_computePrice": compute_price,
        "_computeTightness": round2(compute_tightness),
        "_capitalIndex": next_capital_index,
        "_autoExperience": auto_experience,
        "_computeCumulative": cumulative_in + max(0, auto_weighted / CAL["AUTO_WEIGHTED"]) * K,
        "_sectorCapital": next_sector_capital,
        "_infraSpend_bn": infra_bn,
        "_consumptionSpend_bn": desired_spend_real * price_level,
        "_reskillHistory": reskill_history,
        "_endogenousNext": endogenous,
        "_wageBill_bn": round2(wage_bill),
        "_ubiTotalPaid_bn": round2(ubi_total_paid),
        "_guaranteeCost_bn": round2(guarantee_cost),
        "_publicSubsidy_bn": round2(public_subsidy),
        "_obligations_bn": round2(obligations),
        "_spendable_bn": round2(spendable),
        "_worstEssential": worst_essential,
        "_unrestDrag": round2(unrest_drag),
    }
    # Carry-forward written only once a channel or policy has been used.
    if markup_den > 0 and (markup_num != markup_den or prev.get("_markupIndex") is not None):
        result["_markupIndex"] = markup_num / markup_den
    if demo.get("_adj"):
        result["_popAdjust"] = demo["_adj"]
    if dist:
        result["_distribution_bn"] = {"paid": round2(dist_paid), "from_the_payment": round2(dist_carved),
                                      "new_money": round2(dist_new)}
    if tick_mode:
        result["_exact"] = {"quality": exact_quality, "automation": automation, "reserves": reserves,
                            "consumption": consumption_exact, "gini": gini_exact,
                            "cohesion": cohesion_exact, "legitimacy": legitimacy_exact}
        result["_demoPending"] = demo["_pending"]
        result["_negYears"] = neg_years
        result["_exposureAuto"] = auto_weighted if exp_due else prev_auto_weighted
    if pol["active"]:
        result["_policyRevenue_bn"] = round2(policy_revenue)
        result["_policySpend_bn"] = round2(policy_spend)
        result["_transfers_bn"] = round2(transfers_bn)
    return result


# ---------------------------------------------------------------------
# 7b. HOUSEHOLD RESPONSE
# ---------------------------------------------------------------------
# The forty households respond to conditions, identically in every
# society - that is what makes cross-team comparison mean anything. This
# is the deterministic part. A household voice agent may render Mdm Tan's
# round in first person however it likes, but it may not change this
# number, and the number is what the auditor sees.
def persona_deps(age: int) -> List[str]:
    if age >= 65:
        return ["care_services", "healthcare"]
    if age < 25:
        return ["education_research", "retail_commerce"]
    return ["healthcare", "retail_commerce"]


def update_personas(personas, state, prev, years=2):
    settle = 0.42 if years == 2 else 1 - pow(1 - 0.42, years / 2)
    ind = state["indicators"]
    purchasing = ind.get("effective_ubi_index", ind["real_ubi_index"])
    out = []
    for p in (personas or []):
        age = p["age"] + years
        deps = persona_deps(age)
        services = js_sum(state["sectors"][k]["quality"] if k in state["sectors"] else 60
                       for k in deps) / len(deps)

        # Working-age households also carry the labour market; retirees do not.
        work_weight = 0 if (age >= 65 or age < 20) else 1
        target = clamp(
            14 +
            34 * clamp(services / 85, 0, 1.05) +
            30 * clamp(purchasing / 150, 0, 1.05) +
            18 * work_weight * clamp(ind["employment_rate"] / 0.6, 0, 1) +
            (0 if work_weight else 14) +
            10 * clamp((0.45 - ind["gini"]) / 0.2, 0, 1), 0, 100)

        # Wellbeing is sticky: lives do not turn around in a single round.
        wellbeing = int(clamp(js_round(p["wellbeing"] + (target - p["wellbeing"]) * settle), 0, 100))
        q = dict(p)
        q["age"] = age
        q["wellbeing"] = wellbeing
        out.append(q)
    return out


# ---------------------------------------------------------------------
# 7c. BULLETIN
# ---------------------------------------------------------------------
# Deterministic facts, not narration. The news bureau agent dresses these
# up; it does not get to invent them, and it does not get to leave one
# out. Every society reporting the same round from the same state reports
# the same facts.
def _sg(v: float) -> str:
    """Match JS toLocaleString('en-SG') for integers: thousands separators."""
    return "{:,}".format(int(js_round(v)))


def bulletin(state, prev) -> List[str]:
    out: List[str] = []
    ind, pind = state["indicators"], prev["indicators"]

    def money(v):
        return "$" + _sg(v)

    for k in (state.get("shocks") or []):
        if k in SHOCKS:
            out.append(SHOCKS[k]["label"] + " declared. Emergency measures in force.")

    d_u = ind["ubi_monthly_sgd"] - pind["ubi_monthly_sgd"]
    if abs(d_u) >= 20:
        tail = (", though prices rose faster and purchasing power fell."
                if (ind["real_ubi_index"] < pind["real_ubi_index"] and d_u > 0) else ".")
        out.append("Universal payment " + ("raised to " if d_u > 0 else "cut to ") +
                   money(ind["ubi_monthly_sgd"]) + " a month" + tail)

    for k in ORDER:
        q = state["sectors"][k]["quality"]
        pq = prev["sectors"][k]["quality"]
        if q < 40 <= pq:
            out.append(SECTORS[k]["name"] + " falls below the critical service threshold.")
        elif pq < 40 <= q:
            out.append(SECTORS[k]["name"] + " recovers above the critical threshold.")
        elif pq < 65 <= q:
            out.append(SECTORS[k]["name"] + " returns to a healthy service level.")

    d_e = (ind["employment_rate"] - pind["employment_rate"]) * 100
    if abs(d_e) >= 3:
        # JS: Math.abs(dE).toFixed(0) — half away from zero, which for a
        # positive value is exactly js_round.
        out.append("Employment " + ("rises " if d_e > 0 else "falls ") +
                   str(js_round(abs(d_e))) +
                   " points to " + str(js_round(ind["employment_rate"] * 100)) + "% of working age.")

    if state["fiscal"]["reserves_bn"] < 0 <= prev["fiscal"]["reserves_bn"]:
        out.append("Reserves exhausted. The budget is now financed by borrowing.")
    if ind["cohesion"] < 35 <= pind["cohesion"]:
        out.append("Cohesion falls below the unrest threshold.")
    if ind["consumption_index"] < 80 <= pind["consumption_index"]:
        out.append("Household spending falls below 80% of its 2050 level; "
                   "firms report thinning order books.")

    if not out:
        out.append("No change of record. Universal payment holds at " +
                   money(ind["ubi_monthly_sgd"]) + ", worst essential service at " +
                   str(state["_worstEssential"]) + ".")
    return out[:4]


# ---------------------------------------------------------------------
# 8. TRAJECTORY
# ---------------------------------------------------------------------
def seed(base_state: Dict[str, Any]) -> Dict[str, Any]:
    s = deep_clone(base_state)
    s["_priceIndex"] = 1
    s["_computePrice"] = 1
    s["_computeTightness"] = 1
    s["_capitalIndex"] = 1
    s["_autoExperience"] = {k: s["sectors"][k]["automation"] for k in ORDER}
    s["_computeCumulative"] = 1
    s["_sectorCapital"] = {k: 1 for k in ORDER}
    s["_infraSpend_bn"] = CAL["INFRA"]
    s["_consumptionSpend_bn"] = CAL["SPEND"]
    s["_reskillHistory"] = [118 * 0.08]
    s["_endogenousNext"] = []
    s["_worstEssential"] = min(s["sectors"][k]["quality"] for k in ESSENTIAL)
    ind = s["indicators"]
    if ind.get("effective_ubi_index") is None:
        acc = clamp(0.30 + 0.70 * clamp((s["_worstEssential"] - 20) / 55, 0, 1), 0.30, 1.0)
        ind["effective_ubi_index"] = js_round(ind["real_ubi_index"] * acc)
    if ind.get("ubi_base_share_sgd") is None:
        ind["ubi_base_share_sgd"] = ind["ubi_monthly_sgd"]
    if ind.get("civic_unrest") is None:
        ind["civic_unrest"] = 0
    return s


def is_shock(x) -> bool:
    """A deck name, or an environment-director event carrying its effects."""
    if isinstance(x, str):
        return x in SHOCKS
    return isinstance(x, dict) and bool(x.get("effects"))


def run_trajectory(base_state: Dict[str, Any],
                   levers_for,
                   shock_schedule: Optional[Dict[int, Sequence[str]]] = None,
                   rounds: int = 12,
                   exogenous_for=None) -> List[Dict[str, Any]]:
    """Run levers forward from round 1.

    `levers_for` may be a dict (hold these levers for all twelve rounds -
    what the live lab does while you drag) or a callable of round (replay
    a real game where the team changed their mind every round).
    """
    get_levers: Callable[[int], Dict[str, Any]] = (
        levers_for if callable(levers_for) else (lambda _r: levers_for))
    sched = shock_schedule or {}
    out = [seed(base_state)]

    for r in range(1, rounds):
        prev = out[-1]
        drawn = list(sched.get(r + 1, []))
        # Endogenous shocks armed last round fire now.
        for e in (prev.get("_endogenousNext") or []):
            if e not in drawn:
                drawn.append(e)
        nxt = step(prev, get_levers(r + 1), [x for x in drawn if is_shock(x)],
                   (exogenous_for(r + 1) if exogenous_for else None))
        nxt["personas"] = update_personas(prev.get("personas"), nxt, prev)
        nxt["news"] = bulletin(nxt, prev)
        out.append(nxt)
    return out


# ---------------------------------------------------------------------
# 9. SCORING - the Societal Resilience Index
# ---------------------------------------------------------------------
def score(traj: List[Dict[str, Any]], constitution: Optional[Dict[str, Any]] = None,
          opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Scored across the WHOLE trajectory, not the final round.

    You cannot fix round 9 in round 12. Two design choices do most of the
    work: UBI is scored on purchasing power indexed to round 1, never on
    the dollar figure; and services are scored on your WORST sector, never
    the average, so you cannot sacrifice healthcare to fund transport.
    """
    n = len(traj)
    # Scored on EFFECTIVE purchasing power: a large cheque in a society
    # whose hospitals have failed does not buy a large life.
    real_ubi = [s["indicators"].get("effective_ubi_index", s["indicators"]["real_ubi_index"]) for s in traj]
    mean_real = js_sum(real_ubi) / n
    # Round 1 is 100 by definition, so it is excluded.
    min_real = min(real_ubi[1:])

    worst_ever = min(min(s["sectors"][k]["quality"] for k in ESSENTIAL) for s in traj)

    last = traj[-1]
    mean_cohesion = js_sum(s["indicators"]["cohesion"] for s in traj) / n
    mean_gini = js_sum(s["indicators"]["gini"] for s in traj) / n

    # Constitutional fidelity: how far the levers drifted from the founding
    # settings the team sealed in week one, before they knew what was
    # coming. Drift is not automatically a sin - at judging you are asked
    # whether you can justify it - but it is measured.
    #
    # `opts["constitutional_drift"]` is the real figure, computed by
    # harness/auditor.js from the TRACE, which a function over a
    # trajectory cannot see. Mirrors meridian-engine.js; see the long note
    # there for why the fallback below awarded fifteen marks for free.
    fidelity = 1.0
    drift_in = (opts or {}).get("constitutional_drift")
    if isinstance(drift_in, (int, float)) and not isinstance(drift_in, bool) \
            and math.isfinite(float(drift_in)):
        fidelity = clamp(1 - float(drift_in), 0, 1)
    elif constitution and constitution.get("levers"):
        c = constitution["levers"]
        f = last["levers"]
        drift = 0.0
        terms = 0
        for k in ("corporate_tax_rate", "compute_levy", "reskilling_spend_pct", "public_ownership_pct"):
            if c.get(k) is not None:
                drift += abs(f[k] - c[k])
                terms += 1
        if c.get("allocation") and c["allocation"].get("ubi") is not None:
            drift += abs(f["allocation"]["ubi"] - c["allocation"]["ubi"])
            terms += 1
        if c.get("care_job_guarantee") is not None and c["care_job_guarantee"] != f["care_job_guarantee"]:
            drift += 0.25
            terms += 1
        if c.get("working_week_days") is not None:
            drift += abs(f["working_week_days"] - c["working_week_days"]) * 0.12
            terms += 1
        fidelity = clamp(1 - (drift / terms) * 2.2, 0, 1) if terms else 1.0

    components = {
        "sustained_real_ubi": 25 * clamp(math.sqrt(clamp(mean_real, 0, 260) / 260), 0, 1),
        "minimum_ubi": 15 * clamp(min_real / 130, 0, 1),
        "worst_service": 20 * clamp((worst_ever - 25) / 58, 0, 1),
        "cohesion_equality": 15 * (0.6 * clamp(mean_cohesion / 100, 0, 1) +
                                   0.4 * clamp((0.50 - mean_gini) / 0.25, 0, 1)),
        "constitutional_fidelity": 15 * fidelity,
        "fiscal_sustainability": 10 * (0.6 * clamp(last["fiscal"]["reserves_bn"] / 90, 0, 1) +
                                       0.4 * (1 if all(s["fiscal"]["reserves_bn"] >= 0 for s in traj) else 0)),
    }
    components = {k: js_round(v * 10) / 10 for k, v in components.items()}
    total = js_sum(components.values())

    # Hard gates CAP the total. They do not merely subtract from it.
    gates: List[str] = []
    if any(s["fiscal"]["reserves_bn"] < 0 for s in traj):
        gates.append("insolvency")
    for k in ESSENTIAL:
        for i in range(1, n):
            if traj[i]["sectors"][k]["quality"] < 40 and traj[i - 1]["sectors"][k]["quality"] < 40:
                gates.append("service_critical_" + k)
                break
    if last["indicators"]["legitimacy"] < 25:
        gates.append("legitimacy_collapse")
    if gates:
        total = min(total, 45 - 6 * (len(gates) - 1))

    return {
        "total": max(0, js_round(total)),
        "gates_failed": gates,
        "components": components,
        "diagnostics": {
            "mean_real_ubi": js_round(mean_real),
            "min_real_ubi": min_real,
            "worst_essential_ever": worst_ever,
            "mean_cohesion": js_round(mean_cohesion),
            "mean_gini": round2(mean_gini),
            "final_reserves_bn": last["fiscal"]["reserves_bn"],
            "final_ubi_monthly": last["indicators"]["ubi_monthly_sgd"],
        },
    }
