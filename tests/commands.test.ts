import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runChecks } from '../src/commands/doctor';
import { buildPredictBody, predict } from '../src/commands/predict';
import { reset, resetTargets } from '../src/commands/reset';
import { parseCheckpoints } from '../src/commands/serve';
import { CliError } from '../src/commands/terminal';
import { resolvePaths } from '../src/paths';
import { STUB_PYTHONPATH, systemPython } from './helpers/stub-python';

const originalEnv = { ...process.env };
let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'maclaya-cmd-'));
  process.env.MACLAYA_HOME = path.join(home, '.maclaya');
  process.env.MACLAYA_PYTHON = systemPython();
  process.env.PYTHONPATH = STUB_PYTHONPATH;
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('parseCheckpoints', () => {
  it.each([
    ['english', ['english']],
    ['english, multilingual', ['english', 'multilingual']],
    ['all', ['english', 'multilingual', 'typed-decisions']],
    ['none', []],
  ])('parses %p', (value, expected) => {
    expect(parseCheckpoints(value)).toEqual(expected);
  });

  it('rejects unknown names', () => {
    expect(() => parseCheckpoints('english,klingon')).toThrow(CliError);
  });
});

describe('predict command', () => {
  it('builds the body from inline JSON or files', async () => {
    const file = path.join(home, 'q.json');
    writeFileSync(file, JSON.stringify({ q: { type: 'noul', instructions: 'q?' } }));
    const stateFile = path.join(home, 'state.json');
    writeFileSync(stateFile, JSON.stringify({ message: 'hi' }));
    await expect(buildPredictBody({ state: 'hello', questions: file, extras: false, verbose: false })).resolves.toEqual({
      state: 'hello',
      questions: { q: { type: 'noul', instructions: 'q?' } },
    });
    await expect(
      buildPredictBody({ stateFile, questions: '{"a":{"type":"noul"}}', model: 'laya/english', extras: false, verbose: false }),
    ).resolves.toEqual({ model: 'laya/english', state: { message: 'hi' }, questions: { a: { type: 'noul' } } });
  });

  it('requires exactly one state source and valid JSON', async () => {
    await expect(buildPredictBody({ questions: '{}', extras: false, verbose: false })).rejects.toThrow('exactly one');
    await expect(buildPredictBody({ state: 'a', stateFile: 'b', questions: '{}', extras: false, verbose: false })).rejects.toThrow('exactly one');
    await expect(buildPredictBody({ state: 'a', questions: '{nope', extras: false, verbose: false })).rejects.toThrow('--questions');
  });

  it('prints a Jev response produced by the worker', async () => {
    const out: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    await predict({ state: 'Refund please', questions: '{"refund":{"type":"noul","instructions":"Refund?"}}', extras: false, verbose: false });
    expect(JSON.parse(out.join(''))).toEqual({
      model: 'laya/english',
      answers: { refund: { type: 'noul', noul: 0.9 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    expect(existsSync(path.join(process.env.MACLAYA_HOME!, 'logs', 'worker.log'))).toBe(true);
  });

  it('reports Jev validation errors as CLI errors', async () => {
    await expect(predict({ state: 's', questions: '{"q":{"type":"bogus"}}', extras: false, verbose: false })).rejects.toThrow(
      "invalid_request: questions.q.type: expected one of 'noul', 'choice', 'score'",
    );
  });
});

describe('doctor', () => {
  let server: Server | undefined;

  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  it('checks the platform, runtime, checkpoints and port', async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const hub = path.join(home, 'hub');
    mkdirSync(path.join(hub, 'models--aac6fef--laya-mlx', 'snapshots'), { recursive: true });

    const checks = await runChecks(resolvePaths(), port, { ...process.env, HF_HUB_CACHE: hub });
    const byLabel = Object.fromEntries(checks.map((c) => [c.label, c]));

    expect(byLabel.Hardware!.status).toBe('ok');
    expect(byLabel['Node.js']!.status).toBe('ok');
    expect(byLabel['Python runtime']).toMatchObject({ status: 'ok', detail: expect.stringContaining('MACLAYA_PYTHON') });
    expect(byLabel.MLX).toMatchObject({ status: 'fail', detail: expect.stringContaining('mlx') });
    expect(byLabel['Checkpoint english']).toMatchObject({ status: 'ok', detail: 'downloaded (aac6fef/laya-mlx)' });
    expect(byLabel['Checkpoint multilingual']).toMatchObject({ status: 'warn', hint: expect.stringContaining('maclaya pull multilingual') });
    expect(byLabel[`Port ${port}`]).toMatchObject({ status: 'warn', detail: expect.stringContaining('in use') });
  });
});

describe('reset', () => {
  it('removes the maclaya home and, with --models, the cached checkpoints', async () => {
    const paths = resolvePaths();
    mkdirSync(paths.venv, { recursive: true });
    const hub = path.join(home, 'hub');
    process.env.HF_HUB_CACHE = hub;
    const cached = path.join(hub, 'models--aac6fef--laya-multilingual-mlx');
    const unrelated = path.join(hub, 'models--someone--else');
    mkdirSync(cached, { recursive: true });
    mkdirSync(unrelated, { recursive: true });

    expect(resetTargets({ models: false })).toEqual([paths.home]);
    expect(resetTargets({ models: true })).toEqual([paths.home, cached]);

    await reset({ models: true, yes: true });
    expect(existsSync(paths.home)).toBe(false);
    expect(existsSync(cached)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('does nothing without confirmation in a non-interactive shell', async () => {
    const paths = resolvePaths();
    mkdirSync(paths.venv, { recursive: true });
    await reset({ models: false, yes: false });
    expect(existsSync(paths.home)).toBe(true);
  });
});
