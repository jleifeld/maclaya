import { parseSystemOneRequest } from '../../src/jev/schema';
import { blankQuestion, bodyFromDraft, draftFromBody, fromText, toText } from '../../web/src/lib/request-model';

describe('playground request model', () => {
  const body = {
    model: 'laya/english',
    state: { message: 'Refund please', order: 42 },
    questions: {
      team: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'money', technical: null, sales: { what: 'deals', examples: ['demo'] } } },
      urgency: { type: 'score', instructions: { question: 'How urgent?' }, criteria: ['low', null, 'high'] },
      refund: { type: 'noul', instructions: 'Refund?', criteria: { true: 'asks for money', false: 'anything else' } },
      plain: { type: 'noul', instructions: 'Plain?' },
    },
  };

  it('round-trips a Jev request through the builder without changing it', () => {
    const draft = draftFromBody(body);
    expect(draft.stateMode).toBe('json');
    expect(draft.questions.map((q) => q.name)).toEqual(['team', 'urgency', 'refund', 'plain']);
    const { body: rebuilt, errors } = bodyFromDraft(draft);
    expect(errors).toEqual([]);
    expect(rebuilt).toEqual(body);
  });

  it('keeps plain-text state as text and treats null state as empty', () => {
    expect(draftFromBody({ state: 'hello', questions: {} })).toMatchObject({ stateMode: 'text', state: 'hello', model: 'jev-latest' });
    expect(draftFromBody({ state: null, questions: {} })).toMatchObject({ stateMode: 'text', state: '' });
  });

  it('reads list-style choice criteria', () => {
    const draft = draftFromBody({ state: 's', questions: { c: { type: 'choice', criteria: ['a', 'b'] } } });
    expect(draft.questions[0]!.options).toEqual([
      { label: 'a', description: '' },
      { label: 'b', description: '' },
    ]);
    expect(bodyFromDraft(draft).body.questions).toEqual({ c: { type: 'choice', criteria: { a: null, b: null } } });
  });

  it('reports problems instead of building a broken request', () => {
    const draft = draftFromBody(body);
    draft.stateMode = 'json';
    draft.state = '{ broken';
    draft.questions[1]!.name = 'team';
    draft.questions[2]!.name = ' ';
    const { errors } = bodyFromDraft(draft);
    expect(errors).toEqual([
      expect.stringMatching(/^State is not valid JSON/),
      'Question name "team" is used twice',
      'Question 3 needs a name',
    ]);
    expect(bodyFromDraft({ ...draft, questions: [] }).errors).toContain('Add at least one question');
  });

  it('drops empty option rows and optional noul descriptions', () => {
    const q = blankQuestion('choice', 'pick');
    q.options = [
      { label: 'yes', description: '' },
      { label: '  ', description: 'ignored' },
    ];
    const noul = blankQuestion('noul', 'flag');
    const { body: built } = bodyFromDraft({ model: 'jev-latest', stateMode: 'text', state: 'x', questions: [q, noul] });
    expect(built.questions).toEqual({ pick: { type: 'choice', criteria: { yes: null } }, flag: { type: 'noul' } });
  });

  it('builds requests the server accepts for every blank question type', () => {
    const questions = (['noul', 'choice', 'score'] as const).map((type, i) => {
      const q = blankQuestion(type, `q${i}`);
      q.instructions = 'Question?';
      q.options = q.options.map((o, j) => ({ ...o, label: `option${j}` }));
      q.levels = q.levels.map((_, j) => `level ${j}`);
      return q;
    });
    const { body: built, errors } = bodyFromDraft({ model: 'jev-latest', stateMode: 'text', state: 'hello', questions });
    expect(errors).toEqual([]);
    expect(parseSystemOneRequest(built)).toMatchObject({ ok: true });
  });

  it.each([
    ['plain text', 'plain text'],
    ['{"what":"x"}', { what: 'x' }],
    ['[1, 2]', [1, 2]],
    ['{not json', '{not json'],
    ['   ', null],
  ])('parses builder text %p', (text, value) => {
    expect(fromText(text)).toEqual(value);
  });

  it('renders structured values as compact JSON text', () => {
    expect(toText({ a: [1] })).toBe('{"a":[1]}');
    expect(toText(null)).toBe('');
    expect(toText('x')).toBe('x');
  });
});
