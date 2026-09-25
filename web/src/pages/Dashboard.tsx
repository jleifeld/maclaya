import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, type Range } from '../api';
import { BarList, LatencyChart, RequestsChart } from '../components/charts';
import { Badge, Card, cx, EmptyState, Segmented, StatTile, statusTone } from '../components/ui';
import { usePersistentState } from '../hooks';
import { formatCount, formatMs, formatPercent, formatRelative } from '../lib/format';

const RANGES: { value: Range; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export function Dashboard() {
  const [range, setRange] = usePersistentState<Range>('dashboard-range', '1h');
  const stats = useQuery({ queryKey: ['stats', range], queryFn: () => api.stats(range), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  const recent = useQuery({ queryKey: ['requests', 'recent'], queryFn: () => api.requests({ limit: 8 }) });
  const data = stats.data;
  const s = data?.summary;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
          <p className="text-sm text-muted">Traffic to the local Jev endpoint.</p>
        </div>
        <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
      </header>

      {stats.isError && <p className="text-sm text-critical-ink">Could not load stats: {(stats.error as Error).message}</p>}

      <div className={cx('space-y-5 transition-opacity', stats.isPlaceholderData && 'opacity-60')}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Requests" value={s ? formatCount(s.requests) : '—'} detail={s ? `${s.requests_per_minute} / min · ${formatCount(s.questions)} questions` : undefined} />
          <StatTile
            label="Error rate"
            value={s ? formatPercent(s.error_rate) : '—'}
            detail={s ? `${formatCount(s.errors)} failed requests` : undefined}
          />
          <StatTile label="Latency p50" value={formatMs(s?.latency_ms.p50)} detail={s ? `p95 ${formatMs(s.latency_ms.p95)} · p99 ${formatMs(s.latency_ms.p99)}` : undefined} />
          <StatTile label="Model time p50" value={formatMs(s?.inference_ms.p50)} detail={s ? `${formatCount(s.input_tokens)} input tokens` : undefined} />
        </div>

        {data && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Requests over time" subtitle={`Per ${bucketName(data.bucket_ms)}`}>
              <RequestsChart stats={data} />
            </Card>
            <Card title="Average latency" subtitle={`Successful requests, per ${bucketName(data.bucket_ms)}`}>
              <LatencyChart stats={data} />
            </Card>
          </div>
        )}

        {data && (
          <div className="grid gap-5 md:grid-cols-3">
            <Card title="By checkpoint" subtitle="Where requests were routed">
              <BarList
                empty="No answered requests yet"
                items={data.by_model.map((m) => ({ key: m.model, label: m.model, value: m.requests, detail: `avg ${formatMs(m.avg_latency_ms)}` }))}
              />
            </Card>
            <Card title="By question type" subtitle="Questions asked">
              <BarList empty="No questions yet" items={data.by_question_type.map((q) => ({ key: q.type, label: q.type, value: q.questions }))} />
            </Card>
            <Card title="Clients" subtitle="From the User-Agent header">
              <BarList empty="No clients yet" items={data.by_client.map((c) => ({ key: c.client, label: <span className="font-mono text-xs">{c.client}</span>, value: c.requests }))} />
            </Card>
          </div>
        )}
      </div>

      <Card
        title="Latest requests"
        actions={
          <Link to="/requests" className="text-sm font-medium text-accent-ink hover:underline">
            View all
          </Link>
        }
      >
        {recent.data?.items.length ? (
          <ul className="divide-y divide-(--border)">
            {recent.data.items.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-surface-2 sm:px-2">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {r.model ?? r.error_message ?? r.error_type}
                  </span>
                  <span className="tabular hidden text-ink-2 sm:inline">{formatMs(r.latency_ms)}</span>
                  <span className="w-16 text-right text-xs text-muted">{formatRelative(r.ts)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No requests yet">
            Point a Jev client at this server, or send one from the{' '}
            <Link to="/playground" className="text-accent-ink hover:underline">
              playground
            </Link>
            .
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

function bucketName(ms: number): string {
  if (ms < 60_000) return `${ms / 1000} seconds`;
  if (ms < 60 * 60_000) return ms === 60_000 ? 'minute' : `${ms / 60_000} minutes`;
  return ms === 60 * 60_000 ? 'hour' : `${ms / (60 * 60_000)} hours`;
}
