import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type RequestSummary } from '../api';
import { JsonEditor } from '../components/JsonEditor';
import { Badge, Button, Card, CopyButton, cx, EmptyState, Select, statusTone } from '../components/ui';
import { formatClock, formatMs, formatRelative } from '../lib/format';

function QuestionCounts({ r }: { r: Pick<RequestSummary, 'n_noul' | 'n_choice' | 'n_score'> }) {
  const parts = [
    r.n_noul && `${r.n_noul} noul`,
    r.n_choice && `${r.n_choice} choice`,
    r.n_score && `${r.n_score} score`,
  ].filter(Boolean);
  return <span className="text-ink-2">{parts.length ? parts.join(', ') : '—'}</span>;
}

function Detail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({ queryKey: ['request', id], queryFn: () => api.request(id) });
  const requestJson = data?.request_body ? JSON.stringify(data.request_body, null, 2) : '';
  const responseJson = data?.response_body ? JSON.stringify(data.response_body, null, 2) : '';

  return (
    <Card
      className="lg:sticky lg:top-6"
      title={<span className="font-mono text-xs">{id}</span>}
      actions={
        <Link to="/requests" aria-label="Close details" className="rounded-md p-1 text-ink-2 hover:bg-surface-2">
          <X size={16} />
        </Link>
      }
    >
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {isError && <p className="text-sm text-critical-ink">This request is no longer in the log.</p>}
      {data && (
        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              <Badge tone={statusTone(data.status)}>{data.status}</Badge> {data.error_type && <span className="text-ink-2">{data.error_type}</span>}
            </dd>
            <dt className="text-muted">Time</dt>
            <dd className="text-ink">{new Date(data.ts).toLocaleString()}</dd>
            <dt className="text-muted">Model</dt>
            <dd className="text-ink">
              {data.model ?? '—'}
              {data.model_requested && <span className="text-muted"> (asked for {data.model_requested})</span>}
            </dd>
            {data.route_reason && (
              <>
                <dt className="text-muted">Routing</dt>
                <dd className="text-ink-2">{data.route_reason}</dd>
              </>
            )}
            <dt className="text-muted">Latency</dt>
            <dd className="tabular text-ink">
              {formatMs(data.latency_ms)}
              {data.inference_ms !== null && <span className="text-muted"> · model {formatMs(data.inference_ms)}</span>}
            </dd>
            <dt className="text-muted">Questions</dt>
            <dd>
              <QuestionCounts r={data} />
            </dd>
            <dt className="text-muted">Tokens</dt>
            <dd className="tabular text-ink">{data.input_tokens}</dd>
            <dt className="text-muted">Client</dt>
            <dd className="font-mono text-xs text-ink-2">
              {data.client ?? 'unknown'} · {data.source}
            </dd>
          </dl>

          {data.error_message && <p className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical-ink">{data.error_message}</p>}

          {data.request_body ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-medium text-ink-2">Request</h3>
                <div className="flex">
                  <CopyButton text={requestJson} />
                  <Button size="sm" variant="ghost" onClick={() => navigate('/playground', { state: { body: data.request_body } })}>
                    <FlaskConical size={14} /> Open in playground
                  </Button>
                </div>
              </div>
              <JsonEditor label="Request body" value={requestJson} readOnly maxHeight="320px" minHeight="60px" />
            </div>
          ) : (
            <p className="text-sm text-muted">Request bodies are not recorded (server started with --no-log-bodies).</p>
          )}

          {responseJson && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-xs font-medium text-ink-2">Response</h3>
                <CopyButton text={responseJson} />
              </div>
              <JsonEditor label="Response body" value={responseJson} readOnly maxHeight="360px" minHeight="60px" />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function Requests() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [model, setModel] = useState('');

  const list = useInfiniteQuery({
    queryKey: ['requests', 'list', status, source, model],
    queryFn: ({ pageParam }) => api.requests({ limit: 50, before: pageParam ?? undefined, status, source, model }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.items.length === 50 ? last.next_before : undefined),
  });
  const clear = useMutation({
    mutationFn: api.clearRequests,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      navigate('/requests');
    },
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Requests</h1>
          <p className="text-sm text-muted">Every call to /v1/systemone, newest first.</p>
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={!items.length || clear.isPending}
          onClick={() => {
            if (window.confirm('Delete all recorded requests and stats?')) clear.mutate();
          }}
        >
          <Trash2 size={14} /> Clear log
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto!">
          <option value="">All statuses</option>
          <option value="ok">Successful</option>
          <option value="error">Errors</option>
        </Select>
        <Select aria-label="Checkpoint" value={model} onChange={(e) => setModel(e.target.value)} className="w-auto!">
          <option value="">All checkpoints</option>
          <option value="laya/english">laya/english</option>
          <option value="laya/multilingual">laya/multilingual</option>
          <option value="laya/typed-decisions">laya/typed-decisions</option>
        </Select>
        <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className="w-auto!">
          <option value="">All sources</option>
          <option value="api">API clients</option>
          <option value="playground">Playground</option>
        </Select>
      </div>

      <div className={cx('grid gap-5', id && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]')}>
        <div className={cx('min-w-0', id && 'hidden lg:block')}>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            {items.length ? (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Questions</th>
                    <th className="px-3 py-2 text-right font-medium">Latency</th>
                    <th className="hidden px-3 py-2 font-medium xl:table-cell">Client</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--border)">
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      onClick={() => navigate(`/requests/${r.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/requests/${r.id}`)}
                      className={cx('cursor-pointer whitespace-nowrap hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none', r.id === id && 'bg-accent-wash/30')}
                    >
                      <td className="px-3 py-2 whitespace-nowrap" title={new Date(r.ts).toLocaleString()}>
                        <span className="tabular text-ink">{formatClock(r.ts, true)}</span>
                        <span className="ml-2 hidden text-xs text-muted sm:inline">{formatRelative(r.ts)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="max-w-56 truncate px-3 py-2 text-ink-2">{r.model ?? <span className="text-muted">{r.error_type}</span>}</td>
                      <td className="hidden px-3 py-2 md:table-cell">
                        <QuestionCounts r={r} />
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink">{formatMs(r.latency_ms)}</td>
                      <td className="hidden max-w-48 truncate px-3 py-2 font-mono text-xs text-ink-2 xl:table-cell">
                        {r.source === 'playground' ? 'playground' : (r.client ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title={list.isLoading ? 'Loading…' : 'No requests match'}>
                {!list.isLoading && 'Requests appear here live as they arrive.'}
              </EmptyState>
            )}
          </div>
          {list.hasNextPage && (
            <div className="mt-3 text-center">
              <Button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load older requests'}
              </Button>
            </div>
          )}
        </div>
        {id && <Detail id={id} />}
      </div>
    </div>
  );
}
