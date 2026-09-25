import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'maclaya:theme';

export function parsePreference(raw: string | null): ThemePreference {
  try {
    const value = raw === null ? null : JSON.parse(raw);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

const listeners = new Set<() => void>();
const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : undefined);

function readStored(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readStored();

/** `system` leaves the attribute off so the CSS media query decides. */
export function applyTheme(value: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', value);
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(value: ThemePreference): void {
  preference = value;
  try {
    if (value === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); the choice still applies for this session
  }
  applyTheme(value);
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  const query = systemQuery();
  query?.addEventListener('change', notify);
  return () => {
    listeners.delete(notify);
    query?.removeEventListener('change', notify);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference);
}

/** The theme actually on screen, for components that pick colours in JavaScript (e.g. CodeMirror). */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => resolveTheme(preference, systemQuery()?.matches ?? false));
}
