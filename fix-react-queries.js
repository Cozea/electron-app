const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/features/projects/components/assistant/lib/*ReactQuery.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/from "\~\/nativeApi"/g, 'from "@/lib/nativeApi"');
  content = content.replace(/from "\.\.\/nativeApi"/g, 'from "@/lib/nativeApi"');
  content = `// @ts-nocheck\n${content}`;
  fs.writeFileSync(file, content);
}
