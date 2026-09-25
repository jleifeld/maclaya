import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { JevError } from '../jev/errors';
import { runSystemOne } from '../jev/system-one';
import { resolvePaths } from '../paths';
import { checkPlatform } from '../runtime/environment';
import { CliError, startWorker } from './terminal';

export interface PredictOptions {
  state?: string;
  stateFile?: string;
  questions: string;
  model?: string;
  extras: boolean;
  verbose: boolean;
}

async function readJsonArgument(value: string, label: string): Promise<unknown> {
  const text = existsSync(value) ? await readFile(value, 'utf8') : value;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${label} is neither a JSON file nor valid inline JSON: ${(error as Error).message}`);
  }
}

export async function buildPredictBody(options: PredictOptions): Promise<Record<string, unknown>> {
  if ((options.state === undefined) === (options.stateFile === undefined)) {
    throw new CliError('Pass exactly one of --state <text> or --state-file <file.json>.');
  }
  const state = options.stateFile !== undefined ? await readJsonArgument(options.stateFile, '--state-file') : options.state;
  const questions = await readJsonArgument(options.questions, '--questions');
  return { ...(options.model ? { model: options.model } : {}), state, questions };
}

export async function predict(options: PredictOptions): Promise<void> {
  const platform = await checkPlatform();
  if (!platform.ok) throw new CliError(platform.message);
  const body = await buildPredictBody(options);
  const session = await startWorker(resolvePaths(), { echo: true, verbose: options.verbose });
  try {
    const { response } = await runSystemOne(session.worker, body, { extras: options.extras });
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } catch (error) {
    if (error instanceof JevError) throw new CliError(`${error.errorType}: ${error.message}`);
    throw error;
  } finally {
    await session.close();
  }
}
