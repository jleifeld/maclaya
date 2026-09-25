import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { api, runSystemOne, type JevErrorBody, type Json, type QuestionType, type RunResult, type SystemOneResponse } from '../api';
import { AnswerView } from '../components/AnswerView';
import { JsonEditor } from '../components/JsonEditor';
import { Badge, Button, Card, CopyButton, EmptyState, Input, Label, Segmented, Select, Switch, Textarea, cx, statusTone } from '../components/ui';
import { useStatus, usePersistentState } from '../hooks';
import { formatMs } from '../lib/format';
import { blankQuestion, bodyFromDraft, draftFromBody, type BuildResult, type Draft, type DraftQuestion } from '../lib/request-model';
import { buildSnippet, type SnippetLanguage } from '../lib/snippets';

const DEFAULT_BODY: Record<string, Json> = {
  model: 'jev-latest',
  state: 'I was billed twice this month. Please refund the duplicate charge as soon as possible.',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which department should handle this email?',
      criteria: { billing: 'invoices, payments, refunds', technical: 'bugs, outages, system errors', sales: 'pricing, new contracts', other: 'everything else' },
    },
    urgency: { type: 'score', instructions: 'How urgent is this request?', criteria: ['not urgent', 'soon', 'critical deadline or blocking issue'] },
    refund: { type: 'noul', instructions: 'Does the customer ask for money back?' },
  },
};

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: 'noul', label: 'noul' },
  { value: 'choice', label: 'choice' },
  { value: 'score', label: 'score' },
];

