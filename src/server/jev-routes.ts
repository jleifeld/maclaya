import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { JevError } from '../jev/errors';
import { checkpointModelName, MODEL_CARDS, type Checkpoint } from '../jev/models';
import type { SystemOneRequest } from '../jev/schema';
import { runSystemOne } from '../jev/system-one';
import type { WorkerPrediction } from '../runtime/protocol';
import { EngineError, type Engine } from '../runtime/worker';
import type { RequestRecord, StatsStore } from '../stats/store';
import type { EventBus } from './events';

export interface JevRoutesOptions {
  engine: Engine;
  stats: StatsStore;
  events: EventBus;
  apiKey?: string;
  logBodies: boolean;
}

interface CallContext {
  requestId: string;
  started: number;
  parsed?: SystemOneRequest;
  prediction?: WorkerPrediction;
  error?: JevError;
  payload?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    jev?: CallContext;
  }
}

function keyMatches(expected: string, header: string | undefined): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1].trim());
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function truthy(value: string | string[] | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== undefined && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function clientName(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  if (/^Mozilla\//.test(userAgent)) return 'browser';
  return userAgent.split(/\s+/)[0]?.slice(0, 64) ?? null;
}

function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 256);
}

function toJevError(error: unknown): JevError {
  if (error instanceof JevError) return error;
  if (error instanceof EngineError) {
    if (error.kind === 'invalid_request') return JevError.invalid(error.message);
    if (error.kind === 'unavailable') return new JevError(503, 'overloaded', error.message);
    return new JevError(500, 'internal_error', error.message);
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    const message = fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || fastifyError.name === 'SyntaxError'
      ? `request body is not valid JSON: ${fastifyError.message}`
      : fastifyError.message;
    return new JevError(fastifyError.statusCode, 'invalid_request', message);
  }
  return new JevError(500, 'internal_error', (error as Error)?.message ?? 'internal error');
}

function countTypes(parsed: SystemOneRequest | undefined) {
  const counts = { n_noul: 0, n_choice: 0, n_score: 0 };
  for (const q of Object.values(parsed?.questions ?? {})) counts[`n_${q.type}`] += 1;
  return counts;
}

export async function jevRoutes(app: FastifyInstance, options: JevRoutesOptions): Promise<void> {
  const { engine, stats, events, apiKey, logBodies } = options;

  app.addHook('onRequest', async (request) => {
    request.jev = { requestId: `req_${randomUUID().replace(/-/g, '')}`, started: performance.now() };
    if (apiKey && !keyMatches(apiKey, request.headers.authorization)) {
      throw new JevError(401, 'authentication_error', 'Invalid or missing API key. Send it as `Authorization: Bearer <key>`.');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.jev) {
      reply.header('x-typesafe-request-id', request.jev.requestId);
      if (typeof payload === 'string') request.jev.payload = payload;
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const jevError = toJevError(error);
    if (request.jev) request.jev.error = jevError;
    if (jevError.status >= 500) request.log.error({ err: error }, 'systemone request failed');
    reply.status(jevError.status).send(jevError.toBody());
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(new JevError(404, 'not_found', `No route for ${request.method} ${request.url}`).toBody());
  });

  app.get('/models', async () => ({ models: MODEL_CARDS }));

  app.post(
    '/systemone',
    {
      onResponse: async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = request.jev;
        if (!ctx) return;
        const record: RequestRecord = {
          id: ctx.requestId,
          ts: Date.now(),
          status: reply.statusCode,
          error_type: ctx.error?.errorType ?? null,
          error_message: ctx.error?.message ?? null,
          model_requested: ctx.parsed?.model ?? null,
          model: ctx.prediction ? checkpointModelName(ctx.prediction.routing.model as Checkpoint) : null,
          route_reason: ctx.prediction?.routing.reason ?? null,
          latency_ms: Math.round((performance.now() - ctx.started) * 1000) / 1000,
          inference_ms: ctx.prediction?.inference_ms ?? null,
          input_tokens: ctx.prediction?.usage.input_tokens ?? 0,
          ...countTypes(ctx.parsed),
          client: clientName(request.headers['user-agent']),
          source: request.headers['x-maclaya-source'] === 'playground' ? 'playground' : 'api',
          request_body: logBodies && request.body !== undefined ? JSON.stringify(request.body) : null,
          response_body: logBodies ? (ctx.payload ?? null) : null,
        };
        try {
          stats.insert(record);
        } catch (error) {
          request.log.error({ err: error }, 'could not record request');
        }
        const { request_body: _req, response_body: _res, ...summary } = record;
        events.emit('request', summary);
      },
    },
    async (request, reply) => {
      const ctx = request.jev!;
      const result = await runSystemOne(engine, request.body, {
        extras: truthy(request.headers['x-maclaya-extras']),
        onParsed: (parsed) => {
          ctx.parsed = parsed;
        },
      });
      ctx.prediction = result.prediction;
      reply.header('x-laya-model', result.checkpoint);
      reply.header('x-laya-route-reason', headerSafe(result.prediction.routing.reason));
      return result.response;
    },
  );
}
