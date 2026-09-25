import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const LAYA_MLX_VERSION = '0.2.0';
export const PYTHON_VERSION = '3.12';

export function packageRoot(start: string = __dirname): string {
  let dir = start;
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate the maclaya package root from ${start}`);
    dir = parent;
  }
  return dir;
}

export interface Paths {
  home: string;
  bin: string;
  venv: string;
  python: string;
  runtimeMarker: string;
  statsDb: string;
  logs: string;
  workerScript: string;
  webRoot: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.MACLAYA_HOME ?? path.join(homedir(), '.maclaya');
  const venv = path.join(home, 'venv');
  const root = packageRoot();
  return {
    home,
    bin: path.join(home, 'bin'),
    venv,
    python: path.join(venv, 'bin', 'python'),
    runtimeMarker: path.join(venv, 'maclaya-runtime.json'),
    statsDb: path.join(home, 'stats.db'),
    logs: path.join(home, 'logs'),
    workerScript: path.join(root, 'python', 'maclaya_worker.py'),
    webRoot: path.join(root, 'dist', 'web'),
  };
}

export function huggingFaceHubCache(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE;
  const hfHome = env.HF_HOME ?? path.join(env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'huggingface');
  return path.join(hfHome, 'hub');
}
