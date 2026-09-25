export type SnippetLanguage = 'curl' | 'typescript' | 'python';

export interface SnippetOptions {
  baseUrl: string;
  body: unknown;
  authRequired: boolean;
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function indent(text: string, spaces: number): string {
  return text.replace(/\n/g, `\n${' '.repeat(spaces)}`);
}

function pythonLiteral(value: unknown, level = 0): string {
  const pad = '    '.repeat(level + 1);
  const end = '    '.repeat(level);
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((v) => `${pad}${pythonLiteral(v, level + 1)}`).join(',\n')},\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pythonLiteral(v, level + 1)}`).join(',\n')},\n${end}}`;
}

export function buildSnippet(language: SnippetLanguage, { baseUrl, body, authRequired }: SnippetOptions): string {
  const json = JSON.stringify(body, null, 2);
  if (language === 'curl') {
    return [
      `curl ${baseUrl}/v1/systemone \\`,
      `  -H 'Content-Type: application/json' \\`,
      ...(authRequired ? [`  -H "Authorization: Bearer $MACLAYA_API_KEY" \\`] : []),
      `  -d ${shellQuote(json)}`,
    ].join('\n');
  }
  if (language === 'typescript') {
    return [
      `import { TypeSafeClient } from '@typesafe-ai/sdk';`,
      ``,
      `const client = new TypeSafeClient({`,
      `  baseURL: '${baseUrl}',`,
      `  apiKey: ${authRequired ? 'process.env.MACLAYA_API_KEY' : `'local'`},`,
      `});`,
      ``,
      `const { answers } = await client.systemOne(${indent(json, 0)});`,
      ``,
      `console.log(answers);`,
    ].join('\n');
  }
  return [
    ...(authRequired ? [`import os`] : []),
    `import requests`,
    ``,
    `response = requests.post(`,
    `    "${baseUrl}/v1/systemone",`,
    ...(authRequired ? [`    headers={"Authorization": f"Bearer {os.environ['MACLAYA_API_KEY']}"},`] : []),
    `    json=${pythonLiteral(body, 1)},`,
    `)`,
    `response.raise_for_status()`,
    `print(response.json()["answers"])`,
  ].join('\n');
}
