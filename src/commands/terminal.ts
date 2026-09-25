import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import type { Paths } from '../paths';
import { BootstrapError, ensureRuntime } from '../runtime/environment';
import { WorkerClient } from '../runtime/worker';

export const say = (message = '') => process.stderr.write(`${message}\n`);
export const info = (message: string) => say(`${pc.cyan('›')} ${message}`);
export const success = (message: string) => say(`${pc.green('✓')} ${message}`);
export const warn = (message: string) => say(`${pc.yellow('!')} ${message}`);
export const fail = (message: string) => say(`${pc.red('✗')} ${message}`);

export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${pc.cyan('?')} ${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
    return answer === '' ? defaultYes : answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export interface WorkerSession {
  worker: WorkerClient;
  /** Echo worker stderr (download progress, warnings) to the terminal while `true`. */
  setEcho(echo: boolean): void;
  close(): Promise<void>;
}

/** Bootstrap the Python runtime and start the inference worker, logging its stderr to ~/.maclaya/logs. */
export async function startWorker(paths: Paths, options: { echo?: boolean; verbose?: boolean } = {}): Promise<WorkerSession> {
  let python: string;
  try {
    python = await ensureRuntime({
      paths,
      log: info,
      onOutput: options.verbose ? (chunk) => process.stderr.write(pc.dim(chunk)) : undefined,
      confirmUvInstall: () =>
        confirm(`uv (the Python package manager) is not installed. Download it from astral.sh into ${paths.bin}?`),
    });
  } catch (error) {
    if (error instanceof BootstrapError) throw new CliError(error.message, error.hint);
    throw error;
  }

  mkdirSync(paths.logs, { recursive: true });
  const log: WriteStream = createWriteStream(path.join(paths.logs, 'worker.log'), { flags: 'a' });
  let echo = options.echo ?? false;
  const worker = new WorkerClient({
    python,
    script: paths.workerScript,
    onStderr: (chunk) => {
      log.write(chunk);
      if (echo || options.verbose) process.stderr.write(pc.dim(chunk));
    },
  });
  worker.on('restart', ({ attempt, reason }: { attempt: number; reason: string }) =>
    warn(`${reason.split('\n')[0]} — restarting (attempt ${attempt})`),
  );
  worker.on('restart_failed', (error: Error) => fail(`The inference worker could not be restarted: ${error.message}`));
  try {
    await worker.start();
  } catch (error) {
    log.end();
    throw new CliError((error as Error).message, `See ${path.join(paths.logs, 'worker.log')} or run \`maclaya doctor\`.`);
  }
  return {
    worker,
    setEcho: (value) => {
      echo = value;
    },
    close: async () => {
      await worker.stop();
      await new Promise<void>((resolve) => log.end(resolve));
    },
  };
}
