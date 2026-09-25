import { choice, noul, score, TypeSafeClient } from '@typesafe-ai/sdk';
import type { AddressInfo } from 'node:net';
import { ensureRuntime } from '../../src/runtime/environment';
import { WorkerClient } from '../../src/runtime/worker';
import { buildServer, type MaclayaServer } from '../../src/server/app';
import { resolvePaths } from '../../src/paths';
import { StatsStore } from '../../src/stats/store';

// Runs the real laya-mlx runtime and downloads checkpoints on first use: `npm run test:e2e`.
const describeE2E = process.env.MACLAYA_E2E ? describe : describe.skip;

describeE2E('real Laya checkpoints on MLX', () => {
  let worker: WorkerClient;
  let server: MaclayaServer;
  let client: TypeSafeClient;

  beforeAll(async () => {
    const paths = resolvePaths();
    const python = await ensureRuntime({ paths });
    worker = new WorkerClient({ python, script: paths.workerScript });
    await worker.start();
    await worker.load(['english', 'multilingual']);
    server = await buildServer({ engine: worker, stats: new StatsStore({ file: ':memory:' }), version: 'e2e' });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = server.app.server.address() as AddressInfo;
    client = new TypeSafeClient({ apiKey: 'local', baseURL: `http://127.0.0.1:${port}`, logLevel: 'off' });
  }, 600_000);

  afterAll(async () => {
    await server?.app.close();
    await worker?.stop();
  });

  it('answers an English support ticket sensibly', async () => {
    const { answers, model, usage } = await client.systemOne({
      state: 'I was billed twice this month. Please refund the duplicate charge.',
      questions: {
        refund: noul('Does the customer ask for money back?'),
        department: choice('Which department should handle this?', { billing: 'invoices, payments, refunds', technical: 'bugs and outages', sales: 'pricing' }),
        urgency: score('How urgent is this?', ['not urgent', 'soon', 'critical']),
      },
    });
    expect(model).toBe('laya/english');
    expect(answers.refund.noul).toBeGreaterThan(0.5);
    expect(answers.department.choice).toBe('billing');
    expect(Object.values(answers.department.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(answers.urgency.score).toBeGreaterThanOrEqual(0);
    expect(answers.urgency.score).toBeLessThanOrEqual(2);
    expect(usage.input_tokens).toBeGreaterThan(0);
  });

  it('routes German text to the multilingual checkpoint', async () => {
    const { model, answers } = await client.systemOne({
      state: 'Mir wurde mein Abonnement doppelt berechnet, bitte erstatten Sie den Betrag.',
      questions: { refund: noul('Does the customer ask for money back?') },
    });
    expect(model).toBe('laya/multilingual');
    expect(answers.refund.noul).toBeGreaterThan(0.5);
  });
});
