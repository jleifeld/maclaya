import { z } from 'zod';

export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;
export const QUESTION_TYPES = ['noul', 'choice', 'score'] as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const entry = z.json({ error: 'expected a string, object, array or null' });

const instructions = entry.optional();

const noulQuestion = z.object({
  type: z.literal('noul'),
  instructions,
  criteria: z
    .object({ true: entry.optional(), false: entry.optional() }, { error: "expected an object with 'true'/'false' descriptions or null" })
    .nullish(),
});

const choiceQuestion = z.object({
  type: z.literal('choice'),
  instructions,
  criteria: z
    .union(
      [
        z.record(z.string().min(1, 'option labels must be nonempty'), entry),
        z.array(z.string().min(1, 'option labels must be nonempty')),
      ],
      { error: 'expected a map of option labels to descriptions' },
    )
    .superRefine((criteria, ctx) => {
      const labels = Array.isArray(criteria) ? criteria : Object.keys(criteria);
      if (labels.length === 0) ctx.addIssue({ code: 'custom', message: 'expected at least 1 option' });
      if (labels.length > MAX_CHOICE_OPTIONS) {
        ctx.addIssue({ code: 'custom', message: `expected at most ${MAX_CHOICE_OPTIONS} options, got ${labels.length}` });
      }
      if (Array.isArray(criteria) && new Set(criteria).size !== criteria.length) {
        ctx.addIssue({ code: 'custom', message: 'option labels must be unique' });
      }
    }),
});

const scoreQuestion = z.object({
  type: z.literal('score'),
  instructions,
  criteria: z
    .array(entry, { error: 'expected an ordered list of rubric levels' })
    .min(MIN_SCORE_LEVELS, `expected at least ${MIN_SCORE_LEVELS} levels`)
    .max(MAX_SCORE_LEVELS, `expected at most ${MAX_SCORE_LEVELS} levels`),
});

const question = z.discriminatedUnion('type', [noulQuestion, choiceQuestion, scoreQuestion], {
  error: (issue) =>
    issue.code === 'invalid_union'
      ? `expected one of ${QUESTION_TYPES.map((t) => `'${t}'`).join(', ')}`
      : 'expected a question object',
});

export const systemOneRequestSchema = z.object(
  {
    model: z.string({ error: 'expected a string' }).nullish(),
    state: z.custom<JsonValue>((value) => value !== undefined, 'field required'),
    questions: z
      .record(z.string().min(1, 'question names must be nonempty'), question, {
        error: (issue) => (issue.input === undefined ? 'field required' : 'expected a map of named questions'),
      })
      .refine((questions) => Object.keys(questions).length > 0, 'expected at least 1 question'),
  },
  { error: 'request body must be a JSON object' },
);

export type SystemOneRequest = z.infer<typeof systemOneRequestSchema>;
export type Question = z.infer<typeof question>;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type ParseResult = { ok: true; value: SystemOneRequest } | { ok: false; message: string };

export function parseSystemOneRequest(body: unknown): ParseResult {
  const result = systemOneRequestSchema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  const messages = result.error.issues.map((issue) => {
    const where = issue.path.map(String).join('.');
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  return { ok: false, message: [...new Set(messages)].join('; ') };
}
