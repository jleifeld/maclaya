import type { WorkerPrediction } from '../runtime/protocol';
import type { Engine } from '../runtime/worker';
import { JevError } from './errors';
import { checkpointModelName, MODEL_CARDS, resolveModel, type Checkpoint } from './models';
import { parseSystemOneRequest, type SystemOneRequest } from './schema';
import { toJevResponse, toWorkerQuestions, toWorkerState, type JevResponse } from './transform';

export interface SystemOneResult {
  request: SystemOneRequest;
  prediction: WorkerPrediction;
  checkpoint: Checkpoint;
  response: JevResponse;
}

export interface SystemOneOptions {
  extras?: boolean;
  /** Called once the body passed validation, before inference runs. */
  onParsed?: (request: SystemOneRequest) => void;
}

/** Validate a Jev request body, run it on the engine and shape the answer like Jev does. */
export async function runSystemOne(engine: Engine, body: unknown, options: SystemOneOptions = {}): Promise<SystemOneResult> {
  const parsed = parseSystemOneRequest(body);
  if (!parsed.ok) throw JevError.invalid(parsed.message);
  const request = parsed.value;
  options.onParsed?.(request);

  const requestedModel = request.model ?? undefined;
  const target = resolveModel(requestedModel);
  if (target === undefined) {
    throw JevError.invalid(
      `model: unknown model '${requestedModel}'; available: ${MODEL_CARDS.map((m) => m.name).join(', ')}`,
    );
  }

  const prediction = await engine.predict({
    state: toWorkerState(request.state),
    questions: toWorkerQuestions(request.questions),
    model: target,
  });
  const checkpoint = prediction.routing.model as Checkpoint;
  return {
    request,
    prediction,
    checkpoint,
    response: toJevResponse(request, prediction, checkpointModelName(checkpoint), options.extras ?? false),
  };
}
