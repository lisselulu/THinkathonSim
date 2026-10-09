"""
=====================================================================
MERIDIAN'S CITIZENS, AS CONCORDIA AGENTS
---------------------------------------------------------------------
Twelve generative agents, one per cohort, each of which:

    * remembers what it has lived through and what it did about it
    * receives ONLY its own lived experience, never the government's
    * chooses from a fixed action space rather than writing free text

    The third point is the one that matters. Concordia's natural output is
    free-form action ("Rahim goes to the coffee shop and complains"), which
    is wonderful for a story and useless to an economic engine. We use
    `OutputType.CHOICE` against the twelve behaviours the engine already
    knows how to price, so an agent's decision arrives as `strike` and the
    engine can act on it.

    free text  -> a nice transcript, no simulation
    choice     -> a simulation, and the words come free anyway

    THE BLINDNESS CONSTRAINT
    ------------------------
    Nothing in this file reads a lever, an indicator, or a score, because
    nothing in this file is ever SENT one. The JS side builds the
    observation from `engine/lived.js` and asserts it clean before it
    leaves the process; this side additionally refuses to start an agent
    whose observation contains a forbidden term, so a mistake upstream
    fails here too rather than quietly teaching the agents to read a
    dashboard.

    WHY A SIDECAR AND NOT A PORT
    ----------------------------
    The engine is JavaScript, verified line-for-line against a Python
    reimplementation by `engine/test_parity.py`, and everything else in the
    project is scored against it. Porting it to run inside Concordia would
    throw that away to win a process boundary. So the engine stays where it
    is and the two talk over HTTP: observations out, action keys back.

    WHY THIS DIRECTORY IS NOT CALLED `concordia/`
    ---------------------------------------------
    It was, for about ten minutes. A directory named `concordia` on the
    path IS a namespace package called `concordia`, so it shadows the
    installed one and every `from concordia.agents import ...` in this file
    resolves to our own empty folder. The failure is quiet and reads like a
    broken install, which is the worst way to lose an afternoon.

    CONCORDIA IS OPTIONAL AT IMPORT TIME
    ------------------------------------
    `pip install gdm-concordia` pulls a large dependency tree. If it is not
    present this module still imports and `available()` returns False, so
    `server.py` can come up, report honestly what it is, and let the JS side
    fall back to arithmetic instead of crashing a demo.
    =====================================================================
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------
# Concordia, if it is installed.
# ---------------------------------------------------------------------
_IMPORT_ERROR: Optional[str] = None
try:
    from concordia.agents import entity_agent_with_logging
    from concordia.associative_memory import basic_associative_memory
    from concordia.components import agent as agent_components
    from concordia.language_model import language_model as lm_lib
    from concordia.typing import entity as entity_lib

    _HAVE_CONCORDIA = True
except Exception as exc:  # pragma: no cover - depends on the machine
    _HAVE_CONCORDIA = False
    _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"


def available() -> bool:
    """True when real Concordia agents can be built."""
    return _HAVE_CONCORDIA


def import_error() -> Optional[str]:
    return _IMPORT_ERROR


# ---------------------------------------------------------------------
# THE GUARD, ON THIS SIDE TOO
# ---------------------------------------------------------------------
# Mirrors engine/lived.js FORBIDDEN. Duplicated deliberately: a guard
# that lives only on the other side of a network boundary is a guard
# that stops existing the first time somebody calls this server directly,
# which is exactly what a teammate debugging it will do.
FORBIDDEN = (
    "corporate_tax", "corporate tax", "compute_levy", "compute levy",
    "reskilling_spend", "public_ownership", "public ownership",
    "allocation", "automation_target", "ubi_design", "means_tested",
    "age_weighted", "care_job_guarantee", "working_week_days",
    "gini", "effective_ubi", "real_ubi", "purchasing power index",
    "reserves_bn", "gdp", "tax revenue", "cohesion", "legitimacy",
    "lever", "levers", "the engine", "indicator", "score", "gate",
    )


def leaks(text: str) -> List[str]:
    low = str(text).lower()
    return [w for w in FORBIDDEN if w in low]


def assert_blind(text: str) -> None:
    bad = leaks(text)
    if bad:
        raise ValueError(
            "a citizen was about to be shown government-side information: "
            + ", ".join(bad)
        )


# ---------------------------------------------------------------------
# THE OBSERVATION, AS A CITIZEN WOULD TELL IT
# ---------------------------------------------------------------------
def observation_to_prose(obs: Dict[str, Any]) -> str:
    """
    The JSON the engine sends, rendered as the situation a person is in.

    Written in second person and in plain language on purpose. A model
    handed `{"money_feels": "is short..."}` reasons about a data
    structure; a model handed "What they give you is short" reasons
    about a life, and picks differently.
    """
    lines: List[str] = []

    year = obs.get("year")
    lines.append(f"It is {year}." if year else "Another two years have passed.")

    money = obs.get("money_feels")
    if money:
        lines.append(f"The payment {money}.")

    changed = obs.get("payment_changed_by")
    if isinstance(changed, (int, float)) and changed:
        lines.append(
            "It went up this time." if changed > 0 else "It was cut this time."
        )

    work = obs.get("work_feels")
    if work:
        lines.append(f"As for work: {work}.")

    services = obs.get("services") or []
    for s in services:
        name, feel = s.get("name"), s.get("feel")
        if name and feel:
            direction = s.get("direction")
            tail = "" if direction in (None, "unchanged") else f", and {direction}"
            lines.append(f"{name} is {feel}{tail}.")

    happened = obs.get("something_happened") or []
    if happened:
        lines.append("This year: " + ", ".join(happened) + ".")

    talk = obs.get("talk_of_the_town") or []
    if talk:
        lines.append("People are talking about: " + "; ".join(str(t) for t in talk) + ".")

    # Memory. What continuity feels like from the inside.
    years = obs.get("years_like_this") or 0
    if years >= 6:
        lines.append(f"It has been like this for {years} years now.")
    elif years >= 2:
        lines.append("It has been like this for a while.")

    last = obs.get("last_time_i")
    if last:
        lines.append(f"Last time, what you did about it was: {last}.")

    return "\n".join(lines)


# ---------------------------------------------------------------------
# ONE CITIZEN
# ---------------------------------------------------------------------
@dataclass
class Citizen:
    """
    A cohort's agent, plus the memory it carries between rounds.

    `history` is kept here rather than only inside Concordia's memory
    bank so that a run can be dumped and read by a human afterwards. An
    agent whose reasoning nobody can inspect is a random number
    generator with good manners.
    """

    cohort_id: str
    name: str
    role: str
    temperament: str
    agent: Any = None
    memory: Any = None
    history: List[Dict[str, Any]] = field(default_factory=list)

    def remember(self, round_no: int, situation: str, chose: str) -> None:
        self.history.append(
            {"round": round_no, "situation": situation, "chose": chose}
        )
        if self.memory is not None:
            self.memory.append(f"[{round_no}] {situation}\nWhat I did: {chose}")


# ---------------------------------------------------------------------
# THE SECOND POPULATION: INDUSTRIES
# ---------------------------------------------------------------------
# A firm is not a citizen with a balance sheet. It is optimising a
# MISSION -- what its industry is FOR -- of which margin is one input and
# never the whole of it. A hospital that is profitable and turning people
# away has failed at the thing it exists to do.
#
# The mission is AUTHORED in engine/sector_missions.js and handed to the
# agent. It never chooses its own: an industry that sets its own targets
# can declare success on throughput while the country starves, and no
# number anywhere would contradict it.
FIRM_FORBIDDEN = (
    "reserves_bn", "tax revenue", "score", "gate", "the engine",
    "cohesion", "legitimacy", "gini", "civic_unrest", "sentiment",
    "effective_ubi", "real_ubi", "purchasing power index", "ubi_design",
    "means_tested", "age_weighted", "lever", "levers",
    )


def firm_leaks(text: str) -> List[str]:
    low = str(text).lower()
    return [w for w in FIRM_FORBIDDEN if w in low]


def assert_firm_blind(text: str) -> None:
    """A firm's blindfold is not a citizen's.

    A firm PAYS the corporate tax rate and reads the prices it buys at; a
    citizen may see neither. What a firm must not see is the treasury,
    the score it is not playing for, or the citizen feed. Handing a firm
    a citizen's blindfold produces a company that cannot read its own
    cost base, and the usual response to that is to remove the guard.
    """
    bad = firm_leaks(text)
    if bad:
        raise ValueError(
            "an industry was about to be shown information it may not have: "
            + ", ".join(bad))


def firm_observation_to_prose(obs: Dict[str, Any]) -> str:
    """One industry's position, as its board would describe it."""
    lines: List[str] = []
    year = obs.get("year")
    lines.append(f"It is {year}." if year else "Another two years have passed.")

    if obs.get("margin_feels"):
        lines.append(f"The margin is {obs['margin_feels']}.")
    if obs.get("demand_feels"):
        lines.append(obs["demand_feels"].capitalize() + ".")
    if obs.get("staff_feels"):
        lines.append(obs["staff_feels"].capitalize() + ".")

    auto = obs.get("automation_now")
    ceiling = obs.get("automation_ceiling")
    room = obs.get("room_to_automate")
    if auto is not None and ceiling is not None:
        lines.append(
            f"{auto}% of the work here is done without people. The regulator "
            f"allows up to {ceiling}%, so there is {room} points of room left.")

    if obs.get("energy_costs"):
        lines.append(f"Energy and compute cost {obs['energy_costs']}.")

    level = obs.get("service_level")
    if level is not None:
        lines.append(f"The service this industry delivers is rated {level} out of 100.")

    happened = obs.get("something_happened") or []
    if happened:
        lines.append("This year: " + ", ".join(happened) + ".")

    last = obs.get("last_time_we")
    if last:
        lines.append(f"Last time, what this industry did was: {last}.")

    return "\n".join(lines)


