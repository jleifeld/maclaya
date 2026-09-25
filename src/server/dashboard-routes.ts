import type { FastifyInstance } from 'fastify';
import { CHECKPOINTS, MODEL_CARDS, type Checkpoint } from '../jev/models';
import type { Engine, ModelEvent } from '../runtime/worker';
import type { RequestSummary, StatsStore } from '../stats/store';
import type { EventBus } from './events';
import { PRESET_STATES, QUICKSTART_PRESET, type Preset } from './presets';

export interface DashboardRoutesOptions {
  engine: Engine;
  stats: StatsStore;
  events: EventBus;
  version: string;
  startedAt: number;
  apiKeyRequired: boolean;
  logBodies: boolean;
}

export const RANGES: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

function parseBody(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function dashboardRoutes(app: FastifyInstance, options: DashboardRoutesOptions): Promise<void> {
  const { engine, stats, events } = options;

  app.get('/status', async (request) => {
    const states = engine.modelStates();
    return {
      version: options.version,
      started_at: options.startedAt,
      uptime_s: Math.round((Date.now() - options.startedAt) / 1000),
      base_url: `${request.protocol}://${request.host}`,
      auth_required: options.apiKeyRequired,
      log_bodies: options.logBodies,
      retention_days: Math.round(stats.retentionMs / 86_400_000),
      runtime: engine.info ?? null,
      checkpoints: CHECKPOINTS.map((checkpoint) => ({ checkpoint, state: states[checkpoint] })),
      models: MODEL_CARDS,
    };
  });

  app.get<{ Querystring: { range?: string } }>('/stats', async (request, reply) => {
    const range = request.query.range ?? '1h';
    const rangeMs = RANGES[range];
    if (!rangeMs) return reply.status(400).send({ message: `range must be one of ${Object.keys(RANGES).join(', ')}` });
    return { range, ...stats.stats(rangeMs) };
  });

  app.get<{ Querystring: { limit?: string; before?: string; status?: string; model?: string; source?: string } }>(
    '/requests',
    async (request) => {
      const { limit, before, status, model, source } = request.query;
      const items = stats.list({
        limit: limit ? Number(limit) : undefined,
        before: before ? Number(before) : undefined,
        status: status === 'ok' || status === 'error' ? status : undefined,
        model: model || undefined,
        source: source === 'api' || source === 'playground' ? source : undefined,
      });
      return { items, next_before: items.length ? items[items.length - 1]!.ts : null };
    },
  );

  app.get<{ Params: { id: string } }>('/requests/:id', async (request, reply) => {
    const record = stats.get(request.params.id);
    if (!record) return reply.status(404).send({ message: 'request not found' });
    return { ...record, request_body: parseBody(record.request_body), response_body: parseBody(record.response_body) };
  });

  app.delete('/requests', async (_request, reply) => {
    stats.clear();
    return reply.status(204).send();
  });

  app.get('/presets', async (request) => {
    const presets: Record<string, Preset> = { quickstart: QUICKSTART_PRESET };
    try {
      const runtimePresets = await engine.presets();
      for (const [name, questions] of Object.entries(runtimePresets)) {
        const meta = PRESET_STATES[name] ?? { title: name, description: '', state: '' };
        presets[name] = { ...meta, questions };
      }
    } catch (error) {
      request.log.warn({ err: error }, 'runtime presets unavailable');
    }
    return presets;
  });

  app.post<{ Params: { checkpoint: string } }>('/checkpoints/:checkpoint/load', async (request, reply) => {
    const checkpoint = request.params.checkpoint as Checkpoint;
    if (!CHECKPOINTS.includes(checkpoint)) return reply.status(404).send({ message: 'unknown checkpoint' });
    engine.load([checkpoint]).catch((error: Error) => request.log.error({ err: error }, 'checkpoint load failed'));
    return reply.status(202).send({ checkpoint, state: 'loading' });
  });

  app.get('/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onRequest = (summary: RequestSummary) => send('request', summary);
    const onModel = (event: ModelEvent) => send('model', event);
    events.on('request', onRequest);
    events.on('model', onModel);
    send('hello', { version: options.version });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      events.off('request', onRequest);
      events.off('model', onModel);
    });
  });
}
