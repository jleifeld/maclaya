#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from 'commander';
import pc from 'picocolors';
import { doctor } from './commands/doctor';
import { predict } from './commands/predict';
import { pull } from './commands/pull';
import { reset } from './commands/reset';
import { serve } from './commands/serve';
import { CliError, fail, say } from './commands/terminal';
import { VERSION } from './version';

function integer(min: number, max: number) {
  return (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new InvalidArgumentError(`expected an integer between ${min} and ${max}`);
    }
    return parsed;
  };
}

const program = new Command()
  .name('maclaya')
  .description('Run Laya typed-decision models on this Mac behind a Jev-compatible API.')
  .version(VERSION)
  .showHelpAfterError();

program
  .command('serve')
  .description('start the Jev API, dashboard and playground')
  .addOption(new Option('-p, --port <port>', 'port to listen on').default(4545).argParser(integer(1, 65535)).env('MACLAYA_PORT'))
  .addOption(new Option('-H, --host <host>', 'interface to bind; 0.0.0.0 exposes the API to your network').default('127.0.0.1').env('MACLAYA_HOST'))
  .addOption(new Option('-k, --api-key <key>', 'require this key as `Authorization: Bearer <key>`').env('MACLAYA_API_KEY'))
  .option('--preload <checkpoints>', 'checkpoints to load at startup: english, multilingual, typed-decisions, all or none', 'english')
  .option('--no-log-bodies', 'record only metadata, not request and response bodies')
  .addOption(new Option('--retention-days <days>', 'how long request stats are kept').default(7).argParser(integer(1, 365)))
  .option('--expose-dashboard', 'serve the dashboard to other machines too (it is localhost-only by default)', false)
  .option('--no-open', 'do not open the dashboard in the browser')
  .option('-v, --verbose', 'print runtime and worker logs', false)
  .action((options) => serve(options));

program
  .command('pull')
  .description('download checkpoints ahead of time (default: english multilingual)')
  .argument('[checkpoints...]', 'english, multilingual, typed-decisions or all')
  .option('-v, --verbose', 'print runtime and worker logs', false)
  .action((checkpoints: string[], options) => pull(checkpoints, options));

program
  .command('predict')
  .description('answer typed questions once, without starting the server')
  .option('-s, --state <text>', 'plain-text state')
  .option('-f, --state-file <file>', 'JSON file with a structured state')
  .requiredOption('-q, --questions <file-or-json>', 'questions as a JSON file or inline JSON')
  .option('-m, --model <model>', 'jev-latest (auto-routed), laya/english, laya/multilingual or laya/typed-decisions')
  .option('--extras', 'include laya-specific fields (action probability, routing)', false)
  .option('-v, --verbose', 'print runtime and worker logs', false)
  .action((options) => predict(options));

program
  .command('doctor')
  .description('check hardware, runtime, checkpoints and port')
  .addOption(new Option('-p, --port <port>', 'port to check').default(4545).argParser(integer(1, 65535)))
  .action(async (options) => {
    if (!(await doctor(options))) process.exitCode = 1;
  });

program
  .command('reset')
  .description('remove the Python runtime, stats and logs in ~/.maclaya')
  .option('--models', 'also delete downloaded Laya checkpoints from the Hugging Face cache', false)
  .option('-y, --yes', 'do not ask for confirmation', false)
  .action((options) => reset(options));

program.parseAsync().catch((error: unknown) => {
  if (error instanceof CliError) {
    fail(error.message);
    if (error.hint) say(pc.dim(`  ${error.hint}`));
  } else {
    fail((error as Error)?.stack ?? String(error));
  }
  process.exit(1);
});
