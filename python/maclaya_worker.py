"""maclaya inference worker.

Speaks newline-delimited JSON over stdin/stdout with the Node gateway. stdout carries only
protocol messages; everything else (library prints, warnings, download progress) goes to stderr.
"""

import json
import os
import platform
import sys
import time
import traceback

PROTOCOL = sys.stdout
sys.stdout = sys.stderr

CHECKPOINTS = {
    "english": os.environ.get("MACLAYA_REPO_ENGLISH", "aac6fef/laya-mlx"),
    "multilingual": os.environ.get("MACLAYA_REPO_MULTILINGUAL", "aac6fef/laya-multilingual-mlx"),
    "typed-decisions": os.environ.get(
        "MACLAYA_REPO_TYPED_DECISIONS", "aac6fef/laya-typed-decisions-mlx"
    ),
}


class InvalidRequest(Exception):
    pass


def send(message):
    PROTOCOL.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    PROTOCOL.flush()


def emit(event, **data):
    send({"event": event, **data})


class Worker:
    def __init__(self):
        import laya_mlx

        self.laya = laya_mlx
        self.router = laya_mlx.Router(
            models=CHECKPOINTS,
            max_loaded=len(CHECKPOINTS),
            dtype=os.environ.get("MACLAYA_DTYPE", "float16"),
        )

    def _load(self, name):
        if name in self.router.loaded:
            return
        emit("model_loading", model=name, repo=CHECKPOINTS[name])
        started = time.perf_counter()
        try:
            self.router.load(name)
        except Exception as exc:
            emit("model_failed", model=name, message=str(exc))
            raise
        emit("model_loaded", model=name, seconds=round(time.perf_counter() - started, 3))

    def op_hello(self, _params):
        info = {
            "laya_mlx": getattr(self.laya, "__version__", None),
            "python": platform.python_version(),
            "checkpoints": CHECKPOINTS,
        }
        try:
            import mlx.core as mx

            info["mlx"] = getattr(mx, "__version__", None)
            info["device"] = str(mx.default_device())
            info["metal"] = bool(mx.metal.is_available())
        except Exception as exc:  # the stub used in tests has no MLX
            info["mlx_error"] = str(exc)
        return info

    def op_status(self, _params):
        return {"loaded": self.router.loaded}

    def op_load(self, params):
        for name in params.get("models") or []:
            if name not in CHECKPOINTS:
                raise InvalidRequest("unknown checkpoint %r" % name)
            self._load(name)
        return {"loaded": self.router.loaded}

    def op_presets(self, _params):
        names = ["triage", "email", "guard", "moderation", "router"]
        return {name: getattr(self.laya, name + "_questions")() for name in names}

    def op_predict(self, params):
        state, questions, model = params.get("state"), params.get("questions"), params.get("model")
        if model is not None and model not in CHECKPOINTS:
            raise InvalidRequest("unknown checkpoint %r" % model)
        decision = self.router.route(state, questions, model=model)
        self._load(decision["model"])
        started = time.perf_counter()
        try:
            result = self.router.load(decision["model"]).system_one(state, questions)
        except ValueError as exc:
            raise InvalidRequest(str(exc)) from exc
        return {
            "answers": result["answers"],
            "usage": result["usage"],
            "routing": {"model": decision["model"], "reason": decision["reason"]},
            "inference_ms": round((time.perf_counter() - started) * 1000, 3),
        }

    def handle(self, message):
        request_id = message.get("id")
        op = getattr(self, "op_" + str(message.get("op")), None)
        if op is None:
            send({"id": request_id, "ok": False, "error": {
                "kind": "invalid_request", "message": "unknown op %r" % message.get("op")}})
            return
        try:
            send({"id": request_id, "ok": True, "result": op(message.get("params") or {})})
        except InvalidRequest as exc:
            send({"id": request_id, "ok": False, "error": {
                "kind": "invalid_request", "message": str(exc)}})
        except Exception as exc:
            traceback.print_exc()
            send({"id": request_id, "ok": False, "error": {
                "kind": "internal", "message": "%s: %s" % (type(exc).__name__, exc)}})


def main():
    try:
        worker = Worker()
    except Exception as exc:
        traceback.print_exc()
        emit("fatal", message="%s: %s" % (type(exc).__name__, exc))
        return 1
    emit("ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            send({"id": None, "ok": False, "error": {"kind": "internal", "message": str(exc)}})
            continue
        worker.handle(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
