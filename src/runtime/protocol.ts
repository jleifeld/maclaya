import type { JsonValue } from '../jev/schema';

export interface WorkerQuestion {
  type: 'noul' | 'choice' | 'score';
  instructions: JsonValue;
  criteria?: JsonValue;
}

export interface WorkerAnswer {
  type: 'noul' | 'choice' | 'score';
  confidence: number;
  action?: { act_probability: number };
  noul?: number;
  choice?: string;
  score?: number;
  legend?: Record<string, JsonValue>;
  probabilities?: Record<string, number>;
}

export interface WorkerPrediction {
  answers: Record<string, WorkerAnswer>;
  usage: { input_tokens: number; output_tokens: number };
  routing: { model: string; reason: string };
  inference_ms: number;
}

export interface WorkerInfo {
  laya_mlx: string | null;
  python: string;
  mlx?: string | null;
  device?: string;
  metal?: boolean;
  mlx_error?: string;
  checkpoints: Record<string, string>;
}

export type WorkerEvent =
  | { event: 'ready' }
  | { event: 'fatal'; message: string }
  | { event: 'model_loading'; model: string; repo: string }
  | { event: 'model_loaded'; model: string; seconds: number }
  | { event: 'model_failed'; model: string; message: string };

export interface WorkerErrorPayload {
  kind: 'invalid_request' | 'internal';
  message: string;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number | null; ok: false; error: WorkerErrorPayload };
