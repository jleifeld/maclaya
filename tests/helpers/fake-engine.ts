import { EventEmitter } from 'node:events';
import type { Checkpoint } from '../../src/jev/models';
import type { WorkerAnswer, WorkerInfo, WorkerPrediction, WorkerQuestion } from '../../src/runtime/protocol';
import type { Engine, ModelEvent, ModelState, PredictInput } from '../../src/runtime/worker';
import { EngineError } from '../../src/runtime/worker';

/** Mirrors laya-mlx's output shape, including the fields Jev does not have. */
export function fakeAnswer(question: WorkerQuestion): WorkerAnswer {
  if (question.type === 'choice') {
    const labels = Object.keys(question.criteria as Record<string, unknown>);
    const p = 1 / labels.length;
    return {
      type: 'choice',
      confidence: 0.61,
      action: { act_probability: 0.99 },
      choice: labels[0],
      probabilities: Object.fromEntries(labels.map((l) => [l, p])),
    };
  }
  if (question.type === 'score') {
    const levels = question.criteria as unknown[];
    return {
      type: 'score',
      confidence: 0.33,
      action: { act_probability: 0.98 },
      score: 1.25,
      legend: Object.fromEntries(levels.map((l, i) => [String(i), l as string])),
      probabilities: Object.fromEntries(levels.map((_, i) => [String(i), 1 / levels.length])),
    };
  }
  return { type: 'noul', confidence: 0.87, action: { act_probability: 0.97 }, noul: 0.87 };
}

export class FakeEngine extends EventEmitter implements Engine {
  info: WorkerInfo = { laya_mlx: '0.2.0', python: '3.12.0', mlx: '0.32.2', device: 'Device(gpu, 0)', metal: true, checkpoints: {}, pid: 4242 };
  calls: PredictInput[] = [];
  loads: Checkpoint[][] = [];
  failWith?: EngineError;
  presetsFail = false;
  states: Record<Checkpoint, ModelState> = { english: 'loaded', multilingual: 'idle', 'typed-decisions': 'idle' };

  modelStates() {
    return { ...this.states };
  }

  async predict(input: PredictInput): Promise<WorkerPrediction> {
    this.calls.push(input);
    if (this.failWith) throw this.failWith;
    const checkpoint = input.model ?? (typeof input.state === 'string' && /[äöüß]|Guten/.test(input.state) ? 'multilingual' : 'english');
    return {
      answers: Object.fromEntries(Object.entries(input.questions).map(([name, q]) => [name, fakeAnswer(q)])),
      usage: { input_tokens: 42, output_tokens: 0 },
      routing: { model: checkpoint, reason: input.model ? `explicit model='${input.model}'` : 'English Latin text' },
      inference_ms: 12.5,
    };
  }

  async load(models: Checkpoint[]): Promise<void> {
    this.loads.push(models);
    for (const model of models) {
      this.states[model] = 'loaded';
      this.emit('model', { model, state: 'loaded', seconds: 0.1 } satisfies ModelEvent);
    }
  }

  async presets(): Promise<Record<string, Record<string, WorkerQuestion>>> {
    if (this.presetsFail) throw new EngineError('unavailable', 'worker down');
    return { triage: { is_urgent: { type: 'noul', instructions: 'Is `message` urgent?' } } };
  }
}
