import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { postJson, startTestServer, type TestServer } from './helpers/server';

const body = {
  state: 'I was charged twice.',
  questions: {
    refund: { type: 'noul', instructions: 'Refund?' },
    team: { type: 'choice', criteria: { billing: 'money', tech: 'bugs' } },
    level: { type: 'score', criteria: ['low', 'high'] },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions below check the shape
type AnyJson = any;

async function getJson(url: string): Promise<{ status: number; body: AnyJson }> {
  const res = await fetch(url);
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
}

describe('dashboard API', () => {
  let t: TestServer;

  afterEach(async () => {
    await t.close();
  });

  it('aggregates recorded requests into stats', async () => {
    t = await startTestServer();
    await postJson(t.baseURL, '/v1/systemone', body, { 'user-agent': 'typesafe-sdk/0.6.0' });
    await postJson(t.baseURL, '/v1/systemone', { ...body, model: 'laya/multilingual' }, { 'user-agent': 'curl/8.7.1' });
    await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: {} }, { 'user-agent': 'curl/8.7.1' });

    const { status, body: stats } = await getJson(`${t.baseURL}/api/stats?range=15m`);
    expect(status).toBe(200);
    expect(stats.summary).toMatchObject({ requests: 3, errors: 1, input_tokens: 84, questions: 6 });
    expect(stats.summary.error_rate).toBeCloseTo(1 / 3);
    expect(stats.summary.latency_ms.p50).toEqual(expect.any(Number));
    expect(stats.summary.inference_ms).toEqual({ avg: 12.5, p50: 12.5 });
    expect(stats.by_model.map((m: { model: string }) => m.model).sort()).toEqual(['laya/english', 'laya/multilingual']);
    expect(stats.by_question_type).toEqual([
      { type: 'noul', questions: 2 },
      { type: 'choice', questions: 2 },
      { type: 'score', questions: 2 },
    ]);
    expect(stats.by_client).toEqual([
      { client: 'curl/8.7.1', requests: 2 },
      { client: 'typesafe-sdk/0.6.0', requests: 1 },
    ]);
    expect(stats.by_status).toEqual([
      { status: 200, requests: 2 },
      { status: 422, requests: 1 },
    ]);
    expect(stats.timeseries.reduce((sum: number, b: { requests: number }) => sum + b.requests, 0)).toBe(3);
  });

  it('rejects unknown ranges', async () => {
    t = await startTestServer();
    expect((await getJson(`${t.baseURL}/api/stats?range=2y`)).status).toBe(400);
  });

  it('lists requests newest first, filters them and returns details with bodies', async () => {
    t = await startTestServer();
    const ok = await postJson(t.baseURL, '/v1/systemone', body, { 'x-maclaya-source': 'playground' });
    await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: {} });

    const all = await getJson(`${t.baseURL}/api/requests`);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.items[0]).toMatchObject({ status: 422 });
    expect(all.body.items[0].request_body).toBeUndefined();

    const errors = await getJson(`${t.baseURL}/api/requests?status=error`);
    expect(errors.body.items).toHaveLength(1);
    const playground = await getJson(`${t.baseURL}/api/requests?source=playground`);
    expect(playground.body.items).toMatchObject([{ status: 200, source: 'playground', model: 'laya/english', n_noul: 1, n_choice: 1, n_score: 1 }]);

    const id = ok.headers.get('x-typesafe-request-id');
    const detail = await getJson(`${t.baseURL}/api/requests/${id}`);
    expect(detail.body.request_body).toEqual(body);
    expect(detail.body.response_body).toEqual(ok.body);
    expect(detail.body.route_reason).toBe('English Latin text');

    expect((await getJson(`${t.baseURL}/api/requests/req_missing`)).status).toBe(404);
  });

  it('pages through requests with the before cursor', async () => {
    t = await startTestServer();
    for (let i = 0; i < 3; i++) {
      t.stats.insert({
        id: `r${i}`, ts: 1000 + i, status: 200, error_type: null, error_message: null, model_requested: null, model: 'laya/english',
        route_reason: null, latency_ms: 1, inference_ms: 1, input_tokens: 1, n_noul: 1, n_choice: 0, n_score: 0, client: null,
        source: 'api', request_body: null, response_body: null,
      });
    }
    const first = await getJson(`${t.baseURL}/api/requests?limit=2`);
    expect(first.body.items.map((r: { id: string }) => r.id)).toEqual(['r2', 'r1']);
    const second = await getJson(`${t.baseURL}/api/requests?limit=2&before=${first.body.next_before}`);
    expect(second.body.items.map((r: { id: string }) => r.id)).toEqual(['r0']);
  });

  it('does not store bodies with logBodies disabled', async () => {
    t = await startTestServer({ logBodies: false });
    const res = await postJson(t.baseURL, '/v1/systemone', body);
    const detail = await getJson(`${t.baseURL}/api/requests/${res.headers.get('x-typesafe-request-id')}`);
    expect(detail.body).toMatchObject({ status: 200, request_body: null, response_body: null, n_noul: 1 });
  });

  it('clears the request log', async () => {
    t = await startTestServer();
    await postJson(t.baseURL, '/v1/systemone', body);
    const res = await fetch(`${t.baseURL}/api/requests`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await getJson(`${t.baseURL}/api/requests`)).body.items).toEqual([]);
  });

  it('serves presets from the runtime plus the quickstart', async () => {
    t = await startTestServer();
    const presets = (await getJson(`${t.baseURL}/api/presets`)).body;
    expect(Object.keys(presets)).toEqual(['quickstart', 'triage']);
    expect(presets.triage).toMatchObject({
      title: 'Support triage',
      state: { message: expect.any(String) },
      questions: { is_urgent: { type: 'noul' } },
    });
    t.engine.presetsFail = true;
    expect(Object.keys((await getJson(`${t.baseURL}/api/presets`)).body)).toEqual(['quickstart']);
  });

  it('reports status, runtime and checkpoint states', async () => {
    t = await startTestServer({ apiKey: 'k', logBodies: false });
    const status = (await getJson(`${t.baseURL}/api/status`)).body;
    expect(status).toMatchObject({
      version: '0.0.0-test',
      auth_required: true,
      log_bodies: false,
      retention_days: 7,
      base_url: t.baseURL,
      runtime: { laya_mlx: '0.2.0', metal: true },
      checkpoints: [
        { checkpoint: 'english', state: 'loaded' },
        { checkpoint: 'multilingual', state: 'idle' },
        { checkpoint: 'typed-decisions', state: 'idle' },
      ],
    });
    expect(status.models).toHaveLength(4);
  });

  it('loads checkpoints on demand', async () => {
    t = await startTestServer();
    const res = await postJson(t.baseURL, '/api/checkpoints/multilingual/load', {});
    expect(res).toMatchObject({ status: 202, body: { checkpoint: 'multilingual', state: 'loading' } });
    expect(t.engine.loads).toEqual([['multilingual']]);
    expect((await postJson(t.baseURL, '/api/checkpoints/gpt/load', {})).status).toBe(404);
  });

  it('streams request and model events over SSE', async () => {
    t = await startTestServer();
    const controller = new AbortController();
    const res = await fetch(`${t.baseURL}/api/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const readUntil = async (needle: string) => {
      while (!received.includes(needle)) {
        const { value } = await reader.read();
        received += decoder.decode(value);
      }
    };
    await readUntil('event: hello');
    await postJson(t.baseURL, '/v1/systemone', body);
    await readUntil('event: request');
    await t.engine.load(['typed-decisions']);
    await readUntil('event: model');
    controller.abort();

    const request = received.split('event: request\ndata: ')[1]!.split('\n')[0]!;
    expect(JSON.parse(request)).toMatchObject({ status: 200, model: 'laya/english' });
    expect(JSON.parse(request).request_body).toBeUndefined();
    const model = received.split('event: model\ndata: ')[1]!.split('\n')[0]!;
    expect(JSON.parse(model)).toEqual({ model: 'typed-decisions', state: 'loaded', seconds: 0.1 });
  });

  it('keeps the dashboard local unless exposed, while the API stays reachable', async () => {
    t = await startTestServer();
    const remote = { remoteAddress: '192.168.1.20' };
    expect((await t.server.app.inject({ url: '/api/status', ...remote })).statusCode).toBe(403);
    expect((await t.server.app.inject({ url: '/', ...remote })).statusCode).toBe(403);
    expect((await t.server.app.inject({ url: '/v1/models', ...remote })).statusCode).toBe(200);
    await t.close();

    t = await startTestServer({ exposeDashboard: true });
    expect((await t.server.app.inject({ url: '/api/status', remoteAddress: '192.168.1.20' })).statusCode).toBe(200);
  });

  it('serves the built UI with an SPA fallback', async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), 'maclaya-web-'));
    writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(path.join(webRoot, 'app.js'), 'console.log(1)');
    t = await startTestServer({ webRoot });
    for (const url of ['/', '/playground', '/requests/req_1']) {
      const res = await fetch(`${t.baseURL}${url}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
    }
    expect(await (await fetch(`${t.baseURL}/app.js`)).text()).toBe('console.log(1)');
    expect((await fetch(`${t.baseURL}/api/unknown`)).status).toBe(404);
    const v1 = await fetch(`${t.baseURL}/v1/unknown`);
    expect(v1.status).toBe(404);
    expect(await v1.json()).toMatchObject({ error_type: 'not_found' });
  });

  it('explains how to build the UI when it is missing', async () => {
    t = await startTestServer({ webRoot: '/nonexistent' });
    expect(await (await fetch(t.baseURL)).text()).toContain('npm run build:web');
  });
});
