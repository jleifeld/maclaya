import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, FlaskConical, LayoutDashboard, ListTree, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { api, type Checkpoint, type CheckpointState } from '../api';
import { useLiveEvents, useStatus } from '../hooks';
import { formatUptime } from '../lib/format';
import { setThemePreference, useThemePreference, type ThemePreference } from '../theme';
import { Button, CopyButton, cx, Segmented, StatusDot } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/requests', label: 'Requests', icon: ListTree, end: false },
  { to: '/playground', label: 'Playground', icon: FlaskConical, end: false },
];

const STATE_LABEL: Record<CheckpointState, string> = { idle: 'not loaded', loading: 'loading…', loaded: 'loaded', failed: 'failed' };
const STATE_TONE: Record<CheckpointState, 'good' | 'warning' | 'critical' | 'muted'> = { idle: 'muted', loading: 'warning', loaded: 'good', failed: 'critical' };

function CheckpointRow({ checkpoint, state }: { checkpoint: Checkpoint; state: CheckpointState }) {
  const queryClient = useQueryClient();
  const load = useMutation({
    mutationFn: () => api.loadCheckpoint(checkpoint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status'] }),
  });
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot tone={STATE_TONE[state]} />
        <span className="truncate text-sm text-ink">{checkpoint}</span>
      </span>
      {state === 'idle' || state === 'failed' ? (
        <Button size="sm" variant="ghost" onClick={() => load.mutate()} disabled={load.isPending}>
          Load
        </Button>
      ) : (
        <span className="text-xs text-muted">{STATE_LABEL[state]}</span>
      )}
    </li>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: ReactNode; title: string }[] = [
  { value: 'system', label: <Monitor size={14} aria-hidden />, title: 'Match system appearance' },
  { value: 'light', label: <Sun size={14} aria-hidden />, title: 'Light mode' },
  { value: 'dark', label: <Moon size={14} aria-hidden />, title: 'Dark mode' },
];

function ThemeSwitch() {
  return <Segmented size="sm" label="Appearance" value={useThemePreference()} options={THEME_OPTIONS} onChange={setThemePreference} />;
}

export function Layout() {
  const { data: status, isError } = useStatus();
  const live = useLiveEvents();
  const baseUrl = status?.base_url ?? window.location.origin;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-5">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <div>
              <div className="text-sm font-semibold text-ink">maclaya</div>
              <div className="text-xs text-muted">Laya on this Mac</div>
            </div>
          </div>
          <div className="flex items-center gap-3 md:mt-4 md:justify-between">
            <span className="flex items-center gap-1.5 text-xs text-ink-2" title="Live updates from the server">
              <StatusDot tone={isError || live === 'offline' ? 'critical' : live === 'live' ? 'good' : 'warning'} />
              {isError || live === 'offline' ? 'Server offline' : live === 'live' ? 'Live' : 'Connecting…'}
            </span>
            <ThemeSwitch />
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] md:flex-col md:px-3 md:pb-0">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors md:gap-2.5 md:px-3',
                  isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <Icon size={16} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden space-y-6 px-4 py-6 md:block">
          <section>
            <h2 className="mb-1.5 text-xs font-medium text-muted">Jev endpoint</h2>
            <code className="block truncate rounded-md bg-surface-2 px-2 py-1.5 font-mono text-xs text-ink" title={`${baseUrl}/v1/systemone`}>
              {baseUrl}/v1/systemone
            </code>
            <div className="mt-1 -ml-2">
              <CopyButton text={baseUrl} label="Copy base URL" />
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-xs font-medium text-muted">Checkpoints</h2>
            <ul>
              {status?.checkpoints.map((c) => <CheckpointRow key={c.checkpoint} checkpoint={c.checkpoint} state={c.state} />)}
            </ul>
          </section>

          {status && (
            <section className="space-y-1 text-xs text-muted">
              <h2 className="mb-1 flex items-center gap-1.5 font-medium">
                <Activity size={12} aria-hidden /> Runtime
              </h2>
              <p>maclaya {status.version} · up {formatUptime(status.uptime_s)}</p>
              {status.runtime && (
                <p>
                  laya-mlx {status.runtime.laya_mlx} · MLX {status.runtime.mlx} · {status.runtime.metal ? 'Metal' : 'CPU'}
                </p>
              )}
              <p>{status.auth_required ? 'API key required' : 'No API key required'}</p>
              <p>{status.log_bodies ? `Bodies logged · kept ${status.retention_days} days` : 'Bodies not logged'}</p>
            </section>
          )}
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 md:px-8">
        <Outlet />
      </main>
    </div>
  );
}
