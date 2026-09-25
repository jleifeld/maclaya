import { AuthenticationError, choice, InternalServerError, noul, score, UnprocessableEntityError } from '@typesafe-ai/sdk';
import { EngineError } from '../src/runtime/worker';
import { postJson, startTestServer, type TestServer } from './helpers/server';

describe('Jev API compatibility (via @typesafe-ai/sdk)', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await startTestServer();
  });

  afterEach(async () => {
    await t.close();
  });

  it('lists models in the TypeSafe { models: [...] } shape', async () => {
    const models = await t.client().models.list();
    expect(models.map((m) => m.name)).toEqual(['jev-latest', 'laya/english', 'laya/multilingual', 'laya/typed-decisions']);
    for (const model of models) {
      expect(Object.keys(model).sort()).toEqual(['description', 'name', 'release_date']);
    }
  });

  it('answers noul, choice and score questions with exactly the Jev fields', async () => {
    const { data, requestId, response } = await t
      .client()
      .systemOne({
        state: 'I was charged twice for my subscription.',
        questions: {
          refund: noul('Is the customer asking for money back?'),
          department: choice('Which team should handle this?', { billing: 'Charges and refunds', technical: 'Bugs' }),
          severity: score('How severe?', ['cosmetic', 'broken', 'blocking']),
        },
      })
      .withResponse();

    expect(data).toEqual({
      model: 'laya/english',
      answers: {
        refund: { type: 'noul', noul: 0.87 },
        department: { type: 'choice', choice: 'billing', confidence: 0.61, probabilities: { billing: 0.5, technical: 0.5 } },
        severity: {
          type: 'score',
          score: 1.25,
          confidence: 0.33,
          probabilities: { '0': 1 / 3, '1': 1 / 3, '2': 1 / 3 },
          legend: { '0': 'cosmetic', '1': 'broken', '2': 'blocking' },
        },
      },
      usage: { input_tokens: 42, output_tokens: 0 },
    });
    expect(requestId).toMatch(/^req_[0-9a-f]{32}$/);
    expect(response.headers.get('x-laya-model')).toBe('english');
    expect(response.headers.get('x-laya-route-reason')).toBe('English Latin text');
  });

  it('keeps the answer order of the questions', async () => {
    const data = await t.client().systemOne({
      state: 's',
      questions: { z: noul('z?'), a: noul('a?'), m: noul('m?') },
    });
    expect(Object.keys(data.answers)).toEqual(['z', 'a', 'm']);
  });

  it('echoes structured and null rubric entries in the score legend', async () => {
    const data = await t.client().systemOne({
      state: { ticket: 'x' },
      questions: { level: score({ question: 'How bad?' }, ['fine', { what: 'bad', examples: ['e'] }, null]) },
    });
    expect(data.answers.level.legend).toEqual({ '0': 'fine', '1': { what: 'bad', examples: ['e'] }, '2': null });
    expect(t.engine.calls[0]!.questions.level).toEqual({
      type: 'score',
      instructions: { question: 'How bad?' },
      criteria: ['fine', { what: 'bad', examples: ['e'] }, ''],
    });
  });

  it('normalises null state, missing instructions and list-style choice criteria for the runtime', async () => {
    const res = await postJson(t.baseURL, '/v1/systemone', {
      state: null,
      questions: {
        yes: { type: 'noul', criteria: { true: 'it holds', false: null } },
        pick: { type: 'choice', instructions: null, criteria: ['red', 'green'] },
      },
      some_future_field: true,
    });
    expect(res.status).toBe(200);
    expect(t.engine.calls[0]).toEqual({
      state: '',
      model: null,
      questions: {
        yes: { type: 'noul', instructions: '', criteria: { true: 'it holds', false: null } },
        pick: { type: 'choice', instructions: '', criteria: { red: null, green: null } },
      },
    });
    expect(res.body.answers.pick.probabilities).toEqual({ red: 0.5, green: 0.5 });
  });

  it.each([
    [undefined, null, 'laya/english'],
    ['jev-latest', null, 'laya/english'],
    ['typesafe-ai/jev', null, 'laya/english'],
    ['jev-1.13.0', null, 'laya/english'],
    ['laya/multilingual', 'multilingual', 'laya/multilingual'],
    ['laya/typed-decisions', 'typed-decisions', 'laya/typed-decisions'],
  ])('maps model %p to checkpoint %p', async (model, checkpoint, responseModel) => {
    const res = await postJson(t.baseURL, '/v1/systemone', { model, state: 'hi', questions: { q: { type: 'noul', instructions: 'q?' } } });
    expect(res.status).toBe(200);
    expect(t.engine.calls[0]!.model).toBe(checkpoint);
    expect(res.body.model).toBe(responseModel);
  });

  it('reports the auto-routed checkpoint for non-English state', async () => {
    const res = await postJson(t.baseURL, '/v1/systemone', { state: 'Guten Tag, bitte erstatten', questions: { q: { type: 'noul', instructions: 'q?' } } });
    expect(res.body.model).toBe('laya/multilingual');
    expect(res.headers.get('x-laya-model')).toBe('multilingual');
  });

  it('rejects unknown models with a 422', async () => {
    await expect(t.client().systemOne({ model: 'gpt-4o', state: 's', questions: { q: noul('q?') } })).rejects.toMatchObject({
      constructor: UnprocessableEntityError,
      status: 422,
      body: { error_type: 'invalid_request', message: expect.stringContaining("model: unknown model 'gpt-4o'") },
    });
  });

  it('adds laya extras only when asked to', async () => {
    const plain = await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: { q: { type: 'noul', instructions: 'q?' } } });
    expect(plain.body.answers.q).toEqual({ type: 'noul', noul: 0.87 });
    expect(plain.body.maclaya).toBeUndefined();

    const extras = await postJson(
      t.baseURL,
      '/v1/systemone',
      { state: 's', questions: { q: { type: 'noul', instructions: 'q?' }, c: { type: 'choice', criteria: { a: 'A', b: 'B' } } } },
      { 'x-maclaya-extras': '1' },
    );
    expect(extras.body.answers.q).toEqual({ type: 'noul', noul: 0.87, confidence: 0.87, action: { act_probability: 0.97 } });
    expect(extras.body.answers.c.action).toEqual({ act_probability: 0.99 });
    expect(extras.body.maclaya).toEqual({ checkpoint: 'english', route_reason: 'English Latin text', inference_ms: 12.5 });
  });

  describe('validation errors', () => {
    const q = { type: 'noul', instructions: 'q?' };

    it.each([
      ['an unknown question type', { state: 's', questions: { refund: { type: 'bogus' } } }, "questions.refund.type: expected one of 'noul', 'choice', 'score'"],
      ['a missing state', { questions: { q } }, 'state: field required'],
      ['missing questions', { state: 's' }, 'questions: field required'],
      ['empty questions', { state: 's', questions: {} }, 'questions: expected at least 1 question'],
      ['a non-object body', [1, 2], 'request body must be a JSON object'],
      ['a score with one level', { state: 's', questions: { s: { type: 'score', criteria: ['only'] } } }, 'questions.s.criteria: expected at least 2 levels'],
      ['a score with eleven levels', { state: 's', questions: { s: { type: 'score', criteria: Array(11).fill('l') } } }, 'questions.s.criteria: expected at most 10 levels'],
      ['a choice without criteria', { state: 's', questions: { c: { type: 'choice' } } }, 'questions.c.criteria: expected a map of option labels to descriptions'],
      ['an empty choice', { state: 's', questions: { c: { type: 'choice', criteria: {} } } }, 'questions.c.criteria: expected at least 1 option'],
      ['duplicate list labels', { state: 's', questions: { c: { type: 'choice', criteria: ['a', 'a'] } } }, 'questions.c.criteria: option labels must be unique'],
      ['a non-string model', { model: 5, state: 's', questions: { q } }, 'model: expected a string'],
    ])('rejects %s', async (_label, body, message) => {
      const res = await postJson(t.baseURL, '/v1/systemone', body);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ message, error_type: 'invalid_request' });
      expect(t.engine.calls).toHaveLength(0);
    });

    it('accepts 255 choice options and rejects 256', async () => {
      const options = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null]));
      expect((await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: { c: { type: 'choice', criteria: options(255) } } })).status).toBe(200);
      const res = await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: { c: { type: 'choice', criteria: options(256) } } });
      expect(res.status).toBe(422);
      expect(res.body.message).toBe('questions.c.criteria: expected at most 255 options, got 256');
    });

    it('reports malformed JSON as a 400 invalid_request', async () => {
      const res = await postJson(t.baseURL, '/v1/systemone', '{not json');
      expect(res.status).toBe(400);
      expect(res.body.error_type).toBe('invalid_request');
      expect(res.body.message).toMatch(/not valid JSON/);
    });
  });

  describe('runtime failures', () => {
    const body = { state: 's', questions: { q: { type: 'noul', instructions: 'q?' } } };

    it('maps runtime validation errors to 422', async () => {
      t.engine.failWith = new EngineError('invalid_request', "Question 'q' has too many options for the token budget");
      const res = await postJson(t.baseURL, '/v1/systemone', body);
      expect(res).toMatchObject({ status: 422, body: { error_type: 'invalid_request', message: "Question 'q' has too many options for the token budget" } });
    });

    it('maps an unavailable worker to 503 overloaded', async () => {
      t.engine.failWith = new EngineError('unavailable', 'The inference worker exited (code 1)');
      const res = await postJson(t.baseURL, '/v1/systemone', body);
      expect(res).toMatchObject({ status: 503, body: { error_type: 'overloaded' } });
    });

    it('maps internal runtime errors to 500', async () => {
      t.engine.failWith = new EngineError('internal', 'FloatingPointError: Non-finite model outputs');
      await expect(t.client().systemOne({ state: 's', questions: { q: noul('q?') } })).rejects.toBeInstanceOf(InternalServerError);
    });
  });

  it('answers unknown /v1 routes with a Jev-style 404', async () => {
    const res = await fetch(`${t.baseURL}/v1/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'No route for GET /v1/nope', error_type: 'not_found' });
  });

  it('allows cross-origin calls to the API', async () => {
    const res = await fetch(`${t.baseURL}/v1/systemone`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});

describe('API key authentication', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await startTestServer({ apiKey: 'sekret' });
  });

  afterEach(async () => {
    await t.close();
  });

  it('rejects missing or wrong keys with authentication_error', async () => {
    await expect(t.client('wrong').systemOne({ state: 's', questions: { q: noul('q?') } })).rejects.toMatchObject({
      constructor: AuthenticationError,
      status: 401,
      body: { error_type: 'authentication_error' },
    });
    const res = await fetch(`${t.baseURL}/v1/models`);
    expect(res.status).toBe(401);
    expect(t.engine.calls).toHaveLength(0);
  });

  it('accepts the configured key', async () => {
    const client = t.client('sekret');
    await expect(client.models.list()).resolves.toHaveLength(4);
    await expect(client.systemOne({ state: 's', questions: { q: noul('q?') } })).resolves.toMatchObject({ answers: { q: { noul: 0.87 } } });
  });

  it('records rejected calls in the stats', async () => {
    await postJson(t.baseURL, '/v1/systemone', { state: 's', questions: {} });
    expect(t.stats.list()).toMatchObject([{ status: 401, error_type: 'authentication_error' }]);
  });
});
