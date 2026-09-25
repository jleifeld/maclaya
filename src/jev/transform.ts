import type { WorkerAnswer, WorkerPrediction, WorkerQuestion } from '../runtime/protocol';
import type { JsonValue, Question, SystemOneRequest } from './schema';

export function toWorkerState(state: JsonValue): JsonValue {
  return state === null ? '' : state;
}

/** laya-mlx needs string instructions and renders `null` criteria as the literal text "null". */
export function toWorkerQuestion(question: Question): WorkerQuestion {
  const instructions = question.instructions ?? '';
  switch (question.type) {
    case 'noul':
      return question.criteria
        ? { type: 'noul', instructions, criteria: question.criteria as JsonValue }
        : { type: 'noul', instructions };
    case 'choice': {
      const criteria = Array.isArray(question.criteria)
        ? Object.fromEntries(question.criteria.map((label) => [label, null]))
        : question.criteria;
      return { type: 'choice', instructions, criteria };
    }
    case 'score':
      return { type: 'score', instructions, criteria: question.criteria.map((level) => level ?? '') };
  }
}

export function toWorkerQuestions(questions: SystemOneRequest['questions']): Record<string, WorkerQuestion> {
  return Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, toWorkerQuestion(q)]));
}

export type JevAnswer =
  | { type: 'noul'; noul: number; confidence?: number; action?: WorkerAnswer['action'] }
  | {
      type: 'choice';
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
      action?: WorkerAnswer['action'];
    }
  | {
      type: 'score';
      score: number;
      confidence: number;
      probabilities: Record<string, number>;
      legend: Record<string, JsonValue>;
      action?: WorkerAnswer['action'];
    };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  maclaya?: { checkpoint: string; route_reason: string; inference_ms: number };
}

function toJevAnswer(question: Question, answer: WorkerAnswer, extras: boolean): JevAnswer {
  const extra = extras && answer.action ? { action: answer.action } : {};
  switch (question.type) {
    case 'noul':
      return { type: 'noul', noul: answer.noul ?? 0, ...(extras ? { confidence: answer.confidence } : {}), ...extra };
    case 'choice':
      return {
        type: 'choice',
        choice: answer.choice ?? '',
        confidence: answer.confidence,
        probabilities: answer.probabilities ?? {},
        ...extra,
      };
    case 'score':
      return {
        type: 'score',
        score: answer.score ?? 0,
        confidence: answer.confidence,
        probabilities: answer.probabilities ?? {},
        legend: Object.fromEntries(question.criteria.map((level, i) => [String(i), level as JsonValue])),
        ...extra,
      };
  }
}

export function toJevResponse(
  request: SystemOneRequest,
  prediction: WorkerPrediction,
  model: string,
  extras: boolean,
): JevResponse {
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const answer = prediction.answers[name];
    if (!answer) throw new Error(`Runtime returned no answer for question '${name}'`);
    answers[name] = toJevAnswer(question, answer, extras);
  }
  const response: JevResponse = {
    model,
    answers,
    usage: { input_tokens: prediction.usage.input_tokens, output_tokens: prediction.usage.output_tokens },
  };
  if (extras) {
    response.maclaya = {
      checkpoint: prediction.routing.model,
      route_reason: prediction.routing.reason,
      inference_ms: prediction.inference_ms,
    };
  }
  return response;
}
