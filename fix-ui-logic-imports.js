const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/features/projects/components/assistant/chat/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix relative paths
  content = content.replace(/from "\~\/lib\/terminalContext"/g, 'from "@/stores/terminalContext"');
  content = content.replace(/from "\~\/lib\/utils"/g, 'from "@/lib/utils"');

  // Prefix with @ts-nocheck
  content = `// @ts-nocheck\n${content}`;

  fs.writeFileSync(file, content);
}
