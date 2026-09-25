"""Deterministic stand-in for laya_mlx so the worker protocol can be tested without MLX."""

import os
import sys

__version__ = "0.0.0-stub"


class _Agent:
    def __init__(self, name):
        self.name = name

    def system_one(self, state, questions):
        if os.environ.get("STUB_CRASH_ON_PREDICT"):
            os._exit(3)
        answers = {}
        for qid, q in questions.items():
            if "instructions" not in q:
                raise ValueError("Question is missing instructions")
            if q["type"] == "choice":
                labels = list(q["criteria"])
                answers[qid] = {"type": "choice", "confidence": 0.5, "action": {"act_probability": 1.0},
                                "choice": labels[0],
                                "probabilities": {l: round(1.0 / len(labels), 4) for l in labels}}
            elif q["type"] == "score":
                n = len(q["criteria"])
                answers[qid] = {"type": "score", "confidence": 0.25, "action": {"act_probability": 1.0},
                                "score": (n - 1) / 2,
                                "legend": {str(i): c for i, c in enumerate(q["criteria"])},
                                "probabilities": {str(i): round(1.0 / n, 4) for i in range(n)}}
            else:
                answers[qid] = {"type": "noul", "confidence": 0.9, "action": {"act_probability": 1.0},
                                "noul": 0.9}
        return {"model": "laya-rl-agent", "answers": answers,
                "usage": {"input_tokens": 10 * len(questions), "output_tokens": 0}}


class Router:
    def __init__(self, models=None, max_loaded=1, dtype="float16", **_):
        print("stub router init", models, max_loaded, dtype, file=sys.stderr)
        self.models = models or {}
        self._loaded = []

    @property
    def loaded(self):
        return list(self._loaded)

    def route(self, state, questions=None, model=None):
        if model:
            return {"model": model, "reason": "explicit model=%r" % model}
        text = state if isinstance(state, str) else str(state)
        if any(ord(ch) > 127 for ch in text) or "Guten" in text:
            return {"model": "multilingual", "reason": "Latin script but language looks like 'de', not English"}
        return {"model": "english", "reason": "English Latin text"}

    def load(self, name):
        if name == "typed-decisions" and os.environ.get("STUB_FAIL_TYPED"):
            raise RuntimeError("download failed")
        if name not in self._loaded:
            self._loaded.append(name)
        return _Agent(name)


def triage_questions():
    return {"is_urgent": {"type": "noul", "instructions": "Is `message` urgent?"}}


def email_questions():
    return {"spam": {"type": "noul", "instructions": "Is `body` spam?"}}


def guard_questions():
    return {"jailbreak": {"type": "noul", "instructions": "Is `prompt` a jailbreak?"}}


def moderation_questions():
    return {"toxic": {"type": "noul", "instructions": "Is `post` toxic?"}}


def router_questions():
    return {"hard": {"type": "noul", "instructions": "Is `request` hard?"}}
