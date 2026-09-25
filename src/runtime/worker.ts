import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { Checkpoint } from '../jev/models';
import { CHECKPOINTS } from '../jev/models';
import type { JsonValue } from '../jev/schema';
import type {
  WorkerErrorPayload,
  WorkerEvent,
  WorkerInfo,
  WorkerPrediction,
  WorkerQuestion,
  WorkerResponse,
} from './protocol';

export type ModelState = 'idle' | 'loading' | 'loaded' | 'failed';

export interface PredictInput {
  state: JsonValue;
  questions: Record<string, WorkerQuestion>;
  model: Checkpoint | null;
}

export interface ModelEvent {
  model: Checkpoint;
  state: ModelState;
  seconds?: number;
  message?: string;
}

/** What the HTTP layer needs from the runtime; the Python worker is the real implementation. */
export interface Engine {
  readonly info: WorkerInfo | undefined;
  modelStates(): Record<Checkpoint, ModelState>;
  predict(input: PredictInput): Promise<WorkerPrediction>;
  load(models: Checkpoint[]): Promise<void>;
  presets(): Promise<Record<string, Record<string, WorkerQuestion>>>;
  on(event: 'model', listener: (event: ModelEvent) => void): this;
  off(event: 'model', listener: (event: ModelEvent) => void): this;
}

export class EngineError extends Error {
  constructor(
    readonly kind: WorkerErrorPayload['kind'] | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface WorkerOptions {
  python: string;
  script: string;
  env?: NodeJS.ProcessEnv;
  onStderr?: (chunk: string) => void;
  /** Maximum automatic restarts after unexpected exits; the counter resets once a worker is ready. */
  maxRestarts?: number;
  startupTimeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class WorkerClient extends EventEmitter implements Engine {
  info: WorkerInfo | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private states = Object.fromEntries(CHECKPOINTS.map((c) => [c, 'idle'])) as Record<Checkpoint, ModelState>;
  private restarts = 0;
  private stopping = false;
  private stderrTail = '';

  constructor(private readonly options: WorkerOptions) {
    super();
  }

  start(): Promise<void> {
    this.stopping = false;
    this.ready ??= this.spawn();
    return this.ready;
  }

  private spawn(): Promise<void> {
    const child = spawn(this.options.python, ['-u', this.options.script], {
      env: { ...process.env, PYTHONUNBUFFERED: '1', TOKENIZERS_PARALLELISM: 'false', ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group: Ctrl+C in the terminal must reach only maclaya, which then stops the
      // worker itself. Otherwise the worker dies first and looks like a crash that needs a restart.
      detached: true,
    });
    this.child = child;
    this.stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
      this.options.onStderr?.(chunk);
    });

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let becameReady = false;
      const timer = setTimeout(() => {
        fail(new EngineError('unavailable', 'The inference worker did not start in time'));
        child.kill();
      }, this.options.startupTimeoutMs ?? 120_000);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = undefined;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        becameReady = true;
        this.restarts = 0;
        resolve();
      };

      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        let message: WorkerResponse | WorkerEvent;
        try {
          message = JSON.parse(line);
        } catch {
          this.options.onStderr?.(`[worker stdout] ${line}\n`);
          return;
        }
        if ('event' in message) {
          if (message.event === 'ready') {
            this.call<WorkerInfo>('hello').then((info) => {
              this.info = info;
              succeed();
            }, fail);
          } else if (message.event === 'fatal') {
            fail(new EngineError('unavailable', `The inference worker failed to start: ${message.message}`));
          } else {
            this.handleModelEvent(message);
          }
          return;
        }
        this.settle(message);
      });

      child.on('error', (error) => {
        if (this.child === child && child.pid === undefined) this.child = undefined;
        fail(new EngineError('unavailable', `Could not start Python: ${error.message}`));
      });
      child.on('exit', (code, signal) => {
        this.child = undefined;
        this.ready = undefined;
        const reason = `The inference worker exited (${signal ?? `code ${code}`})`;
        fail(new EngineError('unavailable', `${reason}\n${this.stderrTail.trim()}`));
        for (const [id, pending] of this.pending) {
          pending.reject(new EngineError('unavailable', reason));
          this.pending.delete(id);
        }
        for (const checkpoint of CHECKPOINTS) this.setState(checkpoint, 'idle');
        if (!this.stopping && becameReady && this.restarts < (this.options.maxRestarts ?? 3)) {
          this.restarts += 1;
          this.emit('restart', { attempt: this.restarts, reason });
          this.start().catch((error: Error) => this.emit('restart_failed', error));
        }
      });
    });
  }

  private handleModelEvent(event: Exclude<WorkerEvent, { event: 'ready' | 'fatal' }>) {
    const model = event.model as Checkpoint;
    if (event.event === 'model_loading') this.setState(model, 'loading');
    if (event.event === 'model_loaded') this.setState(model, 'loaded', { seconds: event.seconds });
    if (event.event === 'model_failed') this.setState(model, 'failed', { message: event.message });
  }

  private setState(model: Checkpoint, state: ModelState, extra: Partial<ModelEvent> = {}) {
    if (this.states[model] === state && state === 'idle') return;
    this.states[model] = state;
    this.emit('model', { model, state, ...extra } satisfies ModelEvent);
  }

  private settle(message: WorkerResponse) {
    if (message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new EngineError(message.error.kind, message.error.message));
  }

  private call<T>(op: string, params?: unknown): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new EngineError('unavailable', 'The inference worker is not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      child.stdin.write(JSON.stringify({ id, op, params }) + '\n');
    });
  }

  private async request<T>(op: string, params?: unknown): Promise<T> {
    await this.start();
    return this.call<T>(op, params);
  }

  modelStates(): Record<Checkpoint, ModelState> {
    return { ...this.states };
  }

  predict(input: PredictInput): Promise<WorkerPrediction> {
    return this.request<WorkerPrediction>('predict', input);
  }

  async load(models: Checkpoint[]): Promise<void> {
    await this.request('load', { models });
  }

  presets(): Promise<Record<string, Record<string, WorkerQuestion>>> {
    return this.request('presets');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