def _firm_context(obs: Dict[str, Any]) -> str:
    """Who this industry is, and what it is FOR.

    The mission goes in the persona rather than the question, because it
    is what the industry is, not what it is being asked this round.
    """
    name = obs.get("name", "an industry")
    mission = obs.get("mission") or "keeping going."
    judged = obs.get("what_we_are_judged_on") or []
    judged_line = (" It is judged, in order, on: " + ", ".join(judged) + ".") if judged else ""
    return (
        f"You are the leadership of {name} in Meridian, a city-state where "
        f"machines do most of the work and everyone receives a monthly payment "
        f"from the state instead of a wage."
        "\n\n"
        f"What this industry is FOR: {mission}{judged_line}"
        "\n\n"
        f"Margin matters because an industry that cannot pay for itself stops "
        f"existing. It is not what you are for. You read your own accounts, "
        f"the prices you pay, the demand in front of you, and the limits the "
        f"regulator has set. You do not see the national accounts, and how "
        f"well the government is judged to be doing is not your business.")


def build_firm(model: Any, obs: Dict[str, Any]) -> "Citizen":
    """One Concordia agent for one industry.

    Reuses the Citizen dataclass and the same component wiring: the
    machinery is about remembering and choosing, and neither of those
    cares whether the entity is a person or a company.
    """
    if not _HAVE_CONCORDIA:
        raise RuntimeError("concordia is not installed: " + str(_IMPORT_ERROR))

    name = obs.get("name", obs.get("id", "industry"))
    context = _firm_context(obs)
    assert_firm_blind(context)

    memory_bank: List[str] = []
    components = {
        "instructions": agent_components.instructions.Instructions(
            agent_name=name, pre_act_label="\nHow to answer"),
        "self": agent_components.constant.Constant(
            state=context, pre_act_label="\nWhat this industry is"),
        agent_components.memory.DEFAULT_MEMORY_COMPONENT_KEY:
            agent_components.memory.ListMemory(memory_bank=memory_bank),
        "observation_to_memory": agent_components.observation.ObservationToMemory(),
        "observations": agent_components.observation.LastNObservations(
            history_length=12, pre_act_label="\nRecent years"),
    }
    agent = entity_agent_with_logging.EntityAgentWithLogging(
        agent_name=name,
        act_component=agent_components.concat_act_component.ConcatActComponent(
            model=model, component_order=("instructions", "self", "observations")),
        context_components=components,
    )
    return Citizen(cohort_id=obs["id"], name=name,
                   role=obs.get("role", ""), temperament="",
                   agent=agent, memory=memory_bank)