const TYPE_HELP: Record<QuestionType, string> = {
  noul: 'Yes/no — returns the probability of yes.',
  choice: 'Pick one option — returns a distribution over the options.',
  score: 'Rate on an ordered rubric — returns the expected level.',
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function parseJsonText(text: string): BuildResult {
  try {
    const body = JSON.parse(text);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { body: {}, errors: ['The request must be a JSON object'] };
    return { body, errors: [] };
  } catch (error) {
    return { body: {}, errors: [`Invalid JSON: ${(error as Error).message}`] };
  }
}

function RowButtons({ onUp, onDown, onRemove, removeLabel }: { onUp?: () => void; onDown?: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex shrink-0">
      {onUp !== undefined && (
        <Button size="sm" variant="ghost" aria-label="Move up" onClick={onUp} className="px-1.5">
          <ArrowUp size={14} />
        </Button>
      )}
      {onDown !== undefined && (
        <Button size="sm" variant="ghost" aria-label="Move down" onClick={onDown} className="px-1.5">
          <ArrowDown size={14} />
        </Button>
      )}
      <Button size="sm" variant="ghost" aria-label={removeLabel} onClick={onRemove} className="px-1.5">
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function QuestionEditor({ question, index, count, onChange, onRemove, onMove }: { question: DraftQuestion; index: number; count: number; onChange: (q: DraftQuestion) => void; onRemove: () => void; onMove: (to: number) => void }) {
  const set = (patch: Partial<DraftQuestion>) => onChange({ ...question, ...patch });
  const changeType = (type: QuestionType) => {
    const fresh = blankQuestion(type, question.name);
    onChange({ ...fresh, instructions: question.instructions, options: question.options.length ? question.options : fresh.options, levels: question.levels.length ? question.levels : fresh.levels });
  };

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label={`Question ${index + 1} name`} value={question.name} placeholder="question_name" onChange={(e) => set({ name: e.target.value })} className="h-8 max-w-52 font-mono text-xs" />
        <Segmented size="sm" label="Question type" value={question.type} options={TYPE_OPTIONS} onChange={changeType} />
        <div className="ml-auto">
          <RowButtons
            removeLabel="Remove question"
            onUp={index > 0 ? () => onMove(index - 1) : undefined}
            onDown={index < count - 1 ? () => onMove(index + 1) : undefined}
            onRemove={onRemove}
          />
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted">{TYPE_HELP[question.type]}</p>

      <label className="mt-3 block">
        <Label hint="text, or JSON for structured instructions">Instructions</Label>
        <Textarea rows={2} value={question.instructions} placeholder="Does the customer ask for money back?" onChange={(e) => set({ instructions: e.target.value })} />
      </label>

      {question.type === 'choice' && (
        <fieldset className="mt-3">
          <Label hint={`${question.options.length} / 255`}>Options</Label>
          <div className="space-y-1.5">
            {question.options.map((option, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5">
                <Input aria-label={`Option ${i + 1} label`} placeholder="label" value={option.label} className="h-8 font-mono text-xs" onChange={(e) => set({ options: question.options.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)) })} />
                <Input aria-label={`Option ${i + 1} description`} placeholder="description (optional)" value={option.description} className="h-8 text-xs" onChange={(e) => set({ options: question.options.map((o, j) => (j === i ? { ...o, description: e.target.value } : o)) })} />
                <RowButtons removeLabel="Remove option" onRemove={() => set({ options: question.options.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => set({ options: [...question.options, { label: '', description: '' }] })} disabled={question.options.length >= 255}>
            <Plus size={14} /> Add option
          </Button>
        </fieldset>
      )}

      {question.type === 'score' && (
        <fieldset className="mt-3">
          <Label hint={`${question.levels.length} levels · 2–10, low to high`}>Rubric levels</Label>
          <div className="space-y-1.5">
            {question.levels.map((level, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="tabular w-6 shrink-0 text-center text-xs text-muted">{i}</span>
                <Input aria-label={`Level ${i}`} placeholder={i === 0 ? 'lowest level' : 'description'} value={level} className="h-8 text-xs" onChange={(e) => set({ levels: question.levels.map((l, j) => (j === i ? e.target.value : l)) })} />
                <RowButtons
                  removeLabel="Remove level"
                  onUp={i > 0 ? () => set({ levels: move(question.levels, i, i - 1) }) : undefined}
                  onDown={i < question.levels.length - 1 ? () => set({ levels: move(question.levels, i, i + 1) }) : undefined}
                  onRemove={() => set({ levels: question.levels.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => set({ levels: [...question.levels, ''] })} disabled={question.levels.length >= 10}>
            <Plus size={14} /> Add level
          </Button>
        </fieldset>
      )}

      {question.type === 'noul' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label>
            <Label hint="optional">Yes means</Label>
            <Input value={question.whenTrue} placeholder="yes, the statement holds" className="h-8 text-xs" onChange={(e) => set({ whenTrue: e.target.value })} />
          </label>
          <label>
            <Label hint="optional">No means</Label>
            <Input value={question.whenFalse} placeholder="no, the statement does not hold" className="h-8 text-xs" onChange={(e) => set({ whenFalse: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

function Builder({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const update = (index: number, question: DraftQuestion) => onChange({ ...draft, questions: draft.questions.map((q, i) => (i === index ? question : q)) });
  const addQuestion = (type: QuestionType) => {
    const taken = new Set(draft.questions.map((q) => q.name));
    let n = draft.questions.length + 1;
    while (taken.has(`question_${n}`)) n += 1;
    onChange({ ...draft, questions: [...draft.questions, blankQuestion(type, `question_${n}`)] });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label>State</Label>
          <Segmented
            size="sm"
            label="State format"
            value={draft.stateMode}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
            ]}
            onChange={(stateMode) => onChange({ ...draft, stateMode })}
          />
        </div>
        {draft.stateMode === 'text' ? (
          <Textarea rows={4} aria-label="State" value={draft.state} placeholder="The text Laya should decide about" onChange={(e) => onChange({ ...draft, state: e.target.value })} />
        ) : (
          <JsonEditor label="State JSON" value={draft.state} onChange={(state) => onChange({ ...draft, state })} minHeight="96px" />
        )}
      </div>

      <div className="space-y-3">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={index}
            question={question}
            index={index}
            count={draft.questions.length}
            onChange={(q) => update(index, q)}
            onRemove={() => onChange({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}
            onMove={(to) => onChange({ ...draft, questions: move(draft.questions, index, to) })}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Add question</span>
        {TYPE_OPTIONS.map((t) => (
          <Button key={t.value} size="sm" onClick={() => addQuestion(t.value)}>
            <Plus size={14} /> {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ResultPanel({ result, pending, body, baseUrl, authRequired }: { result: RunResult | undefined; pending: boolean; body: unknown; baseUrl: string; authRequired: boolean }) {
  const [tab, setTab] = usePersistentState<'answers' | 'json' | 'code'>('playground-result-tab', 'answers');
  const [language, setLanguage] = usePersistentState<SnippetLanguage>('playground-language', 'curl');
  const snippet = useMemo(() => buildSnippet(language, { baseUrl, body, authRequired }), [language, baseUrl, body, authRequired]);
  useEffect(() => {
    if (result) setTab(tab === 'code' ? 'answers' : tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const response = result?.ok ? (result.body as SystemOneResponse) : undefined;
  const error = result && !result.ok ? (result.body as JevErrorBody | null) : undefined;

  return (
    <Card
      title="Result"
      actions={
        <Segmented
          size="sm"
          label="Result view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'answers', label: 'Answers' },
            { value: 'json', label: 'Response' },
            { value: 'code', label: 'Code' },
          ]}
        />
      }
    >
      {tab === 'code' ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Segmented
              size="sm"
              label="Language"
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'curl', label: 'curl' },
                { value: 'typescript', label: 'TypeScript' },
                { value: 'python', label: 'Python' },
              ]}
            />
            <CopyButton text={snippet} />
          </div>
          <pre className="max-h-[560px] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink">{snippet}</pre>
          {language === 'typescript' && <p className="mt-2 text-xs text-muted">npm install @typesafe-ai/sdk — the official Jev SDK works unchanged against maclaya.</p>}
        </div>
      ) : !result ? (
        <EmptyState title={pending ? 'Running…' : 'Nothing run yet'}>{!pending && 'Press Run (⌘↵) to send the request to the local model.'}</EmptyState>
      ) : (
        <div className={cx('space-y-3 transition-opacity', pending && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <Badge tone={statusTone(result.status)}>{result.status}</Badge>
            {response && <Badge tone="accent">{response.model}</Badge>}
            <span className="tabular">{formatMs(result.elapsedMs)} round trip</span>
            {response?.maclaya && <span className="tabular">· model {formatMs(response.maclaya.inference_ms)}</span>}
            {response && <span className="tabular">· {response.usage.input_tokens} tokens</span>}
          </div>
          {result.routeReason && <p className="text-xs text-muted">Routing: {result.routeReason}</p>}

          {tab === 'answers' && response && (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {Object.entries(response.answers).map(([name, answer]) => (
                <AnswerView key={name} name={name} answer={answer} />
              ))}
            </div>
          )}
          {tab === 'answers' && error && (
            <div className="rounded-lg bg-critical/10 px-3 py-2 text-sm">
              <p className="font-medium text-critical-ink">{error.error_type}</p>
              <p className="mt-0.5 text-ink">{error.message}</p>
            </div>
          )}
          {tab === 'json' && <JsonEditor label="Response" value={pretty(result.body)} readOnly maxHeight="560px" />}
          {result.requestId && <p className="font-mono text-xs text-muted">{result.requestId}</p>}
        </div>
      )}
    </Card>
  );
}

export function Playground() {
  const location = useLocation();
  const replay = (location.state as { body?: Json } | null)?.body;
  const { data: status } = useStatus();
  const presets = useQuery({ queryKey: ['presets'], queryFn: api.presets, staleTime: Infinity });
  const models = useQuery({ queryKey: ['models'], queryFn: api.models, staleTime: Infinity });
  const [stored, setStored] = usePersistentState<Json | null>('playground-body', null);
  const [apiKey, setApiKey] = usePersistentState('playground-api-key', '');
  const [extras, setExtras] = usePersistentState('playground-extras', false);

  const initial = replay ?? stored ?? DEFAULT_BODY;
  const [mode, setMode] = useState<'builder' | 'json'>('builder');
  const [draft, setDraft] = useState<Draft>(() => draftFromBody(initial));
  const [jsonText, setJsonText] = useState(() => pretty(initial));
  const [switchError, setSwitchError] = useState<string>();

  const current = mode === 'builder' ? bodyFromDraft(draft) : parseJsonText(jsonText);
  const currentKey = JSON.stringify(current.body);
  const valid = current.errors.length === 0;

  useEffect(() => {
    if (valid) setStored(JSON.parse(currentKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, valid]);

  const loadBody = (body: Json) => {
    setDraft(draftFromBody(body));
    setJsonText(pretty(body));
    setSwitchError(undefined);
  };

  const switchMode = (next: 'builder' | 'json') => {
    if (next === mode) return;
    if (next === 'json') {
      setJsonText(pretty(bodyFromDraft(draft).body));
    } else {
      const parsed = parseJsonText(jsonText);
      if (parsed.errors.length) {
        setSwitchError(`Fix the JSON before switching to the builder. ${parsed.errors[0]}`);
        return;
      }
      setDraft(draftFromBody(parsed.body));
    }
    setSwitchError(undefined);
    setMode(next);
  };

  const run = useMutation({ mutationFn: (body: unknown) => runSystemOne(body, { apiKey: apiKey || undefined, extras }) });
  const submit = useCallback(() => {
    if (valid && !run.isPending) run.mutate(JSON.parse(currentKey));
  }, [valid, run, currentKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  const model = typeof current.body.model === 'string' ? current.body.model : 'jev-latest';
  const setModel = (value: string) => (mode === 'builder' ? setDraft({ ...draft, model: value }) : valid && loadBody({ ...current.body, model: value }));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Playground</h1>
          <p className="text-sm text-muted">Build a Jev request, run it on the local model and copy the code.</p>
        </div>
        <Button variant="primary" onClick={submit} disabled={!valid || run.isPending}>
          <Play size={15} /> {run.isPending ? 'Running…' : 'Run'}
          <kbd className="ml-1 hidden rounded bg-white/20 px-1 text-[11px] sm:inline">⌘↵</kbd>
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="w-full sm:w-56">
          <Label>Preset</Label>
          <Select
            value=""
            onChange={(e) => {
              const preset = presets.data?.[e.target.value];
              if (preset) loadBody({ model, state: preset.state, questions: preset.questions });
            }}
          >
            <option value="">Load a preset…</option>
            {Object.entries(presets.data ?? {}).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full sm:w-56">
          <Label>Model</Label>
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {(models.data?.models ?? [{ name: 'jev-latest', description: '' }]).map((m) => (
              <option key={m.name} value={m.name} title={m.description}>
                {m.name === 'jev-latest' ? 'jev-latest (auto-routed)' : m.name}
              </option>
            ))}
          </Select>
        </label>
        {status?.auth_required && (
          <label className="w-full sm:w-56">
            <Label>API key</Label>
            <Input type="password" autoComplete="off" value={apiKey} placeholder="Bearer token" onChange={(e) => setApiKey(e.target.value)} />
          </label>
        )}
        <div className="pb-2">
          <Switch checked={extras} onChange={setExtras} label="Laya extras" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Request"
          actions={
            <Segmented
              size="sm"
              label="Editor"
              value={mode}
              onChange={switchMode}
              options={[
                { value: 'builder', label: 'Builder' },
                { value: 'json', label: 'JSON' },
              ]}
            />
          }
        >
          {switchError && <p className="mb-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical-ink">{switchError}</p>}
          {mode === 'builder' ? <Builder draft={draft} onChange={setDraft} /> : <JsonEditor label="Request JSON" value={jsonText} onChange={setJsonText} minHeight="420px" />}
          {!valid && (
            <ul className="mt-3 space-y-1 text-sm text-critical-ink">
              {current.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
        <div className="min-w-0">
          <ResultPanel result={run.data} pending={run.isPending} body={current.body} baseUrl={status?.base_url ?? window.location.origin} authRequired={Boolean(status?.auth_required)} />
          {run.isError && <p className="mt-2 text-sm text-critical-ink">Request failed: {(run.error as Error).message}</p>}
        </div>
      </div>
    </div>
  );
}
