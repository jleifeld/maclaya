import type { Json, QuestionType } from '../api';

export interface DraftOption {
  label: string;
  description: string;
}

export interface DraftQuestion {
  name: string;
  type: QuestionType;
  instructions: string;
  options: DraftOption[];
  levels: string[];
  whenTrue: string;
  whenFalse: string;
}

export interface Draft {
  model: string;
  stateMode: 'text' | 'json';
  state: string;
  questions: DraftQuestion[];
}

export interface BuildResult {
  body: Record<string, Json>;
  errors: string[];
}

/** Structured values are edited as compact JSON text; plain strings stay as typed. */
export function toText(value: Json | undefined): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function fromText(text: string): Json {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as Json;
    } catch {
      return text;
    }
  }
  return text;
}

export function blankQuestion(type: QuestionType, name = ''): DraftQuestion {
  return {
    name,
    type,
    instructions: '',
    options: type === 'choice' ? [{ label: '', description: '' }, { label: '', description: '' }] : [],
    levels: type === 'score' ? ['', ''] : [],
    whenTrue: '',
    whenFalse: '',
  };
}

function isRecord(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function questionFromJson(name: string, raw: Json): DraftQuestion {
  const q = isRecord(raw) ? raw : {};
  const type: QuestionType = q.type === 'choice' || q.type === 'score' ? q.type : 'noul';
  const draft = blankQuestion(type, name);
  draft.instructions = toText(q.instructions);
  if (type === 'choice') {
    const criteria = q.criteria;
    if (Array.isArray(criteria)) draft.options = criteria.map((label) => ({ label: toText(label), description: '' }));
    else if (isRecord(criteria)) draft.options = Object.entries(criteria).map(([label, d]) => ({ label, description: toText(d) }));
  } else if (type === 'score') {
    if (Array.isArray(q.criteria)) draft.levels = q.criteria.map((level) => toText(level));
  } else if (isRecord(q.criteria)) {
    draft.whenTrue = toText(q.criteria.true);
    draft.whenFalse = toText(q.criteria.false);
  }
  return draft;
}

export function draftFromBody(body: unknown): Draft {
  const b = isRecord(body) ? body : {};
  const state = b.state;
  const questions = isRecord(b.questions) ? b.questions : {};
  return {
    model: typeof b.model === 'string' ? b.model : 'jev-latest',
    stateMode: state === undefined || state === null || typeof state === 'string' ? 'text' : 'json',
    state: state === undefined || state === null ? '' : typeof state === 'string' ? state : JSON.stringify(state, null, 2),
    questions: Object.entries(questions).map(([name, q]) => questionFromJson(name, q)),
  };
}

export function questionToJson(q: DraftQuestion): Record<string, Json> {
  const out: Record<string, Json> = { type: q.type };
  const instructions = fromText(q.instructions);
  if (instructions !== null) out.instructions = instructions;
  if (q.type === 'choice') {
    out.criteria = Object.fromEntries(q.options.filter((o) => o.label.trim()).map((o) => [o.label.trim(), fromText(o.description)]));
  } else if (q.type === 'score') {
    out.criteria = q.levels.map((level) => fromText(level));
  } else {
    const criteria: Record<string, Json> = {};
    if (q.whenTrue.trim()) criteria.true = fromText(q.whenTrue);
    if (q.whenFalse.trim()) criteria.false = fromText(q.whenFalse);
    if (Object.keys(criteria).length) out.criteria = criteria;
  }
  return out;
}

export function bodyFromDraft(draft: Draft): BuildResult {
  const errors: string[] = [];
  let state: Json = draft.state;
  if (draft.stateMode === 'json') {
    try {
      state = draft.state.trim() ? (JSON.parse(draft.state) as Json) : null;
    } catch (error) {
      errors.push(`State is not valid JSON: ${(error as Error).message}`);
    }
  }
  const questions: Record<string, Json> = {};
  draft.questions.forEach((q, i) => {
    const name = q.name.trim();
    if (!name) errors.push(`Question ${i + 1} needs a name`);
    else if (name in questions) errors.push(`Question name "${name}" is used twice`);
    else questions[name] = questionToJson(q);
  });
  if (!draft.questions.length) errors.push('Add at least one question');
  return { body: { model: draft.model, state, questions }, errors };
}
