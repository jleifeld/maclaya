import { execFileSync } from 'node:child_process';
import { EngineError, WorkerClient, type ModelEvent } from '../src/runtime/worker';
import { stubEnv, systemPython, WORKER_SCRIPT } from './helpers/stub-python';

function stubWorker(env: Record<string, string> = {}, stderr: string[] = []) {
  return new WorkerClient({
    python: systemPython(),
    script: WORKER_SCRIPT,
    env: stubEnv(env),
    onStderr: (chunk) => stderr.push(chunk),
    startupTimeoutMs: 15_000,
  });
}

describe('WorkerClient with the Python worker', () => {
  let worker: WorkerClient;

  afterEach(async () => {
    await worker?.stop();
  });

  it('starts, reports runtime info and keeps library output off the protocol channel', async () => {
    const stderr: string[] = [];
    worker = stubWorker({}, stderr);
    await worker.start();
    expect(worker.info).toMatchObject({
      laya_mlx: '0.0.0-stub',
      checkpoints: { english: 'aac6fef/laya-mlx', multilingual: 'aac6fef/laya-multilingual-mlx' },
    });
    expect(stderr.join('')).toContain('stub router init');
  });

  it('runs the worker in its own process group so terminal Ctrl+C only reaches maclaya', async () => {
    worker = stubWorker();
    await worker.start();
    const pgid = (pid: number) => execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim();
    expect(worker.info!.pid).toEqual(expect.any(Number));
    expect(pgid(worker.info!.pid)).toBe(String(worker.info!.pid));
    expect(pgid(worker.info!.pid)).not.toBe(pgid(process.pid));
  });

  it('ignores SIGINT and keeps answering', async () => {
    worker = stubWorker();
    await worker.start();
    process.kill(worker.info!.pid, 'SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(worker.presets()).resolves.toHaveProperty('triage');
  });

  it('routes predictions and emits model lifecycle events once per checkpoint', async () => {
    worker = stubWorker();
    const events: ModelEvent[] = [];
    worker.on('model', (e: ModelEvent) => events.push(e));
    const questions = { refund: { type: 'noul' as const, instructions: 'Refund?' } };

    const en = await worker.predict({ state: 'Please refund me', questions, model: null });
    expect(en).toMatchObject({
      answers: { refund: { type: 'noul', noul: 0.9, confidence: 0.9 } },
      usage: { input_tokens: 10, output_tokens: 0 },
      routing: { model: 'english', reason: 'English Latin text' },
      inference_ms: expect.any(Number),
    });
    const de = await worker.predict({ state: 'Guten Tag, Rückerstattung bitte', questions, model: null });
    expect(de.routing.model).toBe('multilingual');
    await worker.predict({ state: 'again', questions, model: 'english' });

    expect(events.map((e) => `${e.model}:${e.state}`)).toEqual(['english:loading', 'english:loaded', 'multilingual:loading', 'multilingual:loaded']);
    expect(worker.modelStates()).toEqual({ english: 'loaded', multilingual: 'loaded', 'typed-decisions': 'idle' });
  });

  it('answers concurrent requests independently', async () => {
    worker = stubWorker();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        worker.predict({ state: `s${i}`, questions: { [`q${i}`]: { type: 'noul', instructions: 'q' } }, model: null }),
      ),
    );
    results.forEach((result, i) => expect(Object.keys(result.answers)).toEqual([`q${i}`]));
  });

  it('turns runtime ValueErrors into invalid_request errors', async () => {
    worker = stubWorker();
    const error = await worker
      .predict({ state: 's', questions: { q: { type: 'noul' } as never }, model: null })
      .catch((e: EngineError) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ kind: 'invalid_request', message: 'Question is missing instructions' });
  });

  it('reports failed checkpoint loads', async () => {
    worker = stubWorker({ STUB_FAIL_TYPED: '1' });
    const events: ModelEvent[] = [];
    worker.on('model', (e: ModelEvent) => events.push(e));
    await expect(worker.load(['typed-decisions'])).rejects.toMatchObject({ kind: 'internal', message: 'RuntimeError: download failed' });
    expect(events.at(-1)).toEqual({ model: 'typed-decisions', state: 'failed', message: 'download failed' });
  });

  it('returns the runtime presets', async () => {
    worker = stubWorker();
    expect(Object.keys(await worker.presets())).toEqual(['triage', 'email', 'guard', 'moderation', 'router']);
  });

  it('rejects in-flight calls when the worker crashes and restarts it', async () => {
    worker = stubWorker({ STUB_CRASH_ON_PREDICT: '1' });
    await worker.start();
    const restarted = new Promise((resolve) => worker.once('restart', resolve));
    await expect(worker.predict({ state: 's', questions: { q: { type: 'noul', instructions: 'q' } }, model: null })).rejects.toMatchObject({
      kind: 'unavailable',
      message: expect.stringContaining('code 3'),
    });
    await expect(restarted).resolves.toMatchObject({ attempt: 1 });
    await expect(worker.presets()).resolves.toHaveProperty('triage');
  });

  it('fails startup with the Python error when laya_mlx cannot be imported', async () => {
    worker = new WorkerClient({ python: systemPython(), script: WORKER_SCRIPT, env: { PYTHONPATH: '' }, startupTimeoutMs: 15_000 });
    await expect(worker.start()).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining("No module named 'laya_mlx'") });
  });

  it('fails startup when the interpreter does not exist', async () => {
    worker = new WorkerClient({ python: '/nonexistent/python', script: WORKER_SCRIPT });
    await expect(worker.start()).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('Could not start Python') });
  });
});