def _persona_context(name: str, role: str, temperament: str) -> str:
    """
    Who this person is. Deliberately short and free of any political
    position: the whole point is that circumstance, not a written-in
    ideology, drives what they do. An agent told "you are a militant"
    will strike in a golden age.
    """
    return (
        f"{name} is a resident of Meridian, a city-state where machines do most "
        f"of the work and everyone receives a monthly payment from the state "
        f"instead of a wage. {name} is a {role}. By temperament, {name} is "
        f"{temperament}.\n\n"
        f"{name} knows their own life — what the payment covers, the queue at "
        f"the clinic, whether anyone is hiring, what the neighbours are saying. "
        f"{name} has never seen a budget and does not think in policy terms."
    )


def build_citizen(model: Any, cohort: Dict[str, Any]) -> Citizen:
    """One Concordia agent for one cohort."""
    if not _HAVE_CONCORDIA:
        raise RuntimeError("concordia is not installed: " + str(_IMPORT_ERROR))

    name = cohort["name"]
    context = _persona_context(name, cohort.get("role", "resident"),
                               cohort.get("temperament", "even-tempered"))
    assert_blind(context)

    # A PLAIN LIST, NOT AN ASSOCIATIVE BANK.
    # `AssociativeMemoryBank` refuses to accept a memory without a
    # sentence embedder, and an embedder exists to rank memories by
    # SIMILARITY to the current situation. That is the wrong retrieval
    # here: a cohort recalls the last few years of its own life in
    # ORDER, which is exactly what `LastNObservations` reads off a
    # `ListMemory`. Paying for sentence-transformers to rank twelve
    # entries we were going to read in order anyway buys nothing.
    memory_bank: List[str] = []

    components = {
        "instructions": agent_components.instructions.Instructions(
            agent_name=name,
            pre_act_label="\nHow to answer",
        ),
        "self": agent_components.constant.Constant(
            state=context,
            pre_act_label="\nWho I am",
        ),
        # LastNObservations reads through a memory COMPONENT, and it must
        # be registered under this exact key. Register it anywhere else
        # and the agent comes up with no recollection at all, silently
        # re-deciding its life from scratch every round -- which is the
        # one thing Concordia is here to prevent.
        agent_components.memory.DEFAULT_MEMORY_COMPONENT_KEY:
            agent_components.memory.ListMemory(memory_bank=memory_bank),
        # WITHOUT THIS THE AGENTS ARE DECIDING BLIND.
        # `LastNObservations` only READS memory. `observe()` does not
        # write to memory by itself -- `ObservationToMemory` is the
        # component that carries one into the other. Omit it and every
        # agent comes to its decision with a persona, an action menu,
        # and no idea what has happened to it, which produces a
        # plausible-looking answer for the wrong reason: in this
        # project's first run every cohort chose `endure` in every
        # condition, including famine, because none of them had been
        # told there was one.
        "observation_to_memory": agent_components.observation.ObservationToMemory(),
        "observations": agent_components.observation.LastNObservations(
            history_length=12,
            pre_act_label="\nWhat I have lived through",
        ),
    }

    agent = entity_agent_with_logging.EntityAgentWithLogging(
        agent_name=name,
        act_component=agent_components.concat_act_component.ConcatActComponent(
            model=model,
            # Who I am, then what happened to me, then the question.
            component_order=("instructions", "self", "observations"),
        ),
        context_components=components,
    )

    return Citizen(
        cohort_id=cohort["id"],
        name=name,
        role=cohort.get("role", ""),
        temperament=cohort.get("temperament", ""),
        agent=agent,
        memory=memory_bank,
    )


