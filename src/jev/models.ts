export type Checkpoint = 'english' | 'multilingual' | 'typed-decisions';

export const CHECKPOINTS: readonly Checkpoint[] = ['english', 'multilingual', 'typed-decisions'];

export interface ModelCard {
  name: string;
  description: string;
  release_date: string;
}

export const AUTO_MODEL = 'jev-latest';

export const MODEL_CARDS: readonly ModelCard[] = [
  {
    name: AUTO_MODEL,
    description:
      'Auto-routed Laya: each request goes to the English or multilingual checkpoint based on the language of its state.',
    release_date: '2026-09-18',
  },
  {
    name: 'laya/english',
    description: 'Laya 421M (ModernBERT-large), English, 512-token context.',
    release_date: '2026-09-18',
  },
  {
    name: 'laya/multilingual',
    description: 'Laya 322M (mmBERT-base), 100+ languages, 1024-token context.',
    release_date: '2026-09-19',
  },
  {
    name: 'laya/typed-decisions',
    description:
      'Laya 421M fine-tuned on the typed-decisions workflows (customer service, invoices, security incidents, agent traces).',
    release_date: '2026-09-18',
  },
];

const AUTO_ALIASES = new Set([AUTO_MODEL, 'jev', 'typesafe-ai/jev', 'typesafe/jev', '@cf/typesafe/jev', 'laya', 'auto']);

const PINNED_ALIASES: Record<string, Checkpoint> = {
  'laya/english': 'english',
  'laya-english': 'english',
  english: 'english',
  'laya/multilingual': 'multilingual',
  'laya-multilingual': 'multilingual',
  multilingual: 'multilingual',
  'laya/typed-decisions': 'typed-decisions',
  'laya-typed-decisions': 'typed-decisions',
  'typed-decisions': 'typed-decisions',
};

/** `null` means the worker's language router chooses the checkpoint. */
export function resolveModel(model: string | undefined): Checkpoint | null | undefined {
  if (model === undefined) return null;
  const key = model.trim().toLowerCase();
  if (AUTO_ALIASES.has(key) || /^jev-[\w.-]+$/.test(key)) return null;
  return PINNED_ALIASES[key];
}

export function checkpointModelName(checkpoint: Checkpoint): string {
  return `laya/${checkpoint}`;
}
