import { execFileSync } from 'node:child_process';
import { formatBucketLabel, formatCount, formatMs, formatProbability, formatRelative, formatUptime } from '../../web/src/lib/format';
import { buildSnippet } from '../../web/src/lib/snippets';

const body = { model: 'jev-latest', state: "I'm charged twice", questions: { refund: { type: 'noul', instructions: 'Refund?', criteria: null } } };

describe('code snippets', () => {
  it('builds a curl command whose JSON survives shell quoting', () => {
    const snippet = buildSnippet('curl', { baseUrl: 'http://127.0.0.1:4545', body, authRequired: false });
    expect(snippet).toContain('curl http://127.0.0.1:4545/v1/systemone');
    expect(snippet).not.toContain('Authorization');
    const payload = snippet.slice(snippet.indexOf('-d ') + 3);
    const echoed = execFileSync('/bin/sh', ['-c', `printf %s ${payload}`]).toString();
    expect(JSON.parse(echoed)).toEqual(body);
  });

  it('adds the API key header only when the server requires one', () => {
    expect(buildSnippet('curl', { baseUrl: 'http://x', body, authRequired: true })).toContain('Authorization: Bearer $MACLAYA_API_KEY');
    expect(buildSnippet('typescript', { baseUrl: 'http://x', body, authRequired: true })).toContain('apiKey: process.env.MACLAYA_API_KEY');
    expect(buildSnippet('python', { baseUrl: 'http://x', body, authRequired: false })).not.toContain('import os');
  });

  it('uses the official SDK for TypeScript', () => {
    const snippet = buildSnippet('typescript', { baseUrl: 'http://127.0.0.1:4545', body, authRequired: false });
    expect(snippet).toContain("import { TypeSafeClient } from '@typesafe-ai/sdk';");
    expect(snippet).toContain("baseURL: 'http://127.0.0.1:4545'");
    expect(snippet).toContain("apiKey: 'local'");
  });

  it('writes Python literals for JSON values', () => {
    const snippet = buildSnippet('python', { baseUrl: 'http://x', body: { a: null, b: true, c: [false, 1], d: {} }, authRequired: false });
    expect(snippet).toContain('"a": None');
    expect(snippet).toContain('"b": True');
    expect(snippet).toMatch(/"c": \[\n\s+False,\n\s+1,/);
    expect(snippet).toContain('"d": {}');
  });
});

describe('formatters', () => {
  it.each([
    [0, '0 ms'],
    [12.345, '12.3 ms'],
    [345.6, '346 ms'],
    [1234, '1.23 s'],
    [12_345, '12.3 s'],
    [null, '—'],
  ])('formats %p ms as %p', (value, text) => {
    expect(formatMs(value)).toBe(text);
  });

  it('formats counts, probabilities, relative times and uptime', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(12_900)).toBe('12.9K');
    expect(formatProbability(0.8355)).toBe('0.84');
    expect(formatProbability(0.9991)).toBe('0.999');
    expect(formatRelative(1_000_000, 1_000_000 + 2_000)).toBe('just now');
    expect(formatRelative(0, 90_000)).toBe('2m ago');
    expect(formatRelative(0, 3 * 86_400_000)).toBe('3d ago');
    expect(formatUptime(3725)).toBe('1h 2m');
    expect(formatUptime(90_000)).toBe('1d 1h');
    expect(formatBucketLabel(0, 15_000)).toMatch(/\d{2}.\d{2}.\d{2}/);
  });
});
