/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import type * as ThemeModule from '../../web/src/theme';

let systemDark = false;
const mediaListeners = new Set<() => void>();

function mockSystemTheme() {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') && systemDark;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
}

function setSystemDark(value: boolean) {
  systemDark = value;
  mediaListeners.forEach((listener) => listener());
}

/** A fresh module, as on a new page load; React is required from the same registry. */
function loadTheme(): typeof ThemeModule {
  jest.resetModules();
  return require('../../web/src/theme');
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  systemDark = false;
  mediaListeners.clear();
  mockSystemTheme();
});

describe('theme switch', () => {
  it('parses stored preferences and falls back to system', async () => {
    const { parsePreference, resolveTheme } = loadTheme();
    expect(parsePreference('"dark"')).toBe('dark');
    expect(parsePreference('"light"')).toBe('light');
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('"purple"')).toBe('system');
    expect(parsePreference('{broken')).toBe('system');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('persists an explicit choice and applies it to <html>', async () => {
    const theme = loadTheme();
    theme.setThemePreference('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(theme.THEME_STORAGE_KEY)).toBe('"dark"');

    theme.setThemePreference('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(theme.THEME_STORAGE_KEY)).toBeNull();
  });

  it('restores the saved choice on the next page load', async () => {
    localStorage.setItem('maclaya:theme', '"light"');
    const theme = loadTheme();
    expect(theme.getThemePreference()).toBe('light');
  });

  it('re-renders components when the choice or the system appearance changes', async () => {
    const theme = loadTheme();
    // Same module registry as the theme module, so both see one React instance.
    const { act, createElement } = require('react') as typeof import('react');
    const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
    const seen: string[] = [];
    function Probe() {
      const resolved = theme.useResolvedTheme();
      const preference = theme.useThemePreference();
      seen.push(`${preference}:${resolved}`);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe('system:light');

    await act(async () => setSystemDark(true));
    expect(seen.at(-1)).toBe('system:dark');

    await act(async () => theme.setThemePreference('light'));
    expect(seen.at(-1)).toBe('light:light');

    await act(async () => setSystemDark(false));
    await act(async () => theme.setThemePreference('dark'));
    expect(seen.at(-1)).toBe('dark:dark');
    await act(async () => root.unmount());
  });

  it('applies the saved theme before the app loads via the inline script in index.html', async () => {
    const { readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');
    const html = readFileSync(require.resolve('../../web/index.html'), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    localStorage.setItem('maclaya:theme', '"dark"');
    new Function(script!)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
