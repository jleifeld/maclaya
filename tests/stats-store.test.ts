import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bucketFor, StatsStore, type RequestRecord } from '../src/stats/store';

function record(overrides: Partial<RequestRecord>): RequestRecord {
  return {
    id: Math.random().toString(36).slice(2),
    ts: Date.now(),
    status: 200,
    error_type: null,
    error_message: null,
    model_requested: null,
    model: 'laya/english',
    route_reason: 'English Latin text',
    latency_ms: 10,
    inference_ms: 8,
    input_tokens: 100,
    n_noul: 1,
    n_choice: 0,
    n_score: 0,
    client: 'curl/8',
    source: 'api',
    request_body: null,
    response_body: null,
    ...overrides,
  };
}

describe('StatsStore', () => {
  const now = 1_800_000_000_000;

  it('computes latency percentiles over successful requests only', () => {
    const store = new StatsStore({ file: ':memory:' });
    for (let i = 1; i <= 100; i++) store.insert(record({ ts: now - 1000, latency_ms: i }));
    store.insert(record({ ts: now - 1000, latency_ms: 99_999, status: 500, inference_ms: null }));
    const { summary } = store.stats(15 * 60_000, now);
    expect(summary.requests).toBe(101);
    expect(summary.errors).toBe(1);
    expect(summary.latency_ms).toEqual({ avg: 50.5, p50: 50, p95: 95, p99: 99 });
    expect(summary.requests_per_minute).toBeCloseTo(101 / 15, 2);
  });

  it('returns nulls instead of numbers for an empty range', () => {
    const store = new StatsStore({ file: ':memory:' });
    const { summary, by_model } = store.stats(60 * 60_000, now);
    expect(summary).toMatchObject({ requests: 0, errors: 0, error_rate: 0, latency_ms: { avg: null, p50: null, p95: null, p99: null } });
    expect(by_model).toEqual([]);
  });

  it('fills every bucket of the time series, including empty ones', () => {
    const store = new StatsStore({ file: ':memory:' });
    const bucket = bucketFor(60 * 60_000);
    store.insert(record({ ts: now - 5 * bucket, latency_ms: 20 }));
    store.insert(record({ ts: now - 5 * bucket + 1, latency_ms: 40, status: 422 }));
    store.insert(record({ ts: now - 10 * 60 * 60_000 }));
    const { timeseries, bucket_ms } = store.stats(60 * 60_000, now);
    expect(bucket_ms).toBe(60_000);
    expect(timeseries.length).toBeGreaterThanOrEqual(60);
    expect(timeseries.every((b, i) => i === 0 || b.ts - timeseries[i - 1]!.ts === bucket)).toBe(true);
    const busy = timeseries.filter((b) => b.requests > 0);
    expect(busy).toEqual([{ ts: Math.floor((now - 5 * bucket) / bucket) * bucket, requests: 2, errors: 1, avg_latency_ms: 20 }]);
  });

  it.each([
    [15 * 60_000, 15_000],
    [60 * 60_000, 60_000],
    [24 * 60 * 60_000, 15 * 60_000],
    [7 * 24 * 60 * 60_000, 2 * 60 * 60_000],
  ])('uses a sensible bucket for a %pms range', (range, bucket) => {
    expect(bucketFor(range)).toBe(bucket);
  });

  it('prunes by age and by row count', () => {
    const store = new StatsStore({ file: ':memory:', retentionMs: 60_000, maxRows: 3 });
    store.insert(record({ id: 'old', ts: now - 120_000 }));
    for (let i = 0; i < 5; i++) store.insert(record({ id: `new${i}`, ts: now - i }));
    expect(store.prune(now)).toBe(3);
    expect(store.list({ limit: 10 }).map((r) => r.id)).toEqual(['new0', 'new1', 'new2']);
  });

  it('persists to disk across instances', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'maclaya-stats-')), 'nested', 'stats.db');
    const first = new StatsStore({ file });
    first.insert(record({ id: 'kept', request_body: '{"state":"x"}' }));
    first.close();
    const second = new StatsStore({ file });
    expect(second.get('kept')).toMatchObject({ id: 'kept', request_body: '{"state":"x"}' });
    second.close();
  });
});
