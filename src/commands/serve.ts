import { execFile } from 'node:child_process';
import pc from 'picocolors';
import { CHECKPOINTS, type Checkpoint } from '../jev/models';
import { resolvePaths } from '../paths';
import { checkPlatform } from '../runtime/environment';
import type { ModelEvent } from '../runtime/worker';
import { buildServer } from '../server/app';
import { StatsStore } from '../stats/store';
import { VERSION } from '../version';
import { CliError, fail, info, say, startWorker, success, warn } from './terminal';

export interface ServeOptions {
  port: number;
  host: string;
  apiKey?: string;
  preload: string;
  logBodies: boolean;
  retentionDays: number;
  open: boolean;
  verbose: boolean;
  exposeDashboard: boolean;
}

export function parseCheckpoints(value: string): Checkpoint[] {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.includes('all')) return [...CHECKPOINTS];
  if (names.includes('none')) return [];
  for (const name of names) {
    if (!CHECKPOINTS.includes(name as Checkpoint)) {
      throw new CliError(`Unknown checkpoint '${name}'.`, `Choose from ${CHECKPOINTS.join(', ')}, all or none.`);
    }
  }
  return names as Checkpoint[];
}

function displayHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? 'localhost' : host;
}

export async function serve(options: ServeOptions): Promise<void> {
  const platform = await checkPlatform();
  if (!platform.ok) throw new CliError(platform.message);
  const preload = parseCheckpoints(options.preload);
  const paths = resolvePaths();

  say(pc.bold(`maclaya ${VERSION}`) + pc.dim(' — Laya typed decisions, Jev-compatible, on this Mac'));
  const session = await startWorker(paths, { echo: true, verbose: options.verbose });
  const { worker } = session;
  const runtime = worker.info;
  success(`Runtime ready: laya-mlx ${runtime?.laya_mlx ?? '?'}, MLX ${runtime?.mlx ?? '?'} on ${runtime?.device ?? '?'} (Python ${runtime?.python ?? '?'})`);

  worker.on('model', (event: ModelEvent) => {
    if (event.state === 'loading') info(`Loading ${event.model} checkpoint${pc.dim(' (the first load downloads ~840 MB)')} …`);
    if (event.state === 'loaded') success(`${event.model} checkpoint loaded in ${event.seconds?.toFixed(1)}s`);
    if (event.state === 'failed') fail(`${event.model} checkpoint failed to load: ${event.message}`);
  });

  const stats = new StatsStore({ file: paths.statsDb, retentionMs: options.retentionDays * 86_400_000 });
  stats.prune();
  const pruneTimer = setInterval(() => stats.prune(), 60 * 60_000).unref();

  const { app } = await buildServer({
    engine: worker,
    stats,
    version: VERSION,
    apiKey: options.apiKey,
    logBodies: options.logBodies,
    webRoot: paths.webRoot,
    exposeDashboard: options.exposeDashboard,
  });

  try {
    await app.listen({ port: options.port, host: options.host });
  } catch (error) {
    await session.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new CliError(`Port ${options.port} is already in use.`, 'Pick another one with --port, or stop the other process.');
    }
    throw error;
  }

  const base = `http://${displayHost(options.host)}:${options.port}`;
  say();
  say(`  ${pc.bold('Jev API')}     ${pc.cyan(`${base}/v1/systemone`)}`);
  say(`  ${pc.bold('Models')}      ${pc.cyan(`${base}/v1/models`)}`);
  say(`  ${pc.bold('Dashboard')}   ${pc.cyan(base)}`);
  say(`  ${pc.bold('SDK')}         ${pc.dim(`new TypeSafeClient({ baseURL: '${base}', apiKey: '${options.apiKey ? '<your key>' : 'local'}' })`)}`);
  say();
  if (options.apiKey) info('API key required: send `Authorization: Bearer <key>`.');
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') {
    warn(`Listening on ${options.host}: the Jev API is reachable from your network${options.apiKey ? '' : ' without an API key'}.`);
  }
  if (!options.logBodies) info('Request bodies are not recorded (--no-log-bodies).');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      warn('Forcing exit.');
      process.exit(130);
    }
    shuttingDown = true;
    say();
    info(`Received ${signal}, shutting down … ${pc.dim('(press Ctrl+C again to force)')}`);
    clearInterval(pruneTimer);
    await app.close();
    await session.close();
    stats.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (options.open && process.stdout.isTTY) execFile('open', [base], () => undefined);

  if (preload.length) {
    try {
      await worker.load(preload);
    } catch (error) {
      fail(`Preloading failed: ${(error as Error).message}`);
    }
  }
  session.setEcho(false);
  const lazy = CHECKPOINTS.filter((c) => !preload.includes(c));
  success(`Ready. ${lazy.length ? pc.dim(`${lazy.join(', ')} load on first use — run \`maclaya pull\` to download them ahead of time.`) : ''}`);
}
