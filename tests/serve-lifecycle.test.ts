import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { STUB_PYTHONPATH, systemPython } from './helpers/stub-python';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) resolve(true);
      else if (Date.now() - started > timeoutMs) resolve(false);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

describe('maclaya serve lifecycle', () => {
  let child: ChildProcess | undefined;
  let output = '';

  beforeAll(() => {
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsup', 'dist', 'cli-default.js')], { cwd: ROOT, stdio: 'ignore' });
  }, 60_000);

  afterEach(() => {
    if (child?.pid && child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
  });

  async function startServe() {
    const port = await freePort();
    output = '';
    // A process group of its own, like a shell job, so we can send Ctrl+C to the whole group.
    child = spawn(process.execPath, [CLI, 'serve', '--no-open', '--port', String(port)], {
      detached: true,
      env: {
        ...process.env,
        MACLAYA_HOME: mkdtempSync(path.join(tmpdir(), 'maclaya-serve-')),
        MACLAYA_PYTHON: systemPython(),
        PYTHONPATH: STUB_PYTHONPATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', (chunk) => (output += chunk));
    child.stderr!.on('data', (chunk) => (output += chunk));
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    expect(await waitFor(() => output.includes('Ready.'), 20_000)).toBe(true);
    const base = `http://127.0.0.1:${port}`;
    const status = await (await fetch(`${base}/api/status`)).json();
    return { base, workerPid: status.runtime.pid as number, exited };
  }

  it('stops maclaya and its worker on Ctrl+C, even with the dashboard connected', async () => {
    const { base, workerPid, exited } = await startServe();
    expect(isAlive(workerPid)).toBe(true);
    const events = await fetch(`${base}/api/events`);
    const reader = events.body!.getReader();
    await reader.read();

    process.kill(-child!.pid!, 'SIGINT');

    await expect(Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 8000))])).resolves.toBe(0);
    expect(output).toContain('Received SIGINT, shutting down');
    expect(output).not.toContain('restarting');
    expect(await waitFor(() => !isAlive(workerPid), 3000)).toBe(true);
    await reader.cancel().catch(() => undefined);
  }, 40_000);

  it('stops on SIGTERM', async () => {
    const { workerPid, exited } = await startServe();
    child!.kill('SIGTERM');
    await expect(exited).resolves.toBe(0);
    expect(await waitFor(() => !isAlive(workerPid), 3000)).toBe(true);
  }, 40_000);
});
