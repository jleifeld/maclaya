import { resolvePaths } from '../paths';
import { checkPlatform } from '../runtime/environment';
import type { ModelEvent } from '../runtime/worker';
import { parseCheckpoints } from './serve';
import { CliError, info, startWorker, success } from './terminal';

export async function pull(checkpoints: string[], options: { verbose: boolean }): Promise<void> {
  const platform = await checkPlatform();
  if (!platform.ok) throw new CliError(platform.message);
  const targets = parseCheckpoints(checkpoints.length ? checkpoints.join(',') : 'english,multilingual');
  const session = await startWorker(resolvePaths(), { echo: true, verbose: options.verbose });
  session.worker.on('model', (event: ModelEvent) => {
    if (event.state === 'loading') info(`Fetching ${event.model} …`);
    if (event.state === 'loaded') success(`${event.model} is ready (${event.seconds?.toFixed(1)}s)`);
  });
  try {
    await session.worker.load(targets);
  } finally {
    await session.close();
  }
}
