"""
=====================================================================
THE CONCORDIA SIDECAR
---------------------------------------------------------------------
    python society/server.py            # port 8765
    python society/server.py --port 9000 --model qwen2.5-14b-instruct-1m

Three routes:

    GET  /health   what is actually loaded, and whether it can decide
    POST /decide   observations in, action keys out
    POST /reset    forget everything; a new run starts clean

It reads `harness/llm.config.json`, so the agents talk to the same
LM Studio server as the cabinet and the feed. One model config for the
whole project; nobody edits two files to change the model.

HONEST HEALTH
-------------
/health reports `can_decide` — whether Concordia imported AND a model
answered. It never reports optimistically. The JS side checks it before
a run so a team knows, before they spend twenty minutes, whether they
are about to watch generative agents or arithmetic. A demo that
silently degrades is how you end up presenting a deterministic run as
an agent-based one.

STATELESS ROUTES, STATEFUL AGENTS
---------------------------------
The agents deliberately persist between calls: memory across rounds is
the thing Concordia is here to provide. That makes /reset load-bearing
rather than a convenience — without it, run two inherits run one's
grievances and the comparison between two governments is worthless.
=====================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import meridian_agents as MA  # noqa: E402

# Concordia's ActingComponent is typed against its LanguageModel base.
# Subclass it when it is importable; when it is not, a plain object is
# fine because nothing will ask us to act anyway.
try:
    from concordia.language_model import language_model as _lm
    _MODEL_BASE = _lm.LanguageModel
except Exception:
    _MODEL_BASE = object


# ---------------------------------------------------------------------
# MODEL CONFIG — the project's one config file
# ---------------------------------------------------------------------
def load_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = {
        "baseUrl": "http://localhost:1234/v1",
        "model": "qwen2.5-7b-instruct",
        "timeoutMs": 180000,
        "temperature": 0.7,
    }
    path = os.path.join(ROOT, "harness", "llm.config.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for k, v in json.load(fh).items():
                if not k.startswith("_"):
                    cfg[k] = v
    except FileNotFoundError:
        pass
    # An environment variable beats the file, as it does on the JS side.
    if os.environ.get("MERIDIAN_LLM_URL"):
        cfg["baseUrl"] = os.environ["MERIDIAN_LLM_URL"]
    if os.environ.get("MERIDIAN_LLM_MODEL"):
        cfg["model"] = os.environ["MERIDIAN_LLM_MODEL"]
    for k, v in (overrides or {}).items():
        if v:
            cfg[k] = v
    return cfg


# ---------------------------------------------------------------------
# A LANGUAGE MODEL CONCORDIA CAN USE, POINTED AT LM STUDIO
# ---------------------------------------------------------------------
# Concordia ships wrappers for hosted providers and for Ollama. None of
# them is "an OpenAI-shaped endpoint at an arbitrary base URL", which is
# what LM Studio is and what this project already runs. Rather than
# bend the project to a wrapper, this is the wrapper.
#
# `sample_choice` is the interesting half. Concordia's default strategy
# for a forced choice is to sample text and match it back, which small
# local models are bad at. Asking for a bare index instead — "reply with
# one number" — is a question a 7B model gets right almost every time,
# and a wrong answer is detectable rather than plausible.
class LMStudioModel(_MODEL_BASE):
    def __init__(self, base_url: str, model: str, timeout: float, temperature: float):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.temperature = temperature
        self.calls = 0

    def _post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json",
                     "authorization": "Bearer not-needed"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            return json.loads(res.read().decode("utf-8"))

    def _chat(self, prompt: str, max_tokens: int, temperature: Optional[float]) -> str:
        self.calls += 1
        data = self._post({
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature if temperature is None else temperature,
            "max_tokens": max_tokens,
            "stream": False,
        })
        return data["choices"][0]["message"]["content"]

    # -- the Concordia LanguageModel surface --------------------------
    def sample_text(self, prompt: str, *, max_tokens: int = 512,
                    terminators: Any = None, temperature: Optional[float] = None,
                    seed: Optional[int] = None, **_: Any) -> str:
        text = self._chat(prompt, max_tokens, temperature)
        for t in (terminators or ()):
            idx = text.find(t)
            if idx >= 0:
                text = text[:idx]
        return text.strip()

    def sample_choice(self, prompt: str, responses: List[str], *,
                      seed: Optional[int] = None, **_: Any):
        numbered = "\n".join(f"{i}. {r}" for i, r in enumerate(responses))
        ask = (
            f"{prompt}\n\n"
            f"{numbered}\n\n"
            f"Reply with the number of your choice and nothing else."
        )
        raw = self._chat(ask, 8, 0.3).strip()

        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits:
            idx = int(digits[:3])
            if 0 <= idx < len(responses):
                return idx, responses[idx], {}

        # No usable number. Say so; do not pick one.
        raise ValueError(f"model did not return a choice index: {raw!r}")


# ---------------------------------------------------------------------
# THE POPULATION
# ---------------------------------------------------------------------
class Society:
    """The twelve agents and everything they remember."""

    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.model = LMStudioModel(
            cfg["baseUrl"], cfg["model"],
            timeout=float(cfg.get("timeoutMs", 180000)) / 1000.0,
            temperature=float(cfg.get("temperature", 0.7)),
        )
        self.citizens: Dict[str, MA.Citizen] = {}
        self.lock = threading.Lock()
        self.rounds_decided = 0
        self.last_error: Optional[str] = None
        self.concurrency = max(1, int(os.environ.get("MERIDIAN_AGENT_CONCURRENCY", "6")))

    def reset(self) -> None:
        with self.lock:
            self.citizens = {}
            self.rounds_decided = 0
            self.last_error = None

    def _citizen(self, obs: Dict[str, Any], population: str = "citizen") -> MA.Citizen:
        """Fetch or build the agent for one entity.

        Keyed by population AS WELL AS id, because the two corpora share
        an id space: `healthcare` is both a sector an industry agent
        speaks for and a service a cohort depends on. Keying on id alone
        would have one population silently inherit the other's memory.
        """
        key = population + ":" + obs["id"]
        if key not in self.citizens:
            if population == "firm":
                self.citizens[key] = MA.build_firm(self.model, obs)
            else:
                self.citizens[key] = MA.build_citizen(self.model, {
                    "id": obs["id"],
                    "name": obs.get("name", obs["id"]),
                    "role": obs.get("role", "resident"),
                    "temperament": obs.get("temperament", "even-tempered"),
                })
        return self.citizens[key]

    def decide(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        One round: every cohort decides.

        THE COHORTS RUN CONCURRENTLY, AND THAT IS NOT A SHORTCUT.
        Within a round the twelve agents do not interact -- each is shown
        only its own lived experience and answers only for itself. There
        is no ordering between them to preserve, so running them one at a
        time buys nothing and costs everything: twelve agents over twelve
        rounds is ~132 model calls, and sequentially on a local 7B that
        is a quarter of an hour before a page can render. Nobody
        demonstrates a simulation that takes fifteen minutes to say
        hello.

        Agents are still CREATED under the lock, because two threads
        racing to build the same cohort would give one of them an agent
        with no memory. After that each has its own object and its own
        conversation, and only the shared counters are locked again at
        the end.
        """
        menu = payload.get("menu") or []
        observations = payload.get("observations") or []
        round_no = int(payload.get("round") or 0)
        # Which corpus is asking. Defaults to citizens so an older
        # caller that does not say still works.
        population = payload.get("population") or "citizen"

        # Build (or fetch) every agent first, serially and safely.
        with self.lock:
            pairs = []
            for obs in observations:
                try:
                    pairs.append((obs, self._citizen(obs, population)))
                except Exception as exc:
                    pairs.append((obs, exc))

        choices: Dict[str, str] = {}
        reasoning: Dict[str, str] = {}
        faults: List[str] = []

        def run_one(pair):
            obs, citizen = pair
            cid = obs.get("id")
            if isinstance(citizen, Exception):
                return cid, None, f"{cid}: {type(citizen).__name__}: {citizen}"
            try:
                key = MA.choose_for(citizen, obs, menu, round_no,
                                    population=population)
                return cid, key, None
            except Exception as exc:
                # One agent failing is not the round failing. The JS side
                # decides this cohort by arithmetic and records that it
                # had to.
                return cid, None, f"{cid}: {type(exc).__name__}: {exc}"

        if pairs:
            # Modest width: enough to hide latency, not so much that a
            # local model server starts refusing or thrashing.
            with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                for cid, key, fault in pool.map(run_one, pairs):
                    if key:
                        choices[cid] = key
                    if fault:
                        faults.append(fault)

        for obs, citizen in pairs:
            cid = obs.get("id")
            if not isinstance(citizen, Exception) and citizen.history:
                reasoning[cid] = citizen.history[-1]["chose"]

        with self.lock:
            if choices:
                self.rounds_decided += 1
            if faults:
                self.last_error = "; ".join(faults[:3])

        return {"choices": choices, "reasoning": reasoning or None,
                "faults": faults or None, "source": "concordia"}

    def health(self) -> Dict[str, Any]:
        have = MA.available()
        model_ok, detail = False, None
        try:
            self.model.sample_text("Reply with the word: ok", max_tokens=6)
            model_ok = True
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"

        return {
            "concordia_installed": have,
            "concordia_import_error": MA.import_error() if not have else None,
            "model": self.cfg["model"],
            "base_url": self.cfg["baseUrl"],
            "model_reachable": model_ok,
            "model_error": detail,
            # The only field a caller should branch on.
            "can_decide": bool(have and model_ok),
            "agents_alive": len(self.citizens),
            "rounds_decided": self.rounds_decided,
            "last_error": self.last_error,
        }


