const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/stores/t3-*.ts');
files.push('src/stores/terminalContext.ts');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Redirect dependencies
  content = content.replace(/from "\.\/types"/g, 'from "./t3-types"');
  content = content.replace(/from "\.\/lib\/storage"/g, 'from "./t3-storage"');
  content = content.replace(/from "\.\/lib\/terminalContext"/g, 'from "./terminalContext"');
  content = content.replace(/from "\.\/modelSelection"/g, 'from "./t3-modelSelection"');
  content = content.replace(/from "\.\/hooks\/useLocalStorage"/g, 'from "@/hooks/useLocalStorage"');

  // Prefix
  content = `// @ts-nocheck\n${content}`;

  fs.writeFileSync(file, content);
}
