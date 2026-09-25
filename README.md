# maclaya

Run [Laya](https://huggingface.co/convaiinnovations/laya) typed-decision models locally on your Apple Silicon Mac, behind an API that is compatible with **Jev** (TypeSafe AI's System One API). It comes with a dashboard for request statistics and a playground for trying requests.

```bash
npx maclaya serve
```

- **Jev-compatible API.** `POST /v1/systemone` and `GET /v1/models` accept Jev request shapes and return Jev response and error shapes. The official `@typesafe-ai/sdk` works unchanged; only the `baseURL` changes.
- **Local and fast.** Inference runs on the GPU through [laya-mlx](https://github.com/mizorewww/laya-mlx). A warm decision takes a few milliseconds of model time, and nothing leaves your machine.
- **Language routing.** `jev-latest` sends English text to the English checkpoint and other languages to the multilingual one.
- **Dashboard.** Shows request volume, error rate, latency percentiles, a checkpoint/question-type/client breakdown, and a searchable request log with full request and response bodies.
- **Playground.** Build requests visually or as raw JSON, start from built-in presets, see answers as probability bars, and copy curl, TypeScript or Python code.

## Requirements

- A Mac with Apple Silicon (M1 or newer) and macOS 14 or newer
- Node.js 22.13 or newer
- About 1 GB of disk per checkpoint

You don't need to set up Python yourself. On first start, maclaya uses [uv](https://docs.astral.sh/uv/) to create an isolated environment in `~/.maclaya/venv` with a pinned Python and laya-mlx. If uv isn't installed, maclaya asks before installing it into `~/.maclaya/bin`. Checkpoints download from Hugging Face on first use, about 840 MB each.

## Quick start

```bash
npx maclaya serve
```

This command:
1. Sets up the runtime.
2. Loads the English checkpoint.
3. Serves:
   - the API at `http://127.0.0.1:4545/v1/systemone`
   - the dashboard at `http://127.0.0.1:4545`
4. Opens the dashboard in your browser.

Call it with the official SDK:

```ts
import { TypeSafeClient } from '@typesafe-ai/sdk';

const client = new TypeSafeClient({ baseURL: 'http://127.0.0.1:4545', apiKey: 'local' });

const { answers } = await client.systemOne({
  state: 'I was charged twice for my subscription.',
  questions: {
    refund: { type: 'noul', instructions: 'Is the customer asking for money back?' },
    team: {
      type: 'choice',
      instructions: 'Which team should handle this?',
      criteria: { billing: 'Charges and refunds', technical: 'Bugs and outages' },
    },
    urgency: { type: 'score', instructions: 'How urgent is it?', criteria: ['not urgent', 'soon', 'blocking'] },
  },
});
// answers.refund  → { type: 'noul', noul: 0.83 }
// answers.team    → { type: 'choice', choice: 'billing', confidence: 0.83, probabilities: { billing: 0.98, technical: 0.02 } }
// answers.urgency → { type: 'score', score: 1.26, confidence: 0.42, probabilities: {...}, legend: {...} }
```

Or with curl:

```bash
curl http://127.0.0.1:4545/v1/systemone -H 'Content-Type: application/json' -d '{"state":"I was charged twice.","questions":{"refund":{"type":"noul","instructions":"Refund?"}}}'
```

Tools that read `TYPESAFE_BASE_URL` work once you point it at maclaya: `export TYPESAFE_BASE_URL=http://127.0.0.1:4545 TYPESAFE_API_KEY=local`.

## API

| Endpoint | |
|---|---|
| `POST /v1/systemone` | Answers `noul`, `choice` and `score` questions about a `state` |
| `GET /v1/models` | `{ "models": [{ "name", "description", "release_date" }] }` |

**Models**

| `model` | Checkpoint |
|---|---|
| `jev-latest` (default), `jev`, `jev-*`, `typesafe-ai/jev`, `laya` | Auto-routed: English or multilingual, picked from the language of the state |
| `laya/english` | Laya 421M, English, 512-token context |
| `laya/multilingual` | Laya 322M, 100+ languages, 1024-token context |
| `laya/typed-decisions` | Laya 421M fine-tuned on the typed-decisions workflows |

The response's `model` field names the checkpoint that answered, for example `laya/english`.

**Requests** follow the Jev format:
- `state` is a string, object, array or `null`.
- `instructions` and criteria entries can be text or structured JSON.
- `choice` takes up to 255 options.
- `score` takes 2–10 levels.
- `noul` optionally takes `true`/`false` descriptions.
- Unknown fields are ignored.

**Errors** use Jev's shape, `{ "message": "questions.refund.type: expected one of 'noul', 'choice', 'score'", "error_type": "invalid_request" }`:

| Status | `error_type` | When |
|---|---|---|
| 400 | `invalid_request` | The body is not valid JSON |
| 401 | `authentication_error` | `--api-key` is set and the request did not send it |
| 404 | `not_found` | Unknown route |
| 422 | `invalid_request` | Validation failed or the model is unknown |
| 503 | `overloaded` | The inference worker is unavailable |
| 500 | `internal_error` | Unexpected runtime error |

**Response headers**

| Header | Meaning |
|---|---|
| `x-typesafe-request-id` | Request ID, also shown in the dashboard |
| `x-laya-model` | The checkpoint that answered |
| `x-laya-route-reason` | Why that checkpoint was chosen |

**Laya extras.** Send `X-Maclaya-Extras: 1` to add fields that Jev doesn't have:
- `action.act_probability` on every answer
- `confidence` on `noul` answers
- a top-level `maclaya` object with the checkpoint, routing reason and model time

Without the header, responses match Jev field for field.

**Differences from hosted Jev:**
- `usage.output_tokens` is always `0`, because Laya doesn't generate tokens.
- State longer than the checkpoint's context is truncated (512 tokens for English, 1024 for multilingual).
- Answers come from the Laya models, not from Jev.

## CLI

```text
maclaya serve     Start the API, dashboard and playground
  -p, --port <port>           default 4545           (MACLAYA_PORT)
  -H, --host <host>           default 127.0.0.1      (MACLAYA_HOST); 0.0.0.0 exposes the API to your network
  -k, --api-key <key>         require Authorization: Bearer <key> (MACLAYA_API_KEY)
  --preload <checkpoints>     english (default), multilingual, typed-decisions, all or none
  --no-log-bodies             record only metadata, not request/response bodies
  --retention-days <days>     how long stats are kept (default 7)
  --expose-dashboard          serve the dashboard to other machines too (localhost-only by default)
  --no-open                   do not open the browser
  -v, --verbose               print runtime and worker logs

maclaya pull [checkpoints...]   Download checkpoints ahead of time (default: english multilingual)
maclaya predict -s "text" -q questions.json [-m laya/english] [--extras]
                                One decision from the terminal; -f state.json for structured state
maclaya doctor                  Check hardware, macOS, Node, uv, runtime, MLX/Metal, checkpoints and port
maclaya reset [--models] [-y]   Remove ~/.maclaya (runtime, stats, logs); --models also deletes cached checkpoints
```

## Privacy and security

- The server binds to `127.0.0.1` by default.
- With `--host 0.0.0.0`, the API is reachable from your network. Combine it with `--api-key`.
- The dashboard and its `/api` endpoints only answer requests from this Mac unless you pass `--expose-dashboard`.
- Request and response bodies are stored in `~/.maclaya/stats.db` so you can inspect and replay them. `--no-log-bodies` keeps only metadata.
- Stats are pruned after the retention period, or after 50,000 requests, whichever comes first.

## Configuration

| Variable | Purpose |
|---|---|
| `MACLAYA_HOME` | Data directory (default `~/.maclaya`) |
| `MACLAYA_PYTHON` | Use this Python interpreter (which must have `laya-mlx` installed) instead of the managed venv |
| `MACLAYA_UV` | Path to the uv binary |
| `MACLAYA_DTYPE` | `float16` (default), `bfloat16` or `float32` |
| `MACLAYA_REPO_ENGLISH`, `MACLAYA_REPO_MULTILINGUAL`, `MACLAYA_REPO_TYPED_DECISIONS` | Override checkpoint repos or local paths |
| `HF_TOKEN`, `HF_HOME`, `HF_HUB_CACHE` | Standard Hugging Face settings |

## How it works

```
Jev client ──HTTP──▶ Fastify gateway (Node) ──NDJSON over stdio──▶ Python worker ──▶ laya-mlx Router ──▶ MLX / Metal
                       │  validation, Jev shapes, auth
                       ├─ SQLite stats (node:sqlite) ──▶ /api + SSE ──▶ React dashboard & playground
```

The worker runs in a uv-managed virtual environment. It keeps every loaded checkpoint resident, and the gateway restarts it if it crashes. Checkpoints are the pre-converted MLX weights published by laya-mlx (`aac6fef/laya-mlx`, `aac6fef/laya-multilingual-mlx`, `aac6fef/laya-typed-decisions-mlx`).

## Development

```bash
npm install
npm run build          # web UI (Vite) + CLI (tsup) into dist/
node dist/cli.js serve

npm run dev:web        # Vite dev server on :5173, proxying /api and /v1 to a running `maclaya serve`
npm test               # Jest: API compatibility via @typesafe-ai/sdk, dashboard API, worker protocol, CLI, UI logic
npm run test:e2e       # also runs the real checkpoints on MLX (downloads them on first run)
npm run lint:fix
npm run typecheck
```

The regular test suite runs the real Python worker against a small stub of `laya_mlx`, so it needs `python3` but not MLX or any model downloads.

## Credits

- Laya models by Convai Innovations; laya-mlx by mizorewww. Both are Apache-2.0.
- Jev and System One are TypeSafe AI's. maclaya is not affiliated with TypeSafe AI, Convai Innovations or laya-mlx.
