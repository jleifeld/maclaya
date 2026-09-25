import { EventEmitter } from 'node:events';
import type { ModelEvent } from '../runtime/worker';
import type { RequestSummary } from '../stats/store';

interface EventMap {
  request: [RequestSummary];
  model: [ModelEvent];
}

export class EventBus extends EventEmitter<EventMap> {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}
