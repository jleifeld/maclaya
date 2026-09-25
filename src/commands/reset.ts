import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolvePaths } from '../paths';
import { DEFAULT_REPOS, repoCacheDir } from './doctor';
import { confirm, info, say, success } from './terminal';

const execFileAsync = promisify(execFile);

async function sizeOf(target: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('du', ['-sh', target]);
    return stdout.split('\t')[0]?.trim() ?? '?';
  } catch {
    return '?';
  }
}

export function resetTargets(options: { models: boolean }, env: NodeJS.ProcessEnv = process.env): string[] {
  const targets = [resolvePaths(env).home];
  if (options.models) targets.push(...Object.values(DEFAULT_REPOS).map((repo) => repoCacheDir(repo, env)));
  return targets.filter((target) => existsSync(target));
}

export async function reset(options: { models: boolean; yes: boolean }): Promise<void> {
  const targets = resetTargets(options);
  if (!targets.length) {
    info('Nothing to remove.');
    return;
  }
  say('This removes:');
  for (const target of targets) say(`  ${target}  (${await sizeOf(target)})`);
  if (!options.models) say('Downloaded checkpoints are kept; add --models to remove them too.');
  if (!options.yes && !(await confirm('Continue?', false))) {
    info('Aborted.');
    return;
  }
  for (const target of targets) await rm(target, { recursive: true, force: true });
  success('Removed. The runtime is set up again on the next `maclaya serve`.');
}
