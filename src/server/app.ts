import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Engine, ModelEvent } from '../runtime/worker';
import type { StatsStore } from '../stats/store';
import { dashboardRoutes } from './dashboard-routes';
import { EventBus } from './events';
import { jevRoutes } from './jev-routes';

export interface ServerOptions {
  engine: Engine;
  stats: StatsStore;
  version: string;
  apiKey?: string;
  logBodies?: boolean;
  /** Directory with the built WebUI; `undefined` disables the UI. */
  webRoot?: string;
  /** Serve the dashboard and its API to non-loopback clients too. */
  exposeDashboard?: boolean;
  logger?: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(request: FastifyRequest): boolean {
  return LOOPBACK.has(request.socket.remoteAddress ?? '');
}

const UI_MISSING = `<!doctype html><title>maclaya</title>
<body style="font-family:system-ui;padding:2rem">
<h1>maclaya</h1><p>The Jev API is running at <code>/v1/systemone</code>, but the dashboard has not been built.</p>
<p>Run <code>npm run build:web</code> and restart.</p></body>`;

export interface MaclayaServer {
  app: FastifyInstance;
  events: EventBus;
}

export async function buildServer(options: ServerOptions): Promise<MaclayaServer> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 4 * 1024 * 1024 });
  const events = new EventBus();
  const logBodies = options.logBodies ?? true;
  const forwardModelEvent = (event: ModelEvent) => events.emit('model', event);
  options.engine.on('model', forwardModelEvent);
  app.addHook('onClose', async () => {
    options.engine.off('model', forwardModelEvent);
  });

  await app.register(async (v1) => {
    await v1.register(cors, { origin: true, exposedHeaders: ['x-typesafe-request-id', 'x-laya-model', 'x-laya-route-reason'] });
    await jevRoutes(v1, { engine: options.engine, stats: options.stats, events, apiKey: options.apiKey, logBodies });
  }, { prefix: '/v1' });

  const guardDashboard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.exposeDashboard && !isLoopback(request)) {
      return reply.status(403).send({ message: 'The maclaya dashboard is only available from this Mac. Start with --expose-dashboard to allow remote access.' });
    }
  };

  await app.register(async (api) => {
    api.addHook('onRequest', guardDashboard);
    api.setNotFoundHandler((request, reply) => reply.status(404).send({ message: `No route for ${request.method} ${request.url}` }));
    await dashboardRoutes(api, {
      engine: options.engine,
      stats: options.stats,
      events,
      version: options.version,
      startedAt: Date.now(),
      apiKeyRequired: Boolean(options.apiKey),
      logBodies,
    });
  }, { prefix: '/api' });

  const webRoot = options.webRoot;
  const hasUi = Boolean(webRoot && existsSync(path.join(webRoot, 'index.html')));
  await app.register(async (ui) => {
    ui.addHook('onRequest', guardDashboard);
    if (hasUi) {
      await ui.register(fastifyStatic, { root: webRoot!, wildcard: false, index: ['index.html'] });
    }
    ui.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET') return reply.status(404).send({ message: 'not found' });
      if (!hasUi) return reply.type('text/html').send(UI_MISSING);
      return reply.sendFile('index.html');
    });
  });

  return { app, events };
}
