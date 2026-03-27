const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  if (file.endsWith('effect-polyfill.ts')) continue;
  
  let content = fs.readFileSync(file, 'utf8');

  // Prefix with @ts-nocheck to silence all Type Errors in their code
  content = `// @ts-nocheck\n${content}`;

  // Redirect "effect" imports that deal with Schema/Struct/ParseResult to our polyfill
  // First, find the relative path to effect-polyfill.ts
  const depth = file.split('/').length - 3; // e.g. shared/t3-contracts/file.ts -> depth 0
  const relativePrefix = depth > 0 ? '../'.repeat(depth) : './';
  const polyfillPath = `${relativePrefix}effect-polyfill`;

  content = content.replace(
    /import\s+\{([^}]*?(?:Schema|Struct|ParseResult)[^}]*?)\}\s+from\s+"effect";/g,
    (match, imports) => {
      // Split the imports to keep pure effect ones in 'effect', and move Schema/Struct/ParseResult to polyfill
      const tokens = imports.split(',').map(s => s.trim()).filter(s => s);
      const polyfillTokens = [];
      const effectTokens = [];
      for (const t of tokens) {
        if (t.startsWith('Schema') || t.startsWith('Struct') || t.startsWith('ParseResult')) {
          polyfillTokens.push(t);
        } else {
          effectTokens.push(t);
        }
      }
      
      let out = '';
      if (effectTokens.length > 0) out += `import { ${effectTokens.join(', ')} } from "effect";\n`;
      if (polyfillTokens.length > 0) out += `import { ${polyfillTokens.join(', ')} } from "${polyfillPath}";\n`;
      return out;
    }
  );

  fs.writeFileSync(file, content);
}
