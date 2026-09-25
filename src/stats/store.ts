import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface RequestRecord {
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
  request_body: string | null;
  response_body: string | null;
}

export type RequestSummary = Omit<RequestRecord, 'request_body' | 'response_body'>;

export interface RangeStats {
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
  by_question_type: { type: 'noul' | 'choice' | 'score'; questions: number }[];
  by_client: { client: string; requests: number }[];
  by_status: { status: number; requests: number }[];
}

export interface ListFilter {
  limit?: number;
  before?: number;
  status?: 'ok' | 'error';
  model?: string;
  source?: 'api' | 'playground';
}

const SUMMARY_COLUMNS = `id, ts, status, error_type, error_message, model_requested, model, route_reason, latency_ms,
  inference_ms, input_tokens, n_noul, n_choice, n_score, client, source`;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function fillBuckets(rows: RangeStats['timeseries'], since: number, now: number, bucket: number): RangeStats['timeseries'] {
  const byTs = new Map(rows.map((row) => [row.ts, row]));
  const filled: RangeStats['timeseries'] = [];
  for (let ts = Math.floor(since / bucket) * bucket; ts <= now; ts += bucket) {
    const row = byTs.get(ts);
    filled.push(
      row
        ? { ts, requests: row.requests, errors: row.errors ?? 0, avg_latency_ms: round(row.avg_latency_ms) }
        : { ts, requests: 0, errors: 0, avg_latency_ms: null },
    );
  }
  return filled;
}

export function bucketFor(rangeMs: number): number {
  const minute = 60_000;
  if (rangeMs <= 15 * minute) return 15_000;
  if (rangeMs <= 60 * minute) return minute;
  if (rangeMs <= 24 * 60 * minute) return 15 * minute;
  return 2 * 60 * minute;
}

export interface StatsStoreOptions {
  file: string;
  retentionMs?: number;
  maxRows?: number;
}

export class StatsStore {
  private db: DatabaseSync;
  readonly retentionMs: number;
  readonly maxRows: number;