# ---------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    society: Society = None  # set on the class before serving

    def _send(self, code: int, body: Dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read(self) -> Dict[str, Any]:
        n = int(self.headers.get("content-length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._send(200, self.society.health())
        else:
            self._send(404, {"error": "no such route", "routes": ["/health", "/decide", "/reset"]})

    def do_POST(self):  # noqa: N802
        route = self.path.rstrip("/")
        try:
            payload = self._read()
        except Exception as exc:
            self._send(400, {"error": f"bad JSON: {exc}"})
            return

        if route == "/decide":
            started = time.time()
            try:
                out = self.society.decide(payload)
            except Exception as exc:
                self._send(500, {"error": f"{type(exc).__name__}: {exc}"})
                return
            out["ms"] = int((time.time() - started) * 1000)
            self._send(200, out)
        elif route == "/reset":
            self.society.reset()
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "no such route"})

    def log_message(self, fmt, *args):
        # One line per request, not the default two-line noise.
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> None:
    ap = argparse.ArgumentParser(description="Concordia sidecar for Meridian")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--model", default=None, help="override the configured model")
    ap.add_argument("--url", default=None, help="override the model base URL")
    args = ap.parse_args()

    cfg = load_config({"model": args.model, "baseUrl": args.url})
    society = Society(cfg)
    Handler.society = society

    h = society.health()
    print("Meridian — Concordia sidecar")
    print(f"  model      {cfg['model']} at {cfg['baseUrl']}")
    print(f"  concordia  {'installed' if h['concordia_installed'] else 'NOT INSTALLED'}")
    if not h["concordia_installed"]:
        print(f"             {h['concordia_import_error']}")
        print("             pip install -r society/requirements.txt")
    print(f"  model      {'reachable' if h['model_reachable'] else 'NOT REACHABLE'}")
    if not h["model_reachable"]:
        print(f"             {h['model_error']}")
    print(f"  can decide {h['can_decide']}")
    if not h["can_decide"]:
        print("  -> runs will fall back to the deterministic chooser and say so.")
    print(f"  listening  http://{args.host}:{args.port}")

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
