import fs from 'fs';
import glob from 'glob';

const files = glob.sync('src/**/*.{ts,tsx}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  if (content.includes('useParams()')) {
    content = content.replace(/useParams\(\)/g, "useParams({ strict: false })");
    changed = true;
  }

  if (content.includes('useSearch()')) {
    // some might already be useSearch({ strict: false })
  }

  if (content.includes('useSearchParams')) {
    content = content.replace(/useSearchParams/g, 'useSearch');
    content = content.replace(/useSearch\(\)/g, "useSearch({ strict: false })");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, content);
  }
}
console.log('Fixes applied');
