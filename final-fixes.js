const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/features/projects/components/assistant/**/*.{ts,tsx}');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix toSorted
  content = content.replace(/\.toSorted\(/g, '.sort(');
  
  // Fix Random.nextUUIDv4
  content = content.replace(/Random\.nextUUIDv4\(\)/g, 'crypto.randomUUID()');

  fs.writeFileSync(file, content);
}

// Fix lruCache
let lru = fs.readFileSync('src/features/projects/components/assistant/lib/lruCache.ts', 'utf8');
lru = lru.replace(/declare /g, '');
fs.writeFileSync('src/features/projects/components/assistant/lib/lruCache.ts', lru);

// Fix storage.ts
let storage = fs.readFileSync('src/features/projects/components/assistant/lib/storage.ts', 'utf8');
storage = storage.replace(/import \{ useDebouncedValue \} from "@tanstack\/react-pacer";/g, '');
storage = storage.replace(/const debouncedValue = useDebouncedValue\(value, debounceMs\);/g, 'const debouncedValue = value;');
fs.writeFileSync('src/features/projects/components/assistant/lib/storage.ts', storage);

