import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type RequestSummary } from './api';

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 30_000 });
}

export type LiveState = 'connecting' | 'live' | 'offline';

/** Subscribes to server events and invalidates the queries they affect. */
export function useLiveEvents(onRequest?: (summary: RequestSummary) => void): LiveState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    const source = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
        void queryClient.invalidateQueries({ queryKey: ['requests'] });
      }, 400);
    };
    source.addEventListener('open', () => setState('live'));
    source.addEventListener('error', () => setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting'));
    source.addEventListener('request', (event) => {
      refreshSoon();
      onRequest?.(JSON.parse((event as MessageEvent).data));
    });
    source.addEventListener('model', () => void queryClient.invalidateQueries({ queryKey: ['status'] }));
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [queryClient, onRequest]);

  return state;
}

export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`maclaya:${key}`);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(`maclaya:${key}`, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode); the value still lives for this session
    }
  };
  return [value, update];
}