  constructor(options: StatsStoreOptions) {
    if (options.file !== ':memory:') mkdirSync(path.dirname(options.file), { recursive: true });
    this.db = new DatabaseSync(options.file);
    this.retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
    this.maxRows = options.maxRows ?? 50_000;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        status INTEGER NOT NULL,
        error_type TEXT,
        error_message TEXT,
        model_requested TEXT,
        model TEXT,
        route_reason TEXT,
        latency_ms REAL NOT NULL,
        inference_ms REAL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        n_noul INTEGER NOT NULL DEFAULT 0,
        n_choice INTEGER NOT NULL DEFAULT 0,
        n_score INTEGER NOT NULL DEFAULT 0,
        client TEXT,
        source TEXT NOT NULL DEFAULT 'api',
        request_body TEXT,
        response_body TEXT
      );
      CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts);
    `);
  }

  insert(record: RequestRecord): void {
    this.db
      .prepare(
        `INSERT INTO requests (id, ts, status, error_type, error_message, model_requested, model, route_reason,
          latency_ms, inference_ms, input_tokens, n_noul, n_choice, n_score, client, source, request_body, response_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.ts,
        record.status,
        record.error_type,
        record.error_message,
        record.model_requested,
        record.model,
        record.route_reason,
        record.latency_ms,
        record.inference_ms,
        record.input_tokens,
        record.n_noul,
        record.n_choice,
        record.n_score,
        record.client,
        record.source,
        record.request_body,
        record.response_body,
      );
  }

  get(id: string): RequestRecord | undefined {
    return this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRecord | undefined;
  }

  list(filter: ListFilter = {}): RequestSummary[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.before !== undefined) {
      where.push('ts < ?');
      params.push(filter.before);
    }
    if (filter.status === 'ok') where.push('status < 400');
    if (filter.status === 'error') where.push('status >= 400');
    if (filter.model) {
      where.push('model = ?');
      params.push(filter.model);
    }
    if (filter.source) {
      where.push('source = ?');
      params.push(filter.source);
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ts DESC, rowid DESC LIMIT ${limit}`;
    return this.db.prepare(sql).all(...params) as unknown as RequestSummary[];
  }

  stats(rangeMs: number, now: number = Date.now()): RangeStats {
    const since = now - rangeMs;
    const bucket = bucketFor(rangeMs);
    const totals = this.db
      .prepare(
        `SELECT count(*) AS requests, coalesce(sum(status >= 400), 0) AS errors,
           coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(n_noul + n_choice + n_score), 0) AS questions,
           avg(CASE WHEN status < 400 THEN latency_ms END) AS avg_latency, avg(inference_ms) AS avg_inference
         FROM requests WHERE ts >= ?`,
      )
      .get(since) as {
      requests: number;
      errors: number;
      input_tokens: number;
      questions: number;
      avg_latency: number | null;
      avg_inference: number | null;
    };
    const latencies = (
      this.db.prepare('SELECT latency_ms AS v FROM requests WHERE ts >= ? AND status < 400 ORDER BY latency_ms').all(since) as {
        v: number;
      }[]
    ).map((row) => row.v);
    const inference = (
      this.db
        .prepare('SELECT inference_ms AS v FROM requests WHERE ts >= ? AND inference_ms IS NOT NULL ORDER BY inference_ms')
        .all(since) as { v: number }[]
    ).map((row) => row.v);

    const timeseries = this.db
      .prepare(
        `SELECT (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS ts, count(*) AS requests, sum(status >= 400) AS errors,
           avg(CASE WHEN status < 400 THEN latency_ms END) AS avg_latency_ms
         FROM requests WHERE ts >= ? GROUP BY 1 ORDER BY 1`,
      )
      .all(bucket, bucket, since) as RangeStats['timeseries'];

    const byModel = this.db
      .prepare(
        `SELECT model, count(*) AS requests, avg(latency_ms) AS avg_latency_ms FROM requests
         WHERE ts >= ? AND model IS NOT NULL GROUP BY model ORDER BY requests DESC`,
      )
      .all(since) as RangeStats['by_model'];
    const types = this.db
      .prepare(
        `SELECT coalesce(sum(n_noul), 0) AS noul, coalesce(sum(n_choice), 0) AS choice, coalesce(sum(n_score), 0) AS score
         FROM requests WHERE ts >= ?`,
      )
      .get(since) as { noul: number; choice: number; score: number };
    const byClient = this.db
      .prepare(
        `SELECT coalesce(client, 'unknown') AS client, count(*) AS requests FROM requests WHERE ts >= ?
         GROUP BY 1 ORDER BY requests DESC LIMIT 10`,
      )
      .all(since) as RangeStats['by_client'];
    const byStatus = this.db
      .prepare('SELECT status, count(*) AS requests FROM requests WHERE ts >= ? GROUP BY status ORDER BY status')
      .all(since) as RangeStats['by_status'];

    return {
      since,
      bucket_ms: bucket,
      summary: {
        requests: totals.requests,
        errors: totals.errors,
        error_rate: totals.requests ? totals.errors / totals.requests : 0,
        input_tokens: totals.input_tokens,
        questions: totals.questions,
        latency_ms: {
          avg: round(totals.avg_latency),
          p50: round(percentile(latencies, 50)),
          p95: round(percentile(latencies, 95)),
          p99: round(percentile(latencies, 99)),
        },
        inference_ms: { avg: round(totals.avg_inference), p50: round(percentile(inference, 50)) },
        requests_per_minute: Math.round((totals.requests / (rangeMs / 60_000)) * 100) / 100,
      },
      timeseries: fillBuckets(timeseries, since, now, bucket),
      by_model: byModel.map((row) => ({ ...row, avg_latency_ms: round(row.avg_latency_ms) })),
      by_question_type: [
        { type: 'noul', questions: types.noul },
        { type: 'choice', questions: types.choice },
        { type: 'score', questions: types.score },
      ],
      by_client: byClient,
      by_status: byStatus,
    };
  }

  prune(now: number = Date.now()): number {
    const byAge = this.db.prepare('DELETE FROM requests WHERE ts < ?').run(now - this.retentionMs).changes;
    const byCount = this.db
      .prepare(
        `DELETE FROM requests WHERE rowid IN (
           SELECT rowid FROM requests ORDER BY ts DESC, rowid DESC LIMIT -1 OFFSET ?)`,
      )
      .run(this.maxRows).changes;
    return Number(byAge) + Number(byCount);
  }

  clear(): void {
    this.db.exec('DELETE FROM requests');
  }

  close(): void {
    this.db.close();
  }
}
