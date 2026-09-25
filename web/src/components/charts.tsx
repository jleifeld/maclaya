import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { Stats } from '../api';
import { formatBucketLabel, formatCount, formatMs } from '../lib/format';

const axisTick = { fill: 'var(--muted)', fontSize: 11 };

function TooltipCard({ title, rows }: { title: string; rows: { key: string; color: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted">{title}</div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: row.color }} />
          <span className="tabular font-semibold text-ink">{row.value}</span>
          <span className="text-ink-2">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: 'rect' | 'line' }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={item.shape === 'line' ? 'h-0.5 w-3 rounded' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  rounded?: boolean;
}

/** A stacked segment: 4px rounded data-end when it is the top of its stack, square at the baseline. */
function Segment({ x = 0, y = 0, width = 0, height = 0, fill, rounded }: SegmentProps) {
  if (height <= 0 || width <= 0) return null;
  const gap = Math.min(2, height / 2);
  const h = height - gap;
  const top = y + gap;
  const r = rounded ? Math.min(4, width / 2, h) : 0;
  const d = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`;
  return <path d={d} fill={fill} />;
}

type RequestPoint = { ts: number; ok: number; errors: number };

export function RequestsChart({ stats }: { stats: Stats }) {
  const data: RequestPoint[] = stats.timeseries.map((b) => ({ ts: b.ts, ok: b.requests - b.errors, errors: b.errors }));
  const label = (ts: number) => formatBucketLabel(ts, stats.bucket_ms);
  return (
    <div>
      <Legend
        items={[
          { label: 'Successful', color: 'var(--series-1)' },
          { label: 'Errors', color: 'var(--critical)' },
        ]}
      />
      <div className="mt-2 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="ts" tickFormatter={label} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={32} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={formatCount} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={({ active, payload }: TooltipContentProps<ValueType, NameType>) => {
                const point = active ? (payload?.[0]?.payload as RequestPoint | undefined) : undefined;
                if (!point) return null;
                return (
                  <TooltipCard
                    title={label(point.ts)}
                    rows={[
                      { key: 'ok', color: 'var(--series-1)', label: 'successful', value: formatCount(point.ok) },
                      { key: 'errors', color: 'var(--critical)', label: 'errors', value: formatCount(point.errors) },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="ok"
              stackId="requests"
              fill="var(--series-1)"
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props: SegmentProps & { payload?: RequestPoint }) => <Segment {...props} rounded={!props.payload?.errors} />}
            />
            <Bar
              dataKey="errors"
              stackId="requests"
              fill="var(--critical)"
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props: SegmentProps) => <Segment {...props} rounded />}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function LatencyChart({ stats }: { stats: Stats }) {
  const label = (ts: number) => formatBucketLabel(ts, stats.bucket_ms);
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={stats.timeseries} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="ts" tickFormatter={label} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} minTickGap={32} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => formatMs(v)} />
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={({ active, payload }: TooltipContentProps<ValueType, NameType>) => {
              const point = active ? (payload?.[0]?.payload as Stats['timeseries'][number] | undefined) : undefined;
              if (!point) return null;
              return (
                <TooltipCard
                  title={label(point.ts)}
                  rows={[{ key: 'lat', color: 'var(--series-1)', label: `avg · ${formatCount(point.requests)} requests`, value: formatMs(point.avg_latency_ms) }]}
                />
              );
            }}
          />
          <Line
            dataKey="avg_latency_ms"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const i = props.index ?? 0;
              const isolated = stats.timeseries[i - 1]?.avg_latency_ms == null && stats.timeseries[i + 1]?.avg_latency_ms == null;
              if (!isolated || props.cx === undefined || props.cy === undefined || stats.timeseries[i]?.avg_latency_ms == null) return <g key={i} />;
              return <circle key={i} cx={props.cx} cy={props.cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />;
            }}
            activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarList({ items, format = formatCount, empty }: { items: { key: string; label: ReactNode; value: number; detail?: string }[]; format?: (v: number) => string; empty: ReactNode }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length || items.every((i) => i.value === 0)) return <div className="py-6 text-center text-sm text-muted">{empty}</div>;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.key} title={item.detail} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-ink-2">{item.label}</span>
            <span className="tabular font-medium text-ink">{format(item.value)}</span>
          </div>
          <div className="h-2 rounded bg-surface-2">
            <div className="h-2 rounded bg-(--series-1) transition-[width] group-hover:brightness-110" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
