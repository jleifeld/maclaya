import type { Json, SystemOneAnswer } from '../api';
import { formatProbability } from '../lib/format';
import { Badge, cx } from './ui';

function legendText(value: Json | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function ProbabilityRow({ label, value, selected, detail }: { label: string; value: number; selected?: boolean; detail?: string }) {
  return (
    <li title={detail}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className={cx('min-w-0 truncate', selected ? 'font-semibold text-ink' : 'text-ink-2')}>
          {label}
          {detail && <span className="ml-1.5 font-normal text-muted">{detail}</span>}
        </span>
        <span className={cx('tabular', selected ? 'font-semibold text-ink' : 'text-ink-2')}>{formatProbability(value)}</span>
      </div>
      <div className="h-2 rounded bg-surface-2">
        <div className={cx('h-2 rounded', selected ? 'bg-accent' : 'bg-axis')} style={{ width: `${Math.max(value * 100, 0.5)}%` }} />
      </div>
    </li>
  );
}

function Meta({ items }: { items: (string | false | undefined)[] }) {
  const shown = items.filter(Boolean);
  return shown.length ? <p className="mt-3 text-xs text-muted">{shown.join(' · ')}</p> : null;
}

export function AnswerView({ name, answer }: { name: string; answer: SystemOneAnswer }) {
  const act = answer.action ? `act probability ${formatProbability(answer.action.act_probability)}` : undefined;
  return (
    <article className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="truncate font-mono text-sm font-semibold text-ink">{name}</h3>
        <Badge>{answer.type}</Badge>
      </header>

      {answer.type === 'noul' && answer.noul !== undefined && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-ink">{formatProbability(answer.noul)}</span>
            <span className="text-sm text-ink-2">probability of yes</span>
          </div>
          <div className="mt-3 h-2 rounded bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={answer.noul} aria-label={`${name}: probability of yes`}>
            <div className="h-2 rounded bg-accent" style={{ width: `${answer.noul * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>no</span>
            <span>yes</span>
          </div>
          <Meta items={[answer.confidence !== undefined && `confidence ${formatProbability(answer.confidence)}`, act]} />
        </>
      )}

      {answer.type === 'choice' && answer.probabilities && (
        <>
          <p className="mb-3 text-sm text-ink-2">
            Chose <span className="font-semibold text-ink">{answer.choice}</span>
          </p>
          <ul className="space-y-2.5">
            {Object.entries(answer.probabilities).map(([label, p]) => (
              <ProbabilityRow key={label} label={label} value={p} selected={label === answer.choice} />
            ))}
          </ul>
          <Meta items={[answer.confidence !== undefined && `confidence ${formatProbability(answer.confidence)}`, act]} />
        </>
      )}

      {answer.type === 'score' && answer.probabilities && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-ink">{answer.score?.toFixed(2)}</span>
            <span className="text-sm text-ink-2">expected level (0–{Object.keys(answer.probabilities).length - 1})</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {Object.entries(answer.probabilities).map(([level, p]) => (
              <ProbabilityRow
                key={level}
                label={`Level ${level}`}
                detail={legendText(answer.legend?.[level])}
                value={p}
                selected={Math.round(answer.score ?? -1) === Number(level)}
              />
            ))}
          </ul>
          <Meta items={[answer.confidence !== undefined && `confidence ${formatProbability(answer.confidence)}`, act]} />
        </>
      )}
    </article>
  );
}
