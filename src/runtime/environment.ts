import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { LAYA_MLX_VERSION, PYTHON_VERSION, type Paths } from '../paths';

const execFileAsync = promisify(execFile);

export const UV_INSTALLER_URL = 'https://astral.sh/uv/install.sh';

export interface RuntimeMarker {
  laya_mlx: string;
  python: string;
  created_at: string;
}

export interface BootstrapOptions {
  paths: Paths;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** Asked before downloading and running the uv installer; resolve `false` to abort. */
  confirmUvInstall?: () => Promise<boolean>;
  /** Streams the output of uv commands, e.g. to show download progress. */
  onOutput?: (chunk: string) => void;
}

export class BootstrapError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export async function checkPlatform(): Promise<{ ok: boolean; message: string }> {
  if (process.platform !== 'darwin') {
    return { ok: false, message: `maclaya needs macOS on Apple Silicon (this is ${process.platform}).` };
  }
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'hw.optional.arm64']);
    if (stdout.trim() !== '1') return { ok: false, message: 'maclaya needs an Apple Silicon Mac (M1 or newer).' };
  } catch {
    return { ok: false, message: 'Could not detect the CPU architecture (sysctl hw.optional.arm64 failed).' };
  }
  return { ok: true, message: 'Apple Silicon' };
}

export async function macosVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('sw_vers', ['-productVersion']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function which(command: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [command], { env: { PATH: env.PATH ?? '' } });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function findUv(paths: Paths, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.MACLAYA_UV) return env.MACLAYA_UV;
  const onPath = await which('uv', env);
  if (onPath) return onPath;
  for (const candidate of [path.join(paths.bin, 'uv'), path.join(env.HOME ?? '', '.local', 'bin', 'uv')]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-4000);
      options.onOutput?.(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args.join(' ')} failed (exit ${code})\n${output.trim()}`)),
    );
  });
}

async function installUv(paths: Paths, options: BootstrapOptions): Promise<string> {
  const allowed = options.confirmUvInstall ? await options.confirmUvInstall() : false;
  if (!allowed) {
    throw new BootstrapError(
      'uv is required to manage the Python runtime but was not found.',
      'Install it with `brew install uv` (or `curl -LsSf https://astral.sh/uv/install.sh | sh`) and run the command again.',
    );
  }
  await mkdir(paths.bin, { recursive: true });
  options.log?.(`Installing uv into ${paths.bin} …`);
  await run('/bin/sh', ['-c', `curl -LsSf ${UV_INSTALLER_URL} | sh`], {
    env: { UV_INSTALL_DIR: paths.bin, UV_NO_MODIFY_PATH: '1', INSTALLER_NO_MODIFY_PATH: '1' },
    onOutput: options.onOutput,
  });
  const uv = path.join(paths.bin, 'uv');
  if (!existsSync(uv)) throw new BootstrapError(`The uv installer finished but ${uv} does not exist.`);
  return uv;
}

export async function readMarker(paths: Paths): Promise<RuntimeMarker | undefined> {
  try {
    return JSON.parse(await readFile(paths.runtimeMarker, 'utf8')) as RuntimeMarker;
  } catch {
    return undefined;
  }
}

export async function isRuntimeCurrent(paths: Paths): Promise<boolean> {
  const marker = await readMarker(paths);
  return marker?.laya_mlx === LAYA_MLX_VERSION && existsSync(paths.python);
}

/** Returns the Python interpreter that has laya-mlx installed, creating the venv on first use. */
export async function ensureRuntime(options: BootstrapOptions): Promise<string> {
  const env = options.env ?? process.env;
  if (env.MACLAYA_PYTHON) return env.MACLAYA_PYTHON;
  const { paths } = options;
  if (await isRuntimeCurrent(paths)) return paths.python;

  const uv = (await findUv(paths, env)) ?? (await installUv(paths, options));
  await mkdir(paths.home, { recursive: true });
  options.log?.(`Setting up the Python runtime in ${paths.venv} (Python ${PYTHON_VERSION}, laya-mlx ${LAYA_MLX_VERSION}) …`);
  try {
    await run(uv, ['venv', '--allow-existing', '--python', PYTHON_VERSION, paths.venv], { onOutput: options.onOutput });
    await run(uv, ['pip', 'install', '--python', paths.python, `laya-mlx==${LAYA_MLX_VERSION}`], {
      onOutput: options.onOutput,
    });
  } catch (error) {
    throw new BootstrapError(
      `Could not set up the Python runtime: ${(error as Error).message}`,
      'Run `maclaya doctor` for details, or `maclaya reset` to start from scratch.',
    );
  }
  const marker: RuntimeMarker = { laya_mlx: LAYA_MLX_VERSION, python: PYTHON_VERSION, created_at: new Date().toISOString() };
  await writeFile(paths.runtimeMarker, JSON.stringify(marker, null, 2));
  return paths.python;
}