# ---------------------------------------------------------------------
# THE CHOICE
# ---------------------------------------------------------------------
def _call_to_action(menu: List[Dict[str, str]]) -> str:
    """
    The question put to an agent. It names no behaviour as good or bad
    and gives no hint about what a reasonable person does, because the
    entire experiment is what a reasonable person does under conditions
    a team created.
    """
    return (
        "Given everything above, what does {name} actually do about it "
        "over the next two years? Choose the one that fits {name} best."
    )


def choose_for(
    citizen: Citizen,
    obs: Dict[str, Any],
    menu: List[Dict[str, str]],
    round_no: int,
    population: str = "citizen",
) -> str:
    """
    Put one cohort's situation to its agent and return an action key.

    Raises on anything unusable. The caller decides what a failure means
    — and on the JS side it means that cohort is decided by arithmetic
    and the fault is recorded, never that the round silently proceeds
    with a made-up answer.
    """
    # The two corpora are rendered and blindfolded differently: a firm
    # reads its own accounts and the prices it pays, which a citizen may
    # not see; a citizen reads a life, which a firm has no view of.
    if population == "firm":
        situation = firm_observation_to_prose(obs)
        assert_firm_blind(situation)
    else:
        situation = observation_to_prose(obs)
        assert_blind(situation)

    citizen.agent.observe(situation)

    options = [m["option"] for m in menu]
    action_spec = entity_lib.ActionSpec(
        call_to_action=_call_to_action(menu),
        output_type=entity_lib.OutputType.CHOICE,
        options=tuple(options),
        tag="behaviour",
    )

    answer = citizen.agent.act(action_spec)

    # Concordia returns the option TEXT; we need the key behind it.
    key = _key_for_option(answer, menu)
    if key is None:
        raise ValueError(f"unmatched choice from {citizen.name}: {answer!r}")

    citizen.remember(round_no, situation, key)
    return key


def _key_for_option(answer: str, menu: List[Dict[str, str]]) -> Optional[str]:
    """
    Map a returned option back to its key.

    Exact match first. Then a prefix match, because some models return
    the option with trailing commentary attached. Then the key itself,
    because some return `strike` directly. Anything else is a failure and
    is reported as one rather than being guessed at — a wrong guess here
    would put a behaviour into the economy that no agent chose.
    """
    text = str(answer or "").strip()
    if not text:
        return None

    for m in menu:
        if text == m["option"]:
            return m["key"]

    low = text.lower()
    for m in menu:
        opt = m["option"].lower()
        if low.startswith(opt) or opt.startswith(low[:60]):
            return m["key"]

    for m in menu:
        if re.fullmatch(rf"\W*{re.escape(m['key'])}\W*", low):
            return m["key"]

    return None
