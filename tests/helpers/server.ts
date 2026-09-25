import type { AddressInfo } from 'node:net';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { buildServer, type ServerOptions } from '../../src/server/app';
import { StatsStore } from '../../src/stats/store';
import { FakeEngine } from './fake-engine';

export interface TestServer {
  baseURL: string;
  engine: FakeEngine;
  stats: StatsStore;
  server: Awaited<ReturnType<typeof buildServer>>;
  client: (apiKey?: string) => TypeSafeClient;
  close: () => Promise<void>;
}

export async function startTestServer(options: Partial<ServerOptions> = {}): Promise<TestServer> {
  const engine = (options.engine as FakeEngine | undefined) ?? new FakeEngine();
  const stats = options.stats ?? new StatsStore({ file: ':memory:' });
  const server = await buildServer({ version: '0.0.0-test', ...options, engine, stats });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.app.server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${port}`;
  return {
    baseURL,
    engine,
    stats,
    server,
    client: (apiKey = 'local') => new TypeSafeClient({ apiKey, baseURL, retry: { maxRetries: 0 }, logLevel: 'off' }),
    close: async () => {
      await server.app.close();
      stats.close();
    },
  };
}

export async function postJson(baseURL: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
}
