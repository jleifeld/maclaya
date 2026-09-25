import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import pc from 'picocolors';
import { huggingFaceHubCache, LAYA_MLX_VERSION, resolvePaths, type Paths } from '../paths';
import { checkPlatform, findUv, macosVersion, readMarker } from '../runtime/environment';
import { WorkerClient } from '../runtime/worker';
import { say } from './terminal';

const execFileAsync = promisify(execFile);

export const DEFAULT_REPOS: Record<string, string> = {
  english: 'aac6fef/laya-mlx',
  multilingual: 'aac6fef/laya-multilingual-mlx',
  'typed-decisions': 'aac6fef/laya-typed-decisions-mlx',
};

export interface Check {
  status: 'ok' | 'warn' | 'fail';
  label: string;
  detail: string;
  hint?: string;
}

export function repoCacheDir(repo: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(huggingFaceHubCache(env), `models--${repo.replace('/', '--')}`);
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function runChecks(paths: Paths, port: number, env: NodeJS.ProcessEnv = process.env): Promise<Check[]> {
  const checks: Check[] = [];
  const platform = await checkPlatform();
  checks.push({ status: platform.ok ? 'ok' : 'fail', label: 'Hardware', detail: platform.message });

  const macos = await macosVersion();
  const major = Number(macos?.split('.')[0] ?? 0);
  checks.push(
    macos && major >= 14
      ? { status: 'ok', label: 'macOS', detail: macos }
      : { status: 'fail', label: 'macOS', detail: macos ?? 'unknown', hint: 'MLX needs macOS 14 (Sonoma) or newer.' },
  );

  const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number);
  checks.push(
    nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)
      ? { status: 'ok', label: 'Node.js', detail: process.versions.node }
      : { status: 'fail', label: 'Node.js', detail: process.versions.node, hint: 'Node.js 22.13 or newer is required.' },
  );

  const uv = await findUv(paths, env);
  if (uv) {
    const { stdout } = await execFileAsync(uv, ['--version']).catch(() => ({ stdout: 'unknown version' }));
    checks.push({ status: 'ok', label: 'uv', detail: `${stdout.trim()} (${uv})` });
  } else {
    checks.push({
      status: env.MACLAYA_PYTHON ? 'ok' : 'warn',
      label: 'uv',
      detail: 'not found',
      hint: env.MACLAYA_PYTHON ? undefined : '`maclaya serve` offers to install it, or run `brew install uv`.',
    });
  }

  const marker = await readMarker(paths);
  const python = env.MACLAYA_PYTHON ?? (marker && existsSync(paths.python) ? paths.python : undefined);
  if (env.MACLAYA_PYTHON) {
    checks.push({ status: 'ok', label: 'Python runtime', detail: `MACLAYA_PYTHON=${env.MACLAYA_PYTHON}` });
  } else if (!python) {
    checks.push({ status: 'warn', label: 'Python runtime', detail: `not set up yet (${paths.venv})`, hint: 'Created automatically by `maclaya serve` or `maclaya pull`.' });
  } else if (marker?.laya_mlx !== LAYA_MLX_VERSION) {
    checks.push({ status: 'warn', label: 'Python runtime', detail: `laya-mlx ${marker?.laya_mlx}, expected ${LAYA_MLX_VERSION}`, hint: 'It is upgraded on the next `maclaya serve`.' });
  } else {
    checks.push({ status: 'ok', label: 'Python runtime', detail: `${paths.venv} (laya-mlx ${marker.laya_mlx})` });
  }

  let repos = DEFAULT_REPOS;
  if (python) {
    const worker = new WorkerClient({ python, script: paths.workerScript, maxRestarts: 0, startupTimeoutMs: 60_000 });
    try {
      await worker.start();
      const info = worker.info!;
      repos = info.checkpoints;
      checks.push(
        info.metal
          ? { status: 'ok', label: 'MLX', detail: `MLX ${info.mlx} on ${info.device}, Metal available (Python ${info.python})` }
          : { status: 'fail', label: 'MLX', detail: info.mlx_error ?? `Metal unavailable on ${info.device}`, hint: 'Try `maclaya reset` and start again.' },
      );
    } catch (error) {
      checks.push({ status: 'fail', label: 'MLX', detail: (error as Error).message.split('\n')[0] ?? 'worker failed', hint: `See ${path.join(paths.logs, 'worker.log')}; \`maclaya reset\` rebuilds the runtime.` });
    } finally {
      await worker.stop();
    }
  }

  for (const [checkpoint, repo] of Object.entries(repos)) {
    const downloaded = existsSync(path.join(repoCacheDir(repo, env), 'snapshots'));
    checks.push({
      status: downloaded || checkpoint === 'typed-decisions' ? 'ok' : 'warn',
      label: `Checkpoint ${checkpoint}`,
      detail: downloaded ? `downloaded (${repo})` : `not downloaded (${repo})`,
      hint: downloaded ? undefined : `\`maclaya pull ${checkpoint}\` downloads it now; otherwise it downloads on first use.`,
    });
  }

  checks.push(
    (await portFree(port))
      ? { status: 'ok', label: `Port ${port}`, detail: 'free' }
      : { status: 'warn', label: `Port ${port}`, detail: 'in use (maclaya may already be running)', hint: 'Use `maclaya serve --port <n>` for another port.' },
  );

  const dbSize = existsSync(paths.statsDb) ? statSync(paths.statsDb).size : 0;
  checks.push({ status: 'ok', label: 'Stats database', detail: dbSize ? `${paths.statsDb} (${(dbSize / 1024).toFixed(0)} KB)` : 'not created yet' });
  return checks;
}

export async function doctor(options: { port: number }): Promise<boolean> {
  const checks = await runChecks(resolvePaths(), options.port);
  const icon = { ok: pc.green('✓'), warn: pc.yellow('!'), fail: pc.red('✗') };
  for (const check of checks) {
    say(`${icon[check.status]} ${pc.bold(check.label.padEnd(26))} ${check.detail}`);
    if (check.hint) say(`  ${' '.repeat(26)} ${pc.dim(check.hint)}`);
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  say();
  say(failed ? pc.red(`${failed} problem(s) found.`) : pc.green('Everything looks good.'));
  return failed === 0;
}
