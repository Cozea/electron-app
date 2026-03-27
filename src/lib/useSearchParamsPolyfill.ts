import { useSearch, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

export function useSearchParamsPolyfill() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();

  const setSearchParams = useCallback((updater: any) => {
    navigate({
      search: ((old: any) => {
        const next = typeof updater === 'function' ? updater(old) : updater;
        return { ...old, ...next };
      }) as any,
      replace: true
    });
  }, [navigate]);

  const get = (key: string) => search[key as keyof typeof search] as string | undefined;
  
  const searchParams = {
    get,
    entries: () => Object.entries(search),
  };

  return [searchParams, setSearchParams] as const;
}
