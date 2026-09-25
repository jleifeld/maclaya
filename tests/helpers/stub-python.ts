import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const STUB_PYTHONPATH = path.join(__dirname, '..', 'fixtures', 'stub');
export const WORKER_SCRIPT = path.join(__dirname, '..', '..', 'python', 'maclaya_worker.py');

export function systemPython(): string {
  return execFileSync('/usr/bin/which', ['python3']).toString().trim();
}

export function stubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PYTHONPATH: STUB_PYTHONPATH, ...extra };
}
