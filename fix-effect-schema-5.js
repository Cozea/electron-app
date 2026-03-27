const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix import { ..., ParseResult.ParseIssue, ... } from "effect"
  content = content.replace(/ParseResult\.ParseIssue/g, 'ParseResult');
  content = content.replace(/import \{([^}]*?)ParseResult([^}]*?)\} from "effect";/g, 'import {$1ParseResult$2} from "effect";');
  
  fs.writeFileSync(file, content);
}
