export type Checkpoint = 'english' | 'multilingual' | 'typed-decisions';
export type CheckpointState = 'idle' | 'loading' | 'loaded' | 'failed';
export type QuestionType = 'noul' | 'choice' | 'score';
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ModelCard {
  name: string;
  description: string;
  release_date: string;
}

export interface Status {
  version: string;
  started_at: number;
  uptime_s: number;
  base_url: string;
  auth_required: boolean;
  log_bodies: boolean;
  retention_days: number;
  runtime: { laya_mlx: string | null; python: string; mlx?: string | null; device?: string; metal?: boolean } | null;
  checkpoints: { checkpoint: Checkpoint; state: CheckpointState }[];
  models: ModelCard[];
}

export interface RequestSummary {
  id: string;
  ts: number;
  status: number;
  error_type: string | null;
  error_message: string | null;
  model_requested: string | null;
  model: string | null;
  route_reason: string | null;
  latency_ms: number;
  inference_ms: number | null;
  input_tokens: number;
  n_noul: number;
  n_choice: number;
  n_score: number;
  client: string | null;
  source: 'api' | 'playground';
}

export interface RequestDetail extends RequestSummary {
  request_body: Json | null;
  response_body: Json | null;
}

export type Range = '15m' | '1h' | '24h' | '7d';

export interface Stats {
  range: Range;
  since: number;
  bucket_ms: number;
  summary: {
    requests: number;
    errors: number;
    error_rate: number;
    input_tokens: number;
    questions: number;
    latency_ms: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
    inference_ms: { avg: number | null; p50: number | null };
    requests_per_minute: number;
  };
  timeseries: { ts: number; requests: number; errors: number; avg_latency_ms: number | null }[];
  by_model: { model: string; requests: number; avg_latency_ms: number | null }[];
  by_question_type: { type: QuestionType; questions: number }[];
  by_client: { client: string; requests: number }[];
  by_status: { status: number; requests: number }[];
}

export interface Preset {
  title: string;
  description: string;
  state: Json;
  questions: Record<string, Json>;
}

export interface SystemOneAnswer {
  type: QuestionType;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, Json>;
  action?: { act_probability: number };
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  maclaya?: { checkpoint: string; route_reason: string; inference_ms: number };
}

export interface JevErrorBody {
  message: string;
  error_type: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => fetch('/api/status').then((r) => json<Status>(r)),
  stats: (range: Range) => fetch(`/api/stats?range=${range}`).then((r) => json<Stats>(r)),
  requests: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
    );
    return fetch(`/api/requests?${query}`).then((r) => json<{ items: RequestSummary[]; next_before: number | null }>(r));
  },
  request: (id: string) => fetch(`/api/requests/${encodeURIComponent(id)}`).then((r) => json<RequestDetail>(r)),
  clearRequests: () => fetch('/api/requests', { method: 'DELETE' }).then((r) => (r.ok ? undefined : json(r))),
  presets: () => fetch('/api/presets').then((r) => json<Record<string, Preset>>(r)),
  models: () => fetch('/v1/models').then((r) => json<{ models: ModelCard[] }>(r)),
  loadCheckpoint: (checkpoint: Checkpoint) =>
    fetch(`/api/checkpoints/${checkpoint}/load`, { method: 'POST' }).then((r) => json<unknown>(r)),
};

export interface RunResult {
  ok: boolean;
  status: number;
  elapsedMs: number;
  requestId: string | null;
  checkpoint: string | null;
  routeReason: string | null;
  body: SystemOneResponse | JevErrorBody | null;
}

export async function runSystemOne(body: unknown, options: { apiKey?: string; extras?: boolean }): Promise<RunResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-maclaya-source': 'playground' };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  if (options.extras) headers['x-maclaya-extras'] = '1';
  const started = performance.now();
  const res = await fetch('/v1/systemone', { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: RunResult['body'];
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text, error_type: 'invalid_response' };
  }
  return {
    ok: res.ok,
    status: res.status,
    elapsedMs: performance.now() - started,
    requestId: res.headers.get('x-typesafe-request-id'),
    checkpoint: res.headers.get('x-laya-model'),
    routeReason: res.headers.get('x-laya-route-reason'),
    body: parsed,
  };
}
