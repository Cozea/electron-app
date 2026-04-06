const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Fix useParams<...>()
  if (content.match(/useParams<[^>]+>\(\)/)) {
    content = content.replace(/useParams<[^>]+>\(\)/g, 'useParams({ strict: false }) as any');
    changed = true;
  }
  
  // Fix useParams() that was missed
  if (content.includes('useParams()')) {
    content = content.replace(/useParams\(\)/g, 'useParams({ strict: false }) as any');
    changed = true;
  }

  // Fix [searchParams, setSearchParams] = useSearch({ strict: false })
  // TanStack router useSearch returns an object. 
  // Let's replace the import of useSearch if it's actually meant to be useSearchParams
  if (content.includes('const [searchParams, setSearchParams] = useSearch')) {
    content = content.replace(/import \{.*?useSearch.*?\} from ['"]@tanstack\/react-router['"]/g, match => {
      return match + `\nimport { useSearchParamsPolyfill } from '@/lib/useSearchParamsPolyfill'`;
    });
    content = content.replace(/useSearch\(\{ strict: false \}\)/g, 'useSearchParamsPolyfill()');
    changed = true;
  }

  // Fix tooltip delayDuration error in sidebar.tsx
  if (file.includes('sidebar.tsx') && content.includes('delayDuration')) {
    content = content.replace(/delayDuration=\{.*?\}/g, '');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}

// Create useSearchParams polyfill
const polyfill = `import { useSearch, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

export function useSearchParamsPolyfill() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();

  const setSearchParams = useCallback((updater: any) => {
    navigate({
      search: (old: any) => {
        const next = typeof updater === 'function' ? updater(old) : updater;
        return { ...old, ...next };
      },
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
`;

fs.writeFileSync('src/lib/useSearchParamsPolyfill.ts', polyfill);
console.log('Fixed TS errors step 1');
